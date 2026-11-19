#!/usr/bin/env node
'use strict';

/**
 * export-fleet-flow.js — derive references/fleet-flow-graph.json (schema autopilot.fleet-flow/1)
 * from references/stage-graph.json, COARSE_OF_NODE (stage-advance.js), and plugin version.
 *
 * Usage:
 *   node scripts/export-fleet-flow.js [--repo-root <dir>]              # write references/fleet-flow-graph.json
 *   node scripts/export-fleet-flow.js --check [--repo-root <dir>]      # byte-compare in-memory regeneration with file; exit 1 on drift
 *   node scripts/export-fleet-flow.js --verify <file> [--repo-root <dir>] # validate checksum, source sha256, version & schema; exit 0 or 1
 *
 * Canonical form: UTF-8, LF, keys sorted recursively, compact separators (`canonicalJson`).
 * `export_sha256` = sha256 of canonical form with `export_sha256` omitted.
 * Written file is that canonical form (with `export_sha256` included and sorted in place) plus a trailing LF.
 *
 * Exit codes:
 *   0 = written / check clean / verify valid
 *   1 = --check drift, or --verify stale/invalid (`flow_export_stale: ...` or `flow_export_invalid: ...`)
 *   2 = CLI usage or missing/unreadable repo source files
 *
 * Node >= 20.10, built-ins only.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildWalk } = require('./stage-graph.js');
const { COARSE_OF_NODE } = require('./stage-advance.js');
const { canonical, preflightJsonSource, validateJsonSchema } = require('./validate-json-schema.js');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const EXPORT_SCHEMA = 'autopilot.fleet-flow/1';
const SCHEMA_REL = path.join('schemas', 'fleet-flow.schema.json');
const STAGE_GRAPH_REL = path.join('references', 'stage-graph.json');
const EXPORT_REL = path.join('references', 'fleet-flow-graph.json');

function sha256Hex(bytesOrString) {
  return crypto.createHash('sha256').update(bytesOrString).digest('hex');
}

function canonicalJson(value) {
  return canonical(value);
}

function readAutopilotVersion(repoRoot) {
  const candidates = [
    path.join(repoRoot, '.claude-plugin', 'plugin.json'),
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

function buildEvidenceRows(graph) {
  const hasMPlanReview = Array.isArray(graph.sizes?.M?.base)
    && graph.sizes.M.base.includes('plan-review');
  const planReviewSizes = hasMPlanReview ? ['M', 'L', 'XL'] : ['L', 'XL'];

  return [
    {
      event: 'leaving:plan',
      sizes: ['M', 'L', 'XL'],
      derivation_id: 'plan_blob',
      codes: ['plan_receipt_required', 'plan_blob_missing', 'plan_not_first'],
    },
    {
      event: 'leaving:plan-review',
      sizes: planReviewSizes,
      derivation_id: 'plan_review_receipt',
      codes: ['plan_review_required'],
    },
    {
      event: 'leaving:code-review',
      sizes: ['M', 'L', 'XL'],
      derivation_id: 'code_review_receipt',
      codes: ['code_review_receipt_missing'],
      urgent_low_timing: 'after_finish',
    },
    {
      event: 'leaving:qc-gate',
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
      derivation_id: 'stage_order_only',
      codes: [],
    },
    {
      event: 'finish:merge_sha',
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
      derivation_id: 'merge_ancestry_and_tip',
      codes: ['merge_not_on_target', 'merge_not_reviewed_tip'],
    },
    {
      event: 'finish:qc_receipt',
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
      derivation_id: 'qc_verdict_trailer',
      codes: ['qc_trailer_missing', 'qc_verdict_not_pass'],
    },
    {
      event: 'finish:used',
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
      derivation_id: 'used_line_policy',
      codes: ['used_na_not_allowed', 'used_evidence_empty'],
    },
  ];
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

function buildExportObject(repoRoot = DEFAULT_REPO_ROOT) {
  const stageGraphPath = path.join(repoRoot, STAGE_GRAPH_REL);
  const stageGraphBytes = fs.readFileSync(stageGraphPath);
  const graph = JSON.parse(stageGraphBytes.toString('utf8'));
  const autopilotVersion = readAutopilotVersion(repoRoot);

  const coarseMap = {};
  for (const nodeId of graph.node_ids) {
    if (!Object.prototype.hasOwnProperty.call(COARSE_OF_NODE, nodeId)) {
      throw new Error(`COARSE_OF_NODE missing mapping for node "${nodeId}"`);
    }
    coarseMap[nodeId] = COARSE_OF_NODE[nodeId];
  }

  const baseDoc = {
    schema: EXPORT_SCHEMA,
    graph_schema: graph.schema,
    autopilot_version: autopilotVersion,
    source_sha256: {
      stage_graph: sha256Hex(stageGraphBytes),
    },
    sizes: buildSizesMap(graph),
    loop_backs: graph.loop_backs,
    bump_limits: graph.bump_limits,
    evidence: buildEvidenceRows(graph),
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

function loadSchema(repoRoot) {
  const candidate = path.join(repoRoot, SCHEMA_REL);
  const schemaPath = fs.existsSync(candidate)
    ? candidate
    : path.join(DEFAULT_REPO_ROOT, SCHEMA_REL);
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
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

  const expectedCanonical = serializeExport(doc);
  if (text !== expectedCanonical) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: 'file is not in canonical sorted compact LF form',
    };
  }

  const recomputedSha = computeExportSha256(doc);
  if (doc.export_sha256 !== recomputedSha) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `export_sha256 mismatch (recorded ${doc.export_sha256}, recomputed ${recomputedSha})`,
    };
  }

  let currentStageGraphSha;
  let currentVersion;
  try {
    const stageGraphBytes = fs.readFileSync(path.join(repoRoot, STAGE_GRAPH_REL));
    currentStageGraphSha = sha256Hex(stageGraphBytes);
    currentVersion = readAutopilotVersion(repoRoot);
  } catch (err) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `cannot read repo sources under ${repoRoot}: ${err.message}`,
    };
  }

  if (doc.source_sha256?.stage_graph !== currentStageGraphSha) {
    return {
      ok: false,
      code: 'flow_export_stale',
      reason: `source_sha256.stage_graph ${doc.source_sha256?.stage_graph} != current ${currentStageGraphSha}`,
    };
  }

  if (doc.autopilot_version !== currentVersion) {
    return {
      ok: false,
      code: 'flow_export_stale',
      reason: `autopilot_version "${doc.autopilot_version}" != current "${currentVersion}"`,
    };
  }

  let expectedDoc;
  try {
    expectedDoc = buildExportObject(repoRoot);
  } catch (err) {
    return {
      ok: false,
      code: 'flow_export_invalid',
      reason: `cannot build expected export under ${repoRoot}: ${err.message}`,
    };
  }

  if (doc.export_sha256 !== expectedDoc.export_sha256) {
    return {
      ok: false,
      code: 'flow_export_stale',
      reason: `export content drifted from current repo sources (export_sha256 ${doc.export_sha256} != expected ${expectedDoc.export_sha256})`,
    };
  }

  return { ok: true, code: null, reason: null };
}

function parseArgs(argv) {
  const opts = {
    mode: 'write',
    repoRoot: DEFAULT_REPO_ROOT,
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
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (modeCount > 1) {
    throw new Error('--check and --verify are mutually exclusive');
  }
  return opts;
}

function printUsage() {
  process.stdout.write(
    'Usage:\n'
    + '  node scripts/export-fleet-flow.js [--repo-root <dir>]\n'
    + '  node scripts/export-fleet-flow.js --check [--repo-root <dir>]\n'
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

  let doc;
  let expectedBytes;
  try {
    doc = buildExportObject(opts.repoRoot);
    const schema = loadSchema(opts.repoRoot);
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

  const targetPath = path.join(opts.repoRoot, EXPORT_REL);

  if (opts.mode === 'check') {
    if (!fs.existsSync(targetPath)) {
      process.stderr.write(`export-fleet-flow: missing ${EXPORT_REL} (run node scripts/export-fleet-flow.js)\n`);
      return 1;
    }
    let actualBytes;
    try {
      actualBytes = fs.readFileSync(targetPath);
    } catch (err) {
      process.stderr.write(`export-fleet-flow: cannot read ${EXPORT_REL}: ${err.message}\n`);
      return 1;
    }
    if (!actualBytes.equals(expectedBytes)) {
      process.stderr.write(`export-fleet-flow: ${EXPORT_REL} drifted from references/stage-graph.json (run node scripts/export-fleet-flow.js)\n`);
      return 1;
    }
    return 0;
  }

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
  EXPORT_SCHEMA,
  buildEvidenceRows,
  buildExportObject,
  buildSizesMap,
  canonicalJson,
  computeExportSha256,
  readAutopilotVersion,
  runCli,
  serializeExport,
  verifyExportFile,
};
