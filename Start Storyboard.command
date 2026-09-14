#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/studio"

RUNTIME_BIN="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit((() => { const [major, minor] = process.versions.node.split(".").map(Number); return major > 22 || (major === 22 && minor >= 13) ? 0 : 1; })())' >/dev/null 2>&1; then
  if [ -x "$RUNTIME_BIN/node" ]; then
    export PATH="$RUNTIME_BIN:$PATH"
  else
    echo "Storyboard Studio needs Node.js 22 or newer. Install it, then open this file again."
    read -r -p "Press Return to close."
    exit 1
  fi
fi

if ! node scripts/launch.mjs; then
  echo
  read -r -p "Press Return to close."
  exit 1
fi
