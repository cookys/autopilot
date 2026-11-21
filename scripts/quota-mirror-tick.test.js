'use strict';

// quota-mirror-tick.js — one failure must not stop the later steps, and the process
// exits non-zero only when every producer failed. There is no post-step check script.
// Children are stubs in QUOTA_MIRROR_BIN. The child sentinel must never appear in the tick's own output.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TICK = path.join(__dirname, 'quota-mirror-tick.js');
const SENTINEL = 'QUOTA-MIRROR-CHILD-OUTPUT';
const IDS = [
  'usage-probe',
  'sync-statusline',
  'sync-provider-minimax',
  'sync-provider-glm',
];

function writeStub(dir, id, code, log, stderrText) {
  const file = path.join(dir, id);
  let errPart = '';
  if (stderrText != null) {
    const errFile = `${file}.err`;
    fs.writeFileSync(errFile, stderrText.endsWith('\n') ? stderrText : `${stderrText}\n`);
    errPart = `cat '${errFile}' >&2\n`;
  }
  const body = `#!/bin/sh
printf '%s' '${id}' >> '${log}'
if [ "$#" -gt 0 ]; then printf ' %s' "$@" >> '${log}'; fi
printf '\\n' >> '${log}'
echo ${SENTINEL}
${errPart}exit ${code}
`;
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function fixture(codes, stderrById) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-mirror-tick-'));
  const bin = path.join(root, 'bin');
  const live = path.join(root, 'live');
  const log = path.join(root, 'log');
  fs.mkdirSync(bin);
  fs.mkdirSync(live, { mode: 0o700 });
  for (const id of IDS) writeStub(bin, id, codes[id], log, stderrById && stderrById[id]);
  return { root, bin, live, log };
}

function runTick(codes, stderrById, keep) {
  const fx = fixture(codes, stderrById);
  const r = spawnSync(process.execPath, [TICK], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: fx.root,
      AUTOPILOT_ACCOUNTS_DIR: path.join(fx.root, "accounts"),
      TMPDIR: fx.root,
      AUTOPILOT_LIVE_DIR: fx.live,
      QUOTA_MIRROR_BIN: fx.bin,
    },
  });
  const lines = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8').split('\n').filter((l) => l !== '') : [];
  if (!keep) fs.rmSync(fx.root, { recursive: true, force: true });
  return { r, lines, live: fx.live, root: fx.root };
}

function all(code) {
  const codes = {};
  for (const id of IDS) codes[id] = code;
  return codes;
}

