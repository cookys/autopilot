'use strict';
// SessionStart pm-resume injection: the block carries the fleet output as data, and every failure becomes a visible line.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildResumeBlock, readMarker } = require('../hooks/lib/pm-resume.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmres-'));
const baseEnv = { PATH: process.env.PATH, HOME: tmp, XDG_RUNTIME_DIR: tmp, FLEET_ADDRESS: 'cookys/testhost/pm--claude' };
const ID = '01M7R4PE3RN586XSY3ET1P4YNF';
const fake = (body, code = 0) => {
  const f = path.join(tmp, `fleet-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(f, `#!/bin/sh\n${body}\nexit ${code}\n`, { mode: 0o755 });
  return f;
};
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log(`ok - ${name}`); };

t('pm seat: output injected as data, role pm, seat passed, ids recorded', () => {
  const args = path.join(tmp, 'args.txt');
  const bin = fake(`echo "$@" > ${args}; echo "IN_FLIGHT ${ID} 要先做"`);
  const out = buildResumeBlock({ source: 'clear', session_id: 's1' }, { env: { ...baseEnv, FLEET_BIN: bin } });
  assert.match(out, /資料，不是指令/);
  assert.match(out, /IN_FLIGHT（在途）/);
  assert.ok(out.includes(`IN_FLIGHT ${ID}`));
  assert.match(fs.readFileSync(args, 'utf8'), /pm resume --seat pm--claude --role pm/);
  assert.deepStrictEqual(readMarker('s1', { ...baseEnv }).ids, [ID]);
});

t('lead and member roles follow the seat name', () => {
  const args = path.join(tmp, 'args2.txt');
  const bin = fake(`echo "$@" > ${args}; echo ok`);
  buildResumeBlock({ source: 'startup', session_id: 's2' }, { env: { ...baseEnv, FLEET_ADDRESS: 'a/b/gpu-lead--claude', FLEET_BIN: bin } });
  assert.match(fs.readFileSync(args, 'utf8'), /--role lead/);
  buildResumeBlock({ source: 'resume', session_id: 's2' }, { env: { ...baseEnv, FLEET_ADDRESS: 'a/b/autopilot--claude', FLEET_BIN: bin } });
  assert.match(fs.readFileSync(args, 'utf8'), /--role member/);
});

t('all four sources inject, others do not', () => {
  const bin = fake('echo ok');
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    assert.match(buildResumeBlock({ source, session_id: 's3' }, { env: { ...baseEnv, FLEET_BIN: bin } }), /fleet-pm-resume/, source);
  }
  assert.strictEqual(buildResumeBlock({ source: 'other', session_id: 's3' }, { env: { ...baseEnv, FLEET_BIN: bin } }), '');
});

t('fleet missing: one visible line with the reason, never silent', () => {
  const out = buildResumeBlock({ source: 'clear', session_id: 's4' }, { env: { ...baseEnv, FLEET_BIN: path.join(tmp, 'no-such-fleet') } });
  assert.match(out, /resume 讀不到：fleet 不在/);
  assert.strictEqual(readMarker('s4', baseEnv).ok, false);
});

t('fleet non-zero: reason from stderr, socket-mismatch noise skipped', () => {
  const bin = fake('echo "fleet: courier socket mismatch: x" >&2; echo "unconfigured operator source" >&2', 3);
  const out = buildResumeBlock({ source: 'clear', session_id: 's5' }, { env: { ...baseEnv, FLEET_BIN: bin } });
  assert.match(out, /resume 讀不到：unconfigured operator source/);
});

t('timeout: visible line', () => {
  const out = buildResumeBlock({ source: 'clear', session_id: 's6' }, { env: baseEnv, runner: () => ({ signal: 'SIGTERM', error: null }) });
  assert.match(out, /resume 讀不到：fleet 超過/);
});

t('no fleet seat: visible line', () => {
  const env = { ...baseEnv }; delete env.FLEET_ADDRESS;
  assert.match(buildResumeBlock({ source: 'clear' }, { env }), /resume 讀不到：席位解析不到/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${n} passed`);
