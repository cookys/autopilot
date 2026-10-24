#!/usr/bin/env bash
# hooks/tests/p2-batch-wrapper.test.sh - BL-0055 phase 2, wrapper v2 (evals/orchestration/run-p2-batch.js): NC5 and NC8,
# plus the selfcheck, the seeded order and the cost stop rule. No model call: a fake `claude` (fixtures/p2-fake-claude.sh)
# stands in for the CLI, the real harness and the real hook run against it in a throwaway git clone.
# Negative controls (evidence-discipline section 58): each check below must hold for the real wrapper and FAIL for a mutant
# of it. The mutation tool fails when its pattern matches nothing, so there is no no-op mutant.
#   NC5: --audit stubbed to return no failures -> the "exit non-zero" assertion fails for each of three corrupted runs.
#   NC8: post-batch listing removed -> the "TASKHASH_DIFF post fail" assertion fails (the audit still catches the absent
#        taskhash.post.txt on its own, so its own non-zero assertion stays green: defence in depth, not a second red).
#   selfcheck: a writer call removed -> --selfcheck exits non-zero.
# RED at develop 1ce92330d: the wrapper did not exist (node: Cannot find module run-p2-batch.js).
. "$(dirname "$0")/lib.sh"

WRAP_SRC="$REPO_ROOT/evals/orchestration/run-p2-batch.js"
FAKE="$HOOKS_DIR/tests/fixtures/p2-fake-claude.sh"
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"; cp "$FAKE" "$BIN/claude"; chmod +x "$BIN/claude"
FHOME="$TEST_TMP/home"; mkdir -p "$FHOME/.claude"; echo '{}' >"$FHOME/.claude/.credentials.json"

mutate() { # <file> <old> <new>: fails when <old> is absent
  python3 - "$1" "$2" "$3" <<'PY' || return 1
import sys
p, old, new = sys.argv[1:4]
f = open(p).read()
if old not in f:
    sys.stderr.write('mutant pattern matched nothing: ' + old + '\n'); raise SystemExit(1)
open(p, 'w').write(f.replace(old, new, 1))
PY
}

# Throwaway clone with the pieces the harness and the hook need, one commit holding the preregistration files.
CLONE="$TEST_TMP/clone"; mkdir -p "$CLONE/hooks" "$CLONE/scripts" "$CLONE/prereg"
cp -a "$REPO_ROOT/evals" "$CLONE/evals"; rm -rf "$CLONE/evals/orchestration/runs"
cp "$REPO_ROOT/hooks/per-turn-gate.js" "$CLONE/hooks/"; cp -a "$REPO_ROOT/hooks/_shared" "$CLONE/hooks/_shared"
cp -a "$REPO_ROOT/scripts/lib" "$CLONE/scripts/lib"; cp "$REPO_ROOT/scripts/adjudicate-findings.js" "$CLONE/scripts/"
TASKDIR="$CLONE/evals/orchestration/tasks/t14-constraint-horizon"
node -e 'const w=require(process.argv[1]);require("fs").writeFileSync(process.argv[3],w.taskListing(process.argv[2]))' "$WRAP_SRC" "$TASKDIR" "$CLONE/prereg/taskhash.expected.txt"
echo "preregistration stand-in" >"$CLONE/prereg/PREREG.md"
git -C "$CLONE" init -q; git -C "$CLONE" config user.name t; git -C "$CLONE" config user.email t@example.com; git -C "$CLONE" config commit.gpgsign false
make_manifest() { # <wrapper> <out>
  node - "$1" "$2" "$CLONE" "$WRAP_SRC" <<'JS'
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const [wrapper, out, clone, src] = process.argv.slice(2);
const w = require(src);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const m = { task: 't14-constraint-horizon', model: process.env.MAN_MODEL || 'claude-haiku-4-5', cli: '2.1.309 (Claude Code)', seed: 'unit-test-seed', n_per_arm: 3,
  arms: { ON: { gate: 'hook', cap: 30 }, C: { gate: 'observe', cap: 18 } }, probe_cost: 0.0166, window_s: Number(process.env.MAN_WINDOW || 28800), min_complete: 2, max_blocks: 2,
  prereg: 'prereg/PREREG.md', taskhash_expected: 'prereg/taskhash.expected.txt', hook_path: 'hooks/per-turn-gate.js',
  harness_path: 'evals/orchestration/run-orchestration-eval.sh', argv_sha: {},
  hashes: { wrapper: sha(wrapper), hook: sha(path.join(clone, 'hooks/per-turn-gate.js')), harness: sha(path.join(clone, 'evals/orchestration/run-orchestration-eval.sh')), taskhash_expected: sha(path.join(clone, 'prereg/taskhash.expected.txt')) } };
for (const arm of ['ON', 'C']) m.argv_sha[arm] = w.argvSha(w.harnessArgv(m, arm, '<o>', '<t>'), '<o>', '<t>');
fs.writeFileSync(out, JSON.stringify(m, null, 2));
JS
}

