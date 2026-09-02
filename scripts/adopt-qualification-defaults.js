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
//   node scripts/adopt-qualification-defaults.js list [--role <role>] [--json] [--from <url|path>]
//   node scripts/adopt-qualification-defaults.js adopt (--all | --role <role> | --seat <engine>:<runner>)
//                                                      [--role <role>] [--dry-run] [--force]
//                                                      [--store <dir>] [--artifact <path>]
//                                                      [--from <url|path>] [--priors]
//
//   --from      read the defaults from a qualification FEED instead of the shipped artifact.
//               An https URL or a local path. The body is bounded, redirects are refused, and
//               the document is cached content-addressed under
//               ~/.autopilot/qualification-feeds/<sha256-of-what-we-received>/ with a `current`
//               manifest. Cache dir override: --feed-cache-dir.
//
//               A feed is a REMOTE DOCUMENT WRITTEN BY SOMEONE ELSE. Nothing about it is
//               trusted: its `digest` is reported, never believed (our cache key is always our
//               own hash of the bytes we received — a declared `digest_basis` only changes how
//               loudly a difference is reported), and every seat_hash is RE-DERIVED locally
//               from (engine, runner, role, effort) rather than adopted from the feed. A hash
//               you did not compute is a claim (ADR-0001).
//
//               There is no timer and no auto-adopt. `--from` on `list` fetches and prints;
//               adoption is always a separate, explicit command.
//   --priors    with `adopt --from`: also append the feed's `priors[]` as provisional
//               `external_prior` evidence via the existing record-evidence path. Priors are
//               NEVER qualifications — nothing in a feed can produce a `qualified` row that was
//               not `internal_eval` upstream.
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

// ~/.autopilot/config.json `qualification_feed.url`, so an operator who has settled on a feed
// need not retype it. OPT-IN ONLY: absence changes nothing, a malformed config is ignored rather
// than fatal (it must never break the shipped-artifact path), and this still only supplies the
// URL — it never triggers a fetch or an adoption on its own.
// EVERY string that reaches the terminal from a feed passes through one of these.
//
// A feed is untrusted by construction — that is the premise of the whole `--from` path — and its
// text was being printed raw. A hostile `digest_basis` could embed a newline plus a forged
// "advertised <hash> — matches" line, so the document could dictate what the tool appeared to say
// about it, and an ANSI escape could repaint or hide the rest of the output. Reproduced before
// fixing; pinned by a hostile-string case in hooks/tests/qualification-feed-adopt.test.sh.
//
// The original value is NEVER altered in structured output or in provenance: `--json` and the
// adopted row keep the bytes as received, because that is the record. Only the human rendering is
// sanitized, which is where the deception would land.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// One line: newlines become a visible marker rather than real line breaks, so a value can never
// manufacture output that looks like this tool's own.
function safeLine(value, max = 300) {
  const text = String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?|\n/g, '\\n')
    .replace(CONTROL_CHARS, '\uFFFD');
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

// Multi-line, for the disclosure notices that are printed verbatim by design: real newlines are
// kept (they are the formatting), every other control character is not.
function safeBlock(value, max = 8000) {
  const text = String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '\uFFFD');
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

