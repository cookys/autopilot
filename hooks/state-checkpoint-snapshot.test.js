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
    // BL-0181: hooks read $AUTOPILOT_CONFIG_FILE (run.sh pins it); aim it at the sandbox home's config.
    ...process.env, HOME: home, AUTOPILOT_CONFIG_FILE: path.join(home, '.autopilot', 'config.json'), AUTOPILOT_LIVE_DIR: live, AUTOPILOT_SESSION_MODE_DIR: sm,
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

// A `git` shim on PATH that logs each call, then runs the real one. The snapshot's git source must
// run once per PreCompact however many sizes it is rendered at (file and stdout).
function gitCalls(sb, extraEnv = {}) {
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const bin = path.join(sb.root, 'shim'); fs.mkdirSync(bin);
  const log = path.join(sb.root, 'git-calls.log');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$@" >> "${log}"\nexec "${real}" "$@"\n`, { mode: 0o755 });
  const { r } = checkpoint(sb, { PATH: `${bin}:${process.env.PATH}`, ...extraEnv });
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return lines.filter((l) => /status --porcelain=v2/.test(l)).length;
}

test('PreCompact: the snapshot is collected once (git runs once) with the stdout copy on', () => {
  const sb = sandbox();
  try { assert.strictEqual(gitCalls(sb), 1); } finally { sb.cleanup(); }
});

test('PreCompact: the snapshot is collected once (git runs once) with the stdout copy off', () => {
  const sb = sandbox();
  try { assert.strictEqual(gitCalls(sb, { AUTOPILOT_PRECOMPACT_STDOUT: '0' }), 1); } finally { sb.cleanup(); }
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

test('SessionEnd /clear: a task card goal holding a ``` run cannot break the workflow fence', () => {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.root, 'tc', `${SID}.json`), JSON.stringify({ schema: 'autopilot.task-card/1', goal: 'fix the ```json fence\n```` and the rest' }));
    fs.writeFileSync(path.join(sb.home, '.autopilot', 'config.json'), JSON.stringify({ handoff_inject: true }));
    const payload = { session_id: SID, transcript_path: sb.transcript, cwd: sb.repo, hook_event_name: 'SessionEnd', reason: 'clear' };
    const r = spawnSync('node', [HANDOFF], { input: JSON.stringify(payload), encoding: 'utf8', env: sb.env });
    assert.strictEqual(r.status, 0, r.stderr);
    const dir = path.join(sb.home, '.autopilot', 'handoff');
    const body = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))[0];
    const start = body.indexOf('## Workflow state');
    const end = body.indexOf('## Repo state');
    const sec = body.slice(start, end).split('\n');
    const opener = sec.find((l) => /^`{3,}$/.test(l));
    assert.ok(opener, 'a fence opens the block');
    assert.ok(opener.length >= 5, `fence is longer than the longest inner run (got ${opener.length})`);
    const fences = sec.filter((l) => /^`{3,}\s*$/.test(l));
    assert.deepStrictEqual(fences, [opener, opener], 'exactly one open and one close, same length');
    assert.ok(sec.some((l) => l.includes('```json fence')), 'the content is intact');
  } finally { sb.cleanup(); }
});

// Handoff body for a sandbox repo after `prep(sb)` has shaped it.
function handoffBody(sb, prep) {
  prep(sb);
  fs.writeFileSync(path.join(sb.home, '.autopilot', 'config.json'), JSON.stringify({ handoff_inject: true }));
  const payload = { session_id: SID, transcript_path: sb.transcript, cwd: sb.repo, hook_event_name: 'SessionEnd', reason: 'clear' };
  const r = spawnSync('node', [HANDOFF], { input: JSON.stringify(payload), encoding: 'utf8', env: sb.env });
  assert.strictEqual(r.status, 0, r.stderr);
  const dir = path.join(sb.home, '.autopilot', 'handoff');
  return fs.readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))[0];
}
// The lines between the "## <from>" heading and the "## <to>" heading. (`git status -sb` itself prints
// a "## branch" line, so "any ## line" cannot end a section.)
function section(body, from, to) {
  const a = body.indexOf(from);
  return body.slice(a, body.indexOf(to, a)).split('\n');
}
function assertDynamicFence(sec, marker) {
  const fences = sec.filter((l) => /^`{3,}\s*$/.test(l));
  assert.strictEqual(fences.length, 2, `exactly one open and one close fence, got ${JSON.stringify(fences)}`);
  assert.strictEqual(fences[0], fences[1], 'open and close fence are the same');
  assert.ok(fences[0].length >= 4, `fence longer than the ${marker.length}-backtick run inside (got ${fences[0].length})`);
  assert.ok(sec.some((l) => l.includes(marker)), 'the content is intact');
}

test('SessionEnd /clear: a commit subject holding ``` gets a longer fence in Recent commits', () => {
  const sb = sandbox();
  try {
    const body = handoffBody(sb, (x) => {
      spawnSync('git', ['-C', x.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'fix the ``` fence']);
    });
    assertDynamicFence(section(body, '## Recent commits', '## Last action'), '```');
  } finally { sb.cleanup(); }
});

