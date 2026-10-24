#!/usr/bin/env bash
# Test for hooks/per-turn-gate.js - opt-in Stop hook that blocks on a verifier's violations
# (BL-0055 phase 2, docs/plans/2026-10-24-per-turn-gate-phase2.md). NC1-NC4 and the `violations`
# half of NC9. Every check is a function that runs against a hook path and returns 0 (holds) or 1
# (broken); the suite asserts it holds for the real hook AND fails for a deliberately broken copy
# (the negative control, evidence-discipline section 58), so a check that cannot go red fails here.
# The live-session check (NC6) needs a real claude call and lives outside this suite.
. "$(dirname "$0")/lib.sh"

REAL_HOOK="$HOOKS_DIR/per-turn-gate.js"
STUB="$TEST_TMP/verifier.js"
cat >"$STUB" <<'JS'
'use strict';
// Stand-in verifier with the verify-turn.js interface. PTG_V_MODE picks the behaviour.
const m = process.env.PTG_V_MODE || 'clean';
const a = process.argv.slice(2);
require('fs').appendFileSync(process.env.PTG_V_CALLS, `${a.join(' ')}\n`);
const v = [{ constraint: 2, rule: 'timestamps are UTC', evidence: 'local time seen' }];
if (m === 'violate') { console.log(JSON.stringify({ turn: 1, ok: false, violations: v, feature_gaps: [] })); process.exit(1); }
if (m === 'gaps') { console.log(JSON.stringify({ turn: 1, ok: true, violations: [], feature_gaps: ['export did not write a file'] })); process.exit(0); }
if (m === 'both') { console.log(JSON.stringify({ turn: 1, ok: false, violations: v, feature_gaps: ['export did not write a file'] })); process.exit(1); }
if (m === 'nullviol') { console.log(JSON.stringify({ violations: [null] })); process.exit(1); }
if (m === 'notarray') { console.log(JSON.stringify({ violations: 'oops' })); process.exit(1); }
if (m === 'missing') { console.log(JSON.stringify({ ok: false })); process.exit(1); }
if (m === 'partial') { console.log(JSON.stringify({ violations: [{ constraint: 1 }] })); process.exit(1); }
if (m === 'badgaps') { console.log(JSON.stringify({ violations: [], feature_gaps: [null] })); process.exit(0); }
if (m === 'cleanslow' || m === 'violslow') {
  setTimeout(() => {
    if (m === 'cleanslow') { console.log(JSON.stringify({ turn: 1, ok: true, violations: [], feature_gaps: [] })); process.exit(0); }
    console.log(JSON.stringify({ turn: 1, ok: false, violations: v, feature_gaps: [] })); process.exit(1);
  }, 600);
  return;
}
if (m === 'crash') { process.exit(2); }
if (m === 'garbage') { console.log('not json {'); process.exit(1); }
if (m === 'slow') { setTimeout(() => {}, 30000); return; }
console.log(JSON.stringify({ turn: 1, ok: true, violations: [], feature_gaps: [] })); process.exit(0);
JS

