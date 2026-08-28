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

// combinedSealHash(rubricSealFileHash, corpusSealFileHash) -- ONE digest
// binding BOTH seal files' OWN bytes together (2026-08-29, hetero review
// finding [seal-pin-scope]). Before this fix, EXPECTED_*_SEAL_HASH pinned
// ONLY the rubric's seal file (evals/*-eval-rubric.seal.json); the corpus
// manifest's seal file (evals/*-capability-evidence-corpus.seal.json) had
// NO static pin on its own bytes at all -- only assertSealFrozen's relation
// check (corpus.json's live hash equals what corpus.seal.json CLAIMS),
// which says nothing about whether corpus.seal.json's OWN bytes are the
// ones that were actually reviewed/frozen. depth-0 caught this concretely:
// the frozenIdentities() output reported the RUBRIC seal's hash under the
// generic `seal` key while the CORPUS seal file (sha256
// 4117459c...) carried no verified identity anywhere in the five-identity
// surface at all -- an output that looks like "the seal is fine" without
// ever having looked at the file that would actually catch a corpus-seal
// tamper. Fix: hash BOTH seal files, bind them into one combined digest,
// and pin THAT -- preserves the "five identities" KR7 contract (still one
// `seal` field) while making it cover both files; a byte change in EITHER
// seal file changes the combined hash and refuses.
function combinedSealHash(rubricSealFileHash, corpusSealFileHash) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ rubric_seal: rubricSealFileHash, corpus_seal: corpusSealFileHash }))
    .digest('hex')
}

// ---------------------------------------------------------------------------
// Pinned hashes — sha256 of the file bytes as sealed 2026-08-28 (D1/D2 ship).
// Regenerate with: node -e "console.log(require('crypto').createHash('sha256')
//   .update(require('fs').readFileSync('<path>')).digest('hex'))"
// A pin change must be a deliberate re-seal (rubric-freeze.js seal ... ), never
// a silent edit — that is precisely the drift these constants exist to catch.
// ---------------------------------------------------------------------------

// 2026-08-29 re-seal (depth-0 consult/discuss disclosure fix, rulings 1/2/3/5):
// consult generator+grader and consult+discuss corpus manifests changed
// bytes (closed_label_set disclosure, C2 fabricated-id removal, C4/C5
// distractor redesign, C4 aside_span_token disclosure, discuss declared_axes
// disclosure, corpus_version bump to *-v2). discuss's grader.js was NOT
// touched, so its hash is unchanged below.
//
// 2026-08-29 re-seal (fix/consult-grader-c4c5-v2): the C4/C5 exam-design
// instrument fixes changed generator.js (dropped the dead aside_required
// oracle field, added two positive-control checks -- c4_silent_aside /
// c5_no_magic_phrase) and grader.js (scopeDrift no longer auto-fails an
// empty aside; authorityViolation no longer requires an undisclosed magic
// phrase) -- deliberate re-seals, not drift. corpus_version bumped
// consult-v3 -> consult-v4 (byte change from the version bump only;
// discuss is untouched).
const EXPECTED_CONSULT_GENERATOR_HASH = 'f995d91357498b69ef9c30dcf5bbfb95f192d96e1890e633e17a37ae4f6d3218'
const EXPECTED_CONSULT_GRADER_HASH = '82616d4c17459839882653c898e9479128a175697fbbcc18b0bca1af9325dac0'
// D7 re-seal (plan 2026-08-28-consult-discuss-qualification.md D7): the
// applicability_scope field was added to both corpus manifests, changing
// their bytes — a deliberate re-seal, per the comment above, not silent
// drift. Only the *_CORPUS_HASH constants moved at the time.
//
// 2026-08-29 SEAL-PIN RESTRUCTURE (hetero review finding [seal-pin-scope]):
// *_SEAL_HASH used to pin ONLY the rubric's seal file bytes — the corpus
// manifest's own seal file had no static pin at all (see
// combinedSealHash()'s header comment for the concrete depth-0 finding).
// *_SEAL_HASH is now combinedSealHash(rubricSealFileHash,
// corpusSealFileHash) — it moves whenever EITHER seal file's bytes change,
// including a re-seal that touches only the corpus seal (as this same
// change does below: the consult corpus_version bumped to consult-v3
// alongside the C4/C5 distractor redesign, requiring a corpus reseal).
const EXPECTED_CONSULT_CORPUS_HASH = 'b3dd42888c0ad5d128f41d40a4754573135152229bd84a54b0d93d7346ea292c'
const EXPECTED_CONSULT_RUBRIC_HASH = '8c303e33074d97065bf011c33f89a6dddd642837184834ea578ad31c2c0402cc'
const EXPECTED_CONSULT_SEAL_HASH = 'd6e391d10dbc44bcf5b5a8c98eb0f30c0c80749bcead318a44eda2feaceeff03'

