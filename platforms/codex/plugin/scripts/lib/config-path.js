'use strict';
// config-path.js — the ONE place that decides which operator config file to read.
//   configPath({ env?, home? }) -> $AUTOPILOT_CONFIG_FILE when set (non-empty), else <home>/.autopilot/config.json
// `home` defaults to os.homedir(). Path only: parsing and defaults stay with each caller.
// Shell callers inline the same rule: "${AUTOPILOT_CONFIG_FILE:-$HOME/.autopilot/config.json}". BL-0181.
const os = require('os');
const path = require('path');

function configPath(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  if (env.AUTOPILOT_CONFIG_FILE) return env.AUTOPILOT_CONFIG_FILE;
  return path.join(o.home || os.homedir(), '.autopilot', 'config.json');
}

module.exports = { configPath };
