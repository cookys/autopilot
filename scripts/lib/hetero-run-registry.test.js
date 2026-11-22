#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const reg = require('./hetero-run-registry');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hetero-run-reg-test-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function testAtomicWriteAndNoTmp() {
  const dir = makeTempDir();
  try {
    const entry = {
      run_id: 'run-atomic-1',
      owner_member: 'seat-a',
      engine: 'fake',
      pid: process.pid,
      proc_start: reg.readProcStart(process.pid),
      started_at_ms: Date.now(),
      status: 'running',
      result_path: '/tmp/res.json',
    };
    const target = reg.writeEntryAtomic(entry, dir);
    assert.ok(fs.existsSync(target), 'target file should exist');
    const files = fs.readdirSync(dir);
    assert.deepStrictEqual(files, ['run-atomic-1.json'], 'no .tmp file should remain');
    const got = reg.getRun('run-atomic-1', dir);
    assert.strictEqual(got.inflight, true);
    assert.strictEqual(got.owner_member, 'seat-a');
  } finally {
    cleanupDir(dir);
  }
}

function testStalePidAndProcStartMismatch() {
  const dir = makeTempDir();
  try {
    // Dead/non-existent PID
    reg.writeEntryAtomic({
      run_id: 'run-dead-pid',
      owner_member: 'seat-a',
      engine: 'fake',
      pid: 99999999,
      proc_start: '12345',
      started_at_ms: Date.now(),
      status: 'running',
      result_path: '',
    }, dir);
    assert.strictEqual(reg.getRun('run-dead-pid', dir).inflight, false);

    // Live PID (self) but mismatched proc_start
    reg.writeEntryAtomic({
      run_id: 'run-mismatch-start',
      owner_member: 'seat-a',
      engine: 'fake',
      pid: process.pid,
      proc_start: '999999999999',
      started_at_ms: Date.now(),
      status: 'running',
      result_path: '',
    }, dir);
    assert.strictEqual(reg.getRun('run-mismatch-start', dir).inflight, false);

    // Done status even with live PID and matching proc_start
    reg.writeEntryAtomic({
      run_id: 'run-done',
      owner_member: 'seat-a',
      engine: 'fake',
      pid: process.pid,
      proc_start: reg.readProcStart(process.pid),
      started_at_ms: Date.now(),
      status: 'done',
      result_path: '',
    }, dir);
    assert.strictEqual(reg.getRun('run-done', dir).inflight, false);

    // List by owner_member
    reg.writeEntryAtomic({
      run_id: 'run-other-seat',
      owner_member: 'seat-b',
      engine: 'fake',
      pid: process.pid,
      proc_start: reg.readProcStart(process.pid),
      started_at_ms: Date.now(),
      status: 'running',
      result_path: '',
    }, dir);
    const seatARuns = reg.listRuns('seat-a', dir);
    assert.strictEqual(seatARuns.length, 3);
    const seatBRuns = reg.listRuns('seat-b', dir);
    assert.strictEqual(seatBRuns.length, 1);
    assert.strictEqual(seatBRuns[0].run_id, 'run-other-seat');
    assert.strictEqual(seatBRuns[0].inflight, true);
  } finally {
    cleanupDir(dir);
  }
}

function testSetsidOutlivesLauncher() {
  const dir = makeTempDir();
  let childPid = null;
  try {
    // Launch a fake sleep-based runner in its own session via setsid
    const launcher = spawnSync('bash', ['-c', 'setsid sleep 30 >/dev/null 2>&1 < /dev/null & echo $!'], {
      encoding: 'utf8',
    });
    assert.strictEqual(launcher.status, 0);
    childPid = Number(launcher.stdout.trim());
    assert.ok(Number.isInteger(childPid) && childPid > 0, 'childPid should be valid');

    const procStart = reg.readProcStart(childPid);
    assert.ok(procStart, 'procStart should be readable from /proc/<pid>/stat');

    reg.writeEntryAtomic({
      run_id: 'run-setsid-1',
      owner_member: 'seat-x',
      engine: 'fake-sleep',
      pid: childPid,
      proc_start: procStart,
      started_at_ms: Date.now(),
      status: 'running',
      result_path: path.join(dir, 'result.json'),
    }, dir);

    // Launcher exited, child is still alive
    const got = reg.getRun('run-setsid-1', dir);
    assert.strictEqual(got.status, 'running');
    assert.strictEqual(got.inflight, true);

    // Kill the fake child and mark done
    process.kill(childPid, 'SIGKILL');
    childPid = null;
    reg.writeEntryAtomic({ ...got, status: 'done' }, dir);
    const after = reg.getRun('run-setsid-1', dir);
    assert.strictEqual(after.status, 'done');
    assert.strictEqual(after.inflight, false);
  } finally {
    if (childPid) {
      try { process.kill(childPid, 'SIGKILL'); } catch {}
    }
    cleanupDir(dir);
  }
}

testAtomicWriteAndNoTmp();
testStalePidAndProcStartMismatch();
testSetsidOutlivesLauncher();
console.log('hetero-run-registry.test.js: all tests passed');
