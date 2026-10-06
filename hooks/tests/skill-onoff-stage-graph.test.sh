#!/usr/bin/env bash
# hooks/tests/skill-onoff-stage-graph.test.sh — spend-free proof of the stage-graph eval instrument
# (plan docs/plans/2026-10-06-dev-flow-stage-graph.md §4 P0). No live model cell is run: every
# transcript here is SYNTHETIC (stream-json tool_use/tool_result events, same shape as claude -p) and is
# fed through the REAL tasks/stage-graph-*/markers.sh -> lib/stage-graph-cell.js -> score-stage-graph.js.
#
# Asserts:
#   0. expected.json is complete (84 cells, no node id contains "hetero", walks consistent with §2.7)
#   1. the 12 answer keys agree with their expected.json cells; briefs carry no answer vocabulary
#   2. (a) transcripts that follow each expected walk to its horizon pass all 12 briefs
#      (b) the planted-red size rotation passes exactly the 3 M briefs (<= 3 <= 4) and fails the 9 others
#      (c) a wrong first rung fails that brief
#      (d) a walk diverging before the horizon, or stopping short of it, fails; one running past it passes
#      plus: refused stage writes (is_error) are ignored, wrong size/bug/urgent fail, no-op is all false
#   3. aggregate verdicts: SHIP / NOT-SHIP (change low, red high, generic regression) / STOP / INVALID
# Env: ONOFF_SG_BASE points the test at a mutated copy of evals/skill-onoff (mutation controls).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="${ONOFF_SG_BASE:-$REPO_ROOT/evals/skill-onoff}"
EXPECTED="$REPO_ROOT/hooks/tests/fixtures/stage-graph/expected.json"
QUERY="$BASE/lib/transcript-query.js"
SCORER="$BASE/score-stage-graph.js"
PREREG="$BASE/prereg/stage-graph.json"
TEST_TMP=$(mktemp -d -t "skill-onoff-stage-graph-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

TASKS=$(node -e 'process.stdout.write(require(process.argv[1]).tasks.join(" "))' "$PREREG")
[ "$(wc -w <<<"$TASKS")" -eq 12 ] || fail "prereg must list 12 tasks"

echo "=== 0. expected.json completeness ==="
node - "$EXPECTED" <<'NODE' || fail "expected.json invariants"
const j = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const die = (m) => { console.error(m); process.exit(1); };
if (j.cells.length !== 84 || j.schema.cell_count !== 84) die(`cell count ${j.cells.length}`);
const ids = new Set(j.cells.map((c) => c.id));
if (ids.size !== 84) die('duplicate cell ids');
for (const n of j.node_ids) if (n.includes('hetero')) die('node id contains hetero');
const want = { XS: 12, S: 12, M: 12, L: 24, XL: 24 };
for (const [s, n] of Object.entries(want)) if (j.cells.filter((c) => c.size === s).length !== n) die(`size ${s} cells`);
for (const c of j.cells) {
  for (const n of c.walk) if (!j.node_ids.includes(n)) die(`${c.id}: unknown node ${n}`);
  if (JSON.stringify([...new Set(c.walk)]) !== JSON.stringify(c.nodes)) die(`${c.id}: nodes != unique(walk)`);
  if (c.walk[0] !== c.entry) die(`${c.id}: entry`);
  const first = c.bug ? 'diagnose' : { XS: 'implement', S: 'implement', M: 'plan', L: 'intent', XL: 'intent' }[c.size];
  if (c.entry !== first) die(`${c.id}: entry ${c.entry} != ${first}`);
  const hasCR = ['M', 'L', 'XL'].includes(c.size);
  const crIdx = c.walk.indexOf('code-review');
  const fin = c.walk.indexOf('finish');
  if (hasCR) {
    if (c.urgency === 'urgent-low') { if (!(crIdx === c.walk.length - 1 && crIdx > fin)) die(`${c.id}: urgent-low code-review must be terminal after finish`); }
    else if (!(crIdx >= 0 && crIdx < c.walk.indexOf('qc-gate'))) die(`${c.id}: code-review before qc-gate`);
  } else if (crIdx !== -1) die(`${c.id}: XS/S has no code-review`);
  const loops = c.walk.filter((n) => n === 'verify').length;
  if (c.size === 'XS') { if (loops !== 0) die(`${c.id}: XS has no verify`); } else if (loops !== c.units) die(`${c.id}: verify count ${loops} != units ${c.units}`);
  if ((c.research === 'research') !== c.walk.includes('research')) die(`${c.id}: research axis`);
  if (c.size === 'XL' ? c.unit_kind !== 'deliverable' : false) die(`${c.id}: XL unit_kind`);
}
const lb = j.loop_backs.find((x) => x.from === 'code-review');
if (!lb || !lb.except_urgency.includes('urgent-low')) die('code-review loop-back lacks the urgent-low exclusion');
console.log('ok');
NODE

echo "=== 1. answer keys vs expected.json; brief hygiene ==="
out=$(node "$SCORER" validate-keys --prereg "$PREREG" --tasks-dir "$BASE/tasks" --expected "$EXPECTED") || fail "validate-keys: $out"
grep -q '"KEYS-OK"' <<<"$out" || fail "validate-keys verdict: $out"
FORBIDDEN=('dev-flow' 'finish-flow' 'quality-pipeline' 'stage-advance' 'session-mode' 'probe-unknown' 'horizon' 'qc-gate' 'code-review' 'plan-review' 'walk' 'size' 'rung' 'XL' 'S!' 'M!')
for t in $TASKS; do
  [ -f "$BASE/tasks/$t/answer.json" ] && [ -f "$BASE/tasks/$t/task.md" ] && [ -f "$BASE/tasks/$t/markers.sh" ] && [ -f "$BASE/tasks/$t/init-repo.sh" ] && [ -d "$BASE/tasks/$t/repo" ] || fail "$t: incomplete brief dir"
  for tok in "${FORBIDDEN[@]}"; do
    if grep -qF -- "$tok" "$BASE/tasks/$t/task.md"; then fail "leakage: '$tok' in $t/task.md"; fi
  done
done
# the invented nouns must be absent from every fixture repo, knowledge-style text included
if grep -rliE 'zyphrelt|glimmerwake|quillfathom|dovetail' "$BASE"/tasks/stage-graph-*/repo 2>/dev/null; then fail "invented noun present in a fixture repo"; fi

# ── synthetic transcript builder ─────────────────────────────────────────────────────────────────
cat > "$TEST_TMP/mk.js" <<'NODE'
// mk.js <task> <mode> <out> — modes: good | rotated | rung-wrong | diverge | short | long | noop | refused | bad-size | bad-bug | bad-urgent
const fs = require('fs');
const path = require('path');
const [base, expectedFile, task, mode, out] = process.argv.slice(2);
const ans = JSON.parse(fs.readFileSync(path.join(base, 'tasks', task, 'answer.json'), 'utf8'));
const exp = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
const cellOf = (id) => exp.cells.find((c) => c.id === id);
let n = 0;
const lines = [];
const use = (cmd, result, isErr) => {
  const id = `tu${++n}`;
  lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: cmd } }] } }));
  if (result !== undefined) lines.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!isErr, content: result }] } }));
};
const rot = { XS: 'L', L: 'XS', S: 'XL', XL: 'S', M: 'M' };
let walk = ans.horizon_index >= 0 ? cellOf(ans.cell).walk.slice() : [];
let size = ans.size;
let bug = ans.bug;
let urgent = ans.urgent;
let rung = ans.first_rung === 'none' ? null : ans.first_rung;
if (mode === 'noop') { fs.writeFileSync(out, ''); process.exit(0); }
if (mode === 'rotated') {
  const ts = rot[ans.size];
  const res = ['L', 'XL'].includes(ts) ? 'noresearch' : 'na';
  const urg = ans.urgent ? (cellOf(ans.cell).urgency) : 'normal';
  const id = `${ts}.${ans.bug ? 'bug' : 'feat'}.${urg}.${res}.u${ans.units}`;
  const c = cellOf(id);
  if (!c) throw new Error('no rotated cell ' + id);
  walk = c.walk.slice();
}
if (mode === 'rung-wrong') rung = ans.first_rung === 'U1' ? 'U0' : 'U1';
if (mode === 'diverge') { const i = Math.max(1, ans.horizon_index); walk[i] = walk[i] === 'implement' ? 'verify' : 'implement'; }
if (mode === 'short') walk = walk.slice(0, ans.horizon_index);
if (mode === 'long') walk = walk.concat(['code-review', 'qc-gate', 'finish']);
if (mode === 'bad-size') size = size === 'M' ? 'L' : 'M';
if (mode === 'bad-bug') bug = !bug;
if (mode === 'bad-urgent') urgent = !urgent;
use(`cd /work && node "$CLAUDE_PLUGIN_ROOT/scripts/session-mode.js" set --size ${size}${bug ? ' --bug' : ''}${urgent ? ' --urgent' : ''} && echo init`, '{"ok":true}');
if (rung) use(`node scripts/probe-unknown.js classify --ledger /tmp/l.jsonl --terms alpha,beta`, JSON.stringify({ artifact_type: 'unknown_probe', eligible_max: rung, recommend: rung === 'U1' ? 'none' : 'U0' }));
else if (task.endsWith('l-feature')) use('node scripts/probe-unknown.js classify --terms notes,storage', JSON.stringify({ eligible_max: 'U0', recommend: 'U0' }));
for (let i = 0; i < walk.length; i++) {
  if (mode === 'refused' && i === 1) use(`node scripts/stage-advance.js --to ${walk[i] === 'verify' ? 'qc-gate' : 'finish'}`, '{"allowed":false}', true); // refused write: must be ignored
  use(`node scripts/stage-advance.js --to ${walk[i]}${i % 3 === 1 ? ' --unit phase:1/1:x' : ''}`, '{"ok":true}');
  if (i === 0) use(`node scripts/stage-advance.js --to ${walk[i]} --review-families a,b`, '{"ok":true}'); // same-node update: collapsed
}
fs.writeFileSync(out, lines.join('\n') + '\n');
NODE