const EXPECTED_DISCUSS_GENERATOR_HASH = 'c95ed1f514a39eca6d03ea3bb0298bbab95ddea32550bd12551bd8be7e056b0f'
const EXPECTED_DISCUSS_GRADER_HASH = '60864b9302a3a514ac06be2ac56cff7694674933358da19debb2c8305d806bbe'
const EXPECTED_DISCUSS_CORPUS_HASH = '36d1070ff1d4798eb9cf8bf8a74772b41462e6c1396baa3c84cdfc71b48d8e2f'
const EXPECTED_DISCUSS_RUBRIC_HASH = '6a60a549626eeeab1f49974f020a059db6e24ac9e1834f44b5a442c4b9b86104'
// discuss's rubric-seal and corpus-seal FILE BYTES are unchanged this round
// (only consult's grader/generator/corpus moved) -- but the COMBINED-HASH
// FORMULA changed for both roles, so this constant moves too even though
// its inputs did not: it now reports the combined identity, not just the
// rubric seal's.
const EXPECTED_DISCUSS_SEAL_HASH = 'e51b8eefd2f903a58a89f25d9598754adede238a56b97f42a63b022bc28ccfff'

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

  // seal_hash: hash BOTH seal files' OWN bytes and bind them into one
  // combined digest (combinedSealHash, see its header comment) — pinned
  // against expected.seal, refusing on a mismatch in EITHER seal file. This
  // is what makes the `seal` identity `--plan` prints an honest claim about
  // BOTH seal files, not just the rubric's.
  const rubricSealFileHash = sha256(p.rubricSeal)
  const corpusSealFileHash = sha256(p.corpusSeal)
  const seal_hash = combinedSealHash(rubricSealFileHash, corpusSealFileHash)
  if (seal_hash !== expected.seal) {
    throw new Error(
      `${role} evaluation seal drifted from its pinned combined hash `
      + `(rubric-seal ${rubricSealFileHash}, corpus-seal ${corpusSealFileHash} `
      + `-> combined ${seal_hash}, expected ${expected.seal})`
    )
  }

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

// sealedSetHash(role) — ONE canonical digest binding ALL FIVE frozen
// identities (generator, grader, corpus, rubric, seal) together (hetero
// review finding [evidence-asset-binding], 2026-08-28: the persisted
// evidence previously bound only the corpus manifest's own hash into
// methodology.corpus_manifest_hash — generator/grader/rubric/seal drift was
// invisible to anything reading the RECORDED row back, even though `--plan`
// and every live invocation already verify all five before running).
// Consumed as evidence methodology.corpus_manifest_hash for consult/discuss
// specifically (scripts/engine-qualify.js) instead of the bare corpus hash —
// a single opaque digest is sufficient because assertSealedEvidenceBinding
// below recomputes it FRESH from the currently pinned assets and refuses a
// mismatch; adding five new fields to the shared methodology schema
// (src/engine/capability-evidence.js) would ripple into every OTHER
// methodology kind's record shape for no additional tamper-evidence.
function sealedSetHash(role) {
  const identities = verifyPinnedEvaluationAssets(role)
  return crypto.createHash('sha256').update(JSON.stringify({
    generator: identities.generator_hash,
    grader: identities.grader_hash,
    corpus: identities.corpus_hash,
    rubric: identities.rubric_hash,
    seal: identities.seal_hash,
  })).digest('hex')
}

// assertSealedEvidenceBinding(role, evidence) — the RECORD-PATH guard
// (hetero review finding [evidence-asset-binding]): recomputes the sealed-
// set hash from the CURRENTLY PINNED assets and refuses to persist/accept
// an evidence row whose methodology.corpus_manifest_hash does not match it.
// This is independent of (and stronger than) src/engine/capability-
// evidence.js's own trial-vs-methodology internal-consistency check — that
// check only proves the row is internally coherent, never that its binding
// is FRESH against what is pinned on THIS host right now. Call this
// immediately before appendQualifierEvidence (or any other record-path
// write) for consult/discuss evidence.
function assertSealedEvidenceBinding(role, evidence) {
  const expected = sealedSetHash(role)
  const actual = evidence && evidence.methodology && evidence.methodology.corpus_manifest_hash
  if (actual !== expected) {
    throw new Error(
      `${role} evidence sealed-set binding mismatch: methodology.corpus_manifest_hash `
      + `(${actual}) does not match the current pinned sealed-set hash (${expected}) — `
      + 'refusing to record (a stale or forged binding must never be treated as fresh evidence)'
    )
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
  sealedSetHash,
  assertSealedEvidenceBinding,
}