# mutant <name> <sed-expr> : copy of the hook with requires made absolute and one deliberate break.
# The sed script is split into its s#..#..# commands and applied one at a time; every command must change
# the file, so a pattern that no longer matches (a no-op mutant) fails the build of the mutant loudly.
mutant() {
  local out="$TEST_TMP/mut-$1.js" cur="$TEST_TMP/mut-$1.cur" nxt="$TEST_TMP/mut-$1.nxt" cmd
  local abs="s#require('\./_shared#require('$HOOKS_DIR/_shared#; s#require('\.\./#require('$REPO_ROOT/#"
  sed -e "$abs" "$REAL_HOOK" >"$cur"
  while IFS= read -r -d '' cmd; do
    sed -e "$cmd" "$cur" >"$nxt"
    if cmp -s "$cur" "$nxt"; then echo "mutant $1: sed command matched nothing: $cmd" >&2; return 1; fi
    mv "$nxt" "$cur"
  done < <(node -e '
    const s = process.argv[1]; let i = 0; const out = [];
    const field = () => { let r = ""; while (i < s.length && s[i] !== "#") { if (s[i] === "\\") { r += s[i++]; } r += s[i++]; } i++; return r; };
    while (i < s.length) {
      while (s[i] === " " || s[i] === ";") i++;
      if (i >= s.length) break;
      if (s[i] !== "s" || s[i + 1] !== "#") { process.stderr.write("bad sed script near: " + s.slice(i, i + 30) + "\n"); process.exit(2); }
      const start = i; i += 2; field(); field();
      while (i < s.length && s[i] !== ";" && s[i] !== " ") i++;
      out.push(s.slice(start, i));
    }
    process.stdout.write(out.map((c) => c + "\0").join(""));' "$2")
  mv "$cur" "$out"
  echo "$out"
}

# fresh <label> <verifier-json-or-empty> : new live dir + config; sets CASE_* variables.
fresh() {
  CASE_DIR="$TEST_TMP/case-$1"; mkdir -p "$CASE_DIR/repo"
  export AUTOPILOT_LIVE_DIR="$CASE_DIR/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 700 "$AUTOPILOT_LIVE_DIR"
  export AUTOPILOT_CONFIG_FILE="$CASE_DIR/config.json"
  export PTG_V_CALLS="$CASE_DIR/calls.txt"; : >"$PTG_V_CALLS"
  node -e 'const [f,stub,extra]=process.argv.slice(1);const g=Object.assign({verifier:"node "+stub},JSON.parse(extra||"{}"));require("fs").writeFileSync(f,JSON.stringify({hooks:{"per-turn-gate":true},per_turn_gate:g}))' "$AUTOPILOT_CONFIG_FILE" "$STUB" "${2:-}"
  CASE_LOG="$AUTOPILOT_LIVE_DIR/per-turn-gate/s1.jsonl"
}
# stop <hook> <active:true|false> [prompt_id] : one Stop invocation; stdout in STOP_OUT.
stop() {
  STOP_OUT="$(printf '{"session_id":"s1","cwd":"%s","stop_hook_active":%s,"prompt_id":"%s"}' "$CASE_DIR/repo" "$2" "${3:-p}" \
    | env HOME="$HOOK_HOME" node "$1" 2>/dev/null)"
}
blocks() { printf '%s' "$STOP_OUT" | grep -c '"decision":"block"' || true; }
log_count() { [ -f "$CASE_LOG" ] && wc -l <"$CASE_LOG" | tr -d ' ' || echo 0; }
log_has() { [ -f "$CASE_LOG" ] && grep -c "$1" "$CASE_LOG" || echo 0; }

# NC1: a violating repo is blocked once (mode violations).
nc1() {
  fresh nc1; export PTG_V_MODE=violate
  stop "$1" false
  [ "$(blocks)" = 1 ] && [ "$(log_has '"decision":"block"')" = 1 ] && [ "$(log_has '"reason":"block"')" = 1 ] || return 1
  case "$STOP_OUT" in *"timestamps are UTC"*) ;; *) return 1 ;; esac
}
# NC2: always-violating verifier, cap 2: exactly 2 blocks over a bounded loop, then allow.
nc2() {
  fresh nc2; export PTG_V_MODE=violate
  local i n=0 first=false
  for i in 1 2 3 4 5 6; do   # own iteration ceiling: the check ends red, never hangs
    stop "$1" "$first"; first=true
    n=$((n + $(blocks)))
  done
  [ "$n" = 2 ] && [ "$(log_has '"reason":"cap"')" = 4 ] && [ "$(log_count)" = 6 ]
}
# NC3: verifier crash, timeout, garbage JSON, missing command -> allow and log error.
nc3() {
  local mode
  for mode in crash slow garbage; do
    fresh "nc3-$mode" '{"timeout_ms":600}'; export PTG_V_MODE=$mode
    stop "$1" false
    [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"error"')" = 1 ] || return 1
  done
  fresh nc3-missing '{"verifier":"/nonexistent/verifier"}'; export PTG_V_MODE=violate
  stop "$1" false
  [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"error"')" = 1 ] && [ "$(log_count)" = 1 ]
}
# NC4: a new turn (stop_hook_active false) starts at counter 0 and turn+1; the verifier gets --turn.
nc4() {
  fresh nc4; export PTG_V_MODE=violate
  stop "$1" false; stop "$1" true; stop "$1" true          # turn 1: block, block, cap
  [ "$(log_has '"turn":1,')" = 3 ] || return 1
  stop "$1" false                                           # turn 2 must block again
  [ "$(blocks)" = 1 ] || return 1
  [ "$(log_has '"turn":2,')" = 1 ] && grep -q -- '--turn 2 ' "$PTG_V_CALLS" || return 1
}
# NC9 (violations half): exit 0 with feature_gaps is clean in mode violations.
nc9v() {
  fresh nc9v; export PTG_V_MODE=gaps
  stop "$1" false
  [ "$(blocks)" = 0 ] && [ "$(log_has '"reason":"clean"')" = 1 ]
}

# NC9 (violations+features half): the same gaps fixture blocks once, with the gap text, in that mode.
nc9f() {
  fresh nc9f '{"mode":"violations+features"}'; export PTG_V_MODE=gaps
  stop "$1" false
  [ "$(blocks)" = 1 ] && [ "$(log_has '"reason":"block"')" = 1 ] || return 1
  case "$STOP_OUT" in *"export did not write a file"*"Keep the parts that already work"*) ;; *) return 1 ;; esac
}
# W4 text: with a violation AND a gap, mode violations lists only the violation; violations+features lists
# the violation first, then the gap, then the keep line.
nc9t() {
  fresh nc9t; export PTG_V_MODE=both
  stop "$1" false
  case "$STOP_OUT" in *"timestamps are UTC"*) ;; *) return 1 ;; esac
  case "$STOP_OUT" in *"Keep the parts"*|*"export did not write"*) return 1 ;; esac
  fresh nc9t2 '{"mode":"violations+features"}'; export PTG_V_MODE=both
  stop "$1" false
  node -e 'const r=JSON.parse(process.argv[1]).reason;const a=r.indexOf("timestamps are UTC"),b=r.indexOf("export did not write"),c=r.indexOf("Keep the parts");process.exit(a>=0&&b>a&&c>b?0:1)' "$STOP_OUT"
}

