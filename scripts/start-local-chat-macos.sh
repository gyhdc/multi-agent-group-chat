#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/tmp"
RUNTIME_FILE="$RUNTIME_DIR/runtime.json"
LOG_DIR="$RUNTIME_DIR/logs"
BACKEND_STDOUT_LOG="$LOG_DIR/backend.stdout.log"
BACKEND_STDERR_LOG="$LOG_DIR/backend.stderr.log"
FRONTEND_STDOUT_LOG="$LOG_DIR/frontend.stdout.log"
FRONTEND_STDERR_LOG="$LOG_DIR/frontend.stderr.log"

BACKGROUND=0
SKIP_INSTALL=0

for arg in "$@"; do
  case "$arg" in
    --background)
      BACKGROUND=1
      ;;
    --skip-install)
      SKIP_INSTALL=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

require_command() {
  local name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    echo "$name was not found in PATH. Install it and try again." >&2
    exit 1
  fi
}

is_port_open() {
  local port="$1"
  lsof -n -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

get_listening_pid() {
  local port="$1"
  lsof -n -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

wait_for_port() {
  local port="$1"
  local timeout_seconds="${2:-120}"
  local i

  for ((i = 0; i < timeout_seconds; i += 1)); do
    if is_port_open "$port"; then
      return 0
    fi
    sleep 1
  done

  return 1
}

terminate_pid() {
  local pid="$1"

  if [ -z "$pid" ]; then
    return 0
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
}

open_browser() {
  open "http://127.0.0.1:5173" >/dev/null 2>&1 || true
}

cd "$ROOT"
mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

require_command npm
require_command lsof
require_command open

if is_port_open 3030 && is_port_open 5173; then
  if [ "$BACKGROUND" -eq 0 ]; then
    open_browser
    echo "App is already running. Browser opened."
  else
    echo "App is already running."
  fi
  exit 0
fi

if is_port_open 3030 || is_port_open 5173; then
  echo "Port 3030 or 5173 is already occupied, but the app is not fully running." >&2
  exit 1
fi

if [ "$SKIP_INSTALL" -eq 0 ] && [ ! -d "$ROOT/node_modules" ]; then
  npm install
fi

nohup npm run dev:backend >"$BACKEND_STDOUT_LOG" 2>"$BACKEND_STDERR_LOG" < /dev/null &
backend_launcher_pid=$!

nohup npm run dev:frontend >"$FRONTEND_STDOUT_LOG" 2>"$FRONTEND_STDERR_LOG" < /dev/null &
frontend_launcher_pid=$!

if ! wait_for_port 3030 120 || ! wait_for_port 5173 120; then
  terminate_pid "$backend_launcher_pid"
  terminate_pid "$frontend_launcher_pid"
  echo "Startup timeout: frontend or backend did not become ready in time. Check tmp/logs/backend.stderr.log and tmp/logs/frontend.stderr.log." >&2
  exit 1
fi

backend_pid="$(get_listening_pid 3030)"
frontend_pid="$(get_listening_pid 5173)"

cat >"$RUNTIME_FILE" <<EOF
{
  "platform": "macos",
  "backendPid": ${backend_pid:-0},
  "frontendPid": ${frontend_pid:-0},
  "startedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

if [ "$BACKGROUND" -eq 0 ]; then
  open_browser
fi

echo "App started."
echo "Frontend: http://127.0.0.1:5173"
echo "Backend: http://127.0.0.1:3030"
