'use strict';
const assert = require('assert');
const t = require('../src/text.js');
assert.strictEqual(t.trim2('  a   b '), 'a b');
assert.strictEqual(t.upper('ab'), 'AB');
console.log('ok');
