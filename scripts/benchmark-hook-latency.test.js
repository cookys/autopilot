'use strict';
// node --test scripts/benchmark-hook-latency.test.js
// Spends no money: `claude` is a stub (BENCH_CLAUDE_BIN) that writes recorded-shape --debug hook lines and a
// --output-format json body. HOOK_LATENCY_BIN lets a negative control point at a deliberately broken copy.
//
// RED at 10ccb2cb345974e424e8958209322dd2ed2fd6f0: scripts/benchmark-hook-latency.js did not exist, so every
// case below failed with "Cannot find module .../benchmark-hook-latency.js" (spawn exit 1, no report written).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = process.env.HOOK_LATENCY_BIN || path.join(__dirname, 'benchmark-hook-latency.js');
const REPO = path.resolve(__dirname, '..');

const STUB = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const a = process.argv.slice(2);
const val = (f) => { const i = a.indexOf(f); return i < 0 ? null : a[i + 1]; };
const cfg = process.env.CLAUDE_CONFIG_DIR || '';
const settingsRaw = fs.readFileSync(val('--settings'), 'utf8');
const hooks = (JSON.parse(settingsRaw).hooks) || {};
const nHooks = Object.keys(hooks).length;
const arm = /sleep 0\\.2/.test(settingsRaw) ? 'positive' : (nHooks ? 'enabled' : 'zero');
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({
  arm, cfg, cfgFiles: fs.existsSync(cfg) ? fs.readdirSync(cfg).sort() : null, home: process.env.HOME,
  session: ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'AUTOPILOT_PARENT_SESSION_ID'].filter((k) => k in process.env),
  cwd: process.cwd(), budget: val('--max-budget-usd'), debugFile: val('--debug-file'),
}) + '\\n');
const sc = process.env.STUB_SCENARIO || 'normal';
const base = Number(process.env.STUB_BASE_MS || 40);
const lines = [];
const ts = '2026-10-22T21:16:58.395Z';
const push = (ev, cmd, ms) => lines.push(ts + ' [DEBUG] Hooks: ' + ev + ':Read [' + cmd + '] finished with status 0 (' + ms + 'ms)');
for (let i = 0; i < 20; i++) {
  if (arm !== 'zero' || sc === 'zero_leak') { push('PreToolUse', 'node x/hooks/foreman-guard.js', base + (i % 5)); push('PostToolUse', 'node x/hooks/audit-log.js', base + 2 * (i % 5)); }
  if (arm === 'positive' && sc !== 'positive_blind') push('PostToolUse', 'sleep 0.2', process.env.STUB_MARKER_SHORT ? 100 : 210 + (i % 7));
}
lines.push(ts + ' [DEBUG] hooks module cc-plugin-telemetry@builtin telemetry.log settled in 1.2ms (native link, next() included)');
fs.writeFileSync(val('--debug-file'), lines.join('\\n') + '\\n');
if (sc === 'crash_no_json') process.exit(1);
process.stdout.write(JSON.stringify({ total_cost_usd: (process.env.STUB_COST_RAW ? JSON.parse(process.env.STUB_COST_RAW) : Number(process.env.STUB_COST || 0.01)), result: 'done' }));
`;

function withCtx(fn) {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-latency-test-'));
    const stub = path.join(dir, 'claude');
    fs.writeFileSync(stub, STUB, { mode: 0o755 });
    const creds = path.join(dir, 'creds.json');
    fs.writeFileSync(creds, '{"fake":"credentials"}');
    return fn({ dir, stub, creds, log: path.join(dir, 'stub.log'), out: path.join(dir, 'out', 'baseline.json') });
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(ctx, args, env = {}) {
  const e = { ...process.env, BENCH_CLAUDE_BIN: ctx.stub, BENCH_CREDENTIALS: ctx.creds, STUB_LOG: ctx.log, ...env };
  return spawnSync('node', [BIN, ...args], { encoding: 'utf8', env: e, cwd: REPO, timeout: 120000 });
}

const common = (ctx) => ['--samples', '5', '--max-usd', '5', '--out', ctx.out];

test('normal run: parses hook intervals, writes the evidence schema, valid instrument', () => withCtx((ctx) => {
  const r = run(ctx, common(ctx), {
    AUTOPILOT_SESSION_ID: 'leak1', CLAUDE_CODE_SESSION_ID: 'leak2', AUTOPILOT_PARENT_SESSION_ID: 'leak3',
  });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  const j = JSON.parse(fs.readFileSync(ctx.out, 'utf8'));
  assert.match(j.commit, /^[0-9a-f]{40}$/);
  assert.match(j.workload_sha, /^[0-9a-f]{64}$/);
  assert.strictEqual(j.samples, 5);
  for (const arm of ['enabled', 'positive_control', 'zero']) assert.ok(j.arms[arm], arm);
  const pre = j.arms.enabled.per_event.PreToolUse;
  assert.strictEqual(pre.hook_count, 100); // 20 lines x 5 samples
  assert.strictEqual(pre.spawns, 20);      // per run
  assert.strictEqual(pre.p50_ms, 42);      // base 40 + (i%5) over 0..4 => median 42
  assert.strictEqual(pre.p95_ms, 44);
  assert.deepStrictEqual(j.arms.zero.per_event, {});
  assert.ok(j.arms.positive_control.per_event.PostToolUse.hook_count > j.arms.enabled.per_event.PostToolUse.hook_count);
  assert.strictEqual(j.conclusion.refused, false);
  assert.strictEqual(j.conclusion.instrument_valid, true);
  assert.ok(j.conclusion.marker_p95_ms >= 180);
  assert.strictEqual(j.conclusion.enabled_minus_zero_p95_ms, 48); // PostToolUse p95 40+2*4=48 minus 0
  assert.strictEqual(j.conclusion.verdict, 'no_move'); // 48 < 150
  assert.strictEqual(pre.calls, 100);
  assert.strictEqual(pre.spawns_per_call, 1);
  const pc = j.arms.positive_control.per_event.PostToolUse;
  assert.strictEqual(pc.spawns_per_call, 2); // audit-log + marker are one call
  assert.ok(pc.call_p95_ms >= 210);
  assert.strictEqual(j.spent_usd, 0.15);
}));

test('child process isolation: fresh config dir with only .credentials.json, no session env, throwaway cwd', () => withCtx((ctx) => {
  const realClaude = path.join(os.homedir(), '.claude');
  const r = run(ctx, ['--samples', '2', '--max-usd', '5', '--out', ctx.out], {
    AUTOPILOT_SESSION_ID: 'leak1', CLAUDE_CODE_SESSION_ID: 'leak2', AUTOPILOT_PARENT_SESSION_ID: 'leak3',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const calls = fs.readFileSync(ctx.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(calls.length, 6);
  const dirs = new Set();
  for (const c of calls) {
    assert.deepStrictEqual(c.cfgFiles, ['.credentials.json']);
    assert.notStrictEqual(path.resolve(c.cfg), path.resolve(realClaude));
    assert.ok(path.resolve(c.cfg).startsWith(path.resolve(os.tmpdir())));
    assert.deepStrictEqual(c.session, []);
    assert.notStrictEqual(c.home, os.homedir());
    assert.ok(!c.cwd.startsWith(REPO), 'workload must not run inside a real repo');
    assert.ok(Number(c.budget) > 0);
    dirs.add(c.cfg);
  }
  assert.strictEqual(dirs.size, 6, 'every run gets its own fresh config dir');
  for (const d of dirs) assert.ok(!fs.existsSync(d), 'config dir removed afterwards');
}));

test('NEGATIVE CONTROL: zero arm still shows hook lines -> refuses to conclude', () => withCtx((ctx) => {
  const r = run(ctx, common(ctx), { STUB_SCENARIO: 'zero_leak' });
  assert.strictEqual(r.status, 4, r.stderr + r.stdout);
  const j = JSON.parse(fs.readFileSync(ctx.out, 'utf8'));
  assert.strictEqual(j.conclusion.refused, true);
  assert.strictEqual(j.conclusion.reason, 'zero_arm_has_hook_lines');
  assert.strictEqual(j.conclusion.verdict, null);
}));

test('NEGATIVE CONTROL: positive control not measurable -> refuses to conclude', () => withCtx((ctx) => {
  const r = run(ctx, common(ctx), { STUB_SCENARIO: 'positive_blind' });
  assert.strictEqual(r.status, 4, r.stderr + r.stdout);
  const j = JSON.parse(fs.readFileSync(ctx.out, 'utf8'));
  assert.strictEqual(j.conclusion.refused, true);
  assert.strictEqual(j.conclusion.reason, 'positive_control_not_measured');
  assert.strictEqual(j.conclusion.verdict, null);
}));

test('instrument invalid when marker p95 < 180 ms (not a refusal of the data, a refusal of the verdict)', () => withCtx((ctx) => {
  // marker lines reported at ~100 ms: the instrument cannot see a 200 ms hook
  const r = run(ctx, common(ctx), { STUB_MARKER_SHORT: '1' });
  assert.strictEqual(r.status, 4, r.stderr + r.stdout);
  const j = JSON.parse(fs.readFileSync(ctx.out, 'utf8'));
  assert.strictEqual(j.conclusion.refused, true);
  assert.strictEqual(j.conclusion.reason, 'instrument_invalid_marker_p95_below_180');
}));

test('NEGATIVE CONTROL: --max-usd exceeded stops immediately, reports spend, no verdict', () => withCtx((ctx) => {
  const r = run(ctx, ['--samples', '10', '--max-usd', '0.05', '--out', ctx.out], { STUB_COST: '0.02' });
  assert.strictEqual(r.status, 3, r.stderr + r.stdout);
  const calls = fs.readFileSync(ctx.log, 'utf8').trim().split('\n');
  assert.ok(calls.length <= 3, 'stopped after budget reached, ran ' + calls.length);
  const j = JSON.parse(fs.readFileSync(ctx.out, 'utf8'));
  assert.strictEqual(j.stopped, 'max_usd');
  assert.ok(j.spent_usd >= 0.05 && j.spent_usd <= 0.07, String(j.spent_usd));
  assert.strictEqual(j.conclusion.refused, true);
  assert.match(r.stderr, /max-usd/);
}));

test('--dry-run prints plan and estimate, spawns nothing, writes nothing', () => withCtx((ctx) => {
  const r = run(ctx, ['--samples', '30', '--max-usd', '1', '--out', ctx.out, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /90 runs/);
  assert.match(r.stdout, /estimated/i);
  assert.ok(!fs.existsSync(ctx.log));
  assert.ok(!fs.existsSync(ctx.out));
}));

test('--max-usd is required', () => withCtx((ctx) => {
  const r = run(ctx, ['--samples', '2', '--out', ctx.out]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /--max-usd/);
}));

test('verdict opens the guard-port plan only when per-call p95 >= 150 ms AND >= 5 spawns per call', () => {
  const { conclude } = require(BIN);
  const mk = (ms, n, calls) => Array.from({ length: calls }, () => Array.from({ length: n }, () => ({ event: 'PostToolUse', command: 'x', status: 0, ms })));
  const marker = Array.from({ length: 5 }, () => [{ event: 'PostToolUse', command: 'sleep 0.2', status: 0, ms: 215 }]);
  assert.strictEqual(conclude({ enabled: mk(160, 5, 10), positive_control: marker, zero: [[]] }, false).verdict, 'open_guard_port_plan');
  assert.strictEqual(conclude({ enabled: mk(160, 4, 10), positive_control: marker, zero: [[]] }, false).verdict, 'no_move');
  assert.strictEqual(conclude({ enabled: mk(140, 5, 10), positive_control: marker, zero: [[]] }, false).verdict, 'no_move');
});

test('NEGATIVE CONTROL: child dies without parseable JSON -> its --max-budget-usd cap is charged, stop-loss still fires', () => withCtx((ctx) => {
  // RED at 182b743fc: cost was recorded as 0, spent stayed 0 and all 30 runs executed (exit 4, stopped null).
  const r = run(ctx, ['--samples', '10', '--max-usd', '0.6', '--out', ctx.out], { STUB_SCENARIO: 'crash_no_json' });
  assert.strictEqual(r.status, 3, r.stderr + r.stdout);
  const calls = fs.readFileSync(ctx.log, 'utf8').trim().split('\n');
  assert.strictEqual(calls.length, 2, 'cap 0.5 then remaining 0.1 reaches 0.6');
  const j = JSON.parse(fs.readFileSync(ctx.out, 'utf8'));
  assert.strictEqual(j.stopped, 'max_usd');
  assert.strictEqual(j.spent_usd, 0.6);
  assert.strictEqual(j.cost_unknown, 2);
}));

test('cost_unknown is 0 when every run reports total_cost_usd', () => withCtx((ctx) => {
  const r = run(ctx, ['--samples', '1', '--max-usd', '5', '--out', ctx.out]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(ctx.out, 'utf8')).cost_unknown, 0);
}));

for (const raw of ['null', '""', '"0.01"', '-1', '"abc"']) {
  test(`NEGATIVE CONTROL: total_cost_usd=${raw} is not a known cost -> cap charged, stop-loss fires`, () => withCtx((ctx) => {
    // RED at 617f267de: Number(null)/Number("") === 0 counted as a known cost, spent stayed 0, all runs executed.
    const r = run(ctx, ['--samples', '10', '--max-usd', '0.6', '--out', ctx.out], { STUB_COST_RAW: raw });
    assert.strictEqual(r.status, 3, r.stderr + r.stdout);
    const j = JSON.parse(fs.readFileSync(ctx.out, 'utf8'));
    assert.strictEqual(j.stopped, 'max_usd');
    assert.strictEqual(j.cost_unknown, 2);
    assert.strictEqual(j.spent_usd, 0.6);
  }));
}
test('total_cost_usd = 0 (a real number) is a known cost', () => withCtx((ctx) => {
  const r = run(ctx, ['--samples', '1', '--max-usd', '5', '--out', ctx.out], { STUB_COST_RAW: '0' });
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(fs.readFileSync(ctx.out, 'utf8'));
  assert.strictEqual(j.cost_unknown, 0);
  assert.strictEqual(j.spent_usd, 0);
}));
