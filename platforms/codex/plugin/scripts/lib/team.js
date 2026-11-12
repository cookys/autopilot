'use strict';
/**
 * team.js — this home's team role (menucard card routing).
 *
 * Reads $HOME/.autopilot/team.json: { "role": "pm"|"lane"|"lead"|"solo", "pm": "<address optional>" }.
 * solo must be written explicitly. A missing file with a courier marker for THIS home is lane
 * (fail closed). A missing file and no marker is solo, which is today's behaviour.
 * The marker is $HOME/.config/fleet/hub.toml, or $XDG_CONFIG_HOME/fleet/hub.toml when that
 * directory is inside $HOME. AUTOPILOT_COURIER=1|yes|true|on or 0|no|false|off overrides the marker.
 * A courier on PATH, or a socket outside this home, is not this home's courier.
 * Bad JSON, an unknown role, or an unreadable file is lane.
 * Node built-ins only. This module sends nothing and writes nothing.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROLES = new Set(['solo', 'pm', 'lane', 'lead']);

function homeDir() {
  return process.env.HOME || os.homedir();
}

function teamFile() {
  return path.join(homeDir(), '.autopilot', 'team.json');
}

function courierPresent() {
  const flag = process.env.AUTOPILOT_COURIER;
  if (typeof flag === 'string' && flag.trim()) {
    const v = flag.trim().toLowerCase();
    if (v === '1' || v === 'yes' || v === 'true' || v === 'on') return true;
    if (v === '0' || v === 'no' || v === 'false' || v === 'off') return false;
  }
  const home = path.resolve(homeDir());
  const markers = [path.join(home, '.config', 'fleet', 'hub.toml')];
  const xdg = process.env.XDG_CONFIG_HOME;
  if (typeof xdg === 'string' && xdg.trim()) {
    const dir = path.resolve(xdg);
    if (dir === home || dir.startsWith(`${home}${path.sep}`)) markers.push(path.join(dir, 'fleet', 'hub.toml'));
  }
  return markers.some((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

function resolve() {
  let raw;
  try {
    raw = fs.readFileSync(teamFile(), 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { role: courierPresent() ? 'lane' : 'solo', source: 'default', pm: null };
    return { role: 'lane', source: 'unreadable', pm: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { role: 'lane', source: 'bad-json', pm: null };
  }
  const role = parsed && typeof parsed.role === 'string' ? parsed.role.trim().toLowerCase() : '';
  const pm = parsed && typeof parsed.pm === 'string' && parsed.pm.trim() ? parsed.pm.trim() : null;
  if (!ROLES.has(role)) return { role: 'lane', source: 'bad-role', pm };
  return { role, source: 'file', pm };
}

module.exports = { resolve, courierPresent, teamFile, homeDir };
