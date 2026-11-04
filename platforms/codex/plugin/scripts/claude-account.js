#!/usr/bin/env node
'use strict';
/**
 * claude-account.js - G37 account layer CLI (plan project/plans/2026-11-03-g37-account-switching.md 5.2-5.7).
 *
 *   node scripts/claude-account.js pick      [--purpose T] [--exclude a,b]
 *   node scripts/claude-account.js env-check [--alias A] [--any]
 *   node scripts/claude-account.js run       --purpose T [--alias A] [--max-attempts N] [--stdin F] [--stdout F]
 *                                            [--stderr F] [--cwd D] [--timeout SECS] -- claude <argv...>
 *   node scripts/claude-account.js exec      (--alias A | --pick) [--purpose T] -- <cmd...>
 *   node scripts/claude-account.js usage-probe --alias A [--purpose T]
 *   node scripts/claude-account.js usage-probe --due [--dry-run]     (periodic: only when the manifest gate passes; see account-probe.js)
 *                                            one tiny model call as alias A (the manifest's tinyprobe argv); prints
 *                                            {alias, windows} and publishes the observation as source=probe
 *   node scripts/claude-account.js sync-statusline [--alias A]
 *                                            convert each alias's codeforge statusline snapshot into a local mirror row
 *                                            (quota-reporter.js); `run` does the same once before its first gather
 *   node scripts/claude-account.js status    [--limit N]
 *   node scripts/claude-account.js cooldown  --clear <alias>
 *   node scripts/claude-account.js selftest                 (Node shim, throwaway dir)
 *   node scripts/claude-account.js selftest --real-binary [--binary P]
 *                                            operator-run spike (plan O6): FAKE- token against the real claude, never in a suite
 *   node scripts/claude-account.js selftest --simulate-429 <A> [--binary P]
 *                                            operator-run (plan O9): A answers a locally synthesized 429, then the next alias runs
 *
 * Exit codes:
 *   0 ok
 *   2 invalid / config (registry, token, config dir, env, usage); one stderr line, no spawn
 *   3 none available (no enabled alias, all cooling or excluded, refuse_all_tight, pinned alias cooling)
 *   4 all limited (every attempt was rate_limited, or max_attempts reached)
 *   5 child error (structured error envelope with child exit 0, or the child could not be started)
 *   6 auth stop (401 / auth-stop table on the chosen alias; no further alias is tried; STOP_AUTH alias=<A>)
 *   7 token scrubbed (the child printed the token; only scrubbed bytes were written)
 *   anything else on `run` (incl. 124 timeout): the child's own exit code for a non-structured failure.
 *
 * Fail closed: once a registry exists nothing here continues with ambient credentials. The token is
 * read here and handed to the child only as CLAUDE_CODE_OAUTH_TOKEN in its environment.
 * `run` scrubs the exact token value from child stdout/stderr (also across chunks) before any file
 * or forwarded stream is written. `exec` (interactive lane) is not mediated.
 *
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const registry = require('./lib/account-registry');
const quota = require('./lib/account-quota');
const cooldown = require('./lib/account-cooldown');
const { pick, judge } = require('./lib/account-pick');
const observation = require('./lib/account-observation');
const capture = require('./lib/account-capture');
const probe = require('./lib/account-probe');
const reporter = require('./quota-reporter');
const interpret = require('./lib/account-interpret');
const audit = require('./lib/account-audit');
const accountEnv = require('./lib/account-env');
const authStop = require('./lib/auth-stop');
const { resolveLiveDir } = require('./lib/live-state-dir');

const EXIT = { OK: 0, INVALID: 2, NONE: 3, LIMITED: 4, CHILD_ERROR: 5, AUTH: 6, SCRUBBED: 7 };
const PURPOSE_RE = /^[a-z0-9-]{1,32}$/;
const SCRUB_MARK = Buffer.from('[token-scrubbed]');
const THROTTLE_COOLDOWN_MINUTES = 5; // plain server throttle: shorter than a quota exhaustion
const DEFAULT_MAX_ATTEMPTS = 3;
const TERM_GRACE_MS = 5000; // SIGTERM/SIGINT forwarded to the child; still alive after this => SIGKILL

/**
 * Linux: run the child under `setpriv --pdeathsig KILL` so it is SIGKILLed by the kernel when this wrapper
 * dies by a signal Node cannot catch (SIGKILL from a uutils `timeout`, which signals only its direct child).
 * The token stays in the child env only; setpriv execs the real command and adds nothing to argv but itself.
 * Absent setpriv (or non-Linux) => unchanged argv (residual risk: wrapper SIGKILL can orphan the child).
 */
let setprivBin;
function pdeathsigPrefix() {
  if (setprivBin === undefined) {
    setprivBin = null;
    if (process.platform === 'linux') {
      for (const c of ['/usr/bin/setpriv', '/bin/setpriv']) {
        if (!fs.existsSync(c)) continue;
        const r = spawnSync(c, ['--pdeathsig', 'KILL', 'true'], { stdio: 'ignore' });
        if (r.status === 0) { setprivBin = c; break; }
      }
    }
  }
  return setprivBin ? [setprivBin, '--pdeathsig', 'KILL', '--'] : [];
}

/**
 * With setpriv in front, a missing or non-executable child binary no longer surfaces as a spawn 'error' event
 * (setpriv itself starts fine and then exits 127). Resolve the command the way execvp would and return the
 * errno code a direct spawn would have reported ('ENOENT' / 'EACCES'), or null when it can be executed.
 */
function preflightExec(cmd0, env, cwd) {
  const isExe = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
  const canX = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (_) { return false; } };
  // execvp falls back to a default search path when PATH is not set at all (an empty PATH still means cwd).
  const searchPath = env && typeof env.PATH === 'string' ? env.PATH : '/bin:/usr/bin';
  const base = cwd || process.cwd();
  const resolveIn = (name) => {
    const cands = name.includes('/') ? [path.resolve(base, name)]
      : searchPath.split(':').map((d) => path.resolve(base, d || '.', name));
    let found = false;
    for (const c of cands) {
      if (!isExe(c)) continue;
      found = true;
      if (canX(c)) return { path: c, err: null };
    }
    return { path: null, err: found ? 'EACCES' : 'ENOENT' };
  };
  const r = resolveIn(cmd0);
  if (r.err) return r.err;
  // A script whose shebang interpreter is missing makes setpriv answer 127 just like a missing binary.
  let head = '';
  try {
    const fd = fs.openSync(r.path, 'r');
    try { const buf = Buffer.alloc(256); head = buf.toString('latin1', 0, fs.readSync(fd, buf, 0, 256, 0)); } finally { fs.closeSync(fd); }
  } catch (_) { return null; }
  if (!head.startsWith('#!')) return null;
  // Conservative: reject only when the kernel would certainly fail. Anything unusual is left to the real exec.
  const line = head.slice(2).split('\n')[0];
  if (line.includes('\r')) return null;
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (!toks.length || !toks[0].startsWith('/')) return null;
  const interp = resolveIn(toks[0]);
  if (interp.err) return interp.err;
  if (path.basename(toks[0]) === 'env') {
    const t = toks[1];
    // Only a bare `env NAME` (no option, no assignment, no path) is checked; -S/-u/-C/-i etc. are left to exec.
    if (t && !t.startsWith('-') && !t.includes('=') && !t.includes('/')) {
      const target = resolveIn(t);
      if (target.err) return target.err;
    }
  }
  return null;
}

/** Forward SIGTERM/SIGINT to the child, escalate to SIGKILL after TERM_GRACE_MS. Returns a disposer. */
function installSignalForwarding(child) {
  let killTimer = null;
  const fwd = (sig) => () => {
    try { child.kill(sig); } catch (_) { /* gone */ }
    if (!killTimer) {
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, TERM_GRACE_MS);
    }
  };
  const onTerm = fwd('SIGTERM');
  const onInt = fwd('SIGINT');
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  return () => {
    if (killTimer) clearTimeout(killTimer);
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
  };
}

class Stop extends Error {
  constructor(code, line, auditOutcome) {
    super(line);
    this.exitCode = code;
    this.auditOutcome = auditOutcome || null;
  }
}

// ---------------------------------------------------------------- scrub

/** Streaming exact-match scrubber. Holds back the last len(token)-1 bytes across chunk boundaries. */
function createScrubber(token) {
  const tok = Buffer.from(token, 'utf8');
  let carry = Buffer.alloc(0);
  const s = {
    hit: false,
    push(chunk) {
      const raw = Buffer.concat([carry, chunk]);
      const out = [];
      let i = 0;
      for (;;) {
        const idx = raw.indexOf(tok, i);
        if (idx < 0) break;
        out.push(raw.subarray(i, idx), SCRUB_MARK);
        i = idx + tok.length;
        s.hit = true;
      }
      const rest = raw.subarray(i);
      const keep = Math.min(tok.length - 1, rest.length);
      out.push(rest.subarray(0, rest.length - keep));
      carry = Buffer.from(rest.subarray(rest.length - keep));
      return Buffer.concat(out);
    },
    end() {
      // A held-back tail that ends with a (long enough) token prefix is a truncated token: scrub it.
      const minLen = Math.min(8, tok.length - 1);
      let k = Math.min(carry.length, tok.length - 1);
      for (; k >= Math.max(minLen, 1); k--) {
        if (carry.subarray(carry.length - k).equals(tok.subarray(0, k))) break;
      }
      let out = carry;
      if (k >= Math.max(minLen, 1)) {
        out = Buffer.concat([carry.subarray(0, carry.length - k), SCRUB_MARK]);
        s.hit = true;
      }
      carry = Buffer.alloc(0);
      return out;
    },
  };
  return s;
}

// ---------------------------------------------------------------- context / config

function writeAll(fd, buf) {
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(fd, buf, off, buf.length - off); } catch (e) {
      if (e && e.code === 'EAGAIN') continue;
      throw e;
    }
  }
}

