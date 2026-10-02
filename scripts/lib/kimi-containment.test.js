#!/usr/bin/env node
'use strict';
// Phase 1 (final-panel kimi/agy isolation): kimi seat audit. Every fail-closed void
// condition has its own RED fixture and every one is paired with the clean control
// (K2 fixture -> rc 0), so the audit is proven able to go red AND stay green.
// Fixtures are scrubbed copies of the real K1 (default agent, leaked) / K2 (tool-less
// agent) wire.jsonl captures from the 2026-10-02 spike. No model is called; nothing
// touches the real ~/.kimi-code store.

// RED at 53ddc02f: `Error: Cannot find module './kimi-containment'` (code MODULE_NOT_FOUND) — the lib did not exist.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const LIB = path.join(__dirname, 'kimi-containment.js');
const FIX = path.join(__dirname, 'fixtures', 'kimi-containment');
const { AGENT_NAME, AGENT_MD, auditKimiRun, writeToollessAgent } = require('./kimi-containment');

const tmpDirs = [];
function seatWith(wireText, { sessions = 1 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-contain-'));
  tmpDirs.push(home);
  if (wireText !== null) {
    for (let i = 0; i < sessions; i += 1) {
      const dir = path.join(home, '.kimi-code', 'sessions', 'wd_work_x', `session_${i}`, 'agents', 'main');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'wire.jsonl'), wireText);
    }
  }
  return home;
}
const fixture = (name) => fs.readFileSync(path.join(FIX, name, 'wire.jsonl'), 'utf8');
const lines = (text) => text.split('\n').filter(Boolean);
const rc = (home) => spawnSync(process.execPath, [LIB, 'audit', home], { encoding: 'utf8' });

test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const CLEAN = fixture('k2-clean');

test('K2 tool-less fixture: audit rc=0, no breach', () => {
  const home = seatWith(CLEAN);
  assert.strictEqual(auditKimiRun({ seatHome: home }), null);
  const r = rc(home);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('K1 default-agent fixture (leaked canary): audit rc=1', () => {
  const home = seatWith(fixture('k1-leak'));
  const r = rc(home);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /kimi containment breach/);
});

const breaches = {
  'appended tool.call line': () => CLEAN + JSON.stringify({
    type: 'context.append_loop_event', agentId: 'main',
    event: { type: 'tool.call', uuid: 'u', name: 'Bash', toolCallId: 't' },
  }) + '\n',
  'top-level tool.call record': () => CLEAN + JSON.stringify({ type: 'tool.call', name: 'Bash' }) + '\n',
  'tool_calls encoding on a message': () => CLEAN + JSON.stringify({
    type: 'agent.message.appended', message: { message: { role: 'assistant', tool_calls: [{ id: 'x', name: 'Bash' }] } },
  }) + '\n',
  'toolCalls encoding on a message': () => CLEAN + JSON.stringify({
    type: 'agent.message.appended', message: { message: { role: 'assistant', toolCalls: [{ id: 'x', name: 'Bash' }] } },
  }) + '\n',
  'tool_use finish reason': () => CLEAN + JSON.stringify({
    type: 'context.append_loop_event', event: { type: 'step.end', finishReason: 'tool_use' },
  }) + '\n',
  'tools_snapshot line deleted': () => lines(CLEAN).filter((l) => !l.includes('llm.tools_snapshot')).join('\n') + '\n',
  'unknown record type': () => CLEAN + JSON.stringify({ type: 'brand.new.record', agentId: 'main' }) + '\n',
  'unknown loop event type': () => CLEAN + JSON.stringify({
    type: 'context.append_loop_event', event: { type: 'subagent.spawn' },
  }) + '\n',
  'record without a type': () => CLEAN + JSON.stringify({ agentId: 'main' }) + '\n',
  'non-empty tool snapshot, no tool.call': () => lines(CLEAN).map((l) => {
    const o = JSON.parse(l);
    if (o.type === 'llm.tools_snapshot') o.tools = [{ name: 'Read' }];
    return JSON.stringify(o);
  }).join('\n') + '\n',
  'unparseable line': () => CLEAN + '{not json\n',
  'empty wire file': () => '',
  'agent marker mismatch (other agent bound, snapshot empty, no tool.call)': () => lines(CLEAN).map((l) => {
    const o = JSON.parse(l);
    if (o.type === 'profile.bind') o.profileName = 'agent';
    return JSON.stringify(o);
  }).join('\n') + '\n',
  'agent marker missing (no profile.bind)': () => lines(CLEAN).filter((l) => !l.includes('"profile.bind"')).join('\n') + '\n',
};
for (const [label, make] of Object.entries(breaches)) {
  test(`breach -> rc=1: ${label}`, () => {
    const home = seatWith(make());
    const r = rc(home);
    assert.strictEqual(r.status, 1, `expected breach, stderr=${r.stderr}`);
    assert.ok(auditKimiRun({ seatHome: home }), 'library must return a breach description');
  });
}

test('missing wire file (no session at all) -> rc=1', () => {
  const home = seatWith(null);
  fs.mkdirSync(path.join(home, '.kimi-code'), { recursive: true });
  assert.strictEqual(rc(home).status, 1);
});

test('missing seat home -> rc=1', () => {
  assert.strictEqual(rc(path.join(os.tmpdir(), 'kimi-contain-does-not-exist')).status, 1);
});

test('every session found is audited: one clean + one leaking -> rc=1', () => {
  const home = seatWith(CLEAN);
  const dir = path.join(home, '.kimi-code', 'sessions', 'wd_work_x', 'session_leak', 'agents', 'main');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'wire.jsonl'), fixture('k1-leak'));
  assert.strictEqual(rc(home).status, 1);
});

test('a clean wire next to an exit-0 run is still judged by content only (negative control)', () => {
  // the audit has no exit-code input at all; a leaking wire fails regardless of any rc
  assert.strictEqual(auditKimiRun.length <= 1, true);
  assert.ok(auditKimiRun({ seatHome: seatWith(fixture('k1-leak')) }));
});

test('write: agent file read back intact, has description + empty allowlist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-agent-'));
  tmpDirs.push(dir);
  const file = writeToollessAgent(dir);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), AGENT_MD);
  assert.match(AGENT_MD, /^description: \S/m);
  assert.match(AGENT_MD, /^tools: \[\]$/m);
  assert.match(AGENT_MD, new RegExp(`^name: ${AGENT_NAME}$`, 'm'));
  const r = spawnSync(process.execPath, [LIB, 'write', dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(spawnSync(process.execPath, [LIB, 'name'], { encoding: 'utf8' }).stdout.trim(), AGENT_NAME);
});

test('bad usage -> rc=2', () => {
  assert.strictEqual(spawnSync(process.execPath, [LIB, 'audit'], { encoding: 'utf8' }).status, 2);
});
