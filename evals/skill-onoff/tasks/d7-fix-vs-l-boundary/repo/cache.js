'use strict';
const { normalize } = require('./lib/normalize');
module.exports = { cache: (v) => `cache:${normalize(v)}` };
