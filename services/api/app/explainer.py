"""Explains why a launch failed and what to do about it.

`RuleExplainer` recognises the failures Launchbay knows well (a guardrail denial, a failing test
or vulnerability scan, a Terraform error, a timeout) with no network and no cost.
`ClaudeExplainer` and `GeminiExplainer` send the same evidence, including the failed CI job's log,
to a model and get a structured answer back; if the model is unavailable or declines, the rules
answer instead. Which one runs depends on the keys configured (see `build_explainer`).
"""

import logging
import re
from dataclasses import dataclass
from typing import Literal

import anthropic
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel, Field, ValidationError

log = logging.getLogger(__name__)

MAX_LOG_LINES = 200


class Explanation(BaseModel):
    summary: str = Field(description="One sentence: what went wrong, in plain words.")
    cause: str = Field(description="Two or three sentences: why it happened, citing evidence.")
    fix: list[str] = Field(description="Concrete steps the developer should take, in order.")
    evidence: list[str] = Field(description="Up to 4 log lines, copied exactly, that show it.")
    confidence: Literal["high", "medium", "low"]


class ExplanationOut(Explanation):
    source: Literal["claude", "gemini", "rules"]
    model: str | None = None
    stage: str
    note: str | None = None  # e.g. why the model was not used


@dataclass
class Failure:
    service: str
    template: str
    stage: str
    stage_title: str
    error: str
    logs: list[str]
    context: str | None  # extra evidence from the provider (failed job log, Argo CD status)
    guardrails: list[str]


def _evidence(lines: list[str], *patterns: str, flags: int = re.I) -> list[str]:
    found = [line.strip() for line in lines if any(re.search(p, line, flags) for p in patterns)]
    return list(dict.fromkeys(found))[:4]


class RuleExplainer:
    """Pattern-matches the failures Launchbay sees most."""

    def explain(self, f: Failure) -> Explanation:
        # The provider's evidence (e.g. the failed job's log) is the most specific; it goes first.
        text = "\n".join([f.context or "", *f.logs, f.error])
        lines = text.splitlines()

        if "Blocked by a cluster guardrail" in f.error or "denied the request" in text:
            rule = f.error.split("guardrail:", 1)[-1].strip()
            return Explanation(
                summary="Kubernetes refused the deployment because it broke a Launchbay guardrail.",
                cause=f"Kyverno checks every workload when it is admitted. This one failed: {rule}",
                fix=[
                    "Change the service so it meets that rule (the chart and template defaults "
                    "already do; look for local overrides).",
                    "Push the fix to main, then press Retry: the launch resumes at Deploy.",
                ],
                evidence=_evidence(lines, "guardrail", "denied")[:4] or [f.error],
                confidence="high",
            )
        if f.stage == "pipeline":
            if re.search(r"(CRITICAL|HIGH).*(CVE-|vulnerabilit)|Total: \d+ \(.*CRITICAL", text):
                return Explanation(
                    summary="The pipeline stopped because Trivy found a known vulnerability.",
                    cause="Launchbay pipelines fail on any fixable CRITICAL or HIGH finding, so "
                    "a vulnerable package or base image never reaches the cluster.",
                    fix=[
                        "Open the run and read the Trivy table for the package and fixed version.",
                        "Upgrade that package (or the base image), push to main, then Retry.",
                    ],
                    evidence=_evidence(lines, "CVE-", "CRITICAL", "Total:"),
                    confidence="high",
                )
            if re.search(r"\bFAILED\b|AssertionError|npm ERR!|\d+ failed", text):
                return Explanation(
                    summary="The pipeline stopped because the service's tests failed.",
                    cause="Tests run before the image is built; a failing test stops the "
                    "launch so broken code is never deployed.",
                    fix=[
                        "Run the tests locally (pytest or npm test) to reproduce it.",
                        "Fix the code or the test, push to main, then press Retry.",
                    ],
                    evidence=_evidence(
                        lines, r"\bFAILED\b", "AssertionError", r"\d+ failed", "npm ERR!", flags=0
                    ),
                    confidence="high",
                )
            if re.search(r"cancel", text, re.I):
                return Explanation(
                    summary="The pipeline run was cancelled before it finished.",
                    cause="Someone cancelled the run, or a newer run on main replaced it.",
                    fix=["Press Retry: it follows the newest commit on main."],
                    evidence=_evidence(lines, "cancel"),
                    confidence="medium",
                )
        if f.stage == "cloud" and "terraform" in text.lower():
            return Explanation(
                summary="Terraform could not provision the service's cloud resources.",
                cause="The cloud stage applies the service's Terraform against the AWS "
                "emulator; the apply returned an error.",
                fix=[
                    "Check the emulator is up: kubectl -n launchbay-cloud get pods.",
                    "Read the Terraform error below, then press Retry; the apply is idempotent.",
                ],
                evidence=_evidence(lines, "Error", "failed"),
                confidence="medium",
            )
        if re.search(r"timed out|timeout", text, re.I):
            where = {
                "pipeline": "the pipeline to finish",
                "deploy": "Argo CD to sync and report Healthy",
                "live": "the health check to answer",
            }.get(f.stage, f.stage_title)
            return Explanation(
                summary=f"The launch gave up waiting for {where}.",
                cause="Nothing failed outright; it just never got there in time. Pods that "
                "cannot pull their image or crash on start are the usual reason.",
                fix=[
                    f"Check the pods: kubectl -n {f.service} get pods, then describe or logs.",
                    "Fix what they report, then press Retry.",
                ],
                evidence=_evidence(lines, "timed out", "timeout", "Health:", "Degraded"),
                confidence="low",
            )
        return Explanation(
            summary=f"The launch failed in '{f.stage_title}'.",
            cause=f.error,
            fix=["Read the stage's log for details, fix the cause, then press Retry."],
            evidence=[f.error],
            confidence="low",
        )