mk_transcript() { node "$TEST_TMP/mk.js" "$BASE" "$EXPECTED" "$1" "$2" "$3"; }

make_repo() { # $1 task $2 dirty(0|1) -> repo dir
  local dir; dir=$(mktemp -d -p "$TEST_TMP" repo-XXXXXX)
  cp -r "$BASE/tasks/$1/repo"/. "$dir"/
  ( cd "$dir" && git init -q && git config user.name T && git config user.email t@t && git config commit.gpgsign false \
    && bash "$BASE/tasks/$1/init-repo.sh" ) >/dev/null 2>&1
  [ "$2" = 1 ] && echo "work" > "$dir/work-done.txt"
  echo "$dir"
}
run_markers() { # $1 task $2 repo $3 transcript
  ( cd "$2" && TRANSCRIPT="$3" FROZEN_BASE_SHA="$(git rev-list --max-parents=0 HEAD | head -1)" QUERY="$QUERY" ONOFF_LIB="$BASE/lib" \
      ONOFF_SG_EXPECTED="$EXPECTED" bash "$BASE/tasks/$1/markers.sh" )
}
mval() { sed -n "s/^marker_sg_$2=//p" <<<"$1"; } # $1 markers $2 key

declare -A DIRTY CLEAN
for t in $TASKS; do DIRTY[$t]=$(make_repo "$t" 1); CLEAN[$t]=$(make_repo "$t" 0); done
mkdir -p "$TEST_TMP/m"
scenario() { # $1 mode -> writes $TEST_TMP/m/<mode>/<task>.env ; echoes number of passing briefs
  local mode=$1 t pass=0
  mkdir -p "$TEST_TMP/m/$mode"
  for t in $TASKS; do
    mk_transcript "$t" "$mode" "$TEST_TMP/m/$mode/$t.jsonl"
    run_markers "$t" "${DIRTY[$t]}" "$TEST_TMP/m/$mode/$t.jsonl" > "$TEST_TMP/m/$mode/$t.env"
    [ "$(mval "$(cat "$TEST_TMP/m/$mode/$t.env")" pass)" = true ] && pass=$((pass + 1))
  done
  echo "$pass"
}

