#!/usr/bin/env bash
# Test for agent-dispatch-shed.js PreToolUse hook (matcher: Task|Agent)
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID
. "$(dirname "$0")/lib.sh"

HOOK_PATH="$REPO_ROOT/hooks/agent-dispatch-shed.js"

build_agent_payload() {
  local prompt="$1"
  local tool="${2:-Task}"
  node -e '
    const [prompt, tool] = process.argv.slice(1);
    const tool_input = {
      description: "run inventory",
      prompt,
      subagent_type: "general-purpose",
    };
    process.stdout.write(JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input,
    }));
  ' "$prompt" "$tool"
}

# run_hook_direct <payload> — signal env pinned to the per-test sandbox (the
# burn_more path points at the test's own file, never the seat's real one).
# sets OUT and RC for the last hook invocation.
OUT=""
RC=0
invoke_hook() {
  local payload="$1"
  OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$payload")"
  RC=$?
}

# assert_allow_with_rewritten_prompt <raw_stdout> <want_prompt> <label>
assert_allow_with_rewritten_prompt() {
  local raw_stdout="$1"
  local want_prompt="$2"
  local label="$3"
  local check_out
  check_out="$(node -e '
    const [raw, wantPrompt] = process.argv.slice(1);
    const parsed = JSON.parse(raw);
    const h = parsed && parsed.hookSpecificOutput;
    if (!h) process.exit(2);
    if (h.hookEventName !== "PreToolUse") process.exit(3);
    if (h.permissionDecision !== "allow") process.exit(4);
    const u = h.updatedInput;
    if (!u || typeof u !== "object") process.exit(5);
    if (u.prompt !== wantPrompt) process.exit(6);
    if (u.description !== "run inventory") process.exit(7);
    if (u.subagent_type !== "general-purpose") process.exit(8);
    process.stdout.write("ok");
  ' "$raw_stdout" "$want_prompt" 2>/dev/null || true)"
  assert_eq "$check_out" "ok" "${label}: allow + updatedInput.prompt rewritten + preserves description/subagent_type"
}

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

# 0. hook is silent on absent prompt / foreign tool / malformed stdin
invoke_hook "$(build_agent_payload "")"
assert_eq "$RC" 0 "empty-prompt: exit 0"
assert_eq "$OUT" "" "empty-prompt: silent stdout"
invoke_hook "$(build_agent_payload $'Engine: sonnet\nRole: inventory\nSize: S\nInventory files.' "Bash")"
assert_eq "$RC" 0 "foreign tool: exit 0"
assert_eq "$OUT" "" "foreign tool: silent stdout"
invoke_hook "not-json"
assert_eq "$RC" 0 "malformed stdin: exit 0"
assert_eq "$OUT" "" "malformed stdin: silent stdout"

# 1. fresh signal + Role inventory + Size S -> Engine rewritten, Shed hit line after the header block
write_burn_more "$BM_FILE" "$FRESH_AT" "[]"
SHED_PROMPT_1=$'Engine: sonnet\nRole: inventory\nSize: S\nLane: alpha\nInventory files.'
SHED_WANT_1=$'Engine: minimax\nRole: inventory\nSize: S\nLane: alpha\nShed: hit engine=minimax run_id=bm-test-001 signal_at='"$FRESH_AT"$'\nInventory files.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
assert_eq "$RC" 0 "shed-1: exit 0"
assert_allow_with_rewritten_prompt "$OUT" "$SHED_WANT_1" "shed-1"

# 2. stale signal (7 hours old) -> Engine unchanged, Shed skipped stale
write_burn_more "$BM_FILE" "$STALE_AT" "[]"
SHED_WANT_2=$'Engine: sonnet\nRole: inventory\nSize: S\nLane: alpha\nShed: skipped reason=stale\nInventory files.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
assert_allow_with_rewritten_prompt "$OUT" "$SHED_WANT_2" "shed-2"

