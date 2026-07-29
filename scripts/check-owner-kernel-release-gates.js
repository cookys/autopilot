#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');
const {
  normalizeWitnessBinding,
  verifyReceiptShape,
} = require('../src/engine/owner-kernel/witness');

const USAGE = `Usage:
  node scripts/check-owner-kernel-release-gates.js --project <project-dir> [--repo-root <dir>] [--check]

Reports mechanical KR8, KR10, and alias-retirement readiness. With --check, exits
non-zero when disposition is HOLD. Never redefines KR metrics or fabricates
elapsed production telemetry.`;

const KR8_DEFINITION = Object.freeze({
  id: 'KR8',
  text: 'zero observed false acceptance, zero observed missed red-line escalation, and at least 30% fewer mandatory model-review dispatches than the P0 legacy baseline of 6',
  baseline_mandatory_model_review_dispatches: 6,
  min_reduction_ratio: 0.3,
});

const KR10_DEFINITION = Object.freeze({
  id: 'KR10',
  text: 'executed post-P3 load-bearing surface count must be strictly below both the legacy baseline (42) and the projected post-P3 target (51)',
  baseline_surface_count: 42,
  projected_post_p3_surface_count: 51,
});

const ALIAS_DEFINITION = Object.freeze({
  id: 'alias_retirement',
  text: 'aliases /l3-/l6 may be removed only after one shipped compatibility cycle and 14 complete witnessed production days with zero translation_used events, zero unresolved translation deltas, and a deterministic scan confirming callers migrated',
  required_witnessed_days: 14,
  levels: ['l3', 'l4', 'l5', 'l6'],
});

const FROZEN_SURFACE_ENUMERATION = Object.freeze({
  skills: Object.freeze([
    'l5', 'ceo-agent', 'dev-flow', 'finish-flow', 'quality-pipeline',
  ]),
  scripts: Object.freeze([
    'resolve-review-loop.sh',
    'dispatch-hetero.sh',
    'dispatch-review.sh',
    'run-ledger.sh',
    'lib/worktree-reap.sh',
    'lib/json-emit.sh',
    'load-endpoints-env.sh',
    'lib/prune-tmp-residue.sh',
    'lib/output-quiescence.sh',
    'lib/dispatch-detach.sh',
    'dispatch-status.js',
    'dispatch-contract.js',
    'check-disjointness.sh',
    'engine-scorecard.js',
    'session-mode.js',
    'watch-foreman.js',
    'resolve-dispatch.sh',
    'check-loop-convergence.js',
    'reap-dispatch-branches.sh',
    'probe-diff-domain.sh',
    'owner-kernel.js',
  ]),
  engine_modules: Object.freeze([
    'autopilot-engine.js',
    'index.js',
    'resolve-review-loop.js',
    path.join('..', 'runners', 'implementer.js'),
    path.join('..', 'runners', 'review.js'),
    path.join('owner-kernel', 'index.js'),
    path.join('owner-kernel', 'policy.js'),
    path.join('owner-kernel', 'events.js'),
    path.join('owner-kernel', 'state.js'),
    path.join('owner-kernel', 'kernel.js'),
    path.join('owner-kernel', 'acceptance.js'),
    path.join('owner-kernel', 'actions.js'),
    path.join('owner-kernel', 'compatibility.js'),
    'supervised-owner-kernel-installed-engine.js',
  ]),
  schemas: Object.freeze([
    'dispatch-unit-contract.schema.json',
    'review-loop-contract.schema.json',
    'owner-event.schema.json',
  ]),
  hooks_default_on: Object.freeze([
    'audit-log',
    'failure-escalation',
    'intent-capture',
    'log-error',
    'reload-watch',
    'session-handoff',
    'session-start',
    'state-checkpoint',
    'suggest-compact',
    'version-drift-check',
  ]),
});

