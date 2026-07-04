const fs = require('fs');
const path = require('path');

function run() {
  const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      // Ignore
    }
  }

  const timeoutSec = config.timeout !== undefined ? config.timeout : 30;
  console.log(`Active timeout: ${timeoutSec * 1000} ms`);
}

if (require.main === module) {
  run();
}

module.exports = { run };
