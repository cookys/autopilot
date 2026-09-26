#!/usr/bin/env bash
# hook-advisory-channel.test.sh — group-T default-on advisories must reach the
# model via stdout JSON (stderr on exit 0 never does).
#
# RED at 0a57d55e: all five warn/advisory paths exit 0 with empty stdout (JSON parse fails: Unexpected end of JSON input)
. "$(dirname "$0")/lib.sh"

export XDG_RUNTIME_DIR="$TEST_TMP/xdg-runtime"
mkdir -p "$XDG_RUNTIME_DIR"

# RAM-backed live dir so resolveLiveDir never falls through to a real ~/.autopilot.
LIVE_DIR=""
if [ -d /dev/shm ]; then
  LIVE_DIR="$(mktemp -d /dev/shm/ha-p1a-live-XXXXXX)"
else
  LIVE_DIR="$TEST_TMP/live"
  mkdir -p "$LIVE_DIR"
fi
export AUTOPILOT_LIVE_DIR="$LIVE_DIR"
cleanup_live() {
  [ -n "${LIVE_DIR:-}" ] && rm -rf "$LIVE_DIR"
}
trap 'cleanup_live; cleanup_test_tmp' EXIT

assert_advisory_stdout() {
  local event="$1"
  local label="$2"
  local parsed
  parsed="$(node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
const stderr = process.argv[1];
const event = process.argv[2];
let obj;
try { obj = JSON.parse(raw); } catch (e) {
  process.stderr.write("not-json:" + e.message + "\n");
  process.exit(2);
}
const hso = obj && obj.hookSpecificOutput;
if (!hso || typeof hso !== "object") { process.stderr.write("missing hookSpecificOutput\n"); process.exit(3); }
if (hso.hookEventName !== event) {
  process.stderr.write("event got=" + JSON.stringify(hso.hookEventName) + " want=" + JSON.stringify(event) + "\n");
  process.exit(4);
}
if (hso.additionalContext !== stderr) {
  process.stderr.write("additionalContext mismatch\n");
  process.exit(5);
}
function walk(v) {
  if (v && typeof v === "object") {
    if (Object.prototype.hasOwnProperty.call(v, "permissionDecision")) process.exit(6);
    for (const k of Object.keys(v)) walk(v[k]);
  }
}
walk(obj);
' "$__RUN_STDERR" "$event" <<< "$__RUN_STDOUT")"
  local rc=$?
  assert_eq "$rc" 0 "$label: stdout JSON additionalContext byte-matches stderr, event=$event, no permissionDecision (node rc=$rc)"
}

# ── 1. cost-fuse warn ─────────────────────────────────────────────────
TODAY=$(node -e 'process.stdout.write(new Date().toISOString().slice(0, 10))')
export AUTOPILOT_COST_FUSE_DIR="$TEST_TMP/cost-fuse"
export AUTOPILOT_COSTS_FILE="$TEST_TMP/costs.jsonl"
unset AUTOPILOT_COST_FUSE_MODE AUTOPILOT_COST_FUSE_DAILY_USD
TRANSCRIPT_FILE="$TEST_TMP/transcript.jsonl"
cat > "$TRANSCRIPT_FILE" <<EOF
{"type":"user","message":{"role":"user","content":"hi"}}
{"type":"assistant","message":{"role":"assistant","model":"claude-fable-5-1","content":"hello"}}
EOF
cat > "$AUTOPILOT_COSTS_FILE" <<EOF
{"ts":"${TODAY}T01:00:00.000Z","session":"fuse-session-1","model":"claude-fable-5-1","cost_usd":200}
EOF
COST_PAYLOAD=$(printf '{"tool_name":"Edit","session_id":"fuse-session-1","transcript_path":"%s","tool_input":{},"hook_event_name":"PreToolUse"}' "$TRANSCRIPT_FILE")
run_hook cost-fuse.js "$COST_PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "cost-fuse: exit 0 on warn"
assert_contains "$__RUN_STDERR" "cost-fuse" "cost-fuse: stderr still has advisory"
assert_advisory_stdout "PreToolUse" "cost-fuse"