function fail(message, exitCode = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    project: null,
    repoRoot: path.resolve(__dirname, '..'),
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg === '--project' || arg === '--repo-root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(`missing value for ${arg}`);
      if (arg === '--project') options.project = value;
      else options.repoRoot = path.resolve(value);
      index += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  if (!options.project) fail(`missing required --project <project-dir>\n${USAGE}`);
  return options;
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function resolveProjectDir(repoRoot, projectArg) {
  const candidates = [
    path.resolve(projectArg),
    path.resolve(repoRoot, projectArg),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  fail(`project directory not found: ${projectArg}`);
}

function isNonEmptySha256(value) {
  return typeof value === 'string'
    && /^[a-f0-9]{64}$/i.test(value)
    && value !== '0'.repeat(64)
    && value !== 'f'.repeat(64);
}

function measureSkillMember(repoRoot, name) {
  const skillPath = path.join(repoRoot, 'skills', name, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    return { ok: false, error: `skills/${name}/SKILL.md missing` };
  }
  let body;
  try {
    body = fs.readFileSync(skillPath, 'utf8');
  } catch (error) {
    return { ok: false, error: `skills/${name} read failed: ${error.message}` };
  }
  if (!body.includes('name:') && !body.startsWith('---')) {
    return { ok: false, error: `skills/${name} SKILL.md failed frontmatter parse` };
  }
  if (!body.includes(name) && !/name:\s*[^\n]+/.test(body)) {
    return { ok: false, error: `skills/${name} SKILL.md missing name field evidence` };
  }
  return { ok: true };
}

function measureScriptMember(repoRoot, name) {
  const scriptPath = path.join(repoRoot, 'scripts', name);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `scripts/${name} missing` };
  }
  let body;
  try {
    body = fs.readFileSync(scriptPath, 'utf8');
  } catch (error) {
    return { ok: false, error: `scripts/${name} read failed: ${error.message}` };
  }
  if (body.length < 8) {
    return { ok: false, error: `scripts/${name} empty or unparseable` };
  }
  if (name.endsWith('.js')) {
    const checked = spawnSync(process.execPath, ['--check', scriptPath], {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    if (checked.error) {
      return { ok: false, error: `scripts/${name} execution check failed: ${checked.error.message}` };
    }
    if (checked.status !== 0) {
      return {
        ok: false,
        error: `scripts/${name} parse/execution evidence failed (exit ${checked.status})`,
      };
    }
  } else if (name.endsWith('.sh') || name.endsWith('.py') || !path.extname(name)) {
    if (!body.startsWith('#!') && !body.includes('set -') && !body.includes('#!/')) {
      if (body.trim().length < 16) {
        return { ok: false, error: `scripts/${name} failed measurement (too short)` };
      }
    }
  }
  return { ok: true };
}

function measureEngineMember(repoRoot, name) {
  const modulePath = path.join(repoRoot, 'src', 'engine', name);
  if (!fs.existsSync(modulePath)) {
    return { ok: false, error: `src/engine/${name} missing` };
  }
  try {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    const loaded = require(modulePath);
    if (loaded == null || (typeof loaded !== 'object' && typeof loaded !== 'function')) {
      return { ok: false, error: `src/engine/${name} loaded empty module` };
    }
  } catch (error) {
    return { ok: false, error: `src/engine/${name} require/parse failed: ${error.message}` };
  }
  return { ok: true };
}

function measureSchemaMember(repoRoot, name) {
  const schemaPath = path.join(repoRoot, 'schemas', name);
  if (!fs.existsSync(schemaPath)) {
    return { ok: false, error: `schemas/${name} missing` };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: `schemas/${name} parsed to non-object` };
    }
  } catch (error) {
    return { ok: false, error: `schemas/${name} JSON parse failed: ${error.message}` };
  }
  return { ok: true };
}