test('a pass whose producers write nothing still writes tick-last.json', () => {
  const { r, root, live } = runTick(all(0), null, true);
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const file = path.join(live, 'quota', 'tick-last.json');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(j.schema, 'autopilot.quota-mirror-tick/1');
    assert.strictEqual(j.ok, 4);
    assert.strictEqual(j.total, 4);
    assert.deepStrictEqual(j.skipped, []);
    assert.strictEqual(typeof j.ts, 'number');
    const names = fs.readdirSync(path.join(live, 'quota'));
    assert.deepStrictEqual(names.filter((n) => n !== 'tick-last.json' && !n.startsWith('.tick-last.')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('all steps ok: exit 0, every stub ran, child output is not relayed', () => {
  const { r, lines, live } = runTick(all(0));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines, [
    'usage-probe --due',
    'sync-statusline',
    'sync-provider-minimax --provider minimax',
    'sync-provider-glm --provider glm',
  ]);
  assert.match(r.stdout, /quota-mirror-tick: 4\/4 ok/);
  assert.ok(!r.stdout.includes(SENTINEL));
  assert.ok(!r.stderr.includes(SENTINEL));
  assert.ok(!r.stdout.includes(live));
  assert.ok(!r.stderr.includes(live));
});

test('one step fails: the others still run and the tick exits 0', () => {
  const codes = all(0);
  codes['sync-statusline'] = 1;
  const { r, lines } = runTick(codes);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: sync-statusline fail exit=1/);
  assert.match(r.stdout, /quota-mirror-tick: 3\/4 ok/);
});

test('every step fails: exit non-zero after all of them ran', () => {
  const { r, lines } = runTick(all(1));
  assert.notStrictEqual(r.status, 0);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: 0\/4 ok/);
});

test('every non-skipped producer fails writes no tick-last.json and leaves an old one', () => {
  const fresh = runTick(all(1), null, true);
  try {
    assert.notStrictEqual(fresh.r.status, 0);
    assert.strictEqual(fs.existsSync(path.join(fresh.live, 'quota', 'tick-last.json')), false);
  } finally {
    fs.rmSync(fresh.root, { recursive: true, force: true });
  }

  const fx = fixture(all(1));
  const dir = path.join(fx.live, 'quota');
  fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, 'tick-last.json');
  const prior = '{"schema":"autopilot.quota-mirror-tick/1","ts":1,"ok":4,"total":4,"skipped":[]}\n';
  fs.writeFileSync(file, prior, { mode: 0o600 });
  const r = spawnSync(process.execPath, [TICK], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: fx.root,
      AUTOPILOT_ACCOUNTS_DIR: path.join(fx.root, 'accounts'),
      TMPDIR: fx.root,
      AUTOPILOT_LIVE_DIR: fx.live,
      QUOTA_MIRROR_BIN: fx.bin,
    },
  });
  try {
    assert.notStrictEqual(r.status, 0);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), prior);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('exit 1 with token_missing is a skip, not a failure', () => {
  const codes = all(0);
  codes['sync-provider-minimax'] = 1;
  const { r, lines } = runTick(codes, { 'sync-provider-minimax': 'token_missing\n' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: sync-provider-minimax skip token_missing/);
  assert.ok(!r.stdout.includes('sync-provider-minimax fail'));
  assert.ok(!r.stdout.includes('nothing_applicable'));
});

test('every step skip prints nothing_applicable and exits 0', () => {
  const codes = all(1);
  codes['sync-statusline'] = 2;
  codes['sync-provider-glm'] = 2;
  const { r, lines } = runTick(codes, {
    'usage-probe': 'token_missing',
    'sync-statusline': 'mode_off',
    'sync-provider-minimax': 'token_missing',
    'sync-provider-glm': 'registry_not_configured',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: nothing_applicable\n?$/);
  assert.ok(!r.stdout.includes(' fail '));
});

test('one skip and one real fail exits 1 without nothing_applicable', () => {
  const codes = all(0);
  codes['usage-probe'] = 1;
  codes['sync-statusline'] = 1;
  const { r } = runTickArgs(codes, ['--steps', 'usage-probe,sync-statusline'], {
    'usage-probe': 'token_missing',
    'sync-statusline': 'boom',
  });
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /quota-mirror-tick: usage-probe skip token_missing/);
  assert.match(r.stdout, /quota-mirror-tick: sync-statusline fail /);
  assert.ok(!r.stdout.includes('nothing_applicable'));
});

test('exit 2 with registry_not_configured is a skip, not a failure', () => {
  const codes = all(0);
  codes['usage-probe'] = 2;
  const { r, lines } = runTick(codes, { 'usage-probe': 'noise\nregistry_not_configured\n' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: usage-probe skip registry_not_configured/);
  assert.ok(!r.stdout.includes('usage-probe fail'));
  assert.match(r.stdout, /quota-mirror-tick: 3\/3 ok/);
  const probeLines = r.stdout.split('\n').filter((l) => l.includes('usage-probe'));
  assert.deepStrictEqual(probeLines, ['quota-mirror-tick: usage-probe skip registry_not_configured']);
});

test('failure reason is the last stderr line, filtered and capped at 120', () => {
  const codes = all(0);
  codes['sync-statusline'] = 1;
  const raw = `ignored earlier\nKEEP_ME mode=1 (a/b) ${'!@#<>'.repeat(5)}${'A'.repeat(200)}\n`;
  const { r } = runTick(codes, { 'sync-statusline': raw });
  assert.strictEqual(r.status, 0, r.stderr);
  const line = r.stdout.split('\n').find((l) => l.includes('sync-statusline'));
  assert.ok(line, r.stdout);
  const prefix = 'quota-mirror-tick: sync-statusline fail exit=1 reason=';
  assert.ok(line.startsWith(prefix), line);
  const reason = line.slice(prefix.length);
  assert.strictEqual(reason.length, 120);
  assert.match(reason, /^KEEP_ME mode=1 \(a\/b\) A+$/);
  assert.ok(!reason.includes('!'));
  assert.ok(!reason.includes('<'));
  assert.ok(!line.includes('ignored earlier'));
  const statusLines = r.stdout.split('\n').filter((l) => l.includes('sync-statusline'));
  assert.strictEqual(statusLines.length, 1);
});

test('step list is the four producers and a missing check script is not spawned', () => {
  const { r, lines } = runTick(all(0));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.ok(!r.stdout.includes('fail missing'), r.stdout);
  assert.ok(!r.stdout.includes('fail exit=127'), r.stdout);
  assert.ok(!r.stdout.includes('smoke'), r.stdout);
});

function runTickArgs(codes, args, stderrById) {
  const fx = fixture(codes, stderrById);
  const r = spawnSync(process.execPath, [TICK, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: fx.root,
      AUTOPILOT_ACCOUNTS_DIR: path.join(fx.root, "accounts"),
      TMPDIR: fx.root,
      AUTOPILOT_LIVE_DIR: fx.live,
      QUOTA_MIRROR_BIN: fx.bin,
    },
  });
  const lines = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8').split('\n').filter((l) => l !== '') : [];
  const live = fx.live;
  fs.rmSync(fx.root, { recursive: true, force: true });
  return { r, lines, live };
}

test('--steps runs only the named steps, in canonical order', () => {
  const { r, lines } = runTickArgs(all(0), ['--steps', 'sync-provider-glm,sync-provider-minimax']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines, [
    'sync-provider-minimax --provider minimax',
    'sync-provider-glm --provider glm',
  ]);
  assert.match(r.stdout, /quota-mirror-tick: 2\/2 ok/);
  assert.ok(!r.stdout.includes('usage-probe'));
  assert.ok(!r.stdout.includes('smoke'));
});

test('--steps unknown id exits 2 and runs nothing', () => {
  const { r, lines } = runTickArgs(all(0), ['--steps', 'sync-provider-minimax,not-a-step']);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /unknown step not-a-step/);
  assert.deepStrictEqual(lines, []);
});

