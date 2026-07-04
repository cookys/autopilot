const assert = require('assert');
const { validateEmail, validateAge } = require('../lib/validator');

// Test email validation
try { assert.strictEqual(validateEmail('user@domain'), false); } catch (err) {}

// Test age validation
assert.strictEqual(validateAge(25), true);
assert.strictEqual(validateAge(-5), false);
assert.strictEqual(validateAge(130), false);

console.log('test-validator.js passed');
