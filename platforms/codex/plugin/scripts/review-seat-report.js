#!/usr/bin/env node
'use strict';

// review-seat-report.js — read-only per-reviewer-family statistics from hetero-review-loop ledgers.
//
// The caller passes every ledger directory (--ledger) and, optionally, one or more review-ledger
// archive roots (--archive, repeatable). --archive alone is valid. This process does not write the
// archive or any ledger, and it never looks at ~/.autopilot on its own. A <YYYY-MM>.tar.gz month is
// extracted with the system tar into a directory from fs.mkdtempSync (under os.tmpdir()) and that
// directory is removed with fs.rmSync after the report is rendered.
//
// --archive walks each root (layout A is bucket / YYYY-MM / ledger-id /, the legacy flat form is
// root / any-name /, and anything in between). A directory that contains review-*/chain.json is
// one ledger and is not descended into. Symlinks are followed only when their realpath has not
// already been entered and that realpath stays inside the realpath of the archive root (path.relative,
// not a bare prefix). A directory symlink that points outside the root is skipped and never read.
// A file symlink inside the root is still read. Only a file named <YYYY-MM>.tar.gz is a month tar.
// Any other name ending in .tar.gz or .tar is skipped as "not a month tar" and is not extracted.
// A month tar is listed with tar -tvzf. The first character of each verbose line is the member
// type (the type is not taken by splitting the line on whitespace). Regular files and directories
// are allowed. A symlink or hardlink skips the whole tar as "link member". A character device,
// block device, FIFO, or any other member type skips the whole tar as "special member". Nothing
// is extracted in those cases. An absolute member or a member with a ".." segment is skipped as
// "unsafe member path" and is not extracted. Extraction uses tar -xzf with no ownership-restore
// flags, into a directory from fs.mkdtempSync that is removed after the report. Nested .tar and
// .tar.gz files inside that directory are not opened. If <YYYY-MM>/ sits beside the month tar,
// both are read: rotate_remove_source can drop the source month, and a later finalize recreates
// a directory that holds only new phases, so each side can be incomplete. Identical content is
// not counted twice (ledger content key, then generation de-dupe). The footer counts every month
// tar that was extracted and read, including one that has a sibling directory. A tar that fails
// to list or extract is skipped with "tar extract failed: ..." and the report continues.
// The footer counts tar months read and tar months skipped.
//
// Dedupe: two ledgers whose set of (phase, generation, findings.json sha256) is identical count
// once, including two copies of the same ledger-id. A ledger-id whose phase set differs (a month
// tar and a sibling directory that each hold part of one ledger) is kept and accumulated.
// Skipped duplicates are not accumulated. Report keys stay path.resolve of the ledger that was
// kept, which is the --ledger path when --archive is not used.
//
// With --archive, a second pass drops a finalized generation whose (phase, generation, findings.json
// sha256) was already counted in this run, even when the rest of the ledger differs. Pending,
// aborted, corrupt, and unknown-status generations never enter that set. Without --archive the
// generation set is unused and duplicate_generations_skipped stays 0.
//
// A generation counts only when review-<phase>/chain.json says status "finalized". "aborted" and
// "pending" generations are skipped and counted in the scope footer. A phase whose chain or
// generation JSON cannot be parsed is skipped (corrupt_skipped) and does not throw.
//
// Family comes from familyOfEngine(model) in scripts/lib/stage-write.js for the finding's seat file
// in that generation. A missing seat file is family "unknown" and model "unknown". Anything
// familyOfEngine cannot place is "unknown" (no extra muse-spark case).
//
// Default group: family, with every distinct model name sorted and comma-joined. --by-model groups
// by the model name and still shows the family.
//
// Exclusive verified: same finding across seats shares a key. Every phase, generation, and
// exclusive key is prefixed with the absolute ledger directory (path.resolve of --ledger). Default
// key is ledger + phase + generation + slug (text inside the first square brackets on the first
// line). A finding with no slug gets a unique key. --cross-gen drops generation (ledger + phase +
// slug). A verified finding is exclusive when no finding from a different seat under that key is
// also verified. With --cross-gen the seat identity is seat id plus the model from that
// generation's seat file; otherwise it is the seat id. Two seats in one family stay different
// seats. The resolutions array on dispositions.json is ignored.
//
// A chain.json generation whose status is not finalized, aborted, or pending is skipped and counted
// as unknown_status_skipped. A dangling symlink phase directory is corrupt_skipped, not a crash.
//
// Undisposed findings (no matching dispositions.json entry) are a separate column and are not in
// the Ver%/Ref%/Def% denominator. An empty denominator is 0.
//
// Exit codes: 0 success; 2 usage (neither --ledger nor --archive, unknown flag, or a missing
// ledger directory or archive root).
//
// Usage: node scripts/review-seat-report.js [--ledger <dir> ...] [--archive <root> ...] [--json] [--by-model] [--cross-gen]

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { familyOfEngine } = require('./lib/stage-write');

