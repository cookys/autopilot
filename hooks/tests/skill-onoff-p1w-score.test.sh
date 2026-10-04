#!/usr/bin/env bash
# hooks/tests/skill-onoff-p1w-score.test.sh — mods P1W EVALX: the per-row scorer + frozen pre-registration
# (spend-free; synthetic result rows, no model).
#
# Planted-red family under test: "a scorer that passes when its gate is deleted". A vacuous
# ON==OFF dataset, a skill-not-invoked dataset and a survivor-starved dataset must NEVER exit 0
# (PASS), however good the ON arm looks. Also: the prereg files carry exactly the pre-registered
# thresholds (ON >= 8/10, OFF <= 2/10, V1 90%, V2 diff 6, survivor STOP) and their sha256 digests
# are recorded in prereg/FROZEN.json (a threshold edit after freeze = red).
#
# RED-first record: against the unmodified tree (no score-p1w.js / prereg/) every case fails
# at the first scorer call — captured in the REPORT.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="${P1W_EVAL_BASE:-$REPO_ROOT/evals/skill-onoff}"
SCORER="$BASE/score-p1w.js"
TEST_TMP=$(mktemp -d -t "skill-onoff-p1w-score-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# gen <prereg> <out> — env: ON_HITS OFF_HITS (primary markers true count per arm, spread over cells),
# CTL_ON CTL_OFF (control hits of 5), INVOKED_ON INVOKED_OFF (cells with skill_invoked true, of 10), DROP_ON (cells to infra_fail), MODEL_ON
gen() {
  node -e '
    const fs=require("fs");
    const [pre,out]=process.argv.slice(1);
    const P=JSON.parse(fs.readFileSync(pre,"utf8"));
    const E=process.env, n=(k,d)=>E[k]===undefined?d:Number(E[k]);
    const tasks=Object.keys(P.primary.tasks);
    const rows=[]; let hitOn=0,hitOff=0,invOn=0,invOff=0,drop=0;
    for(const t of tasks) for(let rep=1;rep<=P.reps;rep++) for(const arm of ["base","change"]){
      const on=arm==="change";
      const marker=P.primary.tasks[t][0];
      const hit=on?(hitOn++<n("ON_HITS",9)):(hitOff++<n("OFF_HITS",1));
      const inv=on?(invOn++<n("INVOKED_ON",10)):(invOff++<n("INVOKED_OFF",10));
      let failure=null;
      if(on&&drop++<n("DROP_ON",0)) failure="infra_fail";
      rows.push({task_id:t,arm,model:(on&&E.MODEL_ON)||"sonnet",runner:"cc",runner_version:"2.1.234 (Claude Code)",rep,duration_s:1,frozen_base_sha:"x",
        markers:{[marker]:hit},skill_invoked:inv,check_skill:P.skill,failure_class:failure,failure_cause:failure?"runner_error":null});
    }
    if(P.control){ const ct=Object.keys(P.control.tasks)[0], cm=P.control.tasks[ct][0]; let co=0,cf=0;
      for(let rep=1;rep<=5;rep++) for(const arm of ["base","change"]){
        const on=arm==="change"; const hit=on?(co++<n("CTL_ON",0)):(cf++<n("CTL_OFF",0));
        rows.push({task_id:ct,arm,model:"sonnet",runner:"cc",runner_version:"2.1.234 (Claude Code)",rep,duration_s:1,frozen_base_sha:"x",markers:{[cm]:hit},skill_invoked:true,check_skill:P.skill,failure_class:null,failure_cause:null}); } }
    fs.writeFileSync(out,rows.map(r=>JSON.stringify(r)).join("\n")+"\n");
  ' "$1" "$2"
}
score() { # $1 prereg → exit code echoed; output in $TEST_TMP/o.txt
  set +e; node "$SCORER" --prereg "$1" --results "$TEST_TMP/r.jsonl" > "$TEST_TMP/o.txt" 2>&1; echo $?; set -e
}
expect() { # want label prereg
  gen "$3" "$TEST_TMP/r.jsonl"; got=$(score "$3"); [ "$got" = "$1" ] || fail "$2: want exit $1 got $got: $(cat "$TEST_TMP/o.txt")"
}

for row in w2a-g w2b-g w1b-t2; do
  PRE="$BASE/prereg/$row.json"
  echo "=== $row: scorer verdicts ==="
  export CTL_ON=0 CTL_OFF=0
  ON_HITS=9 OFF_HITS=1 expect 0 "$row healthy PASS" "$PRE"
  ON_HITS=8 OFF_HITS=2 expect 0 "$row boundary 8/10 vs 2/10 PASS" "$PRE"
  ON_HITS=7 OFF_HITS=1 expect 3 "$row ON 7/10 FAIL" "$PRE"
  ON_HITS=10 OFF_HITS=3 expect 3 "$row OFF 3/10 FAIL" "$PRE"
  ON_HITS=9 OFF_HITS=9 expect 5 "$row vacuous ON==OFF never PASS (V2)" "$PRE"
  ON_HITS=10 OFF_HITS=5 expect 5 "$row diff 5 < 6 not load-bearing" "$PRE"
  ON_HITS=9 OFF_HITS=1 INVOKED_ON=7 expect 5 "$row V1 skill not invoked" "$PRE"
  ON_HITS=9 OFF_HITS=1 INVOKED_OFF=0 expect 5 "$row V1 OFF arm skill never invoked" "$PRE"
  ON_HITS=9 OFF_HITS=1 DROP_ON=3 expect 4 "$row survivor STOP (3 lost pairs)" "$PRE"
  ON_HITS=9 OFF_HITS=1 DROP_ON=2 expect 4 "$row survivor STOP (2 lost pairs)" "$PRE"
  ON_HITS=9 OFF_HITS=1 DROP_ON=1 expect 0 "$row 1 lost pair tolerated" "$PRE"
  ON_HITS=9 OFF_HITS=1 MODEL_ON=opus expect 5 "$row mixed models invalid" "$PRE"
done

echo "=== w2a-g over-trigger control ==="
PRE="$BASE/prereg/w2a-g.json"
CTL_ON=1 CTL_OFF=0 ON_HITS=9 OFF_HITS=1 expect 0 "control 1/5 ON false-positive tolerated" "$PRE"
CTL_ON=2 CTL_OFF=0 ON_HITS=9 OFF_HITS=1 expect 3 "control 2/5 ON false-positive FAIL" "$PRE"
CTL_ON=2 CTL_OFF=2 ON_HITS=9 OFF_HITS=1 expect 3 "control ON>1 even when OFF also over-triggers FAIL" "$PRE"
unset CTL_ON CTL_OFF

echo "=== pre-registration frozen: thresholds literal + digests recorded ==="
node -e '
  const fs=require("fs"),crypto=require("crypto"),path=require("path");
  const base=process.argv[1];
  const fz=JSON.parse(fs.readFileSync(path.join(base,"prereg/FROZEN.json"),"utf8"));
  const rows={"w2a-g":["ceo-agent",["a1-doa-boundary","a1b-doa-boundary-reset"]],"w2b-g":["dev-flow",["d2-l-multimodule","d8-l-two-phase"]],"w1b-t2":["finish-flow",["f1-ready-to-merge","f1b-ready-to-merge-docs"]]};
  for (const [row,[skill,tasks]] of Object.entries(rows)) {
    const f=`prereg/${row}.json`;
    const P=JSON.parse(fs.readFileSync(path.join(base,f),"utf8"));
    const T=P.thresholds;
    const want={on_min:8,off_max:2,v1_min_invoked_ratio:0.9,v2_min_diff:6,min_usable:8,max_lost_pairs:1};
    for (const [k,v] of Object.entries(want)) if (T[k]!==v) { console.error(`${row}: threshold ${k}=${T[k]} != pre-registered ${v}`); process.exit(1); }
    if (P.skill!==skill || P.reps!==5 || P.model!=="sonnet" || P.arms.off!=="base" || P.arms.on!=="change") { console.error(`${row}: prereg shape`); process.exit(1); }
    if (JSON.stringify(Object.keys(P.primary.tasks))!==JSON.stringify(tasks)) { console.error(`${row}: primary tasks`); process.exit(1); }
    for (const t of tasks) if (!fs.existsSync(path.join(base,"tasks",t,"markers.sh"))) { console.error(`${row}: fixture ${t} missing`); process.exit(1); }
    const d=crypto.createHash("sha256").update(fs.readFileSync(path.join(base,f))).digest("hex");
    if (fz.files[f]!==d) { console.error(`${row}: prereg digest != FROZEN.json (edited after freeze)`); process.exit(1); }
  }
  for (const [f,d] of Object.entries(fz.files)) {
    const got=crypto.createHash("sha256").update(fs.readFileSync(path.join(base,f))).digest("hex");
    if (got!==d) { console.error(`frozen file changed after freeze: ${f}`); process.exit(1); }
  }
  if (Object.keys(fz.files).length < 10) { console.error("FROZEN.json lists too few files"); process.exit(1); }
' "$BASE" || fail "pre-registration frozen check"

echo "PASS: skill-onoff P1W scorer + frozen pre-registration"
