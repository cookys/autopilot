/**
 * BL-0124, updated: T2 wording is the land checklist (先落地再繼續) for every session,
 * whatever the auto-compact window. The old "Keep working" sentence was replaced
 * because it was ignored (context-budget-lib.js landMessage). Run:
 * node --test hooks/context-budget-t2-autocompact.test.js
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
  assert.match(text, /先落地再繼續/);
  assert.doesNotMatch(text, /Directive: STOP/);
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

const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const BUDGET_HOOK = path.join(__dirname, 'context-budget.js');
const GATE_HOOK = path.join(__dirname, 'context-land-gate.js');

function withSandbox(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-t2-home-'));
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-t2-live-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-t2-rt-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-t2-work-'));
  try {
    fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
    return fn({ home, live, runtime, work });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(live, { recursive: true, force: true });
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function cleanEnv(sb, configFile, extraEnv) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('AUTOPILOT_CONTEXT_BUDGET_')) delete env[key];
  }
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.FLEET_ADDRESS;
  delete env.AUTOPILOT_FLEET_ADDRESS;
  return {
    ...env,
    HOME: sb.home,
    XDG_RUNTIME_DIR: sb.runtime,
    AUTOPILOT_CONFIG_FILE: configFile,
    AUTOPILOT_LIVE_DIR: sb.live,
    AUTOPILOT_CONTEXT_BUDGET_DIR: path.join(sb.work, 'state'),
    ...extraEnv,
  };
}

test('(a) PM seat triggers T2 at 36%, non-PM seat below 45% does not trigger', () => {
  withSandbox((sb) => {
    const configFile = path.join(sb.home, '.autopilot', 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({
      context_budget: { t1: 100000, t2: 450000, step: 0, t2_pct_by_seat: { pm: 35 } },
    }));
    const sid = 'seat-pct-sid';
    fs.mkdirSync(path.join(sb.live, 'context'), { recursive: true });
    fs.writeFileSync(path.join(sb.live, 'context', `${sid}.json`), JSON.stringify({
      schema_version: 1,
      written_at: new Date().toISOString(),
      context_window: { context_window_size: 1000000, total_input_tokens: 360000 },
    }));
    const transcript = path.join(sb.work, 't.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ timestamp: new Date().toISOString(), message: { usage: { input_tokens: 360000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}\n`);

    const pmRes = spawnSync(process.execPath, [BUDGET_HOOK], {
      input: JSON.stringify({ transcript_path: transcript, session_id: sid }),
      encoding: 'utf8',
      env: cleanEnv(sb, configFile, { AUTOPILOT_FLEET_ADDRESS: 'cookys/openclaw/pm--claude' }),
    });
    assert.strictEqual(pmRes.status, 2);

    const otherRes = spawnSync(process.execPath, [BUDGET_HOOK], {
      input: JSON.stringify({ transcript_path: transcript, session_id: `${sid}-other` }),
      encoding: 'utf8',
      env: cleanEnv(sb, configFile, { AUTOPILOT_FLEET_ADDRESS: 'cookys/openclaw/worker--claude' }),
    });
    assert.strictEqual(otherRes.status, 0);
  });
});

test('(b) & (c) PM hard block keeps blocking past 2 Stops until the handoff is written, then relays once', () => {
  withSandbox((sb) => {
    const configFile = path.join(sb.home, '.autopilot', 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ context_budget: { t2_hard_block: true } }));
    const sid = 'hard-block-sid';
    const stateDir = path.join(sb.work, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const fireAt = Date.now() - 5000;
    fs.writeFileSync(path.join(stateDir, `${sid}.json`), JSON.stringify({
      landFire: { t2: { at: fireAt, blocks: 0, done: false } },
    }));
    const handoffDir = path.join(sb.live, 'handoff');

    const runGate = () => spawnSync(process.execPath, [GATE_HOOK], {
      input: JSON.stringify({ session_id: sid, cwd: sb.work }),
      encoding: 'utf8',
      env: cleanEnv(sb, configFile, { AUTOPILOT_FLEET_ADDRESS: 'cookys/openclaw/pm--claude' }),
    });

    for (let i = 1; i <= 3; i++) {
      const r = runGate();
      assert.strictEqual(r.status, 0);
      const out = JSON.parse(r.stdout.trim());
      assert.strictEqual(out.decision, 'block', `Stop #${i} should be blocked`);
    }

    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(path.join(handoffDir, `${sid}.md`), '# handoff\n');
    const relay = JSON.parse(runGate().stdout.trim());
    assert.strictEqual(relay.decision, 'block');
    assert.match(relay.reason, /handoff 已寫好/);
    assert.strictEqual(runGate().stdout.trim(), '');
  });
});

test('(d) t2_hard_block=false reverts to old max-2-blocks behavior', () => {
  withSandbox((sb) => {
    const configFile = path.join(sb.home, '.autopilot', 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ context_budget: { t2_hard_block: false } }));
    const sid = 'soft-block-sid';
    const stateDir = path.join(sb.work, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, `${sid}.json`), JSON.stringify({
      landFire: { t2: { at: Date.now() - 5000, blocks: 0, done: false } },
    }));

    const runGate = () => spawnSync(process.execPath, [GATE_HOOK], {
      input: JSON.stringify({ session_id: sid, cwd: sb.work }),
      encoding: 'utf8',
      env: cleanEnv(sb, configFile, {}),
    });

    for (let i = 1; i <= 2; i++) {
      const r = runGate();
      assert.strictEqual(JSON.parse(r.stdout.trim()).decision, 'block');
    }
    const third = runGate();
    assert.strictEqual(third.status, 0);
    assert.strictEqual(third.stdout.trim(), '');
  });
});