SYSTEM = """You explain failed launches on Launchbay, an internal developer platform.

A launch takes a service from a template to a running deployment in seven stages:
1. validate: name, template and owner are checked.
2. repository: a GitHub App creates the repo and commits the rendered template.
3. cloud: Terraform provisions the S3 bucket, SQS queue and DynamoDB table the service asked for,
   on a local AWS emulator (Moto) in a kind cluster.
4. pipeline: the repo's GitHub Actions CI runs tests, Trivy scans (fails on fixable CRITICAL or
   HIGH findings), builds the image, pushes it to GHCR and signs it keylessly with cosign.
5. gitops: a manifest is committed to the launchbay-gitops repo.
6. deploy: an Argo CD ApplicationSet syncs it; Kyverno admission policies (the guardrails) can
   refuse the workload.
7. live: the service's /healthz must answer.

A failed launch can be retried; Retry keeps the stages that passed and resumes at the failed one,
following the newest commit on main.

Explain the failure to the developer who owns the service. Base every claim on the evidence you
are given; do not invent file names, versions or errors that are not in it. If the evidence is
thin, say so and lower your confidence. Keep fix steps concrete and short, and end with Retry when
retrying would help. Copy evidence lines exactly as they appear."""


def _prompt(f: Failure) -> str:
    logs = "\n".join(f.logs[-MAX_LOG_LINES:])
    context = f.context or "(none)"
    guardrails = "\n".join(f"- {g}" for g in f.guardrails) or "(none)"
    return (
        f"<service>{f.service}</service>\n<template>{f.template}</template>\n"
        f"<failed_stage>{f.stage} ({f.stage_title})</failed_stage>\n"
        f"<error>{f.error}</error>\n"
        f"<stage_log>\n{logs}\n</stage_log>\n"
        f"<extra_evidence>\n{context}\n</extra_evidence>\n"
        f"<guardrails>\n{guardrails}\n</guardrails>\n\n"
        "Explain why this launch failed and how to fix it."
    )


def _schema() -> dict:
    schema = Explanation.model_json_schema()
    schema["additionalProperties"] = False
    return schema


class ModelExplainer:
    """Shared by the model-backed explainers: the rules answer whenever the model can't."""

    source: Literal["claude", "gemini"]
    name: str

    def __init__(self, model: str, fallback: RuleExplainer) -> None:
        self.model = model
        self.fallback = fallback

    @property
    def label(self) -> str:
        return f"{self.name} ({self.model})"

    def rules(self, f: Failure, note: str) -> ExplanationOut:
        return ExplanationOut(
            **self.fallback.explain(f).model_dump(), source="rules", stage=f.stage, note=note
        )

    def answer(self, f: Failure, text: str, model: str | None) -> ExplanationOut:
        try:
            explanation = Explanation.model_validate_json(text)
        except ValidationError:
            log.warning("%s returned an unexpected shape", self.name)
            return self.rules(
                f, f"{self.name}'s answer was incomplete; explained with built-in rules instead."
            )
        return ExplanationOut(
            **explanation.model_dump(), source=self.source, model=model or self.model, stage=f.stage
        )

    async def explain(self, f: Failure) -> ExplanationOut:
        raise NotImplementedError


