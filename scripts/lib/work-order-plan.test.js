'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, parseSizeTag, isMPlus } = require('./work-order-plan.js');

test('parse: handles empty, null, and non-string inputs', () => {
  assert.deepEqual(parse(''), { size: null, plan: null });
  assert.deepEqual(parse(null), { size: null, plan: null });
  assert.deepEqual(parse(undefined), { size: null, plan: null });
  assert.deepEqual(parse(123), { size: null, plan: null });
});

test('parse: extracts Size from plain, bullet, bold, line-1 brief header, and line-1 SizeTag', () => {
  assert.equal(parse('Size: M').size, 'M');
  assert.equal(parse('- **Size**: L').size, 'L');
  assert.equal(parse('* **Size:** XL').size, 'XL');
  assert.equal(parse('  - Size: XS').size, 'XS');
  assert.equal(parse('Engine: gemini | Size: S | Lane: autopilot').size, 'S');
  assert.equal(parse('| Size: M |').size, 'M');
  assert.equal(parse('[M] Implement work-order-adopt\nPlan: plan-first').size, 'M');
  assert.equal(parse('[bug S] Fix parser edge case').size, 'S');
  assert.equal(parse('[!L] Urgent incident fix').size, 'L');
  assert.equal(parse('Line 1\n| Size: M |').size, null);
});

test('parse: detects conflicting Size field lines and SizeTags and ignores prose', () => {
  assert.equal(parse('Size: S\n- **Size**: M').size, 'conflict');
  assert.equal(parse('Size: M | Size: L |').size, 'conflict');
  assert.equal(parse('[S] Small title\nSize: M').size, 'conflict');
  assert.equal(parse('[S] [M] Two tags').size, 'conflict');
  assert.equal(parse('Size: M\nSize: M').size, 'M');
  assert.equal(parse('[M] Matching title\nSize: M').size, 'M');
  assert.equal(parse('The Size: M is in prose\nSize: S').size, 'S');
});

test('parseSizeTag: parses size, bug, urgent and ignores non-size brackets', () => {
  assert.deepEqual(parseSizeTag(''), { size: null, bug: false, urgent: false });
  assert.deepEqual(parseSizeTag('No bracket tag here'), { size: null, bug: false, urgent: false });
  assert.deepEqual(parseSizeTag('[no-task: triage] Something'), { size: null, bug: false, urgent: false });
  assert.deepEqual(parseSizeTag('[stage:build/implement] note'), { size: null, bug: false, urgent: false });
  assert.deepEqual(parseSizeTag('[S] Quick cleanup'), { size: 'S', bug: false, urgent: false });
  assert.deepEqual(parseSizeTag('[M] Adopt fleet task\nPlan: plan-first'), { size: 'M', bug: false, urgent: false });
  assert.deepEqual(parseSizeTag('[bug S] Fix null deref'), { size: 'S', bug: true, urgent: false });
  assert.deepEqual(parseSizeTag('[!L] Restore prod'), { size: 'L', bug: false, urgent: true });
  assert.deepEqual(parseSizeTag('[L!] Restore prod'), { size: 'L', bug: false, urgent: true });
  assert.deepEqual(parseSizeTag('[bug !M] Urgent bugfix'), { size: 'M', bug: true, urgent: true });
  assert.deepEqual(parseSizeTag('[!bug M] Urgent bugfix'), { size: 'M', bug: true, urgent: true });
  assert.deepEqual(parseSizeTag('[S] [L] Conflicting tags'), { size: 'conflict', bug: false, urgent: false });
  assert.deepEqual(parseSizeTag('First line without tag\n[M] Second line tag ignored'), {
    size: null,
    bug: false,
    urgent: false,
  });
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

test('parse: supports legacy .md@sha, plan loop/plan-loop, and [plan-exempt: reason]', () => {
  assert.deepEqual(
    parse('Size: M\n見 knowledge/plans/2026-11-25-fleet-routing-mechanization.md@64d739bf5a34').plan,
    { path: 'knowledge/plans/2026-11-25-fleet-routing-mechanization.md', sha: '64d739bf5a34', legacy: true },
  );
  assert.equal(parse('Size: M\n見 docs/plans/a.md@abc123').plan, null);
  assert.equal(parse('Size: M\nPlan: x/y.md@abcdef1\n見 other.md@1234567').plan.legacy, undefined);

  assert.equal(parse('Size: L\n跑 plan loop').plan, 'plan-first');
  assert.equal(parse('Size: L\n跑 PLAN-LOOP').plan, 'plan-first');
  assert.equal(parse('Size: L\n只有 plan 一個字').plan, null);
  assert.equal(parse('Size: L\nplanloop').plan, null);

  assert.deepEqual(parse('Size: M\n[plan-exempt: 純文件錯字修正]').plan, { exempt: '純文件錯字修正' });
  assert.equal(parse('Size: M\n[plan-exempt: ]').plan, null);
  assert.equal(parse('Size: M\n[plan-exempt:]').plan, null);
});
