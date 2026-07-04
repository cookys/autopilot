const assert = require('assert');
const { execSync } = require('child_process');

// Run client on happy path
const stdout = execSync('API_KEY=test-key node bin/client.js success').toString();
assert.ok(stdout.includes('Success'), 'Happy path should output success');

console.log("All tests passed.");
