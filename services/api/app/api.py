import asyncio
import json
import logging
import statistics
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.cloud import KINDS
from app.explainer import Explainer, ExplanationOut, Failure
from app.guardrails import load_guardrails
from app.launcher import Launcher
from app.models import Launch, Service, ServiceStatus, StepStatus
from app.providers.base import StepError
from app.schemas import (
    NAME_PATTERN,
    RESERVED_NAMES,
    AssistantInfo,
    CheckOut,
    CloudInfo,
    CloudOut,
    DecommissionRequest,
    DecommissionResult,
    GuardrailOut,
    LaunchOut,
    NameCheck,
    ResourceKindOut,
    ScorecardOut,
    ScoreSummary,
    ServiceCreate,
    ServiceDetail,
    ServiceOut,
    Stats,
    TemplateOut,
)
from app.scorecard import Scorecard, scorable
from app.templates_catalog import TemplateCatalog

router = APIRouter(prefix="/api")


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async for session in request.app.state.db.session():
        yield session


def get_catalog(request: Request) -> TemplateCatalog:
    return request.app.state.catalog


def get_launcher(request: Request) -> Launcher:
    return request.app.state.launcher


Session = Annotated[AsyncSession, Depends(get_session)]
Catalog = Annotated[TemplateCatalog, Depends(get_catalog)]


@router.get("/templates", response_model=list[TemplateOut])
async def list_templates(catalog: Catalog) -> list[TemplateOut]:
    fields = TemplateOut.model_fields
    return [TemplateOut(**{k: getattr(t, k) for k in fields}) for t in catalog.all()]


@router.get("/cloud", response_model=CloudInfo)
async def cloud_info(request: Request) -> CloudInfo:
    """What a service can ask for at launch, and where it will be provisioned."""
    cloud = request.app.state.cloud
    return CloudInfo(
        mode=cloud.mode,
        label=cloud.label,
        kinds=[ResourceKindOut(**vars(kind)) for kind in KINDS],
    )


@router.get("/services", response_model=list[ServiceOut])
async def list_services(session: Session) -> list[Service]:
    return list(await session.scalars(select(Service).order_by(Service.created_at.desc())))


@router.get("/services/check-name", response_model=NameCheck)
async def check_name(name: str, session: Session) -> NameCheck:
    candidate = name.strip().lower()
    if not NAME_PATTERN.fullmatch(candidate) or "--" in candidate or len(candidate) < 3:
        return NameCheck(name=candidate, available=False, reason="Invalid name")
    if candidate in RESERVED_NAMES:
        return NameCheck(name=candidate, available=False, reason="Reserved name")
    taken = await session.scalar(select(func.count()).where(Service.name == candidate))
    return NameCheck(name=candidate, available=not taken, reason="Already taken" if taken else None)


