'use strict';
// Retry policy: how many attempts a job gets and the delay before each next attempt.
// A fixed delay and a maximum attempt count are all there is today; backoff and jitter are not
// implemented yet.
const DEFAULT_POLICY = { maxAttempts: 3, delayMs: 1000 };
function shouldRetry(job, policy = DEFAULT_POLICY) {
  return (job.attempts || 0) < policy.maxAttempts;
}
function delayFor(job, policy = DEFAULT_POLICY) {
  return policy.delayMs;
}
module.exports = { DEFAULT_POLICY, shouldRetry, delayFor };
