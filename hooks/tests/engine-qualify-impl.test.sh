#!/usr/bin/env bash
# engine-qualify-impl — live-rail implementer qualification suite acceptance
# (plan 2026-08-22). Delegates to the Node harness; self-skips without bwrap.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
exec node "$REPO_ROOT/scripts/engine-qualify-impl.test.js"
