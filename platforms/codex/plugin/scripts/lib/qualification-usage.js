'use strict';
// qualification-usage.js — per-case usage telemetry for qualification exams.
//
// One module owns the usage vocabulary so the provider, the case broker, the
// exam runner and the scorecard validator cannot drift apart:
//   - usage wire object  {input_tokens, output_tokens, reasoning_tokens, total_tokens}
//     each a non-negative safe integer or null. null means NOT MEASURED, never
//     zero. Nothing here estimates; a field the transport did not report stays null.
//   - per-case record    one row per case (or trial, for the brain seat), written
//     to `<raw-dir>/<role>-usage.jsonl`.
//   - row summary        the `usage` block on a scorecard row.
//
// `solved` is supplied by the caller from the sealed grader's own verdict; this
// module never decides pass/fail.

const USAGE_KEYS = Object.freeze(['input_tokens', 'output_tokens', 'reasoning_tokens', 'total_tokens']);
const USAGE_SCHEMA_VERSION = 1;
// Sources whose output_tokens/reasoning_tokens accounting is not verified to be
// "output includes reasoning". A row built from them is never priced.
const UNPRICEABLE_SOURCES = Object.freeze(['jsonl-opencode']);

function tokenOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Lenient: anything that is not a usable count becomes null. Used on data coming
// from a rail/transport whose shape this module does not own.
function normalizeUsage(raw) {
  const out = { input_tokens: null, output_tokens: null, reasoning_tokens: null, total_tokens: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.input_tokens = tokenOrNull(raw.input_tokens);
  out.output_tokens = tokenOrNull(raw.output_tokens);
  out.reasoning_tokens = tokenOrNull(raw.reasoning_tokens);
  out.total_tokens = tokenOrNull(raw.total_tokens);
  if (out.total_tokens === null && out.input_tokens !== null && out.output_tokens !== null) {
    // reasoning is a subset of output on every wire this exam reads; never added.
    out.total_tokens = out.input_tokens + out.output_tokens;
  }
  return out;
}

// Strict: the wire object between provider -> broker -> runner. Throws on any
// deviation so a malformed usage can never be read as a measurement.
function validateWireUsage(value, label = 'usage') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== USAGE_KEYS.slice().sort().join('\0')) {
    throw new Error(`${label} must be an object with exactly ${USAGE_KEYS.join(', ')}`);
  }
  for (const key of USAGE_KEYS) {
    if (value[key] !== null && tokenOrNull(value[key]) === null) {
      throw new Error(`${label}.${key} must be a non-negative integer or null`);
    }
  }
  return value;
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function caseRecord({
  role, unit = 'case', trialId, caseId, wallS, usage, solved, usageSource = null, rounds = null,
}) {
  const u = normalizeUsage(usage);
  return {
    schema_version: USAGE_SCHEMA_VERSION,
    role,
    unit,
    trial_id: trialId,
    case_id: caseId,
    wall_s: Number.isFinite(wallS) && wallS >= 0 ? round(wallS, 3) : null,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    reasoning_tokens: u.reasoning_tokens,
    total_tokens: u.total_tokens,
    solved: solved === true,
    usage_source: usageSource,
    ...(rounds === null ? {} : { rounds }),
  };
}

