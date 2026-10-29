#!/usr/bin/env bash
# Explicit local launcher. No root, service installation, camera connection or host tuning.
set -euo pipefail
task_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$task_root"
task_python="${DVR_PYTHON:-python3.12}"
task_mode="${1:-run}"
case "$task_mode" in run|--install|--check|--analysis) ;; *) echo 'Use run-linux.sh [--install|--check|--analysis]' >&2; exit 2;; esac
command -v node >/dev/null || { echo 'Install Node.js 22 LTS first.' >&2; exit 1; }
test "$(node -p 'process.versions.node.split(".")[0]')" = 22 || { echo 'Use Node.js 22 for this checked setup.' >&2; exit 1; }
command -v "$task_python" >/dev/null || { echo 'Install Python 3.12 with venv support, or set DVR_PYTHON.' >&2; exit 1; }
"$task_python" -c 'import sys; assert sys.version_info[:2] == (3,12), "Use Python 3.12"'
if [ "$task_mode" = --check ]; then
  echo 'Node 22 and Python 3.12 detected. No installation or server start performed.'
  exit 0
fi
if [ "$task_mode" = --install ]; then
  npm ci
  if [ ! -d .venv ]; then "$task_python" -m venv .venv; fi
  .venv/bin/python -m pip install -r edge/requirements-test.txt
fi
test -f node_modules/vite/bin/vite.js || { echo 'Run bash scripts/run-linux.sh --install first.' >&2; exit 1; }
task_port="${DVR_PORT:-4173}"
[[ "$task_port" =~ ^[0-9]{1,5}$ ]] && ((task_port >= 1024 && task_port <= 65535)) || { echo 'DVR_PORT must be 1024–65535.' >&2; exit 2; }
npm run build
if [ "$task_mode" = --analysis ]; then
  test -n "${DVR_RECORDINGS:-}" && test -n "${DVR_ANALYSIS_CONFIG:-}" || { echo 'Set DVR_RECORDINGS and DVR_ANALYSIS_CONFIG to explicit local paths.' >&2; exit 2; }
  test -x .venv/bin/python || { echo 'Install the local edge environment first.' >&2; exit 1; }
  exec .venv/bin/python -m edge.local_service --recordings "$DVR_RECORDINGS" --config "$DVR_ANALYSIS_CONFIG" --port "$task_port"
fi
echo 'Opening a loopback preview only. Stop with Ctrl+C. Camera capture and analysis are separate.'
exec npm run preview -- --host 127.0.0.1 --port "$task_port" --strictPort