WRAP="$TEST_TMP/real/run-p2-batch.js"; mkdir -p "$(dirname "$WRAP")"; cp "$WRAP_SRC" "$WRAP"
AUD_MUT="$TEST_TMP/mut-audit/run-p2-batch.js"; mkdir -p "$(dirname "$AUD_MUT")"; cp "$WRAP_SRC" "$AUD_MUT"
mutate "$AUD_MUT" "function audit(runDir, m, clone, opts) {" "function audit(runDir, m, clone, opts) { return [];" || fail "audit mutant could not be built"
POST_MUT="$TEST_TMP/mut-post/run-p2-batch.js"; mkdir -p "$(dirname "$POST_MUT")"; cp "$WRAP_SRC" "$POST_MUT"
mutate "$POST_MUT" "try { W.writeTaskHash(ctx, 'post'); } catch (e) {" "try { /* post listing removed */ } catch (e) {" || fail "post mutant could not be built"
mk_smut() { SMUT=1 mk_mut "$@"; }
mk_mut() { # <name> then pairs: <old> <new> ...; builds $TEST_TMP/mut-<name>/run-p2-batch.js
  local n="$1" f; shift; f="$TEST_TMP/mut-$n/run-p2-batch.js"; mkdir -p "$(dirname "$f")"; cp "$WRAP_SRC" "$f"
  # Old-rule mutants switch the generic strict layers off, so each of them still tests only its own rule.
  # (Strict-layer mutants are built with mk_smut, which leaves them on.)
  if [ -z "${SMUT:-}" ]; then
    mutate "$f" "const strictRows = auditRows(rows, ids, order, m);" "const strictRows = [] || auditRows(rows, ids, order, m);" || fail "strict-off mutant $n"
    mutate "$f" "fails.push(...auditFiles(" "fails.push(...[] || auditFiles(" || fail "strict-off mutant $n"
  fi
  while [ $# -ge 2 ]; do mutate "$f" "$1" "$2" || fail "mutant $n could not be built"; shift 2; done
}
mk_mut model "for (const r of by('MODEL')) need(" "for (const r of []) need(" "need(mr.rest.slice(id.length + 1) ===" "need(true || mr.rest.slice(id.length + 1) ==="
mk_mut cost "need(Math.abs(Number(kvOf(c.rest).running) -" "need(true || Math.abs(Number(kvOf(c.rest).running) -" "need(total <= m.arms[arm].cap," "need(true || total <= m.arms[arm].cap," "need(rawCost !== null && Math.abs(Number(kvOf(c0.rest).run) - rawCost) < 1e-5," "need(true || rawCost !== null && Math.abs(Number(kvOf(c0.rest).run) - rawCost) < 1e-5," "need(Math.abs(p2.projected - Number(kv.projected)) < 5e-4," "need(true || Math.abs(p2.projected - Number(kv.projected)) < 5e-4,"
mk_mut prereg "else if (pr.length) {" "else if (false) {" "for (const k of Object.keys(actual)) {" "for (const k of []) {"
mk_mut probe "probeSpent: a.probeSpent, total" "probeSpent: a.probeSpent + probeCost, total"
mk_mut base "['taskhash baseline', m.taskhash_expected, 'taskhash_expected']]) {" "]) {" "need(since.status === 0 && since.stdout.trim() === ''," "need(true || since.status === 0 && since.stdout.trim() === ''," "need(nowList !== null && nowList === expected" "need(true || nowList !== null && nowList === expected" "for (const k of Object.keys(actual)) {" "for (const k of []) {"
mk_mut costchk "need(cc.length === 1, " "need(true || cc.length === 1, " "need(cc.length === 1 && st && rows.indexOf(cc[0]) < rows.indexOf(st)," "need(true || cc.length === 1 && st && rows.indexOf(cc[0]) < rows.indexOf(st),"
mk_mut window "need((Date.parse(ends[ends.length - 1].ts) - Date.parse(win0.ts)) / 1000 <= m.window_s," "need(true || (Date.parse(ends[ends.length - 1].ts) - Date.parse(win0.ts)) / 1000 <= m.window_s,"
mk_mut timeout "Math.min(90 * 60 * 1000, (windowS - elapsedS) * 1000)" "90 * 60 * 1000"
mk_mut spend "runSum = Math.max(runSum, allRuns);" "" "for (const r of by('COST')) need(ids.includes(idOf(r))," "for (const r of []) need(ids.includes(idOf(r))," "need(Math.abs(p2.projected - Number(kv.projected)) < 5e-4," "need(true || Math.abs(p2.projected - Number(kv.projected)) < 5e-4,"
mk_mut errfmt "if (he) need(" "if (false) need(" "need(/^\\d+\$/.test(v)," "need(true || /^\\d+\$/.test(v),"
mk_mut ts "need(backwards === 0," "need(true || backwards === 0," "if (st && en) need(Date.parse(st.ts) <= Date.parse(en.ts)," "if (false) need(true," "need(Number.isFinite(mt) &&" "need(true || Number.isFinite(mt) &&"
mk_mut prtime "prTime = Date.parse(ex2(['git', '-C', clone, 'log', '-1', '--format=%cI', pr[0].rest.split(' ')[0]]).stdout.trim());" "prTime = Date.parse(pr[0].rest.split(' ')[1]);" "need(Number.isFinite(mt) &&" "need(true || Number.isFinite(mt) &&" "need(g(['log', '-1', '--format=%cI', prCommit]).stdout.trim() === prr.rest.split(' ')[1]," "need(true || g(['log', '-1', '--format=%cI', prCommit]).stdout.trim() === prr.rest.split(' ')[1]," "need(w0 && Number.isFinite(wsv) &&" "need(true || w0 && Number.isFinite(wsv) &&" "for (const k of Object.keys(actual)) {" "for (const k of []) {"
mk_mut startelapsed "const elapsedNow = ctx.elapsed();" "const elapsedNow = elapsed;"
mk_mut nowindow "if (tmo <= 0) throw" "if (false) throw"
mk_mut probest "need(tsvSeq.length > 0 &&" "need(true || tsvSeq.length > 0 &&" "need(tsvSeq[tsvSeq.length - 1] === 'ok'," "need(true || tsvSeq[tsvSeq.length - 1] === 'ok'," "need(rawSeq.join(',') === tsvSeq.join(',')" "need(true || rawSeq.join(',') === tsvSeq.join(',')"
mk_mut scoreval "need(okv, " "need(true || okv, " "need(okv && kv.m3" "need(true || okv && kv.m3" "need(o && typeof" "need(true || o && typeof"
mk_mut bmax "if (hc) need(" "if (false) need(" "need(bv !== null && /^\\d+$/.test(bv) &&" "need(bv !== null &&" "need(bv !== null && rawMax === Number(bv)," "need(true || bv !== null && rawMax === Number(bv)," "need(rawMax <= m.max_blocks," "need(true || rawMax <= m.max_blocks,"
mk_mut negcost "for (const r of by('COST')) { const kv = kvOf(r.rest); for (const k of ['run', 'probe']) need(" "for (const r of by('COST')) { const kv = kvOf(r.rest); for (const k of ['run', 'probe']) need(true || " "need(rawCost !== null && Math.abs(Number(kvOf(c0.rest).run) - rawCost) < 1e-5," "need(true || rawCost !== null && Math.abs(Number(kvOf(c0.rest).run) - rawCost) < 1e-5," "need(Math.abs(p2.projected - Number(kv.projected)) < 5e-4," "need(true || Math.abs(p2.projected - Number(kv.projected)) < 5e-4,"
mk_mut prereplaced "need(since.status === 0 && since.stdout.trim() === ''," "need(true || since.status === 0 && since.stdout.trim() === '',"  "need(atCommit.status === 0 &&" "need(true || atCommit.status === 0 &&" "need(g(['log', '-1', '--format=%H', '--', m.prereg]).stdout.trim() === prCommit," "need(true || g(['log', '-1', '--format=%H', '--', m.prereg]).stdout.trim() === prCommit," "for (const k of Object.keys(actual)) {" "for (const k of []) {"
mk_mut runver "need(rvVal === m.cli," "need(true || rvVal === m.cli," "need(rj === rvVal," "need(true || rj === rvVal," "need(rv.length !== 1 ||" "need(true || rv.length !== 1 ||"
mk_mut endrc "if (rawTurns === 5 && rcOf[id] === 0)" "if (rawTurns === 5)"
mk_mut rcint "need(Number.isInteger(rcOf[id])," "need(true || Number.isInteger(rcOf[id])," "if (rawTurns === 5 && rcOf[id] === 0)" "if (rawTurns === 5)"
mk_mut scoreor "need(o && typeof" "need(true || o && typeof"
mk_mut turnsraw "need(Number(kv.n) === rawTurns," "need(true || Number(kv.n) === rawTurns," "if (rawTurns === 5 && rcOf[id] === 0)" "if (kv.n === '5' && rcOf[id] === 0)"
mk_mut boolcheck "typeof o.constraints_pass === 'boolean' && typeof o.features_pass === 'boolean' && " ""
mk_mut modelraw "need(mr.rest.slice(id.length + 1) ===" "need(true || mr.rest.slice(id.length + 1) ==="
mk_mut traceraw "need(Number(kv.gate_trace) === tc.gate && Number(kv.plugin) === tc.plugin," "need(true || Number(kv.gate_trace) === tc.gate && Number(kv.plugin) === tc.plugin,"
mk_mut costraw "need(rawCost !== null && Math.abs(Number(kvOf(c0.rest).run) - rawCost) < 1e-5," "need(true || rawCost !== null && Math.abs(Number(kvOf(c0.rest).run) - rawCost) < 1e-5," "need(Math.abs(Number(kv.spent) - spentWant) < 5e-4," "need(true || Math.abs(Number(kv.spent) - spentWant) < 5e-4," "need(Math.abs(p.projected - Number(kv.projected)) < 5e-4 && !p.stop" "need(true || Math.abs(p.projected - Number(kv.projected)) < 5e-4 && !p.stop"
mk_mut taskdir "need(nowList !== null && nowList === expected" "need(true || nowList !== null && nowList === expected"
mk_mut probeaw "need(rawSeq.join(',') === tsvSeq.join(',')" "need(true || rawSeq.join(',') === tsvSeq.join(',')" "need(nums.length > 0 && nums.every" "need(true || nums.length > 0 && nums.every" "need(Math.abs(Number(kvOf(c.rest).probe) -" "need(true || Math.abs(Number(kvOf(c.rest).probe) -" "need(Math.abs(c - (typeof o.total_cost_usd" "need(true || Math.abs(c - (typeof o.total_cost_usd" "need(Math.abs(Number(kv.spent) - spentWant) < 5e-4," "need(true || Math.abs(Number(kv.spent) - spentWant) < 5e-4," "need(Math.abs(p.projected - Number(kv.projected)) < 5e-4 && !p.stop" "need(true || Math.abs(p.projected - Number(kv.projected)) < 5e-4 && !p.stop"
mk_mut cmdtpl "need(Array.isArray(av) &&" "need(true || Array.isArray(av) &&"
mk_mut mtime "need(Number.isFinite(mt) &&" "need(true || Number.isFinite(mt) &&"
mk_mut oldhead "o.auth_ok === true" "String(o.result_head).includes('AUTH_OK')"
mk_mut canon "need(Array.isArray(av) && outV === path.join" "need(true || Array.isArray(av) && outV === path.join"
mk_mut slack "Math.floor(mt) >= Date.parse(st.ts) &&" "Math.floor(mt) >= Date.parse(st.ts) - 5000 &&" "Math.floor(mt) <= Date.parse(en.ts)," "Math.floor(mt) <= Date.parse(en.ts) + 5000,"
mk_mut costnull "? o.total_cost_usd : null; return c; };" "? o.total_cost_usd : 0; return c; };" "need(Math.abs(p2.projected - Number(kv.projected)) < 5e-4," "need(true || Math.abs(p2.projected - Number(kv.projected)) < 5e-4,"
mk_mut probecost "cost = costOk ? o.total_cost_usd : 0; err = (o.is_error || !costOk) ? 1 : 0;" "cost = 0; err = o.is_error ? 1 : 0;"
mk_mut authscan "need(!AUTH_RE.test(raw)," "need(true || !AUTH_RE.test(raw),"
mk_mut tracefiles "need(tc.files > 0," "need(true || tc.files > 0,"
PYOLD="$TEST_TMP/pyold.txt"; PYNEW="$TEST_TMP/pynew.txt"
cat >"$PYOLD" <<'TXT'
const pfiles = nums.map((n) => path.join(runDir, 'probes', `${id}-${n}.json`));
TXT
cat >"$PYNEW" <<'TXT'
const pfiles = []; for (let k = 1; fs.existsSync(path.join(runDir, 'probes', `${id}-${k}.json`)); k++) pfiles.push(path.join(runDir, 'probes', `${id}-${k}.json`));
TXT
mk_mut probeset "need(nums.length > 0 && nums.every" "need(true || nums.length > 0 && nums.every" "need(pfBad.length === 0," "need(true || pfBad.length === 0," "$(cat "$PYOLD" | tr -d '\n')" "$(cat "$PYNEW" | tr -d '\n')"
mk_mut probefield "need(Math.abs(Number(kvOf(c.rest).probe) -" "need(true || Math.abs(Number(kvOf(c.rest).probe) -"
mk_mut stderrfile "need(errText !== null," "need(true || errText !== null,"
mk_mut filehash "need(fh(path.join(clone, m.hook_path)) === m.hashes.hook," "need(true || fh(path.join(clone, m.hook_path)) === m.hashes.hook," "need(fh(path.join(clone, m.harness_path)) === m.hashes.harness," "need(true || fh(path.join(clone, m.harness_path)) === m.hashes.harness," "need(fh((opts && opts.wrapperPath) || __filename) === m.hashes.wrapper," "need(true || fh((opts && opts.wrapperPath) || __filename) === m.hashes.wrapper," "for (const k of Object.keys(actual)) {" "for (const k of []) {"
mk_mut nan "rawCost.push(typeof o.total_cost_usd === 'number' ? o.total_cost_usd : 0);" "rawCost.push(typeof o.total_cost_usd === 'number' ? o.total_cost_usd : NaN);"
mk_mut nostrict "const strictRows = [] ||" "const strictRows = [] ||"
mk_mut costchkmeta "need(kv.stage === p.stage && Number(kv.cap) === m.arms[arm].cap," "need(true || kv.stage === p.stage && Number(kv.cap) === m.arms[arm].cap,"
mk_mut hookerr "if (he) need(" "if (false) need(" "need(errRuns <= 2," "need(true || errRuns <= 2,"
mk_mut modelrow "need(byId('MODEL', id).length === 1," "need(true || byId('MODEL', id).length === 1,"
mk_mut noexpiry "const expiring = exp !== null && exp - ctx.now() < CRED_MIN_AHEAD_MS;" "const expiring = false;"
MAN_NOEXP="$CLONE/prereg/manifest-noexpiry-mutant.json"; make_manifest "$TEST_TMP/mut-noexpiry/run-p2-batch.js" "$MAN_NOEXP"
MAN_M55="$CLONE/prereg/manifest-haiku55.json"; MAN_MODEL=claude-haiku-5-5 make_manifest "$WRAP" "$MAN_M55"
MAN_SE="$CLONE/prereg/manifest-startelapsed-mutant.json"; make_manifest "$TEST_TMP/mut-startelapsed/run-p2-batch.js" "$MAN_SE"
export MAN_WINDOW=3
MAN_W3="$CLONE/prereg/manifest-w3.json"; make_manifest "$WRAP" "$MAN_W3"
MAN_W3M="$CLONE/prereg/manifest-w3-mutant.json"; make_manifest "$TEST_TMP/mut-nowindow/run-p2-batch.js" "$MAN_W3M"
unset MAN_WINDOW
MAN_PC="$CLONE/prereg/manifest-probecost-mutant.json"; make_manifest "$TEST_TMP/mut-probecost/run-p2-batch.js" "$MAN_PC"
MAN_NAN="$CLONE/prereg/manifest-nan-mutant.json"; make_manifest "$TEST_TMP/mut-nan/run-p2-batch.js" "$MAN_NAN"
MAN_PROBE="$CLONE/prereg/manifest-probe-mutant.json"; make_manifest "$TEST_TMP/mut-probe/run-p2-batch.js" "$MAN_PROBE"
# manifests live inside the clone and are committed with the preregistration stand-in (the wrapper requires that)
MAN="$CLONE/prereg/manifest.json"; make_manifest "$WRAP" "$MAN"
MAN_MUT="$CLONE/prereg/manifest-audit-mutant.json"; make_manifest "$AUD_MUT" "$MAN_MUT"
MAN_POST="$CLONE/prereg/manifest-post-mutant.json"; make_manifest "$POST_MUT" "$MAN_POST"
git -C "$CLONE" add -A
# plumbing commit: no commit hooks run in the throwaway clone
TREE=$(git -C "$CLONE" write-tree); COMMIT=$(git -C "$CLONE" commit-tree "$TREE" -m prereg); git -C "$CLONE" update-ref HEAD "$COMMIT"

FAKE_STATE_DIR="$TEST_TMP/fakestate"
run_batch() { # <wrapper> <manifest> <rundir>; FAKE_TASK_EDIT optional
  [ -n "${KEEP_STATE:-}" ] || rm -rf "$FAKE_STATE_DIR"; mkdir -p "$FAKE_STATE_DIR"
  env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 FAKE_TASK_EDIT="${FAKE_TASK_EDIT:-}" FAKE_PROBE_SLEEP="${FAKE_PROBE_SLEEP:-}" FAKE_PROBE_FAIL_ONCE="${FAKE_PROBE_FAIL_ONCE:-}" FAKE_MODEL="${FAKE_MODEL:-}" ORCH_TIMEOUT=1m \
    node "$1" --run --manifest "$2" --run-dir "$3" --clone "$CLONE" ${RUN_ARGS:-} >"$3.stdout" 2>"$3.stderr"
}

echo "--- seeded order, cost rule, selfcheck"
O1=$(node "$WRAP" --order --manifest "$MAN"); O2=$(node "$WRAP" --order --manifest "$MAN")
assert_eq "$O1" "$O2" "the seeded order is reproducible"
assert_eq "$(echo "$O1" | wc -l | tr -d ' ')" 6 "order has 2 x n_per_arm ids"
assert_eq "$(echo "$O1" | sed -n '1,2p' | sed 's/^[0-9]* //' | sed 's/-.*//' | sort | tr '\n' ' ')" "C ON " "first pair holds one id of each arm"
node -e '
const w=require(process.argv[1]); const eq=(a,b,m)=>{ if(a!==b){console.error("FAIL "+m+": "+a+" vs "+b);process.exit(1)} };
const base={total:30,cap:17,probeCost:0.0166};
let p=w.projectCost({...base,runCosts:[0.5,0.5,0.5,0.5],probeSpent:0.07}); eq(p.stage,"pre5","stage before five"); eq(p.stop,false,"no projection before five");
p=w.projectCost({...base,runCosts:[0.5,0.5,0.5,0.5,0.5],probeSpent:0.083}); eq(p.stage,"post5","stage after five"); eq(p.stop,false,"flat 0.5 costs stay under the cap");
p=w.projectCost({...base,runCosts:[0.5,0.7,0.5,0.7,0.5],probeSpent:0.083}); eq(p.stop,true,"noisy costs push the projection over the cap");
p=w.projectCost({total:30,cap:18,probeCost:0.0166,runCosts:[0.552910,0.457526,0.591696,0.500538,0.627904],probeSpent:5*0.0166}); eq(p.stop,false,"P1 first five costs, cap 18: no STOP_COST ("+p.projected.toFixed(2)+")");
p=w.projectCost({total:30,cap:18,probeCost:0.0166,runCosts:[0.552910,0.457526,0.591696,0.500538,0.627904].map(x=>x*1.25),probeSpent:5*0.0166}); eq(p.stop,true,"P1 costs scaled by 1.25: STOP_COST ("+p.projected.toFixed(2)+")");
' "$WRAP" || fail "projectCost checks"
PJ_MUT="$TEST_TMP/mut-proj/run-p2-batch.js"; mkdir -p "$(dirname "$PJ_MUT")"; cp "$WRAP_SRC" "$PJ_MUT"
mutate "$PJ_MUT" "return { stage: 'post5', spent, projected, cap, stop: projected > cap };" "return { stage: 'post5', spent, projected, cap, stop: false };" || fail "projection mutant could not be built"
if node -e 'const w=require(process.argv[1]);const p=w.projectCost({total:30,cap:18,probeCost:0.0166,runCosts:[0.69,0.57,0.74,0.63,0.78],probeSpent:0.083});process.exit(p.stop?0:1)' "$PJ_MUT"; then fail "projection mutant (never stops) still stops"; else echo "RED projection: the never-stopping mutant misses STOP_COST on inflated costs"; fi
SC_OUT=$(node "$WRAP" --selfcheck 2>&1); SC_RC=$?
assert_eq "$SC_RC" 0 "selfcheck exits 0"
assert_contains "$SC_OUT" "SELFCHECK OK: every row has a writer" "selfcheck verdict"
assert_eq "$(echo "$SC_OUT" | grep -c '^row [0-9]* .*: written')" 14 "selfcheck: all 14 rows written"
SC_MUT="$TEST_TMP/mut-selfcheck/run-p2-batch.js"; mkdir -p "$(dirname "$SC_MUT")"; cp "$WRAP_SRC" "$SC_MUT"
mutate "$SC_MUT" "  W.writeBlockMax(ctx, id, recs);" "" || fail "selfcheck mutant could not be built"
if node "$SC_MUT" --selfcheck >/dev/null 2>&1; then fail "selfcheck mutant (writeBlockMax call removed) still exits 0"; else echo "RED selfcheck: mutant exits non-zero"; fi

echo "--- valid batch"
R1="$TEST_TMP/run-valid"
run_batch "$WRAP" "$MAN" "$R1"; assert_eq "$?" 0 "valid batch: wrapper exits 0"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$R1" --clone "$CLONE" >"$TEST_TMP/audit-valid.out"; assert_eq "$?" 0 "valid batch: audit exits 0 ($(tail -3 "$TEST_TMP/audit-valid.out" | tr '\n' ';'))"
assert_eq "$(grep -c ' START ' "$R1/invocation.log")" 6 "six START lines"
assert_eq "$(grep -c 'BLOCKMAX ON-.* 1$' "$R1/invocation.log")" 3 "each ON run shows a one-block turn"
assert_eq "$(grep -c 'HOOKCOUNT C-.* gate_trace=0 gate_log=0' "$R1/invocation.log")" 3 "control runs show no gate hook"
assert_not_contains "$(cat "$R1/invocation.log")" "$TEST_TMP" "log carries no scratch path"

echo "--- NC5 audit"
corrupt() { # <name> <rundir copy>
  case "$1" in
    truncated) python3 - "$2/invocation.log" <<'PY'
import sys
p = sys.argv[1]; lines = open(p).read().split('\n')
idx = max(i for i, l in enumerate(lines) if ' END ' in l); del lines[idx]
open(p, 'w').write('\n'.join(lines))
PY
    ;;
    notaskpost) rm -f "$2/taskhash.post.txt" ;;
    dupstart) python3 - "$2/invocation.log" <<'PY'