// Brain: one trial = many round exchanges. Wall adds up; a token field is known
// only if every round reported it.
function foldRounds(roundRecords) {
  const sumOrNull = (key) => (roundRecords.length > 0 && roundRecords.every((r) => r[key] !== null)
    ? roundRecords.reduce((s, r) => s + r[key], 0) : null);
  return {
    // A round with no measured wall makes the trial wall unknown; a missing wall is never 0.
    wall_s: roundRecords.length > 0 && roundRecords.every((r) => Number.isFinite(r.wall_s))
      ? roundRecords.reduce((s, r) => s + r.wall_s, 0) : null,
    usage: {
      input_tokens: sumOrNull('input_tokens'),
      output_tokens: sumOrNull('output_tokens'),
      // A round that reported no reasoning split makes the trial's reasoning unknown.
      reasoning_tokens: sumOrNull('reasoning_tokens'),
      total_tokens: sumOrNull('total_tokens'),
    },
    rounds: roundRecords.length,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// pricing: null | {inPerMtok, outPerMtok, asOf, source, ref}
// expectedCases: null | the number of cases the exam PLANNED to run. Only a fixed-plan exam knows
// it (implementer); an adaptive stop (consult/discuss/reviewer pools) legitimately runs fewer
// cases, so those callers pass nothing and the block says null instead of guessing. It exists
// because n_cases only counts cases that ran: a time-capped or aborted exam otherwise looks
// like a short, complete one (BL-0168).
function summarize(records, pricing = null, expectedCases = null) {
  if (expectedCases !== null && !(Number.isSafeInteger(expectedCases) && expectedCases >= 0)) {
    throw new Error('summarize: expectedCases must be null or a non-negative integer');
  }
  const nCases = records.length;
  const nSolved = records.filter((r) => r.solved === true).length;
  const walls = records.map((r) => r.wall_s);
  const wallComplete = nCases > 0 && walls.every((w) => w !== null);
  const totalWall = wallComplete ? round(walls.reduce((s, w) => s + w, 0), 3) : null;
  const missingTokens = records.filter((r) => r.total_tokens === null).length;
  const usageComplete = nCases > 0 && missingTokens === 0;
  const ioComplete = nCases > 0
    && records.every((r) => r.input_tokens !== null && r.output_tokens !== null);
  const sumOf = (key) => records.reduce((s, r) => s + r[key], 0);
  const unpriceable = records.some((r) => UNPRICEABLE_SOURCES.includes(r.usage_source));

  let usd = null;
  let usdReason = null;
  if (pricing) {
    if (nSolved === 0) usdReason = 'no_solved_cases';
    else if (!usageComplete) usdReason = 'usage_incomplete';
    else if (!ioComplete) usdReason = 'input_output_split_missing';
    else if (unpriceable) usdReason = 'output_accounting_unverified';
    else {
      usd = round(
        ((sumOf('input_tokens') * pricing.inPerMtok) + (sumOf('output_tokens') * pricing.outPerMtok))
          / 1e6 / nSolved,
        6,
      );
    }
  }
  return {
    schema_version: USAGE_SCHEMA_VERSION,
    n_cases: nCases,
    n_cases_expected: expectedCases,
    cases_complete: expectedCases === null ? null : nCases === expectedCases,
    n_solved: nSolved,
    total_wall_s: totalWall,
    solved_per_hour: totalWall !== null && totalWall > 0 ? round((nSolved * 3600) / totalWall, 4) : null,
    med_wall_s: wallComplete ? round(median(walls), 3) : null,
    usage_complete: usageComplete,
    n_cases_missing_tokens: missingTokens,
    total_tokens: usageComplete ? sumOf('total_tokens') : null,
    tok_per_solved: usageComplete && nSolved > 0 ? round(sumOf('total_tokens') / nSolved, 2) : null,
    io_split_complete: ioComplete,
    usd_per_solved: usd,
    ...(usdReason ? { usd_unavailable_reason: usdReason } : {}),
  };
}

// Parses the optional price flags. All-or-nothing: a partial price set is a usage error.
function parsePricing(options) {
  const names = ['priceUsdPerMtokIn', 'priceUsdPerMtokOut', 'priceAsOf', 'priceSource'];
  const given = names.filter((n) => options[n] !== undefined);
  if (given.length === 0) {
    if (options.priceRef !== undefined) throw new Error('--price-ref needs the other --price-* flags');
    return null;
  }
  if (given.length !== names.length) {
    throw new Error('--price-usd-per-mtok-in, --price-usd-per-mtok-out, --price-as-of and --price-source must be given together');
  }
  const num = (v, label) => {
    if (!/^[0-9]+(\.[0-9]+)?$/u.test(String(v))) throw new Error(`${label} must be a non-negative decimal`);
    return Number(v);
  };
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.priceAsOf) || Number.isNaN(Date.parse(options.priceAsOf))) {
    throw new Error('--price-as-of must be YYYY-MM-DD');
  }
  if (!['manual', 'measured'].includes(options.priceSource)) {
    throw new Error('--price-source must be manual or measured (the scorecard cost.source vocabulary)');
  }
  return {
    inPerMtok: num(options.priceUsdPerMtokIn, '--price-usd-per-mtok-in'),
    outPerMtok: num(options.priceUsdPerMtokOut, '--price-usd-per-mtok-out'),
    asOf: options.priceAsOf,
    source: options.priceSource,
    ref: options.priceRef === undefined ? null : String(options.priceRef).slice(0, 200),
  };
}

// The row's `cost` block. Without a price it is byte-identical to the historic
// unknown block; with one, it carries the stated source and as-of date.
function costBlock(summary, pricing) {
  if (!pricing || summary.usd_per_solved === null) {
    // Unknown price is null, never 0: a consumer that guards on `!= null` and does arithmetic would
    // otherwise see every unpriced seat as free (BL-0024).
    return { source: 'unknown', usd_per_mtok_input: null, usd_per_mtok_output: null, sample_tokens: 0 };
  }
  return {
    source: pricing.source,
    usd_per_mtok_input: pricing.inPerMtok,
    usd_per_mtok_output: pricing.outPerMtok,
    sample_tokens: summary.total_tokens,
    price_as_of: pricing.asOf,
    ...(pricing.ref ? { price_ref: pricing.ref } : {}),
  };
}

