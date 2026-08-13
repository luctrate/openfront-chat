#!/usr/bin/env bash
# Rotate the SHARED_SECRET used by the relay:
#   1. Generate a random secret.
#   2. Replace the Kubernetes Secret on the target VM.
#   3. Restart the relay deployment.
#   4. Write the new value into local .env so `./use.sh chrome` rebuilds
#      config.prod.js against it.
#
#   ./scripts/rotate-secret.sh              # rotate + print new secret
#   ./scripts/rotate-secret.sh --print-only # just print current server secret
#
# Requires .env with GCP_PROJECT / GCP_INSTANCE / GCP_ZONE.
set -euo pipefail

cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  echo "missing .env — copy .env.example and fill in" >&2; exit 1
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a
: "${GCP_PROJECT:?GCP_PROJECT not set in .env}"
: "${GCP_INSTANCE:?GCP_INSTANCE not set in .env}"
: "${GCP_ZONE:?GCP_ZONE not set in .env}"

SSH="gcloud compute ssh --tunnel-through-iap --project=$GCP_PROJECT --zone=$GCP_ZONE $GCP_INSTANCE"

if [ "${1:-}" = "--print-only" ]; then
  $SSH --command='sudo k3s kubectl -n openfront-team-chat get secret relay-secret -o jsonpath="{.data.shared_secret}" | base64 -d; echo'
  exit 0
fi

echo "==> rotating relay secret on $GCP_INSTANCE"
NEW_SECRET=$($SSH --command='
  sudo k3s kubectl -n openfront-team-chat delete secret relay-secret >/dev/null 2>&1 || true
  SECRET=$(head -c 32 /dev/urandom | base64 | tr -d "=+/" | head -c 40)
  sudo k3s kubectl -n openfront-team-chat create secret generic relay-secret \
    --from-literal=shared_secret="$SECRET" >/dev/null
  sudo k3s kubectl -n openfront-team-chat rollout restart deployment/relay >/dev/null
  sudo k3s kubectl -n openfront-team-chat rollout status deployment/relay --timeout=60s >/dev/null
  printf "%s" "$SECRET"
')

if [ -z "$NEW_SECRET" ]; then
  echo "failed to obtain new secret" >&2; exit 1
fi

# Update local .env: replace SHARED_SECRET=... with the new value.
tmp=$(mktemp)
awk -v s="$NEW_SECRET" '
  BEGIN { seen=0 }
  /^SHARED_SECRET=/ { print "SHARED_SECRET=" s; seen=1; next }
  { print }
  END { if (!seen) print "SHARED_SECRET=" s }
' .env > "$tmp" && mv "$tmp" .env

echo "==> rotated. new secret is in .env; re-render extension with:"
echo "    ./use.sh chrome     (or firefox)"
echo "    then reload the extension in your browser"