function makeCtx(deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const realHome = d.realHome || os.userInfo().homedir;
  const ctx = {
    env, realHome,
    now: d.now || (() => Date.now()),
    write: d.write || ((fd, data) => writeAll(fd, Buffer.isBuffer(data) ? data : Buffer.from(String(data)))),
    uid: d.uid,
  };
  ctx.err = (line) => ctx.write(2, `claude-account: ${line}\n`);
  ctx.out = (line) => ctx.write(1, `${line}\n`);
  ctx.regOpts = { realHome, env, uid: d.uid };
  ctx.accountsDir = registry.accountsDir({ realHome, env });
  try { ctx.liveDir = resolveLiveDir({ env, warn: d.warn }).base; } catch (_) { ctx.liveDir = null; }
  ctx.stateDir = env.AUTOPILOT_STATE_DIR
    || path.join(env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(realHome, '.local', 'state'), 'autopilot');
  ctx.configFile = env.AUTOPILOT_CONFIG || env.AUTOPILOT_CONFIG_FILE || path.join(realHome, '.autopilot', 'config.json');
  ctx.auditFile = path.join(ctx.stateDir, 'accounts-audit.jsonl');
  ctx.cooldownDir = ctx.liveDir ? path.join(ctx.liveDir, 'accounts', 'cooldown') : null;
  return ctx;
}

function runtimeDir(ctx) {
  if (ctx.env.XDG_RUNTIME_DIR) return ctx.env.XDG_RUNTIME_DIR;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const cand = uid === null ? null : `/run/user/${uid}`;
  if (cand && fs.existsSync(cand)) return cand;
  throw new Stop(EXIT.INVALID, 'locator_unresolved (XDG_RUNTIME_DIR)', 'invalid_config');
}

function readConfig(ctx) {
  let text;
  try { text = fs.readFileSync(ctx.configFile, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    throw new Stop(EXIT.INVALID, `config_unreadable (${e && e.code ? e.code : 'error'})`, 'invalid_config');
  }
  let j;
  try { j = JSON.parse(text); } catch (_) { throw new Stop(EXIT.INVALID, 'config_not_json', 'invalid_config'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Stop(EXIT.INVALID, 'config_not_object', 'invalid_config');
  return j;
}

/** accounts.* knobs with defaults; an out-of-range value is invalid (exit 2), never silently defaulted. */
function accountsConfig(ctx) {
  const raw = readConfig(ctx).accounts;
  const a = raw === undefined ? {} : raw;
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Stop(EXIT.INVALID, 'config_accounts_not_object', 'invalid_config');
  const cfg = { mode: 'auto', refuse_all_tight: false, cooldown_default_minutes: cooldown.DEFAULT_MINUTES, max_attempts: DEFAULT_MAX_ATTEMPTS };
  if (a.mode !== undefined) {
    if (a.mode !== 'auto' && a.mode !== 'off') throw new Stop(EXIT.INVALID, 'config_accounts_mode_invalid', 'invalid_config');
    cfg.mode = a.mode;
  }
  if (a.refuse_all_tight !== undefined) {
    if (typeof a.refuse_all_tight !== 'boolean') throw new Stop(EXIT.INVALID, 'config_refuse_all_tight_invalid', 'invalid_config');
    cfg.refuse_all_tight = a.refuse_all_tight;
  }
  if (a.cooldown_default_minutes !== undefined) {
    if (!Number.isFinite(a.cooldown_default_minutes) || a.cooldown_default_minutes <= 0) {
      throw new Stop(EXIT.INVALID, 'config_cooldown_default_minutes_invalid', 'invalid_config');
    }
    cfg.cooldown_default_minutes = a.cooldown_default_minutes;
  }
  if (a.max_attempts !== undefined) {
    if (!Number.isInteger(a.max_attempts) || a.max_attempts < 1 || a.max_attempts > 99) {
      throw new Stop(EXIT.INVALID, 'config_max_attempts_invalid', 'invalid_config');
    }
    cfg.max_attempts = a.max_attempts;
  }
  // G40 D4 (plan 10): capture and probe knobs. Range errors are exit 2 like the rest of this function, never defaulted.
  cfg.quota_capture = 'on';
  if (a.quota_capture !== undefined) {
    if (a.quota_capture !== 'on' && a.quota_capture !== 'off') throw new Stop(EXIT.INVALID, 'config_quota_capture_invalid', 'invalid_config');
    cfg.quota_capture = a.quota_capture;
  }
  cfg.host_role = 'agent';
  if (a.host_role !== undefined) {
    if (typeof a.host_role !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(a.host_role)) throw new Stop(EXIT.INVALID, 'config_host_role_invalid', 'invalid_config');
    cfg.host_role = a.host_role;
  }
  const probeProblem = probe.checkProbeConfig(a);
  if (probeProblem) throw new Stop(EXIT.INVALID, probeProblem, 'invalid_config');
  cfg.quota_probe = probe.resolveProbeMode(claudeManifest(), a.quota_probe); // unset follows the manifest (BL-0375); explicit off wins
  if (!probe.probeModeAllowed(claudeManifest(), cfg.quota_probe)) { // N66: `scheduled` needs starts_window false + high confidence + evidence + a recorded Q5
    throw new Stop(EXIT.INVALID, 'config_quota_probe_scheduled_rejected (the manifest does not say starts_window=false with high confidence, evidence and a recorded quota_share_per_probe)', 'invalid_config');
  }
  cfg.quota_probe_stale_minutes = a.quota_probe_stale_minutes === undefined ? probe.STALE_MINUTES_DEFAULT : a.quota_probe_stale_minutes;
  cfg.quota_probe_timeout_secs = a.quota_probe_timeout_secs === undefined ? probe.TIMEOUT_SECS_DEFAULT : a.quota_probe_timeout_secs;
  const envMode = ctx.env.AUTOPILOT_ACCOUNT_MODE;
  if (envMode !== undefined && envMode !== '') {
    if (envMode !== 'auto' && envMode !== 'off') throw new Stop(EXIT.INVALID, 'env_accounts_mode_invalid', 'invalid_config');
    cfg.mode = envMode;
  }
  return cfg;
}

function auditLine(ctx, rec, tokens) {
  if (ctx.noWrite) return; // `usage-probe --due --dry-run`: no audit line on any path, refusals included
  try {
    audit.appendAudit(rec, { path: ctx.auditFile, now: ctx.now(), tokens: tokens || [] });
  } catch (e) {
    ctx.err(`audit_write_failed (${String(e && e.message).slice(0, 80)})`);
  }
}

function preAudit(ctx, purpose, outcome) {
  auditLine(ctx, { alias: '-', purpose: purpose || 'unspecified', attempt: 0, outcome });
}

/** Run the 5.1 validation for EVERY enabled alias; returns the checked registry. Stops on any problem. */
function loadChecked(ctx, purpose) {
  let res;
  try {
    res = registry.checkRegistry(ctx.regOpts);
  } catch (e) {
    if (e instanceof registry.RegistryError) {
      preAudit(ctx, purpose, 'invalid_config');
      throw new Stop(EXIT.INVALID, e.message, null);
    }
    preAudit(ctx, purpose, 'invalid_config');
    throw new Stop(EXIT.INVALID, `registry_error (${e && e.code ? e.code : 'error'})`, null);
  }
  return res;
}

function readToken(tokenFile) {
  const body = fs.readFileSync(tokenFile, 'utf8').replace(/\r?\n$/, '');
  if (body.length === 0 || /\s/.test(body)) throw new Stop(EXIT.INVALID, 'token_invalid', 'invalid_config');
  return body;
}

// ---------------------------------------------------------------- pick data

// ---------------------------------------------------------------- quota mirror (G40 D3, local rows only)

let manifestCache;
function claudeManifest() {
  if (manifestCache === undefined) {
    try { manifestCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'quota-adapters', 'claude.json'), 'utf8')); } catch (_) { manifestCache = null; }
  }
  return manifestCache === null ? undefined : manifestCache;
}

// The usable rows of <live>/quota/claude/<alias>.json, or [] for anything that is not a plain readable view
// (absent file, null liveDir, damaged file, wrong schema). There is no hub this wave: configuredNamespace is null,
// so selectView keeps the local row only and every peer row is ignored (fail closed).
function mirrorRows(ctx, alias, binding) {
  if (!ctx.liveDir) return [];
  try {
    const r = observation.readView(ctx.liveDir, 'claude', alias);
    if (!r.view) return [];
    const b = binding || observation.readNamespaceBinding(ctx.liveDir);
    return interpret.selectView(r.view, { configuredNamespace: null, boundNamespace: b.namespace }).rows
      .filter((row) => row.writer_courier === observation.LOCAL_COURIER); // only the local courier's row counts here
  } catch (_) { return []; }
}

