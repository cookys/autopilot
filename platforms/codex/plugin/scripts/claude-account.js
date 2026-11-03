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
 *   node scripts/claude-account.js status    [--limit N]
 *   node scripts/claude-account.js cooldown  --clear <alias>
 *   node scripts/claude-account.js selftest                 (shim only; --real-binary is refused)
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
const { pick } = require('./lib/account-pick');
const audit = require('./lib/account-audit');
const accountEnv = require('./lib/account-env');
const authStop = require('./lib/auth-stop');
const { resolveLiveDir } = require('./lib/live-state-dir');

const EXIT = { OK: 0, INVALID: 2, NONE: 3, LIMITED: 4, CHILD_ERROR: 5, AUTH: 6, SCRUBBED: 7 };
const PURPOSE_RE = /^[a-z0-9-]{1,32}$/;
const SCRUB_MARK = Buffer.from('[token-scrubbed]');
const THROTTLE_COOLDOWN_MINUTES = 5; // plain server throttle: shorter than a quota exhaustion
const DEFAULT_MAX_ATTEMPTS = 3;

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
      const out = carry;
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
  const envMode = ctx.env.AUTOPILOT_ACCOUNT_MODE;
  if (envMode !== undefined && envMode !== '') {
    if (envMode !== 'auto' && envMode !== 'off') throw new Stop(EXIT.INVALID, 'env_accounts_mode_invalid', 'invalid_config');
    cfg.mode = envMode;
  }
  return cfg;
}

