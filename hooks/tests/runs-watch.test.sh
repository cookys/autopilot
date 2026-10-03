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
cp "$LIVE/runs/$KEY_A.json" "$SB/sample-live.json"; cp "$LIVE/runs/$KEY_A--root-1.json" "$SB/sample-scope.json"
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

# ===== part 2 (R4b): counts, cost aggregation, idle exit =====================================================
# RED at cab0e6ed (R4a; envelope has no counts/sessions/host_today_usd and --idle-exit is an unknown flag):
#   FAIL 29 of 73 assertions (the 44 part-1 assertions stay green), e.g.
#   fresh_bound_s = 2 x interval x ceil(live_candidates / enrich_cap): expected '40', got '';
#   counts sum equals runs.length: expected 'true', got '';
#   session_usd = sum of that session's cost_usd: expected '0.75', got '';
#   host_today_usd = every row whose ts is on today's UTC day: expected '1.75', got '';
#   no costs file: host_today_usd is null, not 0: expected 'null', got '';
#   probe-exited row is counted exited: expected '3', got '';
#   --idle-exit 1 with no marker: exits 0 on its own: expected '0', got '2';
#   unexpired marker for the project: still running after idle > N s: expected 'yes', got 'no'.
cat > "$SB/counts.js" <<'JS'
const R = process.argv[2];
const { createWatcher } = require(`${R}/src/status/runs-watch.js`);
const fs = require('fs');
const path = require('path');
const [live, key, cwd, ident, mode] = [process.env.AUTOPILOT_LIVE_DIR, process.argv[3], process.argv[4], process.argv[5], process.argv[6]];
const t = Date.parse('2026-10-04T12:00:00Z');
const file = path.join(live, 'runs', `${key}.json`);
const row = (id, o) => ({ run_id: id, root_run_id: 'root-c', project: ident, phase: 'running', alive: null, probe_age_s: null, ended_at: null, final_status: null, ...o });
let rows = [];
if (mode === 'counts') {
  rows = [
    row('c-confirmed-edge', { alive: true, probe_age_s: 60, phase: 'running' }),
    row('c-too-old', { alive: true, probe_age_s: 61, phase: 'running' }),
    row('c-unprobed', { alive: null, probe_age_s: null, phase: 'running' }),
    row('c-probe-exited', { alive: false, probe_age_s: 2, phase: 'exited' }),
    row('c-ended', { ended_at: '2026-10-04T11:00:00Z', phase: 'exited' }),
    row('c-final', { final_status: 'reviewed' }),
    row('c-alive-no-age', { alive: true, probe_age_s: null }),
  ];
  for (let i = 0; i < 11; i += 1) rows.push(row(`c-pad-${i}`, { alive: true, probe_age_s: 5 }));
}
const w = createWatcher({ key, cwd, collect: () => rows, now: () => t, interval: 10, enrichCap: 8 });
w.start();
w.tick();
const e = JSON.parse(fs.readFileSync(file, 'utf8'));
process.stdout.write(JSON.stringify({
  counts: e.counts, total: e.runs.length, sessions: e.sessions, today: e.host_today_usd, todayAsOf: e.host_today_as_of,
  hasCounts: Object.prototype.hasOwnProperty.call(e, 'counts'),
}));
JS
cj() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const r=eval(process.argv[1]);process.stdout.write(typeof r==="string"?r:JSON.stringify(r))})' "$2"; }

