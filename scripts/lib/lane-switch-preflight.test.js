'use strict';
// P2 step 1: lane-switch preflight. Stubs only — no tmux, claude, fleet, or real home.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { preflight } = require('./lane-switch-preflight.js');
const { writeManifest, readManifest } = require('./lane-manifest.js');
const { journalFile } = require('./switch-journal.js');
const { claudeAccount } = require('./account-alias.js');

const DAY = 86400000;
const NOW = '2026-11-13T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const DROP = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AUTOPILOT_ACCOUNT'];

function thresholdDays() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'profile-health.js'), 'utf8');
  const m = src.match(/const THRESHOLD_DAYS = (\d+);/);
  assert.ok(m, 'profile-health.js THRESHOLD_DAYS');
  return Number(m[1]);
}
const THRESHOLD = thresholdDays();

function iso(days) { return new Date(NOW_MS + days * DAY).toISOString(); }

function fx(over) {
  const o = over || {};
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lspf-'));
  const base = path.join(home, 'lane-base');
  const paneCwd = '/work/x';
  writeManifest(base, {
    lane: 'l1', pane: 'lanes:1.0', cwd: '/work/stale', seat: 'x--claude', session_id: 'sid-123',
    model: 'opus', launch_flags: ['--mcp-config=/shared/fleet.json'], profile: 'stranity',
  });
  const fromDir = path.join(home, '.claude-profiles', 'stranity');
  const toDir = path.join(home, '.claude-profiles', 'cookys');
  const transcript = path.join(fromDir, 'projects', '-work-x', 'sid-123.jsonl');
  const costs = path.join(fromDir, 'metrics', 'costs.jsonl');
  const files = {};
  if (!o.omitTranscript) files[transcript] = '{"type":"user"}\n';
  files[costs] = [
    JSON.stringify({ ts: '2026-11-01T00:00:00.000Z', session: 'sid-123', account: 'acct-11111111' }),
    JSON.stringify({ ts: '2026-11-02T00:00:00.000Z', session: 'other', account: 'acct-bbbbbbbb' }),
    JSON.stringify({ ts: '2026-11-03T00:00:00.000Z', session: 'sid-123', account: o.costAccount || 'acct-22222222' }),
  ].join('\n') + '\n';
  const calls = [];
  const reads = [];
  const seatState = o.seatState || 'live';
  const currentBody = o.currentAuth || JSON.stringify({ loggedIn: true, loginExpiresAt: iso(80) });
  const targetBody = o.targetAuth || JSON.stringify({ loggedIn: true, loginExpiresAt: iso(THRESHOLD + 30) });
  const stubFs = {
    existsSync(p) {
      if (p.includes('.credentials') || p.endsWith(`${path.sep}.claude.json`) || p.endsWith(`${path.sep}settings.json`)) {
        throw new Error('credential_opened');
      }
      return Object.prototype.hasOwnProperty.call(files, p);
    },
    readFileSync(p) {
      reads.push(p);
      if (p.includes('.credentials') || p.endsWith(`${path.sep}.claude.json`) || p.endsWith(`${path.sep}settings.json`)) {
        throw new Error('credential_opened');
      }
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      return files[p];
    },
  };
  function run(bin, args, opts) {
    calls.push({ bin, args: [...args], env: { ...(opts && opts.env) } });
    if (bin === 'fleet') {
      const members = [
        { member: 'x--claude-2', state: 'live' },
        { member: 'x--claude', state: seatState },
      ];
      return { status: 0, stdout: JSON.stringify({ members }), stderr: '' };
    }
    if (bin === 'tmux') return { status: 0, stdout: `${paneCwd}\n`, stderr: '' };
    if (bin === 'claude') {
      const dir = (opts && opts.env && opts.env.CLAUDE_CONFIG_DIR) || '';
      const body = dir.endsWith(`${path.sep}stranity`) ? currentBody : targetBody;
      return { status: 0, stdout: body, stderr: '' };
    }
    return { status: 127, stdout: '', stderr: 'unexpected' };
  }
  return {
    home, base, fromDir, toDir, transcript, costs, calls, reads, paneCwd,
    opts: { lane: 'l1', profile: 'cookys', order: '01M70ABCDE', baseDir: base, home },
    deps: { run, now: NOW, fs: stubFs },
  };
}

