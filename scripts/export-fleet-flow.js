#!/usr/bin/env node
'use strict';

/**
 * export-fleet-flow.js — derive references/fleet-flow-graph.json (schema autopilot.fleet-flow/1)
 * from its four generator inputs:
 *   1. references/stage-graph.json
 *   2. references/fleet-flow-evidence.json
 *   3. scripts/stage-advance.js (COARSE_OF_NODE)
 *   4. scripts/export-fleet-flow.js (the exporter itself)
 * plus the canonical plugin version.
 *
 * Usage:
 *   node scripts/export-fleet-flow.js [--repo-root <dir>]                        # write references/fleet-flow-graph.json
 *   node scripts/export-fleet-flow.js --check [--pin <pin>] [--repo-root <dir>]  # verify pin inputs clean (if --pin), regenerate in memory, byte-compare
 *   node scripts/export-fleet-flow.js --verify <file> [--repo-root <dir>]        # validate format & schema, regenerate in memory, byte-compare
 *
 * Canonical form: UTF-8, LF, keys sorted recursively, compact separators (`canonicalJson`).
 * `export_sha256` = sha256 of canonical form with `export_sha256` omitted (convenience for diffing only,
 * never used as the staleness check; staleness = in-memory regeneration byte-compared with the file).
 * Written file is that canonical form (with `export_sha256` included and sorted in place) plus a trailing LF.
 *
 * Exit codes:
 *   0 = written / check clean / verify valid
 *   1 = --check drift/dirty (`flow_export_stale: ...` / `flow_export_invalid: ...`), or --verify stale/invalid
 *   2 = CLI usage or missing/unreadable repo source files
 *
 * Node >= 20.10, built-ins only.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vm = require('vm');
const { createRequire } = require('module');
const { TextDecoder } = require('util');
const { buildWalk } = require('./stage-graph.js');
const { COARSE_OF_NODE } = require('./stage-advance.js');
const { canonical, preflightJsonSource, validateJsonSchema } = require('./validate-json-schema.js');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const EXPORT_SCHEMA = 'autopilot.fleet-flow/1';
const EVIDENCE_SCHEMA = 'autopilot.fleet-flow-evidence/1';
const SCHEMA_REL = path.join('schemas', 'fleet-flow.schema.json');
const STAGE_GRAPH_REL = path.join('references', 'stage-graph.json');
const EVIDENCE_REL = path.join('references', 'fleet-flow-evidence.json');
const STAGE_ADVANCE_REL = path.join('scripts', 'stage-advance.js');
const EXPORTER_REL = path.join('scripts', 'export-fleet-flow.js');
const EXPORT_REL = path.join('references', 'fleet-flow-graph.json');
const FOUR_INPUT_RELS = Object.freeze([
  STAGE_GRAPH_REL,
  EVIDENCE_REL,
  STAGE_ADVANCE_REL,
  EXPORTER_REL,
]);
const CANONICAL_SIZE_ORDER = Object.freeze(['XS', 'S', 'M', 'L', 'XL']);

function sha256Hex(bytesOrString) {
  return crypto.createHash('sha256').update(bytesOrString).digest('hex');
}

function canonicalJson(value) {
  return canonical(value);
}

function readAutopilotVersion(repoRoot) {
  const candidates = [
    path.join(repoRoot, '.claude-plugin', 'plugin.json'),
    path.join(repoRoot, '.codex-plugin', 'plugin.json'),
    path.join(repoRoot, 'plugin.json'),
    path.join(repoRoot, 'package.json'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    if (parsed && typeof parsed.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  }
  throw new Error(`cannot resolve autopilot version under ${repoRoot}`);
}

function loadSchema(repoRoot) {
  const candidate = path.join(repoRoot, SCHEMA_REL);
  const schemaPath = fs.existsSync(candidate)
    ? candidate
    : path.join(DEFAULT_REPO_ROOT, SCHEMA_REL);
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function buildEvidenceInputSchema(fullSchema) {
  return {
    $schema: fullSchema.$schema,
    $defs: fullSchema.$defs,
    $ref: '#/$defs/evidence_input',
  };
}

function readEvidenceDoc(repoRoot, fullSchema) {
  const evidencePath = path.join(repoRoot, EVIDENCE_REL);
  const evidenceBytes = fs.readFileSync(evidencePath);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(evidenceBytes);
  preflightJsonSource(text, EVIDENCE_REL);
  const doc = JSON.parse(text);
  const inputSchema = buildEvidenceInputSchema(fullSchema || loadSchema(repoRoot));
  const check = validateJsonSchema(inputSchema, doc);
  if (!check.valid) {
    throw new Error(`${EVIDENCE_REL} failed schema validation: ${check.errors.join('; ')}`);
  }
  return { doc, bytes: evidenceBytes };
}

function loadCoarseOfNode(repoRoot, stageAdvanceBytes) {
  const candidatePath = path.join(repoRoot, STAGE_ADVANCE_REL);
  if (path.resolve(candidatePath) === path.resolve(__dirname, 'stage-advance.js')) {
    return COARSE_OF_NODE;
  }

  const source = stageAdvanceBytes.toString('utf8');
  const literalMatch = /const\s+COARSE_OF_NODE\s*=\s*Object\.freeze\(\s*(\{[\s\S]*?\})\s*\)\s*;/u.exec(source);
  if (literalMatch) {
    const evaluated = vm.runInNewContext(`(${literalMatch[1]})`, Object.create(null));
    if (evaluated && typeof evaluated === 'object' && !Array.isArray(evaluated)) {
      return Object.freeze({ ...evaluated });
    }
  }

  const req = createRequire(candidatePath);
  const loaded = req(candidatePath);
  if (!loaded || !loaded.COARSE_OF_NODE || typeof loaded.COARSE_OF_NODE !== 'object') {
    throw new Error(`cannot load COARSE_OF_NODE from ${candidatePath}`);
  }
  return loaded.COARSE_OF_NODE;
}

function sizesContainingNode(graph, nodeId) {
  const matched = [];
  const sizeKeys = [
    ...CANONICAL_SIZE_ORDER.filter((s) => Object.prototype.hasOwnProperty.call(graph.sizes, s)),
    ...Object.keys(graph.sizes).filter((s) => !CANONICAL_SIZE_ORDER.includes(s)),
  ];
  for (const size of sizeKeys) {
    const cfg = graph.sizes[size];
    const hasOptionalResearch = Array.isArray(cfg?.base)
      && cfg.base.some((item) => item && typeof item === 'object' && item.optional === 'research');
    const researchOptions = hasOptionalResearch ? [false, true] : [false];
    let found = false;
    for (const bug of [false, true]) {
      for (const urgent of [false, true]) {
        for (const explore of [false, true]) {
          for (const research of researchOptions) {
            const w = buildWalk(graph, {
              size,
              bug,
              urgent,
              highRisk: false,
              research,
              explore,
              units: 1,
            });
            if (w.nodes.includes(nodeId)) {
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
      }
      if (found) break;
    }
    if (found) matched.push(size);
  }
  return matched;
}

function buildEvidenceRows(graph, evidenceDoc) {
  const sourceDoc = evidenceDoc
    || readEvidenceDoc(DEFAULT_REPO_ROOT, loadSchema(DEFAULT_REPO_ROOT)).doc;
  if (!sourceDoc || sourceDoc.schema !== EVIDENCE_SCHEMA || !Array.isArray(sourceDoc.rules)) {
    throw new Error(`invalid evidence rules document (expected schema ${EVIDENCE_SCHEMA})`);
  }

  return sourceDoc.rules.map((rule) => {
    let sizes;
    if (typeof rule.sizes_from_node === 'string') {
      if (!Array.isArray(graph.node_ids) || !graph.node_ids.includes(rule.sizes_from_node)) {
        throw new Error(`evidence rule "${rule.event}" references unknown node "${rule.sizes_from_node}"`);
      }
      sizes = sizesContainingNode(graph, rule.sizes_from_node);
      if (sizes.length === 0) {
        throw new Error(`evidence rule "${rule.event}" sizes_from_node "${rule.sizes_from_node}" matched no sizes`);
      }
    } else if (Array.isArray(rule.sizes)) {
      sizes = [...rule.sizes];
    } else {
      throw new Error(`evidence rule "${rule.event}" must specify sizes or sizes_from_node`);
    }

    const out = {
      event: rule.event,
      sizes,
      derivation_id: rule.derivation_id,
      codes: [...rule.codes],
    };
    if (rule.urgent_low_timing !== undefined) {
      out.urgent_low_timing = rule.urgent_low_timing;
    }
    if (rule.urgent_low_codes !== undefined) {
      out.urgent_low_codes = [...rule.urgent_low_codes];
    }
    return out;
  });
}

function buildSizesMap(graph) {
  const sizesOut = {};
  for (const size of Object.keys(graph.sizes)) {
    const cfg = graph.sizes[size];
    const hasOptionalResearch = Array.isArray(cfg.base)
      && cfg.base.some((item) => item && typeof item === 'object' && item.optional === 'research');
    const researchOptions = hasOptionalResearch ? [false, true] : [false];

    const variants = [];
    for (const bug of [false, true]) {
      for (const urgent of [false, true]) {
        for (const explore of [false, true]) {
          for (const research of researchOptions) {
            const w = buildWalk(graph, {
              size,
              bug,
              urgent,
              highRisk: false,
              research,
              explore,
              units: 1,
            });
            variants.push({
              bug,
              urgent,
              explore,
              research,
              urgent_low: Boolean(w.urgentLow),
              nodes: w.nodes,
              walk: w.walk,
              entry: w.entry,
              terminal: w.terminal,
              unit_kind: w.unit_kind,
            });
          }
        }
      }
    }
    sizesOut[size] = variants;
  }
  return sizesOut;
}

function computeExportSha256(docWithoutChecksum) {
  const copy = { ...docWithoutChecksum };
  delete copy.export_sha256;
  return sha256Hex(Buffer.from(canonicalJson(copy), 'utf8'));
}

function readInputFileBytes(repoRoot, relPath) {
  const candidate = path.join(repoRoot, relPath);
  if (!fs.existsSync(candidate)) {
    throw new Error(`missing required generator input ${relPath} under ${repoRoot}`);
  }
  return fs.readFileSync(candidate);
}

function buildExportObject(repoRoot = DEFAULT_REPO_ROOT) {
  const fullSchema = loadSchema(repoRoot);
  const stageGraphBytes = readInputFileBytes(repoRoot, STAGE_GRAPH_REL);
  const { doc: evidenceDoc, bytes: evidenceBytes } = readEvidenceDoc(repoRoot, fullSchema);
  const stageAdvanceBytes = readInputFileBytes(repoRoot, STAGE_ADVANCE_REL);
  const exporterBytes = readInputFileBytes(repoRoot, EXPORTER_REL);

  const stageGraphText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(stageGraphBytes);
  preflightJsonSource(stageGraphText, STAGE_GRAPH_REL);
  const graph = JSON.parse(stageGraphText);
  const autopilotVersion = readAutopilotVersion(repoRoot);
  const coarseSource = loadCoarseOfNode(repoRoot, stageAdvanceBytes);

  const coarseMap = {};
  for (const nodeId of graph.node_ids) {
    if (!Object.prototype.hasOwnProperty.call(coarseSource, nodeId)) {
      throw new Error(`COARSE_OF_NODE missing mapping for node "${nodeId}"`);
    }
    coarseMap[nodeId] = coarseSource[nodeId];
  }

  const baseDoc = {
    schema: EXPORT_SCHEMA,
    graph_schema: graph.schema,
    autopilot_version: autopilotVersion,
    source_sha256: {
      stage_graph: sha256Hex(stageGraphBytes),
      evidence: sha256Hex(evidenceBytes),
      stage_advance: sha256Hex(stageAdvanceBytes),
      exporter: sha256Hex(exporterBytes),
    },
    sizes: buildSizesMap(graph),
    loop_backs: graph.loop_backs,
    bump_limits: graph.bump_limits,
    evidence: buildEvidenceRows(graph, evidenceDoc),
    coarse_of_node: coarseMap,
  };

  const exportSha = computeExportSha256(baseDoc);
  return {
    ...baseDoc,
    export_sha256: exportSha,
  };
}

function serializeExport(doc) {
  return `${canonicalJson(doc)}\n`;
}

function verifyPinInputsClean(repoRoot, pinArg) {
  let dirExists = false;
  try {
    dirExists = fs.statSync(pinArg).isDirectory();
  } catch {
    dirExists = false;
  }

  let checkRoot = repoRoot;
  let commitRef = pinArg;
  if (dirExists) {
    checkRoot = path.resolve(pinArg);
    commitRef = 'HEAD';
  }

  for (const rel of FOUR_INPUT_RELS) {
    if (!fs.existsSync(path.join(checkRoot, rel))) {
      return {
        ok: false,
        code: 'flow_export_invalid',
        reason: `missing input ${rel} under ${checkRoot}`,
      };
    }
  }

  const topRes = spawnSync('git', ['-C', checkRoot, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (topRes.error || topRes.status !== 0) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `cannot resolve git worktree at ${checkRoot}: ${(topRes.stderr || topRes.error?.message || '').trim()}`,
    };
  }
  const gitTop = topRes.stdout.trim();
  const relPrefix = path.relative(gitTop, checkRoot);
  if (relPrefix.startsWith('..') || path.isAbsolute(relPrefix)) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `${checkRoot} is outside git toplevel ${gitTop}`,
    };
  }
  const gitPaths = FOUR_INPUT_RELS.map((rel) => (
    relPrefix ? path.posix.join(relPrefix.split(path.sep).join('/'), rel.split(path.sep).join('/')) : rel.split(path.sep).join('/')
  ));

  const revRes = spawnSync('git', ['-C', gitTop, 'rev-parse', '--verify', '--quiet', `${commitRef}^{commit}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (revRes.error || revRes.status !== 0) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `invalid pin "${pinArg}": cannot resolve commit ${commitRef} in ${gitTop}`,
    };
  }

  const diffRes = spawnSync('git', ['-C', gitTop, 'diff', '--quiet', commitRef, '--', ...gitPaths], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (diffRes.error) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `git diff failed: ${diffRes.error.message}`,
    };
  }
  if (diffRes.status === 1) {
    return {
      ok: false,
      code: 'flow_export_stale',
      reason: `generator inputs dirty against pin ${pinArg} (${FOUR_INPUT_RELS.join(', ')})`,
    };
  }
  if (diffRes.status !== 0) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `git diff exited ${diffRes.status}: ${(diffRes.stderr || '').trim()}`,
    };
  }

  const untrackedRes = spawnSync(
    'git',
    ['-C', gitTop, 'ls-files', '--others', '--exclude-standard', '--', ...gitPaths],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (untrackedRes.error || untrackedRes.status !== 0) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `git ls-files failed: ${(untrackedRes.stderr || untrackedRes.error?.message || '').trim()}`,
    };
  }
  if ((untrackedRes.stdout || '').trim() !== '') {
    return {
      ok: false,
      code: 'flow_export_stale',
      reason: `untracked generator input under pin ${pinArg}: ${untrackedRes.stdout.trim().split('\n').join(', ')}`,
    };
  }

  return { ok: true, effectiveRoot: checkRoot };
}

function verifyExportFile(filePath, repoRoot = DEFAULT_REPO_ROOT) {
  let rawBytes;
  try {
    rawBytes = fs.readFileSync(filePath);
  } catch (err) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `cannot read export file: ${err.message}`,
    };
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBytes);
  } catch (err) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `invalid UTF-8: ${err.message}`,
    };
  }

  if (text.includes('\r')) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: 'CR line endings are not allowed in canonical export',
    };
  }

  let doc;
  try {
    preflightJsonSource(text, 'fleet-flow export');
    doc = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `malformed JSON: ${err.message}`,
    };
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: 'root value must be a JSON object',
    };
  }

  if (doc.schema !== EXPORT_SCHEMA) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `unsupported schema "${String(doc.schema)}" (expected ${EXPORT_SCHEMA})`,
    };
  }

  let schema;
  try {
    schema = loadSchema(repoRoot);
  } catch (err) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `cannot load validation schema: ${err.message}`,
    };
  }

  let schemaCheck;
  try {
    schemaCheck = validateJsonSchema(schema, doc);
  } catch (err) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `schema validation error: ${err.message}`,
    };
  }
  if (!schemaCheck.valid) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `schema violation: ${schemaCheck.errors.join('; ')}`,
    };
  }

  const canonicalForm = serializeExport(doc);
  if (text !== canonicalForm) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: 'file is not in canonical sorted compact LF form',
    };
  }

  const recomputedSelfSha = computeExportSha256(doc);
  if (doc.export_sha256 !== recomputedSelfSha) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `export_sha256 mismatch (recorded ${doc.export_sha256}, recomputed ${recomputedSelfSha})`,
    };
  }

  let expectedDoc;
  let expectedBytes;
  try {
    expectedDoc = buildExportObject(repoRoot);
    expectedBytes = Buffer.from(serializeExport(expectedDoc), 'utf8');
  } catch (err) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `cannot regenerate export from sources under ${repoRoot}: ${err.message}`,
    };
  }

  if (!rawBytes.equals(expectedBytes)) {
    const details = [];
    for (const key of ['stage_graph', 'evidence', 'stage_advance', 'exporter']) {
      if (doc.source_sha256?.[key] !== expectedDoc.source_sha256[key]) {
        details.push(`source_sha256.${key} ${doc.source_sha256?.[key]} != current ${expectedDoc.source_sha256[key]}`);
      }
    }
    if (doc.autopilot_version !== expectedDoc.autopilot_version) {
      details.push(`autopilot_version "${doc.autopilot_version}" != current "${expectedDoc.autopilot_version}"`);
    }
    const why = details.length > 0
      ? details.join('; ')
      : 'regenerated canonical bytes differ from export file';
    return {
      ok: false,
      code: 'flow_export_stale',
      reason: why,
    };
  }

  return { ok: true, code: null, reason: null };
}

function parseArgs(argv) {
  const opts = {
    mode: 'write',
    repoRoot: DEFAULT_REPO_ROOT,
    repoRootExplicit: false,
    pin: null,
    verifyFile: null,
    help: false,
  };
  let modeCount = 0;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--check') {
      opts.mode = 'check';
      modeCount += 1;
    } else if (arg === '--pin') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('--pin requires a <pin> argument');
      }
      opts.pin = argv[++i];
    } else if (arg === '--verify') {
      if (i + 1 >= argv.length) {
        throw new Error('--verify requires a <file> argument');
      }
      opts.mode = 'verify';
      opts.verifyFile = argv[++i];
      modeCount += 1;
    } else if (arg === '--repo-root') {
      if (i + 1 >= argv.length) {
        throw new Error('--repo-root requires a <dir> argument');
      }
      opts.repoRoot = path.resolve(argv[++i]);
      opts.repoRootExplicit = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (modeCount > 1) {
    throw new Error('--check and --verify are mutually exclusive');
  }
  if (opts.pin !== null && opts.mode !== 'check') {
    throw new Error('--pin is only supported with --check');
  }
  return opts;
}

function printUsage() {
  process.stdout.write(
    'Usage:\n'
    + '  node scripts/export-fleet-flow.js [--repo-root <dir>]\n'
    + '  node scripts/export-fleet-flow.js --check [--pin <pin>] [--repo-root <dir>]\n'
    + '  node scripts/export-fleet-flow.js --verify <file> [--repo-root <dir>]\n',
  );
}

function runCli(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`export-fleet-flow: ${err.message}\n`);
    return 2;
  }

  if (opts.help) {
    printUsage();
    return 0;
  }

  if (opts.mode === 'verify') {
    let res;
    try {
      res = verifyExportFile(path.resolve(opts.verifyFile), opts.repoRoot);
    } catch (err) {
      res = { ok: false, code: 'flow_export_invalid', reason: err.message };
    }
    if (res.ok) return 0;
    process.stderr.write(`${res.code}: ${res.reason}\n`);
    return 1;
  }

  let effectiveRoot = opts.repoRoot;
  if (opts.mode === 'check' && opts.pin !== null) {
    const pinCheck = verifyPinInputsClean(opts.repoRoot, opts.pin);
    if (!pinCheck.ok) {
      process.stderr.write(`${pinCheck.code}: ${pinCheck.reason}\n`);
      return 1;
    }
    if (!opts.repoRootExplicit) {
      effectiveRoot = pinCheck.effectiveRoot;
    }
  }

  if (opts.mode === 'check') {
    const targetPath = path.join(effectiveRoot, EXPORT_REL);
    if (!fs.existsSync(targetPath)) {
      process.stderr.write(`flow_export_invalid: missing ${EXPORT_REL} (run node scripts/export-fleet-flow.js)\n`);
      return 1;
    }
    const res = verifyExportFile(targetPath, effectiveRoot);
    if (res.ok) return 0;
    process.stderr.write(`${res.code}: ${res.reason}\n`);
    return 1;
  }

  let doc;
  let expectedBytes;
  try {
    doc = buildExportObject(effectiveRoot);
    const schema = loadSchema(effectiveRoot);
    const check = validateJsonSchema(schema, doc);
    if (!check.valid) {
      process.stderr.write(`export-fleet-flow: generated document failed schema: ${check.errors.join('; ')}\n`);
      return 1;
    }
    expectedBytes = Buffer.from(serializeExport(doc), 'utf8');
  } catch (err) {
    process.stderr.write(`export-fleet-flow: ${err.message}\n`);
    return 2;
  }

  const targetPath = path.join(effectiveRoot, EXPORT_REL);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, expectedBytes);
  fs.renameSync(tmpPath, targetPath);
  return 0;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}

module.exports = {
  EVIDENCE_SCHEMA,
  EXPORT_SCHEMA,
  FOUR_INPUT_RELS,
  buildEvidenceRows,
  buildExportObject,
  buildSizesMap,
  canonicalJson,
  computeExportSha256,
  readAutopilotVersion,
  readEvidenceDoc,
  runCli,
  serializeExport,
  verifyExportFile,
  verifyPinInputsClean,
};
