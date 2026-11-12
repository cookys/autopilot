'use strict';

// quota-mirror-tick.js — one failure must not stop the later steps, and the process
// exits non-zero only when every producer failed. The smoke check still runs and
// prints its own line; it does not count toward that exit. Children are stubs in
// QUOTA_MIRROR_BIN. The child sentinel must never appear in the tick's own output.

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
  'smoke',
];

function writeStub(dir, id, code, log) {
  const file = path.join(dir, id);
  const body = `#!/bin/sh
printf '%s' '${id}' >> '${log}'
if [ "$#" -gt 0 ]; then printf ' %s' "$@" >> '${log}'; fi
printf '\\n' >> '${log}'
echo ${SENTINEL}
echo ${SENTINEL} >&2
exit ${code}
`;
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function fixture(codes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-mirror-tick-'));
  const bin = path.join(root, 'bin');
  const live = path.join(root, 'live');
  const log = path.join(root, 'log');
  fs.mkdirSync(bin);
  fs.mkdirSync(live, { mode: 0o700 });
  for (const id of IDS) writeStub(bin, id, codes[id], log);
  return { root, bin, live, log };
}

function runTick(codes) {
  const fx = fixture(codes);
  const r = spawnSync(process.execPath, [TICK], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: fx.root,
      TMPDIR: fx.root,
      AUTOPILOT_LIVE_DIR: fx.live,
      QUOTA_MIRROR_BIN: fx.bin,
    },
  });
  const lines = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8').split('\n').filter((l) => l !== '') : [];
  fs.rmSync(fx.root, { recursive: true, force: true });
  return { r, lines, live: fx.live };
}

function all(code) {
  const codes = {};
  for (const id of IDS) codes[id] = code;
  return codes;
}

test('all steps ok: exit 0, every stub ran, child output is not relayed', () => {
  const { r, lines, live } = runTick(all(0));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines, [
    'usage-probe --due',
    'sync-statusline',
    'sync-provider-minimax --provider minimax',
    'sync-provider-glm --provider glm',
    `smoke ${live}`,
  ]);
  assert.match(r.stdout, /quota-mirror-tick: smoke ok/);
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
  assert.match(r.stdout, /quota-mirror-tick: smoke ok/);
  assert.match(r.stdout, /quota-mirror-tick: 3\/4 ok/);
});

test('every step fails: exit non-zero after all of them ran', () => {
  const { r, lines } = runTick(all(1));
  assert.notStrictEqual(r.status, 0);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: 0\/4 ok/);
});

test('all four producers fail and smoke passes: exit non-zero, smoke line still printed', () => {
  const codes = all(1);
  codes.smoke = 0;
  const { r, lines } = runTick(codes);
  assert.notStrictEqual(r.status, 0);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: usage-probe fail exit=1/);
  assert.match(r.stdout, /quota-mirror-tick: sync-statusline fail exit=1/);
  assert.match(r.stdout, /quota-mirror-tick: sync-provider-minimax fail exit=1/);
  assert.match(r.stdout, /quota-mirror-tick: sync-provider-glm fail exit=1/);
  assert.match(r.stdout, /quota-mirror-tick: smoke ok/);
  assert.match(r.stdout, /quota-mirror-tick: 0\/4 ok/);
});

test('one producer ok: exit 0', () => {
  const codes = all(1);
  codes['usage-probe'] = 0;
  const { r, lines } = runTick(codes);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(lines.map((l) => l.split(' ')[0]), IDS);
  assert.match(r.stdout, /quota-mirror-tick: usage-probe ok/);
  assert.match(r.stdout, /quota-mirror-tick: smoke fail exit=1/);
  assert.match(r.stdout, /quota-mirror-tick: 1\/4 ok/);
});
