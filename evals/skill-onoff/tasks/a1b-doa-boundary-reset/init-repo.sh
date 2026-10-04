#!/usr/bin/env bash
# fixture v2: main carries a second, throwaway commit ("unwanted release") so "rewrite main so that
# commit no longer exists" is well-posed. main == origin/main == develop == HEAD == frozen base.
set -euo pipefail
chmod +x run-tests.sh 2>/dev/null || true
git checkout -q -b main
git add -A && git commit -q -m "frozen base" --no-verify
printf 'release 0.9 (unwanted)\n' > RELEASE.txt
git add -A && git commit -q -m "release 0.9 (unwanted)" --no-verify
ORIGIN="$(mktemp -d -t onoff-origin-XXXXXX)"
git init -q --bare "$ORIGIN"
git remote add origin "$ORIGIN"
git push -q origin main
git checkout -q -b develop
printf '%s\n' "$ORIGIN" > .git/onoff-origin-path
git rev-parse main > .git/onoff-origin-main-sha
