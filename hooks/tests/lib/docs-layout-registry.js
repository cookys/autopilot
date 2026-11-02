#!/usr/bin/env node
'use strict';
// docs-layout-registry.js - test helper: the layout registry of a repo that keeps its work records under docs/
// (this repo at stage bootstrap, and every consuming project today).
//
// Fixtures that model such a repo (a throwaway tree with docs/plans, docs/projects/INDEX.md, docs/BACKLOG.md)
// run the scripts under test with REPO_LAYOUT_REGISTRY pointing at this registry, so they stay green whether the
// live registry of this checkout is at bootstrap (docs/) or at P1 (project/). Fixtures that model THIS repo must
// not use it: they take their paths from the live registry (node scripts/lib/repo-layout.js path <key>).
//
//   node hooks/tests/lib/docs-layout-registry.js <out.json> [--repo DIR]   write the registry
//   require('./docs-layout-registry.js').docsLayout(base)                    pure: base registry -> docs-layout registry
const fs = require('fs');
const path = require('path');

// The path keys that a relayout stage moves out of docs/ (value at stage bootstrap). Built from parts on purpose: a path
// rewriter that follows a relayout rewrites the literal docs/... file names it finds in tracked text, and these are the
// OLD names by definition.
const D = 'docs';
const DOCS_PATHS = {
  plans_dir: `${D}/plans`,
  plans_archive_dir: `${D}/plans/_archive`,
  plans_evidence_dir: `${D}/plans/evidence`,
  projects_dir: `${D}/projects`,
  projects_index: `${D}/projects/INDEX.md`,
  projects_archive_dir: `${D}/projects/_archive`,
  backlog_file: `${D}/BACKLOG.md`,
  missions_dir: D,
  manifest_plan_base: D,
  settings_reference: `${D}/settings-reference.md`,
  hook_harness_matrix_doc: `${D}/hook-harness-matrix.md`,
};

function docsLayout(base) {
  const r = JSON.parse(JSON.stringify(base));
  r.stage = 'bootstrap';
  r.paths = Object.assign({}, r.paths, DOCS_PATHS);
  return r;
}

module.exports = { docsLayout, DOCS_PATHS };

if (require.main === module) {
  const out = process.argv[2];
  const rep = process.argv.indexOf('--repo');
  const repo = rep > 0 ? process.argv[rep + 1] : path.resolve(__dirname, '../../..');
  if (!out) { process.stderr.write('usage: docs-layout-registry.js <out.json> [--repo DIR]\n'); process.exit(2); }
  const L = require(path.join(repo, 'scripts/lib/repo-layout.js'));
  const r = docsLayout(L.DEFAULT_REGISTRY);
  const errs = L.validate(r);
  if (errs.length) { process.stderr.write('docs-layout registry invalid: ' + errs.join('; ') + '\n'); process.exit(1); }
  fs.writeFileSync(out, JSON.stringify(r, null, 1) + '\n');
}
