#!/bin/bash
export PATH="$HOME/.deno/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
PID_FILE=".ursamu.pid"
DENO_PID_FILE=".ursamu-deno.pid"
LOG_DIR="logs"
MAIN_LOG="$LOG_DIR/main.log"
if [ ! -f "$PID_FILE" ]; then
  echo "Not running. Use 'deno task daemon' to start."
  exit 1
fi
# shellcheck disable=SC1090
source "$PID_FILE"
[ -n "${MAIN_PID:-}" ] && kill "$MAIN_PID" 2>/dev/null || true
sleep 1
if [ -f "$DENO_PID_FILE" ]; then
  kill "$(cat "$DENO_PID_FILE")" 2>/dev/null || true
  rm -f "$DENO_PID_FILE"
fi
mkdir -p "$LOG_DIR"
chmod +x "$(dirname "$0")/main-loop.sh"
MAIN_LOG="$MAIN_LOG" nohup bash "$(dirname "$0")/main-loop.sh" \
  >> /dev/null 2>&1 &
MAIN_PID=$!
printf "MAIN_PID=%s\nTELNET_PID=%s\n" \
  "$MAIN_PID" "${TELNET_PID:-}" > "$PID_FILE"
echo "Main restarted (loop PID: $MAIN_PID). Telnet untouched."
