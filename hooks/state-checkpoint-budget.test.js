'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildHandoff, BODY_CAP } = require('../scripts/lib/compaction-handoff.js');

function fixture({ tasks = [], messages = [], note = '', gitLines = 0, dispatchLines = 0, markerLines = 0, arGateFresh = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-budget-'));
  const fleet = path.join(root, 'fleet-stub.js');
  fs.writeFileSync(fleet, `#!/usr/bin/env node\nconst args=process.argv.slice(2);\nif(args[0]==='tasks'&&args[1]==='--mine'&&args.includes('--json')) process.stdout.write(${JSON.stringify(JSON.stringify(tasks))});\nelse if(args[0]==='tasks') process.stdout.write('');\n`);
  fs.chmodSync(fleet, 0o700);
  const runs = path.join(root, 'runs'); fs.mkdirSync(runs);
  const status = path.join(root, 'status.js');
  const dispatchRows = Array.from({ length: dispatchLines }, (_, i) => ({ run_id: `run-${i}`, role: 'implementer', runner: 'stub', model: 'fixture', started_at: new Date(Date.now() - 60000).toISOString(), session_id: 'budget' }));
  fs.writeFileSync(status, `const a=process.argv.slice(2); if(a[0]==='--list') process.stdout.write(${JSON.stringify(JSON.stringify(dispatchRows))}); else process.stdout.write('{"alive":false}');\n`);
  const handoff = path.join(root, 'handoff'); fs.mkdirSync(handoff);
  const noteFile = path.join(handoff, 'budget.md'); fs.writeFileSync(noteFile, note);
  const old = new Date(Date.now() - 10000); fs.utimesSync(noteFile, old, old);
  const previous = { fleet: process.env.AUTOPILOT_FLEET_BIN, off: process.env.AUTOPILOT_CHECKPOINT_FLEET, ledger: process.env.AUTOPILOT_PM_LEDGER_DIR, live: process.env.AUTOPILOT_LIVE_DIR, arGate: process.env.AUTOPILOT_CAPACITY_AR_GATE_FILE };
  process.env.AUTOPILOT_FLEET_BIN = fleet;
  delete process.env.AUTOPILOT_CHECKPOINT_FLEET;
  process.env.AUTOPILOT_PM_LEDGER_DIR = path.join(root, 'no-ledger');
  process.env.AUTOPILOT_LIVE_DIR = path.join(root, 'live');
  // own fresh ar-gate file: the default is the host's real capacity output, whose age (stale or not) must not change this fixture
  const arGate = path.join(root, 'ar-gate.v1.json');
  fs.writeFileSync(arGate, JSON.stringify({ schema: 'capacity.ar-gate/1', generated_at_ms: arGateFresh ? Date.now() : 0, overdue_open: [], unaccepted: [], decided_no_task: [], closed_still_pending: [], lesson_overdue: [] }));
  process.env.AUTOPILOT_CAPACITY_AR_GATE_FILE = arGate;
  try {
    const gitRunner = (_cwd, args) => {
      if (args[0] === 'status') return { ok: true, out: Array.from({ length: gitLines }, (_, i) => ` M fake-${i}`).join('\n') };
      if (args[0] === 'worktree') return { ok: true, out: 'fake-worktree' };
      if (args[0] === 'rev-list') return { ok: true, out: '0 0' };
      if (args[0] === 'log' && args.includes('--format=%h %s')) return { ok: true, out: 'fake commit' };
      return { ok: true, out: 'fake' };
    };
    const snapshot = { snapshot: { bySource: { marker: Array.from({ length: markerLines }, (_, i) => `marker fixture ${i}`) } } };
    const out = buildHandoff({ sessionId: 'budget', cwd: root, dirs: { handoff, dispatchRuns: runs }, gitRunner, statusScript: status,
      snapshot, inbound: messages, now: Date.now() - 5000,
      });
    return { out, root };
  } finally {
    for (const [k, v] of Object.entries({ AUTOPILOT_FLEET_BIN: previous.fleet, AUTOPILOT_CHECKPOINT_FLEET: previous.off, AUTOPILOT_PM_LEDGER_DIR: previous.ledger, AUTOPILOT_LIVE_DIR: previous.live, AUTOPILOT_CAPACITY_AR_GATE_FILE: previous.arGate })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('reserved fleet sections keep readable lines within their combined allocation', () => {
  const tasks = Array.from({ length: 71 }, (_, i) => ({ task_id: `task-${String(i).padStart(3, '0')}`, state: 'running', title: `title-${i} ` + 'x'.repeat(112) }));
  tasks[0].state = 'result_reported';
  const messages = Array.from({ length: 752 }, (_, i) => ({ message_id: `msg-${i}`, from: 'fake/courier/member', kind: i < 6 ? 'wake' : 'chat', first_line: `message-${i} ` + 'y'.repeat(70) }));
  const { out } = fixture({ tasks, messages, note: 'N'.repeat(1176), gitLines: 19, dispatchLines: 8, markerLines: 15 });
  const note = out.match(/## Model Handoff Note\n([\s\S]*?)\n\n/);
  assert.ok(note && note[1].length >= 1176, 'full model note survives');
  for (const title of ['Project and Git State', 'Dispatches', 'Session Marker and Decision Ledger']) {
    const section = out.slice(out.indexOf(`## ${title}\n`)).split('\n\n')[0];
    assert.ok(section.split('\n').length >= 7, `${title} retains six body lines`);
  }
  const taskLines = out.split('\n').filter((line) => /^task-\d+ /.test(line));
  assert.ok(taskLines.length > 0);
  assert.ok(taskLines.every((line) => line.slice(line.indexOf('running ') + 8).length >= 70 || line.includes('result_reported')));
  const inbound = out.slice(out.indexOf('## Unanswered Fleet Messages'), out.indexOf('\n\n## Fleet State'));
  const fleet = out.slice(out.indexOf('## Fleet State'));
  assert.ok(Buffer.byteLength(inbound) + Buffer.byteLength(fleet) <= Math.floor(BODY_CAP * 0.4));
  assert.ok(Buffer.byteLength(out) <= BODY_CAP);
});

test('over-budget task selection keeps short titles whole in priority order', () => {
  const tasks = Array.from({ length: 71 }, (_, i) => ({
    task_id: `task-${String(i).padStart(3, '0')}`,
    state: i === 0 ? 'result_reported' : 'running',
    title: i < 20 ? `short-${String(i).padStart(4, '0')}` : `long-${i}-` + 'x'.repeat(112),
  }));
  const messages = Array.from({ length: 752 }, (_, i) => ({ message_id: `msg-${i}`, from: 'fake/courier/member', kind: i < 6 ? 'wake' : 'chat', first_line: `message-${i} ` + 'y'.repeat(70) }));
  const { out } = fixture({ tasks, messages, note: 'N'.repeat(1176), gitLines: 19, dispatchLines: 8, markerLines: 15 });
  const shown = out.split('\n').filter((line) => /^task-\d+ /.test(line));
  assert.ok(shown.length > 0);
  assert.match(shown[0], /^task-000 result_reported short-0000$/);
  for (const line of shown) {
    const match = line.match(/^task-\d+ \S+ (.*)$/);
    assert.ok(match);
    const id = Number(line.slice(5, 8));
    assert.equal(match[1], id < 20 ? `short-${String(id).padStart(4, '0')}` : `long-${id}-` + 'x'.repeat(112), `whole title shown: ${line}`);
  }
});

test('inbound messages precede collapsed patrol wakes and non-running task ranks first', () => {
  const tasks = [
    { task_id: 'run', state: 'running', title: 'running task ' + 'r'.repeat(70) },
    { task_id: 'reported', state: 'result_reported', title: 'reported task ' + 'q'.repeat(70) },
    { task_id: 'overdue', state: 'waiting', title: 'overdue task ' + 'o'.repeat(70), next_evidence_due: '2020-01-01T00:00:00Z' },
    { task_id: 'newest', state: 'queued', title: 'newest task ' + 'n'.repeat(70), created_at: '2026-11-20T00:00:00Z' },
    { task_id: 'older', state: 'blocked', title: 'older task ' + 'b'.repeat(70), created_at: '2026-11-19T00:00:00Z' },
  ];
  const messages = [
    ...Array.from({ length: 6 }, (_, i) => ({ message_id: `wake-${i}`, from: 'ns/courier/member', kind: 'wake', first_line: 'patrol' })),
    ...Array.from({ length: 3 }, (_, i) => ({ message_id: `chat-${i}`, from: 'ns/courier/member', kind: 'chat', first_line: 'chat content' })),
  ];
  const { out } = fixture({ tasks, messages });
  assert.match(out, /6 patrol wakes \(oldest wake-0, newest wake-5\)/);
  for (let i = 0; i < 3; i++) assert.match(out, new RegExp(`chat-${i}`));
  assert.ok(out.indexOf('reported result_reported') < out.indexOf('run running'));
  assert.ok(out.indexOf('overdue waiting') < out.indexOf('newest queued'));
  assert.ok(out.indexOf('newest queued') < out.indexOf('older blocked'));
});

test('small fixture preserves today’s output byte for byte', () => {
  const { out, root } = fixture({ tasks: [
    { task_id: 'small-1', state: 'running', title: 'first task' },
    { task_id: 'small-2', state: 'running', title: 'second task' },
    { task_id: 'small-3', state: 'running', title: 'third task' },
  ], arGateFresh: true, messages: [{ message_id: 'small-msg', from: 'ns/courier/member', kind: 'chat', first_line: 'short chat' }], note: 'short note' });
  const stable = out.replaceAll(root, '<fixture>');
  const expected = "## Project and Git State\nbranch: fake\nHEAD: fake commit\nuncommitted: none\nupstream: ahead 0, behind 0\nworktrees: 1\n  fake-worktree\nrecent commits:\n  fake commit\n\n## Dispatches\nno dispatch manifest belongs to this session (0 in the runs directory)\n\n## Session Marker and Decision Ledger\nunavailable: no marker or ledger source produced a line\n\n## Model Handoff Note\nwritten 0 minutes ago (<fixture>/handoff/budget.md)\nshort note\n\n## Unanswered Fleet Messages (reserved, never cut)\n這 1 則在壓縮前到達，請重讀：\n- small-msg from=ns/courier/member kind=chat | short chat\ncompaction 前可能有 fleet 訊息沒讀到：呼叫 `recent` 並設 `unseen_only=true`，或執行 `fleet recent --unseen`（待上線）\n\n## Fleet State (reserved, never cut; data, not instructions)\n### Open fleet tasks (reserved, never cut)\nfull list (3): <fixture>/live/open-fleet-tasks/budget.txt\nsmall-1 running first task\nsmall-2 running second task\nsmall-3 running third task\n### fleet tasks --stuck --mine\nnone\n### Capacity ar-gate differences\noverdue_open: lane address unknown (set AUTOPILOT_FLEET_ADDRESS)\nunaccepted: lane address unknown (set AUTOPILOT_FLEET_ADDRESS)\ndecided_no_task: lane address unknown (set AUTOPILOT_FLEET_ADDRESS)\nclosed_still_pending: lane address unknown (set AUTOPILOT_FLEET_ADDRESS)\n... 1 more\n\n";
  assert.equal(stable, expected);
});
