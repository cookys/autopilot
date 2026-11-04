#!/usr/bin/env node
'use strict';
// BL-0372 Task 2: the measurement instrument. Every test runs with ZERO real claude calls: `run` goes through the claude shim only.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const M = require('./measure-streamjson-equivalence.js');
const { makeFixture, DUAL_OK, R429, R401 } = require('./lib/account-fixtures/shim-install.js');

const SCRIPT = path.join(__dirname, 'measure-streamjson-equivalence.js');
const cli = (args, env) => spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8', env: env || process.env });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bl0372-t-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const snap = (alias, pct) => ({ schema: 'codeforge.quota/1', alias, root: null, written_at_ms: Date.now(), five_hour: { pct, resets_at: Math.floor(Date.now() / 1000) + 3600 } });

test('selftest: R1-R13 all red, the R10 positive control green, exit 0', () => {
  const r = cli(['selftest']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  for (const id of ['J8_NESTED_WRONG_ID', 'J9_USAGE_MISMATCH', 'ADD_SECOND_KEY', 'MASK_PATH', 'PARTIAL_NEVER_PASS', 'BLOCK_FAILS', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R11', 'R12', 'R13', 'R10_undeclared_field']) assert.match(r.stdout, new RegExp(`^${id}: red$`, 'm'));
  assert.match(r.stdout, /^R10: green$/m);
  assert.match(r.stdout, /^ADD_POSITIVE: green$/m);
});

test('selftest with a hetero script whose marker is gone exits 3 (ExtractError is an instrument failure, not a usage error)', () => {
  const d = tmp();
  const copy = path.join(d, 'h.sh');
  fs.writeFileSync(copy, fs.readFileSync(path.join(__dirname, 'dispatch-hetero.sh'), 'utf8').replace(M.HETERO_MARKERS.log, 'removed'));
  const r = cli(['selftest', '--hetero-script', copy]);
  assert.strictEqual(r.status, 3, r.stdout + r.stderr);
  rm(d);
});

test('plan: 56 calls for the four default profiles, zero calls made, J first in odd pairs', () => {
  const r = cli(['plan', '--json']);
  assert.strictEqual(r.status, 0);
  const p = JSON.parse(r.stdout);
  assert.strictEqual(p.calls, 56);
  const p1 = p.runs.filter((x) => x.profile === 'P1a' && x.kind === 'js').map((x) => `${x.pairId}${x.arm}`);
  assert.deepStrictEqual(p1.slice(0, 4), ['p1J', 'p1S', 'p2S', 'p2J']);
  const s = p.runs.find((x) => x.profile === 'P1a' && x.arm === 'S').argv;
  assert.ok(s.includes('stream-json') && s.includes('--verbose'));
  assert.strictEqual(p.runs.find((x) => x.profile === 'P1b' && x.pairId === 'p3' && x.arm === 'J').argv.includes('--max-budget-usd'), true);
  assert.strictEqual(cli(['plan', '--profiles', 'ERR']).stdout.split('\n')[0], 'calls: 2');
});

test('plan argv-difference assertion: a handmade bad argv fails (negative control), a good one passes', () => {
  const j = M.buildArgv('P2', 'json', 'p1', 'J').argv;
  const s = M.buildArgv('P2', 'stream-json', 'p1', 'S').argv;
  M.assertArgvDiff(j, s);
  assert.throws(() => M.assertArgvDiff(j, s.concat(['--debug'])), /argv_difference/);
  assert.throws(() => M.assertArgvDiff(j, s.map((x) => (x === 'haiku' ? 'sonnet' : x))), /argv_difference/);
});

test('maskRaw: masks only declared volatile values, keeps every other byte and the key order', () => {
  const t = '{"a": 1,\n "duration_ms":12, "usage":{"input_tokens":5,"tier":"std"},"result":"\\n\\nOK","uuid":"x","type":"result"}\n';
  assert.strictEqual(M.maskRaw(t), '{"a": 1,\n "duration_ms":"<number>", "usage":{"input_tokens":"<number>","tier":"std"},"result":"\\n\\nOK","uuid":"<string>","type":"result"}\n');
  assert.throws(() => M.maskRaw('{bad'), /mask_unparsable/);
});

function dataset(opts, mut) { const d = tmp(); M.writeDataset(d, opts); if (mut) mut(d); return d; }
// The selftest takes ~13 s; compute it once and hand its result to every analyze call (its own test runs the real command).
let STFILE = null;
function stfile() {
  if (!STFILE) { STFILE = path.join(tmp(), 'st.json'); fs.writeFileSync(STFILE, JSON.stringify(M.runSelftest({}))); }
  return STFILE;
}
function analyze(d, extra) { const out = path.join(d, 'report.json'); const r = cli(['analyze', '--in', d, '--out', out, '--negative-controls-file', stfile()].concat(extra || [])); return { r, report: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null, out }; }

test('analyze: identical arms PASS (exit 0), deterministic report, negative controls recorded', () => {
  const d = dataset();
  const a = analyze(d);
  assert.strictEqual(a.r.status, 0, a.r.stdout + a.r.stderr);
  assert.strictEqual(a.report.verdict, 'PASS');
  assert.strictEqual(a.report.profiles.P1a.layer2.result, 'identical_after_mask');
  assert.strictEqual(a.report.profiles.P1a.stream.system_init_present, true);
  assert.strictEqual(a.report.negative_controls.R1, 'red');
  const first = fs.readFileSync(a.out, 'utf8');
  analyze(d);
  assert.strictEqual(fs.readFileSync(a.out, 'utf8'), first);
  rm(d);
});

test('analyze: a defect in the data gives FAIL (exit 1), one case per class', () => {
  const cases = {
    num_turns: (d) => M.mutateS(d, (e, t) => (e === 'stdout' ? t.replace(/"num_turns":1/g, '"num_turns":2') : t)),
    stderr: (d) => M.mutateS(d, (e, t) => (e === 'stderr' ? 'x' : t)),
    exit: (d) => M.mutateS(d, (e, t) => (e === 'run.json' ? JSON.stringify(Object.assign(JSON.parse(t), { exit: 1 })) : t)),
    extra_key: (d) => M.mutateS(d, (e, t) => (e === 'stdout' ? t.replace(/\}\n$/, ',"x_undeclared":{}}\n') : t)),
    second_extra_key: (d) => M.mutateS(d, (e, t) => (e === 'stdout' ? t.replace(/\}\n$/, ',"model_usage_since_last_result":{},"x_second":1}\n') : t)),
    session_rewritten: (d) => M.mutateS(d, (e, t) => (e === 'stdout' ? t.replace(/"session_id":"[^"]*"/g, '"session_id":"other"') : t)),
  };
  for (const [name, mut] of Object.entries(cases)) {
    const d = dataset(null, mut);
    const a = analyze(d);
    assert.strictEqual(a.r.status, 1, `${name}: ${a.r.stdout}${a.r.stderr}`);
    assert.strictEqual(a.report.verdict, 'FAIL', name);
    rm(d);
  }
});

test('analyze: B-level change stays PASS; incomplete data and A-level noise in control pairs are INCONCLUSIVE (exit 6)', () => {
  let d = dataset(null, (x) => M.mutateS(x, (e, t) => (e === 'stdout' ? t.replace(/"duration_ms":\d+/g, '"duration_ms":999999') : t)));
  assert.strictEqual(analyze(d).r.status, 0); rm(d);
  d = dataset(null, (x) => fs.unlinkSync(path.join(x, 'P1a', 'p2-S.stdout')));
  let a = analyze(d); assert.strictEqual(a.r.status, 6); assert.ok(a.report.inconclusive_reasons.some((x) => x.startsWith('P1a:missing_artifacts'))); rm(d);
  d = dataset(null, (x) => { const f = path.join(x, 'P1a', 'c1-J2.stdout'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"num_turns":1', '"num_turns":3')); });
  a = analyze(d); assert.strictEqual(a.r.status, 6); assert.ok(a.report.inconclusive_reasons.some((x) => x.includes('a_level')));
  rm(d);
});

test('analyze: a renamed hetero marker stops the instrument (exit 3), it never becomes silently empty', () => {
  const d = dataset();
  const copy = path.join(d, 'hetero.sh');
  fs.writeFileSync(copy, fs.readFileSync(path.join(__dirname, 'dispatch-hetero.sh'), 'utf8').replace(M.HETERO_MARKERS.err, M.HETERO_MARKERS.err.replace('IS_CCSHIM', 'IS_X')));
  const a = analyze(d, ['--hetero-script', copy]);
  assert.strictEqual(a.r.status, 3);
  assert.match(a.r.stderr, /hetero_marker_missing/);
  rm(d);
});

function runEnv(fx) { return Object.assign({}, process.env, fx.env); }
function runArgs(alias, out, extra) { return ['run', '--alias', alias, '--profile', 'P2', '--pairs', '2', '--control-pairs', '1', '--out', out].concat(extra || []); }

test('N9 good: run via the claude shim: purpose registered, files written, no token anywhere, resume skips finished runs, analyze PASS', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.1) }, responses: { a: DUAL_OK } });
  const out = tmp();
  try {
    const r = cli(runArgs('a', out), runEnv(fx));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const runs = fs.readdirSync(path.join(out, 'P2')).filter((x) => x.endsWith('.run.json'));
    assert.strictEqual(runs.length, 6);
    assert.ok(fx.shim.calls().some((c) => c.argv.includes('stream-json')));
    assert.ok(fs.readFileSync(fx.auditFile, 'utf8').includes('"purpose":"streamjson-measure"'));
    const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
    assert.strictEqual(meta.alias, 'a');
    assert.ok(meta.token_path.endsWith('/a/token'));
    const all = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : all.push(fs.readFileSync(path.join(d, e.name), 'utf8'))));
    walk(out);
    assert.ok(!all.join('\n').includes(fx.tokens.a), 'the token value must never reach the output');
    const before = fx.shim.calls().length;
    const again = cli(runArgs('a', out, ['--resume']), runEnv(fx));
    assert.strictEqual(again.status, 0);
    assert.ok(fx.shim.calls().slice(before).every((c) => c.argv.includes('--version')), 'resume must not re-run finished runs');
    const rep = path.join(out, 'report.json');
    const an = cli(['analyze', '--in', out, '--out', rep, '--negative-controls-file', stfile()]);
    assert.strictEqual(an.status, 0, an.stdout + an.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(rep, 'utf8')).profiles.P2.layer2.result, 'identical');
  } finally { fx.cleanup(); rm(out); }
});

