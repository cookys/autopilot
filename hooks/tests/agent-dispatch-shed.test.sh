#!/usr/bin/env bash
# Test for agent-dispatch-shed.js PreToolUse hook (matcher: Task|Agent)
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID
. "$(dirname "$0")/lib.sh"

HOOK_PATH="$REPO_ROOT/hooks/agent-dispatch-shed.js"

build_agent_payload() {
  local prompt="$1"
  local tool="${2:-Task}"
  local model="${3-__OMIT__}"
  node -e '
    const [prompt, tool, model] = process.argv.slice(1);
    const tool_input = {
      description: "run inventory",
      prompt,
      subagent_type: "general-purpose",
    };
    if (model !== "__OMIT__") tool_input.model = model;
    process.stdout.write(JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input,
    }));
  ' "$prompt" "$tool" "$model"
}

# run_hook_direct: sets OUT and RC for the last hook invocation.
# Signal env is pinned to the per-test sandbox (the burn_more path points at
# the test's own file, never the seat's real one).
OUT=""
RC=0
invoke_hook() {
  local payload="$1"
  OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$payload")"
  RC=$?
}

# assert_deny_with_target <raw_stdout> <target> <label>
# deny, reason names the dispatch-hetero reroute with the shed target, and the
# tool_input is never rewritten (no updatedInput => model/prompt stay as sent).
assert_deny_with_target() {
  local raw_stdout="$1"
  local target="$2"
  local label="$3"
  local check_out
  check_out="$(node -e '
    const [raw, wantTarget] = process.argv.slice(1);
    const parsed = JSON.parse(raw);
    const h = parsed && parsed.hookSpecificOutput;
    if (!h) process.exit(2);
    if (h.hookEventName !== "PreToolUse") process.exit(3);
    if (h.permissionDecision !== "deny") process.exit(4);
    if (h.updatedInput !== undefined) process.exit(5);
    const r = h.permissionDecisionReason || "";
    if (!r.includes("dispatch-hetero.sh --runner " + wantTarget)) process.exit(6);
    if (!r.includes("run_id=bm-test-001")) process.exit(7);
    process.stdout.write("ok");
  ' "$raw_stdout" "$target" 2>/dev/null || true)"
  assert_eq "$check_out" "ok" "${label}: deny + reason names dispatch-hetero --runner ${target} + no updatedInput (model/prompt untouched)"
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

# 1. fresh signal + Role inventory + Size S -> deny with the shed target named
write_burn_more "$BM_FILE" "$FRESH_AT" "[]"
SHED_PROMPT_1=$'Engine: sonnet\nRole: inventory\nSize: S\nLane: alpha\nInventory files.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
assert_eq "$RC" 0 "shed-1: exit 0"
assert_deny_with_target "$OUT" "minimax" "shed-1"

# 2. stale signal (7 hours old) -> pass untouched and silent
write_burn_more "$BM_FILE" "$STALE_AT" "[]"
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
assert_eq "$RC" 0 "shed-2: exit 0"
assert_eq "$OUT" "" "shed-2: stale signal passes silently"

# 3. first target in undispatchable -> deny names the next target
write_burn_more "$BM_FILE" "$FRESH_AT" '["minimax"]'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
assert_deny_with_target "$OUT" "codex" "shed-3"

# 4. Role implementer -> not mechanical, silent
write_burn_more "$BM_FILE" "$FRESH_AT" "[]"
SHED_PROMPT_4=$'Engine: sonnet\nRole: implementer\nSize: S\nLane: alpha\nImplement feature.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_4")"
assert_eq "$RC" 0 "shed-4: exit 0"
assert_eq "$OUT" "" "shed-4: implementer brief passes silently"

# 5. Engine-Pin present -> caller pinned the engine, silent pass
SHED_PROMPT_5=$'Engine: sonnet\nEngine-Pin: sonnet\nRole: inventory\nSize: S\nLane: alpha\nInventory files.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_5")"
assert_eq "$RC" 0 "shed-5: exit 0"
assert_eq "$OUT" "" "shed-5: Engine-Pin passes silently"

# 6. already has a Shed line -> caller already routed, silent pass
SHED_PROMPT_6=$'Engine: sonnet\nRole: inventory\nSize: S\nShed: hit engine=other run_id=old signal_at=2026-01-01T00:00:00Z\nInventory files.'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_6")"
assert_eq "$RC" 0 "shed-6: exit 0"
assert_eq "$OUT" "" "shed-6: existing Shed line passes silently"

# 7. AUTOPILOT_SHED_ROUTE=0 switches it off
OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" AUTOPILOT_SHED_ROUTE=0 node "$HOOK_PATH" <<< "$(build_agent_payload "$SHED_PROMPT_1")")"
RC=$?
assert_eq "$RC" 0 "shed-7: exit 0"
assert_eq "$OUT" "" "shed-7: AUTOPILOT_SHED_ROUTE=0 silent"

# 8. tool_name Agent (not just Task) is routed the same
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1" "Agent")"
assert_deny_with_target "$OUT" "minimax" "shed-8: Agent tool name routed like Task"

# 9. explicit model:"haiku" stays untouched: deny never rewrites tool_input,
#    so the audit cannot claim a shed engine the subagent does not run on
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1" "Task" "haiku")"
assert_deny_with_target "$OUT" "minimax" "shed-9: model haiku denied with reroute, prompt/model untouched"

# 10. negative control: mutant hook without the applyShedRouting call -> case 1 RED, real hook GREEN
MUTANT_SHED="$TEST_TMP/hooks/agent-dispatch-shed.no-shed.js"
mkdir -p "$TEST_TMP/hooks/lib" "$TEST_TMP/scripts/lib"
cp "$REPO_ROOT/hooks/fleet-dispatch-class.js" "$TEST_TMP/hooks/"
cp "$REPO_ROOT/hooks/lib/gate-hint.js" "$TEST_TMP/hooks/lib/"
cp "$REPO_ROOT/scripts/lib/shed-route.js" "$TEST_TMP/scripts/lib/"
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  const mutated = src.split("const routed = applyShedRouting({ task: prompt, size: toolInput.size });").join("const routed = prompt;");
  if (mutated === src) process.exit(2);
  fs.writeFileSync(process.argv[2], mutated, "utf8");
' "$HOOK_PATH" "$MUTANT_SHED"
assert_eq "$?" 0 "shed-10: built no-shed mutant"
NEG_SHED_OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$MUTANT_SHED" <<< "$(build_agent_payload "$SHED_PROMPT_1")")"
assert_not_contains "$NEG_SHED_OUT" 'dispatch-hetero' "shed-10: negative-control RED without applyShedRouting"
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
assert_contains "$OUT" 'dispatch-hetero.sh --runner minimax' "shed-10: GREEN on real hook"

# 11. RT(1): non-Claude chair + subagent without model -> inherit (never haiku); Claude chair keeps the haiku row
resolve_model() { # $1 chair family
  AUTOPILOT_CHAIR_FAMILY="$1" node -e '
    const { resolveSubagentModel } = require(process.argv[1]);
    process.stdout.write(String(resolveSubagentModel({ prompt: process.argv[2] })));
  ' "$HOOK_PATH" "$SHED_PROMPT_1" 2>/dev/null
}
assert_eq "$(resolve_model local)" "inherit" "rt-1: local chair, no model -> inherit"
assert_eq "$(resolve_model glm-5)" "inherit" "rt-1: non-Claude chair, no model -> inherit"
assert_eq "$(resolve_model claude)" "haiku" "rt-1: Claude chair keeps the haiku row"

# 11b. RT(1) end-to-end through the hook entry: non-Claude chair, no model -> updatedInput.model=inherit
write_burn_more "$BM_FILE" "$STALE_AT" "[]"
e2e_model() { # $1 chair, $2 model arg to build_agent_payload (omit = none)
  local o
  o="$(AUTOPILOT_CHAIR_FAMILY="$1" HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_agent_payload "$SHED_PROMPT_1" Task ${2:+"$2"})")"
  node -e 'const r=process.argv[1]; if(!r){process.stdout.write("none");process.exit(0)} const h=JSON.parse(r).hookSpecificOutput; process.stdout.write(h.updatedInput?String(h.updatedInput.model):"deny")' "$o"
}
assert_eq "$(e2e_model local)" "inherit" "rt-1 e2e: local chair, no model -> hook pins inherit"
assert_eq "$(e2e_model claude)" "none" "rt-1 e2e: Claude chair untouched"
assert_eq "$(e2e_model local haiku)" "none" "rt-1 e2e: explicit model never rewritten"

