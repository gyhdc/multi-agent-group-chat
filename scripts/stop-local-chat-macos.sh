#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_FILE="$ROOT/tmp/runtime.json"

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof was not found in PATH. Install it and try again." >&2
  exit 1
fi

get_runtime_pid() {
  local key="$1"

  if [ ! -f "$RUNTIME_FILE" ]; then
    return 0
  fi

  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$RUNTIME_FILE" | head -n 1
}

get_listening_pid() {
  local port="$1"
  lsof -n -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

stop_pid() {
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
    echo "Stopped process $pid"
  else
    echo "Process $pid is already gone or cannot be stopped"
  fi
}

seen_pids=" "

stop_once() {
  local pid="$1"

  if [ -z "$pid" ]; then
    return 0
  fi

  case "$seen_pids" in
    *" $pid "*) return 0 ;;
  esac

  seen_pids="${seen_pids}${pid} "
  stop_pid "$pid"
}

if [ ! -f "$RUNTIME_FILE" ]; then
  echo "No runtime record found. Checking ports 3030 and 5173 anyway."
fi

stop_once "$(get_runtime_pid backendPid)"
stop_once "$(get_runtime_pid frontendPid)"
stop_once "$(get_listening_pid 3030)"
stop_once "$(get_listening_pid 5173)"

rm -f "$RUNTIME_FILE"
echo "App instance stopped."