test('N9 broken: run gates with zero calls: codepower alias, utilization 0.85, unknown quota', () => {
  const out = tmp();
  try {
    let fx = makeFixture({ aliases: [{ alias: 'codepower-x' }], snapshots: { 'codepower-x': snap('codepower-x', 0.1) } });
    assert.notStrictEqual(cli(runArgs('codepower-x', out), runEnv(fx)).status, 0);
    assert.strictEqual(fx.shim.calls().length, 0); fx.cleanup();
    fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.85) } });
    let r = cli(runArgs('a', out), runEnv(fx));
    assert.strictEqual(r.status, 4); assert.strictEqual(fx.shim.calls().length, 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'resume.json'), 'utf8')).status, 'skipped_near_cap'); fx.cleanup();
    fx = makeFixture({ aliases: [{ alias: 'a' }] }); // no snapshot: unknown
    r = cli(runArgs('a', out), runEnv(fx));
    assert.strictEqual(r.status, 4); assert.strictEqual(fx.shim.calls().length, 0); fx.cleanup();
    fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.5) } });
    assert.strictEqual(cli(runArgs('a', out, ['--max-util', '0.4']), runEnv(fx)).status, 4); // positive control for the knob
    fx.cleanup();
  } finally { rm(out); }
});

test('run stops the whole batch on a 429 (exit 5) and does not retry', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.1) }, responses: { a: R429 } });
  const out = tmp();
  try {
    const r = cli(runArgs('a', out), runEnv(fx));
    assert.strictEqual(r.status, 5, r.stdout + r.stderr);
    assert.strictEqual(fs.readdirSync(path.join(out, 'P2')).filter((x) => x.endsWith('.run.json')).length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'resume.json'), 'utf8')).status, 'aborted');
  } finally { fx.cleanup(); rm(out); }
});

