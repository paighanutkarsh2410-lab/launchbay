# launchbay-gitops

The GitOps source of truth for services launched with [Launchbay](https://github.com/paighanutkarsh2410-lab/launchbay).
Launchbay created this repository when it was connected to this GitHub organization.

What's on `main` here is what runs. Launchbay launches a service by committing one file to
`services/`; an Argo CD ApplicationSet turns each file into an Application deployed with the
shared chart in `charts/service`. Removing the file removes the service.

```yaml
# services/payments-api.yaml
name: payments-api
owner: team-payments
template: python-fastapi
image: ghcr.io/<org>/payments-api@sha256:…
port: 8000
runAsUser: 10001
host: payments-api.localtest.me
```

Every service gets the same hardened defaults from the chart: two replicas, a PodDisruptionBudget,
readiness and liveness probes on `/healthz`, a non-root `RuntimeDefault` seccomp profile, a
read-only root filesystem, no privilege escalation, all capabilities dropped, resource requests
and limits, and an Ingress.

Kyverno enforces Launchbay's guardrails on every namespace launched from here: images only from
this organization's GitHub Container Registry, each signed by its own repository's CI on `main`,
no `:latest`, hardened pods, and resource requests, a memory limit and health probes.
