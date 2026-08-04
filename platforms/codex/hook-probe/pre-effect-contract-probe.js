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
    delete env.CODEX_THREAD_ID;
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
  // This driver itself can run under Codex. A nested Codex must mint its own
  // thread identity instead of inheriting the controller's CODEX_THREAD_ID.
  delete env.CODEX_THREAD_ID;
  const marketplace = run('codex', ['plugin', 'marketplace', 'add', marketplaceRoot, '--json'], { env });
  const plugin = marketplace.status === 0
    ? run('codex', ['plugin', 'add', 'autopilot@autopilot-local', '--json'], { env })
    : { status: null, stdout: '', stderr: '' };
  return { env, marketplace, plugin };
}

function installedAutopilotRoot(codexHome, sourceRoot) {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, 'plugin', '.codex-plugin', 'plugin.json'),
    'utf8',
  ));
  const root = path.join(
    codexHome, 'plugins', 'cache', 'autopilot-local', 'autopilot', manifest.version,
  );
  if (!fs.existsSync(path.join(root, 'hooks', 'pre-effect.js'))) {
    throw new Error('installed autopilot package root is unavailable');
  }
  return root;
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
    '--cd', workspace, '--add-dir', path.dirname(target), prompt,
  ], { env, cwd: workspace, timeout: 180000 });
}

function findExistingCampaign(repoRoot) {
  const probe = run('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir']);
  if (probe.status !== 0) return null;
  const rawCommon = String(probe.stdout || '').trim();
  const common = path.resolve(repoRoot, rawCommon);
  const artifacts = path.join(common, 'autopilot', 'mission', 'artifacts');
  if (!fs.existsSync(artifacts)) return null;
  const matches = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()
          && target.endsWith(path.join(
            'codex-native-lifecycle-enforcement', 'attempt-1', 'campaign.json',
          ))) {
        matches.push(target);
      }
    }
  };
  visit(artifacts);
  if (matches.length !== 1) return null;
  const contract = matches[0];
  const seal = path.join(path.dirname(contract), 'campaign.seal.json');
  return fs.existsSync(seal) ? { contract, seal } : null;
}

function codexLifecycleSequence({
  workspace,
  writableDirectory,
  env,
  installedRoot,
  positiveTarget,
  l5DirectTarget,
  engineCommand,
}) {
  const lifecycle = (level) => [
    'node',
    path.join(installedRoot, 'scripts', 'session-mode.js'),
    'set', '--level', level, '--entry-level', level, '--repo-root', workspace,
  ].join(' ');
  const commands = [
    lifecycle('l3'),
    `touch ${positiveTarget}`,
    lifecycle('l5'),
    `touch ${l5DirectTarget}`,
    engineCommand,
  ];
  const prompt = [
    'Use the shell tool exactly five times as five separate calls, in this exact order.',
    ...commands.map((command, index) => `${index + 1}. Run exactly: ${command}`),
    'The fourth call is expected to be denied and the fifth may exit nonzero; continue through all five.',
    'Do not combine, quote, retry, inspect, explain, simulate, or use another tool.',
  ].join('\n');
  const execution = run('codex', [
    'exec', '--ephemeral', '--ignore-rules', '--skip-git-repo-check',
    '--sandbox', 'workspace-write', '--dangerously-bypass-hook-trust',
    '--cd', workspace, '--add-dir', writableDirectory, prompt,
  ], { env, cwd: workspace, timeout: 240000 });
  return { execution, commands };
}

function dispatcherSignals(execution) {
  const transcript = `${execution.stdout || ''}\n${execution.stderr || ''}`;
  const values = [...transcript.matchAll(/"dispatcher_called"\s*:\s*(true|false)/gu)]
    .map((match) => match[1]);
  return {
    true_count: values.filter((value) => value === 'true').length,
    false_count: values.filter((value) => value === 'false').length,
  };
}

