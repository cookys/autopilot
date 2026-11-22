#!/usr/bin/env node
'use strict';

require('./lib/test-git-env');

// field-outcome scorecard rows (2026-11-22): a record_kind=field-outcome row logs
// the outcome of an engine's first real task (usable|unusable|partial) and must be
// writable WITHOUT being qualification evidence.
//
// Red/green: before the change `record` refuses such a row (missing REQUIRED_FIELDS);
// after it, record accepts it and every qualification reader ignores it.
// Negative control: the test rewrites a copy of engine-scorecard.js with the
// readStorePartition field-outcome branch removed — the malformed-row hard-error
// test must go red on that mutant, proving the branch is the gate.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SC = path.join(__dirname, 'engine-scorecard.js');
const BQD = path.join(__dirname, 'build-qualification-defaults.js');
const FIELD_OUTCOME_BRANCH = [
  "    if (row.record_kind === 'field-outcome') {",
  '      // Same contract as markers: always validated (malformed = hard read error)',
  '      // and excluded from ordinary-row derivation, so no qualification reader',
  '      // counts a field-outcome row as evidence.',
  '      validateFieldOutcomeRow(row);',
  '      allRows.push(row);',
  '      continue;',
  '    }',
].join('\n');

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-outcome-'));
  const sc = path.join(root, 'sc');
  const cap = path.join(root, 'cap');
  fs.mkdirSync(sc);
  fs.mkdirSync(cap);
  return { root, sc, cap };
}

function envFor(sc, cap) {
  return {
    ...process.env,
    ENGINE_SCORECARD_DIR: sc,
    ENGINE_CAPABILITY_DIR: cap,
  };
}

function run(script, args, env) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
}

const VALID_ROW = {
  record_kind: 'field-outcome',
  engine: 'minimax',
  task_id: '01M7Y9PS8WX2W4NJSAXKTQVQ55',
  run_id: 'hetero-1795292172-2339507-522e',
  outcome: 'usable',
  evidence: 'fleet task 01M7Y9PS8WX merged 9a8994b03',
};

function writeRow(sc, cap, row) {
  const file = path.join(cap, 'row.json');
  fs.writeFileSync(file, `${JSON.stringify(row)}\n`);
  return run(SC, ['record', '--file', file], envFor(sc, cap));
}

