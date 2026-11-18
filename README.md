<div align="center">

<img src="apps/portal/public/favicon.svg" width="72" alt="Launchbay logo" />

# Launchbay

**Ship a service in minutes, not tickets.**

A self-service internal developer platform. Pick a template, name your service, and Launchbay
creates the repo, provisions its cloud resources with Terraform, runs a tested, scanned and signed
pipeline, and lets Argo CD put it live.

[![CI](https://github.com/paighanutkarsh2410-lab/launchbay/actions/workflows/ci.yml/badge.svg)](https://github.com/paighanutkarsh2410-lab/launchbay/actions/workflows/ci.yml)
![FastAPI](https://img.shields.io/badge/API-FastAPI-009688)
![React](https://img.shields.io/badge/Portal-React%2019-61dafb)
![Argo CD](https://img.shields.io/badge/GitOps-Argo%20CD-ef7b4d)
![Terraform](https://img.shields.io/badge/cloud-Terraform-7b42bc)
![cosign](https://img.shields.io/badge/images-signed%20with%20cosign-2e7d32)
![Claude](https://img.shields.io/badge/failures%20explained%20by-Claude-d97757)

</div>

---

## Why

Starting a new service usually means a ticket for a repo, another for CI, another for a namespace,
and a week of waiting. Platform teams fix this with a *golden path*: one paved, approved way to go
from idea to production. Launchbay is that path, end to end, running on a single laptop.

## What a launch does

| # | Stage | What happens |
|---|---|---|
| 1 | **Validate** | Name is DNS-safe and unused, template exists, owner is set |
| 2 | **Repository** | A GitHub App creates the repo and renders the template into its first commit |
| 3 | **Cloud** | Terraform provisions the S3 bucket, SQS queue and DynamoDB table it asked for |
| 4 | **Build & sign** | The template's CI tests, scans with Trivy, builds, pushes to GHCR and signs with cosign |
| 5 | **GitOps** | A manifest for the service, with its resources' variables, is committed to `launchbay-gitops` |
| 6 | **Deploy** | An Argo CD ApplicationSet turns the manifest into an app in its own namespace |
| 7 | **Live** | The health check passes and the service gets its URL |

Every stage is stored and streamed to the portal over Server-Sent Events, so you watch the launch
happen: logs scroll in, the timeline fills, and the rocket flies.

## Highlights

- **Live mission view.** A streamed timeline, per-stage terminal and an animated trajectory, built
  with React, Motion and Tailwind CSS. Respects `prefers-reduced-motion`.
- **Retry and decommission.** A failed launch resumes at the stage that failed and keeps the ones
  that passed, following the newest commit so a pushed fix is picked up. Decommissioning removes
  the GitOps manifest (Argo CD prunes everything) and archives or deletes the repo, behind a
  type-the-name confirmation.
- **Guardrails, enforced.** Kyverno admits a workload only if its image is signed with cosign by
  *that service's own* CI on `main`, comes from `ghcr.io/launchbay-labs` with a pinned tag, runs
  non-root without privilege escalation or host access, and declares resources and health probes.
  The policies use Kyverno's CEL-based `ValidatingPolicy` and `ImageValidatingPolicy`; CI tests them
  with `kyverno test`, `scripts/verify-guardrails.sh` proves them on the live cluster, and a blocked
  deploy names the rule it broke.
- **Cloud resources with Terraform.** A service can ask for object storage (S3), a message queue
  (SQS, with a dead-letter queue) and a key-value table (DynamoDB). Launchbay applies one Terraform
  root per service, with its own state, through reusable modules: every resource is encrypted with
  a KMS key of the service's own, tagged with its owner, and handed to the service as environment
  variables through GitOps. Locally it all runs on [Moto](https://github.com/getmoto/moto), an
  open-source AWS emulator, inside the cluster; the same Terraform targets real AWS by leaving out
  the endpoint. The modules have mocked unit tests and an apply-and-destroy integration test in CI,
  and the API re-applies them on start, so a restarted emulator is repopulated.
- **Scorecards.** Every launched service is graded Gold, Silver, Bronze or "Needs work" on eleven
  weighted checks across ownership, delivery, security and reliability: CI green on main, Trivy
  scans clean, signed image admitted, Argo CD healthy, `/healthz` answering, a README, Dependabot,
  recent commits, encrypted cloud data. Facts come live from GitHub, Argo CD and the service itself;
  a check that can't be evaluated is skipped, never counted against the service.
- **Failed launches, explained.** One click on a failed launch pulls the evidence together (the
  stage log, the failed GitHub Actions job's log, Argo CD's status, the guardrails) and returns what
  went wrong, why, and the steps to fix it. With an Anthropic API key it asks Claude (Opus 5.5, with
  structured output and server-side refusal fallback); without one, built-in rules recognise the
  common failures (failing tests, a vulnerability, a guardrail denial, a Terraform error, a timeout).
  Explanations are stored with the launch, so each failure is explained once.
- **Provider architecture.** The launcher talks to the world only through providers. `GitHubProvider`
  does it for real; `DemoProvider` simulates every stage so the portal runs with no credentials.
- **GitHub App, not tokens.** Scoped permissions and short-lived installation tokens.
- **Supply chain built in.** Every template ships a pipeline with Trivy scans and keyless cosign
  signing; images are deployed by digest.
- **Golden-path templates.** Python (FastAPI), Node (Express) and a static site, each with tests,
  a non-root container and CI.

## Run it

You need Python 3.12 and Node 22.

```bash
# API (demo mode, no credentials needed)
cd services/api
python -m venv .venv && .venv/Scripts/activate   # source .venv/bin/activate on macOS/Linux
pip install -e ".[dev]"
uvicorn app.main:app --reload

# Portal, in a second terminal
cd apps/portal
npm install
npm run dev
```

To have Claude explain failed launches, save an Anthropic API key as `~/.launchbay/anthropic-api-key`
(or set `LAUNCHBAY_ANTHROPIC_API_KEY`). Without it, Launchbay explains failures with built-in rules.

Open http://localhost:5173 and launch a service. Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> for
the command palette.

## Run the platform

Real launches deploy to a Kubernetes cluster on your own machine. You need Docker (Docker Desktop on
WSL 2 on Windows), [kind](https://kind.sigs.k8s.io), kubectl and Helm, plus
[Terraform](https://developer.hashicorp.com/terraform/install) 1.17 for cloud resources.

```bash
./scripts/platform-up.sh
```

One command, safe to re-run. It creates a kind cluster, installs Traefik as the ingress controller,
the Moto AWS emulator and Kyverno with Launchbay's guardrails,
installs Argo CD (pinned and checksum-verified), and applies the ApplicationSet that watches
[launchbay-gitops](https://github.com/launchbay-labs/launchbay-gitops). It also mints a
**read-only** Argo CD API token for Launchbay and writes it to `services/api/.env` (git-ignored),
switching cloud resources from simulated to real Terraform when `terraform` is installed. Terraform
state lives in `~/.launchbay/cloud/<service>`, outside the repo.

| What | Where |
|---|---|
| Argo CD | http://argocd.localtest.me |
| Any launched service | http://&lt;name&gt;.localtest.me |
| AWS emulator (Moto) | http://aws.localtest.me |
| A service's view of its resources (Python template) | http://&lt;name&gt;.localtest.me/cloud |

Launched services push **private** images to GHCR. To let the cluster pull them, create a
[classic token with only `read:packages`](https://github.com/settings/tokens/new?scopes=read:packages&description=launchbay-ghcr-pull)
and save it as `~/.launchbay/ghcr-pull-token` before running the script. It is handed to the node's
kubelet and never stored in Git.

Check the guardrails against the live cluster at any time (server-side dry runs, nothing is created):

```bash
./scripts/verify-guardrails.sh
```

`localtest.me` is a public DNS name that always resolves to `127.0.0.1`, so every service gets a
real hostname with no hosts-file edits. Tear everything down with `kind delete cluster --name launchbay`.

```
 services/<name>.yaml ──► ApplicationSet ──► Application ──► namespace <name>
   (launchbay-gitops)      (git generator)    (charts/service)   Deployment · Service · Ingress · PDB
```

## Layout

| Path | What |
|---|---|
| `apps/portal` | React 19 + TypeScript portal |
| `services/api` | FastAPI API, launcher, providers, scorecards and the failure explainer |
| `templates/` | Golden-path templates rendered into new repos |
| `platform/` | kind, Traefik and Argo CD configuration, and the ApplicationSet |
| `platform/terraform/` | Terraform modules (bucket, queue, table) and the per-service root, with tests |
| `platform/cloud/` | The Moto AWS emulator, run in the cluster |
| `scripts/platform-up.sh` | Brings the whole platform up locally |
| `platform/kyverno/` | Guardrail policies and their `kyverno test` suite |
| `scripts/verify-guardrails.sh` | Proves the guardrails on the live cluster |
| `docs/architecture.md` | Design and roadmap |

## Roadmap

- [x] **Phase 1**: portal, launcher, templates, demo and GitHub providers
- [x] GitOps repo and Argo CD ApplicationSet on kind, behind Traefik
- [x] GitHub App on the `launchbay-labs` org: real launches, click to live URL in about 2.5 minutes
- [x] Retry from the failed stage and decommission (archive or delete) from the portal
- [x] **Phase 2**: Kyverno guardrails (CEL policies), signed-image enforcement, policy tests in CI
- [x] **Phase 3**: cloud resources (S3, SQS, DynamoDB) with Terraform, on a local AWS emulator
- [x] **Phase 4**: service scorecards and an AI helper (Claude) that explains failed launches
- [ ] **Phase 5**: polish, screenshots and a demo video
