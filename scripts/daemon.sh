#!/bin/bash
export PATH="$HOME/.deno/bin:$PATH"
# Background daemon: telnet sidecar + main restart loop.
set -e
cd "$(dirname "$0")/.." || exit 1

PID_FILE=".ursamu.pid"
LOG_DIR="logs"
MAIN_LOG="$LOG_DIR/main.log"
TELNET_LOG="$LOG_DIR/telnet.log"
# shellcheck disable=SC1091
source "$(dirname "$0")/deno-env.sh"
court_deno_flags || exit 1

if [ -f "$PID_FILE" ]; then
  # shellcheck disable=SC1090
  source "$PID_FILE"
  if kill -0 "${MAIN_PID:-}" 2>/dev/null || \
     kill -0 "${TELNET_PID:-}" 2>/dev/null; then
    echo "Already running (main: ${MAIN_PID:-?}, telnet: ${TELNET_PID:-?})"
    echo "Run 'deno task stop' first."
    exit 1
  fi
fi

mkdir -p "$LOG_DIR"
chmod +x "$(dirname "$0")/main-loop.sh"

for port in 4201 4202 4203; do
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  # shellcheck disable=SC2086
  [ -n "$pids" ] && echo $pids | xargs kill -9 2>/dev/null || true
done

nohup deno run "${DENO_FLAGS[@]}" src/telnet.ts \
  >> "$TELNET_LOG" 2>&1 &
TELNET_PID=$!

MAIN_LOG="$MAIN_LOG" nohup bash "$(dirname "$0")/main-loop.sh" \
  >> /dev/null 2>&1 &
MAIN_PID=$!

printf "MAIN_PID=%s\nTELNET_PID=%s\n" \
  "$MAIN_PID" "$TELNET_PID" > "$PID_FILE"

echo ""
echo "UrsaMU daemon started."
echo "  Telnet  : port 4201  (PID: $TELNET_PID)  log: $TELNET_LOG"
echo "  Main    : WS 4202 / HTTP 4203  (loop PID: $MAIN_PID)"
echo "            log: $MAIN_LOG"
echo ""
echo "  deno task stop | restart | status | logs"
