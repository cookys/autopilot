# p2-batch test library: the throwaway clone, mutants, manifests, fake claude and helpers shared by the p2-batch test files.
# Sourced after lib.sh by p2-batch-wrapper.test.sh, p2-batch-loop.test.sh and p2-batch-lifecycle.test.sh.

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
const m = { task: 't14-constraint-horizon', model: process.env.MAN_MODEL || 'claude-haiku-4-5', cli: '2.1.309 (Claude Code)', seed: 'unit-test-seed', n_per_arm: Number(process.env.MAN_N || 3),
  arms: { ON: { gate: 'hook', cap: 30 }, C: { gate: 'observe', cap: 18 } }, probe_cost: 0.0166, window_s: Number(process.env.MAN_WINDOW || 28800), min_complete: Math.min(2, Number(process.env.MAN_N || 3)), max_blocks: 2,
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
mk_mut nocfgunset ".filter((k) => SCRUB_RE.test(k))" ".filter((k) => false)"
mk_mut secondsunit "const CRED_MIN_AHEAD_MS = 10 * 60 * 1000;" "const CRED_MIN_AHEAD_MS = 10 * 60;"
MAN_SECS="$CLONE/prereg/manifest-secs-mutant.json"; make_manifest "$TEST_TMP/mut-secondsunit/run-p2-batch.js" "$MAN_SECS"
MAN_NOCFG="$CLONE/prereg/manifest-nocfg-mutant.json"; make_manifest "$TEST_TMP/mut-nocfgunset/run-p2-batch.js" "$MAN_NOCFG"
mk_mut nopar "const orphan = ctx.parentPid ?" "const orphan = false && ctx.parentPid ?"
MAN_NOPAR="$CLONE/prereg/manifest-nopar-mutant.json"; make_manifest "$TEST_TMP/mut-nopar/run-p2-batch.js" "$MAN_NOPAR"
mk_mut nostop "const stopAsked = (STOP !== null && Atomics.load(STOP, 0) === 1) || fs.existsSync(path.join(ctx.runDir, 'stop.request'));" "const stopAsked = false;"
MAN_NOSTOP="$CLONE/prereg/manifest-nostop-mutant.json"; make_manifest "$TEST_TMP/mut-nostop/run-p2-batch.js" "$MAN_NOSTOP"
mk_mut realver "sh(ctx, [\`HOME=\${vh}\`, 'claude', '--version'])" "sh(ctx, ['claude', '--version'])"
MAN_REALVER="$CLONE/prereg/manifest-realver-mutant.json"; make_manifest "$TEST_TMP/mut-realver/run-p2-batch.js" "$MAN_REALVER"
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
mkdir -p "$TEST_TMP/mut-prevwrap"; git -C "$REPO_ROOT" show 33bf07df4:evals/orchestration/run-p2-batch.js >"$TEST_TMP/mut-prevwrap/run-p2-batch.js" || fail "previous wrapper unavailable"
MAN_PREV="$CLONE/prereg/manifest-prevwrap.json"; make_manifest "$TEST_TMP/mut-prevwrap/run-p2-batch.js" "$MAN_PREV"
mk_mut nowinchk "if (!Number.isFinite(w0) || w0 <= 0) throw new Exit(3, 'ABORT window.start is not a positive number');" ""
MAN_NOWIN="$CLONE/prereg/manifest-nowinchk-mutant.json"; make_manifest "$TEST_TMP/mut-nowinchk/run-p2-batch.js" "$MAN_NOWIN"
MAN_W0="$CLONE/prereg/manifest-window0.json"; MAN_WINDOW=0 make_manifest "$WRAP" "$MAN_W0"
MAN_N1="$CLONE/prereg/manifest-n1.json"; MAN_N=1 make_manifest "$WRAP" "$MAN_N1"
git -C "$CLONE" add -A
# plumbing commit: no commit hooks run in the throwaway clone
TREE=$(git -C "$CLONE" write-tree); COMMIT=$(git -C "$CLONE" commit-tree "$TREE" -m prereg); git -C "$CLONE" update-ref HEAD "$COMMIT"

FAKE_STATE_DIR="$TEST_TMP/fakestate"
run_batch() { # <wrapper> <manifest> <rundir>; FAKE_TASK_EDIT optional
  [ -n "${KEEP_STATE:-}" ] || rm -rf "$FAKE_STATE_DIR"; mkdir -p "$FAKE_STATE_DIR"
  env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 FAKE_TASK_EDIT="${FAKE_TASK_EDIT:-}" FAKE_PROBE_SLEEP="${FAKE_PROBE_SLEEP:-}" FAKE_PROBE_FAIL_ONCE="${FAKE_PROBE_FAIL_ONCE:-}" FAKE_MODEL="${FAKE_MODEL:-}" ORCH_TIMEOUT=1m \
    node "$1" --run --manifest "$2" --run-dir "$3" --clone "$CLONE" ${RUN_ARGS:-} >"$3.stdout" 2>"$3.stderr"
}


O1=$(node "$WRAP" --order --manifest "$MAN")

mkcred() { node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({claudeAiOauth:{accessToken:"x",expiresAt:Date.now()+Number(process.argv[2])*60000}}))' "$1" "$2"; chmod 600 "$1"; }
mkcred "$TEST_TMP/cred-soon.json" 5; mkcred "$TEST_TMP/cred-fresh.json" 120
# the launcher
LOOP="$REPO_ROOT/evals/orchestration/run-p2-batch-loop.js"
loop_run() { # <run-dir> <cred> [extra loop args]; fake claude on PATH, real HOME unused (credentials via --credentials-source)
  local d="$1" c="$2"; shift 2; [ -n "${KEEP_STATE:-}" ] || rm -rf "$FAKE_STATE_DIR"; mkdir -p "$FAKE_STATE_DIR"
  env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 ORCH_TIMEOUT=1m FAKE_MODEL="${FAKE_MODEL:-}" \
    node "$LOOP" --manifest "${LMAN:-$MAN}" --run-dir "$d" --clone "$CLONE" --credentials-source "$c" --wrapper "${LWRAP:-$WRAP}" --poll-s 0.2 "$@" >"$d.loop.out" 2>"$d.loop.err" </dev/null
}