class ClaudeExplainer(ModelExplainer):
    source = "claude"
    name = "Claude"

    def __init__(self, api_key: str, model: str, fallback: RuleExplainer) -> None:
        super().__init__(model, fallback)
        self.client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=2, timeout=120)

    async def explain(self, f: Failure) -> ExplanationOut:
        try:
            response = await self.client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                system=SYSTEM,
                messages=[{"role": "user", "content": _prompt(f)}],
                output_config={
                    "effort": "medium",
                    "format": {"type": "json_schema", "schema": _schema()},
                },
                # If the model declines, the API retries on a fallback model in the same call.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.AuthenticationError:
            return self.rules(
                f, "Claude rejected the API key; explained with built-in rules instead."
            )
        except anthropic.RateLimitError:
            return self.rules(f, "Claude is rate limited right now; explained with built-in rules.")
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as error:
            log.warning("Claude explanation failed: %s", error)
            return self.rules(
                f, "Claude could not be reached; explained with built-in rules instead."
            )

        if response.stop_reason == "refusal":
            return self.rules(f, "Claude declined this one; explained with built-in rules instead.")
        text = next((b.text for b in response.content if b.type == "text"), "")
        return self.answer(f, text, response.model)


class GeminiExplainer(ModelExplainer):
    """Google's Gemini API; its free tier is enough for occasional explanations.

    Free-tier capacity comes and goes ("high demand" 503s), so when the main model is overloaded
    the same request goes to a lighter one before the rules take over.
    """

    source = "gemini"
    name = "Gemini"

    def __init__(
        self, api_key: str, model: str, fallback: RuleExplainer, overflow_model: str | None = None
    ) -> None:
        super().__init__(model, fallback)
        self.overflow_model = overflow_model
        self.client = genai.Client(
            api_key=api_key,
            http_options=genai_types.HttpOptions(
                timeout=60_000, retry_options=genai_types.HttpRetryOptions(attempts=2)
            ),
        )

    async def _generate(self, f: Failure):
        config = genai_types.GenerateContentConfig(
            system_instruction=SYSTEM,
            response_mime_type="application/json",
            response_json_schema=_schema(),
        )
        models = [self.model, *([self.overflow_model] if self.overflow_model else [])]
        for i, model in enumerate(models):
            try:
                return await self.client.aio.models.generate_content(
                    model=model, contents=_prompt(f), config=config
                )
            except genai_errors.ServerError as error:
                if i == len(models) - 1:
                    raise
                log.info(
                    "Gemini %s is unavailable (%s); trying %s", model, error.code, models[i + 1]
                )
        raise AssertionError("unreachable")

    async def explain(self, f: Failure) -> ExplanationOut:
        try:
            response = await self._generate(f)
        except genai_errors.ClientError as error:
            if error.code == 429:
                return self.rules(
                    f, "Gemini's free-tier limit was reached; explained with built-in rules."
                )
            log.warning("Gemini rejected the request: %s", error)
            return self.rules(
                f, "Gemini rejected the request (check the API key); explained with built-in rules."
            )
        except Exception as error:  # noqa: BLE001 - server and network errors alike fall back
            log.warning("Gemini explanation failed: %s", error)
            return self.rules(
                f, "Gemini could not be reached; explained with built-in rules instead."
            )

        candidate = (response.candidates or [None])[0]
        reason = str(getattr(candidate, "finish_reason", "") or "")
        if any(word in reason for word in ("SAFETY", "BLOCKLIST", "PROHIBITED")):
            return self.rules(f, "Gemini declined this one; explained with built-in rules instead.")
        return self.answer(f, response.text or "", response.model_version)


class Explainer:
    """A model when one is configured, built-in rules otherwise."""

    def __init__(self, model: ModelExplainer | None = None) -> None:
        self.rules = RuleExplainer()
        self.model = model
        if model:
            model.fallback = self.rules

    @property
    def source(self) -> Literal["claude", "gemini", "rules"]:
        return self.model.source if self.model else "rules"

    @property
    def label(self) -> str:
        return self.model.label if self.model else "Built-in rules"

    async def explain(self, failure: Failure) -> ExplanationOut:
        if self.model:
            return await self.model.explain(failure)
        return ExplanationOut(
            **self.rules.explain(failure).model_dump(), source="rules", stage=failure.stage
        )


def build_explainer(
    choice: str,
    anthropic_key: str | None,
    claude_model: str,
    gemini_key: str | None,
    gemini_model: str,
    gemini_overflow_model: str | None = None,
) -> Explainer:
    """`choice` is auto, claude, gemini or rules. Auto picks Claude, then Gemini, by key."""
    rules = RuleExplainer()
    if choice in ("auto", "claude") and anthropic_key:
        return Explainer(ClaudeExplainer(anthropic_key, claude_model, rules))
    if choice in ("auto", "gemini") and gemini_key:
        return Explainer(GeminiExplainer(gemini_key, gemini_model, rules, gemini_overflow_model))
    if choice not in ("auto", "rules"):
        log.warning("LAUNCHBAY_EXPLAINER=%s but no key for it; using built-in rules", choice)
    return Explainer()
