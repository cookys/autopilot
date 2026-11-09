#!/usr/bin/env bash
# A card written is a card SEEN (BL cardvis). Owner report: in a repo with no `.claude/` and no session marker, `open-decision.js open`
# wrote two cards and exited 0, but no watcher ran and no pane listed them. This suite reproduces that with a real watcher, a real card
# and the pane's own reader (mods/live/model.ts readJobModel, through a test-only resolver for the mod's extensionless imports).
#
#   S1  no .claude, no marker, no runs: open -> a watcher starts, the UNBOUND job page lists the card (the page the pane reads when it finds
#       the project by runs/paths, the way the owner's pane does)
#   S2  a plain session (marker created by the open) with no runs: the marker-root job page lists the card
#   S3  closing the last card empties the unbound page again
#   S4  isolated environment on the shared live dir: the card is written, exit 5, stderr says it will not show and what to do
#   S5  a watcher started by hand without --render: exit 5 naming it
#   S6  opt-in: an open card makes the autostart hook start a watcher; with no card the same hook starts nothing
# Negative controls (RED shown before GREEN, see the commit message): card not an opt-in -> S6 red; no ensure on write -> S1/S2 red;
# no unbound page without runs -> S1 red.
# Every watcher this suite starts is killed BY PID in the trap; the live dir is a /dev/shm tmpdir.
. "$(dirname "$0")/lib.sh"

SB="$TEST_TMP/cv"; mkdir -p "$SB"; EXTRA_PIDS=""
LIVE="$(mktemp -d -p /dev/shm autopilot-test-cv-XXXXXX)"; chmod 700 "$LIVE"
OD="$REPO_ROOT/scripts/open-decision.js"
HOOK="$REPO_ROOT/hooks/runs-watch-autostart.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
cleanup_cv() {
  local f p
  for p in $EXTRA_PIDS; do kill -9 "$p" 2>/dev/null; done
  for f in "$LIVE"/runs/*.json; do
    p="$(node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1]));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$f" 2>/dev/null)"
    [ -n "$p" ] && kill -9 "$p" 2>/dev/null
  done
  rm -rf "$LIVE"
}
trap 'cleanup_cv; cleanup_test_tmp' EXIT

# newrepo <name>: a repo with no .claude; sets R, H (its own HOME), KEY
newrepo() {
  R="$SB/$1/repo"; H="$SB/$1/home"; mkdir -p "$R" "$H/.autopilot" "$SB/$1/claude" "$SB/$1/xdg" "$SB/$1/runs"
  $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
  KEY="$(cd "$R" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
}
# cenv <name> [VAR=val ...] -- cmd...: the autostart is ON (empty value = enabled), a private live dir, a private HOME
cenv() {
  local n="$1"; shift
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID -u CODEX_THREAD_ID -u AUTOPILOT_ROOT_RUN_ID \
    HOME="$SB/$n/home" CLAUDE_CONFIG_DIR="$SB/$n/claude" XDG_RUNTIME_DIR="$SB/$n/xdg" AUTOPILOT_LIVE_DIR="$LIVE" \
    AUTOPILOT_SESSION_MODE_DIR="$SB/$n/home/.autopilot/session-mode" AUTOPILOT_COSTS_FILE="$SB/$n/costs.jsonl" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$SB/$n/runs" ENGINE_CAPABILITY_DIR="$SB/$n/cap" AUTOPILOT_RUNS_WATCH_AUTOSTART= \
    AUTOPILOT_RUNS_WATCH_INTERVAL_S=1 AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S=120 "$@"
}
open_card() { # open_card <name> <question> [extra env as VAR=val...] ; stdout id, stderr -> $SB/err, rc in OPEN_RC
  local n="$1" q="$2"; shift 2
  OPEN_OUT="$(cenv "$n" "$@" node "$OD" open --executor ns/cc/exec--claude --cwd "$R" --question "$q" --option a::x --option b::y --not-authorized irreversible 2>"$SB/err")"; OPEN_RC=$?
}
# the pane's reader on the newest model.json of job <job> in <home>: prints "needs_decision:id,id"
pane_cards() { # pane_cards <name> <job>
  local f
  f="$(find -L "$SB/$1/home/.autopilot/review/$KEY" -path "*/$2/current/model.json" 2>/dev/null | sort | tail -1)" # the path the pane reads
  [ -r "$f" ] || { echo "no-model"; return; }
  node --no-warnings --import "$REPO_ROOT/hooks/tests/lib/ts-resolve-register.mjs" --input-type=module -e '
    import fs from "node:fs";
    const { readJobModel } = await import(process.argv[1] + "/mods/live/model.ts");
    const m = readJobModel(fs.readFileSync(process.argv[2], "utf8"));
    process.stdout.write(m === null ? "unreadable" : `${m.needs_decision}:${m.decisions.map((d) => d.id).sort().join(",")}`);
  ' "$REPO_ROOT" "$f" 2>/dev/null || echo "read-failed"
}
wait_cards() { # wait_cards <name> <job> <expected> (<= 20 s)
  local i got=""
  for i in $(seq 1 100); do got="$(pane_cards "$1" "$2")"; [ "$got" = "$3" ] && break; sleep 0.2; done
  echo "$got"
}

