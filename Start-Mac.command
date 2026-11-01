#!/bin/bash
# Double-click to start Intelligent DVR on this Mac; close this window (or press Ctrl+C) to stop it.
# Serves the app on this computer only. No camera connects and no analysis runs until you choose them.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"
fail() { echo "$1"; read -r -p "Press Return to close."; exit 1; }
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing interface dependencies..."
  npm ci --ignore-scripts --no-audit --no-fund || fail "Dependency install failed."
fi
# Rebuild after updates too, so a pulled change never runs against an old interface build.
if [ ! -f dist/client/index.html ] || [ -n "$(find src public index.html vite.config.mjs package.json -newer dist/client/index.html -print -quit 2>/dev/null)" ]; then
  echo "Building the interface..."
  npm run build || fail "Build failed."
fi
if [ ! -x .venv/bin/python ] || [ ! -f local-analysis/catalog.json ]; then
  echo "Local analysis is not set up; starting the interface only."
  exec npm run preview -- --host 127.0.0.1 --port 4180 --strictPort --open
fi
[ -f local-feeds.json ] || (umask 077; printf '{"sources": []}\n' > local-feeds.json)
exec .venv/bin/python -m edge.local_service --feeds-config local-feeds.json \
  --recordings local-analysis/recordings --config local-analysis/catalog.json \
  --allow-recording-import --port 4180 --open-browser