import sys
p = sys.argv[1]; lines = open(p).read().split('\n')
idx = next(i for i, l in enumerate(lines) if ' START ' in l); lines.insert(idx + 1, lines[idx])
open(p, 'w').write('\n'.join(lines))
PY
    ;;
  esac
}
for c in truncated notaskpost dupstart; do
  RC="$TEST_TMP/run-$c"; cp -a "$R1" "$RC"; corrupt "$c" "$RC"
  node "$WRAP" --audit --manifest "$MAN" --run-dir "$RC" --clone "$CLONE" >/dev/null; real_rc=$?
  node "$AUD_MUT" --audit --manifest "$MAN_MUT" --run-dir "$RC" --clone "$CLONE" >/dev/null; mut_rc=$?
  assert_neq "$real_rc" 0 "NC5 green: real audit exits non-zero for $c"
  assert_eq "$mut_rc" 0 "NC5 red: the stubbed audit exits 0 for $c, so the non-zero assertion would fail"
  echo "NC5 $c: real audit rc=$real_rc, stubbed audit rc=$mut_rc"
done

echo "--- NC8 task integrity"
nc8() { # <wrapper> <manifest> <rundir>: 0 when an edited task file leaves a TASKHASH_DIFF post fail line and a non-zero audit
  FAKE_TASK_EDIT="$TASKDIR/task.md" run_batch "$1" "$2" "$3"
  git -C "$CLONE" checkout -q -- evals/orchestration/tasks 2>/dev/null
  local fail_line audit_rc
  fail_line=$(grep -c 'TASKHASH_DIFF post fail' "$3/invocation.log" 2>/dev/null || true)
  node "$1" --audit --manifest "$2" --run-dir "$3" --clone "$CLONE" >/dev/null; audit_rc=$?
  echo "nc8: post-fail lines=$fail_line audit rc=$audit_rc"
  [ "${fail_line:-0}" -ge 1 ] && [ "$audit_rc" -ne 0 ]
}
if nc8 "$WRAP" "$MAN" "$TEST_TMP/run-nc8-real"; then echo "NC8 green: real wrapper records TASKHASH_DIFF post fail and the audit fails"; else fail "NC8: real wrapper did not catch the edited task file"; fi
if nc8 "$POST_MUT" "$MAN_POST" "$TEST_TMP/run-nc8-mut"; then fail "NC8 mutant (no post listing) passed: the control cannot go red"; else echo "NC8 red: wrapper without the post listing writes no TASKHASH_DIFF post fail"; fi
assert_eq "$(grep -c 'TASKHASH_DIFF post fail' "$TEST_TMP/run-nc8-mut/invocation.log" 2>/dev/null || true)" 0 "NC8 red: mutant leaves no post fail line"
assert_file_absent "$TEST_TMP/run-nc8-mut/taskhash.post.txt"

echo "--- audit round 1: models, final cost, preregistration state, probe accounting"
fixm() { local b="${FB:-$R1}" f tg; for f in "$1"/trace/*/latest; do [ -L "$f" ] || continue; tg=$(readlink "$f"); case "$tg" in "$b"/*) ln -sfn "$1/${tg#"$b"/}" "$f" ;; esac; done; if [ -z "${NOFIXM:-}" ]; then for f in "$b"/runs/*/run.log "$b"/runs/*/result.json; do touch -r "$f" "$1/${f#"$b"/}"; done; fi; if [ -z "${KEEPCMD:-}" ]; then for f in "$1"/cmd/*.json; do sed -i "s#$b#$1#g" "$f"; done; fi; }
audit_rc() { [ "$2" != "$R1" ] && [ -d "$2/runs" ] && fixm "$2"; node "$1" --audit --manifest "$MAN" --run-dir "$2" --clone "$CLONE" --wrapper-file "$WRAP" >/dev/null 2>&1; echo $?; }
# aud <dir> [wrapper]: audit a copy, leaving the status in AUD_RC and the whole output in AUD_OUT.
aud() { [ "$1" != "$R1" ] && [ -d "$1/runs" ] && fixm "$1"; AUD_OUT=$(node "${2:-$WRAP}" --audit --manifest "$MAN" --run-dir "$1" --clone "$CLONE" --wrapper-file "$WRAP" 2>&1); AUD_RC=$?; }
# tamper <name> [base]: a fresh copy of the base batch (default R1). Test isolation: the untouched copy must audit clean first,
# so a later failure can only come from the edit made to it.
tamper() { local b="${2:-$R1}"; rm -rf "$TEST_TMP/t-$1"; cp -a "$b" "$TEST_TMP/t-$1"; FB="$b" aud "$TEST_TMP/t-$1"; assert_eq "$AUD_RC" 0 "isolation: the untouched copy t-$1 audits clean before it is edited (${AUD_OUT:0:120})"; }
# afail <dir> <message>: the edited copy must fail the audit; when the message carries a T:KIND.field label, the failure text must
# also point at that field (LABRE below), so a different rule catching the edit does not count.
declare -A LABRE
LABRE=(
  ["WRAPPER_START.first"]='WRAPPER_START range'
  ["WRAPPER_START.last"]='WRAPPER_START range'
  ["WRAPPER_DONE.last"]='final WRAPPER_DONE'
  ["WRAPPER_EXIT.rc"]='final WRAPPER_EXIT'
  ["HASH.name"]='HASH: row does not match its shape'
  ["HASH.count"]='log grammar: .*HASH'
  ["HASH.second_row_wrong"]='log grammar: .*HASH'
  ["HASH.sha256"]='HASH hook: a row differs from the actual file'
  ["PREREG.commit"]='logged PREREG commit is not the commit'
  ["PREREG.time"]='logged PREREG time differs'
  ["PREREG.ancestor"]='PREREG missing or not an ancestor'
  ["WINDOW_START.row"]='window.start does not agree with the WINDOW_START row'
  ["TASKHASH_DIFF.phase"]='TASKHASH_DIFF: row does not match its shape: mid'
  ["TASKHASH_DIFF.tail"]='TASKHASH_DIFF: row does not match its shape: pre ok trailing'
  ["TASKHASH_DIFF.verdict"]='TASKHASH_DIFF fail line'
  ["ORDER.arm"]='ORDER ON-01: arm'
  ["ORDER.pos"]='ORDER line missing or not as seeded'
  ["ORDER.position"]='log grammar: .*ORDER'
  ["VERSION.value"]='VERSION missing or not'
  ["VERSION.position"]='log grammar: .*(VERSION|PROBE_OK)'
  ["PROBE_OK.cost"]='PROBE_OK/PROBE_FAIL cost'
  ["PROBE_FAIL.rc"]='PROBE_(OK/PROBE_)?FAIL.* rc|PROBE.*rc'
  ["PROBE_FAIL.cost"]='PROBE_OK/PROBE_FAIL cost'
  ["PAUSE.row"]='PAUSE'
  ["CMD.sha256"]='CMD missing or differs'
  ["START.elapsed"]='START elapsed .* disagrees'
  ["END.rc"]='END: row does not match its shape'
  ["COSTCHK.spent"]='COSTCHK spent .* differs from the raw files'
  ["COSTCHK.arm"]='COSTCHK ON-01: arm'
  ["COSTCHK.stage"]='COSTCHK stage/cap'
  ["COSTCHK.cap"]='COSTCHK stage/cap'
  ["COSTCHK.projected"]='COSTCHK projection'
  ["COSTCHK.verdict"]='COSTCHK projection'
  ["COST.arm"]='COST ON-01: arm'
  ["COST.run"]='COST (run|projected)'
  ["COST.probe"]='COST probe .* differs from the sum of the saved probe'
  ["COST.running"]='COST running'
  ["COST.projected"]='COST projected'
  ["SCORE.m1"]='SCORE differs from the oracle'
  ["SCORE.m2"]='SCORE differs from the oracle'
  ["SCORE.m3"]='SCORE m3 must be'
  ["SCORE_MISSING.row"]='need one SCORE'
  ["TURNS.arm"]='TURNS ON-01: arm'
  ["TURNS.n"]='TURNS n=5 differs from result.json'
  ["RUNVERSION.flag"]='RUNVERSION missing or not ok'
  ["RUNVERSION.value"]='RUNVERSION (flag disagrees|value)'
  ["MODEL.value"]='MODEL row differs'
  ["HOOKCOUNT.gate_trace"]='HOOKCOUNT gate_trace/plugin'
  ["HOOKCOUNT.gate_log"]='gate_trace .* != gate_log'
  ["HOOKCOUNT.plugin"]='HOOKCOUNT gate_trace/plugin'
  ["HOOKERR.n"]='HOOKERR differs'
  ["BLOCKMAX.value"]='BLOCKMAX missing'
  ["COMPLETE.counts"]='COMPLETE line does not match'
  ["COMPLETE.n"]='COMPLETE line does not match'
)
for k in ORDER VERSION PROBE_OK PROBE_FAIL CMD START END COSTCHK COST SCORE SCORE_MISSING TURNS RUNVERSION MODEL HOOKCOUNT HOOKERR BLOCKMAX; do LABRE["$k.id"]="$k: id ZZ-99 is not in the expected set"; done
afail() { FB="${FB:-$R1}" aud "$1"; assert_neq "$AUD_RC" 0 "$2"; local lab; lab=$(grep -oE 'T:[A-Za-z_]+\.[A-Za-z0-9_]+' <<<"$2" | head -1); if [ -n "$lab" ]; then local re="${LABRE[${lab#T:}]:-}"; if [ -z "$re" ]; then fail "$lab has no expected failure text in LABRE"; else grep -Eq -- "$re" <<<"$AUD_OUT"; assert_eq "$?" 0 "$lab: the failure text points at the field (/$re/; got: $(grep -m1 'AUDIT FAIL' <<<"$AUD_OUT" | cut -c1-140))"; fi; fi; if [ -n "${3:-}" ]; then grep -Eq -- "$3" <<<"$AUD_OUT"; assert_eq "$?" 0 "$2: failure text matches /$3/ (got: $(grep -m1 'AUDIT FAIL' <<<"$AUD_OUT" | cut -c1-140))"; fi; [ -n "${SHOWMSG:-}" ] && { printf 'LAB %s :: %s\n' "${lab:-none}" "$(grep -m1 'AUDIT FAIL' <<<"$AUD_OUT" | cut -c1-200)" >>"${SHOWMSG}"; }; }
# 1 several models in every MODEL row
tamper model; sed -i -E 's/^(\S+ MODEL \S+ ).*/\1claude-haiku-4-5,claude-sonnet-4-5/' "$TEST_TMP/t-model/invocation.log"
afail "$TEST_TMP/t-model" "T:MODEL.value multi-model rows: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-model/run-p2-batch.js" "$TEST_TMP/t-model")" 0 "RED multi-model: audit without the per-row check says OK"
# 2 last COST row inflated
tamper cost; python3 - "$TEST_TMP/t-cost/invocation.log" <<'PY'
import sys, re
p = sys.argv[1]; L = open(p).read().split('\n')
i = max(k for k, l in enumerate(L) if ' COST ' in l); L[i] = re.sub(r'run=\S+', 'run=999.000000', L[i]); open(p, 'w').write('\n'.join(L))
PY
afail "$TEST_TMP/t-cost" "T:COST.run last COST row 999: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-cost/run-p2-batch.js" "$TEST_TMP/t-cost")" 0 "RED last COST row: audit without the spend recomputation says OK"
# 3 preregistration modified / removed from the index afterwards
echo "edited after the batch" >>"$CLONE/prereg/PREREG.md"
assert_neq "$(audit_rc "$WRAP" "$R1")" 0 "modified PREREG: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-prereg/run-p2-batch.js" "$R1")" 0 "RED modified PREREG: audit trusting the logged ancestor=yes says OK"
git -C "$CLONE" checkout -q -- prereg/PREREG.md
git -C "$CLONE" rm -q --cached prereg/PREREG.md
assert_neq "$(audit_rc "$WRAP" "$R1")" 0 "PREREG removed from the index: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-prereg/run-p2-batch.js" "$R1")" 0 "RED PREREG removed from the index: mutant says OK"
git -C "$CLONE" reset -q HEAD -- prereg/PREREG.md
assert_eq "$(audit_rc "$WRAP" "$R1")" 0 "PREREG restored: real audit OK again"
# 4 probe counted once: running total equals the sum of runs and probes, id by id
node -e '
const fs=require("fs");const log=fs.readFileSync(process.argv[1]+"/invocation.log","utf8").split("\n");
const probes=fs.readFileSync(process.argv[1]+"/probes.tsv","utf8").split("\n").filter(Boolean).map(l=>l.split("\t"));
const run={},pr={};for(const [id,,c] of probes)pr[id]=Number(c);
const tot={ON:0,C:0};let bad=0,n=0;
for(const l of log){const m=/ COST (\S+) arm=(\S+) run=(\S+) probe=(\S+) running=(\S+)/.exec(l);if(!m)continue;n++;
 tot[m[2]]+=Number(m[3])+pr[m[1]];if(Math.abs(tot[m[2]]-Number(m[5]))>5e-4){bad++;console.error("running mismatch",m[1],m[5],tot[m[2]].toFixed(4))}}
process.exit(n===6&&!bad?0:1)' "$R1"; assert_eq "$?" 0 "COST running equals the id-by-id sum of runs and probes"
R2="$TEST_TMP/run-probe-mut"; run_batch "$TEST_TMP/mut-probe/run-p2-batch.js" "$MAN_PROBE" "$R2"
assert_neq "$(node "$TEST_TMP/mut-probe/run-p2-batch.js" --audit --manifest "$MAN_PROBE" --run-dir "$R2" --clone "$CLONE" >/dev/null 2>&1; echo $?)" 0 "RED probe double count: a batch written with the double-counting writer fails the audit"

