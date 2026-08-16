#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  validateZeroDiffReceiptForContract,
} = require(path.resolve(__dirname, '..', 'src', 'engine', 'sealed-zero-diff-validator'));

const SCRIPT_DIR = path.resolve(__dirname);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const STOP_TOKEN = 'stop';
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'dispatch-unit-contract.schema.json');
const REQUIRED_NO_GO_KEYS = [
  'on_missing_spec',
  'on_dirty_base',
  'on_unknown_engine',
  'on_quota_unavailable',
  'on_scope_violation',
  'on_budget_exceeded',
  'on_clarification_needed',
];

const ALLOWED_ROLES = new Set(['implementer', 'verification-author', 'reviewer', 'explorer', 'verifier', 'planner']);
const ALLOWED_ENGINE_ROLES = new Set(['implementer', 'verification-author', 'reviewer', 'explorer', 'verifier', 'planner']);
const FORBIDDEN_ACTIONS_REQUIRED = new Set(['push', 'merge', 'network', 'dependency-change']);
const OUTPUT_KINDS = new Set(['commit', 'raw-artifact', 'verdict', 'diff']);
const REPO_PATH_TOKENS = {
  MANDATORY_MIRROR_PATH: '.codex/mirror',
};

function usage(code, message = '') {
  if (message) {
    console.error(message);
  }

  console.log('Usage:');
  console.log('  node scripts/dispatch-contract.js check --contract <file> --repo <dir> --json');
  process.exit(code);
}

function exitNoGo(unitId, contractSha, specSha, reasons, resolvedEngine) {
  const payload = {
    verdict: 'NO-GO',
    unit_id: unitId,
    contract_sha256: contractSha,
    spec_sha256: specSha,
    reasons,
    resolved_engine: {
      runner: resolvedEngine.runner,
      model: resolvedEngine.model,
      family: resolvedEngine.family,
    },
  };

  console.log(JSON.stringify(payload));
  process.exit(3);
}

function exitGo(unitId, contractSha, specSha, resolvedEngine, options = {}) {
  const payload = {
    verdict: 'GO',
    unit_id: unitId,
    contract_sha256: contractSha,
    spec_sha256: specSha,
    reasons: [],
    resolved_engine: {
      runner: resolvedEngine.runner,
      model: resolvedEngine.model,
      family: resolvedEngine.family,
    },
  };
  // Bounded provisional labor must keep assurance explicit.
  // Only implementer (commit) and verification-author (raw-artifact) set this;
  // reviewer / verifier / owner / finish paths never promote telemetry.
  if (options.assurance === 'provisional') {
    payload.assurance = 'provisional';
  }

  console.log(JSON.stringify(payload));
  process.exit(0);
}

function scorecardRowMatchesEngine(row, storeRole, resolvedEngine) {
  return Boolean(
    row
    && row.role === storeRole
    && row.engine === resolvedEngine.model
    && row.runner === resolvedEngine.runner,
  );
}

// Strict campaign admission scorecard policy:
// - implementer: exact configured provisional rows with observed_status===qualified
//   may GO with assurance=provisional (bounded commit labor only; no review/verify/merge)
// - verification-author: same provisional shape may GO with assurance=provisional only when
//   the unit output kind is exactly raw-artifact (untrusted authoring labor; depth-0
//   remains sole verification/merge authority)
// - missing / unknown / provisional observed_status remains NO-GO
// - reviewer and every other authority-bearing role: require status=qualified (fail-closed)
// - never promotes untrusted telemetry to qualified
function isAdmissibleScorecardRow(row, storeRole, resolvedEngine, options = {}) {
  if (!scorecardRowMatchesEngine(row, storeRole, resolvedEngine)) return false;
  if (row.status === 'qualified') return true;
  if (row.status !== 'provisional') return false;
  // Disk-backed projection maps evidence-backed qualified → provisional while
  // retaining observed_status. Only the exact observed qualified state admits.
  if (row.observed_status !== 'qualified') return false;
  if (storeRole === 'implementer') return true;
  if (storeRole === 'verification_author'
      && options.outputKind === 'raw-artifact') {
    return true;
  }
  return false;
}

function usageError(message) {
  throw new Error(message);
}

