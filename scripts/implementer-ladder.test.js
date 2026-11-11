'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyImplementerLadder,
  selectImplementerRung,
} = require('../src/engine/implementer-ladder');
const { buildImplementationArgs } = require('../src/engine/autopilot-engine');

const REPO = path.resolve(__dirname, '..');
const RESOLVER = path.join(REPO, 'scripts', 'resolve-review-loop.sh');
const TEMPLATE = path.join(REPO, 'project-config-template', 'review-loop-config.md');

const LADDER = [
  { engine: 'gemini-3.7-flash-low', effort: 'low', runner: 'agy' },
  { engine: 'grok-4.6', effort: 'low', runner: 'grok' },
  { engine: 'sonnet', effort: 'medium', runner: 'codex' },
];

function writeConfig(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-'));
  const file = path.join(dir, 'review-loop-config.md');
  fs.writeFileSync(file, body);
  return file;
}

function resolveJson(configPath) {
  const run = spawnSync('bash', [RESOLVER], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, REVIEW_LOOP_CONFIG_OVERRIDE: configPath },
  });
  if (run.status !== 0) {
    return { status: run.status, stderr: run.stderr, stdout: run.stdout, json: null };
  }
  return { status: run.status, stderr: run.stderr, stdout: run.stdout, json: JSON.parse(run.stdout) };
}

function baseRoster() {
  return {
    implementer_engine: 'gpt-5.3-codex-spark',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  };
}

test('select: mechanical r0/r1/r2 climb then cap', () => {
  const r0 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 0 });
  const r1 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 1 });
  const r2 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 2 });
  const r3 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 3 });
  assert.equal(r0.rung, 0);
  assert.equal(r0.tuple.engine, 'gemini-3.7-flash-low');
  assert.equal(r1.rung, 1);
  assert.equal(r1.tuple.engine, 'grok-4.6');
  assert.equal(r2.rung, 2);
  assert.equal(r2.tuple.engine, 'sonnet');
  assert.equal(r3.rung, 2);
});

test('select: judgment defaults to rung 0 and climbs', () => {
  const r0 = selectImplementerRung({ ladder: LADDER, unitClass: 'judgment', repairRound: 0 });
  const r1 = selectImplementerRung({ ladder: LADDER, unitClass: 'judgment', repairRound: 1 });
  assert.equal(r0.rung, 0);
  assert.equal(r0.tuple.engine, 'gemini-3.7-flash-low');
  assert.equal(r1.rung, 1);
  assert.equal(r1.tuple.engine, 'grok-4.6');
});

test('select: judgment with startRungJudgment 0 starts at rung 0', () => {
  const r0 = selectImplementerRung({ ladder: LADDER, unitClass: 'judgment', repairRound: 0, startRungJudgment: 0 });
  assert.equal(r0.rung, 0);
  assert.equal(r0.tuple.engine, 'gemini-3.7-flash-low');
});

test('select: judgment with startRungJudgment 1 starts at rung 1', () => {
  const r0 = selectImplementerRung({ ladder: LADDER, unitClass: 'judgment', repairRound: 0, startRungJudgment: 1 });
  const r1 = selectImplementerRung({ ladder: LADDER, unitClass: 'judgment', repairRound: 1, startRungJudgment: 1 });
  assert.equal(r0.rung, 1);
  assert.equal(r0.tuple.engine, 'grok-4.6');
  assert.equal(r1.rung, 2);
});

test('select: mechanical always starts at rung 0 regardless of startRungJudgment', () => {
  const mDef = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 0 });
  const m0 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 0, startRungJudgment: 0 });
  const m1 = selectImplementerRung({ ladder: LADDER, unitClass: 'mechanical', repairRound: 0, startRungJudgment: 1 });
  assert.equal(mDef.rung, 0);
  assert.equal(m0.rung, 0);
  assert.equal(m1.rung, 0);
});