echo "--- audit round 1 review: baseline pin, COSTCHK, window, HOOKERR, MODEL per id"
# 5 task hash baseline replaced AFTER the batch by a committed file, with pre and post listings rewritten to match it
OLDHEAD=$(git -C "$CLONE" rev-parse HEAD)
tamper base; echo "x" >>"$CLONE/prereg/taskhash.expected.txt"
cp "$CLONE/prereg/taskhash.expected.txt" "$TEST_TMP/t-base/taskhash.pre.txt"; cp "$CLONE/prereg/taskhash.expected.txt" "$TEST_TMP/t-base/taskhash.post.txt"
git -C "$CLONE" add -A; NT=$(git -C "$CLONE" write-tree); NC=$(git -C "$CLONE" commit-tree "$NT" -p "$OLDHEAD" -m swap); git -C "$CLONE" update-ref HEAD "$NC"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-base")" 0 "swapped taskhash baseline: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-base/run-p2-batch.js" "$TEST_TMP/t-base")" 0 "RED swapped taskhash baseline: audit without the baseline re-check says OK"
git -C "$CLONE" update-ref HEAD "$OLDHEAD"; git -C "$CLONE" reset -q --hard "$OLDHEAD"
assert_eq "$(audit_rc "$WRAP" "$R1")" 0 "baseline restored: real audit OK"
# 6 a COSTCHK row missing / after START
tamper chk1; python3 - "$TEST_TMP/t-chk1/invocation.log" <<'PY'
import sys
p = sys.argv[1]; L = open(p).read().split('\n'); i = next(k for k, l in enumerate(L) if ' COSTCHK ' in l); del L[i]; open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-chk1")" 0 "missing COSTCHK: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-costchk/run-p2-batch.js" "$TEST_TMP/t-chk1")" 0 "RED missing COSTCHK: mutant says OK"
# 7 window: the last END is later than the window end; the harness timeout never passes the window
tamper win; python3 - "$TEST_TMP/t-win/invocation.log" <<'PY'
import sys, re
p = sys.argv[1]; L = open(p).read().split('\n'); i = max(k for k, l in enumerate(L) if ' END ' in l)
for k in range(i, len(L)):
    if L[k]: L[k] = re.sub(r'^\d{4}-\d\d-\d\d', '2099-01-01', L[k])
open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-win")" 0 "last END after the window: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-window/run-p2-batch.js" "$TEST_TMP/t-win")" 0 "RED last END after the window: mutant says OK"
TO_CHECK='const w=require(process.argv[1]);process.exit(w.harnessTimeoutMs(28800-120,28800)===120000&&w.harnessTimeoutMs(0,28800)===5400000&&w.harnessTimeoutMs(28800-0.4,28800)===400&&w.harnessTimeoutMs(28800,28800)===0&&w.harnessTimeoutMs(28900,28800)===0?0:1)'
node -e "$TO_CHECK" "$WRAP"; assert_eq "$?" 0 "harness timeout is clamped to the remaining window"
node -e "$TO_CHECK" "$TEST_TMP/mut-timeout/run-p2-batch.js"; assert_eq "$?" 1 "RED timeout clamp: the unclamped mutant fails the check"
# 8 three ON runs with hook errors
tamper herr; python3 - "$TEST_TMP/t-herr/invocation.log" <<'PY'
import sys, re
p = sys.argv[1]; L = open(p).read().split('\n')
for k, l in enumerate(L):
    if ' HOOKERR ON-' in l: L[k] = re.sub(r' 0$', ' 1', l)
open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-herr")" 0 "hook errors in 3 ON runs: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-hookerr/run-p2-batch.js" "$TEST_TMP/t-herr")" 0 "RED hook errors: mutant says OK"
# 9 one MODEL row duplicated and another dropped (count unchanged)
tamper mrow; python3 - "$TEST_TMP/t-mrow/invocation.log" <<'PY'
import sys
p = sys.argv[1]; L = open(p).read().split('\n'); ix = [k for k, l in enumerate(L) if ' MODEL ' in l]
L[ix[1]] = L[ix[1]].split(' ')[0] + ' ' + L[ix[0]].split(' ', 1)[1]; open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-mrow")" 0 "MODEL rows not one per id: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-modelrow/run-p2-batch.js" "$TEST_TMP/t-mrow")" 0 "RED MODEL per id: mutant says OK"

echo "--- audit round 2: unknown COST id, HOOKERR format"
tamper unk; python3 - "$TEST_TMP/t-unk/invocation.log" <<'PY'
import sys
p = sys.argv[1]; L = open(p).read().split('\n'); i = max(k for k, l in enumerate(L) if ' COST ' in l and ' COSTCHK ' not in l)
L.insert(i + 1, L[i].replace(' COST C-', ' COST C-99 arm=C run=50.000000 probe=0 running=50 projected=50 #', 1) if ' COST C-' in L[i] else L[i].replace(' COST ON-', ' COST ON-99 arm=ON run=50.000000 probe=0 running=50 projected=50 #', 1)); open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-unk")" 0 "COST row of an unknown id: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-spend/run-p2-batch.js" "$TEST_TMP/t-unk")" 0 "RED unknown-id COST row: mutant says OK"
for bad in NaN -1 1.5; do
  tamper herr2; sed -i -E "0,/( HOOKERR ON-[0-9]+ )0$/s//\1$bad/" "$TEST_TMP/t-herr2/invocation.log"
  assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-herr2")" 0 "HOOKERR $bad: real audit non-zero"
  assert_eq "$(audit_rc "$TEST_TMP/mut-errfmt/run-p2-batch.js" "$TEST_TMP/t-herr2")" 0 "RED HOOKERR $bad: mutant says OK"
done

echo "--- audit round 2: timestamp order, PREREG time from git"
tamper ts; python3 - "$TEST_TMP/t-ts/invocation.log" <<'PY'
import sys, re
p = sys.argv[1]; L = open(p).read().split('\n'); i = next(k for k, l in enumerate(L) if ' END ' in l)
L[i] = re.sub(r'^\S+', '2000-01-01T00:00:00.000Z', L[i]); open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-ts")" 0 "first END stamped 2000-01-01: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-ts/run-p2-batch.js" "$TEST_TMP/t-ts")" 0 "RED first END in 2000: mutant says OK"
# whole batch moved to 2000 and the logged PREREG time forged to 1990: only git knows the real commit time
tamper shift; python3 - "$TEST_TMP/t-shift/invocation.log" <<'PY'
import sys, re
p = sys.argv[1]; L = open(p).read().split('\n')
for k, l in enumerate(L):
    if not l: continue
    L[k] = re.sub(r'^\d{4}-\d\d-\d\d', '2000-01-01', l)
    if ' PREREG ' in l:
        parts = L[k].split(' '); parts[3] = '1990-01-01T00:00:00+00:00'; L[k] = ' '.join(parts)
open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-shift")" 0 "batch shifted to 2000, PREREG time forged: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-prtime/run-p2-batch.js" "$TEST_TMP/t-shift")" 0 "RED forged PREREG time: audit trusting the logged string says OK"

echo "--- review round 3: START elapsed after a slow probe, window gone during the probe"
elapsed_lines() { node "$1" --audit --manifest "$2" --run-dir "$3" --clone "$CLONE" 2>&1 | grep -c "disagrees with its timestamp"; }
RUN_ARGS="--first 1 --last 1" FAKE_PROBE_SLEEP=5 run_batch "$WRAP" "$MAN" "$TEST_TMP/run-slow"
assert_eq "$(elapsed_lines "$WRAP" "$MAN" "$TEST_TMP/run-slow")" 0 "slow probe (5 s): START elapsed agrees with its timestamp"
RUN_ARGS="--first 1 --last 1" FAKE_PROBE_SLEEP=5 run_batch "$TEST_TMP/mut-startelapsed/run-p2-batch.js" "$MAN_SE" "$TEST_TMP/run-slow-mut"
assert_neq "$(elapsed_lines "$TEST_TMP/mut-startelapsed/run-p2-batch.js" "$MAN_SE" "$TEST_TMP/run-slow-mut")" 0 "RED slow probe: the early-sampling mutant writes an elapsed that disagrees with its timestamp"
RUN_ARGS="--first 1 --last 1" FAKE_PROBE_SLEEP=5 run_batch "$WRAP" "$MAN_W3" "$TEST_TMP/run-w3"; w3rc=$?
assert_eq "$w3rc" 8 "window gone during the probe: wrapper exits 8"
assert_eq "$(grep -c ' STOP_WINDOW ' "$TEST_TMP/run-w3/invocation.log")" 1 "STOP_WINDOW written"
assert_eq "$(grep -cE ' (START|ORDER|CMD) ' "$TEST_TMP/run-w3/invocation.log")" 0 "no ORDER, CMD or START artifact before the stop"
RUN_ARGS="--first 1 --last 1" FAKE_PROBE_SLEEP=5 run_batch "$TEST_TMP/mut-nowindow/run-p2-batch.js" "$MAN_W3M" "$TEST_TMP/run-w3-mut"
assert_neq "$(grep -cE ' START ' "$TEST_TMP/run-w3-mut/invocation.log")" 0 "RED window gone: the mutant without the pre-START check leaves a START"

echo "--- acceptance round 3: negative cost, PREREG replaced by a later commit"
tamper neg; python3 - "$TEST_TMP/t-neg/invocation.log" <<'PY'
import sys, re
p = sys.argv[1]; L = open(p).read().split('\n')
i = max(k for k, l in enumerate(L) if ' COST ' in l and ' COSTCHK ' not in l)
run = float(re.search(r'run=(\S+)', L[i]).group(1)); running = float(re.search(r'running=(\S+)', L[i]).group(1))
L[i] = re.sub(r'run=\S+', 'run=-1.000000', L[i]); L[i] = re.sub(r'running=\S+', 'running=%.4f' % (running - run - 1), L[i])
open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-neg")" 0 "negative run cost with a consistent running total: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-negcost/run-p2-batch.js" "$TEST_TMP/t-neg")" 0 "RED negative cost: mutant says OK"
OLDHEAD=$(git -C "$CLONE" rev-parse HEAD)
tamper late; echo "replacement text" >>"$CLONE/prereg/PREREG.md"
NEWH=$(sha256sum "$CLONE/prereg/PREREG.md" | cut -d' ' -f1)
sed -i -E "s/( HASH prereg )\S+/\1$NEWH/" "$TEST_TMP/t-late/invocation.log"
git -C "$CLONE" add -A; NT=$(git -C "$CLONE" write-tree); NC=$(git -C "$CLONE" commit-tree "$NT" -p "$OLDHEAD" -m late); git -C "$CLONE" update-ref HEAD "$NC"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-late")" 0 "PREREG replaced by a later commit, logged hash updated: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-prereplaced/run-p2-batch.js" "$TEST_TMP/t-late")" 0 "RED replaced PREREG: mutant says OK"
git -C "$CLONE" update-ref HEAD "$OLDHEAD"; git -C "$CLONE" reset -q --hard "$OLDHEAD"
assert_eq "$(audit_rc "$WRAP" "$R1")" 0 "PREREG restored: real audit OK"

echo "--- round 4: probe status, SCORE values, BLOCKMAX from raw log, timeout before artifacts"
tamper pst; python3 - "$TEST_TMP/t-pst/probes.tsv" <<'PY'
import sys
p = sys.argv[1]; L = open(p).read().split('\n'); f = L[0].split('\t'); f[1] = '1'; f[3] = 'fail'; L[0] = '\t'.join(f); open(p, 'w').write('\n'.join(L))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-pst")" 0 "failed probe row covered by a PROBE_OK: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-probest/run-p2-batch.js" "$TEST_TMP/t-pst")" 0 "RED failed probe row: mutant says OK"
for sv in "m1=NaN m2=1 m3=0" "m1=1 m2=0 m3=1" "m1=2 m2=1 m3=1"; do
  tamper sc; python3 - "$TEST_TMP/t-sc/invocation.log" "$sv" <<'PY'
import sys, re
p, sv = sys.argv[1:3]; L = open(p).read().split('\n'); i = next(k for k, l in enumerate(L) if ' SCORE ' in l)
L[i] = re.sub(r'm1=.*$', sv, L[i]); open(p, 'w').write('\n'.join(L))
PY
  assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-sc")" 0 "SCORE '$sv': real audit non-zero"
  assert_eq "$(audit_rc "$TEST_TMP/mut-scoreval/run-p2-batch.js" "$TEST_TMP/t-sc")" 0 "RED SCORE '$sv': mutant says OK"