function hashHex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runGit(repo, args, input = null) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    input,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`git failed to spawn: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(result.stderr ? result.stderr.toString().trim() : 'git command failed');
  }

  return result.stdout || '';
}

function runNodeJson(repo, scriptFile, args) {
  const result = spawnSync('node', [scriptFile, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`node script failed to spawn: ${result.error.message}`);
  }

  const out = (result.stdout || '').trim();
  if (typeof result.status !== 'number' || result.status !== 0) {
    throw new Error(result.stderr ? result.stderr.toString().trim() : 'node script returned non-zero');
  }

  try {
    return JSON.parse(out);
  } catch (err) {
    throw new Error(`cannot parse ${path.basename(scriptFile)} output as JSON`);
  }
}

function runResolverJson(repo, scriptPath, args, envOverrides = {}) {
  const result = spawnSync('bash', [scriptPath, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...envOverrides },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`resolver script failed to spawn: ${result.error.message}`);
  }

  const out = (result.stdout || '').trim();
  if (typeof result.status !== 'number' || result.status !== 0) {
    throw new Error('canonical resolver returned non-zero exit code');
  }

  try {
    return JSON.parse(out);
  } catch (err) {
    throw new Error('canonical resolver output is not valid JSON');
  }
}

function normalizeStoreRole(role) {
  return String(role).replace(/-/g, '_');
}

function getResolverFieldPrefix(requiredEngineRole) {
  return requiredEngineRole === 'verification-author' ? 'verification_author' : 'implementer';
}

// Capability-state endpoint partition selector for an exact resolver tuple.
// Resolver emits "" for "no named endpoint"; capability-state uses "@none" for
// the explicit null wallet. Named endpoints pass through exactly as emitted —
// no trim/normalize here (resolve-review-loop owns endpoint validation).
// Never omit --endpoint: empty/legacy omission would query the ambiguous partition.
// Non-string (including null/undefined) means unresolved: callers must fail closed
// before invoking this helper.
function capabilityEndpointSelector(resolvedEndpoint) {
  if (typeof resolvedEndpoint !== 'string') {
    throw new Error('resolver tuple missing exact endpoint partition');
  }
  return resolvedEndpoint === '' ? '@none' : resolvedEndpoint;
}

// Build fail-closed exact capability `current` argv from the resolver tuple.
// Always includes --effort and --endpoint so admission never silently falls
// back to the legacy ambiguous (runner, model, role)-only partition.
function capabilityCurrentArgs(resolvedEngine, storeRole) {
  const effort = String(resolvedEngine.effort || '').trim();
  if (!effort) {
    throw new Error('resolver tuple missing exact effort partition');
  }
  return [
    'current',
    '--runner', resolvedEngine.runner,
    '--model', resolvedEngine.model,
    '--role', storeRole,
    '--effort', effort,
    '--endpoint', capabilityEndpointSelector(resolvedEngine.endpoint),
  ];
}

function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function withResolverConfig(configPath, requiredEngineRole) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    return { path: configPath };
  }

  if (requiredEngineRole !== 'verification-author') {
    return { path: configPath };
  }

  const hasPresent = /^\s*-\s*verification_author_present\s*:\s*true\s*$/im.test(raw);
  const hasEffort = /^\s*-\s*verification_author_effort\s*:/im.test(raw);
  if (!hasPresent || hasEffort) {
    return { path: configPath };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-contract-'));
  const tempFile = path.join(tempDir, `review-loop-config-${Date.now()}.md`);
  const updated = `${raw.trimEnd()}\n- verification_author_effort: high\n`;
  fs.writeFileSync(tempFile, `${updated}\n`, 'utf8');
  return { path: tempFile, isTemp: true };
}

function assertNoExtra(pathName, obj, allowedKeys, errors) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push(`${pathName}: expected object`);
    return;
  }

  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${pathName}: unknown key '${key}'`);
    }
  }
}

