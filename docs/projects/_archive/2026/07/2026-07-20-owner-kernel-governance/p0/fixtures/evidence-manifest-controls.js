#!/usr/bin/env node
/**
 * Negative controls for canonical P0 evidence composition.
 *
 * The manifest may replace a stale host row only when the referenced mode/harness document is a
 * regular in-tree file with an exact pinned hash. Invalid composition must fail before any tier is
 * emitted.
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

function runClassifier(classifier, dir) {
  return spawnSync(process.execPath, [classifier, '--dir', dir, '--json'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

const repo = path.resolve(arg('--repo', path.resolve(__dirname, '../../../../..')));
const tmp = path.resolve(arg('--tmp', fs.mkdtempSync(path.join(os.tmpdir(), 'p0-manifest-controls-'))));
const p0 = path.join(repo, 'docs/projects/2026-07-20-owner-kernel-governance/p0');
const classifier = path.join(p0, 'classify-hosts.js');
const baseDefault = fs.readFileSync(path.join(p0, 'harness-capability-default-mode.json'));
const baseBypass = fs.readFileSync(path.join(p0, 'harness-capability-bypass-mode.json'));
const opusDefault = fs.readFileSync(path.join(
  p0, 'variants/claude-opus-high/harness-capability-default-mode.json'));
const opusBypass = fs.readFileSync(path.join(
  p0, 'variants/claude-opus-high/harness-capability-bypass-mode.json'));

function makeCase(name, manifest) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'harness-capability-default-mode.json'), baseDefault);
  fs.writeFileSync(path.join(dir, 'harness-capability-bypass-mode.json'), baseBypass);
  fs.writeFileSync(path.join(dir, 'sources/opus-default.json'), opusDefault);
  fs.writeFileSync(path.join(dir, 'sources/opus-bypass.json'), opusBypass);
  writeJson(path.join(dir, 'evidence-manifest.json'), manifest);
  return dir;
}

const validManifest = {
  schema_version: 1,
  base: {
    default: { path: 'harness-capability-default-mode.json', sha256: sha256(baseDefault) },
    bypass: { path: 'harness-capability-bypass-mode.json', sha256: sha256(baseBypass) },
  },
  target_hosts: ['claude-code', 'codex', 'opencode', 'agy'],
  overlays: [{
    harness: 'claude-code',
    default: { path: 'sources/opus-default.json', sha256: sha256(opusDefault) },
    bypass: { path: 'sources/opus-bypass.json', sha256: sha256(opusBypass) },
  }],
};

const valid = runClassifier(classifier, makeCase('valid', validManifest));
assert.equal(valid.status, 0, valid.stderr);
const validPayload = JSON.parse(valid.stdout);
assert.equal(validPayload.evidence_composition.manifest_applied, true);
assert.equal(validPayload.evidence_composition.selected_sources.length, 4);
assert.equal(validPayload.hosts.find((host) => host.harness === 'claude-code').tier, 'none');
assert.equal(validPayload.summary.hosts_none, 4);
assert.equal(validPayload.summary.hosts_unverified, 0);
assert.equal(validPayload.gate.kill_condition_evaluable, true);

const badHash = JSON.parse(JSON.stringify(validManifest));
badHash.overlays[0].default.sha256 = '0'.repeat(64);
const badHashRun = runClassifier(classifier, makeCase('bad-hash', badHash));
assert.equal(badHashRun.status, 2);
assert.match(badHashRun.stderr, /sha256 mismatch/);

const baseTamperDir = makeCase('base-tamper', validManifest);
fs.appendFileSync(path.join(baseTamperDir, 'harness-capability-default-mode.json'), '\n');
const baseTamperRun = runClassifier(classifier, baseTamperDir);
assert.equal(baseTamperRun.status, 2);
assert.match(baseTamperRun.stderr, /base\.default\.sha256 mismatch/);

const outside = path.join(tmp, 'outside.json');
fs.writeFileSync(outside, opusDefault);
const traversal = JSON.parse(JSON.stringify(validManifest));
traversal.overlays[0].default = { path: '../outside.json', sha256: sha256(opusDefault) };
const traversalRun = runClassifier(classifier, makeCase('traversal', traversal));
assert.equal(traversalRun.status, 2);
assert.match(traversalRun.stderr, /escapes the evidence directory/);

const wrongMode = JSON.parse(JSON.stringify(validManifest));
wrongMode.overlays[0].default = { path: 'sources/opus-bypass.json', sha256: sha256(opusBypass) };
const wrongModeRun = runClassifier(classifier, makeCase('wrong-mode', wrongMode));
assert.equal(wrongModeRun.status, 2);
assert.match(wrongModeRun.stderr, /wrong permission mode/);

const wrongHarnessDir = makeCase('wrong-harness', validManifest);
const wrongHarnessDoc = JSON.parse(opusDefault.toString('utf8'));
wrongHarnessDoc.hosts[0].harness = 'not-claude-code';
const wrongHarnessBytes = Buffer.from(JSON.stringify(wrongHarnessDoc, null, 2) + '\n');
fs.writeFileSync(path.join(wrongHarnessDir, 'sources/opus-default.json'), wrongHarnessBytes);
const wrongHarnessManifest = JSON.parse(JSON.stringify(validManifest));
wrongHarnessManifest.overlays[0].default.sha256 = sha256(wrongHarnessBytes);
writeJson(path.join(wrongHarnessDir, 'evidence-manifest.json'), wrongHarnessManifest);
const wrongHarnessRun = runClassifier(classifier, wrongHarnessDir);
assert.equal(wrongHarnessRun.status, 2);
assert.match(wrongHarnessRun.stderr, /exactly one matching harness row/);

const duplicate = JSON.parse(JSON.stringify(validManifest));
duplicate.overlays.push(JSON.parse(JSON.stringify(duplicate.overlays[0])));
const duplicateRun = runClassifier(classifier, makeCase('duplicate', duplicate));
assert.equal(duplicateRun.status, 2);
assert.match(duplicateRun.stderr, /duplicated/);

const symlinkDir = makeCase('symlink', validManifest);
fs.unlinkSync(path.join(symlinkDir, 'sources/opus-default.json'));
fs.symlinkSync(path.join(p0, 'variants/claude-opus-high/harness-capability-default-mode.json'),
  path.join(symlinkDir, 'sources/opus-default.json'));
const symlinkRun = runClassifier(classifier, symlinkDir);
assert.equal(symlinkRun.status, 2);
assert.match(symlinkRun.stderr, /symlink component/);

const intermediateDir = makeCase('intermediate-symlink', validManifest);
const outsideSources = path.join(tmp, 'outside-sources');
fs.mkdirSync(outsideSources, { recursive: true });
fs.writeFileSync(path.join(outsideSources, 'opus-default.json'), opusDefault);
fs.writeFileSync(path.join(outsideSources, 'opus-bypass.json'), opusBypass);
fs.symlinkSync(outsideSources, path.join(intermediateDir, 'linked'));
const intermediateManifest = JSON.parse(JSON.stringify(validManifest));
intermediateManifest.overlays[0].default.path = 'linked/opus-default.json';
intermediateManifest.overlays[0].bypass.path = 'linked/opus-bypass.json';
writeJson(path.join(intermediateDir, 'evidence-manifest.json'), intermediateManifest);
const intermediateRun = runClassifier(classifier, intermediateDir);
assert.equal(intermediateRun.status, 2);
assert.match(intermediateRun.stderr, /symlink component/);

process.stdout.write(JSON.stringify({
  probe: 'owner-kernel-p0-evidence-manifest-controls',
  controls: {
    valid_hash_pinned_overlay_composed: true,
    stale_claude_row_replaced_by_opus_evidence: true,
    hash_mismatch_rejected: true,
    base_hash_mismatch_rejected: true,
    path_traversal_rejected: true,
    permission_mode_mismatch_rejected: true,
    harness_mismatch_rejected: true,
    duplicate_overlay_rejected: true,
    symlink_source_rejected: true,
    intermediate_symlink_rejected: true,
  },
}, null, 2) + '\n');
