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
#   5. amend-3-extractor (prereg/stage-graph.amend-3-extractor.json): loop/variable targets from JSON, hidden stdout = ambiguous,
#      multi-JSON classify; fixtures are excerpts of the retained v2 cell transcripts (hooks/tests/fixtures/stage-graph/amend3/)
#   4. amend-2-instrument (prereg/stage-graph.amend-2-instrument.json): chained stage-advance outcome per invocation,
#      rung consistency (pass + fail cases), l-u0-known brief reachability (real probe -> U0)
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
// amend-2-instrument: a consistency brief (U0 key) is judged on the agent's terms, so the U0 transcript passes terms that hit the repo
if (rung) use(`node scripts/probe-unknown.js classify --ledger /tmp/l.jsonl --terms ${ans.first_rung === 'U0' ? 'scheduler,retry' : 'alpha,beta'}`, JSON.stringify({ artifact_type: 'unknown_probe', eligible_max: rung, recommend: rung === 'U1' ? 'none' : 'U0' }));
else if (task.endsWith('l-feature')) use('node scripts/probe-unknown.js classify --terms notes', JSON.stringify({ eligible_max: 'U0', recommend: 'U0' }));
for (let i = 0; i < walk.length; i++) {
  if (mode === 'refused' && i === 1) use(`node scripts/stage-advance.js --to ${walk[i] === 'verify' ? 'qc-gate' : 'finish'}`, '{"allowed":false}', true); // refused write: must be ignored
  use(`node scripts/stage-advance.js --to ${walk[i]}${i % 3 === 1 ? ' --unit phase:1/1:x' : ''}`, JSON.stringify({ allowed: true, to: walk[i] })); // amend-3: the written node is read from the invocation's own JSON
  if (i === 0) use(`node scripts/stage-advance.js --to ${walk[i]} --review-families a,b`, JSON.stringify({ allowed: true, to: walk[i] })); // same-node update: collapsed
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
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"a3","content":[{"type":"text","text":"{\"allowed\":true,\"to\":\"implement\"}"}]}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a4","name":"Bash","input":{"command":"node scripts/stage-advance.js --to qc-gate"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"a4","content":[{"type":"text","text":"{\"allowed\":true,\"to\":\"qc-gate\"}"}]}]}}
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

echo "=== 4. amend-2-instrument: chained stage-advance outcome (fix 2), rung consistency (fix 3), brief reachability ==="
AMEND="$BASE/prereg/stage-graph.amend-2-instrument.json"
CELL="$BASE/lib/stage-graph-cell.js"
cellj() { # $1 task $2 transcript [$3 repo] -> JSON (observed + judged)
  local extra=(); [ -z "${3:-}" ] || extra=(--repo "$3" --base-sha "$(git -C "$3" rev-list --max-parents=0 HEAD | head -1)")
  node "$CELL" --task "$1" --transcript "$2" --work-done true --expected "$EXPECTED" --tasks-dir "$BASE/tasks" "${extra[@]+"${extra[@]}"}"
}
jq1() { node -e 'const o=JSON.parse(process.argv[1]);let v=o;for(const k of process.argv[2].split("."))v=v==null?v:v[k];process.stdout.write(JSON.stringify(v))' "$1" "$2"; }
# mkt <out> <js expression yielding the spec array>; the expression sees SET W D (stage-advance outputs) CLS(terms)
SET='node scripts/session-mode.js set --size XS'
W='{"allowed":true,"from":"implement","to":"qc-gate","marker_path":"/m","stage":"qc-gate"}'
D='{"allowed":false,"from":"implement","to":"finish","legal_next":["qc-gate"],"reason":"x"}'
OKJ='{"ok":true,"marker_path":"/m","size":"XS"}'
mkt() { SET="$SET" W="$W" D="$D" OKJ="$OKJ" node -e '
const { SET, W, D, OKJ, SETM, SETW } = process.env;
const CLS = (t) => `node scripts/probe-unknown.js classify --ledger /tmp/l.jsonl --terms ${t}`;
const ADV = (n) => `node scripts/stage-advance.js --to ${n}`;
const spec = eval(process.argv[2]);
// amend-3: a stage-advance result is read by the node it names, so the W / D templates are re-targeted to each `--to <node>` of the command, in order
const retarget = (cmd, res) => {
  if (typeof res !== "string") return res;
  const tos = [...cmd.matchAll(/--to ([a-z-]+)/g)].map((m) => m[1]);
  let k = 0;
  return res.split("\n").map((ln) => ((ln.startsWith(W) || ln.startsWith(D)) && tos[k] ? ln.replace(/"to":"[a-z-]+"/, `"to":"${tos[k++]}"`) : ln)).join("\n");
};
require("fs").writeFileSync(process.argv[1], spec.map(([cmd, res0, err], i) => {
  const res = retarget(cmd, res0);
  const id = `t${i}`;
  const a = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: cmd } }] } });
  return res === null ? a : `${a}\n${JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: !!err, content: res }] } })}`;
}).join("\n") + "\n");' "$1" "$2"; }