# ---- S1: the owner's case ----
newrepo s1
open_card s1 "Q-S1?"; ID1="$OPEN_OUT"
assert_eq "0" "$OPEN_RC" "S1 open exits 0 when a watcher can be ensured"
assert_eq "$(printf 'true:%s' "$ID1")" "$(wait_cards s1 unbound "true:$ID1")" "S1 the pane's reader lists the card from the unbound page (no .claude, no marker, no runs)"
assert_file_exists "$LIVE/runs/paths/$KEY.json" "S1 the watcher's paths file (how the pane finds the project without a marker) exists"
assert_contains "$(cat "$LIVE/runs/paths/$KEY.json")" "$(cd "$R" && pwd -P)" "S1 the paths file names the repo"
assert_contains "$(cat "$SB/err")" "UNBOUND scope" "S1 stderr still says where the card went"
# S3: closing the last card empties the page
cenv s1 node "$OD" close --cwd "$R" --id "$ID1" >/dev/null
assert_eq "false:" "$(wait_cards s1 unbound "false:")" "S3 closing the last card empties the unbound page"

# ---- S2: a plain session, no runs: the marker root's page ----
newrepo s2
open_card s2 "Q-S2?" CLAUDE_CODE_SESSION_ID=sid-s2; ID2="$OPEN_OUT"
assert_eq "0" "$OPEN_RC" "S2 open exits 0"
MARK="$SB/s2/home/.autopilot/session-mode/sid-s2.json"
assert_file_exists "$MARK" "S2 the open created the plain session marker"
ROOT2="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).root_run_id||"")' "$MARK")"
assert_neq "" "$ROOT2" "S2 the marker carries a root"
assert_eq "true:$ID2" "$(wait_cards s2 "$ROOT2" "true:$ID2")" "S2 the pane's reader lists the unbound card from the marker root's page"

# ---- S4: isolated environment on the shared live dir ----
newrepo s4
OUT4="$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u AUTOPILOT_LIVE_DIR HOME="$SB/s4/home" CLAUDE_CONFIG_DIR="$SB/s4/claude" XDG_RUNTIME_DIR="$SB/s4/xdg" \
  AUTOPILOT_SESSION_MODE_DIR="$SB/s4/home/.autopilot/session-mode" AUTOPILOT_RUNS_WATCH_AUTOSTART= node "$OD" open --executor ns/cc/exec--claude --cwd "$R" --question "Q-S4?" --option a::x --option b::y --not-authorized irreversible 2>"$SB/err4")"; RC4=$?
assert_eq "5" "$RC4" "S4 isolated environment: exit 5"
assert_contains "$OUT4" "d-" "S4 the id is still printed on stdout"
assert_contains "$(cat "$SB/err4")" "will NOT appear in any live panel" "S4 stderr says the card will not show"
assert_contains "$(cat "$SB/err4")" "AUTOPILOT_LIVE_DIR" "S4 stderr says what to do"
assert_contains "$(env HOME="$SB/s4/home" node "$OD" show --cwd "$R")" "Q-S4?" "S4 the card is written anyway"
OUT4B="$(env HOME="$SB/s4/home" AUTOPILOT_RUNS_WATCH_AUTOSTART=0 node "$OD" open --executor ns/cc/exec--claude --cwd "$R" --question "Q-S4b?" --option a::x --option b::y --not-authorized irreversible 2>/dev/null)"; assert_eq "0" "$?" "S4 autostart switched off: exit 0 (the owner's / a test's explicit switch)"

