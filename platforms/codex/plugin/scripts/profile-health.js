#!/usr/bin/env node
'use strict';
/**
 * profile-health.js - warn the PM before a Claude login profile's login expires.
 *
 *   node scripts/profile-health.js check [--json]
 *   node scripts/profile-health.js notify [--to <addr>]      (else AUTOPILOT_PM_ADDRESS; required)
 *
 * Profiles on this host: `home` (the default ~/.claude, no CLAUDE_CONFIG_DIR) plus each directory under ~/.claude-profiles/.
 * Per profile it runs `claude auth status --json` (CLAUDE_CONFIG_DIR set for non-home) and reads ONLY loggedIn, loginExpiresAt and
 * configDirectory; email, orgId, orgName and every other field are never printed, stored or sent.
 * status: ok (more than 10 days left) | expiring (10 days or less) | expired | logged_out | unsupported_name (dir name fails letters/digits/._- or is `home`; claude is not run, notify asks for a rename) | unknown (claude gave no readable answer; never notified).
 * days_left = floor((loginExpiresAt - now) / 1 day), UTC.
 *
 * notify sends one `fleet send` per expiring / expired / logged_out profile, first line `[操作員決定]`: machine, OS account, profile,
 * expiry (Taipei time), days left and the login command the operator types. Dedup: once per (profile, loginExpiresAt, status), kept in
 * $XDG_STATE_HOME/autopilot/profile-health.json (default ~/.local/state/autopilot/), mode 0600; a failed send is not recorded and retries next run.
 * Exit 0 normally; notify exits 1 when a send failed, 2 when no recipient is given (--to or AUTOPILOT_PM_ADDRESS).
 *
 * Knobs: AUTOPILOT_PM_ADDRESS (notify recipient when --to is omitted), AUTOPILOT_CLAUDE_BIN (default claude), AUTOPILOT_FLEET_BIN (default fleet), AUTOPILOT_NOW (ISO time, tests), HOME, XDG_STATE_HOME.
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DAY = 86400000;
const THRESHOLD_DAYS = 10;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DROP_ENV = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

const nowMs = () => (process.env.AUTOPILOT_NOW ? Date.parse(process.env.AUTOPILOT_NOW) : Date.now());

function listProfiles() {
  const home = os.homedir();
  const out = [{ name: 'home', dir: null, label: path.join(home, '.claude') }];
  let names = [];
  try { names = fs.readdirSync(path.join(home, '.claude-profiles'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch (_e) { /* no profiles dir */ }
  for (const n of names) out.push({ name: n, dir: path.join(home, '.claude-profiles', n), label: path.join(home, '.claude-profiles', n), unsupported: !NAME.test(n) || n === 'home' });
  return out;
}

