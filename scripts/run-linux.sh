#!/usr/bin/env bash
# Foreground, unprivileged PC setup; no automatic camera activation.
set -euo pipefail
task_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$task_root"
task_python="${DVR_PYTHON:-python3.12}"
command -v "$task_python" >/dev/null || { echo 'Install 64-bit Python 3.12 with venv support, or set DVR_PYTHON.' >&2; exit 1; }
if [ "${1:-}" = run ]; then shift; fi
exec "$task_python" -m edge.pc_setup "$@"
