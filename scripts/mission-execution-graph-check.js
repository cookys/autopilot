#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  checkMissionGraphCoverage,
} = require('../src/engine/mission-execution-graph');
const { resolveMissionPolicy } = require('../src/engine/mission-policy');

function usage() {
  return [
    'Usage:',
    '  mission-execution-graph-check.js --graph <json> --governance <json>',
    '    --sources <frozen-source-manifest.json>',
  ].join('\n');
}

function parse(argv) {
  const options = {};
  const allowed = new Map([
    ['--graph', 'graph'],
    ['--governance', 'governance'],
    ['--sources', 'sources'],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = allowed.get(argv[index]);
    if (!key || argv[index + 1] === undefined) throw new Error(`invalid argument: ${argv[index] || ''}`);
    options[key] = argv[index + 1];
  }
  if (!options.graph || !options.governance || !options.sources) {
    throw new Error('--graph, --governance, and --sources are required');
  }
  return options;
}

function readJson(file, label) {
  const target = path.resolve(file);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid readable JSON: ${error.message}`);
  }
  return value;
}

function sha256(bytes) {
  return require('crypto').createHash('sha256').update(bytes).digest('hex');
}

function contentBoundRubricId(planHash, rubricHash, rubricId) {
  const digest = sha256(`${planHash}:${rubricHash}:${rubricId}`);
  return `R${BigInt(`0x${digest}`).toString(10)}`;
}

function loadSourceCoverageManifest(manifestPath) {
  let canonicalManifest;
  try {
    canonicalManifest = fs.realpathSync(manifestPath);
  } catch (error) {
    throw new Error(`source manifest is not readable: ${error.message}`);
  }
  const manifest = readJson(canonicalManifest, 'source manifest');
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.sources)
      || manifest.sources.length === 0
      || Object.keys(manifest).some((key) => !new Set(['schema_version', 'sources']).has(key))) {
    throw new Error('source manifest must be a versioned non-empty source set');
  }
  const root = path.dirname(canonicalManifest);
  const planIds = [];
  const rubricIds = [];
  const authoringUnitIds = [];
  const seenRealTargets = new Set();
  for (const [index, source] of manifest.sources.entries()) {
    if (!source || typeof source !== 'object' || Array.isArray(source)
        || Object.keys(source).some((key) => !new Set([
          'plan_path',
          'rubric_path',
          'plan_sha256',
          'rubric_sha256',
        ]).has(key))) {
      throw new Error(`source manifest.sources[${index}] is invalid`);
    }
    for (const field of ['plan_path', 'rubric_path', 'plan_sha256', 'rubric_sha256']) {
      if (typeof source[field] !== 'string' || source[field].length === 0) {
        throw new Error(`source manifest.sources[${index}].${field} is required`);
      }
    }
    const planPath = path.resolve(root, source.plan_path);
    const rubricPath = path.resolve(root, source.rubric_path);
    for (const [field, authored, resolved] of [
      ['plan_path', source.plan_path, planPath],
      ['rubric_path', source.rubric_path, rubricPath],
    ]) {
      if (path.isAbsolute(authored) || authored.includes('\\')
          || resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`source manifest.sources[${index}].${field} must stay under the manifest root`);
      }
    }
    const canonicalTargets = [];
    for (const [field, target] of [['plan_path', planPath], ['rubric_path', rubricPath]]) {
      let targetStat;
      let canonicalTarget;
      try {
        targetStat = fs.lstatSync(target);
        canonicalTarget = fs.realpathSync(target);
      } catch (error) {
        throw new Error(`source manifest.sources[${index}].${field} is not readable`);
      }
      if (!targetStat.isFile() && !targetStat.isSymbolicLink()) {
        throw new Error(`source manifest.sources[${index}].${field} must resolve to a regular file`);
      }
      if (!canonicalTarget.startsWith(`${root}${path.sep}`)) {
        throw new Error(`source manifest.sources[${index}].${field} escapes the source manifest root`);
      }
      if (!fs.statSync(canonicalTarget).isFile()) {
        throw new Error(`source manifest.sources[${index}].${field} must resolve to a regular file`);
      }
      if (seenRealTargets.has(canonicalTarget)) {
        throw new Error('source manifest real targets must be unique');
      }
      seenRealTargets.add(canonicalTarget);
      canonicalTargets.push(canonicalTarget);
    }
    const planBytes = fs.readFileSync(canonicalTargets[0]);
    const rubricBytes = fs.readFileSync(canonicalTargets[1]);
    const planHash = sha256(planBytes);
    const rubricHash = sha256(rubricBytes);
    if (planHash !== source.plan_sha256 || rubricHash !== source.rubric_sha256) {
      throw new Error(`source manifest.sources[${index}] content digest drifted`);
    }
    const planId = `plan-${planHash}`;
    planIds.push(planId);
    for (const [lineIndex, line] of planBytes.toString('utf8').split(/\r?\n/).entries()) {
      if (/^#{2,6}\s+(?:(?:Phase)\s*[0-9]+|P[0-9]+)(?:\s|[-—:·（(]|$)/i.test(line)) {
        authoringUnitIds.push(`u-${sha256(`${planHash}:${lineIndex + 1}:${line}`)}`);
      }
    }
    const rubricTokens = [];
    for (const line of rubricBytes.toString('utf8').split(/\r?\n/)) {
      const heading = line.match(/^#{2,6}\s+(R[0-9]+)(?:\s|$)/);
      const bullet = line.match(/^\s*-\s+(R[0-9]+)\s*:/);
      const plain = line.match(/^\s*(R[0-9]+)\s*:/);
      if (heading) rubricTokens.push(heading[1]);
      if (bullet) rubricTokens.push(bullet[1]);
      if (plain) rubricTokens.push(plain[1]);
    }
    if (rubricTokens.length === 0) throw new Error(`source manifest.sources[${index}] has no rubric IDs`);
    if (new Set(rubricTokens).size !== rubricTokens.length) {
      throw new Error(`source manifest.sources[${index}] has duplicate rubric IDs`);
    }
    rubricIds.push(...rubricTokens.map((rubricId) => (
      contentBoundRubricId(planHash, rubricHash, rubricId)
    )));
  }
  if (new Set(planIds).size !== planIds.length) throw new Error('source manifest has duplicate plan content');
  return {
    planIds: planIds.sort(),
    rubricIds: rubricIds.sort(),
    authoringUnitIds: authoringUnitIds.sort(),
  };
}

function inspect(options) {
  const governance = readJson(options.governance, 'governance');
  const graph = readJson(options.graph, 'graph');
  const missionPolicy = resolveMissionPolicy(governance);
  const coverage = loadSourceCoverageManifest(options.sources);
  const result = checkMissionGraphCoverage(graph, coverage, missionPolicy);
  const reservationTotals = Object.fromEntries([
    'campaigns',
    'wall_seconds',
    'tool_calls',
    'engine_attempts',
    'external_wait_seconds',
    'canonical_changed_files',
    'output_bytes',
  ].map((field) => [
    field,
    result.graph.nodes.reduce((total, node) => total + node.reservation[field], 0),
  ]));
  return {
    status: 'READY',
    policy_digest: missionPolicy.policy_digest,
    graph_digest: result.graph_digest,
    deliverables: result.graph.nodes.length,
    calculated_depth: result.calculated_depth,
    calculated_batches: result.calculated_batches,
    reservation_totals: reservationTotals,
    coverage: result.coverage ? {
      ...result.coverage,
      authoring_unit_count: coverage.authoringUnitIds.length,
      authoring_unit_ids: coverage.authoringUnitIds,
    } : null,
  };
}

function main() {
  try {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(inspect(parse(process.argv.slice(2))))}\n`);
  } catch (error) {
    process.stderr.write(`mission-execution-graph-check: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { contentBoundRubricId, inspect, loadSourceCoverageManifest };