test('--out-dir refuses a world-writable directory and runs nothing', () => {
  const fx = fixture(all(0));
  fs.chmodSync(fx.live, 0o777);
  const r = spawnSync(process.execPath, [TICK, '--out-dir', fx.live, '--steps', 'sync-provider-minimax'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: fx.root,
      AUTOPILOT_ACCOUNTS_DIR: path.join(fx.root, "accounts"),
      TMPDIR: fx.root,
      AUTOPILOT_LIVE_DIR: fx.live,
      QUOTA_MIRROR_BIN: fx.bin,
    },
  });
  const lines = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8').split('\n').filter((l) => l !== '') : [];
  fs.rmSync(fx.root, { recursive: true, force: true });
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /out_dir_refused:world_writable/);
  assert.deepStrictEqual(lines, []);
});

test('--out-dir is passed to provider steps', () => {
  const fx = fixture(all(0));
  fs.chmodSync(fx.live, 0o750);
  const r = spawnSync(process.execPath, [TICK, '--steps', 'sync-provider-minimax', '--out-dir', fx.live], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: fx.root,
      AUTOPILOT_ACCOUNTS_DIR: path.join(fx.root, "accounts"),
      TMPDIR: fx.root,
      AUTOPILOT_LIVE_DIR: path.join(fx.root, 'other-live'),
      QUOTA_MIRROR_BIN: fx.bin,
    },
  });
  const lines = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8').split('\n').filter((l) => l !== '') : [];
  fs.rmSync(fx.root, { recursive: true, force: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines, [
    `sync-provider-minimax --provider minimax --out-dir ${fx.live}`,
  ]);
});

