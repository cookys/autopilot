'use strict';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function setKey(items) { return JSON.stringify([...new Set(items.map(x => JSON.stringify(canonical(x))))].sort()); }
function matches(event) {
  const actual = event.intents || [];
  return event.valid_answers.some(answer => setKey(actual) === setKey(answer.intents || []) && (actual.length > 0 || (typeof event.reply_category === 'string' && event.reply_category === answer.reply_category)));
}
// Events are aligned to the frozen sample order. Each includes valid_answers and divergent.
function scoreArm(events) {
  if (!Array.isArray(events) || !events.length) throw new Error('frozen sample must be nonempty');
  const consistent = events.map(e => !e.divergent && matches(e));
  const divergences = events.filter(e => e.divergent).length;
  return { events, consistent, n: events.length, divergence_rate: divergences / events.length, agreement: consistent.filter(Boolean).length / events.length };
}
function compareArms(baseline, treatment, { screening = false } = {}) {
  if (baseline.n !== treatment.n) throw new Error('sample sizes differ');
  const paired = baseline.events.map((e, i) => !e.divergent && !treatment.events[i].divergent);
  const n = paired.filter(Boolean).length;
  const rate = arm => n ? arm.consistent.filter((v, i) => paired[i] && v).length / n : null;
  const baseline_paired = rate(baseline), treatment_paired = rate(treatment);
  const fullFail = treatment.agreement < baseline.agreement - 0.05 - 1e-12;
  const pairedFail = n ? treatment_paired < baseline_paired - 0.05 - 1e-12 : null;
  let verdict;
  if (baseline.divergence_rate > 0.3) verdict = 'baseline_invalid';
  else if (!n || fullFail !== pairedFail || treatment.divergence_rate > 0.3) verdict = 'indeterminate';
  else verdict = fullFail || pairedFail ? 'block' : 'pass';
  const baseline_invalid = verdict === 'baseline_invalid';
  if (screening) verdict = verdict === 'block' ? 'eliminate' : 'inconclusive';
  return { verdict, baseline_invalid, baseline_paired, treatment_paired, paired_n: n };
}
module.exports = { scoreArm, compareArms };
