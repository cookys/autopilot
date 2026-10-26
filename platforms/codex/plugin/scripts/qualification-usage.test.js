#!/usr/bin/env node
'use strict';

// qualification-usage.test.js — unit contract for scripts/lib/qualification-usage.js
// and the optional `usage` block on engine-scorecard rows. Pure functions + the
// real scorecard CLI against a throwaway store (never ~/.autopilot).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const U = require('./lib/qualification-usage');

let assertions = 0;
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }
function check(value, message) { assertions += 1; assert.ok(value, message); }

const rec = (over = {}) => U.caseRecord({
  role: 'reviewer', trialId: 't1', caseId: 'c1', wallS: 10,
  usage: { input_tokens: 1000, output_tokens: 200, reasoning_tokens: 50, total_tokens: null },
  solved: true, usageSource: 'provider', ...over,
});

// ── wire usage normalisation: null is "not measured", never zero ───────────
{
  const u = U.normalizeUsage({ input_tokens: 1000, output_tokens: 200 });
  equal(u, { input_tokens: 1000, output_tokens: 200, reasoning_tokens: null, total_tokens: 1200 },
    'total derives from input+output; reasoning stays null (not separable), never added');
  equal(U.normalizeUsage(null), { input_tokens: null, output_tokens: null, reasoning_tokens: null, total_tokens: null },
    'no usage object -> every field null');
  equal(U.normalizeUsage({ input_tokens: 'x', output_tokens: -1, total_tokens: 1.5 }).total_tokens, null,
    'junk/negative/fractional counts are not measurements');
  equal(U.normalizeUsage({ total_tokens: 500 }).total_tokens, 500,
    'a rail that reports only a total keeps it (codex) without inventing an in/out split');
  equal(U.normalizeUsage({ total_tokens: 500 }).input_tokens, null, 'no in/out split invented from a total');
  assert.throws(() => U.validateWireUsage({ input_tokens: 1 }), /exactly/);
  assertions += 1;
  assert.throws(() => U.validateWireUsage({ input_tokens: 1, output_tokens: 2, reasoning_tokens: null, total_tokens: -3 }), /total_tokens/);
  assertions += 1;
}

// ── per-case record ─────────────────────────────────────────────────────────
{
  const r = rec();
  equal([r.trial_id, r.case_id, r.wall_s, r.input_tokens, r.output_tokens, r.reasoning_tokens, r.total_tokens, r.solved],
    ['t1', 'c1', 10, 1000, 200, 50, 1200, true], 'per-case record carries wall, tokens, solved');
  equal(rec({ usage: null }).input_tokens, null, 'missing usage -> null tokens in the case row');
  equal(rec({ solved: 'yes' }).solved, false, 'solved is strictly the boolean the grader supplied');
}

// ── summarize: complete block, solved_per_hour arithmetic ──────────────────
{
  const recs = [rec({ wallS: 10 }), rec({ caseId: 'c2', wallS: 20, solved: false }), rec({ caseId: 'c3', wallS: 30 }), rec({ caseId: 'c4', wallS: 40, solved: false })];
  const s = U.summarize(recs);
  equal(s.n_cases, 4, 'n_cases');
  equal(s.n_solved, 2, 'n_solved counts only grader-solved cases');
  equal(s.total_wall_s, 100, 'total_wall_s is the sum of per-case wall');
  equal(s.solved_per_hour, 72, 'solved_per_hour = n_solved * 3600 / total_wall_s (2 * 3600 / 100)');
  equal(s.med_wall_s, 25, 'median of 10,20,30,40');
  equal(s.usage_complete, true, 'every case measured -> complete');
  equal(s.total_tokens, 4800, 'total tokens summed (4 x 1200)');
  equal(s.tok_per_solved, 2400, 'tok_per_solved = total tokens / n_solved (4800 / 2)');
  equal(s.usd_per_solved, null, 'no price -> usd_per_solved is null');
  equal(s.usd_unavailable_reason, undefined, 'no price asked, no reason needed');
  equal(U.summarize([rec({ wallS: 7 }), rec({ caseId: 'c2', wallS: 9 }), rec({ caseId: 'c3', wallS: 1 })]).med_wall_s, 7, 'odd-count median');
}

// ── usage_complete false when ANY case lacks tokens ─────────────────────────
{
  const recs = [rec(), rec({ caseId: 'c2', usage: null }), rec({ caseId: 'c3' })];
  const s = U.summarize(recs, { inPerMtok: 1, outPerMtok: 2, asOf: '2026-10-01', source: 'manual', ref: null });
  equal(s.usage_complete, false, 'one case without tokens makes the block incomplete');
  equal(s.n_cases_missing_tokens, 1, 'the number of unmeasured cases is reported');
  equal(s.tok_per_solved, null, 'incomplete -> tok_per_solved is null, not a partial average');
  equal(s.total_tokens, null, 'incomplete -> total_tokens is null');
  equal(s.usd_per_solved, null, 'incomplete -> no usd even with a price');
  equal(s.usd_unavailable_reason, 'usage_incomplete', 'the reason is stated');
  equal(s.solved_per_hour, 3 * 3600 / 30 * (3 / 3), 'wall-based figures stay available when only tokens are missing');
  equal(U.summarize([]).usage_complete, false, 'an empty run is never "complete"');
}

