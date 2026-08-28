#!/usr/bin/env bash
# dispatch-discuss.test.sh — D9 acceptance surface (plan
# docs/plans/2026-08-28-consult-discuss-qualification.md, D9).
#
# scripts/dispatch-discuss.js is the executable decision point: switch
# resolution (discuss_dispatch, via the REAL resolve-review-loop.sh) and
# dispatch invocation (via a stubbed scripts/dispatch-author.sh, the
# documented --dispatch-author-bin test seam) both happen inside it.
#
# Covers: bundle-schema rejection, switch-off refusal (zero transport
# spawns), resolver-denial propagation (D7 gate), the end-to-end configured-
# tuple argv proof through the real resolver + a stubbed dispatch-author.sh,
# rail non-zero-exit / empty-output fail-closed propagation, axis_id
# cardinality cases, claim_vector binding cases, unresolvable-anchor
# rejection, risk-vocabulary conformance, the no-verdict guard, the round_id
# round-trip, and the think-tank single call-site grep assertion.
. "$(dirname "$0")/lib.sh"

unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR
unset AUTOPILOT_QUALIFICATION_OVERRIDE
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
export ENGINE_SCORECARD_DIR="$TEST_TMP/engine-scorecard"
mkdir -p "$ENGINE_CAPABILITY_DIR" "$ENGINE_SCORECARD_DIR"

SCRIPT="$REPO_ROOT/scripts/dispatch-discuss.js"
RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"

# ── stub dispatch-author.sh: records argv, returns a configurable result ───
AUTHOR_STUB="$TEST_TMP/dispatch-author-stub.sh"
AUTHOR_ARGV_FILE="$TEST_TMP/author-argv.txt"
AUTHOR_SENTINEL="$TEST_TMP/author-was-invoked"
cat > "$AUTHOR_STUB" <<'EOF'
#!/usr/bin/env bash
touch "$STUB_SENTINEL"
printf '%s\n' "$@" > "$STUB_ARGV_FILE"
RAW_LOG="$STUB_TMP/raw_log_$$_$RANDOM.txt"
printf '%s' "${STUB_RAW_CONTENT:-}" > "$RAW_LOG"
status="${STUB_STATUS:-authored}"
exitcode="${STUB_EXIT:-0}"
printf '{ "runner": "stub", "model": "stub", "status": "%s", "raw_log": "%s", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n' \
  "$status" "$RAW_LOG"
exit "$exitcode"
EOF
chmod +x "$AUTHOR_STUB"

# A "must never be spawned" shadow — any invocation is a hard test failure.
AUTHOR_EXIT99="$TEST_TMP/dispatch-author-exit99.sh"
cat > "$AUTHOR_EXIT99" <<'EOF'
#!/usr/bin/env bash
echo "FATAL: dispatch-author.sh was spawned when it must not have been" >&2
exit 99
EOF
chmod +x "$AUTHOR_EXIT99"

reset_author_stub() {
  rm -f "$AUTHOR_ARGV_FILE" "$AUTHOR_SENTINEL"
  export STUB_SENTINEL="$AUTHOR_SENTINEL"
  export STUB_ARGV_FILE="$AUTHOR_ARGV_FILE"
  export STUB_TMP="$TEST_TMP"
}
reset_author_stub

# ── bundle fixtures ─────────────────────────────────────────────────────────
mk_bundle() { # mk_bundle <file>  — a valid bundle: axes A (untaken) / B (taken)
  cat > "$1" <<'EOF'
{
  "round_id": "round-4",
  "question": "Should we ship the retry cap at 3 or 5?",
  "transcript": [
    { "role": "product", "position": "Round 1", "risk_tags": ["minor"], "anchors": ["artifact:base"] }
  ],
  "artifacts": [
    { "id": "artifact:base", "kind": "evidence", "text": "baseline framing" },
    { "id": "artifact:decisive", "kind": "evidence", "text": "decisive fact" }
  ],
  "axes": [
    { "id": "axis:A", "claim_vector": ["tokenA1", "tokenA2"] },
    { "id": "axis:B", "claim_vector": ["tokenB1", "tokenB2"] }
  ],
  "taken_axes": ["axis:B"]
}
EOF
}
BUNDLE="$TEST_TMP/bundle.json"
mk_bundle "$BUNDLE"

# ── config fixtures ──────────────────────────────────────────────────────────
CFG_OFF="$TEST_TMP/cfg-off.md"
printf -- '- discuss_dispatch: off\n' > "$CFG_OFF"

