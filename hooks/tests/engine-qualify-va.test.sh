#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# Needs bwrap (same requirement as engine-qualify-brain); the JS suite
# self-skips with a SKIP line when the sandbox runtime is unavailable.
OUT="$(node "$REPO_ROOT/scripts/engine-qualify-va.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "verification_author end-to-end suite passes"
if printf '%s' "$OUT" | grep -q '^SKIP:'; then
  assert_contains "$OUT" "SKIP:" "sandbox unavailable — suite self-skipped honestly"
else
  assert_contains "$OUT" "29 assertions passed" \
    "spec-only clause-reconstruction mock qualifies through the REAL sandbox; happy-path/over-strict/flood/lazy/malformed deviants fail on their exact subjects; broker+stub transport parity holds on every transport-independent surface; the literal bwrap allowlist is pinned; precondition aborts fire"
fi

finalize_test
