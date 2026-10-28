'use strict';
function trim2(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function upper(s) { return String(s).toUpperCase(); }
function capitalize(s) { const t = String(s); return t.charAt(0).toUpperCase() + t.slice(1); }
module.exports = { trim2, upper, capitalize };
