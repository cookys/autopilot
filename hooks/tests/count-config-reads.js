// Test preload: append one line to $AUTOPILOT_CONFIG_PARSE_COUNT_FILE per read of .autopilot/config.json.
const fs = require('fs');
const orig = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  const f = process.env.AUTOPILOT_CONFIG_PARSE_COUNT_FILE;
  if (f && typeof p === 'string' && p.endsWith('.autopilot/config.json')) {
    try { fs.appendFileSync(f, 'read\n'); } catch { /* test only */ }
  }
  return orig.call(this, p, ...rest);
};