# ── 2. context-budget T1 (inference path, no live file) ───────────────
CTX_TRANSCRIPT="$TEST_TMP/ctx-transcript.jsonl"
# 50k+60k+1k+10 = 111010 ≥ default t1 100k, below t2 150k
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":50000,"cache_read_input_tokens":60000,"cache_creation_input_tokens":1000,"output_tokens":10}}}' > "$CTX_TRANSCRIPT"
export AUTOPILOT_CONTEXT_BUDGET_DIR="$TEST_TMP/ctx-budget-state"
mkdir -p "$AUTOPILOT_CONTEXT_BUDGET_DIR"
CTX_PAYLOAD=$(printf '{"transcript_path":"%s","session_id":"ctx-t1-sid","hook_event_name":"PostToolUse"}' "$CTX_TRANSCRIPT")
run_hook context-budget.js "$CTX_PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "context-budget T1: exit 0"
assert_contains "$__RUN_STDERR" "Context budget T1" "context-budget T1: stderr still has advisory"
assert_advisory_stdout "PostToolUse" "context-budget T1"

# ── 3. depth0-delegate-gate nudge at threshold 8 ──────────────────────
D0_PAYLOAD='{"tool_name":"Read","session_id":"d0-adv-sid","tool_input":{},"hook_event_name":"PreToolUse"}'
i=1
while [ "$i" -le 8 ]; do
  run_hook depth0-delegate-gate.js "$D0_PAYLOAD"
  i=$((i + 1))
done
assert_eq 0 "$__RUN_EXIT" "depth0-delegate-gate: exit 0 on nudge"
assert_contains "$__RUN_STDERR" "consecutive read-class calls" "depth0-delegate-gate: stderr still has advisory"
assert_advisory_stdout "PreToolUse" "depth0-delegate-gate"

# ── 4. reload-watch detected mtime change ─────────────────────────────
INSTALLED="$HOOK_HOME/.claude/plugins/installed_plugins.json"
STATE_FILE="$HOOK_HOME/.claude/plugins/.reload-watch-state.json"
mkdir -p "$(dirname "$INSTALLED")"
echo '{}' > "$INSTALLED"
run_hook reload-watch.js '{}'
echo '{"plugins":{"autopilot@autopilot":[]}}' > "$INSTALLED"
touch -d "1 minute ago" "$STATE_FILE" 2>/dev/null || true
touch "$INSTALLED"
run_hook reload-watch.js '{}'
assert_eq 0 "$__RUN_EXIT" "reload-watch: exit 0 on advisory"
assert_contains "$__RUN_STDERR" "Plugin catalog signal changed" "reload-watch: stderr still has advisory"
assert_advisory_stdout "PostToolUse" "reload-watch"

# ── 5. dispatch-model-guard mode=warn (handleGuard) ───────────────────
printf '%s\n' "- mode: warn" > "$TEST_TMP/dguard-warn.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/dguard-warn.md"
DMG_PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$DMG_PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "dispatch-model-guard warn: exit 0"
assert_contains "$__RUN_STDERR" "dispatch-model-guard" "dispatch-model-guard: stderr still has advisory"
assert_advisory_stdout "PreToolUse" "dispatch-model-guard"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# ── 6. negative control: none of the five emit permissionDecision ─────
assert_no_permission_decision() {
  local label="$1"
  node -e '
const raw = require("fs").readFileSync(0, "utf8");
if (!String(raw).trim()) process.exit(0);
const obj = JSON.parse(raw);
function walk(v) {
  if (v && typeof v === "object") {
    if (Object.prototype.hasOwnProperty.call(v, "permissionDecision")) process.exit(1);
    for (const k of Object.keys(v)) walk(v[k]);
  }
}
walk(obj);
' <<< "$__RUN_STDOUT"
  assert_eq 0 "$?" "$label: no permissionDecision on stdout"
}

