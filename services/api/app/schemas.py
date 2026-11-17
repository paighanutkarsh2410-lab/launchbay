import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import ServiceStatus, StepStatus

# A Kubernetes namespace and a GitHub repo name at the same time.
NAME_PATTERN = re.compile(r"^[a-z](?:[a-z0-9-]{1,38}[a-z0-9])?$")
RESERVED_NAMES = {"launchbay", "launchbay-gitops", "argocd", "kube-system", "default"}


class TemplateOut(BaseModel):
    id: str
    name: str
    description: str
    language: str
    runtime: str
    port: int
    tags: list[str]
    accent: str


class ServiceCreate(BaseModel):
    name: str = Field(min_length=3, max_length=40)
    template_id: str
    owner: str = Field(min_length=2, max_length=64)
    description: str = Field(default="", max_length=280)

    @field_validator("name")
    @classmethod
    def check_name(cls, value: str) -> str:
        value = value.strip().lower()
        if not NAME_PATTERN.fullmatch(value) or "--" in value:
            raise ValueError(
                "Use 3-40 lowercase letters, digits and single hyphens, starting with a letter"
            )
        if value in RESERVED_NAMES:
            raise ValueError(f"'{value}' is reserved")
        return value

    @field_validator("owner", "description")
    @classmethod
    def strip(cls, value: str) -> str:
        return value.strip()


class StepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    title: str
    position: int
    status: StepStatus
    detail: str | None
    logs: list[str]
    started_at: datetime | None
    finished_at: datetime | None


class LaunchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: StepStatus
    started_at: datetime
    finished_at: datetime | None
    error: str | None
    steps: list[StepOut]


class ServiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str
    template_id: str
    owner: str
    status: ServiceStatus
    repo_url: str | None
    url: str | None
    created_at: datetime


class ServiceDetail(ServiceOut):
    launch: LaunchOut | None


class DecommissionRequest(BaseModel):
    # Archiving keeps the code and history read-only; deleting frees the name.
    repository: Literal["archive", "delete"] = "archive"


class DecommissionResult(BaseModel):
    name: str
    repository: Literal["archive", "delete"]
    steps: list[str]


class NameCheck(BaseModel):
    name: str
    available: bool
    reason: str | None = None


class Stats(BaseModel):
    services: int
    live: int
    launching: int
    failed: int
    median_launch_seconds: float | None
