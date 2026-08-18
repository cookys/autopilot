'use strict';
// parseQuery("a=1&=x&b=2") should keep the empty-key entry ["", "x"].
function parseQuery(s) {
  const out = [];
  for (const seg of String(s).split('&')) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue; // BUG: `<= 0` also drops empty-key segments like "=x"
    out.push([seg.slice(0, eq), seg.slice(eq + 1)]);
  }
  return out;
}
module.exports = { parseQuery };
