"""Cloud resources for launched services: an S3 bucket, an SQS queue and a DynamoDB table.

`TerraformCloud` applies platform/terraform/service once per service, with its own state
file, against the local AWS emulator (Moto in the kind cluster). `SimulatedCloud` fakes it
for the demo provider and tests.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import threading
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from app.config import Settings
from app.providers.base import StepContext, StepError

log = logging.getLogger(__name__)

ResourceKind = Literal["bucket", "queue", "table"]


@dataclass(frozen=True)
class ResourceKindInfo:
    id: ResourceKind
    title: str
    service: str
    description: str
    env: str


KINDS = [
    ResourceKindInfo(
        "bucket",
        "Object storage",
        "Amazon S3",
        "A private, versioned bucket for files and uploads.",
        "LAUNCHBAY_BUCKET",
    ),
    ResourceKindInfo(
        "queue",
        "Message queue",
        "Amazon SQS",
        "A queue for background work, with a dead-letter queue for failures.",
        "LAUNCHBAY_QUEUE_URL",
    ),
    ResourceKindInfo(
        "table",
        "Key-value table",
        "Amazon DynamoDB",
        "An on-demand table keyed by pk and sk, with point-in-time recovery.",
        "LAUNCHBAY_TABLE",
    ),
]
KIND_ORDER = [k.id for k in KINDS]


@dataclass
class CloudResult:
    env: dict[str, str] = field(default_factory=dict)
    resources: list[dict[str, str]] = field(default_factory=list)

    def as_json(self) -> dict:
        return {"env": self.env, "resources": self.resources}


class Cloud(ABC):
    mode: str
    label: str

    @abstractmethod
    async def provision(
        self, service: str, owner: str, kinds: list[str], ctx: StepContext | None = None
    ) -> CloudResult:
        """Creates (or converges) the service's resources. Idempotent."""

    @abstractmethod
    async def destroy(self, service: str, owner: str, kinds: list[str]) -> list[str]:
        """Deletes the service's resources. Succeeds when they are already gone."""


def ordered(kinds: list[str]) -> list[str]:
    return [k for k in KIND_ORDER if k in kinds]


class SimulatedCloud(Cloud):
    mode = "simulated"
    label = "Simulated"

    def __init__(self, speed: float = 1.0) -> None:
        self.speed = speed

    async def provision(
        self, service: str, owner: str, kinds: list[str], ctx: StepContext | None = None
    ) -> CloudResult:
        result = CloudResult()
        kinds = ordered(kinds)
        if not kinds:
            return result
        account = "123456789012"
        names = {
            "key": f"alias/launchbay/{service}",
            "bucket": f"{service}-{account}",
            "queue": service,
            "table": service,
        }
        arns = {
            "key": f"arn:aws:kms:us-east-1:{account}:key/{service}",
            "bucket": f"arn:aws:s3:::{names['bucket']}",
            "queue": f"arn:aws:sqs:us-east-1:{account}:{service}",
            "table": f"arn:aws:dynamodb:us-east-1:{account}:table/{service}",
        }
        for kind in ["key", *kinds]:
            if ctx:
                await ctx.log(f"{kind}: Creating {names[kind]}...")
            if self.speed:
                await asyncio.sleep(0.6 / self.speed)
            result.resources.append({"kind": kind, "name": names[kind], "arn": arns[kind]})
        result.env = {"AWS_REGION": "us-east-1"}
        if "bucket" in kinds:
            result.env["LAUNCHBAY_BUCKET"] = names["bucket"]
        if "queue" in kinds:
            result.env["LAUNCHBAY_QUEUE_URL"] = (
                f"https://sqs.us-east-1.amazonaws.com/{account}/{service}"
            )
        if "table" in kinds:
            result.env["LAUNCHBAY_TABLE"] = service
        return result

    async def destroy(self, service: str, owner: str, kinds: list[str]) -> list[str]:
        return [f"Destroyed {len(kinds)} simulated resource(s)"] if kinds else []


