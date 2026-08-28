#!/bin/bash
export PATH="$HOME/.deno/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
PID_FILE=".ursamu.pid"
if [ ! -f "$PID_FILE" ]; then
  echo "UrsaMU: stopped (no PID file)."
  exit 1
fi
# shellcheck disable=SC1090
source "$PID_FILE"
echo "UrsaMU status:"
if kill -0 "${MAIN_PID:-}" 2>/dev/null; then
  echo "  Main server   : running  (PID: $MAIN_PID)"
else
  echo "  Main server   : stopped"
fi
if kill -0 "${TELNET_PID:-}" 2>/dev/null; then
  echo "  Telnet server : running  (PID: $TELNET_PID)"
else
  echo "  Telnet server : stopped"
fi
for port in 4201:telnet 4202:ws 4203:http; do
  p=${port%:*}; label=${port#*:}
  bound=$(lsof -ti ":$p" 2>/dev/null || true)
  if [ -n "$bound" ]; then
    printf "  %-8s :%s bound (pid %s)\n" "$label" "$p" "$bound"
  else
    printf "  %-8s :%s free\n" "$label" "$p"
  fi
done
