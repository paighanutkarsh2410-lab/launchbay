#!/usr/bin/env bash
# Brings up the whole Launchbay platform on this machine:
#   kind cluster -> Traefik ingress -> AWS emulator -> Kyverno guardrails -> Argo CD -> ApplicationSet
# and writes Argo CD credentials for the API to services/api/.env.
#
# Usage: ./scripts/platform-up.sh [gitops-owner]
#   gitops-owner: GitHub user or org that owns launchbay-gitops (default: $LAUNCHBAY_GITOPS_OWNER,
#   then launchbay-labs). Runs in Git Bash on Windows, and on macOS or Linux.
# Re-running is safe: every step is idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="$ROOT/platform"
OWNER="${1:-${LAUNCHBAY_GITOPS_OWNER:-launchbay-labs}}"
# Container image paths are lowercase, whatever the organization's display case.
IMAGE_OWNER="$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')"
CLUSTER=launchbay
ARGOCD_URL=http://argocd.localtest.me

# Argo CD v3.5.7, pinned to the commit of its signed release tag and checked by SHA-256.
ARGOCD_VERSION=v3.5.7
ARGOCD_COMMIT=6d732962f61a99c2a0f221fd26b9aac7c83bcf18
ARGOCD_SHA256=09bfbb9041b4a8503c6e4fa22cf41c403fa62be17526de353648a4551f5beb77
TRAEFIK_CHART_VERSION=42.3.2
KYVERNO_CHART_VERSION=3.9.2  # Kyverno v1.19.2

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

for tool in docker kind kubectl helm curl; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. Install it and re-run." >&2; exit 1; }
done
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker Desktop and re-run." >&2; exit 1; }

step "Cluster"
if ! kind get clusters | grep -qx "$CLUSTER"; then
  kind create cluster --config "$PLATFORM/kind/cluster.yaml" --wait 120s
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

step "Registry access"
# Launched services push private images to GHCR. A classic token with only read:packages, kept
# outside the repo, is given to the node's kubelet so every namespace can pull them.
PULL_TOKEN_FILE="${LAUNCHBAY_GHCR_TOKEN_FILE:-$HOME/.launchbay/ghcr-pull-token}"
if [ -f "$PULL_TOKEN_FILE" ]; then
  PULL_USER="${LAUNCHBAY_GHCR_USER:-$(gh api user --jq .login 2>/dev/null || echo launchbay)}"
  AUTH="$(printf '%s:%s' "$PULL_USER" "$(tr -d '\r\n' < "$PULL_TOKEN_FILE")" | base64 | tr -d '\n')"
  NODE="$CLUSTER-control-plane"
  printf '{"auths":{"ghcr.io":{"auth":"%s"}}}' "$AUTH" \
    | docker exec -i "$NODE" sh -c 'umask 077 && cat > /var/lib/kubelet/config.json'
  docker exec "$NODE" systemctl restart kubelet
  echo "Kubelet can pull from ghcr.io (token from $PULL_TOKEN_FILE)"
else
  echo "No $PULL_TOKEN_FILE: private GHCR images will not pull. See README > Run the platform."
fi

step "Traefik ingress (chart $TRAEFIK_CHART_VERSION)"
helm repo add traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
helm repo update traefik >/dev/null
helm upgrade --install traefik traefik/traefik --version "$TRAEFIK_CHART_VERSION" \
  --namespace traefik --create-namespace -f "$PLATFORM/traefik/values.yaml" --wait --timeout 5m >/dev/null

step "AWS emulator (Moto) for cloud resources"
kubectl apply -f "$PLATFORM/cloud/moto.yaml" >/dev/null
kubectl -n launchbay-cloud rollout status deployment/moto --timeout=180s >/dev/null
echo "Moto is up at http://aws.localtest.me (in the cluster: moto.launchbay-cloud:5000)"

step "Kyverno $KYVERNO_CHART_VERSION and Launchbay's guardrails"
kubectl create namespace kyverno --dry-run=client -o yaml | kubectl apply -f - >/dev/null
if [ -f "$PULL_TOKEN_FILE" ]; then
  # Kyverno reads cosign signatures from the same private registry the services pull from.
  kubectl -n kyverno create secret docker-registry ghcr-pull --docker-server=ghcr.io \
    --docker-username="$PULL_USER" --docker-password="$(tr -d '\r\n' < "$PULL_TOKEN_FILE")" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi
