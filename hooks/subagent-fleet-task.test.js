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

const SHA = 'a'.repeat(40);

function writeAgentTranscript(subagentsDir, agentId, firstUserText, finalText = 'working') {
  fs.mkdirSync(subagentsDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { content: firstUserText } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: finalText }] } }),
  ];
  fs.writeFileSync(path.join(subagentsDir, `agent-${agentId}.jsonl`), lines.join('\n') + '\n');
}

test('SubagentStop writes stopped progress line when first user message has Fleet-Task', () => {
  withStub(0, ({ dir, argvLog, stub }) => {
    const sid = 'sess-stop-1';
    const mainTp = path.join(dir, `${sid}.jsonl`);
    fs.writeFileSync(mainTp, '');
    writeAgentTranscript(path.join(dir, sid, 'subagents'), 'agent-xyz', `Engine: claude/sonnet\nRole: implementer\nFleet-Task: ${TASK_ID}\nDo work.`, SHA);

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
    assert.equal(log.trim().split('\n').length, 1);
    assert.match(log, new RegExp(`^task update ${TASK_ID} \\[dispatch:implementer\\] agent-xyz stopped sha=${SHA} log=\\S*agent-agent-xyz\\.jsonl$`, 'm'));
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
    assert.match(lines[0], new RegExp(`^task update ${TASK_ID} \\[dispatch:subagent\\] sub-11 cancelled sha=- log=\\S+$`));
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

test('P5: PostToolUse(Agent) at launch writes nothing', () => {
  withStub(0, ({ dir, argvLog, stub }) => {
    const sid = 'sess-launch-1';
    const mainTp = path.join(dir, `${sid}.jsonl`);
    fs.writeFileSync(mainTp, '');
    writeAgentTranscript(path.join(dir, sid, 'subagents'), 'sub-l', `Fleet-Task: ${TASK_ID}\n`);
    const r = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: sid, transcript_path: mainTp,
        tool_input: { prompt: `Fleet-Task: ${TASK_ID}` }, tool_response: { agentId: 'sub-l' } }),
      env: { ...process.env, FLEET_BIN: stub }, encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(fs.existsSync(argvLog), false);
  });
});

test('P5: brief without Fleet-Task falls back to the session marker fleet_task_id', () => {
  withStub(0, ({ dir, argvLog, stub }) => {
    const sid = 'sess-marker-1';
    const markers = path.join(dir, 'markers');
    fs.mkdirSync(markers, { recursive: true });
    fs.writeFileSync(path.join(markers, `${sid}.json`), JSON.stringify({
      level: 'l3', expires_at: new Date(Date.now() + 3600e3).toISOString(), fleet_task_id: TASK_ID,
    }));
    const mainTp = path.join(dir, `${sid}.jsonl`);
    fs.writeFileSync(mainTp, '');
    writeAgentTranscript(path.join(dir, sid, 'subagents'), 'mk-1', 'Engine: sonnet\nRole: reviewer\nno task here');
    const r = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ hook_event_name: 'SubagentStop', session_id: sid, agent_id: 'mk-1', transcript_path: mainTp }),
      env: { ...process.env, FLEET_BIN: stub, AUTOPILOT_SESSION_MODE_DIR: markers }, encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.match(fs.readFileSync(argvLog, 'utf8'), new RegExp(`^task update ${TASK_ID} \\[dispatch:reviewer\\] mk-1 stopped sha=- log=`, 'm'));
  });
});

test('P5: fleet stub that sleeps past the timeout -> exit 0, stdout unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-fleet-task-sleep-'));
  try {
    const stub = path.join(dir, 'fleet');
    fs.writeFileSync(stub, '#!/usr/bin/env bash\nsleep 3\n', { mode: 0o755 });
    const sid = 'sess-sleep-1';
    const mainTp = path.join(dir, `${sid}.jsonl`);
    fs.writeFileSync(mainTp, '');
    writeAgentTranscript(path.join(dir, sid, 'subagents'), 'sl-1', `Fleet-Task: ${TASK_ID}\n`);
    const t0 = Date.now();
    const r = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ hook_event_name: 'SubagentStop', session_id: sid, agent_id: 'sl-1', transcript_path: mainTp }),
      env: { ...process.env, FLEET_BIN: stub, AUTOPILOT_FLEET_WRITEBACK_TIMEOUT_MS: '300' }, encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.ok(Date.now() - t0 < 2500, 'hook returned at the timeout, not after the stub');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