echo "=== no-op: pristine repo + empty transcript => every sg marker false, for every brief ==="
for t in $TASKS; do
  : > "$TEST_TMP/empty.jsonl"
  o=$(run_markers "$t" "${CLEAN[$t]}" "$TEST_TMP/empty.jsonl")
  grep -q '=true' <<<"$o" && fail "$t no-op: expected all-false, got: $o"
  # work done but nothing in the transcript: still no pass
  o=$(run_markers "$t" "${DIRTY[$t]}" "$TEST_TMP/empty.jsonl")
  [ "$(mval "$o" pass)" = false ] || fail "$t: empty transcript passed"
done

echo "=== (a) transcripts following each expected walk to its horizon: all 12 pass ==="
good=$(scenario good)
[ "$good" -eq 12 ] || fail "(a) expected 12/12 briefs to pass, got $good"
# work_done conjunction: the same compliant transcript on a pristine repo is all false
for t in $TASKS; do
  o=$(run_markers "$t" "${CLEAN[$t]}" "$TEST_TMP/m/good/$t.jsonl")
  grep -q '=true' <<<"$o" && fail "$t: compliant transcript but no repo change must be all-false: $o"
done

echo "=== (b) planted-red size rotation: only the 3 M briefs can pass (<= 3 by construction, <= 4 required) ==="
red=$(scenario rotated)
[ "$red" -le 3 ] || fail "(b) rotated arm passed $red briefs, must be <= 3"
[ "$red" -le 4 ] || fail "(b) rotated arm exceeds the registered red ceiling"
for t in $TASKS; do
  p=$(mval "$(cat "$TEST_TMP/m/rotated/$t.env")" pass)
  case "$t" in
    stage-graph-m-feature|stage-graph-m-bug|stage-graph-m-urgent-high) [ "$p" = true ] || fail "(b) $t (M) keeps its sequence and must pass" ;;
    *) [ "$p" = false ] || fail "(b) $t is invalidated by the rotation and must fail" ;;
  esac
