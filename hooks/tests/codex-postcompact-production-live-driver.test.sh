#!/usr/bin/env bash
# Deterministic contract for the production Codex live driver's controller fixture.
. "$(dirname "$0")/lib.sh"

node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { EventEmitter } = require('events');

const [root, temp] = process.argv.slice(2);
const driver = require(path.join(root, 'scripts', 'probe-codex-postcompact-production'));
const workOrder = require(path.join(root, 'src', 'engine', 'work-order'));
const controller = require(path.join(root, 'src', 'engine', 'controller-execution'));

assert.strictEqual(driver.boundedWaitDecision({
  ready: false,
  exited: false,
  elapsedMs: 30_001,
  timeoutMs: driver.INITIAL_READINESS_TIMEOUT_MS,
}), 'pending');
assert.strictEqual(driver.boundedWaitDecision({
  ready: true,
  exited: false,
  elapsedMs: 60_000,
  timeoutMs: driver.INITIAL_READINESS_TIMEOUT_MS,
}), 'ready');
assert.strictEqual(driver.boundedWaitDecision({
  ready: false,
  exited: false,
  elapsedMs: 90_000,
  timeoutMs: driver.INITIAL_READINESS_TIMEOUT_MS,
}), 'timeout');
assert.strictEqual(driver.INITIAL_READINESS_TIMEOUT_MS, 90_000);
assert.deepStrictEqual(driver.codexTuiArgs(12_000), [
  '--no-alt-screen',
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '--disable',
  'apps',
  '-c',
  'model_auto_compact_token_limit=12000',
]);
assert.strictEqual(
  driver.PTY_TRANSPORT_SENTINEL,
  'AUTOPILOT_D3_PTY_TRANSPORT_READY_V1',
);
assert.strictEqual(
  driver.stripTerminal(`${driver.PTY_TRANSPORT_SENTINEL}\r\n`)
    .includes(driver.PTY_TRANSPORT_SENTINEL),
  true,
);
assert.strictEqual(
  driver.allocatedPtyCommand("'/usr/bin/true'"),
  "stty rows 24 cols 80 && printf '%s\\n' 'AUTOPILOT_D3_PTY_TRANSPORT_READY_V1' && exec '/usr/bin/true'",
);

