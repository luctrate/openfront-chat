#!/usr/bin/env bash
# One-command public relay via Cloudflare's ephemeral quick tunnel.
# No Cloudflare account needed. URL rotates each run.
#
#   ./deploy/quick-tunnel.sh
#
# Starts the Node relay locally, tunnels it to a random *.trycloudflare.com URL,
# and prints the wss:// URL to paste into the extension popup.
set -euo pipefail

RELAY_DIR="$(cd "$(dirname "$0")/../relay-example" && pwd)"
PORT="${PORT:-8080}"

if ! command -v cloudflared >/dev/null; then
  echo "cloudflared not found on PATH" >&2; exit 1
fi
if ! command -v node >/dev/null; then
  echo "node not found on PATH" >&2; exit 1
fi

cd "$RELAY_DIR"
[ -d node_modules ] || npm install

# Start relay in background.
PORT="$PORT" node server.js &
RELAY_PID=$!
trap 'kill $RELAY_PID 2>/dev/null || true' EXIT

# Wait for it to be listening.
for _ in $(seq 1 20); do
  if lsof -i ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then break; fi
  sleep 0.2
done

echo
echo "===================================================================="
echo "Relay running on http://localhost:$PORT"
echo "Starting Cloudflare quick tunnel. Look for the trycloudflare.com URL"
echo "below — use it as wss://<that-host> in the extension popup."
echo "===================================================================="
echo

cloudflared tunnel --url "http://localhost:$PORT"
