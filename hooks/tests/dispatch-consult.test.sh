#!/usr/bin/env bash
# dispatch-consult.test.sh — D8 acceptance surface (plan
# docs/plans/2026-08-28-consult-discuss-qualification.md D8). Covers:
# switch-off refusal (exit 2, zero transport spawns, real entry point),
# blind-evidence preflight refusal, verdict-token rejection, and the
# end-to-end configured-tuple test through the real dispatch-author.sh seam
# (--dispatch-author-bin), asserting the recorded argv carries exactly the
# resolved {engine, runner, effort, endpoint} tuple and a frozen-schema
# response round-trips with no verdict protocol.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-consult.sh"
unset REVIEW_LOOP_CONFIG_OVERRIDE
unset AUTOPILOT_QUALIFICATION_OVERRIDE

Q="$TEST_TMP/question.txt"
printf 'should we ship this diff?\n' > "$Q"
ART="$TEST_TMP/artifact.diff"
printf 'diff --git a/x b/x\n+line\n' > "$ART"

# Fail-hard shadow: any invocation of this binary is itself a test failure
# marker (records a sentinel + exits nonzero). Used to prove zero transport
# spawns on every refusal path.
SHADOW_MARKER="$TEST_TMP/shadow-invoked"
SHADOW_BIN="$TEST_TMP/shadow-dispatch-author.sh"
cat > "$SHADOW_BIN" <<EOF
#!/usr/bin/env bash
echo "SHADOW INVOKED — this must never happen on a refusal path" >> "$SHADOW_MARKER"
exit 97
EOF
chmod +x "$SHADOW_BIN"

assert_shadow_not_invoked() {
  assert_file_absent "$SHADOW_MARKER" "${1:-shadow dispatch-author.sh binary was never invoked}"
}

# ── 1. Switch off ⇒ exit 2, message names the field, zero transport spawns ──
OFF_CFG="$TEST_TMP/off.md"
printf -- '- consult_dispatch: off\n' > "$OFF_CFG"
OFF_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$OFF_CFG" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$SHADOW_BIN" 2>"$TEST_TMP/off.err")"
OFF_EXIT=$?
OFF_ERR="$(cat "$TEST_TMP/off.err")"
assert_eq "2" "$OFF_EXIT" "consult_dispatch=off exits 2"
assert_contains "$OFF_OUT" '"status": "switch_off"' "off-path status is switch_off"
assert_contains "$OFF_ERR" "consult_dispatch" "off-path stderr message names the consult_dispatch field"
assert_shadow_not_invoked "off-path never spawns the transport binary"
rm -f "$SHADOW_MARKER"

# Real entry point, not a stubbed-out shortcut: the switch-off refusal is
# driven through the actual $SCRIPT invocation above (round-2 finding [6]).

# ── 2. Missing question-file / artifact ⇒ usage refusal (exit 2), no dispatch ──
NOARG_OUT="$("$SCRIPT" --artifact "$ART" --dispatch-author-bin "$SHADOW_BIN" 2>&1)"; NOARG_EXIT=$?
assert_eq "2" "$NOARG_EXIT" "missing --question-file exits 2"
assert_shadow_not_invoked "missing --question-file never spawns the transport binary"
rm -f "$SHADOW_MARKER"

# ── Fixtures shared by the switch-on cases below ────────────────────────────
ON_CFG="$TEST_TMP/on.md"
printf -- '- consult_engine: gpt-5.6\n- consult_runner: codex\n- consult_effort: high\n- consult_dispatch: on\n' > "$ON_CFG"
OVR="$TEST_TMP/override.json"
cat > "$OVR" <<'JSON'
{"schema":1,"overrides":[
  {"engine":"gpt-5.6","runner":"codex","role":"consult","reason":"dispatch-consult.test.sh fixture","operator":"cookys","expires":"2099-01-01"}
]}
JSON

# ── 3. Blind-evidence preflight refuses a self-report payload before dispatch ──
SELF_REPORT="$TEST_TMP/self-report.txt"
printf 'I have implemented the fix and all tests pass.\n' > "$SELF_REPORT"
BLIND_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$SCRIPT" --question-file "$Q" --artifact "$SELF_REPORT" --dispatch-author-bin "$SHADOW_BIN" 2>"$TEST_TMP/blind.err")"
BLIND_EXIT=$?
BLIND_ERR="$(cat "$TEST_TMP/blind.err")"
assert_eq "4" "$BLIND_EXIT" "self-report payload exits 4 (blind-evidence violation)"
assert_contains "$BLIND_OUT" '"status": "blind_evidence_violation"' "blind-evidence violation status"
assert_contains "$BLIND_ERR" "implementer" "blind-evidence stderr names the implementer-narrative class"
assert_shadow_not_invoked "blind-evidence violation never spawns the transport binary"
rm -f "$SHADOW_MARKER"

