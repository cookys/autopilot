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

finalize_test
