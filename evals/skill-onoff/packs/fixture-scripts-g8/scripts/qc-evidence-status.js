#!/usr/bin/env node
'use strict';

// scripts/qc-evidence-status.js — does HEAD's unpushed range owe review evidence? (P7c QC chip)
//
// Re-derives, for HEAD vs its upstream (origin/HEAD when there is none), exactly what .githooks/pre-push
// decides. It does NOT re-implement the rule: the protected-path + evidence test is scripts/lib/qc-evidence.sh,
// the same file the hook sources; protected paths / evidence mode come from scripts/resolve-qc-gate.sh.
// Verification only: no attestation, no state is written.
//
// Usage: node scripts/qc-evidence-status.js [--repo <dir>]      prints one JSON object, exit 0
// Output: {schema, state, range, protected_files_count, evidence, mode}
//   state     ok          protected files touched AND review evidence found
//             owed        protected files touched, no evidence
//             not_needed  nothing new, no protected file touched, or the gate mode is off
//             unknown     no upstream and no origin/HEAD (or not a git repo / HEAD unresolvable)
//   range     "<base>..HEAD" (null when unknown)
//   evidence  "trailer" | "artifact" (the kind that satisfied the gate) | null
//   mode      block | warn | off (the resolver's value; null when unknown before it was read)
// Exit code is always 0 for a JSON answer; 2 only on bad argv.

const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA = 'autopilot.qc-status/1';
const LIB = path.join(__dirname, 'lib', 'qc-evidence.sh');
const RESOLVE = path.join(__dirname, 'resolve-qc-gate.sh');

function run(cmd, args, cwd, extraEnv) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 15000, env: { ...process.env, ...(extraEnv || {}) } });
}
function git(cwd, args) {
  const r = run('git', args, cwd);
  return r.status === 0 ? r.stdout.trim() : null;
}
function field(cwd, name, fallback) {
  const r = run('bash', [RESOLVE, '--field', name], cwd);
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : fallback;
}

function result(state, range, count, evidence, mode) {
  return { schema: SCHEMA, state, range, protected_files_count: count, evidence, mode };
}

function computeQcStatus({ repo = process.cwd() } = {}) {
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  if (!top || !git(top, ['rev-parse', '--verify', '--quiet', 'HEAD'])) return result('unknown', null, 0, null, null);
  const mode = field(top, 'mode', 'block');
  const base = git(top, ['rev-parse', '--verify', '--quiet', '@{upstream}']) || git(top, ['rev-parse', '--verify', '--quiet', 'origin/HEAD']);
  if (!base) return result('unknown', null, 0, null, mode);
  const range = `${base}..HEAD`;
  if (mode === 'off') return result('not_needed', range, 0, null, mode);
  if (!git(top, ['rev-list', '-n1', range])) return result('not_needed', range, 0, null, mode);
  const csv = field(top, 'protected_paths', 'skills/,agents/,scripts/,references/,hooks/');
  const evidenceMode = field(top, 'evidence', 'trailer');
  // one bash process runs the shared lib: line 1 = protected file count, line 2 = evidence kind ("" = none)
  const script = [
    '. "$QC_LIB"',
    'IFS="," read -r -a PROTECTED <<< "$QC_PATHS"',
    'n=$(qc_protected_files "$QC_RANGE" | grep -c . || true)',
    'echo "$n"',
    'if [ "$n" -gt 0 ] && qc_has_evidence "$QC_RANGE"; then echo "$QC_EVIDENCE_KIND"; else echo; fi',
  ].join('\n');
  const r = run('bash', ['-c', script], top, {
    QC_LIB: LIB, QC_PATHS: csv, QC_RANGE: range, EVIDENCE: evidenceMode, REPO_ROOT: top,
  });
  if (r.status !== 0) return result('unknown', range, 0, null, mode);
  const [countLine, kind] = r.stdout.split('\n');
  const count = parseInt(countLine, 10) || 0;
  if (count === 0) return result('not_needed', range, 0, null, mode);
  if (kind === 'trailer' || kind === 'artifact') return result('ok', range, count, kind, mode);
  return result('owed', range, count, null, mode);
}

module.exports = { SCHEMA, computeQcStatus };

if (require.main === module) {
  const argv = process.argv.slice(2);
  let repo = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo' && argv[i + 1]) { repo = argv[i + 1]; i += 1; } else {
      process.stderr.write('usage: qc-evidence-status.js [--repo <dir>]\n');
      process.exit(2);
    }
  }
  process.stdout.write(`${JSON.stringify(computeQcStatus({ repo }))}\n`);
}
