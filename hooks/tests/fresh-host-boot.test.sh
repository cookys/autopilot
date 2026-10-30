#!/usr/bin/env bash
# fresh-host-boot.test.sh -- a freshly booted / brand-new host: no TMPDIR contents, no dispatch-runs directory, empty HOME (BL-0336 U1).
#
# The REAL hooks/runs-watch-autostart.js handles a SessionStart payload and starts the REAL detached watcher (no watcher is started by
# hand). Fixture: an empty HOME, a private AUTOPILOT_LIVE_DIR (/dev/shm, 0700; it dodges the isolated-environment gate), an opted-in
# fixture repo, a sentinel PATH (stub paid CLIs that record a call and fail), AUTOPILOT_DISPATCH_RUNS_DIR UNSET so the runs directory
# derives from TMPDIR, and two TMPDIR shapes: (i) exists and is empty, (ii) names a path that does not exist.
#
# Expected: the runs directory (and in case ii the TMPDIR itself) appears with mode 0700, this launch's result file says ok under the
# recorded launch id, an envelope is published, the hook prints nothing.
# Negative controls (run in this file against a COPY of the plugin with one line broken):
#   - the shared ensure no longer makes directories      -> no envelope, a failed launch result, the next hook run reports why
#   - failure sentences: once per session, again for another session, and never the stale reason of an earlier launch
# Every watcher this suite starts is killed BY PID in the trap. Nothing touches the real ~/.autopilot, ~/.claude, /run/user or /tmp/.
. "$(dirname "$0")/lib.sh"

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
NODE="$(command -v node)"
SB="$TEST_TMP/boot"
mkdir -p "$SB"
SENT="$SB/sentinel"; mkdir -p "$SENT"
for t in claude codex grok agy kimi; do
  printf '#!/bin/sh\necho "%s $*" >> "%s/called"\nexit 1\n' "$t" "$SB/sentinel-calls" > "$SENT/$t"; chmod +x "$SENT/$t"
done
REPO="$SB/repo"
mkdir -p "$REPO/.claude"
git -C "$REPO" init -q
git -C "$REPO" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
printf '# cfg\n' > "$REPO/.claude/dispatch-config.md"
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"

KILL_PIDS=""
LIVES=""
cleanup_boot() {
  local p d
  for p in $KILL_PIDS; do kill -9 "$p" 2> /dev/null; done
  for d in $LIVES; do rm -rf "$d"; done
}
trap 'cleanup_boot; cleanup_test_tmp' EXIT

# boot_env <case dir> <TMPDIR value> -> runs a command with the fixture environment
benv() {
  local cdir="$1" tmpd="$2"; shift 2
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u AUTOPILOT_DISPATCH_RUNS_DIR -u TMPDIR \
    AUTOPILOT_RUNS_WATCH_AUTOSTART=1 AUTOPILOT_REVIEW_SERVER_AUTOSTART=0 \
    HOME="$cdir/home" CLAUDE_CONFIG_DIR="$cdir/claude" XDG_RUNTIME_DIR="$cdir/xdg" \
    AUTOPILOT_LIVE_DIR="$CLIVE" AUTOPILOT_SESSION_MODE_DIR="$cdir/home/.autopilot/session-mode" AUTOPILOT_COSTS_FILE="$cdir/costs.jsonl" \
    ENGINE_CAPABILITY_DIR="$cdir/cap" TMPDIR="$tmpd" PATH="$SENT:$PATH" "$@"
}
new_case() { # <name> -> sets CD (case dir) with an empty HOME and a private live dir
  CD="$SB/$1"
  mkdir -p "$CD/home" "$CD/claude" "$CD/xdg"
  CLIVE="$(mktemp -d -p /dev/shm autopilot-test-boot-XXXXXX)"; chmod 700 "$CLIVE"
  LIVES="$LIVES $CLIVE"
}
hook() { # <root> <event> <sid> -> HOOK_RC HOOK_OUT HOOK_ERR (tmpdir value in BTMP)
  local root="$1" ev="$2" sid="$3"
  printf '{"hook_event_name":"%s","source":"startup","session_id":"%s","cwd":"%s"}' "$ev" "$sid" "$REPO" \
    | (cd "$SB" && benv "$CD" "$BTMP" "$NODE" "$root/hooks/runs-watch-autostart.js" > "$CD/h.out" 2> "$CD/h.err")
  HOOK_RC=$?
  HOOK_OUT="$(cat "$CD/h.out")"; HOOK_ERR="$(cat "$CD/h.err")"
}
envelope_pid() {
  node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$CLIVE/runs/$KEY.json"
}
wait_writer() { # waits up to $1 s; sets W_PID
  local i n=$(( $1 * 10 ))
  W_PID=""
  for i in $(seq 1 "$n"); do
    W_PID="$(envelope_pid)"
    [ -n "$W_PID" ] && break
    sleep 0.1
  done
  [ -n "$W_PID" ] && KILL_PIDS="$KILL_PIDS $W_PID"
}
wait_result() { # waits up to $1 s for the current launch's result file; prints its path
  local i n=$(( $1 * 10 )) ldir="$CD/home/.autopilot/review/$KEY/live" id f
  for i in $(seq 1 "$n"); do
    id="$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).launch_id)}catch(_){}' "$ldir/watcher-launch.json")"
    f="$ldir/watcher-start.$id.json"
    [ -n "$id" ] && [ -f "$f" ] && { echo "$f"; return; }
    sleep 0.1
  done
}
need_result() { # need_result <what> <secs>: sets RES to the result path of the current launch; a timeout is a FAIL naming the launch
  local ldir="$CD/home/.autopilot/review/$KEY/live" id
  RES="$(wait_result "$2")"
  if [ -z "$RES" ]; then
    id="$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).launch_id)}catch(_){process.stdout.write("(no record)")}' "$ldir/watcher-launch.json")"
    fail "$1: no result file for launch $id within $2 s (case dir $CD)"
  fi
}
jfield() { node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(v[process.argv[2]]))}catch(_){process.stdout.write("?")}' "$1" "$2"; }
modeof() { stat -c %a "$1" 2> /dev/null; }

