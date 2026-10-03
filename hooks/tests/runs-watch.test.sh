#!/usr/bin/env bash
# Tests for the project runs watcher (mods plan P1a R4a part 1; R4b appends part 2).
# Fixture repo + fixture manifest dir. HOME, CLAUDE_CONFIG_DIR, XDG_RUNTIME_DIR, AUTOPILOT_LIVE_DIR
# (a /dev/shm tmpdir), AUTOPILOT_SESSION_MODE_DIR and AUTOPILOT_DISPATCH_RUNS_DIR are all under a
# mktemp dir; nothing reads or writes the real ~/.autopilot, ~/.claude, /run/user/*/autopilot or
# the real dispatch manifest dir. Background processes are killed BY PID in the cleanup trap.
. "$(dirname "$0")/lib.sh"

# RED at c51f901f (base has no src/status/runs-watch.js; `status runs --watch` is 'unknown status argument'):
#   FAIL 35 of 38 assertions, e.g.
#   9 live fixtures all have probe_age_s within a few ticks: expected 'yes', got 'no';
#   envelope schema: expected 'autopilot.runs-live/1', got ''; scope.project_key: expected '<key>', got '';
#   scope file for root-1 carries its root_run_id: expected 'root-1', got '';
#   lock is free after a startup failure: expected '0', got '66';
#   300 s idle: published_at advances on the 60 s heartbeat: expected 'true', got '';
#   producer stopped > 180 s -> stale: expected 'stale', got '';
#   one paths file per project, both intact after 10 heartbeats: expected '<keyB>.json <keyA>.json', got ''.

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
CLI="$REPO_ROOT/bin/autopilot.js"
NODE="$(command -v node)"
SB="$TEST_TMP/runsw"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"
REPO_A="$SB/repo-a"; REPO_B="$SB/repo-b"
mkdir -p "$FAKE_HOME/.autopilot" "$FAKE_CLAUDE/metrics" "$FAKE_XDG" "$RUNS" "$REPO_A" "$REPO_B" "$SB/cap"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-runsw-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_w() {
  local p
  for p in $KILL_PIDS; do kill -9 "$p" 2>/dev/null; done
  rm -rf "$LIVE"
}
trap 'cleanup_w; cleanup_test_tmp' EXIT

for r in "$REPO_A" "$REPO_B"; do
  git -C "$r" init -q
  git -C "$r" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
done
git -C "$REPO_A" worktree add -q "$SB/repo-a-wt" -b wt-branch 2> /dev/null
scope_of() { (cd "$1" && node -e 'const s=require(process.argv[1]).scopeFromCwd(process.cwd());process.stdout.write(s[process.argv[2]])' "$REPO_ROOT/src/status/project-key.js" "$2"); }
KEY_A="$(scope_of "$REPO_A" project_key)"; IDENT_A="$(scope_of "$REPO_A" repo_identity)"
KEY_B="$(scope_of "$REPO_B" project_key)"; IDENT_B="$(scope_of "$REPO_B" repo_identity)"
AHOME="$FAKE_HOME/.autopilot"

wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$AHOME/session-mode" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" "$@"
}
jq_file() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),e=j;const r=eval(process.argv[2]);process.stdout.write(typeof r==="string"?r:JSON.stringify(r))' "$1" "$2"; }