# Re-drive each warn/advisory branch (fresh cost-fuse session so warn fires again).
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(printf '{"tool_name":"Edit","session_id":"fuse-session-neg","transcript_path":"%s","tool_input":{},"hook_event_name":"PreToolUse"}' "$TRANSCRIPT_FILE")"
assert_no_permission_decision "neg-cost-fuse"

export AUTOPILOT_CONTEXT_BUDGET_DIR="$TEST_TMP/ctx-budget-state-neg"
mkdir -p "$AUTOPILOT_CONTEXT_BUDGET_DIR"
run_hook context-budget.js "$(printf '{"transcript_path":"%s","session_id":"ctx-t1-neg","hook_event_name":"PostToolUse"}' "$CTX_TRANSCRIPT")"
assert_no_permission_decision "neg-context-budget"

D0_NEG='{"tool_name":"Read","session_id":"d0-neg-sid","tool_input":{},"hook_event_name":"PreToolUse"}'
i=1
while [ "$i" -le 8 ]; do
  run_hook depth0-delegate-gate.js "$D0_NEG"
  i=$((i + 1))
done
assert_no_permission_decision "neg-depth0"

# reload-watch already saved state after fire; bump mtime again
echo '{"plugins":{"autopilot@autopilot":["x"]}}' > "$INSTALLED"
touch "$INSTALLED"
run_hook reload-watch.js '{}'
assert_no_permission_decision "neg-reload-watch"

printf '%s\n' "- mode: warn" > "$TEST_TMP/dguard-warn.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/dguard-warn.md"
run_hook dispatch-model-guard.js "$DMG_PAYLOAD"
assert_no_permission_decision "neg-dispatch-model-guard"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# RED at 0a57d55e: group-T opt-in advisories still stderr-only (empty stdout);
# multiplexer concatenates child JSON instead of merging additionalContext
# RED at 0a57d55e: ha-p1b six opt-in hooks + multiplexer merge/exit-2/allow-drop all fail on unmodified base

# Capture a hook with optional cwd / extra argv (mcp-health pre|failure, git cwd).
capture_node() {
  local cwd="$1"
  local hook="$2"
  shift 2
  local stdout_file="$TEST_TMP/.stdout.$$"
  local stderr_file="$TEST_TMP/.stderr.$$"
  (
    cd "$cwd" || exit 1
    HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" \
      CLAUDE_PLUGIN_ROOT="${CAPTURE_PLUGIN_ROOT:-$REPO_ROOT}" \
      node "$HOOKS_DIR/$hook" "$@" >"$stdout_file" 2>"$stderr_file" <<< "${CAPTURE_STDIN}"
  )
  __RUN_EXIT=$?
  __RUN_STDOUT=$(cat "$stdout_file")
  __RUN_STDERR=$(cat "$stderr_file")
  rm -f "$stdout_file" "$stderr_file"
}

# ── 7. orchestrator-edit-gate warn ────────────────────────────────────
export AUTOPILOT_HOOK_ORCHESTRATOR_EDIT_GATE=1
export AUTOPILOT_ORCH_EDIT_GATE_MODE=warn
OEG_REPO="$TEST_TMP/oeg-repo"
mkdir -p "$OEG_REPO/src"
git -C "$OEG_REPO" init -b main >/dev/null
OEG_MARKERS="$TEST_TMP/oeg-markers"
mkdir -p "$OEG_MARKERS"
export AUTOPILOT_SESSION_MODE_DIR="$OEG_MARKERS"
export CLAUDE_CODE_SESSION_ID="oeg-adv-sid"
HOME="$HOOK_HOME" AUTOPILOT_SESSION_MODE_DIR="$OEG_MARKERS" CLAUDE_CODE_SESSION_ID="oeg-adv-sid" \
  node "$REPO_ROOT/scripts/session-mode.js" set --level l5 --repo-root "$OEG_REPO" >/dev/null
