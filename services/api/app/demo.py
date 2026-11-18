"""Public demo mode: a Launchbay anyone on the internet can use safely.

With LAUNCHBAY_PUBLIC_DEMO=true the API runs the demo provider (every stage simulated, no
credentials), starts from a snapshot of a real Launchbay, and keeps visitors from breaking it:

- the seeded services are read-only (no retry, decommission or new explanation),
- launches are rate limited per visitor and in total,
- services visitors launch are removed after a few hours.

Make a snapshot from a running Launchbay with:  python -m app.demo export [api-url] [file]
"""

import asyncio
import json
import logging
import sys
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from fastapi import HTTPException, Request, status
from sqlalchemy import func, select

from app.db import Database
from app.models import Launch, LaunchStep, Service, ServiceStatus, StepStatus

log = logging.getLogger(__name__)


def _parse(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


class PublicDemo:
    def __init__(
        self,
        snapshot: Path,
        ttl_hours: float,
        launches_per_hour: int,
        max_running: int,
    ) -> None:
        self.snapshot = snapshot
        self.ttl = timedelta(hours=ttl_hours)
        self.launches_per_hour = launches_per_hour
        self.max_running = max_running
        self.seeded: set[str] = set()
        self.scorecards: dict[str, dict] = {}
        self._launches: dict[str, deque[float]] = defaultdict(deque)

    # Seeding

    async def seed(self, db: Database) -> None:
        """Loads the snapshot into an empty database, with timestamps moved up to now."""
        if not self.snapshot.is_file():
            log.warning("No demo snapshot at %s; starting empty", self.snapshot)
            return
        data = json.loads(self.snapshot.read_text(encoding="utf-8"))
        shift = datetime.now(UTC) - _parse(data["exported_at"])

        def moved(value: str | None) -> datetime | None:
            parsed = _parse(value)
            return parsed + shift if parsed else None

        self.seeded = {s["name"] for s in data["services"]}
        self.scorecards = data.get("scorecards", {})
        async with db.sessions() as session:
            if await session.scalar(select(func.count()).select_from(Service)):
                return  # already seeded (a restart with a persistent database)
            for s in data["services"]:
                launch = s.get("launch")
                service = Service(
                    id=s["id"],
                    name=s["name"],
                    description=s["description"],
                    template_id=s["template_id"],
                    owner=s["owner"],
                    status=ServiceStatus(s["status"]),
                    repo_url=s["repo_url"],
                    url=s["url"],
                    resources=s.get("resources") or [],
                    cloud=s.get("cloud"),
                    created_at=moved(s["created_at"]),
                )
                if launch:
                    service.launches.append(
                        Launch(
                            id=launch["id"],
                            status=StepStatus(launch["status"]),
                            started_at=moved(launch["started_at"]),
                            finished_at=moved(launch["finished_at"]),
                            error=launch["error"],
                            explanation=launch.get("explanation"),
                            steps=[
                                LaunchStep(
                                    key=step["key"],
                                    title=step["title"],
                                    position=step["position"],
                                    status=StepStatus(step["status"]),
                                    detail=step["detail"],
                                    logs=step["logs"],
                                    started_at=moved(step["started_at"]),
                                    finished_at=moved(step["finished_at"]),
                                )
                                for step in launch["steps"]
                            ],
                        )
                    )
                session.add(service)
            await session.commit()
        log.info("Seeded the demo with %d services", len(self.seeded))

    # Guards

    def protect(self, name: str) -> None:
        """Seeded services are the showcase; visitors can look but not change them."""
        if name in self.seeded:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This service is part of the demo and can't be changed. Launch your own to try it.",
            )

    async def admit_launch(self, request: Request, session) -> None:
        forwarded = request.headers.get("x-forwarded-for", "")
        client = forwarded.split(",")[0].strip() or (request.client.host if request.client else "")
        recent = self._launches[client]
        now = time.monotonic()
        while recent and now - recent[0] > 3600:
            recent.popleft()
        if len(recent) >= self.launches_per_hour:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"The demo allows {self.launches_per_hour} launches an hour per visitor. "
                "Try again a little later.",
            )
        running = await session.scalar(
            select(func.count()).where(Service.status == ServiceStatus.LAUNCHING)
        )
        if running >= self.max_running:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Lots of launches in flight right now. Try again in a minute.",
            )
        recent.append(now)

    # Cleanup

    async def remove_expired(self, db: Database) -> int:
        cutoff = datetime.now(UTC) - self.ttl
        async with db.sessions() as session:
            names = [
                name
                for name in await session.scalars(
                    select(Service.name).where(Service.created_at < cutoff)
                )
                if name not in self.seeded
            ]
            if names:
                services = await session.scalars(select(Service).where(Service.name.in_(names)))
                for service in services:
                    await session.delete(service)
                await session.commit()
        return len(names)

    async def cleanup_forever(self, db: Database, every: float = 600) -> None:
        while True:
            try:
                if removed := await self.remove_expired(db):
                    log.info("Removed %d expired demo services", removed)
            except Exception:  # noqa: BLE001 - keep cleaning up on the next round
                log.exception("Demo cleanup failed")
            await asyncio.sleep(every)


# Export


def export(api: str, path: Path) -> None:
    """Writes a snapshot of a running Launchbay: services, their latest launch and scorecard."""
    with httpx.Client(base_url=api.rstrip("/"), timeout=60) as http:
        services = [
            s
            for s in http.get("/api/services").raise_for_status().json()
            if s["status"] in ("live", "failed")
        ]
        snapshot: dict = {"exported_at": datetime.now(UTC).isoformat(), "services": []}
        scorecards = {}
        for s in services:
            detail = http.get(f"/api/services/{s['name']}").raise_for_status().json()
            snapshot["services"].append(detail)
            card = http.get(f"/api/services/{s['name']}/scorecard")
            if card.status_code == 200:
                scorecards[s["name"]] = card.json()
        snapshot["scorecards"] = scorecards
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=1), encoding="utf-8")
    print(f"Wrote {len(snapshot['services'])} services to {path}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] != "export":
        sys.exit("Usage: python -m app.demo export [api-url] [file]")
    export(
        args[1] if len(args) > 1 else "http://localhost:8000",
        Path(args[2]) if len(args) > 2 else Path(__file__).parents[1] / "demo" / "snapshot.json",
    )