NOW=$(date +%s)
mk_manifest() { # id root ident lock(or null) ended(yes|no)
  local id="$1" root="$2" ident="$3" lock="$4" ended="$5"
  local q_lock="null" q_end="null" q_final="null"
  [ "$lock" != null ] && q_lock="\"$lock\""
  if [ "$ended" = yes ]; then q_end="\"$(date -u -d "@$((NOW - 5))" +%Y-%m-%dT%H:%M:%SZ)\""; q_final='"reviewed"'; fi
  printf '{"schema":1,"run_id":"%s","role":"implementer","runner":"codex","model":"m","started_at":"%s","started_epoch":%s,"ended_at":%s,"ended_epoch":null,"final_status":%s,"log_path":"/nonexistent","lock_path":%s,"pid":null,"scope_unit":null,"log_format":"plain","ledger":null,"stage":null,"repo_identity":"%s","root_run_id":"%s","parent_run_id":null,"depth":0}\n' \
    "$id" "$(date -u -d "@$((NOW - 60))" +%Y-%m-%dT%H:%M:%SZ)" "$((NOW - 60))" "$q_end" "$q_final" "$q_lock" "$ident" "$root" > "$RUNS/$id.manifest.json"
}
start_watcher() { # key cwd -> W_LAUNCHER
  (cd "$2" && wenv "$NODE" "$CLI" status runs --watch --project "$1" --interval 1 \
    > "$SB/w.$1.out" 2> "$SB/w.$1.err" < /dev/null & echo $! > "$SB/w.launcher")
  W_LAUNCHER="$(cat "$SB/w.launcher")"; KILL_PIDS="$KILL_PIDS $W_LAUNCHER"
}
stop_watcher() { (cd "$2" && wenv "$NODE" "$CLI" status runs --stop --project "$1" > /dev/null 2>&1 < /dev/null); }
wait_for() { # <seconds> <js predicate over envelope e> <file>
  local i n=$(( $1 * 10 ))
  for i in $(seq 1 "$n"); do
    [ "$(jq_file "$3" "$2" 2>/dev/null)" = true ] && { echo yes; return; }
    sleep 0.1
  done
  echo no
}

# --- 1. nine live runs are all probed within two ticks (enrich cap 8) --------------------------------
for i in 1 2 3 4 5 6 7 8 9; do
  : > "$SB/hold$i.lock"
  flock "$SB/hold$i.lock" sleep 300 < /dev/null > /dev/null 2>&1 &
  KILL_PIDS="$KILL_PIDS $!"
done
sleep 0.5
for i in 1 2 3 4 5 6 7 8 9; do mk_manifest "live-$i" root-1 "$IDENT_A" "$SB/hold$i.lock" no; done
start_watcher "$KEY_A" "$REPO_A"
eq "yes" "$(wait_for 20 'e.runs.length===9 && e.runs.every(r=>r.probe_age_s!==null)' "$LIVE/runs/$KEY_A.json")" "9 live fixtures all have probe_age_s within a few ticks"
eq "true" "$(jq_file "$LIVE/runs/$KEY_A.json" 'e.runs.every(r=>r.alive===true)')" "every probed live row is alive"
eq "autopilot.runs-live/1" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.schema')" "envelope schema"
eq "180" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.valid_for_s')" "valid_for_s is 180"
eq "$KEY_A" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.scope.project_key')" "scope.project_key"
eq "$IDENT_A" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.scope.repo_identity')" "scope.repo_identity"

# --- 2. two roots in one repo -> two scope files + two SSD files, each with the right scope ---------------
for i in 1 2 3 4 5 6 7 8 9; do rm -f "$RUNS/live-$i.manifest.json"; done
mk_manifest r1-run root-1 "$IDENT_A" null yes
mk_manifest r2-run root-2 "$IDENT_A" null yes
mk_manifest other-repo root-9 "$IDENT_B" null yes
eq "yes" "$(wait_for 20 'e.runs.length===2' "$LIVE/runs/$KEY_A.json")" "project file shows only this repo's two runs"
sleep 1
for r in root-1 root-2; do
  F="$LIVE/runs/$KEY_A--$r.json"; S="$AHOME/review/$KEY_A/live/runs.$KEY_A--$r.json"
  eq "$r" "$(jq_file "$F" 'j.scope.root_run_id')" "scope file for $r carries its root_run_id"
  eq "$r" "$(jq_file "$S" 'j.scope.root_run_id')" "SSD fallback for $r carries its root_run_id"
  eq "1" "$(jq_file "$F" 'j.runs.length')" "scope file for $r holds only its own run"
done
eq "$KEY_A" "$(jq_file "$AHOME/review/$KEY_A/live/runs.$KEY_A.json" 'j.scope.project_key')" "SSD fallback for the whole project exists"
eq "null" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.scope.root_run_id')" "project-wide file has root_run_id null"
eq "no" "$([ -e "$LIVE/runs/$KEY_B.json" ] && echo yes || echo no)" "the other repo's run created no file for its project"
eq "yes" "$([ -s "$AHOME/review/$KEY_A/live/watcher.log" ] && echo yes || echo no)" "watcher.log written under review/<key>/live"
eq "yes" "$([ -f "$AHOME/live-pointer.json" ] && echo yes || echo no)" "live pointer written at watcher start (isolated home)"
stop_watcher "$KEY_A" "$REPO_A"