done
node -e '
const P = require(process.argv[1]);
const inv = P.mutation.invalidates, keep = P.mutation.keeps;
if (inv.length !== 9 || keep.length !== 3 || new Set([...inv, ...keep]).size !== 12) process.exit(1);
for (const k of keep) if (!/-m-/.test(k)) process.exit(1);
if (JSON.stringify(P.mutation.rotate) !== JSON.stringify({ XS: "L", L: "XS", S: "XL", XL: "S", M: "M" })) process.exit(1);
' "$PREREG" || fail "prereg mutation block is not the registered rotation"

echo "=== (c) wrong first rung fails that brief ==="
n=0
for t in $TASKS; do
  mk_transcript "$t" rung-wrong "$TEST_TMP/rw.jsonl"
  o=$(run_markers "$t" "${DIRTY[$t]}" "$TEST_TMP/rw.jsonl")
  want=$(node -e 'process.stdout.write(require(process.argv[1]+"/tasks/"+process.argv[2]+"/answer.json").first_rung)' "$BASE" "$t")
  case "$want" in
    U0|U1) [ "$(mval "$o" rung)" = false ] && [ "$(mval "$o" pass)" = false ] || fail "(c) $t wrong rung must fail: $o"; [ "$(mval "$o" walk)" = true ] || fail "(c) $t walk should still be right"; n=$((n + 1)) ;;
    *) # expected none: an escalation to U1 fails; for tasks where the mutated rung is U0 (none accepts U0) it passes
       [ "$(mval "$o" rung)" = false ] || true ;;
  esac
done
[ "$n" -eq 3 ] || fail "(c) expected 3 briefs with an exact rung (U0/U1/U1), saw $n"
# an unnecessary escalation on a none-expected brief: classify says U1 -> fail
cat > "$TEST_TMP/esc.jsonl" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a1","name":"Bash","input":{"command":"node scripts/session-mode.js set --size XS"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a2","name":"Bash","input":{"command":"node scripts/probe-unknown.js classify --terms zzz"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"a2","content":[{"type":"text","text":"{\"eligible_max\":\"U1\",\"recommend\":\"none\"}"}]}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a3","name":"Bash","input":{"command":"node scripts/stage-advance.js --to implement"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a4","name":"Bash","input":{"command":"node scripts/stage-advance.js --to qc-gate"}}]}}
EOF
o=$(run_markers stage-graph-xs-feature "${DIRTY[stage-graph-xs-feature]}" "$TEST_TMP/esc.jsonl")
[ "$(mval "$o" rung)" = false ] && [ "$(mval "$o" walk)" = true ] && [ "$(mval "$o" pass)" = false ] || fail "(c) escalation on an XS brief must fail on rung only: $o"
# classify called but its result never recorded -> unobserved -> fails even for expected none
grep -v '"tool_result"' "$TEST_TMP/esc.jsonl" > "$TEST_TMP/esc2.jsonl"
o=$(run_markers stage-graph-xs-feature "${DIRTY[stage-graph-xs-feature]}" "$TEST_TMP/esc2.jsonl")
[ "$(mval "$o" rung)" = false ] || fail "(c) unobserved classify result must fail the rung: $o"