// Seconds since the newest window or refusal observation across the rows, or null when there is none (a placeholder
// row, or no row at all, is zero observations).
function observationAgeS(rows, nowMs) {
  let newest = null;
  for (const r of rows) {
    const rec = r && r.record;
    if (!rec) continue;
    const stamps = (Array.isArray(rec.windows) ? rec.windows.map((w) => w && w.observed_at) : []).concat(rec.refusal ? [rec.refusal.observed_at] : []);
    for (const t of stamps) if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  return newest === null ? null : Math.max(0, Math.floor(nowMs / 1000 - newest));
}

function gather(ctx, checked, excludeList, pinned, cfg) {
  const nowMs = ctx.now();
  const accounts = checked.accounts.filter((r) => r.enabled && (!pinned || r.alias === pinned))
    .map((r) => ({ alias: r.alias, priority: r.priority }));
  const snapshots = {};
  const roots = {};
  const notes = [];
  for (const acct of accounts) {
    const raw = quota.readSnapshotFile(ctx.liveDir, acct.alias);
    snapshots[acct.alias] = raw && raw.__error ? null : raw;
    const info = checked.enabled.find((e) => e.alias === acct.alias);
    let real = info.configDir;
    try { real = fs.realpathSync(info.configDir); } catch (_) { /* keep as is */ }
    roots[acct.alias] = quota.hash8(real);
  }
  const cooldowns = cooldown.readAllCooldowns(accounts.map((x) => x.alias), { dir: ctx.cooldownDir, nowMs });
  const out = {
    accounts, snapshots, roots, cooldowns, nowMs, notes,
    exclude: excludeList, refuseAllTight: cfg.refuse_all_tight,
  };
  // The mirror adds keys only when some alias has a row: with no mirror the pick input is exactly G37's.
  let binding = null;
  const observations = {};
  for (const acct of accounts) {
    if (binding === null && ctx.liveDir) { try { binding = observation.readNamespaceBinding(ctx.liveDir); } catch (_) { binding = { namespace: null }; } }
    const rows = mirrorRows(ctx, acct.alias, binding);
    if (rows.length > 0) observations[acct.alias] = rows;
  }
  if (Object.keys(observations).length > 0) {
    out.observations = observations;
    const m = claudeManifest();
    if (m !== undefined) out.manifest = m;
  }
  return out;
}

// ---------------------------------------------------------------- args

// Unverified strings (aliases, option names) are never echoed: a diagnostic code plus the argument position only.

function parseArgs(argv, spec) {
  const opts = {};
  const rest = [];
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { i++; break; }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const kind = spec[name];
      if (kind === undefined) throw new Stop(EXIT.INVALID, `unknown_option at_arg=${i + 1}`, null);
      if (kind === 'flag') { opts[name] = true; continue; }
      if (i + 1 >= argv.length) throw new Stop(EXIT.INVALID, `missing_value at_arg=${i + 1}`, null);
      opts[name] = argv[++i];
    } else {
      rest.push(a);
    }
  }
  return { opts, rest, cmd: argv.slice(i) };
}

function checkPurpose(p, dflt) {
  const v = p === undefined ? dflt : p;
  if (typeof v !== 'string' || !PURPOSE_RE.test(v)) throw new Stop(EXIT.INVALID, 'purpose_invalid', null);
  return v;
}

// ---------------------------------------------------------------- classification

function parseEnvelope(text) {
  const t = text.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
  } catch (_) { /* maybe stream-json */ }
  let last = null;
  for (const line of t.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const j = JSON.parse(line);
      if (j && typeof j === 'object' && j.type === 'result') last = j;
    } catch (_) { /* skip */ }
  }
  return last;
}

function classifyErrorText(text, scratchDir) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'engine-capability-state.js'), 'classify-error'], {
    input: text.slice(0, 8192), encoding: 'utf8', timeout: 15000,
    env: { PATH: process.env.PATH || '', ENGINE_CAPABILITY_DIR: scratchDir, AUTOPILOT_STRIKE_WRITER: 'off' },
  });
  return r.status === 0 ? String(r.stdout).trim() : 'unknown';
}

/** Returns {outcome, exit, limitKind?} for one finished attempt. */
function classifyAttempt(a, scratchDir) {
  if (a.scrubbed) return { outcome: 'token_scrubbed', exit: EXIT.SCRUBBED };
  if (a.timedOut) return { outcome: 'timeout', exit: 124 };
  if (a.spawnError) return { outcome: 'child_error', exit: EXIT.CHILD_ERROR };
  const env = parseEnvelope(a.stdout) || null;
  const hasStatus = env && env.api_error_status !== undefined && env.api_error_status !== null;
  const structuredError = !!(env && (env.is_error === true || hasStatus));
  const failed = a.code !== 0 || structuredError;
  if (!failed) return { outcome: 'ok', exit: EXIT.OK };
  const status = hasStatus ? env.api_error_status : null;
  const text = `${env && typeof env.result === 'string' ? env.result : ''}\n${a.stdout}\n${a.stderr}`;
  if (status === 401 || authStop.scanText(`${a.stdout}\n${a.stderr}`, { failed: true })) {
    return { outcome: 'auth_failed', exit: EXIT.AUTH };
  }
  const cls = classifyErrorText(text, scratchDir);
  if (status === 429 || cls === 'rate_limited' || cls === 'quota_exhausted') {
    // Local fallback: "usage limit reached" text is a quota exhaustion even when classify-error says rate_limited.
    const quotaText = /usage limit reached/i.test(text);
    return { outcome: 'rate_limited', exit: EXIT.LIMITED, limitKind: cls === 'quota_exhausted' || quotaText ? 'quota' : 'throttle', text };
  }
  // Any other structured error is a child error whatever the child's exit code was.
  if (structuredError) return { outcome: 'child_error', exit: EXIT.CHILD_ERROR };
  return { outcome: 'other_failure', exit: (a.code === null || a.code === 0) ? EXIT.CHILD_ERROR : a.code };
}

// ---------------------------------------------------------------- child execution (run)

function execAttempt(ctx, args) {
  return new Promise((resolve) => {
    const { argv, env, cwd, stdinFile, timeoutSecs, token, dir } = args;
    const outFile = path.join(dir, 'stdout');
    const errFile = path.join(dir, 'stderr');
    const outFd = fs.openSync(outFile, 'w', 0o600);
    const errFd = fs.openSync(errFile, 'w', 0o600);
    const scrub = { out: createScrubber(token), err: createScrubber(token) };
    let inFd = null;
    let child;
    let timedOut = false;
    let settled = false;
    const result = { code: null, timedOut: false, spawnError: null, scrubbed: false };
    const finish = () => {
      if (settled) return;
      settled = true;
      try { writeAll(outFd, scrub.out.end()); writeAll(errFd, scrub.err.end()); } catch (_) { /* best effort */ }
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      if (inFd !== null) { try { fs.closeSync(inFd); } catch (_) { /* closed */ } }
      result.scrubbed = scrub.out.hit || scrub.err.hit;
      result.timedOut = timedOut;
      result.stdout = fs.readFileSync(outFile);
      result.stderr = fs.readFileSync(errFile);
      resolve(result);
    };
    try {
      if (stdinFile) inFd = fs.openSync(stdinFile, 'r');
      const prefix = pdeathsigPrefix();
      const full = prefix.concat(argv);
      const pre = prefix.length ? preflightExec(argv[0], env, cwd) : null;
      if (pre) { result.spawnError = pre; finish(); return; }
      child = spawn(full[0], full.slice(1), {
        env, cwd: cwd || undefined, stdio: [inFd === null ? 'ignore' : inFd, 'pipe', 'pipe'],
      });
    } catch (e) {
      result.spawnError = e && e.code ? e.code : 'spawn_failed';
      finish();
      return;
    }
    child.on('error', (e) => { result.spawnError = e && e.code ? e.code : 'spawn_failed'; finish(); });
    child.stdout.on('data', (c) => writeAll(outFd, scrub.out.push(c)));
    child.stderr.on('data', (c) => writeAll(errFd, scrub.err.push(c)));
    let timer = null;
    if (timeoutSecs) {
      timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, timeoutSecs * 1000);
    }
    const dispose = installSignalForwarding(child);
    child.on('close', (code, sig) => {
      if (timer) clearTimeout(timer);
      dispose();
      // Killed by a signal: report 128+signal like exec does, never null (which would read as a clean spawn).
      result.code = code === null ? 128 + (os.constants.signals[sig] || 0) : code;
      finish();
    });
  });
}

function emitFinal(ctx, opts, stdoutBuf, stderrBuf) {
  if (opts.stdout) fs.writeFileSync(opts.stdout, stdoutBuf, { mode: 0o600 }); else if (stdoutBuf.length) ctx.write(1, stdoutBuf);
  if (opts.stderr) fs.writeFileSync(opts.stderr, stderrBuf, { mode: 0o600 }); else if (stderrBuf.length) ctx.write(2, stderrBuf);
}

function tightResetsFor(ctx, alias, checked, text) {
  const out = [];
  try {
    const info = checked.enabled.find((e) => e.alias === alias);
    let real = info.configDir;
    try { real = fs.realpathSync(info.configDir); } catch (_) { /* as is */ }
    const q = quota.readQuota(alias, { liveBase: ctx.liveDir, nowMs: ctx.now(), expectedRoot: quota.hash8(real) });
    out.push(...q.tight_resets);
  } catch (_) { /* no snapshot */ }
  try { // a tight mirror window also tells when the limit lifts, when pick would judge the mirror newer than the snapshot
    const rows = mirrorRows(ctx, alias, null);
    if (rows.length > 0) {
      const info = checked.enabled.find((e) => e.alias === alias);
      let real = info.configDir;
      try { real = fs.realpathSync(info.configDir); } catch (_) { /* as is */ }
      const rawSnap = quota.readSnapshotFile(ctx.liveDir, alias);
      const snap = rawSnap && rawSnap.__error ? null : rawSnap;
      const nowMs = ctx.now();
      const sq = quota.interpretSnapshot(snap, { alias, expectedRoot: quota.hash8(real), nowMs });
      const manifest = claudeManifest();
      const { drop, observed_at: decidedAt } = judge(sq, snap, rows, manifest, nowMs);
      if (drop !== null || decidedAt !== undefined) { // refusal row, or a tight mirror observation that took over
        out.push(...interpret.interpretWindows(rows, manifest, nowMs / 1000).tight_resets);
      }
    }
  } catch (_) { /* no mirror */ }
  const m = /usage limit reached\|(\d{10})\b/i.exec(text || '');
  if (m) out.push(Number(m[1]));
  return out;
}

// G40 D5: the reporter's statusline adapter, called by `run` once before the first gather and by `sync-statusline`.
// It converts each enabled alias's codeforge snapshot into a local mirror row (quota-reporter.js) and never throws:
// a failure is a result, and only a real write failure earns one stderr debug line (a missing, stale or mismatching
// snapshot is already visible through pick's own notes). Gated by the same knob as the other mirror writers.
// It prints NOTHING: on the run path a failed mirror write may not change stdout or stderr (PM parity), so the caller
// turns a failure into an audit reason code (syncFailureReason) and only the explicit `sync-statusline` prints a line.
function syncStatusline(ctx, checked, pinned, cfg) {
  try {
    if (cfg.quota_capture !== 'on' || !ctx.liveDir) return [];
    const accounts = [];
    for (const r of checked.accounts) {
      if (!r.enabled || (pinned && r.alias !== pinned)) continue;
      const info = checked.enabled.find((e) => e.alias === r.alias);
      if (!info) continue;
      let real = info.configDir;
      try { real = fs.realpathSync(info.configDir); } catch (_) { /* keep as is */ }
      accounts.push({ alias: r.alias, expectedRoot: quota.hash8(real) });
    }
    return reporter.syncStatusline({ liveDir: ctx.liveDir, accounts, nowMs: ctx.now(), hostRole: cfg.host_role });
  } catch (_) { return []; }
}