rm -f "$LIVE/runs/$KEY_A.json"
CNT="$(wenv AUTOPILOT_COSTS_FILE="$SB/absent-costs.jsonl" "$NODE" "$SB/counts.js" "$REPO_ROOT" "$KEY_A" "$REPO_A" "$IDENT_A" counts)"
# live candidates = rows with no ended_at/final_status = 16; 2 * 10 * ceil(16/8) = 40
eq "40" "$(cj "$CNT" j.counts.fresh_bound_s)" "fresh_bound_s = 2 x interval x ceil(live_candidates / enrich_cap)"
eq "true" "$(cj "$CNT" 'j.counts.confirmed_live+j.counts.exited+j.counts.unknown===j.total')" "counts sum equals runs.length"
eq "18" "$(cj "$CNT" j.total)" "all 18 rows are in the envelope"
eq "3" "$(cj "$CNT" j.counts.exited)" "exited = phase exited OR ended_at OR final_status (3 rows)"
eq "11" "$(cj "$CNT" j.counts.confirmed_live)" "confirmed_live = alive true and probe_age_s <= bound (11 pads; the edge row is 60 > 40 so not counted)"
eq "4" "$(cj "$CNT" j.counts.unknown)" "unknown = the rest: too old, unprobed, alive with no age, edge beyond the bound"

# bound edge: with interval 10 and 8 live rows -> ceil(1)=1 -> bound 20; age 20 counts, age 21 does not
EDGE="$(cat <<'JS'
const R = process.argv[2];
const { createWatcher } = require(`${R}/src/status/runs-watch.js`);
const t = Date.parse('2026-10-04T12:00:00Z');
const mk = (id, age) => ({ run_id: id, root_run_id: null, project: process.argv[5], phase: 'running', alive: true, probe_age_s: age, ended_at: null, final_status: null });
const rows = [mk('a', 20), mk('b', 21), mk('c', 0), mk('d', 5), mk('e', 5), mk('f', 5), mk('g', 5), mk('h', 5)];
const w = createWatcher({ key: process.argv[3], cwd: process.argv[4], collect: () => rows, now: () => t, interval: 10, enrichCap: 8 });
w.start(); w.tick();
const e = JSON.parse(require('fs').readFileSync(require('path').join(process.env.AUTOPILOT_LIVE_DIR, 'runs', `${process.argv[3]}.json`), 'utf8'));
process.stdout.write(JSON.stringify(e.counts));
JS
)"
printf '%s' "$EDGE" > "$SB/edge.js"
rm -f "$LIVE/runs/$KEY_A.json"
EDGE_OUT="$(wenv AUTOPILOT_COSTS_FILE="$SB/absent-costs.jsonl" "$NODE" "$SB/edge.js" "$REPO_ROOT" "$KEY_A" "$REPO_A" "$IDENT_A")"
eq "20" "$(cj "$EDGE_OUT" j.fresh_bound_s)" "8 live candidates, cap 8, interval 10 -> bound 20"
eq "7" "$(cj "$EDGE_OUT" j.confirmed_live)" "age 20 is confirmed (<= bound), age 21 is not"
eq "1" "$(cj "$EDGE_OUT" j.unknown)" "age 21 falls to unknown"