test('select: single rung is used for both classes', () => {
  const one = [LADDER[0]];
  const m = selectImplementerRung({ ladder: one, unitClass: 'mechanical', repairRound: 0 });
  const j = selectImplementerRung({ ladder: one, unitClass: 'judgment', repairRound: 0 });
  assert.equal(m.rung, 0);
  assert.equal(j.rung, 0);
  assert.equal(m.tuple.engine, LADDER[0].engine);
});

test('select: absent ladder is identity', () => {
  const none = selectImplementerRung({ ladder: [], unitClass: 'mechanical', repairRound: 0 });
  assert.equal(none.applied, false);
  assert.equal(none.rung, null);
});

test('resolver: absent ladder emits empty array and keeps seat fields', () => {
  const cfg = writeConfig([
    '- override: implementer | until 2099-01-01 | test fixture seat',
    '- implementer_engine: gpt-5.3-codex-spark',
    '- implementer_effort: high',
    '- implementer_runner: auto',
    '- allow_same_runner_dual_seat: on',
    '',
  ].join('\n'));
  const { status, json, stderr } = resolveJson(cfg);
  assert.equal(status, 0, stderr);
  assert.deepEqual(json.implementer_ladder, []);
  assert.equal(json.implementer_engine, 'gpt-5.3-codex-spark');
  assert.equal(json.implementer_effort, 'high');
  assert.equal(json.implementer_runner, 'auto');
});

test('resolver: parses engine/effort@runner list', () => {
  const cfg = writeConfig([
    '- override: implementer | until 2099-01-01 | test fixture seat',
    '- implementer_engine: gpt-5.3-codex-spark',
    '- implementer_effort: high',
    '- implementer_runner: auto',
    '- implementer_ladder: gemini-3.7-flash-low/low@agy, grok-4.6/low@grok, sonnet/medium@codex',
    '- allow_same_runner_dual_seat: on',
    '',
  ].join('\n'));
  const { status, json, stderr } = resolveJson(cfg);
  assert.equal(status, 0, stderr);
  assert.deepEqual(json.implementer_ladder, LADDER);
});

test('resolver: rejects illegal ladder runner', () => {
  const cfg = writeConfig([
    '- override: implementer | until 2099-01-01 | test fixture seat',
    '- implementer_engine: gpt-5.3-codex-spark',
    '- implementer_effort: high',
    '- implementer_runner: auto',
    '- implementer_ladder: flash/low@not-a-runner',
    '- allow_same_runner_dual_seat: on',
    '',
  ].join('\n'));
  const { status, stderr } = resolveJson(cfg);
  assert.equal(status, 3);
  assert.match(stderr, /invalid implementer_ladder/);
});

