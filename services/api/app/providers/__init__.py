from app.config import Settings
from app.providers.base import LaunchRequest, Provider, StepContext
from app.providers.demo import DemoProvider


def build_provider(settings: Settings) -> Provider:
    if settings.provider == "github":
        from app.providers.github import GitHubProvider

        return GitHubProvider(settings)
    return DemoProvider(speed=settings.demo_speed, domain=settings.service_domain)


__all__ = ["LaunchRequest", "Provider", "StepContext", "build_provider"]
