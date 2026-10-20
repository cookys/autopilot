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
if [ -n "${HETERO_TEST_TERM_LOG:-}" ]; then
  trap 'echo TERM >> "$HETERO_TEST_TERM_LOG"' TERM
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
  # pgrep is host-wide: sibling suites / sessions run their own watchdogs. Mark this test's runs with a
  # unique env var (inherited by the setsid'd sleeper) and only count sleepers carrying our marker.
  local owner="wdog-owner-$$-$RANDOM" p
  for i in 1 2 3 4 5; do
    (cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" HETERO_TEST_SLEEP=0 HETERO_TEST_WDOG_OWNER="$owner" \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch "feat/wdog-fast-$i" --prompt-file "$PROMPT" --timeout 60s >/dev/null 2>&1) || true
    for p in $(pgrep -f 'hetero-wall-watchdog' 2>/dev/null || true); do
      if tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qx "HETERO_TEST_WDOG_OWNER=$owner"; then
        fail "assert_r1_no_stray_watchdog: leftover hetero-wall-watchdog sleeper (pid $p) after fast run $i"
      fi
    done
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

# A concurrent suite_residue_reap must not delete the live watchdog token.
# The token used to be mktemp -t hetero-wdog-tok-*, which matches the
# test-lockgated pattern hetero-*; a lockless reap then disarms the wall
# timeout while the manifest still says timeout_enforced.
# RED at f63cffef4f43dcc1e5831bcb04feb32590b30286:
# FAIL dispatch took 24s (want <19s); missing result JSON (outer timeout killed
# the dispatcher; worker-containment reported the scope Killed, no timed_out JSON);
# token name hetero-wdog-tok-XXXSAMPLE matches test-lockgated hetero-*;
# EXIT:1 (26 passed, 4 failed).
assert_reap_does_not_disarm_wall_timeout() {
  if ! declare -F suite_residue_reap >/dev/null 2>&1; then
    # shellcheck source=lib/suite-residue-reap.sh
    . "$REPO_ROOT/hooks/tests/lib/suite-residue-reap.sh"
  fi
  local priv="$TEST_TMP/wdog-reap-priv"
  local stub="$TEST_TMP/grok-reap" pidfile="$TEST_TMP/reap.pid" runs="$TEST_TMP/runs-reap"
  local outf="$TEST_TMP/reap.out"
  mkdir -p "$priv" "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  : > "$outf"
  local start now elapsed dpid stubpid=""
  start="$(date +%s)"
  (
    cd "$SBX" && timeout --foreground 25 env TMPDIR="$priv" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch feat/wdog-reap --prompt-file "$PROMPT" --timeout 4s
  ) >"$outf" 2>&1 &
  dpid=$!
  local i=0 token=""
  while [ "$i" -lt 100 ]; do
    token=""
    for f in "$priv"/*wdog-tok-*; do
      [ -e "$f" ] || continue
      case "$f" in
        *.sleeppid|*.fired|*.cancel) continue ;;
      esac
      token="$f"
      break
    done
    [ -n "$token" ] && break
    if ! kill -0 "$dpid" 2>/dev/null; then
      break
    fi
    sleep 0.05
    i=$((i + 1))
  done
  if [ -z "$token" ]; then
    kill "$dpid" 2>/dev/null || true
    wait "$dpid" 2>/dev/null || true
    stubpid="$(cat "$pidfile" 2>/dev/null || true)"
    [ -n "$stubpid" ] && kill "$stubpid" 2>/dev/null || true
    wait "$stubpid" 2>/dev/null || true
    fail "assert_reap_does_not_disarm_wall_timeout: watchdog token never appeared (out: $(cat "$outf"))"
    return
  fi
  # Private TMPDIR has no .autopilot-suite-run.*.lock, so the reap sees no other live run.
  ( TMPDIR="$priv" suite_residue_reap >/dev/null )
  local w=0
  while [ "$w" -lt 22 ]; do
    kill -0 "$dpid" 2>/dev/null || break
    sleep 1
    w=$((w + 1))
  done
  if kill -0 "$dpid" 2>/dev/null; then
    kill "$dpid" 2>/dev/null || true
  fi
  wait "$dpid" 2>/dev/null || true
  now="$(date +%s)"; elapsed=$((now - start))
  local out json
  out="$(cat "$outf")"
  json="$(last_json "$out")"
  [ "$elapsed" -lt 19 ] || fail "assert_reap_does_not_disarm_wall_timeout: dispatch took ${elapsed}s (want <19s = 4s timeout + ~15s grace)"
  [ -n "$json" ] || fail "assert_reap_does_not_disarm_wall_timeout: missing result JSON (out: $out)"
  if [ -n "$json" ]; then
    assert_eq "$(json_get "$json" timed_out)" "true" "reap-vs-watchdog timed_out"
  fi
  stubpid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$stubpid" ] || fail "assert_reap_does_not_disarm_wall_timeout: stub did not write pidfile"
  if [ -n "$stubpid" ] && pid_alive "$stubpid"; then
    fail "assert_reap_does_not_disarm_wall_timeout: stub pid $stubpid still alive"
  fi
  [ -n "$stubpid" ] && kill "$stubpid" 2>/dev/null || true
  [ -n "$stubpid" ] && wait "$stubpid" 2>/dev/null || true
}

# The mktemp -t prefix must not match any test-lockgated registry glob.
# _SRR_PATTERNS is required to stay equal to those entries; this catches a
# rename back into a reaped namespace (hetero-* and the rest).
assert_watchdog_token_prefix_avoids_test_lockgated() {
  local line prefix rc sample
  line="$(grep -E 'mktemp[[:space:]]+-t[[:space:]]+[^[:space:]]*wdog-tok-' "$SCRIPT" | head -n 1)"
  prefix="$(printf '%s\n' "$line" | sed -n 's/.*mktemp[[:space:]]\{1,\}-t[[:space:]]\{1,\}\([^[:space:]"]*\).*/\1/p' | sed 's/X\{3,\}$//')"
  [ -n "$prefix" ] || fail "assert_watchdog_token_prefix_avoids_test_lockgated: could not extract token prefix from: ${line:-<none>}"
  sample="${prefix}SAMPLE"
  rc=0
  node - "$REPO_ROOT/scripts/lib/tmp-residue-registry.json" "$sample" <<'NODE' || rc=$?
const fs = require('fs');
const reg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const name = process.argv[3];
function globToReg(g) {
  let s = '^';
  for (const c of g) {
    if (c === '*') s += '.*';
    else if (c === '?') s += '.';
    else s += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(s + '$');
}
const hits = [];
for (const e of reg.entries) {
  if (e.kind !== 'test-lockgated') continue;
  if (globToReg(e.pattern).test(name)) hits.push(e.pattern);
}
if (hits.length) {
  console.error('token name ' + name + ' matches test-lockgated: ' + hits.join(','));
  process.exit(1);
}
NODE
  [ "$rc" -eq 0 ] || fail "assert_watchdog_token_prefix_avoids_test_lockgated: prefix ${prefix} matches a test-lockgated pattern"
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
assert_reap_does_not_disarm_wall_timeout
assert_watchdog_token_prefix_avoids_test_lockgated

# Case A: an unregistered rm of the token must not disarm the wall timeout.
# The test deletes dispatch-wdog-tok-* itself (not via _cancel_worker_watchdog).
# RED at a405d179a: FAIL dispatch took 20s (want <16s); missing result JSON (outer timeout Killed the scope; worker still sleeping); vanished-token line not in stderr; EXIT:1

assert_vanished_token_still_enforces_timeout() {
  local priv="$TEST_TMP/wdog-vanish-priv" home="$TEST_TMP/wdog-vanish-home"
  local stub="$TEST_TMP/grok-vanish" pidfile="$TEST_TMP/vanish.pid" runs="$TEST_TMP/runs-vanish"
  local outf="$TEST_TMP/vanish.out"
  mkdir -p "$priv" "$home" "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  : > "$outf"
  local start now elapsed dpid token="" stubpid=""
  start="$(date +%s)"
  (
    cd "$SBX" && timeout --foreground 20 env HOME="$home" TMPDIR="$priv" \
      AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=120 \
      "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
      --branch feat/wdog-vanish --prompt-file "$PROMPT" --timeout 3s
  ) >"$outf" 2>&1 &
  dpid=$!
  local i=0
  while [ "$i" -lt 100 ]; do
    token=""
    for f in "$priv"/dispatch-wdog-tok-*; do
      [ -e "$f" ] || continue
      case "$f" in
        *.sleeppid|*.fired|*.cancel) continue ;;
      esac
      token="$f"
      break
    done
    [ -n "$token" ] && break
    if ! kill -0 "$dpid" 2>/dev/null; then
      break
    fi
    sleep 0.05
    i=$((i + 1))
  done
  if [ -z "$token" ]; then
    kill "$dpid" 2>/dev/null || true
    wait "$dpid" 2>/dev/null || true
    stubpid="$(cat "$pidfile" 2>/dev/null || true)"
    [ -n "$stubpid" ] && kill "$stubpid" 2>/dev/null || true
    [ -n "$stubpid" ] && wait "$stubpid" 2>/dev/null || true
    fail "assert_vanished_token_still_enforces_timeout: watchdog token never appeared (out: $(cat "$outf"))"
    return
  fi
  rm -f "$token"
  local w=0
  while [ "$w" -lt 18 ]; do
    kill -0 "$dpid" 2>/dev/null || break
    sleep 1
    w=$((w + 1))
  done
  if kill -0 "$dpid" 2>/dev/null; then
    kill "$dpid" 2>/dev/null || true
  fi
  wait "$dpid" 2>/dev/null || true
  now="$(date +%s)"; elapsed=$((now - start))
  local out json
  out="$(cat "$outf")"
  json="$(last_json "$out")"
  # 3s timeout + 10s grace. Startup sits inside this bound.
  [ "$elapsed" -lt 16 ] || fail "assert_vanished_token_still_enforces_timeout: dispatch took ${elapsed}s (want <16s = 3s timeout + 10s grace + slack)"
  [ -n "$json" ] || fail "assert_vanished_token_still_enforces_timeout: missing result JSON (out: $out)"
  if [ -n "$json" ]; then
    assert_eq "true" "$(json_get "$json" timed_out)" "vanished-token timed_out"
    assert_eq "true" "$(json_get "$json" timeout_enforced)" "vanished-token timeout_enforced"
  fi
  assert_contains "$out" "watchdog token vanished without cancel; enforcing timeout" "vanished-token stderr line"
  stubpid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$stubpid" ] || fail "assert_vanished_token_still_enforces_timeout: stub did not write pidfile"
  if [ -n "$stubpid" ] && pid_alive "$stubpid"; then
    fail "assert_vanished_token_still_enforces_timeout: stub pid $stubpid still alive"
    kill "$stubpid" 2>/dev/null || true
    wait "$stubpid" 2>/dev/null || true
  fi
}

# Case B: a runner that finishes inside the timeout is not signalled and
# leaves no watchdog token, cancel marker, fired stamp, or sleeppid.
assert_clean_finish_leaves_no_watchdog_residue() {
  local priv="$TEST_TMP/wdog-clean-priv" home="$TEST_TMP/wdog-clean-home"
  local stub="$TEST_TMP/grok-clean" pidfile="$TEST_TMP/clean.pid" runs="$TEST_TMP/runs-clean"
  local termlog="$TEST_TMP/clean-term.log"
  mkdir -p "$priv" "$home" "$runs"
  install_sleep_stub "$stub"
  : > "$pidfile"
  : > "$termlog"
  local start now elapsed out json left
  start="$(date +%s)"
  out="$(cd "$SBX" && env HOME="$home" TMPDIR="$priv" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_PIDFILE="$pidfile" HETERO_TEST_SLEEP=1 HETERO_TEST_TERM_LOG="$termlog" \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch feat/wdog-clean --prompt-file "$PROMPT" --timeout 30s 2>&1)" || true
  now="$(date +%s)"; elapsed=$((now - start))
  [ "$elapsed" -lt 20 ] || fail "assert_clean_finish_leaves_no_watchdog_residue: took ${elapsed}s (runner sleeps 1s inside a 30s timeout)"
  json="$(last_json "$out")"
  [ -n "$json" ] || fail "assert_clean_finish_leaves_no_watchdog_residue: missing JSON: $out"
  assert_eq "no_op" "$(json_get "$json" status)" "clean-finish status"
  assert_eq "false" "$(json_get "$json" timed_out)" "clean-finish timed_out"
  assert_not_contains "$out" "wall timeout" "clean-finish must not report a wall timeout"
  assert_not_contains "$(cat "$termlog" 2>/dev/null || true)" "TERM" "clean-finish worker was signalled"
  left="$(find "$priv" -name 'dispatch-wdog-tok-*' -print 2>/dev/null || true)"
  [ -z "$left" ] || fail "assert_clean_finish_leaves_no_watchdog_residue: residue left in TMPDIR: $left"
}

assert_vanished_token_still_enforces_timeout
assert_clean_finish_leaves_no_watchdog_residue

finalize_test
