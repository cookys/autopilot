'use strict';

// Seat and ledger raw_log values. A path under $HOME is stored as ~/... .
// Any other absolute path is stored relative to the ledger directory when the
// caller has one. A path that already starts with ~ or is already relative is
// left unchanged. resolveRawLog opens all three, and an old absolute path.

const path = require('path');

const RAW_LOG_KEYS = new Set(['raw_log', 'first_raw_log']);

function homeOf(home) {
  const value = home === undefined ? process.env.HOME : home;
  if (typeof value !== 'string' || value.length === 0) return null;
  const resolved = path.resolve(value);
  return resolved.length > 0 ? resolved : null;
}

function isUnder(abs, root) {
  return abs === root || abs.startsWith(root + path.sep);
}

function isAbsHomePath(abs) {
  return abs === '/home' || abs === '/Users'
    || abs.startsWith('/home/') || abs.startsWith('/Users/');
}

function portableRawLog(value, ledgerDir, home) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (value === '~' || value.startsWith('~/')) return value;
  if (!path.isAbsolute(value)) return value;
  const abs = path.resolve(value);
  const root = homeOf(home);
  if (root && isUnder(abs, root)) {
    const rest = abs.slice(root.length);
    return rest.length === 0 ? '~' : '~' + rest;
  }
  if (typeof ledgerDir === 'string' && ledgerDir.length > 0) {
    const rel = path.relative(path.resolve(ledgerDir), abs);
    if (!path.isAbsolute(rel)) return rel.length === 0 ? '.' : rel;
  }
  if (isAbsHomePath(abs)) {
    const base = (typeof ledgerDir === 'string' && ledgerDir.length > 0)
      ? path.resolve(ledgerDir) : process.cwd();
    const rel = path.relative(base, abs);
    if (!path.isAbsolute(rel)) return rel.length === 0 ? '.' : rel;
  }
  return abs;
}

function resolveRawLog(value, ledgerDir, home) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (value === '~') {
    const root = homeOf(home);
    return root || value;
  }
  if (value.startsWith('~/')) {
    const root = homeOf(home);
    if (!root) return value;
    return path.join(root, value.slice(2));
  }
  if (path.isAbsolute(value)) return path.resolve(value);
  if (typeof ledgerDir === 'string' && ledgerDir.length > 0) return path.resolve(ledgerDir, value);
  return path.resolve(value);
}

function portableRawLogInPlace(value, ledgerDir, home) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) portableRawLogInPlace(item, ledgerDir, home);
    return value;
  }
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (RAW_LOG_KEYS.has(key) && typeof child === 'string') {
      value[key] = portableRawLog(child, ledgerDir, home);
    } else if (child && typeof child === 'object') {
      portableRawLogInPlace(child, ledgerDir, home);
    }
  }
  return value;
}

module.exports = { portableRawLog, resolveRawLog, portableRawLogInPlace };
