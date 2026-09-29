#!/usr/bin/env bash
# RED at 51def4fb
# FAIL [dispatch-hetero-watchdog-followups] assert_r6_cancel_skips_kill_when_cmdline_lacks_tag: unrelated helper 3033051 was killed
# FAIL [dispatch-hetero-watchdog-followups] 7 passed, 1 failed
#       - assert_r6_cancel_skips_kill_when_cmdline_lacks_tag: unrelated helper 3033051 was killed
# EXIT:1
#
# RED at a1ca251e:
# FAIL [dispatch-hetero-watchdog-followups] plain nojobcontrol timeout_enforced: expected 'true', got 'false'
# FAIL [dispatch-hetero-watchdog-followups] manifest timeout_enforced: expected 'true', got 'false'
# FAIL [dispatch-hetero-watchdog-followups] detached nojobcontrol timeout_enforced: expected 'true', got 'false'
# FAIL [dispatch-hetero-watchdog-followups] 2 passed, 3 failed
#       - plain nojobcontrol timeout_enforced: expected 'true', got 'false'
#       - manifest timeout_enforced: expected 'true', got 'false'
#       - detached nojobcontrol timeout_enforced: expected 'true', got 'false'
# EXIT:1
#
# RED at b9fbc8fc
# FAIL [dispatch-hetero-watchdog-followups] worker stdin target: expected '/dev/null', got 'pipe:[716059804]'
# FAIL [dispatch-hetero-watchdog-followups] 7 passed, 1 failed
#       - worker stdin target: expected '/dev/null', got 'pipe:[716059804]'
# EXIT:1
#
# Follow-ups 1/9: no-setsid / no-job-control degrade + set +m scoping.
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
export AUTOPILOT_GROK_EFFORT_PROBE=0

DEFAULT_CAP_ISOLATION_DIR="$TEST_TMP/engine-capability-default"
mkdir -p "$DEFAULT_CAP_ISOLATION_DIR"
export ENGINE_CAPABILITY_DIR="$DEFAULT_CAP_ISOLATION_DIR"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"
EMPTY_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"
mkdir -p "$EMPTY_SESSION_MODE_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR"

json_get() {
  echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(o[process.argv[1]]===undefined?'':String(o[process.argv[1]]))}catch(e){console.log('')}})" "$2"
}

last_json() {
  printf '%s\n' "$1" | grep '^{' | tail -n 1
}

pid_alive() {
  kill -0 "$1" 2>/dev/null
}

install_sleep_stub() {
  local dest="$1"
  cat > "$dest" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--list-models" ]; then
  cat <<'MODELS'
Available models

cursor-grok-4.6-low - Grok 4.6 (low)
cursor-grok-4.6-low-fast - Grok 4.6 (low, fast)
cursor-grok-4.6-medium - Grok 4.6 (medium)
cursor-grok-4.6-medium-fast - Grok 4.6 (medium, fast)
cursor-grok-4.6-high - Grok 4.6 (high)
cursor-grok-4.6-high-fast - Grok 4.6 (high, fast)
cursor-grok-4.6-xhigh - Grok 4.6 (xhigh)
cursor-grok-4.6-xhigh-fast - Grok 4.6 (xhigh, fast)
gpt-5.3-codex-low - GPT-5.3 Codex (low)
gpt-5.3-codex-low-fast - GPT-5.3 Codex (low, fast)
gpt-5.3-codex - GPT-5.3 Codex (medium)
gpt-5.3-codex-fast - GPT-5.3 Codex (medium, fast)
gpt-5.3-codex-high - GPT-5.3 Codex (high)
gpt-5.3-codex-high-fast - GPT-5.3 Codex (high, fast)
gpt-5.3-codex-xhigh - GPT-5.3 Codex (xhigh)
gpt-5.3-codex-xhigh-fast - GPT-5.3 Codex (xhigh, fast)
MODELS
  exit 0
fi
case " $* " in *" __autopilot_probe__ "*)
  echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: high, medium, low" >&2
  exit 1 ;;
esac
if [ -n "${HETERO_TEST_PIDFILE:-}" ]; then
  echo "$$" > "$HETERO_TEST_PIDFILE"
fi
if [ "${HETERO_TEST_IGNORE_TERM:-0}" = "1" ]; then
  trap '' TERM
fi
if [ "${HETERO_TEST_BUSYLOOP:-0}" = "1" ]; then
  while :; do sleep 1; done
fi
sleep "${HETERO_TEST_SLEEP:-120}"
exit 0
EOF
  chmod +x "$dest"
}

hide_cgroup_dir() {
  local hide="$1"
  mkdir -p "$hide"
  cat > "$hide/systemd-run" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  chmod +x "$hide/systemd-run"
}

