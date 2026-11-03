#!/usr/bin/env node
'use strict';
// G37 W4 tests (plan 8 W4, N9 for A4 A5 A6 A7 A8): the JS/probe callers go through the account layer when a
// registry exists. Tempdir only, FAKE- tokens, Node claude shim only; no real home, credential or network.
//
// Per caller: (1) good registry -> the shim sees the alias token fingerprint and no decoy read;
// (2) broken registry -> the caller exits non-zero and the shim got zero API-style calls;
// (3) no registry -> the legacy path (no token, no account env, same argv);
// (4) mutation: remove the wiring / fail-open the invalid branch / re-add a decoy credentials copy -> (1)/(2) go red.
// The shim is a copy of scripts/lib/account-fixtures/claude-shim.js; claude-account.js is run as a real subprocess
// with os.userInfo() pinned to the fixture home by a --require preload (so the real home is never consulted).
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { makeFixture } = require('./lib/account-fixtures/shim-install.js');

const REPO = path.resolve(__dirname, '..');
const SCRIPTS = __dirname;
const fpOf = (tok) => crypto.createHash('sha256').update(tok).digest('hex').slice(0, 8);

const PRELOAD_SRC = [
  "const os = require('os');",
  'const orig = os.userInfo;',
  "os.userInfo = function (o) { return Object.assign({}, orig.call(os, o), { homedir: process.env.G37_TEST_REAL_HOME }); };",
].join('\n');

const REVIEW_ENVELOPE = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, result: '{"verdict":"pass","findings":[]}',
  modelUsage: { 'claude-sonnet-4-6': { inputTokens: 1 } },
});
const TODO_STREAM = `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TaskCreate' }] } })}\n`
  + `${JSON.stringify({ type: 'result', result: 'done' })}\n`;
const DIFF = [
  'diff --git a/lib/mod.js b/lib/mod.js', '--- a/lib/mod.js', '+++ b/lib/mod.js', '@@ -1,1 +1,1 @@', '-a', '+b', '',
].join('\n');

/** A fresh world: fixture + preload + caller env. mode: 'good' | 'broken' | 'none'. */
function world(mode, shimStdout) {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  const preload = path.join(fx.root, 'preload.js');
  fs.writeFileSync(preload, PRELOAD_SRC);
  fx.shim.setControl({ default: { exit: 0, stdout: shimStdout } });
  if (mode === 'broken') fs.chmodSync(fx.regFile, 0o644);
  if (mode === 'none') fs.rmSync(fx.regFile);
  const env = Object.assign({}, fx.env, {
    NODE_OPTIONS: `--require ${preload}`,
    G37_TEST_REAL_HOME: fx.realHome,
    G37_DECOY: fx.decoy,
    CALIBRATION_DATA_DIR: path.join(fx.root, 'cal'),
    ENGINE_CAPABILITY_DIR: path.join(fx.root, 'cap'),
    AUTOPILOT_STRIKE_WRITER: 'off',
  });
  delete env.AUTOPILOT_SESSION_ID;
  return { fx, env, mode };
}

/** API-style shim calls: the `--version` probe of the shell rail is not a spend and is excluded. */
const apiCalls = (fx) => fx.shim.calls().filter((c) => !c.argv.includes('--version'));

// ---------------------------------------------------------------- drivers: (scriptsDir, w) -> {code, stderr}

function driveProvider(dir, w) {
  const r = spawnSync(process.execPath, [path.join(dir, 'qualification-review-provider.js')], {
    input: `${JSON.stringify({ schema_version: 1, request_id: 'r1', role: 'reviewer', payload: { format: 'case_content', content: DIFF } })}\n`,
    encoding: 'utf8', timeout: 60000, cwd: w.fx.root,
    env: Object.assign({}, w.env, {
      QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'claude', QRP_CLI_BIN: w.fx.shim.shimPath, QRP_PROVIDER: 'fake-provider', QRP_MODEL: 'sonnet',
    }),
  });
  return { code: r.status, stderr: r.stderr };
}

