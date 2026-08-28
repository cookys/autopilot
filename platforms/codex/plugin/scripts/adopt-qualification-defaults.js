#!/usr/bin/env node
'use strict';
//
// adopt-qualification-defaults.js — the CONSUMER side of the shipped official
// qualification defaults.
//
// A consuming repo enabling a heterogeneous role has two honest options:
//
//   (a) ADOPT the official defaults — reuse administrations that autopilot ran
//       in ITS environment, with that environment fully disclosed to you; or
//   (b) SELF-QUALIFY — run the administration here, in YOUR environment, via
//       the existing engine-qualify flow.
//
// (b) is always the stronger evidence. (a) exists because re-running the whole
// roster costs hours of real dispatches, and an administration that already
// happened is routing information regardless of whose machine produced it.
//
// ADR-0001: this is DISCLOSURE, not attestation. Adoption copies rows; it does
// not import a trust claim. Nothing here is signed, witnessed, or digested. An
// earlier cut stamped a `defaults_artifact_sha256` into provenance "for
// re-derivation"; no code ever read it, so it was removed by the depth-0 panel
// ruling. Re-derivation is `build-qualification-defaults.js --check`, which
// byte-compares the whole artifact.
//
// An adopted row is a fully ordinary scorecard row: same seat identity, same
// seat_hash, same strike accrual, same admission path. It is NOT privileged and
// it is NOT protected. See references/qualification-defaults.md.
//
// Usage:
//   node scripts/adopt-qualification-defaults.js list [--role <role>] [--json]
//   node scripts/adopt-qualification-defaults.js adopt (--all | --role <role> | --seat <engine>:<runner>)
//                                                      [--role <role>] [--dry-run] [--force]
//                                                      [--store <dir>] [--artifact <path>]
//
//   list        print every shipped default with its full administration
//               environment. The disclosure block is ALWAYS printed with the
//               verdict — there is deliberately no way to read "QUALIFIED"
//               without reading the environment it was measured in.
//   adopt       copy the chosen rows into the local scorecard store.
//
//   --all       adopt every shipped default (all roles, incl. FAILED rows — a
//               FAILED row is routing information: it keeps a bad seat from
//               being retried by accident).
//   --role      restrict to one role (implementer|reviewer|verification_author|owner|explorer).
//   --seat      restrict to one engine:runner pair.
//   --dry-run   print what would be written; write nothing.
//   --force     re-adopt over a PREVIOUS official-default adoption. It cannot
//               override local evidence - see the seat-collision rule below.
//   --store     destination scorecard store DIRECTORY.
//               Default: $ENGINE_SCORECARD_DIR, else ~/.autopilot/engine-scorecard.
//   --capability-store  destination capability store DIRECTORY. The row's
//               qualifier-store anchor wrapper is appended here (renumbered to a
//               free local event_id, with the scorecard row's
//               evidence_store.event_id renumbered to match) — without it
//               engine-scorecard.js `record` rejects the row.
//               Default: $ENGINE_CAPABILITY_DIR, else ~/.autopilot/engine-capability.
//   --artifact  the shipped defaults artifact.
//               Default: <repo-root>/references/official-qualification-defaults.json
//
// Seat-collision rule: if the destination store already holds a row for the same
// {engine, runner, role} whose `qualified_at` is >= the default's, adoption of
// that seat is REFUSED. A local self-qualification always wins over an imported
// default on the same seat identity — that is the whole override contract, and
// silently shadowing local evidence with someone else's would invert it.
//
// Exit codes:
//   0 = success (rows adopted, or nothing to do, or dry-run printed)
//   1 = refusal / validation failure (local evidence present, already adopted,
//       schema-invalid artifact)
//   2 = usage error

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// Sourced from the registry (plan 2026-08-28-consult-discuss-qualification.md
// §2.6), not hand-listed: the capability namespace, which includes the two
// qualification-seat-only roles `consult` and `discuss` alongside the
// execution roles. Adoption is disclosure of qualification evidence, never an
// execution-authority grant, so the wider namespace is the correct one here.
const { CAPABILITY_ROLE_IDS } = require('../src/engine/roles');
const VALID_ROLES = new Set(CAPABILITY_ROLE_IDS);

