#!/usr/bin/env bash
# Optional rc-alarm dispatch integration; all runner and fleet programs are local stubs.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_RC_ALARM_LABEL AUTOPILOT_RC_ALARM_OWNER
TEST_NAME=dispatch-hetero-rc-alarm
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_TEST_CN_GATE_OFF=1 AUTOPILOT_ENDPOINT_PREPROBE=off
export AUTOPILOT_LOCAL_SLOTS_CMD='printf %s '\''{"free":0,"draining":false}'\'''
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" XDG_RUNTIME_DIR="$TEST_TMP/runtime" HOME="$TEST_TMP/home"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin" "$ENGINE_CAPABILITY_DIR" "$XDG_RUNTIME_DIR" "$HOME/.autopilot"
export AUTOPILOT_CONFIG_FILE="$HOME/.autopilot/config.json"
LEAD='team/test-lead--claude' OWNER='team/test-owner--claude'
printf '{"rc_alarm_lead":["%s"]}\n' "$LEAD" > "$AUTOPILOT_CONFIG_FILE"

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.md"; printf 'fail fixture\n' > "$PROMPT"
RUNNER_CALLS="$TEST_TMP/runner-calls"; export RUNNER_CALLS
cat > "$TEST_TMP/bin/grok" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo 'grok test stub'; exit 0; fi
case " $* " in
  *" __autopilot_probe__ "*) echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: xhigh, high, medium, low" >&2; exit 2 ;;
esac
printf 'called %s\n' "$*" >> "$RUNNER_CALLS"
echo 'stub dispatch failed' >&2
exit 23
SH
chmod +x "$TEST_TMP/bin/grok"
FLEET_CALLS="$TEST_TMP/fleet-calls"; export FLEET_CALLS
cat > "$TEST_TMP/bin/fleet" <<'SH'
#!/usr/bin/env node
const fs=require('fs'), args=process.argv.slice(2); if(args[0]==='send') fs.appendFileSync(process.env.FLEET_CALLS, JSON.stringify(args)+'\n');
SH
chmod +x "$TEST_TMP/bin/fleet"
export FLEET_BIN="$TEST_TMP/bin/fleet" PATH="$TEST_TMP/bin:$PATH"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_eq() { [ "$1" = "$2" ] || fail "$3 (expected '$1', got '$2')"; }
assert_contains() { case "$1" in *"$2"*) ;; *) fail "$3 (missing '$2')" ;; esac; }
run_dispatch() {
  local tag="$1"; shift
  local runs="$TEST_TMP/runs-$tag"; mkdir -p "$runs"
  (cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" "$SCRIPT" --runner grok --pin-reason "test fixture" --model grok-4.7 --grok-bin "$TEST_TMP/bin/grok" \
    --no-campaign --no-verify-tip --context-window off --branch "feat/alarm-$tag" --prompt-file "$PROMPT" "$@" </dev/null) \
    >"$TEST_TMP/$tag.out" 2>"$TEST_TMP/$tag.err"
  RUN_RC=$?
}
fleet_lines() { [ ! -f "$FLEET_CALLS" ] && echo 0 || wc -l < "$FLEET_CALLS" | tr -d ' '; }
runner_lines() { [ ! -f "$RUNNER_CALLS" ] && echo 0 || wc -l < "$RUNNER_CALLS" | tr -d ' '; }

run_dispatch first --rc-alarm-label same-label --rc-alarm-owner "$OWNER"
assert_eq 1 "$(runner_lines)" "first dispatch starts failing engine: $(cat "$RUNNER_CALLS" 2>/dev/null)"
assert_eq 0 "$(fleet_lines)" "first failure sends no notice: $(cat "$FLEET_CALLS" 2>/dev/null) :: $(cat "$RUNNER_CALLS" 2>/dev/null)"
run_dispatch second --rc-alarm-label same-label --rc-alarm-owner "$OWNER"
assert_eq 2 "$(runner_lines)" 'second dispatch starts failing engine'
assert_eq 2 "$(fleet_lines)" 'second failure notifies configured lead and owner'
assert_contains "$(cat "$FLEET_CALLS")" '連續 2 次' 'second failure alarm message'
run_dispatch third --rc-alarm-label same-label --rc-alarm-owner "$OWNER"
assert_eq 3 "$(runner_lines)" 'third dispatch starts failing engine'
assert_eq 4 "$(fleet_lines)" 'third failure sends count-three notice'
assert_contains "$(tail -n 2 "$FLEET_CALLS")" '第 3 次失敗' 'third failure alarm message'
run_dispatch fourth --rc-alarm-label same-label --rc-alarm-owner "$OWNER"
assert_eq 3 "$(runner_lines)" 'blocked fourth dispatch does not start engine'
assert_eq 6 "$(fleet_lines)" 'blocked label sends its single blocked notice'
assert_eq 75 "$RUN_RC" 'blocked fourth dispatch exits 75'
assert_contains "$(cat "$TEST_TMP/fourth.err")" '停止重試' 'blocked warning is printed'

before="$(fleet_lines)"
run_dispatch no-label
assert_eq "$before" "$(fleet_lines)" 'dispatch without label never calls fake fleet'

printf 'regular file\n' > "$TEST_TMP/not-a-directory"
export XDG_RUNTIME_DIR="$TEST_TMP/not-a-directory/sub"
before_runner="$(runner_lines)"
run_dispatch broken-state-dir --rc-alarm-label broken-state-dir
assert_eq "$((before_runner + 1))" "$(runner_lines)" 'state directory failure still starts engine'
assert_contains "$(cat "$TEST_TMP/broken-state-dir.err")" 'rc-alarm: check failed rc=1, continuing' 'state directory failure warns and continues'
export XDG_RUNTIME_DIR="$TEST_TMP/runtime"

export AUTOPILOT_RC_ALARM_LABEL=env-label AUTOPILOT_RC_ALARM_OWNER="$OWNER"
run_dispatch env-first
assert_eq "$before" "$(fleet_lines)" 'env label first failure sends no notice'
run_dispatch env-second
assert_eq "$((before + 2))" "$(fleet_lines)" 'environment fallbacks enable alarm notifications'
assert_contains "$(tail -n 2 "$FLEET_CALLS")" 'env-label 連續 2 次' 'environment label appears in notice'
printf 'PASS [dispatch-hetero-rc-alarm] 18 assertions\n'
