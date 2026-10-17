/**
 * BL-0205: context_budget.per_model (per-model T1/T2 by glob on the live file's model.id).
 * Run: node --test hooks/context-budget-per-model.test.js
 * All config lives in temp dirs; the host ~/.autopilot is never read or written.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { readContextBudget, applyPerModel } = require('../scripts/lib/config-path.js');
const { budgetWarning } = require('../scripts/lib/compaction-handoff.js');
const HOOK = path.join(__dirname, 'context-budget.js');

const made = [];
process.on('exit', () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbud-pm-')); made.push(d); return d; }

const PER_MODEL = {
  'claude-*': { t1: 120_000, t2: 170_000 },
  'claude-fable-*': { t1: 150_000, t2: 200_000 },
  'claude-opus-*': { t1: 200_000, t2: 250_000 },
};
function read(config, env = {}, model) {
  const dir = tmp();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(config));
  return readContextBudget({ env: { AUTOPILOT_CONFIG_FILE: file, ...env }, model });
}
const top = { context_budget: { t1: 300_000, t2: 350_000, per_model: PER_MODEL } };

test('match: the model glob replaces t1/t2 and counts as explicit', () => {
  const c = read(top, {}, 'claude-opus-4-8[1m]');
  assert.strictEqual(c.t1, 200_000);
  assert.strictEqual(c.t2, 250_000);
  assert.strictEqual(c.explicitT1 && c.explicitT2, true);
  assert.deepStrictEqual(c.warnings, []);
});

test('no match, no model id: the top-level tiers stay', () => {
  assert.strictEqual(read(top, {}, 'gpt-5').t1, 300_000);
  assert.strictEqual(read(top, {}, 'gpt-5').t2, 350_000);
  assert.strictEqual(read(top, {}, undefined).t1, 300_000);
  assert.strictEqual(read(top, {}, '').t2, 350_000);
});

test('several matching patterns: the most specific (most literal characters) wins', () => {
  const c = read(top, {}, 'claude-fable-5');
  assert.strictEqual(c.t1, 150_000);
  assert.strictEqual(c.t2, 200_000);
  // 'claude-*' alone catches a model no specific pattern covers
  assert.strictEqual(read(top, {}, 'claude-haiku-4').t2, 170_000);
});

test('env T1/T2 beat per_model (each tier independently)', () => {
  const c = read(top, { AUTOPILOT_CONTEXT_BUDGET_T1: '99000' }, 'claude-fable-5');
  assert.strictEqual(c.t1, 99_000);
  assert.strictEqual(c.t2, 200_000);
  const d = read(top, { AUTOPILOT_CONTEXT_BUDGET_T2: '260000' }, 'claude-fable-5');
  assert.strictEqual(d.t1, 150_000);
  assert.strictEqual(d.t2, 260_000);
});

test('bad entries: unknown key, non-positive-integer value, non-object entry warn and are ignored', () => {
  const cfg = { context_budget: { t1: 100_000, t2: 150_000, per_model: {
    'a-*': { t1: 110_000, step: 5 },
    'b-*': { t1: -1, t2: 'x' },
    'c-*': { t1: 1.5 },
    'd-*': 7,
    'e-*': { t2: 180_000 },
  } } };
  const c = read(cfg, {}, 'a-1');
  assert.strictEqual(c.t1, 110_000); // the good key of a partly bad entry still applies
  const w = c.warnings.join('\n');
  assert.match(w, /"a-\*" key "step" is not t1\|t2/);
  assert.match(w, /"b-\*" t1 -1 is not a positive integer/);
  assert.match(w, /"b-\*" t2 "x" is not a positive integer/);
  assert.match(w, /"c-\*" t1 1.5 is not a positive integer/);
  assert.match(w, /"d-\*" is not an object/);
  assert.strictEqual(read(cfg, {}, 'b-1').t1, 100_000); // fully bad entry changes nothing
  assert.strictEqual(read(cfg, {}, 'e-1').t2, 180_000); // partial entry overrides only its own tier
  assert.strictEqual(read(cfg, {}, 'e-1').t1, 100_000);
  // per_model of the wrong shape
  assert.match(read({ context_budget: { per_model: [] } }).warnings.join(), /per_model is not an object/);
  // negative control: a clean config says nothing
  assert.deepStrictEqual(read(top, {}, 'claude-fable-5').warnings, []);
});

test('a per_model pair with t1 >= t2 is named in warnings', () => {
  const c = read({ context_budget: { per_model: { 'm-*': { t1: 300_000, t2: 200_000 } } } }, {}, 'm-1');
  assert.ok(c.warnings.some((x) => /per_model "m-\*": t1 300000 >= t2 200000/.test(x)), String(c.warnings));
});

test('applyPerModel works on an already-read cfg (what the hook does once it learns the model)', () => {
  const base = read(top, {});
  assert.strictEqual(base.t2, 350_000);
  assert.strictEqual(applyPerModel(base, 'claude-fable-5').t2, 200_000);
  assert.strictEqual(applyPerModel(base, undefined), base);
});

test('SessionStart budgetWarning uses the model tiers', () => {
  const dir = tmp();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ context_budget: { t2: 150_000, gap: 50_000, per_model: { 'big-*': { t2: 400_000 } } } }));
  const env = { AUTOPILOT_CONFIG_FILE: file };
  const resolve = () => ({ configured: 300_000, enabled: true }); // compaction point 267k
  assert.strictEqual(budgetWarning({ env, model: 'small-1', resolve }), null); // 150k + 50k fits
  const w = budgetWarning({ env, model: 'big-1', resolve });
  assert.match(w, /T2 400k \+ gap 50k/);
});

// Black box through the hook: remembered model id in state, 160k tokens on a remembered 1M window.
function usageLine(tokens) {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: {
    input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } });
}
function runHook(config, model, extraEnv = {}) {
  const dir = tmp();
  const cfgFile = path.join(dir, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify(config));
  const tpath = path.join(dir, 't.jsonl');
  fs.writeFileSync(tpath, `${usageLine(160_000)}\n`);
  const sid = 'pm-session';
  const seed = { calls: 0, lastT1Context: 0, lastT2Context: 0, lastContext: 0, observedMax: 0, knownWindow: 1_000_000 };
  if (model) seed.knownModel = model;
  fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify(seed));
  const env = {
    ...process.env, HOME: dir, AUTOPILOT_CONFIG_FILE: cfgFile, AUTOPILOT_CONTEXT_BUDGET_DIR: dir,
    AUTOPILOT_LIVE_DIR: path.join(dir, 'live'), AUTOPILOT_MANAGED_SETTINGS_FILE: path.join(dir, 'none.json'),
    CLAUDE_CODE_SESSION_ID: sid,
  };
  for (const k of ['AUTOPILOT_CONTEXT_BUDGET_MODE', 'AUTOPILOT_CONTEXT_BUDGET_T1', 'AUTOPILOT_CONTEXT_BUDGET_T2']) delete env[k];
  Object.assign(env, extraEnv);
  return spawnSync('node', [HOOK], { input: JSON.stringify({ transcript_path: tpath, session_id: sid }), encoding: 'utf8', env });
}

test('hook: the remembered model picks the tiers (fable T1 150k fires at 160k; opus 200k stays quiet)', () => {
  const cfg = { context_budget: { t1: 200_000, t2: 250_000, per_model: PER_MODEL } };
  const fable = runHook(cfg, 'claude-fable-5');
  assert.match(fable.stderr, /Context budget T1: .*threshold 150k/);
  // negative controls: another model, no model id, and env T1 all keep T1 from firing at 160k
  assert.doesNotMatch(runHook(cfg, 'claude-opus-4-8[1m]').stderr, /Context budget T/);
  assert.doesNotMatch(runHook(cfg, undefined).stderr, /Context budget T/);
  assert.doesNotMatch(runHook(cfg, 'claude-fable-5', { AUTOPILOT_CONTEXT_BUDGET_T1: '300000', AUTOPILOT_CONTEXT_BUDGET_T2: '400000' }).stderr, /Context budget T/);
});

test('hook: model.id of the fresh statusline live file picks the tiers', () => {
  const cfg = { context_budget: { t1: 200_000, t2: 250_000, per_model: PER_MODEL } };
  const run = (modelId) => {
    const live = fs.mkdtempSync('/dev/shm/ctxbud-pm-live-'); // the live dir must be RAM-backed
    made.push(live);
    fs.chmodSync(live, 0o700);
    fs.mkdirSync(path.join(live, 'context'), { mode: 0o700 });
    fs.writeFileSync(path.join(live, 'context', 'pm-session.json'), JSON.stringify({
      schema_version: 1, session_id: 'pm-session', written_at: new Date().toISOString(),
      model: { id: modelId },
      context_window: { context_window_size: 1_000_000, total_input_tokens: 160_000 },
    }));
    return runHook(cfg, undefined, { AUTOPILOT_LIVE_DIR: live });
  };
  assert.match(run('claude-fable-5[1m]').stderr, /Context budget T1: .*threshold 150k/);
  assert.doesNotMatch(run('claude-opus-4-8[1m]').stderr, /Context budget T/);
});
