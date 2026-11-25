'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findRows, stuckReason } = require('../operator-stuck-no-card');

const card = (id, state) => ({ card: { card_id: id }, state });
const task = (over) => ({ task_id: 'T1', state: 'waiting', assignee: 'ns/c/lane--claude', ...over });

test('stuck on the operator with no card id is listed', () => {
  const rows = findRows([task({ waiting_on: 'external:operator reviews mockup until X' })], []);
  assert.equal(rows.length, 1);
  assert.match(rows[0].missing, /抽不到/);
  assert.equal(rows[0].lane, 'lane--claude');
});

test('blocked_human and text signals count; unrelated waits do not', () => {
  assert.equal(findRows([task({ state: 'blocked_human' })], []).length, 1);
  assert.equal(findRows([task({ progress: '卡在這裡，要操作員動手' })], []).length, 1);
  assert.equal(findRows([task({ waiting_on: 'task:01ABC' })], []).length, 0);
});

test('a live card id removes the row; unknown or closed card ids keep it', () => {
  const t = (id) => task({ waiting_on: `external:operator handles card ${id}` });
  assert.equal(findRows([t('d-11111111')], [card('d-11111111', 'open')]).length, 0);
  assert.match(findRows([t('d-22222222')], []).at(0).missing, /查不到卡/);
  assert.match(findRows([t('d-33333333')], [card('d-33333333', 'answered')]).at(0).missing, /卡已結/);
});

test('finished tasks are ignored', () => {
  assert.equal(findRows([task({ state: 'done', waiting_on: 'external:operator x' })], []).length, 0);
  assert.equal(stuckReason(task({})), null);
});