function isHex40(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateSchema(contract, errors, repoPath = '') {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    errors.push('contract: expected top-level object');
    return;
  }

  const rootAllowed = new Set([
    'schema',
    'unit_id',
    'role',
    'deliberate_polarity',
    'goal',
    'spec',
    'base_sha',
    'depends_on',
    'scope',
    'go',
    'no_go',
    'output',
    'acceptance',
    'budget',
    'campaign_projection',
    'frozen_four_tuple',
  ]);
  assertNoExtra('contract', contract, rootAllowed, errors);

  const rootRequired = ['schema', 'unit_id', 'role', 'goal', 'spec', 'base_sha', 'depends_on', 'scope', 'go', 'no_go', 'output', 'acceptance', 'budget'];
  for (const key of rootRequired) {
    if (!hasKey(contract, key)) {
      errors.push(`contract: missing required key '${key}'`);
    }
  }

  if (contract.schema !== 1) errors.push('schema: must be 1');

  if (!isNonEmptyString(contract.unit_id)) {
    errors.push('unit_id: must be non-empty string');
  }

  if (!ALLOWED_ROLES.has(contract.role)) {
    errors.push('role: invalid role');
  }

  if (hasKey(contract, 'deliberate_polarity') && typeof contract.deliberate_polarity !== 'boolean') {
    errors.push('deliberate_polarity: must be boolean');
  }

  if (!isNonEmptyString(contract.goal)) {
    errors.push('goal: must be non-empty string');
  }

  if (!contract.spec || typeof contract.spec !== 'object' || Array.isArray(contract.spec)) {
    errors.push('spec: expected object');
  } else {
    const allowed = new Set(['path', 'section']);
    assertNoExtra('spec', contract.spec, allowed, errors);
    if (!hasKey(contract.spec, 'path')) errors.push('spec: missing path');
    if (!hasKey(contract.spec, 'section')) errors.push('spec: missing section');
    if (!isNonEmptyString(contract.spec.path)) errors.push('spec.path: must be non-empty string');
    if (!isNonEmptyString(contract.spec.section)) errors.push('spec.section: must be non-empty string');
  }

  if (!isHex40(contract.base_sha)) {
    errors.push('base_sha: must be lowercase 40-hex commit id');
  }

  if (!Array.isArray(contract.depends_on)) {
    errors.push('depends_on: must be array');
  } else {
    for (let i = 0; i < contract.depends_on.length; i += 1) {
      if (!isHex40(contract.depends_on[i])) {
        errors.push(`depends_on[${i}]: must be lowercase 40-hex commit id`);
      }
    }
  }

  if (!contract.scope || typeof contract.scope !== 'object' || Array.isArray(contract.scope)) {
    errors.push('scope: expected object');
  } else {
    const scopeAllowed = new Set(['allow_paths', 'deny_paths', 'generated_mirrors', 'max_files', 'max_diff_lines']);
    assertNoExtra('scope', contract.scope, scopeAllowed, errors);
    const required = ['allow_paths', 'deny_paths', 'max_files', 'max_diff_lines'];
    for (const key of required) {
      if (!hasKey(contract.scope, key)) {
        errors.push(`scope: missing required key '${key}'`);
      }
    }

    if (!Array.isArray(contract.scope.allow_paths) || contract.scope.allow_paths.length < 1) {
      errors.push('scope.allow_paths: must be a non-empty array');
    } else {
      contract.scope.allow_paths.forEach((entry, idx) => {
        if (!isNonEmptyString(entry)) {
          errors.push(`scope.allow_paths[${idx}]: must be non-empty string`);
        }
      });
    }

    if (!Array.isArray(contract.scope.deny_paths)) {
      errors.push('scope.deny_paths: must be an array');
    } else {
      contract.scope.deny_paths.forEach((entry, idx) => {
        if (!isNonEmptyString(entry)) {
          errors.push(`scope.deny_paths[${idx}]: must be non-empty string`);
        }
      });
    }

    if (!Number.isInteger(contract.scope.max_files) || contract.scope.max_files < 1) {
      errors.push('scope.max_files: must be integer >= 1');
    }

    if (!Number.isInteger(contract.scope.max_diff_lines) || contract.scope.max_diff_lines < 1) {
      errors.push('scope.max_diff_lines: must be integer >= 1');
    }

    if (hasKey(contract.scope, 'generated_mirrors')) {
      if (!contract.scope.generated_mirrors || typeof contract.scope.generated_mirrors !== 'object' || Array.isArray(contract.scope.generated_mirrors)) {
        errors.push('scope.generated_mirrors: expected object');
      } else {
        const gm = contract.scope.generated_mirrors;
        const gmAllowed = new Set(['command', 'allow_paths']);
        assertNoExtra('scope.generated_mirrors', gm, gmAllowed, errors);

        if (!hasKey(gm, 'command')) errors.push('scope.generated_mirrors: missing command');
        if (!hasKey(gm, 'allow_paths')) errors.push('scope.generated_mirrors: missing allow_paths');

        if (!Array.isArray(gm.command) || gm.command.length < 1) {
          errors.push('scope.generated_mirrors.command: must be non-empty array');
        } else {
          gm.command.forEach((arg, argIdx) => {
            if (!isNonEmptyString(arg)) {
              errors.push(`scope.generated_mirrors.command[${argIdx}]: must be non-empty string`);
            }
          });
        }

        if (!Array.isArray(gm.allow_paths) || gm.allow_paths.length < 1) {
          errors.push('scope.generated_mirrors.allow_paths: must be non-empty array');
        } else {
          gm.allow_paths.forEach((entryPath, entryIdx) => {
            if (!isNonEmptyString(entryPath)) {
              errors.push(`scope.generated_mirrors.allow_paths[${entryIdx}]: must be non-empty string`);
            }
          });
        }
      }
    }
  }

  // Canonical static disjointness gate for scope/mirrors.
  if (!Array.isArray(errors) || !(contract && typeof contract === 'object')) return;
  if (contract.scope && Array.isArray(contract.scope.allow_paths) && Array.isArray(contract.scope.deny_paths)) {
    for (const allow of contract.scope.allow_paths) {
      if (!isNonEmptyString(allow)) continue;
      for (const deny of contract.scope.deny_paths) {
        if (!isNonEmptyString(deny)) continue;
        if (pathsOverlap(allow, deny)) {
          errors.push('overlap: scope allow and deny intersect');
        }
      }
    }
  }

  if (contract.scope && contract.scope.generated_mirrors && typeof contract.scope.generated_mirrors === 'object' && !Array.isArray(contract.scope.generated_mirrors)) {
    const gm = contract.scope.generated_mirrors;
    if (Array.isArray(gm.allow_paths)) {
      for (const gmPath of gm.allow_paths) {
        if (!isNonEmptyString(gmPath) || !Array.isArray(contract.scope.allow_paths)) {
          continue;
        }
        const overlapsAllow = contract.scope.allow_paths.some((allow) => pathsOverlap(allow, gmPath));
        const overlapsDeny = Array.isArray(contract.scope.deny_paths)
          && contract.scope.deny_paths.some((deny) => pathsOverlap(gmPath, deny));
        if (overlapsAllow && overlapsDeny) {
          errors.push('overlap: generated mirror path intersects deny_paths');
        }
      }
    }
  }

  if (repoPath && typeof repoPath === 'string' && isHex40(contract.base_sha)) {
    const hasMandatoryMirror = hasPathAtCommit(repoPath, contract.base_sha, REPO_PATH_TOKENS.MANDATORY_MIRROR_PATH);
    if (contract.output && contract.output.kind === 'commit' && hasMandatoryMirror && (!contract.scope.generated_mirrors || typeof contract.scope.generated_mirrors !== 'object' || Array.isArray(contract.scope.generated_mirrors))) {
      errors.push('mirror: generated_mirrors must be declared for mandatory codex mirror generation');
    }
  }

  if (!contract.go || typeof contract.go !== 'object' || Array.isArray(contract.go)) {
    errors.push('go: expected object');
  } else {
    const goAllowed = new Set(['required_paths', 'required_engine_role', 'required_red_command']);
    assertNoExtra('go', contract.go, goAllowed, errors);
    const required = ['required_paths', 'required_engine_role', 'required_red_command'];
    for (const key of required) {
      if (!hasKey(contract.go, key)) {
        errors.push(`go: missing required key '${key}'`);
      }
    }

    if (!Array.isArray(contract.go.required_paths) || contract.go.required_paths.length < 1) {
      errors.push('go.required_paths: must be non-empty array');
    } else {
      contract.go.required_paths.forEach((entry, idx) => {
        if (!isNonEmptyString(entry)) {
          errors.push(`go.required_paths[${idx}]: must be non-empty string`);
        }
      });
    }

    if (!ALLOWED_ENGINE_ROLES.has(contract.go.required_engine_role)) {
      errors.push('go.required_engine_role: invalid role');
    }

    if (!Array.isArray(contract.go.required_red_command) || contract.go.required_red_command.length < 1) {
      errors.push('go.required_red_command: must be non-empty array');
    } else {
      contract.go.required_red_command.forEach((entry, idx) => {
        if (!isNonEmptyString(entry)) {
          errors.push(`go.required_red_command[${idx}]: must be non-empty string`);
        }
      });
    }
  }

  if (!contract.no_go || typeof contract.no_go !== 'object' || Array.isArray(contract.no_go)) {
    errors.push('no_go: expected object');
  } else {
    const allowed = new Set([
      'on_missing_spec',
      'on_dirty_base',
      'on_unknown_engine',
      'on_quota_unavailable',
      'on_scope_violation',
      'on_budget_exceeded',
      'on_clarification_needed',
      'forbidden_actions',
    ]);
    assertNoExtra('no_go', contract.no_go, allowed, errors);

    if (!Array.isArray(contract.no_go.forbidden_actions)) {
      errors.push('no_go.forbidden_actions: must be array');
    } else {
      contract.no_go.forbidden_actions.forEach((entry, idx) => {
        if (!FORBIDDEN_ACTIONS_REQUIRED.has(entry)) {
          errors.push(`no_go.forbidden_actions[${idx}]: invalid forbidden action`);
        }
      });
    }
  }

  if (!contract.output || typeof contract.output !== 'object' || Array.isArray(contract.output)) {
    errors.push('output: expected object');
  } else {
    const allowed = new Set(['kind', 'paths', 'required_change_paths', 'zero_diff_receipt']);
    assertNoExtra('output', contract.output, allowed, errors);
    if (!hasKey(contract.output, 'kind')) errors.push('output: missing kind');
    if (!hasKey(contract.output, 'paths')) errors.push('output: missing paths');

    if (!OUTPUT_KINDS.has(contract.output.kind)) {
      errors.push('output.kind: must be one of commit|raw-artifact|verdict|diff');
    }

    if (!Array.isArray(contract.output.paths) || contract.output.paths.length < 1) {
      errors.push('output.paths: must be non-empty array');
    } else {
      const seenPaths = new Set();
      contract.output.paths.forEach((entry, idx) => {
        if (!isNonEmptyString(entry)) {
          errors.push(`output.paths[${idx}]: must be non-empty string`);
        } else if (seenPaths.has(entry)) {
          errors.push(`output.paths[${idx}]: duplicate path`);
        } else {
          seenPaths.add(entry);
        }
      });
    }

    // required_change_paths: present ⇒ non-empty, unique, exact subset of output.paths
    if (Object.prototype.hasOwnProperty.call(contract.output, 'required_change_paths')) {
      const req = contract.output.required_change_paths;
      if (!Array.isArray(req) || req.length < 1) {
        errors.push('output.required_change_paths: when present must be a non-empty array');
      } else {
        const seenReq = new Set();
        const outPaths = Array.isArray(contract.output.paths) ? contract.output.paths : [];
        req.forEach((entry, idx) => {
          if (!isNonEmptyString(entry)) {
            errors.push(`output.required_change_paths[${idx}]: must be non-empty string`);
            return;
          }
          if (seenReq.has(entry)) {
            errors.push(`output.required_change_paths[${idx}]: duplicate path`);
          }
          seenReq.add(entry);
          if (!outPaths.includes(entry)) {
            errors.push(
              `output.required_change_paths[${idx}]: must be an exact subset of output.paths (${entry})`,
            );
          }
        });
        // Also enforce within scope.allow_paths when scope is present.
        if (contract.scope && Array.isArray(contract.scope.allow_paths)) {
          const allow = contract.scope.allow_paths;
          for (const entry of req) {
            if (!isNonEmptyString(entry)) continue;
            const under = allow.some((p) => entry === p || entry.startsWith(`${p}/`));
            if (!under) {
              errors.push(
                `output.required_change_paths: '${entry}' is outside scope.allow_paths`,
              );
            }
          }
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(contract.output, 'zero_diff_receipt')) {
      // Single production validator (D2 A06) — parity with engine projection + hetero admission.
      validateZeroDiffReceiptForContract(contract.output.zero_diff_receipt, contract, errors);
    }
  }

  if (!Array.isArray(contract.acceptance) || contract.acceptance.length < 1) {
    errors.push('acceptance: must be non-empty array');
  } else {
    contract.acceptance.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`acceptance[${idx}]: expected object`);
        return;
      }

      const allowed = new Set(['argv', 'exit']);
      assertNoExtra(`acceptance[${idx}]`, entry, allowed, errors);
      if (!hasKey(entry, 'argv')) errors.push(`acceptance[${idx}]: missing argv`);
      if (!hasKey(entry, 'exit')) errors.push(`acceptance[${idx}]: missing exit`);

      if (!Array.isArray(entry.argv) || entry.argv.length < 1) {
        errors.push(`acceptance[${idx}].argv: must be non-empty array`);
      } else {
        entry.argv.forEach((arg, argIdx) => {
          if (!isNonEmptyString(arg)) {
            errors.push(`acceptance[${idx}].argv[${argIdx}]: must be non-empty string`);
          }
        });
      }

      if (!Number.isInteger(entry.exit)) {
        errors.push(`acceptance[${idx}].exit: must be integer`);
      }
    });
  }

  if (!contract.budget || typeof contract.budget !== 'object' || Array.isArray(contract.budget)) {
    errors.push('budget: expected object');
  } else {
    const allowed = new Set(['wall_seconds', 'max_attempts', 'max_context_files']);
    assertNoExtra('budget', contract.budget, allowed, errors);
    if (!hasKey(contract.budget, 'wall_seconds')) errors.push('budget: missing wall_seconds');
    if (!hasKey(contract.budget, 'max_attempts')) errors.push('budget: missing max_attempts');
    if (!hasKey(contract.budget, 'max_context_files')) errors.push('budget: missing max_context_files');

    if (!Number.isInteger(contract.budget.wall_seconds) || contract.budget.wall_seconds < 10 || contract.budget.wall_seconds > 3600) {
      errors.push('budget.wall_seconds: must be integer 10..3600');
    }
    if (!Number.isInteger(contract.budget.max_attempts) || contract.budget.max_attempts < 1 || contract.budget.max_attempts > 3) {
      errors.push('budget.max_attempts: must be integer 1..3');
    }
    if (!Number.isInteger(contract.budget.max_context_files) || contract.budget.max_context_files < 1 || contract.budget.max_context_files > 20) {
      errors.push('budget.max_context_files: must be integer 1..20');
    }
  }

  if (hasKey(contract, 'campaign_projection')) {
    const projection = contract.campaign_projection;
    const allowed = new Set([
      'schema_version',
      'campaign_contract_sha256',
      'strict_dispatch_sha256',
      'campaign_id',
      'ticket',
      'campaign_base_sha',
      'branch',
      'stage',
      'generation',
      'root_run_id',
      'mission_lineage_id',
      'mission_policy_digest',
      'mission_graph_digest',
      'graph_node_id',
      'graph_node_digest',
      'runner',
      'model',
    ]);
    assertNoExtra('campaign_projection', projection, allowed, errors);
    for (const key of allowed) {
      if (!projection || !hasKey(projection, key)) {
        errors.push(`campaign_projection: missing required key '${key}'`);
      }
    }
    if (projection && typeof projection === 'object' && !Array.isArray(projection)) {
      const shaFields = [
        'campaign_contract_sha256',
        'strict_dispatch_sha256',
        'mission_policy_digest',
        'mission_graph_digest',
        'graph_node_digest',
      ];
      if (projection.schema_version !== 1) {
        errors.push('campaign_projection.schema_version: must be 1');
      }
      for (const key of shaFields) {
        if (typeof projection[key] !== 'string' || !/^[0-9a-f]{64}$/.test(projection[key])) {
          errors.push(`campaign_projection.${key}: must be lowercase SHA-256`);
        }
      }
      if (typeof projection.campaign_id !== 'string'
          || !/^campaign-v[12]-[0-9a-f]{64}$/.test(projection.campaign_id)) {
        errors.push('campaign_projection.campaign_id: invalid campaign id');
      }
      if (typeof projection.ticket !== 'string'
          || !/^[A-Za-z0-9._-]{1,128}$/.test(projection.ticket)) {
        errors.push('campaign_projection.ticket: invalid ticket');
      }
      if (typeof projection.campaign_base_sha !== 'string'
          || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(projection.campaign_base_sha)) {
        errors.push('campaign_projection.campaign_base_sha: invalid Git object');
      }
      if (!isNonEmptyString(projection.branch)) {
        errors.push('campaign_projection.branch: must be non-empty string');
      }
      const stageMatch = typeof projection.stage === 'string'
        ? /^campaign-implementation(?:#r((?:[2-9]|[1-9][0-9]+)))?$/.exec(
          projection.stage,
        )
        : null;
      if (!stageMatch) {
        errors.push('campaign_projection.stage: invalid campaign stage');
      }
      const round = projection.stage === 'campaign-implementation'
        ? 0
        : (stageMatch && stageMatch[1] ? Number(stageMatch[1]) - 1 : null);
      if (!Number.isSafeInteger(projection.generation)
          || projection.generation < 0
          || round === null
          || projection.generation !== round) {
        errors.push('campaign_projection.generation: disagrees with stage');
      }
      if (typeof projection.root_run_id !== 'string'
          || !/^[A-Za-z0-9._-]+$/.test(projection.root_run_id)) {
        errors.push('campaign_projection.root_run_id: invalid root run id');
      }
      for (const key of ['mission_lineage_id', 'graph_node_id', 'runner', 'model']) {
        if (!isNonEmptyString(projection[key])) {
          errors.push(`campaign_projection.${key}: must be non-empty string`);
        }
      }
    }
  }

  // frozen_four_tuple (optional, additive — autonomous-brain-integration P1).
  // The four surfaces a mid-run brain must not mutate (granularity DAG, gate set,
  // acceptance rubric, control plane). Granularity/rubric are CONTENT-pinned: the
  // path locates the file, the digest is the authority — `check` recomputes and
  // refuses on mismatch. control_plane_pins maps repo-relative paths (configs AND
  // the governance scripts themselves) to sha256 digests so the brain cannot
  // neuter a gate by editing it. Digest pins are configuration identity, not
  // trust machinery: nothing chains or attests; a mismatch simply refuses.
  if (hasKey(contract, 'frozen_four_tuple')) {
    const fft = contract.frozen_four_tuple;
    if (!fft || typeof fft !== 'object' || Array.isArray(fft)) {
      errors.push('frozen_four_tuple: expected object');
    } else {
      const allowed = new Set([
        'granularity_path',
        'granularity_digest',
        'gate_set',
        'rubric_path',
        'rubric_digest',
        'control_plane_pins',
      ]);
      assertNoExtra('frozen_four_tuple', fft, allowed, errors);
      for (const key of allowed) {
        if (!hasKey(fft, key)) {
          errors.push(`frozen_four_tuple: missing required key '${key}'`);
        }
      }
      for (const key of ['granularity_path', 'rubric_path']) {
        if (hasKey(fft, key) && !isNonEmptyString(fft[key])) {
          errors.push(`frozen_four_tuple.${key}: must be non-empty string`);
        }
      }
      for (const key of ['granularity_digest', 'rubric_digest']) {
        if (hasKey(fft, key)
            && (typeof fft[key] !== 'string' || !/^[0-9a-f]{64}$/.test(fft[key]))) {
          errors.push(`frozen_four_tuple.${key}: must be lowercase SHA-256`);
        }
      }
      if (hasKey(fft, 'gate_set')) {
        if (!Array.isArray(fft.gate_set) || fft.gate_set.length === 0) {
          errors.push('frozen_four_tuple.gate_set: must be a non-empty array');
        } else {
          const seen = new Set();
          fft.gate_set.forEach((gate, idx) => {
            if (!isNonEmptyString(gate)) {
              errors.push(`frozen_four_tuple.gate_set[${idx}]: must be non-empty string`);
              return;
            }
            if (seen.has(gate)) {
              errors.push(`frozen_four_tuple.gate_set[${idx}]: duplicate gate '${gate}'`);
            }
            seen.add(gate);
          });
        }
      }
      if (hasKey(fft, 'control_plane_pins')) {
        const pins = fft.control_plane_pins;
        if (!pins || typeof pins !== 'object' || Array.isArray(pins)
            || Object.keys(pins).length === 0) {
          errors.push('frozen_four_tuple.control_plane_pins: must be a non-empty object');
        } else {
          for (const [pinPath, digest] of Object.entries(pins)) {
            if (!isNonEmptyString(pinPath) || pinPath.startsWith('/') || pinPath.includes('..')) {
              errors.push(`frozen_four_tuple.control_plane_pins: invalid path '${pinPath}'`);
            }
            if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
              errors.push(`frozen_four_tuple.control_plane_pins['${pinPath}']: must be lowercase SHA-256`);
            }
          }
        }
      }
    }
  }
}

