#!/usr/bin/env bash
# RED at 1f81de14f02b5958237cf2f581934c2cad65c1ed:
# FAIL [dispatch-hetero-wall-timeout] assert_r1_grok_enforced_timeout_kills: dispatch took 30s (want <30s)
# FAIL missing result JSON (stderr banners only; worker still sleeping)
# FAIL timed_out/timeout_enforced empty vs true; stub pidfile unused on hang
# FAIL default timed_out expected '' got 'false' wait — actually expected 'false' got ''
# FAIL manifest timeout_source default: expected 'default', got ''
# FAIL term-ignore: took 40s
# EXIT:1 after ~107s (GNU timeout 30/40 wrapping unbounded run_worker wait)
#
# Wall-clock watchdog for dispatch-hetero.sh run_worker().
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

# Shared stub: write pid, then sleep (or ignore TERM). Probe/list-models paths exit immediately.
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

assert_timeout_kill_result() {
  local out="$1" elapsed="$2" pidfile="$3" label="$4"
  # Finding 2: enforced TERM path must not burn the full 10s grace after the
  # worker already exited. 3s timeout + ~1s token poll << 12s; 3+10 would fail.
  [ "$elapsed" -lt 12 ] || fail "$label: dispatch took ${elapsed}s (want <12s; extra grace after TERM is forbidden)"
  local json; json="$(last_json "$out")"
  [ -n "$json" ] || fail "$label: missing result JSON (out: $out)"
  assert_eq "failure" "$(json_get "$json" status)" "$label status"
  assert_eq "true" "$(json_get "$json" timed_out)" "$label timed_out"
  assert_eq "true" "$(json_get "$json" timeout_enforced)" "$label timeout_enforced"
  assert_eq "caller" "$(json_get "$json" timeout_source)" "$label timeout_source"
  assert_contains "$(json_get "$json" error)" "wall timeout" "$label error mentions wall timeout"
  local stubpid=""
  [ -f "$pidfile" ] && stubpid="$(cat "$pidfile")"
  [ -n "$stubpid" ] || fail "$label: stub did not write pidfile"
  if pid_alive "$stubpid"; then
    fail "$label: stub pid $stubpid still alive"
  fi
}

# --- grok rail, enforced 3s vs 120s stub ---
assert_r1_grok_enforced_timeout_kills() {
  local stub="$TEST_TMP/grok-sleep" pidfile="$TEST_TMP/grok.pid" runs="$TEST_TMP/runs-grok"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  local start now elapsed out
  start="$(date +%s)"
  out="$(cd "$SBX" && timeout 30 env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-grok --prompt-file "$PROMPT" --timeout 3s 2>&1)" || true
  now="$(date +%s)"; elapsed=$((now - start))
  assert_timeout_kill_result "$out" "$elapsed" "$pidfile" "assert_r1_grok_enforced_timeout_kills"
}

# Second non-agy rail: cursor. Picked because dispatch-hetero-cursor-routing.test.sh
# already stubs cursor-agent via --cursor-bin plus a --list-models inventory, so this
# suite can reuse that argv seam without grok's live effort probe.
assert_r1_second_rail_enforced() {
  local stub="$TEST_TMP/cursor-sleep" pidfile="$TEST_TMP/cursor.pid" runs="$TEST_TMP/runs-cursor"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  local start now elapsed out
  start="$(date +%s)"
  out="$(cd "$SBX" && timeout 30 env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
    "$SCRIPT" --runner cursor --model grok46 --effort low --cursor-bin "$stub" \
    --branch feat/wdog-cursor --prompt-file "$PROMPT" --timeout 3s 2>&1)" || true
  now="$(date +%s)"; elapsed=$((now - start))
  assert_timeout_kill_result "$out" "$elapsed" "$pidfile" "assert_r1_second_rail_enforced"
}

assert_r1_default_not_enforced() {
  local stub="$TEST_TMP/grok-five" pidfile="$TEST_TMP/five.pid" runs="$TEST_TMP/runs-default"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  local out json mf
  out="$(cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=5 \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-default --prompt-file "$PROMPT" 2>&1)" || true
  json="$(last_json "$out")"
  [ -n "$json" ] || fail "assert_r1_default_not_enforced: missing JSON: $out"
  assert_eq "false" "$(json_get "$json" timed_out)" "default timed_out"
  assert_eq "false" "$(json_get "$json" timeout_enforced)" "default timeout_enforced"
  mf="$(find "$runs" -name '*.manifest.json' | head -1)"
  [ -n "$mf" ] || fail "assert_r1_default_not_enforced: no manifest"
  assert_eq "default" "$(json_get "$(cat "$mf")" timeout_source)" "manifest timeout_source default"
}

