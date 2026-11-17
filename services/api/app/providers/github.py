"""Real launches: a GitHub App creates the repo, CI publishes the image, Argo CD deploys it.

The App is installed on a GitHub organization. Installation tokens can create repos in an
organization but not in a personal account, which is also how platform teams usually run it.
"""

import asyncio
import base64
import time
from collections.abc import Awaitable, Callable

import httpx
import jwt
import yaml

from app.config import Settings
from app.providers.base import LaunchRequest, Provider, StepContext, StepError

GITHUB_API = "https://api.github.com"
PIPELINE_TIMEOUT = 20 * 60
DEPLOY_TIMEOUT = 10 * 60
LIVE_TIMEOUT = 3 * 60


async def poll[T](
    check: Callable[[], Awaitable[T | None]], limit: float, interval: float, what: str
) -> T:
    deadline = time.monotonic() + limit
    while time.monotonic() < deadline:
        result = await check()
        if result is not None:
            return result
        await asyncio.sleep(interval)
    raise StepError(f"Timed out after {int(limit)}s waiting for {what}")


class GitHubApp:
    """Mints and caches installation tokens for the App's installation on one org."""

    def __init__(self, app_id: str, private_key: str, owner: str, http: httpx.AsyncClient) -> None:
        self.app_id = app_id
        self.private_key = private_key
        self.owner = owner
        self.http = http
        self._token: str | None = None
        self._expires = 0.0

    def _app_jwt(self) -> str:
        now = int(time.time())
        payload = {"iat": now - 60, "exp": now + 9 * 60, "iss": self.app_id}
        return jwt.encode(payload, self.private_key, algorithm="RS256")

    async def token(self) -> str:
        if self._token and time.time() < self._expires - 300:
            return self._token
        headers = {"Authorization": f"Bearer {self._app_jwt()}"}
        response = await self.http.get(f"/orgs/{self.owner}/installation", headers=headers)
        if response.status_code == 404:
            raise StepError(f"The Launchbay GitHub App is not installed on '{self.owner}'")
        response.raise_for_status()
        installation_id = response.json()["id"]
        response = await self.http.post(
            f"/app/installations/{installation_id}/access_tokens", headers=headers
        )
        response.raise_for_status()
        body = response.json()
        self._token = body["token"]
        self._expires = time.time() + 3600
        return self._token


