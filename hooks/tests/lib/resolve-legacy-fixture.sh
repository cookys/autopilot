#!/usr/bin/env bash
# Test shim: runs the real scripts/resolve-review-loop.sh, but a legacy full-copy config given through
# REVIEW_LOOP_CONFIG_OVERRIDE is split into a fixture roster + empty repo stub first (see roster-fixture.js).
exec node "$(dirname "$0")/roster-fixture.js" run "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/resolve-review-loop.sh" "$@"
