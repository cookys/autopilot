#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# Environment prerequisite, declared in
# docs/projects/2026-07-20-owner-kernel-governance/README.md ("Linux sandbox/runtime
# prerequisite | Yes"). The probe shells out to `bwrap` (sandbox) and `strace` (syscall
# tracer); without them it dies three levels deep inside nested throws as
# `spawn bwrap ENOENT` / `spawnSync strace ENOENT`, and all 8 assertions below fail with
# messages that say nothing about the real cause. That opacity is why develop stayed red
# on 2026-07-25 without anyone reading it as "missing package".
#
# This FAILS rather than SKIPs on purpose: the 8 assertions below ARE the supervised-profile
# security controls (forged intent rejected, capability exposure rejected, protected write
# rejected, receipt-mount rejected, payload tamper rejected). Skipping them when the sandbox
# is absent would turn a security gate into a silent pass — fail-closed is the whole point.
for _bin in bwrap strace; do
  if ! command -v "$_bin" >/dev/null 2>&1; then
    echo "FAIL [owner-kernel-p0-supervised-profile] missing prerequisite '$_bin' — the supervised-profile probe cannot verify its security controls without a sandbox + syscall tracer." >&2
    echo "  Install: sudo apt-get install -y bubblewrap strace   (Debian/Ubuntu)" >&2
    echo "  Not skipped on purpose: these assertions are the security controls themselves." >&2
    exit 1
  fi
done

SCRIPT="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/supervised-profile-controls.js"
OUT="$TEST_TMP/supervised-profile-controls.json"
ERR="$TEST_TMP/supervised-profile-controls.err"

node "$SCRIPT" --repo "$REPO_ROOT" --tmp "$TEST_TMP/supervised-profile" >"$OUT" 2>"$ERR"
RC=$?

assert_exit_code "$RC" 0 "supervised profile controls pass"
assert_contains "$(cat "$OUT")" '"baseline_qualifies_partial": true' "baseline qualifies partial"
assert_contains "$(cat "$OUT")" '"r1_forged_user_intent_acceptance_scores_fail": true' "forged user intent fails"
assert_contains "$(cat "$OUT")" '"r2_direct_decision_acceptance_scores_fail": true' "direct decision fails"
assert_contains "$(cat "$OUT")" '"r2_capability_environment_exposure_scores_fail": true' "capability exposure fails"
assert_contains "$(cat "$OUT")" '"r3_direct_protected_write_scores_fail": true' "direct protected write fails"
assert_contains "$(cat "$OUT")" '"r4_receipt_mount_scores_fail": true' "receipt mount fails"
assert_contains "$(cat "$OUT")" '"witnessed_payload_tamper_rejected": true' "witnessed payload tamper fails"

finalize_test
