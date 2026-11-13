#!/usr/bin/env node
'use strict';

// engine-qualify-progress.test.js — <raw-dir>/<role>-progress.jsonl is appended
// after each completed case (ids, request count, tokens, wall only). A run
// killed on case k keeps the earlier lines because each one was appendFileSync'd.
//
// Negative control: before the append existed, the abort case below was red —
// SIGKILL of the exam on case k left no progress file (0 lines, not k-1),
// because reviewer-usage.jsonl / exchanges are written only when the cell ends.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runConsultQualification } = require('./engine-qualify');
const gen = require('../evals/consult-eval-generator');
const seals = require('./lib/qualification-asset-seals');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-progress-e2e-'));
let assertions = 0;
function check(v, m) { assertions += 1; assert.ok(v, m); }
function equal(a, b, m) { assertions += 1; assert.deepStrictEqual(a, b, m); }
const byteHash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const seed = 'progress-e2e-seed';
const K = 3;
const PROGRESS_KEYS = ['ts', 'role', 'trial', 'case_id', 'requests', 'input_tokens', 'output_tokens', 'wall_s', 'cumulative_wall_s'];
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function orderedCaseIds() {
  const sa = seals.checkAssetSeals('consult');
  const nonce = byteHash(`consult-seed:${seed}`);
  const admin = gen.generateAdministration(
    byteHash(`consult-admin:${nonce}:${sa.generator_hash}`),
    byteHash(`consult-oracle-key:${nonce}:${sa.corpus_hash}`),
  );
  const ids = [];
  let question = '';
  for (const trial of admin.trials) {
    for (const c of trial.cases) {
      ids.push(c.case_id);
      if (!question && typeof c.question === 'string') question = c.question;
    }
  }
  return { ids, question };
}

function writeAdapter(killCaseId) {
  const p = path.join(tempRoot, `a-${crypto.randomBytes(4).toString('hex')}.js`);
  fs.writeFileSync(p, `'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const repo = ${JSON.stringify(path.join(__dirname, '..'))};
const gen = require(path.join(repo, 'evals', 'consult-eval-generator.js'));
const seals = require(path.join(repo, 'scripts', 'lib', 'qualification-asset-seals.js'));
const bh = (v) => crypto.createHash('sha256').update(v).digest('hex');
const sa = seals.checkAssetSeals('consult');
const nonce = bh('consult-seed:' + ${JSON.stringify(seed)});
const admin = gen.generateAdministration(bh('consult-admin:' + nonce + ':' + sa.generator_hash), bh('consult-oracle-key:' + nonce + ':' + sa.corpus_hash));
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const env = JSON.parse(request.payload.content);
let spec = null;
for (const t of admin.trials) for (const c of t.cases) if (c.case_id === env.case_id) spec = c;
if (!spec) throw new Error('adapter: unknown case ' + env.case_id);
const killId = ${JSON.stringify(killCaseId)};
if (killId && env.case_id === killId) {
  const pid = Number(process.env.EXAM_PID);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('adapter: EXAM_PID missing');
  process.kill(pid, 'SIGKILL');
  throw new Error('abort case');
}
const out = {
  schema_version: 1,
  provider: process.env.QUAL_FAKE_PROVIDER,
  model: process.env.QUAL_FAKE_MODEL,
  output: JSON.stringify(spec.reference_response),
  usage: { input_tokens: 1000, output_tokens: 100, reasoning_tokens: 40, total_tokens: 1100 },
};
process.stdout.write(JSON.stringify(out));
`);
  return p;
}

