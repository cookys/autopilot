const assert = require('assert');
const { login } = require('../lib/auth');
assert.strictEqual(login('admin', 'secret'), true);
assert.strictEqual(login('user', 'pass'), false);
console.log('test-auth.js passed');
