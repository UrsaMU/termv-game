#!/bin/bash
# Sync ursamu packages/core → court/vendor/core for local / staged deploys.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC="${URSAMU_CORE_SRC:-}"
if [ -z "$SRC" ]; then
  for cand in \
    "$HOME/github/ursamu/packages/core" \
    "$HOME/src/ursamu/packages/core" \
    "$(dirname "$ROOT")/ursamu/packages/core"
  do
    if [ -f "$cand/mod.ts" ]; then
      SRC="$cand"
      break
    fi
  done
fi

if [ -z "${SRC:-}" ] || [ ! -f "$SRC/mod.ts" ]; then
  echo "usage: URSAMU_CORE_SRC=/path/to/packages/core bash scripts/vendor-core.sh"
  exit 1
fi

DST="$ROOT/vendor/core"
mkdir -p "$DST"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  "$SRC/" "$DST/"

VER="$(python3 -c "import json; print(json.load(open('$DST/deno.json'))['version'])" 2>/dev/null || echo '?')"
echo "vendor/core synced from $SRC (version $VER)"
python3 "$ROOT/scripts/mk-local-config.py" || true
