#!/usr/bin/env node
'use strict';

/**
 * derive-hashes.js — deterministic derivation of the three engine-qualify.js
 * identity fingerprints for the consult/discuss administration bundle
 * (docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/).
 *
 * Recipe (per the Board-authorized administration task and the spirit of
 * docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/README.md's
 * "Frozen corpus identity" section):
 *
 *   prompt_config_hash    = sha256(corpus JSON bytes ‖ generator source bytes)
 *   semantic_fingerprint  = sha256(canonicalJson({corpus_version, families,
 *                            thresholds, canary_closure}))  — "canary_closure"
 *                            is the D3 negative-control admission marker: the
 *                            --plan case-plan's admission.negative_control_
 *                            admission_failed boolean must be true (the
 *                            planted negative control is CAUGHT — that is
 *                            what proves the corpus/grader is not overfit).
 *                            Recorded here as a literal string so the
 *                            fingerprint is reproducible without re-running
 *                            --plan.
 *   containment_fingerprint = sha256 of scripts/qualification-review-provider.js
 *                            bytes (the transport blob consult/discuss run
 *                            through via --remote-provider-cmd). NOTE: git's
 *                            own blob id is SHA-1 (40 hex) and does NOT fit
 *                            engine-qualify.js's SHA-256 digest() validator
 *                            (/^[a-f0-9]{64}$/), so this uses a plain sha256
 *                            of the file bytes, not `git rev-parse :path`.
 *
 * Usage: node derive-hashes.js   (no args; prints one JSON object per role
 * plus the shared containment fingerprint; deterministic given the repo
 * state at HEAD)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function deriveForRole(role) {
  const corpusPath = path.join(REPO_ROOT, 'evals', `${role}-capability-evidence-corpus.json`);
  const generatorPath = path.join(REPO_ROOT, 'evals', `${role}-eval-generator.js`);
  const corpusBytes = fs.readFileSync(corpusPath);
  const generatorBytes = fs.readFileSync(generatorPath);
  const promptConfigHash = sha256(Buffer.concat([corpusBytes, generatorBytes]));

  const corpus = JSON.parse(corpusBytes.toString('utf8'));
  const semanticInput = JSON.stringify({
    corpus_version: corpus.corpus_version,
    families: corpus.families,
    thresholds: corpus.thresholds,
    // The D3 negative-control admission marker (see header comment). Recorded
    // as observed from a real `--plan` run of this corpus (both consult and
    // discuss --plan output negative_control_admission_failed: true).
    canary_closure: 'negative_control_admission_failed:true',
  });
  const semanticFingerprint = sha256(Buffer.from(semanticInput, 'utf8'));

  return {
    role,
    corpus_path: path.relative(REPO_ROOT, corpusPath),
    generator_path: path.relative(REPO_ROOT, generatorPath),
    prompt_config_hash: promptConfigHash,
    semantic_fingerprint: semanticFingerprint,
  };
}

function deriveContainmentFingerprint() {
  const providerPath = path.join(REPO_ROOT, 'scripts', 'qualification-review-provider.js');
  const bytes = fs.readFileSync(providerPath);
  return {
    provider_path: path.relative(REPO_ROOT, providerPath),
    containment_fingerprint: sha256(bytes),
  };
}

function main() {
  const result = {
    consult: deriveForRole('consult'),
    discuss: deriveForRole('discuss'),
    containment: deriveContainmentFingerprint(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
}

main();
