'use strict';

/**
 * Hook-level tests for the workflow snapshot (plan 2026-10-13-workflow-snapshot-at-compaction, P1):
 *  - state-checkpoint.js (PreCompact): the file leads with the snapshot; stdout is the bounded snapshot
 *    addressed to the summarizer; AUTOPILOT_PRECOMPACT_STDOUT=0 silences stdout; tool placeholders are
 *    dropped from the transcript tail.
 *  - session-handoff.js (SessionEnd, /clear): the handoff carries a "Workflow state" section.
 * Run: node --test hooks/state-checkpoint-snapshot.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECKPOINT = path.join(__dirname, 'state-checkpoint.js');
const HANDOFF = path.join(__dirname, 'session-handoff.js');
const SID = 'hook-snap-1';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hooksnap-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
  const sm = path.join(root, 'sm'); fs.mkdirSync(sm);
  const live = path.join(root, 'live'); fs.mkdirSync(live, { mode: 0o700 });
  const tc = path.join(root, 'tc'); fs.mkdirSync(tc);
  const runs = path.join(root, 'runs'); fs.mkdirSync(runs);
  const repo = path.join(home, 'repo'); fs.mkdirSync(repo);
  spawnSync('git', ['-C', repo, 'init', '-q', '-b', 'feat/snap']);
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x');
  fs.writeFileSync(path.join(sm, `${SID}.json`), JSON.stringify({
    session_id: SID, level: 'l4', size: 'M', stage: 'implement', unit: 'phase:2/3:wire', root_run_id: 'job-r',
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
  }));
  fs.writeFileSync(path.join(tc, `${SID}.json`), JSON.stringify({ schema: 'autopilot.task-card/1', goal: 'keep the workflow across compaction' }));
  const turn = (role, content) => JSON.stringify({ type: role, timestamp: '2026-10-13T00:00:00Z', message: { role, content } });
  const transcript = path.join(home, 'transcript.jsonl');
  fs.writeFileSync(transcript, [
    turn('user', 'please wire the hook'),
    turn('assistant', [{ type: 'text', text: 'wiring it now' }, { type: 'tool_use', name: 'Bash', input: {} }]),
    turn('assistant', [{ type: 'tool_use', name: 'Bash', input: {} }]),
    turn('user', [{ type: 'tool_result', content: 'ok' }]),
  ].join('\n') + '\n');
  const env = {
    ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_SESSION_MODE_DIR: sm,
    AUTOPILOT_TASK_CARD_DIR: tc, AUTOPILOT_DISPATCH_RUNS_DIR: runs,
  };
  delete env.AUTOPILOT_PRECOMPACT_STDOUT;
  return { root, home, repo, transcript, env, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function checkpoint(sb, extraEnv = {}) {
  const payload = { session_id: SID, transcript_path: sb.transcript, cwd: sb.repo, hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null };
  const r = spawnSync('node', [CHECKPOINT], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...sb.env, ...extraEnv } });
  const file = path.join(sb.home, '.autopilot', `compaction-state-${SID}.md`);
  return { r, content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}

test('PreCompact: the saved file leads with the snapshot, before the machine state and the tail', () => {
  const sb = sandbox();
  try {
    const { r, content } = checkpoint(sb);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(content, 'checkpoint file written');
    assert.ok(content.startsWith('# Autopilot Compaction Checkpoint\n## Workflow Snapshot\n'), content.slice(0, 120));
    const iSnap = content.indexOf('level l4 · size M · stage implement');
    const iMachine = content.indexOf('## Machine State');
    const iTail = content.indexOf('## Transcript Tail');
    assert.ok(iSnap > 0 && iSnap < iMachine && iMachine < iTail, `order ${iSnap} ${iMachine} ${iTail}`);
    assert.match(content, /next legal node after implement: verify/);
    assert.match(content, /task card — goal: keep the workflow across compaction/);
    assert.match(content, /git: branch feat\/snap/);
  } finally { sb.cleanup(); }
});

test('PreCompact: stdout is the bounded snapshot addressed to the summarizer', () => {
  const sb = sandbox();
  try {
    const { r } = checkpoint(sb);
    assert.match(r.stdout, /^Preserve the following workflow state verbatim in the compaction summary/);
    assert.match(r.stdout, /stage implement/);
    assert.ok(Buffer.byteLength(r.stdout) <= 3300, `stdout ${Buffer.byteLength(r.stdout)} bytes`);
  } finally { sb.cleanup(); }
});

test('PreCompact: AUTOPILOT_PRECOMPACT_STDOUT=0 prints nothing but the file still leads with the snapshot', () => {
  const sb = sandbox();
  try {
    const { r, content } = checkpoint(sb, { AUTOPILOT_PRECOMPACT_STDOUT: '0' });
    assert.strictEqual(r.stdout, '');
    assert.ok(content.startsWith('# Autopilot Compaction Checkpoint\n## Workflow Snapshot\n'));
  } finally { sb.cleanup(); }
});

test('PreCompact: tool placeholders are gone from the tail, text turns stay', () => {
  const sb = sandbox();
  try {
    const { content } = checkpoint(sb);
    const tail = content.slice(content.indexOf('## Transcript Tail'));
    assert.match(tail, /please wire the hook/);
    assert.match(tail, /wiring it now/);
    assert.doesNotMatch(tail, /\[tool_use:/);
    assert.doesNotMatch(tail, /\[tool_result:/);
  } finally { sb.cleanup(); }
});

test('PreCompact: with every disk source missing the file is still written, each source named absent', () => {
  const sb = sandbox();
  try {
    fs.rmSync(path.join(sb.root, 'sm'), { recursive: true });
    fs.rmSync(path.join(sb.root, 'tc'), { recursive: true });
    const { r, content } = checkpoint(sb);
    assert.strictEqual(r.status, 0);
    assert.match(content, /session: absent \(no unexpired session-mode marker\)/);
    assert.match(content, /task card: absent/);
    assert.match(content, /git: branch feat\/snap/);
  } finally { sb.cleanup(); }
});

test('SessionEnd /clear: the machine handoff carries the workflow state section', () => {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.home, '.autopilot', 'config.json'), JSON.stringify({ handoff_inject: true }));
    const payload = { session_id: SID, transcript_path: sb.transcript, cwd: sb.repo, hook_event_name: 'SessionEnd', reason: 'clear' };
    const r = spawnSync('node', [HANDOFF], { input: JSON.stringify(payload), encoding: 'utf8', env: sb.env });
    assert.strictEqual(r.status, 0, r.stderr);
    const dir = path.join(sb.home, '.autopilot', 'handoff');
    const body = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))[0];
    assert.ok(body, 'handoff written');
    assert.match(body, /## Workflow state\n\n```\nWorkflow state read from disk/);
    assert.match(body, /stage implement/);
    assert.ok(body.indexOf('## Workflow state') < body.indexOf('## Repo state'));
  } finally { sb.cleanup(); }
});
