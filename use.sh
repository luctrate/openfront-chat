#!/usr/bin/env bash
# Swap the active manifest.json + config.js for a target build.
#   ./use.sh chrome        — production Chrome    (wss://relay.asp.now)
#   ./use.sh firefox       — production Firefox   (wss://relay.asp.now)
#   ./use.sh dev-chrome    — local dev, Chrome    (ws://localhost:8080)
#   ./use.sh dev-firefox   — local dev, Firefox   (ws://localhost:8080)
#   ./use.sh dev           — alias for dev-chrome
set -e
cd "$(dirname "$0")"

target="${1:-}"
# Normalize alias.
if [ "$target" = "dev" ]; then target="dev-chrome"; fi

case "$target" in
  chrome|firefox|dev-chrome|dev-firefox) ;;
  *) echo "usage: $0 chrome|firefox|dev-chrome|dev-firefox" >&2; exit 2 ;;
esac

manifest_src="manifest.${target}.json"
if [ ! -f "$manifest_src" ]; then
  echo "missing $manifest_src" >&2; exit 1
fi

# Config: any dev-* target uses config.dev.js; prod targets use config.prod.js,
# which is generated from config.prod.js.template + .env by render-config.sh.
case "$target" in
  dev-*)            config_src="config.dev.js" ;;
  *)                config_src="config.prod.js"
                    ./scripts/render-config.sh ;;
esac
if [ ! -f "$config_src" ]; then
  echo "missing $config_src" >&2; exit 1
fi

cp "$manifest_src" manifest.json
cp "$config_src"   config.js

wsUrl=$(sed -n 's/.*wsUrl:[[:space:]]*"\([^"]*\)".*/\1/p' config.js | head -1)
echo "active: $target"
echo "  manifest.json ← $manifest_src"
echo "  config.js     ← $config_src   (wsUrl: $wsUrl)"