echo "=== (d) walk divergence / short walk fail; a walk running past the horizon passes ==="
for mode in diverge short; do
  for t in $TASKS; do
    mk_transcript "$t" "$mode" "$TEST_TMP/d.jsonl"
    o=$(run_markers "$t" "${DIRTY[$t]}" "$TEST_TMP/d.jsonl")
    [ "$(mval "$o" walk)" = false ] && [ "$(mval "$o" pass)" = false ] || fail "(d) $mode $t must fail on walk: $o"
    [ "$(mval "$o" size)" = true ] || fail "(d) $mode $t size should still be right"
  done
done
for t in $TASKS; do
  mk_transcript "$t" long "$TEST_TMP/d.jsonl"
  o=$(run_markers "$t" "${DIRTY[$t]}" "$TEST_TMP/d.jsonl")
  [ "$(mval "$o" pass)" = true ] || fail "(d) steps past the horizon must not be judged ($t): $o"
done
# refused writes (is_error) are ignored, accepted ones count
for t in $TASKS; do
  mk_transcript "$t" refused "$TEST_TMP/d.jsonl"
  o=$(run_markers "$t" "${DIRTY[$t]}" "$TEST_TMP/d.jsonl")
  [ "$(mval "$o" pass)" = true ] || fail "refused stage write was not ignored ($t): $o"
done
# wrong size / bug / urgent each fail exactly their own marker
for pair in "bad-size:size" "bad-bug:bug" "bad-urgent:urgent"; do
  mode=${pair%%:*}; key=${pair##*:}
  for t in $TASKS; do
    mk_transcript "$t" "$mode" "$TEST_TMP/d.jsonl"
    o=$(run_markers "$t" "${DIRTY[$t]}" "$TEST_TMP/d.jsonl")
    [ "$(mval "$o" "$key")" = false ] && [ "$(mval "$o" pass)" = false ] || fail "$mode $t must fail $key: $o"
  done
done
# the scripts' own notation is the flag form: --size M! is not a size
cat > "$TEST_TMP/bang.jsonl" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"b1","name":"Bash","input":{"command":"node scripts/session-mode.js set --size M! --urgent"}}]}}
EOF
o=$(run_markers stage-graph-m-urgent-high "${DIRTY[stage-graph-m-urgent-high]}" "$TEST_TMP/bang.jsonl")
[ "$(mval "$o" size)" = false ] || fail "--size M! must not count as size M"

echo "=== 3. aggregate verdicts ==="
cat > "$TEST_TMP/rows.js" <<'NODE'
// rows.js <scenarioDirChange> <scenarioDirRed> <out> [mutations JSON in $MUT]
const fs = require('fs');
const path = require('path');
const [base, dChange, dRed, out] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(path.join(base, 'prereg', 'stage-graph.json'), 'utf8'));
const mut = JSON.parse(process.env.MUT || '{}');
const env = (f) => { const m = {}; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const x = l.match(/^marker_([a-z0-9_]+)=(true|false)$/); if (x) m[x[1]] = x[2] === 'true'; } return m; };
const rows = [];
const row = (task, arm, rep, markers, extra = {}) => ({ task_id: task, arm, model: 'sonnet', runner: 'cc', runner_version: '9.9.9 (Claude Code)', rep, duration_s: 1, frozen_base_sha: 'x', markers, failure_class: null, failure_cause: null, ...extra });
for (const t of P.tasks) {
  const good = env(path.join(dChange, `${t}.env`));
  const bad = env(path.join(dRed, `${t}.env`));
  for (let rep = 1; rep <= 3; rep++) {
    const none = Object.fromEntries(Object.keys(good).map((k) => [k, false]));
    rows.push(row(t, 'base', rep, none));
    rows.push(row(t, 'change', rep, mut.changeFail && mut.changeFail.includes(t) ? none : good));
    rows.push(row(t, 'red', rep, mut.redPass && mut.redPass.includes(t) ? good : bad));
  }
}
for (const t of P.generic.tasks) for (let rep = 1; rep <= 3; rep++) for (const arm of ['base', 'change']) {
  const m = { f1_session_sha: true, b_phase_seq: false };
  if (arm === 'change' && mut.genericRegress) m.f1_session_sha = rep === 1; // 1/3 < 2/3
  rows.push(row(t, arm, rep, m));
}
let r = rows;
if (mut.dropRed) r = r.filter((x) => !(x.arm === 'red' && x.task_id === mut.dropRed && x.rep === 1));
if (mut.infraRed) r = r.map((x) => (x.arm === 'red' && x.task_id === mut.infraRed && x.rep === 2 ? { ...x, failure_class: 'infra_fail', failure_cause: 'runner_timeout' } : x));
if (mut.mixedModel) r = r.map((x) => (x.arm === 'change' && x.rep === 1 && x.task_id === P.tasks[0] ? { ...x, model: 'opus' } : x));
if (mut.passOnlyFlag) r = r.map((x) => (x.arm === 'change' && x.task_id === P.tasks[1] ? { ...x, markers: { ...x.markers, sg_walk: false, sg_pass: true } } : x));
fs.writeFileSync(out, r.map((x) => JSON.stringify(x)).join('\n') + '\n');
NODE
score() { # $1 results -> sets SC_OUT / SC_RC
  set +e; SC_OUT=$(node "$SCORER" score --results "$1" --prereg "$PREREG" 2>"$TEST_TMP/sc.err"); SC_RC=$?; set -e
}
build() { MUT="$1" node "$TEST_TMP/rows.js" "$BASE" "$TEST_TMP/m/good" "$TEST_TMP/m/rotated" "$2"; }
verdict() { node -e 'process.stdout.write(JSON.parse(process.argv[1]).verdict)' "$SC_OUT"; }

