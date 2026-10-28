#!/usr/bin/env bash
# Tests for the PostToolUse watcher ensure hosted in hooks/audit-log.js (BL-0327 mechanism): every tool call re-ensures the ONE
# project watcher, so a watcher that idle-exited during a long tool-only stretch comes back on the next tool call, not only on the
# next prompt. Same sandbox rules as runs-watch-autostart.test.sh: HOME, CLAUDE_CONFIG_DIR, XDG_RUNTIME_DIR, AUTOPILOT_LIVE_DIR
# (a /dev/shm tmpdir), session-mode dir all under a mktemp dir; every watcher started is killed BY PID in the trap.
# Negative controls: watcher alive -> no git and no spawn; not-opted-in git repo / non-git dir -> no git; knob 0 -> nothing;
# throttle -> the second tool call inside 60 s does not take the full path; a throwing ensure leaves audit-log exiting 0 with its
# own bash-commands.log entry intact.
. "$(dirname "$0")/lib.sh"

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
AS=""

HOOK="$REPO_ROOT/hooks/audit-log.js"
NODE="$(command -v node)"
SB="$TEST_TMP/ale"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"; REPO="$SB/repo"; PLAIN="$SB/plainrepo"; NONREPO="$SB/nonrepo"
AHOME="$FAKE_HOME/.autopilot"; MARKERS="$AHOME/session-mode"
mkdir -p "$AHOME" "$FAKE_CLAUDE/metrics" "$FAKE_XDG" "$RUNS" "$REPO" "$PLAIN" "$NONREPO"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-ale-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_ale() {
  local p
  for p in $KILL_PIDS; do kill -9 "$p" 2>/dev/null; done
  rm -rf "$LIVE"
}
trap 'cleanup_ale; cleanup_test_tmp' EXIT
for r in "$REPO" "$PLAIN"; do
  git -C "$r" init -q
  git -C "$r" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
done
mkdir -p "$REPO/.claude"; printf '# dispatch\n' > "$REPO/.claude/dispatch-config.md" # onboarded; $PLAIN is a git repo with no config
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
LOCK="$LIVE/runs/$KEY.lock"
ENV_FILE="$LIVE/runs/$KEY.json"

# fake git: counts calls, then runs the real one
REALGIT="$(command -v git)"
mkdir -p "$SB/fakebin"
cat > "$SB/fakebin/git" <<GIT
#!/bin/sh
echo x >> "$SB/git-calls"
exec "$REALGIT" "\$@"
GIT
chmod +x "$SB/fakebin/git"
git_calls() { [ -f "$SB/git-calls" ] && wc -l < "$SB/git-calls" | tr -d ' ' || echo 0; }
reset_git_calls() { rm -f "$SB/git-calls"; }

wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u AUTOPILOT_RUNS_WATCH_AUTOSTART ${AS:+AUTOPILOT_RUNS_WATCH_AUTOSTART="$AS"} \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$MARKERS" AUTOPILOT_COSTS_FILE="$SB/costs.jsonl" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" ${WPATH:+PATH="$WPATH"} "$@"
}
envelope_pid() {
  node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$ENV_FILE"
}
wait_writer() {
  local i
  W_PID=""
  for i in $(seq 1 150); do
    W_PID="$(envelope_pid)"
    [ -n "$W_PID" ] && [ "$W_PID" != "${1:-}" ] && break
    W_PID=""
    sleep 0.1
  done
  [ -n "$W_PID" ] && KILL_PIDS="$KILL_PIDS $W_PID"
}
count_watchers() {
  node -e '
    const fs = require("fs"); let n = 0;
    for (const d of fs.readdirSync("/proc")) {
      if (!/^[0-9]+$/.test(d)) continue;
      let a; try { a = fs.readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0"); } catch (_) { continue; }
      const i = a.indexOf("--project");
      if (a.includes("--watch") && a.includes("runs") && i !== -1 && a[i + 1] === process.argv[1]) n += 1;
    }
    process.stdout.write(String(n));' "$KEY"
}
lock_free_within() {
  local i n=$(( $1 * 10 ))
  for i in $(seq 1 "$n"); do
    flock -n "$LOCK" true 2> /dev/null && { echo 0; return; }
    sleep 0.1
  done
  echo 1
}
# run_ptu <cwd> [session_id] [tool_name] -> HOOK_RC, HOOK_ERR (a PostToolUse payload to audit-log.js on stdin)
run_ptu() {
  (cd "$SB" && printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"%s","tool_input":{"command":"echo ale-%s"},"cwd":"%s"}' "${2:-ale-sess}" "${3:-Bash}" "${2:-ale-sess}" "$1" | wenv "$NODE" "$HOOK" > "$SB/h.out" 2> "$SB/h.err")
  HOOK_RC=$?
  HOOK_ERR="$(cat "$SB/h.err")"
}

# --- 1. RED->GREEN: onboarded repo, no watcher, a PostToolUse starts one ---------------------------------------
eq "0" "$(count_watchers)" "precondition: no watcher"
run_ptu "$REPO"
eq "0" "$HOOK_RC" "PostToolUse exits 0"
wait_writer
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "PostToolUse on an onboarded repo with no watcher starts one (envelope with writer.pid)"
FIRST_PID="$W_PID"
eq "1" "$(count_watchers)" "exactly one watcher"
eq "yes" "$(grep -q 'ale-ale-sess' "$FAKE_CLAUDE/../home/.claude/bash-commands.log" 2> /dev/null && echo yes || echo no)" "audit-log's own bash-commands.log entry is still written"

# --- 2. negative control: watcher alive -> no spawn, no git -----------------------------------------------------
rm -rf "$LIVE/autostart/ale-sess.ensure"
reset_git_calls
WPATH="$SB/fakebin:$PATH" run_ptu "$REPO"
eq "" "$HOOK_ERR" "alive: silent"
eq "0" "$(git_calls)" "alive: zero git processes (fast path)"
sleep 1
eq "$FIRST_PID" "$(envelope_pid)" "alive: starts nothing (same writer.pid)"
eq "1" "$(count_watchers)" "alive: still exactly one watcher"
kill -9 "$FIRST_PID" 2> /dev/null
eq "0" "$(lock_free_within 3)" "lock free after killing the watcher"
rm -f "$ENV_FILE"

# --- 3. negative control: not-opted-in git repo / non-git dir -> no git, no spawn ---------------------------------
reset_git_calls
WPATH="$SB/fakebin:$PATH" run_ptu "$PLAIN" ale-plain
WPATH="$SB/fakebin:$PATH" run_ptu "$NONREPO" ale-non
eq "0" "$(git_calls)" "not opted in / non-git: no git process"
sleep 1
eq "0" "$(count_watchers)" "not opted in / non-git: no watcher"

# --- 4. negative control: knob 0 -------------------------------------------------------------------------------
AS=0 run_ptu "$REPO" ale-off
sleep 1
eq "0" "$(count_watchers)" "AUTOPILOT_RUNS_WATCH_AUTOSTART=0: no watcher"

# --- 5. throttle: a start that cannot happen (no flock) is not retried via the full path inside 60 s ----------------
mkdir -p "$SB/nopath"
for tool in node; do ln -sf "$(command -v $tool)" "$SB/nopath/$tool"; done
cp "$SB/fakebin/git" "$SB/nopath/git"
rm -rf "$LIVE/autostart"
reset_git_calls
WPATH="$SB/nopath" run_ptu "$REPO" ale-thr
CALLS1="$(git_calls)"
eq "yes" "$([ "$CALLS1" -gt 0 ] && echo yes || echo no)" "no flock: the first PostToolUse takes the full path (git ran: $CALLS1)"
WPATH="$SB/nopath" run_ptu "$REPO" ale-thr
eq "$CALLS1" "$(git_calls)" "no flock: the second PostToolUse inside the throttle window runs no git"
eq "" "$HOOK_ERR" "throttled call is silent"
WPATH="$SB/nopath" run_ptu "$REPO" ale-thr2
eq "yes" "$([ "$(git_calls)" -gt "$CALLS1" ] && echo yes || echo no)" "another session is throttled separately (full path again)"
# an aged stamp lets the full path run again
touch -d '2 minutes ago' "$LIVE/autostart/ale-thr.ensure"
BEFORE="$(git_calls)"
WPATH="$SB/nopath" run_ptu "$REPO" ale-thr
eq "yes" "$([ "$(git_calls)" -gt "$BEFORE" ] && echo yes || echo no)" "a stamp older than 60 s no longer throttles"
# SessionStart / UserPromptSubmit are never throttled
BEFORE="$(git_calls)"
(cd "$SB" && printf '{"hook_event_name":"UserPromptSubmit","session_id":"ale-thr","cwd":"%s"}' "$REPO" | wenv env PATH="$SB/nopath" "$NODE" "$REPO_ROOT/hooks/runs-watch-autostart.js" > /dev/null 2> /dev/null)
eq "yes" "$([ "$(git_calls)" -gt "$BEFORE" ] && echo yes || echo no)" "UserPromptSubmit ignores the throttle"

# --- 6. fail-open: the ensure throws -> audit-log still exits 0 and writes its own entry ---------------------------------
cat > "$SB/throw.js" <<'JS'
const M = require('module'); const orig = M._load;
M._load = function (request, ...rest) { if (/runs-watch-autostart/.test(request)) throw new Error('boom-ensure'); return orig.call(this, request, ...rest); };
JS
rm -f "$FAKE_HOME/.claude/bash-commands.log"
NODE_OPTIONS="--require $SB/throw.js" run_ptu "$REPO" ale-throw
eq "0" "$HOOK_RC" "throwing ensure: audit-log exits 0"
eq "yes" "$(grep -q 'boom-ensure' <<<"$HOOK_ERR" && echo yes || echo no)" "throwing ensure: one stderr line names it"
eq "yes" "$(grep -q 'ale-ale-throw' "$FAKE_HOME/.claude/bash-commands.log" 2> /dev/null && echo yes || echo no)" "throwing ensure: bash-commands.log entry still written"

# --- 7. docs --------------------------------------------------------------------------------------------------------
eq "yes" "$(grep -q 'PostToolUse ensure' "$REPO_ROOT/hooks/README.md" && echo yes || echo no)" "hooks/README.md documents the PostToolUse ensure"

# nothing left running
eq "0" "$(count_watchers)" "no watcher left behind"
finalize_test