const METRIC_KEYS = [
  'findings', 'critical', 'major', 'minor', 'suggestion',
  'verified', 'refuted', 'deferred', 'undisposed',
  'verified_critical', 'verified_major', 'exclusive_verified',
  'phases', 'generations', 'seat_failures',
];

function emptyMetrics() {
  const row = {};
  for (const key of METRIC_KEYS) row[key] = 0;
  row._phases = new Set();
  row._gens = new Set();
  row._models = new Set();
  return row;
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function slugOf(text) {
  const first = String(text || '').split('\n')[0];
  const match = first.match(/\[([^\]\n]+)\]/);
  return match ? match[1] : null;
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ok: false, value: null };
  }
}

function listPhases(ledgerDir, scope) {
  let names;
  try {
    names = fs.readdirSync(ledgerDir);
  } catch {
    return null;
  }
  const phases = [];
  for (const name of names) {
    if (!name.startsWith('review-')) continue;
    try {
      if (fs.statSync(path.join(ledgerDir, name)).isDirectory()) phases.push(name);
    } catch {
      noteCorrupt(scope, name);
    }
  }
  phases.sort();
  return phases;
}

function groupId(family, model, byModel) {
  return byModel ? `m:${model}` : `f:${family}`;
}

function findingsPath(phaseDir, generation) {
  return path.join(phaseDir, `g${generation}`, 'findings.json');
}

function readFindingsBytes(phaseDir, generation) {
  try {
    return fs.readFileSync(findingsPath(phaseDir, generation));
  } catch {
    return null;
  }
}

function parseFindingsBytes(bytes) {
  if (!bytes) return null;
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || !Array.isArray(value.findings)) return null;
    return value;
  } catch {
    return null;
  }
}

function readableFindingCount(phaseDir, generation) {
  const value = parseFindingsBytes(readFindingsBytes(phaseDir, generation));
  return value ? value.findings.length : 0;
}

function generationDedupeKey(phaseName, generation, bytes) {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  return `${phaseName}\0${generation}\0${hash}`;
}

function noteCorrupt(scope, phaseName) {
  scope.corrupt_skipped += 1;
  scope.corrupt_phases.push(phaseName);
}