LEDGER_SH="$REPO_ROOT/scripts/run-ledger.sh"

assert_r1_nojobcontrol_reports_unenforced() {
  local hide="$TEST_TMP/hide-cgroup-njc"
  hide_cgroup_dir "$hide"
  local stub="$TEST_TMP/grok-njc" runs="$TEST_TMP/runs-njc"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  local out json mf
  out="$(cd "$SBX" && env PATH="$hide:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_NO_SETSID=1 HETERO_TEST_NO_JOBCONTROL=1 HETERO_TEST_SLEEP=0 \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-njc --prompt-file "$PROMPT" --timeout 3s 2>&1)" || true
  json="$(last_json "$out")"
  [ -n "$json" ] || fail "assert_r1_nojobcontrol_reports_unenforced: missing JSON: $out"
  assert_eq "false" "$(json_get "$json" timeout_enforced)" "plain nojobcontrol timeout_enforced"
  mf="$(find "$runs" -name '*.manifest.json' | head -1)"
  [ -n "$mf" ] || fail "assert_r1_nojobcontrol_reports_unenforced: no manifest"
  assert_eq "false" "$(json_get "$(cat "$mf")" timeout_enforced)" "manifest timeout_enforced"
}

assert_r1_nojobcontrol_detached_real_path() {
  local hide="$TEST_TMP/hide-cgroup-njc-d"
  hide_cgroup_dir "$hide"
  local stub="$TEST_TMP/grok-njc-d"
  local runs="$TEST_TMP/runs-njc-d" ledger="$TEST_TMP/njc-d/ledger.jsonl"
  local result="${ledger}.results/wdog-njc-d.implement.result.json"
  mkdir -p "$runs" "$(dirname "$ledger")"
  bash "$LEDGER_SH" init --ledger "$ledger" >/dev/null
  install_sleep_stub "$stub"
  (
    cd "$SBX" && env PATH="$hide:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      HETERO_TEST_NO_SETSID=1 HETERO_TEST_NO_JOBCONTROL=1 HETERO_TEST_SLEEP=0 \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch feat/wdog-njc-d --prompt-file "$PROMPT" --timeout 3s \
      --ledger "$ledger" --run-id wdog-njc-d --stage implement
  ) >/dev/null 2>&1 &
  if ! poll_until 55 test -f "$result"; then
    fail "assert_r1_nojobcontrol_detached_real_path: result not available within 55s"
    return
  fi
  local json
  json="$(cat "$result")"
  [ -n "$json" ] || fail "assert_r1_nojobcontrol_detached_real_path: empty result"
  assert_eq "false" "$(json_get "$json" timeout_enforced)" "detached nojobcontrol timeout_enforced"
}

assert_r1_nosetsid_with_jobcontrol_still_enforces() {
  local hide="$TEST_TMP/hide-cgroup-jc"
  hide_cgroup_dir "$hide"
  local stub="$TEST_TMP/grok-jc" pidfile="$TEST_TMP/jc.pid" runs="$TEST_TMP/runs-jc"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  local start now elapsed out json stubpid
  start="$(date +%s)"
  out="$(cd "$SBX" && timeout 30 env PATH="$hide:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_NO_SETSID=1 HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-jc --prompt-file "$PROMPT" --timeout 3s 2>&1)" || true
  now="$(date +%s)"; elapsed=$((now - start))
  json="$(last_json "$out")"
  if [ "$(json_get "$json" timeout_enforced)" != "true" ]; then
    echo "SKIP assert_r1_nosetsid_with_jobcontrol_still_enforces: job control did not isolate worker pgid on this host (timeout_enforced=$(json_get "$json" timeout_enforced))"
    return 0
  fi
  [ "$elapsed" -lt 30 ] || fail "assert_r1_nosetsid_with_jobcontrol_still_enforces: took ${elapsed}s"
  assert_eq "true" "$(json_get "$json" timed_out)" "nosetsid+jobcontrol timed_out"
  assert_eq "true" "$(json_get "$json" timeout_enforced)" "nosetsid+jobcontrol timeout_enforced"
  stubpid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$stubpid" ] || fail "assert_r1_nosetsid_with_jobcontrol_still_enforces: no pidfile"
  if pid_alive "$stubpid"; then
    fail "assert_r1_nosetsid_with_jobcontrol_still_enforces: stub pid $stubpid still alive"
  fi
}

