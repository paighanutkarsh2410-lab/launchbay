import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Enum, ForeignKey, Integer, String, Text
from sqlalchemy import DateTime as _DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.db import Base


class DateTime(TypeDecorator):
    """Timezone-aware UTC timestamps on every database (SQLite drops the offset otherwise)."""

    impl = _DateTime
    cache_ok = True

    def __init__(self, timezone: bool = True) -> None:
        super().__init__(timezone=timezone)

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Naive datetime; use datetime.now(UTC)")
        return value.astimezone(UTC) if value is not None else None

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _now() -> datetime:
    return datetime.now(UTC)


def _id() -> str:
    return uuid.uuid4().hex


class ServiceStatus(enum.StrEnum):
    LAUNCHING = "launching"
    LIVE = "live"
    FAILED = "failed"


class StepStatus(enum.StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class Service(Base):
    __tablename__ = "services"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    name: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    template_id: Mapped[str] = mapped_column(String(64))
    owner: Mapped[str] = mapped_column(String(64))
    status: Mapped[ServiceStatus] = mapped_column(
        Enum(ServiceStatus, native_enum=False, length=16), default=ServiceStatus.LAUNCHING
    )
    repo_url: Mapped[str | None] = mapped_column(String(255))
    url: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    launches: Mapped[list["Launch"]] = relationship(
        back_populates="service", order_by="Launch.started_at.desc()", cascade="all, delete-orphan"
    )


class Launch(Base):
    __tablename__ = "launches"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"))
    status: Mapped[StepStatus] = mapped_column(
        Enum(StepStatus, native_enum=False, length=16), default=StepStatus.RUNNING
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)

    service: Mapped[Service] = relationship(back_populates="launches")
    steps: Mapped[list["LaunchStep"]] = relationship(
        back_populates="launch", order_by="LaunchStep.position", cascade="all, delete-orphan"
    )


class LaunchStep(Base):
    __tablename__ = "launch_steps"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    launch_id: Mapped[str] = mapped_column(ForeignKey("launches.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(64))
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[StepStatus] = mapped_column(
        Enum(StepStatus, native_enum=False, length=16), default=StepStatus.PENDING
    )
    detail: Mapped[str | None] = mapped_column(Text)
    logs: Mapped[list[str]] = mapped_column(JSON, default=list)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    launch: Mapped[Launch] = relationship(back_populates="steps")