function accumulatePhase(ledgerDir, phaseName, byModel, bag, scope, genDedupe, ledgerKeyOverride) {
  // Same bucket + ledger-id shares one key, so a tar extract and its sibling
  // directory do not each add a generation.
  const ledgerKey = ledgerKeyOverride || path.resolve(ledgerDir);
  const phaseDir = path.join(ledgerDir, phaseName);
  const chain = readJson(path.join(phaseDir, 'chain.json'));
  if (!chain.ok || !Array.isArray(chain.value)) {
    noteCorrupt(scope, phaseName);
    return;
  }
  const dedupeGenerations = Boolean(genDedupe && genDedupe.enabled);
  const seenGenerations = genDedupe && genDedupe.seen;
  const recordUncounted = Boolean(genDedupe && genDedupe.recordUncountedGenerationKeys);

  const finalized = [];
  for (const entry of chain.value) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.status === 'aborted') {
      scope.aborted_skipped += 1;
      scope.aborted_skipped_findings += readableFindingCount(phaseDir, entry.generation);
    } else if (entry.status === 'pending') {
      scope.pending_skipped += 1;
      scope.pending_skipped_findings += readableFindingCount(phaseDir, entry.generation);
      // Test-only poison: a pending key must not enter the set in production. Inserting it
      // here makes a later finalized copy of the same bytes look like a duplicate.
      if (dedupeGenerations && recordUncounted && seenGenerations) {
        const pendingBytes = readFindingsBytes(phaseDir, entry.generation);
        if (pendingBytes) seenGenerations.add(generationDedupeKey(phaseName, entry.generation, pendingBytes));
      }
    } else if (entry.status === 'finalized') finalized.push(entry);
    else scope.unknown_status_skipped += 1;
  }

  const loaded = [];
  const keysToRemember = [];
  for (const entry of finalized) {
    const gen = entry.generation;
    const genDir = path.join(phaseDir, `g${gen}`);
    const findingsBytes = readFindingsBytes(phaseDir, gen);
    const findingsValue = parseFindingsBytes(findingsBytes);
    if (dedupeGenerations && seenGenerations && findingsBytes) {
      const seenKey = generationDedupeKey(phaseName, gen, findingsBytes);
      if (seenGenerations.has(seenKey)) {
        scope.duplicate_generations_skipped += 1;
        continue;
      }
      keysToRemember.push(seenKey);
    }
    if (!findingsValue) {
      noteCorrupt(scope, phaseName);
      return;
    }
    const dispPath = path.join(genDir, 'dispositions.json');
    let dispMap = new Map();
    if (fs.existsSync(dispPath)) {
      const dispDoc = readJson(dispPath);
      if (!dispDoc.ok || !dispDoc.value || !Array.isArray(dispDoc.value.findings)) {
        noteCorrupt(scope, phaseName);
        return;
      }
      for (const item of dispDoc.value.findings) {
        if (item && item.id != null && !dispMap.has(item.id)) dispMap.set(item.id, item.disposition);
      }
    }
    let seatNames;
    try {
      seatNames = fs.readdirSync(genDir).filter((name) => /^seat-.+\.json$/.test(name));
    } catch {
      noteCorrupt(scope, phaseName);
      return;
    }
    const seats = new Map();
    for (const name of seatNames) {
      const doc = readJson(path.join(genDir, name));
      if (!doc.ok || !doc.value || typeof doc.value !== 'object') {
        noteCorrupt(scope, phaseName);
        return;
      }
      const seatId = name.slice('seat-'.length, -'.json'.length);
      const model = typeof doc.value.model === 'string' && doc.value.model ? doc.value.model : 'unknown';
      seats.set(seatId, { model, status: doc.value.status, family: familyOfEngine(model) });
    }
    loaded.push({ gen, findings: findingsValue.findings, dispMap, seats });
  }

  scope.phases_read += 1;
  scope.finalized_generations += loaded.length;
  if (seenGenerations) {
    for (const seenKey of keysToRemember) seenGenerations.add(seenKey);
  }
  const phaseKey = `${ledgerKey}\0${phaseName}`;
  if (loaded.length > 0) scope._phases.add(phaseKey);
  for (const gen of loaded) scope._gens.add(`${ledgerKey}\0${phaseName}\0${gen.gen}`);

  for (const gen of loaded) {
    const genKey = `${ledgerKey}\0${phaseName}\0${gen.gen}`;
    for (const [seatId, info] of gen.seats) {
      const id = groupId(info.family, info.model, byModel);
      if (!bag.rows.has(id)) {
        bag.rows.set(id, emptyMetrics());
        bag.meta.set(id, { family: info.family, model: info.model });
      }
      const row = bag.rows.get(id);
      row._models.add(info.model);
      row._phases.add(phaseKey);
      row._gens.add(genKey);
      if (info.status !== 'reviewed') row.seat_failures += 1;
      void seatId;
    }
    gen.findings.forEach((finding, index) => {
      const seatId = finding && finding.seat != null ? String(finding.seat) : '';
      const info = gen.seats.get(seatId);
      const model = info ? info.model : 'unknown';
      const family = info ? info.family : 'unknown';
      const id = groupId(family, model, byModel);
      if (!bag.rows.has(id)) {
        bag.rows.set(id, emptyMetrics());
        bag.meta.set(id, { family, model });
      }
      const row = bag.rows.get(id);
      row._models.add(model);
      row._phases.add(phaseKey);
      row._gens.add(genKey);
      row.findings += 1;
      if (finding && finding.severity === 'Critical') row.critical += 1;
      else if (finding && finding.severity === 'Major') row.major += 1;
      else if (finding && finding.severity === 'Minor') row.minor += 1;
      else if (finding && finding.severity === 'Suggestion') row.suggestion += 1;
      const disposition = finding && finding.id != null ? gen.dispMap.get(finding.id) : undefined;
      if (disposition === 'verified') row.verified += 1;
      else if (disposition === 'refuted') row.refuted += 1;
      else if (disposition === 'deferred') row.deferred += 1;
      else row.undisposed += 1;
      if (disposition === 'verified' && finding && finding.severity === 'Critical') row.verified_critical += 1;
      if (disposition === 'verified' && finding && finding.severity === 'Major') row.verified_major += 1;
      const slug = slugOf(finding && finding.text);
      const key = slug == null
        ? `noslug\0${ledgerKey}\0${phaseName}\0${gen.gen}\0${finding && finding.id != null ? finding.id : index}`
        : (bag.crossGen ? `${ledgerKey}\0${phaseName}\0${slug}` : `${ledgerKey}\0${phaseName}\0${gen.gen}\0${slug}`);
      const seatIdentity = bag.crossGen ? `${seatId}\0${model}` : seatId;
      bag.keyed.push({
        key,
        seat: seatIdentity,
        verified: disposition === 'verified',
        group: id,
      });
    });
  }
}

