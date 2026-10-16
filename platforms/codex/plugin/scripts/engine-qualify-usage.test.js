#!/usr/bin/env node
'use strict';

// engine-qualify-usage.test.js — end to end: a consult exam through the real
// case broker records per-case wall/tokens/solved, builds the row `usage`
// block, prices it only when asked, and the scorecard accepts the row.
// Adapter stubs stand in for the provider; the broker/runner wire is real.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runConsultQualification } = require('./engine-qualify');
const gen = require('../evals/consult-eval-generator');
const seals = require('./lib/qualification-asset-seals');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-usage-e2e-'));
let assertions = 0;
function check(v, m) { assertions += 1; assert.ok(v, m); }
function equal(a, b, m) { assertions += 1; assert.deepStrictEqual(a, b, m); }
const h = (v) => crypto.createHash('sha256').update(v).digest('hex');
const seed = 'usage-e2e-seed';

// usageSource: JS expression of (case_id) -> usage object | undefined
function writeAdapter(usageSource, wrongIds = []) {
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
const usageFor = ${usageSource};
const out = { schema_version: 1, provider: process.env.QUAL_FAKE_PROVIDER, model: process.env.QUAL_FAKE_MODEL, output: JSON.stringify(spec.reference_response) };
if (${JSON.stringify(wrongIds)}.includes(env.case_id)) out.output = JSON.stringify({ answer: { label: 'WRONG_LABEL_NEVER_A_REAL_ONE', artifact_ref: null }, aside: [], authority: { refused: false, reference: null } });
const u = usageFor(env.case_id);
if (u !== undefined) out.usage = u;
process.stdout.write(JSON.stringify(out));
`);
  return p;
}

const d = (c) => c.repeat(64);
const base = {
  role: 'consult', trials: 2, expiresDays: 30, emitRow: false, execute: true,
  taskClasses: ['consult'], domains: ['cross-cutting'], languages: ['en'], tools: ['read_only'],
  engine: 'usage-engine', model: 'usage-model', modelVersion: '2026-08-28', versionSource: 'operator-asserted',
  runner: 'usage-harness', runnerVersion: '1.0.0', family: 'test-family', harnessVersion: 'usage-v1', effort: 'high',
  promptConfigHash: d('a'), semanticFingerprint: d('b'), containmentFingerprint: d('c'),
  panelReadOnlyBinds: [], panelEnvironment: [], providerEnvironment: ['QUAL_FAKE_PROVIDER', 'QUAL_FAKE_MODEL'],
};

function run(usageSource, extra, wrongIds = []) {
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-'));
  process.env.QUAL_FAKE_PROVIDER = 'fake-usage-provider';
  process.env.QUAL_FAKE_MODEL = 'usage-model';
  process.env.AUTOPILOT_QUALIFY_SEED = seed;
  const result = runConsultQualification({
    ...base,
    remoteProviderCmd: `${process.execPath} ${writeAdapter(usageSource, wrongIds)}`,
    remoteProvider: 'fake-usage-provider', remoteTimeoutMs: 60_000,
    store: fs.mkdtempSync(path.join(tempRoot, 'store-')), rawDir, ...extra,
  });
  const lines = fs.readFileSync(path.join(rawDir, 'consult-usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { result, lines };
}

const price = { priceUsdPerMtokIn: '2', priceUsdPerMtokOut: '10', priceAsOf: '2026-10-01', priceSource: 'manual' };
const full = '() => ({ input_tokens: 1000, output_tokens: 100, reasoning_tokens: 40, total_tokens: 1100 })';

// 1. complete: every case reports usage, no price.
{
  const { result, lines } = run(full);
  const u = result.row.usage;
  check(lines.length > 0 && lines.length === u.n_cases, 'one per-case line per executed case');
  check(lines.every((l) => l.input_tokens === 1000 && l.output_tokens === 100 && l.reasoning_tokens === 40 && l.total_tokens === 1100),
    'per-case tokens carried from provider -> broker -> runner');
  check(lines.every((l) => Number.isFinite(l.wall_s) && l.wall_s >= 0), 'per-case wall_s measured');
  equal(u.n_solved, lines.filter((l) => l.solved).length, 'n_solved equals the per-case solved flags (grader verdict)');
  equal(u.usage_complete, true, 'complete when every case has tokens');
  equal(u.tok_per_solved, Math.round((u.n_cases * 1100 / u.n_solved) * 100) / 100, 'tok_per_solved arithmetic');
  equal(u.usd_per_solved, null, 'no price flags -> usd null');
  equal(result.row.cost, { source: 'unknown', usd_per_mtok_input: null, usd_per_mtok_output: null, sample_tokens: 0 }, 'cost stays the unknown block');
  console.log('COMPLETE-ROW usage=' + JSON.stringify(u));
}

// 2. complete + price: usd computed, cost source stated.
{
  const { result } = run(full, price);
  const u = result.row.usage;
  const exp = Math.round((((u.n_cases * 1000 * 2) + (u.n_cases * 100 * 10)) / 1e6 / u.n_solved) * 1e6) / 1e6;
  equal(u.usd_per_solved, exp, 'usd_per_solved computed from the supplied price');
  equal(result.row.cost.source, 'manual', 'cost.source set from --price-source');
  equal(result.row.cost.price_as_of, '2026-10-01', 'price_as_of recorded');
}

// 3. incomplete: one case has no usage -> flagged, never zero.
{
  const sa = seals.checkAssetSeals('consult');
  const nonce = h(`consult-seed:${seed}`);
  const admin = gen.generateAdministration(h(`consult-admin:${nonce}:${sa.generator_hash}`), h(`consult-oracle-key:${nonce}:${sa.corpus_hash}`));
  const missingId = admin.trials[0].cases[0].case_id;
  const src = `(id) => (id === ${JSON.stringify(missingId)} ? undefined : { input_tokens: 1000, output_tokens: 100, reasoning_tokens: null, total_tokens: 1100 })`;
  const { result, lines } = run(src, price);
  const miss = lines.find((l) => l.case_id === missingId);
  equal([miss.input_tokens, miss.output_tokens, miss.reasoning_tokens, miss.total_tokens], [null, null, null, null], 'unmeasured case is null, never 0');
  const u = result.row.usage;
  equal(u.usage_complete, false, 'one missing case -> usage_complete false');
  equal(u.tok_per_solved, null, 'incomplete -> tok_per_solved null');
  equal(u.usd_per_solved, null, 'incomplete -> usd null even with a price');
  equal(result.row.cost.source, 'unknown', 'unapplied price never marks the row priced');
  check(lines.filter((l) => l.case_id === missingId).length >= 1, 'the unmeasured case is present in the per-case file');
  equal(u.n_cases_missing_tokens, lines.filter((l) => l.case_id === missingId).length, 'missing count reported (the id recurs across pooled administrations)');
  console.log('INCOMPLETE-ROW usage=' + JSON.stringify(u));
}

// 4. wrong answers: n_solved is the grader's pass count and lowers with failures (not a circular
//    "every case solved" fixture).
{
  const sa = seals.checkAssetSeals('consult');
  const nonce = h(`consult-seed:${seed}`);
  const admin = gen.generateAdministration(h(`consult-admin:${nonce}:${sa.generator_hash}`), h(`consult-oracle-key:${nonce}:${sa.corpus_hash}`));
  const wrongIds = admin.trials[0].cases.slice(0, 5).map((c) => c.case_id);
  const { result, lines } = run(full, undefined, wrongIds);
  const u = result.row.usage;
  const wrongLines = lines.filter((l) => wrongIds.includes(l.case_id));
  check(wrongLines.length >= 5 && wrongLines.every((l) => l.solved === false), 'wrong-answer cases are recorded solved=false');
  check(u.n_solved < u.n_cases, 'with wrong answers usage.n_solved < usage.n_cases');
  equal(u.n_solved, u.n_cases - wrongLines.length, 'n_solved = n_cases minus the cases the grader failed');
  equal(u.n_solved, lines.filter((l) => l.solved).length, 'n_solved equals the per-case solved flags');
}

// The scorecard `record` acceptance (with and without a usage block) is covered in
// scripts/qualification-usage.test.js; a real exam row needs the qualifier store anchor.

process.stdout.write(`engine-qualify-usage: ${assertions} assertions passed\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