function countExecutedLoadBearingSurfaces(repoRoot) {
  const measurementErrors = [];

  const skillEvidence = [];
  for (const name of FROZEN_SURFACE_ENUMERATION.skills) {
    const result = measureSkillMember(repoRoot, name);
    if (!result.ok) measurementErrors.push(result.error);
    else skillEvidence.push(name);
  }
  const skillsEntry = skillEvidence.length;
  const skillsExpected = FROZEN_SURFACE_ENUMERATION.skills.length;
  if (skillsEntry !== skillsExpected) {
    measurementErrors.push(
      `skills membership incomplete after per-member evidence: ${skillsEntry}/${skillsExpected}`,
    );
  }

  const scriptEvidence = [];
  for (const name of FROZEN_SURFACE_ENUMERATION.scripts) {
    const result = measureScriptMember(repoRoot, name);
    if (!result.ok) measurementErrors.push(result.error);
    else scriptEvidence.push(name);
  }
  const scripts = scriptEvidence.length;
  const scriptsExpected = FROZEN_SURFACE_ENUMERATION.scripts.length;
  if (scripts !== scriptsExpected) {
    measurementErrors.push(
      `scripts membership incomplete after per-member evidence: ${scripts}/${scriptsExpected}`,
    );
  }

  const engineEvidence = [];
  for (const name of FROZEN_SURFACE_ENUMERATION.engine_modules) {
    const result = measureEngineMember(repoRoot, name);
    if (!result.ok) measurementErrors.push(result.error);
    else engineEvidence.push(name);
  }
  const engineModules = engineEvidence.length;
  const engineExpected = FROZEN_SURFACE_ENUMERATION.engine_modules.length;
  if (engineModules !== engineExpected) {
    measurementErrors.push(
      `engine module membership incomplete after per-member evidence: `
      + `${engineModules}/${engineExpected}`,
    );
  }

  const installedEnginePath = path.join(
    repoRoot,
    'src',
    'engine',
    'supervised-owner-kernel-installed-engine.js',
  );
  let includesInstalledEngine = false;
  if (!fs.existsSync(installedEnginePath)) {
    measurementErrors.push(
      'installed-engine surface bucket missing: supervised-owner-kernel-installed-engine.js',
    );
  } else {
    const installedMeasure = measureEngineMember(
      repoRoot,
      'supervised-owner-kernel-installed-engine.js',
    );
    if (!installedMeasure.ok) {
      measurementErrors.push(
        `installed-engine measurement failed: ${installedMeasure.error}`,
      );
    } else {
      try {
        const installed = require(installedEnginePath);
        if (installed.INSTALLED_ENGINE_SINK_ID !== 'engine-implementation-dispatch-v1') {
          measurementErrors.push(
            'installed-engine surface failed export measurement for fixed sink id',
          );
        } else {
          includesInstalledEngine = true;
        }
      } catch (error) {
        measurementErrors.push(
          `installed-engine export measurement failed: ${error.message}`,
        );
      }
    }
  }

  const schemaEvidence = [];
  for (const name of FROZEN_SURFACE_ENUMERATION.schemas) {
    const result = measureSchemaMember(repoRoot, name);
    if (!result.ok) measurementErrors.push(result.error);
    else schemaEvidence.push(name);
  }
  const schemas = schemaEvidence.length;
  const schemasExpected = FROZEN_SURFACE_ENUMERATION.schemas.length;
  if (schemas !== schemasExpected) {
    measurementErrors.push(
      `schemas membership incomplete after per-member evidence: ${schemas}/${schemasExpected}`,
    );
  }

  const frozenHooks = FROZEN_SURFACE_ENUMERATION.hooks_default_on;
  const hookEvidence = [];
  for (const name of frozenHooks) {
    const jsPath = path.join(repoRoot, 'hooks', `${name}.js`);
    const shPath = path.join(repoRoot, 'hooks', `${name}.sh`);
    const hookPath = fs.existsSync(jsPath) ? jsPath : (fs.existsSync(shPath) ? shPath : null);
    if (!hookPath) {
      measurementErrors.push(`hooks/${name} missing (frozen default-on membership)`);
      continue;
    }
    let body;
    try {
      body = fs.readFileSync(hookPath, 'utf8');
    } catch (error) {
      measurementErrors.push(`hooks/${name} read failed: ${error.message}`);
      continue;
    }
    if (!body || body.trim().length < 8) {
      measurementErrors.push(`hooks/${name} failed parse evidence: empty or trivial body`);
      continue;
    }
    if (hookPath.endsWith('.js')) {
      const parsed = spawnSync(
        process.execPath,
        ['--check', hookPath],
        { encoding: 'utf8', cwd: repoRoot },
      );
      if (parsed.error || parsed.status !== 0) {
        measurementErrors.push(
          `hooks/${name} execution/parse evidence failed: `
          + `${parsed.error ? parsed.error.message : (parsed.stderr || 'syntax check failed')}`,
        );
        continue;
      }
    } else if (!/^#!/.test(body)) {
      measurementErrors.push(`hooks/${name} shell hook missing shebang parse evidence`);
      continue;
    }
    hookEvidence.push(name);
  }
  let hooks = null;
  const hooksExpected = frozenHooks.length;
  if (hookEvidence.length !== hooksExpected) {
    measurementErrors.push(
      `hooks membership incomplete after per-member evidence: `
      + `${hookEvidence.length}/${hooksExpected}`,
    );
  }
  const inventoryScript = path.join(repoRoot, 'scripts', 'check-hook-inventory.js');
  if (!fs.existsSync(inventoryScript)) {
    measurementErrors.push('hooks surface bucket measurement failure: check-hook-inventory.js is missing');
  } else {
    const inventory = spawnSync(
      process.execPath,
      [inventoryScript],
      { encoding: 'utf8', cwd: repoRoot },
    );
    if (inventory.error) {
      measurementErrors.push(`hooks measurement failure: execution failed: ${inventory.error.message}`);
    } else if (inventory.status !== 0) {
      measurementErrors.push(
        `hooks measurement failure: inventory exited ${inventory.status}; HOLD`,
      );
    } else if (!inventory.stdout) {
      measurementErrors.push('hooks measurement failure: empty stdout; HOLD');
    } else {
      const match = inventory.stdout.match(
        /default-on\s*\((\d+)\)\s*:\s*([^\n]+)/i,
      ) || inventory.stdout.match(
        /default-on[^\d]*(\d+)[^\n:]*:\s*([^\n]+)/i,
      );
      if (!match) {
        measurementErrors.push(
          'hooks measurement failure: parse failed for default-on membership; HOLD',
        );
      } else {
        const inventoryCount = Number(match[1]);
        const inventoryMembers = match[2]
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .sort();
        const expectedSorted = [...frozenHooks].sort();
        if (inventoryCount !== hooksExpected
          || canonicalJson(inventoryMembers) !== canonicalJson(expectedSorted)) {
          measurementErrors.push(
            'hooks inventory membership does not match frozen exact default-on membership; HOLD',
          );
        } else if (hookEvidence.length === hooksExpected) {
          hooks = hooksExpected;
        }
      }
    }
  }

  const total = measurementErrors.length === 0
    && skillsEntry === skillsExpected
    && scripts === scriptsExpected
    && engineModules === engineExpected
    && schemas === schemasExpected
    && hooks != null
    && hooks === hooksExpected
    && hookEvidence.length === hooksExpected
    && includesInstalledEngine
    ? skillsEntry + scripts + engineModules + schemas + hooks
    : null;

  return {
    skills: skillsEntry,
    scripts,
    engine_modules: engineModules,
    schemas,
    hooks_default_on: hooks,
    total,
    measurement_errors: measurementErrors,
    method: 'frozen complete surface enumeration including supervised-owner-kernel-installed-engine.js; exact membership + per-member execution/parsing/measurement evidence required for every bucket including hooks; count equality alone is invalid; no KR redefinition; no hooks=10 substitution',
    includes_installed_engine_module: includesInstalledEngine,
    frozen_membership: {
      skills: [...FROZEN_SURFACE_ENUMERATION.skills],
      scripts: [...FROZEN_SURFACE_ENUMERATION.scripts],
      engine_modules: [...FROZEN_SURFACE_ENUMERATION.engine_modules],
      schemas: [...FROZEN_SURFACE_ENUMERATION.schemas],
      hooks_default_on: [...frozenHooks],
    },
    measured_membership: {
      skills: skillEvidence,
      scripts: scriptEvidence,
      engine_modules: engineEvidence,
      schemas: schemaEvidence,
      hooks_default_on: hookEvidence,
    },
    bucket_completeness: {
      skills: skillsEntry === skillsExpected && skillEvidence.length === skillsExpected,
      scripts: scripts === scriptsExpected && scriptEvidence.length === scriptsExpected,
      engine_modules: engineModules === engineExpected && engineEvidence.length === engineExpected,
      schemas: schemas === schemasExpected && schemaEvidence.length === schemasExpected,
      hooks: hooks != null && hookEvidence.length === hooksExpected,
      installed_engine: includesInstalledEngine,
    },
  };
}

