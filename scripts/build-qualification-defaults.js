#!/usr/bin/env node
'use strict';
//
// build-qualification-defaults.js — derive the shipped official qualification
// defaults artifact from a scorecard store + a selection recipe.
//
// The artifact (references/official-qualification-defaults.json) is what a
// consuming repo adopts when it enables a heterogeneous role without running
// the administrations itself. It is DERIVED, never hand-authored: the roster
// gets re-administered, and a hand-maintained copy would silently rot into a
// claim nobody re-checked.
//
// ADR-0001 (docs/adr/0001-verification-over-attestation.md) is binding here.
// This artifact is DISCLOSURE, not attestation. It carries no hash chain, no
// signature, no witness receipt and no trust root. The `store_projection_sha256`
// it records exists so the artifact can be RE-DERIVED — re-run this script over
// the same store and compare — exactly as references/strike-decay.md justifies a
// strike's `artifact_sha256`. It proves nothing about tampering, and it gates
// nothing. The consumer's real verification path is re-derivation in their own
// environment: self-qualify.
//
// Usage:
//   node scripts/build-qualification-defaults.js build [--store <dir>] [--recipe <path>]
//                                                      [--out <path>] [--repo-root <dir>]
//   node scripts/build-qualification-defaults.js --check [--store <dir>] [--recipe <path>]
//                                                        [--artifact <path>] [--repo-root <dir>]
//
//   --capability-store  capability store DIRECTORY holding qualification-evidence.jsonl.
//                 Default: $ENGINE_CAPABILITY_DIR, else ~/.autopilot/engine-capability.
//                 READ-ONLY. The qualifier-store ANCHOR wrapper for each row is
//                 pulled from here and shipped alongside it: engine-scorecard.js
//                 `record` refuses an internal_eval row whose evidence_store
//                 triple does not resolve in the destination capability store,
//                 so a scorecard row that travels alone is not adoptable.
//   --store       scorecard store DIRECTORY holding scorecard.jsonl.
//                 Default: $ENGINE_SCORECARD_DIR, else ~/.autopilot/engine-scorecard.
//                 READ-ONLY — this script never writes to a scorecard store.
//   --recipe      selection recipe. Default: <repo-root>/references/official-qualification-defaults.recipe.json
//   --out         artifact output path (build). Default: <repo-root>/references/official-qualification-defaults.json
//   --artifact    artifact to verify (--check). Default: same as --out default.
//   --repo-root   repo root used to resolve default paths and evidence bundles.
//                 Default: the parent directory of this script's directory.
//   --check       re-derive in memory and byte-compare against the artifact on
//                 disk. This is the anti-hand-edit gate: any manual edit to the
//                 artifact (or any drift from the store) exits 1.
//
// Determinism contract: the output contains NO wall-clock and NO host-specific
// path. Same store + same recipe + same bundles in ⇒ byte-identical artifact out.
//
// Exit codes:
//   0 = success (build wrote the artifact / --check matched)
//   1 = validation failure (missing event id, bundle/store identity mismatch,
//       or --check byte mismatch)
//   2 = usage error

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const ARTIFACT_SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'official_qualification_defaults';

// Disclosure block: every field a consumer needs to judge whether the official
// administration environment transfers to theirs. Board design point 1 —
// "official environment != user environment; disclose, never hide."
const DISCLOSURE_FIELDS = [
  'engine',
  'model',
  'model_version',
  'version_source',
  'runner',
  'runner_version',
  'family',
  'harness_version',
  'corpus_version',
  'prompt_config_hash',
  'effort',
  'date',
  'qualified_at',
  'expires',
];

// Fields the recipe/store cross-check must agree on between the shipped store
// row and the evidence bundle's own emitted row. A mismatch means the recipe
// points a row at the wrong bundle — fail closed rather than ship a wrong
// evidence pointer.
const CROSSCHECK_FIELDS = [
  'engine',
  'runner',
  'role',
  'status',
  'date',
  'corpus_version',
  'prompt_config_hash',
];

function fail(msg, code) {
  process.stderr.write(`build-qualification-defaults: ${msg}\n`);
  process.exit(code === undefined ? 1 : code);
}

