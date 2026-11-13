'use strict';
// P2 step 8: post-switch cost-row confirmation. Stubs only — no tmux, claude, fleet,
// codeforge, and no real costs ledger. deps.run throws if anything spawns.
//
// Negative control, shown red first: copy this module and delete the line
//   if (!(ts > sinceMs)) continue; // gate: newer than the switch
// The copy then accepts a pre-switch row as confirmation (ok:true). With the gate,
// the same row is ignored and the result is no_row_in_window. The suite was run
// once with that comparison neutralized (exit 1) before the gate was restored (exit 0).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { confirmSwitch, main, CONFIRM_WINDOW_MS } = require('./lane-switch-confirm.js');
const { writeManifest } = require('./lane-manifest.js');

const ALIAS = 'acct-aaaaaaaa';
const OTHER = 'acct-bbbbbbbb';
const SINCE = '2026-11-13T00:00:00.000Z';
const SINCE_MS = Date.parse(SINCE);
const SESSION = 'sid-123';
const FILE = '/fixture/metrics/costs.jsonl';
const TOOL = path.join(__dirname, 'lane-switch-confirm.js');
const NEEDLE = 'if (!(ts > sinceMs)) continue; // gate: newer than the switch';
const WINDOW_MS = 30 * 60 * 1000;

const REC = {
  lane: 'l1', pane: 'lanes:1.0', cwd: '/work/x', seat: 'x--claude',
  session_id: SESSION, model: 'opus', launch_flags: ['--mcp-config=/shared/fleet.json'], profile: 'cookys',
};

function iso(ms) { return new Date(ms).toISOString(); }
function line(ts, account, session = SESSION) {
  return JSON.stringify({
    ts, session, account, model: 'opus',
    input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0,
    turns: 1, cost_usd: 0.01, cwd: '/work/x',
  });
}
function clockAt(ms) {
  let t = ms;
  const sleeps = [];
  const runs = [];
  return {
    sleeps,
    runs,
    now: () => t,
    sleep(n) { sleeps.push(n); t += n; },
    run() { runs.push('run'); throw new Error('external command'); },
  };
}
function runCase(body, extraOpts = {}, mod = { confirmSwitch }) {
  const clock = clockAt(SINCE_MS + 1000);
  const reads = [];
  const deps = {
    now: clock.now,
    sleep: clock.sleep,
    run: clock.run,
    intervalMs: 1000,
    home: '/fixture-home',
    env: {},
    fs: {
      readFileSync(p) {
        reads.push(p);
        if (p !== FILE) {
          const e = new Error(`unexpected read ${p}`);
          e.code = 'EPERM';
          throw e;
        }
        return body;
      },
    },
  };
  const result = mod.confirmSwitch({
    lane: 'l1', session: SESSION, since: SINCE, alias: ALIAS, costsFile: FILE, ...extraOpts,
  }, deps);
  return { result, clock, reads };
}

test('CONFIRM_WINDOW_MS is 30 minutes', () => {
  assert.strictEqual(CONFIRM_WINDOW_MS, WINDOW_MS);
});

test('matching row -> ok', () => {
  const body = [
    '{torn',
    line(iso(SINCE_MS - 5000), OTHER),
    line(iso(SINCE_MS + 2000), OTHER, 'other-session'),
    line(iso(SINCE_MS + 4000), ALIAS),
  ].join('\n') + '\n';
  const { result, clock, reads } = runCase(body);
  assert.deepStrictEqual(result, { ok: true, account: ALIAS });
  assert.deepStrictEqual(clock.runs, []);
  assert.deepStrictEqual(clock.sleeps, []);
  assert.ok(reads.length >= 1);
  assert.ok(reads.every((p) => p === FILE));
});

test('mismatching row -> mismatch', () => {
  const body = [
    line(iso(SINCE_MS - 1000), ALIAS),
    line(iso(SINCE_MS + 2000), OTHER),
    line(iso(SINCE_MS + 9000), ALIAS),
  ].join('\n') + '\n';
  const { result, clock } = runCase(body);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'mismatch');
  assert.strictEqual(result.account, OTHER);
  assert.strictEqual(result.expected, ALIAS);
  assert.strictEqual(result.report.includes('\n'), false);
  assert.match(result.report, /^\[換訂閱確認\]/);
  assert.ok(result.report.includes(OTHER));
  assert.ok(result.report.includes(ALIAS));
  assert.ok(result.report.includes('請 PM 處理'));
  assert.strictEqual(result.report.includes('@'), false);
  assert.deepStrictEqual(clock.runs, []);
  assert.deepStrictEqual(clock.sleeps, []);
});