// ── numeric hygiene ─────────────────────────────────────────────────────────
{
  equal(U.summarize([rec({ wallS: 0 })]).solved_per_hour, null, 'zero total wall -> null, not Infinity');
  equal(U.summarize([rec({ solved: false })]).tok_per_solved, null, 'zero solved -> tok_per_solved null, not Infinity');
  equal(U.summarize([rec({ wallS: null })]).total_wall_s, null, 'an unmeasured wall makes the total null');
}

// ── price: usd_per_solved arithmetic ────────────────────────────────────────
{
  const price = { inPerMtok: 2, outPerMtok: 10, asOf: '2026-10-01', source: 'manual', ref: 'vendor page' };
  const recs = [rec({ solved: true }), rec({ caseId: 'c2', solved: false })];
  const s = U.summarize(recs, price);
  // in = 2000, out = 400 -> (2000*2 + 400*10)/1e6 = 0.008 ; / 1 solved = 0.008
  equal(s.usd_per_solved, 0.008, 'usd_per_solved = (sum_in*p_in + sum_out*p_out)/1e6/n_solved');
  const cost = U.costBlock(s, price);
  equal(cost, { source: 'manual', usd_per_mtok_input: 2, usd_per_mtok_output: 10, sample_tokens: 2400, price_as_of: '2026-10-01', price_ref: 'vendor page' },
    'given a price the cost block carries the stated source, prices and as-of date');
  equal(U.costBlock(U.summarize(recs), null), { source: 'unknown', usd_per_mtok_input: null, usd_per_mtok_output: null, sample_tokens: 0 },
    'no price -> the unknown block with null prices (never 0)');
  equal(U.costBlock(U.summarize([rec({ usage: null })], price), price).source, 'unknown',
    'a price that could not be applied (incomplete usage) never relabels the row as priced');
  const totalOnly = U.summarize([rec({ usage: { total_tokens: 900 } })], price);
  equal(totalOnly.usage_complete, true, 'total-only rail still has a measured total');
  equal(totalOnly.io_split_complete, false, 'but no in/out split');
  equal(totalOnly.usd_per_solved, null, 'no split -> no usd');
  equal(totalOnly.usd_unavailable_reason, 'input_output_split_missing', 'reason stated');
  equal(U.summarize([rec({ usageSource: 'jsonl-opencode' })], price).usd_unavailable_reason, 'output_accounting_unverified',
    'opencode output/reasoning accounting is unverified -> never priced');
}

// ── price flag parsing ──────────────────────────────────────────────────────
{
  const ok = { priceUsdPerMtokIn: '2.5', priceUsdPerMtokOut: '10', priceAsOf: '2026-10-01', priceSource: 'manual' };
  equal(U.parsePricing(ok), { inPerMtok: 2.5, outPerMtok: 10, asOf: '2026-10-01', source: 'manual', ref: null }, 'all four -> pricing');
  equal(U.parsePricing({}), null, 'none -> null (stay unknown)');
  assert.throws(() => U.parsePricing({ priceUsdPerMtokIn: '1' }), /together/);
  assertions += 1;
  assert.throws(() => U.parsePricing({ ...ok, priceSource: 'vendor-site' }), /manual or measured/);
  assertions += 1;
  assert.throws(() => U.parsePricing({ ...ok, priceAsOf: 'yesterday' }), /YYYY-MM-DD/);
  assertions += 1;
  assert.throws(() => U.parsePricing({ ...ok, priceUsdPerMtokIn: '-1' }), /non-negative/);
  assertions += 1;
}

// ── brain trial fold: a token field is known only if every round reported it ─
{
  const rounds = [rec({ wallS: 5 }), rec({ wallS: 6 })];
  const f = U.foldRounds(rounds);
  equal([f.wall_s, f.usage.input_tokens, f.usage.total_tokens, f.rounds], [11, 2000, 2400, 2], 'rounds add up');
  const g = U.foldRounds([rec({ wallS: 5 }), rec({ wallS: 6, usage: null })]);
  equal(g.usage.total_tokens, null, 'one unmeasured round -> the trial total is unknown, not half a total');
}

