#!/usr/bin/env bash
# Mission enforce governs campaign work only (PM 01M794CK).
# Stub agy, no network. Cases:
#   (a) enforce + no flags -> refused, message names --no-campaign
#   (b) enforce + --no-campaign on a backlog S fix -> admitted; manifest and the
#       branch ledger row carry campaign_scope none_declared and enforcement_mode
#   (c) enforce + active l6 marker + --no-campaign -> refused
#   (d) --no-campaign with --campaign-seal -> precondition error
#   (e) mode off, no new flag -> admitted, and the manifest stays without campaign_scope
# suite-timeout-secs: 180
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
for _git_cfg_i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  unset "GIT_CONFIG_KEY_${_git_cfg_i}" "GIT_CONFIG_VALUE_${_git_cfg_i}"
done
unset _git_cfg_i

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'S backlog fix: correct the status string typo in the backlog note.\n' > "$PROMPT"
RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
export DISPATCH_QUIET=1
EMPTY_SESSION="$TEST_TMP/session-mode-empty"
mkdir -p "$EMPTY_SESSION"
export AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION"
RAN="$TEST_TMP/runner-ran"
AGY_FIXTURE_HELPER="$TEST_TMP/emit-agy-envelope"
cat > "$AGY_FIXTURE_HELPER" <<'EOF'
#!/usr/bin/env bash
RESPONSE="${1:-self-report: DONE}" node -e '
  process.stdout.write(JSON.stringify({
    conversation_id: "fixture",
    duration_seconds: 1,
    num_turns: 1,
    response: process.env.RESPONSE,
    status: "SUCCESS",
    usage: { cache_read_tokens: 7, input_tokens: 101, output_tokens: 23, thinking_tokens: 11, total_tokens: 142 },
  }));
'
EOF
chmod +x "$AGY_FIXTURE_HELPER"
export AGY_FIXTURE_HELPER

STUB="$TEST_TMP/agy-ok"
cat > "$STUB" <<EOF
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: backlog S fix"
touch "$RAN"
"\$AGY_FIXTURE_HELPER" "self-report: DONE"
exit 0
EOF
chmod +x "$STUB"
make_agy_stub_versioned "$STUB"

# enforcement_mode may be shadow or enforce when the section is present.
# Mode off is the projection with no mission_convergence section.
set_mode() {
  mkdir -p "$SBX/.claude"
  if [ "$1" = "off" ]; then
    node - "$REPO_ROOT/.claude/owner-kernel-governance.json" "$SBX/.claude/owner-kernel-governance.json" <<'NODE'
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(source, 'utf8'));
delete value.mission_convergence;
fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
NODE
  else
    write_mission_governance "$SBX/.claude/owner-kernel-governance.json" "$1"
  fi
}

status_line() {
  printf '%s\n' "$1" | grep '^{ "status"' | tail -1
}

run_dispatch() {
  rm -f "$RAN"
  (cd "$SBX" && "$SCRIPT" --prompt-file "$PROMPT" --agy-bin "$STUB" "$@")
}

# Usage documents the flag beside the campaign contract flags.
HELP="$("$SCRIPT" --help 2>&1)"
assert_contains "$HELP" "--no-campaign" "--help documents --no-campaign"
assert_contains "$HELP" "--campaign-contract" "--help still documents --campaign-contract"

# (a) enforce + neither sealed projection nor --no-campaign stays refused.
set_mode enforce
OUT="$(run_dispatch --branch feat/no-campaign-a)"; RC=$?
assert_eq "2" "$RC" "(a) enforce with no flags exits 2"
assert_contains "$(status_line "$OUT")" '"status": "precondition_failed"' "(a) precondition_failed"
assert_contains "$OUT" "sealed campaign strict projection" "(a) refusal still names the sealed projection"
assert_contains "$OUT" "--no-campaign" "(a) refusal names --no-campaign for backlog work"
assert_file_absent "$RAN" "(a) stub runner was not started"
A_JSON="$(status_line "$OUT")"
A_RUN="$(printf '%s' "$A_JSON" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p')"
if [ -n "$A_RUN" ]; then
  assert_file_absent "$RUNS_DIR/$A_RUN.manifest.json" "(a) refusal writes no run manifest"
fi

