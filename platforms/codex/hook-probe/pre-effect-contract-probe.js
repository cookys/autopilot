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

function writeJson(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

function writeFile(file, value, mode = 0o700) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 30000,
  });
}

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex === -1 || !argv[outputIndex + 1]) {
    throw new Error('usage: pre-effect-contract-probe.js --output <receipt.json>');
  }
  return { output: path.resolve(argv[outputIndex + 1]) };
}

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\n+/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function main() {
  const { output } = parseArgs(process.argv.slice(2));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-codex-pre-effect-contract-'));
  try {
    const codexHome = path.join(scratch, 'codex-home');
    const marketplace = path.join(scratch, 'marketplace');
    const plugin = path.join(marketplace, 'plugin');
    const workspace = path.join(scratch, 'workspace');
    const hookLog = path.join(scratch, 'hook-log.jsonl');
    const targets = {
      allow: path.join(workspace, 'ALLOW_SENTINEL'),
      deny: path.join(workspace, 'DENY_SENTINEL'),
      broken: path.join(workspace, 'BROKEN_SENTINEL'),
    };
    for (const directory of [codexHome, workspace, path.join(plugin, '.codex-plugin'),
      path.join(plugin, 'hooks'), path.join(marketplace, '.agents', 'plugins')]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    run('git', ['init', '-q', workspace]);

    const sourceAuth = path.join(os.homedir(), '.codex', 'auth.json');
    if (fs.existsSync(sourceAuth)) {
      fs.copyFileSync(sourceAuth, path.join(codexHome, 'auth.json'));
      fs.chmodSync(path.join(codexHome, 'auth.json'), 0o600);
    }

    const manifest = {
      name: 'autopilot-pre-effect-contract-probe',
      version: '0.1.0',
      description: 'Disposable Codex PreToolUse allow/deny/broken contract probe.',
      hooks: './hooks/hooks.json',
      interface: {
        displayName: 'Autopilot Pre-effect Contract Probe',
        shortDescription: 'Disposable pre-effect contract probe',
        longDescription: 'Proves the installed Codex pre-effect blocking contract.',
        developerName: 'TWGS Team',
        category: 'Developer Tools',
        capabilities: ['Read'],
        defaultPrompt: ['Run only the explicitly requested harmless probe actions.'],
        brandColor: '#0F766E',
        screenshots: [],
      },
    };
    const hooksManifest = {
      hooks: {
        PreToolUse: [{
          matcher: '.*',
          hooks: [{
            type: 'command',
            command: 'node "${PLUGIN_ROOT}/hooks/contract.js"',
            timeout: 5,
            statusMessage: 'Probing Codex pre-effect contract',
          }],
        }],
      },
    };
    const adapter = [
      "'use strict';",
      "const crypto = require('crypto');",
      "const fs = require('fs');",
      "const payloadBytes = fs.readFileSync(0);",
      "let payload;",
      "try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { process.exit(19); }",
      "const input = payload && payload.tool_input && typeof payload.tool_input === 'object'",
      "  ? payload.tool_input : {};",
      "const command = typeof input.cmd === 'string' ? input.cmd",
      "  : typeof input.command === 'string' ? input.command : '';",
      "const targets = JSON.parse(process.env.AUTOPILOT_CODEX_CONTRACT_TARGETS || '{}');",
      "const exact = Object.fromEntries(Object.entries(targets).map(([key, value]) => [",
      "  key, new Set([`touch ${value}`, `touch '${value}'`, `touch \"${value}\"`]),",
      "]));",
      "const action = Object.keys(exact).find((key) => exact[key].has(command.trim())) || 'other';",
      "const row = {",
      "  action,",
      "  payload_sha256: crypto.createHash('sha256').update(payloadBytes).digest('hex'),",
      "  hook_event_name: typeof payload.hook_event_name === 'string' ? payload.hook_event_name : null,",
      "  cwd_matches: typeof payload.cwd === 'string'",
      "    && require('path').resolve(payload.cwd) === require('path').resolve(process.env.AUTOPILOT_CODEX_CONTRACT_CWD),",
      "  tool_name: typeof payload.tool_name === 'string' ? payload.tool_name : null,",
      "  session_id_present: typeof payload.session_id === 'string' && payload.session_id.length > 0,",
      "};",
      "fs.appendFileSync(process.env.AUTOPILOT_CODEX_CONTRACT_LOG, `${JSON.stringify(row)}\\n`, { mode: 0o600 });",
      "if (action === 'allow') process.exit(0);",
      "if (action === 'deny') {",
      "  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'AUTOPILOT_PRE_EFFECT_DENY_CONTROL' }));",
      "  process.exit(0);",
      "}",
      "if (action === 'broken') {",
      "  process.stderr.write('AUTOPILOT_PRE_EFFECT_BROKEN_CONTROL\\n');",
      "  process.exit(17);",
      "}",
      "process.stdout.write(JSON.stringify({ decision: 'block', reason: 'AUTOPILOT_PRE_EFFECT_UNEXPECTED_ACTION' }));",
      '',
    ].join('\n');
    writeJson(path.join(plugin, '.codex-plugin', 'plugin.json'), manifest);
    writeJson(path.join(plugin, 'hooks', 'hooks.json'), hooksManifest);
    writeFile(path.join(plugin, 'hooks', 'contract.js'), adapter);
    writeJson(path.join(marketplace, '.agents', 'plugins', 'marketplace.json'), {
      name: 'autopilot-pre-effect-contract-probe-local',
      interface: { displayName: 'Autopilot Pre-effect Contract Probe Local' },
      plugins: [{
        name: manifest.name,
        source: { source: 'local', path: './plugin' },
        version: manifest.version,
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Developer Tools',
      }],
    });

    const env = {
      ...process.env,
      CODEX_HOME: codexHome,
      AUTOPILOT_CODEX_CONTRACT_CWD: workspace,
      AUTOPILOT_CODEX_CONTRACT_LOG: hookLog,
      AUTOPILOT_CODEX_CONTRACT_TARGETS: JSON.stringify(targets),
    };
    const version = run('codex', ['--version'], { env });
    const marketplaceAdd = run('codex', ['plugin', 'marketplace', 'add', marketplace, '--json'], { env });
    const pluginAdd = marketplaceAdd.status === 0
      ? run('codex', ['plugin', 'add', `${manifest.name}@autopilot-pre-effect-contract-probe-local`, '--json'], { env })
      : { status: null, stdout: '', stderr: '' };
    const prompt = [
      'Use the shell tool exactly three times, as three separate calls, in this exact order.',
      `First run exactly: touch ${targets.allow}`,
      `Second run exactly: touch ${targets.deny}`,
      `Third run exactly: touch ${targets.broken}`,
      'Do not combine commands, quote paths, retry, inspect files, use another tool, or simulate actions.',
    ].join('\n');
    const execution = pluginAdd.status === 0
      ? run('codex', [
        'exec', '--ephemeral', '--ignore-rules', '--skip-git-repo-check',
        '--sandbox', 'workspace-write', '--dangerously-bypass-hook-trust',
        '--cd', workspace, prompt,
      ], { env, cwd: workspace, timeout: 180000 })
      : { status: null, signal: null, stdout: '', stderr: '' };

    const rows = readRows(hookLog);
    const actionCounts = Object.fromEntries(['allow', 'deny', 'broken'].map((action) => [
      action, rows.filter((row) => row.action === action).length,
    ]));
    const relevant = rows.filter((row) => new Set(['allow', 'deny', 'broken']).has(row.action));
    const payloadContract = {
      event: relevant.length > 0 && relevant.every((row) => row.hook_event_name === 'PreToolUse')
        ? 'PreToolUse' : null,
      matcher: '.*',
      cwd_stable: relevant.length === 3 && relevant.every((row) => row.cwd_matches === true),
      tool_name_stable: relevant.length === 3
        && relevant.every((row) => typeof row.tool_name === 'string' && row.tool_name.length > 0),
      session_identity_stable: relevant.length === 3
        && relevant.every((row) => row.session_id_present === true),
    };
    const sentinels = {
      allow: Number(fs.existsSync(targets.allow)),
      deny: Number(fs.existsSync(targets.deny)),
      broken: Number(fs.existsSync(targets.broken)),
    };
    const ready = version.status === 0
      && marketplaceAdd.status === 0
      && pluginAdd.status === 0
      && execution.status !== null
      && execution.status !== 0
      && actionCounts.allow === 1
      && actionCounts.deny === 1
      && actionCounts.broken === 1
      && sentinels.allow === 1
      && sentinels.deny === 0
      && sentinels.broken === 0
      && payloadContract.event === 'PreToolUse'
      && payloadContract.cwd_stable
      && payloadContract.tool_name_stable
      && payloadContract.session_identity_stable;
    const receiptBody = {
      schema_version: 1,
      artifact_type: 'codex_pre_effect_contract_receipt',
      observed_at: new Date().toISOString(),
      codex_version: String(version.stdout || version.stderr || '').trim(),
      installed_plugin_manifest_sha256: sha256(Buffer.from(JSON.stringify(manifest))),
      probe_adapter_sha256: sha256(Buffer.from(adapter)),
      hook_manifest_sha256: sha256(Buffer.from(JSON.stringify(hooksManifest))),
      transcript_sha256: sha256(Buffer.from(`${execution.stdout || ''}\0${execution.stderr || ''}`)),
      payload_contract: payloadContract,
      denial_contract: {
        structured_stdout: { decision: 'block', reason: 'AUTOPILOT_PRE_EFFECT_DENY_CONTROL' },
        broken_adapter_exit_status: 17,
        cli_exit_nonzero: execution.status !== null && execution.status !== 0,
      },
      effect_sentinel_counts: sentinels,
      hook_action_counts: actionCounts,
      installer: {
        marketplace_exit_status: marketplaceAdd.status,
        plugin_exit_status: pluginAdd.status,
      },
      execution: {
        exit_status: execution.status,
        signal: execution.signal || null,
      },
      verdict: ready ? 'READY' : 'BLOCKED',
      production_pretooluse_allowed: ready,
      d4_verdict: ready ? 'READY' : 'BLOCKED',
      terminal_blocker: ready
        ? null
        : 'broken PreToolUse command failed open: mutation occurred and Codex exited zero',
    };
    const receipt = { ...receiptBody, receipt_sha256: sha256(Buffer.from(JSON.stringify(receiptBody))) };
    writeJson(output, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!ready) process.exitCode = 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`pre-effect-contract-probe: ${error.message || String(error)}\n`);
  process.exitCode = 1;
}