OEG_FILE="$OEG_REPO/src/gated.js"
touch "$OEG_FILE"
CAPTURE_STDIN=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s","old_string":"a","new_string":"b"},"hook_event_name":"PreToolUse"}' "$OEG_FILE")
capture_node "$OEG_REPO" orchestrator-edit-gate.js
assert_eq 0 "$__RUN_EXIT" "orchestrator-edit-gate warn: exit 0"
assert_contains "$__RUN_STDERR" "orchestrator-edit-gate warn" "orchestrator-edit-gate: stderr still has advisory"
assert_advisory_stdout "PreToolUse" "orchestrator-edit-gate warn"
unset AUTOPILOT_HOOK_ORCHESTRATOR_EDIT_GATE AUTOPILOT_ORCH_EDIT_GATE_MODE AUTOPILOT_SESSION_MODE_DIR CLAUDE_CODE_SESSION_ID

# ── 8. branch-protection merge warn on protected branch ───────────────
export AUTOPILOT_HOOK_BRANCH_PROTECTION=1
BP_REPO="$TEST_TMP/bp-repo"
mkdir -p "$BP_REPO"
git -C "$BP_REPO" init -b main >/dev/null
git -C "$BP_REPO" config user.email "t@t.t"
git -C "$BP_REPO" config user.name "t"
echo x > "$BP_REPO/f"
git -C "$BP_REPO" add f
git -C "$BP_REPO" commit -m init >/dev/null
CAPTURE_STDIN='{"tool_name":"Bash","tool_input":{"command":"git merge other"},"hook_event_name":"PreToolUse"}'
capture_node "$BP_REPO" branch-protection.js
assert_eq 0 "$__RUN_EXIT" "branch-protection warn: exit 0"
assert_contains "$__RUN_STDERR" "WARNING: Mutation on protected branch" "branch-protection: stderr still has advisory"
assert_advisory_stdout "PreToolUse" "branch-protection"
unset AUTOPILOT_HOOK_BRANCH_PROTECTION

# ── 9. large-file-warner size-warn (not block) ────────────────────────
export AUTOPILOT_HOOK_LARGE_FILE_WARNER=1
LFW_FILE="$TEST_TMP/largetarget.bin"
dd if=/dev/zero of="$LFW_FILE" bs=1024 count=600 status=none
CAPTURE_STDIN=$(printf '{"tool_name":"Read","tool_input":{"file_path":"%s"},"hook_event_name":"PreToolUse"}' "$LFW_FILE")
capture_node "$TEST_TMP" large-file-warner.js
assert_eq 0 "$__RUN_EXIT" "large-file-warner warn: exit 0"
assert_contains "$__RUN_STDERR" "WARNING:" "large-file-warner: stderr still has advisory"
assert_advisory_stdout "PreToolUse" "large-file-warner"
unset AUTOPILOT_HOOK_LARGE_FILE_WARNER

# ── 10. design-quality generic CTA ────────────────────────────────────
export AUTOPILOT_HOOK_DESIGN_QUALITY=1
DQ_FILE="$TEST_TMP/Hero.tsx"
printf '%s\n' 'export const cta = "Get Started";' > "$DQ_FILE"
CAPTURE_STDIN=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"},"hook_event_name":"PostToolUse"}' "$DQ_FILE")
capture_node "$TEST_TMP" design-quality.js
assert_eq 0 "$__RUN_EXIT" "design-quality: exit 0"
assert_contains "$__RUN_STDERR" "Design quality check" "design-quality: stderr still has advisory"
assert_advisory_stdout "PostToolUse" "design-quality"
unset AUTOPILOT_HOOK_DESIGN_QUALITY