function escapeRegExp(raw) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWildcard(raw) {
  return /[\*?]/.test(raw);
}

function globToRegex(glob) {
  const trimmed = glob.trim().replace(/\/+$/, '');
  let working = trimmed;

  const hasUnsupported = /[{}\[\]]/.test(working);
  if (hasUnsupported) {
    return null;
  }

  const escaped =
    working
      .replace(/[-/\\^$+?.()|]/g, '\\$&')
      .replace(/\*\*/g, '§§DOUBLE§§')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/§§DOUBLE§§/g, '.*');

  const core = `^(?:${escaped})(?:/.*)?$`;
  const literal = new RegExp(core);

  return {
    regex: literal,
    bareDir: !hasWildcard(working) && !working.endsWith('/'),
  };
}

function matchesPath(pathValue, pattern) {
  const entry = globToRegex(pattern);
  if (!entry) {
    return false;
  }
  const re = entry.regex;
  const normalized = String(pathValue).replace(/\/+$/, '');
  const normalizedPattern = String(pattern).replace(/\/+$/, '');

  if (!entry.bareDir) {
    return re.test(normalized);
  }

  return normalized === normalizedPattern || normalized.startsWith(`${normalizedPattern}/`);
}

function pathsOverlap(patternA, patternB) {
  return matchesPath(patternA, patternB) || matchesPath(patternB, patternA);
}

