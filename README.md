<div align="center">

<img src="apps/portal/public/favicon.svg" width="72" alt="Launchbay logo" />

# Launchbay

**Ship a service in minutes, not tickets.**

A self-service internal developer platform. Pick a template, name your service, and Launchbay
creates the repo, runs a tested, scanned and signed pipeline, and lets Argo CD put it live.

[![CI](https://github.com/paighanutkarsh2410-lab/launchbay/actions/workflows/ci.yml/badge.svg)](https://github.com/paighanutkarsh2410-lab/launchbay/actions/workflows/ci.yml)
![FastAPI](https://img.shields.io/badge/API-FastAPI-009688)
![React](https://img.shields.io/badge/Portal-React%2019-61dafb)
![Argo CD](https://img.shields.io/badge/GitOps-Argo%20CD-ef7b4d)
![cosign](https://img.shields.io/badge/images-signed%20with%20cosign-2e7d32)

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
| 3 | **Build & sign** | The template's CI tests, scans with Trivy, builds, pushes to GHCR and signs with cosign |
| 4 | **GitOps** | A manifest for the service is committed to `launchbay-gitops` |
| 5 | **Deploy** | An Argo CD ApplicationSet turns the manifest into an app in its own namespace |
| 6 | **Live** | The health check passes and the service gets its URL |

Every stage is stored and streamed to the portal over Server-Sent Events, so you watch the launch
happen: logs scroll in, the timeline fills, and the rocket flies.

## Highlights

- **Live mission view.** A streamed timeline, per-stage terminal and an animated trajectory, built
  with React, Motion and Tailwind CSS. Respects `prefers-reduced-motion`.
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

Open http://localhost:5173 and launch a service. Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> for
the command palette.

## Layout

| Path | What |
|---|---|
| `apps/portal` | React 19 + TypeScript portal |
| `services/api` | FastAPI API, launcher and providers |
| `templates/` | Golden-path templates rendered into new repos |
| `docs/architecture.md` | Design and roadmap |

## Roadmap

- [x] **Phase 1**: portal, launcher, templates, demo and GitHub providers
- [ ] GitOps repo and Argo CD ApplicationSet on kind
- [ ] **Phase 2**: Kyverno guardrails, signed-image enforcement
- [ ] **Phase 3**: cloud resources with Terraform on LocalStack
- [ ] **Phase 4**: service scorecards and an AI helper that explains failed launches