# --- cost aggregation from costs.jsonl --------------------------------------------------------------------------
COSTS="$SB/costs.jsonl"
mkdir -p "$AHOME/session-mode"
FUTURE="2099-01-01T00:00:00Z" # far future: the harness clock is fake (2026-10-04T12:00Z)
printf '{"session_id":"s-marker","level":"l5","project_key":"%s","expires_at":"%s"}\n' "$KEY_A" "$FUTURE" > "$AHOME/session-mode/s-marker.json"
printf '{"session_id":"s-other-project","level":"l5","project_key":"%s","expires_at":"%s"}\n' "$KEY_B" "$FUTURE" > "$AHOME/session-mode/s-other-project.json"
cat > "$COSTS" <<'JL'
{"ts":"2026-10-04T01:00:00.000Z","session":"s1","model":"m","cost_usd":0.5,"cwd":"/x"}
{"ts":"2026-10-04T03:00:00.000Z","session":"s1","model":"m","cost_usd":0.25,"cwd":"/x"}
{"ts":"2026-10-04T05:00:00.000Z","session":"s2","model":"m","cost_usd":1,"cwd":"/x"}
{"ts":"2026-10-03T23:00:00.000Z","session":"s3","model":"m","cost_usd":2,"cwd":"/x"}
this line is not json
{"ts":"2026-09-01T00:00:00.000Z","session":"s-old","model":"m","cost_usd":5,"cwd":"/x"}
{"ts":"2026-09-01T00:00:00.000Z","session":"s-marker","model":"m","cost_usd":3,"cwd":"/x"}
{"ts":"2026-09-01T00:00:00.000Z","session":"s-other-project","model":"m","cost_usd":9,"cwd":"/x"}
{"ts":"2026-10-04T06:00:00.000Z","session":"s1","model":"m","cost_usd":null,"cwd":"/x"}
JL
rm -f "$LIVE/runs/$KEY_A.json"
COST="$(wenv AUTOPILOT_COSTS_FILE="$COSTS" "$NODE" "$SB/counts.js" "$REPO_ROOT" "$KEY_A" "$REPO_A" "$IDENT_A" cost)"
eq "0.75" "$(cj "$COST" 'j.sessions.s1.session_usd')" "session_usd = sum of that session's cost_usd (null cost row ignored)"
eq "1" "$(cj "$COST" 'j.sessions.s2.session_usd')" "second session summed separately"
eq "2" "$(cj "$COST" 'j.sessions.s3.session_usd')" "a session active within the last 24 h is listed"
eq "3" "$(cj "$COST" 'j.sessions["s-marker"].session_usd')" "a session with an unexpired marker for this project is listed even with old rows"
eq "false" "$(cj "$COST" '"s-old" in j.sessions')" "a session with neither recent rows nor a marker is not listed"
eq "false" "$(cj "$COST" '"s-other-project" in j.sessions')" "another project's marker session is not listed"
eq "1.75" "$(cj "$COST" j.today)" "host_today_usd = every row whose ts is on today's UTC day (0.5+0.25+1)"
eq "2026-10-04T12:00:00.000Z" "$(cj "$COST" j.todayAsOf)" "host_today_as_of is the read time"
eq "2026-10-04T12:00:00.000Z" "$(cj "$COST" 'j.sessions.s1.as_of')" "session as_of is the read time"
rm -f "$LIVE/runs/$KEY_A.json"
NOCOST="$(wenv AUTOPILOT_COSTS_FILE="$SB/absent-costs.jsonl" "$NODE" "$SB/counts.js" "$REPO_ROOT" "$KEY_A" "$REPO_A" "$IDENT_A" cost)"
eq "null" "$(cj "$NOCOST" j.today)" "no costs file: host_today_usd is null, not 0"
eq "{}" "$(cj "$NOCOST" j.sessions)" "no costs file: sessions is empty"
rm -f "$AHOME/session-mode/s-marker.json" "$AHOME/session-mode/s-other-project.json"

# --- real watcher: probe says exited, manifest says not terminal -> rc null, phase exited, counted exited ---------
: > "$SB/free.lock"
mk_manifest live-gone root-1 "$IDENT_A" "$SB/free.lock" no
rm -f "$LIVE/runs/$KEY_A.json"
start_watcher "$KEY_A" "$REPO_A"
eq "yes" "$(wait_for 20 'e.runs.some(r=>r.run_id==="live-gone"&&r.probe_age_s!==null)' "$LIVE/runs/$KEY_A.json")" "live-gone row probed"
eq "exited" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.runs.find(r=>r.run_id==="live-gone").phase')" "free lock -> phase exited"
eq "null" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.runs.find(r=>r.run_id==="live-gone").rc')" "no terminal state and no exit file -> rc null"
eq "3" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.counts.exited')" "probe-exited row is counted exited (with the two ended rows)"
eq "true" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.counts.confirmed_live+j.counts.exited+j.counts.unknown===j.runs.length')" "real envelope: counts sum equals runs.length"
eq "0" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.counts.confirmed_live')" "probe-exited row is not confirmed_live"
stop_watcher "$KEY_A" "$REPO_A"
rm -f "$RUNS/live-gone.manifest.json"

# --- --idle-exit ---------------------------------------------------------------------------------------------------
rm -f "$LIVE/runs/$KEY_A.json"
(cd "$REPO_A" && timeout 40 env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
  AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$AHOME/session-mode" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" \
  "$NODE" "$CLI" status runs --watch --project "$KEY_A" --interval 1 --idle-exit 1 > "$SB/ie.out" 2> "$SB/ie.err" < /dev/null)
