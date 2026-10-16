#!/usr/bin/env bash
# Isolation guard for the machine-global <live>/load-source.json: a watcher running in an isolated environment (own HOME /
# CLAUDE_CONFIG_DIR) on the SHARED live dir (no AUTOPILOT_LIVE_DIR) must neither publish it nor be started at all.
# Covers src/status/load-source.js (publisher + isolatedEnv), src/status/runs-watch.js startWatcherDetached and
# hooks/runs-watch-autostart.js. Every live dir is a mktemp dir; no real /run/user/*/autopilot or ~/.autopilot is touched.
# RED against the unguarded code (develop 8279bd96): the publisher test overwrote the dev file with source "unknown", and
# the autostart test left a runs/<key>.lock + watcher under the shared XDG live dir.
. "$(dirname "$0")/lib.sh"

SB="$TEST_TMP/lsi"
REAL_HOME="$(node -e 'process.stdout.write(require("os").userInfo().homedir)')"
mkdir -p "$SB/home" "$SB/emptycfg"
XDG="$(mktemp -d -p /dev/shm autopilot-test-lsi-XXXXXX)"; chmod 700 "$XDG"
KILL_PIDS=""
cleanup_lsi() { local p; for p in $KILL_PIDS; do kill -9 "$p" 2>/dev/null; done; rm -rf "$XDG"; }
trap 'cleanup_lsi; cleanup_test_tmp' EXIT

# publish <live> <env-json> -> runs one publish() with the given env; prints nothing. Fact detection is stubbed so the
# result is independent of any real ~/.claude: a real claude dir yields "dev", an empty/foreign one "unknown".
publish() {
  node -e '
    const fs = require("fs"), path = require("path");
    const { createLoadSourcePublisher } = require(process.argv[1] + "/src/status/load-source");
    const live = process.argv[2], env = JSON.parse(process.argv[3]);
    const detect = ({ claudeDir }) => ({ plugin_version: "t", source: fs.existsSync(path.join(claudeDir, "plugins")) ? "dev" : "unknown", flags: [] });
    const writeAtomic = (f, b) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); };
    createLoadSourcePublisher({ live, env, repoDir: process.argv[1], writeAtomic, detect }).publish({ nowMs: Date.now() });
  ' "$REPO_ROOT" "$1" "$2" 2>/dev/null
}
src_of() { node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).source)}catch(e){process.stdout.write("absent")}' "$1/load-source.json"; }

# 1. isolated HOME + empty CLAUDE_CONFIG_DIR, shared live dir already holding source:dev -> file untouched
L1="$SB/live1"; mkdir -p "$L1"; printf '{"schema":"autopilot.load-source/1","source":"dev"}\n' > "$L1/load-source.json"
publish "$L1" "{\"HOME\":\"$SB/home\",\"CLAUDE_CONFIG_DIR\":\"$SB/emptycfg\"}"
assert_eq "$(src_of "$L1")" "dev" "isolated env on a shared live dir leaves load-source.json untouched"

# 1b. CLAUDE_CONFIG_DIR alone (real HOME) is enough to be isolated
L1b="$SB/live1b"; mkdir -p "$L1b"; printf '{"schema":"autopilot.load-source/1","source":"dev"}\n' > "$L1b/load-source.json"
publish "$L1b" "{\"HOME\":\"$REAL_HOME\",\"CLAUDE_CONFIG_DIR\":\"$SB/emptycfg\"}"
assert_eq "$(src_of "$L1b")" "dev" "foreign CLAUDE_CONFIG_DIR on a shared live dir leaves the file untouched"

# 2. same isolated env but an explicit AUTOPILOT_LIVE_DIR -> writes its own live dir
L2="$SB/live2"; mkdir -p "$L2"
publish "$L2" "{\"HOME\":\"$SB/home\",\"CLAUDE_CONFIG_DIR\":\"$SB/emptycfg\",\"AUTOPILOT_LIVE_DIR\":\"$L2\"}"
assert_eq "$(src_of "$L2")" "unknown" "isolated env with AUTOPILOT_LIVE_DIR set publishes into its own live dir"

# 3. ordinary env (real HOME, no CLAUDE_CONFIG_DIR) -> writes
L3="$SB/live3"; mkdir -p "$L3"
publish "$L3" "{\"HOME\":\"$REAL_HOME\"}"
assert_neq "$(src_of "$L3")" "absent" "ordinary environment publishes as before"
L3b="$SB/live3b"; mkdir -p "$L3b"
publish "$L3b" "{\"HOME\":\"$REAL_HOME\",\"CLAUDE_CONFIG_DIR\":\"$REAL_HOME/.claude\"}"
assert_neq "$(src_of "$L3b")" "absent" "CLAUDE_CONFIG_DIR equal to the real ~/.claude is not isolated"