function fail(msg, code) {
  process.stderr.write(`adopt-qualification-defaults: ${msg}\n`);
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

function readArtifact(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read defaults artifact: ${file} (${err.code || err.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`defaults artifact is not valid JSON: ${file} (${err.message})`);
  }
  if (parsed.artifact_type !== 'official_qualification_defaults') {
    fail(`not an official qualification defaults artifact (artifact_type='${parsed.artifact_type}'): ${file}`);
  }
  if (!Array.isArray(parsed.defaults) || parsed.defaults.length === 0) {
    fail(`defaults artifact holds no defaults[]: ${file}`);
  }
  // F3 (depth-0 panel): schema-validate the artifact bytes on the CONSUMER side
  // too, before anything is listed or adopted. The generator validates what it
  // writes, but a consumer reads a file that shipped through a package, a
  // mirror, and someone's disk; "the producer checked it once" is not a
  // property of the bytes in front of us. Validating here is what makes the
  // schema a gate on the adoption path rather than a build-time formality.
  // Fail closed if the schema or validator is missing.
  const schemaPath = path.join(REPO_ROOT, 'schemas', 'official-qualification-defaults.schema.json');
  const validator = path.join(SCRIPT_DIR, 'validate-json-schema.js');
  if (!fs.existsSync(schemaPath)) fail(`schema missing, cannot validate the defaults artifact: ${schemaPath}`);
  if (!fs.existsSync(validator)) fail(`validator missing, cannot validate the defaults artifact: ${validator}`);
  const res = spawnSync(process.execPath, [validator, '--schema', schemaPath, '--document', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    fail(`defaults artifact does not satisfy schemas/official-qualification-defaults.schema.json (validator exit ${res.status}): ${(res.stdout || '').trim()} ${(res.stderr || '').trim()}`);
  }
  return { artifact: parsed };
}

function readStoreRows(storeDir) {
  const file = path.join(storeDir, 'scorecard.jsonl');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    fail(`cannot read destination store: ${file} (${err.code || err.message})`);
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      // A malformed line in the destination store is not this tool's problem to
      // repair; skip it rather than refusing to adopt over it.
    }
  }
  return rows;
}

function selfQualifyCommand(entry) {
  const seat = entry.seat;
  const effort = entry.administration && entry.administration.effort;
  const effortFlag = effort && effort !== 'none' ? ` --effort ${effort}` : '';
  return `scripts/engine-qualify.sh ${seat.role} --engine ${seat.engine} --model ${seat.engine} `
    + `--runner ${seat.runner} --family ${entry.administration.family}${effortFlag}`;
}

function selectEntries(artifact, filters) {
  let entries = artifact.defaults.slice();
  if (filters.role) entries = entries.filter((e) => e.role === filters.role);
  if (filters.seat) {
    const [engine, runner] = filters.seat;
    entries = entries.filter((e) => e.seat.engine === engine && e.seat.runner === runner);
  }
  return entries;
}

function formatDisclosure(entry) {
  const a = entry.administration;
  const lines = [];
  lines.push(`${entry.status === 'qualified' ? 'QUALIFIED' : entry.status.toUpperCase()}  ${entry.default_id}`);
  lines.push(`  seat            ${a.engine} / ${a.runner}  (role ${entry.role}, family ${a.family})`);
  lines.push(`  administered    ${a.date}  effort=${a.effort === null ? 'n/a' : a.effort}  version_source=${a.version_source}`);
  lines.push(`  runner version  ${a.runner_version}`);
  lines.push(`  harness         ${a.harness_version}`);
  lines.push(`  corpus          ${a.corpus_version}`);
  lines.push(`  prompt config   ${a.prompt_config_hash}`);
  lines.push(`  model version   ${a.model_version}`);
  lines.push(`  expires         ${a.expires}  (ADVISORY ONLY — never gates admission; see references/strike-decay.md)`);
  if (entry.quality && entry.quality.corpus_pass !== undefined) {
    lines.push(`  result          corpus_pass=${entry.quality.corpus_pass}  capability_score=${entry.capability_score}`);
  } else if (entry.capability_score !== null) {
    lines.push(`  result          capability_score=${entry.capability_score}`);
  }
  lines.push(`  evidence        event ${entry.evidence_pointers.official_event_id} — ${entry.evidence_pointers.evidence_bundle}`);
  lines.push(`  self-qualify    ${selfQualifyCommand(entry)}`);
  return lines.join('\n');
}

