'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decide, contextBytes } = require('./local-impl-slot');

function readyEnv(extra = {}) {
  return {
    ...process.env,
    AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: 'http://127.0.0.1:9/v1',
    AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN: 'fake-test-token',
    AUTOPILOT_CONFIG_FILE: path.join(os.tmpdir(), 'local-impl-slot-missing-config.json'),
    ...extra,
  };
}

test('scope header stops at the next pipe and counts absolute and dotdot names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-scope-'));
  const big = path.join(dir, 'big.bin');
  const dotted = path.join(dir, 'big..bin');
  const outside = path.join(dir, 'outside.bin');
  fs.writeFileSync(big, 'x'.repeat(50));
  fs.writeFileSync(dotted, 'y'.repeat(40));
  fs.writeFileSync(outside, 'z'.repeat(30));
  const prompt = path.join(dir, 'prompt.txt');
  fs.writeFileSync(prompt, `Scope: big.bin | Size: M\nScope: ${outside}, big..bin\n`);
  const n = contextBytes(prompt, dir);
  const promptBytes = fs.statSync(prompt).size;
  assert.equal(n, promptBytes + 50 + 40 + 30);
});

test('slot JSON must carry an integer free and a boolean draining', () => {
  const env = readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'printf %s \'{"free":1}\'' });
  const missing = decide({ env, promptFile: '', cwd: os.tmpdir() });
  assert.equal(missing.signalUnavailable, true);
  assert.equal(missing.reason, 'slot_signal_unavailable');
  const typed = decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'printf %s \'{"free":1,"draining":"true"}\'' }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(typed.signalUnavailable, true);
  assert.notEqual(typed.reason, 'no_free_slot');
});

test('a failing or malformed slot command is not a capacity report', () => {
  const failed = decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'echo nope; exit 1' }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(failed.reason, 'slot_signal_unavailable');
  assert.equal(failed.choose, false);
});

test('an empty AUTOPILOT_LOCAL_SLOTS_CMD selects the probe, not config.local_slots_cmd', () => {
  const cfg = path.join(os.tmpdir(), `slot-cfg-${process.pid}.json`);
  fs.writeFileSync(cfg, JSON.stringify({ local_slots_cmd: 'printf %s \'{"free":0,"draining":false}\'' }));
  const decided = decide({
    env: readyEnv({
      AUTOPILOT_CONFIG_FILE: cfg,
      AUTOPILOT_LOCAL_SLOTS_CMD: '',
      AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: 'http://127.0.0.1:9/v1',
    }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(decided.reason, 'slot_signal_unavailable');
  assert.notEqual(decided.detail, 'free_0');
  fs.unlinkSync(cfg);
});

test('a slot command that ignores SIGTERM still dies inside the deadline', { timeout: 8000 }, () => {
  const started = Date.now();
  const decided = decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: "trap '' TERM; sleep 30" }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  const elapsed = Date.now() - started;
  assert.equal(decided.reason, 'slot_signal_unavailable');
  assert.ok(elapsed < 7000, `elapsed ${elapsed}`);
});

test('free 0 and draining true stay capacity fallbacks', () => {
  const free0 = decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'printf %s \'{"free":0,"draining":false}\'' }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(free0.reason, 'no_free_slot');
  assert.equal(free0.signalUnavailable, undefined);
  const draining = decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'printf %s \'{"free":2,"draining":true}\'' }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(draining.reason, 'draining');
});
