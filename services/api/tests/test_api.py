import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.config import get_settings
from app.templates_catalog import TemplateCatalog

NEW_SERVICE = {
    "name": "payments-api",
    "template_id": "python-fastapi",
    "owner": "team-payments",
    "description": "Takes payments",
}


async def test_lists_every_template(client: AsyncClient) -> None:
    templates = (await client.get("/api/templates")).json()
    assert {t["id"] for t in templates} == {"python-fastapi", "node-express", "static-site"}
    assert all(t["port"] > 0 and t["accent"].startswith("#") for t in templates)


async def test_launch_runs_all_six_stages(app: FastAPI, client: AsyncClient) -> None:
    created = await client.post("/api/services", json=NEW_SERVICE)
    assert created.status_code == 201
    assert created.json()["status"] == "launching"

    await app.state.launcher.wait_idle()

    detail = (await client.get("/api/services/payments-api")).json()
    assert detail["status"] == "live"
    assert detail["url"] == "http://payments-api.localtest.me"
    assert detail["repo_url"].endswith("/payments-api")
    steps = detail["launch"]["steps"]
    assert [s["key"] for s in steps] == [
        "validate",
        "repository",
        "pipeline",
        "gitops",
        "deploy",
        "live",
    ]
    assert all(s["status"] == "succeeded" and s["logs"] for s in steps)

    stats = (await client.get("/api/stats")).json()
    assert stats["services"] == 1 and stats["live"] == 1


async def test_events_replay_a_finished_launch(app: FastAPI, client: AsyncClient) -> None:
    await client.post("/api/services", json=NEW_SERVICE)
    await app.state.launcher.wait_idle()

    async with client.stream("GET", "/api/services/payments-api/events") as response:
        body = "".join([chunk async for chunk in response.aiter_text()])
    assert "event: snapshot" in body
    assert '"status": "succeeded"' in body


@pytest.mark.parametrize(
    ("name", "reason"),
    [("Bad Name", None), ("-starts-with-hyphen", None), ("argocd", "reserved"), ("ab", None)],
)
async def test_rejects_bad_names(client: AsyncClient, name: str, reason: str | None) -> None:
    response = await client.post("/api/services", json={**NEW_SERVICE, "name": name})
    assert response.status_code == 422
    if reason:
        assert reason in response.text


async def test_rejects_duplicate_names(app: FastAPI, client: AsyncClient) -> None:
    await client.post("/api/services", json=NEW_SERVICE)
    await app.state.launcher.wait_idle()
    assert (await client.post("/api/services", json=NEW_SERVICE)).status_code == 409
    check = (await client.get("/api/services/check-name", params={"name": "payments-api"})).json()
    assert check == {"name": "payments-api", "available": False, "reason": "Already taken"}


async def test_rejects_unknown_template(client: AsyncClient) -> None:
    response = await client.post("/api/services", json={**NEW_SERVICE, "template_id": "cobol"})
    assert response.status_code == 422


def test_templates_render_without_leftover_placeholders() -> None:
    catalog = TemplateCatalog(get_settings().templates_dir)
    for template in catalog.all():
        files = template.render({"name": "demo-svc", "description": "A demo"})
        assert ".github/workflows/ci.yml" in files
        assert "Dockerfile" in files
        for path, content in files.items():
            assert b"[[" not in content, f"{template.id}/{path} has an unrendered placeholder"


async def test_timestamps_are_utc(app: FastAPI, client: AsyncClient) -> None:
    await client.post("/api/services", json=NEW_SERVICE)
    await app.state.launcher.wait_idle()
    detail = (await client.get("/api/services/payments-api")).json()
    assert detail["created_at"].endswith(("Z", "+00:00"))
    assert detail["launch"]["steps"][0]["started_at"].endswith(("Z", "+00:00"))


def test_every_template_declares_a_non_root_uid() -> None:
    catalog = TemplateCatalog(get_settings().templates_dir)
    assert {t.id: t.uid for t in catalog.all()} == {
        "node-express": 1000,
        "python-fastapi": 10001,
        "static-site": 101,
    }