const WALK_DEPTH_LIMIT = 16;
const MONTH_TAR_NAME = /^\d{4}-\d{2}\.tar\.gz$/;
const NOT_A_MONTH_TAR = 'not a month tar';

function tarFailureReason(result) {
  const raw = result && (result.stderr || result.message)
    ? String(result.stderr || result.message)
    : 'tar failed';
  const line = raw.split('\n').map((part) => part.trim()).filter(Boolean)[0] || 'tar failed';
  return `tar extract failed: ${line.replace(/\s+/g, ' ').slice(0, 180)}`;
}

function runSystemTar(args) {
  const result = spawnSync('tar', args, {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
  if (result.error) return { ok: false, stderr: result.error.message };
  if (result.status !== 0) return { ok: false, stderr: result.stderr || '' };
  return { ok: true, stdout: result.stdout || '' };
}

function tarMemberUnsafe(member) {
  const name = String(member).replace(/\\/g, '/').replace(/\/+$/, '');
  if (path.posix.isAbsolute(name) || path.win32.isAbsolute(name)) return true;
  return name.split('/').some((part) => part === '..');
}

// Type is the first character. '-' and 'd' are the only members that may be extracted.
function tarMemberTypeRefusal(typeChar) {
  if (typeChar === '-' || typeChar === 'd') return null;
  if (typeChar === 'l' || typeChar === 'h') return 'link member';
  return 'special member';
}

function isTarName(name) {
  return name.endsWith('.tar.gz') || name.endsWith('.tar');
}

function directoryHasLedgerChain(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!name.startsWith('review-')) continue;
    try {
      const st = fs.lstatSync(path.join(dir, name, 'chain.json'));
      if (st.isFile() || st.isSymbolicLink()) return true;
    } catch {
      // not a ledger marker
    }
  }
  return false;
}

