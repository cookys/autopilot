/**
 * L1 unit tests for intent-capture-lib.js pure helpers.
 * Run: node --test hooks/intent-capture.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  summarizeToolInput,
  disableFlagDecision,
  FAILURE_THRESHOLD,
  STALE_DISABLE_HOURS,
  SUMMARY_MAX_LENGTH,
} = require('./intent-capture-lib.js');

// ──────────────── summarizeToolInput ────────────────

test('summarizeToolInput: returns toolName when input is null/non-object', () => {
  assert.equal(summarizeToolInput('Bash', null), 'Bash');
  assert.equal(summarizeToolInput('Bash', undefined), 'Bash');
  assert.equal(summarizeToolInput('Bash', 'string'), 'Bash');
});

test('summarizeToolInput: picks file_path before other fields', () => {
  const r = summarizeToolInput('Read', { file_path: '/etc/hosts', pattern: 'X' });
  assert.equal(r, 'Read /etc/hosts');
});

test('summarizeToolInput: falls through to pattern when file_path absent', () => {
  const r = summarizeToolInput('Grep', { pattern: 'TODO' });
  assert.equal(r, 'Grep TODO');
});

test('summarizeToolInput: command for Bash', () => {
  const r = summarizeToolInput('Bash', { command: 'ls -la', description: 'list' });
  assert.equal(r, 'Bash ls -la');
});

test('summarizeToolInput: truncates long values with ellipsis', () => {
  const long = 'A'.repeat(200);
  const r = summarizeToolInput('Bash', { command: long });
  assert.ok(r.startsWith('Bash '));
  assert.ok(r.endsWith('...'));
  // Tool name + space + (max-3 chars) + '...'
  assert.equal(r.length, 'Bash '.length + SUMMARY_MAX_LENGTH);
});

test('summarizeToolInput: returns toolName when no candidate field matches', () => {
  const r = summarizeToolInput('Custom', { unrelated: 'X' });
  assert.equal(r, 'Custom');
});

test('summarizeToolInput: empty-string field treated as absent (falsy)', () => {
  const r = summarizeToolInput('Read', { file_path: '', pattern: 'fallback' });
  assert.equal(r, 'Read fallback');
});

// ──────────────── disableFlagDecision ────────────────

const now = 1_700_000_000_000; // arbitrary epoch ms

test('disableFlagDecision: no_flag when mtimeMs is null', () => {
  const d = disableFlagDecision({ mtimeMs: null, nowMs: now, flagContentJson: null, currentVersion: '1.0.0' });
  assert.equal(d, 'no_flag');
});

test('disableFlagDecision: clear_stale when age > staleHours', () => {
  const mtime = now - (STALE_DISABLE_HOURS + 1) * 3600 * 1000;
  const d = disableFlagDecision({ mtimeMs: mtime, nowMs: now, flagContentJson: '{}', currentVersion: '1.0.0' });
  assert.equal(d, 'clear_stale');
});

test('disableFlagDecision: clear_version when content version differs', () => {
  const flag = JSON.stringify({ plugin_version: '0.9.0', reason: 'x' });
  const d = disableFlagDecision({ mtimeMs: now, nowMs: now, flagContentJson: flag, currentVersion: '1.0.0' });
  assert.equal(d, 'clear_version');
});

test('disableFlagDecision: active when fresh + matching version', () => {
  const flag = JSON.stringify({ plugin_version: '1.0.0', reason: 'x' });
  const d = disableFlagDecision({ mtimeMs: now - 1000, nowMs: now, flagContentJson: flag, currentVersion: '1.0.0' });
  assert.equal(d, 'active');
});

test('disableFlagDecision: active when content has no plugin_version field', () => {
  const flag = JSON.stringify({ reason: 'x' });
  const d = disableFlagDecision({ mtimeMs: now - 1000, nowMs: now, flagContentJson: flag, currentVersion: '1.0.0' });
  assert.equal(d, 'active');
});

test('disableFlagDecision: malformed JSON content → leave active', () => {
  const d = disableFlagDecision({ mtimeMs: now - 1000, nowMs: now, flagContentJson: '{not json', currentVersion: '1.0.0' });
  assert.equal(d, 'active');
});

test('disableFlagDecision: null flagContentJson + fresh → active', () => {
  const d = disableFlagDecision({ mtimeMs: now - 1000, nowMs: now, flagContentJson: null, currentVersion: '1.0.0' });
  assert.equal(d, 'active');
});

test('disableFlagDecision: staleHours override honored', () => {
  // 1 hour age + staleHours=0.5 → clear_stale even though default 24h would not
  const d = disableFlagDecision({
    mtimeMs: now - 3600 * 1000, nowMs: now, flagContentJson: '{}', currentVersion: '1.0.0', staleHours: 0.5,
  });
  assert.equal(d, 'clear_stale');
});

// ──────────────── Invariant guards ────────────────

test('FAILURE_THRESHOLD has the expected production value', () => {
  // Mirrored across hooks/intent-capture.js + .opencode/plugins/autopilot.ts
  // (which deliberately re-defines it to avoid Bun ESM require coupling).
  // If this changes, both call sites must be updated.
  assert.equal(FAILURE_THRESHOLD, 10);
});

test('STALE_DISABLE_HOURS has the expected production value', () => {
  assert.equal(STALE_DISABLE_HOURS, 24);
});
