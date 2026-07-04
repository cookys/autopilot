const assert = require('assert');
const { parseJsonFile } = require('../lib/parser');

const config = parseJsonFile('config/defaults.json');
assert.strictEqual(config.theme, 'light');

console.log('test-parser.js passed');
