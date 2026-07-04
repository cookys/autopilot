const assert = require('assert');
const { capitalize } = require('../lib/string');
assert.strictEqual(capitalize('hello'), 'Hello');
assert.strictEqual(capitalize(''), '');
console.log('test-string.js passed');
