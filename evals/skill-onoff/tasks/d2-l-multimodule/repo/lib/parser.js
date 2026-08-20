'use strict';
function parse(input) {
  return String(input).trim().split(/\s+/).filter(Boolean);
}
module.exports = { parse };