done
tamper bm; sed -i -E "0,/( BLOCKMAX \S+ )[0-9]+$/s//\1-1/" "$TEST_TMP/t-bm/invocation.log"
afail "$TEST_TMP/t-bm" "T:BLOCKMAX.value BLOCKMAX -1: real audit non-zero"
tamper bm2; ONID=$(grep -oE ' BLOCKMAX ON-[0-9]+' "$TEST_TMP/t-bm2/invocation.log" | head -1 | awk '{print $2}')
HL=$(ls "$TEST_TMP/t-bm2/runs/$ONID/hook/live/per-turn-gate/"*.jsonl | head -1)
printf '%s\n%s\n' '{"session":"s","turn":1,"decision":"block","reason":"block","counter":2}' '{"session":"s","turn":1,"decision":"block","reason":"block","counter":3}' >>"$HL"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-bm2")" 0 "raw hook log with 3 blocks in a turn, summary says 1: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-bmax/run-p2-batch.js" "$TEST_TMP/t-bm2")" 0 "RED raw hook log: mutant says OK"
assert_eq "$(audit_rc "$TEST_TMP/mut-bmax/run-p2-batch.js" "$TEST_TMP/t-bm")" 0 "RED BLOCKMAX -1: mutant says OK"
# 4: the final timeout is computed once, before the first START artifact, and is what the harness call gets
tmo_order() { node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const st=s.indexOf("W.writeProbe(ctx, id, home, expiring);");const loop=s.slice(st,s.indexOf("const r = sh(ctx",st));const calls=(loop.match(/harnessTimeoutMs\(/g)||[]).length;const firstTmo=loop.indexOf("harnessTimeoutMs(");const firstArt=loop.indexOf("W.writeOrder(");console.log(calls+":"+(firstTmo>=0&&firstTmo<firstArt?"before":"after"))' "$1"; }
assert_eq "$(tmo_order "$WRAP")" "1:before" "one timeout computation, before ORDER/CMD/START"
PRE_MUT="$TEST_TMP/mut-tmo2/run-p2-batch.js"; mkdir -p "$(dirname "$PRE_MUT")"; cp "$WRAP_SRC" "$PRE_MUT"
mutate "$PRE_MUT" "    W.writeStartEnd(ctx, 'START', id, " "    const tmo2 = harnessTimeoutMs(ctx.elapsed(), m.window_s); void tmo2;
    W.writeStartEnd(ctx, 'START', id, " || fail "tmo2 mutant"
assert_neq "$(tmo_order "$PRE_MUT")" "1:before" "RED timeout: a second computation after the artifacts is detected"

echo "--- acceptance round 5: RUNVERSION value, END rc semantics"
tamper rv; sed -i -E "0,/( RUNVERSION \S+ ok ).*/s//\1wrong-version/" "$TEST_TMP/t-rv/invocation.log"
afail "$TEST_TMP/t-rv" "T:RUNVERSION.value RUNVERSION wrong-version behind an ok marker: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-runver/run-p2-batch.js" "$TEST_TMP/t-rv")" 0 "RED RUNVERSION: mutant says OK"
tamper rv2; RJ=$(ls "$TEST_TMP"/t-rv2/runs/*/result.json | head -1); sed -i 's/"runner_version":"[^"]*"/"runner_version":"2.0.0 (Claude Code)"/' "$RJ"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-rv2")" 0 "result.json runner_version differs from the log: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-runver/run-p2-batch.js" "$TEST_TMP/t-rv2")" 0 "RED result.json runner_version: mutant says OK"
endrc_case() { # <name> <rc> <score: keep|missing> <complete: keep|lower>
  tamper "$1"; python3 - "$TEST_TMP/t-$1/invocation.log" "$2" "$3" "$4" <<'PY'
import sys, re
p, rc, score, comp = sys.argv[1:5]; L = open(p).read().split('\n')
i = next(k for k, l in enumerate(L) if ' END ' in l); fid = L[i].split()[2]
L[i] = re.sub(r'rc=\S+', 'rc=' + rc, L[i])
if score == 'missing':
    j = next(k for k, l in enumerate(L) if ' SCORE ' + fid + ' ' in l); L[j] = L[j].split(' ')[0] + ' SCORE_MISSING ' + fid
if comp == 'lower':
    j = max(k for k, l in enumerate(L) if ' COMPLETE ' in l); arm = fid.split('-')[0]
    L[j] = re.sub(arm + r'=(\d+)', lambda m: arm + '=' + str(int(m.group(1)) - 1), L[j])
open(p, 'w').write('\n'.join(L))
PY
}
endrc_case e124a 124 keep keep
afail "$TEST_TMP/t-e124a" "T:COMPLETE.counts rc=124 run still counted in COMPLETE: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-endrc/run-p2-batch.js" "$TEST_TMP/t-e124a")" 0 "RED rc=124 counted as complete: mutant says OK"
endrc_case e124b 124 missing lower
assert_eq "$(audit_rc "$WRAP" "$TEST_TMP/t-e124b")" 0 "one rc=124 run, SCORE_MISSING, COMPLETE lowered: still a valid batch (27-of-30 tolerance)"
endrc_case e124c 124 keep lower
assert_eq "$(audit_rc "$WRAP" "$TEST_TMP/t-e124c")" 0 "rc=124 run with its (oracle-consistent) SCORE and COMPLETE lowered: valid"
endrc_case ebad abc keep keep
afail "$TEST_TMP/t-ebad" "T:END.rc END rc=abc: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-rcint/run-p2-batch.js" "$TEST_TMP/t-ebad")" 0 "RED END rc=abc: mutant says OK"
endrc_case emiss 0 missing keep
afail "$TEST_TMP/t-emiss" "T:SCORE_MISSING.row SCORE_MISSING after a successful call (rc=0): real audit non-zero"
tamper orc; OL=$(ls "$TEST_TMP"/t-orc/runs/*/oracle.log | head -1); sed -i 's/"constraints_pass": *true/"constraints_pass": false/; s/"constraints_pass":true/"constraints_pass":false/' "$OL"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-orc")" 0 "oracle.log disagrees with the SCORE row: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-scoreor/run-p2-batch.js" "$TEST_TMP/t-orc")" 0 "RED oracle recomputation: mutant says OK"

echo "--- round 6: TURNS from result.json, oracle booleans"
tamper tz; for f in "$TEST_TMP"/t-tz/runs/*/result.json; do sed -i -E 's/"turns_completed":[0-9]+/"turns_completed":0/' "$f"; done
afail "$TEST_TMP/t-tz" "T:TURNS.n all result.json turns_completed 0, log says 5 and COMPLETE 3/3: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-turnsraw/run-p2-batch.js" "$TEST_TMP/t-tz")" 0 "RED TURNS summary only: mutant says OK"
for variant in missing string null; do
  tamper ob; python3 - "$TEST_TMP/t-ob" "$variant" <<'PY'
import sys, json, glob, re
d, v = sys.argv[1:3]
oc = sorted(glob.glob(d + '/runs/*/oracle.log'))[0]; rid = oc.split('/')[-2]
txt = open(oc).read()
pat = r'"features_pass":\s*(true|false),?'
if not re.search(pat, txt): raise SystemExit('no features_pass field in oracle.log')
rep = {'missing': '', 'string': '"features_pass": "false",', 'null': '"features_pass": null,'}[v]
open(oc, 'w').write(re.sub(pat, rep, txt, count=1))
p = d + '/invocation.log'; L = open(p).read().split('\n')
for k, l in enumerate(L):
    if ' SCORE ' + rid + ' ' in l: L[k] = re.sub(r'm1=.*$', 'm1=1 m2=0 m3=0', l)
open(p, 'w').write('\n'.join(L))
PY
  assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-ob")" 0 "oracle features_pass $variant, SCORE m2=0: real audit non-zero"
  assert_eq "$(audit_rc "$TEST_TMP/mut-boolcheck/run-p2-batch.js" "$TEST_TMP/t-ob")" 0 "RED oracle $variant: mutant says OK"
done

echo "--- round 6: MODEL, trace counts and run cost recomputed from raw files"
tamper mraw; RL=$(ls "$TEST_TMP"/t-mraw/runs/*/run.log | head -1); sed -i 's/claude-haiku-4-5/claude-other-9/' "$RL"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-mraw")" 0 "run.log model differs from the MODEL row: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-modelraw/run-p2-batch.js" "$TEST_TMP/t-mraw")" 0 "RED MODEL from summary only: mutant says OK"
tamper traw; TF=$(ls "$TEST_TMP"/t-traw/trace/ON-*/trace-turn1.log | head -1)
echo 'Hooks: Stop [node x/hooks/per-turn-gate.js] finished with status 0 (3ms)' >>"$TF"
afail "$TEST_TMP/t-traw" "T:HOOKCOUNT.gate_trace trace has one more gate execution than the HOOKCOUNT row says: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-traceraw/run-p2-batch.js" "$TEST_TMP/t-traw")" 0 "RED trace counts from summary only: mutant says OK"
tamper craw; RL=$(ls "$TEST_TMP"/t-craw/runs/*/run.log | head -1); sed -i -E 's/"total_cost_usd":[0-9.]+/"total_cost_usd":0.01/' "$RL"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-craw")" 0 "run.log cost differs from the COST row: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-costraw/run-p2-batch.js" "$TEST_TMP/t-craw")" 0 "RED cost from summary only: mutant says OK"

echo "--- round 7: task dir re-hash, saved probe responses, saved argv, run file times"
echo "edited after the batch" >>"$TASKDIR/task.md"
assert_neq "$(audit_rc "$WRAP" "$R1")" 0 "task directory edited after the batch: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-taskdir/run-p2-batch.js" "$R1")" 0 "RED task directory: audit without the re-hash says OK"
git -C "$CLONE" checkout -q -- evals/orchestration/tasks
assert_eq "$(audit_rc "$WRAP" "$R1")" 0 "task directory restored: real audit OK"
for pv in iserror delete cost; do
  tamper pr; PF=$(ls "$TEST_TMP"/t-pr/probes/*-1.json | head -1)
  case $pv in
    iserror) sed -i 's/"is_error":false/"is_error":true/' "$PF" ;;
    delete) rm -f "$PF" ;;
    cost) sed -i -E 's/"total_cost_usd":[0-9.]+/"total_cost_usd":9.5/' "$PF" ;;
  esac
  assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-pr")" 0 "saved probe response ($pv) disagrees with probes.tsv and the log: real audit non-zero"
  assert_eq "$(audit_rc "$TEST_TMP/mut-probeaw/run-p2-batch.js" "$TEST_TMP/t-pr")" 0 "RED saved probe response ($pv): mutant says OK"
done
tamper cm; CF=$(ls "$TEST_TMP"/t-cm/cmd/ON-*.json | head -1); sed -i 's/"hook"/"observe"/' "$CF"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-cm")" 0 "saved argv with another gate: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-cmdtpl/run-p2-batch.js" "$TEST_TMP/t-cm")" 0 "RED saved argv: mutant says OK"
tamper mt; MF=$(ls "$TEST_TMP"/t-mt/runs/*/run.log | head -1); touch -d '+2 hours' "$MF"
assert_neq "$(NOFIXM=1 audit_rc "$WRAP" "$TEST_TMP/t-mt")" 0 "run.log written outside START..END: real audit non-zero"
assert_eq "$(NOFIXM=1 audit_rc "$TEST_TMP/mut-mtime/run-p2-batch.js" "$TEST_TMP/t-mt")" 0 "RED run file time: mutant says OK"

echo "--- round 8: long probe reply, canonical argv paths, strict mtime, missing costs, auth rescan, missing traces"
tamper lp; PF=$(ls "$TEST_TMP"/t-lp/probes/*-1.json | head -1); sed -i -E 's/"result_head":"[^"]*"/"result_head":"filler only, the marker came after 200 characters"/' "$PF"
assert_eq "$(audit_rc "$WRAP" "$TEST_TMP/t-lp")" 0 "AUTH_OK beyond the saved head: auth_ok decides, audit OK"
assert_neq "$(audit_rc "$TEST_TMP/mut-oldhead/run-p2-batch.js" "$TEST_TMP/t-lp")" 0 "RED long reply: the head-based mutant misjudges a good probe"
tamper cp2; CF=$(ls "$TEST_TMP"/t-cp2/cmd/ON-*.json | head -1); KEEPCMD=1 fixm "$TEST_TMP/t-cp2"; sed -i -E 's#"[^"]*/runs/#"/tmp/other/runs/#' "$CF"
assert_neq "$(KEEPCMD=1 audit_rc "$WRAP" "$TEST_TMP/t-cp2")" 0 "saved argv with another out path: real audit non-zero"
assert_eq "$(KEEPCMD=1 audit_rc "$TEST_TMP/mut-canon/run-p2-batch.js" "$TEST_TMP/t-cp2")" 0 "RED out path: suffix-only mutant says OK"
tamper mt2; MF=$(ls "$TEST_TMP"/t-mt2/runs/*/run.log | head -1); MID=$(basename "$(dirname "$MF")")
ENDMS=$(python3 - "$TEST_TMP/t-mt2/invocation.log" "$MID" <<'PY'
import sys, datetime
for l in open(sys.argv[1]):
    p = l.split()
    if len(p) > 2 and p[1] == 'END' and p[2] == sys.argv[2]:
        print(datetime.datetime.fromisoformat(p[0].replace('Z', '+00:00')).timestamp() + 2)
PY
)
touch -d "@$ENDMS" "$MF"
assert_neq "$(NOFIXM=1 audit_rc "$WRAP" "$TEST_TMP/t-mt2")" 0 "run.log 2 s after END: strict real audit non-zero"
assert_eq "$(NOFIXM=1 audit_rc "$TEST_TMP/mut-slack/run-p2-batch.js" "$TEST_TMP/t-mt2")" 0 "RED 2 s after END: the slack mutant says OK"
node -e 'const w=require(process.argv[1]);const c=[w.lastResultCost("{\"type\":\"result\"}"),w.lastResultCost("{\"type\":\"result\",\"total_cost_usd\":\"x\"}"),w.lastResultCost("{\"type\":\"result\",\"total_cost_usd\":-1}")];process.exit(c.every((v)=>v===null)&&w.lastResultCost("{\"type\":\"result\",\"total_cost_usd\":0.5}")===0.5?0:1)' "$WRAP"; assert_eq "$?" 0 "missing, non-numeric and negative costs are null"
node -e 'const w=require(process.argv[1]);process.exit(w.lastResultCost("{\"type\":\"result\"}")===null?0:1)' "$TEST_TMP/mut-costnull/run-p2-batch.js"; assert_eq "$?" 1 "RED missing cost: the zero-defaulting mutant returns 0"
tamper cm2; python3 - "$TEST_TMP/t-cm2" <<'PY'
import sys, re, glob
d = sys.argv[1]; p = d + '/invocation.log'; L = open(p).read().split('\n')
i = max(k for k, l in enumerate(L) if ' COST ' in l and ' COSTCHK ' not in l)
rid = L[i].split()[2]; run = float(re.search(r'run=(\S+)', L[i]).group(1)); running = float(re.search(r'running=(\S+)', L[i]).group(1))
L[i] = re.sub(r'run=\S+', 'run=0.000000', L[i]); L[i] = re.sub(r'running=\S+', 'running=%.4f' % (running - run), L[i]); open(p, 'w').write('\n'.join(L))
rl = d + '/runs/' + rid + '/run.log'; t = open(rl).read(); open(rl, 'w').write(re.sub(r'"total_cost_usd":[0-9.]+,?', '', t))
PY
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-cm2")" 0 "run.log without total_cost_usd, COST row 0: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-costnull/run-p2-batch.js" "$TEST_TMP/t-cm2")" 0 "RED run.log cost missing: mutant says OK"
RUN_ARGS="--first 1 --last 1" FAKE_PROBE_NOCOST=1 run_batch "$WRAP" "$MAN" "$TEST_TMP/run-nocost"; assert_eq "$?" 7 "probe response without total_cost_usd: the probe fails (exit 7)"
RUN_ARGS="--first 1 --last 1" FAKE_PROBE_NOCOST=1 run_batch "$TEST_TMP/mut-probecost/run-p2-batch.js" "$MAN_PC" "$TEST_TMP/run-nocost-mut"; assert_neq "$?" 7 "RED probe without cost: the zero-defaulting mutant lets it through"
tamper au; AL=$(ls "$TEST_TMP"/t-au/runs/*/run.log | head -1); echo "OAuth session expired, please log in" >>"$AL"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-au")" 0 "raw run.log shows an expired session: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-authscan/run-p2-batch.js" "$TEST_TMP/t-au")" 0 "RED expired session: mutant says OK"
tamper tr; rm -rf "$TEST_TMP"/t-tr/trace/C-*
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-tr")" 0 "all C-arm traces deleted: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-tracefiles/run-p2-batch.js" "$TEST_TMP/t-tr")" 0 "RED missing traces: mutant says OK"