# ---- S5: a watcher started by hand without --render holds the lock; open replaces it ----
envpid() { node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1]));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$LIVE/runs/$1.json"; }
cmdline_has() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -q -- "$2" && echo yes || echo no; }
start_bare() { # start_bare <name>: a render-less watcher, the way `status runs --watch` used to run
  ( cd "$R" && cenv "$1" node -e '
    const r = require(process.argv[1] + "/src/status/runs-watch").startWatcherDetached({ key: process.argv[2], cwd: process.argv[3], env: process.env, render: false, interval: 1 });
    process.stdout.write(r.status);' "$REPO_ROOT" "$KEY" "$R" ) > "$SB/start.out"
  local i; for i in $(seq 1 100); do [ -n "$(envpid "$KEY")" ] && break; sleep 0.2; done
}
newrepo s5
start_bare s5
assert_eq "started" "$(cat "$SB/start.out")" "S5 a render-less watcher is running"
PID5="$(envpid "$KEY")"
assert_eq "no" "$(cmdline_has "$PID5" --render)" "S5 control: that watcher has no --render"
open_card s5 "Q-S5?"; ID5="$OPEN_OUT"
assert_eq "0" "$OPEN_RC" "S5 open replaces the render-less watcher: exit 0"
assert_eq "true:$ID5" "$(wait_cards s5 unbound "true:$ID5")" "S5 the card shows after the replacement"
for i in $(seq 1 50); do N5="$(envpid "$KEY")"; [ -n "$N5" ] && [ "$N5" != "$PID5" ] && break; sleep 0.2; done
assert_neq "$PID5" "$N5" "S5 a new watcher pid holds the lock"
assert_eq "yes" "$(cmdline_has "$N5" --render)" "S5 and it renders"
assert_eq "no" "$([ -d /proc/$PID5 ] && grep -q . "/proc/$PID5/cmdline" 2>/dev/null && echo alive || echo no)" "S5 the old watcher is gone (one writer)"

# ---- S7: the autostart hook replaces a render-less watcher (card or no card) ----
newrepo s7
start_bare s7
PID7="$(envpid "$KEY")"
cenv s7 node -e 'require(process.argv[1]+"/scripts/open-decision.js").openDecision({cwd:process.argv[2],root:null,session:null,question:"Q-S7?",options:[{label:"a"},{label:"b"}],not_authorized:"irreversible"})' "$REPO_ROOT" "$R"
printf '{"hook_event_name":"UserPromptSubmit","session_id":"sid-s7","cwd":"%s"}' "$R" | cenv s7 node "$HOOK"
for i in $(seq 1 100); do N7="$(envpid "$KEY")"; [ -n "$N7" ] && [ "$N7" != "$PID7" ] && break; sleep 0.2; done
assert_neq "$PID7" "$N7" "S7 the hook replaced the render-less watcher"
assert_eq "yes" "$(cmdline_has "$N7" --render)" "S7 the replacement renders"
assert_contains "$(wait_cards s7 unbound "true:$(cenv s7 node "$OD" show --cwd "$R" --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).decisions[0].id)')")" "true:d-" "S7 the card shows"

# ---- S8: a bare `status runs --watch` renders by default, --no-render does not ----
newrepo s8
( cd "$R" && cenv s8 setsid nohup node "$REPO_ROOT/bin/autopilot.js" status runs --watch --project "$KEY" --interval 1 --idle-exit 60 >"$SB/s8.log" 2>&1 < /dev/null & )
for i in $(seq 1 100); do [ -n "$(envpid "$KEY")" ] && break; sleep 0.2; done
P8="$(envpid "$KEY")"
assert_neq "" "$P8" "S8 a hand-run watcher published"
assert_eq "yes" "$(cmdline_has "$P8" --render)" "S8 a bare --watch carries --render"
open_card s8 "Q-S8?"; ID8="$OPEN_OUT"
assert_eq "true:$ID8" "$(wait_cards s8 unbound "true:$ID8")" "S8 the hand-run watcher publishes the card page"
NR="$(cd "$R" && cenv s8 node "$REPO_ROOT/bin/autopilot.js" status runs --watch --no-render --render 2>&1 | head -1)"
assert_contains "$NR" "exclude each other" "S8 --no-render with --render is refused"

# ---- S6: an open card is an opt-in for the autostart hook ----
newrepo s6
payload() { printf '{"hook_event_name":"UserPromptSubmit","session_id":"sid-s6","cwd":"%s"}' "$R"; }
payload | cenv s6 node "$HOOK"
sleep 1
assert_file_absent "$LIVE/runs/$KEY.json" "S6 control: no card, no .claude, no marker -> the hook starts nothing"
# write the card through the library (no ensure), then the hook alone must decide
cenv s6 node -e 'const r=require(process.argv[1]+"/scripts/open-decision.js").openDecision({cwd:process.argv[2],root:null,session:null,question:"Q-S6?",options:[{label:"a"},{label:"b"}],not_authorized:"irreversible"});process.stdout.write(r.status)' "$REPO_ROOT" "$R" >/dev/null
payload | cenv s6 node "$HOOK"
for i in $(seq 1 100); do [ -f "$LIVE/runs/$KEY.json" ] && break; sleep 0.2; done
assert_file_exists "$LIVE/runs/$KEY.json" "S6 an open card opts the project in: the hook started a watcher"

