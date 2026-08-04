#!/usr/bin/env node
'use strict';

// Bounded, evidence-preserving live validation for the production Codex
// PostCompact adapter. The driver itself owns the controller fixture for its
// entire lifetime so the sealed process-parentage authority cannot drift while
// an interactive Codex child is running.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  execFileSync,
  spawn,
} = require('child_process');

const SOURCE_ROOT = path.resolve(__dirname, '..');
const SUBMIT_KEY_INPUT = '\r';
const DIRECTORY_TRUST_ACCEPT_INPUT = '\r';
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
const BRACKETED_PASTE_BOUNDARY_SHA256 = '670510b6dbe957b6d2d8487263f61d59523fc2a536f2d4696d9146ce9448730e';
const PTY_TRANSPORT_SENTINEL = 'AUTOPILOT_D3_PTY_TRANSPORT_READY_V1';
const RAW_BOLD_PROMPT_MARKER = '\x1b[1m›';
const EXPECTED_CODEX_VERSION = '0.146.0';
const INITIAL_READINESS_TIMEOUT_MS = 90_000;
const AUTO_READY_PROMPT = 'Respond with exactly AUTO_READY.';
const AUTO_READY_PROMPT_SHA256 = '2d799c1721cd48464a465ccf9d03663bd1602aa8ca66d80b042afbe4159ab3ef';
const AUTO_CONTINUE_PROMPT = 'Respond with exactly AUTO_CONTINUE_READY.';
const AUTO_CONTINUE_PROMPT_SHA256 = 'fb37708aff2058a09d74267566423a25f8fc17a68b929c43e339978edae852c8';
const AUTO_PROTOCOL_EVENTS = Object.freeze({
  initial_prompt_sent: 'auto_prompt_sent',
  threshold_armed_presend: 'auto_threshold_armed_presend',
  continuation_prompt_sent: 'auto_continue_prompt_sent',
  context_compacted: 'auto_context_compacted',
  receipt_sealed: 'auto_reconcile_sealed',
  continuation_ready: 'auto_continuation_ready',
  effect_admitted: 'auto_effect_after_reconcile',
});
const AUTO_PROTOCOL_TRANSITIONS = Object.freeze({
  await_auto_ready: Object.freeze({ auto_ready_observed: 'threshold_armed' }),
  threshold_armed: Object.freeze({
    auto_authority_presend_validated: 'continuation_submit_required',
  }),
  continuation_submit_required: Object.freeze({
    auto_continuation_submitted: 'await_context_compacted',
  }),
  await_context_compacted: Object.freeze({
    auto_context_compacted: 'await_sealed_receipt',
  }),
  await_sealed_receipt: Object.freeze({ auto_receipt_sealed: 'await_continuation_ready' }),
  await_continuation_ready: Object.freeze({ auto_continuation_ready: 'effect_admissible' }),
  effect_admissible: Object.freeze({ auto_effect_admitted: 'complete' }),
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const nowIso = () => new Date().toISOString();

function advanceAutoProtocol(state, protocolEvent) {
  const next = AUTO_PROTOCOL_TRANSITIONS[state]
    && AUTO_PROTOCOL_TRANSITIONS[state][protocolEvent];
  if (!next) {
    throw new Error(`invalid auto protocol transition: ${state} -> ${protocolEvent}`);
  }
  return next;
}

function bracketedPasteFrame(value) {
  return `${BRACKETED_PASTE_START}${value}${BRACKETED_PASTE_END}`;
}

function bracketedPasteEvidence() {
  return {
    input_framing: 'bracketed_paste',
    frame_start_hex: Buffer.from(BRACKETED_PASTE_START).toString('hex'),
    frame_end_hex: Buffer.from(BRACKETED_PASTE_END).toString('hex'),
    frame_boundary_sha256: BRACKETED_PASTE_BOUNDARY_SHA256,
  };
}

function stripTerminal(value) {
  return String(value)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-2A-Z]/g, '')
    .replace(/\x1b./g, '')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function hasTuiReadinessMarker(value) {
  const raw = String(value);
  return raw.includes('OpenAI Codex')
    && raw.includes(RAW_BOLD_PROMPT_MARKER)
    && hasLoadedModelStatus(raw);
}

function hasLoadedModelStatus(value) {
  const text = stripTerminal(value);
  const statuses = text.matchAll(
    /\bmodel:[ \t]*([^\r\n/]*?\S)[ \t]*\/model[ \t]+to[ \t]+change\b/gi,
  );
  for (const status of statuses) {
    const model = status[1].trim();
    if (model && !/^loading\b/i.test(model)) return true;
  }
  return false;
}

function hasDirectoryTrustChooser(value) {
  const text = stripTerminal(value);
  return text.includes('1. Yes, continue') && text.includes('Press enter to continue');
}

function tuiRawText(tui) {
  let combined = tui && tui.output ? tui.output : '';
  if (tui && typeof tui.transcriptPath === 'string') {
    try {
      combined += `\n${fs.readFileSync(tui.transcriptPath, 'utf8')}`;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return combined;
}

function tuiText(tui) {
  return stripTerminal(tuiRawText(tui));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${key}`);
    }
    flags[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  for (const required of ['codex-bin', 'home', 'plugin-root', 'artifact-dir']) {
    if (!flags[required]) throw new Error(`--${required} is required`);
  }
  return flags;
}

function initRepo(repo) {
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'd3-live@example.invalid']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'D3 Live Driver']);
  fs.writeFileSync(path.join(repo, 'seed'), 'seed\n');
  execFileSync('git', ['-C', repo, 'add', 'seed']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'seed']);
}

function createControllerFixture({
  sourceRoot = SOURCE_ROOT,
  repo,
  rootRunId,
  ownerPid = process.pid,
}) {
  const workOrder = require(path.join(sourceRoot, 'src', 'engine', 'work-order'));
  const controllerExecution = require(path.join(
    sourceRoot,
    'src',
    'engine',
    'controller-execution',
  ));
  const graphNode = 'controller';
  const attempt = 1;
  const workOrderId = `wo-${rootRunId}-${graphNode}-a${attempt}`;
  const baseSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const branch = execFileSync(
    'git',
    ['-C', repo, 'symbolic-ref', '--quiet', '--short', 'HEAD'],
    { encoding: 'utf8' },
  ).trim();
  const commonDir = workOrder.resolveGitCommonDir(repo);
  const parentage = workOrder.captureProcessParentage(ownerPid);
  if (!workOrder.isCompleteIdentity(parentage.owner)) {
    throw new Error('live driver owner identity is incomplete');
  }
  const controller = controllerExecution.emptyControllerState({
    phase: 'CONTROLLER',
    next_action: 'continue',
    process_parentage: parentage,
    resource_inventory: [],
    dispatch_records: [],
    branch,
    worktree: repo,
  });
  const authorityDir = path.join(
    commonDir,
    'autopilot',
    'postcompact-fixtures',
    rootRunId,
  );
  const paths = {
    durable: path.join(authorityDir, 'durable.json'),
    checkpoint: path.join(authorityDir, 'checkpoint.json'),
    ledger: path.join(authorityDir, 'ledger.jsonl'),
    manifest: path.join(authorityDir, 'manifest.json'),
    receipt: path.join(authorityDir, 'result-index.json'),
  };
  const writtenAt = nowIso();
  workOrder.writeAtomicJson(paths.durable, {
    schema_version: 1,
    artifact_type: 'controller_durable_state',
    root_run_id: rootRunId,
    graph_node: graphNode,
    attempt,
    work_order_id: workOrderId,
    campaign_id: rootRunId,
    icc_campaign_id: rootRunId,
    controller_digest: controller.controller_digest,
    written_at: writtenAt,
  });
  workOrder.writeAtomicJson(paths.checkpoint, {
    schema_version: 1,
    artifact_type: 'controller_checkpoint',
    root_run_id: rootRunId,
    graph_node: graphNode,
    attempt,
    work_order_id: workOrderId,
    controller,
    written_at: writtenAt,
  });
  workOrder.writeAtomicJson(paths.manifest, {
    schema_version: 1,
    artifact_type: 'controller_dispatch_manifest_index',
    root_run_id: rootRunId,
    graph_node: graphNode,
    attempt,
    work_order_id: workOrderId,
    controller_digest: controller.controller_digest,
    entries: [],
    written_at: writtenAt,
  });
  workOrder.writeAtomicJson(paths.receipt, {
    schema_version: 1,
    artifact_type: 'controller_dispatch_result_index',
    root_run_id: rootRunId,
    graph_node: graphNode,
    attempt,
    work_order_id: workOrderId,
    controller_digest: controller.controller_digest,
    entries: [],
    written_at: writtenAt,
  });
  fs.writeFileSync(paths.ledger, `${JSON.stringify({
    schema_version: 1,
    event: 'controller_heartbeat',
    root_run_id: rootRunId,
    work_order_id: workOrderId,
    controller_digest: controller.controller_digest,
    at: writtenAt,
  })}\n`);
  const written = workOrder.createOrUpdateWorkOrder(commonDir, {
    root_run_id: rootRunId,
    graph_node: graphNode,
    attempt,
    role: 'controller',
    owner: parentage.owner,
    branch,
    base_sha: baseSha,
    worktree: repo,
    paths,
    phase_cursor: 'CONTROLLER',
    next_action: 'continue',
    controller,
  }, { bindArtifacts: true });
  if (written.status !== 'written') {
    throw new Error(`controller fixture write rejected: ${written.reason || written.status}`);
  }
  return {
    repo,
    rootRunId,
    graphNode,
    attempt,
    owner: parentage.owner,
    workOrder: written.work_order,
    workOrderPath: written.path,
    reconcileReceipt: workOrder.reconcileReceiptPath(commonDir, rootRunId),
  };
}

function validateFixtureAuthority(sourceRoot, fixture) {
  const workOrder = require(path.join(sourceRoot, 'src', 'engine', 'work-order'));
  const loaded = workOrder.readJsonStrict(fixture.workOrderPath);
  if (!loaded.ok || !loaded.value) {
    throw new Error(`controller fixture is unreadable: ${loaded.reason || 'missing'}`);
  }
  const observed = workOrder.validateControllerRecoveryAuthority(loaded.value, {
    rootRunId: fixture.rootRunId,
    graphNode: fixture.graphNode,
    attempt: fixture.attempt,
    workOrderId: fixture.workOrder.work_order_id,
    gitCwd: fixture.repo,
  });
  if (!observed.ok) {
    throw new Error(`controller fixture authority invalid: ${observed.reason_code}: ${observed.reason}`);
  }
  return observed;
}

function boundedWaitDecision({ ready, exited, elapsedMs, timeoutMs }) {
  if (ready) return 'ready';
  if (exited) return 'exited';
  if (elapsedMs >= timeoutMs) return 'timeout';
  return 'pending';
}

function waitFor(check, timeoutMs, label, processState = null) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      try {
        const value = check();
        const decision = boundedWaitDecision({
          ready: Boolean(value),
          exited: Boolean(processState && processState.exited),
          elapsedMs: Date.now() - started,
          timeoutMs,
        });
        if (decision === 'ready') {
          clearInterval(timer);
          resolve(value);
          return;
        }
        if (decision === 'exited') {
          clearInterval(timer);
          reject(new Error(`${label}: TUI exited ${processState.exitCode}`));
          return;
        }
        if (decision === 'timeout') {
          clearInterval(timer);
          reject(new Error(`${label}: timed out after ${timeoutMs}ms`));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 100);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function tuiEnvironment(home, baseEnvironment = process.env) {
  return {
    ...baseEnvironment,
    HOME: home,
    TERM: 'xterm-256color',
  };
}

function allocatedPtyCommand(command) {
  return `stty rows 24 cols 80 && printf '%s\\n' ${shellQuote(PTY_TRANSPORT_SENTINEL)} && exec ${command}`;
}

function codexTuiArgs(compactLimit) {
  return [
    '--no-alt-screen',
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    '--disable',
    'apps',
    '-c',
    `model_auto_compact_token_limit=${compactLimit}`,
  ];
}

function startTui({
  codexBin,
  home,
  repo,
  transcriptPath,
  compactLimit,
  acceptDirectoryTrust,
  spawnFn = spawn,
}) {
  if (typeof acceptDirectoryTrust !== 'boolean') {
    throw new Error('acceptDirectoryTrust must identify fresh versus reused repository trust');
  }
  const command = [
    codexBin,
    ...codexTuiArgs(compactLimit),
  ].map(shellQuote).join(' ');
  const child = spawnFn('/usr/bin/script', [
    '-q',
    '-f',
    '-c', allocatedPtyCommand(command),
    transcriptPath,
  ], {
    cwd: repo,
    env: tuiEnvironment(home),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = {
    child,
    output: '',
    exited: false,
    exitCode: null,
    transcriptPath,
    acceptDirectoryTrust,
    directoryTrustAcceptSent: false,
  };
  const append = (chunk) => { state.output += chunk.toString('utf8'); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('exit', (code) => {
    state.exited = true;
    state.exitCode = code;
  });
  return state;
}

async function waitForTuiReady(tui, event) {
  if (tui.acceptDirectoryTrust) {
    await waitFor(
      () => hasDirectoryTrustChooser(tuiRawText(tui)),
      INITIAL_READINESS_TIMEOUT_MS,
      'TUI directory trust chooser readiness',
      tui,
    );
    if (!tui.directoryTrustAcceptSent) {
      tui.child.stdin.write(DIRECTORY_TRUST_ACCEPT_INPUT);
      tui.directoryTrustAcceptSent = true;
      event('directory_trust_accept_sent', {
        input_bytes: Buffer.byteLength(DIRECTORY_TRUST_ACCEPT_INPUT),
        input_hex: Buffer.from(DIRECTORY_TRUST_ACCEPT_INPUT).toString('hex'),
        input_sha256: sha256(DIRECTORY_TRUST_ACCEPT_INPUT),
      });
    }
  } else {
    await waitFor(
      () => hasTuiReadinessMarker(tuiRawText(tui)),
      INITIAL_READINESS_TIMEOUT_MS,
      'TUI initial readiness',
      tui,
    );
  }
  await waitFor(
    () => hasTuiReadinessMarker(tuiRawText(tui)),
    60_000,
    'TUI composer readiness',
    tui,
  );
  event('tui_ready', {});
}

async function submitTui(tui, value, event, stage) {
  tui.child.stdin.write(bracketedPasteFrame(value));
  await delay(100);
  tui.child.stdin.write(SUBMIT_KEY_INPUT);
  event(stage, {
    input_sha256: sha256(value),
    submit_key_bytes: Buffer.byteLength(SUBMIT_KEY_INPUT),
    submit_key_hex: Buffer.from(SUBMIT_KEY_INPUT).toString('hex'),
    submit_key_sha256: sha256(SUBMIT_KEY_INPUT),
    ...bracketedPasteEvidence(),
  });
}

async function stopTui(tui, event) {
  if (tui.exited) return;
  tui.child.stdin.write(bracketedPasteFrame('/exit'));
  await delay(100);
  tui.child.stdin.write(SUBMIT_KEY_INPUT);
  try {
    await waitFor(() => tui.exited, 15_000, 'TUI exit', tui);
  } catch (_error) {
    tui.child.kill('SIGTERM');
    await waitFor(() => tui.exited, 5_000, 'TUI terminate', null).catch(() => {});
  }
  event('tui_stopped', {
    exit_code: tui.exitCode,
    submit_key_bytes: Buffer.byteLength(SUBMIT_KEY_INPUT),
    submit_key_hex: Buffer.from(SUBMIT_KEY_INPUT).toString('hex'),
    submit_key_sha256: sha256(SUBMIT_KEY_INPUT),
    ...bracketedPasteEvidence(),
  });
}

function readJson(pathname) {
  try {
    return JSON.parse(fs.readFileSync(pathname, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function receiptReady(pathname, trigger, priorDigest = null) {
  const receipt = readJson(pathname);
  if (!receipt || receipt.hook_trigger !== trigger || receipt.digest === priorDigest) return null;
  const classification = Array.isArray(receipt.classifications)
    ? receipt.classifications[0]
    : null;
  return classification
    && classification.classification === 'attach_active'
    && classification.recovery === true
    ? receipt
    : null;
}

function persistTranscript(tui, artifactDir, stage) {
  const raw = fs.readFileSync(tui.transcriptPath);
  const sanitized = stripTerminal(raw.toString('utf8'));
  const sanitizedPath = path.join(artifactDir, `${stage}-terminal.sanitized.txt`);
  fs.writeFileSync(sanitizedPath, sanitized);
  return {
    raw_sha256: sha256(raw),
    raw_bytes: raw.length,
    sanitized_sha256: sha256(sanitized),
    sanitized_bytes: Buffer.byteLength(sanitized),
    sanitized_path: sanitizedPath,
  };
}

async function runLive(flags) {
  const codexBin = fs.realpathSync(flags['codex-bin']);
  const home = fs.realpathSync(flags.home);
  const pluginRoot = fs.realpathSync(flags['plugin-root']);
  const artifactDir = path.resolve(flags['artifact-dir']);
  const autoLimit = Number(flags['auto-limit'] || 12_000);
  if (!Number.isSafeInteger(autoLimit) || autoLimit < 1) {
    throw new Error('--auto-limit must be a positive integer');
  }
  if (fs.existsSync(artifactDir)) {
    throw new Error(`artifact directory already exists: ${artifactDir}`);
  }
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const eventsPath = path.join(artifactDir, 'events.jsonl');
  const event = (stage, details) => {
    const row = { stage, at: nowIso(), ...details };
    row.digest = sha256(JSON.stringify(row));
    fs.appendFileSync(eventsPath, `${JSON.stringify(row)}\n`);
    return row;
  };
  const versionText = execFileSync(codexBin, ['--version'], { encoding: 'utf8' }).trim();
  const versionMatch = versionText.match(/(\d+\.\d+\.\d+)/);
  if (!versionMatch || versionMatch[1] !== EXPECTED_CODEX_VERSION) {
    throw new Error(`expected Codex ${EXPECTED_CODEX_VERSION}, got ${versionText}`);
  }
  const adapterPath = path.join(pluginRoot, 'hooks', 'post-compact.js');
  const adapterOriginal = fs.readFileSync(adapterPath);
  const adapterMode = fs.statSync(adapterPath).mode;
  const productionRepo = path.join(artifactDir, 'production');
  const brokenRepo = path.join(artifactDir, 'broken');
  initRepo(productionRepo);
  initRepo(brokenRepo);
  const productionFixture = createControllerFixture({
    sourceRoot: SOURCE_ROOT,
    repo: productionRepo,
    rootRunId: 'd3-production-live',
    ownerPid: process.pid,
  });
  const brokenFixture = createControllerFixture({
    sourceRoot: SOURCE_ROOT,
    repo: brokenRepo,
    rootRunId: 'd3-production-broken',
    ownerPid: process.pid,
  });
  event('driver_started', {
    codex_version: versionMatch[1],
    codex_binary_sha256: sha256(fs.readFileSync(codexBin)),
    plugin_manifest_sha256: sha256(fs.readFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'))),
    hook_manifest_sha256: sha256(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'))),
    adapter_sha256: sha256(adapterOriginal),
    owner_pid: process.pid,
  });
  const receipt = {
    schema_version: 1,
    artifact_type: 'codex_postcompact_production_live_receipt',
    observed_at: null,
    codex_version: versionMatch[1],
    driver_sha256: sha256(fs.readFileSync(__filename)),
    manual: null,
    auto: null,
    broken_adapter: null,
  };
  let activeTui = null;
  let runFailure = null;
  try {
    validateFixtureAuthority(SOURCE_ROOT, productionFixture);
    event('manual_authority_preflight', { status: 'ready' });
    activeTui = startTui({
      codexBin,
      home,
      repo: productionRepo,
      transcriptPath: path.join(artifactDir, 'manual-terminal.raw'),
      compactLimit: 1_000_000,
      acceptDirectoryTrust: true,
    });
    await waitForTuiReady(activeTui, event);
    await submitTui(activeTui, 'Respond with exactly MANUAL_READY.', event, 'manual_prompt_sent');
    await waitFor(
      () => tuiText(activeTui).includes('• MANUAL_READY'),
      120_000,
      'manual response readiness',
      activeTui,
    );
    validateFixtureAuthority(SOURCE_ROOT, productionFixture);
    event('manual_authority_presend', { status: 'ready' });
    await submitTui(activeTui, '/compact', event, 'manual_compact_sent');
    await waitFor(
      () => tuiText(activeTui).includes('Context compacted'),
      120_000,
      'manual context compacted',
      activeTui,
    );
    const manualReceipt = await waitFor(
      () => receiptReady(productionFixture.reconcileReceipt, 'manual'),
      60_000,
      'manual sealed reconciliation receipt',
      activeTui,
    );
    const manualReceiptPath = path.join(artifactDir, 'manual-reconcile.json');
    fs.writeFileSync(manualReceiptPath, `${JSON.stringify(manualReceipt, null, 2)}\n`);
    const manualSentinel = path.join(artifactDir, 'manual.sentinel');
    fs.writeFileSync(manualSentinel, 'manual effect after sealed reconciliation\n');
    event('manual_effect_after_reconcile', {
      receipt_digest: manualReceipt.digest,
      sentinel_sha256: sha256(fs.readFileSync(manualSentinel)),
    });
    await stopTui(activeTui, event);
    const manualTerminal = persistTranscript(activeTui, artifactDir, 'manual');
    receipt.manual = {
      trigger: manualReceipt.hook_trigger,
      invocation_digest: manualReceipt.hook_invocation_digest,
      reconcile_receipt_digest: manualReceipt.digest,
      sentinel_sha256: sha256(fs.readFileSync(manualSentinel)),
      terminal_sha256: manualTerminal.sanitized_sha256,
    };
    activeTui = null;

    validateFixtureAuthority(SOURCE_ROOT, productionFixture);
    event('auto_authority_preflight', { status: 'ready', threshold: autoLimit });
    activeTui = startTui({
      codexBin,
      home,
      repo: productionRepo,
      transcriptPath: path.join(artifactDir, 'auto-terminal.raw'),
      compactLimit: autoLimit,
      acceptDirectoryTrust: false,
    });
    await waitForTuiReady(activeTui, event);
    let autoProtocolState = 'await_auto_ready';
    await submitTui(
      activeTui,
      AUTO_READY_PROMPT,
      event,
      AUTO_PROTOCOL_EVENTS.initial_prompt_sent,
    );
    await waitFor(
      () => tuiText(activeTui).includes('• AUTO_READY'),
      120_000,
      'auto threshold-arming response readiness',
      activeTui,
    );
    autoProtocolState = advanceAutoProtocol(autoProtocolState, 'auto_ready_observed');
    validateFixtureAuthority(SOURCE_ROOT, productionFixture);
    autoProtocolState = advanceAutoProtocol(
      autoProtocolState,
      'auto_authority_presend_validated',
    );
    event(AUTO_PROTOCOL_EVENTS.threshold_armed_presend, {
      status: 'ready',
      threshold: autoLimit,
      protocol_state: autoProtocolState,
      initial_prompt_sha256: AUTO_READY_PROMPT_SHA256,
    });
    await submitTui(
      activeTui,
      AUTO_CONTINUE_PROMPT,
      event,
      AUTO_PROTOCOL_EVENTS.continuation_prompt_sent,
    );
    autoProtocolState = advanceAutoProtocol(autoProtocolState, 'auto_continuation_submitted');
    await waitFor(
      () => tuiText(activeTui).includes('Context compacted'),
      180_000,
      'forced-auto context compacted',
      activeTui,
    );
    autoProtocolState = advanceAutoProtocol(autoProtocolState, 'auto_context_compacted');
    event(AUTO_PROTOCOL_EVENTS.context_compacted, {
      protocol_state: autoProtocolState,
      continuation_prompt_sha256: AUTO_CONTINUE_PROMPT_SHA256,
    });
    const autoReceipt = await waitFor(
      () => receiptReady(productionFixture.reconcileReceipt, 'auto', manualReceipt.digest),
      180_000,
      'forced-auto sealed reconciliation receipt',
      activeTui,
    );
    autoProtocolState = advanceAutoProtocol(autoProtocolState, 'auto_receipt_sealed');
    event(AUTO_PROTOCOL_EVENTS.receipt_sealed, {
      protocol_state: autoProtocolState,
      receipt_digest: autoReceipt.digest,
    });
    const autoReceiptPath = path.join(artifactDir, 'auto-reconcile.json');
    fs.writeFileSync(autoReceiptPath, `${JSON.stringify(autoReceipt, null, 2)}\n`);
    await waitFor(
      () => tuiText(activeTui).includes('• AUTO_CONTINUE_READY'),
      120_000,
      'auto continuation response readiness',
      activeTui,
    );
    autoProtocolState = advanceAutoProtocol(autoProtocolState, 'auto_continuation_ready');
    event(AUTO_PROTOCOL_EVENTS.continuation_ready, {
      protocol_state: autoProtocolState,
      receipt_digest: autoReceipt.digest,
    });
    autoProtocolState = advanceAutoProtocol(autoProtocolState, 'auto_effect_admitted');
    const autoSentinel = path.join(artifactDir, 'auto.sentinel');
    fs.writeFileSync(autoSentinel, 'auto effect after sealed reconciliation\n');
    event(AUTO_PROTOCOL_EVENTS.effect_admitted, {
      receipt_digest: autoReceipt.digest,
      sentinel_sha256: sha256(fs.readFileSync(autoSentinel)),
      protocol_state: autoProtocolState,
    });
    await stopTui(activeTui, event);
    const autoTerminal = persistTranscript(activeTui, artifactDir, 'auto');
    receipt.auto = {
      trigger: autoReceipt.hook_trigger,
      invocation_digest: autoReceipt.hook_invocation_digest,
      reconcile_receipt_digest: autoReceipt.digest,
      sentinel_sha256: sha256(fs.readFileSync(autoSentinel)),
      terminal_sha256: autoTerminal.sanitized_sha256,
      threshold: autoLimit,
      initial_prompt_sha256: AUTO_READY_PROMPT_SHA256,
      continuation_prompt_sha256: AUTO_CONTINUE_PROMPT_SHA256,
    };
    activeTui = null;

    validateFixtureAuthority(SOURCE_ROOT, brokenFixture);
    event('broken_authority_preflight', { status: 'ready' });
    fs.writeFileSync(adapterPath, [
      '#!/usr/bin/env node',
      "'use strict';",
      "require('fs').readFileSync(0);",
      "process.stderr.write('D3_BROKEN_ADAPTER_CONTROL\\n');",
      'process.exit(2);',
      '',
    ].join('\n'), { mode: adapterMode });
    event('broken_adapter_installed', {
      adapter_sha256: sha256(fs.readFileSync(adapterPath)),
    });
    activeTui = startTui({
      codexBin,
      home,
      repo: brokenRepo,
      transcriptPath: path.join(artifactDir, 'broken-terminal.raw'),
      compactLimit: 1_000_000,
      acceptDirectoryTrust: true,
    });
    await waitForTuiReady(activeTui, event);
    await submitTui(activeTui, 'Respond with exactly BROKEN_READY.', event, 'broken_prompt_sent');
    await waitFor(
      () => tuiText(activeTui).includes('• BROKEN_READY'),
      120_000,
      'broken response readiness',
      activeTui,
    );
    await submitTui(activeTui, '/compact', event, 'broken_compact_sent');
    await waitFor(
      () => tuiText(activeTui).includes('Context compacted'),
      120_000,
      'broken context compacted',
      activeTui,
    );
    await waitFor(() => {
      const text = tuiText(activeTui);
      return text.includes('PostCompact hook (failed)')
        && text.includes('D3_BROKEN_ADAPTER_CONTROL');
    }, 120_000, 'broken adapter failure boundary', activeTui);
    if (fs.existsSync(brokenFixture.reconcileReceipt)) {
      throw new Error('broken adapter unexpectedly persisted a reconciliation receipt');
    }
    const brokenSentinel = path.join(artifactDir, 'broken.sentinel');
    if (fs.existsSync(brokenSentinel)) {
      throw new Error('broken adapter unexpectedly admitted the effect sentinel');
    }
    event('broken_effect_blocked', {
      reconcile_receipt_exists: false,
      sentinel_exists: false,
      outer_action_failed: true,
    });
    await stopTui(activeTui, event);
    const brokenTerminal = persistTranscript(activeTui, artifactDir, 'broken');
    receipt.broken_adapter = {
      hook_failed: true,
      reconcile_receipt_exists: false,
      sentinel_exists: false,
      terminal_sha256: brokenTerminal.sanitized_sha256,
    };
    activeTui = null;
  } catch (error) {
    runFailure = error;
  } finally {
    if (activeTui) await stopTui(activeTui, event);
    fs.writeFileSync(adapterPath, adapterOriginal, { mode: adapterMode });
  }
  if (runFailure) {
    const terminalDigests = {};
    for (const stage of ['manual', 'auto', 'broken']) {
      const transcriptPath = path.join(artifactDir, `${stage}-terminal.raw`);
      if (fs.existsSync(transcriptPath)) {
        terminalDigests[stage] = persistTranscript({ transcriptPath }, artifactDir, stage);
      }
    }
    event('driver_failed', {
      reason_sha256: sha256(runFailure.message || String(runFailure)),
      stages_with_terminal: Object.keys(terminalDigests),
    });
    const failureIndex = {
      schema_version: 1,
      artifact_type: 'codex_postcompact_live_failure_index',
      sealed_at: nowIso(),
      events_sha256: sha256(fs.readFileSync(eventsPath)),
      terminal_digests: terminalDigests,
    };
    failureIndex.digest = sha256(JSON.stringify(failureIndex));
    fs.writeFileSync(
      path.join(artifactDir, 'failure-index.json'),
      `${JSON.stringify(failureIndex, null, 2)}\n`,
    );
    throw runFailure;
  }
  receipt.observed_at = nowIso();
  receipt.events_sha256 = sha256(fs.readFileSync(eventsPath));
  receipt.digest = sha256(JSON.stringify(receipt));
  const receiptPath = path.join(artifactDir, 'live-receipt.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  event('driver_complete', { receipt_digest: receipt.digest });
  process.stdout.write(`${JSON.stringify({ status: 'ready', receipt_path: receiptPath, receipt })}\n`);
}

module.exports = {
  AUTO_CONTINUE_PROMPT,
  AUTO_CONTINUE_PROMPT_SHA256,
  AUTO_PROTOCOL_EVENTS,
  AUTO_READY_PROMPT,
  AUTO_READY_PROMPT_SHA256,
  BRACKETED_PASTE_BOUNDARY_SHA256,
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  INITIAL_READINESS_TIMEOUT_MS,
  PTY_TRANSPORT_SENTINEL,
  RAW_BOLD_PROMPT_MARKER,
  advanceAutoProtocol,
  allocatedPtyCommand,
  boundedWaitDecision,
  codexTuiArgs,
  createControllerFixture,
  hasDirectoryTrustChooser,
  hasLoadedModelStatus,
  hasTuiReadinessMarker,
  startTui,
  stripTerminal,
  stopTui,
  submitTui,
  tuiText,
  tuiEnvironment,
  tuiRawText,
  validateFixtureAuthority,
  waitForTuiReady,
};

if (require.main === module) {
  runLive(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`probe-codex-postcompact-production: ${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