// The first adapter write failure of a result list as a closed audit reason code, or null when nothing failed.
function syncFailureReason(results) {
  for (const r of results) {
    if (!reporter.isFailure(r)) continue;
    return audit.captureReasonOk(r.reason) ? r.reason : 'capture_error';
  }
  return null;
}

function cmdSyncStatusline(ctx, argv) {
  const { opts } = parseArgs(argv, { alias: 'value' });
  const cfg = accountsConfig(ctx);
  const checked = loadChecked(ctx, 'sync-statusline');
  if (!checked.configured) throw new Stop(EXIT.INVALID, 'registry_not_configured', null);
  if (cfg.mode === 'off') { preAudit(ctx, 'sync-statusline', 'mode_off'); throw new Stop(EXIT.INVALID, 'mode_off', null); }
  if (opts.alias !== undefined) {
    try { registry.requireAlias({ accounts: checked.accounts }, opts.alias); } catch (e) {
      if (e instanceof registry.RegistryError) { preAudit(ctx, 'sync-statusline', 'invalid_config'); throw new Stop(EXIT.INVALID, `unknown_alias (${e.reason})`, null); }
      throw e;
    }
  }
  if (cfg.quota_capture !== 'on') { ctx.out('skipped quota_capture=off'); return EXIT.OK; }
  for (const r of syncStatusline(ctx, checked, opts.alias || null, cfg)) {
    if (reporter.isFailure(r)) ctx.err(`quota_statusline alias=${r.alias} reason=${r.reason}`); // the explicit command keeps its diagnostic line
    ctx.out(`alias=${r.alias} wrote=${r.wrote ? 'yes' : 'no'} reason=${r.reason === null ? '-' : r.reason}`);
  }
  return EXIT.OK;
}

// ---------------------------------------------------------------- quota capture and probe (G40 D4, write side)

// The one boundary where the wrapper's millisecond clock becomes the record's seconds (plan 6, N49, N84): called once
// per attempt with the start time taken BEFORE execAttempt, never with a clock read at capture time.
function startSeconds(startMs) { return Math.floor(startMs / 1000); }

// The lock wait and the monotonic guard inside writeLocalRow run on the REAL clock on purpose: a test that pins ctx.now to
// a constant would otherwise never reach the lock deadline. observed_at in the record is the attempt start, not this clock.
function writeRow(ctx, record, token) {
  return observation.writeLocalRow(ctx.liveDir, record, { secrets: [token] });
}

// Passive capture after one classified attempt (plan 5.1, 18.3, 21.8). `a.stdout` is the SCRUBBED text (the scrubber ran
// in execAttempt); the caller never gets here for token_scrubbed. Returns an audit reason code, or null when nothing
// failed. It never throws and never touches stdout, stderr or the exit code.
//  - an event with windows: a passive row (observed_at = the attempt's start);
//  - a 429 with no window in this attempt and no live window in the mirror: a shape (b) refusal row (L1);
//  - auth_failed (401): nothing at all (token_state is P3).
function captureAttempt(ctx, cfg, alias, a, cl, startMs, token, checked, cooldownUntilMs) {
  try {
    if (cfg.quota_capture !== 'on' || !ctx.liveDir) return null;
    if (cl.outcome === 'token_scrubbed' || cl.outcome === 'auth_failed') return null;
    const ev = capture.extractRateLimit(a.stdout);
    let badEvent = ev.status === 'bad'; // a malformed event is dropped, but a 429 below still gets its refusal row
    const observedAtS = startSeconds(startMs);
    let built = null;
    if (ev.status === 'event') {
      built = capture.buildPassiveRow({ alias, windows: ev.windows, observedAtS, hostRole: cfg.host_role, source: 'passive' });
      if (!built.ok) { badEvent = true; built = null; } // the event's own figures fail the contract (e.g. 0..100 left unconverted): drop it
    }
    if (built === null && cl.outcome === 'rate_limited') {
      const nowS = ctx.now() / 1000;
      const prior = interpret.interpretWindows(mirrorRows(ctx, alias, null), claudeManifest(), nowS).windows.length > 0;
      if (prior) return badEvent ? 'bad_event' : null; // a live window is already on file for this alias: not a first 429, nothing to add
      // PM (A), 2026-11-04: without a retry_at in the response the refusal ends when the G37 cooldown the wrapper computed for this 429 ends.
      const hint = capture.parseRetryAt(cl.text);
      const retryAtS = hint !== null ? hint : (Number.isFinite(cooldownUntilMs) ? Math.floor(cooldownUntilMs / 1000) : null);
      built = capture.buildRefusalRow({
        alias, observedAtS, retryAtS, reason: cl.limitKind === 'quota' ? 'quota' : 'rate_limit', hostRole: cfg.host_role,
      });
    }
    if (built === null) return badEvent ? 'bad_event' : null;
    if (!built.ok) return badEvent ? 'bad_event' : capture.captureReason(built);
    const reason = capture.captureReason(writeRow(ctx, built.record, token));
    return badEvent ? 'bad_event' : reason;
  } catch (_) { return 'capture_error'; }
}

// One probe call as `alias` through execAttempt (the one claude spawn site). Returns
// { cl, windows, reason, a } and never throws: any failure here is the probe's, never the caller's.
async function probeAttempt(ctx, checked, alias, cfg, scratchRoot, purpose) {
  try {
    const info = checked.enabled.find((e) => e.alias === alias);
    const token = readToken(info.tokenFile);
    const env = accountEnv.buildEnv({
      alias, token, configDir: info.configDir, homeDir: info.homeDir, callerEnv: ctx.env, realHome: ctx.realHome,
      locators: { accountsDir: ctx.accountsDir, liveDir: ctx.liveDir, stateDir: ctx.stateDir, configFile: ctx.configFile, runtimeDir: runtimeDir(ctx) },
    });
    accountEnv.prepareHome({ homeDir: info.homeDir, realHome: ctx.realHome });
    const argv = probe.probeArgv(claudeManifest(), probe.PROBE_PROMPT);
    const dir = path.join(scratchRoot, `probe-${alias}`);
    fs.mkdirSync(dir, { mode: 0o700 });
    const startMs = ctx.now();
    const raw = await execAttempt(ctx, { argv, env, timeoutSecs: cfg.quota_probe_timeout_secs, token, dir });
    const a = { code: raw.code, timedOut: raw.timedOut, spawnError: raw.spawnError, scrubbed: raw.scrubbed, stdout: raw.stdout.toString('utf8'), stderr: raw.stderr.toString('utf8') };
    const cl = classifyAttempt(a, scratchRoot);
    let windows = [];
    let reason = null;
    if (cl.outcome === 'ok') { // a failed probe (429, 401, timeout, scrubbed) records nothing
      const ev = capture.extractRateLimit(a.stdout);
      if (ev.status === 'bad') reason = 'bad_event';
      else if (ev.status === 'event') {
        const built = capture.buildPassiveRow({ alias, windows: ev.windows, observedAtS: startSeconds(startMs), hostRole: cfg.host_role, source: 'probe' });
        if (!built.ok) reason = 'bad_event';
        else {
          reason = capture.captureReason(writeRow(ctx, built.record, token));
          windows = built.record.windows.map((w) => ({ kind: w.kind, utilization: w.utilization, resets_at: w.resets_at, observed_at: w.observed_at }));
        }
      }
    }
    auditLine(ctx, Object.assign({ alias, purpose: purpose || 'quota-probe', attempt: 1, outcome: cl.outcome }, reason ? { quota_capture: reason } : {}), [token]);
    return { cl, windows, reason, a };
  } catch (_) { return null; }
}

// `stale` trigger (plan 5.3): called once, at the first attempt of an unpinned run, between gather and pick. At most
// one probe per run, serial; a tight, cooling, excluded or fresh alias is never probed. Returns true when it probed.
async function maybeProbe(ctx, checked, data, cfg, scratchRoot) {
  try {
    const manifest = claudeManifest();
    const nowS = ctx.now() / 1000;
    const merged = {};
    for (const [al, rows] of Object.entries(data.observations || {})) merged[al] = interpret.interpretWindows(rows, manifest, nowS);
    const cands = probe.staleCandidates(data.accounts, merged, data.cooldowns, data.exclude, nowS, cfg.quota_probe_stale_minutes);
    if (cands.length === 0) return false;
    await probeAttempt(ctx, checked, cands[0], cfg, scratchRoot);
    return true;
  } catch (_) { return false; }
}

// `cooldown --clear` is the operator's release for a cooling alias (G37). Since D4 a first 429 also leaves a refusal-only
// row in the local mirror, and that row cools the alias too (plan 21.8), so the release has to take it away as well.
// observation.removeLocalRefusal does it under the per-alias lock and removes only the LOCAL courier's refusal-only row
// (peer rows are written back untouched; a row with windows is left alone). Returns { removed, problem }; a lock it
// cannot get is reported as a problem, never forced.
function clearRefusalRow(ctx, alias) {
  try {
    if (!ctx.liveDir) return { removed: false, problem: null };
    const r = observation.removeLocalRefusal(ctx.liveDir, 'claude', alias);
    return r.ok ? { removed: r.removed, problem: null } : { removed: false, problem: r.code };
  } catch (_) { return { removed: false, problem: 'capture_error' }; }
}