class GitHubProvider(Provider):
    def __init__(self, settings: Settings) -> None:
        required = (settings.github_app_id, settings.github_private_key_path, settings.github_owner)
        if not all(required):
            raise RuntimeError(
                "Set LAUNCHBAY_GITHUB_APP_ID, LAUNCHBAY_GITHUB_PRIVATE_KEY_PATH and "
                "LAUNCHBAY_GITHUB_OWNER to use the GitHub provider"
            )
        self.settings = settings
        self.owner = settings.github_owner
        self.http = httpx.AsyncClient(
            base_url=GITHUB_API,
            timeout=30,
            headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
        )
        private_key = settings.github_private_key_path.read_text(encoding="utf-8")
        self.app = GitHubApp(settings.github_app_id, private_key, self.owner, self.http)

    async def _gh(self, method: str, path: str, **kwargs) -> httpx.Response:
        headers = {"Authorization": f"Bearer {await self.app.token()}"}
        response = await self.http.request(method, path, headers=headers, **kwargs)
        if response.status_code >= 400:
            message = response.json().get("message", response.text) if response.content else ""
            raise StepError(f"GitHub {method} {path} failed ({response.status_code}): {message}")
        return response

    # Stage 2
    async def create_repository(self, request: LaunchRequest, ctx: StepContext) -> str:
        name = request.name
        await ctx.log(f"POST /orgs/{self.owner}/repos name={name}")
        repo = (
            await self._gh(
                "POST",
                f"/orgs/{self.owner}/repos",
                json={
                    "name": name,
                    "description": request.description
                    or f"Launched with Launchbay ({request.template.name})",
                    "private": False,
                    "auto_init": True,
                },
            )
        ).json()

        files = request.template.render({"name": name, "description": request.description})
        await ctx.log(f"Rendering template '{request.template.id}' ({len(files)} files)")
        base = (await self._gh("GET", f"/repos/{self.owner}/{name}/git/ref/heads/main")).json()
        parent = base["object"]["sha"]

        tree = []
        for path, content in files.items():
            blob = (
                await self._gh(
                    "POST",
                    f"/repos/{self.owner}/{name}/git/blobs",
                    json={"content": base64.b64encode(content).decode(), "encoding": "base64"},
                )
            ).json()
            mode = "100755" if path.endswith(".sh") else "100644"
            tree.append({"path": path, "mode": mode, "type": "blob", "sha": blob["sha"]})
            await ctx.log(f"  + {path}")

        tree_sha = (
            await self._gh("POST", f"/repos/{self.owner}/{name}/git/trees", json={"tree": tree})
        ).json()["sha"]
        commit = (
            await self._gh(
                "POST",
                f"/repos/{self.owner}/{name}/git/commits",
                json={
                    "message": "Initial commit from Launchbay",
                    "tree": tree_sha,
                    "parents": [parent],
                },
            )
        ).json()
        await self._gh(
            "PATCH",
            f"/repos/{self.owner}/{name}/git/refs/heads/main",
            json={"sha": commit["sha"], "force": True},
        )
        request.outputs["commit"] = commit["sha"]
        await ctx.log(f"Created commit {commit['sha'][:7]} on main")
        await ctx.detail(f"{self.owner}/{name}")
        return repo["html_url"]

    # Stage 3
    async def run_pipeline(self, request: LaunchRequest, ctx: StepContext) -> str:
        name, sha = request.name, request.outputs["commit"]
        seen: set[str] = set()

        async def finished_run() -> dict | None:
            runs = (
                await self._gh(
                    "GET", f"/repos/{self.owner}/{name}/actions/runs", params={"head_sha": sha}
                )
            ).json()["workflow_runs"]
            for run in runs:
                state = f"{run['name']}:{run['status']}"
                if state not in seen:
                    seen.add(state)
                    await ctx.log(f"Workflow '{run['name']}' {run['status'].replace('_', ' ')}")
                if run["status"] == "completed":
                    return run
            return None

        run = await poll(finished_run, PIPELINE_TIMEOUT, 10, "the CI pipeline")
        await ctx.log(f"Run: {run['html_url']}")
        if run["conclusion"] != "success":
            raise StepError(f"CI finished with '{run['conclusion']}'. See {run['html_url']}")

        image = f"ghcr.io/{self.owner}/{name}:{sha}"
        await ctx.log(f"Image: {image}")
        await ctx.detail(image)
        return image

    # Stage 4
    async def register_gitops(self, request: LaunchRequest, ctx: StepContext) -> None:
        path = f"services/{request.name}.yaml"
        manifest = {
            "name": request.name,
            "owner": request.owner,
            "template": request.template.id,
            "image": request.outputs["image"],
            "port": request.template.port,
            "host": f"{request.name}.{self.settings.service_domain}",
        }
        body = yaml.safe_dump(manifest, sort_keys=False)
        for line in body.splitlines():
            await ctx.log(f"  {line}")
        await self._gh(
            "PUT",
            f"/repos/{self.owner}/{self.settings.gitops_repo}/contents/{path}",
            json={
                "message": f"Launch {request.name}",
                "content": base64.b64encode(body.encode()).decode(),
            },
        )
        await ctx.log(f"Committed {path} to {self.settings.gitops_repo}")
        await ctx.detail(path)

    # Stage 5
    async def deploy(self, request: LaunchRequest, ctx: StepContext) -> None:
        if not (self.settings.argocd_url and self.settings.argocd_token):
            raise StepError("Set LAUNCHBAY_ARGOCD_URL and LAUNCHBAY_ARGOCD_TOKEN to track deploys")
        last = ""

        async with httpx.AsyncClient(
            base_url=self.settings.argocd_url,
            headers={"Authorization": f"Bearer {self.settings.argocd_token}"},
            verify=False,  # Argo CD on kind uses a self-signed certificate.
            timeout=15,
        ) as argo:

            async def healthy() -> bool | None:
                nonlocal last
                response = await argo.get(f"/api/v1/applications/{request.name}")
                if response.status_code == 404:
                    state = "Waiting for the ApplicationSet to generate the Application"
                else:
                    response.raise_for_status()
                    status = response.json().get("status", {})
                    sync = status.get("sync", {}).get("status", "Unknown")
                    health = status.get("health", {}).get("status", "Unknown")
                    state = f"Sync: {sync} · Health: {health}"
                    if health == "Degraded":
                        raise StepError("Argo CD reports the application as Degraded")
                    if sync == "Synced" and health == "Healthy":
                        await ctx.log(state)
                        return True
                if state != last:
                    last = state
                    await ctx.log(state)
                return None

            await poll(healthy, DEPLOY_TIMEOUT, 5, "Argo CD to sync the service")
        await ctx.detail("Synced · Healthy")

    # Stage 6
    async def wait_live(self, request: LaunchRequest, ctx: StepContext) -> str:
        url = f"http://{request.name}.{self.settings.service_domain}"
        await ctx.log(f"GET {url}/healthz")
        async with httpx.AsyncClient(timeout=5) as client:

            async def up() -> bool | None:
                try:
                    response = await client.get(f"{url}/healthz")
                except httpx.HTTPError:
                    return None
                if response.status_code == 200:
                    await ctx.log(f"200 OK in {int(response.elapsed.total_seconds() * 1000)}ms")
                    return True
                return None

            await poll(up, LIVE_TIMEOUT, 3, f"{url}/healthz")
        await ctx.detail(url)
        return url
