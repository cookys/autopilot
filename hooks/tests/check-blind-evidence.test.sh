#!/usr/bin/env bash
# Red-case coverage for scripts/check-blind-evidence.sh (four-layer D2 / KR1).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-blind-evidence.sh"
chmod +x "$SCRIPT" 2>/dev/null || true

# ── Red case: seeded implementer narrative MUST fail ──
SEEDED="$TEST_TMP/seeded-narrative-spec.md"
cat > "$SEEDED" <<'EOF'
# Review spec
Review the attached diff for correctness.
I have implemented the retry logic and fixed the race condition.
The implementation is correct and production-ready.
All tests pass.
EOF
OUT="$(bash "$SCRIPT" --payload "$SEEDED" --json 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "seeded narrative payload fails closed"
assert_contains "$OUT" '"class": "C1"' "first-person completion claim detected"
assert_contains "$OUT" '"class": "C2"' "self-assessed quality detected"
assert_contains "$OUT" '"class": "C3"' "unreceipted test assertion detected"

# ── Receipt-bound claims are evidence, not narrative ──
BOUND="$TEST_TMP/bound-claims-spec.md"
cat > "$BOUND" <<'EOF'
# Review spec
Obligation: all tests pass — receipt: /tmp/run-evidence/suite.log (exit code 0)
EOF
OUT="$(bash "$SCRIPT" --payload "$BOUND" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "receipt-bound test claim passes (bound claims are evidence)"

# ── Clean case: a PINNED REAL historical spec passes ──
REAL="$REPO_ROOT/docs/plans/2026-08-14-strict-l5-policy-refresh.md"
OUT="$(bash "$SCRIPT" --payload "$REAL" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "real historical spec doc passes clean (false-positive guard)"

# ── Structural guard: dispatch-review.sh exposes NO implementer-narrative input channel ──
# The rail's only payload inputs are --diff-file and --spec-file (dispatcher-authored).
# A future flag like --implementer-summary would open the laundering channel this linter
# guards; this assertion forces that change to confront the blind-evidence rule.
CHANNELS="$(grep -oE -- '--[a-z-]*(summary|narrative|notes|report)[a-z-]*' "$REPO_ROOT/scripts/dispatch-review.sh" | sort -u || true)"
assert_eq "" "$CHANNELS" "dispatch-review.sh has no implementer-narrative input channel"

# ── Disjointness from the controller-direction gate ──
# check-dispatch-suppression.sh guards controller→reviewer coaching; its patterns must not
# be re-implemented here (no second canonical statement).
OUT="$(bash "$SCRIPT" --payload "$REPO_ROOT/scripts/check-dispatch-suppression.sh" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "suppression-gate source itself is not flagged (directions are disjoint)"

finalize_test
