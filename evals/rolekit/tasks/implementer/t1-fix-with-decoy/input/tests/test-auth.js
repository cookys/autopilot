const assert = require('assert');
const { checkRole } = require('../lib/auth');
assert.strictEqual(checkRole({ roles: ['admin'] }, 'admin'), true);
assert.strictEqual(checkRole(null, 'admin'), false);
console.log('test-auth.js passed');