function readSchema() {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  JSON.parse(raw);
}

function loadContract(pathStr, errors) {
  if (!pathStr) {
    errors.push('contract path is required');
    return null;
  }

  const absPath = path.resolve(pathStr);
  let raw;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    errors.push(`contract file read failed: ${err.message}`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    errors.push('malformed JSON');
    return null;
  }

  return { parsed, raw, absPath, hash: hashHex(raw) };
}

function validatePolicyFilePathsAtBase(repo, commitSha, paths, reasons) {
  for (const p of paths) {
    if (!hasPathAtCommit(repo, commitSha, p)) {
      reasons.push(`path: required path ${p} not present at base`);
      return;
    }
  }
}

function hasPathAtCommit(repo, commitSha, targetPath) {
  let out;
  try {
    out = runGit(repo, ['ls-tree', '-r', '--name-only', commitSha, '--', targetPath]);
  } catch (err) {
    return false;
  }

  if (out.trim().length === 0) {
    return false;
  }

  const exact = targetPath.replace(/\/+$/, '');
  const lines = out.split('\n').filter((v) => v.length > 0);
  return lines.some((line) => line === exact || line.startsWith(`${exact}/`) || line.endsWith(`/${exact}`));
}

function resolveEngine(repo, reasons, resolvedEngine, requiredEngineRole = 'implementer') {
  const configPath = path.join(repo, '.claude', 'review-loop-config.md');
  if (!fs.existsSync(configPath)) {
    reasons.push('engine: missing .claude/review-loop-config.md');
    return;
  }

  let resolvedConfig;
  const resolverConfig = withResolverConfig(configPath, requiredEngineRole);
  try {
    resolvedConfig = runResolverJson(repo, path.join(SCRIPT_DIR, 'resolve-review-loop.sh'), [], {
      REVIEW_LOOP_CONFIG_OVERRIDE: resolverConfig.path,
    });
  } catch (err) {
    if (resolverConfig.isTemp) {
      try {
        fs.unlinkSync(resolverConfig.path);
        fs.rmdirSync(path.dirname(resolverConfig.path), { recursive: false });
      } catch (cleanupErr) {
        // Ignore cleanup failure; keep original error path for deterministic diagnostics.
      }
    }
    reasons.push('engine: failed to resolve engine tuple via canonical resolver');
    return;
  }
  if (resolverConfig.isTemp) {
    try {
      fs.unlinkSync(resolverConfig.path);
      fs.rmdirSync(path.dirname(resolverConfig.path), { recursive: false });
    } catch (cleanupErr) {
      // Ignore cleanup failure; temporary files are under /tmp and best-effort.
    }
  }

  const prefix = getResolverFieldPrefix(requiredEngineRole);
  const model = String(resolvedConfig[`${prefix}_engine`] || '').trim();
  const runner = String(resolvedConfig[`${prefix}_runner`] || '').trim();
  const family = String(resolvedConfig[`${prefix}_family`] || '').trim();
  // Effort/endpoint are part of the exact admission identity.
  // Endpoint "" is a real value (explicit no named endpoint → capability @none).
  // Property absence is NOT equivalent to "" — fail closed so a future resolver
  // drift cannot silently authorize the @none wallet.
  const effort = String(resolvedConfig[`${prefix}_effort`] || '').trim();
  const endpointKey = `${prefix}_endpoint`;
  let endpoint = null; // non-string sentinel: unresolved (never maps to @none)
  if (!Object.prototype.hasOwnProperty.call(resolvedConfig, endpointKey)) {
    reasons.push('engine: missing endpoint in canonical resolver output');
  } else if (typeof resolvedConfig[endpointKey] !== 'string') {
    reasons.push('engine: invalid endpoint in canonical resolver output');
  } else {
    // Forward exactly as emitted — resolver already validated the name or "".
    endpoint = resolvedConfig[endpointKey];
  }

  resolvedEngine.model = model;
  resolvedEngine.runner = runner;
  resolvedEngine.family = family;
  resolvedEngine.effort = effort;
  resolvedEngine.endpoint = endpoint;

  if (!model) {
    reasons.push('engine: missing model in .claude/review-loop-config.md');
  }
  if (!runner) {
    reasons.push('engine: missing runner in .claude/review-loop-config.md');
  }
  if (!family) {
    reasons.push('engine: missing family in .claude/review-loop-config.md');
  }
  if (!effort) {
    reasons.push('engine: missing effort in .claude/review-loop-config.md');
  }
}

