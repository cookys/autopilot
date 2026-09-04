#!/usr/bin/env bash
# cost-fuse.test.sh — PreToolUse brain-tier daily spend fuse tests
. "$(dirname "$0")/lib.sh"

export AUTOPILOT_COST_FUSE_DIR="$TEST_TMP/cost-fuse"
export AUTOPILOT_COSTS_FILE="$TEST_TMP/costs.jsonl"
unset AUTOPILOT_COST_FUSE_MODE AUTOPILOT_COST_FUSE_DAILY_USD

TODAY=$(node -e 'process.stdout.write(new Date().toISOString().slice(0, 10))')
TRANSCRIPT_FILE="$TEST_TMP/transcript.jsonl"

write_transcript() {
  local model="${1:-claude-fable-5-1}"
  cat > "$TRANSCRIPT_FILE" <<EOF
{"type":"user","message":{"role":"user","content":"hi"}}
{"type":"assistant","message":{"role":"assistant","model":"$model","content":"hello"}}
EOF
}

make_payload() {
  local tool="${1:-Edit}"
  local cmd="${2:-}"
  local session="${3:-fuse-session-1}"
  local cmd_json=""
  if [ -n "$cmd" ]; then
    cmd_json="\"command\":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$cmd")"
  fi
  printf '{"tool_name":"%s","session_id":"%s","transcript_path":"%s","tool_input":{%s},"hook_event_name":"PreToolUse"}' \
    "$tool" "$session" "$TRANSCRIPT_FILE" "$cmd_json"
}

write_costs() {
  # rows: model cost_usd session
  local model="${1:-claude-fable-5-1}"
  local cost="${2:-100}"
  local session="${3:-fuse-session-1}"
  cat > "$AUTOPILOT_COSTS_FILE" <<EOF
{"ts":"${TODAY}T01:00:00.000Z","session":"$session","model":"$model","cost_usd":$cost}
EOF
}

# ── 1. Spend under threshold → exit 0, silent stdout/stderr ───────────
write_costs "claude-fable-5-1" 50 "fuse-session-1"
write_transcript "claude-fable-5-1"
run_hook cost-fuse.js "$(make_payload Edit '' 'fuse-session-1')"
assert_eq 0 "$__RUN_EXIT" "case1: exit 0 under threshold"
assert_eq "" "$__RUN_STDOUT" "case1: stdout silent under threshold"
assert_eq "" "$__RUN_STDERR" "case1: stderr silent under threshold"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case1: never ask"

# ── 2. Spend over threshold, mode: block, tool Edit → deny ───────────
write_costs "claude-fable-5-1" 200 "fuse-session-1"
export AUTOPILOT_COST_FUSE_MODE=block
run_hook cost-fuse.js "$(make_payload Edit '' 'fuse-session-1')"
assert_eq 0 "$__RUN_EXIT" "case2: exit 0 on deny"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case2: denied"
assert_contains "$__RUN_STDOUT" "cost-fuse" "case2: reason contains cost-fuse"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case2: never ask"

# ── 3. Same over-threshold + block, but Bash with git status → allow ─
run_hook cost-fuse.js "$(make_payload Bash 'git status' 'fuse-session-1')"
assert_eq 0 "$__RUN_EXIT" "case3: exit 0 for read-only bash"
assert_eq "" "$__RUN_STDOUT" "case3: stdout silent for read-only bash under block"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case3: never ask"

# ── 3b. isReadOnlyBash bypass shapes must all be denied (still over threshold, mode: block) ──
assert_bash_denied() {
  local cmd="$1"
  local label="$2"
  run_hook cost-fuse.js "$(make_payload Bash "$cmd" 'fuse-session-1')"
  assert_eq 0 "$__RUN_EXIT" "$label: exit 0 on deny"
  assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "$label: denied (not treated as read-only)"
}
assert_bash_allowed() {
  local cmd="$1"
  local label="$2"
  run_hook cost-fuse.js "$(make_payload Bash "$cmd" 'fuse-session-1')"
  assert_eq 0 "$__RUN_EXIT" "$label: exit 0"
  assert_eq "" "$__RUN_STDOUT" "$label: stdout silent (treated as read-only)"
}

