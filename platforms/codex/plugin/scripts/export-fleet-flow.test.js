'use strict';

/**
 * Tests for scripts/export-fleet-flow.js + schemas/fleet-flow.schema.json.
 * Run:
 *   unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID
 *   node --test scripts/export-fleet-flow.test.js < /dev/null
 */

require('./lib/test-git-env.js');

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'scripts', 'export-fleet-flow.js');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'fleet-flow.schema.json');
const STAGE_GRAPH_PATH = path.join(REPO_ROOT, 'references', 'stage-graph.json');
const EXPORT_PATH = path.join(REPO_ROOT, 'references', 'fleet-flow-graph.json');
const PLUGIN_JSON_PATH = path.join(REPO_ROOT, '.claude-plugin', 'plugin.json');

const { validateJsonSchema, readJson, canonical } = require('./validate-json-schema.js');
const {
  EXPORT_SCHEMA,
  buildExportObject,
  computeExportSha256,
  serializeExport,
  verifyExportFile,
} = require('./export-fleet-flow.js');
const { COARSE_OF_NODE } = require('./stage-advance.js');
const { buildWalk } = require('./stage-graph.js');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'export-fleet-flow-test-'));
test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function makeTempRepoCopy(name) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'schemas'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });

  fs.copyFileSync(STAGE_GRAPH_PATH, path.join(dir, 'references', 'stage-graph.json'));
  fs.copyFileSync(SCHEMA_PATH, path.join(dir, 'schemas', 'fleet-flow.schema.json'));
  fs.copyFileSync(PLUGIN_JSON_PATH, path.join(dir, '.claude-plugin', 'plugin.json'));
  if (fs.existsSync(EXPORT_PATH)) {
    fs.copyFileSync(EXPORT_PATH, path.join(dir, 'references', 'fleet-flow-graph.json'));
  }
  return dir;
}

test('committed references/fleet-flow-graph.json validates against schema, canonical LF format, and recomputes export_sha256', () => {
  assert.equal(fs.existsSync(EXPORT_PATH), true, 'references/fleet-flow-graph.json must exist');

  const rawText = fs.readFileSync(EXPORT_PATH, 'utf8');
  assert.equal(rawText.includes('\r'), false, 'must use LF only');
  assert.equal(rawText.endsWith('\n'), true, 'must end with trailing newline');
  assert.equal(rawText.split('\n').length, 2, 'canonical compact form is one JSON line + trailing newline');

  const schema = readJson(SCHEMA_PATH, 'fleet-flow.schema.json');
  const doc = readJson(EXPORT_PATH, 'fleet-flow-graph.json');
  const validation = validateJsonSchema(schema, doc);
  assert.equal(validation.valid, true, `schema errors: ${validation.errors.join('; ')}`);

  assert.equal(doc.schema, EXPORT_SCHEMA);
  assert.equal(rawText, `${canonical(doc)}\n`, 'file bytes must match canonical sorted JSON + LF');

  const withoutSha = { ...doc };
  delete withoutSha.export_sha256;
  const expectedSha = crypto.createHash('sha256').update(canonical(withoutSha), 'utf8').digest('hex');
  assert.equal(doc.export_sha256, expectedSha);
  assert.equal(computeExportSha256(doc), expectedSha);

  // Coarse map matches stage-advance COARSE_OF_NODE
  assert.deepEqual(doc.coarse_of_node, { ...COARSE_OF_NODE });

  // Spot-check expanded walks reuse stage-graph.js buildWalk
  const stageGraph = JSON.parse(fs.readFileSync(STAGE_GRAPH_PATH, 'utf8'));
  const mPlain = doc.sizes.M.find((v) => !v.bug && !v.urgent && !v.explore && !v.research);
  const expectedMPlain = buildWalk(stageGraph, {
    size: 'M',
    bug: false,
    urgent: false,
    highRisk: false,
    research: false,
    explore: false,
    units: 1,
  });
  assert.deepEqual(mPlain.walk, expectedMPlain.walk);
  assert.equal(mPlain.entry, expectedMPlain.entry);
  assert.equal(mPlain.terminal, expectedMPlain.terminal);

  const checkRes = runCli(['--check', '--repo-root', REPO_ROOT]);
  assert.equal(checkRes.status, 0, `--check stderr: ${checkRes.stderr}`);

  const verifyRes = runCli(['--verify', EXPORT_PATH, '--repo-root', REPO_ROOT]);
  assert.equal(verifyRes.status, 0, `--verify stderr: ${verifyRes.stderr}`);
});

test('negative control: editing a copy of stage-graph.json without regenerating makes --check exit 1 with one stderr line', () => {
  const repo = makeTempRepoCopy('check-drift');
  // Ensure clean baseline first
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);

  // Mutate stage-graph.json without regenerating export
  const sgFile = path.join(repo, 'references', 'stage-graph.json');
  const sg = JSON.parse(fs.readFileSync(sgFile, 'utf8'));
  sg.bump_limits.XS.lines = 25;
  fs.writeFileSync(sgFile, `${JSON.stringify(sg, null, 2)}\n`, 'utf8');

  const driftRes = runCli(['--check', '--repo-root', repo]);
  assert.equal(driftRes.status, 1);
  const stderrLines = driftRes.stderr.trim().split('\n').filter(Boolean);
  assert.equal(stderrLines.length, 1, `expected exactly one stderr line, got: ${driftRes.stderr}`);

  // Regenerating turns --check green again
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);
});

