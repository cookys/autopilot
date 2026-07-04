const assert = require('assert');
const { checkToken } = require('../lib/auth');
assert.strictEqual(checkToken('valid-token'), true);
assert.strictEqual(checkToken('bad'), false);
console.log('test-auth.js passed');
