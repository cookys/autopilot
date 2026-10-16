'use strict';
const { normalize } = require('./lib/normalize');
module.exports = { writer: (v) => `writer:${normalize(v)}` };