# ---- S9: the lock holder cannot be confirmed as a rendering watcher -> exit 5, never a silent 0 ----
# A real rendering watcher holds the lock (stopped, so it cannot rewrite its envelope); the envelope's writer pid is then pointed at a
# process the check must not trust: no such pid / unreadable argv (a kernel thread) / an argv that is not `status runs --watch --project <key>`.
envelope_pid_set() { node -e 'const fs=require("fs");const f=process.argv[1];const e=JSON.parse(fs.readFileSync(f));e.writer.pid=Number(process.argv[2]);fs.writeFileSync(f,JSON.stringify(e))' "$LIVE/runs/$KEY.json" "$1"; }
holder_case() { # holder_case <name> <label> <fake pid>
  newrepo "$1"
  open_card "$1" "Q-$1-a?"
  local i real; for i in $(seq 1 100); do real="$(envpid "$KEY")"; [ -n "$real" ] && break; sleep 0.2; done
  EXTRA_PIDS="$EXTRA_PIDS $real"; kill -STOP "$real"
  envelope_pid_set "$3"
  open_card "$1" "Q-$1-b?"
  assert_eq "5" "$OPEN_RC" "S9 $2: exit 5"
  assert_contains "$(cat "$SB/err")" "cannot be confirmed" "S9 $2: stderr says the holder cannot be confirmed"
  assert_contains "$(cat "$SB/err")" "status runs --stop --project $KEY" "S9 $2: stderr says what to do"
  kill -9 "$real" 2>/dev/null
}
holder_case s9a "holder pid does not exist" 4194000
holder_case s9b "holder argv unreadable (kernel thread)" 2
newrepo s9c
open_card s9c "Q-s9c-a?"
for i in $(seq 1 100); do REAL9="$(envpid "$KEY")"; [ -n "$REAL9" ] && break; sleep 0.2; done
EXTRA_PIDS="$EXTRA_PIDS $REAL9"; kill -STOP "$REAL9"
fake_holder() { # fake_holder <label> <expected rc> <argv...>: a sleeper the envelope names as the writer
  local label="$1" want="$2"; shift 2
  ( exec -a x "$@" ) & local pid=$!
  EXTRA_PIDS="$EXTRA_PIDS $pid"; sleep 0.5; envelope_pid_set "$pid"
  assert_eq "yes" "$(cmdline_has "$pid" status)" "S9 control ($label): the fake holder is alive"
  open_card s9c "Q-$label?"
  assert_eq "$want" "$OPEN_RC" "S9 $label: exit $want"
  [ "$want" = 5 ] && assert_contains "$(cat "$SB/err")" "cannot be confirmed" "S9 $label: stderr says the holder cannot be confirmed"
  kill -9 "$pid" 2>/dev/null
}
mkdir -p "$SB/fake/bin"; printf 'setTimeout(()=>{},120000)\n' > "$SB/fake/bin/autopilot.js"
# argv that merely names the watcher, behind a plain `node -e`: wrong entry point, no lock fd
fake_holder "argv only, wrong entry point" 5 node -e 'setTimeout(()=>{},120000)' -- status runs --watch --project="$KEY" --render
# unrecognisable argv
fake_holder "unrecognised argv" 5 node -e 'setTimeout(()=>{},120000)' -- status runs --watch --proj="$KEY" --render
# the right entry point and the right argv, but it holds no fd on the lock file
fake_holder "right entry and argv, no lock fd" 5 node "$SB/fake/bin/autopilot.js" status runs --watch --project="$KEY" --render
fake_holder "right entry and argv (spaced form), no lock fd" 5 node "$SB/fake/bin/autopilot.js" status runs --watch --project "$KEY" --render
# a real rendering watcher holds the lock: a second card is confirmed
newrepo s9d
open_card s9d "Q-s9d-a?"; for i in $(seq 1 100); do [ -n "$(envpid "$KEY")" ] && break; sleep 0.2; done
open_card s9d "Q-s9d-b?"
assert_eq "0" "$OPEN_RC" "S9 a real rendering watcher holds the lock: a second open is confirmed (exit 0)"

finalize_test
