#!/usr/bin/env bash
# Build submission zips for Chrome Web Store and Firefox Add-ons.
#
#   ./scripts/build-store.sh              # both
#   ./scripts/build-store.sh chrome       # just chrome
#   ./scripts/build-store.sh firefox      # just firefox
#
# Output: dist/openfront-team-chat-<target>-<version>.zip
set -euo pipefail

cd "$(dirname "$0")/.."
DIST="dist"
mkdir -p "$DIST"

TARGETS=("${@:-chrome firefox}")
if [ "$#" -eq 0 ]; then TARGETS=(chrome firefox); else TARGETS=("$@"); fi

VERSION=$(python3 -c "import json;print(json.load(open('manifest.chrome.json'))['version'])")

# Files that never ship.
EXCLUDE=(
  "manifest.chrome.json"
  "manifest.firefox.json"
  "manifest.dev-chrome.json"
  "manifest.dev-firefox.json"
  "manifest.json"
  "config.prod.js"
  "config.dev.js"
  "use.sh"
  "*.md"
  "scripts/*"
  "deploy/*"
  "relay-example/*"
  "icons/source.svg"
  "dist/*"
  ".git/*"
  ".DS_Store"
  "*/.DS_Store"
)

zip_excludes=()
for pat in "${EXCLUDE[@]}"; do zip_excludes+=("-x" "$pat"); done

for target in "${TARGETS[@]}"; do
  case "$target" in
    chrome|firefox) ;;
    *) echo "unknown target: $target (use chrome|firefox)" >&2; exit 2 ;;
  esac

  echo "==> building $target"
  ./use.sh "$target" >/dev/null   # set manifest.json + config.js to prod
  out="$DIST/openfront-team-chat-$target-$VERSION.zip"
  rm -f "$out"
  # Zip everything from the repo root except the exclusions.
  # NOTE: this bundles the active manifest.json (which use.sh just wrote) and
  # config.js. That's what the store expects.
  zip -qr "$out" . "${zip_excludes[@]}"
  echo "    wrote $out ($(du -h "$out" | cut -f1))"
done

echo
echo "done — zips are in $DIST/"