class TerraformCloud(Cloud):
    """Runs Terraform as a subprocess (in a thread, so it works on any event loop)."""

    mode = "emulator"
    label = "Local AWS emulator (Moto)"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.root = settings.terraform_dir
        self.state_dir = settings.cloud_state_dir
        self._init_lock = asyncio.Lock()
        self._service_locks: dict[str, asyncio.Lock] = {}

    def _bin(self) -> str:
        found = shutil.which(self.settings.terraform_bin)
        if not found:
            raise StepError(
                f"Terraform was not found ('{self.settings.terraform_bin}'). Install it, or set "
                "LAUNCHBAY_TERRAFORM_BIN to its path."
            )
        return found

    def _env(self, service: str) -> dict[str, str]:
        workdir = self.state_dir / service
        return {
            **os.environ,
            "TF_IN_AUTOMATION": "1",
            "TF_INPUT": "0",
            "TF_DATA_DIR": str(workdir / ".terraform"),
            "TF_PLUGIN_CACHE_DIR": str(self.state_dir / "plugin-cache"),
            # Moto accepts any credentials; these never leave the laptop.
            "AWS_ACCESS_KEY_ID": "emulator",
            "AWS_SECRET_ACCESS_KEY": "emulator",
        }

    def _vars(self, service: str, owner: str, kinds: list[str]) -> list[str]:
        return [
            f"-var=service={service}",
            f"-var=owner={owner}",
            f"-var=resources={json.dumps(ordered(kinds))}",
            f"-var=endpoint={self.settings.cloud_endpoint}",
            f"-var=service_endpoint={self.settings.cloud_service_endpoint}",
        ]

    async def _run(
        self,
        service: str,
        args: list[str],
        on_line: Callable[[str], Awaitable[None]] | None = None,
    ) -> str:
        """Runs terraform, streaming each output line to on_line. Returns stdout."""
        loop = asyncio.get_running_loop()
        lines: asyncio.Queue[str | None] = asyncio.Queue()
        command = [self._bin(), f"-chdir={self.root}", *args, "-no-color"]
        env = self._env(service)
        output: list[str] = []
        result: dict[str, int] = {}

        def work() -> None:
            try:
                with subprocess.Popen(
                    command,
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                ) as proc:
                    assert proc.stdout is not None
                    for raw in proc.stdout:
                        loop.call_soon_threadsafe(lines.put_nowait, raw.rstrip())
                    result["code"] = proc.wait()
            finally:
                loop.call_soon_threadsafe(lines.put_nowait, None)

        threading.Thread(target=work, name=f"terraform-{service}", daemon=True).start()
        while (line := await lines.get()) is not None:
            output.append(line)
            if on_line and line.strip():
                await on_line(line)
        if result.get("code", 1) != 0:
            errors = [line for line in output if line.startswith("Error:")]
            reason = errors[0].removeprefix("Error:").strip() if errors else output[-1:]
            raise StepError(f"terraform {args[0]} failed: {reason}")
        return "\n".join(output)

    async def _init(self, service: str) -> None:
        workdir = self.state_dir / service
        workdir.mkdir(parents=True, exist_ok=True)
        (self.state_dir / "plugin-cache").mkdir(parents=True, exist_ok=True)
        # One init at a time: they share the provider cache.
        async with self._init_lock:
            await self._run(
                service,
                ["init", f"-backend-config=path={workdir / 'terraform.tfstate'}", "-reconfigure"],
            )

    def _lock(self, service: str) -> asyncio.Lock:
        return self._service_locks.setdefault(service, asyncio.Lock())

    async def provision(
        self, service: str, owner: str, kinds: list[str], ctx: StepContext | None = None
    ) -> CloudResult:
        async def show(line: str) -> None:
            # Terraform's progress lines, minus the plan dump, shortened to fit the portal.
            if ctx and (
                ": Creat" in line
                or ": Modif" in line
                or ": Refreshing" in line
                or line.startswith(("Apply complete", "Plan:", "No changes"))
            ):
                await ctx.log(shorten(line.strip()))

        async with self._lock(service):
            if ctx:
                await ctx.log(f"terraform init (state in {describe(self.state_dir / service)})")
            await self._init(service)
            if ctx:
                await ctx.log(f"terraform apply -> {self.settings.cloud_endpoint}")
            await self._run(
                service, ["apply", "-auto-approve", *self._vars(service, owner, kinds)], show
            )
            raw = await self._run(service, ["output", "-json"])
        outputs = json.loads(raw)
        return CloudResult(
            env=outputs.get("env", {}).get("value") or {},
            resources=outputs.get("resources", {}).get("value") or [],
        )

    async def destroy(self, service: str, owner: str, kinds: list[str]) -> list[str]:
        workdir = self.state_dir / service
        if not (workdir / "terraform.tfstate").exists():
            return ["No cloud resources to destroy"]
        async with self._lock(service):
            await self._init(service)
            await self._run(
                service, ["destroy", "-auto-approve", *self._vars(service, owner, kinds)]
            )
        shutil.rmtree(workdir, ignore_errors=True)
        return [f"Destroyed cloud resources ({', '.join(ordered(kinds)) or 'none'}) with Terraform"]


_ADDRESS = re.compile(
    r"^(?:module\.(\w+)\[\d+\]\.)?(\w+)\.\w+(?:\[\d+\])?: (.*?)(?: \[id=[^\]]*\])?$"
)


def shorten(line: str) -> str:
    """'module.queue[0].aws_sqs_queue.this: Creation complete after 1s [id=...]'
    -> 'queue/aws_sqs_queue: Creation complete after 1s'"""
    match = _ADDRESS.match(line)
    if not match:
        return line
    module, resource, rest = match.groups()
    return f"{module + '/' if module else ''}{resource}: {rest}"


def build_cloud(settings: Settings) -> Cloud:
    if settings.cloud == "emulator":
        return TerraformCloud(settings)
    return SimulatedCloud(speed=settings.demo_speed)


def describe(path: Path) -> str:
    """~-relative path for log lines, so they don't show the user's home directory."""
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return path.as_posix()