function failUsage(msg) {
  fail(msg, 2);
}

function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Deterministic key ordering + stable stringification. Object.keys() insertion
// order is not a contract we want to inherit from JSON.parse, so every emitted
// object is rebuilt in an explicit order (arrays/objects recursed) before it is
// serialized.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Re-derived locally from the identical two-line algorithm in
// scripts/engine-scorecard.js (seatIdentityHash) — never shelled out
// cross-script, per the note at that call site.
//
// What is actually pinned, stated precisely (a first-pass reviewer caught the
// earlier over-claim here by mutating this function and watching both suites
// stay green): hooks/tests/qualification-defaults.test.sh §7 pins the
// COMMITTED ARTIFACT's seat_hash three ways — against an independent inline
// derivation and against what `engine-scorecard.js seat-status` prints. It
// does not call this function, so a drift here is caught on the NEXT suite run
// after a regeneration is committed, not at the moment the drift is written.
//
// The blast radius of a drift is correspondingly small: the artifact's
// seat_hash is DISCLOSURE only. engine-scorecard.js re-derives seat identity
// live from {engine, runner, role} at read time, so strike accrual on an
// adopted row does not depend on this value being right — a drift ships a
// wrong ADVERTISED hash, not a broken fold.
function seatHash(engine, runner, role) {
  return sha256(canonicalJson({ engine: String(engine), runner: String(runner), role: String(role) }));
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read ${label}: ${file} (${err.code || err.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${label} is not valid JSON: ${file} (${err.message})`);
  }
  return null;
}

function readStoreRows(storeDir) {
  const file = path.join(storeDir, 'scorecard.jsonl');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read scorecard store: ${file} (${err.code || err.message})`);
  }
  const rows = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      fail(`malformed scorecard line ${i + 1} in ${file}: ${err.message}`);
    }
    rows.push(parsed);
  }
  return rows;
}

function readCapabilityEvidenceRows(capabilityDir) {
  const file = path.join(capabilityDir, 'qualification-evidence.jsonl');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    fail(`cannot read capability evidence store: ${file} (${err.code || err.message})`);
  }
  const byEventId = new Map();
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let parsed;
    try {
      parsed = JSON.parse(t);
    } catch {
      continue; // a malformed line in someone else's store is not ours to repair
    }
    if (parsed && typeof parsed.event_id === 'number') byEventId.set(parsed.event_id, parsed);
  }
  return byEventId;
}

