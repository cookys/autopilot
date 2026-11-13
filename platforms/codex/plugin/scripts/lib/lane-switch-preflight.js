'use strict';
/**
 * lane-switch-preflight.js — P2 step 1 (Before) for lane-switch.
 * Plan: project/plans/2026-11-10-profile-switch.md P2 step 1 and section 2.5.
 *
 *   preflight(opts, deps) -> { ok, checks: [{name, ok, detail}], record }
 *
 * opts: { lane, profile, order, baseDir?, home? }
 *   profile is the target. The current profile, seat, pane and session id come from the lane manifest.
 * deps: { run(bin, args, { env, timeout })?, now?, fs?: { existsSync, readFileSync } }
 *   tmux, claude and fleet go through deps.run (default spawnSync). deps.fs reads the transcript
 *   and costs.jsonl. Tests pass stubs and never touch the real system.
 *
 * Each check is appended to the switch journal (step before:<name>, outcome ok|fail).
 * Transcript path: <config dir>/projects/<cwd-key>/<session id>.jsonl, cwd-key = the pane cwd
 * just recorded (every character outside [A-Za-z0-9] becomes '-'), config dir =
 * ~/.claude-profiles/<current> or ~/.claude for home.
 * Target expiry reuses profile-health.js:56-61 (days_left <= THRESHOLD_DAYS is expiring).
 * The account alias comes only from account-alias.js claudeAccount(). This file never opens
 * .claude.json, .credentials.json or settings.json, and never puts an e-mail in a check,
 * the record or the journal.
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readManifest, writeManifest } = require('./lane-manifest');
const { appendJournal, checkRow } = require('./switch-journal');
const { claudeAccount } = require('./account-alias');
const { parsePeers, matchingSeats, isLive, isOffline } = require('./fleet-peers');

const DAY = 86400000;
const THRESHOLD_DAYS = 10; // profile-health.js THRESHOLD_DAYS
const DROP_ENV = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AUTOPILOT_ACCOUNT'];
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ORDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/;
const SID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALIAS_RE = /^(?:acct-[0-9a-f]{8}|[a-z0-9-]{1,24})$/;

function cwdKey(cwd) { return String(cwd).replace(/[^A-Za-z0-9]/g, '-'); }

function configDirOf(home, profile) {
  return profile === 'home' ? path.join(home, '.claude') : path.join(home, '.claude-profiles', profile);
}

// Same classification as profile-health.js readProfile (loggedIn, then days_left, then status).
function loginStatus(auth, nowMs) {
  if (!auth || auth.loggedIn !== true) return { loggedIn: false, days_left: null, status: 'logged_out' };
  const exp = typeof auth.loginExpiresAt === 'string' ? Date.parse(auth.loginExpiresAt) : NaN;
  if (!Number.isFinite(exp)) return { loggedIn: true, days_left: null, status: 'unknown' };
  const days_left = Math.floor((exp - nowMs) / DAY);
  const status = exp <= nowMs ? 'expired' : days_left <= THRESHOLD_DAYS ? 'expiring' : 'ok';
  return { loggedIn: true, days_left, status };
}

function parseAuth(stdout) {
  let j;
  try { j = JSON.parse(stdout); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const out = { loggedIn: j.loggedIn === true };
  if (typeof j.loginExpiresAt === 'string') out.loginExpiresAt = j.loginExpiresAt;
  return out;
}

function resolveNow(d) {
  if (d && typeof d.now === 'number' && Number.isFinite(d.now)) return d.now;
  if (d && typeof d.now === 'string') {
    const t = Date.parse(d.now);
    if (Number.isFinite(t)) return t;
  }
  if (d && typeof d.now === 'function') {
    const v = d.now();
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  if (process.env.AUTOPILOT_NOW) {
    const t = Date.parse(process.env.AUTOPILOT_NOW);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

function childEnv(home, dir) {
  const env = { ...process.env, HOME: home };
  for (const k of DROP_ENV) delete env[k];
  delete env.CLAUDE_CONFIG_DIR;
  if (dir) env.CLAUDE_CONFIG_DIR = dir;
  return env;
}

function defaultRun(bin, args, opts) {
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: (opts && opts.timeout) || 20000,
    env: opts && opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '' };
}

function invoke(run, bin, args, env) {
  try {
    const r = run(bin, args, { env, timeout: 20000 });
    if (!r || typeof r.stdout !== 'string') return { status: 1, stdout: '' };
    return { status: r.status === null ? 1 : r.status, stdout: r.stdout };
  } catch {
    return { status: 1, stdout: '' };
  }
}

function safeDetail(detail) {
  if (detail == null || detail === '') return undefined;
  const s = String(detail);
  try {
    checkRow({ ts: 't', order: 'abcd', lane: 'l', step: 's', outcome: 'ok', detail: s });
    return s;
  } catch {
    return 'detail_rejected';
  }
}

function journal(base, opts, from, to, name, ok, detail, ts) {
  const row = { order: opts.order, lane: opts.lane, step: `before:${name}`, outcome: ok ? 'ok' : 'fail' };
  if (typeof from === 'string' && from) row.from = from;
  if (typeof to === 'string' && to) row.to = to;
  const d = safeDetail(detail);
  if (d) row.detail = d;
  appendJournal(base, row, ts);
}

function aliasFor(home, profile) {
  const env = { HOME: home };
  if (profile !== 'home') env.CLAUDE_CONFIG_DIR = configDirOf(home, profile);
  const alias = claudeAccount(env);
  return typeof alias === 'string' && ALIAS_RE.test(alias) ? alias : null;
}

function seatCheck(run, home, manifest) {
  if (!manifest.seat) return { ok: false, detail: 'seat_missing' };
  const r = invoke(run, process.env.AUTOPILOT_FLEET_BIN || 'fleet', ['peers', '--json'], childEnv(home, null));
  if (r.status !== 0) return { ok: false, detail: 'seat_unreadable' };
  const members = parsePeers(r.stdout);
  if (!members) return { ok: false, detail: 'seat_unreadable' };
  const row = matchingSeats(members, manifest.seat)[0];
  if (!row) return { ok: false, detail: 'seat_absent' };
  if (isOffline(row)) return { ok: false, detail: 'seat_offline' };
  if (!isLive(row)) return { ok: false, detail: 'seat_state_unknown' };
  return { ok: true, detail: 'live' };
}

function paneCheck(run, home, base, manifest) {
  if (!manifest.pane) return { ok: false, detail: 'pane_missing', cwd: null };
  const r = invoke(run, 'tmux', ['display', '-p', '-t', manifest.pane, '#{pane_current_path}'], childEnv(home, null));
  if (r.status !== 0) return { ok: false, detail: 'pane_cwd_unreadable', cwd: null };
  const cwd = r.stdout.trim();
  if (!cwd || !path.isAbsolute(cwd)) return { ok: false, detail: 'pane_cwd_not_absolute', cwd: null };
  try { writeManifest(base, { ...manifest, cwd }); } catch { return { ok: false, detail: 'manifest_write_failed', cwd: null }; }
  return { ok: true, detail: 'recorded', cwd };
}

function transcriptCheck(fsys, home, profile, cwd, sid) {
  if (!profile) return { ok: false, detail: 'profile_missing', cwd_key: null, path: null };
  if (!cwd) return { ok: false, detail: 'no_pane_cwd', cwd_key: null, path: null };
  if (!sid || !SID_RE.test(sid)) return { ok: false, detail: 'session_id_invalid', cwd_key: null, path: null };
  const key = cwdKey(cwd);
  const file = path.join(configDirOf(home, profile), 'projects', key, `${sid}.jsonl`);
  let exists = false;
  try { exists = fsys.existsSync(file) === true; } catch { return { ok: false, detail: 'transcript_unreadable', cwd_key: key, path: file }; }
  if (!exists) return { ok: false, detail: 'transcript_missing', cwd_key: key, path: file };
  return { ok: true, detail: 'present', cwd_key: key, path: file };
}

function currentAuth(run, home, profile) {
  if (!profile) return { ok: false, detail: 'profile_missing', alias: null };
  const dir = profile === 'home' ? null : configDirOf(home, profile);
  const r = invoke(run, process.env.AUTOPILOT_CLAUDE_BIN || 'claude', ['auth', 'status', '--json'], childEnv(home, dir));
  if (r.status !== 0) return { ok: false, detail: 'auth_unreadable', alias: null };
  const auth = parseAuth(r.stdout);
  if (!auth) return { ok: false, detail: 'auth_unreadable', alias: null };
  if (!auth.loggedIn) return { ok: false, detail: 'logged_out', alias: null };
  const alias = aliasFor(home, profile);
  if (!alias) return { ok: false, detail: 'alias_rejected', alias: null };
  return { ok: true, detail: `logged_in alias=${alias}`, alias };
}

function costCheck(fsys, home, profile, sid) {
  if (!profile) return { ok: false, detail: 'profile_missing', account: null };
  if (!sid) return { ok: false, detail: 'session_id_missing', account: null };
  const file = path.join(configDirOf(home, profile), 'metrics', 'costs.jsonl');
  let text;
  try { text = fsys.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, detail: 'none', account: null };
    return { ok: false, detail: 'cost_unreadable', account: null };
  }
  let account = null;
  let saw = false;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || row.session !== sid) continue;
    saw = true;
    account = typeof row.account === 'string' ? row.account : null;
  }
  if (!saw || account === null) return { ok: true, detail: 'none', account: null };
  if (!ALIAS_RE.test(account)) return { ok: false, detail: 'cost_account_not_alias', account: null };
  return { ok: true, detail: `account=${account}`, account };
}

function targetAuth(run, home, profile, nowMs) {
  const dir = profile === 'home' ? null : configDirOf(home, profile);
  const r = invoke(run, process.env.AUTOPILOT_CLAUDE_BIN || 'claude', ['auth', 'status', '--json'], childEnv(home, dir));
  if (r.status !== 0) return { ok: false, detail: 'auth_unreadable', status: null, days_left: null };
  const auth = parseAuth(r.stdout);
  if (!auth) return { ok: false, detail: 'auth_unreadable', status: null, days_left: null };
  const st = loginStatus(auth, nowMs);
  if (st.status === 'ok' || st.status === 'expiring' || st.status === 'expired') {
    return { ok: st.status === 'ok', detail: `${st.status} days_left=${st.days_left}`, status: st.status, days_left: st.days_left };
  }
  return { ok: false, detail: st.status, status: st.status, days_left: st.days_left };
}

function preflight(opts, deps) {
  const o = opts || {};
  const d = deps || {};
  const run = d.run || defaultRun;
  const fsys = d.fs || fs;
  const home = o.home || d.home || os.homedir();
  const base = o.baseDir || process.env.AUTOPILOT_LANE_BASE_DIR || path.join(home, '.config', 'autopilot');
  const now = resolveNow(d);
  const ts = typeof d.now === 'string' ? d.now : new Date(now).toISOString();
  if (!o.order || !ORDER_RE.test(String(o.order))) return { ok: false, checks: [{ name: 'args', ok: false, detail: 'order_invalid' }], record: {} };
  if (!o.lane || !NAME_RE.test(String(o.lane))) return { ok: false, checks: [{ name: 'args', ok: false, detail: 'lane_invalid' }], record: {} };
  if (!o.profile || !NAME_RE.test(String(o.profile))) return { ok: false, checks: [{ name: 'args', ok: false, detail: 'profile_invalid' }], record: {} };

  let manifest;
  try { manifest = readManifest(base, o.lane); } catch (e) {
    const detail = e && /^[a-z0-9_:-]+$/.test(e.message) ? e.message : 'manifest_unreadable';
    journal(base, o, undefined, o.profile, 'manifest', false, detail, ts);
    return { ok: false, checks: [{ name: 'manifest', ok: false, detail }], record: { lane: o.lane, order: o.order, to: o.profile } };
  }
  if (!manifest) {
    journal(base, o, undefined, o.profile, 'manifest', false, 'missing', ts);
    return { ok: false, checks: [{ name: 'manifest', ok: false, detail: 'missing' }], record: { lane: o.lane, order: o.order, to: o.profile } };
  }

  const from = manifest.profile;
  const checks = [];
  const record = {
    lane: o.lane, order: o.order, from: from || null, to: o.profile,
    seat: manifest.seat || null, session_id: manifest.session_id || null, pane: manifest.pane || null,
    pane_cwd: null, cwd_key: null, transcript: null, current_alias: null, cost_account: null,
    target_status: null, target_days_left: null,
  };
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    journal(base, o, from, o.profile, name, ok, detail, ts);
  };

  const seat = seatCheck(run, home, manifest);
  add('seat', seat.ok, seat.detail);
  const pane = paneCheck(run, home, base, manifest);
  record.pane_cwd = pane.cwd;
  add('pane-cwd', pane.ok, pane.detail);
  const tr = transcriptCheck(fsys, home, from, pane.cwd, manifest.session_id);
  record.cwd_key = tr.cwd_key;
  record.transcript = tr.path;
  add('transcript', tr.ok, tr.detail);
  const cur = currentAuth(run, home, from);
  record.current_alias = cur.alias;
  add('current-auth', cur.ok, cur.detail);
  const cost = costCheck(fsys, home, from, manifest.session_id);
  record.cost_account = cost.account;
  add('cost-row', cost.ok, cost.detail);
  const tgt = targetAuth(run, home, o.profile, now);
  record.target_status = tgt.status;
  record.target_days_left = tgt.days_left;
  add('target-auth', tgt.ok, tgt.detail);
  return { ok: checks.every((c) => c.ok), checks, record };
}

module.exports = { preflight };
