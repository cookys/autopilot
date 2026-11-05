'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rp = require('../run-pilot.js');
const { ROOT, tmp, rm } = require('./helpers.js');

const base = (out, extra = {}) => ({ account: 'dry', out, dryRun: true, timeout: '10m', modelWeak: 'claude-haiku-4-5', modelStrong: 'claude-sonnet-4-5', ...extra });
const firstKey = () => rp.loadPlan().ordered[0];
const scenarioFile = (d, sc) => { const f = path.join(d, 'sc.json'); fs.writeFileSync(f, JSON.stringify(sc)); return f; };
const refusal = (f) => { try { f(); } catch (e) { return e.refusal ? e.message : `not a refusal: ${e.message}`; } return null; };

test('parseArgs: account, out and model ids are required for a real run; --scenario only with --dry-run', () => {
  assert.match(refusal(() => rp.parseArgs(['--out', 'x'])), /--account/);
  assert.match(refusal(() => rp.parseArgs(['--account', 'a'])), /--out/);
  assert.match(refusal(() => rp.parseArgs(['--account', 'a', '--out', 'x'])), /--model-weak/);
  assert.match(refusal(() => rp.parseArgs(['--account', 'a', '--out', 'x', '--model-weak', 'w', '--model-strong', 's', '--scenario', 'f'])), /only for --dry-run/);
  assert.match(refusal(() => rp.parseArgs(['--account', 'a', '--out', 'x', '--model-weak', 'w', '--model-strong', 's', '--cap-usd', '0'])), /positive/);
  const o = rp.parseArgs(['--account', 'a', '--out', 'x', '--dry-run']);
  assert.strictEqual(o.dryRun, true); assert.ok(o.modelWeak && o.modelStrong);
});

test('checkEnv: any API-key billing variable is a refusal', () => {
  assert.strictEqual(refusal(() => rp.checkEnv({})), null);
  assert.match(refusal(() => rp.checkEnv({ ANTHROPIC_API_KEY: 'k' })), /subscription only/);
  assert.match(refusal(() => rp.checkEnv({ CLAUDE_CODE_USE_BEDROCK: '1' })), /subscription only/);
});

test('costOf: the rail figure wins; otherwise the per-cell rate, labelled as such', () => {
  const rates = { haiku: { usd: 0.0162 }, sonnet_high: { usd: 0.3 } };
  assert.deepStrictEqual(rp.costOf({ total_cost_usd: 0.5 }, 'weak1', rates), { usd: 0.5, source: 'rail_total_cost_usd' });
  assert.deepStrictEqual(rp.costOf({}, 'weak1', rates), { usd: 0.0162, source: 'cost_model_rate' });
  assert.deepStrictEqual(rp.costOf(null, 'strong', rates), { usd: 0.3, source: 'cost_model_rate' });
  assert.strictEqual(rp.costOf({ total_cost_usd: -1 }, 'strong', rates).source, 'cost_model_rate');
});

test('extractAnswer and stopKind', () => {
  assert.strictEqual(rp.extractAnswer('{"a":1}'), '{"a":1}');
  assert.strictEqual(rp.extractAnswer('text\n```json\n{"a":2}\n```\nbye'), '{"a":2}');
  assert.strictEqual(rp.extractAnswer('blah\n{"a":3}\nmore'), '{"a":3}');
  assert.strictEqual(rp.extractAnswer('no json here'), 'no json here');
  assert.strictEqual(rp.stopKind('runner exited 6: authentication failed'), 'auth');
  assert.strictEqual(rp.stopKind('Error: rate limit reached'), 'quota');
  assert.strictEqual(rp.stopKind('runner exited 1: compile error'), null);
});

test('run: refuses an --out inside evals/rolekit; the frozen tree is untouched', () => {
  assert.match(refusal(() => rp.run(base(path.join(ROOT, 'zz-out')))), /outside evals\/rolekit/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'zz-out')));
  const d = tmp();
  try { assert.match(refusal(() => rp.run(base(d), { ANTHROPIC_API_KEY: 'x', PATH: process.env.PATH })), /subscription only/); } finally { rm(d); }
});

test('run (dry): an auth stop on the first cell records nothing and stops; the stub saw exactly one call', () => {
  const d = tmp();
  try {
    const res = rp.run(base(d, { scenario: scenarioFile(d, { [firstKey()]: 'auth' }) }));
    assert.strictEqual(res.summary.stopped.kind, 'auth');
    assert.strictEqual(res.summary.ran, 0);
    assert.ok(!fs.existsSync(res.resultsFile) || fs.readFileSync(res.resultsFile, 'utf8') === '');
    const calls = fs.readFileSync(path.join(d, 'dry', 'calls.jsonl'), 'utf8').trim().split('\n');
    assert.strictEqual(calls.length, 1);
    const st = JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8'));
    assert.ok(st.known_deviations.length >= 3 && st.dry_run === true);
  } finally { rm(d); }
});

