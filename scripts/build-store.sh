#!/usr/bin/env bash
# Build submission zips for Chrome Web Store and Firefox Add-ons.
#
#   ./scripts/build-store.sh              # both
#   ./scripts/build-store.sh chrome       # just chrome
#   ./scripts/build-store.sh firefox      # just firefox
#
# Allowlist approach: assemble a clean staging tree with exactly the files
# the extension needs, then zip that. Anything not explicitly listed will
# NEVER end up in a shipped bundle — including .env, .git, screenshots, etc.
set -euo pipefail

cd "$(dirname "$0")/.."
DIST="dist"
STAGE_ROOT="$DIST/stage"
mkdir -p "$DIST"

if [ "$#" -eq 0 ]; then TARGETS=(chrome firefox); else TARGETS=("$@"); fi

VERSION=$(python3 -c "import json;print(json.load(open('manifest.chrome.json'))['version'])")

# The complete file set for a shipped bundle.
FILES=(
  manifest.json
  background.js
  content.js
  content.css
  config.js
  popup.html
  popup.js
  icons/16.png
  icons/32.png
  icons/48.png
  icons/128.png
)

for target in "${TARGETS[@]}"; do
  case "$target" in
    chrome|firefox) ;;
    *) echo "unknown target: $target (use chrome|firefox)" >&2; exit 2 ;;
  esac

  echo "==> building $target"
  # Render the prod config from .env and set the active manifest.json.
  ./use.sh "$target" >/dev/null

  # Verify each required file exists.
  for f in "${FILES[@]}"; do
    if [ ! -f "$f" ]; then echo "missing required file: $f" >&2; exit 1; fi
  done

  # Fresh staging dir.
  stage="$STAGE_ROOT/$target"
  rm -rf "$stage"
  mkdir -p "$stage"
  for f in "${FILES[@]}"; do
    mkdir -p "$stage/$(dirname "$f")"
    cp "$f" "$stage/$f"
  done

  # Sanity check: no secrets slipped in.
  if grep -RIn "SHARED_SECRET" "$stage" 2>/dev/null | grep -v "config.js" >/dev/null; then
    echo "aborting: SHARED_SECRET referenced outside config.js in staged bundle" >&2; exit 1
  fi

  out="$DIST/openfront-team-chat-$target-$VERSION.zip"
  rm -f "$out"
  out_abs="$PWD/$out"
  ( cd "$stage" && zip -qr "$out_abs" . )
  echo "    wrote $out ($(du -h "$out" | cut -f1))"
  echo "    contents:"
  unzip -Z1 "$out" | sort | awk '{ printf "      %s\n", $0 }'
done

rm -rf "$STAGE_ROOT"
echo
echo "done — zips are in $DIST/"
