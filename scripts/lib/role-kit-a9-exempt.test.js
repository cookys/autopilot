'use strict';
// The A9 lint stays on for every kit except the byte-identical frozen pilot kits, and only when AUTOPILOT_ROLEKIT_A9_EXEMPT=1.
// Why: the 11-05 stamped pilot kits predate the A9 line (PM 01M894HX0M ruling B); a wider exemption would let any kit skip the rule.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check } = require('./role-kit.js');

const REPO = path.resolve(__dirname, '../..');
const frozen = path.join(REPO, 'evals/rolekit/kits/planner');

function stage(roleText) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-a9-'));
  fs.writeFileSync(path.join(d, 'role.md'), roleText);
  fs.writeFileSync(path.join(d, 'tools'), 'Read\n');
  return d;
}
function withKnob(v, fn) {
  const saved = process.env.AUTOPILOT_ROLEKIT_A9_EXEMPT;
  if (v === null) delete process.env.AUTOPILOT_ROLEKIT_A9_EXEMPT; else process.env.AUTOPILOT_ROLEKIT_A9_EXEMPT = v;
  try { return fn(); } finally { if (saved === undefined) delete process.env.AUTOPILOT_ROLEKIT_A9_EXEMPT; else process.env.AUTOPILOT_ROLEKIT_A9_EXEMPT = saved; }
}

const frozenRole = fs.readFileSync(path.join(frozen, 'role.md'));
const hasA9 = /^A9:/m.test(frozenRole.toString('utf8'));

test('frozen pilot role.md (a staged copy) passes with the knob, is refused without it', () => {
  assert.ok(!hasA9, 'precondition: the frozen planner kit has no A9 line');
  const d = stage(frozenRole);
  try {
    assert.doesNotThrow(() => withKnob('1', () => check(d)));
    assert.throws(() => withKnob(null, () => check(d)), /A9 rule line/);
    assert.throws(() => withKnob('0', () => check(d)), /A9 rule line/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('negative control: any other role.md without A9 is refused even with the knob', () => {
  for (const text of ['not a frozen role\n', Buffer.concat([frozenRole, Buffer.from('\nextra line\n')])]) {
    const d = stage(text);
    try { assert.throws(() => withKnob('1', () => check(d)), /A9 rule line/); } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
});

test('a kit that has the A9 line passes with and without the knob', () => {
  const d = stage('A9: example rule\nbody\n');
  try {
    assert.doesNotThrow(() => withKnob(null, () => check(d)));
    assert.doesNotThrow(() => withKnob('1', () => check(d)));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