assert_r1_no_stray_watchdog() {
  local stub="$TEST_TMP/grok-fast" runs="$TEST_TMP/runs-fast" i
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  # Repeat a zero-sleep worker so cancel races the sleeper pidfile write.
  for i in 1 2 3 4 5; do
    (cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" HETERO_TEST_SLEEP=0 \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch "feat/wdog-fast-$i" --prompt-file "$PROMPT" --timeout 60s >/dev/null 2>&1) || true
    if pgrep -f 'hetero-wall-watchdog' >/dev/null 2>&1; then
      fail "assert_r1_no_stray_watchdog: leftover hetero-wall-watchdog sleeper after fast run $i"
    fi
  done
}

assert_r1_term_ignoring_worker_killed() {
  local stub="$TEST_TMP/grok-trap" pidfile="$TEST_TMP/trap.pid" runs="$TEST_TMP/runs-trap"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  local start now elapsed out stubpid
  start="$(date +%s)"
  out="$(cd "$SBX" && timeout 40 env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 HETERO_TEST_IGNORE_TERM=1 \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-trap --prompt-file "$PROMPT" --timeout 3s 2>&1)" || true
  now="$(date +%s)"; elapsed=$((now - start))
  [ "$elapsed" -lt 40 ] || fail "term-ignore: took ${elapsed}s"
  local json; json="$(last_json "$out")"
  assert_eq "true" "$(json_get "$json" timed_out)" "term-ignore timed_out"
  stubpid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$stubpid" ] || fail "term-ignore: no pidfile"
  if pid_alive "$stubpid"; then
    fail "term-ignore: pid $stubpid still alive after SIGKILL grace"
  fi
}

# Force HAVE_CGROUP=0 so run_worker takes the HAVE_SETSID --wait path even when
# this host's systemd-run --user --scope probe would otherwise succeed.
assert_setsid_wait_path_enforced_timeout_kills() {
  command -v setsid >/dev/null 2>&1 || fail "assert_setsid_wait_path: setsid missing"
  grep -q -- --wait < <(setsid --help 2>&1) || fail "assert_setsid_wait_path: setsid --wait unsupported"
  local hide="$TEST_TMP/hide-cgroup"
  mkdir -p "$hide"
  cat > "$hide/systemd-run" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  chmod +x "$hide/systemd-run"
  local stub="$TEST_TMP/grok-setsid" pidfile="$TEST_TMP/setsid.pid" runs="$TEST_TMP/runs-setsid"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  local start now elapsed out
  start="$(date +%s)"
  out="$(cd "$SBX" && timeout 30 env PATH="$hide:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-setsid --prompt-file "$PROMPT" --timeout 3s 2>&1)" || true
  now="$(date +%s)"; elapsed=$((now - start))
  assert_timeout_kill_result "$out" "$elapsed" "$pidfile" "assert_setsid_wait_path_enforced_timeout_kills"
}

# Same HAVE_CGROUP=0 / setsid --wait seam, but TERM is ignored and the worker
# only has a looping sleep-1 child — so a grandchild-only kill cannot succeed.
assert_setsid_wait_path_term_ignore_kills() {
  command -v setsid >/dev/null 2>&1 || fail "assert_setsid_wait_path_term_ignore: setsid missing"
  grep -q -- --wait < <(setsid --help 2>&1) || fail "assert_setsid_wait_path_term_ignore: setsid --wait unsupported"
  local hide="$TEST_TMP/hide-cgroup-trap"
  mkdir -p "$hide"
  cat > "$hide/systemd-run" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  chmod +x "$hide/systemd-run"
  local stub="$TEST_TMP/grok-setsid-trap" pidfile="$TEST_TMP/setsid-trap.pid" runs="$TEST_TMP/runs-setsid-trap"
  mkdir -p "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  local start now elapsed out
  start="$(date +%s)"
  out="$(cd "$SBX" && timeout 30 env PATH="$hide:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_BUSYLOOP=1 HETERO_TEST_IGNORE_TERM=1 \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-setsid-trap --prompt-file "$PROMPT" --timeout 3s 2>&1)" || true
  now="$(date +%s)"; elapsed=$((now - start))
  [ "$elapsed" -lt 20 ] || fail "assert_setsid_wait_path_term_ignore_kills: took ${elapsed}s (want 3s + 10s grace + SIGKILL)"
  local json; json="$(last_json "$out")"
  [ -n "$json" ] || fail "assert_setsid_wait_path_term_ignore_kills: missing result JSON (out: $out)"
  assert_eq "true" "$(json_get "$json" timed_out)" "setsid-trap timed_out"
  assert_eq "true" "$(json_get "$json" timeout_enforced)" "setsid-trap timeout_enforced"
  local stubpid=""
  [ -f "$pidfile" ] && stubpid="$(cat "$pidfile")"
  [ -n "$stubpid" ] || fail "assert_setsid_wait_path_term_ignore_kills: stub did not write pidfile"
  if pid_alive "$stubpid"; then
    fail "assert_setsid_wait_path_term_ignore_kills: stub pid $stubpid still alive"
  fi
}

