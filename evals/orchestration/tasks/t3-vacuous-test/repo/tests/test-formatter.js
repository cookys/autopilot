const assert = require('assert');
const { formatName } = require('../lib/formatter');
assert.strictEqual(formatName('John', 'Doe'), 'John Doe');
console.log('test-formatter.js passed');