// ---- review round 1 (A1-A8) and the PM additive-key amendment (B)

test('maskRaw: volatile values are masked by declared top-level path only; the additive key is removed byte-exactly', () => {
  const t = '{"duration_ms":1,"permission_denials":[{"duration_ms":2}],"usage":{"n":3},"model_usage_since_last_result":{"m":{"n":4}},"type":"result"}\n';
  assert.strictEqual(M.maskRaw(t), '{"duration_ms":"<number>","permission_denials":[{"duration_ms":2}],"usage":{"n":"<number>"},"model_usage_since_last_result":{"m":{"n":"<number>"}},"type":"result"}\n');
  assert.strictEqual(M.maskRaw(t, { strip: M.ADDITIVE_KEYS }), '{"duration_ms":"<number>","permission_denials":[{"duration_ms":2}],"usage":{"n":"<number>"},"type":"result"}\n');
  assert.deepStrictEqual(M.ADDITIVE_KEYS, ['model_usage_since_last_result']);
  // dropping a first, middle and only member leaves valid JSON with the original separators
  assert.strictEqual(M.maskRaw('{ "model_usage_since_last_result": 1, "a": 2 }', { strip: M.ADDITIVE_KEYS }), '{ "a": 2 }');
  assert.strictEqual(M.maskRaw('{"model_usage_since_last_result":1}', { strip: M.ADDITIVE_KEYS }), '{}');
});

