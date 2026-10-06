'use strict';
function row(cells, widths) {
  return cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
}
function table(header, rows) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  return [row(header, widths), ...rows.map((r) => row(r, widths))].join('\n');
}
module.exports = { table };
