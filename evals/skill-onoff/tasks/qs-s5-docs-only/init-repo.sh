#!/usr/bin/env bash
# init-repo.sh (qs-s5-docs-only) — base on develop, then the pre-committed diff on branch feature. cwd = the fixture repo (fixture_scripts already overlaid).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/../qs-common/build-fixture.sh"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
git checkout -q -b feature
printf "\nMore text.\n" >> docs/guide.md; printf "More.\n" >> README.md
git add -A && git commit -q -m "feature change" --no-verify