function readConfiguredFeedUrl() {
  const file = path.join(os.homedir(), '.autopilot', 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const url = cfg && cfg.qualification_feed && cfg.qualification_feed.url;
    return typeof url === 'string' && url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

// RE-DERIVED locally, never read from the feed. Must stay identical to
// engine-scorecard.js seatIdentityHash / engine-capability-state.js normalizeSeatIdentity:
// effort only when present, so a legacy (effort-less) seat keeps its original hash.
function localSeatHash(engine, runner, role, effort) {
  const obj = {
    engine: String(engine),
    runner: String(runner),
    role: String(role),
    ...(effort === undefined || effort === null ? {} : { effort: String(effort) }),
  };
  const canonical = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// What this consumer's environment actually is, for the environment (never gating) comparison.
// The runner version costs a `--version` call and is best-effort: a probe failure is reported as
// unknown, not as a mismatch, because "I could not look" and "it differs" are different facts.
function localEnvironment(runner) {
  const out = { runner_version: null, runner_version_source: 'unprobed' };
  try {
    const res = spawnSync(process.execPath, [
      path.join(SCRIPT_DIR, 'lib', 'runner-binary.js'), 'version', '--runner', runner, '--json',
    ], { encoding: 'utf8', timeout: 20_000 });
    if (res.status === 0) {
      const parsed = JSON.parse(res.stdout);
      if (parsed && parsed.ok && typeof parsed.token === 'string') {
        out.runner_version = parsed.token;
        out.runner_version_source = 'probe';
      } else {
        out.runner_version_source = 'probe_failed';
      }
    } else {
      out.runner_version_source = 'probe_failed';
    }
  } catch {
    out.runner_version_source = 'probe_failed';
  }
  return out;
}

// Per-entry applicability, split the way the identity itself is split (Board 2026-09-02).
// EXAM identity is what gates; ENVIRONMENT only ever warns. This function REPORTS both and
// decides nothing — `adopt` still applies its own seat-collision rule.
function feedEntryApplicability(entry) {
  const a = entry.administration || {};
  const seat = entry.seat || {};
  const effort = seat.effort === undefined ? a.effort : seat.effort;
  const derived = localSeatHash(seat.engine, seat.runner, seat.role, effort);
  const env = localEnvironment(seat.runner);
  return {
    effort: effort === undefined ? null : effort,
    seat_hash_derived: derived,
    seat_hash_advertised: entry.seat_hash || null,
    // A mismatch means the producer's seat-identity algorithm and ours disagree. That is worth
    // shouting about — it is exactly how a strike gets attached to a seat nobody reads — but it
    // is a DIFF, not an admission decision, so it warns.
    seat_hash_matches: entry.seat_hash ? entry.seat_hash === derived : null,
    // Distinguishing WHY it differs is the difference between an actionable message and noise.
    // A feed built before effort joined the seat identity advertises the three-field hash, which
    // we can reproduce exactly — so we can say "your feed predates effort partitioning" instead
    // of "our algorithms disagree", and the producer knows precisely what to regenerate.
    seat_hash_basis: entry.seat_hash
      ? (entry.seat_hash === derived
        ? 'agrees'
        : (entry.seat_hash === localSeatHash(seat.engine, seat.runner, seat.role, undefined)
          ? 'legacy_three_field'
          : 'unknown'))
      : 'absent',
    environment: {
      feed_runner_version: a.runner_version === undefined ? null : a.runner_version,
      local_runner_version: env.runner_version,
      local_runner_version_source: env.runner_version_source,
      runner_version_matches: env.runner_version === null
        ? null
        : env.runner_version === a.runner_version,
      feed_harness_version: a.harness_version === undefined ? null : a.harness_version,
      // harness_version names the PRODUCER's dispatch harness commit. There is no honest local
      // equivalent to compare it against here, so it is disclosed, not diffed.
      harness_version_comparable: false,
    },
    gating: 'exam identity only — environment differences never make a row inapplicable',
  };
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

// `list --from`: fetch, cache, and print. Never adopts, never writes to a store.
async function cmdListFeed(opts) {
  const { loadFeed } = require('./lib/qualification-feed.js');
  let feed;
  try {
    feed = await loadFeed(opts.from, {
      ...(opts.feedCacheDir ? { cacheDir: expandTilde(opts.feedCacheDir) } : {}),
    });
  } catch (err) {
    fail(err.message);
  }
  const entries = selectEntries({ defaults: feed.defaults }, opts);
  const rows = entries.map((e) => ({ entry: e, applicability: feedEntryApplicability(e) }));

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      from: opts.from,
      origin: feed.origin,
      source_kind: feed.source_kind,
      feed_schema: feed.feed_schema,
      digest: feed.digest,
      advertised_digest: feed.advertised_digest,
      advertised_digest_basis: feed.advertised_digest_basis,
      advertised_digest_is_producer_internal: feed.advertised_digest_is_producer_internal,
      digest_matches_advertised: feed.digest_matches_advertised,
      previous_digest: feed.previous_digest,
      changed: feed.changed,
      counts: { defaults: feed.defaults.length, strikes: feed.strikes.length, priors: feed.priors.length },
      defaults: rows.map(({ entry, applicability }) => ({
        default_id: entry.default_id,
        role: entry.role,
        status: entry.status,
        seat: entry.seat,
        administration: entry.administration,
        feed: entry.feed || null,
        board: entry.board || null,
        applicability,
        self_qualify_command: selfQualifyCommand(entry),
      })),
      strikes: feed.strikes.map((strike) => describeFeedStrike(strike)),
      priors: feed.priors.length,
    }, null, 2)}\n`);
    return;
  }

  // The disclosure block is printed VERBATIM and FIRST, exactly as the shipped-artifact path
  // does: there is deliberately no way to read a verdict without reading the environment it was
  // measured in.
  const doc = feed.doc;
  for (const notice of ['disclosure_notice', 'adr_0001_notice', 'downgrade_notice']) {
    if (typeof doc[notice] === 'string' && doc[notice].length > 0) {
      process.stdout.write(`${safeBlock(doc[notice])}\n\n`);
    }
  }
  if (doc.semantics && typeof doc.semantics === 'object') {
    process.stdout.write('FEED SEMANTICS (the producer\'s own statement):\n');
    for (const [k, v] of Object.entries(doc.semantics)) {
      process.stdout.write(`  ${safeLine(k, 64)}: ${safeLine(v, 600)}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(`feed        ${safeLine(feed.origin)}\n`);
  process.stdout.write(`owner       ${doc.owner === undefined ? '(unstated)' : safeLine(doc.owner, 128)}\n`);
  process.stdout.write(`digest      ${feed.digest}  (OUR hash of the bytes we received)\n`);
  if (feed.advertised_digest) {
    let note;
    if (feed.digest_matches_advertised) {
      note = ' — matches';
    } else if (feed.advertised_digest_is_producer_internal) {
      // The producer stated what their digest covers, so a difference is expected and says
      // nothing about integrity. Reporting it as a discrepancy would alarm every reader about
      // something working as designed.
      note = ' — producer-internal fingerprint, not a hash of these bytes; a difference is expected';
    } else {
      note = ' — DOES NOT match ours; reported, not trusted';
    }
    process.stdout.write(`            advertised ${safeLine(feed.advertised_digest, 128)}${note}\n`);
    if (feed.advertised_digest_basis) {
      process.stdout.write(`            basis      ${safeLine(feed.advertised_digest_basis)}\n`);
    }
  }
  if (feed.changed !== null) {
    process.stdout.write(`            ${feed.changed ? 'CHANGED' : 'unchanged'} since the last fetch `
      + `(${feed.previous_digest ? feed.previous_digest.slice(0, 12) : 'none'})\n`);
  }
  process.stdout.write('\n');

  if (rows.length === 0) {
    process.stdout.write('No feed defaults match that filter.\n');
  }
  for (const { entry, applicability } of rows) {
    process.stdout.write(`${formatDisclosure(entry)}\n`);
    const ap = applicability;
    process.stdout.write(`  effort          ${ap.effort === null ? '(legacy partition — no effort recorded)' : ap.effort}\n`);
    process.stdout.write(`  seat_hash       ${ap.seat_hash_derived}  (RE-DERIVED here)\n`);
    if (ap.seat_hash_matches === false) {
      const why = ap.seat_hash_basis === 'legacy_three_field'
        ? 'that is the pre-effort THREE-FIELD hash — this feed predates effort partitioning, so regenerate it'
        : 'basis unknown — the producer computed it from something we cannot reproduce';
      process.stdout.write(`                  ⚠ feed advertises ${ap.seat_hash_advertised}\n`);
      process.stdout.write(`                    ${why}. Adoption uses OUR derivation either way.\n`);
    }
    const env = ap.environment;
    const localRv = env.local_runner_version === null
      ? `(${env.local_runner_version_source})`
      : env.local_runner_version;
    process.stdout.write(`  environment     runner ${env.feed_runner_version} → local ${localRv}`
      + `${env.runner_version_matches === false ? '  ⚠ differs — WARNING ONLY, never gates' : ''}\n`);
    if (entry.board) {
      process.stdout.write(`  board           ${safeLine(JSON.stringify(entry.board), 600)}\n`);
    }
    if (entry.feed && entry.feed.evidence_url) {
      process.stdout.write(`  evidence url    ${safeLine(entry.feed.evidence_url, 512)}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(`${rows.length} default(s), ${feed.strikes.length} strike(s), ${feed.priors.length} prior(s).\n`);
  for (const described of feed.strikes.map(describeFeedStrike)) {
    process.stdout.write(`  strike  ${described.engine}/${described.runner}/${described.role}`
      + `  effort=${described.effort === null ? '(legacy partition)' : described.effort}`
      + `  class=${described.class}\n`);
    process.stdout.write(`          seat_hash ${described.seat_hash_derived} (RE-DERIVED)`
      + `${described.seat_hash_matches === false ? `  ⚠ feed advertises ${described.seat_hash_advertised}` : ''}\n`);
  }
  process.stdout.write('\nNothing was adopted. Adopt with:  node scripts/adopt-qualification-defaults.js adopt --from <url|path> --role <role>\n');
}

// A feed strike, with its seat_hash RE-DERIVED locally. The feed's own value is kept only for the
// diff: believing it would let the producer decide which local seat a strike attaches to.
function describeFeedStrike(strike) {
  const effort = strike.effort === undefined ? null : strike.effort;
  const derived = localSeatHash(strike.engine, strike.runner, strike.role, effort === null ? undefined : effort);
  return {
    engine: strike.engine,
    runner: strike.runner,
    role: strike.role,
    effort,
    class: strike.class,
    seat_hash_derived: derived,
    seat_hash_advertised: strike.seat_hash || null,
    seat_hash_matches: strike.seat_hash ? strike.seat_hash === derived : null,
    seat_hash_basis: strike.seat_hash
      ? (strike.seat_hash === derived
        ? 'agrees'
        : (strike.seat_hash === localSeatHash(strike.engine, strike.runner, strike.role, undefined)
          ? 'legacy_three_field'
          : 'unknown'))
      : 'absent',
  };
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
// `--priors`: append the feed's priors[] as PROVISIONAL external_prior evidence, through the
// existing `record-evidence` path — the same path an operator uses by hand, with the same
// producer (`operator-record-v1`) and the same validation.
//
// A prior is NOT a qualification and can never become one here. The record-evidence path is what
// enforces that: a `qualified` state requires `internal_eval` provenance, which an
// `external_prior` row does not have and cannot claim. So the ceiling is structural, not a rule
// this function remembers to apply.
//
// Failures are per-prior and reported, not fatal: 53 priors where one is malformed should land 52
// and name the one it refused, not abandon the batch.
function adoptPriors(opts, feed) {
  if (!feed || !Array.isArray(feed.priors) || feed.priors.length === 0) {
    process.stdout.write(`${JSON.stringify({ status: 'no_priors', appended: 0 })}\n`);
    return;
  }
  const cli = path.join(SCRIPT_DIR, 'engine-capability-state.js');
  const appended = [];
  const refused = [];
  for (const prior of feed.priors) {
    if (opts.dryRun) {
      appended.push({ role: prior.role, source_ref: prior.source_ref, would_write: true });
      continue;
    }
    const res = spawnSync(process.execPath, [cli, 'record-evidence', '--store', opts.capabilityDir], {
      input: `${JSON.stringify(prior)}\n`,
      encoding: 'utf8',
    });
    if (res.status === 0) {
      appended.push({
        role: prior.role,
        source_ref: prior.source_ref,
        identity: prior.identity && prior.identity.identity,
      });
    } else {
      refused.push({
        role: prior.role,
        source_ref: prior.source_ref,
        identity: prior.identity && prior.identity.identity,
        reason: `${(res.stdout || '').trim()} ${(res.stderr || '').trim()}`.trim(),
      });
    }
  }
  process.stdout.write(`${JSON.stringify({
    status: opts.dryRun ? 'priors_dry_run' : 'priors_appended',
    appended: appended.length,
    refused: refused.length,
    refusals: refused,
    ceiling: 'external_prior evidence is provisional by construction — nothing in a feed can produce a qualified row that was not internal_eval upstream',
  }, null, 2)}\n`);
}

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

// `source` is either the shipped artifact or a loaded feed. Everything downstream — the
// local-evidence collision rule, the row write, the strike-target reminder — is deliberately
// IDENTICAL for both: a feed entry is not privileged and gets no shortcut a shipped default
// does not have.
function cmdAdopt(opts, source) {
  const artifact = source.artifact;
  const feed = source.feed || null;
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
      // Where this came from, when, and WHICH BYTES. `digest` is our own hash of what we
      // received, never the feed's advertised value — so this records what we actually read,
      // which is the only thing a later reader can check us on.
      ...(feed ? {
        adopted_from: {
          url: feed.origin,
          digest: feed.digest,
          fetched_at: feed.fetched_at,
          feed_schema: feed.feed_schema,
          advertised_digest: feed.advertised_digest,
          advertised_digest_matches: feed.digest_matches_advertised,
          // Recorded so a later reader of this row can tell an expected difference (the producer
          // declared a basis) from an unexplained one, without re-fetching the feed.
          advertised_digest_basis: feed.advertised_digest_basis,
        },
      } : {}),
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
    from: null,
    feedCacheDir: null,
    priors: false,
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
    if (arg === '--from') {
      opts.from = argv[++i];
      if (!opts.from) failUsage('--from requires an https URL or a file path');
      continue;
    }
    if (arg === '--feed-cache-dir') { opts.feedCacheDir = argv[++i]; continue; }
    if (arg === '--priors') { opts.priors = true; continue; }
    failUsage(`unknown argument '${arg}'`);
  }

  if (!opts.command) failUsage('a command is required: list | adopt');
  if (opts.priors && opts.command !== 'adopt') failUsage('--priors applies to adopt');
  if (opts.priors && !opts.from) failUsage('--priors requires --from (priors ride in a feed)');
  // An optional convenience so an operator who has settled on a feed need not retype it. Opt-in
  // only: absence changes nothing, and there is still no automatic refresh.
  if (!opts.from) {
    const configured = readConfiguredFeedUrl();
    if (configured) opts.from = configured;
  }
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

async function loadFeedSource(opts) {
  const { loadFeed } = require('./lib/qualification-feed.js');
  let feed;
  try {
    feed = await loadFeed(opts.from, {
      ...(opts.feedCacheDir ? { cacheDir: expandTilde(opts.feedCacheDir) } : {}),
    });
  } catch (err) {
    fail(err.message);
  }
  // A feed carries no recipe_version of its own; its identity is its digest, which is what the
  // provenance records. Saying `null` here rather than inventing a value keeps the two sources
  // distinguishable in an adopted row.
  return {
    artifact: {
      defaults: feed.defaults,
      schema_version: feed.doc.schema_version === undefined ? null : feed.doc.schema_version,
      recipe_version: null,
    },
    feed,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'list') {
    if (opts.from) {
      cmdListFeed(opts).catch((err) => fail(err.message));
      return;
    }
    cmdList(opts);
    return;
  }
  if (opts.from) {
    loadFeedSource(opts)
      .then((source) => {
        cmdAdopt(opts, source);
        if (opts.priors) adoptPriors(opts, source.feed);
      })
      .catch((err) => fail(err.message));
    return;
  }
  cmdAdopt(opts, { artifact: readArtifact(opts.artifact).artifact, feed: null });
}

if (require.main === module) main();

module.exports = { selfQualifyCommand, formatDisclosure };
