"""The public demo: seeded from a snapshot, simulated, and safe to leave open to the internet."""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from app.config import Settings
from app.main import create_app
from app.models import Service

EXPORTED = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


def _step(key: str, position: int, status: str = "succeeded") -> dict:
    return {
        "key": key,
        "title": key.title(),
        "position": position,
        "status": status,
        "detail": None,
        "logs": [f"{key} log"],
        "started_at": (EXPORTED - timedelta(minutes=3)).isoformat(),
        "finished_at": (EXPORTED - timedelta(minutes=2)).isoformat(),
    }


def _service(name: str, status: str, explanation: dict | None = None) -> dict:
    keys = ["validate", "repository", "cloud", "pipeline", "gitops", "deploy", "live"]
    failed = status == "failed"
    return {
        "id": f"id-{name}",
        "name": name,
        "description": f"{name} for the demo",
        "template_id": "python-fastapi",
        "owner": "team-platform",
        "status": status,
        "repo_url": f"https://github.com/launchbay-labs/{name}",
        "url": f"http://{name}.localtest.me",
        "resources": [],
        "cloud": None,
        "created_at": (EXPORTED - timedelta(hours=2)).isoformat(),
        "launch": {
            "id": f"launch-{name}",
            "status": "failed" if failed else "succeeded",
            "started_at": (EXPORTED - timedelta(minutes=3)).isoformat(),
            "finished_at": (EXPORTED - timedelta(minutes=1)).isoformat(),
            "error": "CI finished with 'failure'." if failed else None,
            "explanation": explanation,
            "steps": [
                _step(k, i, "failed" if failed and k == "pipeline" else "succeeded")
                for i, k in enumerate(keys[: 4 if failed else 7])
            ],
        },
    }


STORED = {
    "summary": "A test failed.",
    "cause": "The root response lost its 'service' field.",
    "fix": ["Fix the test", "Retry"],
    "evidence": ["FAILED tests/test_main.py::test_root"],
    "confidence": "high",
    "source": "gemini",
    "model": "gemini-3.8-flash",
    "stage": "pipeline",
    "note": None,
}
CARD = {
    "service": "steady-api",
    "score": 95,
    "grade": "Gold",
    "checked_at": EXPORTED.isoformat(),
    "checks": [],
}


@pytest.fixture
async def demo_app(tmp_path) -> AsyncIterator[FastAPI]:
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(
        json.dumps(
            {
                "exported_at": EXPORTED.isoformat(),
                "services": [
                    _service("steady-api", "live"),
                    _service("broken-api", "failed", STORED),
                ],
                "scorecards": {"steady-api": CARD},
            }
        )
    )
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'demo.db'}",
        public_demo=True,
        provider="github",  # the demo must override these
        explainer="gemini",
        demo_speed=0,
        demo_snapshot=snapshot,
        demo_launches_per_hour=2,
    )
    application = create_app(settings)
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def demo(demo_app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=demo_app), base_url="http://test") as c:
        yield c


def test_public_demo_never_reaches_real_systems() -> None:
    settings = Settings(_env_file=None, public_demo=True, provider="github", cloud="emulator")
    assert (settings.provider, settings.cloud, settings.explainer) == ("demo", "simulated", "rules")


async def test_seeds_the_snapshot_with_timestamps_moved_to_now(demo: AsyncClient) -> None:
    services = (await demo.get("/api/services")).json()
    assert {s["name"] for s in services} == {"steady-api", "broken-api"}
    created = datetime.fromisoformat(services[0]["created_at"])
    # Exported two hours before the snapshot; still two hours old today.
    assert timedelta(hours=1.9) < datetime.now(UTC) - created < timedelta(hours=2.1)
    detail = (await demo.get("/api/services/broken-api")).json()
    assert detail["launch"]["explanation"]["source"] == "gemini"


async def test_info_reports_the_demo(demo: AsyncClient) -> None:
    info = (await demo.get("/api/info")).json()
    assert info["public_demo"] is True and info["demo_ttl_hours"] == 3


async def test_seeded_services_are_read_only(demo: AsyncClient) -> None:
    assert (await demo.post("/api/services/broken-api/retry")).status_code == 403
    gone = await demo.post("/api/services/steady-api/decommission", json={"repository": "delete"})
    assert gone.status_code == 403
    # Asking again returns the stored answer instead of replacing it.
    again = await demo.post("/api/services/broken-api/explain?refresh=true")
    assert again.status_code == 200 and again.json()["source"] == "gemini"


async def test_seeded_scorecards_are_served_from_the_snapshot(demo: AsyncClient) -> None:
    card = (await demo.get("/api/services/steady-api/scorecard")).json()
    assert card["score"] == 95
    board = {s["service"]: s["score"] for s in (await demo.get("/api/scorecards")).json()}
    assert board["steady-api"] == 95 and "broken-api" in board


async def test_launches_are_rate_limited_per_visitor(demo: AsyncClient) -> None:
    def launch(name: str, ip: str = "203.0.113.7"):
        return demo.post(
            "/api/services",
            json={"name": name, "template_id": "python-fastapi", "owner": "visitor"},
            headers={"x-forwarded-for": f"{ip}, 10.0.0.1"},
        )

    assert (await launch("first-api")).status_code == 201
    assert (await launch("second-api")).status_code == 201
    limited = await launch("third-api")
    assert limited.status_code == 429 and "per visitor" in limited.json()["detail"]
    assert (await launch("other-api", ip="198.51.100.4")).status_code == 201


async def test_visitor_services_expire_but_seeded_ones_stay(
    demo_app: FastAPI, demo: AsyncClient
) -> None:
    await demo.post(
        "/api/services",
        json={"name": "visitor-api", "template_id": "python-fastapi", "owner": "visitor"},
    )
    async with demo_app.state.db.sessions() as session:
        await session.execute(
            update(Service).values(created_at=datetime.now(UTC) - timedelta(hours=10))
        )
        await session.commit()
    assert await demo_app.state.demo.remove_expired(demo_app.state.db) == 1
    names = {s["name"] for s in (await demo.get("/api/services")).json()}
    assert names == {"steady-api", "broken-api"}


async def test_info_without_the_demo(client: AsyncClient) -> None:
    info = (await client.get("/api/info")).json()
    assert info["public_demo"] is False and info["demo_ttl_hours"] is None