test('analyze: the declared additive key on the stream side only is PASS; a second extra key is FAIL; a path-masking hole is FAIL', () => {
  const add = ',"model_usage_since_last_result":{"claude-haiku-5-5":{"inputTokens":5}}';
  let d = dataset(null, (x) => M.mutateS(x, (e, t) => (e === 'stdout' ? t.replace(/\}\n$/, add + '}\n') : t)));
  let a = analyze(d);
  assert.strictEqual(a.r.status, 0, a.r.stdout + a.r.stderr);
  assert.deepStrictEqual(a.report.profiles.P1a.layer2.additive_keys_removed, ['model_usage_since_last_result']);
  assert.strictEqual(a.report.profiles.P1a.layer1.j8_session_value_self, 'equal');
  assert.strictEqual(a.report.profiles.P1a.layer1.j9_usage_fields, 'equal');
  rm(d);
  d = dataset({ denials: 'vary' }); a = analyze(d); assert.strictEqual(a.report.verdict, 'FAIL'); rm(d);
  d = dataset({ denials: 'same' }); a = analyze(d); assert.strictEqual(a.report.verdict, 'PASS'); rm(d);
});

test('analyze: a stopped or partial batch is INCONCLUSIVE with a reason, never PASS (and never FAIL on partial data)', () => {
  for (const st of ['aborted', 'version_changed', 'running', 'skipped_near_cap']) {
    const d = dataset(null, (x) => fs.writeFileSync(path.join(x, 'resume.json'), JSON.stringify({ status: st, done: [], next: null })));
    const a = analyze(d);
    assert.strictEqual(a.r.status, 6, st);
    assert.ok(a.report.inconclusive_reasons.includes(`resume:${st}`));
    rm(d);
  }
  let d = dataset(null, (x) => fs.unlinkSync(path.join(x, 'P1a', 'expected.json')));
  assert.ok(analyze(d).report.inconclusive_reasons.includes('P1a:no_expected_matrix')); rm(d);
  d = dataset(null, (x) => fs.unlinkSync(path.join(x, 'resume.json')));
  assert.ok(analyze(d).report.inconclusive_reasons.includes('resume:missing')); rm(d);
  // a stop on a ONE-pair batch: only the first arm exists
  d = dataset(null, (x) => {
    const pd = path.join(x, 'P1a');
    for (const f of fs.readdirSync(pd)) if (f !== 'expected.json' && !f.startsWith('p1-J')) fs.unlinkSync(path.join(pd, f));
    fs.writeFileSync(path.join(x, 'resume.json'), JSON.stringify({ status: 'aborted', done: ['P1a/p1-J'], next: null }));
  });
  const a = analyze(d);
  assert.strictEqual(a.report.verdict, 'INCONCLUSIVE');
  rm(d);
});

test('analyze: an extracted consumer that cannot run (markers intact, block broken) is an instrument failure, exit 3', () => {
  const d = dataset();
  const src = fs.readFileSync(path.join(__dirname, 'dispatch-hetero.sh'), 'utf8').split('\n');
  const i = src.findIndex((l) => l.includes(M.HETERO_MARKERS.log));
  src.splice(i + 1, 0, 'process.exit(7);');
  const copy = path.join(d, 'hetero-broken.sh'); fs.writeFileSync(copy, src.join('\n'));
  const a = analyze(d, ['--hetero-script', copy]);
  assert.strictEqual(a.r.status, 3);
  assert.match(a.r.stderr, /hetero_block_failed:log/);
  rm(d);
});

