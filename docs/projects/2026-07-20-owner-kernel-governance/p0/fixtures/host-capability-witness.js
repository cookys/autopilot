#!/usr/bin/env node
/**
 * host-capability-witness.js -- wraps host-capability-probe.js with a payload witness.
 *
 * The fresh nonce proves only freshness because it is shown to the model. This wrapper adds a
 * payload hash and process metadata, but that is not trusted by itself. The driver must observe
 * this wrapper's execve/stdout with strace before a row may be promoted to `status=probed`.
 *
 * Threat boundary: this is a driver-side execution witness for the local harness run, not a
 * same-uid malicious-proof attestation. Stronger authoritative receipt roots remain P1+ work.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WITNESS_KIND = 'host_wrapper_payload_hash';
const DRIVER_WITNESS_KIND = 'strace_execve_stdout';
const WITNESS_VERSION = 1;
const EXECUTION_PROOF = 'host_process_witnessed';

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => {
      const v = value[key];
      if (v === undefined) return null;
      return `${JSON.stringify(key)}:${canonical(v)}`;
    }).filter(Boolean).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stripWitness(payload) {
  const copy = JSON.parse(JSON.stringify(payload));
  delete copy.execution_proof;
  delete copy.execution_witness;
  return copy;
}

function witnessPayload(payload) {
  const payloadSha = sha256(canonical(stripWitness(payload)));
  const witness = {
    kind: WITNESS_KIND,
    version: WITNESS_VERSION,
    probe: payload.probe,
    nonce_echo: payload.nonce_echo,
    payload_sha256: payloadSha,
    wrapper_pid: process.pid,
    parent_pid: process.ppid,
    wrapper_script: path.basename(__filename),
    node: path.basename(process.execPath),
  };
  return {
    ...payload,
    execution_proof: EXECUTION_PROOF,
    execution_witness: {
      ...witness,
    },
  };
}

function verifyPayload(payload, expectedNonce) {
  if (!payload || typeof payload !== 'object') throw new Error('payload_not_object');
  if (payload.execution_proof !== EXECUTION_PROOF) throw new Error('missing_execution_proof');
  if (!payload.execution_witness || typeof payload.execution_witness !== 'object') {
    throw new Error('missing_execution_witness');
  }

  const witness = payload.execution_witness;
  if (witness.kind !== WITNESS_KIND) throw new Error('wrong_witness_kind');
  if (witness.version !== WITNESS_VERSION) throw new Error('wrong_witness_version');
  if (expectedNonce && payload.nonce_echo !== expectedNonce) throw new Error('nonce_mismatch');
  if (witness.nonce_echo !== payload.nonce_echo) throw new Error('witness_nonce_mismatch');
  if (witness.probe !== payload.probe) throw new Error('witness_probe_mismatch');

  const expectedPayloadSha = sha256(canonical(stripWitness(payload)));
  if (witness.payload_sha256 !== expectedPayloadSha) throw new Error('payload_hash_mismatch');

  return payload;
}

function sanitizeTraceLine(line) {
  return String(line)
    .replace(/\/tmp\/[^"',) ]+/g, '/tmp/[redacted]')
    .slice(0, 1000);
}

function verifyTrace(payload, traceText) {
  const verifiedPayload = verifyPayload(payload);
  const witness = verifiedPayload.execution_witness;
  const pid = String(witness.wrapper_pid || '');
  if (!/^[0-9]+$/.test(pid)) throw new Error('witness_pid_invalid');

  const lines = String(traceText).split(/\r?\n/).filter((line) => line.startsWith(`${pid} `));
  const execLine = lines.find((line) => line.includes('execve(')
    && line.includes(witness.wrapper_script)
    && line.includes(String(verifiedPayload.nonce_echo)));
  if (!execLine) throw new Error('trace_execve_missing');

  const writeLine = lines.find((line) => line.includes('write(1,')
    && line.includes(String(verifiedPayload.nonce_echo))
    && line.includes(witness.payload_sha256));
  if (!writeLine) throw new Error('trace_stdout_payload_hash_missing');

  return {
    kind: DRIVER_WITNESS_KIND,
    version: WITNESS_VERSION,
    trace_tool: 'strace',
    wrapper_pid: witness.wrapper_pid,
    wrapper_script: witness.wrapper_script,
    payload_sha256: witness.payload_sha256,
    execve_matched: true,
    stdout_payload_hash_matched: true,
    trace_sha256: sha256(traceText),
    evidence: [
      `${pid} execve(${witness.wrapper_script}) nonce=${verifiedPayload.nonce_echo} trace=${sha256(execLine)}`,
      `${pid} write(1, ...) nonce=${verifiedPayload.nonce_echo} payload_sha256=${witness.payload_sha256} trace=${sha256(writeLine)}`,
    ],
  };
}

function runProbe() {
  const repo = path.resolve(arg('--repo', path.resolve(__dirname, '../../../../..')));
  const nonce = arg('--nonce');
  const receiptRoot = arg('--receipt-root', process.env.AUTOPILOT_P0_RECEIPT_ROOT || null);
  if (!nonce) throw new Error('--nonce required');

  const probe = path.join(repo, 'docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/host-capability-probe.js');
  const probeArgs = [probe, '--nonce', nonce, '--repo', repo];
  if (receiptRoot) probeArgs.push('--receipt-root', receiptRoot);
  probeArgs.push('--json');
  const child = spawnSync(process.execPath, probeArgs, {
    cwd: repo,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (child.status !== 0) {
    process.stderr.write(child.stderr || child.stdout || `probe exited ${child.status}\n`);
    process.exit(child.status || 1);
  }

  let payload;
  try {
    payload = JSON.parse(child.stdout);
  } catch (err) {
    process.stderr.write(`probe_json_parse_failed: ${err.message}\n`);
    process.exit(12);
  }
  if (payload.nonce_echo !== nonce) {
    process.stderr.write('probe_nonce_mismatch\n');
    process.exit(13);
  }

  process.stdout.write(JSON.stringify(witnessPayload(payload), null, 2) + '\n');
}

function verifyCli() {
  const file = arg('--payload-file');
  const nonce = arg('--nonce');
  const traceFile = arg('--trace-file');
  if (!file) throw new Error('--payload-file required');

  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const verified = verifyPayload(payload, nonce);
  if (traceFile) {
    const trace = fs.readFileSync(traceFile, 'utf8');
    process.stdout.write(JSON.stringify({
      payload: verified,
      driver: verifyTrace(verified, trace),
    }) + '\n');
  } else {
    process.stdout.write(JSON.stringify(verified) + '\n');
  }
}

if (require.main === module) {
  try {
    if (hasFlag('--verify')) verifyCli();
    else runProbe();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  EXECUTION_PROOF,
  DRIVER_WITNESS_KIND,
  WITNESS_KIND,
  canonical,
  verifyTrace,
  verifyPayload,
  witnessPayload,
};
