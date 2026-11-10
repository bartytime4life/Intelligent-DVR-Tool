#!/usr/bin/env bash
# Open local backup/camera setup; nothing copies, connects or analyzes until Start in the app.
set -euo pipefail
task_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec bash "$task_root/scripts/run-linux.sh" --companion "$@"
