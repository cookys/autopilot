'use strict';
/**
 * account-env.js - child environment builder for the G37 account layer (plan 5.2, 2.5).
 *
 * buildEnv() is pure: allowlist the caller env, set the account variables, force the five
 * absolute locators, then delete the provider/auth names. Nothing outside the allowlist survives,
 * so a provider variable added to `claude` later cannot leak in.
 * prepareHome() is the only function here with side effects: it writes the ssh Include file and
 * the links under <alias>/home/.ssh/ (the one place a link is allowed).
 *
 * Exports: ALLOW_NAMES ALLOW_PREFIXES DELETE_NAMES DELETE_PREFIXES LOCATOR_NAMES EnvError
 *          buildEnv prepareHome
 * Built-ins only, Node >= 20.10.
 */
const fs = require('fs');
const path = require('path');

// Exact names carried from the caller. One constant, on purpose (replaces the 22-name scrub list).
const ALLOW_NAMES = [
  'PATH', 'LANG', 'TERM', 'TMPDIR', 'TZ',
  // autopilot child-session vars the rails already pass
  'AUTOPILOT_PARENT_SESSION_ID', 'AUTOPILOT_CHILD_SESSION_ID', 'AUTOPILOT_SESSION_MODE_DIR',
  'CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT', 'CLAUDE_CODE_ENABLE_TODO_TOOLS',
  // git / ssh / gh passthrough (plan 5.2)
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
  'GIT_SSH_COMMAND', 'GH_TOKEN', 'GH_HOST',
];
const ALLOW_PREFIXES = ['LC_', 'FLEET_'];

// Removed even if somehow allowlisted (plan 5.2; names from F3 and commit 2f7888042).
const DELETE_NAMES = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS',
  'AWS_BEARER_TOKEN_BEDROCK', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
];
const DELETE_PREFIXES = ['CLAUDE_CODE_USE_'];

const LOCATOR_NAMES = [
  'AUTOPILOT_ACCOUNTS_DIR', 'AUTOPILOT_LIVE_DIR', 'AUTOPILOT_STATE_DIR', 'AUTOPILOT_CONFIG', 'XDG_RUNTIME_DIR',
];

class EnvError extends Error {
  constructor(reason, detail) {
    super(detail ? `${reason} (${detail})` : reason);
    this.reason = reason;
  }
}

function allowed(name) {
  return ALLOW_NAMES.includes(name) || ALLOW_PREFIXES.some((p) => name.startsWith(p));
}
function deleted(name) {
  return DELETE_NAMES.includes(name) || DELETE_PREFIXES.some((p) => name.startsWith(p));
}

function mustBeAbsolute(label, v) {
  if (typeof v !== 'string' || !path.isAbsolute(v)) throw new EnvError('locator_unresolved', label);
  return v;
}

/**
 * args: { alias, token, configDir, homeDir, callerEnv,
 *         locators:{accountsDir, liveDir, stateDir, configFile, runtimeDir},
 *         realHome, exists (fs.existsSync-like, injectable) }
 * Returns a fresh env object. Throws EnvError (reason locator_unresolved | token_missing | home_unsafe).
 */
