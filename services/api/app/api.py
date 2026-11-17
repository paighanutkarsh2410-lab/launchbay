import json
import statistics
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.launcher import Launcher
from app.models import Launch, Service, ServiceStatus, StepStatus
from app.schemas import (
    NAME_PATTERN,
    RESERVED_NAMES,
    LaunchOut,
    NameCheck,
    ServiceCreate,
    ServiceDetail,
    ServiceOut,
    Stats,
    TemplateOut,
)
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown template")
    if await session.scalar(select(func.count()).where(Service.name == body.name)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A service named '{body.name}' exists")
    return await launcher.create(
        session,
        name=body.name,
        template_id=body.template_id,
        owner=body.owner,
        description=body.description,
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
        services=sum(counts.values()),
        live=counts.get(ServiceStatus.LIVE, 0),
        launching=counts.get(ServiceStatus.LAUNCHING, 0),
        failed=counts.get(ServiceStatus.FAILED, 0),
        median_launch_seconds=round(statistics.median(durations), 1) if durations else None,
    )


@router.get("/healthz", include_in_schema=False)
async def healthz() -> dict:
    return {"status": "ok"}
