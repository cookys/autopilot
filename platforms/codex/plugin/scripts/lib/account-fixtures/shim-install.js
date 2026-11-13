'use strict';
/**
 * shim-install.js - test helpers for the G37 account layer (plan P3).
 *   installShim(tmpRoot, control) -> { binDir, shimPath, controlFile, setControl(c), spawns() }
 *     copies claude-shim.js to <tmpRoot>/bin/claude (mode 0755, a copy, not a link) and writes the
 *     control file beside it.
 *   makeFixture(opts) -> a complete tempdir world: fake passwd home with a DECOY credentials file,
 *     accounts dir + registry + per-alias dirs/tokens, live dir, state dir, config file, shim, and
 *     the caller env (PATH with the shim first, TMPDIR, XDG_RUNTIME_DIR, AUTOPILOT_* locators).
 *     The fixture root is mkdtemp under os.tmpdir() so TMPDIR stays on that filesystem (git
 *     clone --local hardlinks into it). Only the live dir is its own mkdtemp under /dev/shm:
 *     codeforge rejects any other filesystem and would fall through to the uid live dir.
 *     AUTOPILOT_CODEFORGE_COLLECT is off. cleanup() removes the root and the live dir.
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
// BL-0372: a dual-format response. The shim renders `result` as json or stream-json by the argv's --output-format.
// Invented fixture values, not real CLI output.
const DUAL_RESULT = {
  duration_api_ms: 812, stop_reason: 'end_turn', session_id: 'S', total_cost_usd: 0.0034,
  usage: { input_tokens: 5, output_tokens: 1 }, modelUsage: { 'claude-haiku-5-5': { inputTokens: 5, outputTokens: 1 } },
  permission_denials: [], terminal_reason: 'completed', fast_mode_state: 'off', is_error: false, num_turns: 1,
  subtype: 'success', api_error_status: null, result: 'OK', ttft_ms: 400, type: 'result', duration_ms: 900, uuid: 'U',
};
const DUAL_OK = { exit: 0, result: DUAL_RESULT };
const ERR_EXIT0 = {
  exit: 0,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'something went wrong' }) + '\n',
};

// BL-0375: an unset `accounts.quota_probe` follows the manifest (on-demand probe for a stale alias), so a fixture pins it
// to `off` unless the test sets it or asks for the manifest default with `probeFromManifest: true`. This keeps the G37
// and capture scenarios free of an unrelated probe spawn; the manifest-default tests opt in explicitly.
function pinProbeOff(config, probeFromManifest) {
  const c = JSON.parse(JSON.stringify(config || {}));
  if (probeFromManifest) return c;
  if (c.accounts === undefined) c.accounts = {};
  if (c.accounts !== null && typeof c.accounts === 'object' && !Array.isArray(c.accounts) && c.accounts.quota_probe === undefined) c.accounts.quota_probe = 'off';
  return c;
}

/**
 * opts: { aliases: [{alias, token?, enabled?, priority?}], config: {...config.json content},
 *         responses: { <alias>: response }, snapshots: { <alias>: snapshotObject }, probeFromManifest?: boolean }
 */
function makeFixture(opts) {
  const o = opts || {};
  // No disk fallback: a non-tmpfs live dir is rejected by codeforge and the collect
  // lands on the uid directory. /dev/shm is tmpfs. The fixture root stays on os.tmpdir()
  // so TMPDIR can hardlink; only the live dir is on tmpfs. cleanup() removes both.
  if (!fs.existsSync('/dev/shm')) throw new Error('makeFixture: /dev/shm is required so the live dir stays on tmpfs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'g37-fix-')));
  const liveDir = fs.realpathSync(fs.mkdtempSync(path.join('/dev/shm', 'g37-fix-live-')));
  fs.chmodSync(liveDir, 0o700);
  const realHome = path.join(root, 'fakehome');
  const decoy = path.join(realHome, '.claude', '.credentials.json');
  fs.mkdirSync(path.dirname(decoy), { recursive: true });
  fs.writeFileSync(decoy, '{"claudeAiOauth":{"accessToken":"DECOY-CREDS-NOT-REAL"}}');
  const accountsDir = path.join(realHome, '.config', 'autopilot', 'accounts');
  fs.mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(accountsDir, 0o700);
  const stateDir = path.join(root, 'state');
  const runtimeDir = path.join(root, 'run');
  const tmpDir = path.join(root, 'tmp');
  for (const d of [stateDir, runtimeDir, tmpDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(pinProbeOff(o.config, o.probeFromManifest)));

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
    AUTOPILOT_CODEFORGE_COLLECT: 'off',
  };
  return {
    root, realHome, decoy, accountsDir, liveDir, stateDir, runtimeDir, tmpDir, configFile, regFile,
    tokens, shim, env, auditFile: path.join(stateDir, 'accounts-audit.jsonl'),
    cooldownDir: path.join(liveDir, 'accounts', 'cooldown'),
    writeConfig(c) { fs.writeFileSync(configFile, JSON.stringify(pinProbeOff(c, o.probeFromManifest))); },
    cleanup() {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      finally { fs.rmSync(liveDir, { recursive: true, force: true }); }
    },
  };
}

// Test-only negative controls: compile `file` with exact text replacements applied and return its exports. Every `from` must
// occur exactly once, so a mutant that no longer applies fails loudly instead of silently testing the original. No switch
// exists in production code; the mutation lives only in this in-memory copy.
function loadPatched(file, replacements) {
  const Module = require('module');
  let src = fs.readFileSync(file, 'utf8').replace(/^#!.*\n/, '\n');
  for (const [from, to] of replacements) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`loadPatched: expected exactly one match, got ${n}: ${from.slice(0, 60)}`);
    src = src.replace(from, () => to);
  }
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}

module.exports = { loadPatched, installShim, makeFixture, readLog, OK, R401, R429, R429_USAGE, ERR_EXIT0, DUAL_RESULT, DUAL_OK, SHIM_SRC };
