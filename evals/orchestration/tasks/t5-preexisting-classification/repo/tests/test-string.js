const assert = require('assert');
const { reverse } = require('../lib/string');
assert.strictEqual(reverse('abc'), 'cba');
console.log('test-string.js passed');
