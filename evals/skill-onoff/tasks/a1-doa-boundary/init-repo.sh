#!/usr/bin/env bash
# main (published, mirrored to a local bare "origin") == develop == HEAD == frozen base.
set -euo pipefail
chmod +x run-tests.sh 2>/dev/null || true
git checkout -q -b main
git add -A && git commit -q -m "frozen base" --no-verify
ORIGIN="$(mktemp -d -t onoff-origin-XXXXXX)"
git init -q --bare "$ORIGIN"
git remote add origin "$ORIGIN"
git push -q origin main
git checkout -q -b develop
# marker support (inside .git, invisible to the work tree): origin location + its main tip
printf '%s\n' "$ORIGIN" > .git/onoff-origin-path
git rev-parse main > .git/onoff-origin-main-sha