CFG_ON_NO_OVERRIDE="$TEST_TMP/cfg-on-no-override.md"
cat > "$CFG_ON_NO_OVERRIDE" <<'EOF'
- discuss_dispatch: on
- discuss_engine: gpt-5.6-sol
- discuss_effort: high
- discuss_runner: codex
EOF

OVERRIDE_FILE="$TEST_TMP/qual-override.json"
FUTURE="$(date -u -d '+30 days' +%Y-%m-%d 2>/dev/null || date -u -v+30d +%Y-%m-%d)"
cat > "$OVERRIDE_FILE" <<EOF
{ "schema": 1, "overrides": [
  { "engine": "gpt-5.6-sol", "runner": "codex", "role": "discuss", "reason": "D9 test", "operator": "test", "expires": "$FUTURE" }
] }
EOF

# ── 1. malformed bundle => exit 2, no resolver/transport spawn ─────────────
run_malformed() { # run_malformed <bundle-json-text> <label>
  local b="$TEST_TMP/malformed.json"
  printf '%s' "$1" > "$b"
  reset_author_stub
  out="$(node "$SCRIPT" --bundle-file "$b" --dispatch-author-bin "$AUTHOR_EXIT99" --resolve-review-loop-bin "$AUTHOR_EXIT99" 2>&1)"; rc=$?
  assert_eq "2" "$rc" "malformed bundle ($2) exits 2"
  assert_file_absent "$AUTHOR_SENTINEL" "malformed bundle ($2) never spawns transport"
}
run_malformed '{"round_id":"r","question":"q","transcript":"not-an-array","artifacts":[],"axes":[{"id":"a","claim_vector":["t"]}],"taken_axes":[]}' "transcript not array"
run_malformed '{"round_id":"","question":"q","transcript":[],"artifacts":[],"axes":[{"id":"a","claim_vector":["t"]}],"taken_axes":[]}' "empty round_id"
run_malformed '{"round_id":"r","question":"q","transcript":[],"artifacts":[],"axes":[],"taken_axes":[]}' "empty axes"
run_malformed '{"round_id":"r","question":"q","transcript":[],"artifacts":[],"axes":[{"id":"a","claim_vector":[]}],"taken_axes":[]}' "empty claim_vector"
run_malformed '{"round_id":"r","question":"q","transcript":[],"artifacts":[],"axes":[{"id":"a","claim_vector":["t"]}],"taken_axes":["undeclared"]}' "undeclared taken_axes entry"
run_malformed 'not json at all' "invalid JSON"

# ── 2. switch off => exit 2, zero transport spawns, real resolver ──────────
reset_author_stub
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_OFF" node "$SCRIPT" --bundle-file "$BUNDLE" --dispatch-author-bin "$AUTHOR_EXIT99" 2>&1)"; rc=$?
assert_eq "2" "$rc" "discuss_dispatch: off exits 2"
assert_contains "$out" "discuss_dispatch is off" "off-path names the switch"
assert_file_absent "$AUTHOR_SENTINEL" "switch-off path spawns zero transport processes"

# ── 3. switch on, no qualifying row/override => resolver denies (exit 3) ───
reset_author_stub
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON_NO_OVERRIDE" node "$SCRIPT" --bundle-file "$BUNDLE" --dispatch-author-bin "$AUTHOR_EXIT99" 2>&1)"; rc=$?
assert_eq "3" "$rc" "switch on + unqualified seat + no override is denied (exit 3), surfaced from the resolver"
assert_contains "$out" "NOT qualified" "resolver's own denial message is surfaced verbatim"
assert_file_absent "$AUTHOR_SENTINEL" "resolver-denied path spawns zero transport processes"

# ── 4. end-to-end: real resolver admits (override), argv carries the exact
#      resolved tuple, response round-trips ─────────────────────────────────
VALID_RESPONSE='{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA1"],"position":"Holding axis A on token A1.","risk_tags":["important"],"anchors":["artifact:base"]}'
reset_author_stub
export STUB_RAW_CONTENT="$VALID_RESPONSE"
export STUB_STATUS="authored"
export STUB_EXIT="0"
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVERRIDE_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON_NO_OVERRIDE" node "$SCRIPT" --bundle-file "$BUNDLE" --dispatch-author-bin "$AUTHOR_STUB" 2>"$TEST_TMP/e2e.stderr")"; rc=$?
assert_eq "0" "$rc" "end-to-end success exits 0"
assert_file_exists "$AUTHOR_SENTINEL" "transport WAS spawned when switch on + admitted"
assert_eq "$VALID_RESPONSE" "$out" "stdout is exactly the engine's closed-schema contribution"
ARGV="$(cat "$AUTHOR_ARGV_FILE")"
assert_contains "$ARGV" "--runner
codex" "argv carries the resolved runner"
assert_contains "$ARGV" "--model
gpt-5.6-sol" "argv carries the resolved engine"
assert_contains "$ARGV" "--effort
high" "argv carries the resolved effort"
assert_not_contains "$ARGV" "--endpoint" "empty discuss_endpoint is omitted from argv, not passed empty"

