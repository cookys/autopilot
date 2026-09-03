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
      "endpoint": "-", "effort": "medium" },
    { "slug": "seat-gamma", "runner": "opencode", "model": "opencode-go/x-1.0",
      "family": "meta", "version_source": "operator-asserted",
      "endpoint": "-", "effort": "high" }
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

# seat-gamma: a provider/model id — --engine keeps the "/", --model-version is the
# strict-TOKEN derivation ("/" -> ":"), version binary is opencode
assert_contains "$PLAN_OUT" "--engine opencode-go/x-1.0 --model opencode-go/x-1.0 --model-version opencode-go:x-1.0" "plan derives a TOKEN model-version for a provider/model id"
assert_contains "$PLAN_OUT" "version_binary: opencode" "plan resolves the opencode version binary"
assert_contains "$PLAN_OUT" "--engine gpt-5.6-sol --model gpt-5.6-sol --model-version gpt-5.6-sol" "a plain id is its own model-version (unchanged)"

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

# 7. Role fail-closed: the --execute cost warning (seats*25) and the hardcoded
#    scope tuple are BOTH implementer-shaped. A reviewer roster would understate
#    real money spent (that corpus is 42 cases, not 24), and the cost warning is
#    the only informed-consent gate before --yes. So a non-implementer role must
#    be refused outright rather than mis-quoted.
NON_IMPL_ROSTER="$TEST_TMP/roster-reviewer.json"
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  r.role = "reviewer";
  fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 2));
' "$ROSTER" "$NON_IMPL_ROSTER"
NON_IMPL_OUT=$("$SCRIPT" --roster "$NON_IMPL_ROSTER" --plan 2>&1)
NON_IMPL_EXIT=$?
assert_exit_code "$NON_IMPL_EXIT" "1" "a non-implementer roster role is refused (fail closed, not mis-quoted)"
assert_contains "$NON_IMPL_OUT" "implementer-only" "the refusal says why the sweep is implementer-only"
assert_not_contains "$NON_IMPL_OUT" "engine-qualify.js reviewer" "no reviewer plan is emitted"

# =====================================================================
# 8. VERSION-BINARY RESOLUTION (2026-08-27 incident). The sweep used to derive the
#    --version binary from the runner NAME, special-casing only cc-shim->claude. For
#    `runner: cursor` that runs the Cursor IDE launcher, whose stderr error sentence —
#    folded in by `2>&1` and merely character-sanitized — became the --runner-version
#    identity token of a real, paid administration.
#
#    --plan now prints the RESOLVED version binary per seat (map lookup only; no
#    --version is executed, so determinism above still holds). That is the free,
#    pre-spend check the incident lacked.
#
#    Deep-guard coverage of the refusal itself lives in hooks/tests/runner-binary.test.sh
#    (PATH stubs). It cannot live here: exercising run_seat's refusal needs --execute,
#    which the header forbids.
# =====================================================================
CURSOR_ROSTER="$TEST_TMP/roster-cursor.json"
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  r.seats = [{ slug: "seat-cursor", runner: "cursor", model: "grok-4.6-fast",
    family: "xai", version_source: "operator-asserted", endpoint: "-", effort: "high" }];
  fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 2));
' "$ROSTER" "$CURSOR_ROSTER"
CURSOR_PLAN="$("$SCRIPT" --roster "$CURSOR_ROSTER" --plan 2>&1)"
assert_exit_code "$?" "0" "--plan over a cursor seat exits 0"
assert_contains "$CURSOR_PLAN" "version_binary: cursor-agent" \
  "the cursor seat resolves its version binary to cursor-agent (the CLI), not cursor (the IDE launcher)"
assert_not_contains "$CURSOR_PLAN" "version_binary: cursor
" "plain 'cursor' is never named as the version binary"

# cc-shim keeps resolving to claude (the one mapping the old inline code got right).
assert_contains "$PLAN_OUT" "version_binary: claude" "the cc-shim seat resolves to claude"
assert_contains "$PLAN_OUT" "version_binary: codex" "the codex seat resolves to codex"

# The plan states the fail-closed posture so an operator reading it before spending
# knows an unusable --version costs nothing.
assert_contains "$PLAN_OUT" "UNCHARGED" "the plan states that an unusable --version refuses the seat uncharged"

# An UNMAPPED runner is announced as such rather than silently name-derived.
BOGUS_ROSTER="$TEST_TMP/roster-bogus-runner.json"
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  r.seats = [{ slug: "seat-bogus", runner: "not-a-real-runner", model: "m",
    family: "f", version_source: "operator-asserted", endpoint: "-", effort: "high" }];
  fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 2));
' "$ROSTER" "$BOGUS_ROSTER"
BOGUS_PLAN="$("$SCRIPT" --roster "$BOGUS_ROSTER" --plan 2>&1)"
assert_contains "$BOGUS_PLAN" "version_binary: UNMAPPED" \
  "an unmapped runner is announced as UNMAPPED, never name-derived"
assert_not_contains "$BOGUS_PLAN" "version_binary: not-a-real-runner" \
  "an unmapped runner's own name is never used as its version binary"

# The old name-derived derivation must be GONE from the script, not merely bypassed.
assert_not_contains "$(cat "$SCRIPT")" 'verbin="$runner"' \
  "the name-derived version binary (verbin=\$runner) is removed from the sweep"
# Comment lines are excluded: the header explains the old form on purpose, and the fix is
# that no EXECUTABLE line folds stderr into a version read any more.
assert_not_contains "$(grep -v '^[[:space:]]*#' "$SCRIPT")" '--version 2>&1' \
  "no stderr-folding --version read remains in the sweep's executable lines"

finalize_test
