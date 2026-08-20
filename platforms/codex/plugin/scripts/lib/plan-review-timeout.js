'use strict';
// Seat-timeout policy for dispatch-plan-review. An explicit --timeout applies to every
// seat unchanged. When the caller omits it, the per-seat default derives from the seat's
// effort tier: the old flat 5m default killed max/xhigh reviewers before their first
// token (2026-08-20 incident, multiturn-event-harness G1 — both required-seat attempts
// dead, policy stop, zero semantics recorded).
const EFFORT_DEFAULT_SECONDS = Object.freeze({
  max: 1200,
  xhigh: 1200,
  high: 600,
});
function effortSeatTimeoutSeconds(effort, explicitSeconds) {
  if (Number.isSafeInteger(explicitSeconds) && explicitSeconds > 0) return explicitSeconds;
  return EFFORT_DEFAULT_SECONDS[effort] || 300;
}
module.exports = { effortSeatTimeoutSeconds, EFFORT_DEFAULT_SECONDS };