test('SessionEnd /clear: a file name holding ``` gets a longer fence in the git status block', () => {
  const sb = sandbox();
  try {
    const body = handoffBody(sb, (x) => fs.writeFileSync(path.join(x.repo, 'a```b.txt'), 'x'));
    const sec = section(body, '## Repo state', '## Recent commits');
    // Only the git status block sits in Repo state; the Recent commits block starts at the next heading.
    assertDynamicFence(sec, 'a```b.txt');
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

// --- P4: PostCompact check ---------------------------------------------------------------------
function postCompact(sb, summary) {
  const payload = { session_id: SID, transcript_path: sb.transcript, cwd: sb.repo, hook_event_name: 'PostCompact', trigger: 'auto', compact_summary: summary };
  const r = spawnSync('node', [CHECKPOINT], { input: JSON.stringify(payload), encoding: 'utf8', env: sb.env });
  const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const adv = readJsonl(path.join(sb.root, 'live', 'advisories', `${SID}.jsonl`));
  const log = readJsonl(path.join(sb.home, '.autopilot', '.state-checkpoint.log'));
  return { r, adv, log };
}

test('PostCompact: a summary without the branch and the stage raises one advisory and writes no checkpoint', () => {
  const sb = sandbox();
  try {
    const { r, adv, log } = postCompact(sb, 'We were fixing some hook behaviour.');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(adv.length, 1);
    assert.strictEqual(adv[0].kind, 'compact-summary-lost-state');
    assert.match(adv[0].text, /branch feat\/snap or the stage implement/);
    assert.strictEqual(log[log.length - 1].status, 'postcompact_summary_missing');
    assert.deepStrictEqual(log[log.length - 1].missing, ['branch feat/snap', 'stage implement']);
    assert.strictEqual(fs.existsSync(path.join(sb.home, '.autopilot', `compaction-state-${SID}.md`)), false);
  } finally { sb.cleanup(); }
});

test('PostCompact: a summary that names the branch and the stage is silent', () => {
  const sb = sandbox();
  try {
    const { r, adv, log } = postCompact(sb, 'On branch feat/snap, stage implement (phase 2 of 3).');
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(adv, []);
    assert.strictEqual(log[log.length - 1].status, 'postcompact_ok');
  } finally { sb.cleanup(); }
});

test('PostCompact: a stage that only appears inside a longer stage name does not count', () => {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.root, 'sm', `${SID}.json`), JSON.stringify({ session_id: SID, level: 'l4', size: 'L', stage: 'plan', expires_at: new Date(Date.now() + 3600e3).toISOString() }));
    const { adv } = postCompact(sb, 'branch feat/snap is at plan-review now');
    assert.strictEqual(adv.length, 1);
    assert.match(adv[0].text, /stage plan/);
  } finally { sb.cleanup(); }
});

test('PostCompact: a stage that only appears as the tail of a longer word does not count', () => {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.root, 'sm', `${SID}.json`), JSON.stringify({ session_id: SID, level: 'l4', size: 'L', stage: 'plan', expires_at: new Date(Date.now() + 3600e3).toISOString() }));
    const { adv } = postCompact(sb, 'branch feat/snap, we are in preplan now');
    assert.strictEqual(adv.length, 1);
    assert.match(adv[0].text, /stage plan/);
  } finally { sb.cleanup(); }
});

test('PostCompact: the stage as the head of a longer word (planning) does not count', () => {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.root, 'sm', `${SID}.json`), JSON.stringify({ session_id: SID, level: 'l4', size: 'L', stage: 'plan', expires_at: new Date(Date.now() + 3600e3).toISOString() }));
    const { adv } = postCompact(sb, 'branch feat/snap, we are still planning');
    assert.strictEqual(adv.length, 1);
    assert.match(adv[0].text, /stage plan/);
  } finally { sb.cleanup(); }
});

test('PostCompact: the stage after a hyphen (re-implement) does not count', () => {
  const sb = sandbox();
  try {
    const { adv } = postCompact(sb, 'branch feat/snap, we will re-implement it');
    assert.strictEqual(adv.length, 1);
    assert.match(adv[0].text, /stage implement/);
  } finally { sb.cleanup(); }
});

test('PostCompact: a summary that starts with the stage name counts (the ^ anchor)', () => {
  const sb = sandbox();
  try {
    const { adv } = postCompact(sb, 'implement is where we are; branch feat/snap');
    assert.deepStrictEqual(adv, []);
  } finally { sb.cleanup(); }
});

// Each spelling glues a word character to the stage on one side. Dropping `0-9` or `_` from either
// side's character class, or dropping the `^|` start alternative, must turn one of these red.
for (const word of ['plan2', 'plan_x', '2plan', 'pre_plan']) {
  test(`PostCompact: the stage glued to a digit or underscore (${word}) does not count`, () => {
    const sb = sandbox();
    try {
      fs.writeFileSync(path.join(sb.root, 'sm', `${SID}.json`), JSON.stringify({ session_id: SID, level: 'l4', size: 'L', stage: 'plan', expires_at: new Date(Date.now() + 3600e3).toISOString() }));
      const { adv } = postCompact(sb, `branch feat/snap, now at ${word} here`);
      assert.strictEqual(adv.length, 1);
      assert.match(adv[0].text, /stage plan/);
    } finally { sb.cleanup(); }
  });
}

test('PostCompact: the stage match ignores case', () => {
  const sb = sandbox();
  try {
    const { adv } = postCompact(sb, 'branch feat/snap, Stage: IMPLEMENT');
    assert.deepStrictEqual(adv, []);
  } finally { sb.cleanup(); }
});

test('PostCompact: no marker and no git work tree means nothing to check, nothing raised', () => {
  const sb = sandbox();
  try {
    fs.rmSync(path.join(sb.root, 'sm'), { recursive: true });
    fs.rmSync(path.join(sb.repo, '.git'), { recursive: true });
    const { r, adv, log } = postCompact(sb, 'anything');
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(adv, []);
    assert.strictEqual(log[log.length - 1].status, 'postcompact_ok');
  } finally { sb.cleanup(); }
});

test('hooks.json wires PostCompact to the same state-checkpoint hook', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8')).hooks;
  const cmds = (hooks.PostCompact || []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepStrictEqual(cmds, ['node ${CLAUDE_PLUGIN_ROOT}/hooks/state-checkpoint.js']);
});
