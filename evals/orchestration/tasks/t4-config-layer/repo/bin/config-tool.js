const { loadConfig } = require('../lib/config');
const config = loadConfig();
console.log(`Port: ${config.port}, Theme: ${config.theme}`);