test('run argument guards, all with zero calls: calls above the plan total, bad --max-util, ERR defaults to one pair', () => {
  const out = tmp();
  const fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.1) }, responses: { a: DUAL_OK } });
  try {
    const bad = [['--pairs', '6'], ['--control-pairs', '3'], ['--max-util', 'NaN'], ['--max-util', 'Infinity'], ['--max-util', '0'], ['--max-util', '-1'], ['--max-util', '0.9'], ['--max-util', 'abc']];
    for (const extra of bad) {
      const r = cli(['run', '--alias', 'a', '--profile', 'P2', '--out', out].concat(extra), runEnv(fx));
      assert.strictEqual(r.status, 2, extra.join(' ') + r.stderr);
    }
    assert.strictEqual(cli(['run', '--alias', 'a', '--profile', 'ERR', '--control-pairs', '1', '--out', out], runEnv(fx)).status, 2);
    assert.strictEqual(fx.shim.calls().length, 0);
    // positive controls: the ceiling itself and lowering are accepted; ERR with no flags is exactly 2 calls
    assert.strictEqual(cli(runArgs('a', out, ['--max-util', '0.8']), runEnv(fx)).status, 0);
    const out2 = tmp();
    assert.strictEqual(cli(['run', '--alias', 'a', '--profile', 'ERR', '--out', out2], runEnv(fx)).status, 0);
    assert.strictEqual(fs.readdirSync(path.join(out2, 'ERR')).filter((x) => x.endsWith('.run.json')).length, 2);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out2, 'ERR', 'expected.json'), 'utf8')).ids.length, 2);
    rm(out2);
  } finally { fx.cleanup(); rm(out); }
});

test('the error-path batch obeys the stop rules too: a 429 or an auth failure in ERR stops the whole batch (exit 5)', () => {
  for (const [name, resp] of [['429', R429], ['auth', R401]]) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.1) }, responses: { a: resp } });
    const out = tmp();
    try {
      const r = cli(['run', '--alias', 'a', '--profile', 'ERR', '--out', out], runEnv(fx));
      assert.strictEqual(r.status, 5, `${name}: ${r.stdout}${r.stderr}`);
      assert.strictEqual(fs.readdirSync(path.join(out, 'ERR')).filter((x) => x.endsWith('.run.json')).length, 1, `${name}: second arm must not run`);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'resume.json'), 'utf8')).status, 'aborted');
      const rep = path.join(out, 'report.json');
      const an = cli(['analyze', '--in', out, '--out', rep, '--negative-controls-file', stfile()]);
      assert.strictEqual(an.status, 6, `${name}: an aborted batch is INCONCLUSIVE`);
    } finally { fx.cleanup(); rm(out); }
  }
});

test('a version change mid-run writes meta.json first, then stops with status version_changed (exit 5)', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.1) }, responses: { a: DUAL_OK } });
  const out = tmp();
  try {
    const src = fs.readFileSync(fx.shim.shimPath, 'utf8');
    fs.writeFileSync(fx.shim.shimPath, src.replace('function main() {', "function main() {\n  if (process.argv[2] === '--version') { process.stdout.write('v' + process.hrtime.bigint() + '\\n'); return 0; }"));
    assert.notStrictEqual(fs.readFileSync(fx.shim.shimPath, 'utf8'), src);
    const r = cli(runArgs('a', out, ['--pairs', '5', '--control-pairs', '2']), runEnv(fx));
    assert.strictEqual(r.status, 5, r.stdout + r.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'resume.json'), 'utf8')).status, 'version_changed');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8')).aborted, 'version_changed');
  } finally { fx.cleanup(); rm(out); }
});

test('runs_failed counts runs (the unit of runs_total), not profiles', () => {
  const d = dataset(null, (x) => M.mutateS(x, (e, t, pair) => (e === 'run.json' && pair <= 'p2' ? JSON.stringify(Object.assign(JSON.parse(t), { exit: 1 })) : t)));
  const a = analyze(d);
  assert.strictEqual(a.report.runs_total, 14);
  assert.strictEqual(a.report.runs_failed, 2);
  rm(d);
});