# ---- the good plugin: two TMPDIR shapes -------------------------------------------------------------------
for shape in exists missing; do
  new_case "good-$shape"
  if [ "$shape" = exists ]; then BTMP="$CD/tmp"; mkdir -p "$BTMP"; else BTMP="$CD/not/yet/tmp"; fi
  hook "$REPO_ROOT" SessionStart "sess-$shape"
  eq "0" "$HOOK_RC" "[$shape] hook exits 0"
  eq "" "$HOOK_OUT" "[$shape] a healthy start prints nothing"
  wait_writer 20
  eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "[$shape] a watcher publishes an envelope although nothing existed beforehand"
  RUNS="$BTMP/autopilot-dispatch-runs"
  eq "700" "$(modeof "$RUNS")" "[$shape] the runs directory was made by the product, mode 0700"
  [ "$shape" = missing ] && eq "700" "$(modeof "$BTMP")" "[$shape] the TMPDIR the user named was made, mode 0700"
  need_result "[good/$shape] first launch" 10
  eq "yes" "$([ -n "$RES" ] && echo yes || echo no)" "[$shape] this launch left a result file under its launch id"
  eq "true" "$(jfield "$RES" ok)" "[$shape] the result says ok"
  LID="$(jfield "$CD/home/.autopilot/review/$KEY/live/watcher-launch.json" launch_id)"
  eq "$LID" "$(jfield "$RES" launch_id)" "[$shape] the result carries the recorded launch id"
done
eq "no" "$([ -e "$SB/sentinel-calls" ] && echo yes || echo no)" "no paid CLI was ever called (sentinel PATH)"

# ---- negative control 1 (the plan's): the shared ensure makes no directory at all ------------------------------
# Not even the launch record's directory can be made, so no watcher comes up and the hook says why (live directory unusable).
mkplugin() { # <dest> <file> <from> <to>
  mkdir -p "$1"
  node -e '
    const { copyPlugin, mutate } = require(process.argv[1] + "/hooks/tests/lib/plugin-copy");
    copyPlugin(process.argv[1], process.argv[2]);
    mutate(process.argv[2], process.argv[3], process.argv[4], process.argv[5]);
  ' "$REPO_ROOT" "$1" "$2" "$3" "$4" || fail "could not build the mutated plugin copy $1"
}
mkplugin "$SB/mut-nomake" scripts/lib/runtime-paths.js "f.mkdirSync(layer, { mode: 0o700 });" "/* mutation: the shared ensure makes nothing */"
for shape in exists missing; do
  new_case "nomake-$shape"
  if [ "$shape" = exists ]; then BTMP="$CD/tmp"; mkdir -p "$BTMP"; else BTMP="$CD/not/yet/tmp"; fi
  hook "$SB/mut-nomake" SessionStart "sess-n-$shape"
  wait_writer 5
  eq "no" "$([ -n "$W_PID" ] && echo yes || echo no)" "[nomake/$shape] with the shared ensure broken NO watcher comes up (the good case above is not vacuous)"
  eq "no" "$([ -d "$BTMP/autopilot-dispatch-runs" ] && echo yes || echo no)" "[nomake/$shape] ...and the runs directory does not exist"
  eq "yes" "$(printf '%s' "$HOOK_OUT" | grep -q 'additionalContext":"live 目錄無法使用：' && echo yes || echo no)" "[nomake/$shape] the hook says the directory cannot be used instead of staying silent"