eq "0" "$?" "--idle-exit 1 with no marker: exits 0 on its own"
eq "null" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.writer')" "idle exit publishes writer: null"
eq "idle_exit" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.exit_reason')" "idle exit publishes exit_reason idle_exit"
flock -n "$LIVE/runs/$KEY_A.lock" true; eq "0" "$?" "lock is free after an idle exit"

# unexpired marker (same project_key) keeps it running; once the marker expires it exits
printf '{"session_id":"s-live","level":"l5","project_key":"%s","expires_at":"%s"}\n' "$KEY_A" "$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)" > "$AHOME/session-mode/s-live.json"
(cd "$REPO_A" && wenv "$NODE" "$CLI" status runs --watch --project "$KEY_A" --interval 1 --idle-exit 1 > "$SB/ie2.out" 2> "$SB/ie2.err" < /dev/null & echo $! > "$SB/ie2.pid")
IE_PID="$(cat "$SB/ie2.pid")"; KILL_PIDS="$KILL_PIDS $IE_PID"
sleep 6
eq "yes" "$(kill -0 "$IE_PID" 2>/dev/null && echo yes || echo no)" "unexpired marker for the project: still running after idle > N s"
eq "true" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.writer!==null')" "...and the envelope still has a writer"
printf '{"session_id":"s-live","level":"l5","project_key":"%s","expires_at":"%s"}\n' "$KEY_A" "$(date -u -d '-1 minute' +%Y-%m-%dT%H:%M:%SZ)" > "$AHOME/session-mode/s-live.json"
GONE=no
for i in $(seq 1 100); do kill -0 "$IE_PID" 2>/dev/null || { GONE=yes; break; }; sleep 0.1; done
eq "yes" "$GONE" "marker expired: the watcher idle-exits"
eq "idle_exit" "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.exit_reason')" "...with exit_reason idle_exit"

# a marker for ANOTHER project does not hold this watcher open
printf '{"session_id":"s-b","level":"l5","project_key":"%s","expires_at":"%s"}\n' "$KEY_B" "$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)" > "$AHOME/session-mode/s-b.json"
rm -f "$AHOME/session-mode/s-live.json" "$LIVE/runs/$KEY_A.json"
(cd "$REPO_A" && timeout 40 env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
  AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$AHOME/session-mode" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" \
  "$NODE" "$CLI" status runs --watch --project "$KEY_A" --interval 1 --idle-exit 1 > /dev/null 2>&1 < /dev/null)
eq "0" "$?" "another project's marker does not keep this watcher alive"

