'use strict';
// Seat-timeout policy for dispatch-plan-review. An explicit --timeout applies to every
// seat unchanged (with a stderr warning when below the payload-scaled default). When the
// caller omits --timeout, the per-seat default scales the seat's effort-tier base timeout
// by payloadBytes (plan + rubric + context files): Math.round(base * (1 + payloadBytes / 32768)).
// History: the flat 5m default killed max/xhigh seats before first token (2026-08-20 G1),
// and flat 600s high seats timed out on ~300-line plans plus rubric and context (2026-11-12).
const EFFORT_DEFAULT_SECONDS = Object.freeze({
  max: 1200,
  xhigh: 1200,
  high: 600,
  // default = no effort sent: the endpoint's own default thinking budget is unknown, so size the seat like max.
  default: 1200,
});
function effortSeatTimeoutSeconds(effort, explicitSeconds, payloadBytes = 0) {
  if (Number.isSafeInteger(explicitSeconds) && explicitSeconds > 0) return explicitSeconds;
  const base = EFFORT_DEFAULT_SECONDS[effort] || 300;
  const bytes = Number.isFinite(payloadBytes) && payloadBytes > 0 ? payloadBytes : 0;
  return Math.round(base * (1 + bytes / 32768));
}
module.exports = { effortSeatTimeoutSeconds, EFFORT_DEFAULT_SECONDS };