const ptyEnvironment = driver.tuiEnvironment('/isolated/home', { PATH: '/usr/bin' });
assert.strictEqual(ptyEnvironment.HOME, '/isolated/home');
assert.strictEqual(ptyEnvironment.TERM, 'xterm-256color');
const geometryTranscript = path.join(temp, 'geometry-terminal.raw');
const observedGeometry = execFileSync('/usr/bin/script', [
  '-q',
  '-c', driver.allocatedPtyCommand('stty size'),
  geometryTranscript,
], {
  encoding: 'utf8',
  env: ptyEnvironment,
}).trim();
assert.strictEqual(observedGeometry, `${driver.PTY_TRANSPORT_SENTINEL}\r\n24 80`);
const failedTransport = spawnSync('/bin/sh', [
  '-c',
  driver.allocatedPtyCommand("/usr/bin/printf 'CODEX_EXECUTED\\n'"),
], { encoding: 'utf8' });
assert.notStrictEqual(failedTransport.status, 0);
assert.strictEqual(failedTransport.stdout.includes(driver.PTY_TRANSPORT_SENTINEL), false);
assert.strictEqual(failedTransport.stdout.includes('CODEX_EXECUTED'), false);
assert.strictEqual(
  driver.hasTuiReadinessMarker([
    '\u001b[1mOpenAI Codex\u001b[0m',
    '\u001b[1m›\u001b[0m',
    'model: test-model /model to change',
  ].join('\n')),
  true,
);
assert.strictEqual(driver.hasTuiReadinessMarker([
  'OpenAI Codex',
  '\u001b[1m›',
  'model: loading /model to change',
].join('\n')), false);
assert.strictEqual(driver.hasTuiReadinessMarker('OpenAI Codex\n›'), false);
assert.strictEqual(driver.hasTuiReadinessMarker('\u001b[1m›'), false);
assert.strictEqual(driver.RAW_BOLD_PROMPT_MARKER, '\u001b[1m›');
assert.strictEqual(driver.hasLoadedModelStatus('model: loading /model to change'), false);
assert.strictEqual(driver.hasLoadedModelStatus('model: /model to change'), false);
assert.strictEqual(driver.hasLoadedModelStatus('model: test-model /model to change'), true);
assert.strictEqual(driver.hasLoadedModelStatus(
  '\u001b[2Kmodel:\u001b[4Ctest-model\u001b[2C/model to change',
), true);
const cursorDiffChooserPrefix = [
  driver.PTY_TRANSPORT_SENTINEL,
  '\u001b[2J\u001b[H›',
  '\u001b[12C1. Yes, continue',
].join('\n');
assert.strictEqual(driver.hasDirectoryTrustChooser(cursorDiffChooserPrefix), false);
const cursorDiffChooserComplete = `${cursorDiffChooserPrefix}\n\u001b[4CPress enter to continue`;
assert.strictEqual(driver.hasDirectoryTrustChooser(cursorDiffChooserComplete), true);
assert.strictEqual(driver.hasTuiReadinessMarker(cursorDiffChooserComplete), false);
assert.strictEqual(driver.hasDirectoryTrustChooser([
  'Do you trust the contents of this directory?',
  '1. Yes, continue',
  'Press enter to continue',
].join('\n')), true);
const transcriptOnlyPath = path.join(temp, 'transcript-only-terminal.raw');
execFileSync('/usr/bin/script', [
  '-q',
  '-c', driver.allocatedPtyCommand(
    "/usr/bin/printf '\\033[1mOpenAI Codex\\033[0m\\n\\033[1m›\\033[0m\\nmodel: fixture-model /model to change\\n• MANUAL_READY\\nContext compacted\\nPostCompact hook (failed)\\nD3_BROKEN_ADAPTER_CONTROL\\n'",
  ),
  transcriptOnlyPath,
], {
  stdio: 'ignore',
  env: ptyEnvironment,
});
const transcriptOnlyText = driver.tuiText({
  output: 'captured stdout incomplete',
  transcriptPath: transcriptOnlyPath,
});
assert.strictEqual(driver.hasTuiReadinessMarker(driver.tuiRawText({
  output: 'captured stdout incomplete',
  transcriptPath: transcriptOnlyPath,
})), true);
assert.strictEqual(transcriptOnlyText.includes('• MANUAL_READY'), true);
assert.strictEqual(transcriptOnlyText.includes('Context compacted'), true);
assert.strictEqual(transcriptOnlyText.includes('PostCompact hook (failed)'), true);
assert.strictEqual(transcriptOnlyText.includes('D3_BROKEN_ADAPTER_CONTROL'), true);