# ===== repair (R4 review): shared fresh bound, --stop confirms exit, idle re-arm ==============================
# RED at 7caa7e17: root files carried their own fresh_bound_s (40, not the project-wide 60), so a row at
#   probe age 50 was confirmed_live in <key>.json but unknown in <key>--<root>.json; --stop on a writer that
#   ignores SIGTERM exited 0 without "still running"; the idle clock kept running while a marker held the
#   watcher open, so it exited at the first tick after the marker expired.
cat > "$SB/bound.js" <<'JS'
const R = process.argv[2];
const { createWatcher } = require(`${R}/src/status/runs-watch.js`);
const fs = require('fs');
const path = require('path');
const [key, cwd, ident] = process.argv.slice(3);
const t = Date.parse('2026-10-04T12:00:00Z');
const mk = (id, root) => ({ run_id: id, root_run_id: root, project: ident, phase: 'running', alive: true, probe_age_s: 50, ended_at: null, final_status: null });
const rows = [];
for (let i = 0; i < 6; i += 1) { rows.push(mk(`a${i}`, 'root-a')); rows.push(mk(`b${i}`, 'root-b')); }
const w = createWatcher({ key, cwd, collect: () => rows, now: () => t, interval: 10, enrichCap: 4 });
w.start(); w.tick();
const rd = (f) => JSON.parse(fs.readFileSync(path.join(process.env.AUTOPILOT_LIVE_DIR, 'runs', f), 'utf8'));
const all = rd(`${key}.json`); const ra = rd(`${key}--root-a.json`); const rb = rd(`${key}--root-b.json`);
process.stdout.write(JSON.stringify({
  bounds: [all.counts.fresh_bound_s, ra.counts.fresh_bound_s, rb.counts.fresh_bound_s],
  confirmed: [all.counts.confirmed_live, ra.counts.confirmed_live, rb.counts.confirmed_live],
  sums: [all, ra, rb].map((e) => e.counts.confirmed_live + e.counts.exited + e.counts.unknown === e.runs.length),
}));
JS
rm -f "$LIVE/runs/$KEY_A.json" "$LIVE/runs/$KEY_A--root-a.json" "$LIVE/runs/$KEY_A--root-b.json"
BND="$(wenv AUTOPILOT_COSTS_FILE="$SB/absent-costs.jsonl" "$NODE" "$SB/bound.js" "$REPO_ROOT" "$KEY_A" "$REPO_A" "$IDENT_A")"
eq "60,60,60" "$(cj "$BND" 'j.bounds.join(",")')" "every scope file carries the project-wide fresh_bound_s (12 candidates, cap 4, interval 10)"
eq "12,6,6" "$(cj "$BND" 'j.confirmed.join(",")')" "the same rows are confirmed_live in the project file and in the root files"
eq "true,true,true" "$(cj "$BND" 'j.sums.join(",")')" "per-scope counts still sum to runs.length"

# --stop must confirm the exit: a writer that ignores SIGTERM -> stderr 'still running pid N', exit 1
mkdir -p "$LIVE/runs"
"$NODE" -e 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)' status runs --watch --project "$KEY_A" < /dev/null > /dev/null 2>&1 &
STUBBORN=$!; KILL_PIDS="$KILL_PIDS $STUBBORN"
sleep 0.5
printf '{"schema":"autopilot.runs-live/1","scope":{"project_key":"%s","repo_identity":null,"root_run_id":null},"published_at":"%s","valid_for_s":180,"writer":{"pid":%s,"session_id":null,"started_at":"x"},"runs":[]}\n' \
  "$KEY_A" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STUBBORN" > "$LIVE/runs/$KEY_A.json"
(cd "$REPO_A" && wenv "$NODE" "$CLI" status runs --stop --project "$KEY_A" > "$SB/st.out" 2> "$SB/st.err" < /dev/null)
eq "1" "$?" "--stop on a writer that ignores SIGTERM exits 1"
eq "yes" "$(grep -q "still running pid $STUBBORN" "$SB/st.err" && echo yes || echo no)" "--stop says 'still running pid N' on stderr"
eq "no" "$(grep -q 'stopped watcher' "$SB/st.out" && echo yes || echo no)" "--stop does not claim it stopped"
kill -9 "$STUBBORN"

# --idle-exit re-arm: a marker holding the watcher open resets the idle clock
cat > "$SB/rearm.js" <<'JS'
const R = process.argv[2];
const { createWatcher } = require(`${R}/src/status/runs-watch.js`);
const fs = require('fs');
const path = require('path');
const [key, cwd] = process.argv.slice(3);
let t = Date.parse('2026-10-04T12:00:00Z');
const dir = process.env.AUTOPILOT_SESSION_MODE_DIR;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'rearm.json'), JSON.stringify({ session_id: 'rearm', project_key: key, expires_at: new Date(t + 100000).toISOString() }));
const w = createWatcher({ key, cwd, collect: () => [], now: () => t, interval: 1, idleExitS: 5 });
w.start();
const out = {};
for (let i = 0; i < 99; i += 1) { if (w.tick().exit) out.earlyExit = true; t += 1000; }
t = Date.parse('2026-10-04T12:00:00Z') + 101000; // marker expired a second ago
out.atExpiry = w.tick().exit || null;
t += 3000; out.plus3 = w.tick().exit || null;
t += 3000; out.plus6 = w.tick().exit || null;
process.stdout.write(JSON.stringify(out));
JS
RE="$(wenv AUTOPILOT_COSTS_FILE="$SB/absent-costs.jsonl" "$NODE" "$SB/rearm.js" "$REPO_ROOT" "$KEY_A" "$REPO_A")"
eq "undefined" "$(cj "$RE" 'String(j.earlyExit)')" "no idle exit while the marker is unexpired"
eq "null" "$(cj "$RE" 'j.atExpiry')" "first tick after the marker expires does not exit"
eq "null" "$(cj "$RE" 'j.plus3')" "3 s after expiry (N = 5) still does not exit"
eq "idle_exit" "$(cj "$RE" 'j.plus6')" "N s after expiry the watcher idle-exits"
rm -f "$AHOME/session-mode/rearm.json"