# Detached path (ledger + run-id + stage together): default DISPATCH_DETACH.
# Poll the durable result file — do not treat the wrapper as a synchronous kill.
# RED at 88d76b8271872a7125ba6a7ea6d9a12c3cf95a93:
# FAIL [dispatch-hetero-wall-timeout] assert_detached_path_enforced_timeout_kills: result not available within 55s (watchdog never armed; stub still sleeping 120s)
# FAIL stub pid still alive after 55s poll; EXIT:1 (~97s wall; prior 6 cases still passed)
LEDGER_SH="$REPO_ROOT/scripts/run-ledger.sh"

assert_detached_path_enforced_timeout_kills() {
  local stub="$TEST_TMP/grok-detach" pidfile="$TEST_TMP/detach.pid"
  local runs="$TEST_TMP/runs-detach" ledger="$TEST_TMP/detach/ledger.jsonl"
  local result="${ledger}.results/wdog-detach.implement.result.json"
  mkdir -p "$runs" "$(dirname "$ledger")"
  bash "$LEDGER_SH" init --ledger "$ledger" >/dev/null
  install_sleep_stub "$stub"
  : > "$pidfile"
  local start now elapsed json stubpid
  start="$(date +%s)"
  (
    cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch feat/wdog-detach --prompt-file "$PROMPT" --timeout 3s \
      --ledger "$ledger" --run-id wdog-detach --stage implement
  ) >/dev/null 2>&1 &
  if ! poll_until 55 test -f "$result"; then
    fail "assert_detached_path_enforced_timeout_kills: result not available within 55s (watchdog never armed; stub still sleeping 120s)"
    return
  fi
  now="$(date +%s)"; elapsed=$((now - start))
  [ "$elapsed" -lt 60 ] || fail "assert_detached_path_enforced_timeout_kills: took ${elapsed}s (want well under 60s vs 10s grace)"
  json="$(cat "$result")"
  [ -n "$json" ] || fail "assert_detached_path_enforced_timeout_kills: empty result"
  assert_eq "failure" "$(json_get "$json" status)" "detached status"
  assert_eq "true" "$(json_get "$json" timed_out)" "detached timed_out"
  assert_eq "true" "$(json_get "$json" timeout_enforced)" "detached timeout_enforced"
  assert_eq "3" "$(json_get "$json" timeout_seconds)" "detached timeout_seconds"
  assert_contains "$(json_get "$json" error)" "wall timeout" "detached error mentions wall timeout"
  stubpid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$stubpid" ] || fail "assert_detached_path_enforced_timeout_kills: stub did not write pidfile"
  if pid_alive "$stubpid"; then
    fail "assert_detached_path_enforced_timeout_kills: stub pid $stubpid still alive"
  fi
}

# Isolate _watchdog_signal_worker without executing dispatch-hetero main.
# RED at 9d50f3186f798b318d804e5ce837ba6820f7444d:
# FAIL [bash] assert_r6_no_bare_pid_fallback: helper 1533245 died (bare-pid fallback; state='gone')
# FAIL [bash] 0 passed, 1 failed
#       - assert_r6_no_bare_pid_fallback: helper 1533245 died (bare-pid fallback; state='gone')
assert_r6_no_bare_pid_fallback() {
  unset SCOPE_UNIT
  eval "$(sed -n '/^_self_pgid() {/,/^}$/p' "$SCRIPT")"
  eval "$(sed -n '/^_watchdog_signal_worker() {/,/^}$/p' "$SCRIPT")"
  /bin/sleep 120 &
  local helper=$!
  local hpg selfpg
  hpg="$(ps -o pgid= -p "$helper" 2>/dev/null | tr -d ' ')"
  selfpg="$(_self_pgid)"
  [ -n "$hpg" ] && [ "$hpg" = "$selfpg" ] || fail "assert_r6_no_bare_pid_fallback: helper must share the test process group (not be its own leader)"
  [ "$helper" != "$selfpg" ] || fail "assert_r6_no_bare_pid_fallback: helper pid equals pgid; cannot isolate non-leader case"
  [ "$helper" != "$$" ] || fail "assert_r6_no_bare_pid_fallback: helper pid is the test shell"
  WORKER_SID="$helper"
  _watchdog_signal_worker TERM
  # kill -0 is true for a zombie; after a successful bare-pid TERM the helper
  # is Z or gone. A live non-leader sleep stays S/R/D.
  local state
  state="$(ps -o state= -p "$helper" 2>/dev/null | tr -d ' ')"
  case "$state" in
    S|R|D) ;;
    *) fail "assert_r6_no_bare_pid_fallback: helper $helper died (bare-pid fallback; state='${state:-gone}')" ;;
  esac
  kill "$helper" 2>/dev/null || true
  wait "$helper" 2>/dev/null || true
}

assert_r1_grok_enforced_timeout_kills
assert_r1_second_rail_enforced
assert_r1_default_not_enforced
assert_r1_no_stray_watchdog
assert_r1_term_ignoring_worker_killed
assert_setsid_wait_path_enforced_timeout_kills
assert_setsid_wait_path_term_ignore_kills
assert_detached_path_enforced_timeout_kills
assert_r6_no_bare_pid_fallback

finalize_test
