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
    // HERMETICITY (v2.32.56): both the opt-in check (_shared/opt-in.js) and
    // loadConfig() resolve ~/.autopilot/config.json via os.homedir(). Without
    // pinning HOME the suite reads the DEVELOPER'S real config, so results
    // depend on who runs it — a maintainer with {"context_budget":{"t2":...}}
    // set turns the T1/T2 wrapper tests red, and one with the hook enabled
    // in config breaks the "disabled ⇒ silent" test (config beats env opt-out).
    // Found 2026-07-20 when exactly that happened. Pin it to an empty dir.
    HOME: dir,
    AUTOPILOT_HOOK_CONTEXT_BUDGET: '1',
    AUTOPILOT_CONTEXT_BUDGET_DIR: dir,
    CLAUDE_CODE_SESSION_ID: `t-${path.basename(dir)}`,
    ...extra,
  };
}

test('wrapper: opt-OUT (AUTOPILOT_CONTEXT_BUDGET_MODE=off) ⇒ silent exit 0', () => {
  // default-on since v2.35.15: there is no enable flag any more, only the opt-out.
  const p = tmpFile([usageLine(999_999, 0, 0, 1)]);
  const r = runHook({ transcript_path: p }, freshEnv({ AUTOPILOT_CONTEXT_BUDGET_MODE: 'off' }));
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim(), '');
});

test('wrapper: default-on — fires with NO enable flag at all', () => {
  const p = tmpFile([usageLine(999_999, 0, 0, 1)]);
  const r = runHook({ transcript_path: p }, freshEnv({ AUTOPILOT_HOOK_CONTEXT_BUDGET: '' }));
  assert.notStrictEqual(r.stderr.trim(), '');
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

test('wrapper: subagent fire (agent_id present) ⇒ silent exit 0 (depth-0 only)', () => {
  const p = tmpFile([usageLine(80_000, 80_000, 1_000, 10)]); // would be T2 for depth-0
  const r = runHook({ transcript_path: p, agent_id: 'a326adc31e613f671', agent_type: 'general-purpose' }, freshEnv());
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim(), '');
});

// --- v2.32.56: context-window inference (A: ratchet + B: explicit config) ----
//
// Regression guarded: on a 1M-window model the 200K-calibrated defaults
// (100k/150k) fire from 15% onward and never stop. Observed 2026-07-20 — a 1M
// session sat at 216k (22%) with T2 firing every turn, and the reader relayed
// "context nearly full / please /clear" to the user. There is NO harness signal
// to key off (transcript model string is identical for the 200K and 1M variant;
// no env var carries the window), so the window is inferred from evidence:
// observing N tokens proves the window is > N.

const { inferWindowTokens, scaleTiers, BASE_WINDOW } = require(LIB);

test('inferWindowTokens: snaps to smallest known window above the observation', () => {
  assert.strictEqual(inferWindowTokens(0), 200_000);          // no evidence ⇒ base
  assert.strictEqual(inferWindowTokens(150_000), 200_000);    // still fits 200K
  assert.strictEqual(inferWindowTokens(199_999), 200_000);
  assert.strictEqual(inferWindowTokens(216_000), 1_000_000);  // proves >200K
  assert.strictEqual(inferWindowTokens(999_999), 1_000_000);
  // Garbage in ⇒ base window, never NaN/undefined tiers.
  assert.strictEqual(inferWindowTokens(undefined), 200_000);
  assert.strictEqual(inferWindowTokens(-5), 200_000);
});

test('scaleTiers: scales defaults proportionally, leaves explicit values alone', () => {
  const dflt = { t1: 100_000, t2: 150_000, explicitT1: false, explicitT2: false };
  assert.deepStrictEqual(
    { t1: scaleTiers(dflt, 1_000_000).t1, t2: scaleTiers(dflt, 1_000_000).t2 },
    { t1: 500_000, t2: 750_000 },   // 50% / 75% of 1M — same proportions as 200K
  );
  // Base window ⇒ untouched (no accidental drift for 200K sessions).
  assert.deepStrictEqual(scaleTiers(dflt, BASE_WINDOW), dflt);

  // B overlays A: a hand-set threshold must survive inference.
  const pinned = { t1: 100_000, t2: 300_000, explicitT1: false, explicitT2: true };
  const out = scaleTiers(pinned, 1_000_000);
  assert.strictEqual(out.t2, 300_000, 'explicit t2 must not be rescaled');
  assert.strictEqual(out.t1, 500_000, 'non-explicit t1 still scales');
});

test('budgetDecision: message states PROPORTION, not just absolute tokens', () => {
  // The whole failure mode was "216k" reading as near-full. Percentage is the fix.
  const d = budgetDecision(
    { contextTokens: 800_000, calls: 1 },
    { t1: 500_000, t2: 750_000, inferredWindow: 1_000_000 },
  );
  assert.strictEqual(d.tier, 't2');
  assert.match(d.message, /80% of the ~1000k window/);
});

test('RED CHECK: pre-fix tiers would have fired T2 at 216k on a 1M window', () => {
  // Proves this test file actually discriminates — with the old unscaled
  // defaults, 216k trips T2. If this ever stops firing the guard below is vacuous.
  const old = budgetDecision({ contextTokens: 216_000, calls: 1 }, { t1: 100_000, t2: 150_000 });
  assert.strictEqual(old.tier, 't2', 'pre-fix behaviour must still reproduce');
});

test('GREEN: 216k on an inferred 1M window is silent (the reported bug)', () => {
  const cfg = { t1: 100_000, t2: 150_000, explicitT1: false, explicitT2: false };
  const scaled = scaleTiers(cfg, inferWindowTokens(216_000));
  const d = budgetDecision({ contextTokens: 216_000, calls: 1 }, scaled);
  assert.strictEqual(d.tier, null, '22% of a 1M window must not fire any tier');
});

test('wrapper end-to-end: 1M-scale context does not emit T2 (exit 0, no stderr)', () => {
  // 216k total across the usage fields ⇒ ratchet infers 1M on this very call,
  // so even the FIRST crossing is suppressed (evidence arrives with the reading).
  const p = tmpFile([usageLine(6_000, 200_000, 10_000, 10)]);
  const r = runHook({ transcript_path: p }, freshEnv());
  assert.strictEqual(r.status, 0, 'must not exit 2 on a 1M-window session');
  assert.strictEqual(r.stderr.trim(), '', 'must not nudge at 22% of window');
});

test('wrapper: 200K-window session still gets its T2 (no regression for small windows)', () => {
  const p = tmpFile([usageLine(6_000, 150_000, 4_000, 10)]); // 160k ⇒ fits 200K
  const r = runHook({ transcript_path: p }, freshEnv());
  assert.strictEqual(r.status, 2, '200K sessions must keep the escalated advisory');
  assert.match(r.stderr, /Context budget T2/);
});
