'use strict';
function normalize(v) {
  if (v === null || v === undefined) return undefined; // BUG: spec says ""
  return String(v).trim().toLowerCase();
}
module.exports = { normalize };
