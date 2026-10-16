#!/usr/bin/env bash
# init-repo.sh (qs-s3-hooks-json-full) — base on develop, then the pre-committed diff on branch feature. cwd = the fixture repo (fixture_scripts already overlaid).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/../qs-common/build-fixture.sh"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
git checkout -q -b feature
printf "{ \"hooks\": [ { \"event\": \"Stop\" } ] }\n" > hooks/hooks.json
git add -A && git commit -q -m "feature change" --no-verify
