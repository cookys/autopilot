#!/usr/bin/env node
/**
 * qualification-asset-seals.js
 *
 * D4 (plan: docs/plans/2026-08-28-consult-discuss-qualification.md) — load-bearing
 * seal/pin verification for the consult and discuss qualification exams.
 *
 * Extends the existing `verifyPinnedImplEvaluationAssets()` pattern in
 * `scripts/engine-qualify.js` (byte-hash pins checked at every invocation) with
 * the two NEW artifacts that pattern did not carry: a rubric `.md` and its
 * `rubric-freeze.js` seal. Reuses `scripts/rubric-freeze.js`'s sealing format
 * directly (its `spec_sha256` field) rather than re-implementing seal I/O.
 *
 * KR7 / D4: "--plan output carries five identities per role — generator,
 * grader, corpus, rubric, and seal". This module is that five-identity surface,
 * and it REFUSES (throws) on drift in ANY of them, including the rubric's own
 * seal and the corpus manifest's own seal — verified on every call, not just at
 * release time (D4 finding [5]: "seals made load-bearing at every qualifier
 * invocation").
 *
 * Coordination note (2026-08-28, D4 worker): D3 (engine-qualify.js role/registry
 * wiring + `--plan` flag) had not landed a `checkAssetSeals()` stub at the time
 * this file was authored — `scripts/engine-qualify.js` has no `consult`/`discuss`
 * references at all yet. This module is therefore written standalone, in
 * `scripts/lib/`, for D3 (or a follow-up) to `require()` and call from:
 *   (a) the `consult`/`discuss` role router, before any provider/broker call
 *       (mirroring `runImplQualification()`'s `verifyPinnedImplEvaluationAssets()`
 *       call at the top of the function), and
 *   (b) the `--plan` dry-run handler, to print the five frozen identities and
 *       to exit non-zero on drift BEFORE any provider call (KR7).
 *
 * Every function here is a pure verify-and-return-or-throw; no process.exit,
 * no console output — callers own presentation and exit codes.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const REPO_ROOT = path.join(__dirname, '..', '..')

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

// Reads a rubric-freeze.js seal file and returns its pinned spec_sha256.
// Mirrors rubric-freeze.js's own loadSeal() validation (missing/malformed
// seal is a hard failure, never treated as "no seal" / an implicit pass).
function loadSealDigest(sealPath) {
  let raw
  try {
    raw = fs.readFileSync(sealPath, 'utf8')
  } catch (err) {
    throw new Error(`unable to read seal file: ${sealPath}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`seal file is not valid JSON: ${sealPath}`)
  }
  const digest = parsed && parsed.spec_sha256
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`seal file missing valid spec_sha256: ${sealPath}`)
  }
  return digest
}

// Asserts specPath's live bytes match sealPath's pinned spec_sha256.
// Throws with a DRIFT message (never returns a warning) on mismatch.
function assertSealFrozen(specPath, sealPath, label) {
  const specDigest = sha256(specPath)
  const sealedDigest = loadSealDigest(sealPath)
  if (specDigest !== sealedDigest) {
    throw new Error(
      `${label} DRIFT: ${specPath} (sha256 ${specDigest}) does not match its seal ${sealPath} (sealed sha256 ${sealedDigest})`
    )
  }
  return specDigest
}

function assertPinned(filePath, expectedHash, label) {
  const actual = sha256(filePath)
  if (actual !== expectedHash) {
    throw new Error(`${label} drifted from its pinned hash (expected ${expectedHash}, got ${actual})`)
  }
  return actual
}

// ---------------------------------------------------------------------------
// Pinned hashes — sha256 of the file bytes as sealed 2026-08-28 (D1/D2 ship).
// Regenerate with: node -e "console.log(require('crypto').createHash('sha256')
//   .update(require('fs').readFileSync('<path>')).digest('hex'))"
// A pin change must be a deliberate re-seal (rubric-freeze.js seal ... ), never
// a silent edit — that is precisely the drift these constants exist to catch.
// ---------------------------------------------------------------------------

const EXPECTED_CONSULT_GENERATOR_HASH = 'fddf7f4f579f3dfbcafc00b623931b46d270739ddf1df12842ad44c07b82a411'
const EXPECTED_CONSULT_GRADER_HASH = 'aa5e80426b1ffa92abb0d5b90b86e3f2ec12746f3841873b1fd333e0cdc81cd0'
// D7 re-seal (plan 2026-08-28-consult-discuss-qualification.md D7): the
// applicability_scope field was added to both corpus manifests, changing
// their bytes — a deliberate re-seal, per the comment above, not silent
// drift. Only the *_CORPUS_HASH constants move: *_SEAL_HASH pins the
// RUBRIC's seal file (evals/*-eval-rubric.seal.json), which D7 did not
// touch — the corpus manifest's own seal is checked by the live
// assertSealFrozen(p.corpus, p.corpusSeal, ...) relationship check below,
// which has no separate static pin.
const EXPECTED_CONSULT_CORPUS_HASH = 'd34452f3cd29c3218b22e1fe667feae6107d0ff2cc2ab8358e42c1835fdb0730'
const EXPECTED_CONSULT_RUBRIC_HASH = '8c303e33074d97065bf011c33f89a6dddd642837184834ea578ad31c2c0402cc'
const EXPECTED_CONSULT_SEAL_HASH = '1643508f2a53f3383094ebfea04fd49d702605576d6764c88ca4c29f5da3d436'

const EXPECTED_DISCUSS_GENERATOR_HASH = '7c90708c7110c270b48fd1d3c0c563d61504ad4d9f7d8ea93d96fc1713342bbd'
const EXPECTED_DISCUSS_GRADER_HASH = '60864b9302a3a514ac06be2ac56cff7694674933358da19debb2c8305d806bbe'
const EXPECTED_DISCUSS_CORPUS_HASH = 'f2dbb2a7c259503e1a086e38e5cf44775bfc110ac13e7bdd737bac3dc3da6889'
const EXPECTED_DISCUSS_RUBRIC_HASH = '6a60a549626eeeab1f49974f020a059db6e24ac9e1834f44b5a442c4b9b86104'
const EXPECTED_DISCUSS_SEAL_HASH = '7dc0eeb6967ff1beeb5d3be03110d9d89a81dd735e17d7740d1118136b8c7523'

const PATHS = {
  consult: {
    generator: path.join(REPO_ROOT, 'evals', 'consult-eval-generator.js'),
    grader: path.join(REPO_ROOT, 'evals', 'consult-eval-grader.js'),
    corpus: path.join(REPO_ROOT, 'evals', 'consult-capability-evidence-corpus.json'),
    rubric: path.join(REPO_ROOT, 'evals', 'consult-eval-rubric.md'),
    rubricSeal: path.join(REPO_ROOT, 'evals', 'consult-eval-rubric.seal.json'),
    corpusSeal: path.join(REPO_ROOT, 'evals', 'consult-capability-evidence-corpus.seal.json'),
  },
  discuss: {
    generator: path.join(REPO_ROOT, 'evals', 'discuss-eval-generator.js'),
    grader: path.join(REPO_ROOT, 'evals', 'discuss-eval-grader.js'),
    corpus: path.join(REPO_ROOT, 'evals', 'discuss-capability-evidence-corpus.json'),
    rubric: path.join(REPO_ROOT, 'evals', 'discuss-eval-rubric.md'),
    rubricSeal: path.join(REPO_ROOT, 'evals', 'discuss-eval-rubric.seal.json'),
    corpusSeal: path.join(REPO_ROOT, 'evals', 'discuss-capability-evidence-corpus.seal.json'),
  },
}

const EXPECTED = {
  consult: {
    generator: EXPECTED_CONSULT_GENERATOR_HASH,
    grader: EXPECTED_CONSULT_GRADER_HASH,
    corpus: EXPECTED_CONSULT_CORPUS_HASH,
    rubric: EXPECTED_CONSULT_RUBRIC_HASH,
    seal: EXPECTED_CONSULT_SEAL_HASH,
  },
  discuss: {
    generator: EXPECTED_DISCUSS_GENERATOR_HASH,
    grader: EXPECTED_DISCUSS_GRADER_HASH,
    corpus: EXPECTED_DISCUSS_CORPUS_HASH,
    rubric: EXPECTED_DISCUSS_RUBRIC_HASH,
    seal: EXPECTED_DISCUSS_SEAL_HASH,
  },
}

// verifyPinnedEvaluationAssets(role) — the load-bearing check. Verifies, for
// the given role ('consult' | 'discuss'):
//   1. generator/grader/corpus byte hashes match their pinned constants
//      (tamper in the file bytes with the seal left alone).
//   2. the rubric's seal is FROZEN (rubric.md bytes match rubric.seal.json's
//      pinned spec_sha256) — catches BOTH "rubric bytes changed, seal stale"
//      AND "seal changed, rubric bytes intact" (D4's two named negatives).
//   3. the corpus manifest's seal is FROZEN the same way.
//   4. the rubric.md bytes AND the rubric.seal.json bytes each also match
//      their OWN pinned hash constants — so a coordinated tamper of a rubric
//      AND its seal together (which would still satisfy #2's internal
//      consistency check) is still caught, because the pinned constants here
//      are independent of the seal file's own claim.
//
// Throws on ANY drift. Returns { generator_hash, grader_hash, corpus_hash,
// rubric_hash, seal_hash } — the five frozen identities KR7/D4 requires
// `--plan` to print — on success.
function verifyPinnedEvaluationAssets(role) {
  if (role !== 'consult' && role !== 'discuss') {
    throw new Error(`qualification-asset-seals: unknown role '${role}' (expected 'consult' or 'discuss')`)
  }
  const p = PATHS[role]
  const expected = EXPECTED[role]

  const generator_hash = assertPinned(p.generator, expected.generator, `${role} evaluation generator`)
  const grader_hash = assertPinned(p.grader, expected.grader, `${role} evaluation grader`)
  const corpus_hash = assertPinned(p.corpus, expected.corpus, `${role} evaluation corpus`)
  const rubric_hash = assertPinned(p.rubric, expected.rubric, `${role} evaluation rubric`)
  const seal_hash = assertPinned(p.rubricSeal, expected.seal, `${role} evaluation rubric seal`)

  // Seal-relationship checks: catches drift the static pins above cannot —
  // a rubric.md edited alongside its seal.json edited in step (both files'
  // bytes would then differ from the pins above too, but a live re-check of
  // the *relationship* is what the plan calls "refuses to run on seal drift
  // in any mode", independent of whether the pinned constants here happen to
  // be stale).
  assertSealFrozen(p.rubric, p.rubricSeal, `${role} rubric`)
  assertSealFrozen(p.corpus, p.corpusSeal, `${role} corpus manifest`)

  return { generator_hash, grader_hash, corpus_hash, rubric_hash, seal_hash }
}

function verifyPinnedConsultEvaluationAssets() {
  return verifyPinnedEvaluationAssets('consult')
}

function verifyPinnedDiscussEvaluationAssets() {
  return verifyPinnedEvaluationAssets('discuss')
}

// checkAssetSeals(role) — the single call-point D3's role router / `--plan`
// handler should invoke before ANY provider call. Alias kept deliberately
// thin over verifyPinnedEvaluationAssets so both a generic (role-parametrized)
// and a role-specific caller are available without duplicated logic.
function checkAssetSeals(role) {
  return verifyPinnedEvaluationAssets(role)
}

// frozenIdentities(role) — the exact five-key shape `--plan` output should
// print (KR7: "generator, grader, corpus, rubric, seal"). Throws on drift,
// same as verifyPinnedEvaluationAssets — `--plan` must abort on drift, not
// print a warning (D4: "refuses to run on seal drift in any mode").
function frozenIdentities(role) {
  const hashes = verifyPinnedEvaluationAssets(role)
  return {
    role,
    generator: hashes.generator_hash,
    grader: hashes.grader_hash,
    corpus: hashes.corpus_hash,
    rubric: hashes.rubric_hash,
    seal: hashes.seal_hash,
  }
}

module.exports = {
  PATHS,
  EXPECTED,
  verifyPinnedEvaluationAssets,
  verifyPinnedConsultEvaluationAssets,
  verifyPinnedDiscussEvaluationAssets,
  checkAssetSeals,
  frozenIdentities,
}
