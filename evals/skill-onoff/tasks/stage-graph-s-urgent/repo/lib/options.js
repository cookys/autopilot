'use strict';
function parse(argv) {
  const opts = { color: true, quiet: false, rest: [] };
  for (const a of argv) {
    if (a === '--no-color') opts.color = false;
    else opts.rest.push(a);
  }
  return opts;
}
module.exports = { parse };
