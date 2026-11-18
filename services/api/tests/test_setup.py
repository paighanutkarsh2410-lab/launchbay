"""Self-hosting: connecting GitHub through an App manifest, against a fake GitHub."""

import json
from collections.abc import AsyncIterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from asgi_lifespan import LifespanManager
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app
from app.providers.github import GitHubProvider
from app.setup import GITOPS_SEED, PERMISSIONS, write_env

PEM = (
    rsa.generate_private_key(public_exponent=65537, key_size=2048)
    .private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    .decode()
)


class FakeGitHub:
    """Just enough of the GitHub API for the manifest flow."""

    def __init__(self, gitops_exists: bool = False) -> None:
        self.gitops_exists = gitops_exists
        self.calls: list[str] = []
        self.files: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append(f"{method} {path}")
        if method == "POST" and path == "/app-manifests/good-code/conversions":
            return httpx.Response(201, json={"id": 4242, "slug": "launchbay-acme", "pem": PEM})
        if method == "POST" and path.startswith("/app-manifests/"):
            return httpx.Response(404, json={"message": "Not Found"})
        if path == "/orgs/acme/installation":
            return httpx.Response(200, json={"id": 7})
        if path == "/app/installations/7/access_tokens":
            return httpx.Response(201, json={"token": "ghs_fake"})
        if method == "GET" and path == "/repos/acme/launchbay-gitops":
            return httpx.Response(200 if self.gitops_exists else 404, json={})
        if method == "POST" and path == "/orgs/acme/repos":
            assert json.loads(request.content)["private"] is False
            return httpx.Response(201, json={"full_name": "acme/launchbay-gitops"})
        if method == "PUT" and path.startswith("/repos/acme/launchbay-gitops/contents/"):
            self.files.append(path.split("/contents/", 1)[1])
            return httpx.Response(201, json={})
        return httpx.Response(500, json={"message": f"unexpected {method} {path}"})


@pytest.fixture
async def selfhost(tmp_path) -> AsyncIterator[tuple[FastAPI, AsyncClient, FakeGitHub]]:
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'setup.db'}",
        provider="demo",
        demo_speed=0,
        explainer="rules",
        launchbay_home=tmp_path / "home",
        env_file_path=tmp_path / ".env",
        public_api_url="http://localhost:8000",
        portal_url="http://localhost:8000",
    )
    (tmp_path / ".env").write_text("LAUNCHBAY_ARGOCD_TOKEN=keep-me\n")
    fake = FakeGitHub()
    app = create_app(settings)
    async with LifespanManager(app):
        app.state.github_transport = httpx.MockTransport(fake)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield app, c, fake


async def start(client: AsyncClient) -> str:
    response = await client.post("/api/setup/github/manifest", json={"owner": "acme"})
    assert response.status_code == 200
    body = response.json()
    assert body["action"].startswith("https://github.com/organizations/acme/settings/apps/new?")
    manifest = body["manifest"]
    assert manifest["default_permissions"] == PERMISSIONS
    assert manifest["redirect_url"] == "http://localhost:8000/api/setup/github/callback"
    assert manifest["setup_url"] == "http://localhost:8000/api/setup/github/installed"
    assert manifest["hook_attributes"]["active"] is False and manifest["public"] is False
    return parse_qs(urlparse(body["action"]).query)["state"][0]


