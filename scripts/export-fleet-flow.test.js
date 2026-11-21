'use strict';

/**
 * Tests for scripts/export-fleet-flow.js + references/fleet-flow-evidence.json + schemas/fleet-flow.schema.json.
 * Run:
 *   unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID
 *   node scripts/export-fleet-flow.test.js < /dev/null
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
const EVIDENCE_PATH = path.join(REPO_ROOT, 'references', 'fleet-flow-evidence.json');
const STAGE_ADVANCE_PATH = path.join(REPO_ROOT, 'scripts', 'stage-advance.js');
const VALIDATE_JSON_SCHEMA_PATH = path.join(REPO_ROOT, 'scripts', 'validate-json-schema.js');
const STAGE_GRAPH_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'stage-graph.js');
const EXPORT_PATH = path.join(REPO_ROOT, 'references', 'fleet-flow-graph.json');
const PLUGIN_JSON_PATH = path.join(REPO_ROOT, '.claude-plugin', 'plugin.json');

const { validateJsonSchema, readJson, canonical } = require('./validate-json-schema.js');
const {
  EVIDENCE_SCHEMA,
  EXPORT_SCHEMA,
  FOUR_INPUT_RELS,
  buildExportObject,
  computeExportSha256,
  readEvidenceDoc,
  serializeExport,
  verifyExportFile,
} = require('./export-fleet-flow.js');
const { COARSE_OF_NODE } = require('./stage-advance.js');
const { buildWalk } = require('./stage-graph.js');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'export-fleet-flow-test-'));
test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function runCli(args, cliPath = CLI) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function makeTempRepoCopy(name, { initGit = false } = {}) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'schemas'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });

  fs.copyFileSync(STAGE_GRAPH_PATH, path.join(dir, 'references', 'stage-graph.json'));
  fs.copyFileSync(EVIDENCE_PATH, path.join(dir, 'references', 'fleet-flow-evidence.json'));
  fs.copyFileSync(SCHEMA_PATH, path.join(dir, 'schemas', 'fleet-flow.schema.json'));
  fs.copyFileSync(PLUGIN_JSON_PATH, path.join(dir, '.claude-plugin', 'plugin.json'));
  fs.copyFileSync(STAGE_ADVANCE_PATH, path.join(dir, 'scripts', 'stage-advance.js'));
  fs.copyFileSync(CLI, path.join(dir, 'scripts', 'export-fleet-flow.js'));
  fs.copyFileSync(VALIDATE_JSON_SCHEMA_PATH, path.join(dir, 'scripts', 'validate-json-schema.js'));
  fs.copyFileSync(STAGE_GRAPH_SCRIPT_PATH, path.join(dir, 'scripts', 'stage-graph.js'));
  if (fs.existsSync(EXPORT_PATH)) {
    fs.copyFileSync(EXPORT_PATH, path.join(dir, 'references', 'fleet-flow-graph.json'));
  }

  if (initGit) {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
    assert.equal(spawnSync('git', ['add', '.'], { cwd: dir }).status, 0);
    assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'init'], { cwd: dir }).status, 0);
  }
  return dir;
}

test('committed references/fleet-flow-evidence.json and references/fleet-flow-graph.json validate against schema and cover all four source_sha256 inputs', () => {
  assert.equal(fs.existsSync(EVIDENCE_PATH), true, 'references/fleet-flow-evidence.json must exist');
  assert.equal(fs.existsSync(EXPORT_PATH), true, 'references/fleet-flow-graph.json must exist');

  const schema = readJson(SCHEMA_PATH, 'fleet-flow.schema.json');
  const { doc: evDoc } = readEvidenceDoc(REPO_ROOT, schema);
  assert.equal(evDoc.schema, EVIDENCE_SCHEMA);
  assert.equal(Array.isArray(evDoc.rules) && evDoc.rules.length >= 7, true);

  const rawText = fs.readFileSync(EXPORT_PATH, 'utf8');
  assert.equal(rawText.includes('\r'), false, 'must use LF only');
  assert.equal(rawText.endsWith('\n'), true, 'must end with trailing newline');
  assert.equal(rawText.split('\n').length, 2, 'canonical compact form is one JSON line + trailing newline');

  const doc = readJson(EXPORT_PATH, 'fleet-flow-graph.json');
  const validation = validateJsonSchema(schema, doc);
  assert.equal(validation.valid, true, `schema errors: ${validation.errors.join('; ')}`);

  assert.equal(doc.schema, EXPORT_SCHEMA);
  assert.equal(rawText, `${canonical(doc)}\n`, 'file bytes must match canonical sorted JSON + LF');

  // source_sha256 covers all four generator inputs
  assert.deepEqual(Object.keys(doc.source_sha256).sort(), ['evidence', 'exporter', 'stage_advance', 'stage_graph']);
  assert.equal(doc.source_sha256.stage_graph, sha256File(STAGE_GRAPH_PATH));
  assert.equal(doc.source_sha256.evidence, sha256File(EVIDENCE_PATH));
  assert.equal(doc.source_sha256.stage_advance, sha256File(STAGE_ADVANCE_PATH));
  assert.equal(doc.source_sha256.exporter, sha256File(CLI));

  // export_sha256 matches canonical form without export_sha256
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

test('negative control (1): removing an evidence rule (in evidence JSON copy or export with recomputed export_sha256) is caught as flow_export_stale, then green on regeneration', () => {
  const repo = makeTempRepoCopy('nc1-evidence-rule');
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);

  const exportFile = path.join(repo, 'references', 'fleet-flow-graph.json');

  // Part A: delete one evidence rule from the export and recompute export_sha256 (self-consistent checksum)
  const tamperedExport = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  assert.equal(tamperedExport.evidence.length > 1, true);
  tamperedExport.evidence = tamperedExport.evidence.slice(0, -1);
  tamperedExport.export_sha256 = computeExportSha256(tamperedExport);
  fs.writeFileSync(exportFile, serializeExport(tamperedExport), 'utf8');

  const checkTampered = runCli(['--check', '--repo-root', repo]);
  assert.equal(checkTampered.status, 1);
  assert.match(checkTampered.stderr, /^flow_export_stale:/);

  const verifyTampered = runCli(['--verify', exportFile, '--repo-root', repo]);
  assert.equal(verifyTampered.status, 1);
  assert.match(verifyTampered.stderr, /^flow_export_stale:/);

  // Restore clean export before Part B
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);

  // Part B: remove an evidence rule from the evidence JSON copy without regenerating -> stale
  const evFile = path.join(repo, 'references', 'fleet-flow-evidence.json');
  const ev = JSON.parse(fs.readFileSync(evFile, 'utf8'));
  ev.rules = ev.rules.slice(0, -1);
  fs.writeFileSync(evFile, `${JSON.stringify(ev, null, 2)}\n`, 'utf8');

  const checkEvDrift = runCli(['--check', '--repo-root', repo]);
  assert.equal(checkEvDrift.status, 1);
  assert.match(checkEvDrift.stderr, /^flow_export_stale:.*source_sha256\.evidence/);

  const verifyEvDrift = runCli(['--verify', exportFile, '--repo-root', repo]);
  assert.equal(verifyEvDrift.status, 1);
  assert.match(verifyEvDrift.stderr, /^flow_export_stale:.*source_sha256\.evidence/);

  // Regenerating turns --check and --verify green again
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);
  assert.equal(runCli(['--verify', exportFile, '--repo-root', repo]).status, 0);
});

test('negative control (2): older export with valid checksum after COARSE_OF_NODE changed in stage-advance.js copy (stage-graph.json unchanged) reports flow_export_stale, then green on regeneration', () => {
  const repo = makeTempRepoCopy('nc2-coarse-of-node');
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  const exportFile = path.join(repo, 'references', 'fleet-flow-graph.json');
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);

  const sgBefore = sha256File(path.join(repo, 'references', 'stage-graph.json'));

  // Change COARSE_OF_NODE in stage-advance.js copy while stage-graph.json stays byte-identical
  const saFile = path.join(repo, 'scripts', 'stage-advance.js');
  const saSrc = fs.readFileSync(saFile, 'utf8');
  const updatedSaSrc = saSrc.replace("finish: 'merged',", "finish: 'shipped',");
  assert.notEqual(updatedSaSrc, saSrc, 'COARSE_OF_NODE replacement must change stage-advance.js');
  fs.writeFileSync(saFile, updatedSaSrc, 'utf8');

  assert.equal(sha256File(path.join(repo, 'references', 'stage-graph.json')), sgBefore);

  // Older export still has a valid self-checksum, yet --check and --verify fail with flow_export_stale
  const checkStale = runCli(['--check', '--repo-root', repo]);
  assert.equal(checkStale.status, 1);
  assert.match(checkStale.stderr, /^flow_export_stale:.*source_sha256\.stage_advance/);

  const verifyStale = runCli(['--verify', exportFile, '--repo-root', repo]);
  assert.equal(verifyStale.status, 1);
  assert.match(verifyStale.stderr, /^flow_export_stale:.*source_sha256\.stage_advance/);

  // Regenerating picks up the new COARSE_OF_NODE and turns green
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  const regenerated = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  assert.equal(regenerated.coarse_of_node.finish, 'shipped');
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);
  assert.equal(runCli(['--verify', exportFile, '--repo-root', repo]).status, 0);
});

test('negative control (3): editing a copy of stage-graph.json without regenerating makes --check exit 1 with flow_export_stale (one stderr line), then green on regeneration', () => {
  const repo = makeTempRepoCopy('nc3-stage-graph-drift');
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
  assert.match(stderrLines[0], /^flow_export_stale:.*source_sha256\.stage_graph/);

  // Regenerating turns --check green again
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);
});

test('--check --pin <pin> requires the four input paths clean at <pin> and byte-compares regeneration; unknown argument exits 2', () => {
  const repo = makeTempRepoCopy('pin-check', { initGit: true });

  // Generate clean export and commit only if anything changed so pin is clean
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  const statusPorcelain = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  if (statusPorcelain) {
    assert.equal(spawnSync('git', ['add', '.'], { cwd: repo }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-q', '-m', 'regen export'], { cwd: repo }).status, 0);
  }
  const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();

  // Clean pin passes both with directory path (<pin> as dir) and commit ref (<pin> as sha with --repo-root)
  const cleanDirPin = runCli(['--check', '--pin', repo]);
  assert.equal(cleanDirPin.status, 0, `dir pin stderr: ${cleanDirPin.stderr}`);

  const cleanShaPin = runCli(['--check', '--pin', headSha, '--repo-root', repo]);
  assert.equal(cleanShaPin.status, 0, `sha pin stderr: ${cleanShaPin.stderr}`);

  // Dirty one of the four input paths AND even regenerate the export so byte-compare alone would pass:
  // --check --pin must STILL fail because git diff --quiet <pin> -- <paths> is dirty!
  const evFile = path.join(repo, 'references', 'fleet-flow-evidence.json');
  const origEv = fs.readFileSync(evFile, 'utf8');
  const mutatedEv = JSON.parse(origEv);
  mutatedEv.rules[0].codes.push('extra_dirty_code');
  fs.writeFileSync(evFile, `${JSON.stringify(mutatedEv, null, 2)}\n`, 'utf8');
  assert.equal(runCli(['--repo-root', repo]).status, 0);

  // Without --pin, in-memory regeneration matches the regenerated file; WITH --pin, dirty input fails!
  assert.equal(runCli(['--check', '--repo-root', repo]).status, 0);

  const dirtyDirPin = runCli(['--check', '--pin', repo]);
  assert.equal(dirtyDirPin.status, 1);
  assert.match(dirtyDirPin.stderr, /^flow_export_stale:.*dirty against pin/);

  const dirtyShaPin = runCli(['--check', '--pin', headSha, '--repo-root', repo]);
  assert.equal(dirtyShaPin.status, 1);
  assert.match(dirtyShaPin.stderr, /^flow_export_stale:.*dirty against pin/);

  // Restore clean tree -> --check --pin green again
  fs.writeFileSync(evFile, origEv, 'utf8');
  assert.equal(runCli(['--repo-root', repo]).status, 0);
  assert.equal(runCli(['--check', '--pin', repo]).status, 0);
  assert.equal(FOUR_INPUT_RELS.length, 4);

  // Unknown argument stays exit 2
  const unknownArg = runCli(['--check', '--bogus-flag']);
  assert.equal(unknownArg.status, 2);
  assert.match(unknownArg.stderr, /unknown argument/);

  // --pin without value or without --check exits 2
  assert.equal(runCli(['--check', '--pin']).status, 2);
  assert.equal(runCli(['--pin', repo]).status, 2);
});

test('negative control: invalid evidence JSON fails schema validation and exits 2 on generate', () => {
  const repo = makeTempRepoCopy('bad-evidence-schema');
  const evFile = path.join(repo, 'references', 'fleet-flow-evidence.json');
  fs.writeFileSync(evFile, JSON.stringify({ schema: EVIDENCE_SCHEMA, rules: [{ event: 'x', codes: ['BAD-UPPER'], derivation_id: 'ok', sizes: ['M'] }] }), 'utf8');

  const genRes = runCli(['--repo-root', repo]);
  assert.equal(genRes.status, 2);
  assert.match(genRes.stderr, /failed schema validation/);
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

  const direct = verifyExportFile(v2Path, dir);
  assert.equal(direct.ok, false);
  assert.equal(direct.code, 'flow_export_invalid');
  assert.match(direct.reason, /autopilot\.fleet-flow\/2/);

  const res = runCli(['--verify', v2Path, '--repo-root', dir]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^flow_export_invalid:.*autopilot\.fleet-flow\/2/);
  assert.doesNotMatch(res.stderr, /Error:\s*\n\s*at /);
});
