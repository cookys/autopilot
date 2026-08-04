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
  const capabilityIndex = argv.indexOf('--capability-receipt');
  return {
    output: path.resolve(argv[outputIndex + 1]),
    production: argv.includes('--production'),
    capabilityReceipt: capabilityIndex === -1
      ? null : path.resolve(argv[capabilityIndex + 1]),
  };
}

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\n+/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runCapability() {
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
    const structuredDenyReady = version.status === 0
      && marketplaceAdd.status === 0
      && pluginAdd.status === 0
      && execution.status !== null
      && actionCounts.allow === 1
      && actionCounts.deny === 1
      && actionCounts.broken === 1
      && sentinels.allow === 1
      && sentinels.deny === 0
      && payloadContract.event === 'PreToolUse'
      && payloadContract.cwd_stable
      && payloadContract.tool_name_stable
      && payloadContract.session_identity_stable;
    const brokenAdapterFailOpen = execution.status === 0 && sentinels.broken === 1;
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
      verdict: structuredDenyReady ? 'READY' : 'BLOCKED',
      structured_deny_verdict: structuredDenyReady ? 'READY' : 'BLOCKED',
      production_pretooluse_allowed: structuredDenyReady,
      d4_verdict: structuredDenyReady ? 'PENDING_PRODUCTION_PROOF' : 'BLOCKED',
      broken_adapter_semantics: brokenAdapterFailOpen
        ? 'DOCUMENTED_FAIL_OPEN' : 'UNEXPECTED_RESULT',
      known_limitations: brokenAdapterFailOpen ? [
        'Codex 0.146.0 continues the tool call when a PreToolUse command adapter exits 17 without a structured denial.',
        'Production enforcement does not claim fail-closed behavior when the adapter process cannot emit structured stdout.',
      ] : [],
      terminal_blocker: structuredDenyReady
        ? null
        : 'structured PreToolUse denial did not preserve the deny sentinel',
      superseded_qc_classification: {
        verdict: 'BLOCKED',
        production_pretooluse_allowed: false,
        d4_verdict: 'BLOCKED',
        terminal_blocker: 'broken PreToolUse command failed open: mutation occurred and Codex exited zero',
        receipt_sha256: 'e5f134a7902c1ddd90f331e3fe6be2e59eca1c063246bf1dc8e670582678c1ee',
      },
    };
    const receipt = { ...receiptBody, receipt_sha256: sha256(Buffer.from(JSON.stringify(receiptBody))) };
    writeJson(output, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!structuredDenyReady) process.exitCode = 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function prepareCodexHome(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const sourceAuth = path.join(os.homedir(), '.codex', 'auth.json');
  if (fs.existsSync(sourceAuth)) {
    fs.copyFileSync(sourceAuth, path.join(directory, 'auth.json'));
    fs.chmodSync(path.join(directory, 'auth.json'), 0o600);
  }
}

function installAutopilot(codexHome, marketplaceRoot, envExtra = {}) {
  const env = { ...process.env, ...envExtra, CODEX_HOME: codexHome };
  const marketplace = run('codex', ['plugin', 'marketplace', 'add', marketplaceRoot, '--json'], { env });
  const plugin = marketplace.status === 0
    ? run('codex', ['plugin', 'add', 'autopilot@autopilot-local', '--json'], { env })
    : { status: null, stdout: '', stderr: '' };
  return { env, marketplace, plugin };
}

function codexTouch(target, workspace, env) {
  const prompt = [
    'Use the shell tool exactly once.',
    `Run exactly: touch ${target}`,
    'Do not quote, combine, retry, inspect, explain, or use another tool.',
  ].join('\n');
  return run('codex', [
    'exec', '--ephemeral', '--ignore-rules', '--skip-git-repo-check',
    '--sandbox', 'workspace-write', '--dangerously-bypass-hook-trust',
    '--cd', workspace, prompt,
  ], { env, cwd: workspace, timeout: 180000 });
}

function stateDigest(workspace) {
  const refs = run('git', ['-C', workspace, 'for-each-ref', '--format=%(refname)%00%(objectname)']);
  const worktrees = run('git', ['-C', workspace, 'worktree', 'list', '--porcelain']);
  return {
    refs_sha256: sha256(Buffer.from(refs.stdout || '')),
    worktrees_sha256: sha256(Buffer.from(worktrees.stdout || '')),
  };
}