# NC10: seven concurrent Stops of one session (re-entries) never exceed the cap and each leaves one record.
nc10() {
  fresh nc10; export PTG_V_MODE=violate
  local i pids=""
  for i in 1 2 3 4 5 6 7; do
    ( printf '{"session_id":"s1","cwd":"%s","stop_hook_active":true,"prompt_id":"p"}' "$CASE_DIR/repo" | env HOME="$HOOK_HOME" node "$1" >"$CASE_DIR/out.$i" 2>/dev/null ) &
    pids="$pids $!"
  done
  wait $pids
  local n; n=$(cat "$CASE_DIR"/out.* | grep -c '"decision":"block"' || true)
  [ "$n" -le 2 ] && [ "$(log_count)" = 7 ] && [ "$(log_has '"decision":"block"')" = "$n" ] && [ "$(log_has '"turn":1,')" = 7 ] || return 1
}
# NC11: a malformed verifier answer is an error: allow, one error record, no slot consumed.
nc11() {
  local mode
  for mode in nullviol notarray missing partial badgaps; do
    fresh "nc11-$mode" '{"mode":"violations+features"}'; export PTG_V_MODE=$mode
    stop "$1" false
    [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"error"')" = 1 ] && [ "$(log_count)" = 1 ] || return 1
    [ "$(cat "$AUTOPILOT_LIVE_DIR"/per-turn-gate/s1.t1.count 2>/dev/null || echo 0)" = 0 ] || return 1
  done
}
# NC12: state files older than the retention are removed, fresh ones and logs stay.
nc12() {
  fresh nc12; export PTG_V_MODE=clean
  local d="$AUTOPILOT_LIVE_DIR/per-turn-gate"; mkdir -p "$d/old.lock"
  : >"$d/old.t3.count"; : >"$d/old.turn"; : >"$d/fresh.turn"; echo '{}' >"$d/old.jsonl"
  : >"$d/old.t4.count.4242.tmp"; : >"$d/foreign.tmp"; : >"$d/foreign.count"; : >"$d/other.lock.bak"
  touch -d '10 days ago' "$d/old.t3.count" "$d/old.turn" "$d/old.lock" "$d/old.jsonl" "$d/old.t4.count.4242.tmp" "$d/foreign.tmp" "$d/foreign.count" "$d/other.lock.bak"
  stop "$1" false
  [ ! -e "$d/old.t3.count" ] && [ ! -e "$d/old.turn" ] && [ ! -e "$d/old.lock" ] && [ ! -e "$d/old.t4.count.4242.tmp" ] && [ -e "$d/fresh.turn" ] && [ -e "$d/old.jsonl" ] && [ -e "$d/s1.turn" ] || return 1
  # files that are not this hook's own state are never touched
  [ -e "$d/foreign.tmp" ] && [ -e "$d/foreign.count" ] && [ -e "$d/other.lock.bak" ]
}
# NC13: nothing configured => the live-state directory gets no new file or directory at all.
nc13() {
  fresh nc13; printf '{}' >"$AUTOPILOT_CONFIG_FILE"; export PTG_V_MODE=violate
  stop "$1" false
  [ "$(find "$AUTOPILOT_LIVE_DIR" -mindepth 1 | wc -l | tr -d ' ')" = 0 ] && [ "$(blocks)" = 0 ]
}

# hold_lock <dir> : a live lock held by someone else (fresh owner record).
hold_lock() {
  mkdir -p "$1"; printf '{"pid":1,"token":"other","created":%s}' "$(node -e 'console.log(Date.now())')" >"$1/owner.json"
}
# NC14: nothing is deducted and given back. A lock taken by someone else while the verifier runs must not
# leave a consumed slot behind (clean outcome), and a block that cannot take its lock allows with error.
nc14() {
  fresh nc14c; export PTG_V_MODE=cleanslow
  local d="$AUTOPILOT_LIVE_DIR/per-turn-gate"
  ( sleep 0.25; hold_lock "$d/s1.lock" ) &
  stop "$1" false; wait
  [ "$(log_has '"reason":"clean"')" = 1 ] && [ "$(cat "$d/s1.t1.count" 2>/dev/null || echo 0)" = 0 ] || return 1
  fresh nc14b; export PTG_V_MODE=violslow; d="$AUTOPILOT_LIVE_DIR/per-turn-gate"
  ( sleep 0.25; hold_lock "$d/s1.lock" ) &
  stop "$1" false; wait
  [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"error"')" = 1 ] && [ "$(log_count)" = 1 ] && [ "$(cat "$d/s1.t1.count" 2>/dev/null || echo 0)" = 0 ]
}
# unit script for the lock functions: node lockcase.js <hook> <case>
cat >"$TEST_TMP/lockcase.js" <<'JS'
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const { acquireLock } = require(process.argv[2]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-lock-')); const lockDir = path.join(dir, 's1.lock');
const writeOwner = (d, token, created) => fs.writeFileSync(path.join(d, 'owner.json'), JSON.stringify({ pid: 1, token, created }));
fs.mkdirSync(lockDir); writeOwner(lockDir, 'stale-token', Date.now() - 60000);
let holder = null;
const got = acquireLock(lockDir, { afterJudged: (d) => { fs.rmSync(d, { recursive: true }); holder = acquireLock(d); } });
// the stale lock was replaced by a live one between the judgement and the reclaim
const gaveUp = got === null;
const holderLost = holder ? holder.release() === false : false;
// a lock path now holding someone else's lock: our release must report failure
const d2 = path.join(dir, 's2.lock'); const h = acquireLock(d2);
fs.rmSync(d2, { recursive: true }); fs.mkdirSync(d2); writeOwner(d2, 'someone-else', Date.now());
const foreignSeen = h.release() === false;
process.exit(gaveUp && holderLost && foreignSeen ? 0 : 1);
JS
# NC15: stale judgement, then the lock is swapped for a live one: the reclaimer gives up and the holder notices.
nc15() { node "$TEST_TMP/lockcase.js" "$1"; }
# NC16: a lock path that is a regular file never makes the hook spin: fresh file => error within the wait;
# stale file => reclaimed, the hook finishes normally.
nc16() {
  fresh nc16a; export PTG_V_MODE=violate
  local d="$AUTOPILOT_LIVE_DIR/per-turn-gate"; mkdir -p "$d"; : >"$d/s1.lock"
  local t0 t1; t0=$(date +%s)
  STOP_OUT="$(printf '{"session_id":"s1","cwd":"%s","stop_hook_active":false}' "$CASE_DIR/repo" | env HOME="$HOOK_HOME" timeout 12 node "$1" 2>/dev/null)" || true
  t1=$(date +%s)
  [ $((t1 - t0)) -le 8 ] && [ "$(blocks)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"error"')" = 1 ] && [ "$(log_count)" = 1 ] || return 1
  fresh nc16b; export PTG_V_MODE=violate; d="$AUTOPILOT_LIVE_DIR/per-turn-gate"; mkdir -p "$d"; : >"$d/s1.lock"; touch -d '10 minutes ago' "$d/s1.lock"
  t0=$(date +%s)
  STOP_OUT="$(printf '{"session_id":"s1","cwd":"%s","stop_hook_active":false}' "$CASE_DIR/repo" | env HOME="$HOOK_HOME" timeout 12 node "$1" 2>/dev/null)" || true
  t1=$(date +%s)
  [ $((t1 - t0)) -le 8 ] && [ "$(log_count)" = 1 ] && [ "$(blocks)" = 1 ]
}

# --require shim: pauses a hook inside its counter write (after the tmp file, before the rename) until $PTG_GO exists.
cat >"$TEST_TMP/pause.cjs" <<'JS'
const fs = require('fs'); const write = fs.writeFileSync;
fs.writeFileSync = function (a) {
  const r = write.apply(this, arguments);
  if (process.env.PTG_PAUSE && /\.count\.\d+\.tmp$/.test(String(a))) {
    write(process.env.PTG_READY, 'ready');
    while (!fs.existsSync(process.env.PTG_GO)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return r;
};
JS
# start_paused <hook> : a real hook process, paused inside its counter write. Sets HOLD_PID.
start_paused() {
  rm -f "$CASE_DIR/ready" "$CASE_DIR/go"
  ( printf '{"session_id":"s1","cwd":"%s","stop_hook_active":true,"prompt_id":"p"}' "$CASE_DIR/repo" \
      | env HOME="$HOOK_HOME" NODE_OPTIONS="--require=$TEST_TMP/pause.cjs" PTG_PAUSE=1 PTG_READY="$CASE_DIR/ready" PTG_GO="$CASE_DIR/go" node "$1" >"$CASE_DIR/out.holder" 2>/dev/null ) &
  HOLD_PID=$!
  local i; for i in $(seq 1 300); do [ -e "$CASE_DIR/ready" ] && return 0; sleep 0.05; done
  return 1
}
# NC17: a holder paused inside its counter write while its lock is really reclaimed must not write back its
# stale counter: two other calls block (2 = cap), the old holder resumes and must not block a third time.
nc17() {
  fresh nc17; export PTG_V_MODE=violate
  local d="$AUTOPILOT_LIVE_DIR/per-turn-gate"
  start_paused "$1" || return 1
  node -e 'const f=process.argv[1];const o=JSON.parse(require("fs").readFileSync(f,"utf8"));o.created=Date.now()-60000;require("fs").writeFileSync(f,JSON.stringify(o))' "$d/s1.lock/owner.json"
  stop "$1" true; local b1; b1=$(blocks)
  stop "$1" true; local b2; b2=$(blocks)
  touch "$CASE_DIR/go"; wait "$HOLD_PID"
  local bh; bh=$(grep -c '"decision":"block"' "$CASE_DIR/out.holder" || true)
  stop "$1" true; local b3; b3=$(blocks)   # a later call: a stale write-back would have reset the counter to 1
  [ $((b1 + b2 + bh + b3)) -le 2 ] && [ "$(log_has '"decision":"block"')" -le 2 ] && [ "$(log_count)" = 4 ] && [ "$(cat "$d/s1.t1.count")" -le 2 ] && [ ! -e "$d"/s1.t1.count.*.tmp ]
}
# NC18: a holder paused for more than half the stale threshold (16 s) is fenced by time alone, even though
# nobody touched its lock: allow with error, nothing written.
nc18() {
  fresh nc18; export PTG_V_MODE=violate
  local d="$AUTOPILOT_LIVE_DIR/per-turn-gate"
  start_paused "$1" || return 1
  sleep 16; touch "$CASE_DIR/go"; wait "$HOLD_PID"
  [ "$(grep -c '"decision":"block"' "$CASE_DIR/out.holder" || true)" = 0 ] && [ "$(log_has '"decision":"allow","reason":"error"')" = 1 ] \
    && [ ! -e "$d/s1.t1.count" ] && [ ! -e "$d"/s1.t1.count.*.tmp ]
}
# NC19: release is atomic. A new lock appearing at the path after our token was checked is not deleted.
cat >"$TEST_TMP/relcase.js" <<'JS'
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const { acquireLock } = require(process.argv[2]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-rel-')); const lockDir = path.join(dir, 's1.lock');
const a = acquireLock(lockDir);
let b = null; const rm = fs.rmSync; let armed = true;
fs.rmSync = function (p) { // runs between "token verified" and "deleted" of the old release
  if (armed) { armed = false; fs.rmSync = rm; rm(lockDir, { recursive: true, force: true }); b = acquireLock(lockDir); }
  return rm.apply(this, arguments);
};
const aOk = a.release();
fs.rmSync = rm;
const atomicOk = aOk === true && b && b.release() === true;
// the path is taken over by someone else's live lock BEFORE our release: ours reports failure, theirs survives
const d3 = path.join(dir, 's3.lock'); const mine3 = acquireLock(d3);
fs.rmSync(d3, { recursive: true }); const theirs = acquireLock(d3);
const failed = mine3.release() === false;
let theirsWrites = false;
try { theirs.writeInt(path.join(dir, 's3.count'), 1); theirsWrites = fs.readFileSync(path.join(dir, 's3.count'), 'utf8').trim() === '1'; } catch (_e) { /* stays false */ }
const theirsReleases = theirs.release() === true;
process.exit(atomicOk && failed && theirsWrites && theirsReleases ? 0 : 1);
JS
nc19() { node "$TEST_TMP/relcase.js" "$1"; }

run_nc() { # <label> <fn> <mutant-name> <sed-expr>
  if "$2" "$REAL_HOOK"; then assert_eq 0 0 "$1 holds on the real hook"; else fail "$1 broken on the real hook"; fi
  local m; m="$(mutant "$3" "$4")" || { fail "$1 mutant not built"; return; }
  if "$2" "$m"; then fail "$1 negative control: the mutant passed (check cannot go red)"; else assert_eq 0 0 "$1 red on the mutant"; fi
}

run_nc NC1 nc1 allowall "s#else { text = renderRetry(result.json, mode); outcome = 'block'; }#else { outcome = 'clean'; }#"
run_nc NC2 nc2 nocap "s#capCounter >= maxBlocks#false#; s#counterNow >= maxBlocks#false#"
run_nc NC3 nc3 blockonerr "s#if (result.kind === 'error') outcome = 'error';#if (false) outcome = 'error';#; s#return { kind: 'error' };#return { kind: 'violations', json: {} };#g"
run_nc NC4 nc4 noreset "s#startsNewTurn(payload) ? prevTurn + 1 : prevTurn#prevTurn#"
run_nc NC9v nc9v gapsblock "s#return mode === 'violations+features' \&\& gapsOf(result.json).length > 0;#return gapsOf(result.json).length > 0;#"

run_nc NC9f nc9f gapsnever "s#return mode === 'violations+features' \&\& gapsOf(result.json).length > 0;#return false;#"
run_nc NC9t nc9t nogate "s#const withGaps = mode === 'violations+features' \&\& gaps.length > 0;#const withGaps = gaps.length > 0;#"

run_nc NC10 nc10 nolock "s#const lockA = acquireLock(lockDir);#const lockA = { release: () => true };#; s#const lockB = acquireLock(lockDir);#const lockB = { release: () => true };#; s#counterNow = readInt(countFile);#counterNow = readInt(countFile); sleepMs(150);#"
run_nc NC11 nc11 noschema "s#if (!validSchema(json)) return { kind: 'error' };##"
run_nc NC12w nc12 widecleanup "s#if (!STATE_NAME.test(name)) continue;##"
run_nc NC12 nc12 noclean "s#^  cleanupState(dir,#  (() => {})(dir,#"
run_nc NC14 nc14 givebackish "s#log(turn, 'allow', outcome, capCounter);#log(turn, 'allow', outcome, capCounter); fs.writeFileSync(path.join(dir, session + '.t' + turn + '.count'), '1');#"
run_nc NC15 nc15 reclaimnotoken "s#if (movedToken !== judged) return null;##"
run_nc NC15r nc15 releasenotoken "s#if (!o || o.token !== token) {#if (false) {#"
run_nc NC16 nc16 nodeadline "s#if (Date.now() >= deadline) return null;##"
run_nc NC17 nc17 nofence "s#if (!fenced) {#if (false) {#"
run_nc NC18 nc18 notimefence "s# \&\& Date.now() - acquiredAt < LOCK_STALE_MS / 2;#;#"
run_nc NC19r nc19 nodrestore "s#try { fs.renameSync(moved, lockDir); } catch (_e) { /\* left for retention cleanup \*/ }#fs.rmSync(moved, { recursive: true, force: true });#"
run_nc NC19 nc19 checkthendelete "s#try { fs.renameSync(lockDir, moved); } catch (_e) { return false; }##; s#^          const o = readOwner(moved);#          const o = readOwner(lockDir);#; s#^          try { fs.rmSync(moved, { recursive: true, force: true }); } catch (_e) { /\* nothing \*/ }#          try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_e) { /* nothing */ }#"
run_nc NC13 nc13 alwaystrace "s#if (!enabled \&\& !hasVerifier) return;##"

# Knob off / nothing configured / prompt_id.
fresh off; export PTG_V_MODE=violate
printf '{"per_turn_gate":{"verifier":"node %s"}}' "$STUB" >"$AUTOPILOT_CONFIG_FILE"
stop "$REAL_HOOK" false
assert_eq "$(blocks)" 0 "knob off: no block"
assert_eq "$(log_has '"decision":"allow","reason":"off"')" 1 "knob off: one allow/off record"
assert_eq "$(log_count)" 1 "knob off: exactly one record"
fresh none; printf '{}' >"$AUTOPILOT_CONFIG_FILE"
stop "$REAL_HOOK" false
assert_eq "$(log_count)" 0 "unconfigured: no trace"
fresh pid; export PTG_V_MODE=clean
stop "$REAL_HOOK" false pid-7
assert_eq "$(log_has '"prompt_id":"pid-7"')" 1 "prompt_id is logged"
printf '{"session_id":"s1","cwd":"%s"}' "$CASE_DIR/repo" | env HOME="$HOOK_HOME" node "$REAL_HOOK" >/dev/null 2>&1
assert_eq "$(log_has '"prompt_id":null')" 1 "absent prompt_id is logged as null"

finalize_test
