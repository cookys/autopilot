/**
 * cfgfix: context_budget parse consistency (config-path.js readContextBudget) and the one-line config warnings.
 * Run: node --test hooks/context-budget-config-warnings.test.js
 * Negative controls sit next to each positive case (a value that must NOT warn / must NOT turn the hook off).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { readContextBudget } = require('../scripts/lib/config-path.js');
const { unreachableT2Warning } = require('./context-budget-lib.js');
const HOOK = path.join(__dirname, 'context-budget.js');

const made = [];
process.on('exit', () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbud-cfgw-')); made.push(d); return d; }

// Hermetic reader: config file in a temp dir, env passed explicitly (never the host's).
function read(config, env = {}) {
  const dir = tmp();
  const file = path.join(dir, 'config.json');
  if (config !== undefined) fs.writeFileSync(file, JSON.stringify(config));
  return readContextBudget({ env: { AUTOPILOT_CONFIG_FILE: file, ...env } });
}

test('mode: env and config spellings are case-insensitive; off turns the hook off', () => {
  assert.strictEqual(read({}, { AUTOPILOT_CONTEXT_BUDGET_MODE: 'Off' }).mode, 'off');
  assert.strictEqual(read({}, { AUTOPILOT_CONTEXT_BUDGET_MODE: ' OFF ' }).mode, 'off');
  assert.strictEqual(read({ context_budget: { mode: 'OFF' } }).mode, 'off');
  // negative control: unset / warn stays on and says nothing
  const c = read({ context_budget: { mode: 'warn' } });
  assert.strictEqual(c.mode, 'warn');
  assert.deepStrictEqual(c.warnings, []);
  assert.deepStrictEqual(read({}).warnings, []);
});

test('mode: an unknown value is ignored (hook stays on) and named in a warning', () => {
  for (const bad of ['disabled', 'false', 'of']) {
    const e = read({}, { AUTOPILOT_CONTEXT_BUDGET_MODE: bad });
    assert.strictEqual(e.mode, 'warn');
    assert.ok(e.warnings.some((w) => w.includes(`"${bad}"`) && /env/.test(w)), `env ${bad}: ${e.warnings}`);
    const c = read({ context_budget: { mode: bad } });
    assert.strictEqual(c.mode, 'warn');
    assert.ok(c.warnings.some((w) => w.includes(`"${bad}"`) && /config/.test(w)), `config ${bad}: ${c.warnings}`);
  }
});

test('t2 = 0 means off from config AND env (one meaning); empty/junk env is ignored', () => {
  assert.strictEqual(read({ context_budget: { t2: 0 } }).t2, 0);
  const e = read({}, { AUTOPILOT_CONTEXT_BUDGET_T2: '0' });
  assert.strictEqual(e.t2, 0);
  assert.strictEqual(e.explicitT2, true);
  assert.strictEqual(read({}, { AUTOPILOT_CONTEXT_BUDGET_T1: '0' }).t1, 0);
  // negative control: '' / junk are "unset", not 0
  assert.strictEqual(read({}, { AUTOPILOT_CONTEXT_BUDGET_T2: '' }).t2, 150_000);
  assert.strictEqual(read({}, { AUTOPILOT_CONTEXT_BUDGET_T2: 'abc' }).t2, 150_000);
});

test('t1 >= t2 is named once in warnings; thresholds are not changed', () => {
  const c = read({ context_budget: { t1: 200_000, t2: 150_000 } });
  assert.strictEqual(c.t1, 200_000);
  assert.strictEqual(c.t2, 150_000);
  assert.ok(c.warnings.some((w) => /t1 200000 >= t2 150000/.test(w) && /never fires/.test(w)), String(c.warnings));
  assert.ok(read({ context_budget: { t1: 150_000, t2: 150_000 } }).warnings.length === 1);
  // negative controls: ordered tiers, defaults, and a disabled tier are silent
  assert.deepStrictEqual(read({ context_budget: { t1: 100_000, t2: 150_000 } }).warnings, []);
  assert.deepStrictEqual(read({ context_budget: { t1: 200_000, t2: 0 } }).warnings, []);
});

test('unreachableT2Warning: only a user-set t2 past the compaction point of a <200k window', () => {
  const w = unreachableT2Warning({ explicitT2: true, t2: 150_000 }, 150_000); // point = 117k
  assert.match(w, /t2 150k is past the compaction point 117k/);
  // negative controls
  assert.strictEqual(unreachableT2Warning({ explicitT2: true, t2: 100_000 }, 150_000), null); // before the point
  assert.strictEqual(unreachableT2Warning({ explicitT2: false, t2: 150_000 }, 150_000), null); // default scales down
  assert.strictEqual(unreachableT2Warning({ explicitT2: true, t2: 300_000 }, 1_000_000), null); // big window
  assert.strictEqual(unreachableT2Warning({ explicitT2: true, t2: 0 }, 150_000), null); // T2 off
  assert.strictEqual(unreachableT2Warning({ explicitT2: true, t2: 150_000 }, null), null); // window unknown
});

// Black box: the hook says it on stderr once per session, never changes exit code.
function usageLine(tokens) {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: {
    input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } });
}
function runHookTwice(config, extraEnv, seedState) {
  const dir = tmp();
  const cfgFile = path.join(dir, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify(config));
  const tpath = path.join(dir, 't.jsonl');
  fs.writeFileSync(tpath, `${usageLine(1000)}\n`);
  const sid = 'cfgw-session';
  if (seedState) fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify(seedState));
  const env = {
    ...process.env, HOME: dir, AUTOPILOT_CONFIG_FILE: cfgFile, AUTOPILOT_CONTEXT_BUDGET_DIR: dir,
    AUTOPILOT_LIVE_DIR: path.join(dir, 'live'), AUTOPILOT_MANAGED_SETTINGS_FILE: path.join(dir, 'none.json'),
    CLAUDE_CODE_SESSION_ID: sid, ...extraEnv,
  };
  delete env.AUTOPILOT_CONTEXT_BUDGET_MODE;
  Object.assign(env, extraEnv);
  const run = () => spawnSync('node', [HOOK], { input: JSON.stringify({ transcript_path: tpath, session_id: sid }), encoding: 'utf8', env });
  return [run(), run()];
}

test('hook: unknown mode warns once per session, stays on, exit 0', () => {
  const [a, b] = runHookTwice({}, { AUTOPILOT_CONTEXT_BUDGET_MODE: 'disabled' });
  assert.strictEqual(a.status, 0);
  assert.match(a.stderr, /context-budget config: .*"disabled"/);
  assert.doesNotMatch(b.stderr, /context-budget config/);
  // negative control: a correct mode=off is silent (no warning, hook off)
  const [c] = runHookTwice({}, { AUTOPILOT_CONTEXT_BUDGET_MODE: 'Off' });
  assert.strictEqual(c.status, 0);
  assert.strictEqual(c.stderr.trim(), '');
});

test('hook: t1 >= t2 warns once; a user t2 past the compaction point of a remembered <200k window warns once', () => {
  const [a, b] = runHookTwice({ context_budget: { t1: 200_000, t2: 150_000 } }, {});
  assert.match(a.stderr, /t1 200000 >= t2 150000/);
  assert.doesNotMatch(b.stderr, /t1 200000/);
  const seed = { calls: 0, lastT1Context: 0, lastT2Context: 0, lastContext: 0, observedMax: 0, knownWindow: 150_000 };
  const [c, d] = runHookTwice({ context_budget: { t2: 140_000 } }, {}, seed);
  assert.match(c.stderr, /past the compaction point/);
  assert.doesNotMatch(d.stderr, /past the compaction point/);
  // negative control: default t2 on the same 150k window is silent
  const [e] = runHookTwice({}, {}, seed);
  assert.doesNotMatch(e.stderr, /compaction point/);
  assert.strictEqual(e.status, 0);
});
