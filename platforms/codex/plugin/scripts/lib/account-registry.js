#!/usr/bin/env node
'use strict';
// G37 P1: account registry + token store validation (plan section 5.1, 5.5, 2.5).
// Library plus a thin CLI: `list`, `check`. This file NEVER creates a token file; only the
// operator does. `check` reads a token only to measure its shape and never prints it.
//
// Exit codes: 0 ok or not configured, 2 invalid (one line reason on stderr).
// Only ENOENT on the registry path means "not configured"; every other probe error is invalid.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ALIAS_RE = /^[a-z0-9-]{1,24}$/;
const RESERVED_RE = /^(acct|codex)-[0-9a-f]{8}$/;
const SCHEMA = 'autopilot.accounts/1';
const ROW_KEYS = ['alias', 'enabled', 'priority'];
const TOP_KEYS = ['schema', 'accounts'];

class RegistryError extends Error {
  constructor(reason, alias, detail) {
    super(`${alias ? alias + ': ' : ''}${reason}${detail ? ' (' + detail + ')' : ''}`);
    this.reason = reason;
    this.alias = alias || null;
  }
}

function realHomeDir(opts) {
  return (opts && opts.realHome) || os.userInfo().homedir;
}

function accountsDir(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  if (o.accountsDir) return o.accountsDir;
  if (env.AUTOPILOT_ACCOUNTS_DIR) return env.AUTOPILOT_ACCOUNTS_DIR;
  return path.join(realHomeDir(o), '.config', 'autopilot', 'accounts');
}

function uidOf(o) {
  if (o.uid !== undefined) return o.uid;
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

// Unvalidated strings are never echoed (an operator may paste a token into an alias or key):
// diagnostics use a position or this irreversible short fingerprint instead.
function fp(v) {
  return 'fp:' + crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 8);
}

