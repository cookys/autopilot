/**
 * BL-0124, updated: T2 wording is keep-working for every session, whatever the
 * auto-compact window. Run: node --test hooks/context-budget-t2-autocompact.test.js
 * Negative control: the old "/clear" / STOP sentence is rejected by the same predicate.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { budgetDecision } = require(path.join(__dirname, 'context-budget-lib.js'));

const state = { contextTokens: 310000, calls: 9, lastT1Context: 0, lastT2Context: 0 };
const cfg = { t1: 100000, t2: 300000, step: 25000, inferredWindow: 1000000, windowSource: 'statusline' };

function assertKeepWorking(text) {
  assert.equal(typeof text, 'string');
  assert.doesNotMatch(text, /\/clear/);
  assert.doesNotMatch(text, /next session/);
  assert.doesNotMatch(text, /new session/);
  assert.doesNotMatch(text, /wait/);
  assert.match(text, /[Kk]eep working/);
}

test('window set (below, at or above T2): keep working, no STOP, no /clear', () => {
  for (const w of [250000, 300000, 533000]) {
    const d = budgetDecision(state, { ...cfg, autocompactWindow: w });
    assert.strictEqual(d.tier, 't2');
    assert.doesNotMatch(d.message, /Directive: STOP/);
    assertKeepWorking(d.message);
    assert.match(d.message, /handoff/);
  }
});

test('window unset or invalid: keep working, no STOP, no /clear', () => {
  for (const w of [undefined, null, 0, NaN]) {
    const d = budgetDecision(state, { ...cfg, autocompactWindow: w });
    assert.strictEqual(d.tier, 't2');
    assert.doesNotMatch(d.message, /Directive: STOP/);
    assertKeepWorking(d.message);
    assert.match(d.message, /handoff/);
  }
});

test('90% context, any window: model text keeps working', () => {
  const hi = { contextTokens: 900000, calls: 9, lastT1Context: 0, lastT2Context: 0 };
  const hiCfg = { t1: 100000, t2: 150000, step: 25000, inferredWindow: 1000000, windowSource: 'statusline' };
  for (const w of [250000, undefined, null, 0]) {
    const d = budgetDecision(hi, { ...hiCfg, autocompactWindow: w });
    assert.strictEqual(d.tier, 't2');
    assert.match(d.message, /90%/);
    assertKeepWorking(d.message);
  }
});

test('negative control: old /clear wording is rejected', () => {
  const old = 'write a handoff and /clear, or split the work. Directive: STOP taking on new work. start a fresh session';
  assert.throws(() => assertKeepWorking(old));
});