function driveQc(dir, w) {
  const d = path.join(w.fx.root, 'qc');
  fs.mkdirSync(d, { recursive: true });
  const report = path.join(d, 'report.json');
  fs.writeFileSync(report, JSON.stringify({ node: 'n1', verdict: 'pass', confidence: 0.9, evidence_pointers: [], artifact_paths: [], doa_log: [], escalations: [] }));
  const art = path.join(d, 'art.txt');
  fs.writeFileSync(art, 'build ok\n');
  // judge B = codex stub on PATH (reads stdin, writes ./verdict.txt)
  const codex = path.join(w.fx.shim.binDir, 'codex');
  fs.writeFileSync(codex, '#!/bin/sh\ncat >/dev/null\nprintf "ACHIEVED: g1\\n" > verdict.txt\nprintf DONE\\n\n', { mode: 0o755 });
  const r = spawnSync(process.execPath, [path.join(dir, 'qc-panel.js'), '--report', report, '--artifacts', art, '--out', path.join(d, 'out'), '--node', 'n1'], {
    encoding: 'utf8', timeout: 120000, cwd: w.fx.root,
    env: Object.assign({}, w.env, { QC_CLAUDE_BIN: w.fx.shim.shimPath, QC_AGY_BIN: codex, QC_JUDGE_B_MODEL: 'gpt-5.5-x' }),
  });
  return { code: r.status, stderr: r.stderr };
}

function driveTodo(dir, w) {
  const r = spawnSync(process.execPath, [path.join(dir, 'probe-todo-tools-pin.js'), '--claude-bin', w.fx.shim.shimPath, '--cwd', w.fx.root, '--timeout-seconds', '60'], {
    encoding: 'utf8', timeout: 90000, cwd: w.fx.root, env: w.env,
  });
  return { code: r.status, stderr: r.stderr };
}

function driveBench(dir, w, forceAbsentCreds) {
  const absent = path.join(w.fx.root, 'absent-credentials.json');
  // With a registry BENCH_CREDENTIALS points nowhere: the benchmark must not need (or copy) a credentials file.
  // Legacy (no registry) keeps the copy, so it gets a fake file to copy.
  let creds = absent;
  if (w.mode !== 'good' && !forceAbsentCreds) {
    creds = path.join(w.fx.root, 'creds.json');
    fs.writeFileSync(creds, '{"fake":"credentials"}');
  }
  const r = spawnSync(process.execPath, [path.join(dir, 'benchmark-hook-latency.js'), '--samples', '1', '--max-usd', '5', '--out', path.join(w.fx.root, 'out', 'b.json')], {
    encoding: 'utf8', timeout: 180000, cwd: REPO,
    env: Object.assign({}, w.env, { BENCH_CLAUDE_BIN: w.fx.shim.shimPath, BENCH_CREDENTIALS: creds }),
  });
  // exit 4 (conclusion refused: the shim writes no hook lines) is fine; what matters is that the runs happened.
  return { code: r.status === 4 ? 0 : r.status, stderr: r.stderr };
}

function driveProbe(dir, w) {
  const r = spawnSync('bash', [path.join(dir, 'probe-engine-capability.sh'), 'quota', '--runner', 'claude-native', '--model', 'sonnet', '--live-spend', '--store', path.join(w.fx.root, 'cap')], {
    encoding: 'utf8', timeout: 90000, cwd: w.fx.root, env: w.env,
  });
  return { code: r.status, stderr: r.stderr };
}

