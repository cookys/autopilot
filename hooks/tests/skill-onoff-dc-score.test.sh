#!/usr/bin/env bash
# hooks/tests/skill-onoff-dc-score.test.sh — spend-free proof of score-dc.js (row "dc"): the V1/V2/V3 verdict map from a FROZEN
# prereg, with planted-red datasets. Negative control: a vacuous FULL==OFF dataset can NEVER reach SHIP-GATE-MET or V2-PHASE-PASS.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SC="$REPO_ROOT/evals/skill-onoff/score-dc.js"
PRE="$TEST_TMP/prereg.json"
fail() { echo "FAIL: $*" >&2; exit 1; }

cat > "$PRE" <<'J'
{"reps":3,"arms":["full","card","off"],"min_load_bearing":2,
 "families":{"A":{"label":"a","tasks":{"t1":["m1"],"t2":["m1"],"t3":["m1"]}},"B":{"label":"b","tasks":{"t1":["m2"],"t2":["m2"],"t3":["m2"]}},"C":{"label":"c","tasks":{"t1":["m3"],"t2":["m3"],"t3":["m3"]}}},
 "informational":{"I":{"label":"i","tasks":{"t1":["m4"]}}}}
J
# gen <full-pass-map> <card-pass-map> <off-pass-map> : each map "A:n,B:n,C:n" = how many of the 9 (task,rep) cells of the family pass
gen() { node -e '
const [full,card,off]=process.argv.slice(1).map(m=>Object.fromEntries(m.split(",").map(x=>x.split(":"))));
const key={A:"m1",B:"m2",C:"m3"}; const rows=[];
for (const [arm,map] of [["full",full],["card",card],["off",off]]) for (const t of ["t1","t2","t3"]) for (let rep=1;rep<=3;rep++){
  const markers={m4:false}; const idx=(["t1","t2","t3"].indexOf(t))*3+(rep-1);
  for (const f of ["A","B","C"]) markers[key[f]]= idx < Number(map[f]);
  rows.push({task_id:t,arm,model:"sonnet",runner:"cc",runner_version:"1",rep,failure_class:null,skill_invoked:arm!=="off",markers});
}
console.log(rows.map(r=>JSON.stringify(r)).join("\n"))' "$@"; }
run() { node "$SC" --prereg "$PRE" --results "$1" "${@:2}"; }

gen "A:9,B:9,C:9" "A:9,B:9,C:9" "A:0,B:0,C:0" > "$TEST_TMP/ok.jsonl"
out=$(run "$TEST_TMP/ok.jsonl") && rc=0 || rc=$?; [ "$rc" = 0 ] && grep -q "SHIP-GATE-MET" <<<"$out" || fail "good dataset should SHIP-GATE-MET (rc=$rc): $out"

gen "A:9,B:9,C:9" "A:9,B:9,C:9" "A:9,B:9,C:9" > "$TEST_TMP/vacuous.jsonl"   # NEGATIVE CONTROL: FULL == OFF
out=$(run "$TEST_TMP/vacuous.jsonl") && rc=0 || rc=$?; [ "$rc" = 5 ] && grep -q "INSTRUMENT-INVALID (V2" <<<"$out" || fail "vacuous dataset must be INSTRUMENT-INVALID (rc=$rc): $out"
out=$(run "$TEST_TMP/vacuous.jsonl" --arms full,off) && rc=0 || rc=$?; [ "$rc" = 5 ] || fail "vacuous full,off must not pass the V2 phase (rc=$rc)"

gen "A:9,B:9,C:9" "A:2,B:9,C:9" "A:0,B:0,C:0" > "$TEST_TMP/card-bad.jsonl"      # card loses family A
out=$(run "$TEST_TMP/card-bad.jsonl") && rc=0 || rc=$?; [ "$rc" = 3 ] && grep -q "ITERATE-CARD (V3 failed on: A)" <<<"$out" || fail "card regression must ITERATE-CARD on A (rc=$rc): $out"

gen "A:9,B:9,C:9" "A:0,B:0,C:0" "A:0,B:0,C:0" > "$TEST_TMP/card-dead.jsonl"       # card loses every family
out=$(run "$TEST_TMP/card-dead.jsonl") && rc=0 || rc=$?; [ "$rc" = 4 ] || fail "card dead on >2 families must ABORT-RECORD (rc=$rc): $out"

gen "A:9,B:9,C:9" "A:9,B:9,C:9" "A:0,B:0,C:0" > "$TEST_TMP/p2.jsonl"
out=$(run "$TEST_TMP/p2.jsonl" --arms full,off) && rc=0 || rc=$?; [ "$rc" = 0 ] && grep -q "V2-PHASE-PASS" <<<"$out" || fail "full,off V2 phase should pass (rc=$rc): $out"

gen "A:9,B:9,C:9" "A:9,B:9,C:9" "A:0,B:0,C:0" | sed 's/"skill_invoked":true/"skill_invoked":false/' > "$TEST_TMP/v1.jsonl"   # routing failure
out=$(run "$TEST_TMP/v1.jsonl") && rc=0 || rc=$?; [ "$rc" = 5 ] && grep -q "V1" <<<"$out" || fail "V1 failure must be INSTRUMENT-INVALID (rc=$rc): $out"

echo "PASS: score-dc verdict map"
