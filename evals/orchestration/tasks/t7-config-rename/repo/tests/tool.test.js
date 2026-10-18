const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't7-config-'));
const configPath = path.join(tmpDir, 'config.json');

try {
  fs.writeFileSync(configPath, JSON.stringify({ timeout: 5 }), 'utf8');

  const output = execSync('node bin/tool.js', { env: { ...process.env, CONFIG_PATH: configPath } }).toString();
  assert.ok(output.includes('Active timeout: 5000 ms'), 'Should output active timeout in ms');

  console.log("All tests passed.");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
