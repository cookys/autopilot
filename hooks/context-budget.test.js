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

// Every temp dir this file makes is registered here and removed when the test process exits
// (also after failed assertions); BL-0140.
const madeDirs = [];
process.on('exit', () => {
  for (const d of madeDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});
function mkTmp(base, prefix) {
  const d = fs.mkdtempSync(path.join(base, prefix));
  madeDirs.push(d);
  return d;
}

function tmpFile(lines) {
  const p = path.join(mkTmp(os.tmpdir(), 'ctxbud-'), 't.jsonl');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

// `timestamp` (ISO string) is optional — it exercises the v2.36.1 live/transcript lag
// guard in context-budget.js (readContextUsage's row.timestamp vs the live file's
// written_at). Omitted, the row carries no timestamp (pre-P2 fixture behaviour).
const usageLine = (input, cacheRead, cacheCreate, out, timestamp) => JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', usage: {
    input_tokens: input, cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate, output_tokens: out,
  } },
  ...(timestamp ? { timestamp } : {}),
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

test('budgetDecision: t1 fires, then throttles until context grows by step (default 50k)', () => {
  const cfg = { t1: 100_000, t2: 150_000 };
  const first = budgetDecision({ contextTokens: 120_000, calls: 30 }, cfg);
  assert.strictEqual(first.tier, 't1');
  assert.match(first.message, /120k/);
  // Many calls later but context barely moved => still throttled (calls no longer matter).
  const throttled = budgetDecision({ contextTokens: 121_000, calls: 400, lastT1Context: 120_000 }, cfg);
  assert.strictEqual(throttled.tier, null);
  const justShort = budgetDecision({ contextTokens: 119_999, calls: 401, lastT1Context: 70_000 + 50_000 }, cfg);
  assert.strictEqual(justShort.tier, null);
  const refire = budgetDecision({ contextTokens: 170_000, calls: 31, lastT1Context: 120_000 }, { t1: 100_000, t2: 0 });
  assert.strictEqual(refire.tier, 't1');
});

test('budgetDecision: t2 outranks t1, refires per token step, message directs handoff', () => {
  const cfg = { t1: 100_000, t2: 150_000 };
  const d = budgetDecision({ contextTokens: 160_000, calls: 60, lastT1Context: 110_000 }, cfg);
  assert.strictEqual(d.tier, 't2');
  assert.match(d.message, /handoff/i);
  const throttled = budgetDecision({ contextTokens: 161_000, calls: 600, lastT1Context: 110_000, lastT2Context: 160_000 }, cfg);
  assert.strictEqual(throttled.tier, null);
  const refire = budgetDecision({ contextTokens: 210_000, calls: 61, lastT1Context: 110_000, lastT2Context: 160_000 }, cfg);
  assert.strictEqual(refire.tier, 't2');
});

test('budgetDecision: step 0 reminds on every call past the threshold; custom step honoured', () => {
  const every = budgetDecision({ contextTokens: 160_000, calls: 2, lastT2Context: 160_000 }, { t1: 100_000, t2: 150_000, step: 0 });
  assert.strictEqual(every.tier, 't2');
  const small = budgetDecision({ contextTokens: 170_000, calls: 2, lastT2Context: 160_000 }, { t1: 100_000, t2: 150_000, step: 10_000 });
  assert.strictEqual(small.tier, 't2');
  const big = budgetDecision({ contextTokens: 210_000, calls: 2, lastT2Context: 160_000 }, { t1: 100_000, t2: 150_000, step: 100_000 });
  assert.strictEqual(big.tier, null);
});

test('budgetDecision: a drop of >= step (compaction) starts a new reminder cycle', () => {
  const d = budgetDecision({ contextTokens: 155_000, calls: 2, lastT2Context: 400_000 }, { t1: 100_000, t2: 150_000 });
  assert.strictEqual(d.tier, 't2');
});

// ---- wrapper black-box ----

