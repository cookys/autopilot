'use strict';
function parse(s) { return String(s).split(/\s+/).filter(Boolean); }
module.exports = { parse };
