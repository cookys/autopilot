const assert = require('assert');
const { LOG_PREFIX, formatMessage, formatError } = require('../lib/logger');

assert.strictEqual(formatMessage('hello'), `${LOG_PREFIX} hello`);
assert.strictEqual(formatMessage(''), `${LOG_PREFIX} `);
assert.strictEqual(formatError('failed', new Error('boom')), `${LOG_PREFIX} ERROR: failed (boom)`);
assert.strictEqual(formatError('failed', 'raw string err'), `${LOG_PREFIX} ERROR: failed (raw string err)`);

console.log('test-logger.js passed');