const tick = require('./quota-mirror-tick.js');
const audit = require('./lib/account-audit');
const observation = require('./lib/account-observation');

const IDLE_NOW_S = 1_800_000_000;
const IDLE_NOW_MS = IDLE_NOW_S * 1000;

function idleWin(kind, resetsAt) {
  return {
    kind, utilization: 0.2, resets_at: resetsAt === undefined ? IDLE_NOW_S + 3600 : resetsAt,
    source: 'probe', observed_at: IDLE_NOW_S - 60,
  };
}

function writeClaude(live, alias, windows) {
  const record = {
    schema: observation.SCHEMA, provider: 'claude', alias, visibility: 'L3', windows,
    refusal: null, token_state: 'unknown', token_state_at: null,
  };
  const view = {
    schema: observation.VIEW_SCHEMA, namespace: null, hub_offset: 0,
    rows: [{ writer_courier: 'local', host_role: 'agent', observed_at_hub: null, skewed: false, record }],
  };
  const dir = path.join(live, 'quota', 'claude');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(live, 'quota'), 0o700);
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(path.join(dir, `${alias}.json`), `${JSON.stringify(view)}\n`, { mode: 0o600 });
}

function idleWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-alias-'));
  const live = path.join(root, 'live');
  const home = path.join(root, 'home');
  fs.mkdirSync(live, { mode: 0o700 });
  fs.mkdirSync(home, { recursive: true });
  const auditFile = path.join(root, 'accounts-audit.jsonl');
  return {
    root, live, home, auditFile,
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

function runIdle(w) {
  return tick.appendIdleAliases({
    liveDir: w.live, auditFile: w.auditFile, nowMs: IDLE_NOW_MS, env: {}, home: w.home,
  });
}

function idleLines(w) {
  const file = path.join(w.live, 'quota', 'idle-alias.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
}

function plantAudit(w, alias, ageMs) {
  audit.appendAudit(
    { alias, purpose: 'run', attempt: 1, outcome: 'ok' },
    { path: w.auditFile, now: IDLE_NOW_MS - ageMs },
  );
}

test('idle: absent with no recent audit writes one line, and a second run does not duplicate', () => {
  const w = idleWorld();
  try {
    writeClaude(w.live, 'a', [idleWin('weekly')]);
    const first = runIdle(w);
    assert.deepStrictEqual(first.appended, [{ alias: 'a', observed_at: IDLE_NOW_S, five_hour: 'absent' }]);
    const file = path.join(w.live, 'quota', 'idle-alias.jsonl');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"alias":"a","observed_at":1800000000,"five_hour":"absent"}\n');
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    const second = runIdle(w);
    assert.deepStrictEqual(second.appended, []);
    assert.strictEqual(idleLines(w).length, 1);
  } finally { w.cleanup(); }
});

test('idle: an audit attempt inside 5.5 h suppresses the line; one older than 5.5 h does not', () => {
  const recent = idleWorld();
  try {
    writeClaude(recent.live, 'a', [idleWin('weekly')]);
    plantAudit(recent, 'a', 3600 * 1000);
    assert.deepStrictEqual(runIdle(recent).appended, []);
    assert.deepStrictEqual(idleLines(recent), []);
  } finally { recent.cleanup(); }

  const old = idleWorld();
  try {
    writeClaude(old.live, 'a', [idleWin('weekly')]);
    plantAudit(old, 'a', 6 * 3600 * 1000);
    assert.deepStrictEqual(runIdle(old).appended, [{ alias: 'a', observed_at: IDLE_NOW_S, five_hour: 'absent' }]);
  } finally { old.cleanup(); }
});

test('idle: a past resets_at writes reset; a future or null resets_at writes nothing', () => {
  const past = idleWorld();
  try {
    writeClaude(past.live, 'a', [idleWin('rolling_5h', IDLE_NOW_S - 10)]);
    assert.deepStrictEqual(runIdle(past).appended, [{ alias: 'a', observed_at: IDLE_NOW_S, five_hour: 'reset' }]);
  } finally { past.cleanup(); }

  const future = idleWorld();
  try {
    writeClaude(future.live, 'a', [idleWin('rolling_5h', IDLE_NOW_S + 3600)]);
    assert.deepStrictEqual(runIdle(future).appended, []);
    assert.deepStrictEqual(idleLines(future), []);
  } finally { future.cleanup(); }

  const unset = idleWorld();
  try {
    writeClaude(unset.live, 'a', [idleWin('rolling_5h', null)]);
    assert.deepStrictEqual(runIdle(unset).appended, []);
  } finally { unset.cleanup(); }
});

function runAt(w, nowS) {
  return tick.appendIdleAliases({
    liveDir: w.live, auditFile: w.auditFile, nowMs: nowS * 1000, env: {}, home: w.home,
  });
}

test('idle: idle then active then the same label after activity appends again', () => {
  const w = idleWorld();
  try {
    const t0 = IDLE_NOW_S;
    const activeResets = t0 + 3600;
    writeClaude(w.live, 'a', [idleWin('rolling_5h', t0 - 10)]);
    writeClaude(w.live, 'b', [idleWin('weekly')]);
    const first = runAt(w, t0);
    const byAlias = (rows) => Object.fromEntries(rows.map((r) => [r.alias, r]));
    const f = byAlias(first.appended);
    assert.deepStrictEqual(f.a, { alias: 'a', observed_at: t0, five_hour: 'reset' });
    assert.deepStrictEqual(f.b, { alias: 'b', observed_at: t0, five_hour: 'absent' });
    assert.deepStrictEqual(runAt(w, t0).appended, [], 'same label with no later activity does not append');

    writeClaude(w.live, 'a', [idleWin('rolling_5h', activeResets)]);
    writeClaude(w.live, 'b', [idleWin('rolling_5h', activeResets)]);
    audit.appendAudit(
      { alias: 'b', purpose: 'run', attempt: 1, outcome: 'ok' },
      { path: w.auditFile, now: (t0 + 30) * 1000 },
    );
    assert.deepStrictEqual(runAt(w, t0 + 60).appended, []);

    const t2 = t0 + 6 * 3600;
    writeClaude(w.live, 'a', [idleWin('rolling_5h', activeResets)]);
    writeClaude(w.live, 'b', [idleWin('weekly')]);
    const again = byAlias(runAt(w, t2).appended);
    assert.deepStrictEqual(again.a, { alias: 'a', observed_at: t2, five_hour: 'reset' });
    assert.deepStrictEqual(again.b, { alias: 'b', observed_at: t2, five_hour: 'absent' });
  } finally { w.cleanup(); }
});

test('idle: absent then reset appends a second line', () => {
  const w = idleWorld();
  try {
    writeClaude(w.live, 'a', [idleWin('weekly')]);
    runIdle(w);
    writeClaude(w.live, 'a', [idleWin('rolling_5h', IDLE_NOW_S - 10)]);
    const second = runIdle(w);
    assert.deepStrictEqual(second.appended, [{ alias: 'a', observed_at: IDLE_NOW_S, five_hour: 'reset' }]);
    assert.deepStrictEqual(idleLines(w), [
      '{"alias":"a","observed_at":1800000000,"five_hour":"absent"}',
      '{"alias":"a","observed_at":1800000000,"five_hour":"reset"}',
    ]);
  } finally { w.cleanup(); }
});

test('one producer ok: exit 0', () => {
  const codes = all(1);
  codes['usage-probe'] = 0;
  const { r, lines } = runTick(codes);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: usage-probe ok/);
  assert.match(r.stdout, /quota-mirror-tick: 1\/4 ok/);
  assert.ok(!r.stdout.includes('fail missing'), r.stdout);
  assert.ok(!r.stdout.includes('smoke'), r.stdout);
});
