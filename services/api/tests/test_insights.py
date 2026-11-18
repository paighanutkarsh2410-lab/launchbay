"""Scorecards and failure explanations."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.explainer import ClaudeExplainer, Explainer, Failure, RuleExplainer
from app.providers.base import RepoFacts, StepError
from app.providers.demo import DemoProvider
from app.scorecard import CHECKS, evaluate, grade_for, score

SERVICE = {"name": "ledger-api", "template_id": "python-fastapi", "owner": "payments"}


async def launch(app: FastAPI, client: AsyncClient, body: dict = SERVICE) -> None:
    assert (await client.post("/api/services", json=body)).status_code == 201
    await app.state.launcher.wait_idle()


@pytest.fixture(autouse=True)
def no_network_probe(app: FastAPI) -> None:
    # The "answers its health check" probe would reach out to *.localtest.me.
    app.state.scorecards.probe = False


# Scorecards


def test_grades() -> None:
    assert [grade_for(s) for s in (100, 90, 89, 75, 74, 50, 49)] == [
        "Gold", "Gold", "Silver", "Silver", "Bronze", "Bronze", "Needs work",
    ]  # fmt: skip


def service_row(**overrides):
    deploy = SimpleNamespace(key="deploy", status="succeeded")
    values = {
        "name": "ledger-api",
        "owner": "payments",
        "description": "Keeps the books",
        "resources": [],
        "cloud": None,
        "launches": [SimpleNamespace(steps=[deploy])],
    }
    return SimpleNamespace(**{**values, **overrides})


def test_every_check_passes_for_a_healthy_service() -> None:
    now = datetime.now(UTC)
    facts = RepoFacts("success", None, True, True, True, now - timedelta(days=2), "Healthy")
    results = evaluate(service_row(), facts, True, now)
    by_id = {r.check.id: r.result for r in results}
    assert by_id.pop("encrypted") == "skip"  # no cloud resources
    assert set(by_id.values()) == {"pass"}
    assert score(results) == 100


def test_failures_cost_their_weight_and_unknowns_are_skipped() -> None:
    now = datetime.now(UTC)
    facts = RepoFacts(ci_conclusion="failure", last_commit_at=now - timedelta(days=200))
    results = evaluate(service_row(description=""), facts, None, now)
    by_id = {r.check.id: r for r in results}
    assert by_id["ci"].result == "fail" and by_id["ci"].detail == "Latest run: failure"
    assert by_id["fresh"].result == "fail"
    assert by_id["description"].result == "fail"
    assert by_id["readme"].result == "skip"  # unknown, so not held against it
    counted = [r for r in results if r.result != "skip"]
    passed = sum(r.check.weight for r in counted if r.result == "pass")
    assert score(results) == round(100 * passed / sum(r.check.weight for r in counted))


async def test_scorecard_endpoint(app: FastAPI, client: AsyncClient) -> None:
    await launch(app, client)
    card = (await client.get("/api/services/ledger-api/scorecard")).json()
    assert [c["id"] for c in card["checks"]] == [c.id for c in CHECKS]
    assert 0 <= card["score"] <= 100
    assert card["grade"] == grade_for(card["score"])
    summary = (await client.get("/api/scorecards")).json()
    assert summary == [{"service": "ledger-api", "score": card["score"], "grade": card["grade"]}]


async def test_scorecards_are_cached_until_fresh_is_asked(
    app: FastAPI, client: AsyncClient
) -> None:
    await launch(app, client)
    calls = []
    provider = app.state.launcher.provider
    original = provider.repo_facts

    async def counting(request):
        calls.append(request.name)
        return await original(request)

    provider.repo_facts = counting
    await client.get("/api/services/ledger-api/scorecard")
    await client.get("/api/services/ledger-api/scorecard")
    assert len(calls) == 1
    await client.get("/api/services/ledger-api/scorecard?fresh=true")
    assert len(calls) == 2


# Explanations


class FailingPipeline(DemoProvider):
    def __init__(self) -> None:
        super().__init__(speed=0)

    async def run_pipeline(self, request, ctx) -> str:
        await ctx.log("Run 4242: completed (failure)")
        raise StepError("CI failed on main. Push a fix to main, then retry.")

    async def failure_context(self, request, stage):
        return (
            "Failed job: build (failed step: Run pytest -q)\n"
            "FAILED tests/test_main.py::test_root_names_the_service - AssertionError\n"
            "1 failed, 3 passed in 0.41s"
        )


async def test_nothing_to_explain_without_a_failure(app: FastAPI, client: AsyncClient) -> None:
    await launch(app, client)
    assert (await client.post("/api/services/ledger-api/explain")).status_code == 409


async def test_explains_a_failed_launch_once(app: FastAPI, client: AsyncClient) -> None:
    app.state.launcher.provider = FailingPipeline()
    await launch(app, client)

    first = await client.post("/api/services/ledger-api/explain")
    assert first.status_code == 200
    body = first.json()
    assert body["source"] == "rules" and body["stage"] == "pipeline"
    assert "tests" in body["summary"]
    assert any("1 failed" in line for line in body["evidence"])

    # Stored with the launch: asking again does not explain it again.
    app.state.explainer = None
    assert (await client.post("/api/services/ledger-api/explain")).json() == body


def failure(**overrides) -> Failure:
    values = {
        "service": "ledger-api",
        "template": "python-fastapi",
        "stage": "deploy",
        "stage_title": "Deploy with Argo CD",
        "error": "",
        "logs": [],
        "context": None,
        "guardrails": [],
    }
    return Failure(**{**values, **overrides})


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        (
            {"error": "Blocked by a cluster guardrail: Pods must set runAsNonRoot."},
            "guardrail",
        ),
        (
            {
                "stage": "pipeline",
                "context": "Total: 1 (HIGH: 1, CRITICAL: 0)\nzlib CVE-2026-1234 HIGH fixed 1.3.2",
            },
            "vulnerability",
        ),
        ({"stage": "pipeline", "context": "npm ERR! Test failed"}, "tests failed"),
        ({"error": "Timed out waiting for Argo CD to sync the service"}, "gave up waiting"),
        ({"stage": "cloud", "error": "terraform apply failed: Error: creating SQS"}, "Terraform"),
        ({"error": "Something new"}, "failed in"),
    ],
)
def test_rules_recognise_common_failures(overrides: dict, expected: str) -> None:
    assert expected in RuleExplainer().explain(failure(**overrides)).summary


GOOD = (
    '{"summary": "A test failed.", "cause": "test_root asserts the name.", '
    '"fix": ["Fix it", "Retry"], "evidence": ["1 failed"], "confidence": "high"}'
)


def fake_claude(result):
    """A ClaudeExplainer whose API call returns (or raises) `result`."""
    explainer = ClaudeExplainer("test-key", "claude-opus-5-5", RuleExplainer())
    sent = {}

    async def create(**kwargs):
        sent.update(kwargs)
        if isinstance(result, Exception):
            raise result
        return result

    explainer.client = SimpleNamespace(
        beta=SimpleNamespace(messages=SimpleNamespace(create=create))
    )
    return explainer, sent


def response(text: str, stop: str = "end_turn"):
    return SimpleNamespace(
        stop_reason=stop, model="claude-opus-5-5", content=[SimpleNamespace(type="text", text=text)]
    )


async def test_claude_answer_is_used_and_the_request_is_well_formed() -> None:
    explainer, sent = fake_claude(response(GOOD))
    out = await explainer.explain(failure(stage="pipeline", logs=["1 failed"]))
    assert out.source == "claude" and out.model == "claude-opus-5-5"
    assert out.fix == ["Fix it", "Retry"]
    assert sent["model"] == "claude-opus-5-5"
    assert sent["output_config"]["format"]["type"] == "json_schema"
    assert sent["output_config"]["format"]["schema"]["additionalProperties"] is False
    assert sent["fallbacks"] == "default"
    assert "<failed_stage>pipeline" in sent["messages"][0]["content"]


@pytest.mark.parametrize(
    "result",
    [
        response("", stop="refusal"),
        response('{"summary": "cut off'),
        anthropic.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com")),
    ],
    ids=["refusal", "truncated", "unreachable"],
)
async def test_falls_back_to_rules(result) -> None:
    explainer, _ = fake_claude(result)
    out = await explainer.explain(failure(error="Timed out waiting for Argo CD"))
    assert out.source == "rules" and out.note
    assert "gave up waiting" in out.summary


def test_without_a_key_only_rules_run() -> None:
    assert Explainer(None, "claude-opus-5-5").claude is None
    assert Explainer("k", "claude-opus-5-5").label == "Claude (claude-opus-5-5)"