function cmdList(opts) {
  const { artifact } = readArtifact(opts.artifact);
  const entries = selectEntries(artifact, opts);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      artifact: path.relative(REPO_ROOT, opts.artifact),
      recipe_version: artifact.recipe_version,
      count: entries.length,
      defaults: entries.map((e) => ({
        default_id: e.default_id,
        role: e.role,
        status: e.status,
        seat: e.seat,
        seat_hash: e.seat_hash,
        administration: e.administration,
        evidence_pointers: e.evidence_pointers,
        self_qualify_command: selfQualifyCommand(e),
      })),
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${artifact.disclosure_notice}\n\n${artifact.adr_0001_notice}\n\n`);
  if (entries.length === 0) {
    process.stdout.write('No shipped defaults match that filter.\n');
    return;
  }
  for (const entry of entries) process.stdout.write(`${formatDisclosure(entry)}\n\n`);
  process.stdout.write(`${entries.length} default(s). Adopt with:  node scripts/adopt-qualification-defaults.js adopt --role <role>\n`);
}

// The qualifier-store ANCHOR. `engine-scorecard.js record` refuses an
// internal_eval row whose `evidence_store` triple does not resolve to a matching
// wrapper in the destination CAPABILITY store, so adopting a scorecard row means
// adopting its evidence wrapper too. The wrapper's `event_id` is store-local, so
// it is renumbered on arrival exactly as the scorecard row's own event_id is —
// and the scorecard row's `evidence_store.event_id` is renumbered WITH it, in
// the same step, so the triple still resolves. Nothing else in either record is
// altered.
function adoptCapabilityEvidence(capabilityDir, wrapper) {
  const file = path.join(capabilityDir, 'qualification-evidence.jsonl');
  let existingRaw = '';
  try {
    existingRaw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') fail(`cannot read capability evidence store: ${file} (${err.code || err.message})`);
  }
  let maxEventId = 0;
  for (const line of existingRaw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let parsed;
    try {
      parsed = JSON.parse(t);
    } catch {
      continue;
    }
    if (parsed && typeof parsed.event_id === 'number') {
      // Already present, byte-for-byte the same administration: reuse it rather
      // than appending a duplicate. `transcript_hash` + `producer` identify the
      // administration; `event_id` is only the local slot.
      if (parsed.producer === wrapper.producer
          && parsed.transcript_hash === wrapper.transcript_hash) {
        return parsed.event_id;
      }
      if (parsed.event_id > maxEventId) maxEventId = parsed.event_id;
    }
  }
  const assigned = maxEventId + 1;
  fs.mkdirSync(capabilityDir, { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ...wrapper, event_id: assigned })}\n`);
  return assigned;
}

