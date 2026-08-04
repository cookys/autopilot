/**
 * Tests for orchestrator-edit-gate: pure decision lib + wrapper black-box.
 * Run: node --test hooks/orchestrator-edit-gate.test.js
 *
 * Panel-finding regressions guarded here:
 * - SPIKE-1 canary: subagent identity = payload `agent_id` PRESENCE (empirical
 *   CC 2.1.208 schema — the fixture mirrors a real captured payload). If a CC
 *   update changes this schema, these tests are the tripwire.
 * - MiniMax WHERE-not-WHO: depth-0 editing inside a dispatch worktree is STILL
 *   denied — worker territory protection must not double as a depth-0 backdoor.
 * - Stale-marker/mode-change: an l3 marker (set by /l3 re-entry or --solo)
 *   neutralizes the gate; an expired marker is a no-op.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIB = path.join(__dirname, 'orchestrator-edit-gate-lib.js');
const HOOK = path.join(__dirname, 'orchestrator-edit-gate.js');
const CODEX_PLUGIN_ROOT = path.join(__dirname, '..', 'platforms', 'codex', 'plugin');
const CODEX_HOOK = path.join(CODEX_PLUGIN_ROOT, 'hooks', 'pre-effect.js');
const {
  decide,
  decideCodexPreEffect,
  classifyCodexGitProbe,
  isAllowlisted,
} = require(LIB);

// ---- pure lib ----

test('decide: no marker ⇒ allow', () => {
  assert.strictEqual(decide({ markerLevel: null, isSubagent: false, inRepoRoot: true, inDispatchWorktree: false, allowlisted: false }).action, 'allow');
});

test('decide: l3 marker ⇒ allow (inline-by-design)', () => {
  assert.strictEqual(decide({ markerLevel: 'l3', isSubagent: false, inRepoRoot: true, inDispatchWorktree: false, allowlisted: false }).action, 'allow');
});

test('decide: l5 + depth-0 + product path ⇒ gate', () => {
  const d = decide({ markerLevel: 'l5', isSubagent: false, inRepoRoot: true, inDispatchWorktree: false, allowlisted: false });
  assert.strictEqual(d.action, 'gate');
  assert.match(d.reason, /dispatch/i);
});

test('decide: l5 + SUBAGENT ⇒ allow (SPIKE-1 identity)', () => {
  assert.strictEqual(decide({ markerLevel: 'l5', isSubagent: true, inRepoRoot: true, inDispatchWorktree: false, allowlisted: false }).action, 'allow');
});

test('decide: l5 + depth-0 + allowlisted ⇒ allow', () => {
  assert.strictEqual(decide({ markerLevel: 'l5', isSubagent: false, inRepoRoot: true, inDispatchWorktree: false, allowlisted: true }).action, 'allow');
});

test('decide: l5 + depth-0 + dispatch worktree ⇒ gate (WHERE-not-WHO)', () => {
  const d = decide({ markerLevel: 'l4', isSubagent: false, inRepoRoot: false, inDispatchWorktree: true, allowlisted: false });
  assert.strictEqual(d.action, 'gate');
});

test('decide: l5 + depth-0 + outside repo & worktrees ⇒ allow (scratchpad etc.)', () => {
  assert.strictEqual(decide({ markerLevel: 'l5', isSubagent: false, inRepoRoot: false, inDispatchWorktree: false, allowlisted: false }).action, 'allow');
});

test('isAllowlisted: tracking/config/plans paths pass, product paths fail', () => {
  assert.strictEqual(isAllowlisted('docs/projects/2026-07-14-x/README.md'), true);
  assert.strictEqual(isAllowlisted('.claude/settings.json'), true);
  assert.strictEqual(isAllowlisted('.autopilot/state.json'), true);
  assert.strictEqual(isAllowlisted('docs/plans/2026-07-14-x.md'), true);
  assert.strictEqual(isAllowlisted('src/engine/autopilot-engine.js'), false);
  assert.strictEqual(isAllowlisted('docs/README.md'), false);
  // GPT-OSS finding: a handoff-named file in product territory is NOT allowlisted
  assert.strictEqual(isAllowlisted('src/handoff.md'), false);
});

test('decideCodexPreEffect: no marker blocks effect-capable repository tools', () => {
  const d = decideCodexPreEffect({
    inRepository: true,
    effectCapable: true,
    lifecycleEntry: false,
    managedEngineEntry: false,
    markerStatus: 'absent',
    markerReason: 'session marker absent',
    markerLevel: null,
  });
  assert.strictEqual(d.action, 'gate');
  assert.strictEqual(d.reasonCode, 'DEV_FLOW_ENTRY_REQUIRED');
});

test('decideCodexPreEffect: non-repository and read-only activity are no-ops', () => {
  assert.strictEqual(decideCodexPreEffect({
    inRepository: false, effectCapable: true,
  }).action, 'allow');
  assert.strictEqual(decideCodexPreEffect({
    inRepository: true, effectCapable: false,
  }).action, 'allow');
});

test('decideCodexPreEffect: fixed lifecycle entry remains available without a marker', () => {
  assert.strictEqual(decideCodexPreEffect({
    inRepository: true,
    effectCapable: true,
    lifecycleEntry: true,
    managedEngineEntry: false,
    markerStatus: 'absent',
    markerLevel: null,
  }).action, 'allow');
});

test('decideCodexPreEffect: l3 preserves inline effects', () => {
  assert.strictEqual(decideCodexPreEffect({
    inRepository: true,
    effectCapable: true,
    lifecycleEntry: false,
    managedEngineEntry: false,
    markerStatus: 'valid',
    markerLevel: 'l3',
  }).action, 'allow');
});

test('decideCodexPreEffect: managed levels block depth-0 but admit fixed Engine entry', () => {
  const direct = decideCodexPreEffect({
    inRepository: true,
    effectCapable: true,
    lifecycleEntry: false,
    managedEngineEntry: false,
    markerStatus: 'valid',
    markerLevel: 'l5',
  });
  assert.strictEqual(direct.action, 'gate');
  assert.strictEqual(direct.reasonCode, 'DEPTH_ZERO_MUTATION_FORBIDDEN');
  assert.strictEqual(decideCodexPreEffect({
    inRepository: true,
    effectCapable: true,
    lifecycleEntry: false,
    managedEngineEntry: true,
    markerStatus: 'valid',
    markerLevel: 'l5',
  }).action, 'allow');
});

test('classifyCodexGitProbe: only the real non-repository result is a no-op', () => {
  assert.deepStrictEqual(classifyCodexGitProbe({
    status: 128,
    stdout: '',
    stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    error: null,
    signal: null,
  }), { status: 'not_repository', root: null, reason: null });
  assert.strictEqual(classifyCodexGitProbe({
    status: null,
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }),
    signal: null,
  }).status, 'error');
  assert.strictEqual(classifyCodexGitProbe({
    status: null,
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
    signal: 'SIGTERM',
  }).status, 'error');
});

function setupCodexGate() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-oeg-'));
  const repo = path.join(base, 'repo');
  const markers = path.join(base, 'markers');
  fs.mkdirSync(repo, { recursive: true });
  assert.strictEqual(spawnSync('git', ['init', '-q', repo]).status, 0);
  return {
    base,
    repo,
    markers,
    env: {
      ...process.env,
      PLUGIN_ROOT: CODEX_PLUGIN_ROOT,
      AUTOPILOT_SESSION_MODE_DIR: markers,
      AUTOPILOT_SESSION_ID: 'codex-live-session',
      CODEX_THREAD_ID: 'codex-live-session',
    },
  };
}

function codexPayload(cwd, command, toolName = 'shell') {
  return {
    hook_event_name: 'PreToolUse',
    cwd,
    session_id: 'codex-live-session',
    tool_name: toolName,
    tool_input: command === null ? { path: cwd } : { command },
  };
}

function runCodexHook(value, env) {
  return spawnSync(process.execPath, [CODEX_HOOK], {
    input: JSON.stringify(value), encoding: 'utf8', env,
  });
}

function setCodexMarker(env, repo, level) {
  const result = spawnSync('node', [path.join(CODEX_PLUGIN_ROOT, 'scripts', 'session-mode.js'),
    'set', '--level', level, '--entry-level', level, '--repo-root', repo], {
    env, cwd: repo, encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
}

test('Codex wrapper: no marker returns the live-proven structured denial', () => {
  const { repo, env } = setupCodexGate();
  const result = runCodexHook(codexPayload(repo, 'touch denied'), env);
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    decision: 'block',
    reason: 'DEV_FLOW_ENTRY_REQUIRED: session marker absent',
  });
});

test('Codex wrapper: fixed session-mode entry is available before a marker exists', () => {
  const { repo, markers, env } = setupCodexGate();
  const hookLog = path.join(markers, 'hook-log.jsonl');
  env.AUTOPILOT_CODEX_PRE_EFFECT_TEST_LOG = hookLog;
  fs.mkdirSync(markers, { recursive: true });
  fs.writeFileSync(path.join(markers, 'stale-corrupt.json'), '{{{');
  const script = path.join(CODEX_PLUGIN_ROOT, 'scripts', 'session-mode.js');
  const command = `AUTOPILOT_SESSION_ID=codex-live-session node "${script}" set `
    + `--level l5 --entry-level l5 --repo-root "${repo}"`;
  const result = runCodexHook(codexPayload(repo, command), env);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  const row = JSON.parse(fs.readFileSync(hookLog, 'utf8'));
  assert.strictEqual(row.command_class, 'lifecycle_entry');
  assert.match(row.session_id_sha256, /^[a-f0-9]{64}$/u);
});

test('Codex wrapper: l3 allows inline shell while l5 blocks depth-0 shell', () => {
  const l3 = setupCodexGate();
  setCodexMarker(l3.env, l3.repo, 'l3');
  assert.strictEqual(runCodexHook(codexPayload(l3.repo, 'touch inline'), l3.env).stdout, '');

  const l5 = setupCodexGate();
  setCodexMarker(l5.env, l5.repo, 'l5');
  const blocked = runCodexHook(codexPayload(l5.repo, 'touch depth-zero'), l5.env);
  assert.strictEqual(blocked.status, 0);
  assert.strictEqual(JSON.parse(blocked.stdout).decision, 'block');
  assert.match(JSON.parse(blocked.stdout).reason, /DEPTH_ZERO_MUTATION_FORBIDDEN/u);
});

test('Codex wrapper: l5 admits only the fixed managed Engine entry', () => {
  const { base, repo, env } = setupCodexGate();
  const hookLog = path.join(base, 'hook-log.jsonl');
  env.AUTOPILOT_CODEX_PRE_EFFECT_TEST_LOG = hookLog;
  setCodexMarker(env, repo, 'l5');
  const script = path.join(CODEX_PLUGIN_ROOT, 'bin', 'autopilot.js');
  const command = `AUTOPILOT_SESSION_ID=codex-live-session AUTOPILOT_LEVEL=l5 node "${script}" `
    + 'engine implement-review --campaign-contract campaign.json';
  const result = runCodexHook(codexPayload(repo, command), env);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  const row = JSON.parse(fs.readFileSync(hookLog, 'utf8'));
  assert.strictEqual(row.command_class, 'managed_engine_entry');
  assert.match(row.session_id_sha256, /^[a-f0-9]{64}$/u);
});

test('Codex wrapper: corrupt marker denies; read-only and non-repository calls no-op', () => {
  const { base, repo, markers, env } = setupCodexGate();
  fs.mkdirSync(markers, { recursive: true });
  fs.writeFileSync(path.join(markers, 'codex-live-session.json'), '{{{');
  assert.strictEqual(JSON.parse(runCodexHook(codexPayload(repo, 'touch nope'), env).stdout).decision, 'block');
  assert.strictEqual(runCodexHook(codexPayload(repo, null, 'read_file'), env).stdout, '');
  assert.strictEqual(runCodexHook(codexPayload(base, 'touch scratch'), env).stdout, '');
});

test('Codex wrapper: a marker cannot be reused by another host session', () => {
  const { repo, markers, env } = setupCodexGate();
  setCodexMarker(env, repo, 'l3');
  const original = path.join(markers, 'codex-live-session.json');
  const copied = path.join(markers, 'another-codex-session.json');
  fs.copyFileSync(original, copied);
  const mismatched = codexPayload(repo, 'touch denied');
  mismatched.session_id = 'another-codex-session';
  const result = runCodexHook(mismatched, env);
  assert.strictEqual(JSON.parse(result.stdout).decision, 'block');
  assert.match(JSON.parse(result.stdout).reason, /host-session mismatch/u);
});

test('Codex wrapper: host session IDs that would normalize ambiguously are denied', () => {
  const { repo, env } = setupCodexGate();
  const ambiguous = codexPayload(repo, 'touch denied');
  ambiguous.session_id = 'codex/session';
  const result = runCodexHook(ambiguous, env);
  assert.strictEqual(JSON.parse(result.stdout).decision, 'block');
  assert.match(JSON.parse(result.stdout).reason, /payload identity is invalid/u);
});

test('Codex wrapper: git spawn failures block effect-capable tools but read-only remains a no-op', () => {
  const { base, repo, env } = setupCodexGate();
  const emptyPath = path.join(base, 'empty-path');
  fs.mkdirSync(emptyPath);
  const missingGitEnv = { ...env, PATH: emptyPath };
  const blocked = runCodexHook(codexPayload(repo, 'touch denied'), missingGitEnv);
  assert.strictEqual(JSON.parse(blocked.stdout).decision, 'block');
  assert.match(JSON.parse(blocked.stdout).reason, /git probe failed \(ENOENT\)/u);
  assert.strictEqual(
    runCodexHook(codexPayload(repo, null, 'read_file'), missingGitEnv).stdout,
    '',
  );
});

test('Codex wrapper: a timed-out Git probe returns structured denial', () => {
  const { base, repo, env } = setupCodexGate();
  const slowPath = path.join(base, 'slow-path');
  const slowGit = path.join(slowPath, 'git');
  fs.mkdirSync(slowPath);
  fs.writeFileSync(slowGit, '#!/bin/sh\n/bin/sleep 30\n');
  fs.chmodSync(slowGit, 0o700);
  const result = runCodexHook(codexPayload(repo, 'touch denied'), {
    ...env,
    PATH: slowPath,
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(JSON.parse(result.stdout).decision, 'block');
  assert.match(JSON.parse(result.stdout).reason, /git probe failed \(ETIMEDOUT\)/u);
});

// ---- wrapper black-box ----

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oeg-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs', 'projects'), { recursive: true });
  const init = spawnSync('git', ['init', repo], { encoding: 'utf8' });
  assert.strictEqual(init.status, 0, init.stderr);
  const markers = path.join(base, 'markers');
  const sid = `t-${path.basename(base)}`;
  const env = {
    ...process.env,
    AUTOPILOT_HOOK_ORCHESTRATOR_EDIT_GATE: '1',
    AUTOPILOT_SESSION_MODE_DIR: markers,
    AUTOPILOT_ORCH_EDIT_GATE_MODE: 'block',
    CLAUDE_CODE_SESSION_ID: sid,
  };
  return { base, repo, env, sid };
}

function setMarker(env, repo, level, extra = []) {
  const r = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'session-mode.js'),
    'set', '--level', level, '--repo-root', repo, ...extra], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
}

// Payload fixtures mirror the SPIKE-1 capture (CC 2.1.208).
function payload(file, { subagent = false } = {}) {
  const p = {
    hook_event_name: 'PreToolUse',
    session_id: 'overridden-by-env-derivation',
    transcript_path: '/tmp/whatever.jsonl',
    cwd: '/tmp',
    permission_mode: 'default',
    prompt_id: 'p-1',
    tool_use_id: 'toolu_x',
    tool_name: 'Edit',
    tool_input: { file_path: file, old_string: 'a', new_string: 'b' },
  };
  if (subagent) { p.agent_id = 'a326adc31e613f671'; p.agent_type = 'general-purpose'; }
  return p;
}

function runHook(obj, env) {
  return spawnSync('node', [HOOK], {
    input: typeof obj === 'string' ? obj : JSON.stringify(obj),
    encoding: 'utf8', env,
  });
}

test('wrapper: disabled ⇒ exit 0 even with live l5 marker', () => {
  const { repo, env } = setup();
  setMarker(env, repo, 'l5');
  const r = runHook(payload(path.join(repo, 'src', 'a.js')), { ...env, AUTOPILOT_HOOK_ORCHESTRATOR_EDIT_GATE: '' });
  assert.strictEqual(r.status, 0);
});

test('wrapper: no marker ⇒ exit 0 silent', () => {
  const { repo, env } = setup();
  const r = runHook(payload(path.join(repo, 'src', 'a.js')), env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim(), '');
});

test('wrapper: l5 marker + depth-0 + product file + block ⇒ exit 2 deny', () => {
  const { repo, env } = setup();
  setMarker(env, repo, 'l5');
  const r = runHook(payload(path.join(repo, 'src', 'a.js')), env);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /dispatch/i);
});

test('wrapper: l5 marker + SUBAGENT payload ⇒ exit 0 (foreman passes)', () => {
  const { repo, env } = setup();
  setMarker(env, repo, 'l5');
  const r = runHook(payload(path.join(repo, 'src', 'a.js'), { subagent: true }), env);
  assert.strictEqual(r.status, 0);
});

test('wrapper: l3 marker ⇒ exit 0', () => {
  const { repo, env } = setup();
  setMarker(env, repo, 'l3');
  const r = runHook(payload(path.join(repo, 'src', 'a.js')), env);
  assert.strictEqual(r.status, 0);
});

test('wrapper: expired marker ⇒ exit 0', () => {
  const { repo, env } = setup();
  setMarker(env, repo, 'l5', ['--ttl-hours', '0']);
  const r = runHook(payload(path.join(repo, 'src', 'a.js')), env);
  assert.strictEqual(r.status, 0);
});

test('wrapper: allowlisted tracking path ⇒ exit 0', () => {
  const { repo, env } = setup();
  setMarker(env, repo, 'l5');
  const r = runHook(payload(path.join(repo, 'docs', 'projects', 'x', 'README.md')), env);
  assert.strictEqual(r.status, 0);
});

test('wrapper: depth-0 editing inside a dispatch worktree ⇒ exit 2 (WHERE-not-WHO)', () => {
  const { base, repo, env } = setup();
  const wt = path.join(base, 'wt-unit1');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.autopilot-worktree'), '');
  setMarker(env, repo, 'l5');
  const r = runHook(payload(path.join(wt, 'src.js')), env);
  assert.strictEqual(r.status, 2);
});

test('wrapper: file outside repo/worktrees (scratch) ⇒ exit 0', () => {
  const { base, repo, env } = setup();
  setMarker(env, repo, 'l5');
  const r = runHook(payload(path.join(base, 'scratch', 'notes.md')), env);
  assert.strictEqual(r.status, 0);
});

test('wrapper: warn mode ⇒ exit 0 with stderr warning', () => {
  const { repo, env } = setup();
  setMarker(env, repo, 'l5');
  const r = runHook(payload(path.join(repo, 'src', 'a.js')), { ...env, AUTOPILOT_ORCH_EDIT_GATE_MODE: 'warn' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /orchestrator/i);
});

test('wrapper: garbage stdin ⇒ fail-open exit 0', () => {
  const { env } = setup();
  const r = runHook('{{{nope', env);
  assert.strictEqual(r.status, 0);
});

test('wrapper: Write and NotebookEdit paths are gated too', () => {
  const { repo, env } = setup();
  setMarker(env, repo, 'l6');
  const w = payload(path.join(repo, 'src', 'b.js'));
  w.tool_name = 'Write';
  w.tool_input = { file_path: path.join(repo, 'src', 'b.js'), content: 'x' };
  assert.strictEqual(runHook(w, env).status, 2);
  const n = payload(path.join(repo, 'src', 'c.ipynb'));
  n.tool_name = 'NotebookEdit';
  n.tool_input = { notebook_path: path.join(repo, 'src', 'c.ipynb'), new_source: 'x' };
  assert.strictEqual(runHook(n, env).status, 2);
});