function loadKr8Evidence(projectDir) {
  const reasons = [];
  const productionTelemetryPaths = [
    path.join(projectDir, 'p3', 'production-telemetry', 'kr8.json'),
    path.join(projectDir, 'production-telemetry', 'kr8.json'),
    path.join(projectDir, 'p3', 'dogfood', 'kr8.json'),
  ];
  for (const candidate of productionTelemetryPaths) {
    const data = readJsonIfExists(candidate);
    if (data) {
      const reportedBaseline = data.baseline_mandatory_review_dispatches;
      if (reportedBaseline != null
        && Number(reportedBaseline) !== KR8_DEFINITION.baseline_mandatory_model_review_dispatches) {
        reasons.push(
          `production telemetry baseline_mandatory_review_dispatches=${reportedBaseline} `
          + `conflicts with frozen KR8 baseline ${KR8_DEFINITION.baseline_mandatory_model_review_dispatches}; `
          + 'conflicting baseline is a blocker and must never replace the frozen baseline',
        );
      }
      return {
        source: 'production_telemetry',
        path: path.relative(projectDir, candidate),
        observed_false_acceptances: Number(data.observed_false_acceptances),
        observed_missed_red_line_escalations: Number(data.observed_missed_red_line_escalations),
        baseline_mandatory_review_dispatches:
          KR8_DEFINITION.baseline_mandatory_model_review_dispatches,
        candidate_mandatory_review_dispatches: Number(data.candidate_mandatory_review_dispatches),
        telemetry_reported_baseline: reportedBaseline == null ? null : Number(reportedBaseline),
        reasons,
      };
    }
  }

  const spikeSummary = readJsonIfExists(path.join(
    projectDir,
    'p0',
    'spike',
    'evidence-2026-07-23-hardened-r2',
    'run',
    'summaries',
    'acceptance.json',
  ));
  if (spikeSummary) {
    reasons.push(
      'only fixture/spike KR8 evidence is present; production installed dogfood telemetry is required for release',
    );
    return {
      source: 'fixture_spike_not_production',
      path: 'p0/spike/evidence-2026-07-23-hardened-r2/run/summaries/acceptance.json',
      observed_false_acceptances: Number(spikeSummary.observed_false_acceptances),
      observed_missed_red_line_escalations: Number(spikeSummary.observed_missed_red_line_escalations),
      baseline_mandatory_review_dispatches:
        KR8_DEFINITION.baseline_mandatory_model_review_dispatches,
      candidate_mandatory_review_dispatches: Number(
        spikeSummary.candidate_mandatory_review_dispatches,
      ),
      telemetry_reported_baseline: null,
      reasons,
    };
  }

  reasons.push('no KR8 evidence file found under production or spike paths');
  return {
    source: 'missing',
    path: null,
    observed_false_acceptances: null,
    observed_missed_red_line_escalations: null,
    baseline_mandatory_review_dispatches: KR8_DEFINITION.baseline_mandatory_model_review_dispatches,
    candidate_mandatory_review_dispatches: null,
    telemetry_reported_baseline: null,
    reasons,
  };
}

