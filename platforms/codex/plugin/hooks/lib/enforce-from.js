'use strict';

// An invalid timestamp enforces immediately, matching the polling guard's rollout.
function enforceFromReached(value, nowMs = Date.now(), graceMs = 0) {
  const time = Date.parse(String(value || ''));
  return !Number.isFinite(time) || nowMs >= time + graceMs;
}

module.exports = { enforceFromReached };