test('no row in window -> no_row_in_window', () => {
  const { result, clock } = runCase('');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'no_row_in_window');
  assert.strictEqual(result.report.includes('\n'), false);
  assert.ok(result.report.includes('2026-11-13 08:00:00 台北時間'));
  assert.ok(result.report.includes('請 PM 處理'));
  assert.strictEqual(result.report.includes('@'), false);
  assert.strictEqual(clock.now(), SINCE_MS + 1000 + WINDOW_MS);
  assert.ok(clock.sleeps.length > 1);
  assert.deepStrictEqual(clock.runs, []);
});

test('rows before the switch are ignored', () => {
  const onlyOld = [
    line(iso(SINCE_MS - 1000), ALIAS),
    line(iso(SINCE_MS + 1000), ALIAS, 'other-session'),
  ].join('\n') + '\n';
  const ignored = runCase(onlyOld);
  assert.strictEqual(ignored.result.ok, false);
  assert.strictEqual(ignored.result.reason, 'no_row_in_window');
  assert.strictEqual(ignored.clock.now(), SINCE_MS + 1000 + WINDOW_MS);

  const later = runCase([
    line(iso(SINCE_MS - 1000), ALIAS),
    line(iso(SINCE_MS + 4000), ALIAS),
  ].join('\n') + '\n');
  assert.deepStrictEqual(later.result, { ok: true, account: ALIAS });

  const wrongAfter = runCase([
    line(iso(SINCE), ALIAS),
    line(iso(SINCE_MS + 4000), OTHER),
  ].join('\n') + '\n');
  assert.strictEqual(wrongAfter.result.reason, 'mismatch');
  assert.strictEqual(wrongAfter.result.account, OTHER);
});

test('a row within 30 min after the next turn counts, even long after the switch', () => {
  const turnMs = SINCE_MS + 2 * 60 * 60 * 1000;
  const rowMs = turnMs + 10 * 60 * 1000;
  const { result, clock } = runCase(line(iso(rowMs), ALIAS) + '\n', { turnAt: iso(turnMs) });
  assert.deepStrictEqual(result, { ok: true, account: ALIAS });
  assert.deepStrictEqual(clock.sleeps, []);
});

test('a row later than 30 min after the turn is outside the window', () => {
  const rowMs = SINCE_MS + WINDOW_MS + 1000;
  const { result, clock } = runCase(line(iso(rowMs), ALIAS) + '\n', { turnAt: SINCE });
  assert.strictEqual(result.reason, 'no_row_in_window');
  assert.strictEqual(clock.now(), SINCE_MS + WINDOW_MS);
});

test('negative control: removing the since-gate accepts a pre-switch row', () => {
  const srcPath = path.join(__dirname, 'lane-switch-confirm.js');
  const src = fs.readFileSync(srcPath, 'utf8');
  assert.ok(src.includes(NEEDLE), 'since-gate line missing');
  const brokenSrc = src.replace(NEEDLE, 'if (false) continue; // gate removed');
  assert.strictEqual(brokenSrc.includes(NEEDLE), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-tamper-'));
  const rewritten = brokenSrc.replace(/require\('\.\/([^']+)'\)/g, (_, rel) => {
    return `require(${JSON.stringify(path.join(__dirname, rel))})`;
  });
  const file = path.join(dir, 'lane-switch-confirm.js');
  fs.writeFileSync(file, rewritten);
  try {
    const broken = require(file);
    const onlyOld = line(iso(SINCE_MS - 1000), ALIAS) + '\n';
    const bad = runCase(onlyOld, {}, broken);
    assert.deepStrictEqual(bad.result, { ok: true, account: ALIAS });
    const good = runCase(onlyOld);
    assert.strictEqual(good.result.reason, 'no_row_in_window');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a credential path is refused and not opened', () => {
  let opened = false;
  const clock = clockAt(SINCE_MS + 1000);
  assert.throws(() => confirmSwitch({
    lane: 'l1', session: SESSION, since: SINCE, alias: ALIAS,
    costsFile: '/tmp/profile/.credentials.json',
  }, {
    now: clock.now,
    sleep: clock.sleep,
    run: clock.run,
    fs: { readFileSync() { opened = true; return ''; } },
  }), (e) => e && e.code === 'costs_path_refused');
  assert.strictEqual(opened, false);
  assert.deepStrictEqual(clock.runs, []);
  assert.throws(() => confirmSwitch({
    lane: 'l1', session: SESSION, since: SINCE, alias: ALIAS,
    costsFile: '/tmp/profile/.claude.json',
  }, {
    now: clock.now,
    sleep() { throw new Error('slept'); },
    fs: { readFileSync() { opened = true; return ''; } },
  }), (e) => e && e.code === 'costs_path_refused');
  assert.strictEqual(opened, false);
});

