const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const configPath = path.join(__dirname, '../config.json');

// Reset config
fs.writeFileSync(configPath, JSON.stringify({ timeout: 5 }), 'utf8');

const output = execSync('node bin/tool.js', { env: { ...process.env, CONFIG_PATH: configPath } }).toString();
assert.ok(output.includes('Active timeout: 5000 ms'), 'Should output active timeout in ms');

console.log("All tests passed.");