function runHook(stdinObj, env) {
  return spawnSync('node', [HOOK], {
    input: typeof stdinObj === 'string' ? stdinObj : JSON.stringify(stdinObj),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// Wave-B row 1: with no usable live file, no remembered window, observedMax < 200K and no
// user-explicit t2, the window is UNKNOWN to the hook, so T2 is an advisory (exit 0,
// additionalContext, no STOP/clear directive) instead of the directive exit-2 T2.
function assertUnknownWindowAdvisory(r, kTokens, why) {
  assert.strictEqual(r.status, 0, `${why}: unknown window ⇒ advisory exit 0 (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Context budget T2 \(advisory\)/);
  assert.match(r.stderr, new RegExp(`context is ${kTokens}k tokens`));
  assert.match(r.stderr, /context window is unknown/);
  assert.doesNotMatch(r.stderr, /STOP|\/clear/, `${why}: no STOP/clear directive`);
  assert.doesNotMatch(r.stderr, /\(statusline\)/);
  const out = JSON.parse(r.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /context window is unknown/);
  assert.doesNotMatch(r.stdout, /permissionDecision/);
}

function freshEnv(extra = {}) {
  const dir = mkTmp(os.tmpdir(), 'ctxbud-state-');
  return {
    // HERMETICITY (v2.32.56): both the opt-in check (_shared/opt-in.js) and
    // loadConfig() resolve ~/.autopilot/config.json via os.homedir(). Without
    // pinning HOME the suite reads the DEVELOPER'S real config, so results
    // depend on who runs it — a maintainer with {"context_budget":{"t2":...}}
    // set turns the T1/T2 wrapper tests red, and one with the hook enabled
    // in config breaks the "disabled ⇒ silent" test (config beats env opt-out).
    // Found 2026-07-20 when exactly that happened. Pin it to an empty dir.
    HOME: dir,
    AUTOPILOT_CONFIG_FILE: path.join(dir, '.autopilot', 'config.json'),
    AUTOPILOT_HOOK_CONTEXT_BUDGET: '1',
    AUTOPILOT_CONTEXT_BUDGET_DIR: dir,
    // W2f: the hook now WRITES <live>/context/<sid>.json when no status line does, so a test
    // that omits an override would drop fixture rows into the host's real live dir.
    AUTOPILOT_LIVE_DIR: shmTmp('ctxbud-hermetic-live-'),
    // The autocompact tip reads the policy file; a host's real /etc/claude-code one must not leak in.
    AUTOPILOT_MANAGED_SETTINGS_FILE: path.join(dir, 'no-managed-settings.json'),
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

// P7a advisory bridge: T1 is an owner nudge. Default: no additionalContext, exactly one advisory row (text = the stderr copy);
// AUTOPILOT_ADVISORY_BRIDGE_CONTEXT_BUDGET=inject restores the injection.
test('wrapper: t1 bridge default ⇒ no additionalContext, one advisory row with the stderr text', () => {
  const p = tmpFile([usageLine(50_000, 60_000, 1_000, 10)]);
  const env = freshEnv();
  const r = runHook({ transcript_path: p, session_id: 'bridge-t1' }, env);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /context/i);
  assert.strictEqual(r.stdout.trim(), '', 'no stdout JSON / additionalContext');
  const rows = fs.readFileSync(path.join(env.AUTOPILOT_LIVE_DIR, 'advisories', 'bridge-t1.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].kind, 'context-budget-t1');
  assert.ok(rows[0].id && rows[0].at && rows[0].severity);
  assert.strictEqual(rows[0].text, r.stderr.trim());
});

test('wrapper: t1 knob inject ⇒ additionalContext restored, no advisory row', () => {
  const p = tmpFile([usageLine(50_000, 60_000, 1_000, 10)]);
  const env = freshEnv({ AUTOPILOT_ADVISORY_BRIDGE_CONTEXT_BUDGET: 'inject' });
  const r = runHook({ transcript_path: p, session_id: 'bridge-t1-inj' }, env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, r.stderr.trim());
  assert.ok(!fs.existsSync(path.join(env.AUTOPILOT_LIVE_DIR, 'advisories', 'bridge-t1-inj.jsonl')));
});

test('wrapper: t2 crossing, unknown window ⇒ exit 0 advisory on stderr (model-visible), no directive', () => {
  const p = tmpFile([usageLine(80_000, 80_000, 1_000, 10)]); // 161k ≥ 150k default t2, window unknown
  const r = runHook({ transcript_path: p }, freshEnv());
  assertUnknownWindowAdvisory(r, 161, 'no live file');
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

const { inferWindowTokens, scaleTiers, tiersForKnownWindow, BASE_WINDOW } = require(LIB);

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

test('scaleTiers: NEVER scales defaults up (1M window keeps 100k/150k); only tags the window', () => {
  const dflt = { t1: 100_000, t2: 150_000, explicitT1: false, explicitT2: false };
  const out = scaleTiers(dflt, 1_000_000);
  assert.deepStrictEqual({ t1: out.t1, t2: out.t2 }, { t1: 100_000, t2: 150_000 });
  assert.strictEqual(out.inferredWindow, 1_000_000);
  assert.deepStrictEqual(scaleTiers(dflt, BASE_WINDOW), dflt);
  // Explicit values pass through untouched too.
  const pinned = { t1: 100_000, t2: 250_000, explicitT1: false, explicitT2: true };
  assert.strictEqual(scaleTiers(pinned, 1_000_000).t2, 250_000);
});

test('tiersForKnownWindow: no upscaling at 1M; a window below 200K still scales defaults DOWN', () => {
  const dflt = { t1: 100_000, t2: 150_000, explicitT1: false, explicitT2: false };
  const big = tiersForKnownWindow(dflt, 1_000_000);
  assert.deepStrictEqual({ t1: big.t1, t2: big.t2 }, { t1: 100_000, t2: 150_000 });
  const small = tiersForKnownWindow(dflt, 100_000);
  assert.deepStrictEqual({ t1: small.t1, t2: small.t2 }, { t1: 50_000, t2: 75_000 });
  const pinned = tiersForKnownWindow({ ...dflt, t2: 250_000, explicitT2: true }, 1_000_000);
  assert.strictEqual(pinned.t2, 250_000);
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

test('216k on an inferred 1M window fires T2 at the ABSOLUTE 150k (cost is turns x context)', () => {
  const cfg = { t1: 100_000, t2: 150_000, explicitT1: false, explicitT2: false };
  const tiers = scaleTiers(cfg, inferWindowTokens(216_000));
  const d = budgetDecision({ contextTokens: 216_000, calls: 1 }, tiers);
  assert.strictEqual(d.tier, 't2');
  assert.match(d.message, /22% of the ~1000k window/, 'proportion is still stated');
});

test('wrapper end-to-end: 216k with the window inferred as 1M still emits the T2 directive (exit 2)', () => {
  const p = tmpFile([usageLine(6_000, 200_000, 10_000, 10)]);
  const r = runHook({ transcript_path: p }, freshEnv());
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /threshold 150k/);
  assert.doesNotMatch(r.stderr, /threshold 750k/);
});

test('wrapper: 160k with no live file/remembered window ⇒ unknown-window advisory (not a directive T2)', () => {
  const p = tmpFile([usageLine(6_000, 150_000, 4_000, 10)]); // 160k, window unknown to the hook
  const r = runHook({ transcript_path: p }, freshEnv());
  assertUnknownWindowAdvisory(r, 160, '160k unknown');
});

// --- v2.36.1 (P2): consume the statusline live file instead of inferring the window ---
//
// Live-dir resolution (scripts/lib/live-state-dir.js) requires a RAM-backed directory to
// ACCEPT AUTOPILOT_LIVE_DIR (findmnt -T must print tmpfs/ramfs — even the override is
// checked). /dev/shm is tmpfs on every Linux host these hooks run on, so tests use a
// mkdtemp under /dev/shm as the live-dir override rather than mocking findmnt (that mock
// lives in scripts/lib/live-state-dir.test.js; here we exercise the real resolver).
function shmTmp(prefix) {
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  return mkTmp(base, prefix);
}

function writeLiveMain(base, sid, obj) {
  const dir = path.join(base, 'context');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify(obj));
}

function liveMainFixture(overrides = {}) {
  return {
    schema_version: 1,
    session_id: 'live-sid',
    written_at: new Date().toISOString(),
    cc_version: '2.1.260',
    model: { id: 'claude-fable-5-1', display_name: 'Fable 5.1' },
    context_window: {
      context_window_size: 1_000_000,
      used_percentage: 15.3,
      total_input_tokens: 153_000,
      current_usage: { input_tokens: 32, cache_creation_input_tokens: 900, cache_read_input_tokens: 152_068 },
    },
    ...overrides,
  };
}

test('RED/GREEN: 1M live file at 153k => T2 fires at the absolute 150k (fails if tiers scale up with the window)', () => {
  const liveDir = shmTmp('ctxbud-live-1m-');
  const sid = 'live-sid-1m';
  writeLiveMain(liveDir, sid, liveMainFixture());
  const p = tmpFile([usageLine(1_000, 151_000, 1_000, 10)]); // 153k via transcript too
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assert.strictEqual(r.status, 2, '1M window, no t1/t2 configured: T2 at 150k');
  assert.match(r.stderr, /threshold 150k/);
  assert.match(r.stderr, /\(statusline\)/);
});

test('1M live file, explicit t2=250000 => configured value wins (silent at 153k, fires at 260k)', () => {
  const liveDir = shmTmp('ctxbud-live-1m-x-');
  const sid = 'live-sid-1m-x';
  writeLiveMain(liveDir, sid, liveMainFixture());
  const env = freshEnv({ AUTOPILOT_LIVE_DIR: liveDir, AUTOPILOT_CONTEXT_BUDGET_T2: '250000' });
  const low = runHook({ transcript_path: tmpFile([usageLine(1_000, 151_000, 1_000, 10)]), session_id: sid }, env);
  assert.strictEqual(low.status, 0);
  assert.doesNotMatch(low.stderr, /T2/);
  const high = runHook({ transcript_path: tmpFile([usageLine(1_000, 258_000, 1_000, 10, new Date().toISOString())]), session_id: sid }, env);
  assert.strictEqual(high.status, 2);
  assert.match(high.stderr, /threshold 250k/);
});

// --- step throttle (per token step, not per call) ---
// Drives the real wrapper repeatedly against ONE session id/state dir, varying the transcript.
function stepSession(extraEnv) {
  const liveDir = shmTmp('ctxbud-step-');
  const sid = `step-${Math.random().toString(36).slice(2)}`;
  const env = freshEnv({ AUTOPILOT_LIVE_DIR: liveDir, ...extraEnv });
  // The live file tracks the same total as the transcript (the statusline keeps it fresh), so
  // the cheap no-parse path sees the real context too.
  return (tokens) => writeLiveMain(liveDir, sid, liveMainFixture({ context_window: {
    context_window_size: 1_000_000, total_input_tokens: tokens } })) || runHook(
    { transcript_path: tmpFile([usageLine(1_000, tokens - 1_000, 0, 10, new Date().toISOString())]), session_id: sid }, env);
}

test('step=50000 (default): context parked at 160k reminds ONCE across many calls; 210k reminds again', () => {
  const call = stepSession({});
  const first = call(160_000);
  assert.strictEqual(first.status, 2, 'first crossing fires');
  for (let i = 0; i < 25; i++) {
    const r = call(160_000 + i * 100);
    assert.strictEqual(r.status, 0, `call ${i + 2} at ~160k must stay silent`);
    assert.strictEqual(r.stderr.trim(), '');
  }
  const grown = call(210_000);
  assert.strictEqual(grown.status, 2, 'grew by step since the last reminder => remind again');
  assert.match(grown.stderr, /210k/);
  assert.strictEqual(call(215_000).status, 0, 'and parks again');
});

test('dropping below a tier threshold resets it: T2 reminds again on the next climb (compaction cycle)', () => {
  const call = stepSession({});
  assert.strictEqual(call(160_000).status, 2, 'first T2');
  assert.strictEqual(call(165_000).status, 0, 'parked');
  assert.strictEqual(call(40_000).status, 0, 'compacted below both tiers');
  const again = call(160_000);
  assert.strictEqual(again.status, 2, 'new cycle: first crossing after compaction must remind');
  assert.match(again.stderr, /T2/);
});

test('dropping below a tier threshold resets it: T1 reminds again on the next climb (compaction cycle)', () => {
  const call = stepSession({});
  const first = call(120_000);
  assert.match(first.stderr, /Context budget T1/, 'first T1');
  assert.strictEqual(call(125_000).stderr.trim(), '', 'parked');
  assert.strictEqual(call(40_000).stderr.trim(), '', 'compacted below T1');
  assert.match(call(120_000).stderr, /Context budget T1/, 'new cycle: T1 reminds again');
});

test('step from config file applies; env AUTOPILOT_CONTEXT_BUDGET_STEP overrides the config file', () => {
  const home = mkTmp(os.tmpdir(), 'ctxbud-home-');
  fs.mkdirSync(path.join(home, '.autopilot'));
  fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify({ context_budget: { step: 10_000 } }));
  const viaCfg = stepSession({ HOME: home, AUTOPILOT_CONFIG_FILE: path.join(home, '.autopilot', 'config.json') });
  assert.strictEqual(viaCfg(160_000).status, 2);
  assert.strictEqual(viaCfg(171_000).status, 2, 'config step=10000 honoured');
  const viaEnv = stepSession({ HOME: home, AUTOPILOT_CONFIG_FILE: path.join(home, '.autopilot', 'config.json'), AUTOPILOT_CONTEXT_BUDGET_STEP: '100000' });
  assert.strictEqual(viaEnv(160_000).status, 2);
  assert.strictEqual(viaEnv(171_000).status, 0, 'env step=100000 overrides config step=10000');
  assert.strictEqual(viaEnv(261_000).status, 2);
  const every = stepSession({ AUTOPILOT_CONTEXT_BUDGET_STEP: '0' });
  assert.strictEqual(every(160_000).status, 2);
  assert.strictEqual(every(160_000).status, 2);
});

test('200K live file at 150k ⇒ T2 still fires (no regression for small windows)', () => {
  const liveDir = shmTmp('ctxbud-live-200k-');
  const sid = 'live-sid-200k';
  writeLiveMain(liveDir, sid, liveMainFixture({
    context_window: {
      context_window_size: 200_000,
      used_percentage: 75,
      total_input_tokens: 150_000,
      current_usage: { input_tokens: 32, cache_creation_input_tokens: 900, cache_read_input_tokens: 149_068 },
    },
  }));
  const p = tmpFile([usageLine(1_000, 148_000, 1_000, 10)]);
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assert.strictEqual(r.status, 2, '200K live-window session at 150k must still get T2');
  assert.match(r.stderr, /Context budget T2/);
  assert.match(r.stderr, /\(statusline\)/, 'message must say the window came from the statusline, not inference');
});

test('lag guard: OLDER transcript row with a HIGHER total ⇒ contextTokens = max(transcript, live)', () => {
  const liveDir = shmTmp('ctxbud-live-lag-older-');
  const sid = 'live-sid-lag-older';
  const writtenAt = new Date();
  writeLiveMain(liveDir, sid, liveMainFixture({
    written_at: writtenAt.toISOString(),
    context_window: {
      context_window_size: 200_000,
      used_percentage: 65,
      total_input_tokens: 130_000, // below t2 (150k) on its own
      current_usage: { input_tokens: 32, cache_creation_input_tokens: 900, cache_read_input_tokens: 129_068 },
    },
  }));
  // Transcript row timestamped BEFORE written_at, but its own total (160k) is HIGHER than
  // the live total (130k) — the lag guard must take the max, not blindly trust either side.
  const rowTs = new Date(writtenAt.getTime() - 5_000).toISOString();
  const p = tmpFile([usageLine(10_000, 149_000, 1_000, 10, rowTs)]); // 160k total, older row
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assert.strictEqual(r.status, 2, 'max(160k transcript, 130k live) = 160k ≥ 150k t2');
  assert.match(r.stderr, /is 160k tokens/, 'contextTokens must be the max, not the live total alone');
  assert.match(r.stderr, /\(statusline\)/);
});

test('lag guard: NEWER transcript row ⇒ transcript value used even when the live total is larger', () => {
  const liveDir = shmTmp('ctxbud-live-lag-newer-');
  const sid = 'live-sid-lag-newer';
  const writtenAt = new Date();
  writeLiveMain(liveDir, sid, liveMainFixture({
    written_at: writtenAt.toISOString(),
    context_window: {
      context_window_size: 200_000,
      used_percentage: 80,
      total_input_tokens: 160_000, // above t2 (150k) on its own
      current_usage: { input_tokens: 32, cache_creation_input_tokens: 900, cache_read_input_tokens: 159_068 },
    },
  }));
  // Transcript row timestamped AFTER written_at (fresher than the live tick) with a LOWER
  // total (130k) — the fresher transcript row must win outright, not be maxed with the stale
  // (larger) live total.
  const rowTs = new Date(writtenAt.getTime() + 5_000).toISOString();
  const p = tmpFile([usageLine(10_000, 119_000, 1_000, 10, rowTs)]); // 130k total, newer row
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assert.strictEqual(r.status, 0, 'fresher transcript row (130k) is below t2 ⇒ no T2, even though live total (160k) is above it');
  assert.match(r.stderr, /Context budget T1/, 'still ≥ t1 (100k) so T1 fires');
  assert.match(r.stderr, /is 130k tokens/, 'contextTokens must be the fresher transcript value, not the live total');
  assert.match(r.stderr, /\(statusline\)/, 'the live path must still be the one that ran (guards a vacuous pass where /dev/shm is absent)');
});

test('lag guard: OLDER transcript row with a LOWER total ⇒ contextTokens = live total (max, not "trust transcript")', () => {
  // Mutant guard (v2.36.2): collapsing `Math.max(usage.tokens, liveTotal)` to `usage.tokens`
  // survived 35/35 because the older-row fixture above has transcript > live. This case
  // is the other arm: older row 130k, live 160k ⇒ 160k ⇒ T2.
  const liveDir = shmTmp('ctxbud-live-lag-older-lower-');
  const sid = 'live-sid-lag-older-lower';
  const writtenAt = new Date();
  writeLiveMain(liveDir, sid, liveMainFixture({
    written_at: writtenAt.toISOString(),
    context_window: {
      context_window_size: 200_000,
      used_percentage: 80,
      total_input_tokens: 160_000, // above t2 (150k)
      current_usage: { input_tokens: 32, cache_creation_input_tokens: 900, cache_read_input_tokens: 159_068 },
    },
  }));
  const rowTs = new Date(writtenAt.getTime() - 5_000).toISOString();
  const p = tmpFile([usageLine(10_000, 119_000, 1_000, 10, rowTs)]); // 130k total, older row
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assert.strictEqual(r.status, 2, 'max(130k older transcript, 160k live) = 160k ≥ 150k t2');
  assert.match(r.stderr, /is 160k tokens/, 'contextTokens must be the live total, not the older transcript row');
  assert.match(r.stderr, /\(statusline\)/);
});

for (const bad of [0, -1]) {
  test(`live file with context_window_size ${bad} ⇒ treated as absent, inference path used (no "~-0k window")`, () => {
    // v2.36.2: `Number.isFinite` accepted 0 and negatives — -1 produced a
    // "-15300000% of the ~-0k window" message, 0 silently reverted to the unscaled ceiling
    // while still claiming "(statusline)". Require > 0, else fall back to inference.
    const liveDir = shmTmp(`ctxbud-live-badwin-${bad === 0 ? 'zero' : 'neg'}-`);
    const sid = `live-sid-badwin-${bad === 0 ? 'zero' : 'neg'}`;
    writeLiveMain(liveDir, sid, liveMainFixture({
      context_window: {
        context_window_size: bad,
        used_percentage: 75,
        total_input_tokens: 153_000,
        current_usage: { input_tokens: 32, cache_creation_input_tokens: 900, cache_read_input_tokens: 152_068 },
      },
    }));
    // The transcript (120k) and the live total (153k) DISAGREE on purpose: the live path would
    // take the live total and fire T2; the inference path reads the transcript and fires T1
    // only. (The inference path at a 200K window prints no window clause and pre-fix `0`
    // printed none either — `win ? … : ''` — so the message text alone cannot discriminate.)
    const p = tmpFile([usageLine(1_000, 118_000, 1_000, 10)]); // 120k via transcript ⇒ T1 only
    const r = runHook(
      { transcript_path: p, session_id: sid },
      freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
    );
    assert.strictEqual(r.status, 0, 'inference path at 120k ⇒ T1 only (the live path would have fired T2 off its 153k total)');
    assert.match(r.stderr, /Context budget T1: context is 120k tokens/, 'the transcript value must be used, not the live total');
    assert.doesNotMatch(r.stderr, /\(statusline\)/, 'a non-positive window must not be attributed to the statusline');
    assert.doesNotMatch(r.stderr, /~-|-0k|-\d+%/, 'no negative-window arithmetic may leak into the message');
  });
}

test('stale live file (>120s), no memory yet ⇒ its window is adopted, not attributed to the statusline (BL-0091)', () => {
  const liveDir = shmTmp('ctxbud-live-stale-');
  const sid = 'live-sid-stale';
  writeLiveMain(liveDir, sid, liveMainFixture({
    written_at: new Date(Date.now() - 121_000).toISOString(),
  }));
  const p = tmpFile([usageLine(1_000, 151_000, 1_000, 10)]);
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  // The window never changes mid-session, so this session's own stale file still names it; the
  // token total comes from the transcript (153k, past the absolute 150k T2).
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /this session's window/);
  assert.match(r.stderr, /context is 153k tokens/);
  assert.doesNotMatch(r.stderr, /\(statusline\)/);
});

test('stale live file of ANOTHER session ⇒ still the inference path', () => {
  const liveDir = shmTmp('ctxbud-live-stale-other-');
  writeLiveMain(liveDir, 'live-sid-owner', liveMainFixture({
    written_at: new Date(Date.now() - 121_000).toISOString(),
  }));
  const p = tmpFile([usageLine(1_000, 151_000, 1_000, 10)]);
  const r = runHook(
    { transcript_path: p, session_id: 'live-sid-someone-else' },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assertUnknownWindowAdvisory(r, 153, 'stale live file of another session');
});

test('schema_version 2 ⇒ treated as absent, inference path used', () => {
  const liveDir = shmTmp('ctxbud-live-schema2-');
  const sid = 'live-sid-schema2';
  writeLiveMain(liveDir, sid, liveMainFixture({ schema_version: 2 }));
  const p = tmpFile([usageLine(1_000, 151_000, 1_000, 10)]);
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assertUnknownWindowAdvisory(r, 153, 'unusable schema_version ⇒ window unknown');
});

test('missing live file ⇒ inference path used (no crash)', () => {
  const liveDir = shmTmp('ctxbud-live-missing-');
  const sid = 'live-sid-missing';
  const p = tmpFile([usageLine(1_000, 151_000, 1_000, 10)]);
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assertUnknownWindowAdvisory(r, 153, 'no live file at all ⇒ window unknown for a 153k transcript');
});

test('malformed live file (invalid JSON) ⇒ inference path used', () => {
  const liveDir = shmTmp('ctxbud-live-malformed-');
  const sid = 'live-sid-malformed';
  const dir = path.join(liveDir, 'context');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sid}.json`), '{{{not json');
  const p = tmpFile([usageLine(1_000, 151_000, 1_000, 10)]);
  const r = runHook(
    { transcript_path: p, session_id: sid },
    freshEnv({ AUTOPILOT_LIVE_DIR: liveDir }),
  );
  assertUnknownWindowAdvisory(r, 153, 'malformed live file ⇒ window unknown');
});

test('state file lands under the tmpfs live base when no AUTOPILOT_CONTEXT_BUDGET_DIR override is set', () => {
  const liveDir = shmTmp('ctxbud-live-statedir-');
  const sid = 'live-sid-statedir';
  const p = tmpFile([usageLine(1_000, 1_000, 100, 10)]);
  const dir = mkTmp(os.tmpdir(), 'ctxbud-state-nooverride-');
  const env = {
    HOME: dir,
    AUTOPILOT_CONFIG_FILE: path.join(dir, '.autopilot', 'config.json'),
    AUTOPILOT_HOOK_CONTEXT_BUDGET: '1',
    AUTOPILOT_LIVE_DIR: liveDir,
    CLAUDE_CODE_SESSION_ID: sid,
    // Deliberately NOT setting AUTOPILOT_CONTEXT_BUDGET_DIR: the state dir must be derived
    // from the resolved (tmpfs) live base, not the legacy ~/.autopilot path.
  };
  const r = runHook({ transcript_path: p, session_id: sid }, env);
  assert.strictEqual(r.status, 0);
  const expected = path.join(liveDir, 'context-budget', `${sid}.json`);
  assert.ok(fs.existsSync(expected), `state file expected at ${expected}`);
});

test('absent live (no AUTOPILOT_LIVE_DIR override, no live file) ⇒ exit/stdout/stderr identical to the pre-P2 fixture', () => {
  // The develop fixture: below-t1 silent, t1 nudge, t2 escalated-advisory — reproduced here
  // against a repo build with NO live file present anywhere the resolver could find one for
  // this fresh, never-used session id. This is the compatibility contract (plan §2.6): with
  // no usable live file, behaviour is byte-for-byte v2.36.0.
  const belowP = tmpFile([usageLine(10_000, 5_000, 100, 10)]);
  const belowR = runHook({ transcript_path: belowP }, freshEnv());
  assert.strictEqual(belowR.status, 0);
  assert.strictEqual(belowR.stderr.trim(), '');

  const t1P = tmpFile([usageLine(50_000, 60_000, 1_000, 10)]);
  const t1R = runHook({ transcript_path: t1P }, freshEnv());
  assert.strictEqual(t1R.status, 0);
  assert.match(t1R.stderr, /Context budget T1/);
  assert.doesNotMatch(t1R.stderr, /\(statusline\)/, 'no live file ⇒ never attributed to the statusline');

  const t2P = tmpFile([usageLine(80_000, 80_000, 1_000, 10)]);
  const t2R = runHook({ transcript_path: t2P }, freshEnv());
  // Row 1: the pre-P2 directive T2 is now an unknown-window advisory (exit 0, no STOP/clear).
  assertUnknownWindowAdvisory(t2R, 161, 'no live file, 161k');

  // 216k on a genuinely 1M window (via the RATCHET, not a live file) must still say
  // "inferred from observed usage" — that phrasing is reserved for the inference path.
  const bigP = tmpFile([usageLine(6_000, 200_000, 10_000, 10)]);
  const bigR = runHook({ transcript_path: bigP }, freshEnv());
  assert.strictEqual(bigR.status, 2, 'absolute T2 (150k) applies on an inferred 1M window too');
  assert.match(bigR.stderr, /inferred from observed usage/);
});

// v2.36.6 regressions (2026-09-06: T2 fired at 8% real usage right after auto-compaction).
test('lib: advisor turn usage.iterations — last message iteration wins, not the summed top level', () => {
  const p = tmpFile([JSON.stringify({ type: 'assistant', timestamp: '2026-09-05T20:03:36.868Z', message: { usage: {
    input_tokens: 4, cache_creation_input_tokens: 3651, cache_read_input_tokens: 1241031,
    iterations: [
      { type: 'message', input_tokens: 2, cache_read_input_tokens: 620467, cache_creation_input_tokens: 97 },
      { type: 'advisor_message', input_tokens: 624607, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { type: 'message', input_tokens: 2, cache_read_input_tokens: 620564, cache_creation_input_tokens: 3554 },
    ] } } })]);
  assert.strictEqual(readContextTokens(p), 2 + 620564 + 3554);
});

test('lib: compact_boundary after the last usage row ⇒ null (stale pre-compaction rows are not context)', () => {
  const p = tmpFile([
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1, cache_read_input_tokens: 740000, cache_creation_input_tokens: 0 } } }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-09-05T20:09:09.892Z' }),
    JSON.stringify({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } }),
  ]);
  assert.strictEqual(readContextTokens(p), null);
});

test('lib: usage row written after the compact_boundary is returned normally', () => {
  const p = tmpFile([
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1, cache_read_input_tokens: 740000, cache_creation_input_tokens: 0 } } }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: 73890, cache_creation_input_tokens: 1946 } } }),
  ]);
  assert.strictEqual(readContextTokens(p), 73890 + 1948);
});