function aliasProblem(alias) {
  if (typeof alias !== 'string' || !ALIAS_RE.test(alias)) return 'alias_invalid';
  // Sentinel exception: audit uses `-` for "no alias yet", so an alias made only of dashes is
  // reserved. The grammar itself is unchanged.
  if (/^-+$/.test(alias)) return 'alias_reserved';
  if (RESERVED_RE.test(alias)) return 'alias_reserved';
  return null;
}

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Open without following links, then fstat and read from the SAME fd (no lstat-then-reopen gap).
// `what` is 'registry' or 'token'; missing -> <what>_missing; a link -> <what>_is_symlink.
function readChecked(file, o, uid, what, maxSize, needNonEmpty, alias) {
  if (typeof o.beforeOpen === 'function') o.beforeOpen(file, what);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (e) {
    const c = e && e.code;
    if (c === 'ENOENT') throw new RegistryError(what + '_missing', alias);
    if (c === 'ELOOP') throw new RegistryError(what + '_is_symlink', alias);
    throw new RegistryError(what + '_probe_error', alias, c || 'unknown');
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new RegistryError(what + '_not_regular_file', alias);
    if (uid !== undefined && st.uid !== uid) throw new RegistryError(what + '_foreign_owner', alias);
    if ((st.mode & 0o077) !== 0) throw new RegistryError(what + '_mode_too_open', alias);
    if (st.size > maxSize || (needNonEmpty && st.size < 1)) throw new RegistryError(what + '_size_out_of_range', alias);
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Only ENOENT means absent; any other probe failure is a credentials_probe_error.
function exists(p, alias) {
  try { fs.lstatSync(p); return true; } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    throw new RegistryError('credentials_probe_error', alias, e && e.code ? e.code : 'unknown');
  }
}

// Load and structurally validate registry.json. Returns {configured:false} on ENOENT only.
function loadRegistry(opts) {
  const o = opts || {};
  const dir = accountsDir(o);
  const file = path.join(dir, 'registry.json');
  const uid = uidOf(o);
  let text;
  try {
    text = readChecked(file, o, uid, 'registry', 1 << 20, false);
  } catch (e) {
    if (e instanceof RegistryError && e.reason === 'registry_missing') return { configured: false, dir, file, accounts: [] };
    throw e;
  }
  let dst;
  try {
    dst = fs.lstatSync(dir);
  } catch (e) {
    throw new RegistryError('registry_probe_error', null, e && e.code ? e.code : 'unknown');
  }
  if (dst.isSymbolicLink() || !dst.isDirectory()) throw new RegistryError('accounts_dir_not_directory');
  if ((dst.mode & 0o077) !== 0) throw new RegistryError('accounts_dir_mode_too_open');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new RegistryError('registry_not_json');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new RegistryError('registry_not_object');
  for (const k of Object.keys(doc)) {
    if (!TOP_KEYS.includes(k)) throw new RegistryError('registry_unknown_key', null, 'top-level key ' + fp(k));
  }
  if (doc.schema !== SCHEMA) throw new RegistryError('registry_schema_unsupported');
  if (!Array.isArray(doc.accounts)) throw new RegistryError('registry_accounts_not_array');
  const seen = new Set();
  const accounts = [];
  for (const [idx, row] of doc.accounts.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new RegistryError('registry_row_not_object');
    const alias = row.alias;
    for (const k of Object.keys(row)) {
      if (!ROW_KEYS.includes(k)) throw new RegistryError('registry_unknown_key', null, `row ${idx} key ${fp(k)}`);
    }
    const p = aliasProblem(alias);
    if (p) throw new RegistryError(p, null, `row ${idx} value ${fp(alias)}`);
    if (seen.has(alias)) throw new RegistryError('alias_duplicate', alias);
    seen.add(alias);
    if (typeof row.enabled !== 'boolean') throw new RegistryError('enabled_not_boolean', alias);
    if (row.priority !== undefined && !(Number.isFinite(row.priority))) {
      throw new RegistryError('priority_not_number', alias);
    }
    accounts.push({ alias, enabled: row.enabled, priority: row.priority === undefined ? 100 : row.priority });
  }
  return { configured: true, dir, file, accounts };
}

function realpathOrNull(p) {
  try { return fs.realpathSync(p); } catch (e) { return null; }
}

// Isolation + token checks for one enabled alias. Throws RegistryError.
function checkAlias(reg, alias, opts) {
  const o = opts || {};
  const uid = uidOf(o);
  const env = o.env || process.env;
  const home = realHomeDir(o);
  const dirReal = realpathOrNull(reg.dir);
  const aliasDir = path.join(reg.dir, alias);
  const realClaude = realpathOrNull(path.join(home, '.claude')) || path.join(home, '.claude');
  const realHomeReal = realpathOrNull(home) || home;
  const callerCfg = env.CLAUDE_CONFIG_DIR ? (realpathOrNull(env.CLAUDE_CONFIG_DIR) || env.CLAUDE_CONFIG_DIR) : null;

  const escapes = (why) => new RegistryError('path_escapes_isolation', alias, why);

  let ast;
  try { ast = fs.lstatSync(aliasDir); } catch (e) {
    if (e && e.code === 'ENOENT') throw new RegistryError('alias_dir_missing', alias);
    throw new RegistryError('registry_probe_error', alias, e && e.code);
  }
  if (ast.isSymbolicLink() || !ast.isDirectory()) throw escapes('alias dir is a link or not a directory');

  for (const sub of ['', 'claude', 'home']) {
    const p = sub ? path.join(aliasDir, sub) : aliasDir;
    let st = null;
    try { st = fs.lstatSync(p); } catch (e) {
      if (!(e && e.code === 'ENOENT')) throw new RegistryError('registry_probe_error', alias, e && e.code);
    }
    if (!st) {
      if (o.create === false) continue;
      fs.mkdirSync(p, { mode: 0o700 });
      st = fs.lstatSync(p);
    }
    if (st.isSymbolicLink()) throw escapes(`${sub || 'alias dir'} is a link`);
    if (!st.isDirectory()) throw escapes(`${sub || 'alias dir'} is not a directory`);
    const real = realpathOrNull(p);
    if (!real || !dirReal || !inside(real, dirReal)) throw escapes(`${sub || 'alias dir'} outside accounts dir`);
    if (real === realHomeReal) throw escapes(`${sub || 'alias dir'} equals real home`);
    if (inside(real, realClaude)) throw escapes(`${sub || 'alias dir'} inside real .claude`);
    if (callerCfg && real === callerCfg && !inside(callerCfg, dirReal)) {
      throw escapes(`${sub || 'alias dir'} is the caller config dir`);
    }
  }

  const homeDir = path.join(aliasDir, 'home');
  let hl = null;
  try { hl = fs.lstatSync(path.join(homeDir, '.claude')); } catch (e) {
    if (!(e && e.code === 'ENOENT')) throw new RegistryError('credentials_probe_error', alias, e && e.code ? e.code : 'unknown');
  }
  if (hl && hl.isSymbolicLink()) throw escapes('home/.claude is a link');
  if (exists(path.join(homeDir, '.claude', '.credentials.json'), alias)) throw escapes('home holds .claude credentials');

  const cfgDir = path.join(aliasDir, 'claude');
  if (exists(path.join(cfgDir, '.credentials.json'), alias)) throw new RegistryError('config_dir_has_credentials', alias);

  // Token file: shape only, never printed.
  const tokenFile = path.join(aliasDir, 'token');
  let body = readChecked(tokenFile, o, uid, 'token', 4096, true, alias);
  body = body.replace(/\r?\n$/, '');
  if (body.length === 0) throw new RegistryError('token_empty', alias);
  if (/\s/.test(body)) throw new RegistryError('token_whitespace', alias);
  return { alias, tokenFile, configDir: cfgDir, homeDir };
}

// Full check: every enabled alias must pass; any failure throws (the whole run fails).
function checkRegistry(opts) {
  const reg = loadRegistry(opts);
  if (!reg.configured) return { configured: false, enabled: [] };
  const enabled = [];
  for (const row of reg.accounts) {
    if (row.enabled) enabled.push(checkAlias(reg, row.alias, opts));
  }
  return { configured: true, enabled, accounts: reg.accounts, dir: reg.dir };
}

// `--alias X` must point at an enabled registered row; never a path input.
function requireAlias(reg, alias) {
  const p = aliasProblem(alias);
  if (p) throw new RegistryError(p, null, `--alias value ${fp(alias)}`);
  const row = (reg.accounts || []).find((r) => r.alias === alias);
  if (!row) throw new RegistryError('alias_not_registered', alias);
  if (!row.enabled) throw new RegistryError('alias_disabled', alias);
  return row;
}

function main(argv) {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 20 || (maj === 20 && min < 10)) {
    process.stderr.write('account-registry: node >= 20.10 required\n');
    return 2;
  }
  const cmd = argv[0];
  try {
    if (cmd === 'list') {
      const reg = loadRegistry({});
      if (!reg.configured) { process.stdout.write('unconfigured\n'); return 0; }
      for (const r of reg.accounts) process.stdout.write(`${r.alias}\t${r.enabled ? 'enabled' : 'disabled'}\t${r.priority}\n`);
      return 0;
    }
    if (cmd === 'check') {
      const r = checkRegistry({});
      process.stdout.write(r.configured ? 'ok\n' : 'unconfigured\n');
      return 0;
    }
  } catch (e) {
    if (e instanceof RegistryError) {
      process.stderr.write(`account-registry: ${e.message}\n`);
      return 2;
    }
    process.stderr.write(`account-registry: ${e && e.code ? e.code : 'error'}\n`);
    return 2;
  }
  process.stderr.write('usage: account-registry.js list|check\n');
  return 2;
}

module.exports = {
  ALIAS_RE, RESERVED_RE, SCHEMA, RegistryError,
  accountsDir, aliasProblem, loadRegistry, checkAlias, checkRegistry, requireAlias,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