function buildEnv(args) {
  const a = args || {};
  const caller = a.callerEnv || {};
  const exists = a.exists || fs.existsSync;
  // A declared token seat (lane-token-resume) must hand the parent's
  // CLAUDE_CODE_OAUTH_TOKEN to the child. An empty parent token refuses even when
  // the alias file has a token. Ordinary callers keep the alias-file token.
  const tokenSeat = caller.AUTOPILOT_TOKEN_SEAT === '1';
  const parentToken = typeof caller.CLAUDE_CODE_OAUTH_TOKEN === 'string' ? caller.CLAUDE_CODE_OAUTH_TOKEN : '';
  if (tokenSeat && parentToken.length === 0) {
    throw new EnvError('token_seat_missing', 'AUTOPILOT_TOKEN_SEAT=1 but CLAUDE_CODE_OAUTH_TOKEN is missing; refusing to spawn claude (would fall back to the host login)');
  }
  if (!tokenSeat && (typeof a.token !== 'string' || a.token.length === 0)) throw new EnvError('token_missing');
  const loc = a.locators || {};
  const realHome = mustBeAbsolute('realHome', a.realHome);
  const homeDir = mustBeAbsolute('homeDir', a.homeDir);
  const configDir = mustBeAbsolute('configDir', a.configDir);
  if (path.resolve(homeDir) === path.resolve(realHome)) throw new EnvError('home_unsafe', 'child HOME equals real home');

  const env = {};
  for (const [k, v] of Object.entries(caller)) {
    if (typeof v === 'string' && allowed(k)) env[k] = v;
  }
  // Read-only references to the REAL git/gh config; never copies.
  const gitconfig = path.join(realHome, '.gitconfig');
  const xdgBase = typeof caller.XDG_CONFIG_HOME === 'string' && path.isAbsolute(caller.XDG_CONFIG_HOME)
    ? caller.XDG_CONFIG_HOME : path.join(realHome, '.config');
  const xdgGit = path.join(xdgBase, 'git', 'config');
  if (exists(gitconfig)) env.GIT_CONFIG_GLOBAL = gitconfig;
  else if (exists(xdgGit)) env.GIT_CONFIG_GLOBAL = xdgGit;
  const ghDir = path.join(realHome, '.config', 'gh');
  if (exists(ghDir)) env.GH_CONFIG_DIR = ghDir;

  if (tokenSeat) {
    env.CLAUDE_CODE_OAUTH_TOKEN = parentToken;
    env.AUTOPILOT_TOKEN_SEAT = '1';
  } else {
    env.CLAUDE_CODE_OAUTH_TOKEN = a.token;
  }
  env.CLAUDE_CONFIG_DIR = configDir;
  env.HOME = homeDir;
  env.AUTOPILOT_ACCOUNT = a.alias;

  env.AUTOPILOT_ACCOUNTS_DIR = mustBeAbsolute('accountsDir', loc.accountsDir);
  env.AUTOPILOT_LIVE_DIR = mustBeAbsolute('liveDir', loc.liveDir);
  env.AUTOPILOT_STATE_DIR = mustBeAbsolute('stateDir', loc.stateDir);
  env.AUTOPILOT_CONFIG = mustBeAbsolute('configFile', loc.configFile);
  // config-path.js reads this name; keep both so a nested call resolves the same file.
  env.AUTOPILOT_CONFIG_FILE = env.AUTOPILOT_CONFIG;
  env.XDG_RUNTIME_DIR = mustBeAbsolute('runtimeDir', loc.runtimeDir);

  for (const k of Object.keys(env)) {
    if (deleted(k)) delete env[k];
  }
  return env;
}

function linkIfDifferent(target, linkPath) {
  let cur = null;
  try { cur = fs.readlinkSync(linkPath); } catch (_) { /* absent or not a link */ }
  if (cur === target) return;
  try { fs.unlinkSync(linkPath); } catch (_) { /* absent */ }
  fs.symlinkSync(target, linkPath);
}

/**
 * Write <homeDir>/.ssh/config (Include of the real one) and link known_hosts / id_* from the real
 * ~/.ssh. These links are allowed only under home/.ssh/. No-op when the real ~/.ssh is absent.
 */
function prepareHome(args) {
  const { homeDir, realHome } = args;
  if (path.resolve(homeDir) === path.resolve(realHome)) throw new EnvError('home_unsafe', 'child HOME equals real home');
  const realSsh = path.join(realHome, '.ssh');
  const sshDir = path.join(homeDir, '.ssh');
  const cfg = path.join(sshDir, 'config');
  // Destination link checks come first: they hold whether or not the real ~/.ssh exists.
  let dst = null;
  try { dst = fs.lstatSync(sshDir); } catch (_) { /* absent */ }
  if (dst && (dst.isSymbolicLink() || !dst.isDirectory())) throw new EnvError('ssh_path_is_link', '.ssh');
  let cst = null;
  try { cst = fs.lstatSync(cfg); } catch (_) { /* absent */ }
  if (cst && (cst.isSymbolicLink() || !cst.isFile())) throw new EnvError('ssh_path_is_link', '.ssh/config');
  if (!fs.existsSync(realSsh)) return { ssh: false };
  if (!dst) fs.mkdirSync(sshDir, { mode: 0o700 });
  fs.chmodSync(sshDir, 0o700);
  // tmp file + rename: the write never follows a link at the final name.
  const tmp = `${cfg}.${require('crypto').randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, `Include ${path.join(realSsh, 'config')}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, cfg);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* not created */ }
    throw new EnvError('ssh_config_write_failed', e && e.code ? e.code : 'error');
  }
  let linked = 0;
  for (const name of fs.readdirSync(realSsh)) {
    if (name === 'known_hosts' || name.startsWith('id_')) {
      linkIfDifferent(path.join(realSsh, name), path.join(sshDir, name));
      linked++;
    }
  }
  return { ssh: true, linked };
}

module.exports = {
  ALLOW_NAMES, ALLOW_PREFIXES, DELETE_NAMES, DELETE_PREFIXES, LOCATOR_NAMES, EnvError,
  buildEnv, prepareHome,
};