// ── foldRounds: a missing wall is unknown, never 0 ──────────────────────────
{
  const g = U.foldRounds([rec({ wallS: 5 }), rec({ wallS: null })]);
  equal(g.wall_s, null, 'one round without wall -> the trial wall is null, not a partial sum');
  equal(U.foldRounds([rec({ wallS: 5 }), rec({ wallS: 6 })]).wall_s, 11, 'all rounds measured -> summed');
}

// ── validateUsageBlock: symmetric invariants ────────────────────────────────
{
  const good = U.summarize([rec(), rec({ caseId: 'c2' })]);
  assert.doesNotThrow(() => U.validateUsageBlock(good));
  assertions += 1;
  assert.throws(() => U.validateUsageBlock({ ...good, total_tokens: null }), /usage_complete=true requires total_tokens/);
  assertions += 1;
  assert.throws(() => U.validateUsageBlock({ ...good, tok_per_solved: null }), /usage_complete=true requires/);
  assertions += 1;
  const none = U.summarize([rec({ solved: false })]);
  assert.doesNotThrow(() => U.validateUsageBlock(none));
  assertions += 1;
  assert.throws(() => U.validateUsageBlock({ ...none, tok_per_solved: 99 }), /n_solved=0 requires/);
  assertions += 1;
  assert.throws(() => U.validateUsageBlock({ ...none, usd_per_solved: 0.5 }), /n_solved=0 requires/);
  assertions += 1;
}

