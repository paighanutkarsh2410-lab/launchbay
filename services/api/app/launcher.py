"""Runs a launch: seven stages in order, each persisted and streamed as it changes."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.cloud import Cloud, ordered
from app.events import EventBroker
from app.models import Launch, LaunchStep, Service, ServiceStatus, StepStatus
from app.providers.base import LaunchRequest, Provider, StepError
from app.templates_catalog import TemplateCatalog

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Stage:
    key: str
    title: str


STAGES = [
    Stage("validate", "Validate request"),
    Stage("repository", "Create repository"),
    Stage("cloud", "Provision cloud resources"),
    Stage("pipeline", "Build, scan & sign"),
    Stage("gitops", "Register with GitOps"),
    Stage("deploy", "Deploy with Argo CD"),
    Stage("live", "Go live"),
]


def now() -> datetime:
    return datetime.now(UTC)


def step_event(step: LaunchStep) -> dict:
    return {
        "type": "step",
        "key": step.key,
        "status": step.status.value,
        "detail": step.detail,
        "started_at": step.started_at.isoformat() if step.started_at else None,
        "finished_at": step.finished_at.isoformat() if step.finished_at else None,
    }


class StepRecorder:
    """The StepContext a provider writes to: persists and publishes logs and details."""

    def __init__(
        self, launcher: "Launcher", session: AsyncSession, launch_id: str, step: LaunchStep
    ) -> None:
        self.launcher = launcher
        self.session = session
        self.launch_id = launch_id
        self.step = step

    async def log(self, line: str) -> None:
        self.step.logs = [*self.step.logs, line]
        await self.session.commit()
        await self.launcher.events.publish(
            self.launch_id, {"type": "log", "key": self.step.key, "line": line}
        )

    async def detail(self, text: str) -> None:
        self.step.detail = text
        await self.session.commit()
        await self.launcher.events.publish(self.launch_id, step_event(self.step))


class Launcher:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        provider: Provider,
        catalog: TemplateCatalog,
        events: EventBroker,
        cloud: Cloud,
    ) -> None:
        self.sessions = sessions
        self.provider = provider
        self.cloud = cloud
        self.catalog = catalog
        self.events = events
        self._tasks: set[asyncio.Task] = set()

    async def create(
        self,
        session: AsyncSession,
        *,
        name: str,
        template_id: str,
        owner: str,
        description: str,
        resources: list[str] | None = None,
    ) -> Service:
        service = Service(
            name=name,
            template_id=template_id,
            owner=owner,
            description=description,
            resources=ordered(resources or []),
        )
        launch = Launch(service=service)
        launch.steps = [
            LaunchStep(key=stage.key, title=stage.title, position=i, logs=[])
            for i, stage in enumerate(STAGES)
        ]
        session.add(service)
        await session.commit()
        self.start(launch.id)
        return service

    async def retry(self, session: AsyncSession, service: Service) -> Launch:
        """Starts a new launch that keeps every stage that succeeded and resumes at the first
        one that did not. The previous launch stays in the history."""
        previous = {step.key: step for step in service.launches[0].steps}
        steps = []
        resuming = False
        for i, stage in enumerate(STAGES):
            # A launch from before a stage was added has no step for it: resume there.
            old = previous.get(stage.key)
            if old is not None and old.status == StepStatus.SUCCEEDED and not resuming:
                steps.append(
                    LaunchStep(
                        key=stage.key,
                        title=stage.title,
                        position=i,
                        status=StepStatus.SUCCEEDED,
                        detail=old.detail,
                        logs=[*old.logs, "↺ Kept from the previous launch"],
                        started_at=old.started_at,
                        finished_at=old.finished_at,
                    )
                )
            else:
                resuming = True
                steps.append(LaunchStep(key=stage.key, title=stage.title, position=i, logs=[]))
        launch = Launch(service=service, steps=steps)
        service.status = ServiceStatus.LAUNCHING
        service.url = None
        session.add(launch)
        await session.commit()
        self.start(launch.id)
        return launch

    async def decommission(
        self, session: AsyncSession, service: Service, *, delete_repository: bool
    ) -> list[str]:
        """Removes the service from GitOps (Argo CD prunes it), destroys its cloud resources,
        and archives or deletes its repo."""
        request = self._request(service)
        lines = await self.provider.decommission(request, delete_repository=delete_repository)
        if service.resources or service.cloud:
            lines += await self.cloud.destroy(service.name, service.owner, service.resources or [])
            service.cloud = None
        if delete_repository:
            await session.delete(service)
        else:
            service.status = ServiceStatus.DECOMMISSIONED
            service.url = None
        await session.commit()
        return lines

    def start(self, launch_id: str) -> None:
        task = asyncio.create_task(self.run(launch_id), name=f"launch-{launch_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def wait_idle(self) -> None:
        """Waits for running launches to finish. Used by tests."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def shutdown(self) -> None:
        """Stops running launches. They are marked failed on the next start."""
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def run(self, launch_id: str) -> None:
        async with self.sessions() as session:
            launch = await session.scalar(
                select(Launch)
                .where(Launch.id == launch_id)
                .options(selectinload(Launch.steps), selectinload(Launch.service))
            )
            if launch is None:
                return
            service = launch.service
            request = self._request(service)
            steps = {step.key: step for step in launch.steps}
            kept = {k: s.detail for k, s in steps.items() if s.status == StepStatus.SUCCEEDED}
            if "cloud" in kept:
                request.cloud_env = dict((service.cloud or {}).get("env") or {})

            failed: str | None = None
            if kept:
                # A retry: let the provider rebuild what the kept stages produced.
                try:
                    await self.provider.resume(request, kept)
                    service.repo_url = service.repo_url or request.outputs.get("repo_url")
                except StepError as error:
                    failed = str(error)
                except Exception:
                    log.exception("Launch %s could not resume", launch_id)
                    failed = "Could not resume the previous launch. Check the API logs."

            for stage in STAGES:
                step = steps[stage.key]
                if step.status == StepStatus.SUCCEEDED:
                    continue
                if failed:
                    # Resuming failed: report it on the first stage that would have run.
                    step.status = StepStatus.FAILED
                    step.started_at = step.finished_at = now()
                    await StepRecorder(self, session, launch_id, step).log(f"✗ {failed}")
                    await session.commit()
                    await self.events.publish(launch_id, step_event(step))
                    break
                step.status = StepStatus.RUNNING
                step.started_at = now()
                await session.commit()
                await self.events.publish(launch_id, step_event(step))

                recorder = StepRecorder(self, session, launch_id, step)
                try:
                    await self._run_stage(stage.key, request, recorder, service)
                except StepError as error:
                    failed = str(error)
                except Exception:
                    log.exception("Launch %s failed in stage %s", launch_id, stage.key)
                    failed = f"Unexpected error in '{stage.title}'. Check the API logs."

                step.finished_at = now()
                if failed:
                    step.status = StepStatus.FAILED
                    await recorder.log(f"✗ {failed}")
                else:
                    step.status = StepStatus.SUCCEEDED
                await session.commit()
                await self.events.publish(launch_id, step_event(step))
                if failed:
                    break

            launch.finished_at = now()
            launch.status = StepStatus.FAILED if failed else StepStatus.SUCCEEDED
            launch.error = failed
            service.status = ServiceStatus.FAILED if failed else ServiceStatus.LIVE
            await session.commit()
            await self.events.publish(
                launch_id,
                {
                    "type": "launch",
                    "status": launch.status.value,
                    "error": failed,
                    "url": service.url,
                    "repo_url": service.repo_url,
                },
            )

    async def _run_stage(
        self, key: str, request: LaunchRequest, ctx: StepRecorder, service: Service
    ) -> None:
        match key:
            case "validate":
                await ctx.log(f"name: {request.name}")
                await ctx.log(f"template: {request.template.name} ({request.template.runtime})")
                await ctx.log(f"owner: {request.owner}")
                await ctx.detail("Name, template and owner are valid")
            case "repository":
                service.repo_url = await self.provider.create_repository(request, ctx)
            case "cloud":
                if not request.resources:
                    await ctx.log("No cloud resources requested")
                    await ctx.detail("None requested")
                    return
                await ctx.log(f"Target: {self.cloud.label}")
                await ctx.log(f"Requested: {', '.join(request.resources)}")
                result = await self.cloud.provision(
                    service.name, service.owner, request.resources, ctx
                )
                service.cloud = result.as_json()
                request.cloud_env = result.env
                for name, value in result.env.items():
                    await ctx.log(f"  {name}={value}")
                await ctx.detail(f"{len(result.resources)} resources ready")
            case "pipeline":
                request.outputs["image"] = await self.provider.run_pipeline(request, ctx)
            case "gitops":
                await self.provider.register_gitops(request, ctx)
            case "deploy":
                await self.provider.deploy(request, ctx)
            case "live":
                service.url = await self.provider.wait_live(request, ctx)

    def _request(self, service: Service) -> LaunchRequest:
        return LaunchRequest(
            name=service.name,
            description=service.description,
            owner=service.owner,
            template=self.catalog.get(service.template_id),
            resources=list(service.resources or []),
            cloud_emulated=self.cloud.mode == "emulator",
        )

    async def reconcile_cloud(self) -> None:
        """Re-applies every live service's Terraform. The emulator keeps resources in memory,
        so after a restart this puts them back; on a running emulator it changes nothing."""
        async with self.sessions() as session:
            services = list(
                await session.scalars(select(Service).where(Service.status == ServiceStatus.LIVE))
            )
            for service in services:
                if not service.resources:
                    continue
                try:
                    result = await self.cloud.provision(
                        service.name, service.owner, service.resources
                    )
                except Exception as error:  # noqa: BLE001 - one service must not stop the rest
                    log.warning(
                        "Could not reconcile cloud resources for %s: %s", service.name, error
                    )
                    continue
                # Recreated resources can have new ARNs (the KMS key's is random).
                service.cloud = result.as_json()
                await session.commit()
                log.info("Cloud resources for %s are in place", service.name)
