#!/usr/bin/env node
'use strict';
// Phase 1 (final-panel kimi/agy isolation): agy audit checked against the same
// fail-closed void list as the kimi audit. Each condition has its own RED fixture,
// each paired with the clean control (rc 0). No model is called.

// RED at 53ddc02f (phase 1) (7 of 17 failed on the unmodified lib): empty transcript (no steps); toolCalls encoding;
// nested tool call encoding; non-empty tools snapshot field; fallback to another agent named;
// agent marker missing (log names another agent / names nothing). Negative controls above: the clean run stays rc=0.
// Repair r2: agy never names the agent; the marker is real-log shaped (agent=true, agentScript=true, no not-found,
// single agent dir) and applies in cleanroom mode ONLY; default mode is the base audit unchanged.
// RED at ff719bc7 (phase-1 lib, 3 of 32 failed):
//   FAIL cleanroom clean run: agent=true + agentScript=true, single tool-less agent dir -> rc=0
//   FAIL default mode: base conditions unchanged (stricter cleanroom-only checks do not apply)
//   FAIL default mode: real-shaped log with no marker, text-only transcript -> rc=0 (as base)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const LIB = path.join(__dirname, 'agy-containment.js');
const { AGENT_NAME, auditAgyRun } = require('./agy-containment');

const tmpDirs = [];
const step = (o) => JSON.stringify(o);
// Real agy 1.2.14 log lines (two real calls, seat HOME): selected custom agent.
const L_CONV = 'I0924 conversation_manager.go:512] Starting new conversation (agent=true)';
const L_SCRIPT = 'I0924 server.go:1213] Creating new cascade trajectory (agentScript=true)';
const CLEAN_LOG = `I0924 cli_setting_manager.go:92] CLI settings initialized\n${L_CONV}\n${L_SCRIPT}\n`;
// Real-shaped log with NO agent marker at all (what a non-blind run's log may look like).
const UNMARKED_LOG = 'I0924 cli_setting_manager.go:92] CLI settings initialized\n';
const FALLBACK_LOG = 'I0924 cli_setting_manager.go:92] CLI settings initialized\n'
  + 'W0924 session.go:94] Agent "wrong-agent-xyz" not found, falling back to default\n'
  + 'I0924 conversation_manager.go:512] Starting new conversation (agent=false)\n'
  + 'I0924 server.go:1213] Creating new cascade trajectory (agentScript=false)\n';
const CLEAN_STEPS = [
  step({ step_index: 0, type: 'USER_INPUT' }),
  step({ step_index: 1, type: 'PLANNER_RESPONSE' }),
];

// mode: 'default' (non-blind, == base audit) or 'cleanroom'. agents: names of dirs in the seat agents dir.
function run({ log = CLEAN_LOG, steps = CLEAN_STEPS, transcript = true, mode = 'cleanroom', agents = [AGENT_NAME] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-contain-'));
  tmpDirs.push(root);
  const logDir = path.join(root, 'log');
  const brain = path.join(root, 'brain');
  const agentsDir = path.join(root, 'agents');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.join(brain, 'conv1'), { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const name of agents) fs.mkdirSync(path.join(agentsDir, name), { recursive: true });
  if (log !== null) fs.writeFileSync(path.join(logDir, 'agy.log'), log);
  if (transcript) fs.writeFileSync(path.join(brain, 'conv1', 'transcript.jsonl'), steps.join('\n') + '\n');
  const cr = mode === 'cleanroom';
  const argv = [LIB, 'audit', logDir, brain, ...(cr ? ['--cleanroom', agentsDir] : [])];
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8' });
  const opts = cr ? { logDir, brainDir: brain, cleanroom: true, agentsDir } : { logDir, brainDir: brain };
  return { status: r.status, stderr: r.stderr, breach: auditAgyRun(opts) };
}

test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

test('cleanroom clean run: agent=true + agentScript=true, single tool-less agent dir -> rc=0', () => {
  const r = run();
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.breach, null);
});

test('cleanroom fallback: not-found + agent=false -> rc=1', () => {
  const r = run({ log: FALLBACK_LOG });
  assert.strictEqual(r.status, 1);
  assert.ok(r.breach);
});

test('cleanroom: agent=true but a second agent in the seat dir -> rc=1', () => {
  const r = run({ agents: [AGENT_NAME, 'other-agent'] });
  assert.strictEqual(r.status, 1);
  assert.ok(r.breach);
});

test('cleanroom: agent=true but no agentScript line -> rc=1', () => {
  const r = run({ log: `${UNMARKED_LOG}${L_CONV}\n` });
  assert.strictEqual(r.status, 1);
  assert.ok(r.breach);
});