function checkSchemaCompliance(contractPath, repoPath = '') {
  const errors = [];
  const loaded = loadContract(contractPath, errors);
  if (!loaded) return { loaded: null, errors };

  validateSchema(loaded.parsed, errors, repoPath);

  return { loaded, errors, contract: loaded.parsed };
}

function getBaseSpecSection(baseSha, contract, repo) {
  const specPath = contract.spec.path;
  let specText = '';

  try {
    specText = runGit(repo, ['show', `${baseSha}:${specPath}`]);
  } catch (err) {
    return { ok: false, specText: '', reason: `base: spec file missing at base (${specPath})` };
  }

  const section = String(contract.spec.section || '');
  // CommonMark ATX: at most 3 leading ASCII spaces (not tabs / arbitrary WS).
  const heading = `^ {0,3}#{1,6}\\s+${escapeRegExp(section)}\\s*$`;
  const found = specText.split('\n').some((line) => new RegExp(heading).test(line));

  if (!found) {
    return { ok: false, specText, reason: `section: missing heading for '${section}'` };
  }

  return { ok: true, specText };
}

function checkPolicy(contract, repo, contractSha, resolvedEngine) {
  const reasons = [];
  const baseSha = contract.base_sha;
  const requiredEngineRole = contract.go.required_engine_role;
  const storeRole = normalizeStoreRole(requiredEngineRole);
  const campaignProjection = contract.campaign_projection || null;

  let headSha = '';
  let baseAtHead = false;

  try {
    headSha = runGit(repo, ['rev-parse', 'HEAD']).trim();
    if (!isHex40(headSha)) {
      reasons.push('base: HEAD must be a commit');
    }
  } catch (err) {
    reasons.push('base: repository has no HEAD');
  }

  try {
    runGit(repo, ['rev-parse', '--is-inside-work-tree']);
  } catch (err) {
    reasons.push('base: repository is not a git work tree');
  }

  if (reasons.length > 0) {
    return { reasons, specSha: '' };
  }

  const status = runGit(repo, ['status', '--porcelain']);
  if (status.trim().length > 0) {
    reasons.push('dirty: repository has uncommitted changes');
    return { reasons, specSha: '' };
  }

  try {
    runGit(repo, ['cat-file', '-e', `${baseSha}^{commit}`]);
  } catch (err) {
    reasons.push('base: pinned base commit does not resolve');
    return { reasons, specSha: '' };
  }

  for (const dep of contract.depends_on) {
    try {
      runGit(repo, ['cat-file', '-e', `${dep}^{commit}`]);
    } catch (err) {
      reasons.push('dependency: commit does not resolve');
      continue;
    }

    try {
      runGit(repo, ['merge-base', '--is-ancestor', dep, baseSha]);
    } catch (err) {
      reasons.push(`dependency: ${dep} is not ancestor of base`);
    }
  }

  // frozen_four_tuple immutability: recompute every pinned digest from the repo's
  // CURRENT files. A mismatch means a frozen surface (DAG, rubric, config, or a
  // governance script itself) was edited mid-campaign — refuse, do not re-freeze.
  if (contract.frozen_four_tuple) {
    const fft = contract.frozen_four_tuple;
    const pinned = [
      ['frozen_four_tuple.granularity', fft.granularity_path, fft.granularity_digest],
      ['frozen_four_tuple.rubric', fft.rubric_path, fft.rubric_digest],
      ...Object.entries(fft.control_plane_pins || {}).map(
        ([pinPath, digest]) => [`frozen_four_tuple.control_plane_pins['${pinPath}']`, pinPath, digest],
      ),
    ];
    for (const [label, pinPath, digest] of pinned) {
      const absolute = path.resolve(repo, pinPath);
      if (!absolute.startsWith(path.resolve(repo) + path.sep)) {
        reasons.push(`${label}: pinned path escapes the repository`);
        continue;
      }
      let content;
      try {
        content = fs.readFileSync(absolute);
      } catch (err) {
        reasons.push(`${label}: pinned file is missing (${pinPath})`);
        continue;
      }
      const actual = crypto.createHash('sha256').update(content).digest('hex');
      if (actual !== digest) {
        reasons.push(`${label}: frozen surface was modified (digest mismatch for ${pinPath})`);
      }
    }
  }

  // Pre-spend catch: for output.kind=commit, dispatch-hetero's boundary check matches
  // output.paths EXACTLY against `git diff --name-only` ("output.paths must be a subset
  // of changed files"). A directory can never appear in that list, so such a contract is
  // guaranteed to be boundary_rejected — but only AFTER the runner has been paid for.
  // Proving it here costs nothing. Restricted to kind=commit because the other kinds do
  // not go through that exact-match rail.
  if (contract.output.kind === 'commit') {
    for (const outPath of contract.output.paths) {
      let isDir = outPath.endsWith('/');

      if (!isDir) {
        try {
          isDir = runGit(repo, ['cat-file', '-t', `${baseSha}:${outPath}`]).trim() === 'tree';
        } catch (err) {
          isDir = false;  // absent at base is fine: the unit may be creating the file
        }
      }

      if (isDir) {
        reasons.push(`output: path '${outPath}' is a directory; kind=commit matches changed files exactly, so it can never be satisfied`);
      }
    }
  }

  const baseSpec = getBaseSpecSection(baseSha, contract, repo);
  let specSha = '';
  if (!baseSpec.ok) {
    reasons.push(baseSpec.reason);
  } else {
    specSha = hashHex(baseSpec.specText);

    const workingSpecPath = path.join(repo, contract.spec.path);
    if (fs.existsSync(workingSpecPath)) {
      const workingSpec = fs.readFileSync(workingSpecPath, 'utf8');
      if (workingSpec !== baseSpec.specText) {
        reasons.push('drift: spec file differs from base snapshot (assume-unchanged or local edit)');
      }
    } else {
      reasons.push('path: spec path not present in working tree');
    }
  }

  validatePolicyFilePathsAtBase(repo, baseSha, contract.go.required_paths, reasons);

  const forbidden = new Set(Array.isArray(contract.no_go.forbidden_actions) ? contract.no_go.forbidden_actions : []);
  for (const key of REQUIRED_NO_GO_KEYS) {
    if (!hasKey(contract.no_go, key) || contract.no_go[key] !== STOP_TOKEN) {
      reasons.push(`forbidden: no_go.${key} must be "${STOP_TOKEN}"`);
    }
  }

  for (const action of FORBIDDEN_ACTIONS_REQUIRED) {
    if (!forbidden.has(action)) {
      reasons.push(`forbidden: missing forbidden action ${action}`);
    }
  }

  if (reasons.length > 0) {
    return { reasons, specSha };
  }

  if (!resolvedEngine.model) {
    reasons.push('engine: no resolved model');
    return { reasons, specSha };
  }

  const scoreScript = path.join(REPO_ROOT, 'scripts', 'engine-scorecard.js');
  let scoreRows = [];
  try {
    scoreRows = runNodeJson(repo, scoreScript, ['current', '--role', storeRole]);
  } catch (err) {
    reasons.push('engine: failed to read scorecard state');
  }

  let engineAssurance = null;
  if (reasons.length === 0) {
    const matched = Array.isArray(scoreRows)
      ? scoreRows.find((row) => isAdmissibleScorecardRow(row, storeRole, resolvedEngine, {
        outputKind: contract.output && contract.output.kind,
      }))
      : null;

    if (!matched) {
      reasons.push('engine: no qualified scorecard row for configured role/engine/runner');
    } else if (matched.status === 'provisional') {
      // Explicit provisional assurance for bounded labor only (implementer commit
      // or verification-author raw-artifact). Never review/verify/merge authority.
      engineAssurance = 'provisional';
    }
  }

  if (reasons.length === 0) {
    // Endpoint must be a string (including "") before any capability partition
    // query. A non-string means unresolved — never fall through to @none/legacy.
    if (typeof resolvedEngine.endpoint !== 'string') {
      reasons.push('engine: missing endpoint in canonical resolver output');
    } else {
      const capScript = path.join(REPO_ROOT, 'scripts', 'engine-capability-state.js');
      let cap;
      try {
        // Exact tuple only — never omit effort/endpoint (legacy ambiguous partition).
        cap = runNodeJson(
          repo,
          capScript,
          capabilityCurrentArgs(resolvedEngine, storeRole),
        );
      } catch (err) {
        reasons.push('quota: failed to read capability state');
      }

      if (cap && (!cap.capability || !cap.capability.quota || cap.capability.quota.status !== 'available')) {
        reasons.push(`quota: quota unavailable for ${resolvedEngine.model} as ${requiredEngineRole}`);
      }
    }
  }

  if (campaignProjection
      && (campaignProjection.runner !== resolvedEngine.runner
        || campaignProjection.model !== resolvedEngine.model)) {
    reasons.push('engine: campaign projection disagrees with resolved runner/model');
  }

  return { reasons, specSha, headSha, baseAtHead, engineAssurance };
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0] !== 'check') {
    usage(2, 'Unsupported command');
  }

  let contractPath = '';
  let repoPath = '';
  let wantJson = false;

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--contract') {
      contractPath = argv[i + 1] || '';
      i += 2;
    } else if (arg === '--repo') {
      repoPath = argv[i + 1] || '';
      i += 2;
    } else if (arg === '--json') {
      wantJson = true;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      usage(0);
    } else {
      usage(2, `unknown argument: ${arg}`);
    }
  }

  if (!contractPath) {
    usage(2, '--contract is required');
  }
  if (!repoPath) {
    usage(2, '--repo is required');
  }
  if (!wantJson) {
    usage(2, '--json is required');
  }

  return { contractPath, repoPath: path.resolve(repoPath) };
}

