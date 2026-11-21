#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, 'native-msg-outbox.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'native-msg-outbox-test-'));
}

function makeStubFleet(dir) {
  const logFile = path.join(dir, 'fleet-stub.log');
  const binPath = path.join(dir, 'fleet-stub.sh');
  fs.writeFileSync(
    binPath,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${logFile}"
exit "\${STUB_FLEET_EXIT:-0}"
`,
    { mode: 0o755 }
  );
  return { binPath, logFile };
}

function runOutbox(args, env) {
  const out = execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
  return JSON.parse(out.trim());
}

// 1. record -> status pending 1
const tmp = makeTmpDir();
const stateDir = path.join(tmp, 'state');
const { binPath, logFile } = makeStubFleet(tmp);

try {
  runOutbox(
    ['record', '--from', 'ns/c/me', '--to', 'ns/c/peer', '--summary', 'hello peer', '--ts', '2026-11-22T00:00:00Z'],
    { AUTOPILOT_STATE_DIR: stateDir }
  );
  let st = runOutbox(['status'], { AUTOPILOT_STATE_DIR: stateDir });
  assert.deepEqual(st, { pending: 1, replayed: 0, unreplayable: 0 });

  // 2. flush with stub exit 1 -> still pending
  runOutbox(['flush', '--fleet-bin', binPath], {
    AUTOPILOT_STATE_DIR: stateDir,
    STUB_FLEET_EXIT: '1',
  });
  st = runOutbox(['status'], { AUTOPILOT_STATE_DIR: stateDir });
  assert.deepEqual(st, { pending: 1, replayed: 0, unreplayable: 0 });

  // 3. flush with stub exit 0 -> replayed, stub log has "[native 補送]" with from/to/summary
  runOutbox(['flush', '--fleet-bin', binPath], {
    AUTOPILOT_STATE_DIR: stateDir,
    STUB_FLEET_EXIT: '0',
  });
  st = runOutbox(['status'], { AUTOPILOT_STATE_DIR: stateDir });
  assert.deepEqual(st, { pending: 0, replayed: 1, unreplayable: 0 });

  const logContent = fs.readFileSync(logFile, 'utf8');
  assert.match(logContent, /\[native 補送\]/);
  assert.match(logContent, /ns\/c\/me/);
  assert.match(logContent, /ns\/c\/peer/);
  assert.match(logContent, /hello peer/);

  // 4. second flush sends nothing
  const beforeLines = logContent.trim().split('\n').length;
  runOutbox(['flush', '--fleet-bin', binPath], {
    AUTOPILOT_STATE_DIR: stateDir,
    STUB_FLEET_EXIT: '0',
  });
  const afterLines = fs.readFileSync(logFile, 'utf8').trim().split('\n').length;
  assert.equal(afterLines, beforeLines);

  // 5. non-fleet `to` -> unreplayable, never sent
  runOutbox(
    ['record', '--from', 'ns/c/me', '--to', 'session-xyz', '--summary', 'non-fleet'],
    { AUTOPILOT_STATE_DIR: stateDir }
  );
  runOutbox(['flush', '--fleet-bin', binPath], {
    AUTOPILOT_STATE_DIR: stateDir,
    STUB_FLEET_EXIT: '0',
  });
  st = runOutbox(['status'], { AUTOPILOT_STATE_DIR: stateDir });
  assert.deepEqual(st, { pending: 0, replayed: 1, unreplayable: 1 });
  const finalLines = fs.readFileSync(logFile, 'utf8').trim().split('\n').length;
  assert.equal(finalLines, beforeLines);

  console.log('native-msg-outbox.test.js: PASS');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