# chained success + red test: the advance WAS written although the call is_error -> counted (the v1 defect)
mkt "$TEST_TMP/c1.jsonl" '[[SET, OKJ, false], [ADV("implement") + " && bash run-tests.sh", W + "\nFAIL: stage one\n", true], [ADV("qc-gate"), W, false]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/c1.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["implement","qc-gate"]' ] || fail "fix2: chained success + red test must count the advance: $o"
[ "$(jq1 "$o" observed.stage_calls.0.basis)" = '"json"' ] && [ "$(jq1 "$o" observed.ambiguous)" = false ] || fail "fix2: outcome must be attributed from JSON: $o"
# genuine exit 3 (denied) in a chained call: refused, a later written advance still counts
mkt "$TEST_TMP/c2.jsonl" '[[SET, OKJ, false], [ADV("finish") + " && bash run-tests.sh", D, true], [ADV("implement"), W, false]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/c2.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["implement"]' ] && [ "$(jq1 "$o" observed.stage_calls.0.written)" = false ] || fail "fix2: a genuine exit-3 refusal must stay refused: $o"
# two invocations in one call, first denied, second written: attributed one by one
mkt "$TEST_TMP/c3.jsonl" '[[SET, OKJ, false], [ADV("finish") + "; " + ADV("implement"), D + "\n" + W, true]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/c3.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["implement"]' ] && [ "$(jq1 "$o" observed.ambiguous)" = false ] || fail "fix2: per-invocation attribution inside one call: $o"
# no stage-advance JSON visible (amend-3-extractor, defect 2): the invocations are ambiguous and are NOT written, whatever the call's is_error
mkt "$TEST_TMP/c4.jsonl" '[[SET, OKJ, false], [ADV("implement") + " && bash run-tests.sh", "FAIL: red\n", true], [ADV("qc-gate"), "ok", false]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/c4.jsonl")
[ "$(jq1 "$o" observed.walk)" = '[]' ] && [ "$(jq1 "$o" observed.ambiguous)" = true ] && [ "$(jq1 "$o" observed.stage_calls.0.basis)" = '"unattributable"' ] || fail "fix2+amend3: an invocation with no visible JSON must be ambiguous and not written: $o"
# a bump-required output ({bump_to}, exit 4) wrote nothing
mkt "$TEST_TMP/c5.jsonl" '[[SET, OKJ, false], [ADV("implement"), JSON.stringify({ bump_to: "S", files: 9, lines: 99 }), true]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/c5.jsonl")
[ "$(jq1 "$o" observed.walk)" = '[]' ] || fail "fix2: {bump_to} is a refusal: $o"