// ── scorecard: optional usage block ─────────────────────────────────────────
const sc = path.join(__dirname, 'engine-scorecard.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qual-usage-scorecard-'));
function legacyRow(extra = {}) {
  return {
    engine: 'usage-eng', runner: 'usage-run', family: 'fam', role: 'consult', model_version: 'v1',
    version_source: 'manual', corpus_version: 'c@1', harness_version: 'h@1', runner_version: 'rv1',
    prompt_config_hash: 'sha256:x', date: '2026-06-30',
    quality: { corpus_pass: '10/10', false_pass_critical: 0, specificity: '3/3' },
    capability_score: 0.9,
    cost: { source: 'unknown', usd_per_mtok_input: 0, usd_per_mtok_output: 0, sample_tokens: 0 },
    latency: { sample_wall_time_s: 0 }, status: 'qualified', qualified_at: '2026-06-30',
    ...extra,
  };
}
function record(row) {
  return spawnSync(process.execPath, [sc, 'record'], {
    input: JSON.stringify(row), encoding: 'utf8',
    env: { ...process.env, ENGINE_SCORECARD_DIR: dir },
  });
}
{
  const legacy = record(legacyRow());
  equal(legacy.status, 0, `a legacy row without a usage block still records (${legacy.stderr})`);
  const complete = U.summarize([rec(), rec({ caseId: 'c2' })]);
  const withComplete = record(legacyRow({ engine: 'usage-eng2', usage: complete }));
  equal(withComplete.status, 0, `a complete usage block records (${withComplete.stderr})`);
  const incomplete = U.summarize([rec(), rec({ caseId: 'c2', usage: null })]);
  const withIncomplete = record(legacyRow({ engine: 'usage-eng3', usage: incomplete }));
  equal(withIncomplete.status, 0, `an incomplete usage block records (${withIncomplete.stderr})`);
  const stored = fs.readFileSync(path.join(dir, 'scorecard.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  equal(stored.find((r) => r.engine === 'usage-eng3').usage.tok_per_solved, null, 'the incomplete block round-trips with tok_per_solved null');
  check(stored.find((r) => r.engine === 'usage-eng').usage === undefined, 'the legacy row stays without a usage block');
  // An incomplete block claiming a token figure is a lie to the reader: refuse it.
  const lie = record(legacyRow({ engine: 'usage-eng4', usage: { ...incomplete, tok_per_solved: 1234 } }));
  check(lie.status !== 0, 'usage_complete=false with a tok_per_solved figure is rejected');
  check(/usage_complete=false/.test(lie.stderr + lie.stdout), 'the rejection names the rule');
  const bad = record(legacyRow({ engine: 'usage-eng5', usage: { n_cases: 'x' } }));
  check(bad.status !== 0, 'a malformed usage block is rejected');
}
fs.rmSync(dir, { recursive: true, force: true });

// ── BL-0168: a truncated exam must be distinguishable from a complete one ─
{
  const two = [rec(), rec({ caseId: 'c2' })];
  const full = U.summarize(two, null, 2);
  equal([full.n_cases_expected, full.cases_complete], [2, true], 'expected count met -> cases_complete true');
  const half = U.summarize(two, null, 24);
  equal([half.n_cases, half.n_cases_expected, half.cases_complete], [2, 24, false],
    'a half-run exam keeps its true n_cases but says it was 24 planned and is NOT complete');
  check(half.usage_complete === true, 'token completeness is a separate axis: it stays true for the cases that ran');
  const unknown = U.summarize(two);
  equal([unknown.n_cases_expected, unknown.cases_complete], [null, null],
    'no expected count (adaptive stop) -> both fields present and null, never a guess');
  assert.throws(() => U.summarize(two, null, -1), /expected/); assertions += 1;
  assert.throws(() => U.summarize(two, null, 1.5), /expected/); assertions += 1;
  // block validation: the new fields must agree with n_cases, and legacy blocks still pass
  U.validateUsageBlock(full); U.validateUsageBlock(half); U.validateUsageBlock(unknown);
  const legacyBlock = { ...full }; delete legacyBlock.n_cases_expected; delete legacyBlock.cases_complete;
  U.validateUsageBlock(legacyBlock); assertions += 1;
  const bad = (patch, re, why) => { assert.throws(() => U.validateUsageBlock({ ...half, ...patch }), re, why); assertions += 1; };
  bad({ cases_complete: true }, /cases_complete/, 'claiming complete while n_cases != expected is refused');
  bad({ n_cases_expected: 2, cases_complete: false }, /cases_complete/, 'claiming incomplete while n_cases == expected is refused');
  bad({ n_cases_expected: null, cases_complete: true }, /cases_complete/, 'complete without an expected count is refused');
  bad({ n_cases_expected: -3 }, /n_cases_expected/, 'a negative expected count is refused');
  // cross-checks the validator used to lack
  const base = U.summarize(two, { inPerMtok: 1, outPerMtok: 2, asOf: '2026-10-01', source: 'manual', ref: null }, 2);
  U.validateUsageBlock(base);
  const bad2 = (patch, re, why) => { assert.throws(() => U.validateUsageBlock({ ...base, ...patch }), re, why); assertions += 1; };
  bad2({ n_cases_missing_tokens: 1 }, /n_cases_missing_tokens/, 'usage_complete=true cannot coexist with missing-token cases');
  bad2({ n_cases_missing_tokens: 5 }, /n_cases_missing_tokens/, 'missing-token count above n_cases is refused');
  bad2({ total_wall_s: null }, /solved_per_hour|med_wall_s/, 'rate/median without a total wall is refused');
  bad2({ solved_per_hour: 999999 }, /solved_per_hour/, 'solved_per_hour must agree with n_solved and total_wall_s');
  bad2({ usd_unavailable_reason: 'usage_incomplete' }, /usd_unavailable_reason/, 'a usd figure together with an unavailable reason is refused');
  const noPrice = U.summarize(two, { inPerMtok: 1, outPerMtok: 2, asOf: '2026-10-01', source: 'manual', ref: null }, 2);
  const incompleteTokens = U.summarize([rec(), rec({ caseId: 'c2', usage: null })], { inPerMtok: 1, outPerMtok: 2, asOf: '2026-10-01', source: 'manual', ref: null }, 2);
  U.validateUsageBlock(incompleteTokens);
  assert.throws(() => U.validateUsageBlock({ ...incompleteTokens, n_cases_missing_tokens: 0 }), /n_cases_missing_tokens/); assertions += 1;
  assert.throws(() => U.validateUsageBlock({ ...incompleteTokens, usd_unavailable_reason: undefined, usd_per_solved: null, usage_complete: false, tok_per_solved: null, total_tokens: null, n_cases_missing_tokens: 0 }), /n_cases_missing_tokens/); assertions += 1;
  check(noPrice.usd_unavailable_reason === undefined, 'priced complete block has no unavailable reason');
}

// ── BL-0024: an unpriced seat never sorts as free ───────────────────────────
{
  const { costSortValue } = require('./engine-scorecard');
  const unknownBlock = U.costBlock(U.summarize([rec({})]), null);
  equal(costSortValue({ cost: unknownBlock }), Infinity, 'the writer\'s unknown block (null prices) sorts last');
  equal(costSortValue({ cost: { source: 'unknown', usd_per_mtok_input: 0, usd_per_mtok_output: 0 } }), Infinity,
    'a legacy unknown block that stored 0 still sorts last (gate is cost.source, not the number)');
  equal(costSortValue({ cost: { source: 'manual', usd_per_mtok_input: null, usd_per_mtok_output: null } }), Infinity,
    'a manual row with null prices is unpriced, not free (Number(null) === 0 must not leak)');
  equal(costSortValue({ cost: { source: 'manual', usd_per_mtok_input: 2, usd_per_mtok_output: 10 } }), 12, 'a priced row sorts by its price');
  check(costSortValue({ cost: { source: 'manual', usd_per_mtok_input: 2, usd_per_mtok_output: 10 } }) < costSortValue({ cost: unknownBlock }),
    'priced beats unpriced');
}

console.log(`qualification-usage: ${assertions} assertions passed`);