test('run (dry): the cap stops before the cell that would cross it; a re-run resumes without repeating the recorded cell', () => {
  const d = tmp();
  try {
    const first = rp.run(base(d, { capUsd: '0.02' })); // one weak1 cell costs 0.0162, a second would reach 0.0324
    assert.strictEqual(first.summary.ran, 1);
    assert.strictEqual(first.summary.stopped.kind, 'cap');
    const row = JSON.parse(fs.readFileSync(first.resultsFile, 'utf8').trim());
    assert.strictEqual(row.arm, 'A'); assert.strictEqual(row.pass, 0); assert.strictEqual(row.infra, false);
    assert.strictEqual(row.cost_source, 'cost_model_rate'); assert.strictEqual(row.kit_applied, false);
    const second = rp.run(base(d, { capUsd: '0.02' }));
    assert.strictEqual(second.summary.skipped_already_recorded, 1);
    assert.strictEqual(second.summary.ran, 0);
    assert.strictEqual(fs.readFileSync(first.resultsFile, 'utf8').trim().split('\n').length, 1);
  } finally { rm(d); }
});

test('run (dry): an infra first cell is retried once, stays infra, and costs both attempts', () => {
  const d = tmp();
  try {
    const res = rp.run(base(d, { capUsd: '0.04', scenario: scenarioFile(d, { [firstKey()]: 'infra' }) }));
    const row = JSON.parse(fs.readFileSync(res.resultsFile, 'utf8').split('\n')[0]);
    assert.strictEqual(row.infra, true); assert.strictEqual(row.pass, 0);
    assert.strictEqual(row.attempts, 2);
    assert.ok(Math.abs(row.cost_usd - 0.0324) < 1e-9);
    const calls = fs.readFileSync(path.join(d, 'dry', 'calls.jsonl'), 'utf8').trim().split('\n');
    assert.strictEqual(calls.length, 2);
  } finally { rm(d); }
});

test('railKitDir: an empty-tools kit is staged with tools=none and an identical role.md; a tooled kit is used as is', () => {
  const d = tmp();
  try {
    const empty = path.join(ROOT, 'kits', 'reviewer');
    const staged = rp.railKitDir(empty, path.join(d, 's'));
    assert.notStrictEqual(staged, empty);
    assert.strictEqual(fs.readFileSync(path.join(staged, 'tools'), 'utf8'), 'none\n');
    assert.ok(fs.readFileSync(path.join(staged, 'role.md')).equals(fs.readFileSync(path.join(empty, 'role.md'))));
    const tooled = path.join(ROOT, 'kits', 'explorer');
    assert.strictEqual(rp.railKitDir(tooled, path.join(d, 't')), tooled);
    assert.strictEqual(rp.transportFor('reviewer'), 'author'); assert.strictEqual(rp.transportFor('explorer'), 'hetero');
  } finally { rm(d); }
});

test('the runner is not part of the stamped set: stamp --check still passes', () => {
  const r = require('child_process').spawnSync('node', [path.join(ROOT, 'stamp-rolekit.js'), '--row', 'pilot', '--check', '--root', ROOT], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('run --roles: an unknown role is refused before any cell runs', () => {
  const d = tmp();
  try {
    assert.match(refusal(() => rp.run(base(d, { roles: 'reviewer,nosuchrole' }))), /unknown role nosuchrole/);
    assert.ok(!fs.existsSync(path.join(d, 'results.jsonl')));
  } finally { rm(d); }
});

test('run --roles: only the named role runs, in the unchanged schedule order', () => {
  const d = tmp();
  try {
    const res = rp.run(base(d, { roles: 'explorer', capUsd: '0.07' })); // weak1 cells at 0.0162: four fit, the fifth would cross
    const rows = fs.readFileSync(res.resultsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(rows.length >= 1 && rows.every((r) => r.role === 'explorer'));
    const want = rp.loadPlan().ordered.filter((k) => k.split('|')[2] === 'explorer').slice(0, rows.length);
    assert.deepStrictEqual(rows.map((r) => `${r.arm}|${r.seat}|${r.role}|${r.task}|${r.rep}`), want);
    assert.strictEqual(res.summary.scheduled, 126);
  } finally { rm(d); }
});

test('run (dry, hetero path): an auth error that only the agent log carries stops the run and is not recorded as infra', () => {
  const d = tmp();
  try {
    const key = rp.loadPlan().ordered.find((k) => k.split('|')[2] === 'explorer'); // explorer goes through the hetero rail
    const res = rp.run(base(d, { roles: 'explorer', scenario: scenarioFile(d, { [key]: 'auth' }) }));
    assert.strictEqual(res.summary.stopped.kind, 'auth');
    assert.strictEqual(res.summary.stopped.at, key);
    assert.strictEqual(res.summary.ran, 0);
    assert.ok(!fs.existsSync(res.resultsFile) || fs.readFileSync(res.resultsFile, 'utf8') === '');
    assert.strictEqual(fs.readFileSync(path.join(d, 'dry', 'calls.jsonl'), 'utf8').trim().split('\n').length, 1); // no infra retry
  } finally { rm(d); }
});
