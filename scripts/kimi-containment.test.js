#!/usr/bin/env node
'use strict';
// Unit tests for scripts/lib/kimi-containment.js — synthetic wire fixtures only.
// Run: node --test scripts/kimi-containment.test.js < /dev/null

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  AGENT_NAME,
  AGENT_MD,
  writeToollessAgent,
  auditKimiRun,
  isToolAttemptBreach,
} = require('./lib/kimi-containment');

const LIB = path.join(__dirname, 'lib', 'kimi-containment.js');
const FIX = path.join(__dirname, 'lib', 'fixtures', 'kimi-containment');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-contain-scripts-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function seatWith(wireText) {
  const home = fs.mkdtempSync(path.join(TMP, 'seat-'));
  if (wireText !== null) {
    const dir = path.join(home, '.kimi-code', 'sessions', 'wd', 'sess', 'agents', 'main');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'wire.jsonl'), wireText);
  }
  return home;
}

const cleanWire = () => fs.readFileSync(path.join(FIX, 'k2-clean', 'wire.jsonl'), 'utf8');

test('exports: AGENT_NAME and AGENT_MD shape', () => {
  assert.equal(AGENT_NAME, 'toolless-reviewer');
  assert.match(AGENT_MD, /^name: toolless-reviewer$/m);
  assert.match(AGENT_MD, /^tools: \[\]$/m);
});

test('writeToollessAgent: writes and read-back matches', () => {
  const dir = path.join(TMP, 'agents');
  const p = writeToollessAgent(dir);
  assert.equal(p, path.join(dir, `${AGENT_NAME}.md`));
  assert.equal(fs.readFileSync(p, 'utf8'), AGENT_MD);
});

// kimi-containment.js:63 — read-back check needs a path that write succeeds on but read fails; not reproducible portably without mocking fs.
test('writeToollessAgent: throws when read-back fails', {
  skip: 'kimi-containment.js:62 read-back failure needs fs mock on this host',
}, () => {});

test('auditKimiRun: clean K2 fixture returns null', () => {
  const home = seatWith(cleanWire());
  assert.equal(auditKimiRun({ seatHome: home }), null);
});

test('auditKimiRun: missing wire returns breach string', () => {
  const home = seatWith(null);
  fs.mkdirSync(path.join(home, '.kimi-code', 'sessions'), { recursive: true });
  const breach = auditKimiRun({ seatHome: home });
  assert.ok(breach && breach.includes('no kimi wire.jsonl'));
});

test('auditKimiRun: tool-call encoding is a breach', () => {
  const leak = fs.readFileSync(path.join(FIX, 'k1-leak', 'wire.jsonl'), 'utf8');
  const breach = auditKimiRun({ seatHome: seatWith(leak) });
  assert.ok(breach);
});

test('isToolAttemptBreach: true only for model tool-call encoding', () => {
  assert.equal(isToolAttemptBreach('tool-call encoding in kimi wire (context.append_loop_event): Bash'), true);
  assert.equal(isToolAttemptBreach('tool-call encoding in kimi wire (x): non-empty snapshot'), false);
  assert.equal(isToolAttemptBreach('kimi wire empty'), false);
  assert.equal(isToolAttemptBreach(null), false);
});

test('CLI: name prints agent name', () => {
  const r = spawnSync(process.execPath, [LIB, 'name'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', HOME: TMP, TMPDIR: TMP },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), AGENT_NAME);
});

test('CLI: bad usage exits 2', () => {
  assert.equal(spawnSync(process.execPath, [LIB, 'audit'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', HOME: TMP, TMPDIR: TMP },
  }).status, 2);
});