const assert = require('assert');
const { add, sub } = require('../lib/math');
assert.strictEqual(add(2, 3), 5);
assert.strictEqual(sub(5, 2), 3);
console.log('test-math.js passed');
