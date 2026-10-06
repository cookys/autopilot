'use strict';
const fs = require('fs');
function loadItems(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
  return lines.map((l) => {
    const [name, category, qty, price] = l.split(',');
    return { name, category, qty: Number(qty), price: Number(price) };
  });
}
module.exports = { loadItems };
