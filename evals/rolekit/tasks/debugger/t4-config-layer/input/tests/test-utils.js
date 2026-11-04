const assert = require('assert');
const { isObject } = require('../lib/utils');

assert.strictEqual(isObject({}), true);
assert.strictEqual(isObject([]), false);
assert.strictEqual(isObject(null), false);

console.log('test-utils.js passed');
