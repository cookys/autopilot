'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');

test('hooks/cost-fuse.js is retired and removed', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'hooks/cost-fuse.js')), false);
});

test('hooks/hooks.json does not reference cost-fuse', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'hooks/hooks.json'), 'utf8');
  assert.equal(raw.includes('cost-fuse'), false);
});

test('skills/handoff/SKILL.md states one-sentence positioning', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'skills/handoff/SKILL.md'), 'utf8');
  assert.equal(raw.includes('handoff 只帶對話殘留，工作狀態看 resume'), true);
});

test('skills/handoff/SKILL.md pending_rulings requires empty before clear', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'skills/handoff/SKILL.md'), 'utf8');
  assert.equal(raw.includes('清空前必須是空的'), true);
});