@router.post("/services", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
async def create_service(
    body: ServiceCreate,
    session: Session,
    catalog: Catalog,
    launcher: Annotated[Launcher, Depends(get_launcher)],
) -> Service:
    if catalog.get(body.template_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown template")
    if await session.scalar(select(func.count()).where(Service.name == body.name)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A service named '{body.name}' exists")
    return await launcher.create(
        session,
        name=body.name,
        template_id=body.template_id,
        owner=body.owner,
        description=body.description,
        resources=body.resources,
    )


async def _load_service(session: AsyncSession, name: str) -> Service:
    service = await session.scalar(
        select(Service)
        .where(Service.name == name)
        .options(selectinload(Service.launches).selectinload(Launch.steps))
    )
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    return service


@router.get("/services/{name}", response_model=ServiceDetail)
async def get_service(name: str, session: Session) -> ServiceDetail:
    service = await _load_service(session, name)
    latest = service.launches[0] if service.launches else None
    return ServiceDetail(
        **ServiceOut.model_validate(service).model_dump(),
        launch=LaunchOut.model_validate(latest) if latest else None,
        cloud=CloudOut.model_validate(service.cloud) if service.cloud else None,
    )


@router.get("/services/{name}/events")
async def stream_events(name: str, request: Request, session: Session) -> EventSourceResponse:
    """Streams the latest launch: a snapshot first, then every change until it finishes."""
    service = await _load_service(session, name)
    if not service.launches:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No launch for this service")
    launch_id = service.launches[0].id
    broker = request.app.state.events
    sessions = request.app.state.db.sessions

    async def events() -> AsyncIterator[dict]:
        # Subscribe before taking the snapshot so no change falls in between. The request's
        # session is closed once streaming starts, so the snapshot uses its own.
        async with broker.subscribe(launch_id) as queue:
            async with sessions() as own:
                launch = await own.scalar(
                    select(Launch).where(Launch.id == launch_id).options(selectinload(Launch.steps))
                )
                snapshot = LaunchOut.model_validate(launch).model_dump(mode="json")
            yield {"event": "snapshot", "data": json.dumps(snapshot)}
            if snapshot["status"] != StepStatus.RUNNING:
                return
            while True:
                event = await queue.get()
                yield {"event": event["type"], "data": json.dumps(event)}
                if event["type"] == "launch":
                    return

    return EventSourceResponse(events(), ping=15)


@router.post(
    "/services/{name}/retry", response_model=ServiceOut, status_code=status.HTTP_202_ACCEPTED
)
async def retry_service(
    name: str, session: Session, launcher: Annotated[Launcher, Depends(get_launcher)]
) -> Service:
    """Resumes a failed launch at the stage that failed, keeping the stages that succeeded."""
    service = await _load_service(session, name)
    if service.status != ServiceStatus.FAILED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a failed launch can be retried")
    await launcher.retry(session, service)
    return service


@router.post("/services/{name}/decommission", response_model=DecommissionResult)
async def decommission_service(
    name: str,
    body: DecommissionRequest,
    session: Session,
    launcher: Annotated[Launcher, Depends(get_launcher)],
) -> DecommissionResult:
    """Takes a service out of GitOps (Argo CD prunes it) and archives or deletes its repo."""
    service = await _load_service(session, name)
    if service.status == ServiceStatus.LAUNCHING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Wait for the launch to finish first")
    if service.status == ServiceStatus.DECOMMISSIONED and body.repository == "archive":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already decommissioned")
    try:
        steps = await launcher.decommission(
            session, service, delete_repository=body.repository == "delete"
        )
    except StepError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
    return DecommissionResult(name=name, repository=body.repository, steps=steps)


@router.get("/guardrails", response_model=list[GuardrailOut])
async def list_guardrails(request: Request) -> list[GuardrailOut]:
    """The policies Kyverno enforces on every launched namespace."""
    return [
        GuardrailOut(**vars(g)) for g in load_guardrails(request.app.state.settings.policies_dir)
    ]


@router.get("/stats", response_model=Stats)
async def stats(session: Session) -> Stats:
    counts = dict(
        (await session.execute(select(Service.status, func.count()).group_by(Service.status))).all()
    )
    finished = await session.execute(
        select(Launch.started_at, Launch.finished_at).where(Launch.status == StepStatus.SUCCEEDED)
    )
    durations = [(end - start).total_seconds() for start, end in finished.all() if end]
    return Stats(
        # Decommissioned services stay in the history but are not counted as running ones.
        services=sum(counts.values()) - counts.get(ServiceStatus.DECOMMISSIONED, 0),
        live=counts.get(ServiceStatus.LIVE, 0),
        launching=counts.get(ServiceStatus.LAUNCHING, 0),
        failed=counts.get(ServiceStatus.FAILED, 0),
        median_launch_seconds=round(statistics.median(durations), 1) if durations else None,
    )


@router.get("/healthz", include_in_schema=False)
async def healthz() -> dict:
    return {"status": "ok"}


# Scorecards


def _scorecard_out(card: Scorecard) -> ScorecardOut:
    return ScorecardOut(
        service=card.service,
        score=card.score,
        grade=card.grade,
        checked_at=card.checked_at,
        checks=[
            CheckOut(
                id=r.check.id,
                title=r.check.title,
                category=r.check.category,
                weight=r.check.weight,
                description=r.check.description,
                remedy=r.check.remedy,
                result=r.result,
                detail=r.detail,
            )
            for r in card.results
        ],
    )


@router.get("/services/{name}/scorecard", response_model=ScorecardOut)
async def get_scorecard(
    name: str,
    session: Session,
    request: Request,
    launcher: Annotated[Launcher, Depends(get_launcher)],
    fresh: bool = False,
) -> ScorecardOut:
    service = await _load_service(session, name)
    if not scorable(service):
        raise HTTPException(status.HTTP_409_CONFLICT, "Scorecards cover launched services")
    card = await request.app.state.scorecards.get(
        service, launcher._request(service), launcher.provider, fresh=fresh
    )
    return _scorecard_out(card)


@router.get("/scorecards", response_model=list[ScoreSummary])
async def list_scorecards(
    session: Session, request: Request, launcher: Annotated[Launcher, Depends(get_launcher)]
) -> list[ScoreSummary]:
    services = [
        s
        for s in await session.scalars(
            select(Service).options(selectinload(Service.launches).selectinload(Launch.steps))
        )
        if scorable(s)
    ]
    scorecards = request.app.state.scorecards
    cards = await asyncio.gather(
        *(scorecards.get(s, launcher._request(s), launcher.provider) for s in services),
        return_exceptions=True,
    )
    return [
        ScoreSummary(service=card.service, score=card.score, grade=card.grade)
        for card in cards
        if isinstance(card, Scorecard)
    ]


# Failure explanations


@router.get("/assistant", response_model=AssistantInfo)
async def assistant_info(request: Request) -> AssistantInfo:
    explainer: Explainer = request.app.state.explainer
    return AssistantInfo(source=explainer.source, label=explainer.label)


@router.post("/services/{name}/explain", response_model=ExplanationOut)
async def explain_failure(
    name: str,
    session: Session,
    request: Request,
    launcher: Annotated[Launcher, Depends(get_launcher)],
    refresh: bool = False,
) -> ExplanationOut:
    """Explains the service's most recent failed launch. The answer is stored with the launch,
    so asking again is free unless refresh is set."""
    service = await _load_service(session, name)
    launch = next((x for x in service.launches if x.status == StepStatus.FAILED), None)
    step = launch and next((s for s in launch.steps if s.status == StepStatus.FAILED), None)
    if launch is None or step is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No failed launch to explain")
    if launch.explanation and not refresh:
        return ExplanationOut.model_validate(launch.explanation)

    launch_request = launcher._request(service)
    try:
        context = await launcher.provider.failure_context(launch_request, step.key)
    except Exception as error:  # noqa: BLE001 - extra evidence is optional
        context = None
        logging.getLogger(__name__).warning("No failure context for %s: %s", name, error)
    settings = request.app.state.settings
    guardrails = [
        f"{g.title}: {'; '.join(g.rules)}" for g in load_guardrails(settings.policies_dir)
    ]
    failure = Failure(
        service=service.name,
        template=service.template_id,
        stage=step.key,
        stage_title=step.title,
        error=launch.error or "",
        logs=list(step.logs or []),
        context=context,
        guardrails=guardrails,
    )
    explanation = await request.app.state.explainer.explain(failure)
    launch.explanation = explanation.model_dump(mode="json")
    await session.commit()
    return explanation
