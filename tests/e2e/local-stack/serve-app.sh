#!/usr/bin/env bash
# Builds the app against the local stack and serves it on :3100 for the end-to-end tests.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
STACK_DIR="${STACK_DIR:?set STACK_DIR}"
cd "$REPO"
cp "$STACK_DIR/app.env" .env.local
fuser -k 3100/tcp > /dev/null 2>&1 || true; sleep 1
npx next build > "$STACK_DIR/build.log" 2>&1
nohup npx next start -p 3100 -H 127.0.0.1 > "$STACK_DIR/app.log" 2>&1 &
for _ in $(seq 1 30); do curl -sf http://127.0.0.1:3100/api/health > /dev/null && exit 0; sleep 0.5; done
echo "app did not start; see $STACK_DIR/app.log" >&2; exit 1