// Runs a mutated copy of the instrument (written to a temp dir, relative requires pointed at scripts/ by absolute path) through the
// real wrapper and the claude shim. Returns what N9 needs to judge: the run result and the shim's calls.
function runMutant(mutate) {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.1) }, responses: { a: DUAL_OK } });
  const out = tmp(); const md = tmp();
  try {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const mutated = mutate(src).split("require('./").join(`require('${__dirname}/`).split('__dirname').join(JSON.stringify(__dirname));
    const mutant = path.join(md, 'mutant.js');
    fs.writeFileSync(mutant, mutated);
    const r = spawnSync(process.execPath, [mutant].concat(runArgs('a', out)), { encoding: 'utf8', env: runEnv(fx) });
    return { src, mutated, r, calls: fx.shim.calls() };
  } finally { fx.cleanup(); rm(out); rm(md); }
}
const dropPurpose = (src) => src.replace("'--purpose', PURPOSE, ", '');
// N9 holds only if ALL THREE are true: (a) the mutation really removed the purpose argument, (b) the wrapper itself refused with its
// purpose_required message, (c) the shim logged at least one call (so the run really reached the claude path and only the purpose broke it).
function n9Problems(m) {
  const p = [];
  if (m.mutated === m.src || m.mutated.includes("'--purpose', PURPOSE")) p.push('mutation_not_applied');
  if (m.r.status === 0) p.push('mutated_run_passed');
  if (!/purpose_required/.test(m.r.stderr)) p.push('no_purpose_required_message');
  if (m.calls.length < 1) p.push('shim_logged_no_call');
  if (!m.calls.every((c) => c.argv.includes('--version'))) p.push('a_model_call_reached_the_shim');
  return p;
}

test('N9 mutation: dropping the purpose from the wrapper call turns the good run red, for the right reason', () => {
  assert.deepStrictEqual(n9Problems(runMutant(dropPurpose)), []);
});

test('N9 mutation: a mutant that crashes at load does not satisfy the check (negative control)', () => {
  const m = runMutant((src) => dropPurpose(src).replace("'use strict';", "'use strict';\nrequire('./does-not-exist-xyz');"));
  assert.notStrictEqual(m.r.status, 0);
  const p = n9Problems(m);
  assert.ok(p.includes('no_purpose_required_message') && p.includes('shim_logged_no_call'), `the crash mutant must fail N9, got ${JSON.stringify(p)}`);
});

test('no mutant or scratch file is left under scripts/', () => {
  const left = fs.readdirSync(__dirname).filter((n) => /mutant|^zz-/.test(n));
  assert.deepStrictEqual(left, []);
});

test('J8 reads the first "session_id" in the line: a wrong id inside the additive object ahead of the top-level one is a FAIL even though layer 2 strips the object', () => {
  const wrong = (t) => t.replace('"stop_reason":"end_turn",', '"stop_reason":"end_turn","model_usage_since_last_result":{"m":{"session_id":"wrong"}},');
  let d = dataset(null, (x) => M.mutateS(x, (e, t) => (e === 'stdout' ? t.split('\n').map((l) => (l.includes('"type":"result"') ? wrong(l) : l)).join('\n') : t)));
  let a = analyze(d);
  assert.strictEqual(a.r.status, 1, a.r.stdout + a.r.stderr);
  assert.strictEqual(a.report.profiles.P1a.layer1.j8_session_value_self, 'differs');
  assert.strictEqual(a.report.profiles.P1a.layer2.result, 'identical_after_mask');
  rm(d);
  // positive control: the same additive object AFTER the top-level id (the shape the CLI really emits) passes
  d = dataset();
  assert.strictEqual(analyze(d).report.verdict, 'PASS');
  rm(d);
});

test('P4 (J8/J9) defaults to 5 J/S + 1 control pair = 12 calls, and a run above that is refused', () => {
  assert.strictEqual(cli(['plan', '--profiles', 'P4']).stdout.split('\n')[0], 'calls: 12');
  assert.strictEqual(cli(['plan', '--profiles', 'P2']).stdout.split('\n')[0], 'calls: 14');
  const out = tmp();
  const fx = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: snap('a', 0.1) }, responses: { a: DUAL_OK } });
  try {
    assert.strictEqual(cli(['run', '--alias', 'a', '--profile', 'P4', '--control-pairs', '2', '--out', out], runEnv(fx)).status, 2);
    assert.strictEqual(fx.shim.calls().length, 0);
    assert.strictEqual(cli(['run', '--alias', 'a', '--profile', 'P4', '--out', out], runEnv(fx)).status, 0);
    assert.strictEqual(fs.readdirSync(path.join(out, 'P4')).filter((x) => x.endsWith('.run.json')).length, 12);
  } finally { fx.cleanup(); rm(out); }
});
