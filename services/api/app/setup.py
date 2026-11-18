"""First-run setup: connect GitHub in one click, then create the GitOps repo.

1. The portal posts a GitHub App *manifest* (name, permissions, callback URLs) to GitHub, which
   shows the person a pre-filled "Create GitHub App" page for their organization.
2. GitHub creates the App and redirects to /api/setup/github/callback?code=...; the API trades
   the code for the App's id and private key, keeps the key in ~/.launchbay (never in the repo),
   and sends the browser on to install the App on the organization.
3. After the install, GitHub redirects to /api/setup/github/installed; the API creates
   <org>/launchbay-gitops from platform/gitops if it is missing and switches to real launches.

Nobody copies an App id or a key by hand. These routes write secrets to disk, so they answer
only requests from this machine, and never in the public demo.
"""

import base64
import logging
import secrets
import time
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.config import REPO_ROOT, Settings
from app.providers.github import GITHUB_API, GitHubApp, GitHubProvider

log = logging.getLogger(__name__)

# What a Launchbay App may do: create and archive repos, write their first commit and CI
# workflow, read CI results, and commit to the GitOps repo. No webhooks, no events.
PERMISSIONS = {
    "administration": "write",
    "contents": "write",
    "workflows": "write",
    "actions": "read",
    "metadata": "read",
}
GITOPS_SEED = REPO_ROOT / "platform" / "gitops"
LOOPBACK = {"127.0.0.1", "::1", "localhost"}
STATE_TTL = 15 * 60


# Schemas


