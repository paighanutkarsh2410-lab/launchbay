# Launchbay architecture

Launchbay is a self-service internal developer platform. A developer picks a
template, names a service, and Launchbay takes it from nothing to a running,
signed, policy-checked deployment without anyone filing a ticket.

## The launch

Every new service goes through the same six stages. Each stage is recorded in
the database and streamed to the portal as it happens.

| # | Stage | What happens |
|---|---|---|
| 1 | Validate | Name is DNS-safe and unused; template exists; owner is set |
| 2 | Repository | A GitHub repo is created and the template is rendered into its first commit |
| 3 | Pipeline | The template's CI runs: tests, Trivy, image build, cosign signing, push to GHCR |
| 4 | GitOps | A manifest for the service is committed to `launchbay-gitops` |
| 5 | Deploy | Argo CD's ApplicationSet picks the manifest up and syncs it to its own namespace |
| 6 | Live | The service answers its health check and gets a URL |

## Components

```
                 ┌──────────────────────────┐
  developer ───► │  Portal (React, Vite)    │
                 └────────────┬─────────────┘
                              │ REST + Server-Sent Events
                 ┌────────────▼─────────────┐        ┌────────────────────┐
                 │  API (FastAPI)           │ ─────► │ PostgreSQL         │
                 │  launcher + providers    │        │ services, launches │
                 └──┬──────────────┬────────┘        └────────────────────┘
                    │              │
        GitHub App  │              │  Argo CD API
                    ▼              ▼
     ┌──────────────────┐   ┌────────────────────────────────────────┐
     │ service repo     │   │ kind cluster (on the laptop)           │
     │  CI → GHCR       │   │  Argo CD ── ApplicationSet ──► ns/<svc> │
     │ launchbay-gitops │──►│                                        │
     └──────────────────┘   └────────────────────────────────────────┘
```

- **Portal**: React + TypeScript, Tailwind CSS, Motion for animation,
  TanStack Query for data. The launch view subscribes to the API's event
  stream, so progress appears the moment a stage changes.
- **API**: FastAPI with async SQLAlchemy. The launcher runs each launch as a
  background task and talks to the outside world only through *providers*:
  - `GitHubProvider` uses a GitHub App (scoped permissions, short-lived
    installation tokens; no personal access tokens).
  - `DemoProvider` simulates every stage with realistic timing, so the portal
    can be developed, tested and demoed with no credentials at all.
- **Templates** live in `templates/`. Each has a `template.yaml` (metadata and
  inputs) and a `skeleton/` that is rendered into the new repo. Placeholders use
  `[[name]]` so they never clash with GitHub Actions' `${{ }}` syntax.
- **GitOps**: `launchbay-gitops` holds one small manifest per service. An Argo CD
  ApplicationSet with a Git generator turns each manifest into an Application.

## Runs locally

Everything runs on one laptop: the portal and API natively, Kubernetes in kind
(Docker Desktop on WSL2). No cloud VMs are needed. AWS is optional and only
used for short, torn-down demos.

## Phases

1. Core loop: portal, launches, repo + CI, GitOps, Argo CD on kind
2. Guardrails: Kyverno CEL policies (signed images, trusted registry, pod security, probes and resources)
3. Cloud resources: Terraform modules on LocalStack, AWS for demos
4. Catalog and AI helper: scorecards, failure explanations
5. Polish: docs, screenshots, demo