# --- R6 review repair -------------------------------------------------------------------------------
# RED at 367affdd (R6 cases): --stop --project <repo_identity>: expected '0', got '2' (stderr names the 16-hex rule);
#   --watch --project <repo_identity>: rc 2 instead of a normal start; envelope validates against
#   schemas/runs-live.schema.json: validator rc 2 (schema file absent); failed `git worktree list` keeps the paths
#   file: expected '1 entries', got '0 entries' (map overwritten with {}).
(cd "$REPO_A" && wenv "$NODE" "$CLI" status runs --stop --project "$IDENT_A" > "$SB/si.out" 2> "$SB/si.err" < /dev/null)
eq "0" "$?" "--stop --project <repo_identity> is accepted (normalised to the project key)"
eq "yes" "$(grep -q "for project $KEY_A" "$SB/si.out" && echo yes || echo no)" "--stop <repo_identity> reports the normalised project key"
(cd "$REPO_A" && wenv AUTOPILOT_DISPATCH_RUNS_DIR="$SB/does-not-exist" "$NODE" "$CLI" status runs --watch --project "$IDENT_A" --interval 1 > "$SB/wi.out" 2> "$SB/wi.err" < /dev/null)
eq "yes" "$(grep -q 'must be a 16-hex' "$SB/wi.err" && echo no || echo yes)" "--watch --project <repo_identity> is not rejected as a bad key"
(cd "$REPO_A" && wenv "$NODE" "$CLI" status runs --stop --project "not-a-key" > /dev/null 2> "$SB/sb.err" < /dev/null)
eq "2" "$?" "--stop --project <garbage> is still rejected"
eq "yes" "$(grep -q '16-hex' "$SB/sb.err" && echo yes || echo no)" "garbage rejection keeps the 16-hex message"

# envelope schema: real envelopes validate; a mutated one does not
VS="$REPO_ROOT/scripts/validate-json-schema.js"; RS="$REPO_ROOT/schemas/runs-live.schema.json"
"$NODE" "$VS" --schema "$RS" --document "$SB/sample-live.json" > "$SB/v1.out" 2>&1; eq "0" "$?" "project envelope validates against schemas/runs-live.schema.json"
"$NODE" "$VS" --schema "$RS" --document "$SB/sample-scope.json" > "$SB/v2.out" 2>&1; eq "0" "$?" "per-root envelope validates against schemas/runs-live.schema.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));delete j.counts;require("fs").writeFileSync(process.argv[2],JSON.stringify(j))' "$SB/sample-live.json" "$SB/sample-bad.json"
"$NODE" "$VS" --schema "$RS" --document "$SB/sample-bad.json" > "$SB/v3.out" 2>&1; eq "1" "$?" "an envelope missing counts fails validation"