// --- 1. record accepts a valid field-outcome row (green on the write side) ---
{
  const { sc, cap } = makeStore();
  const res = writeRow(sc, cap, VALID_ROW);
  assert.strictEqual(res.status, 0, `record failed: ${res.stderr}`);
  const written = JSON.parse(res.stdout);
  assert.strictEqual(written.event_id, 1, 'row must get event_id 1');
  const lines = fs.readFileSync(path.join(sc, 'scorecard.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(JSON.parse(lines[0]), written);
}

// --- 2. record rejects malformed field-outcome rows ---
{
  const { sc, cap } = makeStore();
  for (const [label, row] of [
    ['bad outcome', { ...VALID_ROW, outcome: 'qualified' }],
    ['missing task_id', { ...VALID_ROW, task_id: undefined }],
    ['object evidence', { ...VALID_ROW, evidence: { pointer: 'x' } }],
    ['qualification field smuggled in', { ...VALID_ROW, quality: 0.9 }],
  ]) {
    const res = writeRow(sc, cap, row);
    assert.notStrictEqual(res.status, 0, `${label}: record must refuse`);
    assert.match(`${res.stderr}`, /ERROR/, `${label}: must fail validation`);
  }
}

// --- 3. readers ignore a well-formed field-outcome row ---
{
  const empty = makeStore();
  const withRow = makeStore();
  writeRow(withRow.sc, withRow.cap, VALID_ROW);

  for (const args of [
    ['current', '--role', 'implementer'],
    ['current', '--role', 'reviewer'],
  ]) {
    const a = run(SC, args, envFor(empty.sc, empty.cap));
    const b = run(SC, args, envFor(withRow.sc, withRow.cap));
    assert.strictEqual(a.status, 0, `current failed: ${a.stderr}`);
    assert.strictEqual(b.status, 0, `current failed with field-outcome row: ${b.stderr}`);
    assert.strictEqual(a.stdout, b.stdout, `current output changed with a field-outcome row present (${args.join(' ')})`);
  }

  const a = run(SC, ['export-qualified', '--out', path.join(empty.root, 'q1.json')], envFor(empty.sc, empty.cap));
  const b = run(SC, ['export-qualified', '--out', path.join(withRow.root, 'q2.json')], envFor(withRow.sc, withRow.cap));
  assert.strictEqual(a.status, 0);
  assert.strictEqual(b.status, 0);
  const stripStamp = (p) => {
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    delete doc.generated_at;
    return JSON.stringify(doc);
  };
  assert.strictEqual(
    stripStamp(path.join(empty.root, 'q1.json')),
    stripStamp(path.join(withRow.root, 'q2.json')),
    'export-qualified output changed with a field-outcome row present',
  );
}

// --- 4. malformed field-outcome row in the store is a hard READ error ---
{
  const { root, sc, cap } = makeStore();
  writeRow(sc, cap, VALID_ROW);
  const file = path.join(sc, 'scorecard.jsonl');
  const broken = JSON.parse(fs.readFileSync(file, 'utf8'));
  broken.outcome = 'qualified';
  fs.writeFileSync(file, `${JSON.stringify(broken)}\n`);
  const res = run(SC, ['current', '--role', 'implementer'], envFor(sc, cap));
  assert.notStrictEqual(res.status, 0, 'malformed field-outcome row must be a hard read error');
  assert.match(`${res.stderr}`, /field-outcome/, 'read error must name the field-outcome row');
  fs.rmSync(root, { recursive: true, force: true });
}

// --- 5. official defaults builder ignores the row ---
{
  const empty = makeStore();
  const withRow = makeStore();
  fs.writeFileSync(path.join(empty.sc, 'scorecard.jsonl'), '');
  writeRow(withRow.sc, withRow.cap, VALID_ROW);
  // The builder needs recipe+repo context; what the test pins is that a
  // field-outcome row in the store changes nothing it computes.
  const a = run(BQD, ['--store', empty.sc, '--repo-root', path.resolve(__dirname, '..'), '--out', path.join(empty.root, 'od.json')], envFor(empty.sc, empty.cap));
  const b = run(BQD, ['--store', withRow.sc, '--repo-root', path.resolve(__dirname, '..'), '--out', path.join(withRow.root, 'od.json')], envFor(withRow.sc, withRow.cap));
  assert.strictEqual(a.status, b.status, 'exit code changed with a field-outcome row present');
  assert.strictEqual(a.stdout, b.stdout, 'official-defaults output changed with a field-outcome row present');
  // The failure text embeds the store path; normalize before comparing.
  const norm = (s) => s.split('\n')[0].split(empty.root).join('<store>').split(withRow.root).join('<store>');
  assert.strictEqual(norm(a.stderr), norm(b.stderr), 'official-defaults failure changed with a field-outcome row present');
}

// --- 6. negative control: remove the readStorePartition field-outcome branch ---
// and the malformed-row hard-error test above must go red (reader exits 0).
{
  const src = fs.readFileSync(SC, 'utf8');
  assert.ok(src.includes(FIELD_OUTCOME_BRANCH), 'field-outcome branch text not found; update the negative-control anchor');
  const mutantPath = path.join(__dirname, '.tmp-mutant-engine-scorecard.test.js');
  try {
    fs.writeFileSync(mutantPath, src.replace(FIELD_OUTCOME_BRANCH, ''));
    const { sc, cap, root } = makeStore();
    fs.writeFileSync(path.join(sc, 'scorecard.jsonl'), `${JSON.stringify({ ...VALID_ROW, outcome: 'qualified' })}\n`);
    const res = run(mutantPath, ['current', '--role', 'implementer'], envFor(sc, cap));
    assert.strictEqual(res.status, 0, 'mutant without the branch must NOT hard-error (test must be red on this mutant)');
    fs.rmSync(root, { recursive: true, force: true });
  } finally {
    fs.rmSync(mutantPath, { force: true });
  }
}

console.log('engine-scorecard-field-outcome.test.js: all green');
