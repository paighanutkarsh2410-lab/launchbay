# Launchbay architecture

Launchbay is a self-service internal developer platform. A developer picks a
template, names a service, and Launchbay takes it from nothing to a running,
signed, policy-checked deployment without anyone filing a ticket.

## The launch

Every new service goes through the same seven stages. Each stage is recorded in
the database and streamed to the portal as it happens.

| # | Stage | What happens |
|---|---|---|
| 1 | Validate | Name is DNS-safe and unused; template exists; owner is set |
| 2 | Repository | A GitHub repo is created and the template is rendered into its first commit |
| 3 | Cloud | Terraform provisions the resources the service asked for (S3, SQS, DynamoDB) |
| 4 | Pipeline | The template's CI runs: tests, Trivy, image build, cosign signing, push to GHCR |
| 5 | GitOps | A manifest for the service, with its resources' variables, is committed to `launchbay-gitops` |
| 6 | Deploy | Argo CD's ApplicationSet picks the manifest up and syncs it to its own namespace |
| 7 | Live | The service answers its health check and gets a URL |

## Components

```
                 ┌──────────────────────────┐
  developer ───► │  Portal (React, Vite)    │
                 └────────────┬─────────────┘
                              │ REST + Server-Sent Events
                 ┌────────────▼─────────────┐        ┌────────────────────┐
                 │  API (FastAPI)           │ ─────► │ SQLite             │
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
  ApplicationSet with a Git generator turns each manifest into an Application, and passes the
  manifest to the chart as its values file.

## Cloud resources

```
 API ── terraform apply ──► http://aws.localtest.me ──► Moto (ns launchbay-cloud)
  │      (state: ~/.launchbay/cloud/<svc>)                    ▲
  └── env ──► services/<svc>.yaml ──► Deployment ── AWS SDK ──┘ moto.launchbay-cloud:5000
```

- `platform/terraform/modules/` has one module per resource: a private, versioned bucket; a queue
  with a dead-letter queue; an on-demand table with point-in-time recovery. All three take a KMS key.
- `platform/terraform/service/` is the root Launchbay applies once per service. It creates the
  service's KMS key and the modules it asked for, and outputs the environment variables
  (`LAUNCHBAY_BUCKET`, `LAUNCHBAY_QUEUE_URL`, `LAUNCHBAY_TABLE`, `AWS_REGION`, `AWS_ENDPOINT_URL`).
- Each service gets its own state file and Terraform data directory, so launches never share state;
  providers come from a shared plugin cache, pinned by the committed lock file.
- Terraform reaches the emulator through Traefik; pods reach it by its cluster address. Only the
  endpoint differs, so the same root targets real AWS when `endpoint` is null. On AWS, pods would
  get credentials from EKS Pod Identity rather than the emulator's placeholder keys.
- Moto keeps state in memory. The API re-applies every live service's Terraform when it starts,
  which recreates anything a restarted emulator lost and changes nothing otherwise.
- Decommissioning runs `terraform destroy` and removes the state.

Moto replaced LocalStack in the plan: LocalStack's image now needs an account and auth token, while
Moto is Apache-2.0 and runs anywhere with no sign-up.

## Runs locally

Everything runs on one laptop: the portal and API natively, Kubernetes in kind
(Docker Desktop on WSL2). No cloud VMs are needed. AWS is optional and only
used for short, torn-down demos.

## Phases

1. Core loop: portal, launches, repo + CI, GitOps, Argo CD on kind
2. Guardrails: Kyverno CEL policies (signed images, trusted registry, pod security, probes and resources)
3. Cloud resources: Terraform modules (S3, SQS, DynamoDB) on the Moto emulator, AWS-ready
4. Catalog and AI helper: scorecards, failure explanations
5. Polish: docs, screenshots, demo