function evaluateKr8(evidence) {
  const blocking = [...evidence.reasons];
  let status = 'HOLD';
  let reduction = null;
  const baseline = KR8_DEFINITION.baseline_mandatory_model_review_dispatches;
  if (evidence.baseline_mandatory_review_dispatches !== baseline) {
    blocking.push(
      `KR8 baseline must remain frozen at ${baseline}; got ${evidence.baseline_mandatory_review_dispatches}`,
    );
  }
  if (evidence.source === 'missing') {
    blocking.push('KR8 cannot pass without mechanical evidence');
  } else if (evidence.source === 'fixture_spike_not_production') {
    if (Number.isFinite(evidence.candidate_mandatory_review_dispatches) && baseline > 0) {
      reduction = 1 - (evidence.candidate_mandatory_review_dispatches / baseline);
    }
    blocking.push('KR8 fixture arithmetic is not production telemetry and cannot fund release');
  } else {
    const falseOk = evidence.observed_false_acceptances === 0;
    const missedOk = evidence.observed_missed_red_line_escalations === 0;
    if (!falseOk) blocking.push(`observed_false_acceptances=${evidence.observed_false_acceptances}`);
    if (!missedOk) {
      blocking.push(
        `observed_missed_red_line_escalations=${evidence.observed_missed_red_line_escalations}`,
      );
    }
    if (!Number.isFinite(evidence.candidate_mandatory_review_dispatches) || baseline <= 0) {
      blocking.push('mandatory model-review dispatch counts are incomplete');
    } else {
      reduction = 1 - (evidence.candidate_mandatory_review_dispatches / baseline);
      if (reduction < KR8_DEFINITION.min_reduction_ratio) {
        blocking.push(
          `mandatory model-review reduction ${(reduction * 100).toFixed(1)}% is below 30%`,
        );
      }
    }
    if (blocking.length === 0) status = 'PASS';
  }
  return {
    id: 'KR8',
    definition: KR8_DEFINITION,
    evidence,
    reduction_ratio: reduction,
    status,
    blocking_reasons: blocking,
  };
}

