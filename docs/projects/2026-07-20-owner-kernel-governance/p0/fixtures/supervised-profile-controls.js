#!/usr/bin/env node
/**
 * Deterministic controls for the P0 supervised-partial fixture.
 *
 * Each fault opens exactly one boundary. The classifier must accept the baseline only as
 * `partial` and must resolve every opened boundary to `none` or `unverified`, never full/partial.
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!opts.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

const repo = path.resolve(arg('--repo', path.resolve(__dirname, '../../../../..')));
const tmp = path.resolve(arg('--tmp', fs.mkdtempSync(path.join(os.tmpdir(), 'p0-supervised-controls-'))));
const p0 = path.join(repo, 'docs/projects/2026-07-20-owner-kernel-governance/p0');
const driver = path.join(p0, 'fixtures/run-supervised-profile.js');
const classifier = path.join(p0, 'classify-hosts.js');
const baseDefault = fs.readFileSync(path.join(p0, 'harness-capability-default-mode.json'));
const baseBypass = fs.readFileSync(path.join(p0, 'harness-capability-bypass-mode.json'));

function drive(name, fault = 'none') {
  const out = path.join(tmp, 'runs', name);
  const result = run(process.execPath, [driver, '--out-dir', out, '--nonce', `supervised-${name}`, '--fault', fault]);
  assert.match(result.stdout, /execution_witness_verified/);
  return out;
}

function classifyProfile(name, profileDir) {
  const dir = path.join(tmp, 'classify', name);
  const sourceDir = path.join(dir, 'sources');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'harness-capability-default-mode.json'), baseDefault);
  fs.writeFileSync(path.join(dir, 'harness-capability-bypass-mode.json'), baseBypass);
  const defaultBytes = fs.readFileSync(path.join(profileDir, 'harness-capability-default-mode.json'));
  const bypassBytes = fs.readFileSync(path.join(profileDir, 'harness-capability-bypass-mode.json'));
  fs.writeFileSync(path.join(sourceDir, 'default.json'), defaultBytes);
  fs.writeFileSync(path.join(sourceDir, 'bypass.json'), bypassBytes);
  writeJson(path.join(dir, 'evidence-manifest.json'), {
    schema_version: 1,
    base: {
      default: { path: 'harness-capability-default-mode.json', sha256: sha256(baseDefault) },
      bypass: { path: 'harness-capability-bypass-mode.json', sha256: sha256(baseBypass) },
    },
    target_hosts: ['supervised-partial'],
    overlays: [{
      harness: 'supervised-partial',
      default: { path: 'sources/default.json', sha256: sha256(defaultBytes) },
      bypass: { path: 'sources/bypass.json', sha256: sha256(bypassBytes) },
    }],
  });
  const result = run(process.execPath, [classifier, '--dir', dir, '--json']);
  const output = JSON.parse(result.stdout);
  return {
    dir,
    output,
    host: output.hosts.find((host) => host.harness === 'supervised-partial'),
  };
}

const baseline = classifyProfile('baseline', drive('baseline'));
assert.equal(baseline.host.tier, 'partial');
assert.equal(baseline.host.roots.R1.verdict, 'pass');
assert.equal(baseline.host.roots.R2.verdict, 'pass');
assert.equal(baseline.host.roots.R3.verdict, 'pass');
assert.equal(baseline.host.roots.R4.verdict, 'pass');
assert.equal(baseline.output.gate.any_target_host_qualified, true);

const faults = [
  ['accept-user-forge', 'R1'],
  ['allow-direct-decision', 'R2'],
  ['expose-capability', 'R2'],
  ['writable-protected', 'R3'],
  ['mount-receipts', 'R4'],
];
for (const [fault, root] of faults) {
  const result = classifyProfile(fault, drive(fault, fault));
  assert.notEqual(result.host.tier, 'partial', fault);
  assert.notEqual(result.host.tier, 'full', fault);
  assert.equal(result.host.roots[root].verdict, 'fail', fault);
}

const tamperedDir = path.join(tmp, 'tampered-profile');
fs.cpSync(path.join(tmp, 'runs', 'baseline'), tamperedDir, { recursive: true });
const tamperedDefault = path.join(tamperedDir, 'harness-capability-default-mode.json');
const tamperedDoc = JSON.parse(fs.readFileSync(tamperedDefault, 'utf8'));
tamperedDoc.hosts[0].probe_payload.findings.R3_pre_action_mediation_substrate.gate_non_disableable_positive_proof = false;
writeJson(tamperedDefault, tamperedDoc);
const tampered = classifyProfile('tampered', tamperedDir);
assert.equal(tampered.host.tier, 'unverified');
assert.equal(tampered.host.roots.R3.verdict, 'unverified');

process.stdout.write(JSON.stringify({
  probe: 'owner-kernel-p0-supervised-profile-controls',
  controls: {
    baseline_qualifies_partial: true,
    r1_forged_user_intent_acceptance_scores_fail: true,
    r2_direct_decision_acceptance_scores_fail: true,
    r2_capability_environment_exposure_scores_fail: true,
    r3_direct_protected_write_scores_fail: true,
    r4_receipt_mount_scores_fail: true,
    witnessed_payload_tamper_rejected: true,
  },
}, null, 2) + '\n');