function stateDigest(workspace) {
  const refs = run('git', ['-C', workspace, 'for-each-ref', '--format=%(refname)%00%(objectname)']);
  const worktrees = run('git', ['-C', workspace, 'worktree', 'list', '--porcelain']);
  const status = run('git', ['-C', workspace, 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  return {
    refs_sha256: sha256(Buffer.from(refs.stdout || '')),
    worktrees_sha256: sha256(Buffer.from(worktrees.stdout || '')),
    status_sha256: sha256(Buffer.from(status.stdout || '')),
  };
}

function stateUnchanged(before, after) {
  return before.refs_sha256 === after.refs_sha256
    && before.worktrees_sha256 === after.worktrees_sha256
    && before.status_sha256 === after.status_sha256;
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
    const brokenWorkspace = path.join(scratch, 'broken-workspace');
    const markers = path.join(scratch, 'markers');
    const brokenMarkers = path.join(scratch, 'broken-markers');
    const hookLog = path.join(scratch, 'pre-effect-log.jsonl');
    const targets = {
      negative: path.join(scratch, 'NEGATIVE_SENTINEL'),
      positive: path.join(scratch, 'POSITIVE_SENTINEL'),
      l5Direct: path.join(scratch, 'L5_DIRECT_SENTINEL'),
      broken: path.join(brokenWorkspace, 'BROKEN_SENTINEL'),
    };
    for (const directory of [brokenWorkspace, markers, brokenMarkers]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    run('git', ['init', '-q', brokenWorkspace]);
    prepareCodexHome(goodHome);
    prepareCodexHome(brokenHome);

    const childIsolation = run('bash', [
      path.join(repoRoot, 'hooks', 'tests', 'dispatch-hetero.test.sh'),
    ], { cwd: repoRoot, timeout: 600000 });
    const childIsolationMatch = String(childIsolation.stdout || '')
      .match(/PASS \[dispatch-hetero\] (\d+) assertions/u);
    const childIsolationReady = childIsolation.status === 0
      && Number(childIsolationMatch?.[1]) >= 213;

    const goodInstall = installAutopilot(goodHome, sourceRoot, {
      AUTOPILOT_SESSION_MODE_DIR: markers,
      AUTOPILOT_CODEX_PRE_EFFECT_TEST_LOG: hookLog,
    });
    const version = run('codex', ['--version'], { env: goodInstall.env });
    const installedRoot = goodInstall.plugin.status === 0
      ? installedAutopilotRoot(goodHome, sourceRoot)
      : null;
    const goodStateBefore = stateDigest(repoRoot);
    const negative = goodInstall.plugin.status === 0
      ? codexTouch(targets.negative, repoRoot, goodInstall.env)
      : { status: null, signal: null, stdout: '', stderr: '' };
    const goodStateAfterNegative = stateDigest(repoRoot);

    const campaign = findExistingCampaign(repoRoot);
    const campaignContract = campaign
      ? JSON.parse(fs.readFileSync(campaign.contract, 'utf8'))
      : null;
    const controlPrompt = path.join(scratch, 'managed-control.prompt.md');
    writeFile(controlPrompt, 'D4 existing-campaign admission control only.\n', 0o600);
    const engineCommand = installedRoot ? [
      'AUTOPILOT_LEVEL=l5',
      'node', path.join(installedRoot, 'bin', 'autopilot.js'),
      'engine', 'implement-review',
      '--campaign-contract', campaign ? campaign.contract : path.join(scratch, 'MISSING_CAMPAIGN.json'),
      ...(campaign ? ['--campaign-seal', campaign.seal] : []),
      '--prompt-file', controlPrompt,
      '--branch', campaignContract?.branch || 'mission/d4-installed-control',
      '--base', campaignContract?.base_sha || '0000000000000000000000000000000000000000',
      '--cwd', repoRoot,
      '--max-rounds', '1',
      '--no-verify-first',
      '--allow-unqualified-reviewer',
      '--no-review-spec',
    ].join(' ') : '';
    const sequence = installedRoot
      ? codexLifecycleSequence({
        workspace: repoRoot,
        writableDirectory: scratch,
        env: goodInstall.env,
        installedRoot,
        positiveTarget: targets.positive,
        l5DirectTarget: targets.l5Direct,
        engineCommand,
      })
      : {
        execution: { status: null, signal: null, stdout: '', stderr: '' },
        commands: [],
      };
    const goodStateAfterSequence = stateDigest(repoRoot);

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
    const negativeRows = rows.filter((row) => (
      row.command_class === 'effect' && row.reason_code === 'DEV_FLOW_ENTRY_REQUIRED'
    ));
    const lifecycleRows = rows.filter((row) => row.command_class === 'lifecycle_entry');
    const positiveRows = rows.filter((row) => (
      row.command_class === 'effect'
      && row.decision === 'allow' && row.marker_status === 'valid' && row.marker_level === 'l3'
    ));
    const l5DirectRows = rows.filter((row) => (
      row.command_class === 'effect'
      && row.decision === 'block'
      && row.reason_code === 'DEPTH_ZERO_MUTATION_FORBIDDEN'
      && row.marker_status === 'valid' && row.marker_level === 'l5'
    ));
    const managedRows = rows.filter((row) => (
      row.command_class === 'managed_engine_entry'
      && row.decision === 'allow' && row.reason_code === null
      && row.marker_status === 'valid' && row.marker_level === 'l5'
    ));
    const sentinels = {
      negative: Number(fs.existsSync(targets.negative)),
      positive: Number(fs.existsSync(targets.positive)),
      l5_direct: Number(fs.existsSync(targets.l5Direct)),
      broken: Number(fs.existsSync(targets.broken)),
    };
    const negativeStateUnchanged = stateUnchanged(goodStateBefore, goodStateAfterNegative);
    const sequenceStateUnchanged = stateUnchanged(goodStateAfterNegative, goodStateAfterSequence);
    const brokenStateUnchanged = stateUnchanged(brokenStateBefore, brokenStateAfter);
    const sequenceRows = [...lifecycleRows, ...positiveRows, ...l5DirectRows, ...managedRows];
    const sequenceSessionHashes = new Set(sequenceRows.map((row) => row.session_id_sha256));
    const sequenceSessionBound = sequenceRows.length === 5
      && sequenceSessionHashes.size === 1
      && [...sequenceSessionHashes].every((value) => /^[a-f0-9]{64}$/u.test(value || ''));
    const expectedManagedCommandSha256 = sha256(Buffer.from(engineCommand));
    const exactManagedEntry = managedRows.length === 1
      && managedRows[0].command_sha256 === expectedManagedCommandSha256;
    const managedSignals = dispatcherSignals(sequence.execution);
    const managedDispatcherReady = exactManagedEntry
      && managedSignals.true_count === 1
      && managedSignals.false_count === 0;
    const installedManifest = installedRoot
      ? fs.readFileSync(path.join(installedRoot, '.codex-plugin', 'plugin.json'))
      : Buffer.alloc(0);
    const installedAdapter = installedRoot
      ? fs.readFileSync(path.join(installedRoot, 'hooks', 'pre-effect.js'))
      : Buffer.alloc(0);
    const installedHookManifest = installedRoot
      ? fs.readFileSync(path.join(installedRoot, 'hooks', 'hooks.json'))
      : Buffer.alloc(0);
    const generatedAdapter = fs.readFileSync(path.join(sourceRoot, 'plugin', 'hooks', 'pre-effect.js'));
    const exactInstalledAdapter = installedAdapter.length > 0
      && sha256(installedAdapter) === sha256(generatedAdapter);
    const hookControlsReady = capabilityReady(capabilityEvidence)
      && version.status === 0
      && goodInstall.marketplace.status === 0
      && goodInstall.plugin.status === 0
      && brokenInstall.marketplace.status === 0
      && brokenInstall.plugin.status === 0
      && negative.status === 0
      && sequence.execution.status === 0
      && broken.status === 0
      && negativeRows.length === 1
      && lifecycleRows.length === 2
      && positiveRows.length === 1
      && l5DirectRows.length === 1
      && exactManagedEntry
      && sequenceSessionBound
      && childIsolationReady
      && sentinels.negative === 0
      && sentinels.positive === 1
      && sentinels.l5_direct === 0
      && sentinels.broken === 1
      && negativeStateUnchanged && sequenceStateUnchanged && brokenStateUnchanged
      && exactInstalledAdapter;
    const ready = hookControlsReady && managedDispatcherReady;
    const terminalBlocker = !hookControlsReady
      ? 'installed-package lifecycle controls did not reproduce exactly'
      : !managedDispatcherReady
        ? 'the sole existing campaign is bound to the pre-amendment Mission projection; no new campaign/work-order authority was available, so the exact managed Engine entry stopped before dispatcher invocation'
        : null;
    const receiptBody = {
      schema_version: 3,
      artifact_type: 'codex_pre_effect_production_receipt',
      observed_at: new Date().toISOString(),
      codex_version: String(version.stdout || version.stderr || '').trim(),
      capability_evidence: capabilityEvidence,
      production_contract: {
        event: 'PreToolUse',
        matcher: '.*',
        denial: { decision: 'block', reason_code: 'DEV_FLOW_ENTRY_REQUIRED' },
        installed_plugin_manifest_sha256: sha256(installedManifest),
        installed_hook_manifest_sha256: sha256(installedHookManifest),
        production_adapter_sha256: sha256(installedAdapter),
        generated_adapter_sha256: sha256(generatedAdapter),
        installed_adapter_matches_generated_payload: exactInstalledAdapter,
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
          lifecycle_entry_hook_invocations: lifecycleRows.filter((row) => (
            row.command_sha256 === sha256(Buffer.from(sequence.commands[0] || ''))
          )).length,
          hook_invocations: positiveRows.length,
          cli_exit_status: sequence.execution.status,
          sentinel_count: sentinels.positive,
          session_bound_to_hook_payload: sequenceSessionBound,
          transcript_sha256: sha256(Buffer.from(
            `${sequence.execution.stdout || ''}\0${sequence.execution.stderr || ''}`,
          )),
        },
        l5_direct_denial: {
          lifecycle_entry_hook_invocations: lifecycleRows.filter((row) => (
            row.command_sha256 === sha256(Buffer.from(sequence.commands[2] || ''))
          )).length,
          hook_invocations: l5DirectRows.length,
          sentinel_count: sentinels.l5_direct,
          reason_code: 'DEPTH_ZERO_MUTATION_FORBIDDEN',
          session_bound_to_same_hook_payload: sequenceSessionBound,
        },
        managed_engine_entry: {
          hook_invocations: managedRows.length,
          expected_command_sha256: expectedManagedCommandSha256,
          observed_exact_command_hash: exactManagedEntry,
          existing_campaign_reused: Boolean(campaign),
          campaign_contract_sha256: campaign ? sha256(fs.readFileSync(campaign.contract)) : null,
          campaign_seal_sha256: campaign ? sha256(fs.readFileSync(campaign.seal)) : null,
          dispatcher_called_true_count: managedSignals.true_count,
          dispatcher_called_false_count: managedSignals.false_count,
          exactly_one_managed_dispatcher_path: managedDispatcherReady,
          child_isolation_assertion: {
            actual_runner_test_exit_status: childIsolation.status,
            assertion_count: childIsolationMatch ? Number(childIsolationMatch[1]) : 0,
            controller_config_plugins_and_thread_absent: childIsolationReady,
            dispatch_script_sha256: sha256(fs.readFileSync(
              path.join(sourceRoot, 'plugin', 'scripts', 'dispatch-hetero.sh'),
            )),
            test_transcript_sha256: sha256(Buffer.from(
              `${childIsolation.stdout || ''}\0${childIsolation.stderr || ''}`,
            )),
          },
          new_campaign_or_work_order_created: false,
          git_state_unchanged: sequenceStateUnchanged,
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
      model_call_budget: {
        installed_codex_sessions: 3,
        managed_dispatcher_calls: managedSignals.true_count,
      },
      verdict: ready ? 'READY' : 'NOT_READY',
      d1_verdict: capabilityReady(capabilityEvidence) ? 'READY' : 'BLOCKED',
      d4_verdict: ready ? 'READY' : 'NOT_READY',
      hook_controls_verdict: hookControlsReady ? 'READY' : 'BLOCKED',
      terminal_blocker: terminalBlocker,
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
