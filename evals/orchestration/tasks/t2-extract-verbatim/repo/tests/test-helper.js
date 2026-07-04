const assert = require('assert');
const { getTimestamp } = require('../lib/helper');
assert.ok(getTimestamp().includes('T'));
console.log('test-helper.js passed');
