from collections.abc import AsyncIterator

import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
async def app(tmp_path) -> AsyncIterator[FastAPI]:
    settings = Settings(
        _env_file=None,  # tests never read the developer's services/api/.env
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        provider="demo",
        demo_speed=0,  # no waiting in tests
    )
    application = create_app(settings)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
