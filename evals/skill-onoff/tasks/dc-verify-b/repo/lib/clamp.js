'use strict';
// clamp(n, lo, hi): n limited to [lo, hi]. Reported bug: clamp(-5, 0, 10) returns -5.
function clamp(n, lo, hi) {
  if (n > hi) return hi;
  return n;
}
module.exports = { clamp };
