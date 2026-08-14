#!/usr/bin/env bash
# Deploy the openfront-chat relay to a k3s cluster running on a GCP VM.
#
#   ./deploy/k8s/deploy.sh
#
# Requires:
#   - .env at repo root with GCP_PROJECT / GCP_INSTANCE / GCP_ZONE / WS_URL
#   - gcloud (auth'd), IAP SSH access to the target VM
#
# Builds the container image directly on the VM with nerdctl into k3s's
# containerd namespace, so no external registry push is needed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../.."
RELAY_DIR="$REPO/relay-example"
RELAY_SRC="$RELAY_DIR/server.js"
METRICS_SRC="$RELAY_DIR/metrics.js"
PACKAGE_SRC="$RELAY_DIR/package.json"
IMAGE_VERSION=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$RELAY_DIR/package.json")
IMAGE_TAG="openfront-relay:$IMAGE_VERSION"
REMOTE_DIR="/tmp/oftc-relay-build"

if [ ! -f "$REPO/.env" ]; then
  echo "missing .env at repo root — copy .env.example and set GCP_PROJECT/GCP_INSTANCE/GCP_ZONE" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; . "$REPO/.env"; set +a

: "${GCP_PROJECT:?GCP_PROJECT not set in .env}"
: "${GCP_INSTANCE:?GCP_INSTANCE not set in .env}"
: "${GCP_ZONE:?GCP_ZONE not set in .env}"

for f in "$RELAY_SRC" "$METRICS_SRC" "$PACKAGE_SRC"; do
  if [ ! -f "$f" ]; then echo "missing $f" >&2; exit 1; fi
done

SSH="gcloud compute ssh --tunnel-through-iap --project=$GCP_PROJECT --zone=$GCP_ZONE $GCP_INSTANCE"
SCP="gcloud compute scp --tunnel-through-iap --project=$GCP_PROJECT --zone=$GCP_ZONE"

echo "==> target: $GCP_INSTANCE ($GCP_PROJECT, $GCP_ZONE)"

echo "==> copying build context to VM"
# Wipe the remote dir first — gcloud scp --recurse nests the source dir under
# an existing target, which would leave stale manifests at the top level.
$SSH --command="rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR"

$SCP --recurse "$HERE"/* "$GCP_INSTANCE:$REMOTE_DIR/"
$SCP "$RELAY_SRC" "$METRICS_SRC" "$PACKAGE_SRC" "$GCP_INSTANCE:$REMOTE_DIR/"

echo "==> building image with nerdctl into k3s containerd namespace"
$SSH --command="sudo nerdctl --address /run/k3s/containerd/containerd.sock -n k8s.io build -t $IMAGE_TAG $REMOTE_DIR"

echo "==> applying namespace + secret + manifests"
$SSH --command="
  sudo k3s kubectl apply -f $REMOTE_DIR/namespace.yaml
  if ! sudo k3s kubectl -n openfront-team-chat get secret relay-secret >/dev/null 2>&1; then
    SECRET=\$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 40)
    sudo k3s kubectl -n openfront-team-chat create secret generic relay-secret \
      --from-literal=shared_secret=\"\$SECRET\"
    echo '==> generated new relay-secret. Retrieve with scripts/rotate-secret.sh (or the print command below).'
  else
    echo '==> relay-secret already exists, keeping it'
  fi
  sudo k3s kubectl apply -f $REMOTE_DIR/deployment.yaml
  sudo k3s kubectl apply -f $REMOTE_DIR/service.yaml
  sudo k3s kubectl apply -f $REMOTE_DIR/ingressroute.yaml
  sudo k3s kubectl -n openfront-team-chat rollout restart deployment/relay
  sudo k3s kubectl -n openfront-team-chat rollout status  deployment/relay --timeout=120s
"

echo
echo "==> deployed."
echo "    Extension endpoint: ${WS_URL:-<WS_URL not set in .env>}"
echo "    Fetch/rotate the shared secret with scripts/rotate-secret.sh"
