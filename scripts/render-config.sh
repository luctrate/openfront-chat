#!/usr/bin/env bash
# Render config.prod.js from config.prod.js.template + .env values.
# Called by use.sh before it copies to the active config.js.
set -euo pipefail

cd "$(dirname "$0")/.."

TPL="config.prod.js.template"
OUT="config.prod.js"
ENV_FILE=".env"

if [ ! -f "$TPL" ]; then
  echo "missing $TPL" >&2; exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE — copy .env.example to .env and set WS_URL / SHARED_SECRET" >&2
  exit 1
fi

# Load .env variables.
# shellcheck disable=SC1091
set -a; . "./$ENV_FILE"; set +a

: "${WS_URL:?WS_URL not set in .env}"
: "${SHARED_SECRET:?SHARED_SECRET not set in .env}"

# Escape any '&' or '|' in the values so sed doesn't misinterpret them.
esc_url=$(printf '%s' "$WS_URL"        | sed 's/[&|]/\\&/g')
esc_sec=$(printf '%s' "$SHARED_SECRET" | sed 's/[&|]/\\&/g')

sed -e "s|__WS_URL__|$esc_url|g" -e "s|__SHARED_SECRET__|$esc_sec|g" "$TPL" > "$OUT"
echo "rendered $OUT (wsUrl=$WS_URL, secret=${SHARED_SECRET:0:4}…${SHARED_SECRET: -4})"
