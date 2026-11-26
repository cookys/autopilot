#!/usr/bin/env bash
# Test for fleet-dispatch-class.js PreToolUse hook (matcher: mcp__fleet__dispatch)
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID
. "$(dirname "$0")/lib.sh"

HOOK_PATH="$REPO_ROOT/hooks/fleet-dispatch-class.js"

build_dispatch_payload() {
  local task_text="$1"
  local explicit_class="${2-__OMIT__}"
  node -e '
    const [task, cls] = process.argv.slice(1);
    const tool_input = {
      to: "ns/courier/worker",
      task,
      size: "M",
    };
    if (cls !== "__OMIT__") tool_input.class = cls;
    process.stdout.write(JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__fleet__dispatch",
      tool_input,
    }));
  ' "$task_text" "$explicit_class"
}

assert_mapped_role() {
  local role_line="$1"
  local want_class="$2"
  local label="$3"
  local task_body="Engine: sonnet
${role_line}
Lane: alpha
Please handle this work item."
  local payload
  payload="$(build_dispatch_payload "$task_body")"
  run_hook fleet-dispatch-class.js "$payload"
  assert_eq 0 "$__RUN_EXIT" "${label}: exit 0"
  local check_out
  check_out="$(node -e '
    const [raw, wantClass, wantTask] = process.argv.slice(1);
    const parsed = JSON.parse(raw);
    const h = parsed && parsed.hookSpecificOutput;
    if (!h) process.exit(2);
    if (h.hookEventName !== "PreToolUse") process.exit(3);
    if (h.permissionDecision !== undefined) process.exit(4);
    const u = h.updatedInput;
    if (!u || typeof u !== "object") process.exit(5);
    if (u.class !== wantClass) process.exit(6);
    if (u.to !== "ns/courier/worker") process.exit(7);
    if (u.size !== "M") process.exit(8);
    if (u.task !== wantTask) process.exit(9);
    process.stdout.write("ok");
  ' "$__RUN_STDOUT" "$want_class" "$task_body" 2>/dev/null || true)"
  assert_eq "ok" "$check_out" "${label}: allow + updatedInput.class=${want_class} + preserves to/task/size"
}

assert_denied_one_line_zh() {
  local raw_stdout="$1"
  local label="$2"
  local reason
  reason="$(node -e '
    const parsed = JSON.parse(process.argv[1]);
    const h = parsed && parsed.hookSpecificOutput;
    if (!h || h.hookEventName !== "PreToolUse" || h.permissionDecision !== "deny") process.exit(2);
    const r = h.permissionDecisionReason;
    if (typeof r !== "string" || !r.trim() || /[\r\n]/.test(r)) process.exit(3);
    if (!/[\u4e00-\u9fff]/.test(r)) process.exit(4);
    process.stdout.write(r);
  ' "$raw_stdout" 2>/dev/null || true)"
  assert_neq "" "$reason" "${label}: deny with one-line zh-TW reason"
  printf '%s' "$reason"
}

# 1. Role -> class mapping across all four work classes (preserving to/task/size)
assert_mapped_role "Role: plan-reviewer" "plan-review" "map-plan-reviewer"
assert_mapped_role "Role: reviewer (plan)" "plan-review" "map-reviewer-with-plan"
assert_mapped_role "  role:   review - plan loop  " "plan-review" "map-case-insensitive-trimmed-plan"

assert_mapped_role "Role: reviewer" "code-review" "map-reviewer"
assert_mapped_role "Role: code-reviewer" "code-review" "map-code-reviewer"
assert_mapped_role "Role: qc" "code-review" "map-qc"
assert_mapped_role "Role: verifier" "code-review" "map-verifier"
assert_mapped_role "Role: reviewer (explanation)" "code-review" "map-reviewer-explanation-not-plan"