const TRUST_ACCEPT_SHA256 = '9d1e0e2d9459d06523ad13e28a4093c2316baafe7aec5b25f30eba2e113599c4';
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
const BRACKETED_PASTE_BOUNDARY_SHA256 = '670510b6dbe957b6d2d8487263f61d59523fc2a536f2d4696d9146ce9448730e';
assert.strictEqual(driver.BRACKETED_PASTE_START, BRACKETED_PASTE_START);
assert.strictEqual(driver.BRACKETED_PASTE_END, BRACKETED_PASTE_END);
assert.strictEqual(
  driver.BRACKETED_PASTE_BOUNDARY_SHA256,
  BRACKETED_PASTE_BOUNDARY_SHA256,
);
assert.strictEqual(driver.AUTO_READY_PROMPT, 'Respond with exactly AUTO_READY.');
assert.strictEqual(
  driver.AUTO_READY_PROMPT_SHA256,
  '2d799c1721cd48464a465ccf9d03663bd1602aa8ca66d80b042afbe4159ab3ef',
);
assert.strictEqual(
  driver.AUTO_CONTINUE_PROMPT,
  'Respond with exactly AUTO_CONTINUE_READY.',
);
assert.strictEqual(
  driver.AUTO_CONTINUE_PROMPT_SHA256,
  'fb37708aff2058a09d74267566423a25f8fc17a68b929c43e339978edae852c8',
);
assert.deepStrictEqual(driver.AUTO_PROTOCOL_EVENTS, {
  initial_prompt_sent: 'auto_prompt_sent',
  threshold_armed_presend: 'auto_threshold_armed_presend',
  continuation_prompt_sent: 'auto_continue_prompt_sent',
  context_compacted: 'auto_context_compacted',
  receipt_sealed: 'auto_reconcile_sealed',
  continuation_ready: 'auto_continuation_ready',
  effect_admitted: 'auto_effect_after_reconcile',
});

assert.throws(
  () => driver.advanceAutoProtocol('await_auto_ready', 'auto_continuation_submitted'),
  /invalid auto protocol transition/,
);
let autoProtocolState = driver.advanceAutoProtocol(
  'await_auto_ready',
  'auto_ready_observed',
);
assert.strictEqual(autoProtocolState, 'threshold_armed');
assert.throws(
  () => driver.advanceAutoProtocol(autoProtocolState, 'auto_continuation_submitted'),
  /invalid auto protocol transition/,
);
autoProtocolState = driver.advanceAutoProtocol(
  autoProtocolState,
  'auto_authority_presend_validated',
);
assert.strictEqual(autoProtocolState, 'continuation_submit_required');
autoProtocolState = driver.advanceAutoProtocol(autoProtocolState, 'auto_continuation_submitted');
assert.strictEqual(autoProtocolState, 'await_context_compacted');
assert.throws(
  () => driver.advanceAutoProtocol(autoProtocolState, 'auto_receipt_sealed'),
  /invalid auto protocol transition/,
);
autoProtocolState = driver.advanceAutoProtocol(autoProtocolState, 'auto_context_compacted');
assert.strictEqual(autoProtocolState, 'await_sealed_receipt');
assert.throws(
  () => driver.advanceAutoProtocol(autoProtocolState, 'auto_continuation_ready'),
  /invalid auto protocol transition/,
);
assert.throws(
  () => driver.advanceAutoProtocol(autoProtocolState, 'auto_effect_admitted'),
  /invalid auto protocol transition/,
);
autoProtocolState = driver.advanceAutoProtocol(autoProtocolState, 'auto_receipt_sealed');
assert.strictEqual(autoProtocolState, 'await_continuation_ready');
assert.throws(
  () => driver.advanceAutoProtocol(autoProtocolState, 'auto_effect_admitted'),
  /invalid auto protocol transition/,
);
autoProtocolState = driver.advanceAutoProtocol(autoProtocolState, 'auto_continuation_ready');
assert.strictEqual(autoProtocolState, 'effect_admissible');
autoProtocolState = driver.advanceAutoProtocol(autoProtocolState, 'auto_effect_admitted');
assert.strictEqual(autoProtocolState, 'complete');

