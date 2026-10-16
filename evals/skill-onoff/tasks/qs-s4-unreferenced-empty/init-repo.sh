#!/usr/bin/env bash
# init-repo.sh (qs-s4-unreferenced-empty) — base on develop, then the pre-committed diff on branch feature. cwd = the fixture repo (fixture_scripts already overlaid).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/../qs-common/build-fixture.sh"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
git checkout -q -b feature
printf "console.log(\"orphan\");\n" > scripts/orphan.js
git add -A && git commit -q -m "feature change" --no-verify