echo "--- round 9: probe file set, COST probe field, stderr file, real file hashes"
tamper pg; PF=$(ls "$TEST_TMP"/t-pg/probes/*-1.json | head -1); cp "$PF" "${PF%-1.json}-3.json"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-pg")" 0 "extra probe response with a gap (n=1,3): real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-probeset/run-p2-batch.js" "$TEST_TMP/t-pg")" 0 "RED probe file gap: sequential-read mutant says OK"
tamper pu; cp "$(ls "$TEST_TMP"/t-pu/probes/*-1.json | head -1)" "$TEST_TMP/t-pu/probes/ZZ-01-1.json"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-pu")" 0 "probe response file with an unknown id: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-probeset/run-p2-batch.js" "$TEST_TMP/t-pu")" 0 "RED unknown probe file: mutant says OK"
tamper pf; sed -i -E '0,/( COST \S+ arm=\S+ run=\S+ )probe=\S+/s//\1probe=999.000000/' "$TEST_TMP/t-pf/invocation.log"
afail "$TEST_TMP/t-pf" "T:COST.probe COST probe=999: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-probefield/run-p2-batch.js" "$TEST_TMP/t-pf")" 0 "RED COST probe field: mutant says OK"
tamper se; rm -f "$TEST_TMP"/t-se/runs/*.stderr
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-se")" 0 "stderr files deleted: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-stderrfile/run-p2-batch.js" "$TEST_TMP/t-se")" 0 "RED missing stderr: mutant says OK"
for what in hooks/per-turn-gate.js evals/orchestration/run-orchestration-eval.sh; do
  echo "// edited after the batch" >>"$CLONE/$what"
  assert_neq "$(audit_rc "$WRAP" "$R1")" 0 "$what edited after the batch: real audit non-zero"
  assert_eq "$(audit_rc "$TEST_TMP/mut-filehash/run-p2-batch.js" "$R1")" 0 "RED $what: audit comparing only the HASH rows says OK"
  git -C "$CLONE" checkout -q -- "$what"
done
node "$WRAP" --audit --manifest "$MAN" --run-dir "$R1" --clone "$CLONE" --wrapper-file "$TEST_TMP/mut-hookerr/run-p2-batch.js" >/dev/null 2>&1; assert_neq "$?" 0 "another wrapper file than the preregistered one: audit non-zero"
node "$TEST_TMP/mut-filehash/run-p2-batch.js" --audit --manifest "$MAN" --run-dir "$R1" --clone "$CLONE" --wrapper-file "$TEST_TMP/mut-hookerr/run-p2-batch.js" >/dev/null 2>&1; assert_eq "$?" 0 "RED wrapper file: the mutant without the file hashes says OK"
assert_eq "$(audit_rc "$WRAP" "$R1")" 0 "files restored: real audit OK"

echo "--- round 9 E: a probe fails (no cost), the owner re-logs in, the batch resumes and must audit OK"
RF="$TEST_TMP/run-resume"
FAKE_PROBE_FAIL_ONCE=1 run_batch "$WRAP" "$MAN" "$RF"; assert_eq "$?" 7 "first probe fails: wrapper pauses with exit 7"
KEEP_STATE=1 FAKE_PROBE_FAIL_ONCE=1 run_batch "$WRAP" "$MAN" "$RF"; assert_eq "$?" 0 "resumed batch completes"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$RF" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/resume-audit.out" 2>&1; assert_eq "$?" 0 "batch with a failed-then-recovered probe: real audit OK ($(head -3 "$TEST_TMP/resume-audit.out" | tr "\n" ";"))"
assert_eq "$(grep -c ' PROBE_FAIL ' "$RF/invocation.log")" 1 "the failed probe is in the log"
NANMUT="$TEST_TMP/mut-nan/run-p2-batch.js"
assert_neq "$(node "$NANMUT" --audit --manifest "$MAN_NAN" --run-dir "$RF" --clone "$CLONE" --wrapper-file "$NANMUT" >/dev/null 2>&1; echo $?)" 0 "RED probe without cost: the NaN mutant fails a valid resumed batch"

echo "--- round 10: the schema table, one tamper per row kind and per raw file"
logedit() { # <name> <python expr body acting on list L (log lines)>
  tamper "$1"; python3 - "$TEST_TMP/t-$1/invocation.log" "$2" <<'PY'
import sys, re
p, code = sys.argv[1:3]; L = open(p).read().split('\n')
def first(k, pref=''): return next(j for j, l in enumerate(L) if ' %s %s' % (k, pref) in l)
def lastidx(k): return max(j for j, l in enumerate(L) if ' %s ' % k in l)
def sub(i, pat, rep): L[i] = re.sub(pat, rep, L[i], count=1)
exec(code); open(p, 'w').write('\n'.join(L))
PY
}
chk_real() { afail "$TEST_TMP/t-$1" "$2"; }
chk_red() { assert_eq "$(audit_rc "$TEST_TMP/mut-nostrict/run-p2-batch.js" "$TEST_TMP/t-$1")" 0 "RED $2"; }
logedit ws "i = next(k for k, l in enumerate(L) if ' WRAPPER_START ' in l); L[i] = re.sub(r'first=\S+ last=\S+', 'first=5 last=2', L[i])"; chk_real ws "WRAPPER_START range first>last: real audit non-zero"
logedit wd "i = max(k for k, l in enumerate(L) if ' WRAPPER_DONE ' in l); L[i] = re.sub(r'last=\S+', 'last=5', L[i])"; chk_real wd "final WRAPPER_DONE not last=2n: real audit non-zero"
logedit we "i = max(k for k, l in enumerate(L) if ' WRAPPER_EXIT ' in l); L[i] = re.sub(r'rc=\S+', 'rc=7', L[i])"; chk_real we "final WRAPPER_EXIT rc=7: real audit non-zero"
tamper wsf; echo $(( $(cat "$TEST_TMP/t-wsf/window.start") - 3600000 )) >"$TEST_TMP/t-wsf/window.start"; chk_real wsf "T:WINDOW_START.row WINDOW_START file disagrees with the row: real audit non-zero"
logedit ob "i = next(k for k, l in enumerate(L) if ' ORDER ' in l); o = L[i]; fid = o.split()[2]; del L[i]; s = next(k for k, l in enumerate(L) if ' START ' + fid + ' ' in l); L.insert(s + 1, L[s].split(' ')[0] + ' ' + o.split(' ', 1)[1])"
chk_real ob "T:ORDER.position ORDER before START violated (ORDER row after START): real audit non-zero"; chk_red ob "ORDER position: audit without the strict layers says OK"
logedit vv "i = next(k for k, l in enumerate(L) if ' VERSION ' in l); L[i] = re.sub(r'VERSION (\S+) .*', r'VERSION \1 2.1.0 (Claude Code)', L[i])"; chk_real vv "T:VERSION.value VERSION value is not the pin: real audit non-zero"
logedit pok "i = next(k for k, l in enumerate(L) if ' PROBE_OK ' in l); L[i] = re.sub(r'cost=\S+', 'cost=0.500000', L[i])"; chk_real pok "T:PROBE_OK.cost PROBE_OK cost differs from the saved response: real audit non-zero"
rfedit() { tamper "$1" "$RF"; python3 - "$TEST_TMP/t-$1/invocation.log" "$2" <<'PY'
import sys, re
p, code = sys.argv[1:3]; L = open(p).read().split('\n')
exec(code); open(p, 'w').write('\n'.join(L))
PY
}
rfedit pfrc "i = next(k for k, l in enumerate(L) if ' PROBE_FAIL ' in l); L[i] = re.sub(r'rc=\S+', 'rc=9', L[i])"
FB="$RF" afail "$TEST_TMP/t-pfrc" "T:PROBE_FAIL.rc PROBE_FAIL rc differs from the saved response: real audit non-zero"
rfedit paus "L[:] = [l for l in L if ' PAUSE ' not in l]"
FB="$RF" afail "$TEST_TMP/t-paus" "T:PAUSE.row PAUSE row removed (count differs from the PROBE_FAIL count): real audit non-zero"
logedit ccm "i = next(k for k, l in enumerate(L) if ' COSTCHK ' in l); L[i] = re.sub(r'stage=\S+', 'stage=post5', L[i])"; chk_real ccm "T:COSTCHK.stage COSTCHK metadata (stage) differs from the recomputed value: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-costchkmeta/run-p2-batch.js" "$TEST_TMP/t-ccm")" 0 "RED COSTCHK metadata: mutant says OK"
logedit ccc "i = next(k for k, l in enumerate(L) if ' COSTCHK ' in l); L[i] = re.sub(r'cap=\S+', 'cap=99', L[i])"; chk_real ccc "T:COSTCHK.cap COSTCHK metadata (cap) differs from the manifest: real audit non-zero"
logedit cca "i = next(k for k, l in enumerate(L) if ' COST ON-' in l); L[i] = L[i].replace('arm=ON', 'arm=C', 1)"; chk_real cca "T:COST.arm COST arm differs from the seeded arm: real audit non-zero"
logedit tur "i = next(k for k, l in enumerate(L) if ' TURNS ON-' in l); L[i] = L[i].replace('arm=ON', 'arm=C', 1)"; chk_real tur "T:TURNS.arm TURNS arm differs from the seeded arm: real audit non-zero"
logedit trm "L.insert(len(L) - 2, L[-3].split(' ')[0] + ' STOP_COST before C-01 projected=99')"; chk_real trm "terminal row STOP_COST present: real audit non-zero"
logedit unk "L.insert(len(L) - 2, L[-3].split(' ')[0] + ' ZZZ something')"; chk_real unk "unknown row kind ZZZ: real audit non-zero"; chk_red unk "unknown row kind: audit without the strict layers says OK"
logedit gar "L.insert(len(L) - 2, 'garbage without a timestamp')"; chk_real gar "unknown row kind (an unparseable line): real audit non-zero"
tamper tsu; printf 'ZZ-01\t0\t0.100000\tok\n' >>"$TEST_TMP/t-tsu/probes.tsv"; chk_real tsu "probes.tsv unknown id: real audit non-zero"; chk_red tsu "probes.tsv unknown id: audit without the strict layers says OK"
tamper rex; mkdir "$TEST_TMP/t-rex/runs/EXTRA"; chk_real rex "extra entry in runs/: real audit non-zero"; chk_red rex "extra entry in runs/: mutant says OK"
tamper gjc; GJ=$(ls "$TEST_TMP"/t-gjc/runs/*/gate.jsonl | head -1); echo '{broken' >>"$GJ"; chk_real gjc "gate.jsonl corrupt line: real audit non-zero"; chk_red gjc "gate.jsonl corrupt line: mutant says OK"
tamper hjc; HJ=$(ls "$TEST_TMP"/t-hjc/runs/ON-*/hook/live/per-turn-gate/*.jsonl | head -1); echo '{broken' >>"$HJ"; chk_real hjc "corrupt hook log line (skipped by the old reader): real audit non-zero"; chk_red hjc "corrupt hook log line: audit without the strict layers says OK"
tamper cx; rm -f "$TEST_TMP/t-cx/cmd/$(ls "$TEST_TMP/t-cx/cmd" | head -1)"; chk_real cx "cmd/ file set is not exactly the expected ids: real audit non-zero"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$R1" >/dev/null 2>&1; assert_neq "$?" 0 "audit without --clone: non-zero"
echo "--- round 11: one tamper per table field"
tt() { local lab="$1" nm="tt_${1//./_}"; logedit "$nm" "$2"; afail "$TEST_TMP/t-$nm" "T:$lab real audit non-zero"; }
tt WRAPPER_START.first "sub(first('WRAPPER_START'), r'first=\S+', 'first=0')"
tt WRAPPER_START.last "sub(first('WRAPPER_START'), r'last=\S+', 'last=99')"
tt WRAPPER_DONE.last "sub(lastidx('WRAPPER_DONE'), r'last=\S+', 'last=5')"
tt WRAPPER_EXIT.rc "sub(lastidx('WRAPPER_EXIT'), r'rc=\S+', 'rc=7')"
tt HASH.name "sub(first('HASH', 'wrapper'), 'HASH wrapper', 'HASH bogus')"
tt HASH.count "i = first('HASH', 'prereg'); L.insert(i + 1, L[i])"
tt HASH.sha256 "sub(first('HASH', 'hook'), r'[0-9a-f]{64}$', 'a' * 64)"
tt PREREG.commit "sub(first('PREREG'), r'PREREG [0-9a-f]{40}', 'PREREG ' + 'b' * 40)"
tt PREREG.time "sub(first('PREREG'), r'(PREREG [0-9a-f]{40}) \S+', r'\1 1990-01-01T00:00:00+00:00')"
tt PREREG.ancestor "sub(first('PREREG'), 'ancestor=yes', 'ancestor=no')"
tt TASKHASH_DIFF.phase "sub(first('TASKHASH_DIFF', 'pre'), 'pre ok', 'mid ok')"
tt TASKHASH_DIFF.verdict "sub(first('TASKHASH_DIFF', 'post'), 'post ok', 'post fail')"
tt ORDER.arm "i = first('ORDER'); L[i] = L[i].replace(' ON pos', ' C pos') if ' ON pos' in L[i] else L[i].replace(' C pos', ' ON pos')"
tt ORDER.pos "sub(first('ORDER'), r'pos=\d+', 'pos=99')"
tt CMD.sha256 "sub(first('CMD'), r'[0-9a-f]{64}$', 'c' * 64)"
tt START.elapsed "sub(first('START'), r'elapsed=\d+', 'elapsed=9999')"
tt COSTCHK.arm "i = first('COSTCHK'); L[i] = L[i].replace('arm=ON', 'arm=C', 1) if 'arm=ON' in L[i] else L[i].replace('arm=C', 'arm=ON', 1)"
tt COSTCHK.projected "sub(first('COSTCHK'), r'projected=\S+', 'projected=0.0001')"
tt COSTCHK.verdict "sub(first('COSTCHK'), r' ok$', ' stop')"
tt COST.running "sub(first('COST'), r'running=\S+', 'running=0.1')"
tt COST.projected "sub(first('COST'), r'projected=\S+', 'projected=0.1')"
tt SCORE.m1 "sub(first('SCORE'), r'm1=(\d)', lambda m: 'm1=%d' % (1 - int(m.group(1))))"
tt SCORE.m2 "sub(first('SCORE'), r'm2=(\d)', lambda m: 'm2=%d' % (1 - int(m.group(1))))"
tt SCORE.m3 "sub(first('SCORE'), r'm3=(\d)', lambda m: 'm3=%d' % (1 - int(m.group(1))))"
tt RUNVERSION.flag "sub(first('RUNVERSION'), r'(RUNVERSION \S+) ok', r'\1 fail')"
tt HOOKCOUNT.gate_log "sub(first('HOOKCOUNT', 'ON-'), r'gate_log=(\d+)', lambda m: 'gate_log=%d' % (int(m.group(1)) + 1))"
tt HOOKERR.n "sub(first('HOOKERR', 'ON-'), r' 0$', ' 1')"
tt COMPLETE.n "sub(lastidx('COMPLETE'), r'ON=(\d+)/\d+', lambda m: 'ON=%s/9' % m.group(1))"
tamper hcp; echo 'Hooks: Stop [node x/other-plugin.js] finished with status 0 (3ms)' >>"$(ls "$TEST_TMP"/t-hcp/trace/ON-*/trace-turn1.log | head -1)"
afail "$TEST_TMP/t-hcp" "T:HOOKCOUNT.plugin real audit non-zero"
# PROBE_FAIL.cost and SCORE_MISSING.id need a batch that has those rows
rfedit pfco "i = next(k for k, l in enumerate(L) if ' PROBE_FAIL ' in l); L[i] = re.sub(r'cost=\S+', 'cost=0.700000', L[i])"
FB="$RF" afail "$TEST_TMP/t-pfco" "T:PROBE_FAIL.cost PROBE_FAIL cost differs from the saved response: real audit non-zero"
rfedit pfid "i = next(k for k, l in enumerate(L) if ' PROBE_FAIL ' in l); t = L[i].split(' '); t[2] = 'ZZ-99'; L[i] = ' '.join(t)"
FB="$RF" afail "$TEST_TMP/t-pfid" "T:PROBE_FAIL.id PROBE_FAIL names an id outside the expected set: real audit non-zero"
endrc_case smi 124 missing lower; python3 - "$TEST_TMP/t-smi/invocation.log" <<'PY'
import sys
p = sys.argv[1]; L = open(p).read().split('\n'); i = next(k for k, l in enumerate(L) if ' SCORE_MISSING ' in l); t = L[i].split(' '); t[2] = 'ZZ-99'; L[i] = ' '.join(t); open(p, 'w').write('\n'.join(L))
PY
afail "$TEST_TMP/t-smi" "T:SCORE_MISSING.id real audit non-zero"
# id fields: the first row of each kind gets an id outside the expected set
idtest() { local k="$1" nm="idt_$1"; logedit "$nm" "i = first('$k'); t = L[i].split(' '); t[2] = 'ZZ-99'; L[i] = ' '.join(t)"; afail "$TEST_TMP/t-$nm" "T:$k.id real audit non-zero"; }
for k in ORDER VERSION PROBE_OK CMD START END COSTCHK COST SCORE TURNS RUNVERSION MODEL HOOKCOUNT HOOKERR BLOCKMAX; do idtest $k; done
# the three new file-level cases of this round
tamper rt; RL=$(ls "$TEST_TMP"/t-rt/runs/*/run.log | head -1); echo '{"type":"result","total_cost_usd":999, BROKEN' >>"$RL"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-rt")" 0 "run.log truncated result object: real audit non-zero"
tamper rj; RJ=$(ls "$TEST_TMP"/t-rj/runs/*/result.json | head -1); head -c 40 "$RJ" >"$RJ.cut"; mv "$RJ.cut" "$RJ"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-rj")" 0 "result.json truncated: real audit non-zero"
tamper gja; GJ=$(ls "$TEST_TMP"/t-gja/runs/*/gate.jsonl | head -1); echo '[]' >>"$GJ"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-gja")" 0 "gate.jsonl corrupt line: a JSON array line is rejected"
# COSTCHK spent: first spent 0 -> 1 with projected raised to match (the claimed value must not be trusted)
logedit csp "i = first('COSTCHK'); sub(i, r'spent=\S+', 'spent=1.0000'); sub(i, r'projected=\S+', 'projected=1.0166')"
afail "$TEST_TMP/t-csp" "T:COSTCHK.spent real audit non-zero (claimed spent and projected raised together)"
logedit csp2 "i = [k for k, l in enumerate(L) if ' COSTCHK ' in l][1]; sub(i, r'spent=(\S+)', lambda m: 'spent=%.4f' % (float(m.group(1)) + 0.02)); sub(i, r'projected=(\S+)', lambda m: 'projected=%.4f' % (float(m.group(1)) + 0.02))"
afail "$TEST_TMP/t-csp2" "T:COSTCHK.spent real audit non-zero (later row off by 0.02)"
SPM="$TEST_TMP/mut-costchkspent/run-p2-batch.js"
assert_eq "$(audit_rc "$TEST_TMP/mut-costraw/run-p2-batch.js" "$TEST_TMP/t-csp")" 0 "RED COSTCHK spent from the claimed value: mutant says OK"
# HASH rows: a second row of one kind with the actual value is fine only with a second invocation
tt HASH.second_row_wrong "i = first('HASH', 'prereg'); t = L[i].split(' '); L.insert(i + 1, ' '.join(t[:3]) + ' ' + 'd' * 64)"

echo "--- round 11b: the real CLI's trace/<id>/latest symlink"
mk_mut countlatest "if (f === 'latest') { out.latest = st; continue; }" "if (f === 'latest') { out.regular.push(f); continue; }"
mk_mut nolatestchk "if (tf.latest && !tf.latestOk) f.push(" "if (false) f.push("
assert_eq "$(audit_rc "$WRAP" "$R1")" 0 "latest symlink present in every trace dir (fake CLI makes it): real audit OK"
assert_neq "$(audit_rc "$TEST_TMP/mut-countlatest/run-p2-batch.js" "$R1")" 0 "RED latest counted as a trace file: audit of a good batch fails (the old behaviour)"
tamper lt1; LD=$(ls -d "$TEST_TMP"/t-lt1/trace/*/ | head -1); ln -sfn "$(ls "$LD"trace-turn*.log | head -1)" "${LD}latest"
LN=$(ls "$LD"trace-turn*.log | wc -l); [ "$LN" -gt 1 ] && assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-lt1")" 0 "trace latest symlink to the wrong file: real audit non-zero" || echo "single trace file: wrong-target case skipped"
tamper lt2; LD=$(ls -d "$TEST_TMP"/t-lt2/trace/*/ | head -1); rm "${LD}latest"; cp "$(ls "$LD"trace-turn*.log | tail -1)" "${LD}latest"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-lt2")" 0 "trace latest is a regular file, not a symlink: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-nolatestchk/run-p2-batch.js" "$TEST_TMP/t-lt2")" 0 "RED trace latest as a regular file: mutant without the latest check says OK"
tamper lt3; LD=$(ls -d "$TEST_TMP"/t-lt3/trace/*/ | head -1); : >"${LD}other.txt"
assert_neq "$(audit_rc "$WRAP" "$TEST_TMP/t-lt3")" 0 "trace dir with another name: real audit non-zero"

