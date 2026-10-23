'use strict';
// Call fn(); on failure retry up to MAX_RETRIES more times, then throw the last error.
const MAX_RETRIES = 1;

function withRetry(fn) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return fn(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

module.exports = { withRetry, MAX_RETRIES };