function capabilityReady(receipt) {
  const evidence = receipt && receipt.artifact_type === 'codex_pre_effect_production_receipt'
    ? receipt.capability_evidence : receipt;
  return Boolean(evidence
    && evidence.payload_contract?.event === 'PreToolUse'
    && evidence.payload_contract?.matcher === '.*'
    && evidence.payload_contract?.cwd_stable === true
    && evidence.payload_contract?.tool_name_stable === true
    && evidence.payload_contract?.session_identity_stable === true
    && evidence.effect_sentinel_counts?.allow === 1
    && evidence.effect_sentinel_counts?.deny === 0
    && evidence.hook_action_counts?.allow === 1
    && evidence.hook_action_counts?.deny === 1
    && evidence.denial_contract?.structured_stdout?.decision === 'block');
}

function runProduction() {
  const { output, capabilityReceipt } = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(sourceRoot, '..', '..');
  const defaultCapability = path.join(
    repoRoot,
    'docs', 'projects', '2026-08-05-codex-native-lifecycle-enforcement',
    'evidence', 'codex-pre-effect-production-live-receipt.json',
  );
  const capabilityPath = capabilityReceipt || defaultCapability;
  let capabilityEvidence = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
  if (capabilityEvidence.artifact_type === 'codex_pre_effect_production_receipt') {
    capabilityEvidence = capabilityEvidence.capability_evidence;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-codex-production-pre-effect-'));
  try {
    const goodHome = path.join(scratch, 'good-home');
    const brokenHome = path.join(scratch, 'broken-home');
    const workspace = path.join(scratch, 'workspace');
    const brokenWorkspace = path.join(scratch, 'broken-workspace');
    const markers = path.join(scratch, 'markers');
    const brokenMarkers = path.join(scratch, 'broken-markers');
    const hookLog = path.join(scratch, 'pre-effect-log.jsonl');
    const targets = {
      negative: path.join(workspace, 'NEGATIVE_SENTINEL'),
      positive: path.join(workspace, 'POSITIVE_SENTINEL'),
      broken: path.join(brokenWorkspace, 'BROKEN_SENTINEL'),
    };
    for (const directory of [workspace, brokenWorkspace, markers, brokenMarkers]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    run('git', ['init', '-q', workspace]);
    run('git', ['init', '-q', brokenWorkspace]);
    prepareCodexHome(goodHome);
    prepareCodexHome(brokenHome);

    const goodInstall = installAutopilot(goodHome, sourceRoot, {
      AUTOPILOT_SESSION_MODE_DIR: markers,
      AUTOPILOT_CODEX_PRE_EFFECT_TEST_LOG: hookLog,
    });
    const version = run('codex', ['--version'], { env: goodInstall.env });
    const goodStateBefore = stateDigest(workspace);
    const negative = goodInstall.plugin.status === 0
      ? codexTouch(targets.negative, workspace, goodInstall.env)
      : { status: null, signal: null, stdout: '', stderr: '' };
    const goodStateAfterNegative = stateDigest(workspace);

    const markerSet = goodInstall.plugin.status === 0
      ? run('node', [
        path.join(sourceRoot, 'plugin', 'scripts', 'session-mode.js'),
        'set', '--level', 'l3', '--entry-level', 'l3', '--repo-root', workspace,
      ], {
        cwd: workspace,
        env: { ...goodInstall.env, AUTOPILOT_SESSION_ID: 'd4-positive-control' },
      })
      : { status: null, stdout: '', stderr: '' };
    const positive = markerSet.status === 0
      ? codexTouch(targets.positive, workspace, goodInstall.env)
      : { status: null, signal: null, stdout: '', stderr: '' };
    const goodStateAfterPositive = stateDigest(workspace);

    const brokenMarketplace = path.join(scratch, 'broken-marketplace');
    fs.mkdirSync(path.join(brokenMarketplace, '.agents', 'plugins'), { recursive: true });
    fs.cpSync(path.join(sourceRoot, 'plugin'), path.join(brokenMarketplace, 'plugin'), { recursive: true });
    fs.copyFileSync(
      path.join(sourceRoot, '.agents', 'plugins', 'marketplace.json'),
      path.join(brokenMarketplace, '.agents', 'plugins', 'marketplace.json'),
    );
    writeFile(
      path.join(brokenMarketplace, 'plugin', 'hooks', 'pre-effect.js'),
      "#!/usr/bin/env node\n'use strict';\nprocess.stderr.write('AUTOPILOT_PRE_EFFECT_BROKEN_CONTROL\\n');\nprocess.exit(17);\n",
    );
    const brokenInstall = installAutopilot(brokenHome, brokenMarketplace, {
      AUTOPILOT_SESSION_MODE_DIR: brokenMarkers,
    });
    const brokenStateBefore = stateDigest(brokenWorkspace);
    const broken = brokenInstall.plugin.status === 0
      ? codexTouch(targets.broken, brokenWorkspace, brokenInstall.env)
      : { status: null, signal: null, stdout: '', stderr: '' };
    const brokenStateAfter = stateDigest(brokenWorkspace);

    const rows = readRows(hookLog);
    const negativeRows = rows.filter((row) => row.reason_code === 'DEV_FLOW_ENTRY_REQUIRED');
    const positiveRows = rows.filter((row) => (
      row.decision === 'allow' && row.marker_status === 'valid' && row.marker_level === 'l3'
    ));
    const sentinels = {
      negative: Number(fs.existsSync(targets.negative)),
      positive: Number(fs.existsSync(targets.positive)),
      broken: Number(fs.existsSync(targets.broken)),
    };
    const negativeStateUnchanged = goodStateBefore.refs_sha256 === goodStateAfterNegative.refs_sha256
      && goodStateBefore.worktrees_sha256 === goodStateAfterNegative.worktrees_sha256;
    const positiveStateUnchanged = goodStateAfterNegative.refs_sha256 === goodStateAfterPositive.refs_sha256
      && goodStateAfterNegative.worktrees_sha256 === goodStateAfterPositive.worktrees_sha256;
    const brokenStateUnchanged = brokenStateBefore.refs_sha256 === brokenStateAfter.refs_sha256
      && brokenStateBefore.worktrees_sha256 === brokenStateAfter.worktrees_sha256;
    const ready = capabilityReady(capabilityEvidence)
      && version.status === 0
      && goodInstall.marketplace.status === 0
      && goodInstall.plugin.status === 0
      && brokenInstall.marketplace.status === 0
      && brokenInstall.plugin.status === 0
      && negative.status === 0
      && positive.status === 0
      && broken.status === 0
      && markerSet.status === 0
      && negativeRows.length === 1
      && positiveRows.length === 1
      && sentinels.negative === 0
      && sentinels.positive === 1
      && sentinels.broken === 1
      && negativeStateUnchanged && positiveStateUnchanged && brokenStateUnchanged;
    const productionManifest = fs.readFileSync(
      path.join(sourceRoot, 'plugin', '.codex-plugin', 'plugin.json'),
    );
    const productionAdapter = fs.readFileSync(path.join(sourceRoot, 'plugin', 'hooks', 'pre-effect.js'));
    const receiptBody = {
      schema_version: 2,
      artifact_type: 'codex_pre_effect_production_receipt',
      observed_at: new Date().toISOString(),
      codex_version: String(version.stdout || version.stderr || '').trim(),
      capability_evidence: capabilityEvidence,
      production_contract: {
        event: 'PreToolUse',
        matcher: '.*',
        denial: { decision: 'block', reason_code: 'DEV_FLOW_ENTRY_REQUIRED' },
        installed_plugin_manifest_sha256: sha256(productionManifest),
        production_adapter_sha256: sha256(productionAdapter),
      },
      controls: {
        negative_no_admission: {
          hook_invocations: negativeRows.length,
          cli_exit_status: negative.status,
          sentinel_count: sentinels.negative,
          git_state_unchanged: negativeStateUnchanged,
          transcript_sha256: sha256(Buffer.from(`${negative.stdout || ''}\0${negative.stderr || ''}`)),
        },
        positive_canonical_l3: {
          marker_set_exit_status: markerSet.status,
          hook_invocations: positiveRows.length,
          cli_exit_status: positive.status,
          sentinel_count: sentinels.positive,
          git_refs_and_worktrees_unchanged: positiveStateUnchanged,
          transcript_sha256: sha256(Buffer.from(`${positive.stdout || ''}\0${positive.stderr || ''}`)),
        },
        broken_adapter: {
          adapter_exit_status: 17,
          cli_exit_status: broken.status,
          sentinel_count: sentinels.broken,
          git_refs_and_worktrees_unchanged: brokenStateUnchanged,
          observed_semantics: broken.status === 0 && sentinels.broken === 1
            ? 'FAIL_OPEN' : 'UNEXPECTED_RESULT',
          transcript_sha256: sha256(Buffer.from(`${broken.stdout || ''}\0${broken.stderr || ''}`)),
        },
      },
      model_calls: 3,
      verdict: ready ? 'READY' : 'BLOCKED',
      d1_verdict: capabilityReady(capabilityEvidence) ? 'READY' : 'BLOCKED',
      d4_verdict: ready ? 'READY' : 'BLOCKED',
      known_limitation: 'On Codex 0.146.0, a PreToolUse command adapter that exits nonzero before emitting a structured denial fails open; this production gate does not claim adapter-failure fail-closed semantics.',
    };
    const receipt = { ...receiptBody, receipt_sha256: sha256(Buffer.from(JSON.stringify(receiptBody))) };
    writeJson(output, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!ready) process.exitCode = 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.production) runProduction();
  else runCapability();
}

try {
  main();
} catch (error) {
  process.stderr.write(`pre-effect-contract-probe: ${error.message || String(error)}\n`);
  process.exitCode = 1;
}