// Scorecard-side shape check: absent is fine (legacy rows); present must be coherent.
function validateUsageBlock(block) {
  const fail = (m) => { throw new Error(`usage ${m}`); };
  if (!block || typeof block !== 'object' || Array.isArray(block)) fail('must be an object');
  const intOrFail = (k) => {
    if (!Number.isSafeInteger(block[k]) || block[k] < 0) fail(`${k} must be a non-negative integer`);
  };
  const numOrNull = (k) => {
    if (block[k] !== null && !(typeof block[k] === 'number' && Number.isFinite(block[k]) && block[k] >= 0)) {
      fail(`${k} must be a non-negative number or null`);
    }
  };
  intOrFail('n_cases');
  intOrFail('n_solved');
  if (block.n_solved > block.n_cases) fail('n_solved exceeds n_cases');
  for (const k of ['total_wall_s', 'solved_per_hour', 'med_wall_s', 'tok_per_solved', 'usd_per_solved', 'total_tokens']) {
    numOrNull(k);
  }
  if (typeof block.usage_complete !== 'boolean') fail('usage_complete must be a boolean');
  // The invariant the reader relies on: an incomplete block never carries a derived token figure.
  if (block.usage_complete === false && (block.tok_per_solved !== null || block.usd_per_solved !== null
      || block.total_tokens !== null)) {
    fail('usage_complete=false requires tok_per_solved, usd_per_solved and total_tokens to be null');
  }
  if (block.usage_complete === true && block.n_cases === 0) fail('usage_complete=true requires n_cases > 0');
  if (block.usage_complete === true && (block.total_tokens === null
      || (block.n_solved > 0 && block.tok_per_solved === null))) {
    fail('usage_complete=true requires total_tokens (and tok_per_solved when n_solved > 0) to be non-null');
  }
  if (block.n_solved === 0 && (block.tok_per_solved !== null || block.usd_per_solved !== null)) {
    fail('n_solved=0 requires tok_per_solved and usd_per_solved to be null');
  }
  // Truncation fields (BL-0168). Absent on legacy blocks; when present they must agree with n_cases.
  if (block.n_cases_expected !== undefined || block.cases_complete !== undefined) {
    const expected = block.n_cases_expected;
    if (expected !== null && !(Number.isSafeInteger(expected) && expected >= 0)) {
      fail('n_cases_expected must be a non-negative integer or null');
    }
    if (expected === null) {
      if (block.cases_complete !== null) fail('cases_complete must be null when n_cases_expected is null');
    } else if (block.cases_complete !== (block.n_cases === expected)) {
      fail('cases_complete must equal (n_cases === n_cases_expected)');
    }
  }
  // Cross-checks between figures that are derived from the same records.
  if (block.n_cases_missing_tokens !== undefined) {
    intOrFail('n_cases_missing_tokens');
    if (block.n_cases_missing_tokens > block.n_cases) fail('n_cases_missing_tokens exceeds n_cases');
    if (block.usage_complete !== (block.n_cases > 0 && block.n_cases_missing_tokens === 0)) {
      fail('n_cases_missing_tokens disagrees with usage_complete');
    }
  }
  if (block.total_wall_s === null && (block.solved_per_hour !== null || block.med_wall_s !== null)) {
    fail('solved_per_hour and med_wall_s require total_wall_s (an unmeasured wall has no rate or median)');
  }
  if (block.total_wall_s !== null && block.total_wall_s > 0 && block.solved_per_hour !== null) {
    const expectedRate = (block.n_solved * 3600) / block.total_wall_s;
    if (Math.abs(block.solved_per_hour - expectedRate) > Math.max(1e-3, expectedRate * 1e-3)) {
      fail('solved_per_hour disagrees with n_solved and total_wall_s');
    }
  }
  if (block.usd_unavailable_reason !== undefined && block.usd_per_solved !== null) {
    fail('usd_unavailable_reason cannot accompany a usd_per_solved figure');
  }
  return block;
}

module.exports = {
  USAGE_KEYS,
  USAGE_SCHEMA_VERSION,
  UNPRICEABLE_SOURCES,
  normalizeUsage,
  validateWireUsage,
  caseRecord,
  foldRounds,
  summarize,
  parsePricing,
  costBlock,
  validateUsageBlock,
};