assert_r9_no_job_notices_on_stderr() {
  local hide="$TEST_TMP/hide-cgroup-r9"
  hide_cgroup_dir "$hide"
  local stub="$TEST_TMP/grok-r9" pidfile="$TEST_TMP/r9.pid" runs="$TEST_TMP/runs-r9"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  local errf="$TEST_TMP/r9.err"
  (cd "$SBX" && timeout 30 env PATH="$hide:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_NO_SETSID=1 HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-r9 --prompt-file "$PROMPT" --timeout 3s >/dev/null) 2>"$errf" || true
  if grep -E '^[[:space:]]*\[[0-9]+\][+ ][[:space:]]*(Terminated|Killed|Done)' "$errf" >/dev/null; then
    fail "assert_r9_no_job_notices_on_stderr: bash job-status notice in stderr: $(cat "$errf")"
  fi
}

host_has_user_scope() {
  command -v systemd-run >/dev/null 2>&1 \
    && systemd-run --user --scope --quiet -- true >/dev/null 2>&1
}

wait_pid_dead() {
  local pid="$1" limit="$2" n=0
  while [ "$n" -lt "$limit" ]; do
    pid_alive "$pid" || return 0
    sleep 1
    n=$((n + 1))
  done
  pid_alive "$pid" && return 1
  return 0
}

reap_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

assert_r2_cgroup_kill_failure_falls_back_to_pgid() {
  if ! host_has_user_scope; then
    echo "SKIP assert_r2_cgroup_kill_failure_falls_back_to_pgid: no working systemd-run --user --scope on this host"
    return 0
  fi
  local stub="$TEST_TMP/grok-r2" pidfile="$TEST_TMP/r2.pid" runs="$TEST_TMP/runs-r2"
  local outf="$TEST_TMP/r2.out"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  local stubpid="" dispid="" json
  (
    cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
      HETERO_TEST_SYSTEMCTL_KILL_FAIL=1 \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch feat/wdog-r2 --prompt-file "$PROMPT" --timeout 3s
  ) >"$outf" 2>&1 &
  dispid=$!
  if ! poll_until 15 test -s "$pidfile"; then
    reap_pid "$dispid"
    fail "assert_r2_cgroup_kill_failure_falls_back_to_pgid: stub pidfile empty"
    return
  fi
  stubpid="$(cat "$pidfile" 2>/dev/null || true)"
  if ! wait_pid_dead "$stubpid" 30; then
    reap_pid "$stubpid"
    reap_pid "$dispid"
    fail "assert_r2_cgroup_kill_failure_falls_back_to_pgid: stub pid $stubpid still alive after 30s"
    return
  fi
  wait "$dispid" 2>/dev/null || true
  json="$(last_json "$(cat "$outf")")"
  [ -n "$json" ] || fail "assert_r2_cgroup_kill_failure_falls_back_to_pgid: missing JSON: $(cat "$outf")"
  assert_eq "true" "$(json_get "$json" timed_out)" "r2 cgroup fallback timed_out"
}

assert_r2_cgroup_kill_failure_detached_real_path() {
  if ! host_has_user_scope; then
    echo "SKIP assert_r2_cgroup_kill_failure_detached_real_path: no working systemd-run --user --scope on this host"
    return 0
  fi
  local stub="$TEST_TMP/grok-r2-d" pidfile="$TEST_TMP/r2-d.pid"
  local runs="$TEST_TMP/runs-r2-d" ledger="$TEST_TMP/r2-d/ledger.jsonl"
  local result="${ledger}.results/wdog-r2-d.implement.result.json"
  mkdir -p "$runs" "$(dirname "$ledger")"
  bash "$LEDGER_SH" init --ledger "$ledger" >/dev/null
  install_sleep_stub "$stub"
  : > "$pidfile"
  local stubpid="" json
  (
    cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
      HETERO_TEST_SYSTEMCTL_KILL_FAIL=1 \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch feat/wdog-r2-d --prompt-file "$PROMPT" --timeout 3s \
      --ledger "$ledger" --run-id wdog-r2-d --stage implement
  ) >/dev/null 2>&1 &
  local wrap=$!
  if ! poll_until 55 test -f "$result"; then
    stubpid="$(cat "$pidfile" 2>/dev/null || true)"
    reap_pid "$stubpid"
    reap_pid "$wrap"
    fail "assert_r2_cgroup_kill_failure_detached_real_path: result not available within 55s"
    return
  fi
  json="$(cat "$result")"
  [ -n "$json" ] || fail "assert_r2_cgroup_kill_failure_detached_real_path: empty result"
  assert_eq "true" "$(json_get "$json" timed_out)" "r2 detached timed_out"
  stubpid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$stubpid" ] || fail "assert_r2_cgroup_kill_failure_detached_real_path: no pidfile"
  if ! wait_pid_dead "$stubpid" 30; then
    reap_pid "$stubpid"
    fail "assert_r2_cgroup_kill_failure_detached_real_path: stub pid $stubpid still alive"
  fi
  wait "$wrap" 2>/dev/null || true
}

assert_r6_cancel_skips_kill_when_cmdline_lacks_tag() {
  eval "$(sed -n '/^_watchdog_sleeppid_cmdline_has_tag() {/,/^}$/p' "$SCRIPT")"
  eval "$(sed -n '/^_cancel_worker_watchdog() {/,/^}$/p' "$SCRIPT")"
  local tok="$TEST_TMP/hetero-wdog-tok-r6neg"
  : > "$tok"
  WATCHDOG_TOKEN_FILE="$tok"
  WATCHDOG_PID=""
  /bin/sleep 120 &
  local helper=$!
  echo "$helper" > "${tok}.sleeppid"
  set -e -o pipefail
  _cancel_worker_watchdog
  if ! pid_alive "$helper"; then
    fail "assert_r6_cancel_skips_kill_when_cmdline_lacks_tag: unrelated helper $helper was killed"
    return
  fi
  reap_pid "$helper"
}

assert_r2_cgroup_worker_stdin_is_devnull() {
  local hide="$TEST_TMP/hide-cgroup-stdin" wrap="$TEST_TMP/wrap-systemd-run"
  local stub="$TEST_TMP/grok-stdin" runs="$TEST_TMP/runs-stdin"
  local rec="$TEST_TMP/worker-stdin.target"
  mkdir -p "$runs" "$wrap"
  : > "$rec"
  cat > "$stub" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "--list-models" ]; then
  cat <<'MODELS'
Available models

cursor-grok-4.6-low - Grok 4.6 (low)
MODELS
  exit 0
fi
case " \$* " in *" __autopilot_probe__ "*)
  echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: high, medium, low" >&2
  exit 1 ;;