function rowsOf(base) {
  const file = journalFile(base);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function checkNamed(res, name) {
  const c = res.checks.find((x) => x.name === name);
  assert.ok(c, `missing check ${name}`);
  return c;
}

test('all-pass: six checks, alias, latest cost account, pane cwd recorded, journal', () => {
  const w = fx();
  const res = preflight(w.opts, w.deps);
  assert.strictEqual(res.ok, true, JSON.stringify(res.checks));
  assert.deepStrictEqual(res.checks.map((c) => c.name), ['seat', 'pane-cwd', 'transcript', 'current-auth', 'cost-row', 'target-auth']);
  assert.ok(res.checks.every((c) => c.ok));
  const alias = claudeAccount({ HOME: w.home, CLAUDE_CONFIG_DIR: w.fromDir });
  assert.strictEqual(res.record.current_alias, alias);
  assert.match(alias, /^acct-[0-9a-f]{8}$/);
  assert.strictEqual(res.record.cost_account, 'acct-22222222');
  assert.strictEqual(res.record.pane_cwd, w.paneCwd);
  assert.strictEqual(res.record.cwd_key, '-work-x');
  assert.strictEqual(res.record.session_id, 'sid-123');
  assert.strictEqual(res.record.target_status, 'ok');
  assert.ok(res.record.target_days_left > THRESHOLD);
  assert.strictEqual(readManifest(w.base, 'l1').cwd, w.paneCwd);
  const cmds = w.calls.map((c) => `${c.bin} ${c.args.join(' ')}`);
  assert.ok(cmds.includes('fleet peers --json'));
  assert.ok(cmds.includes('tmux display -p -t lanes:1.0 #{pane_current_path}'));
  assert.strictEqual(w.calls.filter((c) => c.bin === 'claude').length, 2);
  assert.ok(w.calls.filter((c) => c.bin === 'claude').every((c) => c.args.join(' ') === 'auth status --json'));
  const cur = w.calls.find((c) => c.bin === 'claude' && c.env.CLAUDE_CONFIG_DIR === w.fromDir);
  const tgt = w.calls.find((c) => c.bin === 'claude' && c.env.CLAUDE_CONFIG_DIR === w.toDir);
  assert.ok(cur && tgt);
  for (const c of w.calls) for (const k of DROP) assert.strictEqual(Object.hasOwn(c.env, k), false, k);
  assert.ok(!w.calls.some((c) => c.bin === 'codeforge'));
  assert.ok(w.reads.every((p) => p === w.costs));
  const rows = rowsOf(w.base);
  assert.deepStrictEqual(rows.map((r) => r.step), res.checks.map((c) => `before:${c.name}`));
  assert.ok(rows.every((r) => r.outcome === 'ok' && r.order === '01M70ABCDE' && r.from === 'stranity' && r.to === 'cookys'));
  assert.ok(rows.some((r) => r.step === 'before:cost-row' && r.detail === 'account=acct-22222222'));
  assert.ok(!JSON.stringify(rows).includes('@'));
  assert.strictEqual(fs.statSync(journalFile(w.base)).mode & 0o777, 0o600);
});

test('seat offline: directory row present but offline is not live', () => {
  const w = fx({ seatState: 'offline' });
  const res = preflight(w.opts, w.deps);
  assert.strictEqual(res.ok, false);
  const seat = checkNamed(res, 'seat');
  assert.strictEqual(seat.ok, false);
  assert.strictEqual(seat.detail, 'seat_offline');
  const row = rowsOf(w.base).find((r) => r.step === 'before:seat');
  assert.ok(row);
  assert.strictEqual(row.outcome, 'fail');
});

test('transcript missing: session id in the manifest is not confirmed', () => {
  const w = fx({ omitTranscript: true });
  const res = preflight(w.opts, w.deps);
  assert.strictEqual(res.ok, false);
  const tr = checkNamed(res, 'transcript');
  assert.strictEqual(tr.ok, false);
  assert.strictEqual(tr.detail, 'transcript_missing');
  assert.strictEqual(readManifest(w.base, 'l1').cwd, w.paneCwd);
  const row = rowsOf(w.base).find((r) => r.step === 'before:transcript');
  assert.ok(row);
  assert.strictEqual(row.outcome, 'fail');
});

test('target expiring: days_left at the profile-health threshold fails', () => {
  const w = fx({ targetAuth: JSON.stringify({ loggedIn: true, loginExpiresAt: iso(THRESHOLD) }) });
  const res = preflight(w.opts, w.deps);
  assert.strictEqual(res.ok, false);
  const t = checkNamed(res, 'target-auth');
  assert.strictEqual(t.ok, false);
  assert.strictEqual(t.detail, `expiring days_left=${THRESHOLD}`);
  assert.strictEqual(res.record.target_status, 'expiring');
  assert.strictEqual(res.record.target_days_left, THRESHOLD);
  const row = rowsOf(w.base).find((r) => r.step === 'before:target-auth');
  assert.ok(row);
  assert.strictEqual(row.outcome, 'fail');
});

test('target logged out: loggedIn false fails even with a far expiry', () => {
  const w = fx({ targetAuth: JSON.stringify({ loggedIn: false, loginExpiresAt: iso(THRESHOLD + 30) }) });
  const res = preflight(w.opts, w.deps);
  assert.strictEqual(res.ok, false);
  const t = checkNamed(res, 'target-auth');
  assert.strictEqual(t.ok, false);
  assert.strictEqual(t.detail, 'logged_out');
  assert.strictEqual(res.record.target_status, 'logged_out');
  const row = rowsOf(w.base).find((r) => r.step === 'before:target-auth');
  assert.ok(row);
  assert.strictEqual(row.outcome, 'fail');
  assert.ok(!JSON.stringify(rowsOf(w.base)).includes('@'));
});
