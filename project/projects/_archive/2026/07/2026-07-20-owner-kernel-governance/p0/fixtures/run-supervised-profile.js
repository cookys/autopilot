#!/usr/bin/env node
/**
 * Driver for the P0 supervised-partial profile.
 *
 * Runs the profile under strace, verifies the wrapper payload/trace relationship, and emits the
 * same two evidence documents consumed by classify-hosts.js.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyPayload, verifyTrace } = require('./host-capability-witness.js');

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

const outDir = path.resolve(arg('--out-dir', process.cwd()));
const nonce = arg('--nonce', 'supervised' + Math.random().toString(16).slice(2, 18));
const fault = arg('--fault', 'none');
const receiptRoot = arg('--receipt-root');
const protectedDir = arg('--protected-dir');
const contentFile = arg('--content-file');
const taskId = arg('--task-id');
const probe = path.join(__dirname, 'supervised-profile-probe.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-supervised-driver-'));
const traceFile = path.join(tmp, 'probe.trace');

try {
  const run = spawnSync('strace', [
    '-f', '-qq', '-s', '200000', '-e', 'trace=execve,write', '-o', traceFile,
    process.execPath, probe, '--nonce', nonce, '--fault', fault, '--quiet',
    ...(receiptRoot ? ['--receipt-root', path.resolve(receiptRoot)] : []),
    ...(protectedDir ? ['--protected-dir', path.resolve(protectedDir)] : []),
    ...(contentFile ? ['--content-file', path.resolve(contentFile)] : []),
    ...(taskId ? ['--task-id', taskId] : []),
  ], {
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`supervised_profile_probe_failed_${run.status}: ${run.stderr.slice(0, 1000)}`);
  }
  const payload = verifyPayload(JSON.parse(run.stdout), nonce);
  const driver = verifyTrace(payload, fs.readFileSync(traceFile, 'utf8'));
  const host = {
    harness: 'supervised-partial',
    status: 'probed',
    command: 'strace node supervised-profile-probe.js --nonce <nonce>',
    exit_code: 0,
    error_excerpt: 'driver strace execution witness verified',
    probe_payload: payload,
    evidence_grade: 'driver_verified_execution_witness',
    execution_witness_verified: true,
    execution_witness_driver: driver,
  };
  const defaultDoc = {
    probe: 'owner-kernel-p0-per-harness-capability',
    permission_mode: 'default',
    nonce_rail: 'fresh driver nonce',
    execution_witness_rail: 'strace execve/stdout payload hash',
    profile: 'supervised-partial',
    fault_injection: fault,
    task_id: taskId || null,
    hosts: [host],
  };
  const bypassDoc = {
    probe: 'owner-kernel-p0-per-harness-capability',
    permission_mode: 'bypass',
    nonce_rail: 'not applicable',
    execution_witness_rail: 'not applicable',
    profile: 'supervised-partial',
    fault_injection: fault,
    hosts: [{
      harness: 'supervised-partial',
      status: 'not_applicable',
      command: 'no bypass mode; the OS boundary is the profile',
      exit_code: null,
      error_excerpt: 'bypass is intentionally unavailable',
      probe_payload: null,
    }],
  };
  writeJson(path.join(outDir, 'harness-capability-default-mode.json'), defaultDoc);
  writeJson(path.join(outDir, 'harness-capability-bypass-mode.json'), bypassDoc);
  process.stdout.write(JSON.stringify({
    probe: 'owner-kernel-p0-supervised-profile-driver',
    fault_injection: fault,
    out_dir: outDir,
    default_status: host.status,
    execution_witness_verified: true,
  }, null, 2) + '\n');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