# ── fix 3: rung consistency (l-feature none, l-u0-known U0, xl none) ──
UR="${DIRTY[stage-graph-l-u0-known]}"; LR="${DIRTY[stage-graph-l-feature]}"
rungof() { jq1 "$1" judged.rung; }
# pass: honest classify at intent, every term present in the repo -> U0
mkt "$TEST_TMP/r1.jsonl" '[[SET, OKJ, false], [CLS("scheduler,retry,queue"), "{\"eligible_max\":\"U0\"}", false], [ADV("intent"), "{\"allowed\":true}", false]]'
[ "$(rungof "$(cellj stage-graph-l-u0-known "$TEST_TMP/r1.jsonl" "$UR")")" = true ] || fail "fix3: U0 key, honest U0 at intent must pass"
# pass: the agent honestly named a NEW noun -> probe and transcript agree on U1: consistent
mkt "$TEST_TMP/r2.jsonl" '[[SET, OKJ, false], [CLS("scheduler,zzqx-new-thing"), "{\"eligible_max\":\"U1\"}", false]]'
o=$(cellj stage-graph-l-u0-known "$TEST_TMP/r2.jsonl" "$UR")
[ "$(rungof "$o")" = true ] && [ "$(jq1 "$o" observed.rung_check.derived)" = '"U1"' ] || fail "fix3: U1 reported for a zero-hit term is consistent: $o"
# FAIL: result says U0 although a term is zero-hit in the repo
mkt "$TEST_TMP/r3.jsonl" '[[SET, OKJ, false], [CLS("scheduler,zzqx-new-thing"), "{\"eligible_max\":\"U0\"}", false]]'
[ "$(rungof "$(cellj stage-graph-l-u0-known "$TEST_TMP/r3.jsonl" "$UR")")" = false ] || fail "fix3: U0 reported for a zero-hit term must fail"
# FAIL: result says U1 although every term hits
mkt "$TEST_TMP/r4.jsonl" '[[SET, OKJ, false], [CLS("scheduler,retry"), "{\"eligible_max\":\"U1\"}", false]]'
[ "$(rungof "$(cellj stage-graph-l-u0-known "$TEST_TMP/r4.jsonl" "$UR")")" = false ] || fail "fix3: U1 reported for all-hit terms must fail"
# FAIL: U0 key and classify never called
mkt "$TEST_TMP/r5.jsonl" '[[SET, OKJ, false], [ADV("intent"), "{\"allowed\":true}", false]]'
[ "$(rungof "$(cellj stage-graph-l-u0-known "$TEST_TMP/r5.jsonl" "$UR")")" = false ] || fail "fix3: U0 key needs a classify call"
# FAIL: U0 key, consistent classify but only AFTER the session moved past intent
mkt "$TEST_TMP/r6.jsonl" '[[SET, OKJ, false], [ADV("intent"), "{\"allowed\":true}", false], [ADV("proposal"), "{\"allowed\":true}", false], [CLS("scheduler,retry"), "{\"eligible_max\":\"U0\"}", false]]'
[ "$(rungof "$(cellj stage-graph-l-u0-known "$TEST_TMP/r6.jsonl" "$UR")")" = false ] || fail "fix3: U0 key needs classify at intent"
# none key (l-feature): no classify passes; an honest consistent U1 on a feature noun passes (the v1 R1 case); an inconsistent one fails
mkt "$TEST_TMP/n1.jsonl" '[[SET, OKJ, false]]'
[ "$(rungof "$(cellj stage-graph-l-feature "$TEST_TMP/n1.jsonl" "$LR")")" = true ] || fail "fix3: none key, no classify must pass"
mkt "$TEST_TMP/n2.jsonl" '[[SET, OKJ, false], [CLS("notes,zzqx-storage"), "{\"eligible_max\":\"U1\"}", false]]'
[ "$(rungof "$(cellj stage-graph-l-feature "$TEST_TMP/n2.jsonl" "$LR")")" = true ] || fail "fix3: none key, honest U1 on a new feature noun must pass"
mkt "$TEST_TMP/n3.jsonl" '[[SET, OKJ, false], [CLS("notes,zzqx-storage"), "{\"eligible_max\":\"U0\"}", false]]'
[ "$(rungof "$(cellj stage-graph-l-feature "$TEST_TMP/n3.jsonl" "$LR")")" = false ] || fail "fix3: none key, inconsistent classify must fail"
# un-derivable terms ($VAR) fall back to the pinned rule and say so
mkt "$TEST_TMP/n4.jsonl" '[[SET, OKJ, false], [CLS("\"$T\""), "{\"eligible_max\":\"U1\"}", false]]'
o=$(cellj stage-graph-l-feature "$TEST_TMP/n4.jsonl" "$LR")
[ "$(jq1 "$o" observed.rung_check.mode)" = '"pinned-fallback"' ] && [ "$(rungof "$o")" = false ] || fail "fix3: un-derivable terms use the pinned rule (U1 not accepted for a none key): $o"

