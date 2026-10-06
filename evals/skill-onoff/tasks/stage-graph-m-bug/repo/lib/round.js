'use strict';
// round to cents
function roundMoney(x) {
  return Math.floor(x * 100) / 100;
}
module.exports = { roundMoney };
