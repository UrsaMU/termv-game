#!/bin/bash
# Shared Deno flags for court run/daemon/main-loop.
#
# Local: if vendor/mush and/or vendor/core exist (and COURT_VENDOR_MUSH
#   != 0), build .deno.local.json that overrides those imports.
# Prod baseline: committed deno.json JSR pins only.
#
# COURT_VENDOR_MUSH=0  force JSR even if vendor trees are present
# COURT_VENDOR_MUSH=1  require vendor/mush (fail if missing)

court_deno_flags() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local flags=(
    --minimum-dependency-age=0
    --allow-all
    --node-modules-dir=auto
    --unstable-detect-cjs
    --unstable-kv
    --unstable-net
  )

  # Prod host sets COURT_VENDOR_MUSH=0 in gitignored .env so a
  # leftover vendor/mush tree cannot override JSR pins.
  if [ -z "${COURT_VENDOR_MUSH+x}" ] && [ -f "$root/.env" ]; then
    local env_line
    env_line="$(
      grep -E '^[[:space:]]*COURT_VENDOR_MUSH=' "$root/.env" \
        | tail -1 || true
    )"
    if [ -n "$env_line" ]; then
      COURT_VENDOR_MUSH="${env_line#*=}"
      COURT_VENDOR_MUSH="${COURT_VENDOR_MUSH//[$'\t\r\n \"']/}"
      export COURT_VENDOR_MUSH
    fi
  fi

  local mode="${COURT_VENDOR_MUSH:-auto}"
  local vendor_mush="$root/vendor/mush/mod.ts"
  local vendor_core="$root/vendor/core/mod.ts"
  local cfg="$root/deno.json"
  local local_cfg="$root/.deno.local.json"
  local has_vendor=0
  [ -f "$vendor_mush" ] || [ -f "$vendor_core" ] && has_vendor=1

  if [ "$mode" = "0" ]; then
    rm -f "$local_cfg"
    flags+=(--config="$cfg")
    echo "[court] imports: JSR (COURT_VENDOR_MUSH=0)" >&2
  elif [ "$has_vendor" = "1" ] && [ "$mode" != "0" ]; then
    if python3 "$root/scripts/mk-local-config.py"; then
      flags+=(--config="$local_cfg")
      echo "[court] imports: .deno.local.json (vendor)" >&2
    else
      flags+=(--config="$cfg")
      echo "[court] imports: JSR (vendor config failed)" >&2
    fi
  else
    rm -f "$local_cfg"
    if [ "$mode" = "1" ]; then
      echo "[court] ERROR: COURT_VENDOR_MUSH=1 but vendor/mush missing" >&2
      echo "  run: bash scripts/vendor-mush.sh" >&2
      return 1
    fi
    flags+=(--config="$cfg")
    echo "[court] imports: JSR (deno.json)" >&2
  fi

  # shellcheck disable=SC2034
  DENO_FLAGS=("${flags[@]}")
  # shellcheck disable=SC2034
  DENO_FLAGS_STR="${flags[*]}"
}
