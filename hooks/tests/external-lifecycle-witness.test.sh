#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const root = process.argv[2];
const {
  BoundedUnixLifecycleObserver,
  ExternalLifecycleWitnessDaemon,
  createEngineLifecycleObservationSession,
  invokeSocketRequest,
} = require(path.join(root, 'src', 'engine'));
const { canonicalJson, sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel', 'canonical'));

// Keep the Unix-domain socket path well below Linux's 108-byte limit even when
// a test runner supplies an unusually long TMPDIR.
const runtime = fs.mkdtempSync(path.join(os.homedir(), '.aew-'));
fs.chmodSync(runtime, 0o700);
const daemonModule = path.join(root, 'src', 'engine', 'external-lifecycle-witness.js');
const CLIENT_KEY = 'b'.repeat(64);
const ATTESTATION_HASH = 'c'.repeat(64);
const RAW_ENVELOPE_SECRET = 'RAW_ENVELOPE_SECRET_MUST_NOT_REACH_JOURNAL';
const RAW_RECORD_SECRET = 'RAW_RECORD_SECRET_MUST_NOT_REACH_JOURNAL';
const RAW_TERMINAL_SECRET = 'RAW_TERMINAL_SECRET_MUST_NOT_REACH_JOURNAL';
const RAW_IDENTITY_SECRET = 'RAW_IDENTITY_SECRET_MUST_NOT_REACH_JOURNAL';

function waitForReady(child, label) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      cleanup();
      child.kill('SIGKILL');
      reject(new Error(`${label}_timeout`));
    }, 5_000);
    const onStdout = (chunk) => {
      stdout += chunk;
      const lineEnd = stdout.indexOf('\n');
      if (lineEnd < 0) return;
      let payload;
      try { payload = JSON.parse(stdout.slice(0, lineEnd)); } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (payload.status === 'ready') {
        cleanup();
        resolve(payload);
      }
    };
    const onStderr = (chunk) => { stderr += chunk; };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`${label}_exited_${code}_${stderr.trim()}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('exit', onExit);
  });
}

async function startDaemon(config, label) {
  const child = childProcess.spawn(process.execPath, [daemonModule, '--serve'], {
    cwd: runtime,
    env: { PATH: process.env.PATH || '/usr/bin:/bin' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(`${JSON.stringify(config)}\n`);
  await waitForReady(child, label);
  return child;
}

function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 1_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startDaemonEventually(config, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await startDaemon(config, `${label}-${attempt}`);
    } catch (error) {
      lastError = error;
      await sleep(25);
    }
  }
  throw lastError || new Error(`${label}_unavailable`);
}

function asyncRequest(config, method, request) {
  return invokeSocketRequest({
    socketPath: config.socketPath,
    clientKey: config.clientKey,
    timeoutMs: config.requestTimeoutMs,
    method,
    request,
  });
}

function makeOpenRequest(engineRunId, invocationId, marker) {
  const envelope = {
    schema_version: 1,
    record_type: 'engine_lifecycle_open',
    marker,
  };
  return {
    engine_run_id: engineRunId,
    invocation_id: invocationId,
    envelope,
    envelope_hash: sha256(canonicalJson(envelope)),
  };
}

function connectRaw(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(10);
  }
  return predicate();
}

async function expectRejected(run) {
  try {
    await run();
    return false;
  } catch (_error) {
    return true;
  }
}

async function expectDaemonRejected(run) {
  let child = null;
  try {
    child = await run();
    await stopProcess(child);
    return false;
  } catch (_error) {
    return true;
  }
}

async function exerciseJournalFaults() {
  const closeConfig = {
    socketPath: path.join(runtime, 'fault-close', 'socket', 'w.sock'),
    journalPath: path.join(runtime, 'fault-close', 'journal', 'w.jsonl'),
    clientKey: CLIENT_KEY,
    identity: 'fault-close-identity',
    attestationHash: ATTESTATION_HASH,
    requestTimeoutMs: 500,
  };
  const closeRequest = makeOpenRequest('fault-close-run', 'fault-close-invocation', 'close-fault');
  let closeDaemon = null;
  let recoveredDaemon = null;
  let originalClose = null;
  try {
    closeDaemon = new ExternalLifecycleWitnessDaemon(closeConfig);
    await closeDaemon.start();
    originalClose = fs.closeSync;
    let closeFaulted = false;
    fs.closeSync = (fd) => {
      if (!closeFaulted) {
        closeFaulted = true;
        originalClose(fd);
        const error = new Error('injected durable close failure');
        error.code = 'EIO';
        throw error;
      }
      return originalClose(fd);
    };
    const closeFirstRejected = await expectRejected(() => asyncRequest(closeConfig, 'open', closeRequest));
    fs.closeSync = originalClose;
    originalClose = null;
    const closeLiveRetryRejected = await expectRejected(() => asyncRequest(closeConfig, 'open', closeRequest));
    await closeDaemon.stop();
    closeDaemon = null;
    recoveredDaemon = new ExternalLifecycleWitnessDaemon(closeConfig);
    await recoveredDaemon.start();
    const recovered = await asyncRequest(closeConfig, 'open', closeRequest);
    const changedAppend = {
      engine_run_id: closeRequest.engine_run_id,
      invocation_id: closeRequest.invocation_id,
      sequence: 1,
      expected_observation_head: '0'.repeat(64),
      record: { schema_version: 1, marker: 'must-not-advance' },
      record_hash: sha256(canonicalJson({ schema_version: 1, marker: 'must-not-advance' })),
    };
    const changedRejected = await expectRejected(() => asyncRequest(closeConfig, 'append_if_head', changedAppend));
    return {
      close_first_rejected: closeFirstRejected,
      close_live_retry_rejected: closeLiveRetryRejected,
      close_recovered_idempotent: typeof recovered.observation_head === 'string',
      close_changed_rejected: changedRejected,
    };
  } finally {
    if (originalClose) fs.closeSync = originalClose;
    if (recoveredDaemon) await recoveredDaemon.stop();
    if (closeDaemon) await closeDaemon.stop();
  }
}

async function exerciseShortWriteFailure() {
  const config = {
    socketPath: path.join(runtime, 'fault-write', 'socket', 'w.sock'),
    journalPath: path.join(runtime, 'fault-write', 'journal', 'w.jsonl'),
    clientKey: CLIENT_KEY,
    identity: 'fault-write-identity',
    attestationHash: ATTESTATION_HASH,
    requestTimeoutMs: 500,
  };
  const request = makeOpenRequest('fault-write-run', 'fault-write-invocation', 'write-fault');
  let daemon = null;
  let originalWrite = null;
  try {
    daemon = new ExternalLifecycleWitnessDaemon(config);
    await daemon.start();
    originalWrite = fs.writeSync;
    let writeFaulted = false;
    fs.writeSync = (...args) => {
      if (!writeFaulted) {
        writeFaulted = true;
        return 0;
      }
      return originalWrite(...args);
    };
    const firstRejected = await expectRejected(() => asyncRequest(config, 'open', request));
    fs.writeSync = originalWrite;
    originalWrite = null;
    const retryRejected = await expectRejected(() => asyncRequest(config, 'open', request));
    return { short_write_rejected: firstRejected, short_write_fail_stop: retryRejected };
  } finally {
    if (originalWrite) fs.writeSync = originalWrite;
    if (daemon) await daemon.stop();
  }
}

async function exercisePinnedPathSwap() {
  const socketParent = path.join(runtime, 'path-swap', 'socket-parent');
  const movedParent = path.join(runtime, 'path-swap', 'moved-parent');
  const attackerParent = path.join(runtime, 'path-swap', 'attacker-parent');
  fs.mkdirSync(socketParent, { recursive: true, mode: 0o700 });
  fs.mkdirSync(attackerParent, { recursive: true, mode: 0o700 });
  const config = {
    socketPath: path.join(socketParent, 'w.sock'),
    journalPath: path.join(runtime, 'path-swap', 'journal', 'w.jsonl'),
    clientKey: CLIENT_KEY,
    identity: 'path-swap-identity',
    attestationHash: ATTESTATION_HASH,
    requestTimeoutMs: 500,
  };
  const daemon = new ExternalLifecycleWitnessDaemon(config);
  const acquireLeases = daemon.acquireLeases.bind(daemon);
  daemon.acquireLeases = async () => {
    await acquireLeases();
    fs.renameSync(socketParent, movedParent);
    fs.symlinkSync(attackerParent, socketParent);
  };
  try {
    await daemon.start();
    const pinned = fs.existsSync(path.join(movedParent, 'w.sock'))
      && !fs.existsSync(path.join(attackerParent, 'w.sock'));
    const clientRejected = await expectRejected(() => asyncRequest(config, 'get_head', {
      engine_run_id: 'path-swap-run',
      invocation_id: 'path-swap-invocation',
    }));
    return { path_swap_pinned: pinned, path_swap_client_rejected: clientRejected };
  } finally {
    await daemon.stop();
  }
}

async function exerciseConnectionBoundaries() {
  const deadlineConfig = {
    socketPath: path.join(runtime, 'connection-deadline', 'socket', 'w.sock'),
    journalPath: path.join(runtime, 'connection-deadline', 'journal', 'w.jsonl'),
    clientKey: CLIENT_KEY,
    identity: 'connection-deadline-identity',
    attestationHash: ATTESTATION_HASH,
    requestTimeoutMs: 100,
  };
  const deadlineDaemon = new ExternalLifecycleWitnessDaemon(deadlineConfig);
  let deadlineSocket = null;
  let stopDaemon = null;
  let stopSocket = null;
  try {
    await deadlineDaemon.start();
    deadlineSocket = await connectRaw(deadlineConfig.socketPath);
    deadlineSocket.on('error', () => {});
    const deadlineStartedAt = Date.now();
    const chatter = setInterval(() => {
      if (!deadlineSocket.destroyed && deadlineSocket.writable) deadlineSocket.write('x');
    }, 15);
    const deadlineClosed = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 750);
      deadlineSocket.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    clearInterval(chatter);
    const deadlineBounded = deadlineClosed && Date.now() - deadlineStartedAt < 700;
    if (!deadlineSocket.destroyed) deadlineSocket.destroy();
    await deadlineDaemon.stop();

    const stopConfig = {
      socketPath: path.join(runtime, 'connection-stop', 'socket', 'w.sock'),
      journalPath: path.join(runtime, 'connection-stop', 'journal', 'w.jsonl'),
      clientKey: CLIENT_KEY,
      identity: 'connection-stop-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 1_000,
    };
    stopDaemon = new ExternalLifecycleWitnessDaemon(stopConfig);
    await stopDaemon.start();
    stopSocket = await connectRaw(stopConfig.socketPath);
    stopSocket.on('error', () => {});
    const stopChatter = setInterval(() => {
      if (!stopSocket.destroyed && stopSocket.writable) stopSocket.write('x');
    }, 15);
    const stopStartedAt = Date.now();
    const firstStop = stopDaemon.stop();
    const secondStop = stopDaemon.stop();
    const stopCompleted = await Promise.race([
      Promise.all([firstStop, secondStop]).then(() => true),
      sleep(500).then(() => false),
    ]);
    clearInterval(stopChatter);
    if (!stopSocket.destroyed) stopSocket.destroy();
    if (!stopCompleted) await Promise.all([firstStop, secondStop]);
    return {
      absolute_deadline_bounded: deadlineBounded,
      stop_bounded: stopCompleted && Date.now() - stopStartedAt < 500,
      concurrent_stop_resolved: stopCompleted,
    };
  } finally {
    if (deadlineSocket && !deadlineSocket.destroyed) deadlineSocket.destroy();
    if (stopSocket && !stopSocket.destroyed) stopSocket.destroy();
    await deadlineDaemon.stop();
    if (stopDaemon) await stopDaemon.stop();
  }
}

async function exerciseLeaseAndReuse() {
  const config = {
    socketPath: path.join(runtime, 'lease-health', 'socket', 'w.sock'),
    journalPath: path.join(runtime, 'lease-health', 'journal', 'w.jsonl'),
    clientKey: CLIENT_KEY,
    identity: 'lease-health-identity',
    attestationHash: ATTESTATION_HASH,
    requestTimeoutMs: 500,
  };
  const daemon = new ExternalLifecycleWitnessDaemon(config);
  try {
    await daemon.start();
    daemon.leases[0].child.kill('SIGKILL');
    const unhealthy = await waitUntil(() => !daemon.leaseHealthy && !daemon.journalHealthy, 500);
    const rejected = await expectRejected(() => asyncRequest(config, 'get_head', {
      engine_run_id: 'lease-health-run',
      invocation_id: 'lease-health-invocation',
    }));
    await daemon.stop();

    const epipeDaemon = new ExternalLifecycleWitnessDaemon({
      socketPath: path.join(runtime, 'lease-epipe', 'socket', 'w.sock'),
      journalPath: path.join(runtime, 'lease-epipe', 'journal', 'w.jsonl'),
      clientKey: CLIENT_KEY,
      identity: 'lease-epipe-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 500,
    });
    await epipeDaemon.start();
    const epipeLease = epipeDaemon.leases[0];
    const originalEnd = epipeLease.child.stdin.end;
    epipeLease.child.stdin.end = () => {
      process.nextTick(() => {
        const error = new Error('injected lease pipe EPIPE');
        error.code = 'EPIPE';
        epipeLease.child.stdin.emit('error', error);
      });
    };
    const epipeStartedAt = Date.now();
    const epipeStopped = await Promise.race([
      epipeDaemon.stop().then(() => true),
      sleep(500).then(() => false),
    ]);
    epipeLease.child.stdin.end = originalEnd;

    const reusable = new ExternalLifecycleWitnessDaemon({
      socketPath: path.join(runtime, 'reuse', 'socket', 'w.sock'),
      journalPath: path.join(runtime, 'reuse', 'journal', 'w.jsonl'),
      clientKey: CLIENT_KEY,
      identity: 'reuse-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 500,
    });
    await reusable.start();
    await reusable.stop();
    await reusable.start();
    await reusable.stop();
    return {
      unexpected_lease_fail_stop: unhealthy && rejected,
      lease_epipe_stop_bounded: epipeStopped && Date.now() - epipeStartedAt < 500,
      same_instance_restart: true,
    };
  } finally {
    await daemon.stop();
  }
}

async function exerciseUnavailableFdCleanup() {
  const socketDirectory = path.join(runtime, 'unavailable-client', 'socket');
  fs.mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
  const config = {
    socketPath: path.join(socketDirectory, 'missing.sock'),
    clientKey: CLIENT_KEY,
    requestTimeoutMs: 100,
  };
  const before = fs.readdirSync('/proc/self/fd').length;
  let allRejected = true;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    allRejected = allRejected && await expectRejected(() => invokeSocketRequest({
      ...config,
      method: 'get_head',
      request: { engine_run_id: 'missing-run', invocation_id: `missing-${attempt}` },
    }));
  }
  const after = fs.readdirSync('/proc/self/fd').length;
  return { unavailable_rejected: allRejected, unavailable_fd_bounded: after <= before + 2 };
}

async function main() {
  let daemon = null;
  let restarted = null;
  let blocker = null;
  try {
    const socketPath = path.join(runtime, 'socket', 'witness.sock');
    const journalPath = path.join(runtime, 'receipts', 'witness.jsonl');
    const config = {
      socketPath,
      journalPath,
      clientKey: CLIENT_KEY,
      identity: RAW_IDENTITY_SECRET,
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 1_000,
    };
    daemon = await startDaemon(config, 'daemon');
    const observer = new BoundedUnixLifecycleObserver({
      socketPath,
      clientKey: CLIENT_KEY,
      timeoutMs: 1_000,
    });
    const envelope = {
      schema_version: 1,
      record_type: 'engine_lifecycle_open',
      marker: RAW_ENVELOPE_SECRET,
    };
    const openRequest = {
      engine_run_id: 'engine-run-1',
      invocation_id: 'invocation-1',
      envelope,
      envelope_hash: sha256(canonicalJson(envelope)),
    };
    const open = observer.open(openRequest);
    const record = {
      schema_version: 1,
      record_type: 'engine_ledger_entry',
      marker: RAW_RECORD_SECRET,
    };
    const appendRequest = {
      engine_run_id: 'engine-run-1',
      invocation_id: 'invocation-1',
      sequence: 1,
      expected_observation_head: open.observation_head,
      record,
      record_hash: sha256(canonicalJson(record)),
    };
    const append = observer.appendIfHead(appendRequest);
    const terminal = {
      schema_version: 1,
      record_type: 'engine_terminal',
      marker: RAW_TERMINAL_SECRET,
    };
    const closeRequest = {
      engine_run_id: 'engine-run-1',
      invocation_id: 'invocation-1',
      sequence: 2,
      expected_observation_head: append.observation_head,
      terminal,
      terminal_hash: sha256(canonicalJson(terminal)),
    };
    const close = observer.close(closeRequest);
    const head = observer.getHead({ engine_run_id: 'engine-run-1', invocation_id: 'invocation-1' });
    const sidecarPrompt = path.join(runtime, 'sidecar-prompt.txt');
    fs.writeFileSync(sidecarPrompt, 'SIDECAR_PROMPT_SECRET_MUST_NOT_REACH_JOURNAL', 'utf8');
    const sidecar = createEngineLifecycleObservationSession({
      observer,
      config: {
        engineRunId: 'engine-run-2',
        invocationId: 'invocation-2',
        legacyLevel: 'l5',
        policyHash: 'a'.repeat(64),
      },
      promptFile: sidecarPrompt,
      base: '1'.repeat(40),
      branch: 'SIDECAR_BRANCH_SECRET_MUST_NOT_REACH_JOURNAL',
      verifyCmd: 'SIDECAR_VERIFY_SECRET_MUST_NOT_REACH_JOURNAL',
    });
    const sidecarLedger = [];
    sidecar.attach(sidecarLedger);
    sidecarLedger.push({
      unit: 'verify_round',
      status: 'passed',
      started_at: '2026-07-23T00:00:00.000Z',
      ended_at: '2026-07-23T00:00:01.000Z',
      branch: 'SIDECAR_BRANCH_SECRET_MUST_NOT_REACH_JOURNAL',
    });
    const sidecarResult = sidecar.finalize({
      status: 'converged',
      phase: 'engine_loop',
      rounds: 1,
      verdict: 'SHIP-AS-IS',
    });
    const competingJournalRejected = await expectDaemonRejected(() => startDaemon({
      ...config,
      socketPath: path.join(runtime, 'competing-socket', 'witness.sock'),
    }, 'competing-journal'));
    const activeSocketRejected = await expectDaemonRejected(() => startDaemon({
      ...config,
      journalPath: path.join(runtime, 'other-receipts', 'witness.jsonl'),
    }, 'active-socket'));
    const duplicateOpen = observer.open(openRequest);
    const duplicateAppend = observer.appendIfHead(appendRequest);
    const staleRejected = await expectRejected(() => Promise.resolve(observer.appendIfHead({
      ...appendRequest,
      expected_observation_head: '0'.repeat(64),
    })));
    const badKeyRejected = await expectRejected(() => Promise.resolve(new BoundedUnixLifecycleObserver({
      socketPath,
      clientKey: 'd'.repeat(64),
      timeoutMs: 1_000,
    }).getHead({ engine_run_id: 'engine-run-1', invocation_id: 'invocation-1' })));
    const actionRejected = await expectRejected(() => Promise.resolve(observer.invoke('execute', {})));
    const journal = fs.readFileSync(journalPath, 'utf8');
    const openOnlySidecar = createEngineLifecycleObservationSession({
      observer,
      config: {
        engineRunId: 'engine-run-3',
        invocationId: 'invocation-3',
        legacyLevel: 'l5',
        policyHash: 'a'.repeat(64),
      },
      promptFile: sidecarPrompt,
      base: '1'.repeat(40),
      branch: 'SIDECAR_RESUME_SECRET_MUST_NOT_REACH_JOURNAL',
      verifyCmd: 'SIDECAR_RESUME_VERIFY_SECRET_MUST_NOT_REACH_JOURNAL',
    });
    openOnlySidecar.observeLedgerEntry({
      unit: 'verify_round',
      status: 'passed',
      started_at: '2026-07-23T00:00:00.000Z',
      ended_at: '2026-07-23T00:00:01.000Z',
    });
    const resumedSidecar = createEngineLifecycleObservationSession({
      observer,
      config: {
        engineRunId: 'engine-run-3',
        invocationId: 'invocation-3',
        legacyLevel: 'l5',
        policyHash: 'a'.repeat(64),
      },
      promptFile: sidecarPrompt,
      base: '1'.repeat(40),
      branch: 'SIDECAR_RESUME_SECRET_MUST_NOT_REACH_JOURNAL',
      verifyCmd: 'SIDECAR_RESUME_VERIFY_SECRET_MUST_NOT_REACH_JOURNAL',
    });
    resumedSidecar.observeLedgerEntry({
      unit: 'verify_round',
      status: 'passed',
      started_at: '2026-07-23T00:00:02.000Z',
      ended_at: '2026-07-23T00:00:03.000Z',
    });
    const p31ResumeRejected = openOnlySidecar.snapshot().status === 'open'
      && openOnlySidecar.snapshot().entry_count === 1
      && resumedSidecar.snapshot().status === 'partial'
      && resumedSidecar.snapshot().failure_stage === 'append';
    const socketStat = fs.lstatSync(socketPath);
    const socketMode = socketStat.mode & 0o777;

    console.log(`open_shape=${Object.keys(open).sort().join(',')}`);
    console.log(`append_shape=${Object.keys(append).sort().join(',')}`);
    console.log(`close_shape=${Object.keys(close).sort().join(',')}`);
    console.log(`head_closed=${head.closed}`);
    console.log(`head_sequence=${head.sequence}`);
    console.log(`sidecar_remote_status=${sidecarResult.lifecycle_observation.status}`);
    console.log(`sidecar_remote_terminal=${sidecarResult.lifecycle_observation.terminal_recorded}`);
    console.log(`competing_journal_rejected=${competingJournalRejected}`);
    console.log(`active_socket_rejected=${activeSocketRejected}`);
    console.log(`duplicate_open=${duplicateOpen.observation_head === open.observation_head}`);
    console.log(`duplicate_append=${duplicateAppend.observation_head === append.observation_head}`);
    console.log(`stale_rejected=${staleRejected}`);
    console.log(`bad_key_rejected=${badKeyRejected}`);
    console.log(`action_rejected=${actionRejected}`);
    console.log(`p31_resume_not_silent=${p31ResumeRejected}`);
    console.log(`socket_mode=${socketMode.toString(8)}`);
    console.log(`socket_owner=${socketStat.uid === process.getuid()}`);
    console.log(`journal_entries=${journal.trim().split('\n').length}`);
    console.log(`journal_envelope_secret=${journal.includes(RAW_ENVELOPE_SECRET)}`);
    console.log(`journal_record_secret=${journal.includes(RAW_RECORD_SECRET)}`);
    console.log(`journal_terminal_secret=${journal.includes(RAW_TERMINAL_SECRET)}`);
    console.log(`journal_identity_secret=${journal.includes(RAW_IDENTITY_SECRET)}`);

    await killProcess(daemon);
    daemon = null;
    restarted = await startDaemonEventually(config, 'crash-restart');
    const restartedObserver = new BoundedUnixLifecycleObserver({ socketPath, clientKey: CLIENT_KEY, timeoutMs: 1_000 });
    const recoveredOpen = restartedObserver.open(openRequest);
    const recoveredHead = restartedObserver.getHead({ engine_run_id: 'engine-run-1', invocation_id: 'invocation-1' });
    console.log(`restart_open=${recoveredOpen.observation_head === open.observation_head}`);
    console.log(`restart_head=${recoveredHead.observation_head === close.observation_head}`);
    console.log(`restart_closed=${recoveredHead.closed}`);
    await stopProcess(restarted);
    restarted = null;

    const tamperedJournal = `${fs.readFileSync(journalPath, 'utf8')}not-json\n`;
    fs.writeFileSync(journalPath, tamperedJournal, { mode: 0o600 });
    const tamperRejected = await expectRejected(() => startDaemon(config, 'tampered'));
    console.log(`tamper_rejected=${tamperRejected}`);

    const unsafeSocketPath = path.join(runtime, 'unsafe', 'witness.sock');
    const unsafeJournalPath = path.join(runtime, 'safe-receipts', 'witness.jsonl');
    fs.mkdirSync(path.dirname(unsafeSocketPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(unsafeSocketPath), 0o777);
    const unsafeDaemon = new ExternalLifecycleWitnessDaemon({
      socketPath: unsafeSocketPath,
      journalPath: unsafeJournalPath,
      clientKey: CLIENT_KEY,
      identity: 'safe-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 1_000,
    });
    const unsafeRejected = await expectRejected(() => unsafeDaemon.start());
    console.log(`unsafe_socket_parent_rejected=${unsafeRejected}`);

    const readableSocketPath = path.join(runtime, 'readable-socket', 'w.sock');
    fs.mkdirSync(path.dirname(readableSocketPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(readableSocketPath), 0o755);
    const readableSocketParentRejected = await expectRejected(() => new ExternalLifecycleWitnessDaemon({
      socketPath: readableSocketPath,
      journalPath: path.join(runtime, 'readable-journal', 'w.jsonl'),
      clientKey: CLIENT_KEY,
      identity: 'readable-socket-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 500,
    }).start());
    console.log(`readable_socket_parent_rejected=${readableSocketParentRejected}`);

    const directoryFsyncConfig = {
      socketPath: path.join(runtime, 'directory-fsync', 'socket', 'w.sock'),
      journalPath: path.join(runtime, 'directory-fsync', 'journal', 'w.jsonl'),
      clientKey: CLIENT_KEY,
      identity: 'directory-fsync-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 500,
    };
    const originalFsync = fs.fsyncSync;
    let fsyncFaulted = false;
    let fsyncCalls = 0;
    fs.fsyncSync = (fd) => {
      fsyncCalls += 1;
      if (fsyncCalls === 2) {
        fsyncFaulted = true;
        const error = new Error('injected directory fsync failure');
        error.code = 'EIO';
        throw error;
      }
      return originalFsync(fd);
    };
    const directoryFsyncRejected = await expectRejected(() => new ExternalLifecycleWitnessDaemon(directoryFsyncConfig).start());
    fs.fsyncSync = originalFsync;
    const retryFsyncPaths = [];
    fs.fsyncSync = (fd) => {
      try { retryFsyncPaths.push(fs.readlinkSync(`/proc/self/fd/${fd}`)); } catch (_error) {}
      return originalFsync(fd);
    };
    const retryDirectoryDaemon = new ExternalLifecycleWitnessDaemon(directoryFsyncConfig);
    await retryDirectoryDaemon.start();
    await retryDirectoryDaemon.stop();
    fs.fsyncSync = originalFsync;
    console.log(`directory_fsync_failure_rejected=${directoryFsyncRejected && fsyncFaulted}`);
    console.log(`directory_fsync_retry_persists_parent=${retryFsyncPaths.includes(runtime)}`);

    const symlinkTarget = path.join(runtime, 'symlink-target');
    const symlinkParent = path.join(runtime, 'symlink-parent');
    fs.mkdirSync(symlinkTarget, { recursive: true, mode: 0o700 });
    fs.symlinkSync(symlinkTarget, symlinkParent);
    const symlinkRejected = await expectRejected(() => new ExternalLifecycleWitnessDaemon({
      socketPath: path.join(symlinkParent, 'w.sock'),
      journalPath: path.join(runtime, 'symlink-journal', 'w.jsonl'),
      clientKey: CLIENT_KEY,
      identity: 'symlink-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 500,
    }).start());
    const collisionRejected = await expectRejected(() => new ExternalLifecycleWitnessDaemon({
      socketPath: path.join(runtime, 'collision', 'w.jsonl.lock'),
      journalPath: path.join(runtime, 'collision', 'w.jsonl'),
      clientKey: CLIENT_KEY,
      identity: 'collision-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 500,
    }));
    console.log(`intermediate_symlink_rejected=${symlinkRejected}`);
    console.log(`lease_path_collision_rejected=${collisionRejected}`);

    const newlineConfig = {
      socketPath: path.join(runtime, 'newline', 'socket', 'w.sock'),
      journalPath: path.join(runtime, 'newline', 'journal', 'w.jsonl'),
      clientKey: CLIENT_KEY,
      identity: 'newline-identity',
      attestationHash: ATTESTATION_HASH,
      requestTimeoutMs: 500,
    };
    const newlineDaemon = await startDaemon(newlineConfig, 'newline');
    await stopProcess(newlineDaemon);
    const newlineJournal = fs.readFileSync(newlineConfig.journalPath, 'utf8');
    fs.writeFileSync(newlineConfig.journalPath, newlineJournal.slice(0, -1), { mode: 0o600 });
    const unterminatedFinalRecordRejected = await expectRejected(() => startDaemon(newlineConfig, 'newline-truncated'));
    console.log(`unterminated_final_record_rejected=${unterminatedFinalRecordRejected}`);

    const journalFaults = await exerciseJournalFaults();
    const shortWriteFault = await exerciseShortWriteFailure();
    const pathSwap = await exercisePinnedPathSwap();
    const connectionBoundaries = await exerciseConnectionBoundaries();
    const leaseAndReuse = await exerciseLeaseAndReuse();
    const unavailableCleanup = await exerciseUnavailableFdCleanup();
    for (const [key, value] of Object.entries({
      ...journalFaults,
      ...shortWriteFault,
      ...pathSwap,
      ...connectionBoundaries,
      ...leaseAndReuse,
      ...unavailableCleanup,
    })) {
      console.log(`${key}=${value}`);
    }

    const blockerPath = path.join(runtime, 'blocker.sock');
    blocker = childProcess.spawn(process.execPath, ['-e', [
      "const net = require('net');",
      "const fs = require('fs');",
      "const server = net.createServer({ allowHalfOpen: true }, (socket) => socket.on('data', () => {}));",
      "server.listen(process.argv[1], () => { fs.chmodSync(process.argv[1], 0o600); process.stdout.write('{\\\"status\\\":\\\"ready\\\"}\\n'); });",
      "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
    ].join('\n'), blockerPath], {
      cwd: runtime,
      env: { PATH: process.env.PATH || '/usr/bin:/bin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForReady(blocker, 'blocker');
    const timeoutStartedAt = Date.now();
    const timeoutRejected = await expectRejected(() => Promise.resolve(new BoundedUnixLifecycleObserver({
      socketPath: blockerPath,
      clientKey: CLIENT_KEY,
      timeoutMs: 100,
    }).getHead({ engine_run_id: 'engine-run-2', invocation_id: 'invocation-2' })));
    const timeoutElapsed = Date.now() - timeoutStartedAt;
    console.log(`timeout_rejected=${timeoutRejected}`);
    console.log(`timeout_bounded=${timeoutElapsed < 2_000}`);
    console.log(`timeout_waited_for_private_host=${timeoutElapsed >= 75}`);
  } finally {
    await stopProcess(blocker);
    await stopProcess(restarted);
    await stopProcess(daemon);
    fs.rmSync(runtime, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
NODE
)"; EXIT=$?

assert_eq "0" "$EXIT" "external lifecycle witness test process exits 0"
assert_contains "$OUT" "open_shape=engine_run_id,envelope_hash,invocation_id,observation_head" "open returns the strict observer receipt shape"
assert_contains "$OUT" "append_shape=engine_run_id,invocation_id,observation_head,previous_observation_head,record_hash,sequence" "append returns the strict observer receipt shape"
assert_contains "$OUT" "close_shape=engine_run_id,invocation_id,observation_head,previous_observation_head,sequence,terminal_hash" "close returns the strict observer receipt shape"
assert_contains "$OUT" "head_closed=true" "durable stream closes after terminal observation"
assert_contains "$OUT" "head_sequence=2" "durable stream tracks its own sequence"
assert_contains "$OUT" "sidecar_remote_status=observed" "bounded daemon works with the P3.1 observation sidecar"
assert_contains "$OUT" "sidecar_remote_terminal=true" "P3.1 sidecar receives a durable terminal receipt"
assert_contains "$OUT" "competing_journal_rejected=true" "a second daemon cannot fork the active journal"
assert_contains "$OUT" "active_socket_rejected=true" "a second daemon cannot replace an active socket"
assert_contains "$OUT" "duplicate_open=true" "same open request is idempotent after receipt persistence"
assert_contains "$OUT" "duplicate_append=true" "same append request is idempotent after receipt persistence"
assert_contains "$OUT" "stale_rejected=true" "stale compare-and-append head is rejected"
assert_contains "$OUT" "bad_key_rejected=true" "wrong client HMAC key cannot read a stream"
assert_contains "$OUT" "action_rejected=true" "observer exposes no action operation"
assert_contains "$OUT" "p31_resume_not_silent=true" "P3.1 refuses to silently resume an external open stream"
assert_contains "$OUT" "socket_mode=600" "daemon socket is private rather than world writable"
assert_contains "$OUT" "socket_owner=true" "daemon socket is owned by the daemon uid"
assert_contains "$OUT" "journal_entries=7" "journal contains one binding header and both receipt chains"
assert_contains "$OUT" "journal_envelope_secret=false" "journal stores envelope hashes rather than raw envelopes"
assert_contains "$OUT" "journal_record_secret=false" "journal stores record hashes rather than raw records"
assert_contains "$OUT" "journal_terminal_secret=false" "journal stores terminal hashes rather than raw terminals"
assert_contains "$OUT" "journal_identity_secret=false" "journal stores daemon identity hash rather than raw identity"
assert_contains "$OUT" "restart_open=true" "restart replays the durable idempotent open receipt"
assert_contains "$OUT" "restart_head=true" "restart reconstructs the durable observation head"
assert_contains "$OUT" "restart_closed=true" "restart reconstructs terminal stream state"
assert_contains "$OUT" "tamper_rejected=true" "tampered durable journal prevents daemon restart"
assert_contains "$OUT" "unsafe_socket_parent_rejected=true" "world-writable socket parent is rejected"
assert_contains "$OUT" "readable_socket_parent_rejected=true" "socket parent denies startup until it is private"
assert_contains "$OUT" "directory_fsync_failure_rejected=true" "runtime directory creation fails closed when fsync cannot persist it"
assert_contains "$OUT" "directory_fsync_retry_persists_parent=true" "retry fsyncs a retained runtime directory parent before journal reuse"
assert_contains "$OUT" "intermediate_symlink_rejected=true" "intermediate symlinked socket parent is rejected"
assert_contains "$OUT" "lease_path_collision_rejected=true" "journal and socket lease path collisions are rejected"
assert_contains "$OUT" "unterminated_final_record_rejected=true" "unterminated durable journal tail fails closed"
assert_contains "$OUT" "close_first_rejected=true" "post-fsync close failure rejects the initial request"
assert_contains "$OUT" "close_live_retry_rejected=true" "post-fsync close failure fail-stops the live daemon"
assert_contains "$OUT" "close_recovered_idempotent=true" "restart recovers a durable request whose response was lost"
assert_contains "$OUT" "close_changed_rejected=true" "recovered durable request cannot advance with a changed head"
assert_contains "$OUT" "short_write_rejected=true" "zero-progress journal write is rejected"
assert_contains "$OUT" "short_write_fail_stop=true" "zero-progress journal write fail-stops the live daemon"
assert_contains "$OUT" "path_swap_pinned=true" "descriptor-pinned daemon socket does not follow a swapped parent"
assert_contains "$OUT" "path_swap_client_rejected=true" "client rejects a swapped symlink parent before sending"
assert_contains "$OUT" "absolute_deadline_bounded=true" "periodic peer bytes cannot extend the absolute request deadline"
assert_contains "$OUT" "stop_bounded=true" "daemon stop destroys an active slow peer without waiting for its timeout"
assert_contains "$OUT" "concurrent_stop_resolved=true" "concurrent stop callers share one bounded shutdown"
assert_contains "$OUT" "unexpected_lease_fail_stop=true" "unexpected flock holder exit fail-stops requests"
assert_contains "$OUT" "lease_epipe_stop_bounded=true" "lease pipe EPIPE falls back to a bounded shutdown"
assert_contains "$OUT" "same_instance_restart=true" "same daemon instance can stop and replay on restart"
assert_contains "$OUT" "unavailable_rejected=true" "missing private socket is rejected before request delivery"
assert_contains "$OUT" "unavailable_fd_bounded=true" "unavailable direct requests do not leak directory descriptors"
assert_contains "$OUT" "timeout_rejected=true" "unresponsive external host request is rejected"
assert_contains "$OUT" "timeout_bounded=true" "subprocess client bounds a stalled callback"
assert_contains "$OUT" "timeout_waited_for_private_host=true" "stalled private host reaches the bounded socket timeout"

finalize_test
