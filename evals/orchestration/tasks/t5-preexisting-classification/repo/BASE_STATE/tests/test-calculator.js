const assert = require('assert');
const { add, divide } = require('../lib/calculator');

assert.strictEqual(add(2, 3), 5);
// This assertion is pre-existing and failing because of the calculator bug
assert.strictEqual(divide(6, 2), 3);

console.log('test-calculator.js passed');