function isRealpathInside(rootReal, candidateReal) {
  const rel = path.relative(rootReal, candidateReal);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function layoutLedgerIdentity(relParts, ctx) {
  if (!relParts || relParts.length < 2) return { bucket: null, ledgerId: null };
  const month = relParts[relParts.length - 2];
  if (!MONTH_TAR_NAME.test(`${month}.tar.gz`)) return { bucket: null, ledgerId: null };
  if (ctx && ctx.fromTar) {
    if (!ctx.bucket) return { bucket: null, ledgerId: null };
    return { bucket: ctx.bucket, ledgerId: relParts[relParts.length - 1] };
  }
  if (relParts.length < 3) return { bucket: null, ledgerId: null };
  return { bucket: relParts[relParts.length - 3], ledgerId: relParts[relParts.length - 1] };
}

function discoverArchive(root, tempDirs = []) {
  const ledgers = [];
  const tarMonths = [];
  let tarMonthsRead = 0;
  const seen = new Set();

  function walkRoot(start, readMonthTars, ctx) {
    let rootReal;
    try {
      rootReal = fs.realpathSync(start);
    } catch {
      return;
    }
    function enter(dir, depth, relParts) {
      let real;
      try {
        real = fs.realpathSync(dir);
      } catch {
        return;
      }
      if (!isRealpathInside(rootReal, real)) return;
      if (seen.has(real)) return;
      seen.add(real);
      let st;
      try {
        st = fs.statSync(real);
      } catch {
        return;
      }
      if (!st.isDirectory()) return;
      if (directoryHasLedgerChain(real)) {
        const identity = layoutLedgerIdentity(relParts, ctx);
        ledgers.push({ dir: real, bucket: identity.bucket, ledgerId: identity.ledgerId, fromTar: Boolean(ctx && ctx.fromTar) });
        return;
      }
      if (depth >= WALK_DEPTH_LIMIT) return;
      let names;
      try {
        names = fs.readdirSync(real);
      } catch {
        return;
      }
      for (const name of names) {
        if (isTarName(name)) {
          // An extracted month is already unpacked. Opening a nested tar would
          // follow whatever the outer archive planted, including another month.
          if (!readMonthTars) continue;
          if (!MONTH_TAR_NAME.test(name)) {
            tarMonths.push({ name, reason: NOT_A_MONTH_TAR });
            continue;
          }
          const file = path.join(real, name);
          const verbose = runSystemTar(['-tvzf', file]);
          if (!verbose.ok) {
            tarMonths.push({ name, reason: tarFailureReason(verbose) });
            continue;
          }
          const named = runSystemTar(['-tzf', file]);
          if (!named.ok) {
            tarMonths.push({ name, reason: tarFailureReason(named) });
            continue;
          }
          const typeLines = verbose.stdout.split('\n').filter((line) => line.length > 0);
          const memberNames = named.stdout.split('\n').filter((line) => line.length > 0);
          let refusal = null;
          if (typeLines.length !== memberNames.length) {
            refusal = tarFailureReason({ stderr: 'member list mismatch' });
          }
          for (const line of typeLines) {
            if (refusal) break;
            // Type is line[0]. Names may contain spaces, so the line is not split.
            refusal = tarMemberTypeRefusal(line[0]);
          }
          if (!refusal && memberNames.some(tarMemberUnsafe)) refusal = 'unsafe member path';
          if (refusal) {
            tarMonths.push({ name, reason: refusal });
            continue;
          }
          let extracted = null;
          let keepExtract = false;
          try {
            extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-report-tar-'));
            tempDirs.push(extracted);
            const unpacked = runSystemTar(['-xzf', file, '-C', extracted]);
            if (!unpacked.ok) {
              tarMonths.push({ name, reason: tarFailureReason(unpacked) });
            } else {
              keepExtract = true;
              tarMonthsRead += 1;
              walkRoot(extracted, false, { fromTar: true, bucket: path.basename(real) });
            }
          } finally {
            if (!keepExtract && extracted) {
              fs.rmSync(extracted, { recursive: true, force: true });
            }
          }
          continue;
        }
        const child = path.join(real, name);
        let childStat;
        try {
          childStat = fs.lstatSync(child);
        } catch {
          continue;
        }
        if (childStat.isSymbolicLink() || childStat.isDirectory()) enter(child, depth + 1, relParts.concat(name));
      }
    }
    enter(start, 0, []);
  }

  walkRoot(root, true, { fromTar: false, bucket: null });
  return { ledgers, tarMonths, tarMonthsRead, tempDirs };
}

function ledgerContentKey(dir) {
  const parts = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  for (const phase of names.filter((name) => name.startsWith('review-')).sort()) {
    const phaseDir = path.join(dir, phase);
    let gens = [];
    try {
      gens = fs.readdirSync(phaseDir).filter((name) => /^g\d+$/.test(name)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    } catch {
      gens = [];
    }
    for (const genName of gens) {
      const file = path.join(phaseDir, genName, 'findings.json');
      let hash = 'missing';
      try {
        hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      } catch {
        hash = 'missing';
      }
      parts.push(`${phase}\0${genName.slice(1)}\0${hash}`);
    }
  }
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

function dedupeLedgers(candidates) {
  const seenContent = new Set();
  const kept = [];
  let duplicates = 0;
  for (const entry of candidates) {
    // Same ledger-id with a different phase set is kept so generation de-dupe can
    // merge a month tar with a sibling directory. Identical content is skipped.
    const contentKey = ledgerContentKey(entry.dir);
    if (seenContent.has(contentKey)) {
      duplicates += 1;
      continue;
    }
    seenContent.add(contentKey);
    kept.push(entry);
  }
  // dedupeGenerations is true only on this return, which main uses solely when --archive
  // was given. The test that splices out this call therefore turns generation de-dupe off too.
  return { kept, duplicates, dedupeGenerations: true };
}

function buildReport(ledgerDirs, options = {}) {
  const byModel = Boolean(options.byModel);
  const crossGen = Boolean(options.crossGen);
  const scope = {
    ledgers_read: 0,
    phases_read: 0,
    finalized_generations: 0,
    aborted_skipped: 0,
    pending_skipped: 0,
    corrupt_skipped: 0,
    unknown_status_skipped: 0,
    aborted_skipped_findings: 0,
    pending_skipped_findings: 0,
    corrupt_phases: [],
    archive_ledgers_read: options.archiveLedgersRead || 0,
    duplicates_skipped: options.duplicatesSkipped || 0,
    duplicate_generations_skipped: 0,
    tar_months_read: options.tarMonthsRead || 0,
    tar_months_skipped: options.tarMonths || [],
    _phases: new Set(),
    _gens: new Set(),
  };
  const bag = { rows: new Map(), meta: new Map(), keyed: [], crossGen };
  const genDedupe = {
    enabled: Boolean(options.dedupeGenerations),
    seen: new Set(),
    recordUncountedGenerationKeys: Boolean(options.recordUncountedGenerationKeys),
  };
  const identities = Array.isArray(options.ledgerIdentities) ? options.ledgerIdentities : null;
  const seenLedgerIds = new Set();
  for (let i = 0; i < ledgerDirs.length; i++) {
    const dir = ledgerDirs[i];
    const phases = listPhases(dir, scope);
    if (phases == null) continue;
    const ident = identities ? identities[i] : null;
    if (ident) {
      if (!seenLedgerIds.has(ident)) {
        seenLedgerIds.add(ident);
        scope.ledgers_read += 1;
      }
    } else {
      scope.ledgers_read += 1;
    }
    for (const phaseName of phases) accumulatePhase(dir, phaseName, byModel, bag, scope, genDedupe, ident || null);
  }

  const verifiedSeats = new Map();
  for (const item of bag.keyed) {
    if (!item.verified) continue;
    if (!verifiedSeats.has(item.key)) verifiedSeats.set(item.key, new Set());
    verifiedSeats.get(item.key).add(item.seat);
  }
  for (const item of bag.keyed) {
    if (!item.verified) continue;
    const seats = verifiedSeats.get(item.key);
    if (seats && seats.size === 1) bag.rows.get(item.group).exclusive_verified += 1;
  }

  const groups = [];
  for (const [id, row] of bag.rows) {
    const meta = bag.meta.get(id);
    const models = [...row._models].sort();
    const dispositioned = row.verified + row.refuted + row.deferred;
    groups.push({
      family: meta.family,
      models,
      findings: row.findings,
      critical: row.critical,
      major: row.major,
      minor: row.minor,
      suggestion: row.suggestion,
      verified: row.verified,
      refuted: row.refuted,
      deferred: row.deferred,
      undisposed: row.undisposed,
      verified_pct: pct(row.verified, dispositioned),
      refuted_pct: pct(row.refuted, dispositioned),
      deferred_pct: pct(row.deferred, dispositioned),
      verified_critical: row.verified_critical,
      verified_major: row.verified_major,
      exclusive_verified: row.exclusive_verified,
      phases: row._phases.size,
      generations: row._gens.size,
      seat_failures: row.seat_failures,
    });
  }
  groups.sort((a, b) => {
    if (byModel) {
      const am = a.models[0] || '';
      const bm = b.models[0] || '';
      return am < bm ? -1 : am > bm ? 1 : a.family < b.family ? -1 : a.family > b.family ? 1 : 0;
    }
    if (a.family !== b.family) return a.family < b.family ? -1 : 1;
    const am = a.models.join(',');
    const bm = b.models.join(',');
    return am < bm ? -1 : am > bm ? 1 : 0;
  });

  const totals = {
    findings: 0, critical: 0, major: 0, minor: 0, suggestion: 0,
    verified: 0, refuted: 0, deferred: 0, undisposed: 0,
    verified_critical: 0, verified_major: 0, exclusive_verified: 0,
    phases: 0, generations: 0, seat_failures: 0,
  };
  for (const row of groups) {
    for (const key of Object.keys(totals)) totals[key] += row[key];
  }
  totals.phases = scope._phases.size;
  totals.generations = scope._gens.size;
  scope.distinct_phases = scope._phases.size;
  scope.distinct_generations = scope._gens.size;
  scope.corrupt_phases = [...new Set(scope.corrupt_phases)].sort();
  delete scope._phases;
  delete scope._gens;
  const dispositioned = totals.verified + totals.refuted + totals.deferred;
  totals.verified_pct = pct(totals.verified, dispositioned);
  totals.refuted_pct = pct(totals.refuted, dispositioned);
  totals.deferred_pct = pct(totals.deferred, dispositioned);

  return {
    schema_version: 1,
    groups,
    totals,
    scope,
    key_mode: crossGen ? 'phase+slug' : 'phase+generation+slug',
    by_model: byModel,
  };
}

const TEXT_COLUMNS = [
  ['Family', (row) => row.family],
  ['Models', (row) => row.models.join(', ')],
  ['Findings', (row) => String(row.findings)],
  ['Crit', (row) => String(row.critical)],
  ['Major', (row) => String(row.major)],
  ['Minor', (row) => String(row.minor)],
  ['Sugg', (row) => String(row.suggestion)],
  ['Verified', (row) => String(row.verified)],
  ['Refuted', (row) => String(row.refuted)],
  ['Deferred', (row) => String(row.deferred)],
  ['Undisp', (row) => String(row.undisposed)],
  ['Ver%', (row) => String(row.verified_pct)],
  ['Ref%', (row) => String(row.refuted_pct)],
  ['Def%', (row) => String(row.deferred_pct)],
  ['VerCrit', (row) => String(row.verified_critical)],
  ['VerMajor', (row) => String(row.verified_major)],
  ['Excl', (row) => String(row.exclusive_verified)],
  ['Phases', (row) => String(row.phases)],
  ['Gens', (row) => String(row.generations)],
  ['SeatFail', (row) => String(row.seat_failures)],
];

function formatText(report) {
  const totalRow = { ...report.totals, family: 'TOTAL', models: [] };
  const rows = [...report.groups, totalRow];
  const widths = TEXT_COLUMNS.map(([title, pick]) => {
    let width = title.length;
    for (const row of rows) width = Math.max(width, pick(row).length);
    return width;
  });
  const lineOf = (row) => TEXT_COLUMNS.map(([, pick], i) => pick(row).padEnd(widths[i])).join('  ');
  const header = TEXT_COLUMNS.map(([title], i) => title.padEnd(widths[i])).join('  ');
  const scope = report.scope;
  const lines = [
    header,
    ...rows.map(lineOf),
    `scope: ledgers read ${scope.ledgers_read}, phases read ${scope.phases_read}, finalized generations counted ${scope.finalized_generations}, aborted skipped ${scope.aborted_skipped} (${scope.aborted_skipped_findings} findings), pending skipped ${scope.pending_skipped} (${scope.pending_skipped_findings} findings), corrupt skipped ${scope.corrupt_skipped}${scope.corrupt_skipped > 0 ? ` (${scope.corrupt_phases.join(', ')})` : ''}, unknown-status skipped ${scope.unknown_status_skipped}, archive ledgers read ${scope.archive_ledgers_read || 0}, duplicates skipped ${scope.duplicates_skipped || 0}, duplicate generations skipped ${scope.duplicate_generations_skipped || 0}, tar months read ${scope.tar_months_read || 0}, tar months skipped ${(scope.tar_months_skipped || []).length}${(scope.tar_months_skipped || []).length ? ` (${scope.tar_months_skipped.map((row) => `${row.name}: ${row.reason}`).join(', ')})` : ''}`,
    'Heuristic: exclusive verified matches findings by slug, and slugs are named by the reviewers themselves.',
    `key mode: ${report.key_mode}`,
  ];
  return `${lines.join('\n')}\n`;
}

function formatJson(report) {
  return `${JSON.stringify(report)}\n`;
}

function writeStdout(text) {
  const buf = Buffer.from(text);
  let offset = 0;
  while (offset < buf.length) {
    const wrote = fs.writeSync(1, buf, offset, buf.length - offset);
    if (wrote <= 0) break;
    offset += wrote;
  }
}

function usage() {
  process.stderr.write('Usage: node scripts/review-seat-report.js [--ledger <dir> ...] [--archive <root> ...] [--json] [--by-model] [--cross-gen]\n');
  process.exitCode = 2;
}

function main(argv) {
  const ledgers = [];
  const archives = [];
  let json = false;
  let byModel = false;
  let crossGen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ledger' || arg === '--archive') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return usage();
      (arg === '--ledger' ? ledgers : archives).push(value);
      i += 1;
    } else if (arg === '--json') json = true;
    else if (arg === '--by-model') byModel = true;
    else if (arg === '--cross-gen') crossGen = true;
    else return usage();
  }
  if (ledgers.length === 0 && archives.length === 0) return usage();
  for (const dir of ledgers.concat(archives)) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return usage();
  }
  const candidates = ledgers.map((dir) => ({ dir, fromArchive: false }));
  const tarMonths = [];
  let tarMonthsRead = 0;
  const tempDirs = [];
  try {
    for (const root of archives) {
      const found = discoverArchive(root, tempDirs);
      tarMonths.push(...found.tarMonths);
      tarMonthsRead += found.tarMonthsRead;
      for (const entry of found.ledgers) {
        candidates.push({
          dir: entry.dir,
          fromArchive: true,
          bucket: entry.bucket || null,
          ledgerId: entry.ledgerId || null,
        });
      }
    }
    // Without --archive the candidate list is exactly the --ledger list. Skipping
    // dedupe keeps the previous totals, including two directories with the same bytes.
    const selected = archives.length === 0
      ? { kept: candidates, duplicates: 0 }
      : dedupeLedgers(candidates); // dedupe-call
    const archiveLedgersRead = selected.kept.filter((entry) => entry.fromArchive).length;
    const report = buildReport(selected.kept.map((entry) => entry.dir), {
      byModel,
      crossGen,
      archiveLedgersRead,
      duplicatesSkipped: selected.duplicates,
      tarMonths,
      tarMonthsRead,
      dedupeGenerations: Boolean(selected.dedupeGenerations),
      ledgerIdentities: selected.kept.map((entry) => (
        entry.bucket && entry.ledgerId ? `${entry.bucket}\0${entry.ledgerId}` : null
      )),
    });
    writeStdout(json ? formatJson(report) : formatText(report));
    process.exitCode = 0;
  } finally {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { buildReport, formatText, formatJson, familyOfEngine };

if (require.main === module) main(process.argv.slice(2));