helm repo add kyverno https://kyverno.github.io/kyverno >/dev/null 2>&1 || true
helm repo update kyverno >/dev/null
helm upgrade --install kyverno kyverno/kyverno --version "$KYVERNO_CHART_VERSION" \
  --namespace kyverno -f "$PLATFORM/kyverno/values.yaml" --wait --timeout 6m >/dev/null
# The policies name launchbay-labs; point them at this organization's images and CI instead.
for policy in "$PLATFORM"/kyverno/policies/*.yaml; do
  # The signer's identity keeps the organization's case; image paths are lowercase.
  sed -e "/subjectRegExp/s|launchbay-labs|$OWNER|g" -e "s|launchbay-labs|$IMAGE_OWNER|g" "$policy" \
    | kubectl apply -f - >/dev/null
done
echo "Guardrails admit only ghcr.io/$IMAGE_OWNER images, signed by $IMAGE_OWNER's own CI"
for policy in $(kubectl get validatingpolicies,imagevalidatingpolicies -o name); do
  kubectl wait --for=jsonpath='{.status.conditionStatus.ready}'=true "$policy" --timeout=120s >/dev/null
done
kubectl get validatingpolicies,imagevalidatingpolicies \
  -o custom-columns='POLICY:.metadata.name,KIND:.kind,ACTIONS:.spec.validationActions,READY:.status.conditionStatus.ready'

step "Argo CD $ARGOCD_VERSION"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL -o "$WORK/install.yaml" \
  "https://raw.githubusercontent.com/argoproj/argo-cd/$ARGOCD_COMMIT/manifests/install.yaml"
echo "$ARGOCD_SHA256  $WORK/install.yaml" | sha256sum --check --quiet
echo "Manifest verified"
cp "$PLATFORM/argocd/kustomization.yaml" "$PLATFORM/argocd/ingress.yaml" "$WORK/"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f - >/dev/null
# Server-side apply: some Argo CD CRDs are too large for client-side apply's annotation.
kubectl kustomize "$WORK" | kubectl apply --server-side --force-conflicts -f - >/dev/null
# Pick up the patched config maps on re-runs.
kubectl -n argocd rollout restart deployment argocd-server argocd-applicationset-controller >/dev/null
for d in argocd-server argocd-repo-server argocd-redis argocd-applicationset-controller; do
  kubectl -n argocd rollout status "deployment/$d" --timeout=300s >/dev/null
done
kubectl -n argocd rollout status statefulset/argocd-application-controller --timeout=300s >/dev/null
echo "Argo CD is up at $ARGOCD_URL"

step "ApplicationSet watching github.com/$OWNER/launchbay-gitops"
sed "s|GITOPS_OWNER|$OWNER|g" "$PLATFORM/argocd/applicationset.yaml" | kubectl apply -f - >/dev/null

step "API token for Launchbay"
PASSWORD="$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d)"
# The server was just restarted; retry until Traefik routes to a ready pod.
SESSION=""
for _ in $(seq 1 40); do
  if RESPONSE="$(curl -fsS "$ARGOCD_URL/api/v1/session" -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$PASSWORD\"}" 2>/dev/null)"; then
    SESSION="$(echo "$RESPONSE" | sed -E 's/.*"token":"([^"]+)".*/\1/')"
    break
  fi
  sleep 3
done
[ -n "$SESSION" ] || { echo "Could not sign in to Argo CD at $ARGOCD_URL" >&2; exit 1; }
TOKEN="$(curl -fsS -X POST "$ARGOCD_URL/api/v1/account/launchbay/token" \
  -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"launchbay-api"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')"

ENV_FILE="$ROOT/services/api/.env"
touch "$ENV_FILE"
grep -v '^LAUNCHBAY_ARGOCD_\|^LAUNCHBAY_CLOUD=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
{
  cat "$ENV_FILE.tmp"
  echo "LAUNCHBAY_ARGOCD_URL=$ARGOCD_URL"
  echo "LAUNCHBAY_ARGOCD_TOKEN=$TOKEN"
  # Real cloud resources need Terraform on this machine; without it they are simulated.
  if command -v terraform >/dev/null; then echo "LAUNCHBAY_CLOUD=emulator"; fi
} > "$ENV_FILE"
rm -f "$ENV_FILE.tmp"
chmod 600 "$ENV_FILE" 2>/dev/null || true
echo "Wrote Argo CD settings to services/api/.env (git-ignored)"

step "Ready"
cat <<EOF
  Argo CD UI     $ARGOCD_URL   (user: admin; password: run the command below)
                 kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
  Services       http://<service>.localtest.me
  AWS emulator   http://aws.localtest.me
  Tear down      kind delete cluster --name $CLUSTER
EOF