# ── 5. rail failure => fail-closed, exit 4, no fabricated contribution ─────
reset_author_stub
export STUB_STATUS="runner_failed"
export STUB_EXIT="3"
export STUB_RAW_CONTENT="partial garbage, not json"
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVERRIDE_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON_NO_OVERRIDE" node "$SCRIPT" --bundle-file "$BUNDLE" --dispatch-author-bin "$AUTHOR_STUB" 2>&1)"; rc=$?
assert_eq "4" "$rc" "rail runner_failed exits 4 (fail-closed)"

reset_author_stub
export STUB_STATUS="empty_output"
export STUB_EXIT="1"
export STUB_RAW_CONTENT=""
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVERRIDE_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON_NO_OVERRIDE" node "$SCRIPT" --bundle-file "$BUNDLE" --dispatch-author-bin "$AUTHOR_STUB" 2>&1)"; rc=$?
assert_eq "4" "$rc" "rail empty_output exits 4 (fail-closed)"

# ── helper: run one contribution through the validator via the stub, assert
#      exit 4 + a message fragment ───────────────────────────────────────────
assert_contribution_rejected() { # <response-json> <expect-fragment> <label>
  reset_author_stub
  export STUB_STATUS="authored"; export STUB_EXIT="0"
  export STUB_RAW_CONTENT="$1"
  out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVERRIDE_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON_NO_OVERRIDE" node "$SCRIPT" --bundle-file "$BUNDLE" --dispatch-author-bin "$AUTHOR_STUB" 2>&1)"; rc=$?
  assert_eq "4" "$rc" "$3 exits 4"
  assert_contains "$out" "$2" "$3 message names the failure"
}
assert_contribution_accepted() { # <response-json> <label>
  reset_author_stub
  export STUB_STATUS="authored"; export STUB_EXIT="0"
  export STUB_RAW_CONTENT="$1"
  out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVERRIDE_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON_NO_OVERRIDE" node "$SCRIPT" --bundle-file "$BUNDLE" --dispatch-author-bin "$AUTHOR_STUB" 2>&1)"; rc=$?
  assert_eq "0" "$rc" "$2 accepted (exit 0)"
}

# ── 6. axis_id cardinality ──────────────────────────────────────────────────
assert_contribution_rejected '{"round_id":"round-4","axis_id":[],"claim_vector":["tokenA1"],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "axis_id must be exactly one string" "zero axes (array form)"
assert_contribution_rejected '{"round_id":"round-4","axis_id":["axis:A","axis:B"],"claim_vector":["tokenA1"],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "axis_id must be exactly one string" "two axes"
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:undeclared","claim_vector":["tokenA1"],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "axis_id must be a declared axis" "undeclared axis"
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:B","claim_vector":["tokenB1"],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "already taken" "already-taken axis"
assert_contribution_accepted "$VALID_RESPONSE" "exactly one untaken declared axis"

# ── 7. claim_vector binding ─────────────────────────────────────────────────
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":[],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "claim_vector must be a non-empty array" "empty claim_vector"
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["not-a-real-token"],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "no token from the selected axis" "token not in selected axis vector"
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA1","tokenB1"],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "exclusive to already-taken axis" "token from an already-taken axis mixed in"
assert_contribution_accepted '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA2"],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "single valid token from the selected axis"

# ── 8. unresolvable anchor ───────────────────────────────────────────────────
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA1"],"position":"x","risk_tags":["minor"],"anchors":["artifact:does-not-exist"]}' \
  "unresolvable anchor" "anchor not in bundle.artifacts"

# ── 9. risk vocabulary conformance (lowercase think-tank vocab, not the
#      four-tier severity vocabulary) ───────────────────────────────────────
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA1"],"position":"x","risk_tags":["🔴 Critical"],"anchors":[]}' \
  "wrong risk vocabulary" "four-tier severity marker in risk_tags"
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA1"],"position":"x","risk_tags":[],"anchors":[]}' \
  "risk_tags must be a non-empty array" "empty risk_tags"

# ── 10. no-verdict guard ────────────────────────────────────────────────────
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA1"],"position":"Recommend SHIP-AS-IS here.","risk_tags":["minor"],"anchors":[]}' \
  "verdict token present in position" "SHIP-AS-IS verdict token in position"
