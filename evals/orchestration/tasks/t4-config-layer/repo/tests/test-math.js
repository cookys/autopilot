const assert = require('assert');
const { min, max } = require('../lib/math');

assert.strictEqual(min(5, 10), 5);
assert.strictEqual(max(5, 10), 10);

console.log('test-math.js passed');
