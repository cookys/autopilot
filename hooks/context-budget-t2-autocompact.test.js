/**
 * BL-0124: T2 wording when an auto-compact window is set (any position relative to T2).
 * Run: node --test hooks/context-budget-t2-autocompact.test.js
 * Negative controls: window unset or invalid must still carry the STOP directive plus the autoCompactWindow hint.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { budgetDecision } = require(path.join(__dirname, 'context-budget-lib.js'));

const state = { contextTokens: 310000, calls: 9, lastT1Context: 0, lastT2Context: 0 };
const cfg = { t1: 100000, t2: 300000, step: 25000, inferredWindow: 1000000, windowSource: 'statusline' };

test('window set (below, at or above T2): no STOP, no /clear request', () => {
  for (const w of [250000, 300000, 533000]) {
    const d = budgetDecision(state, { ...cfg, autocompactWindow: w });
    assert.strictEqual(d.tier, 't2');
    assert.doesNotMatch(d.message, /Directive: STOP/);
    assert.match(d.message, /do NOT stop/);
    assert.match(d.message, new RegExp(`set at ${w / 1000}k`));
  }
});

test('negative control: window unset or invalid keeps the STOP directive and the hint', () => {
  for (const w of [undefined, null, 0, NaN]) {
    const d = budgetDecision(state, { ...cfg, autocompactWindow: w });
    assert.match(d.message, /Directive: STOP/);
    assert.match(d.message, /autoCompactWindow/);
  }
});