echo "--- round 11c: VERSION position and count, TASKHASH_DIFF tail"
mk_mut verpos "cc < vr && vr < Math.min(...pr) &&" "cc < vr &&" "const cc = one('COSTCHK'), vr = one('VERSION')," "const cc = one('COSTCHK'), vr = (of('VERSION')[0]),"
mk_mut tdtail "re: /^(pre|post) (ok|fail)\$/" "re: /^(pre|post) (ok|fail)(?: .*)?\$/"
logedit vmove "i = first('VERSION', 'ON-01' if any(' VERSION ON-01 ' in l for l in L) else ''); j = first('PROBE_OK'); row = L.pop(i); j = first('PROBE_OK') + 1; row = L[j - 1].split(' ')[0] + ' ' + ' '.join(row.split(' ')[1:]); L.insert(j, row)"
afail "$TEST_TMP/t-vmove" "T:VERSION.position VERSION moved after the first PROBE: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-verpos/run-p2-batch.js" "$TEST_TMP/t-vmove")" 0 "RED VERSION after PROBE: mutant without the position check says OK"
logedit vdup "i = first('VERSION'); L.insert(i + 1, L[i])"
afail "$TEST_TMP/t-vdup" "T:VERSION.position a second VERSION row for one id: real audit non-zero"
logedit tdtail "i = first('TASKHASH_DIFF', 'pre'); L[i] = L[i] + ' trailing words'"
afail "$TEST_TMP/t-tdtail" "T:TASKHASH_DIFF.tail text after ok: real audit non-zero"
assert_eq "$(audit_rc "$TEST_TMP/mut-tdtail/run-p2-batch.js" "$TEST_TMP/t-tdtail")" 0 "RED TASKHASH_DIFF tail: mutant with the open regex says OK"

echo "--- round 12: the log as a grammar, trace readability"
mkdir -p "$TEST_TMP/mut-prev2"; git -C "$REPO_ROOT" show a30300a4ae22a3a7974ec4ec0a5ded48034faa5e:evals/orchestration/run-p2-batch.js >"$TEST_TMP/mut-prev2/run-p2-batch.js" || fail "round 12 wrapper unavailable"
mkdir -p "$TEST_TMP/mut-prev"; git -C "$REPO_ROOT" show 51f8c73eca73232cdb37c77717bc1fbaf62dc784:evals/orchestration/run-p2-batch.js >"$TEST_TMP/mut-prev/run-p2-batch.js" || fail "previous wrapper unavailable"
gedit() { tamper "$1" "${3:-$R1}"; python3 - "$TEST_TMP/t-$1/invocation.log" "$2" <<'PY'
import sys, re
p, code = sys.argv[1:3]; L = open(p).read().split('\n')
def idx(k, pref=''): return [j for j, l in enumerate(L) if ' %s %s' % (k, pref) in l]
def retime(row, ref): return ref.split(' ')[0] + ' ' + ' '.join(row.split(' ')[1:])
exec(code); open(p, 'w').write('\n'.join(L))
PY
}
# A: the second invocation's PREREG row is forged (the first one is genuine)
gedit gA "i = idx('PREREG')[-1]; L[i] = re.sub(r'PREREG [0-9a-f]{40}', 'PREREG ' + 'e' * 40, L[i])" "$RF"
FB="$RF" afail "$TEST_TMP/t-gA" "T:PREREG.commit the PREREG row of the second invocation is forged: real audit non-zero"
FB="$RF" aud "$TEST_TMP/t-gA" "$TEST_TMP/mut-prev/run-p2-batch.js"; assert_eq "$AUD_RC" 0 "RED forged second PREREG: the previous wrapper (first PREREG row only) says OK (got: $(grep -m1 "AUDIT FAIL" <<<"$AUD_OUT" | cut -c1-120))" 
# B: every HASH row moved to the end of the log (just before the footer)
gedit gB "h = [L[j] for j in idx('HASH')]; L[:] = [l for l in L if ' HASH ' not in l]; e = idx('TASKHASH_DIFF', 'post')[-1]; h = [retime(r, L[e - 1]) for r in h]; L[e:e] = h"
afail "$TEST_TMP/t-gB" "T:HASH.count all HASH rows moved after the last END: real audit non-zero" 'log grammar'
# C: TASKHASH_DIFF post moved before the first call (right after pre)
gedit gC "pp = idx('TASKHASH_DIFF', 'post')[-1]; row = L.pop(pp); q = idx('TASKHASH_DIFF', 'pre')[0]; L.insert(q + 1, retime(row, L[q]))"
afail "$TEST_TMP/t-gC" "TASKHASH_DIFF post moved before the first call: real audit non-zero" 'log grammar'
# D (review): a HASH row re-assigned between two invocations keeps the global count but breaks each header
gedit gD "h = idx('HASH', 'hook'); j = h[-1]; row = L[h[0]]; del L[j]; L.insert(h[0] + 1, row)" "$RF"
FB="$RF" afail "$TEST_TMP/t-gD" "T:HASH.count a HASH row moved from the second invocation to the first: real audit non-zero" 'log grammar'
FB="$RF" aud "$TEST_TMP/t-gD" "$TEST_TMP/mut-prev/run-p2-batch.js"; assert_eq "$AUD_RC" 0 "RED HASH re-assignment: the previous wrapper (positional rules only) says OK (got: $(grep -m1 "AUDIT FAIL" <<<"$AUD_OUT" | cut -c1-120))"
FB="$R1" aud "$TEST_TMP/t-gC" "$TEST_TMP/mut-prev/run-p2-batch.js"; assert_eq "$AUD_RC" 0 "RED TASKHASH_DIFF post moved: the previous wrapper (positional rules only) says OK (got: $(grep -m1 "AUDIT FAIL" <<<"$AUD_OUT" | cut -c1-120))"
FB="$R1" aud "$TEST_TMP/t-gB" "$TEST_TMP/mut-prev/run-p2-batch.js"; assert_eq "$AUD_RC" 0 "RED HASH rows at the end: the previous wrapper (positional rules only) says OK (got: $(grep -m1 "AUDIT FAIL" <<<"$AUD_OUT" | cut -c1-120))"
# unreadable trace file (chmod 000): not counted, and the audit fails
tamper tu; TU=$(ls "$TEST_TMP"/t-tu/trace/ON-*/trace-turn*.log | head -1); chmod 000 "$TU"
afail "$TEST_TMP/t-tu" "a trace file that cannot be read: real audit non-zero" 'unreadable'
chmod 600 "$TU"
tamper tu2; for f in "$TEST_TMP"/t-tu2/trace/C-01/trace-turn*.log; do chmod 000 "$f"; done
afail "$TEST_TMP/t-tu2" "every trace file of one id unreadable: real audit non-zero" 'unreadable|no readable'
for f in "$TEST_TMP"/t-tu2/trace/C-01/trace-turn*.log; do chmod 600 "$f"; done

