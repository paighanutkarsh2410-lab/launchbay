from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from app.templates_catalog import Template


class StepError(Exception):
    """A stage failed in a way the developer can act on. The message is shown in the portal."""


class StepContext(Protocol):
    async def log(self, line: str) -> None: ...

    async def detail(self, text: str) -> None: ...


@dataclass
class LaunchRequest:
    name: str
    description: str
    owner: str
    template: Template
    # Cloud resources the service asked for (bucket, queue, table).
    resources: list[str] = field(default_factory=list)
    # Environment variables for those resources, set by the cloud stage.
    cloud_env: dict[str, str] = field(default_factory=dict)
    # Whether the resources live on the local AWS emulator.
    cloud_emulated: bool = False
    # Filled in as the launch goes; later stages read what earlier ones produced.
    outputs: dict[str, str] = field(default_factory=dict)


@dataclass
class RepoFacts:
    """What a scorecard needs to know about a service, gathered from the outside world.
    None means "could not tell", and the check is skipped rather than failed."""

    ci_conclusion: str | None = None  # latest CI run on main: success, failure, ...
    ci_url: str | None = None
    scans_passed: bool | None = None  # the Trivy scan steps of that run
    has_readme: bool | None = None
    has_dependabot: bool | None = None
    last_commit_at: datetime | None = None
    deploy_health: str | None = None  # Argo CD: Healthy, Degraded, Progressing, ...


class Provider(ABC):
    """Talks to the outside world for each launch stage."""

    async def repo_facts(self, request: LaunchRequest) -> RepoFacts:
        """Facts for the service's scorecard. Providers that can't tell return nothing."""
        return RepoFacts()

    async def failure_context(self, request: LaunchRequest, stage: str) -> str | None:
        """Extra evidence for explaining a failed stage, such as the failed CI job's log."""
        return None

    @abstractmethod
    async def create_repository(self, request: LaunchRequest, ctx: StepContext) -> str:
        """Creates the repo with the rendered template. Returns its URL."""

    @abstractmethod
    async def run_pipeline(self, request: LaunchRequest, ctx: StepContext) -> str:
        """Waits for the first CI run. Returns the published image reference."""

    @abstractmethod
    async def register_gitops(self, request: LaunchRequest, ctx: StepContext) -> None:
        """Commits the service manifest to the GitOps repo."""

    @abstractmethod
    async def deploy(self, request: LaunchRequest, ctx: StepContext) -> None:
        """Waits until Argo CD reports the service Synced and Healthy."""

    @abstractmethod
    async def wait_live(self, request: LaunchRequest, ctx: StepContext) -> str:
        """Waits for the service's health check. Returns its URL."""

    @abstractmethod
    async def resume(self, request: LaunchRequest, kept: dict[str, str | None]) -> None:
        """Before a retry: fills request.outputs from the stages being kept.

        `kept` maps each kept stage to its recorded detail (the pipeline's is its image)."""

    @abstractmethod
    async def decommission(self, request: LaunchRequest, *, delete_repository: bool) -> list[str]:
        """Removes the GitOps manifest, then archives or deletes the repo. Returns what it did.
        Must succeed when parts are already gone, so a half-launched service can be removed."""