test('an email-shaped account is a mismatch and is not copied into the report', () => {
  const raw = ['not-an-alias', 'example.com'].join('@');
  const { result } = runCase(line(iso(SINCE_MS + 2000), raw) + '\n');
  assert.strictEqual(result.reason, 'mismatch');
  assert.strictEqual(result.account, null);
  assert.strictEqual(result.report.includes('@'), false);
  assert.ok(result.report.includes('（非別名）'));
});

test('cli main: mismatch exits 1 with the report and does not spawn', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-main-'));
  const base = path.join(home, 'cfg');
  writeManifest(base, REC);
  const out = [];
  const err = [];
  const clock = clockAt(SINCE_MS + 1000);
  const code = main(['--lane', 'l1', '--since', SINCE, '--alias', ALIAS], {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    baseDir: base,
    costsFile: FILE,
    home,
    env: {},
    now: clock.now,
    sleep: clock.sleep,
    run: clock.run,
    intervalMs: 1000,
    fs: { readFileSync: () => `${line(iso(SINCE_MS + 2000), OTHER)}\n` },
  });
  assert.strictEqual(code, 1);
  const body = JSON.parse(out.join(''));
  assert.strictEqual(body.reason, 'mismatch');
  assert.ok(body.report.includes('請 PM 處理'));
  assert.strictEqual(err.join(''), '');
  assert.deepStrictEqual(clock.runs, []);
});

test('cli usage: missing args and a bad alias exit 2 without echoing the value', () => {
  const err = [];
  const out = [];
  const sink = { err: (s) => err.push(s), out: (s) => out.push(s) };
  assert.strictEqual(main(['--lane', 'l1'], sink), 2);
  assert.match(err.join(''), /--since/);
  err.length = 0;
  const bad = ['who', 'example.com'].join('@');
  assert.strictEqual(main(['--lane', 'l1', '--since', SINCE, '--alias', bad], sink), 2);
  assert.match(err.join(''), /alias_invalid/);
  assert.strictEqual(err.join('').includes('@'), false);
  assert.strictEqual(err.join('').includes(bad), false);
  err.length = 0;
  assert.strictEqual(main(['--help'], sink), 0);
  assert.match(out.join(''), /--lane L --since <iso> --alias A/);
});

test('cli subprocess reads the cost-tracker path under CLAUDE_CONFIG_DIR', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-cli-'));
  const base = path.join(home, 'cfg');
  const configDir = path.join(home, 'profile');
  const costs = path.join(configDir, 'metrics', 'costs.jsonl');
  writeManifest(base, REC);
  fs.mkdirSync(path.dirname(costs), { recursive: true });
  fs.writeFileSync(costs, `${line(iso(SINCE_MS + 5000), ALIAS)}\n`);
  const r = cp.spawnSync(process.execPath, [TOOL, '--lane', 'l1', '--since', SINCE, '--alias', ALIAS], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      AUTOPILOT_LANE_BASE_DIR: base,
      CLAUDE_CONFIG_DIR: configDir,
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.strictEqual(r.error && r.error.code, undefined, r.stderr || String(r.error));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), { ok: true, account: ALIAS });
});
