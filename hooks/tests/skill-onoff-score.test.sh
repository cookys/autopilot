#!/usr/bin/env bash
# hooks/tests/skill-onoff-score.test.sh — planted-red fixtures for score-onoff.js.
# The known failure family under test: "a scorer that passes when the gate is deleted".
# The vacuous FULL==OFF fixture must NEVER reach SHIP-GATE-MET (exit 0), no matter how
# good CARD looks — that assertion is the mutation tripwire for V2 deletion.
# Also: pack digest integrity, card-frontmatter byte-equality, verdict-map coverage.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
SCORER="$BASE/score-onoff.js"
TEST_TMP=$(mktemp -d -t "skill-onoff-score-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# ── fixture generator: emits a full 7×3×3 block with per-arm marker probabilities 0/1 ──
gen() { # $1 out file; env: FULL_SCORE CARD_SCORE OFF_SCORE (true|false), plus overrides via args
  node -e '
    const fs=require("fs");
    const [out]=process.argv.slice(1);
    const TASKS={
      "d1-s-tiny-feature":["f1_s_no_tracking","f6_gate_before_commit"],
      "d2-l-multimodule":["f1_session_sha","f1_plan_file","f1_project_readme"],
      "d3-fix-known-bug":["f3_fix_branch_flow","f4_maintenance_ledger","f5_red_before_edit","f6_gate_before_commit"],
      "d4-hotfix":["f3_hotfix_compound"],
      "d5-verify-contract":["f5_red_before_edit","f5_green_after_edit"],
      "d6-quality-gate":["f6_gate_before_commit"],
      "d7-fix-vs-l-boundary":["f3_fix_branch_flow","f1_stays_fix_no_tracking"],
    };
    const val={full:process.env.FULL_SCORE==="true",card:process.env.CARD_SCORE==="true",off:process.env.OFF_SCORE==="true"};
    // overrides: JSON in $OVERRIDES — [{task,arm,rep,markers:{..}}, {drop:{task,arm,rep}}, ...]
    const ov=JSON.parse(process.env.OVERRIDES||"[]");
    const lines=[];
    for(const [task,markers] of Object.entries(TASKS))
      for(let rep=1;rep<=3;rep++)
        for(const arm of ["full","card","off"]){
          if(ov.some(o=>o.drop&&o.drop.task===task&&o.drop.arm===arm&&o.drop.rep===rep)) continue;
          const row={task_id:task,arm,model:process.env.MODEL_A||"sonnet",runner:"cc",
            runner_version:"2.1.234 (Claude Code)",rep,duration_s:1,frozen_base_sha:"x",
            markers:Object.fromEntries(markers.map(m=>[m,val[arm]])),
            skill_invoked_devflow:process.env.V1_FAIL==="true"&&arm==="full"?false:(arm!=="off"),
            failure_class:null,failure_cause:null};
          const o=ov.find(o=>o.task===task&&o.arm===arm&&o.rep===rep);
          if(o&&o.markers) Object.assign(row.markers,o.markers);
          if(o&&o.model) row.model=o.model;
          lines.push(JSON.stringify(row));
        }
    fs.writeFileSync(out,lines.join("\n")+"\n");
  ' "$1"
}

run_scorer() { # $1 results → echoes exit code
  set +e
  node "$SCORER" --results "$1" > "$TEST_TMP/score-out.txt" 2>&1
  echo $?
  set -e
}

echo "=== healthy SHIP: FULL high, OFF low, CARD == FULL ==="
FULL_SCORE=true CARD_SCORE=true OFF_SCORE=false OVERRIDES="[]" gen "$TEST_TMP/ship.jsonl"
rc=$(run_scorer "$TEST_TMP/ship.jsonl")
[ "$rc" -eq 0 ] || { cat "$TEST_TMP/score-out.txt"; fail "healthy fixture did not SHIP (rc=$rc)"; }
grep -q 'SHIP-GATE-MET' "$TEST_TMP/score-out.txt" || fail "SHIP verdict text missing"

echo "=== vacuous FULL==OFF can NEVER ship (V2 tripwire) ==="
FULL_SCORE=true CARD_SCORE=true OFF_SCORE=true OVERRIDES="[]" gen "$TEST_TMP/vacuous.jsonl"
rc=$(run_scorer "$TEST_TMP/vacuous.jsonl")
[ "$rc" -eq 5 ] || fail "vacuous fixture must exit 5 (got $rc)"
grep -q 'INSTRUMENT-INVALID' "$TEST_TMP/score-out.txt" || fail "vacuous verdict text"
FULL_SCORE=false CARD_SCORE=false OFF_SCORE=false OVERRIDES="[]" gen "$TEST_TMP/allfalse.jsonl"
rc=$(run_scorer "$TEST_TMP/allfalse.jsonl")
[ "$rc" -eq 5 ] || fail "all-false fixture must exit 5 (got $rc)"

echo "=== ITERATE-CARD: card below margin on ONE load-bearing family (F4, n=3, margin 1) ==="
OV='[{"task":"d3-fix-known-bug","arm":"card","rep":1,"markers":{"f4_maintenance_ledger":false}},{"task":"d3-fix-known-bug","arm":"card","rep":2,"markers":{"f4_maintenance_ledger":false}},{"task":"d3-fix-known-bug","arm":"card","rep":3,"markers":{"f4_maintenance_ledger":false}}]'
FULL_SCORE=true CARD_SCORE=true OFF_SCORE=false OVERRIDES="$OV" gen "$TEST_TMP/iter.jsonl"
rc=$(run_scorer "$TEST_TMP/iter.jsonl")
[ "$rc" -eq 3 ] || { cat "$TEST_TMP/score-out.txt"; fail "one-family margin miss must ITERATE (rc=$rc)"; }
grep -q 'ITERATE-CARD' "$TEST_TMP/score-out.txt" || fail "iterate verdict text"

echo "=== ABORT-RECORD: card dead on three families ==="
node -e '
  const fs=require("fs");
  const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
  for(const r of rows) if(r.arm==="card") for(const k of Object.keys(r.markers))
    if(k.startsWith("f3")||k.startsWith("f4")||k.startsWith("f5")) r.markers[k]=false;
  fs.writeFileSync(process.argv[2],rows.map(r=>JSON.stringify(r)).join("\n")+"\n");
' "$TEST_TMP/ship.jsonl" "$TEST_TMP/abort.jsonl"
rc=$(run_scorer "$TEST_TMP/abort.jsonl")
[ "$rc" -eq 4 ] || { cat "$TEST_TMP/score-out.txt"; fail "three-family kill must ABORT (rc=$rc)"; }

echo "=== V1 manipulation-check failure ==="
FULL_SCORE=true CARD_SCORE=true OFF_SCORE=false V1_FAIL=true OVERRIDES="[]" gen "$TEST_TMP/v1.jsonl"
rc=$(run_scorer "$TEST_TMP/v1.jsonl")
[ "$rc" -eq 5 ] || fail "V1 failure must exit 5 (got $rc)"
grep -q 'V1' "$TEST_TMP/score-out.txt" || fail "V1 verdict text"

echo "=== mixed models rejected ==="
OV='[{"task":"d1-s-tiny-feature","arm":"full","rep":1,"model":"haiku"}]'
FULL_SCORE=true CARD_SCORE=true OFF_SCORE=false OVERRIDES="$OV" gen "$TEST_TMP/mixed.jsonl"
rc=$(run_scorer "$TEST_TMP/mixed.jsonl")
[ "$rc" -eq 5 ] || fail "mixed models must exit 5 (got $rc)"

echo "=== paired exclusion: 1 missing cell survives; 2 lost pairs in a family invalidate ==="
OV='[{"drop":{"task":"d6-quality-gate","arm":"card","rep":2}}]'
FULL_SCORE=true CARD_SCORE=true OFF_SCORE=false OVERRIDES="$OV" gen "$TEST_TMP/drop1.jsonl"
rc=$(run_scorer "$TEST_TMP/drop1.jsonl")
[ "$rc" -eq 0 ] || { cat "$TEST_TMP/score-out.txt"; fail "single missing cell should still SHIP (rc=$rc)"; }
OV='[{"drop":{"task":"d3-fix-known-bug","arm":"card","rep":1}},{"drop":{"task":"d3-fix-known-bug","arm":"off","rep":2}}]'
FULL_SCORE=true CARD_SCORE=true OFF_SCORE=false OVERRIDES="$OV" gen "$TEST_TMP/drop2.jsonl"
rc=$(run_scorer "$TEST_TMP/drop2.jsonl")
[ "$rc" -eq 5 ] || fail "two lost pairs in one family must invalidate (got $rc)"

echo "=== pack digest integrity + card frontmatter byte-equality ==="
node -e '
  const fs=require("fs"),crypto=require("crypto"),path=require("path");
  const base=process.argv[1];
  const man=JSON.parse(fs.readFileSync(path.join(base,"packs/manifest.json"),"utf8"));
  for(const [pack,files] of Object.entries(man.packs))
    for(const [rel,digest] of Object.entries(files)){
      const got=crypto.createHash("sha256").update(fs.readFileSync(path.join(base,"packs",rel))).digest("hex");
      if(got!==digest){console.error(`digest drift: ${rel}`);process.exit(1);}
    }
  const fm=f=>{const t=fs.readFileSync(f,"utf8");const m=t.match(/^---\n[\s\S]*?\n---\n/);return m?m[0]:null;};
  const a=fm(path.join(base,"packs/dev-flow-full/SKILL.md"));
  const b=fm(path.join(base,"packs/dev-flow-card/SKILL.md"));
  if(!a||a!==b){console.error("card frontmatter not byte-identical to full");process.exit(1);}
' "$BASE" || fail "digest/frontmatter integrity"

echo "PASS: skill-onoff scorer planted-red suite"
