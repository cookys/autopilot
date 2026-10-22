#!/usr/bin/env bash
# hooks/tests/preflight-hook-matrix-advisory.test.sh — BL-0231: the 60-day staleness check of
# scripts/hook-harness-matrix.js --check is wired into scripts/preflight-release.sh as a
# non-blocking advisory, and the check itself warns (exit 0) on a row older than 60 days.
# RED at 6384c3753: preflight-release.sh did not mention hook-harness-matrix.js at all
#   (wiring pin below failed: "preflight-release.sh runs hook-harness-matrix.js --check").
. "$(dirname "$0")/lib.sh"

PREFLIGHT="$REPO_ROOT/scripts/preflight-release.sh"
MATRIX="$REPO_ROOT/scripts/hook-harness-matrix.js"

# 1. Wiring pin: preflight calls the check, as an advisory (not via run_check, so it never counts as a failure).
assert_contains "$(cat "$PREFLIGHT")" "hook-harness-matrix.js --check" "preflight-release.sh runs hook-harness-matrix.js --check"
assert_eq "$(grep -c 'run_check .*hook-harness-matrix' "$PREFLIGHT")" "0" "hook matrix staleness is advisory, not a counted run_check"

# 2. Negative control on the check itself: the one evidence row (2026-08-05) warns at 62 days, not at 59.
F="$TEST_TMP/fx"; mkdir -p "$F/hooks" "$F/platforms/codex/hooks" "$F/docs"
cp "$REPO_ROOT/hooks/hooks.json" "$F/hooks/hooks.json"
cp "$REPO_ROOT/platforms/codex/hooks/hooks.json" "$F/platforms/codex/hooks/hooks.json"
node - "$REPO_ROOT" "$F" <<'JS'
const fs = require('fs'); const [r, f] = process.argv.slice(2);
fs.writeFileSync(f + '/hooks/harness-support-evidence.json', JSON.stringify({ rows: [{ stem: 'post-compact', harness: 'codex', event: 'PostCompact', kind: 'packaged', verified_at: '2026-08-05', evidence: 'fixture' }] }));
JS
node "$MATRIX" --repo "$F" --write >/dev/null 2>&1
STALE=$(node "$MATRIX" --repo "$F" --check --today 2026-10-06 2>&1 >/dev/null); RC=$?
assert_exit_code "$RC" "0" "stale evidence row: --check still exits 0 (advisory)"
assert_contains "$STALE" "older than 60 days" "row older than 60 days warns"
FRESH=$(node "$MATRIX" --repo "$F" --check --today 2026-10-03 2>&1 >/dev/null)
assert_not_contains "$FRESH" "older than 60 days" "row 59 days old does not warn"

finalize_test