# ── walk follows the consistent rung (coordinator decision): >= U1 -> research variant, U0/none -> noresearch ──
SETL='node scripts/session-mode.js set --size L'
U1T='scheduler,zzqx-new-thing'
walkj() { jq1 "$1" judged.walk; }
# U1-consistent agent that goes through research: pass (rung and walk)
mkt "$TEST_TMP/w1.jsonl" '[["'"$SETL"'", OKJ, false], [CLS("'"$U1T"'"), "{\"eligible_max\":\"U1\"}", false], [ADV("intent"), W, false], [ADV("research"), W, false], [ADV("proposal"), W, false], [ADV("plan"), W, false]]'
o=$(cellj stage-graph-l-u0-known "$TEST_TMP/w1.jsonl" "$UR")
[ "$(walkj "$o")" = true ] && [ "$(rungof "$o")" = true ] && [ "$(jq1 "$o" observed.walk_variant)" = '"research"' ] || fail "walk: U1-consistent agent through research must pass: $o"
# U1-consistent agent that skips research: walk fails
mkt "$TEST_TMP/w2.jsonl" '[["'"$SETL"'", OKJ, false], [CLS("'"$U1T"'"), "{\"eligible_max\":\"U1\"}", false], [ADV("intent"), W, false], [ADV("proposal"), W, false], [ADV("plan"), W, false]]'
o=$(cellj stage-graph-l-u0-known "$TEST_TMP/w2.jsonl" "$UR")
[ "$(walkj "$o")" = false ] && [ "$(rungof "$o")" = true ] || fail "walk: U1-consistent agent skipping research must fail the walk: $o"
# U0 agent that goes through research: walk fails
mkt "$TEST_TMP/w3.jsonl" '[["'"$SETL"'", OKJ, false], [CLS("scheduler,retry"), "{\"eligible_max\":\"U0\"}", false], [ADV("intent"), W, false], [ADV("research"), W, false], [ADV("proposal"), W, false], [ADV("plan"), W, false]]'
o=$(cellj stage-graph-l-u0-known "$TEST_TMP/w3.jsonl" "$UR")
[ "$(walkj "$o")" = false ] && [ "$(jq1 "$o" observed.walk_variant)" = '"key"' ] || fail "walk: U0 agent going through research must fail: $o"
# U0 agent on the noresearch walk, and a none-key agent with no classify: pass
mkt "$TEST_TMP/w4.jsonl" '[["'"$SETL"'", OKJ, false], [CLS("scheduler,retry"), "{\"eligible_max\":\"U0\"}", false], [ADV("intent"), W, false], [ADV("proposal"), W, false], [ADV("plan"), W, false]]'
[ "$(walkj "$(cellj stage-graph-l-u0-known "$TEST_TMP/w4.jsonl" "$UR")")" = true ] || fail "walk: U0 agent on the noresearch walk must pass"
mkt "$TEST_TMP/w5.jsonl" '[["'"$SETL"'", OKJ, false], [ADV("intent"), W, false], [ADV("proposal"), W, false], [ADV("plan"), W, false]]'
[ "$(walkj "$(cellj stage-graph-l-feature "$TEST_TMP/w5.jsonl" "$LR")")" = true ] || fail "walk: none-key agent without classify keeps the noresearch walk"
# an INCONSISTENT classify (U1 claimed for all-hit terms) does not buy the research variant
mkt "$TEST_TMP/w6.jsonl" '[["'"$SETL"'", OKJ, false], [CLS("scheduler,retry"), "{\"eligible_max\":\"U1\"}", false], [ADV("intent"), W, false], [ADV("research"), W, false], [ADV("proposal"), W, false], [ADV("plan"), W, false]]'
o=$(cellj stage-graph-l-u0-known "$TEST_TMP/w6.jsonl" "$UR")
[ "$(walkj "$o")" = false ] && [ "$(rungof "$o")" = false ] || fail "walk: inconsistent U1 must not select the research variant: $o"
# pinned tasks keep their pinned walk: no research variant is even loaded for them
node -e 'const c=require(process.argv[1]);const k=c.loadKey("stage-graph-m-feature",process.argv[2],process.argv[3]);if(k.researchCell!==null)process.exit(1)' "$CELL" "$BASE/tasks" "$EXPECTED" || fail "walk: pinned task must have no research variant"