(function main() {
  try {
    readSchema();
  } catch (err) {
    usage(2, 'Invalid local schema payload');
  }

  const { contractPath, repoPath } = parseArgs(process.argv.slice(2));
  const parsed = checkSchemaCompliance(contractPath, repoPath);

  if (!parsed.loaded) {
    usage(2, parsed.errors[0] || 'invalid contract');
  }

  if (parsed.errors.length > 0) {
    usage(2, parsed.errors.join('\n'));
  }

  const contract = parsed.contract;
  const contractSha = parsed.loaded.hash;
  // endpoint null = unresolved (not the explicit "" → @none wallet).
  const resolvedEngine = { runner: '', model: '', family: '', effort: '', endpoint: null };
  const reasons = [];

  resolveEngine(repoPath, reasons, resolvedEngine, contract.go.required_engine_role);
  const policy = checkPolicy(contract, repoPath, contractSha, resolvedEngine);

  reasons.push(...policy.reasons);

  const specSha = policy.specSha || '';

  if (reasons.length > 0) {
    exitNoGo(contract.unit_id, contractSha, specSha, reasons, {
      runner: resolvedEngine.runner,
      model: resolvedEngine.model,
      family: resolvedEngine.family,
    });
  }

  exitGo(contract.unit_id, contractSha, specSha, {
    runner: resolvedEngine.runner,
    model: resolvedEngine.model,
    family: resolvedEngine.family,
  }, {
    assurance: policy.engineAssurance || null,
  });
})();