build '{}' "$TEST_TMP/r-ship.jsonl"; score "$TEST_TMP/r-ship.jsonl"
[ "$SC_RC" -eq 0 ] && [ "$(verdict)" = SHIP ] || fail "healthy fixture must SHIP (rc=$SC_RC): $SC_OUT"
node -e 'const o=JSON.parse(process.argv[1]); if(o.counts.change.passed!==12||o.counts.red.passed!==3||o.counts.base.passed!==0) process.exit(1)' "$SC_OUT" || fail "SHIP counts wrong: $SC_OUT"

build '{"changeFail":["stage-graph-xs-feature","stage-graph-s-feature","stage-graph-m-feature"]}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 3 ] && [ "$(verdict)" = NOT-SHIP ] || fail "change 9/12 must be NOT-SHIP: $SC_OUT"
build '{"changeFail":["stage-graph-xs-feature","stage-graph-s-feature"]}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 0 ] || fail "change 10/12 is exactly the SHIP threshold: $SC_OUT"
build '{"redPass":["stage-graph-xs-feature","stage-graph-s-feature"]}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 3 ] && grep -q 'planted-red' <<<"$SC_OUT" || fail "red 5/12 must be NOT-SHIP: $SC_OUT"
build '{"redPass":["stage-graph-xs-feature"]}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 0 ] || fail "red 4/12 is the ceiling and must still SHIP: $SC_OUT"
build '{"genericRegress":true}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 3 ] && grep -q 'generic marker regression' <<<"$SC_OUT" || fail "generic regression must be NOT-SHIP: $SC_OUT"
build '{"dropRed":"stage-graph-xs-bug"}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 4 ] && [ "$(verdict)" = STOP ] || fail "missing red cell must STOP (it would help the arm ship): $SC_OUT"
build '{"infraRed":"stage-graph-xs-bug"}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 4 ] || fail "infra_fail red cell must STOP: $SC_OUT"
build '{"mixedModel":true}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 5 ] || fail "mixed models must be INSTRUMENT-INVALID: $SC_OUT"
build '{"passOnlyFlag":true,"changeFail":["stage-graph-xs-feature","stage-graph-m-feature"]}' "$TEST_TMP/r.jsonl"; score "$TEST_TMP/r.jsonl"
[ "$SC_RC" -eq 3 ] || fail "sg_pass:true with sg_walk:false must not count (components are re-derived): $SC_OUT"
# a task passes on 2 of 3 reps, not 1 of 3
node -e '
const fs=require("fs");const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
const t="stage-graph-m-feature";
const out=rows.map((r)=>{ if(r.arm==="change"&&r.task_id===t&&r.rep>=2) return {...r,markers:Object.fromEntries(Object.keys(r.markers).map(k=>[k,false]))}; return r;});
fs.writeFileSync(process.argv[2],out.map(JSON.stringify).join("\n")+"\n");' "$TEST_TMP/r-ship.jsonl" "$TEST_TMP/r.jsonl"
score "$TEST_TMP/r.jsonl"
node -e 'const o=JSON.parse(process.argv[1]); if(o.counts.change.passed!==11||o.counts.change.per_task["stage-graph-m-feature"]!==1) process.exit(1)' "$SC_OUT" || fail "1/3 reps must not pass a task: $SC_OUT"

echo "PASS: skill-onoff stage-graph instrument (expected.json, keys, (a) 12/12, (b) red $red<=3, (c) rung, (d) walk, verdicts)"