done

# ---- negative control 2: the watcher refuses the runs directory -> a failed launch result, reported by the next hook run -----
mkplugin "$SB/mut-refuse" scripts/lib/runtime-paths.js "function ensureRunsDir(env = process.env, deps) {
  return ensurePrivateDir(runsDir(env), deps);" "function ensureRunsDir(env = process.env, deps) {
  return { ok: false, path: runsDir(env), reason: 'mutation: this directory is refused' };"
for shape in exists missing; do
  new_case "refuse-$shape"
  if [ "$shape" = exists ]; then BTMP="$CD/tmp"; mkdir -p "$BTMP"; else BTMP="$CD/not/yet/tmp"; fi
  # stale evidence of EARLIER launches: a log line and a result file that must not decide anything about this launch
  mkdir -p "$CD/home/.autopilot/review/$KEY/live"
  printf 'watcher startup failed: STALE reason from last week\n' > "$CD/home/.autopilot/review/$KEY/live/watcher.log"
  printf '{"launch_id":"deadbeefdeadbeef","ok":false,"reason":"STALE reason from last week"}\n' > "$CD/home/.autopilot/review/$KEY/live/watcher-start.deadbeefdeadbeef.json"
  hook "$SB/mut-refuse" SessionStart "sess-r-$shape"
  wait_writer 5
  eq "no" "$([ -n "$W_PID" ] && echo yes || echo no)" "[refuse/$shape] a watcher that is refused its runs directory publishes nothing"
  need_result "[refuse/$shape] first launch" 20
  eq "false" "$(jfield "$RES" ok)" "[refuse/$shape] this launch's result says it failed"
  eq "yes" "$(grep -q 'dispatch runs directory unusable: mutation: this directory is refused' "$RES" && echo yes || echo no)" "[refuse/$shape] with the reason the watcher gave"
  eq "no" "$(grep -q 'STALE' "$RES" && echo yes || echo no)" "[refuse/$shape] not the stale reason of an earlier launch"
  # the NEXT hook run reports it, once per session
  hook "$SB/mut-refuse" UserPromptSubmit "sess-r-$shape"
  eq "yes" "$(printf '%s' "$HOOK_OUT" | grep -q '"systemMessage":"watcher 無法啟動：dispatch runs directory unusable: mutation' && echo yes || echo no)" "[refuse/$shape] the next UserPromptSubmit returns systemMessage 'watcher 無法啟動：<reason>'"
  eq "no" "$(printf '%s' "$HOOK_OUT" | grep -q 'STALE' && echo yes || echo no)" "[refuse/$shape] ...and never the stale reason"
  # Every hook run starts a NEW (doomed) watcher, whose launch stays 'pending' until that child writes its result. A run that lands
  # in that window sees a pending newest launch and says nothing; real prompts are seconds apart, so the test waits for each result.
  need_result "[refuse/$shape] launch before the second prompt" 20
  hook "$SB/mut-refuse" UserPromptSubmit "sess-r-$shape"
  eq "" "$HOOK_OUT" "[refuse/$shape] the same session is not told twice"
  need_result "[refuse/$shape] launch before the other session's prompt" 20
  hook "$SB/mut-refuse" UserPromptSubmit "sess-other-$shape"
  eq "yes" "$(printf '%s' "$HOOK_OUT" | grep -q '"systemMessage":"watcher 無法啟動：' && echo yes || echo no)" "[refuse/$shape] another session is told"
done

# ---- a live directory that cannot be used is named, once per session (plan B: 'live 目錄無法使用：<reason>') ----------------
new_case livedir
BTMP="$CD/tmp"; mkdir -p "$BTMP"
REAL_LIVE="$CLIVE"; CLIVE="$CD/live-is-a-symlink"; ln -s "$REAL_LIVE" "$CLIVE"
hook "$REPO_ROOT" SessionStart "sess-live"
eq "yes" "$(printf '%s' "$HOOK_OUT" | grep -q 'additionalContext":"live 目錄無法使用：' && echo yes || echo no)" "[livedir] SessionStart returns 'live 目錄無法使用：<reason>' as additionalContext"
eq "yes" "$(printf '%s' "$HOOK_OUT" | grep -q 'symlink' && echo yes || echo no)" "[livedir] ...and the reason says why (a symlink)"
hook "$REPO_ROOT" UserPromptSubmit "sess-live"
eq "" "$HOOK_OUT" "[livedir] the same session is not told twice"
hook "$REPO_ROOT" UserPromptSubmit "sess-live-2"
eq "yes" "$(printf '%s' "$HOOK_OUT" | grep -q '"systemMessage":"live 目錄無法使用：' && echo yes || echo no)" "[livedir] another session gets it as a systemMessage"

finalize_test
