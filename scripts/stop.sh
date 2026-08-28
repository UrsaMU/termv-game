#!/bin/bash
export PATH="$HOME/.deno/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
PID_FILE=".ursamu.pid"
DENO_PID_FILE=".ursamu-deno.pid"
if [ ! -f "$PID_FILE" ]; then
  echo "UrsaMU is not running (no PID file)."
  exit 0
fi
# shellcheck disable=SC1090
source "$PID_FILE"
echo "Stopping UrsaMU..."
[ -n "${MAIN_PID:-}" ] && kill "$MAIN_PID" 2>/dev/null \
  && echo "  Stopped main loop (PID: $MAIN_PID)" || true
if [ -f "$DENO_PID_FILE" ]; then
  kill "$(cat "$DENO_PID_FILE")" 2>/dev/null || true
  rm -f "$DENO_PID_FILE"
fi
[ -n "${TELNET_PID:-}" ] && kill "$TELNET_PID" 2>/dev/null \
  && echo "  Stopped telnet (PID: $TELNET_PID)" || true
rm -f "$PID_FILE"
for port in 4201 4202 4203; do
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  # shellcheck disable=SC2086
  [ -n "$pids" ] && echo $pids | xargs kill -9 2>/dev/null || true
done
echo "Done."
