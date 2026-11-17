from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Protocol

from app.templates_catalog import Template


class StepError(Exception):
    """A stage failed in a way the developer can act on. The message is shown in the portal."""


class StepContext(Protocol):
    async def log(self, line: str) -> None: ...

    async def detail(self, text: str) -> None: ...


@dataclass
class LaunchRequest:
    name: str
    description: str
    owner: str
    template: Template
    # Filled in as the launch goes; later stages read what earlier ones produced.
    outputs: dict[str, str] = field(default_factory=dict)


class Provider(ABC):
    """Talks to the outside world for each launch stage."""

    @abstractmethod
    async def create_repository(self, request: LaunchRequest, ctx: StepContext) -> str:
        """Creates the repo with the rendered template. Returns its URL."""

    @abstractmethod
    async def run_pipeline(self, request: LaunchRequest, ctx: StepContext) -> str:
        """Waits for the first CI run. Returns the published image reference."""

    @abstractmethod
    async def register_gitops(self, request: LaunchRequest, ctx: StepContext) -> None:
        """Commits the service manifest to the GitOps repo."""

    @abstractmethod
    async def deploy(self, request: LaunchRequest, ctx: StepContext) -> None:
        """Waits until Argo CD reports the service Synced and Healthy."""

    @abstractmethod
    async def wait_live(self, request: LaunchRequest, ctx: StepContext) -> str:
        """Waits for the service's health check. Returns its URL."""

    @abstractmethod
    async def resume(self, request: LaunchRequest, kept: dict[str, str | None]) -> None:
        """Before a retry: fills request.outputs from the stages being kept.

        `kept` maps each kept stage to its recorded detail (the pipeline's is its image)."""

    @abstractmethod
    async def decommission(self, request: LaunchRequest, *, delete_repository: bool) -> list[str]:
        """Removes the GitOps manifest, then archives or deletes the repo. Returns what it did.
        Must succeed when parts are already gone, so a half-launched service can be removed."""