assert_mapped_role "Role: implementer" "implement" "map-implementer"
assert_mapped_role "Role: hand" "implement" "map-hand"
assert_mapped_role "Role: foreman" "implement" "map-foreman"
assert_mapped_role "Role: author" "implement" "map-author"
assert_mapped_role "Role: fixer" "implement" "map-fixer"

assert_mapped_role "Role: chat" "chat" "map-chat"
assert_mapped_role "Role: question" "chat" "map-question"
assert_mapped_role "Role: consult" "chat" "map-consult"
assert_mapped_role "Role: research" "chat" "map-research"
assert_mapped_role "Role: report" "chat" "map-report"

# Role on line 15 is within the ~15-line window; line 16 is outside.
LINE15_TASK="$(printf '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\nRole: implementer\nBody')"
run_hook fleet-dispatch-class.js "$(build_dispatch_payload "$LINE15_TASK")"
assert_contains "$__RUN_STDOUT" '"class":"implement"' "line15-role-accepted"

LINE16_TASK="$(printf '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\nRole: implementer\nBody')"
run_hook fleet-dispatch-class.js "$(build_dispatch_payload "$LINE16_TASK")"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "line16-role-ignored-denied"

# 2. Explicit valid class -> allow untouched (exit 0, no stdout), even without Role:
for valid_cls in plan-review code-review implement chat review summary inventory test-gen subagent author; do
  PAYLOAD="$(build_dispatch_payload "No role header here." "$valid_cls")"
  run_hook fleet-dispatch-class.js "$PAYLOAD"
  assert_eq 0 "$__RUN_EXIT" "explicit-${valid_cls}: exit 0"
  assert_eq "" "$__RUN_STDOUT" "explicit-${valid_cls}: untouched (empty stdout)"
done

# 3. Missing Role: -> denied with one-line zh-TW reason naming Role: and class
PAYLOAD="$(build_dispatch_payload $'Engine: sonnet\nLane: alpha\nDo work without a role header.')"
run_hook fleet-dispatch-class.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "missing-role: exit 0"
REASON_MISSING="$(assert_denied_one_line_zh "$__RUN_STDOUT" "missing-role")"
assert_contains "$REASON_MISSING" "Role:" "missing-role reason names Role:"
assert_contains "$REASON_MISSING" "class" "missing-role reason names class"
assert_contains "$REASON_MISSING" "plan-review" "missing-role reason lists plan-review"
assert_contains "$REASON_MISSING" "code-review" "missing-role reason lists code-review"
assert_contains "$REASON_MISSING" "implement" "missing-role reason lists implement"
assert_contains "$REASON_MISSING" "chat" "missing-role reason lists chat"

# 4. Unknown Role: -> denied with one-line zh-TW reason
for bad_role in "Role: wizard" "Role: wizard (plan)"; do
  PAYLOAD="$(build_dispatch_payload $'Engine: sonnet\n'"${bad_role}"$'\nDo work.')"
  run_hook fleet-dispatch-class.js "$PAYLOAD"
  assert_eq 0 "$__RUN_EXIT" "unknown-role (${bad_role}): exit 0"
  REASON_UNKNOWN="$(assert_denied_one_line_zh "$__RUN_STDOUT" "unknown-role (${bad_role})")"
  assert_contains "$REASON_UNKNOWN" "Role:" "unknown-role reason names Role:"
  assert_contains "$REASON_UNKNOWN" "class" "unknown-role reason names class"
done

# 5. Invalid explicit class -> denied with one-line zh-TW reason listing all valid values
for bad_cls in "deploy" "" "foo"; do
  PAYLOAD="$(build_dispatch_payload $'Role: implementer\nDo work.' "$bad_cls")"
  run_hook fleet-dispatch-class.js "$PAYLOAD"
  assert_eq 0 "$__RUN_EXIT" "invalid-class (${bad_cls}): exit 0"
  REASON_BAD_CLS="$(assert_denied_one_line_zh "$__RUN_STDOUT" "invalid-class (${bad_cls})")"
  assert_contains "$REASON_BAD_CLS" "plan-review" "invalid-class lists plan-review"
  assert_contains "$REASON_BAD_CLS" "code-review" "invalid-class lists code-review"
  assert_contains "$REASON_BAD_CLS" "implement" "invalid-class lists implement"
  assert_contains "$REASON_BAD_CLS" "chat" "invalid-class lists chat"