const d = (c) => c.repeat(64);
function baseOptions(rawDir, adapterPath, extraEnvNames) {
  return {
    role: 'consult', trials: 2, expiresDays: 30, emitRow: false, execute: true,
    taskClasses: ['consult'], domains: ['cross-cutting'], languages: ['en'], tools: ['read_only'],
    engine: 'progress-engine', model: 'progress-model', modelVersion: '2026-08-28', versionSource: 'operator-asserted',
    runner: 'progress-harness', runnerVersion: '1.0.0', family: 'test-family', harnessVersion: 'progress-v1', effort: 'high',
    promptConfigHash: d('a'), semanticFingerprint: d('b'), containmentFingerprint: d('c'),
    panelReadOnlyBinds: [], panelEnvironment: [],
    providerEnvironment: ['QUAL_FAKE_PROVIDER', 'QUAL_FAKE_MODEL', ...extraEnvNames],
    remoteProviderCmd: `${process.execPath} ${adapterPath}`,
    remoteProvider: 'fake-usage-provider', remoteTimeoutMs: 60_000,
    store: fs.mkdtempSync(path.join(tempRoot, 'store-')),
    rawDir,
    testAdministrationsOverride: 1,
  };
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (text.length === 0) return [];
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const { ids: orderedIds, question } = orderedCaseIds();
check(orderedIds.length > K, `consult administration has more than ${K} cases`);

// 1. Abort on case k (stub SIGKILLs the exam, then throws). k-1 lines survive.
{
  const killId = orderedIds[K - 1];
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-abort-'));
  const adapterPath = writeAdapter(killId);
  const runner = path.join(tempRoot, 'abort-runner.js');
  fs.writeFileSync(runner, `'use strict';
const path = require('path');
process.env.EXAM_PID = String(process.pid);
process.env.QUAL_FAKE_PROVIDER = 'fake-usage-provider';
process.env.QUAL_FAKE_MODEL = 'progress-model';
process.env.AUTOPILOT_QUALIFY_SEED = ${JSON.stringify(seed)};
const { runConsultQualification } = require(${JSON.stringify(path.join(__dirname, 'engine-qualify.js'))});
const options = ${JSON.stringify(baseOptions(rawDir, adapterPath, ['EXAM_PID']))};
options.remoteProviderCmd = process.execPath + ' ' + ${JSON.stringify(adapterPath)};
runConsultQualification(options);
`);
  const run = spawnSync(process.execPath, [runner], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  check(run.signal === 'SIGKILL', `abort run is SIGKILL (signal=${run.signal} status=${run.status} stderr=${run.stderr})`);
  const progressPath = path.join(rawDir, 'consult-progress.jsonl');
  const lines = readJsonl(progressPath);
  check(lines !== null && lines.length === K - 1,
    `abort on case ${K} leaves ${K - 1} progress lines, got ${lines === null ? 'no file' : lines.length}`);
  if (lines) {
    equal(lines.map((line) => line.case_id), orderedIds.slice(0, K - 1),
      'surviving lines are the cases that finished before the kill');
  }
}

// 2. A finished run has one progress line per executed case, numbers only.
{
  process.env.QUAL_FAKE_PROVIDER = 'fake-usage-provider';
  process.env.QUAL_FAKE_MODEL = 'progress-model';
  process.env.AUTOPILOT_QUALIFY_SEED = seed;
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-full-'));
  const adapterPath = writeAdapter(null);
  const result = runConsultQualification(baseOptions(rawDir, adapterPath, []));
  const usage = readJsonl(path.join(rawDir, 'consult-usage.jsonl'));
  const progressPath = path.join(rawDir, 'consult-progress.jsonl');
  const lines = readJsonl(progressPath);
  check(usage && usage.length > 0, 'usage file still written at the end of the cell');
  check(lines !== null && lines.length === usage.length,
    `progress lines ${lines === null ? 'missing' : lines.length} expected ${usage ? usage.length : 0}`);
  const exchanges = readJsonl(path.join(rawDir, 'consult-exchanges.jsonl'));
  check(exchanges && exchanges.length === usage.length && exchanges.some((row) => row.envelope),
    'existing exchanges file still carries the case envelope');
  const progressText = fs.readFileSync(progressPath, 'utf8');
  check(question.length > 20 && !progressText.includes(question), 'progress file has no prompt text');
  check(!progressText.includes('reference_response') && !progressText.includes('"envelope"'),
    'progress file has no response or envelope fields');
  let sum = 0;
  lines.forEach((line, index) => {
    equal(Object.keys(line), PROGRESS_KEYS, `line ${index} fields`);
    check(ISO_TS.test(line.ts), `line ${index} ts is ISO`);
    equal(line.role, 'consult', `line ${index} role`);
    equal(line.trial, usage[index].trial_id, `line ${index} trial`);
    equal(line.case_id, usage[index].case_id, `line ${index} case_id`);
    equal(line.requests, 1, `line ${index} requests`);
    equal(line.input_tokens, 1000, `line ${index} input_tokens`);
    equal(line.output_tokens, 100, `line ${index} output_tokens`);
    equal(line.wall_s, usage[index].wall_s, `line ${index} wall_s matches the usage row`);
    sum = Math.round((sum + line.wall_s) * 1000) / 1000;
    equal(line.cumulative_wall_s, sum, `line ${index} cumulative_wall_s`);
  });
  check((fs.statSync(progressPath).mode & 0o077) === 0, 'progress file is not group/world readable');
  check(result.row && result.row.usage && result.row.usage.n_cases === lines.length,
    'evidence row usage.n_cases still counts executed cases');
  check(!Object.hasOwn(result.row, 'progress'), 'evidence row has no progress field');
}

process.stdout.write(`engine-qualify-progress: ${assertions} assertions passed\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
