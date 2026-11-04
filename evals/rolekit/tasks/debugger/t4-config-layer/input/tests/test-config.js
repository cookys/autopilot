const assert = require('assert');
const { loadConfig } = require('../lib/config');

const config = loadConfig();
assert.strictEqual(typeof config, 'object');
assert.ok(config.port);
assert.strictEqual(config.theme, 'light');

console.log('test-config.js passed');