done

# 6. Non-dispatch tool -> untouched
run_hook fleet-dispatch-class.js '{"hook_event_name":"PreToolUse","tool_name":"mcp__fleet__send","tool_input":{"to":"peer","content":"hi"}}'
assert_eq 0 "$__RUN_EXIT" "other-tool: exit 0"
assert_eq "" "$__RUN_STDOUT" "other-tool: untouched"

# 7. Malformed stdin JSON -> exits 0 silently (fail-open)
run_hook fleet-dispatch-class.js 'not valid json'
assert_eq 0 "$__RUN_EXIT" "malformed-stdin: exit 0"
assert_eq "" "$__RUN_STDOUT" "malformed-stdin: silent stdout"
assert_eq "" "$__RUN_STDERR" "malformed-stdin: silent stderr"

run_hook fleet-dispatch-class.js ''
assert_eq 0 "$__RUN_EXIT" "empty-stdin: exit 0"
assert_eq "" "$__RUN_STDOUT" "empty-stdin: silent stdout"

# 8. Negative control: copy hook with ROLE_CLASS_MAP emptied -> all 4 mapping cases go RED, then GREEN on real hook
mkdir -p "$TEST_TMP/hooks/lib"
cp "$REPO_ROOT/hooks/lib/gate-hint.js" "$TEST_TMP/hooks/lib/gate-hint.js"
mkdir -p "$TEST_TMP/scripts/lib"
cp "$REPO_ROOT/scripts/lib/shed-route.js" "$TEST_TMP/scripts/lib/shed-route.js"
MUTANT_HOOK="$TEST_TMP/hooks/fleet-dispatch-class.empty-map.js"
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  const re = /const ROLE_CLASS_MAP = Object\.freeze\(\{[\s\S]*?\}\);/;
  if (!re.test(src)) process.exit(2);
  const mutated = src.replace(re, "const ROLE_CLASS_MAP = Object.freeze({});");
  fs.writeFileSync(process.argv[2], mutated, "utf8");
' "$HOOK_PATH" "$MUTANT_HOOK"
assert_eq 0 "$?" "negative-control: built emptied-table mutant"

for pair in "Role: plan-reviewer|plan-review" "Role: reviewer|code-review" "Role: implementer|implement" "Role: consult|chat"; do
  role_hdr="${pair%|*}"
  want_cls="${pair#*|}"
  neg_payload="$(build_dispatch_payload "${role_hdr}"$'\nTask body.')"
  neg_out="$(printf '%s' "$neg_payload" | node "$MUTANT_HOOK")"
  assert_contains "$neg_out" '"permissionDecision":"deny"' "negative-control RED on emptied table (${want_cls})"
  assert_not_contains "$neg_out" '"permissionDecision":"allow"' "negative-control never allows when table empty (${want_cls})"

  run_hook fleet-dispatch-class.js "$neg_payload"
  assert_contains "$__RUN_STDOUT" "\"class\":\"${want_cls}\"" "negative-control GREEN on real hook (${want_cls})"
done

# 9. Capacity shed routing for mechanical fleet dispatches (inventory/summary/chores, XS/S)
SHED_TMP="$TEST_TMP/shed"
mkdir -p "$SHED_TMP/home/projects/capacity/out"
write_burn_more() {
  local target_file="$1"
  local gen_at="$2"
  local undispatchable="${3:-[]}"
  cat > "$target_file" <<EOF
{
  "schema": "capacity.burn_more/1",
  "run_id": "bm-test-001",
  "generated_at": "${gen_at}",
  "shed": {
    "pools": [],
    "rules": {
      "mechanical_classes": ["inventory", "summary", "chores"],
      "targets_in_order": ["minimax", "codex"],
      "undispatchable": ${undispatchable}
    }
  }
}
EOF
}

