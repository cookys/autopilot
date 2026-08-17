#!/usr/bin/env node
'use strict';

/**
 * check-blueprint-conformance.js — the frozen-four-tuple round gate
 * (autonomous-brain-integration P1; plan: docs/plans/2026-08-17-autonomous-brain-integration.md).
 *
 * Kills sol failure shapes F1/F3/F4 (mid-run reinvention of granularity, gate set,
 * rubric, or control plane) and F2 (mega-batch: churn-budget breach) BEFORE spend.
 * Evidence base: docs/plans/evidence/2026-08-17-autonomous-brain-integration/sol-pathology.md.
 *
 * Modes:
 *   preflight --contract <file> --intent <file> --repo <dir> [--plugin-root <dir>]
 *             [--ledger <file>] [--json]
 *     Validates a round's DECLARED intent against the contract's frozen_four_tuple
 *     before any runner spawns. Refusals (exit 1):
 *       - pin_drift:        any pinned file's current digest mismatches (incl. the
 *                           governance scripts themselves — an edited gate refuses,
 *                           it does not silently neuter)
 *       - unknown_unit:     intent.unit_id absent from the pinned deliverable DAG
 *       - gate_set_drift:   intent.gate_set != frozen gate set (exact set equality)
 *       - scope_escape:     a declared diff path outside the unit's allowed paths
 *       - churn_budget:     declared files/lines exceed the unit's churn budget
 *       - role_drift:       intent.role != contract.role
 *       - vetoed_basis:     intent.based_on_decisions contains a decision the
 *                           operator vetoed in the decision ledger (needs --ledger)
 *       - missing_pin:      a governance script that exists at --plugin-root is not
 *                           in control_plane_pins (the freeze must cover the gates)
 *   audit --contract <file> --intent <file> --repo <dir> [--manifest-dir <dir>]
 *         [--ledger <file>] [--json]
 *     Post-round backstop from pre-existing sources only: re-verifies pins, then
 *     compares the ACTUAL diff (contract.base_sha..HEAD) against the declared
 *     intent scope and the unit's allowed paths. With --manifest-dir AND --ledger
 *     (P3 extension), every dispatch manifest newer than the contract's base commit
 *     must have a matching ledger entry (kind=dispatch, run_id) — a trace without
 *     a ledger row is an unlogged decision (KR3's ledger-independent universe).
 *
 * Deliverable DAG file format (pinned by frozen_four_tuple.granularity_*):
 *   { "schema": 1, "deliverables": [ { "id": "<token>", "paths": ["dir/", ...],
 *       "churn_budget": { "max_files": N, "max_lines": N } } ] }
 *
 * Intent file format (authored by the brain per round):
 *   { "schema": 1, "unit_id": "...", "role": "implementer",
 *     "gate_set": ["..."], "diff_scope": { "paths": [...],
 *       "churn_estimate": { "files": N, "lines": N } },
 *     "based_on_decisions": ["<decision_id>", ...] }
 *
 * Exit: 0 = conformant · 1 = refused (reasons on stdout) · 2 = usage/precondition.
 * Node >= 20.10 built-ins only (dispatch runtime path).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GOVERNANCE_SCRIPTS = [
  'scripts/check-blueprint-conformance.js',
  'scripts/decision-ledger.js',
  'scripts/check-stall-fuse.js',
  'scripts/next-pick.js',
  'scripts/build-rehydration-bundle.js',
];

function usage(message) {
  process.stderr.write(`check-blueprint-conformance: ${message}\n`);
  process.exit(2);
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    usage(`${label} is unreadable: ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    usage(`${label} is not valid JSON: ${file}`);
  }
  return null;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseArgs(argv) {
  const opts = { json: false };
  const mode = argv[0];
  if (mode !== 'preflight' && mode !== 'audit') {
    usage('mode must be preflight|audit');
  }
  opts.mode = mode;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { opts.json = true; continue; }
    const value = argv[i + 1];
    if (value === undefined) usage(`${arg} needs a value`);
    if (arg === '--contract') opts.contract = value;
    else if (arg === '--intent') opts.intent = value;
    else if (arg === '--repo') opts.repo = value;
    else if (arg === '--plugin-root') opts.pluginRoot = value;
    else if (arg === '--ledger') opts.ledger = value;
    else if (arg === '--manifest-dir') opts.manifestDir = value;
    else if (arg === '--strike-identity-file') opts.strikeIdentityFile = value;
    else if (arg === '--strike-store') opts.strikeStore = value;
    else usage(`unknown argument: ${arg}`);
    i += 1;
  }
  if (!opts.contract || !opts.repo) usage('--contract and --repo are required');
  if (!opts.intent) usage('--intent is required');
  // Strike emission (plan 2026-08-17-brain-seat-exam-suite KR3b): audit-mode only
  // (preflight refusals are pre-spend protection, not seat failures), both flags or
  // neither — a half-wired emitter is a dead gate, refuse it loudly.
  if ((opts.strikeIdentityFile != null) !== (opts.strikeStore != null)) {
    usage('--strike-identity-file and --strike-store must be given together');
  }
  if (opts.mode !== 'audit' && opts.strikeIdentityFile != null) {
    usage('strike flags are audit-mode only');
  }
  return opts;
}

function verifyPins(fft, repo, violations) {
  const pinned = [
    ['granularity', fft.granularity_path, fft.granularity_digest],
    ['rubric', fft.rubric_path, fft.rubric_digest],
    ...Object.entries(fft.control_plane_pins || {}).map(
      ([pinPath, digest]) => [`control_plane:${pinPath}`, pinPath, digest],
    ),
  ];
  for (const [label, pinPath, digest] of pinned) {
    const absolute = path.resolve(repo, pinPath);
    if (!absolute.startsWith(path.resolve(repo) + path.sep)) {
      violations.push({ code: 'pin_drift', detail: `${label}: pinned path escapes the repository` });
      continue;
    }
    if (!fs.existsSync(absolute)) {
      violations.push({ code: 'pin_drift', detail: `${label}: pinned file is missing (${pinPath})` });
      continue;
    }
    const actual = sha256File(absolute);
    if (actual !== digest) {
      violations.push({
        code: 'pin_drift',
        detail: `${label}: frozen surface was modified (digest mismatch for ${pinPath})`,
      });
    }
  }
}

function loadDag(fft, repo, violations) {
  const dagPath = path.resolve(repo, fft.granularity_path);
  if (!fs.existsSync(dagPath)) return null;
  let dag;
  try {
    dag = JSON.parse(fs.readFileSync(dagPath, 'utf8'));
  } catch (err) {
    violations.push({ code: 'pin_drift', detail: 'granularity: pinned DAG is not valid JSON' });
    return null;
  }
  if (!dag || dag.schema !== 1 || !Array.isArray(dag.deliverables)) {
    violations.push({ code: 'pin_drift', detail: 'granularity: pinned DAG has an invalid shape' });
    return null;
  }
  return dag;
}

function pathWithin(candidate, allowedPaths) {
  return allowedPaths.some((allowed) => {
    const normalized = allowed.endsWith('/') ? allowed : `${allowed}`;
    return candidate === normalized
      || (normalized.endsWith('/') && candidate.startsWith(normalized))
      || candidate === allowed;
  });
}

function setEquals(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const entry of sa) if (!sb.has(entry)) return false;
  return true;
}

function readLedgerVetoes(ledgerFile) {
  const vetoed = new Set();
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return vetoed;
  const lines = fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row && row.kind === 'veto' && typeof row.target_decision_id === 'string') {
        vetoed.add(row.target_decision_id);
      }
    } catch (err) {
      // Malformed telemetry lines never grant conformance; they are simply skipped.
    }
  }
  return vetoed;
}

function readLedgerDispatchRuns(ledgerFile) {
  const runs = new Set();
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return runs;
  const lines = fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row && row.kind === 'dispatch' && typeof row.run_id === 'string') {
        runs.add(row.run_id);
      }
    } catch (err) {
      // skip malformed line
    }
  }
  return runs;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const contract = readJson(opts.contract, 'contract');
  const intent = readJson(opts.intent, 'intent');
  if (!contract.frozen_four_tuple) {
    usage('contract carries no frozen_four_tuple — nothing is frozen, refuse to certify');
  }
  const fft = contract.frozen_four_tuple;
  const violations = [];

  // 1. Pin freshness (both modes): an edited frozen surface refuses the round.
  verifyPins(fft, opts.repo, violations);

  // 2. Governance-script pin membership: every governance script that exists at the
  //    plugin root must be pinned — the freeze has to cover the gates themselves.
  const pluginRoot = opts.pluginRoot || path.resolve(__dirname, '..');
  for (const scriptPath of GOVERNANCE_SCRIPTS) {
    if (!fs.existsSync(path.join(pluginRoot, scriptPath))) continue;
    if (!Object.prototype.hasOwnProperty.call(fft.control_plane_pins || {}, scriptPath)) {
      violations.push({
        code: 'missing_pin',
        detail: `control plane must pin ${scriptPath} (the gate scripts are frozen surfaces too)`,
      });
    }
  }

  // 3. Intent shape.
  if (!intent || intent.schema !== 1 || typeof intent.unit_id !== 'string') {
    usage('intent must be {schema:1, unit_id, role, gate_set, diff_scope}');
  }

  const dag = loadDag(fft, opts.repo, violations);
  let unit = null;
  if (dag) {
    unit = dag.deliverables.find((entry) => entry && entry.id === intent.unit_id) || null;
    if (!unit) {
      violations.push({
        code: 'unknown_unit',
        detail: `intent.unit_id '${intent.unit_id}' is not a deliverable in the frozen DAG`,
      });
    }
  }

  if (!Array.isArray(intent.gate_set) || !setEquals(intent.gate_set, fft.gate_set)) {
    violations.push({
      code: 'gate_set_drift',
      detail: 'intent.gate_set must exactly equal the frozen gate set (no additions, no removals)',
    });
  }

  if (intent.role !== contract.role) {
    violations.push({
      code: 'role_drift',
      detail: `intent.role '${intent.role}' differs from contract.role '${contract.role}'`,
    });
  }

  const declaredPaths = intent.diff_scope && Array.isArray(intent.diff_scope.paths)
    ? intent.diff_scope.paths
    : null;
  if (!declaredPaths) {
    usage('intent.diff_scope.paths is required (the declaration KR1 preflight gates on)');
  }
  if (unit) {
    for (const declared of declaredPaths) {
      if (!pathWithin(declared, unit.paths || [])) {
        violations.push({
          code: 'scope_escape',
          detail: `declared path '${declared}' is outside unit '${unit.id}' allowed paths`,
        });
      }
    }
    const churn = (intent.diff_scope && intent.diff_scope.churn_estimate) || {};
    const budget = unit.churn_budget || {};
    if (Number.isFinite(budget.max_files) && Number(churn.files) > budget.max_files) {
      violations.push({
        code: 'churn_budget',
        detail: `declared ${churn.files} files exceeds unit budget ${budget.max_files} (mega-batch refused pre-spend)`,
      });
    }
    if (Number.isFinite(budget.max_lines) && Number(churn.lines) > budget.max_lines) {
      violations.push({
        code: 'churn_budget',
        detail: `declared ${churn.lines} lines exceeds unit budget ${budget.max_lines}`,
      });
    }
  }

  // 4. Vetoed-basis refusal (needs --ledger; absent ledger file → nothing vetoed yet).
  if (Array.isArray(intent.based_on_decisions) && intent.based_on_decisions.length > 0) {
    const vetoed = readLedgerVetoes(opts.ledger);
    for (const decisionId of intent.based_on_decisions) {
      if (vetoed.has(decisionId)) {
        violations.push({
          code: 'vetoed_basis',
          detail: `round builds on vetoed decision '${decisionId}' — undo it first (front-queued repair unit)`,
        });
      }
    }
  }

  // 5. Audit-only: actual diff vs declaration, and manifest↔ledger completeness.
  if (opts.mode === 'audit') {
    const diff = spawnSync('git', ['-C', opts.repo, 'diff', '--name-only', `${contract.base_sha}..HEAD`], {
      encoding: 'utf8',
    });
    if (diff.status !== 0) {
      usage(`audit cannot diff ${contract.base_sha}..HEAD in ${opts.repo}`);
    }
    const actualPaths = diff.stdout.split('\n').filter(Boolean);
    for (const actual of actualPaths) {
      const declared = declaredPaths.some((d) => actual === d
        || (d.endsWith('/') && actual.startsWith(d)));
      const inUnit = unit ? pathWithin(actual, unit.paths || []) : false;
      if (!declared && !inUnit) {
        violations.push({
          code: 'scope_escape',
          detail: `actual change '${actual}' was neither declared nor inside the unit's allowed paths`,
        });
      }
    }
    if (opts.manifestDir && opts.ledger) {
      const loggedRuns = readLedgerDispatchRuns(opts.ledger);
      let manifests = [];
      try {
        manifests = fs.readdirSync(opts.manifestDir).filter((f) => f.endsWith('.manifest.json'));
      } catch (err) {
        usage(`audit cannot read manifest dir ${opts.manifestDir}`);
      }
      for (const manifestFile of manifests) {
        let manifest;
        try {
          manifest = JSON.parse(fs.readFileSync(path.join(opts.manifestDir, manifestFile), 'utf8'));
        } catch (err) {
          continue;
        }
        const runId = manifest && typeof manifest.run_id === 'string' ? manifest.run_id : null;
        if (runId && !loggedRuns.has(runId)) {
          violations.push({
            code: 'unlogged_decision',
            detail: `dispatch manifest '${runId}' has no matching decision-ledger entry (KR3)`,
          });
        }
      }
    }
  }

  const result = {
    schema_version: 1,
    artifact_type: 'blueprint_conformance_result',
    mode: opts.mode,
    conformant: violations.length === 0,
    unit_id: intent.unit_id,
    violations,
  };
  process.stdout.write(opts.json
    ? `${JSON.stringify(result)}\n`
    : `${result.conformant ? 'CONFORMANT' : 'REFUSED'} (${opts.mode}) unit=${intent.unit_id}\n${violations.map((v) => `  - [${v.code}] ${v.detail}`).join('\n')}${violations.length ? '\n' : ''}`);
  if (violations.length > 0 && opts.strikeIdentityFile) {
    // Fail closed: an audit failure that cannot be recorded as a strike must not
    // exit as a plain refusal — the revocation ledger is load-bearing (KR3b).
    try {
      const crypto = require('crypto');
      const state = require('./engine-capability-state');
      const identity = JSON.parse(fs.readFileSync(opts.strikeIdentityFile, 'utf8'));
      const receiptRef = `conformance-${crypto.createHash('sha256')
        .update(JSON.stringify(result)).digest('hex').slice(0, 16)}`;
      const row = state.appendStrikeRecord(
        state.resolveStoreConfig({ store: opts.strikeStore }),
        { identity, source: 'conformance_audit', receiptRef },
      );
      process.stderr.write(`check-blueprint-conformance: strike ${row.event_id} appended for ${row.identity_hash.slice(0, 12)}\n`);
    } catch (err) {
      process.stderr.write(`check-blueprint-conformance: strike append failed closed: ${err.message}\n`);
      process.exit(2);
    }
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

main();