assert_bash_denied 'git status && rm -rf x' "case3b-chain-and"
assert_bash_denied 'git status || rm -rf x' "case3b-chain-or"
assert_bash_denied 'git status; rm -rf x' "case3b-semicolon"
assert_bash_denied 'ls | sh' "case3b-pipe"
assert_bash_denied 'cat a > b' "case3b-redirect-out"
assert_bash_denied $'cat > f <<EOF\nrm -rf x\nEOF' "case3b-heredoc"
assert_bash_denied $'git status\nrm -rf x' "case3b-second-line"
assert_bash_denied 'echo `whoami`' "case3b-backtick"
assert_bash_denied 'echo $(whoami)' "case3b-dollar-paren"
assert_bash_denied 'sed -i s/x/y/ file' "case3b-sed-i"
assert_bash_denied "node -e 'console.log(1)' --check" "case3b-node-dash-e"

assert_bash_allowed 'git status' "case3c-git-status"
assert_bash_allowed 'sed -n 1,5p file' "case3c-sed-n"
assert_bash_allowed 'node scripts/x.js --check' "case3c-node-check"

# ── 4. Over threshold, mode: warn → allow, ONE stderr line; second identical call silent ──
unset AUTOPILOT_COST_FUSE_MODE
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Edit '' 'fuse-session-1')"
assert_eq 0 "$__RUN_EXIT" "case4: exit 0 on warn"
assert_eq "" "$__RUN_STDOUT" "case4: stdout silent on warn"
assert_contains "$__RUN_STDERR" "cost-fuse" "case4: stderr has cost-fuse warning"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case4: never ask"

# Second identical call: same session, same multiple
run_hook cost-fuse.js "$(make_payload Edit '' 'fuse-session-1')"
assert_eq 0 "$__RUN_EXIT" "case4b: exit 0 on repeat warn"
assert_eq "" "$__RUN_STDOUT" "case4b: stdout silent on repeat warn"
assert_eq "" "$__RUN_STDERR" "case4b: stderr suppressed on repeat within same multiple"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case4b: never ask"

# ── 5. Session model sonnet over threshold → allow silently ───────────
# Transcript has sonnet model, and costs.jsonl has sonnet session row
write_transcript "claude-sonnet-4-6"
cat > "$AUTOPILOT_COSTS_FILE" <<EOF
{"ts":"${TODAY}T01:00:00.000Z","session":"other-brain-session","model":"claude-fable-5-1","cost_usd":250}
{"ts":"${TODAY}T02:00:00.000Z","session":"sonnet-session","model":"claude-sonnet-4-6","cost_usd":10}
EOF
export AUTOPILOT_COST_FUSE_MODE=block
run_hook cost-fuse.js "$(make_payload Edit '' 'sonnet-session')"
assert_eq 0 "$__RUN_EXIT" "case5: sonnet session exit 0"
assert_eq "" "$__RUN_STDOUT" "case5: sonnet session allowed even if brain spend over threshold"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case5: never ask"

# ── 5b. Model resolution order: transcript (mid-session switch) wins over ledger row ──
export AUTOPILOT_COST_FUSE_MODE=block
# Ledger says sonnet for this session, but there's also enough OTHER brain spend
# today to cross the threshold; transcript's last assistant message says fable.
write_transcript "claude-fable-5-1"
cat > "$AUTOPILOT_COSTS_FILE" <<EOF
{"ts":"${TODAY}T01:00:00.000Z","session":"other-brain-session","model":"claude-fable-5-1","cost_usd":200}
{"ts":"${TODAY}T02:00:00.000Z","session":"switch-session","model":"claude-sonnet-4-6","cost_usd":5}
EOF
run_hook cost-fuse.js "$(make_payload Edit '' 'switch-session')"
assert_eq 0 "$__RUN_EXIT" "case5b: exit 0"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case5b: transcript (fable) wins over ledger (sonnet) -> denied"