function evaluateKr10(surface) {
  const blocking = [];
  if (surface.measurement_errors && surface.measurement_errors.length > 0) {
    for (const error of surface.measurement_errors) {
      blocking.push(`KR10 measurement failure: ${error}`);
    }
    return {
      id: 'KR10',
      definition: KR10_DEFINITION,
      measured_surface: surface,
      status: 'HOLD',
      blocking_reasons: blocking,
    };
  }
  if (!surface.includes_installed_engine_module) {
    blocking.push(
      'KR10 frozen enumeration must include supervised-owner-kernel-installed-engine.js',
    );
  }
  const measured = surface.total;
  if (!Number.isFinite(measured)) {
    blocking.push('KR10 measured surface total is not finite; HOLD without substitution');
  } else {
    if (!(measured < KR10_DEFINITION.baseline_surface_count)) {
      blocking.push(
        `measured surface count ${measured} is not strictly below baseline ${KR10_DEFINITION.baseline_surface_count}`,
      );
    }
    if (!(measured < KR10_DEFINITION.projected_post_p3_surface_count)) {
      blocking.push(
        `measured surface count ${measured} is not strictly below projected ${KR10_DEFINITION.projected_post_p3_surface_count}`,
      );
    }
    if (measured >= KR10_DEFINITION.baseline_surface_count) {
      blocking.push(
        'KR10 remains the executed-module cardinality gate; definition is not revised after measurement',
      );
    }
  }
  return {
    id: 'KR10',
    definition: KR10_DEFINITION,
    measured_surface: surface,
    status: blocking.length === 0 ? 'PASS' : 'HOLD',
    blocking_reasons: blocking,
  };
}