# 3. first target in undispatchable -> next target chosen
write_burn_more "$BM_FILE" "$FRESH_AT" '["minimax"]'
SHED_WANT_3=$'Engine: codex\nRole: inventory\nSize: S\nLane: alpha\nShed: hit engine=codex run_id=bm-test-001 signal_at='"$FRESH_AT"$'\nInventory files.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
assert_allow_with_rewritten_prompt "$OUT" "$SHED_WANT_3" "shed-3"

# 4. Role implementer -> untouched, silent (no rewrite, no output)
write_burn_more "$BM_FILE" "$FRESH_AT" "[]"
SHED_PROMPT_4=$'Engine: sonnet\nRole: implementer\nSize: S\nLane: alpha\nImplement feature.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_4")"
assert_eq "$RC" 0 "shed-4: exit 0"
assert_eq "$OUT" "" "shed-4: implementer brief untouched and silent"

# 5. Engine-Pin present -> untouched Engine, skipped pinned
SHED_PROMPT_5=$'Engine: sonnet\nEngine-Pin: sonnet\nRole: inventory\nSize: S\nLane: alpha\nInventory files.'
SHED_WANT_5=$'Engine: sonnet\nEngine-Pin: sonnet\nRole: inventory\nSize: S\nLane: alpha\nShed: skipped reason=pinned\nInventory files.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_5")"
assert_allow_with_rewritten_prompt "$OUT" "$SHED_WANT_5" "shed-5"

# 6. already has a Shed line -> untouched and silent
SHED_PROMPT_6=$'Engine: sonnet\nRole: inventory\nSize: S\nShed: hit engine=other run_id=old signal_at=2026-01-01T00:00:00Z\nInventory files.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_6")"
assert_eq "$RC" 0 "shed-6: exit 0"
assert_eq "$OUT" "" "shed-6: existing Shed line untouched and silent"

# 7. AUTOPILOT_SHED_ROUTE=0 switches it off
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" AUTOPILOT_SHED_ROUTE=0 node "$HOOK_PATH" <<< "$(build_agent_payload "$SHED_PROMPT_1")")"
RC=$?
assert_eq "$RC" 0 "shed-7: exit 0"
assert_eq "$OUT" "" "shed-7: AUTOPILOT_SHED_ROUTE=0 silent"

# 8. tool_name Agent (not just Task) also gets shed routing
OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_agent_payload "$SHED_PROMPT_1" "Agent")")"
RC=$?
assert_allow_with_rewritten_prompt "$OUT" "$SHED_WANT_1" "shed-8: Agent tool name routed like Task"

# 9. negative control: mutant hook without the applyShedRouting call -> case 1 RED, real hook GREEN
MUTANT_SHED="$TEST_TMP/hooks/agent-dispatch-shed.no-shed.js"
mkdir -p "$TEST_TMP/hooks/lib" "$TEST_TMP/scripts/lib"
cp "$REPO_ROOT/hooks/fleet-dispatch-class.js" "$TEST_TMP/hooks/"
cp "$REPO_ROOT/hooks/lib/gate-hint.js" "$TEST_TMP/hooks/lib/"
cp "$REPO_ROOT/scripts/lib/shed-route.js" "$TEST_TMP/scripts/lib/"
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  const mutated = src.split("const nextPrompt = applyShedRouting({ task: prompt, size: toolInput.size });").join("const nextPrompt = prompt;");
  if (mutated === src) process.exit(2);
  fs.writeFileSync(process.argv[2], mutated, "utf8");
' "$HOOK_PATH" "$MUTANT_SHED"
assert_eq "$?" 0 "shed-9: built no-shed mutant"
NEG_SHED_OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$MUTANT_SHED" <<< "$(build_agent_payload "$SHED_PROMPT_1")")"
assert_not_contains "$NEG_SHED_OUT" 'Shed: hit' "shed-9: negative-control RED without applyShedRouting"
OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_agent_payload "$SHED_PROMPT_1")")"
RC=$?
assert_contains "$OUT" 'Shed: hit engine=minimax' "shed-9: GREEN on real hook"

finalize_test
