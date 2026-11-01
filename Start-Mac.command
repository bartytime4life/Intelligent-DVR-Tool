#!/bin/bash
# Foreground launch; no camera or analysis job starts automatically.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"
if ! command -v python3.12 >/dev/null; then
  echo 'Install Python 3.12 and Node.js 22 first; see docs/setup-macos.md.' >&2
  exit 1
fi
exec python3.12 -m edge.mac_setup "$@"