// Demand rule (plan 19.6 A, BL-0375): an alias counts only when a run line with an outcome in the audit log, newer than
// 24 h, names it. Fail closed: a missing, unreadable, refused or partly damaged log means NO demand, so nothing is probed.
function readDemand(ctx) {
  try {
    const res = audit.readAudit(ctx.auditFile, {});
    if (res.refused || res.invalid > 0) return new Set();
    return probe.demandAliases(res.records, ctx.now());
  } catch (_) { return new Set(); }
}

// `usage-probe --due [--dry-run]`: the periodic entry point an external timer calls. No timer is installed here.
// Only an unset or `scheduled` quota_probe on a periodic-eligible manifest has anything due; `off`, `stale` and every
// other manifest print an empty due list and spawn nothing. Prints {due, probed}; --dry-run never spawns.
async function cmdUsageProbeDue(realCtx, opts) {
  // --dry-run writes nothing on any path: audit (preAudit/auditLine, also from loadChecked), mirror and cooldown are only
  // read before the spawn step, and the spawn step is skipped. Refusals and exit codes are unchanged.
  const ctx = opts['dry-run'] ? Object.assign({}, realCtx, { noWrite: true }) : realCtx;
  if (opts.alias !== undefined || opts.purpose !== undefined) throw new Stop(EXIT.INVALID, 'due_excludes_alias_and_purpose', null);
  const purpose = 'quota-probe';
  const cfg = accountsConfig(ctx);
  const checked = loadChecked(ctx, purpose);
  if (!checked.configured) throw new Stop(EXIT.INVALID, 'registry_not_configured', null);
  if (cfg.mode === 'off') { preAudit(ctx, purpose, 'mode_off'); throw new Stop(EXIT.INVALID, 'mode_off', null); }
  let due = [];
  if (cfg.quota_probe === 'scheduled') {
    const data = gather(ctx, checked, [], null, cfg);
    const nowS = ctx.now() / 1000;
    const manifest = claudeManifest();
    const merged = {};
    for (const [al, rows] of Object.entries(data.observations || {})) merged[al] = interpret.interpretWindows(rows, manifest, nowS);
    due = probe.periodicDue({ manifest, accounts: data.accounts, merged, cooldowns: data.cooldowns, exclude: data.exclude, nowS, demand: readDemand(ctx) });
  }
  const probed = [];
  if (!opts['dry-run'] && due.length > 0) {
    let scratchRoot = null;
    try {
      scratchRoot = fs.mkdtempSync(path.join(ctx.env.TMPDIR || os.tmpdir(), 'claude-account-'));
      fs.chmodSync(scratchRoot, 0o700);
      for (const alias of due) {
        const r = await probeAttempt(ctx, checked, alias, cfg, scratchRoot, purpose);
        probed.push({ alias, outcome: r === null ? 'probe_failed' : r.cl.outcome });
      }
    } finally {
      if (scratchRoot) fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  }
  ctx.out(JSON.stringify({ due, probed }));
  return EXIT.OK;
}

async function cmdUsageProbe(ctx, argv) {
  const { opts } = parseArgs(argv, { alias: 'value', purpose: 'value', due: 'flag', 'dry-run': 'flag' });
  if (opts.due) return cmdUsageProbeDue(ctx, opts);
  if (opts['dry-run']) throw new Stop(EXIT.INVALID, 'dry_run_needs_due', null);
  if (opts.alias === undefined) throw new Stop(EXIT.INVALID, 'alias_required', null);
  const purpose = checkPurpose(opts.purpose, 'quota-probe');
  const cfg = accountsConfig(ctx);
  const checked = loadChecked(ctx, purpose);
  if (!checked.configured) throw new Stop(EXIT.INVALID, 'registry_not_configured', null);
  if (cfg.mode === 'off') { preAudit(ctx, purpose, 'mode_off'); throw new Stop(EXIT.INVALID, 'mode_off', null); }
  try { registry.requireAlias({ accounts: checked.accounts }, opts.alias); } catch (e) {
    if (e instanceof registry.RegistryError) { preAudit(ctx, purpose, 'invalid_config'); throw new Stop(EXIT.INVALID, `unknown_alias (${e.reason})`, null); }
    throw e;
  }
  if (!checked.enabled.some((e) => e.alias === opts.alias)) { preAudit(ctx, purpose, 'no_account'); throw new Stop(EXIT.NONE, 'alias_disabled', null); }
  let scratchRoot = null;
  try {
    scratchRoot = fs.mkdtempSync(path.join(ctx.env.TMPDIR || os.tmpdir(), 'claude-account-'));
    fs.chmodSync(scratchRoot, 0o700);
    const r = await probeAttempt(ctx, checked, opts.alias, cfg, scratchRoot, purpose);
    if (r === null) throw new Stop(EXIT.CHILD_ERROR, 'probe_failed', null);
    ctx.out(JSON.stringify({ alias: opts.alias, windows: r.windows }));
    if (r.cl.outcome === 'auth_failed') ctx.err(`STOP_AUTH alias=${opts.alias}`);
    else if (r.cl.outcome === 'token_scrubbed') ctx.err(`token_scrubbed alias=${opts.alias}`);
    return r.cl.exit;
  } finally {
    if (scratchRoot) fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- subcommands

async function cmdRun(ctx, argv) {
  const { opts, cmd } = parseArgs(argv, {
    purpose: 'value', alias: 'value', 'max-attempts': 'value', stdin: 'value', stdout: 'value', stderr: 'value', cwd: 'value', timeout: 'value',
  });
  if (cmd.length === 0) throw new Stop(EXIT.INVALID, 'missing_command (use -- claude <argv>)', null);
  if (opts.purpose === undefined) throw new Stop(EXIT.INVALID, 'purpose_required', null);
  const purpose = checkPurpose(opts.purpose);
  let flagAttempts = null;
  if (opts['max-attempts'] !== undefined) {
    if (!/^\d{1,2}$/.test(opts['max-attempts']) || Number(opts['max-attempts']) < 1) throw new Stop(EXIT.INVALID, 'max_attempts_invalid', null);
    flagAttempts = Number(opts['max-attempts']);
  }
  let timeoutSecs = null;
  if (opts.timeout !== undefined) {
    if (!/^\d{1,6}$/.test(opts.timeout) || Number(opts.timeout) < 1) throw new Stop(EXIT.INVALID, 'timeout_invalid', null);
    timeoutSecs = Number(opts.timeout);
  }
  if (opts.stdin !== undefined) {
    let st = null;
    try { st = fs.statSync(opts.stdin); } catch (_) { /* missing */ }
    if (!st || !st.isFile()) throw new Stop(EXIT.INVALID, 'stdin_file_unreadable', null);
  }
  const cfg = accountsConfig(ctx);
  const maxAttempts = flagAttempts !== null ? flagAttempts : cfg.max_attempts;
  const checked = loadChecked(ctx, purpose);
  if (!checked.configured) throw new Stop(EXIT.INVALID, 'registry_not_configured', null);
  if (cfg.mode === 'off') {
    preAudit(ctx, purpose, 'mode_off');
    throw new Stop(EXIT.INVALID, 'mode_off: the account layer is switched off; the caller must use its legacy path', null);
  }
  const loc = {
    accountsDir: ctx.accountsDir, liveDir: ctx.liveDir, stateDir: ctx.stateDir,
    configFile: ctx.configFile, runtimeDir: runtimeDir(ctx),
  };
  let pinned = null;
  if (opts.alias !== undefined) {
    try { registry.requireAlias({ accounts: checked.accounts }, opts.alias); } catch (e) {
      if (e instanceof registry.RegistryError) {
        preAudit(ctx, purpose, 'invalid_config');
        throw new Stop(EXIT.INVALID, `unknown_alias (${e.reason})`, null);
      }
      throw e;
    }
    pinned = opts.alias;
    const until = cooldown.readCooldown(pinned, { dir: ctx.cooldownDir, nowMs: ctx.now() });
    if (cooldown.isCooling(until, ctx.now())) {
      preAudit(ctx, purpose, 'no_account');
      throw new Stop(EXIT.NONE, `alias_cooling alias=${pinned}`, null);
    }
  }

  const tried = [];
  let last = null;
  let scratchRoot = null;
  let probeChecked = false; // the `stale` probe is looked at once per run, at the first attempt, never when pinned
  try {
    scratchRoot = fs.mkdtempSync(path.join(ctx.env.TMPDIR || os.tmpdir(), 'claude-account-'));
    fs.chmodSync(scratchRoot, 0o700);
    let syncReason = syncFailureReason(syncStatusline(ctx, checked, pinned, cfg)); // once per run, before the first gather (G40 D5); silent, the reason rides the first attempt's audit line
    for (let k = 1; k <= maxAttempts; k++) {
      let data = gather(ctx, checked, tried, pinned, cfg);
      if (cfg.quota_probe !== 'off' && !pinned && !probeChecked) { // `stale` and `scheduled` both probe on demand
        probeChecked = true;
        if (await maybeProbe(ctx, checked, data, cfg, scratchRoot)) data = gather(ctx, checked, tried, pinned, cfg); // the probe's row is now in the mirror
      }
      const p = pick(data);
      if (!p.ok) {
        if (k === 1) {
          preAudit(ctx, purpose, p.code === 'all_tight_refused' ? 'all_limited' : 'no_account');
          const why = data.accounts.length === 0 ? 'no enabled alias' : p.dropped.map((x) => `${x.alias}:${x.reason}`).join(',') || p.code;
          throw new Stop(EXIT.NONE, `${p.code} (${why})`, null);
        }
        break;
      }
      for (const n of p.notes) {
        if (n.note === 'quota_schema_unsupported') auditLine(ctx, { alias: n.alias, purpose, attempt: k, outcome: 'quota_schema_unsupported' });
        else ctx.err(`${n.note} alias=${n.alias}`);
      }
      const alias = p.choice.alias;
      ctx.lastAttemptAlias = alias;
      if (p.outcome === 'all_tight') auditLine(ctx, { alias, purpose, attempt: k, outcome: 'all_tight' });
      tried.push(alias);
      const info = checked.enabled.find((e) => e.alias === alias);
      const token = readToken(info.tokenFile);
      let env;
      try {
        env = accountEnv.buildEnv({
          alias, token, configDir: info.configDir, homeDir: info.homeDir, callerEnv: ctx.env, realHome: ctx.realHome, locators: loc,
        });
        accountEnv.prepareHome({ homeDir: info.homeDir, realHome: ctx.realHome });
        // Internal seam: only cmdSelftest sets ctx.childEnvExtra (never read from argv, env or cli deps).
        if (ctx.childEnvExtra && ctx.childEnvExtra[alias]) Object.assign(env, ctx.childEnvExtra[alias]);
      } catch (e) {
        if (e instanceof accountEnv.EnvError) {
          preAudit(ctx, purpose, 'invalid_config');
          throw new Stop(EXIT.INVALID, e.message, null);
        }
        throw e;
      }
      const dir = path.join(scratchRoot, `attempt-${k}`);
      fs.mkdirSync(dir, { mode: 0o700 });
      const attemptStartMs = ctx.now(); // observed_at of a passive row: the attempt's START, read before the child runs (N84)
      const raw = await execAttempt(ctx, { argv: cmd, env, cwd: opts.cwd, stdinFile: opts.stdin, timeoutSecs, token, dir });
      const a = { code: raw.code, timedOut: raw.timedOut, spawnError: raw.spawnError, scrubbed: raw.scrubbed, stdout: raw.stdout.toString('utf8'), stderr: raw.stderr.toString('utf8') };
      const cl = classifyAttempt(a, scratchRoot);
      let until = null; // the G37 cooldown end for a 429 as of now, so a refusal row without a retry_at can share it
      if (cl.outcome === 'rate_limited') {
        const nowMs = ctx.now();
        if (cl.limitKind === 'quota') {
          until = cooldown.computeUntil({ nowMs, defaultMinutes: cfg.cooldown_default_minutes, tightResets: tightResetsFor(ctx, alias, checked, cl.text) });
        } else {
          until = nowMs + Math.min(cfg.cooldown_default_minutes, THROTTLE_COOLDOWN_MINUTES) * 60 * 1000;
        }
      }
      const capReason = captureAttempt(ctx, cfg, alias, a, cl, attemptStartMs, token, checked, until) || syncReason;
      syncReason = null; // carried by one audit line only
      auditLine(ctx, Object.assign({ alias, purpose, attempt: k, outcome: cl.outcome }, capReason ? { quota_capture: capReason } : {}), [token]);
      last = { raw, cl, alias };
      if (cl.outcome === 'rate_limited') {
        // Recomputed after the capture on purpose: a tight window the capture just wrote also tells when the limit lifts.
        const nowMs = ctx.now();
        const finalUntil = cl.limitKind === 'quota'
          ? cooldown.computeUntil({ nowMs, defaultMinutes: cfg.cooldown_default_minutes, tightResets: tightResetsFor(ctx, alias, checked, cl.text) })
          : until;
        cooldown.writeCooldown(alias, finalUntil, { dir: ctx.cooldownDir, nowMs });
        continue;
      }
      emitFinal(ctx, opts, raw.stdout, raw.stderr);
      if (cl.outcome === 'auth_failed') {
        ctx.err(`STOP_AUTH alias=${alias}`);
      } else if (cl.outcome === 'token_scrubbed') {
        ctx.err(`token_scrubbed alias=${alias}`);
      } else if (cl.outcome === 'child_error' && a.spawnError) {
        ctx.err(`child_spawn_failed (${a.spawnError})`);
      }
      return cl.exit;
    }
    // Only rate_limited attempts reach here.
    preAudit(ctx, purpose, 'all_limited');
    if (last) emitFinal(ctx, opts, last.raw.stdout, last.raw.stderr);
    ctx.err(`all_accounts_limited (tried ${tried.join(',')})`);
    return EXIT.LIMITED;
  } finally {
    if (scratchRoot) fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function cmdEnvCheck(ctx, argv) {
  const { opts } = parseArgs(argv, { alias: 'value', any: 'flag', purpose: 'value' });
  const purpose = checkPurpose(opts.purpose, 'env-check');
  const cfg = accountsConfig(ctx);
  const checked = loadChecked(ctx, purpose);
  if (!checked.configured) { ctx.out('unconfigured'); return EXIT.OK; }
  if (cfg.mode === 'off') { preAudit(ctx, purpose, 'mode_off'); ctx.out('mode_off'); return EXIT.OK; }
  let list = checked.enabled;
  if (opts.alias !== undefined) {
    try { registry.requireAlias({ accounts: checked.accounts }, opts.alias); } catch (e) {
      if (e instanceof registry.RegistryError) throw new Stop(EXIT.INVALID, `unknown_alias (${e.reason})`, null);
      throw e;
    }
    list = checked.enabled.filter((x) => x.alias === opts.alias);
  }
  if (list.length === 0) {
    preAudit(ctx, purpose, 'no_account');
    throw new Stop(EXIT.NONE, 'no enabled alias', null);
  }
  for (const x of list) {
    const mode = (fs.statSync(x.tokenFile).mode & 0o777).toString(8).padStart(4, '0');
    ctx.out(`ok alias=${x.alias} mode=${mode} config_dir=${x.configDir} credentials_present=no`);
  }
  return EXIT.OK;
}

function cmdPick(ctx, argv) {
  const { opts } = parseArgs(argv, { purpose: 'value', exclude: 'value' });
  const purpose = checkPurpose(opts.purpose, 'pick');
  const cfg = accountsConfig(ctx);
  const checked = loadChecked(ctx, purpose);
  if (!checked.configured) throw new Stop(EXIT.INVALID, 'registry_not_configured', null);
  if (cfg.mode === 'off') { preAudit(ctx, purpose, 'mode_off'); throw new Stop(EXIT.INVALID, 'mode_off', null); }
  const exclude = opts.exclude ? opts.exclude.split(',').filter(Boolean) : [];
  const p = pick(gather(ctx, checked, exclude, null, cfg));
  if (!p.ok) {
    preAudit(ctx, purpose, p.code === 'all_tight_refused' ? 'all_limited' : 'no_account');
    throw new Stop(EXIT.NONE, `${p.code} (${p.dropped.map((x) => `${x.alias}:${x.reason}`).join(',') || 'no enabled alias'})`, null);
  }
  for (const n of p.notes) ctx.err(`${n.note} alias=${n.alias}`);
  const c = p.choice;
  ctx.out(`${c.alias} class=${c.class} used=${c.used === null ? '-' : c.used} source=${c.source}`);
  return EXIT.OK;
}

async function cmdExec(ctx, argv) {
  const { opts, cmd } = parseArgs(argv, { alias: 'value', pick: 'flag', purpose: 'value' });
  if (cmd.length === 0) throw new Stop(EXIT.INVALID, 'missing_command', null);
  if ((opts.alias === undefined) === (opts.pick !== true)) throw new Stop(EXIT.INVALID, 'exec needs exactly one of --alias or --pick', null);
  const purpose = checkPurpose(opts.purpose, 'exec');
  const cfg = accountsConfig(ctx);
  const checked = loadChecked(ctx, purpose);
  if (!checked.configured) throw new Stop(EXIT.INVALID, 'registry_not_configured', null);
  if (cfg.mode === 'off') { preAudit(ctx, purpose, 'mode_off'); throw new Stop(EXIT.INVALID, 'mode_off', null); }
  let alias = opts.alias;
  if (alias !== undefined) {
    try { registry.requireAlias({ accounts: checked.accounts }, alias); } catch (e) {
      if (e instanceof registry.RegistryError) { preAudit(ctx, purpose, 'invalid_config'); throw new Stop(EXIT.INVALID, `unknown_alias (${e.reason})`, null); }
      throw e;
    }
  } else {
    const p = pick(gather(ctx, checked, [], null, cfg));
    if (!p.ok) { preAudit(ctx, purpose, p.code === 'all_tight_refused' ? 'all_limited' : 'no_account'); throw new Stop(EXIT.NONE, p.code, null); }
    alias = p.choice.alias;
  }
  const info = checked.enabled.find((e) => e.alias === alias);
  const token = readToken(info.tokenFile);
  let env;
  try {
    env = accountEnv.buildEnv({
      alias, token, configDir: info.configDir, homeDir: info.homeDir, callerEnv: ctx.env, realHome: ctx.realHome,
      locators: { accountsDir: ctx.accountsDir, liveDir: ctx.liveDir, stateDir: ctx.stateDir, configFile: ctx.configFile, runtimeDir: runtimeDir(ctx) },
    });
    accountEnv.prepareHome({ homeDir: info.homeDir, realHome: ctx.realHome });
  } catch (e) {
    if (e instanceof accountEnv.EnvError) { preAudit(ctx, purpose, 'invalid_config'); throw new Stop(EXIT.INVALID, e.message, null); }
    throw e;
  }
  return new Promise((resolve) => {
    let child;
    try {
      const prefix = pdeathsigPrefix();
      const pre = prefix.length ? preflightExec(cmd[0], env, undefined) : null;
      if (pre) { const er = new Error(pre); er.code = pre; throw er; }
      const full = prefix.concat(cmd); child = spawn(full[0], full.slice(1), { env, stdio: 'inherit' }); } catch (e) {
      ctx.err(`child_spawn_failed (${e && e.code ? e.code : 'error'})`);
      resolve(EXIT.CHILD_ERROR);
      return;
    }
    const dispose = installSignalForwarding(child);
    child.on('error', (e) => { dispose(); ctx.err(`child_spawn_failed (${e && e.code ? e.code : 'error'})`); resolve(EXIT.CHILD_ERROR); });
    child.on('close', (code, sig) => {
      dispose();
      const exitCode = code === null ? 128 + (os.constants.signals[sig] || 0) : code;
      auditLine(ctx, { alias, purpose, attempt: 1, outcome: exitCode === 0 ? 'ok' : 'other_failure' }, [token]);
      resolve(exitCode);
    });
  });
}

function cmdStatus(ctx, argv) {
  const { opts } = parseArgs(argv, { limit: 'value' });
  const limit = opts.limit === undefined ? 20 : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Stop(EXIT.INVALID, 'limit_invalid', null);
  const cfg = accountsConfig(ctx);
  const checked = loadChecked(ctx, 'status');
  if (!checked.configured) { ctx.out('unconfigured'); return EXIT.OK; }
  ctx.out(`mode=${cfg.mode} refuse_all_tight=${cfg.refuse_all_tight} max_attempts=${cfg.max_attempts}`);
  const nowMs = ctx.now();
  const ages = [];
  for (const row of checked.accounts) {
    const info = checked.enabled.find((e) => e.alias === row.alias);
    let cls = '-';
    let used = '-';
    let source = '-';
    let extra = '';
    let mirrorAge = null;
    if (info) {
      const d = gather(ctx, checked, [], row.alias, cfg);
      const q = quota.interpretSnapshot(d.snapshots[row.alias], { alias: row.alias, expectedRoot: d.roots[row.alias], nowMs });
      cls = require('./lib/account-pick').classify(q);
      used = q.used === null ? '-' : String(q.used);
      source = q.source;
      const rows = d.observations ? d.observations[row.alias] : null;
      if (rows) { // mirror fields appear only on a row that has mirror data
        const j = judge(q, d.snapshots[row.alias], rows, d.manifest, nowMs);
        if (j.drop !== null) { cls = 'cooling'; used = '-'; source = 'none'; } else { cls = j.cls; used = j.used === null ? '-' : String(j.used); source = j.source; }
        const { observed_at: takeoverAt } = j; // set only when a tight mirror window decided the alias
        mirrorAge = observationAgeS(rows, nowMs);
        let own = 'unknown';
        try { own = interpret.interpretWindows(rows, d.manifest, nowMs / 1000).class; } catch (_) { /* unknown */ }
        extra = ` mirror_class=${own} mirror_age=${mirrorAge === null ? 'none' : `${mirrorAge}s`}` +
          (takeoverAt !== undefined ? ` observed_at=${audit.formatTaipei(takeoverAt * 1000)}` : '');
      }
    }
    ages.push(`${row.alias}=${mirrorAge === null ? 'none' : `${mirrorAge}s`}`);
    const until = cooldown.readCooldown(row.alias, { dir: ctx.cooldownDir, nowMs });
    const cd = cooldown.isCooling(until, nowMs) ? audit.formatTaipei(until) : '-';
    ctx.out(`alias=${row.alias} enabled=${row.enabled ? 'yes' : 'no'} priority=${row.priority} class=${cls} used=${used} source=${source} cooldown_until=${cd}${extra}`);
  }
  // Coverage (plan 15a): the newest observation per alias in the quota mirror, or none, so zero observations show.
  ctx.out(`observations newest_age: ${ages.join(' ')}`);
  const res = audit.readAudit(ctx.auditFile, {});
  for (const line of audit.renderStatus(res, { limit })) ctx.out(line);
  return EXIT.OK;
}

function cmdCooldown(ctx, argv) {
  const { opts } = parseArgs(argv, { clear: 'value' });
  if (opts.clear === undefined) throw new Stop(EXIT.INVALID, 'usage: cooldown --clear <alias>', null);
  const checked = loadChecked(ctx, 'cooldown');
  if (!checked.configured) throw new Stop(EXIT.INVALID, 'registry_not_configured', null);
  try { registry.requireAlias({ accounts: checked.accounts }, opts.clear); } catch (e) {
    if (e instanceof registry.RegistryError) throw new Stop(EXIT.INVALID, `unknown_alias (${e.reason})`, null);
    throw e;
  }
  const clearedCooldown = cooldown.clearCooldown(opts.clear, { dir: ctx.cooldownDir });
  const refusal = clearRefusalRow(ctx, opts.clear);
  ctx.out(clearedCooldown || refusal.removed ? `cleared alias=${opts.clear}` : `no_cooldown alias=${opts.clear}`);
  if (refusal.problem) {
    ctx.err(`refusal_not_cleared alias=${opts.clear} (${refusal.problem})`);
    return EXIT.CHILD_ERROR;
  }
  return EXIT.OK;
}

const SELFTEST_FAIL = 1; // operator spikes: any failed condition exits 1
const LOCAL_BASE_RE = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
const SELFTEST_PROMPT = ['-p', 'say OK', '--model', 'haiku', '--output-format', 'json', '--tools', '', '--strict-mcp-config'];

/** Copy of ctx whose output is captured (lines kept in .captured), so a selftest controls what is printed. */
function quietCtx(ctx) {
  const q = Object.assign({}, ctx, { captured: [] });
  q.write = (fd, data) => { q.captured.push(String(data)); };
  q.err = (line) => q.write(2, `claude-account: ${line}\n`);
  q.out = (line) => q.write(1, `${line}\n`);
  return q;
}

function insideDir(child, parent) {
  if (typeof child !== 'string' || !path.isAbsolute(child)) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Pure verdict of the --real-binary spike (plan O6). Returns the list of failed conditions (empty = pass).
 *   1 exit 6 (auth stop) AND positive evidence of an auth stop: the wrapper's `STOP_AUTH alias=probe` line in
 *     the captured output, or a parsed envelope with is_error === true and api_error_status === 401. A bare
 *     exit 6 proves nothing (run passes a child's own exit code through); unparseable output does not pass.
 *   2 no normal answer (no is_error:false result)   3 child HOME and CLAUDE_CONFIG_DIR are inside the throwaway
 *   dir and not the real home or its ~/.claude.
 */
function judgeRealBinary(x) {
  const bad = [];
  if (x.code !== EXIT.AUTH) bad.push(`exit_not_auth (got ${x.code}, want ${EXIT.AUTH})`);
  const env = parseEnvelope(x.stdout || '');
  // Only the wrapper's own prefixed line counts. The child's stdout/stderr never reach `stderr` here (selftest sends
  // them to files), and a child echoing the bare marker without the wrapper prefix is not evidence either.
  const markerRe = /(^|\n)claude-account: STOP_AUTH alias=probe(\n|$)/;
  const marker = markerRe.test(String(x.stderr || ''));
  const env401 = !!(env && env.is_error === true && env.api_error_status === 401);
  if (!marker && !env401) bad.push('no_auth_stop_evidence (need STOP_AUTH alias=probe or a 401 envelope)');
  if (env && env.is_error === false) bad.push('normal_answer_returned (ambient login used?)');
  const o = x.observed;
  if (!o || !o.home || !o.config_dir) {
    bad.push('child_env_not_observed');
  } else {
    const realClaude = path.join(x.realHome, '.claude');
    for (const [label, v] of [['HOME', o.home], ['CLAUDE_CONFIG_DIR', o.config_dir]]) {
      if (!insideDir(v, x.tmpRoot) || path.resolve(v) === path.resolve(x.realHome) || insideDir(v, realClaude)) {
        bad.push(`child_${label}_not_in_tempdir`);
      }
    }
  }
  return bad;
}

/**
 * Records HOME and CLAUDE_CONFIG_DIR (one per line) and then EXECs the real binary: exec replaces this shell, so
 * no extra process sits between the setpriv-guarded wrapper child and claude (a timeout or signal reaches claude
 * itself, and pdeathsig survives the execve).
 */
const PROBE_SRC = [
  '#!/bin/sh',
  'rec=$1; bin=$2; shift 2',
  'printf "%s\\n%s\\n" "${HOME-}" "${CLAUDE_CONFIG_DIR-}" > "$rec"',
  'exec "$bin" "$@"',
  '',
].join('\n');

function readObserved(file) {
  try {
    const [home, configDir] = fs.readFileSync(file, 'utf8').split('\n');
    return { home: home || null, config_dir: configDir || null };
  } catch (_) { return null; }
}

function resolveBinaryOpt(v) {
  if (v === undefined) return 'claude';
  if (typeof v !== 'string' || v === '') throw new Stop(EXIT.INVALID, 'binary_invalid', null);
  return path.resolve(v);
}

async function selftestRealBinary(ctx, binary) {
  let base = null;
  try {
    base = fs.realpathSync(fs.mkdtempSync(path.join(ctx.env.TMPDIR || os.tmpdir(), 'g37-realbin-')));
    fs.chmodSync(base, 0o700);
    const accounts = path.join(base, 'accounts');
    const dirs = { accounts, live: path.join(base, 'live'), state: path.join(base, 'state'), run: path.join(base, 'run'), tmp: path.join(base, 'tmp') };
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    for (const d of ['claude', 'home']) fs.mkdirSync(path.join(accounts, 'probe', d), { recursive: true, mode: 0o700 });
    fs.chmodSync(accounts, 0o700);
    fs.chmodSync(path.join(accounts, 'probe'), 0o700);
    const tokenFile = path.join(accounts, 'probe', 'token');
    fs.writeFileSync(tokenFile, 'FAKE-not-a-real-token', { mode: 0o600 });
    fs.chmodSync(tokenFile, 0o600);
    const regFile = path.join(accounts, 'registry.json');
    fs.writeFileSync(regFile, JSON.stringify({ schema: 'autopilot.accounts/1', accounts: [{ alias: 'probe', enabled: true, priority: 10 }] }), { mode: 0o600 });
    fs.chmodSync(regFile, 0o600);
    const cfgFile = path.join(base, 'config.json');
    fs.writeFileSync(cfgFile, '{}');
    const probe = path.join(base, 'probe.sh');
    fs.writeFileSync(probe, PROBE_SRC, { mode: 0o700 });
    const rec = path.join(base, 'observed.json');
    const outFile = path.join(base, 'stdout.json');
    const errFile = path.join(base, 'stderr.txt');
    const env = {
      PATH: ctx.env.PATH || '', LANG: ctx.env.LANG || 'C', TMPDIR: dirs.tmp, XDG_RUNTIME_DIR: dirs.run,
      AUTOPILOT_ACCOUNTS_DIR: accounts, AUTOPILOT_LIVE_DIR: dirs.live, AUTOPILOT_STATE_DIR: dirs.state, AUTOPILOT_CONFIG: cfgFile,
    };
    const sctx = quietCtx(makeCtx({ env, realHome: ctx.realHome, now: ctx.now, uid: ctx.uid, warn: () => {} }));
    const code = await cmdRun(sctx, ['--alias', 'probe', '--purpose', 'selftest', '--timeout', '180', '--stdout', outFile, '--stderr', errFile, '--',
      '/bin/sh', probe, rec, binary, ...SELFTEST_PROMPT]);
    let stdout = '';
    try { stdout = fs.readFileSync(outFile, 'utf8'); } catch (_) { /* none */ }
    const observed = readObserved(rec);
    const bad = judgeRealBinary({ code, stdout, stderr: sctx.captured.join(''), observed, tmpRoot: base, realHome: ctx.realHome });
    if (bad.length) {
      for (const b of bad) ctx.err(`selftest FAIL ${b}`);
      return SELFTEST_FAIL;
    }
    ctx.out('selftest: fake token -> 401, ambient login not used');
    return EXIT.OK;
  } finally {
    if (base) fs.rmSync(base, { recursive: true, force: true });
  }
}

/** Local server that answers every request itself with the S3 429 shape. It has no forwarding code path. */
function startLocal429Server() {
  const http = require('http');
  const state = { requests: 0, server: null, base: null };
  state.server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      state.requests++;
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: "This request would exceed your account's rate limit. (local synthetic)" } }));
    });
  });
  return new Promise((resolve, reject) => {
    state.server.once('error', reject);
    state.server.listen(0, '127.0.0.1', () => {
      state.base = `http://127.0.0.1:${state.server.address().port}`;
      resolve(state);
    });
  });
}

