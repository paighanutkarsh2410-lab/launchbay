"""Service scorecards: a set of checks every launched service is measured against.

Each check reads facts the provider gathered (CI, repo files, Argo CD) plus what Launchbay
already knows about the service. A check that cannot be evaluated is "skipped" and left out of
the score, so a missing fact never counts against a service.
"""

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import httpx

from app.models import Service, ServiceStatus, StepStatus
from app.providers.base import LaunchRequest, Provider, RepoFacts

Result = Literal["pass", "fail", "skip"]
STALE_AFTER = timedelta(days=90)


@dataclass(frozen=True)
class Check:
    id: str
    title: str
    category: Literal["Ownership", "Delivery", "Security", "Reliability"]
    weight: int
    # What passing means, shown as the check's description.
    description: str
    # How to fix a failure.
    remedy: str


CHECKS = [
    Check(
        "owner",
        "Has an owning team",
        "Ownership",
        1,
        "Someone is on call for it.",
        "Set an owner when launching.",
    ),
    Check(
        "description",
        "Says what it does",
        "Ownership",
        1,
        "A one-line description in the catalog.",
        "Add a description to the service.",
    ),
    Check(
        "readme",
        "Has a README",
        "Ownership",
        1,
        "The repo explains how to run and change it.",
        "Add a README.md to the repo.",
    ),
    Check(
        "ci",
        "CI is green on main",
        "Delivery",
        3,
        "The latest pipeline run on main passed.",
        "Fix the failing pipeline on main.",
    ),
    Check(
        "fresh",
        "Changed in the last 90 days",
        "Delivery",
        1,
        "Someone has committed to main recently.",
        "Ship a change, or retire the service.",
    ),
    Check(
        "dependabot",
        "Dependencies stay updated",
        "Delivery",
        1,
        "Dependabot opens update PRs.",
        "Add .github/dependabot.yml.",
    ),
    Check(
        "scans",
        "No known vulnerabilities",
        "Security",
        3,
        "Trivy's source and image scans passed.",
        "Upgrade the packages Trivy flags.",
    ),
    Check(
        "signed",
        "Signed image admitted",
        "Security",
        3,
        "Kyverno verified its cosign signature at deploy.",
        "Deploy only images CI signed.",
    ),
    Check(
        "encrypted",
        "Cloud data encrypted",
        "Security",
        2,
        "Its resources use a KMS key of its own.",
        "Provision resources through Launchbay.",
    ),
    Check(
        "healthy",
        "Healthy in the cluster",
        "Reliability",
        3,
        "Argo CD reports it Synced and Healthy.",
        "Look at the pods' events and logs.",
    ),
    Check(
        "responding",
        "Answers its health check",
        "Reliability",
        2,
        "GET /healthz returns 200 right now.",
        "Make /healthz respond, then redeploy.",
    ),
]


@dataclass
class CheckResult:
    check: Check
    result: Result
    detail: str


@dataclass
class Scorecard:
    service: str
    score: int  # 0-100
    grade: Literal["Gold", "Silver", "Bronze", "Needs work"]
    results: list[CheckResult]
    checked_at: datetime


def grade_for(score: int) -> Literal["Gold", "Silver", "Bronze", "Needs work"]:
    if score >= 90:
        return "Gold"
    if score >= 75:
        return "Silver"
    if score >= 50:
        return "Bronze"
    return "Needs work"


def evaluate(
    service: Service, facts: RepoFacts, responding: bool | None, now: datetime
) -> list[CheckResult]:
    launch = service.launches[0] if service.launches else None
    deployed = bool(
        launch and any(s.key == "deploy" and s.status == StepStatus.SUCCEEDED for s in launch.steps)
    )

    def known(value: bool | None, yes: str, no: str) -> tuple[Result, str]:
        if value is None:
            return "skip", "Could not check"
        return ("pass", yes) if value else ("fail", no)

    outcomes: dict[str, Callable[[], tuple[Result, str]]] = {
        "owner": lambda: known(bool(service.owner), service.owner, "No owner"),
        "description": lambda: known(
            bool(service.description.strip()), "Described", "No description"
        ),
        "readme": lambda: known(facts.has_readme, "README.md found", "No README in the repo"),
        "ci": lambda: (
            ("skip", "No pipeline runs yet")
            if facts.ci_conclusion is None
            else known(
                facts.ci_conclusion == "success",
                "Latest run passed",
                f"Latest run: {facts.ci_conclusion}",
            )
        ),
        "fresh": lambda: (
            ("skip", "Could not check")
            if facts.last_commit_at is None
            else known(
                now - facts.last_commit_at <= STALE_AFTER,
                f"Last commit {(now - facts.last_commit_at).days} days ago",
                f"No commits for {(now - facts.last_commit_at).days} days",
            )
        ),
        "dependabot": lambda: known(
            facts.has_dependabot, "dependabot.yml found", "No dependabot.yml"
        ),
        "scans": lambda: known(facts.scans_passed, "Trivy scans passed", "Trivy found issues"),
        "signed": lambda: known(
            deployed, "Admitted by the signed-images guardrail", "Not deployed yet"
        ),
        "encrypted": lambda: (
            ("skip", "No cloud resources")
            if not service.resources
            else known(
                bool(service.cloud),
                "KMS key alias/launchbay/" + service.name,
                "Resources not provisioned",
            )
        ),
        "healthy": lambda: (
            ("skip", "Could not reach Argo CD")
            if facts.deploy_health is None
            else known(
                facts.deploy_health == "Healthy",
                "Synced and Healthy",
                f"Argo CD health: {facts.deploy_health}",
            )
        ),
        "responding": lambda: known(responding, "/healthz returned 200", "/healthz did not answer"),
    }
    return [CheckResult(check, *outcomes[check.id]()) for check in CHECKS]


def score(results: list[CheckResult]) -> int:
    counted = [r for r in results if r.result != "skip"]
    total = sum(r.check.weight for r in counted)
    if not total:
        return 0
    return round(100 * sum(r.check.weight for r in counted if r.result == "pass") / total)


class Scorecards:
    """Computes scorecards on demand and reuses them for a few minutes."""

    def __init__(self, ttl_seconds: int, probe: bool = True) -> None:
        self.ttl = ttl_seconds
        self.probe = probe
        self._cache: dict[str, tuple[float, Scorecard]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def forget(self, name: str) -> None:
        self._cache.pop(name, None)

    async def _responding(self, service: Service) -> bool | None:
        if not self.probe or not service.url:
            return None
        try:
            async with httpx.AsyncClient(timeout=3) as http:
                return (await http.get(f"{service.url}/healthz")).status_code == 200
        except httpx.HTTPError:
            return False

    async def get(
        self, service: Service, request: LaunchRequest, provider: Provider, fresh: bool = False
    ) -> Scorecard:
        cached = self._cache.get(service.name)
        if cached and not fresh and time.monotonic() - cached[0] < self.ttl:
            return cached[1]
        async with self._locks.setdefault(service.name, asyncio.Lock()):
            cached = self._cache.get(service.name)
            if cached and not fresh and time.monotonic() - cached[0] < self.ttl:
                return cached[1]
            facts, responding = await asyncio.gather(
                provider.repo_facts(request), self._responding(service)
            )
            now = datetime.now(UTC)
            results = evaluate(service, facts, responding, now)
            value = score(results)
            card = Scorecard(service.name, value, grade_for(value), results, now)
            self._cache[service.name] = (time.monotonic(), card)
            return card


def scorable(service: Service) -> bool:
    return service.status in (ServiceStatus.LIVE, ServiceStatus.FAILED)
