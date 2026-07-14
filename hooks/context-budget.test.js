/**
 * Tests for context-budget: pure lib (backward usage scan, tier decision) +
 * wrapper black-box (opt-in gating, fail-open, T1/T2 exit semantics).
 * Run: node --test hooks/context-budget.test.js
 *
 * Panel-finding regressions guarded here:
 * - MiniMax: a single JSONL line >64KB must not hide the last usage row
 *   (backward window growth, 5MB cap ⇒ null fail-open).
 * - Gemini: corrupt state ⇒ reset-and-continue, never a crash/block.
 * - MiniMax: T2 is an ESCALATED ADVISORY (exit 2 feeds stderr to the model);
 *   T1 stays exit 0 (user-visible nudge only).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const LIB = path.join(__dirname, 'context-budget-lib.js');
const HOOK = path.join(__dirname, 'context-budget.js');
const { readContextTokens, budgetDecision } = require(LIB);

function tmpFile(lines) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbud-')), 't.jsonl');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

const usageLine = (input, cacheRead, cacheCreate, out) => JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', usage: {
    input_tokens: input, cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate, output_tokens: out,
  } },
});

test('readContextTokens: last assistant usage wins, trailing non-usage lines skipped', () => {
  const p = tmpFile([
    usageLine(100, 1000, 50, 10),
    usageLine(200, 2000, 60, 20),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
  ]);
  assert.strictEqual(readContextTokens(p), 200 + 2000 + 60);
});

test('readContextTokens: usage hidden behind a >64KB single line is still found (window growth)', () => {
  const big = JSON.stringify({ type: 'user', message: { role: 'user', content: 'X'.repeat(80 * 1024) } });
  const p = tmpFile([usageLine(300, 3000, 70, 30), big]);
  assert.strictEqual(readContextTokens(p), 300 + 3000 + 70);
});

test('readContextTokens: no usage anywhere ⇒ null (fail-open)', () => {
  const p = tmpFile([JSON.stringify({ type: 'user', message: {} })]);
  assert.strictEqual(readContextTokens(p), null);
});

test('readContextTokens: missing file ⇒ null', () => {
  assert.strictEqual(readContextTokens('/nonexistent/nope.jsonl'), null);
});

test('readContextTokens: cap hit ⇒ null (fail-open), never a throw', () => {
  const big = JSON.stringify({ type: 'user', message: { role: 'user', content: 'X'.repeat(100 * 1024) } });
  const p = tmpFile([usageLine(1, 1, 1, 1), big]);
  assert.strictEqual(readContextTokens(p, { capBytes: 16 * 1024 }), null);
});

test('budgetDecision: below t1 ⇒ no fire', () => {
  const d = budgetDecision({ contextTokens: 50_000, calls: 30, lastT1Call: 0, lastT2Call: 0 },
    { t1: 100_000, t2: 150_000 });
  assert.strictEqual(d.tier, null);
});

test('budgetDecision: t1 fires, then throttles for 20 calls', () => {
  const cfg = { t1: 100_000, t2: 150_000 };
  const first = budgetDecision({ contextTokens: 120_000, calls: 30, lastT1Call: 0, lastT2Call: 0 }, cfg);
  assert.strictEqual(first.tier, 't1');
  assert.match(first.message, /120k/);
  const throttled = budgetDecision({ contextTokens: 121_000, calls: 45, lastT1Call: 30, lastT2Call: 0 }, cfg);
  assert.strictEqual(throttled.tier, null);
  const refire = budgetDecision({ contextTokens: 122_000, calls: 50, lastT1Call: 30, lastT2Call: 0 }, cfg);
  assert.strictEqual(refire.tier, 't1');
});

test('budgetDecision: t2 outranks t1, refires every 10 calls, message directs handoff', () => {
  const cfg = { t1: 100_000, t2: 150_000 };
  const d = budgetDecision({ contextTokens: 160_000, calls: 60, lastT1Call: 50, lastT2Call: 0 }, cfg);
  assert.strictEqual(d.tier, 't2');
  assert.match(d.message, /handoff/i);
  const throttled = budgetDecision({ contextTokens: 161_000, calls: 65, lastT1Call: 50, lastT2Call: 60 }, cfg);
  assert.strictEqual(throttled.tier, null);
  const refire = budgetDecision({ contextTokens: 162_000, calls: 70, lastT1Call: 50, lastT2Call: 60 }, cfg);
  assert.strictEqual(refire.tier, 't2');
});

// ---- wrapper black-box ----

function runHook(stdinObj, env) {
  return spawnSync('node', [HOOK], {
    input: typeof stdinObj === 'string' ? stdinObj : JSON.stringify(stdinObj),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function freshEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbud-state-'));
  return {
    AUTOPILOT_HOOK_CONTEXT_BUDGET: '1',
    AUTOPILOT_CONTEXT_BUDGET_DIR: dir,
    CLAUDE_CODE_SESSION_ID: `t-${path.basename(dir)}`,
    ...extra,
  };
}

test('wrapper: disabled (no opt-in) ⇒ silent exit 0', () => {
  const p = tmpFile([usageLine(999_999, 0, 0, 1)]);
  const r = runHook({ transcript_path: p }, {
    AUTOPILOT_HOOK_CONTEXT_BUDGET: '', AUTOPILOT_CONTEXT_BUDGET_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'x-')),
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim(), '');
});

test('wrapper: garbage stdin ⇒ fail-open exit 0', () => {
  const r = runHook('not json{{{', freshEnv());
  assert.strictEqual(r.status, 0);
});

test('wrapper: below t1 ⇒ exit 0 silent', () => {
  const p = tmpFile([usageLine(10_000, 5_000, 100, 10)]);
  const r = runHook({ transcript_path: p }, freshEnv());
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim(), '');
});

test('wrapper: t1 crossing ⇒ exit 0 with nudge on stderr', () => {
  const p = tmpFile([usageLine(50_000, 60_000, 1_000, 10)]); // 111k ≥ 100k default t1
  const r = runHook({ transcript_path: p }, freshEnv());
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /context/i);
});

test('wrapper: t2 crossing ⇒ exit 2 with handoff directive on stderr (model-visible)', () => {
  const p = tmpFile([usageLine(80_000, 80_000, 1_000, 10)]); // 161k ≥ 150k default t2
  const r = runHook({ transcript_path: p }, freshEnv());
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /handoff/i);
});

test('wrapper: corrupt state file ⇒ reset-and-continue, exit 0/2 not crash', () => {
  const env = freshEnv();
  const sid = env.CLAUDE_CODE_SESSION_ID;
  fs.writeFileSync(path.join(env.AUTOPILOT_CONTEXT_BUDGET_DIR, `${sid}.json`), '{{{corrupt');
  const p = tmpFile([usageLine(10_000, 5_000, 100, 10)]);
  const r = runHook({ transcript_path: p }, env);
  assert.strictEqual(r.status, 0);
});

test('wrapper: env threshold override respected', () => {
  const p = tmpFile([usageLine(30_000, 30_000, 0, 10)]); // 60k
  const r = runHook({ transcript_path: p }, freshEnv({ AUTOPILOT_CONTEXT_BUDGET_T1: '50000' }));
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /context/i);
});

test('wrapper: parse cadence — below t1 only every 5th call parses (cheap path)', () => {
  const env = freshEnv();
  const p = tmpFile([usageLine(10_000, 5_000, 100, 10)]);
  // 4 calls: state counts but no fire either way; assert no crash & state file advances
  for (let i = 0; i < 4; i++) {
    const r = runHook({ transcript_path: p }, env);
    assert.strictEqual(r.status, 0);
  }
  const sid = env.CLAUDE_CODE_SESSION_ID;
  const st = JSON.parse(fs.readFileSync(path.join(env.AUTOPILOT_CONTEXT_BUDGET_DIR, `${sid}.json`), 'utf8'));
  assert.strictEqual(st.calls, 4);
});
