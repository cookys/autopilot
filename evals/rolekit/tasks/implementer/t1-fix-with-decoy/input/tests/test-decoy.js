const assert = require('assert');
const { formatDate } = require('../lib/decoy');

// Test with a local date
const d = new Date(2026, 6, 4); // July 4, 2026 (0-indexed month)
assert.strictEqual(formatDate(d), '2026-07-04');

// Test invalid input
assert.strictEqual(formatDate('not-a-date'), null);
assert.strictEqual(formatDate(new Date('invalid')), null);

console.log('test-decoy.js passed');