function readProfile(p, now) {
  if (p.unsupported) return { name: p.name, config_dir: p.label, loggedIn: null, loginExpiresAt: null, days_left: null, status: 'unsupported_name' };
  const env = { ...process.env };
  for (const k of DROP_ENV) delete env[k];
  delete env.CLAUDE_CONFIG_DIR;
  if (p.dir) env.CLAUDE_CONFIG_DIR = p.dir;
  const r = spawnSync(process.env.AUTOPILOT_CLAUDE_BIN || 'claude', ['auth', 'status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 20000, env });
  const row = { name: p.name, config_dir: p.label, loggedIn: null, loginExpiresAt: null, days_left: null, status: 'unknown' };
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (_e) { return row; }
  if (!j || typeof j !== 'object') return row;
  row.loggedIn = j.loggedIn === true;
  if (!row.loggedIn) { row.status = 'logged_out'; return row; }
  const exp = typeof j.loginExpiresAt === 'string' ? Date.parse(j.loginExpiresAt) : NaN;
  if (!Number.isFinite(exp)) return row;
  row.loginExpiresAt = j.loginExpiresAt;
  row.days_left = Math.floor((exp - now) / DAY);
  row.status = exp <= now ? 'expired' : row.days_left <= THRESHOLD_DAYS ? 'expiring' : 'ok';
  return row;
}

const check = () => { const now = nowMs(); return listProfiles().map((p) => readProfile(p, now)); };

function taipei(iso) { return `${new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')} +08`; }

function message(row) {
  if (row.status === 'unsupported_name') {
    return [
      '[操作員決定]',
      `Claude profile 目錄名稱不受支援：機器 ${os.hostname()}，OS 帳號 ${os.userInfo().username}，目錄名 ${JSON.stringify(row.name)}。`,
      '名稱只能用英文字母、數字、. _ -（開頭須為字母或數字，且不可叫 home）；請改名後才能檢查登入到期。',
    ].join('\n');
  }
  const prefix = row.name === 'home' ? '' : `CLAUDE_CONFIG_DIR="$HOME/.claude-profiles/${row.name}" `;
  const when = row.status === 'logged_out'
    ? '狀態：已登出（沒有有效登入）'
    : row.status === 'expired'
      ? `登入已於 ${taipei(row.loginExpiresAt)} 到期（已過 ${Math.floor((nowMs() - Date.parse(row.loginExpiresAt)) / DAY)} 天）`
      : `登入到期時間：${taipei(row.loginExpiresAt)}（剩 ${row.days_left} 天）`;
  return [
    '[操作員決定]',
    `Claude 登入需要重新登入：機器 ${os.hostname()}，OS 帳號 ${os.userInfo().username}，profile ${row.name}。`,
    when,
    '請在該機器、該 OS 帳號的終端機輸入：',
    `${prefix}claude auth login --claudeai`,
    '登入完成後確認：',
    `${prefix}claude auth status --text`,
    '憑證由你在瀏覽器中輸入；使用這個 profile 的 lane 會繼續運作，不需要先停。',
  ].join('\n');
}

function statePath() {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'autopilot', 'profile-health.json');
}
function loadState(f) {
  try { const s = JSON.parse(fs.readFileSync(f, 'utf8')); return s && typeof s.sent === 'object' && s.sent ? s : { sent: {} }; } catch (_e) { return { sent: {} }; }
}
function saveState(f, s) {
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.tmp${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, f);
}

function notify(to) {
  const f = statePath();
  const state = loadState(f);
  let failed = 0;
  for (const row of check()) {
    if (!['expiring', 'expired', 'logged_out', 'unsupported_name'].includes(row.status)) continue;
    const key = `${row.status}|${row.loginExpiresAt || 'none'}`;
    const slot = row.status === 'unsupported_name' ? `unsupported:${row.name}` : row.name;
    if (state.sent[slot] === key) { console.log(`${row.name}: ${row.status}, already notified`); continue; }
    const env = { ...process.env }; delete env.FLEET_FYI;
    const r = spawnSync(process.env.AUTOPILOT_FLEET_BIN || 'fleet', ['send', to, message(row)], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000, env });
    if (r.status !== 0) { failed++; console.log(`${row.name}: ${row.status}, send failed (will retry)`); continue; }
    state.sent[slot] = key;
    saveState(f, state);
    console.log(`${row.name}: ${row.status}, notified ${to}`);
  }
  return failed ? 1 : 0;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'check') {
    const rows = check();
    if (rest.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(`${r.name}\t${r.status}\tdays_left=${r.days_left === null ? '-' : r.days_left}\texpires=${r.loginExpiresAt || '-'}\t${r.config_dir}`);
    return 0;
  }
  if (cmd === 'notify') {
    const i = rest.indexOf('--to');
    const to = i >= 0 ? (rest[i + 1] || '').trim() : (process.env.AUTOPILOT_PM_ADDRESS || '').trim();
    if (!to || (i >= 0 && to.startsWith('-'))) {
      console.error('usage: profile-health.js notify --to <addr> (or set AUTOPILOT_PM_ADDRESS)');
      return 2;
    }
    return notify(to);
  }
  console.error('usage: profile-health.js check [--json] | notify [--to <addr>] (or set AUTOPILOT_PM_ADDRESS)');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { check, message, taipei };
