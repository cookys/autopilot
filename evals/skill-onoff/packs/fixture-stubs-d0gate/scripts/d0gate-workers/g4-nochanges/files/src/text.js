'use strict';
function trim2(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function upper(s) { return String(s).toUpperCase(); }
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
module.exports = { trim2, upper, slugify };