FRESH_AT="$(node -e 'process.stdout.write(new Date(Date.now() - 60000).toISOString())')"
STALE_AT="$(node -e 'process.stdout.write(new Date(Date.now() - 7 * 3600 * 1000).toISOString())')"
BM_FILE="$SHED_TMP/home/projects/capacity/out/burn_more.v1.json"

# (1) fresh signal + Role inventory + Size S -> Engine rewritten, Shed hit line has run_id and engine
write_burn_more "$BM_FILE" "$FRESH_AT" "[]"
SHED_TASK_1=$'Engine: sonnet\nRole: inventory\nSize: S\nLane: alpha\nInventory files.'
__RUN_STDOUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_dispatch_payload "$SHED_TASK_1")")"
assert_contains "$__RUN_STDOUT" 'Engine: minimax' "shed-1: Engine rewritten to minimax"
assert_contains "$__RUN_STDOUT" "Shed: hit engine=minimax run_id=bm-test-001 signal_at=${FRESH_AT}" "shed-1: Shed hit line"

# (2) stale signal (7 hours old) -> Engine unchanged, Shed skipped stale
write_burn_more "$BM_FILE" "$STALE_AT" "[]"
__RUN_STDOUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_dispatch_payload "$SHED_TASK_1")")"
assert_contains "$__RUN_STDOUT" 'Engine: sonnet' "shed-2: Engine unchanged on stale"
assert_contains "$__RUN_STDOUT" 'Shed: skipped reason=stale' "shed-2: Shed skipped stale"

# (3) first target in undispatchable -> next target chosen
write_burn_more "$BM_FILE" "$FRESH_AT" '["minimax"]'
__RUN_STDOUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_dispatch_payload "$SHED_TASK_1")")"
assert_contains "$__RUN_STDOUT" 'Engine: codex' "shed-3: next target codex chosen"
assert_contains "$__RUN_STDOUT" 'Shed: hit engine=codex run_id=bm-test-001' "shed-3: Shed hit codex"

# (4) Role implementer -> untouched
write_burn_more "$BM_FILE" "$FRESH_AT" "[]"
SHED_TASK_4=$'Engine: sonnet\nRole: implementer\nSize: S\nLane: alpha\nImplement feature.'
__RUN_STDOUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_dispatch_payload "$SHED_TASK_4")")"
assert_contains "$__RUN_STDOUT" 'Engine: sonnet' "shed-4: implementer Engine untouched"
assert_not_contains "$__RUN_STDOUT" 'Shed:' "shed-4: implementer has no Shed line"

# (5) Engine-Pin present -> untouched plus skipped pinned
SHED_TASK_5=$'Engine: sonnet\nEngine-Pin: sonnet\nRole: inventory\nSize: S\nLane: alpha\nInventory files.'
__RUN_STDOUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_dispatch_payload "$SHED_TASK_5")")"
assert_contains "$__RUN_STDOUT" 'Engine: sonnet' "shed-5: Engine-Pin keeps sonnet"
assert_contains "$__RUN_STDOUT" 'Shed: skipped reason=pinned' "shed-5: Shed skipped pinned"

# (6) already has a Shed line -> untouched
SHED_TASK_6=$'Engine: sonnet\nRole: inventory\nSize: S\nShed: hit engine=other run_id=old signal_at=2026-01-01T00:00:00Z\nInventory files.'
__RUN_STDOUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_dispatch_payload "$SHED_TASK_6")")"
assert_contains "$__RUN_STDOUT" 'Engine: sonnet' "shed-6: existing Shed line keeps Engine"
assert_contains "$__RUN_STDOUT" 'run_id=old' "shed-6: existing Shed line untouched"

