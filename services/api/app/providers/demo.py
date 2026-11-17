"""Simulates every stage with realistic output, so the portal works with no credentials."""

import asyncio
import hashlib
import random

from app.providers.base import LaunchRequest, Provider, StepContext


class DemoProvider(Provider):
    def __init__(self, speed: float = 1.0, domain: str = "localtest.me") -> None:
        self.speed = max(speed, 0.0)
        self.domain = domain

    async def _pause(self, seconds: float) -> None:
        if self.speed:
            await asyncio.sleep(seconds * random.uniform(0.7, 1.3) / self.speed)

    async def _say(self, ctx: StepContext, lines: list[str], gap: float = 0.35) -> None:
        for line in lines:
            await self._pause(gap)
            await ctx.log(line)

    def _sha(self, request: LaunchRequest) -> str:
        return hashlib.sha1(request.name.encode()).hexdigest()

    async def create_repository(self, request: LaunchRequest, ctx: StepContext) -> str:
        files = request.template.render({"name": request.name, "description": request.description})
        repo = f"launchbay-labs/{request.name}"
        await self._say(
            ctx,
            [
                f"POST /orgs/launchbay-labs/repos name={request.name}",
                f"Rendering template '{request.template.id}' ({len(files)} files)",
                *[f"  + {path}" for path in list(files)[:6]],
                "Created commit on main: Initial commit from Launchbay",
                "Enabled branch protection on main",
            ],
            gap=0.25,
        )
        await ctx.detail(repo)
        return f"https://github.com/{repo}"

    async def run_pipeline(self, request: LaunchRequest, ctx: StepContext) -> str:
        sha = self._sha(request)
        image = f"ghcr.io/launchbay-labs/{request.name}:{sha[:12]}"
        await self._say(
            ctx,
            [
                "Workflow 'ci' queued on main",
                "test: 14 passed in 2.1s",
                "trivy fs: 0 critical, 0 high",
                f"docker build: {request.template.runtime} image built",
                "trivy image: 0 critical, 0 high",
                f"pushed {image}",
                f"cosign sign: signed sha256:{hashlib.sha256(sha.encode()).hexdigest()[:16]}...",
                "Workflow 'ci' succeeded",
            ],
            gap=0.7,
        )
        await ctx.detail(image)
        return image

    async def register_gitops(self, request: LaunchRequest, ctx: StepContext) -> None:
        await self._say(
            ctx,
            [
                f"Writing services/{request.name}.yaml",
                f"  image: {request.outputs.get('image', '')}",
                f"  port: {request.template.port}",
                "Committed to launchbay-gitops@main",
            ],
        )
        await ctx.detail(f"services/{request.name}.yaml")

    async def deploy(self, request: LaunchRequest, ctx: StepContext) -> None:
        await self._say(
            ctx,
            [
                f"ApplicationSet generated Application '{request.name}'",
                f"Namespace {request.name} created",
                "Sync started: Deployment, Service, Ingress",
                "Pods: 0/2 ready",
                "Pods: 1/2 ready",
                "Pods: 2/2 ready",
                "Application is Synced and Healthy",
            ],
            gap=0.6,
        )
        await ctx.detail("Synced · Healthy")

    async def wait_live(self, request: LaunchRequest, ctx: StepContext) -> str:
        url = f"http://{request.name}.{self.domain}"
        await self._say(ctx, [f"GET {url}/healthz", "200 OK in 12ms"])
        await ctx.detail(url)
        return url
