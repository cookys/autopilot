#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK_PATH = path.join(__dirname, 'subagent-fleet-task.js');
const TASK_ID = '01M7R609WK44HJP629E6C93Q9N';

function withStub(exitCode = 0, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-fleet-task-test-'));
  const argvLog = path.join(dir, 'fleet-argv.log');
  const stub = path.join(dir, 'fleet');
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${argvLog}"\nexit ${exitCode}\n`,
    { mode: 0o755 },
  );
  try {
    return fn({ dir, argvLog, stub });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeAgentTranscript(subagentsDir, agentId, firstUserText) {
  fs.mkdirSync(subagentsDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { content: firstUserText } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }),
  ];
  fs.writeFileSync(path.join(subagentsDir, `agent-${agentId}.jsonl`), lines.join('\n') + '\n');
}

test('SubagentStop writes stopped progress line when first user message has Fleet-Task', () => {
  withStub(0, ({ dir, argvLog, stub }) => {
    const sid = 'sess-stop-1';
    const mainTp = path.join(dir, `${sid}.jsonl`);
    fs.writeFileSync(mainTp, '');
    writeAgentTranscript(path.join(dir, sid, 'subagents'), 'agent-xyz', `Engine: claude/sonnet\nFleet-Task: ${TASK_ID}\nDo work.`);

    const r = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        hook_event_name: 'SubagentStop',
        session_id: sid,
        agent_id: 'agent-xyz',
        transcript_path: mainTp,
      }),
      env: { ...process.env, FLEET_BIN: stub },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    const log = fs.readFileSync(argvLog, 'utf8');
    assert.match(log, new RegExp(`^task update ${TASK_ID} \\[subagent\\] agent-xyz stopped$`, 'm'));
  });
});

test('PostToolUse(TaskStop) writes cancelled progress line for bound subagent and ignores non-subagent', () => {
  withStub(0, ({ dir, argvLog, stub }) => {
    const sid = 'sess-cancel-1';
    const mainTp = path.join(dir, `${sid}.jsonl`);
    fs.writeFileSync(mainTp, '');
    writeAgentTranscript(path.join(dir, sid, 'subagents'), 'sub-11', `Engine: claude/sonnet\nFleet-Task: ${TASK_ID}\n`);

    const r1 = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'TaskStop',
        session_id: sid,
        transcript_path: mainTp,
        tool_input: { task_id: 'sub-11' },
      }),
      env: { ...process.env, FLEET_BIN: stub },
      encoding: 'utf8',
    });
    assert.equal(r1.status, 0);
    assert.equal(r1.stdout, '');

    const r2 = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'TaskStop',
        session_id: sid,
        transcript_path: mainTp,
        tool_input: { task_id: 'bash-bg-99' },
      }),
      env: { ...process.env, FLEET_BIN: stub },
      encoding: 'utf8',
    });
    assert.equal(r2.status, 0);

    const lines = fs.readFileSync(argvLog, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(lines[0], `task update ${TASK_ID} [subagent] sub-11 cancelled`);
  });
});

test('SubagentStop without Fleet-Task writes nothing and fleet failure stays fail-open', () => {
  withStub(3, ({ dir, argvLog, stub }) => {
    const sid = 'sess-fail-1';
    const subTp = path.join(dir, 'subagents', 'agent-no-task.jsonl');
    writeAgentTranscript(path.join(dir, 'subagents'), 'no-task', 'Explore something without Fleet-Task');

    const r1 = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        hook_event_name: 'SubagentStop',
        session_id: sid,
        agent_id: 'no-task',
        transcript_path: subTp,
      }),
      env: { ...process.env, FLEET_BIN: stub },
      encoding: 'utf8',
    });
    assert.equal(r1.status, 0);
    assert.equal(fs.existsSync(argvLog), false);

    writeAgentTranscript(path.join(dir, 'subagents'), 'with-task', `Fleet-Task: ${TASK_ID}\n`);
    const r2 = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        hook_event_name: 'SubagentStop',
        session_id: sid,
        agent_id: 'with-task',
        transcript_path: path.join(dir, 'subagents', 'agent-with-task.jsonl'),
      }),
      env: { ...process.env, FLEET_BIN: stub },
      encoding: 'utf8',
    });
    assert.equal(r2.status, 0);
    assert.equal(r2.stdout, '');
  });
});
