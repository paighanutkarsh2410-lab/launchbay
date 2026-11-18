"""Cloud resources: the launch's cloud stage, the env it hands to GitOps, retry and teardown."""

import sqlite3

from fastapi import FastAPI
from httpx import AsyncClient

from app.cloud import SimulatedCloud
from app.config import Settings
from app.db import Database
from app.providers.base import StepError
from app.providers.demo import DemoProvider

SERVICE = {
    "name": "orders-api",
    "template_id": "python-fastapi",
    "owner": "checkout-team",
    "resources": ["table", "bucket", "queue", "bucket"],
}


class RecordingCloud(SimulatedCloud):
    def __init__(self) -> None:
        super().__init__(speed=0)
        self.destroyed: list[tuple[str, list[str]]] = []

    async def destroy(self, service, owner, kinds):
        self.destroyed.append((service, kinds))
        return await super().destroy(service, owner, kinds)


async def launch(app: FastAPI, client: AsyncClient, body: dict = SERVICE) -> dict:
    assert (await client.post("/api/services", json=body)).status_code == 201
    await app.state.launcher.wait_idle()
    return (await client.get(f"/api/services/{body['name']}")).json()


async def test_cloud_info_lists_what_can_be_requested(client: AsyncClient) -> None:
    info = (await client.get("/api/cloud")).json()
    assert info["mode"] == "simulated"
    assert [k["id"] for k in info["kinds"]] == ["bucket", "queue", "table"]


async def test_launch_provisions_resources_and_passes_their_env(
    app: FastAPI, client: AsyncClient
) -> None:
    detail = await launch(app, client)
    assert detail["status"] == "live"
    # Deduplicated and in a fixed order, whatever order they were asked for in.
    assert detail["resources"] == ["bucket", "queue", "table"]

    kinds = [r["kind"] for r in detail["cloud"]["resources"]]
    assert kinds == ["key", "bucket", "queue", "table"]
    env = detail["cloud"]["env"]
    assert env["LAUNCHBAY_BUCKET"] == "orders-api-123456789012"
    assert env["LAUNCHBAY_TABLE"] == "orders-api"
    assert env["LAUNCHBAY_QUEUE_URL"].endswith("/orders-api")

    steps = {s["key"]: s for s in detail["launch"]["steps"]}
    assert steps["cloud"]["detail"] == "4 resources ready"
    # The GitOps manifest carries the same variables to the deployment.
    assert any("env.LAUNCHBAY_TABLE: orders-api" in line for line in steps["gitops"]["logs"])


async def test_no_resources_skips_provisioning(app: FastAPI, client: AsyncClient) -> None:
    detail = await launch(app, client, {**SERVICE, "resources": []})
    steps = {s["key"]: s for s in detail["launch"]["steps"]}
    assert steps["cloud"]["status"] == "succeeded"
    assert steps["cloud"]["detail"] == "None requested"
    assert detail["cloud"] is None


async def test_rejects_unknown_resources(client: AsyncClient) -> None:
    response = await client.post("/api/services", json={**SERVICE, "resources": ["database"]})
    assert response.status_code == 422


class FailingGitOpsOnce(DemoProvider):
    def __init__(self) -> None:
        super().__init__(speed=0)
        self.calls = 0
        self.envs: list[dict] = []

    async def register_gitops(self, request, ctx) -> None:
        self.calls += 1
        self.envs.append(dict(request.cloud_env))
        if self.calls == 1:
            raise StepError("GitHub is down")
        await super().register_gitops(request, ctx)


async def test_retry_keeps_resources_and_their_env(app: FastAPI, client: AsyncClient) -> None:
    provider = FailingGitOpsOnce()
    app.state.launcher.provider = provider
    assert (await launch(app, client))["status"] == "failed"

    await client.post("/api/services/orders-api/retry")
    await app.state.launcher.wait_idle()
    detail = (await client.get("/api/services/orders-api")).json()

    assert detail["status"] == "live"
    steps = {s["key"]: s for s in detail["launch"]["steps"]}
    assert steps["cloud"]["logs"][-1] == "↺ Kept from the previous launch"
    # The kept stage's env still reaches GitOps on the retry.
    assert provider.envs[1] == provider.envs[0] != {}


async def test_decommission_destroys_resources(app: FastAPI, client: AsyncClient) -> None:
    cloud = RecordingCloud()
    app.state.launcher.cloud = cloud
    await launch(app, client)

    result = await client.post(
        "/api/services/orders-api/decommission", json={"repository": "archive"}
    )
    assert result.status_code == 200
    assert cloud.destroyed == [("orders-api", ["bucket", "queue", "table"])]
    assert any("Destroyed" in line for line in result.json()["steps"])
    assert (await client.get("/api/services/orders-api")).json()["cloud"] is None


async def test_old_databases_gain_the_new_columns(tmp_path) -> None:
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE services (id VARCHAR(32) PRIMARY KEY, name VARCHAR(40))")
    db = Database(Settings(database_url=f"sqlite+aiosqlite:///{path}").database_url)
    await db.create_all()
    await db.dispose()
    with sqlite3.connect(path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(services)")}
    assert {"resources", "cloud", "template_id"} <= columns


def test_terraform_lines_are_shortened_for_the_portal() -> None:
    from app.cloud import shorten

    assert (
        shorten(
            "module.queue[0].aws_sqs_queue.dead_letter: Creation complete after 25s [id=http://x/1/q]"
        )
        == "queue/aws_sqs_queue: Creation complete after 25s"
    )
    assert shorten("aws_kms_key.service[0]: Creating...") == "aws_kms_key: Creating..."
    assert shorten("Apply complete! Resources: 11 added") == "Apply complete! Resources: 11 added"


async def test_reconcile_reapplies_live_services(app: FastAPI, client: AsyncClient) -> None:
    await launch(app, client)
    calls: list[str] = []
    cloud = app.state.launcher.cloud
    original = cloud.provision

    async def provision(service, owner, kinds, ctx=None):
        calls.append(service)
        return await original(service, owner, kinds, ctx)

    cloud.provision = provision
    await launch(app, client, {**SERVICE, "name": "no-cloud", "resources": []})
    await app.state.launcher.reconcile_cloud()
    # Only services with resources are re-applied.
    assert calls == ["orders-api"]
