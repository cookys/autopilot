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
const { makeFixture, DUAL_OK, R429 } = require('./lib/account-fixtures/shim-install.js');

const SCRIPT = path.join(__dirname, 'measure-streamjson-equivalence.js');
const cli = (args, env) => spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8', env: env || process.env });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bl0372-t-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const snap = (alias, pct) => ({ schema: 'codeforge.quota/1', alias, root: null, written_at_ms: Date.now(), five_hour: { pct, resets_at: Math.floor(Date.now() / 1000) + 3600 } });

test('selftest: R1-R13 all red, the R10 positive control green, exit 0', () => {
  const r = cli(['selftest']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R11', 'R12', 'R13', 'R10_undeclared_field']) assert.match(r.stdout, new RegExp(`^${id}: red$`, 'm'));
  assert.match(r.stdout, /^R10: green$/m);
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
    extra_key: (d) => M.mutateS(d, (e, t) => (e === 'stdout' ? t.replace(/\}\n$/, ',"model_usage_since_last_result":{}}\n') : t)),
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
  let a = analyze(d); assert.strictEqual(a.r.status, 6); assert.ok(a.report.inconclusive_reasons.includes('P1a:incomplete')); rm(d);
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

test('run via the claude shim: purpose registered, files written, no token anywhere, resume skips finished runs, analyze PASS', () => {
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

test('run gates with zero calls: codepower alias, utilization 0.85, unknown quota', () => {
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
