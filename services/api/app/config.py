from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]


class Settings(BaseSettings):
    """Configuration, read from LAUNCHBAY_* environment variables or services/api/.env."""

    # Anchored to services/api so the API finds its settings and database from any directory.
    model_config = SettingsConfigDict(
        env_prefix="LAUNCHBAY_", env_file=API_ROOT / ".env", extra="ignore"
    )

    database_url: str = f"sqlite+aiosqlite:///{(API_ROOT / 'launchbay.db').as_posix()}"
    cors_origins: list[str] = ["http://localhost:5173"]
    templates_dir: Path = REPO_ROOT / "templates"
    policies_dir: Path = REPO_ROOT / "platform" / "kyverno" / "policies"

    # "demo" simulates every stage; "github" does it for real.
    provider: Literal["demo", "github"] = "demo"
    # Speeds up or slows down the demo provider (1.0 is realistic timing).
    demo_speed: float = 1.0

    github_app_id: str | None = None
    github_private_key_path: Path | None = None
    github_owner: str | None = None
    gitops_repo: str = "launchbay-gitops"

    argocd_url: str | None = None
    argocd_token: str | None = None
    service_domain: str = "localtest.me"


@lru_cache
def get_settings() -> Settings:
    return Settings()
