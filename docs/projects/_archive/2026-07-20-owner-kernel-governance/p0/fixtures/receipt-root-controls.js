#!/usr/bin/env node
/**
 * Deterministic controls for the P0 authoritative receipt-root evidence path.
 *
 * This is P0-only measurement code. It does not create Owner Kernel product surfaces.
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { witnessPayload } = require('./host-capability-witness.js');

const RECEIPT_ROOT_MARKER = '.autopilot-p0-disposable-receipt-root';
const RECEIPT_ROOT_MARKER_VALUE = 'owner-kernel-p0-disposable-receipt-root';

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

function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  return '{' + Object.keys(obj).sort()
    .filter((k) => k !== 'content_hash' && k !== 'prev_hash')
    .map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function makeReceiptRoot(root, opts = {}) {
  const marker = opts.marker !== false;
  fs.mkdirSync(root, { recursive: true });
  const row = {
    seq: 0,
    type: 'evidence',
    payload: 'baseline',
    prev_hash: 'genesis',
  };
  row.content_hash = sha256(canonical(row) + '|genesis');
  const receipt = {
    seq: 0,
    event_head: row.content_hash,
    prev_witnessed_head: 'genesis',
  };
  fs.writeFileSync(path.join(root, 'events.jsonl'), JSON.stringify(row) + '\n');
  fs.writeFileSync(path.join(root, 'receipts.jsonl'), JSON.stringify(receipt) + '\n');
  if (marker) {
    fs.writeFileSync(path.join(root, RECEIPT_ROOT_MARKER), RECEIPT_ROOT_MARKER_VALUE + '\n');
  }
}

function driverFor(payload) {
  const witness = payload.execution_witness;
  const traceHash = 'a'.repeat(64);
  return {
    kind: 'strace_execve_stdout',
    version: 1,
    trace_tool: 'strace',
    wrapper_pid: witness.wrapper_pid,
    wrapper_script: witness.wrapper_script,
    payload_sha256: witness.payload_sha256,
    execve_matched: true,
    stdout_payload_hash_matched: true,
    trace_sha256: traceHash,
    evidence: [
      `${witness.wrapper_pid} execve(${witness.wrapper_script}) nonce=${payload.nonce_echo} trace=${traceHash}`,
      `${witness.wrapper_pid} write(1, ...) nonce=${payload.nonce_echo} payload_sha256=${witness.payload_sha256} trace=${traceHash}`,
    ],
  };
}

function hostDoc(permissionMode, host) {
  return {
    probe: 'owner-kernel-p0-per-harness-capability',
    permission_mode: permissionMode,
    nonce_rail: 'control fixture',
    execution_witness_rail: 'control fixture',
    receipt_root: null,
    hosts: [host],
  };
}

function probedHost(harness, payload) {
  return {
    harness,
    status: 'probed',
    command: 'control fixture',
    exit_code: 0,
    error_excerpt: 'control driver proof',
    probe_payload: payload,
    evidence_grade: 'driver_verified_execution_witness',
    execution_witness_verified: true,
    execution_witness_driver: driverFor(payload),
  };
}

function classify(classifier, dir) {
  return JSON.parse(run(process.execPath, [classifier, '--dir', dir, '--json']).stdout);
}

const repo = path.resolve(arg('--repo', path.resolve(__dirname, '../../../../..')));
const tmp = path.resolve(arg('--tmp', fs.mkdtempSync(path.join(os.tmpdir(), 'p0-receipt-root-controls-'))));
const probe = path.join(repo, 'docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/host-capability-probe.js');
const classifier = path.join(repo, 'docs/projects/2026-07-20-owner-kernel-governance/p0/classify-hosts.js');
fs.mkdirSync(tmp, { recursive: true });

const noRoot = JSON.parse(run(process.execPath, [probe, '--nonce', 'noroot', '--repo', repo, '--json'], { cwd: repo }).stdout);
assert.equal(noRoot.findings.R4_append_only_witness_substrate.external_receipt_root.configured, false);

const unmarkedRoot = path.join(tmp, 'unmarked-root');
makeReceiptRoot(unmarkedRoot, { marker: false });
const unmarkedRaw = JSON.parse(run(process.execPath, [
  probe, '--nonce', 'unmarked', '--repo', repo, '--receipt-root', unmarkedRoot, '--json',
], { cwd: repo }).stdout);
const unmarkedR4 = unmarkedRaw.findings.R4_append_only_witness_substrate;
assert.equal(unmarkedR4.external_receipt_root.configured, true);
assert.equal(unmarkedR4.external_receipt_root.disposable_marker_verified, false);
assert.equal(unmarkedR4.external_receipt_root.error, 'receipt_root_marker_missing');
assert.equal(unmarkedR4.harness_authoritative_witness_root_compromised, false);

const insecureRoot = path.join(tmp, 'same-uid-root');
makeReceiptRoot(insecureRoot);
const insecureRaw = JSON.parse(run(process.execPath, [
  probe, '--nonce', 'insecure', '--repo', repo, '--receipt-root', insecureRoot, '--json',
], { cwd: repo }).stdout);
const insecureR4 = insecureRaw.findings.R4_append_only_witness_substrate;
assert.equal(insecureR4.external_receipt_root.configured, true);
assert.equal(insecureR4.external_receipt_root.disposable_marker_verified, true);
assert.equal(insecureR4.harness_authoritative_witness_root_compromised, true);

const insecurePayload = witnessPayload(insecureRaw);
const insecureDir = path.join(tmp, 'insecure-classifier');
writeJson(path.join(insecureDir, 'harness-capability-default-mode.json'), hostDoc('default', probedHost('opencode', insecurePayload)));
writeJson(path.join(insecureDir, 'harness-capability-bypass-mode.json'), hostDoc('bypass', probedHost('opencode', insecurePayload)));
const insecureClass = classify(classifier, insecureDir).hosts.find((h) => h.harness === 'opencode');
assert.equal(insecureClass.roots.R4.verdict, 'fail');

const forgedDriverDir = path.join(tmp, 'no-driver-classifier');
const noDriverHost = {
  ...probedHost('opencode', insecurePayload),
  execution_witness_driver: undefined,
};
writeJson(path.join(forgedDriverDir, 'harness-capability-default-mode.json'), hostDoc('default', noDriverHost));
writeJson(path.join(forgedDriverDir, 'harness-capability-bypass-mode.json'), hostDoc('bypass', noDriverHost));
const noDriverClass = classify(classifier, forgedDriverDir).hosts.find((h) => h.harness === 'opencode');
assert.equal(noDriverClass.roots.R4.verdict, 'unverified');

const detectedRaw = {
  probe: 'owner-kernel-p0-host-capability',
  nonce_echo: 'detected',
  scope_note: 'synthetic detected receipt-root classifier control',
  findings: {
    R1_user_channel_substrate: {
      live_forge_rejected: true,
      witness_channel_outside_model: true,
    },
    R2_owner_capability_substrate: {
      authenticated_broker_unreachable_from_model: true,
      host_memory_capability_unreachable_from_model: true,
    },
    R3_pre_action_mediation_substrate: {
      protected_path_write: 'blocked',
      gate_non_disableable_positive_proof: true,
    },
    R4_append_only_witness_substrate: {
      harness_authoritative_witness_attack_detected: true,
      external_receipt_chain_verified: false,
      external_receipt_root: {
        configured: true,
        baseline_verified: true,
        disposable_marker_verified: true,
      },
    },
  },
};
const detectedPayload = witnessPayload(detectedRaw);
const detectedDir = path.join(tmp, 'detected-classifier');
writeJson(path.join(detectedDir, 'harness-capability-default-mode.json'), hostDoc('default', probedHost('opencode', detectedPayload)));
writeJson(path.join(detectedDir, 'harness-capability-bypass-mode.json'), hostDoc('bypass', probedHost('opencode', detectedPayload)));
const detectedClass = classify(classifier, detectedDir).hosts.find((h) => h.harness === 'opencode');
assert.equal(detectedClass.roots.R4.verdict, 'suspect');
assert.equal(detectedClass.tier, 'unverified');
assert(detectedClass.missing_operations.some((m) => m.includes('detected-compromise recovery')));

const inconsistentRaw = {
  probe: 'owner-kernel-p0-host-capability',
  nonce_echo: 'inconsistent',
  scope_note: 'synthetic inconsistent receipt-root classifier control',
  findings: {
    R1_user_channel_substrate: {
      live_forge_rejected: true,
      witness_channel_outside_model: true,
    },
    R2_owner_capability_substrate: {
      authenticated_broker_unreachable_from_model: true,
      host_memory_capability_unreachable_from_model: true,
    },
    R3_pre_action_mediation_substrate: {
      protected_path_write: 'blocked',
      gate_non_disableable_positive_proof: true,
    },
    R4_append_only_witness_substrate: {
      harness_authoritative_witness_attack_rejected: true,
      external_receipt_chain_verified: false,
      external_receipt_root: {
        configured: true,
        baseline_verified: true,
        disposable_marker_verified: true,
      },
    },
  },
};
const inconsistentPayload = witnessPayload(inconsistentRaw);
const inconsistentDir = path.join(tmp, 'inconsistent-classifier');
writeJson(path.join(inconsistentDir, 'harness-capability-default-mode.json'), hostDoc('default', probedHost('opencode', inconsistentPayload)));
writeJson(path.join(inconsistentDir, 'harness-capability-bypass-mode.json'), hostDoc('bypass', probedHost('opencode', inconsistentPayload)));
const inconsistentClass = classify(classifier, inconsistentDir).hosts.find((h) => h.harness === 'opencode');
assert.equal(inconsistentClass.roots.R4.verdict, 'suspect');
assert.equal(inconsistentClass.tier, 'unverified');
assert(inconsistentClass.missing_operations.some((m) => m.includes('before scoring R4 as pass')));

const protectedRaw = {
  probe: 'owner-kernel-p0-host-capability',
  nonce_echo: 'protected',
  scope_note: 'synthetic protected receipt-root classifier control',
  findings: {
    R1_user_channel_substrate: {
      live_forge_rejected: true,
      witness_channel_outside_model: true,
    },
    R2_owner_capability_substrate: {
      authenticated_broker_unreachable_from_model: true,
      host_memory_capability_unreachable_from_model: true,
    },
    R3_pre_action_mediation_substrate: {
      protected_path_write: 'blocked',
      gate_non_disableable_positive_proof: true,
    },
    R4_append_only_witness_substrate: {
      harness_authoritative_witness_attack_rejected: true,
      external_receipt_chain_verified: true,
      external_receipt_root: {
        configured: true,
        baseline_verified: true,
        disposable_marker_verified: true,
      },
    },
  },
};
const protectedPayload = witnessPayload(protectedRaw);
const protectedDir = path.join(tmp, 'protected-classifier');
writeJson(path.join(protectedDir, 'harness-capability-default-mode.json'), hostDoc('default', probedHost('opencode', protectedPayload)));
writeJson(path.join(protectedDir, 'harness-capability-bypass-mode.json'), hostDoc('bypass', probedHost('opencode', protectedPayload)));
const protectedClass = classify(classifier, protectedDir).hosts.find((h) => h.harness === 'opencode');
assert.equal(protectedClass.roots.R4.verdict, 'pass');
assert.equal(protectedClass.tier, 'full');

process.stdout.write(JSON.stringify({
  probe: 'owner-kernel-p0-receipt-root-controls',
  controls: {
    no_receipt_root_is_unconfigured: true,
    non_disposable_receipt_root_rejected: true,
    same_uid_receipt_root_compromised: true,
    classifier_scores_insecure_root_fail: true,
    classifier_rejects_driverless_receipt_root_claim: true,
    classifier_scores_detected_mutation_suspect: true,
    classifier_scores_inconsistent_receipt_state_suspect: true,
    classifier_scores_protected_root_pass: true,
  },
}, null, 2) + '\n');
