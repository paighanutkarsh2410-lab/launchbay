#!/usr/bin/env bash
# Proves Launchbay's guardrails on the live cluster. Each case is sent to the API server with
# server-side dry-run, so Kyverno's admission webhooks really evaluate it but nothing is created.
#
# Usage: ./scripts/verify-guardrails.sh [namespace]
#   namespace: a launched service's namespace (default: the first one labeled launchbay.dev/managed)
set -uo pipefail

NS="${1:-$(kubectl get ns -l launchbay.dev/managed=true -o jsonpath='{.items[0].metadata.name}')}"
[ -n "$NS" ] || { echo "No launched namespace found." >&2; exit 1; }
# A real, signed image from that service's own deployment.
SIGNED="$(kubectl -n "$NS" get deploy "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}')"
REPO="${SIGNED%:*}"
PASS=0
FAIL=0

# Prints a Deployment that passes every rule unless one of the arguments breaks it.
deployment() {
  local image="$1" pod_security="$2" container_security="$3" probes="$4"
  cat <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: guardrail-check, namespace: $NS }
spec:
  selector: { matchLabels: { app: guardrail-check } }
  template:
    metadata: { labels: { app: guardrail-check } }
    spec:
      securityContext: $pod_security
      containers:
        - name: app
          image: $image
          securityContext: $container_security
          resources: { requests: { cpu: 10m, memory: 32Mi }, limits: { memory: 64Mi } }
$probes
EOF
}

GOOD_POD='{ runAsNonRoot: true, runAsUser: 10001 }'
GOOD_CONTAINER='{ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: [ALL] } }'
GOOD_PROBES='          readinessProbe: { httpGet: { path: /healthz, port: 8080 } }
          livenessProbe: { httpGet: { path: /healthz, port: 8080 } }'

expect() {
  local want="$1" title="$2" manifest="$3" output code
  output="$(echo "$manifest" | kubectl apply --dry-run=server -f - 2>&1)"
  code=$?
  if [ "$want" = allow ] && [ "$code" -eq 0 ]; then
    printf '  \033[32m✔ allowed\033[0m  %s\n' "$title"; PASS=$((PASS + 1))
  elif [ "$want" = deny ] && grep -q "denied" <<<"$output"; then
    reason="$(sed -E 's/.*denied the request: //; s/Policy [a-z-]+ (failed|error): //g' <<<"$output" | cut -c1-110)"
    printf '  \033[32m✔ denied\033[0m   %s\n             \033[2m%s\033[0m\n' "$title" "$reason"; PASS=$((PASS + 1))
  else
    printf '  \033[31m✘ expected %s\033[0m %s\n%s\n' "$want" "$title" "$output"; FAIL=$((FAIL + 1))
  fi
}

echo "Guardrails in namespace $NS (signed image: $SIGNED)"
expect allow "signed launchbay image, hardened, with probes" \
  "$(deployment "$SIGNED" "$GOOD_POD" "$GOOD_CONTAINER" "$GOOD_PROBES")"
expect deny "image from another registry" \
  "$(deployment "nginx:1.27" "$GOOD_POD" "$GOOD_CONTAINER" "$GOOD_PROBES")"
expect deny "launchbay image with no signature to verify" \
  "$(deployment "$REPO:0000000000000000000000000000000000000000" "$GOOD_POD" "$GOOD_CONTAINER" "$GOOD_PROBES")"
expect deny ":latest tag" \
  "$(deployment "$REPO:latest" "$GOOD_POD" "$GOOD_CONTAINER" "$GOOD_PROBES")"
expect deny "pod without runAsNonRoot" \
  "$(deployment "$SIGNED" '{}' "$GOOD_CONTAINER" "$GOOD_PROBES")"
expect deny "privileged container" \
  "$(deployment "$SIGNED" "$GOOD_POD" '{ privileged: true, allowPrivilegeEscalation: true }' "$GOOD_PROBES")"
expect deny "writable root filesystem" \
  "$(deployment "$SIGNED" "$GOOD_POD" '{ allowPrivilegeEscalation: false, capabilities: { drop: [ALL] } }' "$GOOD_PROBES")"
expect deny "container without health probes" \
  "$(deployment "$SIGNED" "$GOOD_POD" "$GOOD_CONTAINER" "")"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
