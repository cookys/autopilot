#!/usr/bin/env bash
# hooks/tests/qualification-sweep.test.sh — scripts/qualification-sweep.sh coverage.
#
# Covers --plan fully (including determinism) and the --execute usage/guard
# surface (refuses without --yes, spends nothing, creates no bundle). It does
# NOT and cannot exercise a real --execute run: that spends real money on real
# dispatches (see the script's own header HONESTY REQUIREMENT). Never invokes
# scripts/dispatch-hetero.sh or scripts/engine-qualify.js for real here.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/qualification-sweep.sh"

# --- fixture roster (2 seats) ---------------------------------------------
ROSTER="$TEST_TMP/roster.json"
cat > "$ROSTER" <<'EOF'
{
  "corpus": {
    "prompt_config_hash": "aaaa1111",
    "semantic_fingerprint": "bbbb2222",
    "containment_fingerprint": "cccc3333",
    "harness_version": "dispatch-hetero:deadbeef",
    "expires_days": 90
  },
  "evidence_root": "docs/plans/evidence/test-qualification-sweep-bundle",
  "role": "implementer",
  "seats": [
    { "slug": "seat-alpha", "runner": "cc-shim", "model": "claude-sonnet-5",
      "family": "anthropic", "version_source": "operator-asserted",
      "endpoint": "anthropic-native", "effort": "high" },
    { "slug": "seat-beta", "runner": "codex", "model": "gpt-5.6-sol",
      "family": "openai", "version_source": "operator-asserted",
      "endpoint": "-", "effort": "medium" }
  ]
}
EOF

# =====================================================================
# 1. --help exits 0 and names both modes
# =====================================================================
HELP_OUT="$("$SCRIPT" --help 2>&1)"
HELP_EXIT=$?
assert_exit_code "$HELP_EXIT" "0" "--help exit code"
assert_contains "$HELP_OUT" "--plan" "--help names --plan mode"
assert_contains "$HELP_OUT" "--execute" "--help names --execute mode"

# =====================================================================
# 2. Missing/malformed roster exits 1 and names the file
# =====================================================================
MISSING_ROSTER="$TEST_TMP/does-not-exist.json"
MISSING_OUT="$("$SCRIPT" --roster "$MISSING_ROSTER" --plan 2>&1)"
MISSING_EXIT=$?
assert_exit_code "$MISSING_EXIT" "1" "missing roster exit code"
assert_contains "$MISSING_OUT" "$MISSING_ROSTER" "missing-roster message names the file"

MALFORMED_ROSTER="$TEST_TMP/malformed.json"
echo '{ this is not json' > "$MALFORMED_ROSTER"
MALFORMED_OUT="$("$SCRIPT" --roster "$MALFORMED_ROSTER" --plan 2>&1)"
MALFORMED_EXIT=$?
assert_exit_code "$MALFORMED_EXIT" "1" "malformed roster exit code"
assert_contains "$MALFORMED_OUT" "$MALFORMED_ROSTER" "malformed-roster message names the file"

# =====================================================================
# 3. --plan over the 2-seat fixture roster: exit 0, contains resolved
#    engine-qualify.js commands per seat with model/runner/family/effort
#    and the roster's corpus hashes.
# =====================================================================
PLAN_OUT="$("$SCRIPT" --roster "$ROSTER" --plan 2>&1)"
PLAN_EXIT=$?
assert_exit_code "$PLAN_EXIT" "0" "--plan exit code"

assert_contains "$PLAN_OUT" "node scripts/engine-qualify.js implementer" "plan contains engine-qualify.js invocation"

# seat-alpha resolved fields
assert_contains "$PLAN_OUT" "seat-alpha" "plan names seat-alpha"
assert_contains "$PLAN_OUT" "--engine claude-sonnet-5" "plan resolves seat-alpha model"
assert_contains "$PLAN_OUT" "--runner cc-shim" "plan resolves seat-alpha runner"
assert_contains "$PLAN_OUT" "--family anthropic" "plan resolves seat-alpha family"
assert_contains "$PLAN_OUT" "--effort high" "plan resolves seat-alpha effort"

# seat-beta resolved fields
assert_contains "$PLAN_OUT" "seat-beta" "plan names seat-beta"
assert_contains "$PLAN_OUT" "--engine gpt-5.6-sol" "plan resolves seat-beta model"
assert_contains "$PLAN_OUT" "--runner codex" "plan resolves seat-beta runner"
assert_contains "$PLAN_OUT" "--family openai" "plan resolves seat-beta family"
assert_contains "$PLAN_OUT" "--effort medium" "plan resolves seat-beta effort"

# corpus hashes (both seats share the roster's corpus)
assert_contains "$PLAN_OUT" "--prompt-config-hash aaaa1111" "plan resolves prompt-config-hash"
assert_contains "$PLAN_OUT" "--semantic-fingerprint bbbb2222" "plan resolves semantic-fingerprint"
assert_contains "$PLAN_OUT" "--containment-fingerprint cccc3333" "plan resolves containment-fingerprint"
assert_contains "$PLAN_OUT" "--harness-version dispatch-hetero:deadbeef" "plan resolves harness-version"
assert_contains "$PLAN_OUT" "--expires-days 90" "plan resolves expires-days"

# scorecard record command also present
assert_contains "$PLAN_OUT" "node scripts/engine-scorecard.js record" "plan contains scorecard record invocation"

# =====================================================================
# 4. DETERMINISM: --plan run twice is byte-identical (no timestamp/PID/
#    tempdir-name leakage).
# =====================================================================
PLAN_FILE_1="$TEST_TMP/plan-1.txt"
PLAN_FILE_2="$TEST_TMP/plan-2.txt"
"$SCRIPT" --roster "$ROSTER" --plan > "$PLAN_FILE_1" 2>&1
"$SCRIPT" --roster "$ROSTER" --plan > "$PLAN_FILE_2" 2>&1
if cmp -s "$PLAN_FILE_1" "$PLAN_FILE_2"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "determinism: two --plan runs over the same roster differ"
fi

# =====================================================================
# 5. --execute WITHOUT --yes exits nonzero, spends nothing, creates no
#    evidence bundle directory.
# =====================================================================
EVIDENCE_BUNDLE_ROOT="$REPO_ROOT/docs/plans/evidence/test-qualification-sweep-bundle"
# Guard: this directory must not already exist in the repo (fixture hygiene).
assert_file_absent "$EVIDENCE_BUNDLE_ROOT" "evidence bundle root must not pre-exist"

NO_YES_OUT="$("$SCRIPT" --roster "$ROSTER" --execute 2>&1)"
NO_YES_EXIT=$?
if [ "$NO_YES_EXIT" -eq 0 ]; then
  fail "--execute without --yes: expected nonzero exit, got 0"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_contains "$NO_YES_OUT" "paid dispatches" "execute-without-yes prints the cost warning"
assert_contains "$NO_YES_OUT" "--yes" "execute-without-yes tells the operator to pass --yes"
assert_file_absent "$EVIDENCE_BUNDLE_ROOT" "no evidence bundle directory created without --yes"

# =====================================================================
# 6. Usage tooth: an unknown flag exits 2.
# =====================================================================
"$SCRIPT" --roster "$ROSTER" --plan --totally-bogus-flag > /dev/null 2>&1
assert_exit_code "$?" "2" "unknown flag exit code"

finalize_test
