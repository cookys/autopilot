#!/usr/bin/env node
'use strict';

// qualification-applicability-scope.js
//
// D7 (plan docs/plans/2026-08-28-consult-discuss-qualification.md, "the
// applicability-scope contract"): ONE frozen production {task_classes,
// domains, languages, tool_surface} scope tuple per consult/discuss role,
// declared in the corpus manifest (evals/<role>-capability-evidence-
// corpus.json's `applicability_scope` field) and sealed with the rubric.
//
// BOTH sides derive it from this same manifest constant; neither side
// accepts it from a caller. `resolve-review-loop.sh` calls `write-scope`
// (below) to construct the scope file it hands to `engine-scorecard.js
// seat-status --require-evidence`; a would-be qualifier row must be issued
// under evidence whose scope compiles to the identical bytes (identical
// canonicalJson -> identical scope_hash) for `--require-evidence` to ever
// treat it as applicable. Fail-closed, not skip: any manifest read/shape
// problem throws (exit 1 from the CLI below; the resolver wraps that as
// exit 3), never a silently empty/default scope.

const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('../../src/engine/owner-kernel/canonical');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const CORPUS_PATHS = {
  consult: path.join(REPO_ROOT, 'evals', 'consult-capability-evidence-corpus.json'),
  discuss: path.join(REPO_ROOT, 'evals', 'discuss-capability-evidence-corpus.json'),
};

const SCOPE_FIELDS = ['task_classes', 'domains', 'languages', 'tool_surface'];

function frozenScopeForRole(role) {
  const corpusPath = CORPUS_PATHS[role];
  if (!corpusPath) {
    throw new Error(`qualification-applicability-scope: no frozen applicability scope for role '${role}'`);
  }
  if (!fs.existsSync(corpusPath)) {
    throw new Error(`qualification-applicability-scope: applicability-scope manifest is absent: ${corpusPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  } catch (error) {
    throw new Error(`qualification-applicability-scope: applicability-scope manifest is unreadable or malformed: ${corpusPath} (${error.message})`);
  }
  const scope = manifest && manifest.applicability_scope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error(`qualification-applicability-scope: manifest is missing applicability_scope: ${corpusPath}`);
  }
  for (const field of SCOPE_FIELDS) {
    if (!Array.isArray(scope[field])) {
      throw new Error(`qualification-applicability-scope: applicability_scope.${field} must be an array: ${corpusPath}`);
    }
  }
  return {
    task_classes: [...scope.task_classes],
    domains: [...scope.domains],
    languages: [...scope.languages],
    tool_surface: [...scope.tool_surface],
  };
}

// Byte-identical construction is the point: the resolver never widens,
// narrows, or otherwise re-derives this — it writes exactly this object's
// canonicalJson, so its scope_hash matches whatever a D1/D2-emitted row's
// evidence.scope compiles to when built from the same manifest constant.
function writeScopeFile(role, destPath) {
  const scope = frozenScopeForRole(role);
  fs.writeFileSync(destPath, canonicalJson(scope));
  return destPath;
}

module.exports = {
  CORPUS_PATHS,
  frozenScopeForRole,
  writeScopeFile,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === 'write-scope') {
    let role = null;
    let out = null;
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === '--role') role = args[++i];
      else if (args[i] === '--out') out = args[++i];
    }
    if (!role || !out) {
      process.stderr.write('usage: qualification-applicability-scope.js write-scope --role <consult|discuss> --out <path>\n');
      process.exit(2);
    }
    try {
      writeScopeFile(role, out);
      process.exit(0);
    } catch (error) {
      process.stderr.write(`ERROR: ${error.message}\n`);
      process.exit(1);
    }
  } else {
    process.stderr.write('usage: node qualification-applicability-scope.js write-scope --role <role> --out <path>\n');
    process.exit(2);
  }
}