echo "--- round 13: WRAPPER_DONE ends the batch"
HDRPY="s0 = idx('WRAPPER_START')[0]; pre = idx('TASKHASH_DIFF', 'pre')[0]; hdr = [l for l in L[s0:pre + 1] if ' WINDOW_START' not in l]"
# 1 DONE after only some of the ids, then a second invocation finishes the rest
gedit gE "$HDRPY; b = idx('BLOCKMAX')[0] + 1; ref = L[b - 1]; ins = [retime(r, ref) for r in ['x WRAPPER_DONE last=2', 'x TASKHASH_DIFF post ok', 'x COMPLETE ON=0/3 C=0/3', 'x WRAPPER_EXIT rc=0'] + hdr]; L[b:b] = ins"
afail "$TEST_TMP/t-gE" "WRAPPER_DONE after only some of the ids: real audit non-zero" 'WRAPPER_DONE after'
FB="$R1" aud "$TEST_TMP/t-gE" "$TEST_TMP/mut-prev2/run-p2-batch.js"; assert_eq "$AUD_RC" 0 "RED WRAPPER_DONE after part of the ids: the previous grammar (done as a flag) says OK (got: $(grep -m1 'AUDIT FAIL' <<<"$AUD_OUT" | cut -c1-120))"
# 2 a further complete invocation after the DONE invocation
gedit gF "$HDRPY; e = len(L) - 1 if L[-1] == '' else len(L); ref = L[e - 1]; L[e:e] = [retime(r, ref) for r in hdr + ['x WRAPPER_DONE last=6', 'x TASKHASH_DIFF post ok', 'x COMPLETE ON=3/3 C=3/3', 'x WRAPPER_EXIT rc=0']]"
afail "$TEST_TMP/t-gF" "an invocation after the one that ended with WRAPPER_DONE: real audit non-zero" 'after the invocation that ended with WRAPPER_DONE'
FB="$R1" aud "$TEST_TMP/t-gF" "$TEST_TMP/mut-prev2/run-p2-batch.js"; assert_eq "$AUD_RC" 0 "RED invocation after DONE: the previous grammar says OK (got: $(grep -m1 'AUDIT FAIL' <<<"$AUD_OUT" | cut -c1-120))"
# 3 a legal multi-part batch (failed probe, pause, resume) still audits clean
FB="$RF" aud "$RF"; assert_eq "$AUD_RC" 0 "legal multi-part batch (PROBE_FAIL, PAUSE, resumed invocation, WRAPPER_DONE last): audit OK"

# every label named in the schema table exists in this file (T:KIND.field, or `idtest KIND` for id fields), every file test text
# exists, every row kind the wrapper writes is listed, and PREREG carries the generated table verbatim
node -e '
const w=require(process.argv[1]),fs=require("fs");const t=fs.readFileSync(process.argv[2],"utf8");
const table=w.schemaTable();let bad=0;
for(const m of table.matchAll(/`(T:([A-Z_]+)\.([^`]+))`/g)){const [,label,kind,field]=m;if(!(t.includes(label)||t.includes("tt "+kind+"."+field)||(field==="id"&&new RegExp("for k in [^;]*\\b"+kind+"\\b[^;]*; do idtest").test(t)))){console.error("test missing:",label);bad++}}
for(const m of table.matchAll(/^\| `[^`]+`(?: \| [^|]*){1} \| `([^`T][^`]*)` \|$/gm)){if(!t.includes(m[1])){console.error("file test text missing:",m[1]);bad++}}
for(const n of ["unknown row kind","terminal row"]){if(!t.includes(n)){console.error("test missing:",n);bad++}}
const kinds=[...fs.readFileSync(process.argv[1],"utf8").matchAll(/ctx\.log\(\x27([A-Z_]+)\x27/g)].map(m=>m[1]);
const known=new Set(w.LOG_SCHEMA.map(e=>e.kind));const fail=new Set(["STOP_COST","STOP_WINDOW","STOP_AUTH","ABORT","REFUSE","COST_INVALID"]);
for(const k of new Set(kinds)){if(!known.has(k)&&!fail.has(k)){console.error("row kind written but not in the table:",k);bad++}}
const prereg=fs.readFileSync(process.argv[3],"utf8");if(!prereg.includes(table)){console.error("PREREG appendix differs from --schema-table");bad++}
process.exit(bad?1:0)' "$WRAP_SRC" "$0" "$REPO_ROOT/docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/PREREG.md"; assert_eq "$?" 0 "schema table: every row kind is listed, every field has its test, PREREG carries the table"

echo "--- round 14: credential source, the auto-resume launcher, a model other than haiku-4-5"
mkcred() { node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({claudeAiOauth:{accessToken:"x",expiresAt:Date.now()+Number(process.argv[2])*60000}}))' "$1" "$2"; chmod 600 "$1"; }
mkcred "$TEST_TMP/cred-soon.json" 5; mkcred "$TEST_TMP/cred-fresh.json" 120
RX="$TEST_TMP/run-expiring"
RUN_ARGS="--credentials-source $TEST_TMP/cred-soon.json" run_batch "$WRAP" "$MAN" "$RX"; assert_eq "$?" 7 "source token 5 minutes from expiry: the first id pauses (exit 7)"
assert_file_absent "$RX/runs/$(echo "$O1" | sed -n 1p | cut -d' ' -f2)"
assert_eq "$(grep -c ' PROBE_FAIL ' "$RX/invocation.log")" 1 "expiring source: one PROBE_FAIL row"
assert_contains "$(cat "$RX"/probes/*-1.json)" "source_token_expiring" "expiring source: the saved response names the reason"
RUN_ARGS="--credentials-source $TEST_TMP/cred-fresh.json" KEEP_STATE=1 run_batch "$WRAP" "$MAN" "$RX"; assert_eq "$?" 0 "fresh source: the paused batch resumes and completes"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$RX" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/rx-audit.out" 2>&1; assert_eq "$?" 0 "paused-on-expiry then resumed batch: audit OK ($(head -c 150 "$TEST_TMP/rx-audit.out"))"
RUN_ARGS="--credentials-source $TEST_TMP/cred-soon.json" run_batch "$TEST_TMP/mut-noexpiry/run-p2-batch.js" "$MAN_NOEXP" "$TEST_TMP/run-noexp"; assert_neq "$?" 7 "RED expiring source: the mutant without the expiry check does not pause"
# the launcher
LOOP="$REPO_ROOT/evals/orchestration/run-p2-batch-loop.js"
loop_run() { # <run-dir> <cred> [extra loop args]; fake claude on PATH, real HOME unused (credentials via --credentials-source)
  local d="$1" c="$2"; shift 2; [ -n "${KEEP_STATE:-}" ] || rm -rf "$FAKE_STATE_DIR"; mkdir -p "$FAKE_STATE_DIR"
  env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 ORCH_TIMEOUT=1m FAKE_MODEL="${FAKE_MODEL:-}" \
    node "$LOOP" --manifest "${LMAN:-$MAN}" --run-dir "$d" --clone "$CLONE" --credentials-source "$c" --wrapper "${LWRAP:-$WRAP}" --poll-s 0.2 "$@" >"$d.loop.out" 2>"$d.loop.err" </dev/null
}
RL1="$TEST_TMP/run-loop1"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-loop.json"
( sleep 2; mkcred "$TEST_TMP/cred-loop.json" 120 ) &
loop_run "$RL1" "$TEST_TMP/cred-loop.json"; assert_eq "$?" 0 "launcher: pause on an expiring source, restart once the source is fresh, batch completes"
wait
assert_contains "$(cat "$RL1/loop.status")" "ended rc=0" "launcher: final status line"
assert_eq "$(grep -c ' PAUSE ' "$RL1/invocation.log")" 1 "launcher: one pause was written"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$RL1" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/rl1-audit.out" 2>&1; assert_eq "$?" 0 "launcher batch: audit OK ($(head -c 150 "$TEST_TMP/rl1-audit.out"))"
# window nearly used up: stops instead of restarting
RL2="$TEST_TMP/run-loop2"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-loop2.json"
loop_run "$RL2" "$TEST_TMP/cred-loop2.json" --min-window-s 999999; assert_eq "$?" 9 "launcher: window left below the minimum: stops with exit 9"
assert_contains "$(cat "$RL2/loop.status")" "window_exhausted" "launcher: status says the window is exhausted"
assert_eq "$(grep -c ' WRAPPER_START ' "$RL2/invocation.log")" 1 "launcher: no restart when the window is short"
# a wrapper exit other than 7 is final
RL3="$TEST_TMP/run-loop3"; mkdir -p "$RL3/runs/$(echo "$O1" | sed -n 1p | cut -d' ' -f2)"
loop_run "$RL3" "$TEST_TMP/cred-fresh.json"; LRC=$?
assert_neq "$LRC" 0 "launcher: a wrapper refusal ends the loop non-zero"
assert_contains "$(cat "$RL3/loop.status")" "ended rc=" "launcher: the status records the final rc"
assert_eq "$(grep -c ' WRAPPER_START ' "$RL3/invocation.log")" 1 "launcher: no second run after a non-7 exit"
# restart limit
RL4="$TEST_TMP/run-loop4"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-loop4.json"
loop_run "$RL4" "$TEST_TMP/cred-loop4.json" --fresh-min 0 --max-restarts 1; assert_eq "$?" 9 "launcher: restart limit reached: exit 9"
assert_contains "$(cat "$RL4/loop.status")" "restart_limit" "launcher: status says the restart limit"
# negative controls for the launcher: a copy that ignores the window, and one that restarts after any exit code
mkdir -p "$TEST_TMP/mut-loopwin" "$TEST_TMP/mut-loopany"; cp "$LOOP" "$TEST_TMP/mut-loopwin/l.js"; cp "$LOOP" "$TEST_TMP/mut-loopany/l.js"
mutate "$TEST_TMP/mut-loopwin/l.js" "if (windowLeftS() < Number(o['min-window-s'])) { status(\`stopped window_exhausted left_s=\${Math.floor(windowLeftS())}\`); return 9; }
      const exp" "const exp" || fail "loopwin mutant"
mutate "$TEST_TMP/mut-loopwin/l.js" "    if (windowLeftS() < Number(o['min-window-s'])) { status(\`stopped window_exhausted left_s=\${Math.floor(windowLeftS())}\`); return 9; }
    restarts++;" "    restarts++;" || fail "loopwin mutant 2"
mutate "$TEST_TMP/mut-loopany/l.js" "if (rc !== 7) {" "if (rc === 0) {" || fail "loopany mutant"
RL5="$TEST_TMP/run-loop5"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-loop5.json"
LOOP="$TEST_TMP/mut-loopwin/l.js" loop_run "$RL5" "$TEST_TMP/cred-loop5.json" --min-window-s 999999 --fresh-min 0 --max-restarts 1 >/dev/null 2>&1
assert_eq "$(grep -c ' WRAPPER_START ' "$RL5/invocation.log")" 2 "RED window: the launcher without the window check restarts although the window is short"
RL6="$TEST_TMP/run-loop6"; mkdir -p "$RL6/runs/$(echo "$O1" | sed -n 1p | cut -d' ' -f2)"
LOOP="$TEST_TMP/mut-loopany/l.js" loop_run "$RL6" "$TEST_TMP/cred-fresh.json" --fresh-min 0 --max-restarts 1 >/dev/null 2>&1
assert_eq "$(grep -c ' WRAPPER_START ' "$RL6/invocation.log")" 2 "RED exit code: the launcher that restarts after any exit code runs the wrapper twice"
# a model other than haiku-4-5 follows the manifest everywhere
R55="$TEST_TMP/run-m55"; FAKE_MODEL=claude-haiku-5-5 run_batch "$WRAP" "$MAN_M55" "$R55"; assert_eq "$?" 0 "manifest model claude-haiku-5-5: the batch completes"
assert_contains "$(cat "$R55"/cmd/ON-*.json | head -1)" "claude-haiku-5-5" "harness argv carries the manifest model"
assert_eq "$(grep -c ' MODEL .* claude-haiku-5-5$' "$R55/invocation.log")" 6 "MODEL rows carry the resolved haiku-5-5 id"
node "$WRAP" --audit --manifest "$MAN_M55" --run-dir "$R55" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/r55-audit.out" 2>&1; assert_eq "$?" 0 "haiku-5-5 batch: audit OK ($(head -c 150 "$TEST_TMP/r55-audit.out"))"

finalize_test