async def test_connect_github_end_to_end(selfhost, tmp_path) -> None:
    app, client, fake = selfhost
    state = await start(client)

    # GitHub created the App: the key is kept and the browser goes on to install it.
    created = await client.get(f"/api/setup/github/callback?code=good-code&state={state}")
    assert created.status_code == 302
    assert created.headers["location"] == "https://github.com/apps/launchbay-acme/installations/new"
    key = tmp_path / "home" / "github-app-launchbay-acme.pem"
    assert key.read_text() == PEM
    env = (tmp_path / ".env").read_text()
    assert "LAUNCHBAY_ARGOCD_TOKEN=keep-me" in env
    assert "LAUNCHBAY_GITHUB_APP_ID=4242" in env and "LAUNCHBAY_GITHUB_OWNER=acme" in env

    # Installed: the GitOps repo is created from the seed and launches become real.
    installed = await client.get("/api/setup/github/installed?installation_id=7")
    assert installed.status_code == 302
    assert installed.headers["location"] == (
        "http://localhost:8000/setup?connected=acme&gitops=created"
    )
    seed = sorted(
        p.relative_to(GITOPS_SEED).as_posix() for p in GITOPS_SEED.rglob("*") if p.is_file()
    )
    assert sorted(fake.files) == seed and "charts/service/values.yaml" in seed
    assert isinstance(app.state.launcher.provider, GitHubProvider)
    assert "LAUNCHBAY_PROVIDER=github" in (tmp_path / ".env").read_text()
    info = (await client.get("/api/info")).json()
    assert info["mode"] == "github" and info["github_owner"] == "acme"


async def test_an_existing_gitops_repo_is_kept(selfhost) -> None:
    _, client, fake = selfhost
    fake.gitops_exists = True
    state = await start(client)
    await client.get(f"/api/setup/github/callback?code=good-code&state={state}")
    installed = await client.get("/api/setup/github/installed")
    assert installed.headers["location"].endswith("gitops=found")
    assert "POST /orgs/acme/repos" not in fake.calls and not fake.files


async def test_unknown_state_is_refused(selfhost) -> None:
    _, client, fake = selfhost
    response = await client.get("/api/setup/github/callback?code=good-code&state=forged")
    assert response.status_code == 302 and "error=" in response.headers["location"]
    assert not fake.calls  # never reached GitHub


async def test_a_failed_conversion_is_reported(selfhost) -> None:
    _, client, _ = selfhost
    state = await start(client)
    response = await client.get(f"/api/setup/github/callback?code=stale&state={state}")
    assert "error=" in response.headers["location"]


async def test_status_before_anything_is_connected(selfhost) -> None:
    _, client, _ = selfhost
    body = (await client.get("/api/setup")).json()
    assert body["mode"] == "demo"
    assert body["github"]["ok"] is None and body["gitops"]["ok"] is None
    assert body["cloud"]["ok"] is False and body["assistant"]["ok"] is False


async def test_setup_only_answers_this_machine(selfhost) -> None:
    app, _, _ = selfhost
    remote = ASGITransport(app=app, client=("203.0.113.9", 4000))
    async with AsyncClient(transport=remote, base_url="http://test") as outsider:
        assert (await outsider.get("/api/setup")).status_code == 403
        manifest = await outsider.post("/api/setup/github/manifest", json={"owner": "acme"})
        assert manifest.status_code == 403


async def test_setup_is_off_in_the_public_demo(tmp_path) -> None:
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'd.db'}",
        public_demo=True,
        demo_snapshot=tmp_path / "none.json",
    )
    app = create_app(settings)
    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c,
    ):
        assert (await c.get("/api/setup")).status_code == 404


def test_write_env_replaces_only_its_keys(tmp_path) -> None:
    env = tmp_path / ".env"
    env.write_text("LAUNCHBAY_A=1\nLAUNCHBAY_B=2\n# a comment\n")
    write_env(env, {"B": "3", "C": "4"})
    assert env.read_text().splitlines() == [
        "LAUNCHBAY_A=1",
        "# a comment",
        "LAUNCHBAY_B=3",
        "LAUNCHBAY_C=4",
    ]


async def test_the_api_serves_the_built_portal(tmp_path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>portal</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("outside")
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'p.db'}",
        demo_speed=0,
        explainer="rules",
        portal_dist=dist,
    )
    app = create_app(settings)
    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c,
    ):
        assert (await c.get("/")).text == "<html>portal</html>"
        assert (await c.get("/services/x")).text == "<html>portal</html>"
        assert (await c.get("/assets/app.js")).text == "console.log(1)"
        assert (await c.get("/api/templates")).status_code == 200
        assert (await c.get("/api/nothing")).status_code == 404
        assert "outside" not in (await c.get("/..%2Fsecret.txt")).text