# (7) AUTOPILOT_SHED_ROUTE=0 switches it off
__RUN_STDOUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" AUTOPILOT_SHED_ROUTE=0 node "$HOOK_PATH" <<< "$(build_dispatch_payload "$SHED_TASK_1")")"
assert_contains "$__RUN_STDOUT" 'Engine: sonnet' "shed-7: AUTOPILOT_SHED_ROUTE=0 keeps Engine"
assert_not_contains "$__RUN_STDOUT" 'Shed:' "shed-7: AUTOPILOT_SHED_ROUTE=0 adds no Shed line"

# (8) negative control: mutant hook without applyShedRouting -> case 1 RED, real hook GREEN
MUTANT_SHED="$TEST_TMP/hooks/fleet-dispatch-class.no-shed.js"
mkdir -p "$TEST_TMP/scripts/lib"
cp "$REPO_ROOT/scripts/lib/shed-route.js" "$TEST_TMP/scripts/lib/shed-route.js"
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  const mutated = src.split("const nextTask = applyShedRouting(toolInput);").join("const nextTask = toolInput.task;");
  if (mutated === src) process.exit(2);
  fs.writeFileSync(process.argv[2], mutated, "utf8");
' "$HOOK_PATH" "$MUTANT_SHED"
assert_eq 0 "$?" "shed-8: built no-shed mutant"
NEG_SHED_OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$MUTANT_SHED" <<< "$(build_dispatch_payload "$SHED_TASK_1")")"
assert_not_contains "$NEG_SHED_OUT" 'Shed: hit' "shed-8: negative-control RED without applyShedRouting"

# --- Auto-inject --expect-revision when task references a plan sha ---
# (1) positive: Plan: <path>@<sha> + dispatch-plan-review.js without --expect-revision -> injects --expect-revision <sha>
EXP_REV_TASK_1=$'Engine: sonnet\nRole: plan-reviewer\nSize: M\nPlan: docs/plans/2026-11-26-sample.md@abc1234\nRun node scripts/dispatch-plan-review.js --plan-file docs/plans/2026-11-26-sample.md'
__RUN_STDOUT="$(node "$HOOK_PATH" <<< "$(build_dispatch_payload "$EXP_REV_TASK_1")")"
assert_contains "$__RUN_STDOUT" '--expect-revision abc1234' "expect-rev-1: injects --expect-revision abc1234"

# (2) negative: no sha (Plan: plan-first) -> unchanged
EXP_REV_TASK_2=$'Engine: sonnet\nRole: plan-reviewer\nSize: M\nPlan: plan-first\nRun node scripts/dispatch-plan-review.js --plan-file docs/plans/2026-11-26-sample.md'
__RUN_STDOUT="$(node "$HOOK_PATH" <<< "$(build_dispatch_payload "$EXP_REV_TASK_2")")"
assert_not_contains "$__RUN_STDOUT" '--expect-revision' "expect-rev-2: no sha leaves command unchanged"

# (3) negative: already has --expect-revision -> unchanged
EXP_REV_TASK_3=$'Engine: sonnet\nRole: plan-reviewer\nSize: M\nPlan: docs/plans/2026-11-26-sample.md@abc1234\nRun node scripts/dispatch-plan-review.js --expect-revision def5678 --plan-file docs/plans/2026-11-26-sample.md'
__RUN_STDOUT="$(node "$HOOK_PATH" <<< "$(build_dispatch_payload "$EXP_REV_TASK_3")")"
assert_contains "$__RUN_STDOUT" '--expect-revision def5678' "expect-rev-3: preserves explicit --expect-revision"
assert_not_contains "$__RUN_STDOUT" '--expect-revision abc1234' "expect-rev-3: does not duplicate --expect-revision"

finalize_test
