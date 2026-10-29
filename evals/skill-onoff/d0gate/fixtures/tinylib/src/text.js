'use strict';
function trim2(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function upper(s) { return String(s).toUpperCase(); }
module.exports = { trim2, upper };
