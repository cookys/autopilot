'use strict';
// lib/sealed-docs.js — the one list of docs/ files whose BYTES are pinned by a fingerprint.
//
// A sealed doc is frozen record: some runtime re-derives a sha256/digest over its bytes, so a
// one-byte edit (a link rewrite, a path migration, a typo fix) turns a suite red far from the
// edit ("active plan/rubric digest does not match source manifest"). Tools that REWRITE or
// JUDGE docs must skip these. Two such tools exist and both consume this module:
//   - scripts/doc-drift-gate.js       skips sealed files (no link/fence/script-ref check)
//   - scripts/check-plan-graduation.js  frozenAssetFiles() never rewrites them
// The same defect hit three times (6559da33 migrate-archive-layout, BL-0130 graphs, 13976b30
// doc-drift link repair) because each tool kept its own partial list.
//
// What is sealed (derived from the repo, never a hand list):
//   1. docs/mission-*-sources.json: each source's plan_path / rubric_path (relative to docs/),
//      counted only when the paired plan_sha256 / rubric_sha256 is present.
//   2. docs/mission-*-execution-graph.json that carries a top-level `graph_digest`.
// Not sealed on purpose: execution graphs without graph_digest, task-authority envelopes
// (their digests point at the graph/policy, not at their own bytes), docs/plans/*.manifest.json.
//
// API: sealedDocFiles(repoRoot) -> Set<string> of repo-relative POSIX paths. Never throws;
// unreadable manifests are skipped (their own validators report them). Built-ins only.

const fs = require('fs');
const path = require('path');

const SHA256 = /^[0-9a-f]{64}$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function sealedDocFiles(repoRoot) {
  const sealed = new Set();
  const docsDir = path.join(repoRoot, 'docs');
  let names = [];
  try { names = fs.readdirSync(docsDir); } catch { return sealed; }
  for (const name of names.sort()) {
    const rel = `docs/${name}`;
    if (/^mission-.*-sources\.json$/.test(name)) {
      const manifest = readJson(path.join(docsDir, name));
      const sources = manifest && Array.isArray(manifest.sources) ? manifest.sources : [];
      for (const src of sources) {
        if (!src || typeof src !== 'object') continue;
        for (const [pathKey, shaKey] of [['plan_path', 'plan_sha256'], ['rubric_path', 'rubric_sha256']]) {
          if (typeof src[pathKey] === 'string' && src[pathKey] && SHA256.test(String(src[shaKey] || ''))) {
            sealed.add(path.posix.join('docs', src[pathKey].split(path.sep).join('/')));
          }
        }
      }
    } else if (/^mission-.*-execution-graph\.json$/.test(name)) {
      const graph = readJson(path.join(docsDir, name));
      if (graph && typeof graph === 'object' && typeof graph.graph_digest === 'string' && graph.graph_digest) {
        sealed.add(rel);
      }
    }
  }
  return sealed;
}

module.exports = { sealedDocFiles };
