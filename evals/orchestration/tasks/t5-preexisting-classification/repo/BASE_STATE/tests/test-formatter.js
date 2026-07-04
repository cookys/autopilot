const assert = require('assert');
const { formatCurrency } = require('../lib/formatter');

assert.strictEqual(formatCurrency(123.456), '$123.46');
assert.strictEqual(formatCurrency(10), '$10.00');

console.log('test-formatter.js passed');