# 12. RT(2): pool tight -> agy, codex first, grok removed
write_burn_more_targets() { # $1 targets json, $2 undispatchable json
  write_burn_more "$BM_FILE" "$FRESH_AT" "${2:-[]}"
  sed -i "s/\"targets_in_order\": \[[^]]*\]/\"targets_in_order\": $1/" "$BM_FILE"
}
tight_hook() { OUT="$(HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" AUTOPILOT_POOL_TIGHT=1 node "$HOOK_PATH" <<< "$(build_agent_payload "$SHED_PROMPT_1")")"; }
write_burn_more_targets '["grok","codex","agy"]'
tight_hook
assert_deny_with_target "$OUT" "agy" "rt-2: tight pool picks agy first, not grok"
write_burn_more_targets '["grok","codex","agy"]' '["agy"]'
tight_hook
assert_deny_with_target "$OUT" "codex" "rt-2: agy undispatchable -> codex"
write_burn_more_targets '["grok"]'
tight_hook
assert_eq "$OUT" "" "rt-2: grok-only list under a tight pool never reassigns to grok"
write_burn_more_targets '["grok","codex"]'
invoke_hook "$(build_agent_payload "$SHED_PROMPT_1")"
assert_deny_with_target "$OUT" "grok" "rt-2: pool not tight keeps the signal order (grok allowed)"

# 13. RT(3): transcript-type work from a non-Claude chair is blocked
TRANSCRIPT_PROMPT=$'Engine: sonnet\nWork-Class: transcript\nRole: implementer\nSize: M\nSummarize the session transcript.'
OUT="$(AUTOPILOT_CHAIR_FAMILY=local HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_agent_payload "$TRANSCRIPT_PROMPT")")"
assert_contains "$OUT" '"permissionDecision":"deny"' "rt-3: non-Claude chair + transcript work denied"
assert_contains "$OUT" 'transcript' "rt-3: reason names transcript"
OUT="$(AUTOPILOT_CHAIR_FAMILY=claude HOME="$SHED_TMP/home" AUTOPILOT_BURN_MORE="$BM_FILE" node "$HOOK_PATH" <<< "$(build_agent_payload "$TRANSCRIPT_PROMPT")")"
assert_eq "$OUT" "" "rt-3: Claude chair + transcript work passes"

finalize_test