function evaluateAliasRetirement(repoRoot, projectDir) {
  const blocking = [];
  const present = [];
  const missing = [];
  for (const level of ALIAS_DEFINITION.levels) {
    const skillPath = path.join(repoRoot, 'skills', level, 'SKILL.md');
    if (fs.existsSync(skillPath)) present.push(level);
    else missing.push(level);
  }
  const nonblockingNotes = [];
  if (missing.length > 0) {
    nonblockingNotes.push(
      `compatibility aliases missing (informational): ${missing.join(',')}`,
    );
  } else {
    nonblockingNotes.push(
      'compatibility aliases /l3-/l6 are still present (nonblocking; deletion not authorized yet)',
    );
  }

  const productionTelemetry = readJsonIfExists(path.join(
    projectDir,
    'p3',
    'production-telemetry',
    'alias-retirement.json',
  )) || readJsonIfExists(path.join(
    projectDir,
    'production-telemetry',
    'alias-retirement.json',
  ));

  let witnessedDays = 0;
  let translationUsed = null;
  let unresolvedDeltas = null;
  let telemetrySource = 'missing';
  let shippedCompatibilityCycle = false;
  let deterministicCallerMigration = false;
  let dayRecords = null;

  if (productionTelemetry) {
    telemetrySource = 'production_telemetry';
    witnessedDays = Number(productionTelemetry.witnessed_zero_use_days || 0);
    translationUsed = Number(productionTelemetry.translation_used_events ?? NaN);
    unresolvedDeltas = Number(productionTelemetry.unresolved_translation_deltas ?? NaN);

    const cycleId = productionTelemetry.compatibility_cycle_id;
    const cycleReceipt = productionTelemetry.compatibility_cycle_ship_receipt;
    const cycleReceiptBody = productionTelemetry.compatibility_cycle_receipt_body;
    const cycleSignerBinding = productionTelemetry.compatibility_cycle_signer_binding;
    let cycleReceiptBound = false;
    let signerBinding = null;
    if (typeof cycleId === 'string'
      && /^[a-z0-9][a-z0-9._-]{2,128}$/i.test(cycleId)
      && cycleReceiptBody && typeof cycleReceiptBody === 'object'
      && !Array.isArray(cycleReceiptBody)
      && cycleReceiptBody.compatibility_cycle_id === cycleId
      && cycleReceipt && typeof cycleReceipt === 'object'
      && !Array.isArray(cycleReceipt)
      && cycleSignerBinding && typeof cycleSignerBinding === 'object') {
      try {
        signerBinding = normalizeWitnessBinding(cycleSignerBinding);
        verifyReceiptShape(cycleReceipt);
        if (cycleReceipt.stream_id
          && typeof cycleReceipt.stream_id === 'string'
          && cycleReceipt.stream_id.includes(signerBinding.identity)
          && isNonEmptySha256(cycleReceipt.witness_head)
          && isNonEmptySha256(cycleReceipt.event_hash)
          && productionTelemetry.shipped_compatibility_cycle === true) {
          const selfBodyHash = sha256(canonicalJson(cycleReceiptBody));
          const selfSignatureMaterial = sha256(canonicalJson({
            receipt_hash: selfBodyHash,
            body_hash: selfBodyHash,
            compatibility_cycle_id: cycleId,
          }));
          if (cycleReceipt.event_hash.toLowerCase() === selfBodyHash.toLowerCase()
            || cycleReceipt.witness_head.toLowerCase() === selfBodyHash.toLowerCase()
            || cycleReceipt.event_hash.toLowerCase() === selfSignatureMaterial.toLowerCase()) {
            cycleReceiptBound = false;
          } else {
            cycleReceiptBound = true;
          }
        }
      } catch (_error) {
        cycleReceiptBound = false;
      }
    }
    shippedCompatibilityCycle = cycleReceiptBound;
    if (!shippedCompatibilityCycle) {
      blocking.push(
        'shipped compatibility cycle evidence missing or incomplete '
        + '(require authoritative signer_binding via normalizeWitnessBinding + '
        + 'compatibility_cycle_ship_receipt verified by verifyReceiptShape bound to that signer; '
        + 'reject self-computable shaped hashes and self-asserted booleans)',
      );
    }

    const migrationHash = productionTelemetry.caller_migration_scan_hash;
    const migrationBody = productionTelemetry.caller_migration_scan_body;
    let migrationBound = false;
    if (migrationBody && typeof migrationBody === 'object' && !Array.isArray(migrationBody)
      && isNonEmptySha256(migrationHash)
      && migrationBody.complete === true
      && Array.isArray(migrationBody.callers_migrated)) {
      migrationBound = sha256(canonicalJson(migrationBody)).toLowerCase()
        === migrationHash.toLowerCase();
    }
    deterministicCallerMigration = productionTelemetry.deterministic_caller_migration === true
      && productionTelemetry.caller_migration_complete === true
      && migrationBound;
    if (!deterministicCallerMigration) {
      blocking.push(
        'deterministic caller migration evidence missing or incomplete '
        + '(require caller_migration_scan_body content-addressed to caller_migration_scan_hash '
        + 'with complete=true; reject self-asserted booleans and arbitrary hashes)',
      );
    }

    dayRecords = Array.isArray(productionTelemetry.witnessed_day_records)
      ? productionTelemetry.witnessed_day_records
      : null;

    const todayUtc = new Date().toISOString().slice(0, 10);

    if (!dayRecords || dayRecords.length < ALIAS_DEFINITION.required_witnessed_days) {
      blocking.push(
        `full witnessed 14-day production evidence missing; `
        + `have ${dayRecords ? dayRecords.length : 0} day records, `
        + `require ${ALIAS_DEFINITION.required_witnessed_days} (scalar day count alone is insufficient)`,
      );
    } else {
      const validDays = [];
      let previousWitnessHead = null;
      for (const day of dayRecords) {
        if (!day || typeof day !== 'object') continue;
        if (typeof day.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.day)) continue;
        if (day.day >= todayUtc) continue;
        if (day.translation_used_events !== 0 || day.unresolved_translation_deltas !== 0) continue;
        const dayReceipt = day.witness_receipt;
        if (!dayReceipt || typeof dayReceipt !== 'object' || Array.isArray(dayReceipt)) continue;
        try {
          verifyReceiptShape(dayReceipt);
        } catch (_error) {
          continue;
        }
        if (!isNonEmptySha256(dayReceipt.witness_head)
          || !isNonEmptySha256(dayReceipt.event_hash)) continue;
        const selfDayHash = sha256(canonicalJson({
          day: day.day,
          translation_used_events: 0,
          unresolved_translation_deltas: 0,
        }));
        if (dayReceipt.witness_head.toLowerCase() === selfDayHash.toLowerCase()
          || dayReceipt.event_hash.toLowerCase() === selfDayHash.toLowerCase()) {
          continue;
        }
        if (previousWitnessHead == null) {
          if (dayReceipt.previous_witness_head !== null
            && dayReceipt.previous_witness_head !== undefined
            && dayReceipt.previous_witness_head !== '') {
            continue;
          }
        } else if (dayReceipt.previous_witness_head == null
          || dayReceipt.previous_witness_head.toLowerCase() !== previousWitnessHead.toLowerCase()) {
          continue;
        }
        if (day.witness_head
          && day.witness_head.toLowerCase() !== dayReceipt.witness_head.toLowerCase()) {
          continue;
        }
        validDays.push({
          day: day.day,
          witness_head: dayReceipt.witness_head.toLowerCase(),
          event_hash: dayReceipt.event_hash.toLowerCase(),
        });
        previousWitnessHead = dayReceipt.witness_head.toLowerCase();
      }
      if (validDays.length < ALIAS_DEFINITION.required_witnessed_days) {
        blocking.push(
          `only ${validDays.length} complete witnessed day records with linked receipt chain, `
          + `zero translation use, and dates strictly before today; `
          + `require ${ALIAS_DEFINITION.required_witnessed_days}`,
        );
      }
      const distinctDays = new Set(validDays.map((day) => day.day));
      if (distinctDays.size !== validDays.length) {
        blocking.push(
          'duplicate production days rejected; require 14 distinct complete witnessed days',
        );
      }
      if (distinctDays.size < ALIAS_DEFINITION.required_witnessed_days) {
        blocking.push(
          `only ${distinctDays.size} distinct complete production days strictly before today; `
          + `require ${ALIAS_DEFINITION.required_witnessed_days}`,
        );
      }
      const distinctHeads = new Set(validDays.map((day) => day.witness_head));
      if (distinctHeads.size !== validDays.length) {
        blocking.push(
          'duplicate or arbitrary repeated witness heads rejected across production days',
        );
      }
      const distinctEvents = new Set(validDays.map((day) => day.event_hash));
      if (distinctEvents.size !== validDays.length) {
        blocking.push(
          'duplicate or self-computable shaped event hashes rejected across production days',
        );
      }
      if (witnessedDays !== validDays.length || witnessedDays !== distinctDays.size) {
        blocking.push(
          `scalar witnessed_zero_use_days=${witnessedDays} does not match `
          + `validated distinct day-record count ${distinctDays.size}; refusing scalar-only trust`,
        );
      }
    }
    if (translationUsed !== 0) {
      blocking.push(`translation_used_events=${translationUsed} (require 0)`);
    }
    if (unresolvedDeltas !== 0) {
      blocking.push(`unresolved_translation_deltas=${unresolvedDeltas} (require 0)`);
    }
  } else {
    blocking.push(
      'no production alias-retirement telemetry; refusing to manufacture 14 elapsed days or promote fixture telemetry',
    );
  }

  const fixtureTelemetry = readJsonIfExists(path.join(
    projectDir,
    'p0',
    'fixtures',
    'alias-retirement-fixture.json',
  ));
  if (fixtureTelemetry) {
    blocking.push(
      'fixture alias telemetry is present and intentionally excluded from production retirement evidence',
    );
  }

  return {
    id: 'alias_retirement',
    definition: ALIAS_DEFINITION,
    aliases_present: present,
    aliases_missing: missing,
    aliases_present_nonblocking: true,
    nonblocking_notes: nonblockingNotes,
    telemetry_source: telemetrySource,
    witnessed_zero_use_days: witnessedDays,
    translation_used_events: translationUsed,
    unresolved_translation_deltas: unresolvedDeltas,
    shipped_compatibility_cycle: shippedCompatibilityCycle,
    deterministic_caller_migration: deterministicCallerMigration,
    status: blocking.length === 0 ? 'PASS' : 'HOLD',
    blocking_reasons: blocking,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const repoRoot = options.repoRoot;
  const projectDir = resolveProjectDir(repoRoot, options.project);
  const surface = countExecutedLoadBearingSurfaces(repoRoot);
  const kr8 = evaluateKr8(loadKr8Evidence(projectDir));
  const kr10 = evaluateKr10(surface);
  const alias = evaluateAliasRetirement(repoRoot, projectDir);

  const blocking = [
    ...kr8.blocking_reasons.map((reason) => `KR8: ${reason}`),
    ...kr10.blocking_reasons.map((reason) => `KR10: ${reason}`),
    ...alias.blocking_reasons.map((reason) => `alias_retirement: ${reason}`),
  ];
  const disposition = blocking.length === 0 ? 'PASS' : 'HOLD';
  const material = {
    schema_version: 1,
    kind: 'owner_kernel_release_gate_report',
    project: path.relative(repoRoot, projectDir) || projectDir,
    disposition,
    kr8,
    kr10,
    alias_retirement: alias,
    blocking_reasons: blocking,
    notes: [
      'KR definitions are frozen by the parent plan and are not redefined by this checker',
      'KR8 always uses frozen baseline 6; conflicting production telemetry is a blocker',
      'KR10 uses frozen complete surface enumeration including installed-engine; measurement failure is HOLD',
      'fixture telemetry is never promoted to production telemetry',
      'this checker never deletes compatibility aliases',
      'present compatibility aliases are nonblocking; only unmet retirement prerequisites HOLD',
      'P4 role qualification is out of scope',
    ],
  };
  material.report_hash = sha256(canonicalJson(material));
  process.stdout.write(`${JSON.stringify(material, null, 2)}\n`);
  if (options.check && disposition === 'HOLD') {
    process.exitCode = 1;
  }
}

main();