# ── 4. Verdict-token rejection: a response carrying a loop-convergence ──────
# verdict token is rejected even though the transport succeeded.
VERDICT_RESPONSE="$TEST_TMP/verdict-response.json"
cat > "$VERDICT_RESPONSE" <<'EOF'
{ "answer": { "label": "ship-as-is", "artifact_ref": null },
  "aside": [],
  "authority": { "refused": true, "reference": "qc@depth-0" } }
EOF
VERDICT_ARGV="$TEST_TMP/verdict-argv.txt"
VERDICT_BIN="$TEST_TMP/verdict-author.sh"
cat > "$VERDICT_BIN" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$VERDICT_ARGV"
printf '{ "runner": "codex", "model": "gpt-5.6", "status": "authored", "raw_log": "$VERDICT_RESPONSE", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
EOF
chmod +x "$VERDICT_BIN"
VERDICT_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$VERDICT_BIN" 2>"$TEST_TMP/verdict.err")"
VERDICT_EXIT=$?
assert_eq "5" "$VERDICT_EXIT" "verdict-token response exits 5"
assert_contains "$VERDICT_OUT" '"status": "verdict_rejected"' "verdict-token response is rejected"
assert_file_exists "$VERDICT_ARGV" "verdict case: transport WAS invoked (this is a post-dispatch content rejection, not a preflight refusal)"

# ── 5. Protocol violation: a response with an extra top-level key is refused ──
BADSCHEMA_RESPONSE="$TEST_TMP/bad-schema-response.json"
cat > "$BADSCHEMA_RESPONSE" <<'EOF'
{ "answer": { "label": "insufficient_evidence", "artifact_ref": null },
  "aside": [],
  "authority": { "refused": true, "reference": "qc@depth-0" },
  "extra_field": "not in the frozen schema" }
EOF
BADSCHEMA_BIN="$TEST_TMP/bad-schema-author.sh"
cat > "$BADSCHEMA_BIN" <<EOF
#!/usr/bin/env bash
printf '{ "runner": "codex", "model": "gpt-5.6", "status": "authored", "raw_log": "$BADSCHEMA_RESPONSE", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
EOF
chmod +x "$BADSCHEMA_BIN"
BADSCHEMA_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$BADSCHEMA_BIN" 2>&1 >/dev/null)"
BADSCHEMA_EXIT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$BADSCHEMA_BIN" >/dev/null 2>&1; echo $?)"
assert_eq "5" "$BADSCHEMA_EXIT" "extra top-level key response exits 5 (protocol_violation)"
assert_contains "$BADSCHEMA_OUT" "protocol_violation" "extra top-level key names protocol_violation"

# ── 6. Exclusivity: insufficient_evidence + a confident artifact_ref together
# is a protocol_violation.
EXCL_RESPONSE="$TEST_TMP/exclusivity-response.json"
cat > "$EXCL_RESPONSE" <<'EOF'
{ "answer": { "label": "insufficient_evidence", "artifact_ref": "a1" },
  "aside": [],
  "authority": { "refused": false, "reference": null } }
EOF
EXCL_BIN="$TEST_TMP/exclusivity-author.sh"
cat > "$EXCL_BIN" <<EOF
#!/usr/bin/env bash
printf '{ "runner": "codex", "model": "gpt-5.6", "status": "authored", "raw_log": "$EXCL_RESPONSE", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
EOF
chmod +x "$EXCL_BIN"
EXCL_EXIT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$EXCL_BIN" >/dev/null 2>&1; echo $?)"
assert_eq "5" "$EXCL_EXIT" "insufficient_evidence + confident artifact_ref exits 5 (exclusivity protocol_violation)"

# ── 7. End-to-end configured-tuple test through the real transport seam ────
# The recorded argv must carry EXACTLY the resolved {engine, runner, effort}
# (endpoint omitted — the fixture leaves consult_endpoint empty), and a
# frozen-schema, no-verdict response must round-trip as "advised".
GOOD_RESPONSE="$TEST_TMP/good-response.json"
cat > "$GOOD_RESPONSE" <<'EOF'
{ "answer": { "label": "insufficient_evidence", "artifact_ref": null },
  "aside": [ { "note": "unrelated aside, parked" } ],
  "authority": { "refused": true, "reference": "qc@depth-0" } }