# Reverse: ledger says fable, transcript's last assistant message says sonnet ->
# transcript wins -> sonnet is not in the fused tiers -> allowed even though
# total brain spend is over threshold.
write_transcript "claude-sonnet-4-6"
cat > "$AUTOPILOT_COSTS_FILE" <<EOF
{"ts":"${TODAY}T01:00:00.000Z","session":"other-brain-session","model":"claude-fable-5-1","cost_usd":200}
{"ts":"${TODAY}T02:00:00.000Z","session":"switch-session","model":"claude-fable-5-1","cost_usd":5}
EOF
run_hook cost-fuse.js "$(make_payload Edit '' 'switch-session')"
assert_eq 0 "$__RUN_EXIT" "case5c: exit 0"
assert_eq "" "$__RUN_STDOUT" "case5c: transcript (sonnet) wins over ledger (fable) -> allowed silently"

# ── 5d. Warn state rolls over by UTC day ───────────────────────────────
unset AUTOPILOT_COST_FUSE_MODE
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
mkdir -p "$AUTOPILOT_COST_FUSE_DIR"
write_transcript "claude-fable-5-1"
write_costs "claude-fable-5-1" 200 "fuse-session-1"
# Pre-seed state as if the session already warned YESTERDAY at multiple 1, with
# no "day" field (legacy) — simulates a stale/yesterday state file.
YESTERDAY=$(node -e 'const d=new Date();d.setUTCDate(d.getUTCDate()-1);process.stdout.write(d.toISOString().slice(0,10))')
STATE_FILE="$AUTOPILOT_COST_FUSE_DIR/fuse-session-1.json"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1], JSON.stringify({warned_multiple:1, day: process.argv[2]}))' "$STATE_FILE" "$YESTERDAY"
run_hook cost-fuse.js "$(make_payload Edit '' 'fuse-session-1')"
assert_eq 0 "$__RUN_EXIT" "case5d: exit 0 on warn"
assert_eq "" "$__RUN_STDOUT" "case5d: stdout silent on warn"
assert_contains "$__RUN_STDERR" "cost-fuse" "case5d: stderr warns again today despite yesterday's warned_multiple=1"

# ── 6. AUTOPILOT_COSTS_FILE nonexistent → inert (exit 0 silently) ─────
export AUTOPILOT_COSTS_FILE="$TEST_TMP/nonexistent-costs.jsonl"
run_hook cost-fuse.js "$(make_payload Edit '' 'fuse-session-1')"
assert_eq 0 "$__RUN_EXIT" "case6: nonexistent costs file exit 0"
assert_eq "" "$__RUN_STDOUT" "case6: nonexistent costs file silent stdout"
assert_eq "" "$__RUN_STDERR" "case6: nonexistent costs file silent stderr"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case6: never ask"
export AUTOPILOT_COSTS_FILE="$TEST_TMP/costs.jsonl"

# ── 7. Negative control: corrupt daily_usd_brain default in copy ──────
# Proves that case 1 (spend $50 with default $150 threshold) actually depends on default 150.
# If default is corrupted to 25, spend $50 should DENY under block mode.
TMP_HOOK="$HOOKS_DIR/cost-fuse-mutant.tmp.js"
sed 's/const DEFAULT_DAILY_USD_BRAIN = 150;/const DEFAULT_DAILY_USD_BRAIN = 25;/' "$HOOKS_DIR/cost-fuse.js" > "$TMP_HOOK"
write_costs "claude-fable-5-1" 50 "fuse-session-1"
write_transcript "claude-fable-5-1"
export AUTOPILOT_COST_FUSE_MODE=block
# Running mutant hook with $50 spend: should trigger fuse because 50 >= 25
MUTANT_OUT=$(CLAUDE_PLUGIN_ROOT="$REPO_ROOT" HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" node "$TMP_HOOK" <<< "$(make_payload Edit '' 'fuse-session-1')")
rm -f "$TMP_HOOK"
case "$MUTANT_OUT" in
  *'"permissionDecision":"deny"'*)
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
    ;;
  *)
    fail "case7: negative control failed to trigger deny with corrupted default threshold"
    ;;
esac
rm -f "$TMP_HOOK"

# ── 8. Explicit assert across ALL cases that stdout never contains permissionDecision: ask
# (already asserted in each case above, add explicit check)
assert_not_contains "$MUTANT_OUT" '"permissionDecision":"ask"' "case8: mutant never ask"

finalize_test
