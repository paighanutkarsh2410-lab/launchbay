"""Launchbay's cluster guardrails, read from the Kyverno policies the cluster enforces.

Serving them from the same files platform-up.sh applies means the portal can never describe
rules that differ from the ones Kyverno runs."""

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Guardrail:
    name: str
    title: str
    summary: str
    kind: str
    rules: list[str]


def load_guardrails(policies_dir: Path) -> list[Guardrail]:
    guardrails = []
    for file in sorted(policies_dir.glob("*.yaml")):
        text = file.read_text(encoding="utf-8")
        policy = yaml.safe_load(text)
        # The leading comment block is the human summary of the policy.
        summary = " ".join(
            line.lstrip("# ").strip() for line in text.splitlines() if line.startswith("#")
        )
        guardrails.append(
            Guardrail(
                name=policy["metadata"]["name"],
                title=policy["metadata"]["annotations"]["launchbay.dev/title"],
                summary=summary,
                kind=policy["kind"],
                # Positive wording for the portal; the validation messages are the denials.
                rules=policy["metadata"]["annotations"]["launchbay.dev/rules"].strip().splitlines(),
            )
        )
    # Supply chain first, then what runs, how it runs, and how it is operated.
    order = ["require-signed-images", "restrict-registries", "pod-security", "require-operability"]
    rank = {f"launchbay-{name}": i for i, name in enumerate(order)}
    return sorted(guardrails, key=lambda g: rank.get(g.name, len(order)))