function buildEntry(row, recipeEntry, repoRoot, capabilityRows) {
  const eventId = recipeEntry.event_id;

  if (row.role !== recipeEntry.role) {
    fail(`recipe/store role mismatch for event ${eventId}: recipe says '${recipeEntry.role}', store row says '${row.role}'`);
  }

  // Cross-check the evidence bundle. A recipe pointing a row at the wrong
  // bundle is the exact failure evidence-discipline §13 is about: an evidence
  // pointer nobody re-derived certifies nothing.
  const bundleRel = recipeEntry.evidence_bundle;
  const bundleDir = path.resolve(repoRoot, bundleRel);
  if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
    fail(`evidence bundle missing for event ${eventId}: ${bundleRel}`);
  }
  let bundleRow = null;
  for (const candidate of ['record-out.json', 'qualify-out.json', 'emitted-row.json']) {
    const p = path.join(bundleDir, candidate);
    if (fs.existsSync(p)) {
      bundleRow = readJson(p, `evidence bundle row (${candidate})`);
      break;
    }
  }
  if (!bundleRow) {
    fail(`evidence bundle for event ${eventId} holds no record-out.json / qualify-out.json / emitted-row.json: ${bundleRel}`);
  }
  for (const field of CROSSCHECK_FIELDS) {
    if (bundleRow[field] !== row[field]) {
      fail(`evidence-bundle mismatch for event ${eventId} (${bundleRel}): ${field} is '${bundleRow[field]}' in the bundle but '${row[field]}' in the store — the recipe points this row at the wrong bundle`);
    }
  }

  const disclosure = {};
  for (const field of DISCLOSURE_FIELDS) {
    disclosure[field] = row[field] === undefined ? null : row[field];
  }

  // The row that gets copied into a consuming store on adoption. `event_id` is
  // stripped because the destination store assigns its own; everything else
  // rides verbatim so `engine-scorecard.js record`'s evidence-binding
  // validation still passes on the other side.
  const shippedRow = { ...row };
  delete shippedRow.event_id;

  // The qualifier-store anchor. `engine-scorecard.js record` refuses any
  // internal_eval row whose `evidence_store` triple does not resolve to a
  // matching wrapper in the CAPABILITY store (verifyEvidenceStoreAnchor). So a
  // scorecard row alone is not adoptable — the wrapper has to travel with it,
  // or the consumer's `record` rejects the row and the whole defaults idea is
  // inert. This is the difference between "the file exists" and "the flow
  // works" (references/evidence-discipline.md §1).
  let capabilityEvidence = null;
  if (row.evidence && row.evidence.source === 'internal_eval') {
    const anchor = row.evidence_store;
    if (!anchor || typeof anchor.event_id !== 'number') {
      fail(`event ${eventId} carries internal_eval evidence but no evidence_store anchor — it cannot be adopted`);
    }
    const wrapper = capabilityRows.get(anchor.event_id);
    if (!wrapper) {
      fail(`event ${eventId} anchors capability-evidence event ${anchor.event_id}, which is not in the capability store — fail closed rather than ship a default that no consumer can record`);
    }
    if (wrapper.producer !== anchor.producer || wrapper.transcript_hash !== anchor.transcript_hash) {
      fail(`event ${eventId} anchor mismatch: capability-evidence event ${anchor.event_id} has producer='${wrapper.producer}' transcript_hash='${wrapper.transcript_hash}', the scorecard row expects producer='${anchor.producer}' transcript_hash='${anchor.transcript_hash}'`);
    }
    capabilityEvidence = wrapper;
  }

  return {
    default_id: `official:${row.role}:${row.engine}:${row.runner}:${eventId}`,
    role: row.role,
    status: row.status,
    seat: { engine: row.engine, runner: row.runner, role: row.role },
    seat_hash: seatHash(row.engine, row.runner, row.role),
    administration: disclosure,
    quality: row.quality === undefined ? null : row.quality,
    capability_score: row.capability_score === undefined ? null : row.capability_score,
    evidence_pointers: {
      official_event_id: eventId,
      evidence_bundle: bundleRel,
      evidence_store: row.evidence_store === undefined ? null : row.evidence_store,
      evidence_id: (row.evidence && row.evidence.evidence_id) || null,
    },
    row: shippedRow,
    capability_evidence: capabilityEvidence,
  };
}