const SIM_FAKE_TOKEN = 'FAKE-simulate-429-local-only';

async function selftestSimulate429(ctx, aliasA, binary) {
  const checked = loadChecked(ctx, 'selftest');
  if (!checked.configured) throw new Stop(EXIT.INVALID, 'registry_not_configured', null);
  try { registry.requireAlias({ accounts: checked.accounts }, aliasA); } catch (e) {
    if (e instanceof registry.RegistryError) throw new Stop(EXIT.INVALID, `unknown_alias (${e.reason})`, null);
    throw e;
  }
  let srv = null;
  let tmp = null;
  try {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(ctx.env.TMPDIR || os.tmpdir(), 'g37-sim429-')));
    srv = await startLocal429Server();
    if (!LOCAL_BASE_RE.test(srv.base)) throw new Stop(EXIT.INVALID, 'simulate_base_not_local', null);
    // Step 1: alias A only, pointed at the local server. Nothing leaves the machine.
    const a = quietCtx(ctx);
    a.childEnvExtra = {
      [aliasA]: {
        ANTHROPIC_BASE_URL: srv.base,
        // The local server must never see A's real token: step 1 sends a fake one.
        CLAUDE_CODE_OAUTH_TOKEN: SIM_FAKE_TOKEN,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_MAX_RETRIES: '0',
      },
    };
    const codeA = await cmdRun(a, ['--alias', aliasA, '--purpose', 'selftest-429', '--max-attempts', '1', '--timeout', '180',
      '--stdout', path.join(tmp, 'a.out'), '--stderr', path.join(tmp, 'a.err'), '--', binary, ...SELFTEST_PROMPT]);
    const bad = [];
    if (srv.requests < 1) bad.push('alias_a_did_not_reach_local_server');
    if (codeA !== EXIT.LIMITED) bad.push(`alias_a_exit (got ${codeA}, want ${EXIT.LIMITED})`);
    const until = cooldown.readCooldown(aliasA, { dir: ctx.cooldownDir, nowMs: ctx.now() });
    if (!cooldown.isCooling(until, ctx.now())) bad.push('cooldown_not_written');
    if (bad.length) { for (const b of bad) ctx.err(`selftest FAIL ${b}`); return SELFTEST_FAIL; }
    // Step 2: unpinned run, no seam. A is cooling, so the next alias answers through its real route.
    const b = quietCtx(ctx);
    let codeB;
    try {
      codeB = await cmdRun(b, ['--purpose', 'selftest-429', '--timeout', '180', '--stdout', path.join(tmp, 'b.out'), '--', binary, ...SELFTEST_PROMPT]);
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
      codeB = e.exitCode;
    }
    const aliasB = b.lastAttemptAlias;
    if (codeB !== EXIT.OK || !aliasB || aliasB === aliasA) {
      ctx.err(`selftest FAIL next_alias_not_ok (exit ${codeB}${aliasB ? `, alias ${aliasB}` : ''})`);
      return SELFTEST_FAIL;
    }
    const st = quietCtx(ctx);
    cmdStatus(st, []);
    const line = st.captured.join('').split('\n').find((l) => l.startsWith(`alias=${aliasA} `));
    if (!line || /cooldown_until=-(\s|$)/.test(line)) {
      ctx.err('selftest FAIL status_does_not_show_cooldown');
      return SELFTEST_FAIL;
    }
    ctx.out(`${aliasA} rate_limited -> ${aliasB} ok`);
    ctx.out(`status shows ${aliasA} cooling; release it with: node scripts/claude-account.js cooldown --clear ${aliasA}`);
    return EXIT.OK;
  } finally {
    if (srv) await new Promise((r) => srv.server.close(r));
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function cmdSelftest(ctx, argv) {
  const { opts, rest } = parseArgs(argv, { 'real-binary': 'flag', 'simulate-429': 'value', binary: 'value' });
  if (opts['real-binary'] && opts['simulate-429'] !== undefined) throw new Stop(EXIT.INVALID, 'selftest: pick one of --real-binary or --simulate-429', null);
  if (opts.binary !== undefined && !opts['real-binary'] && opts['simulate-429'] === undefined) throw new Stop(EXIT.INVALID, 'selftest: --binary needs --real-binary or --simulate-429', null);
  if (rest.length) throw new Stop(EXIT.INVALID, 'selftest: unexpected argument', null);
  if (opts['real-binary']) return selftestRealBinary(ctx, resolveBinaryOpt(opts.binary));
  if (opts['simulate-429'] !== undefined) return selftestSimulate429(ctx, opts['simulate-429'], resolveBinaryOpt(opts.binary));
  const { makeFixture, R401, R429, R429_USAGE, ERR_EXIT0 } = require('./lib/account-fixtures/shim-install');
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  const results = [];
  const check = (name, got, want) => { results.push({ name, ok: got === want, got, want }); };
  const quiet = (d) => ({ env: fx.env, realHome: fx.realHome, write: () => {}, now: d && d.now });
  const call = (argvx) => cli(argvx, quiet());
  try {
    check('run ok', await call(['run', '--purpose', 'selftest', '--', 'claude', '-p', 'x']), 0);
    fx.shim.setControl({ default: undefined, tokens: { [fx.tokens.a]: R429, [fx.tokens.b]: R429_USAGE } });
    check('all limited', await call(['run', '--purpose', 'selftest', '--', 'claude', '-p', 'x']), 4);
    check('none available while cooling', await call(['run', '--purpose', 'selftest', '--', 'claude', '-p', 'x']), 3);
    fx.shim.setControl({ tokens: { [fx.tokens.a]: R401 }, default: undefined });
    for (const al of ['a', 'b']) cooldown.clearCooldown(al, { dir: fx.cooldownDir });
    fs.rmSync(path.join(fx.liveDir, 'quota'), { recursive: true, force: true }); // the 429 scenarios left refusal rows (G40 D4): release them with the cooldowns
    check('401 stops', await call(['run', '--purpose', 'selftest', '--', 'claude', '-p', 'x']), 6);
    fx.shim.setControl({ default: ERR_EXIT0 });
    check('error envelope exit 0 -> 5', await call(['run', '--purpose', 'selftest', '--', 'claude', '-p', 'x']), 5);
  } finally {
    fx.cleanup();
  }
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) ctx.err(`selftest FAIL ${r.name}: got ${r.got} want ${r.want}`);
  if (bad.length) return EXIT.CHILD_ERROR;
  ctx.out(`selftest ok (${results.length} checks)`);
  return EXIT.OK;
}

