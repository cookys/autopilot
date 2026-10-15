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
assert_contains "$__RUN_STDOUT" '"hookEventName":"PreToolUse"' "case4: stdout advisory envelope"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case4: stdout additionalContext"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "case4: warn path never permissionDecision"
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

# ── 5e. Ledger fallback skips subagent rows: last row is a sonnet subagent, main row before it is fable ──
# Transcript yields no model, so resolution falls to the ledger; a subagent's model must not be taken as the session's.
export AUTOPILOT_COST_FUSE_MODE=block
printf '%s\n' '{"type":"user","message":{"role":"user","content":"hi"}}' > "$TRANSCRIPT_FILE"
cat > "$AUTOPILOT_COSTS_FILE" <<EOF
{"ts":"${TODAY}T01:00:00.000Z","session":"fallback-session","model":"claude-fable-5-1","cost_usd":200}
{"ts":"${TODAY}T02:00:00.000Z","session":"fallback-session","model":"claude-sonnet-4-6","sidechain":true,"agent_id":"aaa111","cost_usd":1}
EOF
run_hook cost-fuse.js "$(make_payload Edit '' 'fallback-session')"
assert_eq 0 "$__RUN_EXIT" "case5e: exit 0"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case5e: fallback resolves the main (fable) model, not the trailing subagent (sonnet) row"
unset AUTOPILOT_COST_FUSE_MODE

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
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case5d: stdout advisory envelope"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "case5d: warn path never permissionDecision"
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

# ── 8. Warn text scopes the number: this session vs the host total ───────
unset AUTOPILOT_COST_FUSE_MODE
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
write_transcript "claude-fable-5-1"
cat > "$AUTOPILOT_COSTS_FILE" <<EOF
{"ts":"${TODAY}T01:00:00.000Z","session":"fuse-session-1","model":"claude-fable-5-1","cost_usd":60}
{"ts":"${TODAY}T02:00:00.000Z","session":"other-brain-session","model":"claude-fable-5-1","cost_usd":120}
EOF
run_hook cost-fuse.js "$(make_payload Edit '' 'fuse-session-1')"
assert_contains "$__RUN_STDERR" 'this session $60.00' "case8: names this session's own spend"
assert_contains "$__RUN_STDERR" 'host today $180.00' "case8: names the host-wide total"

# ── 9. Dispatch-rail exemption: WARN mode only; block mode exempts nothing ──
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
export AUTOPILOT_COST_FUSE_MODE=warn
run_hook cost-fuse.js "$(make_payload Bash 'bash scripts/dispatch-hetero.sh --brief b.md > /tmp/out.log 2>&1' 'fuse-session-1')"
assert_eq "" "$__RUN_STDOUT" "case9: warn mode + plain dispatch-rail command is exempt"
run_hook cost-fuse.js "$(make_payload Bash 'node scripts/dispatch-review.js --x &' 'fuse-session-1')"
assert_eq "" "$__RUN_STDOUT" "case9b: warn mode + node dispatch-*.js with one trailing & is exempt"
run_hook cost-fuse.js "$(make_payload Bash 'bash scripts/dispatch-hetero.sh --brief b.md; git push origin x' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case9c: warn mode + chained with ; is not exempt (advisory fires)"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Bash 'bash scripts/dispatch-hetero.sh --x & git push origin x' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case9e: warn mode + '& git push' is not exempt"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Bash 'bash scripts/dispatch-hetero.sh --x <(git push origin x)' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case9f: warn mode + process substitution is not exempt"
export AUTOPILOT_COST_FUSE_MODE=block
run_hook cost-fuse.js "$(make_payload Bash 'bash scripts/dispatch-hetero.sh --brief b.md > /tmp/out.log 2>&1' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case9g: block mode + plain dispatch command is still fused"
run_hook cost-fuse.js "$(make_payload Bash 'bash scripts/dispatch-hetero.sh --x & git push origin x' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case9h: block mode + '& git push' denied"
run_hook cost-fuse.js "$(make_payload Bash 'bash scripts/dispatch-hetero.sh --x >(git push origin x)' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case9i: block mode + >( ) denied"
run_hook cost-fuse.js "$(make_payload Bash 'git push origin x' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case9d: an ordinary mutating Bash is still fused"
# ── 10. BL-0137: a held lock is waited out by sleeping, not spinning (warn mode) ──
# A fresh (<5 s) lock file ⇒ withLock waits its 2 s deadline then runs the warn body without the
# lock (fail-open). user+sys CPU must stay well under wall-clock time, and the warn must still land.
export AUTOPILOT_COST_FUSE_MODE=warn
# $200 is above the built-in brain default ($150); HOOK_HOME has no cost_fuse config, so that default applies.
write_costs "claude-fable-5-1" 200 "fuse-session-lock"
write_transcript "claude-fable-5-1"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"; mkdir -p "$AUTOPILOT_COST_FUSE_DIR"
: > "$AUTOPILOT_COST_FUSE_DIR/fuse-session-lock.json.lock"
LOCK_TIMING="$( { LC_ALL=C; TIMEFORMAT='%U %S %R'; time HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" node "$HOOKS_DIR/cost-fuse.js" >/dev/null 2>&1 <<< "$(make_payload Edit '' 'fuse-session-lock')"; } 2>&1 | tail -1 )"
read -r LOCK_U LOCK_S LOCK_R <<< "$LOCK_TIMING"
if LC_ALL=C awk -v u="$LOCK_U" -v s="$LOCK_S" -v r="$LOCK_R" 'BEGIN{exit !(r >= 1.5 && (u + s) < r / 2)}'; then
  assert_eq ok ok "held lock: waited the timeout without spinning (cpu ${LOCK_U}+${LOCK_S}s, wall ${LOCK_R}s)"
