from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
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

    # Cloud resources: "simulated" fakes them; "emulator" runs Terraform against Moto.
    cloud: Literal["simulated", "emulator"] = "simulated"
    terraform_bin: str = "terraform"
    terraform_dir: Path = REPO_ROOT / "platform" / "terraform" / "service"
    # Per-service Terraform state, kept outside the repo.
    cloud_state_dir: Path = Path.home() / ".launchbay" / "cloud"
    # Where Terraform (on this machine) and the services (in the cluster) reach the emulator.
    cloud_endpoint: str = "http://aws.localtest.me"
    cloud_service_endpoint: str = "http://moto.launchbay-cloud.svc.cluster.local:5000"

    # Failure explanations: Claude when a key is available, built-in rules otherwise.
    # The key comes from LAUNCHBAY_ANTHROPIC_API_KEY or this file (kept outside the repo).
    anthropic_api_key: SecretStr | None = None
    anthropic_api_key_file: Path = Path.home() / ".launchbay" / "anthropic-api-key"
    explainer_model: str = "claude-opus-5-5"
    # How long scorecards are reused before their checks run again.
    scorecard_ttl_seconds: int = 300

    def anthropic_key(self) -> str | None:
        if self.anthropic_api_key:
            return self.anthropic_api_key.get_secret_value()
        if self.anthropic_api_key_file.is_file():
            return self.anthropic_api_key_file.read_text(encoding="utf-8").strip() or None
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