# --- 3. startup failure: manifest dir missing -> non-zero, one stderr line, lock free ------------------------
(cd "$REPO_A" && wenv AUTOPILOT_DISPATCH_RUNS_DIR="$SB/does-not-exist" "$NODE" "$CLI" status runs --watch --project "$KEY_A" --interval 1 > "$SB/f.out" 2> "$SB/f.err" < /dev/null)
FAIL_RC=$?
eq "yes" "$([ "$FAIL_RC" -ne 0 ] && echo yes || echo no)" "startup failure exits non-zero (got $FAIL_RC)"
eq "1" "$(wc -l < "$SB/f.err" | tr -d ' ')" "startup failure prints one stderr line"
flock -n "$LIVE/runs/$KEY_A.lock" true; eq "0" "$?" "lock is free after a startup failure"

# --- 4. fake-clock core: heartbeat, freshness, observed_at, scope mismatch ----------------------------------
cat > "$SB/clock.js" <<'JS'
const R = process.argv[2];
const { createWatcher, readEnvelope } = require(`${R}/src/status/runs-watch.js`);
const fs = require('fs');
const path = require('path');
const [live, key, cwd] = [process.env.AUTOPILOT_LIVE_DIR, process.argv[3], process.argv[4]];
const mode = process.argv[5];
let t = Date.parse('2026-10-04T00:00:00Z');
const w = createWatcher({ key, cwd, collect: () => [], now: () => t, interval: 10 });
w.start();
const file = path.join(live, 'runs', `${key}.json`);
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const out = {};
if (mode === 'idle') {
  w.tick(); const first = read();
  const published = [first.published_at];
  for (let i = 0; i < 30; i += 1) { t += 10000; w.tick(); const e = read(); if (e.published_at !== published[published.length - 1]) published.push(e.published_at); }
  const last = read();
  const strip = (e) => JSON.stringify({ ...e, published_at: null });
  out.advanced = published.length; out.payloadSame = strip(first) === strip(last);
  out.observedSame = first.observed_at === last.observed_at;
  out.fresh = readEnvelope({ file, scope: { project_key: key, root_run_id: null }, nowMs: t }).status;
}
if (mode === 'late') {
  w.tick(); const first = read();
  t += 90000; // heartbeat due at +60 s runs 30 s late
  out.freshBeforeLateTick = readEnvelope({ file, scope: { project_key: key, root_run_id: null }, nowMs: t }).status;
  w.tick();
  out.freshAfter = readEnvelope({ file, scope: { project_key: key, root_run_id: null }, nowMs: t }).status;
  out.publishedMoved = read().published_at !== first.published_at;
}
if (mode === 'stale') {
  w.tick();
  const at = (s) => readEnvelope({ file, scope: { project_key: key, root_run_id: null }, nowMs: t + s * 1000 }).status;
  out.at180 = at(180); out.at181 = at(181);
  out.wrongProject = readEnvelope({ file, scope: { project_key: 'ffffffffffffffff', root_run_id: null }, nowMs: t }).status;
  out.wrongRoot = readEnvelope({ file, scope: { project_key: key, root_run_id: 'root-x' }, nowMs: t }).status;
  out.noFile = readEnvelope({ file: file + '.nope', scope: null, nowMs: t }).status;
}
process.stdout.write(JSON.stringify(out));
JS
clock() { (wenv "$NODE" "$SB/clock.js" "$REPO_ROOT" "$KEY_A" "$REPO_A" "$1"); }
rm -f "$LIVE/runs/$KEY_A.json"
IDLE="$(clock idle)"
eq "true" "$(printf '%s' "$IDLE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).advanced>=5)))')" "300 s idle: published_at advances on the 60 s heartbeat"
eq "true" "$(printf '%s' "$IDLE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).payloadSame)))')" "300 s idle: payload unchanged apart from published_at"
eq "true" "$(printf '%s' "$IDLE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).observedSame)))')" "heartbeat does not move observed_at"
eq "fresh" "$(printf '%s' "$IDLE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).fresh))')" "reader judges the idle envelope fresh"
rm -f "$LIVE/runs/$KEY_A.json"
LATE="$(clock late)"
eq "fresh" "$(printf '%s' "$LATE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).freshBeforeLateTick))')" "heartbeat 30 s late: envelope still fresh"
eq "true" "$(printf '%s' "$LATE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).publishedMoved)))')" "the late heartbeat still moves published_at"
rm -f "$LIVE/runs/$KEY_A.json"
STALE="$(clock stale)"
sj() { printf '%s' "$STALE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s)[process.argv[1]])))' "$1"; }
eq "fresh" "$(sj at180)" "age 180 s is still fresh"
eq "stale" "$(sj at181)" "producer stopped > 180 s -> stale"
eq "missing" "$(sj wrongProject)" "reader: envelope.scope.project_key mismatch = missing"
eq "missing" "$(sj wrongRoot)" "reader: envelope.scope.root_run_id mismatch = missing"
eq "missing" "$(sj noFile)" "reader: absent file = missing"

# --- 5. two projects, ten heartbeats each: both paths files intact; longest-prefix lookup works -----------------
cat > "$SB/paths.js" <<'JS'
const R = process.argv[2];
const { createWatcher } = require(`${R}/src/status/runs-watch.js`);
const fs = require('fs');
const path = require('path');
const live = process.env.AUTOPILOT_LIVE_DIR;
const [keyA, cwdA, keyB, cwdB, wtA] = process.argv.slice(3);
let t = Date.parse('2026-10-04T00:00:00Z');
const a = createWatcher({ key: keyA, cwd: cwdA, collect: () => [], now: () => t, interval: 10 });
const b = createWatcher({ key: keyB, cwd: cwdB, collect: () => [], now: () => t, interval: 10 });
a.start(); b.start();
for (let i = 0; i < 10; i += 1) { a.tick(); b.tick(); t += 60000; }
const dir = path.join(live, 'runs', 'paths');
const merged = {};
for (const f of fs.readdirSync(dir)) Object.assign(merged, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const lookup = (p) => {
  const real = fs.realpathSync(p);
  const best = Object.keys(merged).filter((k) => real === k || real.startsWith(`${k}/`)).sort((x, y) => y.length - x.length)[0];
  return best ? merged[best].project_key : null;
};
fs.mkdirSync(path.join(cwdA, 'sub'), { recursive: true });
process.stdout.write(JSON.stringify({
  files: fs.readdirSync(dir).sort(),
  a: lookup(cwdA), aSub: lookup(path.join(cwdA, 'sub')), aWt: lookup(wtA), b: lookup(cwdB),
}));
JS
PATHS="$(wenv "$NODE" "$SB/paths.js" "$REPO_ROOT" "$KEY_A" "$REPO_A" "$KEY_B" "$REPO_B" "$SB/repo-a-wt")"
pj() { printf '%s' "$PATHS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const r=eval(process.argv[1]);process.stdout.write(typeof r==="string"?r:JSON.stringify(r))})' "$1"; }
eq "$(printf '%s\n%s\n' "$KEY_A.json" "$KEY_B.json" | sort | paste -sd,)" "$(pj 'j.files.join("\n")' | paste -sd,)" "one paths file per project, both intact after 10 heartbeats"
eq "$KEY_A" "$(pj j.a)" "lookup of project A's main worktree"
eq "$KEY_A" "$(pj j.aSub)" "lookup of a subdirectory of A (longest prefix)"
eq "$KEY_A" "$(pj j.aWt)" "lookup of A's linked worktree gives the same key"
eq "$KEY_B" "$(pj j.b)" "lookup of project B"
eq "$KEY_A" "$(jq_file "$LIVE/runs/paths/$KEY_A.json" 'Object.values(j).map(v=>v.project_key).filter((v,i,a)=>a.indexOf(v)===i).join(",")')" "A's paths file only names A (no cross-project entries)"

finalize_test
