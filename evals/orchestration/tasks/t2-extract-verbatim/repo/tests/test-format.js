const assert = require('assert');
const { formatLog } = require('../lib/format');
assert.strictEqual(formatLog('info', 'test'), '[INFO] test');
console.log('test-format.js passed');