# ── session-mode set: per-invocation outcome (same attribution as stage-advance) ──
SETM='node scripts/session-mode.js set --size M --bug'
SETW='{"ok":true,"marker_path":"/m","size":"M","bug":true}'
export SETM SETW
# chained success + failing follow-up command (call is_error, the set WAS written): counted
mkt "$TEST_TMP/s1.jsonl" '[[SETM + " && bash run-tests.sh", SETW + "\nFAIL: red\n", true]]'
o=$(cellj stage-graph-m-bug "$TEST_TMP/s1.jsonl")
[ "$(jq1 "$o" observed.set.size)" = '"M"' ] && [ "$(jq1 "$o" observed.set.bug)" = true ] && [ "$(jq1 "$o" observed.ambiguous)" = false ] && [ "$(jq1 "$o" observed.set_outcomes.0.basis)" = '"json"' ] || fail "set: chained success + failing command must count the size: $o"
# a failed set (no stdout JSON, is_error): not recorded; ambiguous -> old rule
mkt "$TEST_TMP/s2.jsonl" '[[SETM, "session-mode: bad flag", true]]'
o=$(cellj stage-graph-m-bug "$TEST_TMP/s2.jsonl")
[ "$(jq1 "$o" observed.set)" = null ] && [ "$(jq1 "$o" observed.ambiguous)" = true ] || fail "set: a failed set must not be recorded: $o"
# ambiguous success (no JSON, not an error): old rule counts it
mkt "$TEST_TMP/s3.jsonl" '[[SETM, "done", false]]'
o=$(cellj stage-graph-m-bug "$TEST_TMP/s3.jsonl")
[ "$(jq1 "$o" observed.set.size)" = '"M"' ] && [ "$(jq1 "$o" observed.ambiguous)" = true ] || fail "set: ambiguous call falls back to the old rule and is flagged: $o"
# a second session-mode call in the same command (alignment by count): get + set both print ok-objects -> still attributed
mkt "$TEST_TMP/s4.jsonl" '[["node scripts/session-mode.js get && " + SETM + " && bash run-tests.sh", SETW + "\n" + SETW + "\nFAIL\n", true]]'
o=$(cellj stage-graph-m-bug "$TEST_TMP/s4.jsonl")
[ "$(jq1 "$o" observed.set.size)" = '"M"' ] && [ "$(jq1 "$o" observed.ambiguous)" = false ] || fail "set: per-invocation alignment across subcommands: $o"

# the amendment record: amendment 2, v1 not re-scored, its task list == the code's, thresholds untouched
node -e '
const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const c = require(process.argv[2]);
const want = [...c.RUNG_CONSISTENCY_TASKS].sort().join(",");
if (a.amendment !== 2 || a.v1_rescored !== false || a.made_after_v1_results_seen !== true) process.exit(1);
if ([...a.fixes.rung_keys.applies_to].sort().join(",") !== want) process.exit(2);
if (JSON.stringify(a.thresholds_unchanged) !== JSON.stringify(require(process.argv[3]).thresholds)) process.exit(3);
' "$AMEND" "$CELL" "$PREREG" || fail "amend-2-instrument.json invariants (rc=$?): amendment 2, v1 not re-scored, task list == RUNG_CONSISTENCY_TASKS, thresholds unchanged"