# (d) the flag and any --campaign-* flag are a precondition error, before seal readability.
OUT="$(run_dispatch --branch feat/no-campaign-d --no-campaign --campaign-seal "$TEST_TMP/missing.seal.json")"; RC=$?
assert_eq "2" "$RC" "(d) --no-campaign with --campaign-seal exits 2"
assert_contains "$(status_line "$OUT")" '"status": "precondition_failed"' "(d) precondition_failed"
assert_contains "$OUT" "--no-campaign cannot be combined with" "(d) names the flag conflict"
assert_not_contains "$OUT" "unknown argument" "(d) conflict is not an unknown-argument miss"
assert_file_absent "$RAN" "(d) stub runner was not started"

# (c) an active campaign marker cannot be escaped with --no-campaign.
ACTIVE="$TEST_TMP/session-mode-active"
mkdir -p "$ACTIVE"
printf '%s\n' \
  "{\"level\":\"l6\",\"repo_root\":\"$(cd "$SBX" && pwd -P)\",\"started_at\":\"2026-07-28T00:00:00Z\",\"expires_at\":\"2099-01-01T00:00:00Z\"}" \
  > "$ACTIVE/l6.json"
OUT="$(AUTOPILOT_SESSION_MODE_DIR="$ACTIVE" run_dispatch --branch feat/no-campaign-c --no-campaign)"; RC=$?
assert_eq "2" "$RC" "(c) active campaign marker with --no-campaign exits 2"
assert_contains "$OUT" "active session-mode=l6 requires a sealed campaign strict projection" "(c) session-mode gate still refuses"
assert_contains "$OUT" "--no-campaign does not leave an active campaign" "(c) the flag is named as not an escape"
assert_file_absent "$RAN" "(c) stub runner was not started"

# (b) enforce + --no-campaign admits a backlog S fix and records the scope.
OUT="$(AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION" run_dispatch --branch feat/no-campaign-b --no-campaign)"; RC=$?
assert_eq "0" "$RC" "(b) enforce + --no-campaign exits 0: $OUT"
assert_contains "$(status_line "$OUT")" '"status": "committed"' "(b) backlog S fix committed"
assert_file_exists "$RAN" "(b) stub runner ran"
B_JSON="$(status_line "$OUT")"
B_RUN="$(printf '%s' "$B_JSON" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p')"
B_MF="$RUNS_DIR/$B_RUN.manifest.json"
assert_file_exists "$B_MF" "(b) run manifest written"
assert_contains "$(cat "$B_MF")" '"campaign_scope": "none_declared"' "(b) manifest campaign_scope is none_declared"
assert_contains "$(cat "$B_MF")" '"enforcement_mode": "enforce"' "(b) manifest records the enforce mode seen"
B_LEDGER="$(git -C "$SBX" rev-parse --path-format=absolute --git-common-dir)/autopilot/dispatch-branches.jsonl"
B_ROW="$(grep -F '"branch":"feat/no-campaign-b"' "$B_LEDGER")"
assert_contains "$B_ROW" '"campaign_scope":"none_declared"' "(b) branch ledger line carries campaign_scope none_declared"
assert_contains "$B_ROW" '"enforcement_mode":"enforce"' "(b) branch ledger line carries the enforce mode seen"
assert_eq "ok" "$(git -C "$SBX" show feat/no-campaign-b:ok.txt)" "(b) the S fix is on the hands branch"

# (e) mode off keeps today's bare-dispatch behaviour and does not stamp campaign_scope.
set_mode off
OUT="$(run_dispatch --branch feat/no-campaign-e)"; RC=$?
assert_eq "0" "$RC" "(e) mode off with no flags exits 0: $OUT"
assert_contains "$(status_line "$OUT")" '"status": "committed"' "(e) mode off still commits"
assert_not_contains "$OUT" "Mission enforce mode requires" "(e) mode off does not apply the enforce refusal"
E_JSON="$(status_line "$OUT")"
E_RUN="$(printf '%s' "$E_JSON" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p')"
E_MF="$RUNS_DIR/$E_RUN.manifest.json"
assert_file_exists "$E_MF" "(e) mode off still writes the run manifest"
assert_not_contains "$(cat "$E_MF")" "campaign_scope" "(e) mode off manifest has no campaign_scope"
E_ROW="$(grep -F '"branch":"feat/no-campaign-e"' "$B_LEDGER")"
assert_not_contains "$E_ROW" "campaign_scope" "(e) mode off ledger row has no campaign_scope"

finalize_test