const CALLERS = [
  { name: 'A4 probe-engine-capability.sh', file: 'probe-engine-capability.sh', stdout: REVIEW_ENVELOPE, drive: driveProbe, argv0: '-p',
    wire: ['        legacy)\n', '        legacy|active)\n'], failOpen: ['        legacy)\n', '        legacy|*)\n'], inject: 'sh' },
  { name: 'A5 qualification-review-provider.js (claude kind)', file: 'qualification-review-provider.js', stdout: REVIEW_ENVELOPE, drive: driveProvider, argv0: '-p',
    wire: ["useAccount = layer.state === 'active';", 'useAccount = false;'], failOpen: ["if (layer.state === 'invalid') throw", 'if (false) throw'], inject: 'js' },
  { name: 'A6 qc-panel.js', file: 'qc-panel.js', stdout: 'ACHIEVED: goal-1 done\n', drive: driveQc, argv0: '-p',
    wire: ["accountActive = layer.state === 'active';", 'accountActive = false;'], failOpen: ["if (layer.state === 'invalid') {", 'if (false) {'], inject: 'js' },
  { name: 'A7 probe-todo-tools-pin.js', file: 'probe-todo-tools-pin.js', stdout: TODO_STREAM, drive: driveTodo, argv0: '-p',
    wire: ["if (layer.state === 'active') {", 'if (false) {'], failOpen: ["if (layer.state === 'invalid') {", 'if (false) {'], inject: 'js' },
  { name: 'A8 benchmark-hook-latency.js', file: 'benchmark-hook-latency.js', stdout: REVIEW_ENVELOPE, drive: driveBench, argv0: '-p',
    oldPathStderr: /credentials not found/, wire: ["const account = layer.state === 'active';", 'const account = false;'], failOpen: ["if (layer.state === 'invalid') usage(", 'if (false) usage('], inject: 'js' },
];

// Mutated copy of scripts/ (once): each mutation is applied to its own file copy, then undone via a fresh copy.
let mutRoot = null;
function mutatedScripts(file, mutate) {
  if (!mutRoot) mutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-w4-mut-'));
  const dir = fs.mkdtempSync(path.join(mutRoot, 'm-'));
  fs.cpSync(SCRIPTS, dir, { recursive: true, filter: (s) => !/\.test\.(js|sh)$/.test(s) });
  const p = path.join(dir, file);
  const src = fs.readFileSync(p, 'utf8');
  const out = mutate(src);
  assert.notStrictEqual(out, src, `mutation applied to ${file}`);
  fs.writeFileSync(p, out, { mode: 0o755 });
  return dir;
}
test.after(() => { if (mutRoot) fs.rmSync(mutRoot, { recursive: true, force: true }); });

/** The N9 good-run predicate: success, the shim saw only the alias token, never the decoy. */
function goodHolds(c, w, res) {
  const calls = apiCalls(w.fx);
  if (res.code !== 0 || calls.length === 0) return false;
  return calls.every((x) => x.fp === fpOf(w.fx.tokens.a) && x.account === 'a' && x.decoy_read === false
    && x.home !== w.fx.realHome && x.config_dir && x.config_dir.startsWith(w.fx.accountsDir));
}
/** The N9 broken-registry predicate: non-zero exit and nothing spawned. */
function brokenHolds(w, res) {
  return res.code !== 0 && apiCalls(w.fx).length === 0 && !w.fx.shim.calls().some((x) => x.decoy_read && !x.argv.includes('--version'));
}