function deriveArtifact(opts) {
  const recipe = readJson(opts.recipe, 'recipe');
  if (!Array.isArray(recipe.entries) || recipe.entries.length === 0) {
    fail('recipe has no entries[]');
  }

  const rows = readStoreRows(opts.storeDir);
  const capabilityRows = readCapabilityEvidenceRows(opts.capabilityDir);
  const byEventId = new Map();
  for (const row of rows) {
    if (row && typeof row.event_id === 'number') byEventId.set(row.event_id, row);
  }

  const seen = new Set();
  const entries = [];
  for (const recipeEntry of recipe.entries) {
    const eventId = recipeEntry.event_id;
    if (typeof eventId !== 'number') {
      fail(`recipe entry has a non-numeric event_id: ${JSON.stringify(recipeEntry)}`);
    }
    if (seen.has(eventId)) fail(`recipe names event ${eventId} twice`);
    seen.add(eventId);
    const row = byEventId.get(eventId);
    if (!row) {
      fail(`recipe names event ${eventId}, which is not in the scorecard store at ${opts.storeDir} — fail closed rather than ship a default with no administration behind it`);
    }
    entries.push(buildEntry(row, recipeEntry, opts.repoRoot, capabilityRows));
  }

  entries.sort((a, b) => {
    if (a.role !== b.role) return a.role < b.role ? -1 : 1;
    return a.evidence_pointers.official_event_id - b.evidence_pointers.official_event_id;
  });

  const roleCounts = {};
  for (const entry of entries) {
    if (!roleCounts[entry.role]) roleCounts[entry.role] = { qualified: 0, failed: 0, other: 0 };
    if (entry.status === 'qualified') roleCounts[entry.role].qualified += 1;
    else if (entry.status === 'failed') roleCounts[entry.role].failed += 1;
    else roleCounts[entry.role].other += 1;
  }

  const artifact = {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    recipe_version: recipe.recipe_version === undefined ? null : recipe.recipe_version,
    generated_by: 'scripts/build-qualification-defaults.js',
    // No wall-clock: a timestamp here would break the byte-identical
    // regeneration contract and would be a claim about the generator run, not
    // about the administration. The administration dates live per-entry in
    // `administration.date`.
    disclosure_notice: 'These rows record administrations run in the autopilot maintainer\'s environment, not yours. Every entry carries the full administration environment (engine/runner/CLI versions, transport harness, prompt_config_hash, effort, corpus_version, date) precisely because official environment != user environment. FAILED rows ship alongside QUALIFIED ones: a FAILED administration is routing information, not an embarrassment to hide.',
    adr_0001_notice: 'DISCLOSURE, NOT ATTESTATION. Nothing here is signed, hash-chained, or witnessed, and no field is tamper-evidence (ADR-0001). Adopting these defaults is an informed choice to reuse someone else\'s evidence; the only verification path is re-derivation — self-qualify in your own environment via the engine-qualify flow, which overrides a default on the same seat identity.',
    downgrade_notice: 'An adopted default is a seat-scoped strike target exactly like a self-qualified row (references/strike-decay.md). Authority is withdrawn by accumulated mechanical no-confidence, never because a date passed: `expires` is advisory here too.',
    role_summary: roleCounts,
    // Re-derivation aid, never a trust claim: re-run this script over the same
    // store and the same digest must come back. It gates nothing.
    store_projection_sha256: sha256(canonicalJson(entries)),
    defaults: entries,
  };

  return `${JSON.stringify(canonicalize(artifact), null, 2)}\n`;
}

function parseArgs(argv) {
  const opts = {
    mode: null,
    storeDir: null,
    capabilityDir: null,
    recipe: null,
    out: null,
    artifact: null,
    repoRoot: null,
  };

  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n')
        .filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.stdout.write('\n');
      process.exit(0);
    }
    if (arg === '--check') { opts.mode = 'check'; continue; }
    if (arg === 'build' || arg === 'check') { opts.mode = arg === 'check' ? 'check' : 'build'; continue; }
    if (arg === '--store') { opts.storeDir = argv[++i]; continue; }
    if (arg === '--capability-store') { opts.capabilityDir = argv[++i]; continue; }
    if (arg === '--recipe') { opts.recipe = argv[++i]; continue; }
    if (arg === '--out') { opts.out = argv[++i]; continue; }
    if (arg === '--artifact') { opts.artifact = argv[++i]; continue; }
    if (arg === '--repo-root') { opts.repoRoot = argv[++i]; continue; }
    if (arg.startsWith('--')) failUsage(`unknown flag '${arg}'`);
    rest.push(arg);
  }
  if (rest.length > 0) failUsage(`unexpected argument '${rest[0]}'`);

  opts.mode = opts.mode || 'build';
  opts.repoRoot = path.resolve(expandTilde(opts.repoRoot || DEFAULT_REPO_ROOT));
  opts.storeDir = path.resolve(expandTilde(
    opts.storeDir || process.env.ENGINE_SCORECARD_DIR || path.join('~', '.autopilot', 'engine-scorecard'),
  ));
  opts.capabilityDir = path.resolve(expandTilde(
    opts.capabilityDir || process.env.ENGINE_CAPABILITY_DIR || path.join('~', '.autopilot', 'engine-capability'),
  ));
  opts.recipe = path.resolve(expandTilde(
    opts.recipe || path.join(opts.repoRoot, 'references', 'official-qualification-defaults.recipe.json'),
  ));
  const defaultArtifact = path.join(opts.repoRoot, 'references', 'official-qualification-defaults.json');
  opts.out = path.resolve(expandTilde(opts.out || defaultArtifact));
  opts.artifact = path.resolve(expandTilde(opts.artifact || opts.out));
  return opts;
}

