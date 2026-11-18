# Run your own Launchbay

Launchbay runs entirely on your machine, with your own GitHub organization: a kind cluster in
Docker holds Argo CD, Kyverno, Traefik and the AWS emulator; the API and portal run next to it.
Your keys stay in `~/.launchbay`, never in the repository and never on anyone else's server.

## 1. Install the tools

| Tool | Why |
|---|---|
| [Docker](https://docs.docker.com/get-docker/) (Docker Desktop with WSL 2 on Windows) | Runs the cluster |
| [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation), [kubectl](https://kubernetes.io/docs/tasks/tools/), [Helm](https://helm.sh/docs/intro/install/) | Create and configure it |
| [Python 3.12+](https://www.python.org/downloads/), [Node 22+](https://nodejs.org/) | The API and the portal |
| [Terraform](https://developer.hashicorp.com/terraform/install) (optional) | Real cloud resources on the AWS emulator; simulated without it |

You also need a **GitHub organization** to launch services into. A free one works:
[create one](https://github.com/account/organizations/new). (A GitHub App can create repositories
in an organization, not in a personal account.)

## 2. Start it

```bash
./launchbay up --org <your-org>
```

On Windows, run it from Git Bash. It checks the tools, then:

1. creates the `launchbay` kind cluster with Traefik, the AWS emulator, Kyverno and Argo CD, and
   points the guardrails at `ghcr.io/<your-org>` images signed by your organization's CI,
2. installs the API and builds the portal,
3. starts Launchbay at **http://localhost:8000** and opens the setup page.

The first run takes a few minutes; later runs are quick (every step is safe to repeat).

## 3. Connect GitHub

On the setup page, check the organization and click **Connect GitHub**:

1. GitHub shows a pre-filled *Create GitHub App* page for your organization. The App asks only for
   what Launchbay uses: create and archive repositories, write their contents and CI workflow, and
   read CI results. It has no webhooks. Click **Create**.
2. Launchbay receives the App's key from GitHub and saves it as
   `~/.launchbay/github-app-<name>.pem`; GitHub then asks you to **install** the App on the
   organization.
3. After the install, Launchbay creates `<your-org>/launchbay-gitops` (public, so Argo CD can read
   it) from `platform/gitops`, and switches from demo mode to real launches.

Nobody copies an App id or a key by hand, and the setup routes only answer requests from your own
machine.

## 4. Optional extras

The setup page shows each of these:

- **Private images.** Launched services push private images to GHCR. Create a
  [classic token with only `read:packages`](https://github.com/settings/tokens/new?scopes=read:packages&description=launchbay-ghcr-pull),
  save it as `~/.launchbay/ghcr-pull-token` and run `./launchbay up` again; the cluster's nodes get
  it, and Git never does.
- **AI explanations of failed launches.** Save a free [Gemini](https://aistudio.google.com) key as
  `~/.launchbay/gemini-api-key` or an Anthropic key as `~/.launchbay/anthropic-api-key`, then
  `./launchbay up` again. Without one, built-in rules explain failures.
- **Cloud resources.** Install Terraform and run `./launchbay up` again.

## Day to day

| Command | What it does |
|---|---|
| `./launchbay up` | Start (or restart) Launchbay; the organization is remembered |
| `./launchbay up --skip-platform` | Restart only the API and portal |
| `./launchbay status` | Whether it's running, its mode, and the cluster |
| `./launchbay logs` | Follow the API's log |
| `./launchbay down` | Stop Launchbay; the cluster and your services keep running |

`--port` runs it on another port. Argo CD is at http://argocd.localtest.me, each service at
http://&lt;name&gt;.localtest.me (`localtest.me` always resolves to your own machine).

## Remove it

1. `./launchbay down` and `kind delete cluster --name launchbay`
2. On GitHub, delete the App (*Organization settings → Developer settings → GitHub Apps*) and, if
   you like, the `launchbay-gitops` and service repositories
3. Delete `~/.launchbay` and `services/api/.env`