for (const c of CALLERS) {
  test(`${c.name}: registry present -> alias token fingerprint at the shim, decoy never read`, () => {
    const w = world('good', c.stdout);
    try {
      const res = c.drive(SCRIPTS, w);
      assert.ok(goodHolds(c, w, res), `good run (code ${res.code}) calls=${JSON.stringify(apiCalls(w.fx))} stderr=${res.stderr.slice(0, 400)}`);
    } finally { w.fx.cleanup(); }
  });

  test(`${c.name}: N9 broken registry -> non-zero exit, no spawn, decoy not read`, () => {
    const w = world('broken', c.stdout);
    try {
      const res = c.drive(SCRIPTS, w);
      assert.ok(brokenHolds(w, res), `broken run (code ${res.code}) calls=${JSON.stringify(apiCalls(w.fx))} stderr=${res.stderr.slice(0, 400)}`);
    } finally { w.fx.cleanup(); }
  });

  test(`${c.name}: no registry -> legacy path (no token, no account env)`, () => {
    const w = world('none', c.stdout);
    try {
      const res = c.drive(SCRIPTS, w);
      const calls = apiCalls(w.fx);
      assert.ok(calls.length >= 1, `legacy spawned the claude binary (code ${res.code}, stderr ${res.stderr.slice(0, 300)})`);
      for (const x of calls) {
        assert.strictEqual(x.fp, '', 'no account token');
        assert.strictEqual(x.account, null, 'no AUTOPILOT_ACCOUNT');
        assert.ok(x.argv.includes(c.argv0), 'claude -p argv shape');
      }
    } finally { w.fx.cleanup(); }
  });

  test(`${c.name}: mutation - account call removed -> the good-run assertion turns red`, () => {
    const dir = mutatedScripts(c.file, (s) => s.split(c.wire[0]).join(c.wire[1]));
    const w = world('good', c.stdout);
    try {
      const res = c.drive(dir, w);
      assert.ok(!goodHolds(c, w, res), 'with the wiring removed the good-run predicate must fail');
      // right reason: the caller ran the pre-G37 claude path (shim spawned, no alias, no token)
      const calls = apiCalls(w.fx);
      // (A8's old path first needs the credentials copy, which the registry-world fixture deliberately leaves
      // absent: "credentials not found" is the old path's own first step failing, so it counts as reached.)
      const oldPathStep = c.oldPathStderr && c.oldPathStderr.test(res.stderr);
      assert.ok(calls.length >= 1 || oldPathStep, `wiring-removed mutation reached the old claude path; code ${res.code} stderr=${res.stderr.slice(0, 300)}`);
      for (const x of calls) { assert.strictEqual(x.fp, ''); assert.strictEqual(x.account, null); }
    } finally { w.fx.cleanup(); }
  });

  test(`${c.name}: mutation - invalid registry no longer fails closed -> the broken-registry assertion turns red because the OLD claude path ran`, () => {
    const dir = mutatedScripts(c.file, (s) => s.split(c.failOpen[0]).join(c.failOpen[1]));
    const w = world('broken', c.stdout);
    try {
      const res = c.drive(dir, w);
      assert.ok(!brokenHolds(w, res), 'fail-open must be caught by the broken-registry predicate');
      // The reason must be the right one: the invalid registry fell through to the pre-G37 claude path, i.e.
      // the shim was spawned with no alias and no token. A red caused only by a different exit code (the
      // account wrapper refusing, say) would not prove that the legacy path is shut.
      const calls = apiCalls(w.fx);
      assert.ok(calls.length >= 1, `fail-open mutation reached the old claude path (shim spawned); code ${res.code} stderr=${res.stderr.slice(0, 300)}`);
      for (const x of calls) {
        assert.strictEqual(x.fp, '', 'old path carries no alias token');
        assert.strictEqual(x.account, null, 'old path carries no AUTOPILOT_ACCOUNT');
      }
    } finally { w.fx.cleanup(); }
  });

  test(`${c.name}: mutation - decoy credentials copy re-added -> the good-run assertion turns red`, () => {
    const copy = c.inject === 'sh'
      ? 'cp "$G37_DECOY" "$AUTOPILOT_ACCOUNTS_DIR/a/claude/.credentials.json"\n'
      : "require('fs').copyFileSync(process.env.G37_DECOY, require('path').join(process.env.AUTOPILOT_ACCOUNTS_DIR, 'a', 'claude', '.credentials.json'));\n";
    const dir = mutatedScripts(c.file, (s) => s.replace(/^(#![^\n]*\n)/, `$1${copy}`));
    const w = world('good', c.stdout);
    try {
      const res = c.drive(dir, w);
      assert.ok(!goodHolds(c, w, res), 'a copied decoy credentials file must break the good run (registry refuses config_dir_has_credentials)');
      // right reason: the account layer refused the poisoned config dir, so nothing was spawned
      assert.strictEqual(apiCalls(w.fx).length, 0, `decoy-copy mutation must be refused before any spawn; stderr=${res.stderr.slice(0, 300)}`);
      assert.notStrictEqual(res.code, 0);
    } finally { w.fx.cleanup(); }
  });
}

test('A8: with a registry the benchmark neither needs nor copies a credentials file', () => {
  const w = world('good', REVIEW_ENVELOPE);
  try {
    const res = driveBench(SCRIPTS, w);
    assert.strictEqual(res.code, 0, res.stderr.slice(0, 300));
    assert.ok(!/credentials not found/.test(res.stderr));
    assert.ok(!fs.existsSync(path.join(w.fx.accountsDir, 'a', 'claude', '.credentials.json')), 'no credentials file landed in the alias config dir');
  } finally { w.fx.cleanup(); }
});

test('A8: no registry keeps the credentials copy (legacy) and still requires the file', () => {
  const w = world('none', REVIEW_ENVELOPE);
  try {
    const res = driveBench(SCRIPTS, w, true);
    assert.notStrictEqual(res.code, 0);
    assert.ok(/credentials not found/.test(res.stderr), res.stderr.slice(0, 300));
    assert.strictEqual(w.fx.shim.calls().length, 0);
  } finally { w.fx.cleanup(); }
});

// ---------------------------------------------------------------- layerState: the one reading rule (JS side)
// A copy of lib/account-rail.js sits beside a stub claude-account.js that prints $STUB_OUT with exit $STUB_RC and
// records its argv. The same table as scripts/lib/account-state.sh: rc != 0 -> invalid; first token of line 1
// unconfigured|mode_off -> legacy, ok -> active; anything else -> invalid; always `--any`.
function stubLayer(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-layer-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  let src = fs.readFileSync(path.join(SCRIPTS, 'lib', 'account-rail.js'), 'utf8');
  if (mutate) { const out = mutate(src); assert.notStrictEqual(out, src, 'mutation applied'); src = out; }
  fs.writeFileSync(path.join(dir, 'lib', 'account-rail.js'), src);
  fs.writeFileSync(path.join(dir, 'claude-account.js'), [
    "const fs = require('fs');",
    "fs.appendFileSync(process.env.STUB_ARGV, process.argv.slice(2).join(' ') + '\\n');",
    "process.stdout.write(process.env.STUB_OUT || ''); process.exit(Number(process.env.STUB_RC || 0));",
    '',
  ].join('\n'));
  return { dir, argvLog: path.join(dir, 'argv.log'), rail: require(path.join(dir, 'lib', 'account-rail.js')) };
}
function layer(st, out, rc) {
  return st.rail.layerState({ purpose: 'x', env: Object.assign({}, process.env, { STUB_OUT: out, STUB_RC: String(rc || 0), STUB_ARGV: st.argvLog }) });
}
const LAYER_TABLE = [
  ['unconfigured\n', 0, 'legacy'], ['mode_off\n', 0, 'legacy'], ['ok alias=a mode=0600\n', 0, 'active'],
  ['garbage\n', 0, 'invalid'], ['', 0, 'invalid'], ['okay alias=a\n', 0, 'invalid'], ['Unconfigured\n', 0, 'invalid'],
  [' ok alias=a\n', 0, 'invalid'], ['\nok alias=a\n', 0, 'invalid'], ['ok alias=a\n', 2, 'invalid'], ['unconfigured\n', 3, 'invalid'],
];
test('layerState: the one reading rule over the whole table, always with --any', () => {
  const st = stubLayer();
  try {
    // positive control first: the stub works (an `ok` line is active and the argv log exists)
    assert.strictEqual(layer(st, 'ok alias=a\n').state, 'active');
    assert.match(fs.readFileSync(st.argvLog, 'utf8'), /^env-check --any --purpose x$/m);
    for (const [out, rc, want] of LAYER_TABLE) assert.strictEqual(layer(st, out, rc).state, want, `[${JSON.stringify(out)} rc=${rc}]`);
  } finally { fs.rmSync(st.dir, { recursive: true, force: true }); }
});
test('layerState: mutation - unknown output read as active turns the table red', () => {
  const st = stubLayer((s) => s.replace("  return { state: 'invalid', detail: 'unrecognised env-check output' };", "  return { state: 'active', detail: 'ok' };"));
  try {
    assert.strictEqual(layer(st, 'ok alias=a\n').state, 'active');
    assert.notStrictEqual(layer(st, 'garbage\n').state, 'invalid', 'the mutated reader accepts garbage: the table assertion above would be red');
  } finally { fs.rmSync(st.dir, { recursive: true, force: true }); }
});
