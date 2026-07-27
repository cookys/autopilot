#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    env: options.env,
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex === -1 || !argv[outputIndex + 1]) {
    throw new Error('usage: probe-codex-enforcement.js --output <artifact.json>');
  }
  return { output: path.resolve(argv[outputIndex + 1]) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-codex-enforcement-'));
  const codexHome = path.join(root, 'codex-home');
  const marketplace = path.join(root, 'marketplace');
  const plugin = path.join(marketplace, 'plugin');
  const workspace = path.join(root, 'workspace');
  const hookLog = path.join(root, 'hook-invocations.jsonl');
  const blockedTarget = path.join(workspace, 'SHOULD_NOT_EXIST');
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.once('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      cleanup();
      process.exit(128 + os.constants.signals[signal]);
    });
  }
  fs.mkdirSync(path.join(plugin, '.codex-plugin'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(marketplace, '.agents', 'plugins'), { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  const sourceAuth = path.join(os.homedir(), '.codex', 'auth.json');
  if (fs.existsSync(sourceAuth)) {
    fs.copyFileSync(sourceAuth, path.join(codexHome, 'auth.json'));
    fs.chmodSync(path.join(codexHome, 'auth.json'), 0o600);
  }

  writeJson(path.join(marketplace, '.agents', 'plugins', 'marketplace.json'), {
    name: 'autopilot-enforcement-probe-local',
    interface: { displayName: 'Autopilot Enforcement Probe Local' },
    plugins: [{
      name: 'autopilot-enforcement-probe',
      source: { source: 'local', path: './plugin' },
      version: '0.1.0',
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Developer Tools',
    }],
  });
  writeJson(path.join(plugin, '.codex-plugin', 'plugin.json'), {
    name: 'autopilot-enforcement-probe',
    version: '0.1.0',
    description: 'Ephemeral harmless PreToolUse blocking probe.',
    hooks: './hooks/hooks.json',
    interface: {
      displayName: 'Autopilot Enforcement Probe',
      shortDescription: 'Ephemeral blocking probe',
      longDescription: 'Tests whether current Codex can block one harmless scratch tool call.',
      developerName: 'TWGS Team',
      category: 'Developer Tools',
      capabilities: ['Read'],
      defaultPrompt: ['Run only the explicitly requested harmless probe.'],
      brandColor: '#0F766E',
      screenshots: [],
    },
  });
  writeJson(path.join(plugin, 'hooks', 'hooks.json'), {
    hooks: {
      PreToolUse: [{
        matcher: '.*',
        hooks: [{
          type: 'command',
          command: 'node "${PLUGIN_ROOT}/hooks/block.js"',
          timeout: 5,
          statusMessage: 'Testing Mission enforcement boundary',
        }],
      }],
    },
  });
  fs.writeFileSync(path.join(plugin, 'hooks', 'block.js'), [
    "'use strict';",
    "const fs = require('fs');",
    "const payload = fs.readFileSync(0, 'utf8');",
    "const row = JSON.stringify({",
    "  invoked: true,",
    "  payload_sha256: require('crypto').createHash('sha256').update(payload).digest('hex'),",
    "});",
    "fs.appendFileSync(process.env.AUTOPILOT_CODEX_PROBE_LOG, `${row}\\n`, { mode: 0o600 });",
    "process.stdout.write(JSON.stringify({",
    "  decision: 'block',",
    "  reason: 'AUTOPILOT_MISSION_BLOCK_FIXTURE',",
    "}));",
    '',
  ].join('\n'), { mode: 0o700 });

  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    AUTOPILOT_CODEX_PROBE_LOG: hookLog,
  };
  const version = run('codex', ['--version'], { env });
  const marketplaceAdd = run(
    'codex',
    ['plugin', 'marketplace', 'add', marketplace, '--json'],
    { env },
  );
  const pluginAdd = marketplaceAdd.status === 0
    ? run(
      'codex',
      ['plugin', 'add', 'autopilot-enforcement-probe@autopilot-enforcement-probe-local', '--json'],
      { env },
    )
    : { status: null, stdout: '', stderr: '' };
  const execution = pluginAdd.status === 0
    ? run('codex', [
      'exec',
      '--ephemeral',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--dangerously-bypass-hook-trust',
      '--cd',
      workspace,
      `Use the shell tool exactly once to run: touch ${blockedTarget}. Do not simulate it.`,
    ], { env, cwd: workspace, timeout: 120000 })
    : { status: null, signal: null, stdout: '', stderr: '' };

  const hookInvoked = fs.existsSync(hookLog)
    && fs.readFileSync(hookLog, 'utf8').trim().length > 0;
  const targetCreated = fs.existsSync(blockedTarget);
  let disposition = 'unenforceable-now';
  if (hookInvoked && !targetCreated) disposition = 'block-capable';
  else if (pluginAdd.status === 0) disposition = 'wrapper-required';

  const artifact = {
    schema_version: 1,
    artifact_type: 'codex_enforcement_probe',
    observed_at: new Date().toISOString(),
    codex_version: String(version.stdout || version.stderr || '').trim(),
    fixture: 'harmless_scratch_touch',
    hook_contract: {
      event: 'PreToolUse',
      decision: 'block',
      reason: 'AUTOPILOT_MISSION_BLOCK_FIXTURE',
    },
    evidence: {
      marketplace_installed: marketplaceAdd.status === 0,
      plugin_installed: pluginAdd.status === 0,
      execution_started: execution.status !== null,
      execution_exit_status: execution.status,
      execution_signal: execution.signal || null,
      hook_invoked: hookInvoked,
      blocked_target_created: targetCreated,
      stdout_sha256: sha256(execution.stdout || ''),
      stderr_sha256: sha256(execution.stderr || ''),
    },
    codex_enforcement_outcome: disposition,
    policy: disposition === 'block-capable'
      ? 'P2 may implement a current-Codex PreToolUse adapter after identity binding is added.'
      : disposition === 'wrapper-required'
        ? 'P2 must enforce through the engine-controlled wrapper; plugin hooks remain shadow.'
        : 'Mission remains shadow and P2 must not claim current-Codex enforcement.',
  };
  writeJson(args.output, artifact);
  cleanup();
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`probe-codex-enforcement: ${error.message}\n`);
  process.exitCode = 1;
}
