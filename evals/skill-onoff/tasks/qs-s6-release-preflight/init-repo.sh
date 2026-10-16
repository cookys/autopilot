#!/usr/bin/env bash
# init-repo.sh (qs-s6-release-preflight) — base on develop, then the pre-committed diff on branch feature. cwd = the fixture repo (fixture_scripts already overlaid).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/../qs-common/build-fixture.sh"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
git checkout -q -b feature
printf "// tweak\nmodule.exports = { label: \"alpha-02\", v: 2 };\n" > scripts/lib/lib02.js
git add -A && git commit -q -m "feature change" --no-verify