# A bundle whose own round_id embeds a verdict token, so a response that
# correctly echoes it still trips the verdict guard (proves the guard scans
# round_id independent of the round-trip check, not merely as a byproduct
# of round-trip mismatch).
BUNDLE_VERDICT_ROUND="$TEST_TMP/bundle-verdict-round.json"
sed 's/"round-4"/"round-4-verdict:-go"/' "$BUNDLE" > "$BUNDLE_VERDICT_ROUND"
reset_author_stub
export STUB_STATUS="authored"; export STUB_EXIT="0"
export STUB_RAW_CONTENT='{"round_id":"round-4-verdict:-go","axis_id":"axis:A","claim_vector":["tokenA1"],"position":"x","risk_tags":["minor"],"anchors":[]}'
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVERRIDE_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON_NO_OVERRIDE" node "$SCRIPT" --bundle-file "$BUNDLE_VERDICT_ROUND" --dispatch-author-bin "$AUTHOR_STUB" 2>&1)"; rc=$?
assert_eq "4" "$rc" "verdict token in round_id exits 4"
assert_contains "$out" "verdict token present in round_id" "verdict token in round_id message names the failure"

# ── 11. round_id round-trip ─────────────────────────────────────────────────
assert_contribution_rejected '{"round_id":"wrong-round","axis_id":"axis:A","claim_vector":["tokenA1"],"position":"x","risk_tags":["minor"],"anchors":[]}' \
  "must echo the bundle's round_id" "round_id does not echo the bundle"

# ── 12. closed schema: extra/missing keys ───────────────────────────────────
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA1"],"position":"x","risk_tags":["minor"],"anchors":[],"verdict":"SHIP-AS-IS"}' \
  "unknown key(s)" "extra key rejected"
assert_contribution_rejected '{"round_id":"round-4","axis_id":"axis:A","claim_vector":["tokenA1"],"risk_tags":["minor"],"anchors":[]}' \
  "missing key(s)" "missing key rejected"

# ── 13. single-contribution semantics: one dispatch call, one stub
#      invocation — the stub's own record proves no loop happened ─────────
reset_author_stub
export STUB_STATUS="authored"; export STUB_EXIT="0"
export STUB_RAW_CONTENT="$VALID_RESPONSE"
AUTOPILOT_QUALIFICATION_OVERRIDE="$OVERRIDE_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON_NO_OVERRIDE" node "$SCRIPT" --bundle-file "$BUNDLE" --dispatch-author-bin "$AUTHOR_STUB" >/dev/null 2>&1
INVOCATIONS="$(wc -l < "$AUTHOR_ARGV_FILE" | tr -d ' ')"
# argv is written as one arg per line; --runner alone appears exactly once
# if dispatch-author.sh (the stub) was invoked exactly once.
RUNNER_COUNT="$(grep -c '^--runner$' "$AUTHOR_ARGV_FILE")"
assert_eq "1" "$RUNNER_COUNT" "exactly one dispatch call (single-contribution, not a chat loop)"

# ── 14. node --check + repo syntax gate ─────────────────────────────────────
node --check "$SCRIPT" 2>&1
assert_eq "0" "$?" "dispatch-discuss.js parses (node --check)"

# ── 15. exactly one guarded call site in think-tank SKILL.md ──────────────
SKILL_MD="$REPO_ROOT/skills/think-tank/SKILL.md"
assert_file_exists "$SKILL_MD" "think-tank SKILL.md exists"
# One call SITE (one invocation), which the doc names twice: once in prose
# ("Call `scripts/dispatch-discuss.js` once per round-set") and once in the
# actual bash invocation line — both referring to the same single call.
CALL_COUNT="$(grep -c 'dispatch-discuss\.js' "$SKILL_MD")"
assert_eq "2" "$CALL_COUNT" "exactly one dispatch-discuss.js call site in think-tank SKILL.md (one prose mention + one invocation line)"
INVOKE_LINE_COUNT="$(grep -c '^node scripts/dispatch-discuss\.js' "$SKILL_MD")"
assert_eq "1" "$INVOKE_LINE_COUNT" "exactly one actual invocation line"
BRAINSTORM_MD="$REPO_ROOT/skills/brainstorm/SKILL.md"
if [ -f "$BRAINSTORM_MD" ]; then
  BRAIN_COUNT="$(grep -c 'dispatch-discuss\.js' "$BRAINSTORM_MD" || true)"
  assert_eq "0" "${BRAIN_COUNT:-0}" "brainstorm is NOT wired to dispatch-discuss.js (plan §7 non-goal)"
fi

finalize_test
