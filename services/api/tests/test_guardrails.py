from app.providers.github import policy_denial

KYVERNO = (
    'admission webhook "vpol.validate.kyverno.svc-fail" denied the request: '
    "Policy launchbay-pod-security failed: Pods must set securityContext.runAsNonRoot: true."
)


def test_reads_a_denial_from_a_refused_resource() -> None:
    status = {
        "operationState": {
            "phase": "Running",
            "message": "one or more objects failed to apply, reason: retrying",
            "syncResult": {
                "resources": [
                    {"kind": "Service", "status": "Synced", "message": "service created"},
                    {"kind": "Deployment", "status": "SyncFailed", "message": KYVERNO},
                ]
            },
        }
    }
    assert policy_denial(status) == "Pods must set securityContext.runAsNonRoot: true."


def test_reads_a_denial_from_the_operation_message() -> None:
    status = {"operationState": {"phase": "Failed", "message": f"error: {KYVERNO}"}}
    assert policy_denial(status).startswith("Pods must set")


def test_ignores_ordinary_sync_states() -> None:
    assert policy_denial({}) is None
    assert policy_denial({"operationState": {"phase": "Succeeded", "message": "ok"}}) is None


async def test_serves_the_enforced_guardrails(client) -> None:
    guardrails = (await client.get("/api/guardrails")).json()
    assert [g["name"] for g in guardrails][0] == "launchbay-require-signed-images"
    assert {g["name"] for g in guardrails} == {
        "launchbay-require-signed-images",
        "launchbay-restrict-registries",
        "launchbay-pod-security",
        "launchbay-require-operability",
    }
    assert all(g["title"] and g["summary"] and g["rules"] for g in guardrails)
