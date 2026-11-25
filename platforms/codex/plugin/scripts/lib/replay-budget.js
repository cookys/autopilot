'use strict';
function amount(n) { if (!Number.isFinite(n) || n < 0) throw new TypeError('amount must be finite and nonnegative'); return n; }
function weightedCost({read=0, cache_write_5m=0, cache_write_1h=0, input=0, output=0} = {}) {
  return amount(read)*0.1 + amount(cache_write_5m)*1.25 + amount(cache_write_1h)*2 + amount(input) + amount(output)*5;
}
// manifest contains total_limit and estimate. Each reservation is settled exactly once.
function createBudget(manifest) {
  const limit = amount(manifest.total_limit), estimate = amount(manifest.estimate);
  let spent = 0, reserved = 0, halted = false;
  const pending = new Map();
  return {
    reserve(maximum) {
      amount(maximum);
      if (halted || maximum > limit - spent - reserved) return null;
      const token = {}; pending.set(token, maximum); reserved += maximum; return token;
    },
    settle(token, actual) {
      amount(actual);
      if (!pending.has(token)) throw new Error('unknown or settled reservation');
      reserved -= pending.get(token); pending.delete(token); spent += actual;
      if (spent > estimate * 1.5 || spent > limit) halted = true;
      return { spent, reserved, halted };
    },
    report() { return { spent, reserved, halted, limit, estimate }; }
  };
}
module.exports = { createBudget, weightedCost };