# 4. explicit override AUTOPILOT_LOAD_SOURCE_TRUST_ENV=1 -> writes despite isolation
L4="$SB/live4"; mkdir -p "$L4"
publish "$L4" "{\"HOME\":\"$SB/home\",\"CLAUDE_CONFIG_DIR\":\"$SB/emptycfg\",\"AUTOPILOT_LOAD_SOURCE_TRUST_ENV\":\"1\"}"
assert_neq "$(src_of "$L4")" "absent" "AUTOPILOT_LOAD_SOURCE_TRUST_ENV=1 overrides the guard"

# --- autostart: isolated env + shared (XDG) live dir must not start a watcher or write the cache there
REPO="$SB/repo"; mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
autostart() { # <extra env assignments...>; shared live = $XDG/autopilot
  printf '{"hook_event_name":"SessionStart","session_id":"lsi","cwd":"%s"}' "$REPO" |
    env -u AUTOPILOT_LIVE_DIR HOME="$SB/home" CLAUDE_CONFIG_DIR="$SB/emptycfg" XDG_RUNTIME_DIR="$XDG" \
      AUTOPILOT_SESSION_MODE_DIR="$SB/home/.autopilot/session-mode" AUTOPILOT_COSTS_FILE="$SB/costs.jsonl" \
      AUTOPILOT_DISPATCH_RUNS_DIR="$SB/dr" AUTOPILOT_RUNS_WATCH_AUTOSTART=1 AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S=3 \
      "$@" node "$REPO_ROOT/hooks/runs-watch-autostart.js" >/dev/null 2>&1
}
autostart
sleep 1
assert_eq "$([ -e "$XDG/autopilot/runs/$KEY.lock" ] && echo yes || echo no)" "no" "autostart: isolated env starts no watcher on the shared live dir"
assert_eq "$([ -e "$XDG/autopilot/autostart" ] && echo yes || echo no)" "no" "autostart: isolated env writes no per-cwd cache into the shared live dir"

# control: the same isolated env with its own AUTOPILOT_LIVE_DIR does start a watcher there
OWN="$(mktemp -d -p /dev/shm autopilot-test-lsi-own-XXXXXX)"; chmod 700 "$OWN"
autostart AUTOPILOT_LIVE_DIR="$OWN"
for _ in $(seq 1 40); do [ -s "$OWN/runs/$KEY.json" ] && break; sleep 0.25; done
WPID="$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).writer.pid))}catch(e){}' "$OWN/runs/$KEY.json")"
KILL_PIDS="$KILL_PIDS $WPID"
assert_eq "$([ -e "$OWN/runs/$KEY.lock" ] && echo yes || echo no)" "yes" "autostart: isolated env with AUTOPILOT_LIVE_DIR set still starts its watcher there"
[ -n "$WPID" ] && kill -9 "$WPID" 2>/dev/null
rm -rf "$OWN"

# --- hand-started watcher (BL-0195): `status runs --watch` in an isolated env on the shared live dir must refuse and write nothing
XDG2="$(mktemp -d -p /dev/shm autopilot-test-lsi-hand-XXXXXX)"; chmod 700 "$XDG2"
hand_watch() { # <extra env...>
  ( cd "$REPO" && env -u AUTOPILOT_LIVE_DIR HOME="$SB/home" CLAUDE_CONFIG_DIR="$SB/emptycfg" XDG_RUNTIME_DIR="$XDG2" \
      AUTOPILOT_DISPATCH_RUNS_DIR="$SB/dr" AUTOPILOT_RUNS_WATCH_AUTOSTART=0 "$@" \
      timeout 5 node "$REPO_ROOT/bin/autopilot.js" status runs --watch --project "$KEY" --idle-exit 2 >/dev/null 2>"$SB/hand.err" )
  echo $?
}
RC="$(hand_watch)"
assert_neq "$RC" "0" "hand-started watcher: isolated env on the shared live dir exits non-zero"
assert_eq "$(ls -A "$XDG2" 2>/dev/null | wc -l | tr -d ' ')" "0" "hand-started watcher: nothing written under the shared live dir"
assert_contains "$(cat "$SB/hand.err")" "isolated environment" "hand-started watcher: says why it refused"
rm -rf "$XDG2"

finalize_test
