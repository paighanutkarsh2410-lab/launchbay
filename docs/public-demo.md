# The public demo

A Launchbay anyone can open in a browser, at no cost: the real portal and API, with every launch
simulated. It runs the API's **public demo mode** (`LAUNCHBAY_PUBLIC_DEMO=true`):

| | Real Launchbay | Public demo |
|---|---|---|
| Launches | GitHub repo, Terraform, CI, cosign, Argo CD | Every stage simulated, with realistic logs and timing |
| Starting data | Your services | A snapshot of a real Launchbay (`services/api/demo/snapshot.json`) |
| Seeded services | Yours to change | Read-only: no retry, decommission or new explanation |
| Failure explanations | Gemini, Claude or rules | Stored answers for seeded services, rules for new ones |
| Visitor launches | – | 3 an hour per visitor, 6 in flight at most, removed after 3 hours |

Nothing in demo mode can reach GitHub, a cluster, a cloud account or a paid model: the setting
overrides the provider, cloud and explainer, whatever else is configured.

## Where it runs

```
 browser ──► Cloudflare Pages (portal, static) ──► Render (API, Docker, free web service)
                                                      ▲
               GitHub Actions, every 10 minutes ──────┘ keeps it awake
```

- **Portal**: Cloudflare Pages, free, served from Cloudflare's edge, never sleeps.
- **API**: a free Render web service built from `services/api/Dockerfile` (`render.yaml`). Free
  services sleep after 15 idle minutes; the `Keep the demo warm` workflow pings it so visitors
  rarely wait, and the portal says "Waking up the demo server" when they do. Its database is
  SQLite in `/tmp`, reseeded from the snapshot whenever the service restarts.

## Set it up

1. **API on Render.** Sign in to [render.com](https://render.com) with GitHub, choose
   **New → Blueprint**, pick this repository and apply `render.yaml`. Note the service URL, for
   example `https://launchbay-demo-api.onrender.com`, and check `/api/info` says
   `"public_demo": true`.
2. **Portal on Cloudflare Pages.** In the Cloudflare dashboard, **Workers & Pages → Create →
   Pages → Connect to Git**, pick this repository, then set:
   - Project name: `launchbay` (gives `https://launchbay.pages.dev`)
   - Root directory: `apps/portal`
   - Build command: `npm ci && npm run build`, output directory: `dist`
   - Environment variables: `VITE_API_URL` = the Render URL, `NODE_VERSION` = `22`
3. **CORS.** If the Pages address is not `https://launchbay.pages.dev`, change
   `LAUNCHBAY_CORS_ORIGINS` in `render.yaml` (or in the Render dashboard) to match.
4. **Keep it warm.** In the GitHub repository, **Settings → Secrets and variables → Actions →
   Variables**, add `DEMO_API_URL` = the Render URL.

Both hosts redeploy on every push to `main`. GitHub pauses scheduled workflows in a repository
with no activity for 60 days; re-enable `Keep the demo warm` from the Actions tab if that happens.

## Refresh the snapshot

With your real Launchbay running locally:

```bash
cd services/api
python -m app.demo export http://localhost:8000 demo/snapshot.json
```

Check the file before committing it: it holds service names, launch logs and stored explanations.
Timestamps are moved up to the present when the demo seeds, so "2h ago" stays "2h ago".
