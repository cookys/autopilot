const assert = require('assert');
const { clamp, average } = require('../lib/math');

assert.strictEqual(clamp(5, 0, 10), 5);
assert.strictEqual(clamp(-5, 0, 10), 0);
assert.strictEqual(clamp(15, 0, 10), 10);
assert.strictEqual(average([1, 2, 3]), 2);
assert.strictEqual(average([]), 0);

console.log('test-math.js passed');