// Validate the derived artifact against the committed schema BEFORE it is
// written, so a shape regression cannot reach the repo in the first place.
//
// One documented wrinkle: scripts/validate-json-schema.js preflights its
// document and rejects EVERY non-integer numeric literal
// (UNSUPPORTED_JSON_NUMBER, validate-json-schema.js:161) before any schema
// keyword is evaluated. Our artifact carries verbatim `capability_score`
// floats, which are the ONLY non-integer numbers anywhere in it (asserted in
// hooks/tests/qualification-defaults.test.sh). So the document handed to the
// validator has those floats normalized to 0. The schema places NO constraint
// on `capability_score` at all (empty subschema — it is verbatim scorecard
// data), so the normalization changes no verdict this schema could reach on
// that field either way — and it touches nothing in the disclosure block,
// which is the contract the schema exists to enforce. The validator's
// integer-only restriction is filed as a BACKLOG row, not worked around
// silently.
function validateAgainstSchema(derived, opts) {
  const schemaPath = path.join(opts.repoRoot, 'schemas', 'official-qualification-defaults.schema.json');
  const validator = path.join(SCRIPT_DIR, 'validate-json-schema.js');
  // Fail closed, not silently open: a gate that disables itself when its own
  // schema goes missing is the "script exists but is switched off" failure
  // (references/evidence-discipline.md §1).
  if (!fs.existsSync(schemaPath)) fail(`schema missing, cannot validate the derived artifact: ${schemaPath}`);
  if (!fs.existsSync(validator)) fail(`validator missing, cannot validate the derived artifact: ${validator}`);
  const normalized = derived.replace(/("capability_score": )-?[0-9]+\.[0-9]+/g, '$10');
  const tmp = `${os.tmpdir()}/qualification-defaults-schemacheck-${process.pid}.json`;
  fs.writeFileSync(tmp, normalized);
  try {
    const res = spawnSync(process.execPath, [validator, '--schema', schemaPath, '--document', tmp], { encoding: 'utf8' });
    if (res.status !== 0) {
      fail(`derived artifact does not satisfy schemas/official-qualification-defaults.schema.json (validator exit ${res.status}): ${(res.stdout || '').trim()} ${(res.stderr || '').trim()}`);
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const derived = deriveArtifact(opts);
  validateAgainstSchema(derived, opts);

  if (opts.mode === 'check') {
    let onDisk;
    try {
      onDisk = fs.readFileSync(opts.artifact, 'utf8');
    } catch (err) {
      fail(`cannot read artifact for --check: ${opts.artifact} (${err.code || err.message})`);
    }
    if (onDisk === derived) {
      process.stdout.write(`${JSON.stringify({ status: 'match', artifact: path.relative(opts.repoRoot, opts.artifact), bytes: derived.length })}\n`);
      return;
    }
    const derivedLines = derived.split('\n');
    const diskLines = onDisk.split('\n');
    let firstDiff = -1;
    for (let i = 0; i < Math.max(derivedLines.length, diskLines.length); i += 1) {
      if (derivedLines[i] !== diskLines[i]) { firstDiff = i + 1; break; }
    }
    process.stderr.write(`${JSON.stringify({
      status: 'mismatch',
      artifact: path.relative(opts.repoRoot, opts.artifact),
      first_differing_line: firstDiff,
      on_disk: diskLines[firstDiff - 1] === undefined ? null : diskLines[firstDiff - 1].slice(0, 200),
      re_derived: derivedLines[firstDiff - 1] === undefined ? null : derivedLines[firstDiff - 1].slice(0, 200),
      remedy: 'the artifact is DERIVED — do not hand-edit it. Re-run: node scripts/build-qualification-defaults.js build',
    }, null, 2)}\n`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const tmp = `${opts.out}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, derived);
  fs.renameSync(tmp, opts.out);
  process.stdout.write(`${JSON.stringify({
    status: 'written',
    artifact: path.relative(opts.repoRoot, opts.out),
    entries: JSON.parse(derived).defaults.length,
    bytes: derived.length,
  })}\n`);
}

if (require.main === module) main();

module.exports = { deriveArtifact, seatHash, canonicalJson, DISCLOSURE_FIELDS };