# ── 11. test-runner sibling failure ───────────────────────────────────
export AUTOPILOT_HOOK_TEST_RUNNER=1
TR_DIR="$TEST_TMP/tr-proj"
mkdir -p "$TR_DIR/node_modules/.bin" "$TR_DIR/src"
printf '%s\n' 'module.exports = 1;' > "$TR_DIR/src/mod.js"
printf '%s\n' 'throw new Error("fail");' > "$TR_DIR/src/mod.test.js"
printf '%s\n' '#!/bin/sh' 'echo vitest-fail-output' 'exit 1' > "$TR_DIR/node_modules/.bin/vitest"
chmod +x "$TR_DIR/node_modules/.bin/vitest"
CAPTURE_STDIN=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"},"hook_event_name":"PostToolUse"}' "$TR_DIR/src/mod.js")
capture_node "$TR_DIR" test-runner.js
assert_eq 0 "$__RUN_EXIT" "test-runner: exit 0"
assert_contains "$__RUN_STDERR" "Test failure for" "test-runner: stderr still has advisory"
assert_advisory_stdout "PostToolUse" "test-runner"
unset AUTOPILOT_HOOK_TEST_RUNNER

# ── 12. mcp-health failure argv (PostToolUseFailure advisory) ─────────
export AUTOPILOT_HOOK_MCP_HEALTH=1
mkdir -p "$HOOK_HOME/.claude"
CAPTURE_STDIN='{"tool_name":"mcp__demo__call","tool_output":"ECONNREFUSED connection failed","hook_event_name":"PostToolUseFailure"}'
capture_node "$TEST_TMP" mcp-health.js failure
assert_eq 0 "$__RUN_EXIT" "mcp-health failure: exit 0"
assert_contains "$__RUN_STDERR" "marked unhealthy" "mcp-health failure: stderr still has advisory"
assert_advisory_stdout "PostToolUseFailure" "mcp-health failure"

# ── 13. mcp-health pre argv (unhealthy window still writes model text) ─
# pre's model-facing write currently exits 2. Tests still require the advisory
# JSON channel (exit 0 is the failure-path sibling above). Drive the write via
# a healthy retry-window expiry so the hook stays exit 0: seed lastError and
# nextRetry in the past, then... that path does NOT write. The only pre write
# is the unhealthy+backoff branch. Emit JSON on that write; keep exit 2 in
# product. This case asserts the JSON channel on the write (exit remains 2).
HOME="$HOOK_HOME" node -e '
const fs = require("fs");
const path = require("path");
const p = path.join(process.env.HOME, ".claude", "mcp-health-cache.json");
fs.mkdirSync(path.dirname(p), { recursive: true });
fs.writeFileSync(p, JSON.stringify({
  demo: { healthy: false, failures: 2, nextRetry: Date.now() + 60000, lastError: "ECONNREFUSED" }
}, null, 2));
'
CAPTURE_STDIN='{"tool_name":"mcp__demo__call","hook_event_name":"PreToolUse"}'
capture_node "$TEST_TMP" mcp-health.js pre
assert_eq 2 "$__RUN_EXIT" "mcp-health pre: exit 2 (deny path unchanged)"
assert_contains "$__RUN_STDERR" "is unhealthy" "mcp-health pre: stderr still has advisory"
assert_advisory_stdout "PreToolUse" "mcp-health pre"
unset AUTOPILOT_HOOK_MCP_HEALTH