# writePaths: a failing `git worktree list` must keep the previous paths file
cat > "$SB/gitfail.js" <<'JS'
const R = process.argv[2];
const { createWatcher } = require(`${R}/src/status/runs-watch.js`);
const fs = require('fs');
const path = require('path');
const [key, cwd, fakeBin] = process.argv.slice(3);
const file = path.join(process.env.AUTOPILOT_LIVE_DIR, 'runs', 'paths', `${key}.json`);
let t = Date.parse('2026-10-04T00:00:00Z');
const w = createWatcher({ key, cwd, collect: () => [], now: () => t, interval: 10 });
w.start(); w.tick();
const before = fs.readFileSync(file, 'utf8');
const entries = (txt) => Object.keys(JSON.parse(txt)).length;
const realPath = process.env.PATH;
process.env.PATH = `${fakeBin}:${realPath}`;
t += 60000; w.tick();
process.env.PATH = realPath;
const after = fs.readFileSync(file, 'utf8');
process.stdout.write(JSON.stringify({ before: entries(before), after: entries(after), same: before === after }));
JS
mkdir -p "$SB/fakebin"
printf '#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = list ]; then exit 1; fi\nexec %s "$@"\n' "$(command -v git)" > "$SB/fakebin/git"
chmod +x "$SB/fakebin/git"
rm -f "$LIVE/runs/paths/$KEY_A.json" "$AHOME/review/$KEY_A/live/watcher.log"
GF="$(wenv AUTOPILOT_COSTS_FILE="$SB/absent-costs.jsonl" "$NODE" "$SB/gitfail.js" "$REPO_ROOT" "$KEY_A" "$REPO_A" "$SB/fakebin")"
eq "true" "$(cj "$GF" 'j.before>=1 && j.after===j.before && j.same')" "failed git worktree list keeps the previous paths file ($GF)"
eq "yes" "$(grep -q 'git worktree list failed' "$AHOME/review/$KEY_A/live/watcher.log" && echo yes || echo no)" "the failure is logged once to watcher.log"

# ===== repair 2: the enrich rotation is scoped to the watched project ======================================================
# RED at 5bd2cca3: with 6 foreign live runs and cap 2 the rotation covered all 10 live runs, so each own run was
#   re-probed every 5 ticks against a bound that assumes ceil(4/2) = 2 -> own rows flapped to unknown.
FRUNS="$SB/foreign-runs"; mkdir -p "$FRUNS"; RUNS_SAVE="$RUNS"; RUNS="$FRUNS"
for i in 1 2 3 4; do
  : > "$SB/own$i.lock"; flock "$SB/own$i.lock" sleep 300 < /dev/null > /dev/null 2>&1 &
  KILL_PIDS="$KILL_PIDS $!"
  mk_manifest "own-$i" root-f "$IDENT_A" "$SB/own$i.lock" no
done
for i in 1 2 3 4 5 6; do
  : > "$SB/for$i.lock"; flock "$SB/for$i.lock" sleep 300 < /dev/null > /dev/null 2>&1 &
  KILL_PIDS="$KILL_PIDS $!"
  mk_manifest "foreign-$i" root-g "$IDENT_B" "$SB/for$i.lock" no
done
sleep 0.5
rm -f "$LIVE/runs/$KEY_A.json" "$LIVE/runs-enrich-cursor.$KEY_A.json" "$LIVE/runs-enrich-cursor.json"
(cd "$REPO_A" && wenv "$NODE" "$CLI" status runs --watch --project "$KEY_A" --interval 2 --enrich-cap 2 > /dev/null 2>&1 < /dev/null & echo $! > "$SB/f.launcher")
KILL_PIDS="$KILL_PIDS $(cat "$SB/f.launcher")"
eq "yes" "$(wait_for 30 'e.counts&&e.counts.confirmed_live===4' "$LIVE/runs/$KEY_A.json")" "all 4 own live rows become confirmed_live"
sleep 7
BAD=0
for i in 1 2 3 4 5 6; do
  [ "$(jq_file "$LIVE/runs/$KEY_A.json" 'j.counts.confirmed_live')" = 4 ] || BAD=$((BAD + 1))
  sleep 2.5
done
eq "0" "$BAD" "steady state: confirmed_live stays 4 in every sample with 6 foreign live runs present (no flapping)"
eq "own-1,own-2,own-3,own-4" "$(node -e 'process.stdout.write(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).probes).sort().join(","))' "$LIVE/runs-enrich-cursor.$KEY_A.json")" "this watcher probed none of the foreign runs"
stop_watcher "$KEY_A" "$REPO_A"
RUNS="$RUNS_SAVE"

finalize_test