test('cleanroom: agentScript=true but no agent=true line -> rc=1', () => {
  const r = run({ log: `${UNMARKED_LOG}${L_SCRIPT}\n` });
  assert.strictEqual(r.status, 1);
});

test('cleanroom: agent=true, agentScript=true but a not-found line is present -> rc=1', () => {
  const r = run({ log: `${CLEAN_LOG}W0924 session.go:94] Agent "other" not found, falling back to default\n` });
  assert.strictEqual(r.status, 1);
});

test('cleanroom: seat agents dir holds a different single agent -> rc=1', () => {
  const r = run({ agents: ['some-other-agent'] });
  assert.strictEqual(r.status, 1);
});

test('cleanroom: no marker at all (real-shaped log) -> rc=1', () => {
  const r = run({ log: UNMARKED_LOG });
  assert.strictEqual(r.status, 1);
});

// Negative control: default (non-blind) mode is exactly the base audit — a real-shaped
// log with no agent marker at all stays rc 0.
test('default mode: real-shaped log with no marker, text-only transcript -> rc=0 (as base)', () => {
  const r = run({ log: UNMARKED_LOG, mode: 'default' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.breach, null);
});

test('default mode: base conditions unchanged (stricter cleanroom-only checks do not apply)', () => {
  // an empty transcript and a toolCalls-encoded step passed the base audit; they must still pass in default mode
  assert.strictEqual(run({ mode: 'default', steps: [] }).status, 0);
  assert.strictEqual(
    run({ mode: 'default', steps: [...CLEAN_STEPS, step({ step_index: 2, type: 'PLANNER_RESPONSE', toolCalls: [{ name: 'x' }] })] }).status, 0);
  assert.strictEqual(run({ mode: 'default', log: `${UNMARKED_LOG}W0924 Agent "other" not found\n` }).status, 0);
});

// Conditions that are breaches in BOTH modes (base behaviour): paired with the clean controls above.
const shared = {
  'missing log': { log: null },
  'empty log': { log: '' },
  'missing transcript': { transcript: false },
  'unparseable transcript line': { steps: [...CLEAN_STEPS, '{broken'] },
  'unknown step type': { steps: [...CLEAN_STEPS, step({ step_index: 2, type: 'RUN_COMMAND' })] },
  'tool_calls on a step': { steps: [...CLEAN_STEPS, step({ step_index: 2, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command' }] })] },
  'agent fallback (not found line for the tool-less agent)': { log: `Agent "${AGENT_NAME}" not found, falling back to default\n` },
  'rejected deny entry (vocabulary drift)': { log: `${CLEAN_LOG}ignoring invalid deny entry "foo(*)" unknown action\n` },
};
// Breaches only in cleanroom mode (stricter transcript rules).
const cleanroomOnly = {
  'empty transcript (no steps)': { steps: [] },
  'toolCalls encoding': { steps: [...CLEAN_STEPS, step({ step_index: 2, type: 'PLANNER_RESPONSE', toolCalls: [{ name: 'run_command' }] })] },
  'tool.call record type': { steps: [...CLEAN_STEPS, step({ step_index: 2, type: 'tool.call' })] },
  'nested tool call encoding': { steps: [...CLEAN_STEPS, step({ step_index: 2, type: 'PLANNER_RESPONSE', event: { type: 'tool_use' } })] },
  'non-empty tools snapshot field': { steps: [...CLEAN_STEPS, step({ step_index: 2, type: 'PLANNER_RESPONSE', tools_snapshot: { tools: [{ name: 'Bash' }] } })] },
  'fallback to another agent named': { log: `${CLEAN_LOG}WARN Agent "other" not found\n` },
};
for (const mode of ['default', 'cleanroom']) {
  for (const [label, opts] of Object.entries(shared)) {
    test(`${mode} breach -> rc=1: ${label}`, () => {
      const r = run({ ...opts, mode, log: 'log' in opts ? opts.log : (mode === 'default' ? UNMARKED_LOG : CLEAN_LOG) });
      assert.strictEqual(r.status, 1, `expected breach; stderr=${r.stderr}`);
      assert.ok(r.breach);
    });
  }
}
for (const [label, opts] of Object.entries(cleanroomOnly)) {
  test(`cleanroom breach -> rc=1: ${label}`, () => {
    const r = run(opts);
    assert.strictEqual(r.status, 1, `expected breach; stderr=${r.stderr}`);
    assert.ok(r.breach);
  });
}

// Phase-5 repair (agy 1.2.15 layout). Real behaviour observed model-free with a scratch seat HOME:
// agy 1.2.15 migrates <HOME>/.gemini/antigravity-cli/agents -> <HOME>/.gemini/config/agents and leaves an
// ABSOLUTE symlink antigravity-cli/agents -> <HOME>/.gemini/config/agents. Inside the bwrap seat HOME is
// /home/review, so on the host that symlink dangles and the legacy-only audit "cannot list the seat agents dir".
// The audit takes every agy-recognised agents dir and judges the union.
// RED at 92455ca3 (audit takes one dir; 8 of 40 failed, every layout case): the multi-dir cases below fail (dangling alias breach / config dir unread).
function layoutRun({ legacy, config, log = CLEAN_LOG, extraDirs = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-layout-'));
  tmpDirs.push(root);
  const app = path.join(root, 'home', '.gemini', 'antigravity-cli');
  const cfg = path.join(root, 'home', '.gemini', 'config', 'agents');
  fs.mkdirSync(path.join(app, 'log'), { recursive: true });
  fs.mkdirSync(path.join(app, 'brain', 'c1'), { recursive: true });
  fs.writeFileSync(path.join(app, 'log', 'agy.log'), log);
  fs.writeFileSync(path.join(app, 'brain', 'c1', 'transcript.jsonl'), CLEAN_STEPS.join('\n') + '\n');
  const legacyDir = path.join(app, 'agents');
  const mk = (dir, spec) => {
    if (spec === 'absent') return;
    if (spec === 'dangling-alias') { fs.symlinkSync('/home/review/.gemini/config/agents', dir); return; }
    if (spec === 'foreign-alias') { fs.symlinkSync('/somewhere/else', dir); return; }
    fs.mkdirSync(dir, { recursive: true });
    for (const n of spec) fs.mkdirSync(path.join(dir, n), { recursive: true });
  };
  mk(legacyDir, legacy);
  mk(cfg, config);
  const dirs = [cfg, legacyDir, ...extraDirs];
  const r = spawnSync(process.execPath, [LIB, 'audit', path.join(app, 'log'), path.join(app, 'brain'), '--cleanroom', ...dirs], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, breach: auditAgyRun({ logDir: path.join(app, 'log'), brainDir: path.join(app, 'brain'), cleanroom: true, agentsDirs: dirs }) };
}
test('layout 1.2.15 after migration: config/agents holds the agent, legacy path is a dangling alias -> rc=0', () => {
  const r = layoutRun({ legacy: 'dangling-alias', config: [AGENT_NAME] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.breach, null);
});
test('layout 1.2.15 config-only: legacy dir absent -> rc=0', () => {
  const r = layoutRun({ legacy: 'absent', config: [AGENT_NAME] });
  assert.strictEqual(r.status, 0, r.stderr);
});
test('layout legacy-only (agy <= 1.2.14): config dir absent -> rc=0', () => {
  const r = layoutRun({ legacy: [AGENT_NAME], config: 'absent' });
  assert.strictEqual(r.status, 0, r.stderr);
});
test('layout both real dirs, same single agent (write-both seat, rename failed) -> rc=0', () => {
  const r = layoutRun({ legacy: [AGENT_NAME], config: [AGENT_NAME] });
  assert.strictEqual(r.status, 0, r.stderr);
});
test('layout: a second agent in EITHER location -> rc=1', () => {
  assert.strictEqual(layoutRun({ legacy: [AGENT_NAME, 'x'], config: [AGENT_NAME] }).status, 1);
  assert.strictEqual(layoutRun({ legacy: [AGENT_NAME], config: [AGENT_NAME, 'x'] }).status, 1);
  assert.strictEqual(layoutRun({ legacy: ['x'], config: [AGENT_NAME] }).status, 1);
});
test('layout fail-closed: no listable agents dir at all (both absent / only an alias) -> rc=1', () => {
  assert.strictEqual(layoutRun({ legacy: 'absent', config: 'absent' }).status, 1);
  assert.strictEqual(layoutRun({ legacy: 'dangling-alias', config: 'absent' }).status, 1);
});
test('layout fail-closed: legacy symlink that points anywhere but a config/agents dir -> rc=1', () => {
  assert.strictEqual(layoutRun({ legacy: 'foreign-alias', config: [AGENT_NAME] }).status, 1);
});
test('layout: empty config/agents (agent not there) -> rc=1', () => {
  assert.strictEqual(layoutRun({ legacy: 'absent', config: [] }).status, 1);
});
