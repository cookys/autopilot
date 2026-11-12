'use strict';
/**
 * team.js — this home's team role (menucard card routing).
 *
 * Reads $HOME/.autopilot/team.json: { "role": "pm"|"lane"|"lead"|"solo", "pm": "<address optional>" }.
 * A missing file is solo, which is today's behaviour. The new routing stays inert until
 * that mode file exists. Bad JSON, an unknown role, or an unreadable file is lane
 * (fail closed once the operator opted in by writing the file).
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

function resolve() {
  let raw;
  try {
    raw = fs.readFileSync(teamFile(), 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { role: 'solo', source: 'default', pm: null };
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

module.exports = { resolve, teamFile, homeDir };
