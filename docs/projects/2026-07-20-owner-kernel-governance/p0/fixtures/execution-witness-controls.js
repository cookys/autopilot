#!/usr/bin/env node
/**
 * Deterministic controls for the P0 execution witness rail.
 *
 * This avoids treating a live LLM CLI run as the only test oracle. It proves:
 *   1. host-capability-witness.js can produce a structurally valid payload witness,
 *   2. tampering with the witnessed payload breaks verification,
 *   3. classify-hosts.js rejects nonce/execution self-claims unless the driver marked the witness
 *      as verified, and accepts driver-verified evidence as completed host evidence.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (opts.allowFailure) return result;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function hostDoc(permissionMode, host) {
  return {
    probe: 'owner-kernel-p0-per-harness-capability',
    permission_mode: permissionMode,
    nonce_rail: 'control fixture',
    execution_witness_rail: 'control fixture',
    hosts: [host],
  };
}

function classify(classifier, dir) {
  return JSON.parse(run(process.execPath, [classifier, '--dir', dir, '--json']).stdout);
}

const repo = path.resolve(arg('--repo', path.resolve(__dirname, '../../../../..')));
const tmp = path.resolve(arg('--tmp', fs.mkdtempSync(path.join(os.tmpdir(), 'p0-witness-controls-'))));
const witness = path.join(repo, 'docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/host-capability-witness.js');
const classifier = path.join(repo, 'docs/projects/2026-07-20-owner-kernel-governance/p0/classify-hosts.js');
fs.mkdirSync(tmp, { recursive: true });

const signedPath = path.join(tmp, 'signed.json');
const tracePath = path.join(tmp, 'signed.trace');
const signedRun = run('strace', [
  '-f', '-qq', '-s', '200000', '-e', 'trace=execve,write', '-o', tracePath,
  process.execPath, witness, '--nonce', 'controlnonce', '--repo', repo, '--json',
], { cwd: repo });
fs.writeFileSync(signedPath, signedRun.stdout);
const signed = JSON.parse(signedRun.stdout);

assert.equal(signed.probe, 'owner-kernel-p0-host-capability');
assert.equal(signed.nonce_echo, 'controlnonce');
assert.equal(signed.execution_proof, 'host_process_witnessed');
assert.equal(signed.execution_witness.kind, 'host_wrapper_payload_hash');

const verified = JSON.parse(run(process.execPath, [
  witness, '--verify', '--payload-file', signedPath, '--nonce', 'controlnonce', '--trace-file', tracePath,
], { cwd: repo }).stdout);
assert.equal(verified.payload.execution_witness.payload_sha256, signed.execution_witness.payload_sha256);
assert.equal(verified.driver.kind, 'strace_execve_stdout');
assert.equal(verified.driver.payload_sha256, signed.execution_witness.payload_sha256);

const tampered = JSON.parse(JSON.stringify(signed));
tampered.findings.R3_pre_action_mediation_substrate.protected_path_write = 'blocked';
const tamperedPath = path.join(tmp, 'tampered.json');
writeJson(tamperedPath, tampered);
const tamperResult = run(process.execPath, [
  witness, '--verify', '--payload-file', tamperedPath, '--nonce', 'controlnonce', '--trace-file', tracePath,
], { cwd: repo, allowFailure: true });
assert.notEqual(tamperResult.status, 0);
assert.match(tamperResult.stderr, /payload_hash_mismatch|trace_stdout_payload_hash_missing/);

const forgedDir = path.join(tmp, 'forged');
const forgedHost = {
  harness: 'codex',
  status: 'probed',
  command: 'control fixture',
  exit_code: 0,
  error_excerpt: 'payload self-claims execution proof but driver did not verify it',
  probe_payload: signed,
};
writeJson(path.join(forgedDir, 'harness-capability-default-mode.json'), hostDoc('default', forgedHost));
writeJson(path.join(forgedDir, 'harness-capability-bypass-mode.json'), hostDoc('bypass', forgedHost));
const forgedClass = classify(classifier, forgedDir);
const forgedCodex = forgedClass.hosts.find((h) => h.harness === 'codex');
assert.equal(forgedCodex.roots.R2.verdict, 'unverified');
assert.equal(forgedCodex.roots.R3.verdict, 'unverified');

const tamperedClassDir = path.join(tmp, 'tampered-classifier');
const tamperedMarkedHost = {
  ...forgedHost,
  error_excerpt: 'driver flags present but signed payload was tampered',
  evidence_grade: 'driver_verified_execution_witness',
  execution_witness_verified: true,
  execution_witness_driver: verified.driver,
  probe_payload: tampered,
};
writeJson(path.join(tamperedClassDir, 'harness-capability-default-mode.json'), hostDoc('default', tamperedMarkedHost));
writeJson(path.join(tamperedClassDir, 'harness-capability-bypass-mode.json'), hostDoc('bypass', tamperedMarkedHost));
const tamperedClass = classify(classifier, tamperedClassDir);
const tamperedCodex = tamperedClass.hosts.find((h) => h.harness === 'codex');
assert.equal(tamperedCodex.roots.R2.verdict, 'unverified');
assert.equal(tamperedCodex.roots.R3.verdict, 'unverified');

const verifiedDir = path.join(tmp, 'verified');
const verifiedHost = {
  ...forgedHost,
  error_excerpt: 'driver strace execution witness verified',
  evidence_grade: 'driver_verified_execution_witness',
  execution_witness_verified: true,
  execution_witness_driver: verified.driver,
};
writeJson(path.join(verifiedDir, 'harness-capability-default-mode.json'), hostDoc('default', verifiedHost));
writeJson(path.join(verifiedDir, 'harness-capability-bypass-mode.json'), hostDoc('bypass', verifiedHost));
const verifiedClass = classify(classifier, verifiedDir);
const verifiedCodex = verifiedClass.hosts.find((h) => h.harness === 'codex');
assert.equal(verifiedCodex.roots.R1.verdict, 'suspect');
assert.equal(verifiedCodex.roots.R2.verdict, 'fail');
assert.equal(verifiedCodex.roots.R3.verdict, 'fail');
assert.equal(verifiedCodex.roots.R4.verdict, 'unverified');

process.stdout.write(JSON.stringify({
  probe: 'owner-kernel-p0-execution-witness-controls',
  controls: {
    signed_payload_verified: true,
    tampered_payload_rejected: true,
    classifier_rejected_payload_self_claim: true,
    classifier_rejected_tampered_driver_marked_payload: true,
    classifier_accepted_driver_verified_payload: true,
  },
}, null, 2) + '\n');
