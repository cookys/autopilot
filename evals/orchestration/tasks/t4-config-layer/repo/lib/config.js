const { parseJsonFile } = require('./parser');

function loadConfig() {
  const defaults = parseJsonFile('config/defaults.json');
  const override = parseJsonFile('config/override.json');
  
  const env = {};
  if (process.env.PORT) {
    env.port = parseInt(process.env.PORT, 10);
  }
  if (process.env.THEME) {
    env.theme = process.env.THEME;
  }
  
  // Buggy precedence resolution:
  // env has lowest priority, override highest
  const resolved = Object.assign({}, env, defaults, override);
  return resolved;
}

module.exports = { loadConfig };