else
  fail "held lock: waiting burned CPU (cpu ${LOCK_U}+${LOCK_S}s, wall ${LOCK_R}s)"
fi
assert_contains "$(cat "$AUTOPILOT_COST_FUSE_DIR/fuse-session-lock.json")" '"warned_multiple":1' "timeout fails open: the warn is still recorded"
rm -f "$AUTOPILOT_COST_FUSE_DIR/fuse-session-lock.json.lock"
unset AUTOPILOT_COST_FUSE_MODE


# ── 11. BL-0105: the dispatch exemption is anchored to the command word ──
export AUTOPILOT_COST_FUSE_MODE=warn
write_costs "claude-fable-5-1" 200 "fuse-session-1"
write_transcript "claude-fable-5-1"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Bash 'FOO=scripts/dispatch-x.sh rm -rf build' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case11a: an env assignment whose value is the rail path is not exempt"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Bash 'bash /tmp/evil/myscripts/dispatch-x.sh' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case11b: a path whose last dir merely ends in 'scripts' is not exempt"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Bash 'bash scripts/dispatch-x.sh' 'fuse-session-1')"
assert_eq "" "$__RUN_STDOUT" "case11c: control: bare relative rail is still exempt"
run_hook cost-fuse.js "$(make_payload Bash 'node /home/u/.claude/plugins/autopilot/scripts/dispatch-review.js --x 2>&1' 'fuse-session-1')"
assert_eq "" "$__RUN_STDOUT" "case11d: control: absolute plugin-root rail is still exempt"

# ── 11e. BL-0183: quoted rail paths are exempt; disguises still are not ──
i=0
for cmd in \
  'bash "$REPO_ROOT/scripts/dispatch-x.sh" --brief b.md' \
  'bash "${CLAUDE_PLUGIN_ROOT}"/scripts/dispatch-x.sh --x 2>&1' \
  'node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-review.js" --x &' \
  "bash '\$REPO_ROOT/scripts/dispatch-x.sh'"; do
  i=$((i+1))
  rm -rf "$AUTOPILOT_COST_FUSE_DIR"
  run_hook cost-fuse.js "$(make_payload Bash "$cmd" 'fuse-session-1')"
  assert_eq "" "$__RUN_STDOUT" "case11e$i: quoted rail form is exempt: $cmd"
done
i=0
for cmd in \
  'FOO="scripts/dispatch-x.sh" rm -rf build' \
  'FOO="$X/scripts/dispatch-x.sh" rm -rf build' \
  'bash "/tmp/evil/myscripts/dispatch-x.sh"' \
  'bash "${X}"/myscripts/dispatch-x.sh' \
  'bash -c="scripts/dispatch-x.sh"' \
  'bash --rcfile="scripts/dispatch-x.sh"' \
  'bash --rcfile=scripts/dispatch-x.sh' \
  'bash -c=scripts/dispatch-x.sh' \
  'bash "$REPO_ROOT/scripts/dispatch-x.sh' \
  'bash "$REPO_ROOT/scripts/dispatch-x.sh"; git push origin x' \
  'bash "$REPO_ROOT/scripts/dispatch-x.sh" && rm -rf build'; do
  i=$((i+1))
  rm -rf "$AUTOPILOT_COST_FUSE_DIR"
  run_hook cost-fuse.js "$(make_payload Bash "$cmd" 'fuse-session-1')"
  assert_contains "$__RUN_STDOUT" '"additionalContext"' "case11f$i: disguise is not exempt: $cmd"
done
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
export AUTOPILOT_COST_FUSE_MODE=block
run_hook cost-fuse.js "$(make_payload Bash 'bash "$REPO_ROOT/scripts/dispatch-x.sh"' 'fuse-session-1')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case11g: block mode exempts nothing, quoted rail included"
export AUTOPILOT_COST_FUSE_MODE=warn

# ── 12. BL-0105: distinct session ids never share a sanitised key ──
write_transcript "claude-fable-5-1"
cat > "$AUTOPILOT_COSTS_FILE" <<EOF
{"ts":"${TODAY}T01:00:00.000Z","session":"a/b","model":"claude-fable-5-1","cost_usd":60}
{"ts":"${TODAY}T02:00:00.000Z","session":"a_b","model":"claude-fable-5-1","cost_usd":120}
EOF
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Edit '' 'a_b')"
assert_contains "$__RUN_STDERR" 'this session $120.00' "case12a: session a_b does not absorb a/b's spend"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Edit '' 'a/b')"
assert_contains "$__RUN_STDERR" 'this session $60.00' "case12b: session a/b does not absorb a_b's spend"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
run_hook cost-fuse.js "$(make_payload Edit '' 'a/b')"
run_hook cost-fuse.js "$(make_payload Edit '' 'a_b')"
assert_contains "$__RUN_STDERR" 'this session' "case12c: a/b's warn state does not silence a_b"

# ── 13. BL-0105: no resolvable session id prints 'unknown', not $0.00 ──
write_costs "claude-fable-5-1" 200 "fuse-session-1"
rm -rf "$AUTOPILOT_COST_FUSE_DIR"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID
NOSID_PAYLOAD=$(printf '{"tool_name":"Edit","transcript_path":"%s","tool_input":{},"hook_event_name":"PreToolUse"}' "$TRANSCRIPT_FILE")
run_hook cost-fuse.js "$NOSID_PAYLOAD"
assert_contains "$__RUN_STDERR" 'this session unknown' "case13: warn says 'this session unknown' with no session id"
assert_not_contains "$__RUN_STDERR" 'this session $0.00' "case13: warn never claims a fake zero session spend"
unset AUTOPILOT_COST_FUSE_MODE

finalize_test