async function verifyDirectoryTrustLaunch({ chooserVisible, acceptDirectoryTrust }) {
  const writes = [];
  const events = [];
  const ordering = [];
  const terminal = {
    chooserPending: acceptDirectoryTrust,
    composerContent: '',
    promptSubmissions: [],
    trustAcceptances: 0,
  };
  const child = new EventEmitter();
  let trustEventResolve;
  const trustEvent = new Promise((resolve) => { trustEventResolve = resolve; });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(value) {
      const input = Buffer.from(value);
      writes.push(input.toString('hex'));
      ordering.push(`stdin:${input.toString('hex')}`);
      if (terminal.chooserPending && value === '\r') {
        terminal.chooserPending = false;
        terminal.trustAcceptances += 1;
      } else if (value.startsWith(BRACKETED_PASTE_START)
        && value.endsWith(BRACKETED_PASTE_END)) {
        terminal.composerContent += value.slice(
          BRACKETED_PASTE_START.length,
          -BRACKETED_PASTE_END.length,
        );
      } else if (value === '\r' || value === '\x1b[13u') {
        terminal.promptSubmissions.push(terminal.composerContent);
        terminal.composerContent = '';
      } else {
        terminal.composerContent += value;
      }
      return true;
    },
  };
  const event = (stage, details) => {
    events.push({ stage, details });
    ordering.push(`event:${stage}`);
    if (stage === 'directory_trust_accept_sent') trustEventResolve();
  };
  const tui = driver.startTui({
    codexBin: '/usr/bin/codex-under-test',
    home: '/isolated/home',
    repo: root,
    transcriptPath: path.join(temp, `trust-${chooserVisible}-${acceptDirectoryTrust}.raw`),
    compactLimit: 12_000,
    acceptDirectoryTrust,
    spawnFn(command, args, options) {
      assert.strictEqual(command, '/usr/bin/script');
      assert.strictEqual(args[3], [
        "stty rows 24 cols 80 && printf '%s\\n' 'AUTOPILOT_D3_PTY_TRANSPORT_READY_V1' && exec",
        "'/usr/bin/codex-under-test'",
        "'--no-alt-screen'",
        "'--dangerously-bypass-approvals-and-sandbox'",
        "'--dangerously-bypass-hook-trust'",
        "'--disable'",
        "'apps'",
        "'-c'",
        "'model_auto_compact_token_limit=12000'",
      ].join(' '));
      assert.strictEqual(options.cwd, root);
      ordering.push('spawn');
      return child;
    },
  });
  assert.deepStrictEqual(writes, []);
  tui.output = chooserVisible
    ? `${driver.PTY_TRANSPORT_SENTINEL}\nDo you trust this repository?\n1. Yes, continue`
    : `${driver.PTY_TRANSPORT_SENTINEL}\n\u001b[2J\u001b[H›\n\u001b[12C1. Yes, continue`;
  const readiness = driver.waitForTuiReady(tui, event);
  if (acceptDirectoryTrust) {
    await Promise.resolve();
    assert.deepStrictEqual(writes, []);
    ordering.push('chooser_complete');
    tui.output += '\n\u001b[4CPress enter to continue';
    await trustEvent;
    assert.deepStrictEqual(writes, ['0d']);
    ordering.push('composer_plain_arrow');
    tui.output += '\nOpenAI Codex\n›';
    assert.strictEqual(driver.hasTuiReadinessMarker(driver.tuiRawText(tui)), false);
    ordering.push('composer_ready');
    tui.output += '\n\u001b[1m›\nmodel: fresh-test-model /model to change';
  } else {
    ordering.push('composer_loading');
    tui.output += [
      '\n\u001b[1mOpenAI Codex\u001b[0m',
      '\u001b[1m›\u001b[0m',
      'model: loading /model to change',
    ].join('\n');
    await Promise.resolve();
    assert.strictEqual(driver.hasTuiReadinessMarker(driver.tuiRawText(tui)), false);
    assert.deepStrictEqual(terminal.promptSubmissions, []);
    ordering.push('model_loaded');
    tui.output += '\n\u001b[2Kmodel:\u001b[4Cauto-test-model\u001b[2C/model to change';
  }
  await readiness;

  const autoPrompt = 'Respond with exactly AUTO_READY.';
  if (!acceptDirectoryTrust) {
    await driver.submitTui(tui, autoPrompt, event, 'auto_prompt_sent');
  }

  const expectedWrites = acceptDirectoryTrust
    ? ['0d']
    : [Buffer.from(
      `${BRACKETED_PASTE_START}${autoPrompt}${BRACKETED_PASTE_END}`,
    ).toString('hex'), '0d'];
  const expectedTrustEvents = acceptDirectoryTrust ? [{
    stage: 'directory_trust_accept_sent',
    details: {
      input_bytes: 1,
      input_hex: '0d',
      input_sha256: TRUST_ACCEPT_SHA256,
    },
  }] : [];
  assert.deepStrictEqual(writes, expectedWrites);
  assert.strictEqual(terminal.trustAcceptances, acceptDirectoryTrust ? 1 : 0);
  assert.strictEqual(terminal.composerContent, '');
  assert.deepStrictEqual(
    terminal.promptSubmissions,
    acceptDirectoryTrust ? [] : [autoPrompt],
  );
  assert.deepStrictEqual(events, [
    ...expectedTrustEvents,
    { stage: 'tui_ready', details: {} },
    ...(!acceptDirectoryTrust ? [{
      stage: 'auto_prompt_sent',
      details: {
        input_sha256: '2d799c1721cd48464a465ccf9d03663bd1602aa8ca66d80b042afbe4159ab3ef',
        submit_key_bytes: 1,
        submit_key_hex: '0d',
        submit_key_sha256: TRUST_ACCEPT_SHA256,
        input_framing: 'bracketed_paste',
        frame_start_hex: '1b5b3230307e',
        frame_end_hex: '1b5b3230317e',
        frame_boundary_sha256: BRACKETED_PASTE_BOUNDARY_SHA256,
      },
    }] : []),
  ]);
  assert.deepStrictEqual(ordering, [
    'spawn',
    ...(acceptDirectoryTrust
      ? [
        'chooser_complete',
        'stdin:0d',
        'event:directory_trust_accept_sent',
        'composer_plain_arrow',
        'composer_ready',
      ]
      : [
        'composer_loading',
        'model_loaded',
      ]),
    'event:tui_ready',
    ...(!acceptDirectoryTrust ? [
      `stdin:${Buffer.from(
        `${BRACKETED_PASTE_START}${autoPrompt}${BRACKETED_PASTE_END}`,
      ).toString('hex')}`,
      'stdin:0d',
      'event:auto_prompt_sent',
    ] : []),
  ]);
  if (!acceptDirectoryTrust) {
    assert.strictEqual(writes.includes(Buffer.from(autoPrompt).toString('hex')), false);
    assert.strictEqual(
      writes[0].split(Buffer.from(BRACKETED_PASTE_START).toString('hex')).length - 1,
      1,
    );
    assert.strictEqual(
      writes[0].split(Buffer.from(BRACKETED_PASTE_END).toString('hex')).length - 1,
      1,
    );
    assert.strictEqual(writes.includes(Buffer.from('\x1b[13u').toString('hex')), false);
  }
}

