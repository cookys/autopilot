'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, isMPlus } = require('./work-order-plan.js');

test('parse: handles empty, null, and non-string inputs', () => {
  assert.deepEqual(parse(''), { size: null, plan: null });
  assert.deepEqual(parse(null), { size: null, plan: null });
  assert.deepEqual(parse(undefined), { size: null, plan: null });
  assert.deepEqual(parse(123), { size: null, plan: null });
});

test('parse: extracts Size from plain, bullet, bold, and line-1 brief header', () => {
  assert.equal(parse('Size: M').size, 'M');
  assert.equal(parse('- **Size**: L').size, 'L');
  assert.equal(parse('* **Size:** XL').size, 'XL');
  assert.equal(parse('  - Size: XS').size, 'XS');
  assert.equal(parse('Engine: gemini | Size: S | Lane: autopilot').size, 'S');
  assert.equal(parse('| Size: M |').size, 'M');
  assert.equal(parse('Line 1\n| Size: M |').size, null);
});

test('parse: detects conflicting Size field lines and ignores prose', () => {
  assert.equal(parse('Size: S\n- **Size**: M').size, 'conflict');
  assert.equal(parse('Size: M | Size: L |').size, 'conflict');
  assert.equal(parse('Size: M\nSize: M').size, 'M');
  assert.equal(parse('The Size: M is in prose\nSize: S').size, 'S');
});

test('parse: extracts Plan markers and ignores prose plan-first', () => {
  assert.deepEqual(
    parse('Size: M\nPlan: docs/plans/x.md@abc1234').plan,
    { path: 'docs/plans/x.md', sha: 'abc1234' },
  );
  assert.deepEqual(
    parse('- **Size**: L\n- **Plan**: project/plans/2026-11-17-a.md@0123456789abcdef0123456789abcdef01234567').plan,
    { path: 'project/plans/2026-11-17-a.md', sha: '0123456789abcdef0123456789abcdef01234567' },
  );
  assert.equal(parse('Size: M\nPlan: plan-first').plan, 'plan-first');
  assert.equal(parse('Size: M\n- **Plan**: plan-first').plan, 'plan-first');
  assert.equal(parse('Size: M\nplan-first').plan, 'plan-first');
  assert.equal(parse('Size: M\nwe follow plan-first in this lane').plan, null);
  assert.equal(parse('Size: M\nPlan: docs/plans/x.md@123').plan, null);
  assert.equal(parse('Size: M\nPlan: docs/plans/x.md@zzzzzzz').plan, null);
});

test('isMPlus: identifies M, L, XL only', () => {
  assert.equal(isMPlus('XS'), false);
  assert.equal(isMPlus('S'), false);
  assert.equal(isMPlus('M'), true);
  assert.equal(isMPlus('L'), true);
  assert.equal(isMPlus('XL'), true);
  assert.equal(isMPlus('conflict'), false);
  assert.equal(isMPlus(null), false);
});
