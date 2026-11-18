import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update

from app.api import router
from app.cloud import build_cloud
from app.config import Settings, get_settings
from app.db import Database
from app.events import EventBroker
from app.explainer import build_explainer
from app.launcher import Launcher
from app.models import Launch, Service, ServiceStatus, StepStatus
from app.providers import build_provider
from app.scorecard import Scorecards
from app.templates_catalog import TemplateCatalog

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


async def fail_interrupted_launches(db: Database) -> None:
    """A launch still 'running' at startup was cut off by a restart; mark it failed."""
    async with db.sessions() as session:
        await session.execute(
            update(Launch)
            .where(Launch.status == StepStatus.RUNNING)
            .values(status=StepStatus.FAILED, error="Interrupted by an API restart")
        )
        await session.execute(
            update(Service)
            .where(Service.status == ServiceStatus.LAUNCHING)
            .values(status=ServiceStatus.FAILED)
        )
        await session.commit()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.database_url)
        await db.create_all()
        await fail_interrupted_launches(db)
        events = EventBroker()
        catalog = TemplateCatalog(settings.templates_dir)
        app.state.settings = settings
        app.state.db = db
        app.state.events = events
        app.state.catalog = catalog
        cloud = build_cloud(settings)
        app.state.cloud = cloud
        app.state.launcher = launcher = Launcher(
            db.sessions, build_provider(settings), catalog, events, cloud
        )
        app.state.scorecards = Scorecards(settings.scorecard_ttl_seconds)
        app.state.explainer = build_explainer(
            settings.explainer,
            settings.anthropic_key(),
            settings.claude_model,
            settings.gemini_key(),
            settings.gemini_model,
            settings.gemini_overflow_model,
        )
        reconcile = None
        if settings.cloud == "emulator":
            # In the background: startup should not wait on Terraform.
            reconcile = asyncio.create_task(launcher.reconcile_cloud(), name="reconcile-cloud")
        yield
        if reconcile:
            reconcile.cancel()
        await app.state.launcher.shutdown()
        await db.dispose()

    app = FastAPI(title="Launchbay API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(router)
    return app


app = create_app()
