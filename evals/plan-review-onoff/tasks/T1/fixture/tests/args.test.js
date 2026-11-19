const test = require('node:test'); const assert = require('node:assert');
const { parseArgs } = require('../src/cli/args');
test('quiet', () => assert.equal(parseArgs(['--quiet']).quiet, true));
