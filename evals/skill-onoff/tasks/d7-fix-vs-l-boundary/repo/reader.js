'use strict';
const { normalize } = require('./lib/normalize');
module.exports = { reader: (v) => `reader:${normalize(v)}` };
