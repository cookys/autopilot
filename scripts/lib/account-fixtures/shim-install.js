'use strict';
/**
 * shim-install.js - test helpers for the G37 account layer (plan P3).
 *   installShim(tmpRoot, control) -> { binDir, shimPath, controlFile, setControl(c), spawns() }
 *     copies claude-shim.js to <tmpRoot>/bin/claude (mode 0755, a copy, not a link) and writes the
 *     control file beside it.
 *   makeFixture(opts) -> a complete tempdir world: fake passwd home with a DECOY credentials file,
 *     accounts dir + registry + per-alias dirs/tokens, live dir, state dir, config file, shim, and
 *     the caller env (PATH with the shim first, TMPDIR, XDG_RUNTIME_DIR, AUTOPILOT_* locators).
 * Test-only. Tokens are FAKE- literals. Built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHIM_SRC = path.join(__dirname, 'claude-shim.js');

function installShim(tmpRoot, control) {
  const binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true, mode: 0o755 });
  const shimPath = path.join(binDir, 'claude');
  fs.copyFileSync(SHIM_SRC, shimPath);
  fs.chmodSync(shimPath, 0o755);
  const controlFile = path.join(binDir, 'shim-control.json');
  const log = path.join(tmpRoot, 'shim.log');
  const state = { control: Object.assign({ log }, control || {}) };
  const write = () => fs.writeFileSync(controlFile, JSON.stringify(state.control));
  write();
  return {
    binDir, shimPath, controlFile, log,
    setControl(c) { state.control = Object.assign({ log }, c); write(); },
    spawns() { return readLog(log).length; },
    calls() { return readLog(log); },
  };
}

function readLog(log) {
  try {
    return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (_) { return []; }
}

const OK = { exit: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' }) + '\n' };
const R401 = {
  exit: 1,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, terminal_reason: 'api_error',
    result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.' }) + '\n',
};
const R429 = {
  exit: 1,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, terminal_reason: 'api_error',
    result: "API Error: Server is temporarily limiting requests (not your usage limit) · This request would exceed your account's rate limit. (local synthetic)" }) + '\n',
};
const R429_USAGE = {
  exit: 1,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, terminal_reason: 'api_error',
    result: 'API Error: 429 Claude AI usage limit reached|1799999999' }) + '\n',
};
const ERR_EXIT0 = {
  exit: 0,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'something went wrong' }) + '\n',
};

/**
 * opts: { aliases: [{alias, token?, enabled?, priority?}], config: {...config.json content},
 *         responses: { <alias>: response }, snapshots: { <alias>: snapshotObject } }
 */
function makeFixture(opts) {
  const o = opts || {};
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'g37-fix-')));
  const realHome = path.join(root, 'fakehome');
  const decoy = path.join(realHome, '.claude', '.credentials.json');
  fs.mkdirSync(path.dirname(decoy), { recursive: true });
  fs.writeFileSync(decoy, '{"claudeAiOauth":{"accessToken":"DECOY-CREDS-NOT-REAL"}}');
  const accountsDir = path.join(realHome, '.config', 'autopilot', 'accounts');
  fs.mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(accountsDir, 0o700);
  const liveDir = path.join(root, 'live');
  const stateDir = path.join(root, 'state');
  const runtimeDir = path.join(root, 'run');
  const tmpDir = path.join(root, 'tmp');
  for (const d of [liveDir, stateDir, runtimeDir, tmpDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(o.config || {}));

  const aliases = o.aliases || [{ alias: 'a' }, { alias: 'b' }];
  const rows = [];
  const tokens = {};
  aliases.forEach((x, i) => {
    const token = x.token === undefined ? `FAKE-token-${x.alias}-${i}` : x.token;
    tokens[x.alias] = token;
    const d = path.join(accountsDir, x.alias);
    fs.mkdirSync(path.join(d, 'claude'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(d, 'home'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(d, 'token'), token, { mode: 0o600 });
    fs.chmodSync(path.join(d, 'token'), 0o600);
    rows.push({ alias: x.alias, enabled: x.enabled !== false, priority: x.priority === undefined ? 10 * (i + 1) : x.priority });
  });
  const regFile = path.join(accountsDir, 'registry.json');
  fs.writeFileSync(regFile, JSON.stringify({ schema: 'autopilot.accounts/1', accounts: rows }), { mode: 0o600 });
  fs.chmodSync(regFile, 0o600);

  const tokenControl = {};
  for (const [al, resp] of Object.entries(o.responses || {})) tokenControl[tokens[al]] = resp;
  const shim = installShim(root, { default: OK, tokens: tokenControl });

  if (o.snapshots) {
    const qdir = path.join(liveDir, 'codeforge', 'usage', 'quota');
    fs.mkdirSync(qdir, { recursive: true, mode: 0o700 });
    for (const [al, snap] of Object.entries(o.snapshots)) fs.writeFileSync(path.join(qdir, al + '.json'), JSON.stringify(snap), { mode: 0o600 });
  }

  const env = {
    PATH: `${shim.binDir}:${process.env.PATH}`,
    LANG: 'C', TMPDIR: tmpDir,
    HOME: realHome, // the caller's HOME on purpose: a correct builder must NOT hand this to the child
    XDG_RUNTIME_DIR: runtimeDir,
    AUTOPILOT_ACCOUNTS_DIR: accountsDir, AUTOPILOT_LIVE_DIR: liveDir, AUTOPILOT_STATE_DIR: stateDir,
    AUTOPILOT_CONFIG: configFile,
  };
  return {
    root, realHome, decoy, accountsDir, liveDir, stateDir, runtimeDir, tmpDir, configFile, regFile,
    tokens, shim, env, auditFile: path.join(stateDir, 'accounts-audit.jsonl'),
    cooldownDir: path.join(liveDir, 'accounts', 'cooldown'),
    writeConfig(c) { fs.writeFileSync(configFile, JSON.stringify(c)); },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

module.exports = { installShim, makeFixture, readLog, OK, R401, R429, R429_USAGE, ERR_EXIT0, SHIM_SRC };