function recordRow(storeDir, capabilityDir, row) {
  const tmp = path.join(os.tmpdir(), `adopt-qd-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(tmp, JSON.stringify(row));
  try {
    // Always go through engine-scorecard.js `record` rather than appending to
    // the JSONL directly: `record` owns the write lock, the event_id
    // assignment, and — the load-bearing part — the full row validation
    // including the capability-evidence identity binding. A raw append would
    // let an adopted row into the store that `record` would have rejected.
    const res = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'engine-scorecard.js'), 'record', '--file', tmp], {
      encoding: 'utf8',
      env: { ...process.env, ENGINE_SCORECARD_DIR: storeDir, ENGINE_CAPABILITY_DIR: capabilityDir },
    });
    if (res.status !== 0) {
      fail(`engine-scorecard.js record rejected the adopted row (exit ${res.status}): ${(res.stderr || '').trim()}`);
    }
    return JSON.parse(res.stdout.trim());
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  }
}

function cmdAdopt(opts) {
  const { artifact } = readArtifact(opts.artifact);
  if (!opts.all && !opts.role && !opts.seat) {
    failUsage('adopt requires one of --all, --role <role>, or --seat <engine>:<runner>');
  }
  const entries = selectEntries(artifact, opts);
  if (entries.length === 0) {
    process.stdout.write(`${JSON.stringify({ status: 'nothing_to_adopt', adopted: [] })}\n`);
    return;
  }

  const existing = readStoreRows(opts.storeDir);

  // LOCAL EVIDENCE ALWAYS WINS (depth-0 panel F2).
  //
  // The previous rule compared dates (`localAt >= defaultAt`) and let --force
  // through. Both were wrong, and the date compare failed hardest exactly where
  // it mattered most: a local FAILED row has no `qualified_at`, so localAt was
  // '' and '' >= '2026-08-21' is false — no collision was recorded at all, and
  // an official QUALIFIED default landed silently on top of a local honest
  // FAILURE. A newer official default could also supersede an older local
  // self-qualification.
  //
  // The rule now has nothing to do with dates: if this seat has ANY local row
  // that is not itself a previously-adopted official default, adoption of that
  // seat is refused. Locally-derived evidence — pass or fail — is the stronger
  // tier (engine-onboarding Stage 3) and an import must never overwrite it.
  const collisions = [];
  for (const entry of entries) {
    for (const row of existing) {
      if (row.engine !== entry.seat.engine || row.runner !== entry.seat.runner || row.role !== entry.role) continue;
      const localKind = (row.provenance && row.provenance.kind) || 'self-qualified';
      collisions.push({
        default_id: entry.default_id,
        local_event_id: row.event_id,
        local_status: row.status,
        local_qualified_at: String(row.qualified_at || ''),
        default_qualified_at: String(entry.administration.qualified_at || ''),
        local_provenance: localKind,
        local_is_official_default: localKind === 'official-default',
      });
      break;
    }
  }
  const localEvidenceCollisions = collisions.filter((c) => !c.local_is_official_default);
  const readoptCollisions = collisions.filter((c) => c.local_is_official_default);

  // Never overridable, --force included.
  if (localEvidenceCollisions.length > 0) {
    process.stderr.write(`${JSON.stringify({
      status: 'refused_local_evidence_present',
      reason: "these seats already carry LOCAL evidence (self-qualified rows, pass or fail). A local administration always beats an imported default on the same seat identity, regardless of dates - and --force cannot override this, because there is no situation in which someone else's administration should silently replace your own.",
      collisions: localEvidenceCollisions,
      remedy: 'narrow --seat/--role to the seats that have no local evidence. To replace a local row, run a fresh LOCAL administration (self-qualify); its result supersedes on the same seat.',
    }, null, 2)}\n`);
    process.exit(1);
  }
  // Re-adopting over a previous official-default adoption is the only case
  // --force covers.
  if (readoptCollisions.length > 0 && !opts.force) {
    process.stderr.write(`${JSON.stringify({
      status: 'refused_already_adopted',
      reason: 'these seats already hold a previously-adopted official default.',
      collisions: readoptCollisions,
      remedy: 'pass --force to re-adopt over a previous official-default adoption, or narrow the filter.',
    }, null, 2)}\n`);
    process.exit(1);
  }

  const adopted = [];
  for (const entry of entries) {
    const row = { ...entry.row };
    // F3, later reopened: validate-json-schema.js used to reject every
    // non-integer numeric literal, so an earlier cut shipped capability_score
    // as a lossless decimal STRING and converted it back to a number here.
    // The validator now accepts a non-integer literal whenever it round-trips
    // losslessly, so the artifact carries capability_score as a real JSON
    // number again and no conversion is needed — just fail closed if some
    // artifact still hands this a non-finite or non-numeric value.
    if (typeof row.capability_score !== 'number' || !Number.isFinite(row.capability_score)) {
      fail(`${entry.default_id}: capability_score '${JSON.stringify(row.capability_score)}' is not a finite number`);
    }
    // F6: an adopted row's version_source names HOW THIS ROW GOT HERE, and it
    // got here by adoption. The original administration's value is preserved in
    // provenance disclosure below, so nothing is lost.
    const administrationVersionSource = row.version_source;
    row.version_source = 'official-default';
    row.provenance = {
      kind: 'official-default',
      administration_version_source: administrationVersionSource,
      official_event_id: entry.evidence_pointers.official_event_id,
      default_id: entry.default_id,
      defaults_schema_version: artifact.schema_version,
      defaults_recipe_version: artifact.recipe_version,
      evidence_bundle: entry.evidence_pointers.evidence_bundle,
      adopted_at: new Date().toISOString(),
      self_qualify_command: selfQualifyCommand(entry),
      note: 'Administered in the autopilot maintainer environment disclosed in this row, not in this one. Verification path is re-derivation: self-qualify.',
    };

    if (opts.dryRun) {
      adopted.push({ default_id: entry.default_id, role: entry.role, seat: entry.seat, status: entry.status, would_write: true });
      continue;
    }
    if (entry.capability_evidence) {
      const localEvidenceEventId = adoptCapabilityEvidence(opts.capabilityDir, entry.capability_evidence);
      row.evidence_store = { ...row.evidence_store, event_id: localEvidenceEventId };
    }
    const written = recordRow(opts.storeDir, opts.capabilityDir, row);
    adopted.push({
      default_id: entry.default_id,
      role: entry.role,
      seat: entry.seat,
      status: entry.status,
      local_event_id: written.event_id,
    });
  }

  process.stdout.write(`${JSON.stringify({
    status: opts.dryRun ? 'dry_run' : 'adopted',
    store: opts.storeDir,
    forced_over_collisions: opts.force ? collisions : [],
    count: adopted.length,
    adopted,
    reminder: 'Adopted rows are ordinary seat-scoped strike targets. If a seat accumulates mechanical no-confidence, the remedy is a fresh LOCAL administration (self-qualify) — re-adopting the same default cannot clear it.',
  }, null, 2)}\n`);
}

function parseArgs(argv) {
  const opts = {
    command: null,
    role: null,
    seat: null,
    all: false,
    dryRun: false,
    force: false,
    json: false,
    storeDir: null,
    capabilityDir: null,
    artifact: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n')
        .filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.stdout.write('\n');
      process.exit(0);
    }
    if (arg === 'list' || arg === 'adopt') {
      if (opts.command) failUsage(`two commands given ('${opts.command}' and '${arg}')`);
      opts.command = arg;
      continue;
    }
    if (arg === '--all') { opts.all = true; continue; }
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--role') {
      opts.role = argv[++i];
      if (!opts.role) failUsage('--role requires a value');
      if (!VALID_ROLES.has(opts.role)) failUsage(`invalid role '${opts.role}' (${[...VALID_ROLES].join('|')})`);
      continue;
    }
    if (arg === '--seat') {
      const v = argv[++i];
      if (!v) failUsage('--seat requires <engine>:<runner>');
      const idx = v.lastIndexOf(':');
      if (idx <= 0 || idx === v.length - 1) failUsage(`--seat must be <engine>:<runner>, got '${v}'`);
      opts.seat = [v.slice(0, idx), v.slice(idx + 1)];
      continue;
    }
    if (arg === '--store') { opts.storeDir = argv[++i]; continue; }
    if (arg === '--capability-store') { opts.capabilityDir = argv[++i]; continue; }
    if (arg === '--artifact') { opts.artifact = argv[++i]; continue; }
    failUsage(`unknown argument '${arg}'`);
  }

  if (!opts.command) failUsage('a command is required: list | adopt');
  opts.storeDir = path.resolve(expandTilde(
    opts.storeDir || process.env.ENGINE_SCORECARD_DIR || path.join('~', '.autopilot', 'engine-scorecard'),
  ));
  opts.capabilityDir = path.resolve(expandTilde(
    opts.capabilityDir || process.env.ENGINE_CAPABILITY_DIR || path.join('~', '.autopilot', 'engine-capability'),
  ));
  opts.artifact = path.resolve(expandTilde(
    opts.artifact || path.join(REPO_ROOT, 'references', 'official-qualification-defaults.json'),
  ));
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'list') cmdList(opts);
  else cmdAdopt(opts);
}

if (require.main === module) main();

module.exports = { selfQualifyCommand, formatDisclosure };