async function verifyStopUsesCarriageReturn() {
  const writes = [];
  const submissions = [];
  const events = [];
  let composerContent = '';
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(value) {
      writes.push(Buffer.from(value).toString('hex'));
      if (value.startsWith(BRACKETED_PASTE_START) && value.endsWith(BRACKETED_PASTE_END)) {
        composerContent += value.slice(
          BRACKETED_PASTE_START.length,
          -BRACKETED_PASTE_END.length,
        );
      } else if (value === '\r' || value === '\x1b[13u') {
        submissions.push(composerContent);
        composerContent = '';
        child.emit('exit', 0);
      } else {
        composerContent += value;
      }
      return true;
    },
  };
  child.kill = () => assert.fail('stopTui unexpectedly needed SIGTERM');
  const tui = driver.startTui({
    codexBin: '/usr/bin/codex-under-test',
    home: '/isolated/home',
    repo: root,
    transcriptPath: path.join(temp, 'stop-terminal.raw'),
    compactLimit: 12_000,
    acceptDirectoryTrust: false,
    spawnFn() { return child; },
  });
  await driver.stopTui(tui, (stage, details) => events.push({ stage, details }));
  assert.deepStrictEqual(writes, [Buffer.from(
    `${BRACKETED_PASTE_START}/exit${BRACKETED_PASTE_END}`,
  ).toString('hex'), '0d']);
  assert.strictEqual(writes.includes(Buffer.from('/exit').toString('hex')), false);
  assert.strictEqual(
    writes[0].split(Buffer.from(BRACKETED_PASTE_START).toString('hex')).length - 1,
    1,
  );
  assert.strictEqual(
    writes[0].split(Buffer.from(BRACKETED_PASTE_END).toString('hex')).length - 1,
    1,
  );
  assert.strictEqual(writes.includes(Buffer.from('\x1b[13u').toString('hex')), false);
  assert.deepStrictEqual(submissions, ['/exit']);
  assert.strictEqual(composerContent, '');
  assert.strictEqual(tui.exited, true);
  assert.deepStrictEqual(events, [{
    stage: 'tui_stopped',
    details: {
      exit_code: 0,
      submit_key_bytes: 1,
      submit_key_hex: '0d',
      submit_key_sha256: TRUST_ACCEPT_SHA256,
      input_framing: 'bracketed_paste',
      frame_start_hex: '1b5b3230307e',
      frame_end_hex: '1b5b3230317e',
      frame_boundary_sha256: BRACKETED_PASTE_BOUNDARY_SHA256,
    },
  }]);
}

