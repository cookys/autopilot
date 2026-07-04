const assert = require('assert');
const { add, subtract } = require('../lib/math');
assert.strictEqual(add(2, 3), 5);
assert.strictEqual(subtract(5, 2), 3);
console.log('test-math.js passed');
