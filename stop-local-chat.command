#!/usr/bin/env bash

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

bash "$ROOT/scripts/stop-local-chat-macos.sh" "$@"
status=$?

if [ "$status" -eq 0 ]; then
  exit 0
fi

echo
read -r -p "Stop failed. Press Enter to close..." _
exit "$status"
