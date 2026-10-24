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
if (m === 'crash') { process.exit(2); }
if (m === 'garbage') { console.log('not json {'); process.exit(1); }
if (m === 'slow') { setTimeout(() => {}, 30000); return; }
console.log(JSON.stringify({ turn: 1, ok: true, violations: [], feature_gaps: [] })); process.exit(0);
JS

# mutant <name> <sed-expr> : copy of the hook with requires made absolute and one deliberate break.
mutant() {
  local out="$TEST_TMP/mut-$1.js"
  local abs="s#require('\./_shared#require('$HOOKS_DIR/_shared#; s#require('\.\./#require('$REPO_ROOT/#"
  sed -e "$abs" -e "$2" "$REAL_HOOK" >"$out"
  sed -e "$abs" "$REAL_HOOK" | cmp -s - "$out" && { echo "mutant $1 changes nothing" >&2; return 1; }
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
  touch -d '10 days ago' "$d/old.t3.count" "$d/old.turn" "$d/old.lock" "$d/old.jsonl"
  stop "$1" false
  [ ! -e "$d/old.t3.count" ] && [ ! -e "$d/old.turn" ] && [ ! -e "$d/old.lock" ] && [ -e "$d/fresh.turn" ] && [ -e "$d/old.jsonl" ] && [ -e "$d/s1.turn" ]
}
# NC13: nothing configured => the live-state directory gets no new file or directory at all.
nc13() {
  fresh nc13; printf '{}' >"$AUTOPILOT_CONFIG_FILE"; export PTG_V_MODE=violate
  stop "$1" false
  [ "$(find "$AUTOPILOT_LIVE_DIR" -mindepth 1 | wc -l | tr -d ' ')" = 0 ] && [ "$(blocks)" = 0 ]
}

run_nc() { # <label> <fn> <mutant-name> <sed-expr>
  if "$2" "$REAL_HOOK"; then assert_eq 0 0 "$1 holds on the real hook"; else fail "$1 broken on the real hook"; fi
  local m; m="$(mutant "$3" "$4")" || { fail "$1 mutant not built"; return; }
  if "$2" "$m"; then fail "$1 negative control: the mutant passed (check cannot go red)"; else assert_eq 0 0 "$1 red on the mutant"; fi
}

run_nc NC1 nc1 allowall "s#else { text = renderRetry(result.json, mode); outcome = 'block'; }#else { outcome = 'clean'; }#"
run_nc NC2 nc2 nocap "s#if (counter >= maxBlocks) {#if (false) {#"
run_nc NC3 nc3 blockonerr "s#if (result.kind === 'error') outcome = 'error';#if (false) outcome = 'error';#; s#return { kind: 'error' };#return { kind: 'violations', json: {} };#g"
run_nc NC4 nc4 noreset "s#startsNewTurn(payload) ? prevTurn + 1 : prevTurn#prevTurn#"
run_nc NC9v nc9v gapsblock "s#return mode === 'violations+features' \&\& gapsOf(result.json).length > 0;#return gapsOf(result.json).length > 0;#"

run_nc NC9f nc9f gapsnever "s#return mode === 'violations+features' \&\& gapsOf(result.json).length > 0;#return false;#"
run_nc NC9t nc9t nogate "s#const withGaps = mode === 'violations+features' \&\& gaps.length > 0;#const withGaps = gaps.length > 0;#"

run_nc NC10 nc10 nolock "s#let unlock = acquireLock(lockDir);#let unlock = () => {};#; s#const u = acquireLock(lockDir);#const u = () => {};#; s#const counter = readInt(countFile);#const counter = readInt(countFile); sleepMs(150);#"
run_nc NC11 nc11 noschema "s#if (!validSchema(json)) return { kind: 'error' };##"
run_nc NC12 nc12 noclean "s#^  cleanupState(dir,#  (() => {})(dir,#"
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