class ManifestRequest(BaseModel):
    owner: str = Field(pattern=r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")


class ManifestOut(BaseModel):
    action: str  # where the portal posts the form
    manifest: dict


class Check(BaseModel):
    ok: bool | None  # None: not known (not configured yet, or could not check)
    detail: str


class SetupStatus(BaseModel):
    mode: Literal["demo", "github"]
    owner: str | None
    app_slug: str | None
    platform: Check
    github: Check
    gitops: Check
    registry: Check
    cloud: Check
    assistant: Check


# Helpers


def local_only(request: Request) -> None:
    if request.app.state.settings.public_demo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not available in the public demo")
    host = request.client.host if request.client else ""
    if host not in LOOPBACK:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Setup is only available from this machine")


def write_env(path: Path, updates: dict[str, str]) -> None:
    """Sets LAUNCHBAY_* lines in the API's .env, keeping every other line."""
    keys = {f"LAUNCHBAY_{k}" for k in updates}
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    kept = [line for line in lines if line.split("=", 1)[0] not in keys]
    kept += [f"LAUNCHBAY_{k}={v}" for k, v in updates.items()]
    path.write_text("\n".join(kept) + "\n", encoding="utf-8")
    path.chmod(0o600)


def manifest(settings: Settings, owner: str) -> dict:
    api = settings.public_api_url.rstrip("/")
    return {
        # App names are unique across GitHub and at most 34 characters.
        "name": f"Launchbay {owner}"[:34],
        "url": settings.project_url,
        "description": "Launches services from golden-path templates: repo, CI, GitOps.",
        "hook_attributes": {"url": f"{api}/api/healthz", "active": False},
        "redirect_url": f"{api}/api/setup/github/callback",
        "setup_url": f"{api}/api/setup/github/installed",
        "setup_on_update": True,
        "public": False,
        "default_permissions": PERMISSIONS,
        "default_events": [],
    }


def github(request: Request) -> httpx.AsyncClient:
    # Tests swap the transport for a fake GitHub.
    return httpx.AsyncClient(
        base_url=GITHUB_API,
        timeout=30,
        transport=getattr(request.app.state, "github_transport", None),
        headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )


def portal(settings: Settings, **params: str) -> RedirectResponse:
    query = "&".join(f"{k}={quote(v)}" for k, v in params.items())
    return RedirectResponse(
        f"{settings.portal_url.rstrip('/')}/setup?{query}", status.HTTP_302_FOUND
    )


async def seed_gitops(app: GitHubApp, http: httpx.AsyncClient, owner: str, repo: str) -> bool:
    """Creates <owner>/<repo> from platform/gitops. Returns False if it already existed."""
    headers = {"Authorization": f"Bearer {await app.token()}"}
    if (await http.get(f"/repos/{owner}/{repo}", headers=headers)).status_code == 200:
        return False
    created = await http.post(
        f"/orgs/{owner}/repos",
        headers=headers,
        json={
            "name": repo,
            "description": "What runs: one manifest per service, deployed by Argo CD.",
            # Argo CD reads it without credentials.
            "private": False,
            "has_issues": False,
            "has_wiki": False,
        },
    )
    created.raise_for_status()
    for file in sorted(p for p in GITOPS_SEED.rglob("*") if p.is_file()):
        path = file.relative_to(GITOPS_SEED).as_posix()
        response = await http.put(
            f"/repos/{owner}/{repo}/contents/{path}",
            headers=headers,
            json={
                "message": f"Add {path}",
                "content": base64.b64encode(file.read_bytes()).decode(),
            },
        )
        response.raise_for_status()
    return True


# Routes

router = APIRouter(prefix="/api/setup", dependencies=[Depends(local_only)])


@router.get("", response_model=SetupStatus)
async def setup_status(request: Request) -> SetupStatus:
    settings: Settings = request.app.state.settings
    platform = Check(ok=None, detail="Argo CD is not configured; run ./launchbay up")
    if settings.argocd_url:
        try:
            async with httpx.AsyncClient(timeout=3) as http:
                reachable = (await http.get(f"{settings.argocd_url}/api/version")).is_success
        except httpx.HTTPError:
            reachable = False
        platform = Check(
            ok=reachable,
            detail=f"Argo CD at {settings.argocd_url}"
            + ("" if reachable else " is not answering; is the cluster running?"),
        )

    github_check = Check(ok=None, detail="Not connected")
    gitops = Check(ok=None, detail="Created when GitHub is connected")
    if settings.github_app_id and settings.github_private_key_path and settings.github_owner:
        async with github(request) as http:
            try:
                key = settings.github_private_key_path.read_text(encoding="utf-8")
                app = GitHubApp(settings.github_app_id, key, settings.github_owner, http)
                token = await app.token()
                github_check = Check(ok=True, detail=f"App installed on {settings.github_owner}")
                repo = f"{settings.github_owner}/{settings.gitops_repo}"
                found = await http.get(
                    f"/repos/{repo}", headers={"Authorization": f"Bearer {token}"}
                )
                gitops = Check(
                    ok=found.status_code == 200,
                    detail=repo if found.status_code == 200 else f"{repo} does not exist yet",
                )
            except Exception as error:  # noqa: BLE001 - shown to the person setting up
                github_check = Check(ok=False, detail=str(error))
                gitops = Check(ok=None, detail="Needs the App installed first")

    pull_token = settings.launchbay_home / "ghcr-pull-token"
    registry = Check(
        ok=pull_token.is_file(),
        detail="The cluster can pull private images"
        if pull_token.is_file()
        else f"Optional: save a read:packages token as {pull_token} for private images",
    )
    cloud = Check(
        ok=settings.cloud == "emulator",
        detail="Terraform on the local AWS emulator"
        if settings.cloud == "emulator"
        else "Simulated; install Terraform and re-run ./launchbay up for real resources",
    )
    explainer = request.app.state.explainer
    assistant = Check(
        ok=explainer.source != "rules",
        detail=explainer.label
        if explainer.source != "rules"
        else "Built-in rules; add a Gemini or Anthropic key for AI explanations",
    )
    return SetupStatus(
        mode=settings.provider,
        owner=settings.github_owner,
        app_slug=settings.github_app_slug,
        platform=platform,
        github=github_check,
        gitops=gitops,
        registry=registry,
        cloud=cloud,
        assistant=assistant,
    )


@router.post("/github/manifest", response_model=ManifestOut)
async def github_manifest(body: ManifestRequest, request: Request) -> ManifestOut:
    states: dict[str, tuple[str, float]] = request.app.state.setup_states
    now = time.monotonic()
    for key in [k for k, (_, at) in states.items() if now - at > STATE_TTL]:
        states.pop(key)
    state = secrets.token_urlsafe(24)
    states[state] = (body.owner, now)
    return ManifestOut(
        action=f"https://github.com/organizations/{body.owner}/settings/apps/new?state={state}",
        manifest=manifest(request.app.state.settings, body.owner),
    )


@router.get("/github/callback")
async def github_callback(request: Request, code: str, state: str) -> RedirectResponse:
    """GitHub created the App: keep its key and send the browser on to install it."""
    settings: Settings = request.app.state.settings
    pending = request.app.state.setup_states.pop(state, None)
    if pending is None or time.monotonic() - pending[1] > STATE_TTL:
        return portal(settings, error="That GitHub link expired. Start again from this page.")
    owner = pending[0]
    async with github(request) as http:
        response = await http.post(f"/app-manifests/{code}/conversions")
    if response.status_code != 201:
        log.warning("Manifest conversion failed: %s %s", response.status_code, response.text)
        return portal(settings, error="GitHub did not confirm the new App. Try again.")
    created = response.json()

    settings.launchbay_home.mkdir(parents=True, exist_ok=True)
    key_file = settings.launchbay_home / f"github-app-{created['slug']}.pem"
    key_file.write_text(created["pem"], encoding="utf-8")
    key_file.chmod(0o600)
    settings.github_app_id = str(created["id"])
    settings.github_private_key_path = key_file
    settings.github_owner = owner
    settings.github_app_slug = created["slug"]
    write_env(
        settings.env_file_path,
        {
            "GITHUB_APP_ID": settings.github_app_id,
            "GITHUB_PRIVATE_KEY_PATH": key_file.as_posix(),
            "GITHUB_OWNER": owner,
            "GITHUB_APP_SLUG": created["slug"],
        },
    )
    log.info("Created GitHub App %s for %s", created["slug"], owner)
    return RedirectResponse(
        f"https://github.com/apps/{created['slug']}/installations/new", status.HTTP_302_FOUND
    )


@router.get("/github/installed")
async def github_installed(request: Request) -> RedirectResponse:
    """The App is installed: make sure the GitOps repo exists, then launch for real."""
    settings: Settings = request.app.state.settings
    if not (settings.github_app_id and settings.github_private_key_path and settings.github_owner):
        return portal(settings, error="Connect GitHub first.")
    async with github(request) as http:
        key = settings.github_private_key_path.read_text(encoding="utf-8")
        app = GitHubApp(settings.github_app_id, key, settings.github_owner, http)
        try:
            created = await seed_gitops(app, http, settings.github_owner, settings.gitops_repo)
        except Exception as error:  # noqa: BLE001 - shown to the person setting up
            log.warning("GitOps setup failed: %s", error)
            return portal(settings, error=f"Installed, but the GitOps repo failed: {error}")

    settings.provider = "github"
    write_env(settings.env_file_path, {"PROVIDER": "github"})
    request.app.state.launcher.provider = GitHubProvider(settings)
    return portal(
        settings, connected=settings.github_owner, gitops="created" if created else "found"
    )
