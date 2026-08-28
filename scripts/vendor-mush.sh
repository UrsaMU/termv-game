#!/bin/bash
# Sync ursamu packages/mush → court/vendor/mush for local dev only.
# Never committed; prod always uses jsr:@ursamu/mush from deno.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC="${URSAMU_MUSH_SRC:-}"
if [ -z "$SRC" ]; then
  for cand in \
    "$HOME/github/ursamu/packages/mush" \
    "$HOME/src/ursamu/packages/mush" \
    "$(dirname "$ROOT")/ursamu/packages/mush"
  do
    if [ -f "$cand/mod.ts" ]; then
      SRC="$cand"
      break
    fi
  done
fi

if [ -z "${SRC:-}" ] || [ ! -f "$SRC/mod.ts" ]; then
  echo "usage: URSAMU_MUSH_SRC=/path/to/packages/mush bash scripts/vendor-mush.sh"
  echo "Could not find ursamu packages/mush."
  exit 1
fi

DST="$ROOT/vendor/mush"
mkdir -p "$DST"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  --exclude 'data' \
  "$SRC/" "$DST/"

VER="$(python3 -c "import json; print(json.load(open('$DST/deno.json'))['version'])" 2>/dev/null || echo '?')"
echo "vendor/mush synced from $SRC (version $VER)"
echo "Local runs will use vendor when present (COURT_VENDOR_MUSH=0 forces JSR)."
python3 "$ROOT/scripts/mk-local-config.py" || true
