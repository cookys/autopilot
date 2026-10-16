'use strict';
function build(rows) { return rows.map((r) => ({ name: r.name, total: r.qty * r.price })); }
function renderText(items) { return items.map((i) => `${i.name}: ${i.total.toFixed(2)}`).join('\n'); }
module.exports = { build, renderText };