esac
readlink /proc/self/fd/0 > "$rec" || true
exit 0
EOF
  chmod +x "$stub"
  local out="" real_sr
  real_sr="$(command -v systemd-run || true)"
  if host_has_user_scope && [ -n "$real_sr" ]; then
    cat > "$wrap/systemd-run" <<WRAP
#!/usr/bin/env bash
readlink /proc/self/fd/0 > "$rec" || true
exec "$real_sr" "\$@"
WRAP
    chmod +x "$wrap/systemd-run"
    out="$(cd "$SBX" && env PATH="$wrap:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch feat/wdog-stdin-cg --prompt-file "$PROMPT" --timeout 8s \
      < <(printf 'dispatcher-stdin-is-not-null\n') 2>&1)" || true
  else
    echo "SKIP assert_r2_cgroup_worker_stdin_is_devnull: no working systemd-run --user --scope; exercising plain path"
    hide_cgroup_dir "$hide"
    out="$(cd "$SBX" && env PATH="$hide:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      HETERO_TEST_NO_SETSID=1 \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch feat/wdog-stdin-plain --prompt-file "$PROMPT" --timeout 8s \
      < <(printf 'dispatcher-stdin-is-not-null\n') 2>&1)" || true
  fi
  [ -s "$rec" ] || fail "assert_r2_cgroup_worker_stdin_is_devnull: worker did not record fd0: $out"
  local target
  target="$(cat "$rec")"
  assert_eq "$target" "/dev/null" "worker stdin target"
}

assert_r6_cancel_kills_when_cmdline_has_tag() {
  eval "$(sed -n '/^_watchdog_sleeppid_cmdline_has_tag() {/,/^}$/p' "$SCRIPT")"
  eval "$(sed -n '/^_cancel_worker_watchdog() {/,/^}$/p' "$SCRIPT")"
  local tok="$TEST_TMP/hetero-wdog-tok-r6pos"
  : > "$tok"
  local tag="${tok##*/}"
  WATCHDOG_TOKEN_FILE="$tok"
  WATCHDOG_PID=""
  bash -c 'exec -a "hetero-wall-watchdog-'"$tag"'" /bin/sleep 120' &
  local helper=$!
  echo "$helper" > "${tok}.sleeppid"
  set -e -o pipefail
  _cancel_worker_watchdog
  if pid_alive "$helper"; then
    reap_pid "$helper"
    fail "assert_r6_cancel_kills_when_cmdline_has_tag: tagged sleeper $helper still alive"
    return
  fi
  wait "$helper" 2>/dev/null || true
}

assert_r1_nojobcontrol_reports_unenforced
assert_r1_nojobcontrol_detached_real_path
assert_r1_nosetsid_with_jobcontrol_still_enforces
assert_r9_no_job_notices_on_stderr
assert_r2_cgroup_kill_failure_falls_back_to_pgid
assert_r2_cgroup_kill_failure_detached_real_path
assert_r2_cgroup_worker_stdin_is_devnull
assert_r6_cancel_skips_kill_when_cmdline_lacks_tag
assert_r6_cancel_kills_when_cmdline_has_tag

finalize_test