test('negative control: older export with valid checksum (built from modified stage-graph copy) reports flow_export_stale', () => {
  const oldRepo = makeTempRepoCopy('older-source');
  const sgFile = path.join(oldRepo, 'references', 'stage-graph.json');
  const sg = JSON.parse(fs.readFileSync(sgFile, 'utf8'));
  sg.bump_limits.S.files = 7;
  fs.writeFileSync(sgFile, `${JSON.stringify(sg, null, 2)}\n`, 'utf8');

  // Generate self-consistent export for the older stage-graph
  assert.equal(runCli(['--repo-root', oldRepo]).status, 0);
  const oldExportFile = path.join(oldRepo, 'references', 'fleet-flow-graph.json');
  assert.equal(runCli(['--verify', oldExportFile, '--repo-root', oldRepo]).status, 0);

  // Verify that older export against the current repo -> flow_export_stale
  const verifyRes = runCli(['--verify', oldExportFile, '--repo-root', REPO_ROOT]);
  assert.equal(verifyRes.status, 1);
  assert.match(verifyRes.stderr, /^flow_export_stale:/);
});

test('negative control: edited export with recomputed checksum fails with flow_export_stale (source sha mismatch or content drift)', () => {
  const dir = makeTempRepoCopy('edited-recomputed');
  assert.equal(runCli(['--repo-root', dir]).status, 0);

  const exportFile = path.join(dir, 'references', 'fleet-flow-graph.json');
  const doc = JSON.parse(fs.readFileSync(exportFile, 'utf8'));

  // Case A: tamper source_sha256.stage_graph and recompute export_sha256
  const tamperedSourceDoc = {
    ...doc,
    source_sha256: { stage_graph: '0'.repeat(64) },
  };
  tamperedSourceDoc.export_sha256 = computeExportSha256(tamperedSourceDoc);
  const tamperedSourcePath = path.join(dir, 'tampered-source-sha.json');
  fs.writeFileSync(tamperedSourcePath, serializeExport(tamperedSourceDoc), 'utf8');

  const resA = runCli(['--verify', tamperedSourcePath, '--repo-root', dir]);
  assert.equal(resA.status, 1);
  assert.match(resA.stderr, /^flow_export_stale:.*source_sha256\.stage_graph/);

  // Case B: tamper bump_limits (keeping source_sha256 intact) and recompute export_sha256
  const tamperedBodyDoc = structuredClone(doc);
  tamperedBodyDoc.bump_limits.M.lines = 999;
  tamperedBodyDoc.export_sha256 = computeExportSha256(tamperedBodyDoc);
  const tamperedBodyPath = path.join(dir, 'tampered-body-recomputed.json');
  fs.writeFileSync(tamperedBodyPath, serializeExport(tamperedBodyDoc), 'utf8');

  const resB = runCli(['--verify', tamperedBodyPath, '--repo-root', dir]);
  assert.equal(resB.status, 1);
  assert.match(resB.stderr, /^flow_export_stale:/);

  // Case C: tamper autopilot_version and recompute export_sha256
  const tamperedVerDoc = {
    ...doc,
    autopilot_version: '0.0.1-stale',
  };
  tamperedVerDoc.export_sha256 = computeExportSha256(tamperedVerDoc);
  const tamperedVerPath = path.join(dir, 'tampered-version.json');
  fs.writeFileSync(tamperedVerPath, serializeExport(tamperedVerDoc), 'utf8');

  const resC = runCli(['--verify', tamperedVerPath, '--repo-root', dir]);
  assert.equal(resC.status, 1);
  assert.match(resC.stderr, /^flow_export_stale:.*autopilot_version/);
});

test('negative control: bad checksum without recomputing reports flow_export_invalid', () => {
  const dir = makeTempRepoCopy('bad-checksum');
  const doc = buildExportObject(dir);
  doc.export_sha256 = doc.export_sha256.startsWith('a') ? `b${doc.export_sha256.slice(1)}` : `a${doc.export_sha256.slice(1)}`;
  const badPath = path.join(dir, 'bad-checksum.json');
  fs.writeFileSync(badPath, serializeExport(doc), 'utf8');

  const res = runCli(['--verify', badPath, '--repo-root', dir]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^flow_export_invalid:.*export_sha256 mismatch/);
});

test('negative control: unknown major autopilot.fleet-flow/2 exits 1 with flow_export_invalid and never throws', () => {
  const dir = makeTempRepoCopy('unknown-major');
  const doc = buildExportObject(dir);
  const v2Doc = {
    ...doc,
    schema: 'autopilot.fleet-flow/2',
    future_field: { added: true },
  };
  v2Doc.export_sha256 = computeExportSha256(v2Doc);
  const v2Path = path.join(dir, 'v2-export.json');
  fs.writeFileSync(v2Path, serializeExport(v2Doc), 'utf8');

  // Direct library call never throws
  const direct = verifyExportFile(v2Path, dir);
  assert.equal(direct.ok, false);
  assert.equal(direct.code, 'flow_export_invalid');
  assert.match(direct.reason, /autopilot\.fleet-flow\/2/);

  // CLI call exits 1 with flow_export_invalid and no unhandled stack trace
  const res = runCli(['--verify', v2Path, '--repo-root', dir]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^flow_export_invalid:.*autopilot\.fleet-flow\/2/);
  assert.doesNotMatch(res.stderr, /Error:\s*\n\s*at /);
});
