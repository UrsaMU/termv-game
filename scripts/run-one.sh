#!/bin/bash
# Run a single Deno entry with court mush resolution (vendor local / JSR).
# usage: bash scripts/run-one.sh src/main.ts [--watch]
export PATH="$HOME/.deno/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
# shellcheck disable=SC1091
source "$(dirname "$0")/deno-env.sh"
court_deno_flags || exit 1
ENTRY="${1:?entry required}"
shift
deno run "${DENO_FLAGS[@]}" "$@" "$ENTRY"