EOF
GOOD_ARGV="$TEST_TMP/good-argv.txt"
GOOD_BIN="$TEST_TMP/good-author.sh"
cat > "$GOOD_BIN" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$GOOD_ARGV"
printf '{ "runner": "codex", "model": "gpt-5.6", "status": "authored", "raw_log": "$GOOD_RESPONSE", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
EOF
chmod +x "$GOOD_BIN"
GOOD_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$GOOD_BIN")"
GOOD_EXIT=$?
assert_eq "0" "$GOOD_EXIT" "configured-tuple end-to-end dispatch exits 0"
assert_contains "$GOOD_OUT" '"status": "advised"' "configured-tuple end-to-end status is advised"
assert_contains "$GOOD_OUT" '"engine": "gpt-5.6"' "output names the resolved engine"
assert_contains "$GOOD_OUT" '"runner": "codex"' "output names the resolved runner"
assert_contains "$GOOD_OUT" '"effort": "high"' "output names the resolved effort"
GOOD_ARGV_TEXT="$(cat "$GOOD_ARGV")"
assert_contains "$GOOD_ARGV_TEXT" "--runner
codex" "recorded argv carries --runner codex"
assert_contains "$GOOD_ARGV_TEXT" "--model
gpt-5.6" "recorded argv carries --model gpt-5.6"
assert_contains "$GOOD_ARGV_TEXT" "--effort
high" "recorded argv carries --effort high"
assert_not_contains "$GOOD_ARGV_TEXT" "--endpoint" "recorded argv omits --endpoint when consult_endpoint is empty"
assert_contains "$GOOD_OUT" '"authority": { "refused": true, "reference": "qc@depth-0" }' "frozen-schema response round-trips without any verdict protocol"

# ── 8. Endpoint is forwarded when the seat configures one ──────────────────
EP_CFG="$TEST_TMP/on-endpoint.md"
printf -- '- consult_engine: glm-5.2\n- consult_runner: cc-shim\n- consult_effort: high\n- consult_endpoint: MY_EP\n- consult_dispatch: on\n' > "$EP_CFG"
EP_OVR="$TEST_TMP/override-endpoint.json"
cat > "$EP_OVR" <<'JSON'
{"schema":1,"overrides":[
  {"engine":"glm-5.2","runner":"cc-shim","role":"consult","reason":"dispatch-consult.test.sh fixture","operator":"cookys","expires":"2099-01-01"}
]}
JSON
EP_ARGV="$TEST_TMP/ep-argv.txt"
EP_BIN="$TEST_TMP/ep-author.sh"
cat > "$EP_BIN" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$EP_ARGV"
printf '{ "runner": "cc-shim", "model": "glm-5.2", "status": "authored", "raw_log": "$GOOD_RESPONSE", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
EOF
chmod +x "$EP_BIN"
EP_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EP_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$EP_OVR" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$EP_BIN")"
EP_EXIT=$?
assert_eq "0" "$EP_EXIT" "endpoint-configured seat dispatches successfully"
EP_ARGV_TEXT="$(cat "$EP_ARGV")"
assert_contains "$EP_ARGV_TEXT" "--endpoint
MY_EP" "recorded argv carries --endpoint MY_EP when consult_endpoint is set"

# ── 9. Qualification gate failure (D7) surfaces the resolver's own message,
# never a re-invented one, and never dispatches.
UNQUAL_CFG="$TEST_TMP/on-unqualified.md"
printf -- '- consult_engine: unqualified-model\n- consult_runner: codex\n- consult_effort: high\n- consult_dispatch: on\n' > "$UNQUAL_CFG"
UNQUAL_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$UNQUAL_CFG" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$SHADOW_BIN" 2>"$TEST_TMP/unqual.err")"
UNQUAL_EXIT=$?
UNQUAL_ERR="$(cat "$TEST_TMP/unqual.err")"
assert_eq "3" "$UNQUAL_EXIT" "unqualified consult seat exits 3"
assert_contains "$UNQUAL_ERR" "NOT qualified" "unqualified-seat stderr surfaces resolve-review-loop.sh's own qualification message"
assert_shadow_not_invoked "unqualified seat never spawns the transport binary"
rm -f "$SHADOW_MARKER"

# ── 10. references/hetero-dispatch.md no longer contains a hand-assembled ──
# argv recipe (D8 acceptance): the old recipe hand-typed a full
# dispatch-review.sh argv; the consult seat section must now call
# scripts/dispatch-consult.sh instead.
HETERO_MD="$REPO_ROOT/references/hetero-dispatch.md"
assert_file_exists "$HETERO_MD" "references/hetero-dispatch.md exists"
HETERO_TEXT="$(cat "$HETERO_MD")"
assert_contains "$HETERO_TEXT" "scripts/dispatch-consult.sh" "hetero-dispatch.md's consult seat section calls scripts/dispatch-consult.sh"
assert_not_contains "$HETERO_TEXT" 'dispatch-review.sh --runner "$run" --model "$eng"' \
  "hetero-dispatch.md no longer carries the hand-assembled dispatch-review.sh argv recipe"

finalize_test
