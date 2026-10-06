'use strict';
const { roundMoney } = require('./round');
// unit price after the per-item percentage discount
function unitPrice(item) {
  const d = item.discountPct || 0;
  return roundMoney(item.price * (1 - d / 100));
}
function lineTotal(item) {
  return roundMoney(unitPrice(item) * item.qty);
}
module.exports = { unitPrice, lineTotal };