// ---------------------------------------------------------------- entry

function nodeTooOld() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  return maj < 20 || (maj === 20 && min < 10);
}

/** In-process entry. Returns the exit code; never calls process.exit. deps: {env, realHome, now, write, uid}. */
async function cli(argv, deps) {
  const ctx = makeCtx(deps);
  if (nodeTooOld()) { ctx.err('node >= 20.10 required'); return EXIT.INVALID; }
  if (!ctx.liveDir) { ctx.err('live_dir_refused'); return EXIT.INVALID; }
  const sub = argv[0];
  const rest = argv.slice(1);
  try {
    switch (sub) {
      case 'run': return await cmdRun(ctx, rest);
      case 'exec': return await cmdExec(ctx, rest);
      case 'pick': return cmdPick(ctx, rest);
      case 'env-check': return cmdEnvCheck(ctx, rest);
      case 'status': return cmdStatus(ctx, rest);
      case 'cooldown': return cmdCooldown(ctx, rest);
      case 'usage-probe': return await cmdUsageProbe(ctx, rest);
      case 'sync-statusline': return cmdSyncStatusline(ctx, rest);
      case 'selftest': return await cmdSelftest(ctx, rest);
      default:
        ctx.err('usage: claude-account.js pick|env-check|run|exec|usage-probe|sync-statusline|status|cooldown|selftest');
        return EXIT.INVALID;
    }
  } catch (e) {
    if (e instanceof Stop) {
      ctx.err(e.message);
      return e.exitCode;
    }
    ctx.err(`error (${e && e.code ? e.code : String(e && e.message).slice(0, 80)})`);
    return EXIT.INVALID;
  }
}

module.exports = { cli, createScrubber, classifyAttempt, parseEnvelope, judgeRealBinary, preflightExec, PROBE_SRC, EXIT };

if (require.main === module) {
  cli(process.argv.slice(2)).then((c) => { process.exitCode = c; });
}