# l-u0-known reachability: every noun the brief rests on exists in the fixture repo, the old new-flag tokens are gone, and the REAL probe
# returns U0 for them (v1: the brief's own flag names were zero-hit, so classify could never yield U0)
BR="$BASE/tasks/stage-graph-l-u0-known/task.md"
for tok in 'max-attempts' 'delay-ms' 'delay-cap-ms' 'doubling' 'configurable cap' '--'; do if grep -qF -- "$tok" "$BR"; then fail "l-u0-known brief still names a thing that does not exist: $tok"; fi; done
NOUNS=scheduler,retry,queue,attempts,delay,backoff,policy,runner
for n in ${NOUNS//,/ }; do grep -qi -- "$n" "$BR" || fail "l-u0-known brief should still speak of $n"; done
real=$(cd "$UR" && HOME="$TEST_TMP/home" node "$REPO_ROOT/scripts/probe-unknown.js" classify --ledger "$TEST_TMP/u0-ledger.jsonl" --terms "$NOUNS" 2>/dev/null) || fail "real classify on l-u0-known failed"
[ "$(jq1 "$real" eligible_max)" = '"U0"' ] || fail "l-u0-known: the brief's nouns must classify U0 on the fixture repo: $real"

echo "=== 5. amend-3-extractor: loop/variable targets (d1), hidden stdout = ambiguous (d2), multi-JSON classify (d3) ==="
AMEND3="$BASE/prereg/stage-graph.amend-3-extractor.json"
FX="$REPO_ROOT/hooks/tests/fixtures/stage-graph/amend3"
[ -f "$AMEND3" ] || fail "amend-3-extractor.json missing"
node -e '
const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (a.amendment !== 3 || a.v1_rescored !== false || a.v2_rescored !== false || a.made_after_v1_results_seen !== true || a.made_after_v2_results_seen !== true) process.exit(1);
for (const k of ["loop_variable_target", "hidden_stdout_ambiguous", "multi_json_classify"]) { const f = a.fixes[k]; if (!f || !f.transcript_excerpt || !f.fixture || !f.change) process.exit(2); }
if (JSON.stringify(a.thresholds_unchanged) !== JSON.stringify(require(process.argv[2]).thresholds)) process.exit(3);
' "$AMEND3" "$PREREG" || fail "amend-3-extractor.json invariants (rc=$?): amendment 3, v1+v2 not re-scored, 3 defects each with excerpt+fixture+change, thresholds unchanged"
# the OLD extractor (the commit before amend-3) on the same real excerpts: shows each defect is real
OLD_BASE_COMMIT=6aef17dc
OLDLIB="$TEST_TMP/oldlib"; mkdir -p "$OLDLIB"
cp "$BASE/lib/transcript-query.js" "$OLDLIB/"
HAVE_OLD=1
git -C "$REPO_ROOT" show "$OLD_BASE_COMMIT:evals/skill-onoff/lib/stage-graph-cell.js" > "$OLDLIB/stage-graph-cell.js" 2>/dev/null || HAVE_OLD=0
oldj() { node -e '
const { extract } = require(process.argv[1]); const o = extract(process.argv[2], null);
process.stdout.write(JSON.stringify({ observed: o }));' "$OLDLIB/stage-graph-cell.js" "$1"; }

# d1: `for n in verify code-review qc-gate; do ... --to $n | head -c 150` (m-feature r2): every written node, in order
o=$(cellj stage-graph-m-feature "$FX/d1-loop-var-m-feature-r2.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["plan","implement","verify","code-review","qc-gate"]' ] || fail "d1: loop over \$n must yield each written node in order: $o"
[ "$(jq1 "$o" observed.stage_calls.0.outcome)" = '"refused"' ] || fail "d1: the exit-3 intent refusal must stay refused: $o"
[ "$HAVE_OLD" = 0 ] || [ "$(jq1 "$(oldj "$FX/d1-loop-var-m-feature-r2.jsonl")" observed.walk)" = '["plan","implement"]' ] || fail "d1: old extractor expected to drop the loop nodes"
# d1 (xl r2): truncated records (head -c 200), loop over intent proposal plan
o=$(cellj stage-graph-xl-deliverable "$FX/d1-loop-var-xl-r2.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["intent","proposal","plan"]' ] || fail "d1: truncated loop output still names allowed+to: $o"
# synthetic: a loop that advances nodes, each record fully visible
mkt "$TEST_TMP/d1s.jsonl" '[[SET, OKJ, false], ["for n in plan implement; do node scripts/stage-advance.js --to $n; done", "{\"allowed\":true,\"from\":null,\"to\":\"plan\",\"stage\":\"plan\"}\n{\"allowed\":true,\"from\":\"plan\",\"to\":\"implement\",\"stage\":\"implement\"}", false], ["node scripts/stage-advance.js --to $NEXT", "{\"allowed\":true,\"from\":\"implement\",\"to\":\"verify\",\"stage\":\"verify\"}", false]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/d1s.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["plan","implement","verify"]' ] || fail "d1: loop + a bare --to \$VAR both read from JSON: $o"
# a loop whose second iteration is refused: that node is not written
mkt "$TEST_TMP/d1r.jsonl" '[[SET, OKJ, false], ["for n in plan verify; do node scripts/stage-advance.js --to $n; done", "{\"allowed\":true,\"from\":null,\"to\":\"plan\"}\n{\"allowed\":false,\"from\":\"plan\",\"to\":\"verify\",\"legal_next\":[\"implement\"]}", true]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/d1r.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["plan"]' ] && [ "$(jq1 "$o" observed.stage_calls.1.outcome)" = '"refused"' ] || fail "d1: refused loop iteration must not be written: $o"

# d2: stdout hidden (>/dev/null): not written, ambiguous, not in the walk
o=$(cellj stage-graph-m-feature "$FX/d2-devnull-m-feature-r3.jsonl")
[ "$(jq1 "$o" observed.walk)" = '[]' ] && [ "$(jq1 "$o" observed.ambiguous)" = true ] && [ "$(jq1 "$o" observed.stage_calls.0.outcome)" = '"ambiguous"' ] || fail "d2: hidden-stdout loop must be ambiguous, not written: $o"
[ "$(jq1 "$o" judged.walk)" = false ] || fail "d2: ambiguous nodes must not count as a matched walk: $o"
o=$(cellj stage-graph-xs-bug "$FX/d2-devnull-xs-bug-r1.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["diagnose"]' ] || fail "d2: xs-bug r1 (--to implement >/dev/null && ...; --to verify >/dev/null; verify is an exit-3 node) must not count implement/verify: $o"
[ "$HAVE_OLD" = 0 ] || [ "$(jq1 "$(oldj "$FX/d2-devnull-xs-bug-r1.jsonl")" observed.walk)" = '["diagnose","implement","verify"]' ] || fail "d2: old extractor expected to count the refused verify as written"
# a visible refusal next to a hidden one: only visible JSON attributed; hidden stays ambiguous
mkt "$TEST_TMP/d2s.jsonl" '[[SET, OKJ, false], ["node scripts/stage-advance.js --to implement >/dev/null 2>&1; node scripts/stage-advance.js --to qc-gate", "{\"allowed\":true,\"from\":\"implement\",\"to\":\"qc-gate\"}", false]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/d2s.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["qc-gate"]' ] && [ "$(jq1 "$o" observed.stage_calls.0.outcome)" = '"ambiguous"' ] || fail "d2: hidden + visible in one call: $o"
# 2>/dev/null hides stderr only; stdout JSON stays visible and attributable
mkt "$TEST_TMP/d2e.jsonl" '[[SET, OKJ, false], ["node scripts/stage-advance.js --to qc-gate 2>/dev/null", W, false]]'
o=$(cellj stage-graph-xs-feature "$TEST_TMP/d2e.jsonl")
[ "$(jq1 "$o" observed.walk)" = '["qc-gate"]' ] && [ "$(jq1 "$o" observed.ambiguous)" = false ] || fail "d2: 2>/dev/null leaves stdout visible: $o"

# d3: classify result with other JSON objects in the same stdout
o=$(cellj stage-graph-l-research-a "$FX/d3-multijson-research-a-r1.jsonl")
[ "$(jq1 "$o" observed.rung)" = '"U1"' ] || fail "d3: classify after a chained stage-advance object must read U1: $o"
[ "$HAVE_OLD" = 0 ] || [ "$(jq1 "$(oldj "$FX/d3-multijson-research-a-r1.jsonl")" observed.rung)" = '"unobserved"' ] || fail "d3: old extractor expected unobserved"
o=$(cellj stage-graph-l-feature "$FX/d3-multijson-l-feature-r3.jsonl")
[ "$(jq1 "$o" observed.rung)" = '"U1"' ] || fail "d3: l-feature r3 classify with a leading ls line and stage-advance object: $o"
[ "$HAVE_OLD" = 0 ] || [ "$(jq1 "$(oldj "$FX/d3-multijson-l-feature-r3.jsonl")" observed.rung)" = '"unobserved"' ] || fail "d3: old extractor expected unobserved (l-feature r3)"
# truncated classify object (head -c) still names eligible_max
mkt "$TEST_TMP/d3t.jsonl" '[[SET, OKJ, false], [CLS("scheduler,retry") + " | head -c 120", "{\"schema_version\":1,\"artifact_type\":\"unknown_probe\",\"eligible_max\":\"U0\",\"signals\":[{\"id\":\"S4\",\"va", false]]'
o=$(cellj stage-graph-l-u0-known "$TEST_TMP/d3t.jsonl")
[ "$(jq1 "$o" observed.rung)" = '"U0"' ] || fail "d3: truncated classify output read by its eligible_max: $o"

echo "PASS: amend-3 extractor (loop/variable targets, hidden stdout ambiguous, multi-JSON classify)"

echo "PASS: skill-onoff stage-graph instrument (expected.json, keys, (a) 12/12, (b) red $red<=3, (c) rung, (d) walk, verdicts, amend-2 chained advance + rung consistency + brief reachability)"