test('planted negative: empty ladder dispatch argv equals pre-ladder roster', () => {
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  const roster = { ...baseRoster(), implementer_ladder: [] };
  const applied = applyImplementerLadder(roster, {
    unitClass: 'judgment',
    repairRound: 0,
  });
  const before = buildImplementationArgs({
    roster: baseRoster(),
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
  const after = buildImplementationArgs({
    roster: applied.roster,
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
  assert.deepEqual(after, before);
});

test('roster override qwen_local implementer emits bwrap sandbox argv', () => {
  const cfg = writeConfig([
    '- override: implementer | until 2099-01-01 | test fixture seat',
    '- implementer_engine: Qwen3.8-27B-QUASAR-NVFP4',
    '- implementer_effort: high',
    '- implementer_runner: cc-shim',
    '- implementer_endpoint: qwen_local',
    '- implementer_ladder: Qwen3.8-27B-QUASAR-NVFP4/high@cc-shim',
    '- allow_same_runner_dual_seat: on',
    '',
  ].join('\n'));
  const { status, json, stderr } = resolveJson(cfg);
  assert.equal(status, 0, stderr);
  const applied = applyImplementerLadder(json, { unitClass: 'mechanical', repairRound: 0 });
  assert.equal(applied.roster.implementer_runner, 'cc-shim');
  assert.equal(applied.roster.implementer_endpoint, 'qwen_local');
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  const args = buildImplementationArgs({
    roster: applied.roster,
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
  const sandboxAt = args.indexOf('--sandbox');
  assert.notEqual(sandboxAt, -1, args.join(' '));
  assert.equal(args[sandboxAt + 1], 'bwrap');
  const parentAt = args.indexOf('--worktree-parent');
  assert.notEqual(parentAt, -1, args.join(' '));
  const parent = args[parentAt + 1];
  assert.equal(path.isAbsolute(parent), true);
  assert.equal(parent.startsWith(REPO + path.sep), false);
  assert.equal(fs.existsSync(parent), true);
  assert.equal(args[args.lastIndexOf('--endpoint') + 1], 'qwen_local');
  fs.rmSync(promptDir, { recursive: true, force: true });
});

test('runner auto plus qwen_local carries bwrap sandbox argv', () => {
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  const args = buildImplementationArgs({
    roster: {
      implementer_engine: 'Qwen3.8-27B-QUASAR-NVFP4',
      implementer_effort: 'high',
      implementer_runner: 'auto',
      implementer_endpoint: 'qwen_local',
    },
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
  const sandboxAt = args.indexOf('--sandbox');
  assert.notEqual(sandboxAt, -1, args.join(' '));
  assert.equal(args[sandboxAt + 1], 'bwrap');
  assert.equal(args[args.indexOf('--runner') + 1], 'auto');
  assert.equal(args[args.lastIndexOf('--endpoint') + 1], 'qwen_local');
  const parentAt = args.indexOf('--worktree-parent');
  assert.notEqual(parentAt, -1, args.join(' '));
  fs.rmSync(promptDir, { recursive: true, force: true });
});

test('empty implementer_runner with qwen_local is sandboxed like auto', () => {
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  const args = buildImplementationArgs({
    roster: {
      implementer_engine: 'Qwen3.8-27B-QUASAR-NVFP4',
      implementer_effort: 'high',
      implementer_runner: '',
      implementer_endpoint: 'qwen_local',
    },
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
  assert.equal(args[args.indexOf('--sandbox') + 1], 'bwrap');
  assert.equal(args[args.lastIndexOf('--endpoint') + 1], 'qwen_local');
  fs.rmSync(promptDir, { recursive: true, force: true });
});

function qwenLocalArgs(promptDir) {
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  return buildImplementationArgs({
    roster: {
      implementer_engine: 'Qwen3.8-27B-QUASAR-NVFP4',
      implementer_effort: 'high',
      implementer_runner: 'auto',
      implementer_endpoint: 'qwen_local',
    },
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
}

function worktreeParentOf(args) {
  const at = args.indexOf('--worktree-parent');
  assert.notEqual(at, -1, args.join(' '));
  return args[at + 1];
}

test('two local sandbox builds reuse one per-uid worktree parent', () => {
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  try {
    const first = worktreeParentOf(qwenLocalArgs(promptDir));
    const second = worktreeParentOf(qwenLocalArgs(promptDir));
    assert.equal(first, second);
    assert.equal(path.basename(first), `autopilot-local-sbx-${process.getuid()}`);
    assert.equal(fs.statSync(first).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(promptDir, { recursive: true, force: true });
  }
});

test('a TMPDIR inside a git repo is not the local sandbox parent', () => {
  const prev = process.env.TMPDIR;
  const repoTmp = fs.mkdtempSync(path.join(REPO, 'impl-ladder-git-tmp-'));
  const promptDir = path.join(repoTmp, 'prompt');
  fs.mkdirSync(promptDir);
  process.env.TMPDIR = repoTmp;
  try {
    const parent = worktreeParentOf(qwenLocalArgs(promptDir));
    assert.equal(parent.startsWith(`${repoTmp}${path.sep}`), false, parent);
    assert.equal(parent, path.join('/tmp', `autopilot-local-sbx-${process.getuid()}`));
  } finally {
    if (prev === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prev;
    fs.rmSync(repoTmp, { recursive: true, force: true });
  }
});

function endpointValues(args) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--endpoint' && typeof args[i + 1] === 'string') {
      values.push(args[i + 1]);
      i += 1;
    } else if (typeof args[i] === 'string' && args[i].startsWith('--endpoint=')) {
      values.push(args[i].slice('--endpoint='.length));
    }
  }
  return values;
}

function argsWithExtra(extra, runner, endpoint) {
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  try {
    return buildImplementationArgs({
      roster: {
        implementer_engine: 'Qwen3.8-27B-QUASAR-NVFP4',
        implementer_effort: 'high',
        implementer_runner: runner,
        implementer_endpoint: endpoint,
      },
      promptFile,
      branch: 'feat/x',
      base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      cwd: promptDir,
      extraImplementationArgs: extra,
    });
  } finally {
    fs.rmSync(promptDir, { recursive: true, force: true });
  }
}

test('duplicate --endpoint last wins: trailing qwen_local is sandboxed', () => {
  const args = argsWithExtra(
    ['--endpoint', 'glm', '--endpoint', 'qwen_local'],
    'cc-shim',
    'glm',
  );
  assert.equal(args[args.indexOf('--sandbox') + 1], 'bwrap', args.join(' '));
  assert.deepEqual(endpointValues(args), ['glm', 'qwen_local']);
});

test('duplicate --endpoint last wins: trailing glm is not sandboxed', () => {
  const args = argsWithExtra(
    ['--endpoint', 'qwen_local', '--endpoint', 'glm'],
    'cc-shim',
    'qwen_local',
  );
  assert.equal(args.includes('--sandbox'), false, args.join(' '));
  assert.equal(args.includes('--worktree-parent'), false, args.join(' '));
  assert.deepEqual(endpointValues(args), ['qwen_local', 'glm']);
});

test('--endpoint= last occurrence wins over an earlier --endpoint', () => {
  const args = argsWithExtra(
    ['--endpoint', 'qwen_local', '--endpoint=glm'],
    'cc-shim',
    'qwen_local',
  );
  assert.equal(args.includes('--sandbox'), false, args.join(' '));
  assert.deepEqual(endpointValues(args), ['qwen_local', 'glm']);
});

test('an empty --endpoint does not fall back to the roster endpoint', () => {
  const args = argsWithExtra(['--endpoint', ''], 'auto', 'qwen_local');
  assert.equal(args.includes('--sandbox'), false, args.join(' '));
  assert.equal(args.includes('qwen_local'), false, args.join(' '));
});

test('an empty --endpoint= does not fall back to the roster endpoint', () => {
  const args = argsWithExtra(['--endpoint='], 'cc-shim', 'qwen_local');
  assert.equal(args.includes('--sandbox'), false, args.join(' '));
  assert.equal(args.includes('qwen_local'), false, args.join(' '));
});

test('cloud-fallback cc-shim rung argv has no qwen_local and no --sandbox', () => {
  const { AutopilotEngine } = require('../src/engine/autopilot-engine');
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  const capDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-cap-'));
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  const prevCap = process.env.ENGINE_CAPABILITY_DIR;
  process.env.ENGINE_CAPABILITY_DIR = capDir;
  const calls = [];
  try {
    const engine = new AutopilotEngine({
      clock: () => 1782864000000,
      implementationDispatcher(args) {
        calls.push(args.slice());
        const first = calls.length === 1;
        const result = first
          ? {
            status: 'engine_unavailable',
            runner: 'cc-shim',
            model: 'Qwen3.8-27B-QUASAR-NVFP4',
            commit: null,
            base: '1111111111111111111111111111111111111111',
            branch: 'impl-branch',
            files_changed: 0,
            insertions: 0,
            deletions: 0,
            worktree: '/tmp/wt',
            agent_log: '/tmp/l',
            error: 'engine unavailable (endpoint_unreachable): worker exited non-zero (agent exit 1); worktree kept',
          }
          : {
            status: 'committed',
            runner: 'cc-shim',
            model: 'claude-sonnet',
            branch: 'impl-branch-cloudfb',
            base: '1111111111111111111111111111111111111111',
            commit: '2222222222222222222222222222222222222222',
            files_changed: 1,
            insertions: 1,
            deletions: 0,
            worktree: null,
            agent_log: '/tmp/l',
            error: null,
          };
        return {
          error: null,
          status: result.status === 'committed' ? 0 : 1,
          signal: null,
          stdout: '',
          stderr: '',
          parseError: null,
          result,
        };
      },
    });
    const out = engine.implementTask({
      promptFile,
      branch: 'impl-branch',
      base: '1111111111111111111111111111111111111111',
      runId: 'run-cf-qwen',
      implementationRound: 1,
      extraImplementationArgs: ['--endpoint', 'qwen_local'],
      roster: {
        implementer_engine: 'Qwen3.8-27B-QUASAR-NVFP4',
        implementer_effort: 'high',
        implementer_runner: 'cc-shim',
        implementer_endpoint: 'qwen_local',
        on_engine_unavailable: 'cloud-fallback',
        cloud_fallback_rung: { engine: 'claude-sonnet', effort: 'high', runner: 'cc-shim' },
      },
    });
    assert.equal(out.status, 'committed');
    assert.equal(calls.length, 2);
    const second = calls[1];
    assert.equal(second.includes('qwen_local'), false, second.join(' '));
    assert.equal(second.includes('--sandbox'), false, second.join(' '));
    assert.equal(second.includes('--endpoint'), false, second.join(' '));
    assert.equal(second.includes('--worktree-parent'), false, second.join(' '));
  } finally {
    if (prevCap === undefined) delete process.env.ENGINE_CAPABILITY_DIR;
    else process.env.ENGINE_CAPABILITY_DIR = prevCap;
    fs.rmSync(promptDir, { recursive: true, force: true });
    fs.rmSync(capDir, { recursive: true, force: true });
  }
});

test('cc-shim glm implementer is not forced into the local sandbox', () => {
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-prompt-'));
  const promptFile = path.join(promptDir, 'prompt.md');
  fs.writeFileSync(promptFile, 'do the thing\n');
  const args = buildImplementationArgs({
    roster: {
      implementer_engine: 'GLM-5.3',
      implementer_effort: 'high',
      implementer_runner: 'cc-shim',
      implementer_endpoint: 'glm',
    },
    promptFile,
    branch: 'feat/x',
    base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    cwd: promptDir,
  });
  assert.equal(args.includes('--sandbox'), false, args.join(' '));
  assert.equal(args.includes('--worktree-parent'), false, args.join(' '));
  assert.equal(args[args.indexOf('--endpoint') + 1], 'glm');
  fs.rmSync(promptDir, { recursive: true, force: true });
});

test('template config with auto implementer_ladder and no topology file emits empty ladder plus warning', () => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ladder-template-'));
  const nonExistentTopo = path.join(scratchDir, 'nonexistent-topology.json');
  const run = spawnSync('bash', [RESOLVER], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...process.env,
      REVIEW_LOOP_CONFIG_OVERRIDE: TEMPLATE,
      AUTOPILOT_TOPOLOGY_FILE: nonExistentTopo,
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const json = JSON.parse(run.stdout);
  assert.deepEqual(json.implementer_ladder, []);
  assert.ok(Array.isArray(json.capability_warnings), 'capability_warnings should be an array');
  assert.ok(
    json.capability_warnings.some((w) => w.includes('implementer_ladder auto')),
    `expected warning containing "implementer_ladder auto", got: ${JSON.stringify(json.capability_warnings)}`
  );
});