# ── 14. multiplexer: two advising children merge ──────────────────────
MUX_ROOT="$TEST_TMP/mux-plugin"
mkdir -p "$MUX_ROOT/hooks"
printf '%s\n' '#!/usr/bin/env node
process.stderr.write("ADV-A-STDERR\n");
process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"ADV-A-STDERR"}})+"\n");
' > "$MUX_ROOT/hooks/test-runner.js"
printf '%s\n' '#!/usr/bin/env node
process.stderr.write("ADV-B-STDERR\n");
process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"ADV-B-STDERR"}})+"\n");
' > "$MUX_ROOT/hooks/design-quality.js"
export AUTOPILOT_HOOK_TEST_RUNNER=1
export AUTOPILOT_HOOK_DESIGN_QUALITY=1
unset AUTOPILOT_HOOK_ACCUMULATOR
CAPTURE_PLUGIN_ROOT="$MUX_ROOT"
CAPTURE_STDIN='{"tool_name":"Edit","tool_input":{"file_path":"x.js"}}'
capture_node "$TEST_TMP" opt-in-multiplexer.js PostToolUse
assert_eq 0 "$__RUN_EXIT" "mux merge: exit 0"
MERGED_CTX=$(node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(o.hookSpecificOutput.additionalContext);' <<< "$__RUN_STDOUT")
assert_eq "ADV-A-STDERR
ADV-B-STDERR" "$MERGED_CTX" "mux merge: additionalContext joined in child order"
node -e '
const o=JSON.parse(process.argv[1]);
if (o.hookSpecificOutput.hookEventName!=="PostToolUse") process.exit(1);
function w(v){ if(v&&typeof v==="object"){ if(Object.prototype.hasOwnProperty.call(v,"permissionDecision")) process.exit(2); Object.keys(v).forEach(k=>w(v[k])); } }
w(o);
' "$__RUN_STDOUT"
assert_eq 0 "$?" "mux merge: event PostToolUse, no permissionDecision"

# ── 15. multiplexer: advising sibling + exit-2 passthrough ────────────
printf '%s\n' '#!/usr/bin/env node
process.stderr.write("ADV-A-STDERR\n");
process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"ADV-A-STDERR"}})+"\n");
' > "$MUX_ROOT/hooks/test-runner.js"
printf '%s\n' '#!/usr/bin/env node
process.stdout.write("EXIT2-RAW-STDOUT");
process.stderr.write("EXIT2-ERR\n");
process.exit(2);
' > "$MUX_ROOT/hooks/design-quality.js"
CAPTURE_PLUGIN_ROOT="$MUX_ROOT"
CAPTURE_STDIN='{"tool_name":"Edit","tool_input":{"file_path":"x.js"}}'
HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$MUX_ROOT" \
  node "$HOOKS_DIR/opt-in-multiplexer.js" PostToolUse >"$TEST_TMP/mux-e2.out" 2>"$TEST_TMP/mux-e2.err" <<< "$CAPTURE_STDIN"
assert_eq 2 "$?" "mux exit2: multiplexer exits 2"
HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$MUX_ROOT" \
  node "$MUX_ROOT/hooks/design-quality.js" >"$TEST_TMP/child-e2.out" 2>/dev/null <<< "$CAPTURE_STDIN" || true
cmp -s "$TEST_TMP/mux-e2.out" "$TEST_TMP/child-e2.out"
assert_eq 0 "$?" "mux exit2: stdout byte-identical to the exit-2 child alone"

# ── 16. multiplexer: drop permissionDecision allow ────────────────────
printf '%s\n' '#!/usr/bin/env node
process.stderr.write("ALLOW-ADV\n");
process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"ALLOW-ADV",permissionDecision:"allow"}})+"\n");
' > "$MUX_ROOT/hooks/test-runner.js"
printf '%s\n' '#!/usr/bin/env node
process.exit(0);
' > "$MUX_ROOT/hooks/design-quality.js"
CAPTURE_PLUGIN_ROOT="$MUX_ROOT"
CAPTURE_STDIN='{"tool_name":"Edit","tool_input":{"file_path":"x.js"}}'
capture_node "$TEST_TMP" opt-in-multiplexer.js PostToolUse
assert_eq 0 "$__RUN_EXIT" "mux drop-allow: exit 0"
node -e '
const o=JSON.parse(process.argv[1]);
if (o.hookSpecificOutput.additionalContext!=="ALLOW-ADV") process.exit(1);
function w(v){ if(v&&typeof v==="object"){ if(Object.prototype.hasOwnProperty.call(v,"permissionDecision")) process.exit(2); Object.keys(v).forEach(k=>w(v[k])); } }
w(o);
' "$__RUN_STDOUT"
assert_eq 0 "$?" "mux drop-allow: additionalContext kept, permissionDecision absent"
unset AUTOPILOT_HOOK_TEST_RUNNER AUTOPILOT_HOOK_DESIGN_QUALITY
unset CAPTURE_PLUGIN_ROOT

finalize_test