function auditLine(ctx, rec, tokens) {
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
  return {
    accounts, snapshots, roots, cooldowns, nowMs, notes,
    exclude: excludeList, refuseAllTight: cfg.refuse_all_tight,
  };
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
    return { outcome: 'rate_limited', exit: EXIT.LIMITED, limitKind: cls === 'quota_exhausted' ? 'quota' : 'throttle', text };
  }
  if (a.code === 0) return { outcome: 'child_error', exit: EXIT.CHILD_ERROR };
  return { outcome: 'other_failure', exit: a.code === null ? EXIT.CHILD_ERROR : a.code };
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
      child = spawn(argv[0], argv.slice(1), {
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
    const fwd = (sig) => () => { try { child.kill(sig); } catch (_) { /* gone */ } };
    const onTerm = fwd('SIGTERM');
    const onInt = fwd('SIGINT');
    process.on('SIGTERM', onTerm);
    process.on('SIGINT', onInt);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      process.removeListener('SIGTERM', onTerm);
      process.removeListener('SIGINT', onInt);
      result.code = code;
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
  const m = /usage limit reached\|(\d{10})\b/i.exec(text || '');
  if (m) out.push(Number(m[1]));
  return out;
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
  try {
    scratchRoot = fs.mkdtempSync(path.join(ctx.env.TMPDIR || os.tmpdir(), 'claude-account-'));
    fs.chmodSync(scratchRoot, 0o700);
    for (let k = 1; k <= maxAttempts; k++) {
      const data = gather(ctx, checked, tried, pinned, cfg);
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
      if (p.outcome === 'all_tight') auditLine(ctx, { alias, purpose, attempt: k, outcome: 'all_tight' });
      tried.push(alias);
      const info = checked.enabled.find((e) => e.alias === alias);
      const token = readToken(info.tokenFile);
      accountEnv.prepareHome({ homeDir: info.homeDir, realHome: ctx.realHome });
      let env;
      try {
        env = accountEnv.buildEnv({
          alias, token, configDir: info.configDir, homeDir: info.homeDir, callerEnv: ctx.env, realHome: ctx.realHome, locators: loc,
        });
      } catch (e) {
        if (e instanceof accountEnv.EnvError) {
          preAudit(ctx, purpose, 'invalid_config');
          throw new Stop(EXIT.INVALID, e.message, null);
        }
        throw e;
      }
      const dir = path.join(scratchRoot, `attempt-${k}`);
      fs.mkdirSync(dir, { mode: 0o700 });
      const raw = await execAttempt(ctx, { argv: cmd, env, cwd: opts.cwd, stdinFile: opts.stdin, timeoutSecs, token, dir });
      const a = { code: raw.code, timedOut: raw.timedOut, spawnError: raw.spawnError, scrubbed: raw.scrubbed, stdout: raw.stdout.toString('utf8'), stderr: raw.stderr.toString('utf8') };
      const cl = classifyAttempt(a, scratchRoot);
      auditLine(ctx, { alias, purpose, attempt: k, outcome: cl.outcome }, [token]);
      last = { raw, cl, alias };
      if (cl.outcome === 'rate_limited') {
        const nowMs = ctx.now();
        let until;
        if (cl.limitKind === 'quota') {
          until = cooldown.computeUntil({ nowMs, defaultMinutes: cfg.cooldown_default_minutes, tightResets: tightResetsFor(ctx, alias, checked, cl.text) });
        } else {
          until = nowMs + Math.min(cfg.cooldown_default_minutes, THROTTLE_COOLDOWN_MINUTES) * 60 * 1000;
        }
        cooldown.writeCooldown(alias, until, { dir: ctx.cooldownDir, nowMs });
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
  accountEnv.prepareHome({ homeDir: info.homeDir, realHome: ctx.realHome });
  let env;
  try {
    env = accountEnv.buildEnv({
      alias, token, configDir: info.configDir, homeDir: info.homeDir, callerEnv: ctx.env, realHome: ctx.realHome,
      locators: { accountsDir: ctx.accountsDir, liveDir: ctx.liveDir, stateDir: ctx.stateDir, configFile: ctx.configFile, runtimeDir: runtimeDir(ctx) },
    });
  } catch (e) {
    if (e instanceof accountEnv.EnvError) { preAudit(ctx, purpose, 'invalid_config'); throw new Stop(EXIT.INVALID, e.message, null); }
    throw e;
  }
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd[0], cmd.slice(1), { env, stdio: 'inherit' }); } catch (e) {
      ctx.err(`child_spawn_failed (${e && e.code ? e.code : 'error'})`);
      resolve(EXIT.CHILD_ERROR);
      return;
    }
    const fwd = (sig) => () => { try { child.kill(sig); } catch (_) { /* gone */ } };
    process.on('SIGTERM', fwd('SIGTERM'));
    process.on('SIGINT', fwd('SIGINT'));
    child.on('error', (e) => { ctx.err(`child_spawn_failed (${e && e.code ? e.code : 'error'})`); resolve(EXIT.CHILD_ERROR); });
    child.on('close', (code, sig) => {
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
  for (const row of checked.accounts) {
    const info = checked.enabled.find((e) => e.alias === row.alias);
    let cls = '-';
    let used = '-';
    let source = '-';
    if (info) {
      const d = gather(ctx, checked, [], row.alias, cfg);
      const q = quota.interpretSnapshot(d.snapshots[row.alias], { alias: row.alias, expectedRoot: d.roots[row.alias], nowMs });
      cls = require('./lib/account-pick').classify(q);
      used = q.used === null ? '-' : String(q.used);
      source = q.source;
    }
    const until = cooldown.readCooldown(row.alias, { dir: ctx.cooldownDir, nowMs });
    const cd = cooldown.isCooling(until, nowMs) ? audit.formatTaipei(until) : '-';
    ctx.out(`alias=${row.alias} enabled=${row.enabled ? 'yes' : 'no'} priority=${row.priority} class=${cls} used=${used} source=${source} cooldown_until=${cd}`);
  }
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
  ctx.out(cooldown.clearCooldown(opts.clear, { dir: ctx.cooldownDir }) ? `cleared alias=${opts.clear}` : `no_cooldown alias=${opts.clear}`);
  return EXIT.OK;
}

async function cmdSelftest(ctx, argv) {
  const { opts } = parseArgs(argv, { 'real-binary': 'flag', 'simulate-429': 'value' });
  if (opts['real-binary'] || opts['simulate-429'] !== undefined) {
    throw new Stop(EXIT.INVALID, 'selftest runs against the Node shim only; the real-binary run is an operator step (plan O6/O9)', null);
  }
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
      case 'selftest': return await cmdSelftest(ctx, rest);
      default:
        ctx.err('usage: claude-account.js pick|env-check|run|exec|status|cooldown|selftest');
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

module.exports = { cli, createScrubber, classifyAttempt, parseEnvelope, EXIT };

if (require.main === module) {
  cli(process.argv.slice(2)).then((c) => { process.exitCode = c; });
}
