'use strict';

const os = require('os');
const path = require('path');

function stateDir(env = process.env) {
  const e = env || {};
  const abs = (v) => (typeof v === 'string' && path.isAbsolute(v) ? v : '');
  const over = abs(e.AUTOPILOT_STATE_DIR);
  if (over) return over;
  const xdg = abs(e.XDG_STATE_HOME);
  if (xdg) return path.join(xdg, 'autopilot');
  const home = abs(e.HOME) || os.homedir();
  return path.join(home, '.local', 'state', 'autopilot');
}

module.exports = { stateDir };