const repo = path.join(temp, 'authority');
fs.mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q', repo]);
execFileSync('git', ['-C', repo, 'config', 'user.email', 'd3-live@example.invalid']);
execFileSync('git', ['-C', repo, 'config', 'user.name', 'D3 Live Driver']);
fs.writeFileSync(path.join(repo, 'seed'), 'seed\n');
execFileSync('git', ['-C', repo, 'add', 'seed']);
execFileSync('git', ['-C', repo, 'commit', '-qm', 'seed']);

const fixture = driver.createControllerFixture({
  sourceRoot: root,
  repo,
  rootRunId: 'd3-live-driver-contract',
  ownerPid: process.pid,
});
assert.strictEqual(fixture.owner.pid, process.pid);
assert.strictEqual(fixture.workOrder.controller.process_parentage.owner.pid, process.pid);

const observation = workOrder.validateControllerRecoveryAuthority(fixture.workOrder, {
  rootRunId: fixture.rootRunId,
  graphNode: fixture.graphNode,
  attempt: fixture.attempt,
  workOrderId: fixture.workOrder.work_order_id,
  gitCwd: repo,
});
assert.strictEqual(observation.ok, true, observation.reason);

const reconciled = controller.runPostCompactAdapter({
  gitCwd: repo,
  rootRunId: fixture.rootRunId,
  graphNode: fixture.graphNode,
  attempt: fixture.attempt,
  workOrderId: fixture.workOrder.work_order_id,
  workOrder: fixture.workOrder,
  hookInvocationDigest: 'a'.repeat(64),
  hookTrigger: 'manual',
  reconcileFn: workOrder.reconcilePostCompact,
  probeEvidenceAccepted: true,
});
assert.strictEqual(reconciled.status, 'ready');
assert.strictEqual(reconciled.reconcile.receipt.hook_trigger, 'manual');
assert.strictEqual(reconciled.reconcile.receipt.classifications[0].classification, 'attach_active');

Promise.all([
  verifyDirectoryTrustLaunch({ chooserVisible: false, acceptDirectoryTrust: true }),
  verifyDirectoryTrustLaunch({ chooserVisible: true, acceptDirectoryTrust: true }),
  verifyDirectoryTrustLaunch({ chooserVisible: false, acceptDirectoryTrust: false }),
  verifyStopUsesCarriageReturn(),
]).then(() => {
  process.stdout.write('PASS [codex-postcompact-production-live-driver] 110 assertions\n');
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});
NODE
