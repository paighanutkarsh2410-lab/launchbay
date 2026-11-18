from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz() -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_names_the_service() -> None:
    assert client.get("/").json()["service"] == "[[name]]"


def test_cloud_is_empty_without_resources(monkeypatch) -> None:
    for name in ("LAUNCHBAY_BUCKET", "LAUNCHBAY_QUEUE_URL", "LAUNCHBAY_TABLE"):
        monkeypatch.delenv(name, raising=False)
    assert client.get("/cloud").json()["resources"] == []


def test_cloud_reports_unreachable_resources(monkeypatch) -> None:
    # Nothing listens here, so the check must fail fast and say so instead of erroring.
    monkeypatch.setenv("AWS_ENDPOINT_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("LAUNCHBAY_TABLE", "orders")
    [table] = client.get("/cloud").json()["resources"]
    assert table["name"] == "orders" and table["reachable"] is False
    assert table["error"]
