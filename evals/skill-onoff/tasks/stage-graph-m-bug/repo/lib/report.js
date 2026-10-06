'use strict';
const { lineTotal } = require('./pricing');
const { roundMoney } = require('./round');
function invoiceTotal(items) {
  let sum = 0;
  for (const it of items) {
    let t = lineTotal(it);
    if (it.discountPct) t = roundMoney(t * (1 - it.discountPct / 100));
    sum += t;
  }
  return roundMoney(sum);
}
module.exports = { invoiceTotal };
