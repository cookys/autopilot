'use strict';
/**
 * repair-recheck.js — the generation-cap repair recheck shared by dispatch-plan-review.js
 * (`--repair-recheck`) and hetero-review-loop.js (`recheck`).
 *
 * WHY: both review loops stop at two generations. When generation 2 still lists candidate blockers,
 * the PM used to read every finding. After the repair, ONE cheap reviewer seat of a family other than
 * the implementer's compares, per blocker only, the blocker's original claim/repair text with the
 * repaired section and answers fixed | not_fixed with a one-line reason. It cannot raise new findings:
 * the answer schema has no field for them and any extra key makes the whole answer invalid.
 *
 * Failure it prevents: a repaired blocker that is still broken freezing as READY (not_fixed keeps the
 * adjudication), and a recheck seat widening into a third review generation (extra keys are rejected).
 *
 * Seat choice reads the caller's own roster (plan manifest seats + fallbacks, or the review-loop
 * resolver's panel); this module only filters (never the implementer's family) and orders cheapest
 * effort first. The Chinese-model gate stays in each caller's dispatch path.
 */

const POLICY_PASSED = 'generation_cap_repair_recheck_passed';
const POLICY_ADJUDICATION = 'generation_cap_requires_depth_0_adjudication';
const ANSWER_STATUSES = new Set(['fixed', 'not_fixed']);
const MAX_SEAT_TRIES = 1;
const EFFORT_RANK = Object.freeze({ low: 1, medium: 2, high: 3, xhigh: 4, max: 5, default: 6 });

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Usage a runner reported, or null. Never a guess: absent numbers stay null, never 0. */
function normalizeUsage(raw) {
  if (!isRecord(raw)) return null;
  const num = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
  const input = num(raw.input_tokens);
  const output = num(raw.output_tokens);
  let total = num(raw.total_tokens);
  if (total === null && input !== null && output !== null) total = input + output;
  if (input === null && output === null && total === null) return null;
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

/** Sum of the non-null usages; null when no attempt reported any. */
function sumUsage(usages) {
  const reported = (usages || []).map(normalizeUsage).filter(Boolean);
  if (reported.length === 0) return null;
  const sum = (key) => {
    const values = reported.map((usage) => usage[key]).filter((value) => value !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return {
    input_tokens: sum('input_tokens'),
    output_tokens: sum('output_tokens'),
    total_tokens: sum('total_tokens'),
  };
}

function sumDuration(items) {
  return (items || []).reduce((sum, item) => sum + (Number.isFinite(item.duration_ms) ? item.duration_ms : 0), 0);
}

function parseAnswerText(text) {
  let body = String(text || '').trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(body);
  if (fenced) body = fenced[1].trim();
  try {
    return JSON.parse(body);
  } catch (error) {
    return undefined;
  }
}

/**
 * Strict answer check. Shape: { results: [ { id, status, reason } ] } and nothing else, at either
 * level. Every blocker id exactly once; an id outside the blocker set is invalid.
 */
function validateAnswer(parsed, blockerIds) {
  if (!isRecord(parsed)) return { ok: false, error: 'answer is not a JSON object' };
  const topKeys = Object.keys(parsed);
  if (topKeys.length !== 1 || topKeys[0] !== 'results') {
    return { ok: false, error: `answer keys must be exactly "results" (got ${topKeys.join(', ') || 'none'})` };
  }
  if (!Array.isArray(parsed.results)) return { ok: false, error: 'results must be an array' };
  const wanted = new Set(blockerIds);
  const seen = new Set();
  const results = [];
  for (const item of parsed.results) {
    if (!isRecord(item)) return { ok: false, error: 'a result is not an object' };
    const keys = Object.keys(item).sort().join(',');
    if (keys !== 'id,reason,status') return { ok: false, error: `a result must carry exactly id, status, reason (got ${keys})` };
    if (typeof item.id !== 'string' || !wanted.has(item.id)) {
      return { ok: false, error: `result id ${JSON.stringify(item.id)} is not in the blocker set` };
    }
    if (seen.has(item.id)) return { ok: false, error: `result id ${item.id} appears twice` };
    if (!ANSWER_STATUSES.has(item.status)) return { ok: false, error: `result ${item.id} status must be fixed or not_fixed` };
    if (typeof item.reason !== 'string' || item.reason.trim() === '') {
      return { ok: false, error: `result ${item.id} needs a non-empty reason` };
    }
    seen.add(item.id);
    results.push({ id: item.id, status: item.status, reason: item.reason.trim().replace(/\s+/g, ' ') });
  }
  const missing = blockerIds.filter((id) => !seen.has(id));
  if (missing.length) return { ok: false, error: `missing a result for ${missing.length} blocker(s): ${missing.slice(0, 3).join(', ')}` };
  return { ok: true, results };
}

/**
 * Seats allowed to recheck: never a family the implementer belongs to; cheapest effort first.
 * `familyOf(seat)` returns the seat's family (or null/'unknown', which is never eligible: an
 * unknown family cannot be shown to differ from the implementer's).
 */
function eligibleSeats(seats, implementerFamilies, familyOf) {
  const barred = new Set(implementerFamilies.filter(Boolean));
  const eligible = [];
  const excluded = [];
  for (const seat of seats) {
    const family = familyOf(seat);
    if (!family || family === 'unknown' || barred.has(family)) {
      excluded.push({ seat_id: seat.id, family: family || null });
    } else {
      eligible.push(seat);
    }
  }
  const rank = (seat) => (Object.prototype.hasOwnProperty.call(EFFORT_RANK, seat.effort) ? EFFORT_RANK[seat.effort] : 99);
  eligible.sort((a, b) => rank(a) - rank(b));
  return { eligible, excluded };
}

function buildPrompt({ kind, items, nonce, appendix = '' }) {
  const blocks = items.map((item) => `<BLOCKER_${nonce} id="${item.id}">
ORIGINAL CLAIM:
${item.original}

REPAIR ASKED FOR:
${item.repair || '(none stated)'}

REPAIRED ${kind === 'plan' ? 'SECTION' : 'HUNKS'}:
${item.repaired}
</BLOCKER_${nonce}>`).join('\n\n');
  return `You are the repair-recheck seat. A ${kind} review stopped at its generation cap with blockers; the ${kind} has since been repaired.
For each blocker below and ONLY for that blocker, decide whether the repaired ${kind === 'plan' ? 'section' : 'hunks'} now resolves the original claim.
Answer fixed or not_fixed with a one-line reason. Do not raise new findings, do not review anything else.

Return one JSON object and nothing else, exactly this shape:
{"results":[{"id":"<blocker id>","status":"fixed|not_fixed","reason":"<one line>"}]}
Every blocker id must appear exactly once. Any other key anywhere makes the whole answer invalid.

${blocks}
${appendix ? `\n<FULL_${kind.toUpperCase()}_${nonce}>\n${appendix}\n</FULL_${kind.toUpperCase()}_${nonce}>\n` : ''}`;
}

/**
 * Run the recheck. `ask(seat, prompt)` is the caller's transport; it returns
 * { ok, text, usage, duration_ms, error }. Never throws for a transport failure.
 *
 * status: passed | failed (some not_fixed) | invalid (answer rejected, nothing frozen) |
 *         no_seat (no eligible seat: fails closed to PM adjudication) | unavailable (every try failed in transport).
 */
async function runRecheck({ kind, blockers, seats, implementerFamilies, familyOf, ask, nonce, appendix = '' }) {
  const blockerIds = blockers.map((blocker) => blocker.id);
  const { eligible, excluded } = eligibleSeats(seats, implementerFamilies, familyOf);
  const base = {
    kind,
    blocker_count: blockers.length,
    excluded_seats: excluded,
    seat: null,
    attempts: [],
    results: [],
    not_fixed_ids: [],
    error: null,
  };
  const finish = (status, extra = {}) => {
    const out = { ...base, ...extra, status };
    out.usage = sumUsage(out.attempts.map((attempt) => attempt.usage));
    out.duration_ms = sumDuration(out.attempts);
    return out;
  };
  if (eligible.length === 0) {
    return finish('no_seat', { error: 'no recheck seat of a family other than the implementer\'s is available' });
  }
  const prompt = buildPrompt({ kind, items: blockers, nonce, appendix });
  for (const seat of eligible.slice(0, MAX_SEAT_TRIES)) {
    const answer = await ask(seat, prompt);
    const attempt = {
      seat_id: seat.id,
      attempt: base.attempts.length + 1,
      usage: normalizeUsage(answer.usage),
      duration_ms: Number.isFinite(answer.duration_ms) ? answer.duration_ms : 0,
      outcome: answer.ok ? 'answered' : 'transport_failed',
      ...(answer.ok ? {} : { error: String(answer.error || 'no answer').slice(0, 200) }),
    };
    base.attempts.push(attempt);
    if (!answer.ok) continue;
    const seatInfo = { id: seat.id, family: familyOf(seat), runner: seat.runner, model: seat.model || seat.engine, effort: seat.effort };
    const parsed = parseAnswerText(answer.text);
    const checked = validateAnswer(parsed, blockerIds);
    if (!checked.ok) {
      attempt.outcome = 'invalid';
      return finish('invalid', { seat: seatInfo, error: checked.error });
    }
    const notFixed = checked.results.filter((result) => result.status === 'not_fixed').map((result) => result.id);
    return finish(notFixed.length === 0 ? 'passed' : 'failed', {
      seat: seatInfo,
      results: checked.results,
      not_fixed_ids: notFixed,
    });
  }
  return finish('unavailable', { error: 'every eligible recheck seat failed in transport' });
}

/** The public recheck block (what lands in an artifact). */
function recheckBlock(run, extra = {}) {
  return {
    status: run.status,
    blocker_count: run.blocker_count,
    seat: run.seat,
    excluded_seats: run.excluded_seats,
    results: run.results,
    not_fixed_ids: run.not_fixed_ids,
    error: run.error,
    attempts: run.attempts,
    usage: run.usage,
    duration_ms: run.duration_ms,
    ...extra,
  };
}

module.exports = {
  POLICY_PASSED,
  POLICY_ADJUDICATION,
  buildPrompt,
  eligibleSeats,
  normalizeUsage,
  parseAnswerText,
  recheckBlock,
  runRecheck,
  sumDuration,
  sumUsage,
  validateAnswer,
};
