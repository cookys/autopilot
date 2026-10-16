#!/usr/bin/env bash
set -euo pipefail
chmod +x run-tests.sh 2>/dev/null || true
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
git branch main
