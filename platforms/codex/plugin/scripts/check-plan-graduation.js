#!/usr/bin/env node
'use strict';

/**
 * check-plan-graduation.js — plan-graduation lifecycle gate.
 *
 * BACKLOG is a queue → a plan is the project for campaign work → a 🔵 review finding
 * never becomes a BACKLOG row. This gate enforces the first two mechanically:
 *
 *   backlog_row_has_plan          row Pointer resolves to ANY path whose stem belongs to a
 *                                 plan that exists — the plan file itself, a sidecar
 *                                 (`docs/plans/<stem>.<tag>.md`), or anything under its
 *                                 `docs/plans/evidence/<stem>/` dir — checked against both
 *                                 docs/plans/<stem>.md and docs/plans/_archive/<stem>.md
 *                                 ("archived or not"). The violation reports the matched stem.
 *   backlog_row_done              row Status starts with shipped/dropped
 *   backlog_title_closed_status_open
 *                                 title contains ~~, CLOSED, SHIPPED, FIXED v, or LANDED
 *                                 but Status is still open
 *   plan_released_not_archived    a docs/plans/*.md whose full stem or slug (stem minus
 *                                 leading date) is mentioned in a released (non-"Unreleased")
 *                                 `## v…` CHANGELOG.md section, bounded on both sides by a
 *                                 character outside [A-Za-z0-9-] (so `foreman-rail` does not
 *                                 match inside `foreman-rail-gaps`)
 *   plan_orphan                   report-only, non-blocking: no reference to the plan in
 *                                 CHANGELOG.md, docs/projects/INDEX.md, any
 *                                 docs/plans/evidence/ dir name, or docs/BACKLOG.md
 *   archive_destination_exists    --fix's move target for a stem already exists on disk;
 *                                 the whole stem's move is skipped (all-or-nothing), the
 *                                 existing destination is left untouched
 *   plan_active_lineage           report-only, non-blocking: the plan is named by
 *                                 `.claude/mission-routing-config.json`'s sources manifest
 *                                 (a live campaign lineage with a frozen source sha) —
 *                                 implicitly excluded from plan_released_not_archived;
 *                                 moving it would invalidate the frozen sha
 *   plan_reference_dangling       report-only, non-blocking: a tracked file (*.md, *.json,
 *                                 *.sh, *.js — excluding CHANGELOG.md and docs/BACKLOG.md,
 *                                 which are history) references a bare `docs/plans/<stem>`
 *                                 path that exists in neither docs/plans/ nor
 *                                 docs/plans/_archive/
 *
 * --fix deletes the offending BACKLOG rows (backlog_row_has_plan, backlog_row_done,
 * backlog_title_closed_status_open) and git mv's released plans — plus their
 * `<same stem>.*.md` sidecars and `docs/plans/evidence/<stem>/` dir, if present —
 * into docs/plans/_archive/, preserving names. A stem's move is all-or-nothing: every
 * destination is checked for a pre-existing file BEFORE any move for that stem starts: on
 * a clash nothing for that stem moves and archive_destination_exists is reported instead.
 * It never touches plan_orphan or plan_active_lineage findings (both report-only; the
 * latter is also excluded from the move set itself, never just skipped-and-retried).
 * Because backlog_row_has_plan's scope covers the plan file, its sidecars, AND anything
 * under its evidence dir, every row that could otherwise dangle against a path --fix is
 * about to move is deleted before the move happens. Beyond BACKLOG, --fix also rewrites
 * every `docs/plans/<stem>` occurrence to `docs/plans/_archive/<stem>` in every OTHER
 * tracked text file (same *.md/*.json/*.sh/*.js set, same CHANGELOG/BACKLOG exclusion) so
 * skill docs, references, and configs that link the plan keep resolving.
 *
 * --fix re-runs the full check after fixing and reports exit/ok from that POST-fix state;
 * the payload's `violations` is therefore the post-fix set (ideally empty of blocking
 * codes) and the ORIGINAL pre-fix violations are kept under `fixed` for audit.
 *
 * Usage:
 *   node scripts/check-plan-graduation.js
 *     [--repo-root <dir>] [--backlog <file>] [--changelog <file>] [--plans-dir <dir>]
 *     [--allowlist <file>] [--fix] [--json]
 *
 * --allowlist <file>: a JSON file holding an array of plan stems (e.g.
 *   "2026-09-19-roundtable") to exclude from plan_released_not_archived and
 *   plan_orphan — for plans that are intentionally living docs.
 *
 * Exit: 0 clean (report-only codes alone never block) · 1 blocking violations · 2 usage
 *
 * Known limitations (documented, not fixed — 🔵 class, non-blocking to note):
 *   - a single-word slug (stem has no `-` after the date, e.g. `2026-01-01-x`) is more
 *     prone to an incidental boundary-matched false positive in CHANGELOG prose than a
 *     multi-word slug; prefer the full `<date>-<slug>` stem in ambiguous cases (also
 *     accepted, see plan_released_not_archived above)
 *   - a stem containing a literal `.` (not a sidecar tag) is misparsed by the sidecar-tag
 *     stripper in planStemForPointer() / findSidecars(), which assume the LAST dot segment
 *     is a tag
 *   - CLOSED_MARKERS is a plain substring match (e.g. "SHIPPED" inside an unrelated word);
 *     no word-boundary applied there
 *   - `--plans-dir` only relocates plan/sidecar/evidence discovery; plan_active_lineage's
 *     `.claude/mission-routing-config.json` resolution is always repoRoot-relative and does
 *     not follow a custom --plans-dir
 *   - DANGLING_REFERENCE_PATTERNS (plan_reference_dangling) match within a single line; a
 *     `docs/plans/<stem>` or `docs/plans/evidence/<stem>` mention word-wrapped across a
 *     line break in a long comment (the stem hyphenated at the line boundary) is truncated
 *     at the break and reported dangling even when the real, unbroken stem exists
 *     (observed: evals/consult-eval-generator.js, evals/discuss-eval-grader.js)
 *   - plan_reference_dangling also fires on synthetic example paths inside OTHER suites'
 *     test fixtures (e.g. a `docs/plans/2026-07-15-example.md` string in a JSON fixture) —
 *     report-only, so this is accepted noise rather than a false block
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const CLOSED_MARKERS = ['~~', 'CLOSED', 'SHIPPED', 'FIXED v', 'LANDED'];
const BLOCKING_CODES = new Set([
  'backlog_row_has_plan',
  'backlog_row_done',
  'backlog_title_closed_status_open',
  'plan_released_not_archived',
  'archive_destination_exists',
  'plan_unregistered',
  'plan_stem_malformed',
]);
const REPORT_ONLY_CODES = new Set(['plan_orphan', 'plan_active_lineage', 'plan_reference_dangling']);
const CODES = [...BLOCKING_CODES, ...REPORT_ONLY_CODES];
// Rewritten/scanned for stray docs/plans/<stem> references; excluded because both files
// are intentional HISTORY — a CHANGELOG entry or a deleted BACKLOG row is expected to
// mention a plan path that no longer resolves, and neither should be rewritten in place.
const REFERENCE_SCAN_EXCLUDE = new Set(['CHANGELOG.md', 'docs/BACKLOG.md']);

function usage(code) {
  process.stderr.write(
    'Usage: node scripts/check-plan-graduation.js [--repo-root <dir>] ' +
    '[--backlog <file>] [--changelog <file>] [--plans-dir <dir>] ' +
    '[--allowlist <file>] [--fix] [--json]\n' +
    '   or: node scripts/check-plan-graduation.js --register-template <stem> [--repo-root <dir>]\n' +
    '   or: node scripts/check-plan-graduation.js --archive <stem> [--archive <stem>...] ' +
    '[--shipped-in <version-or-sha>] [--repo-root <dir>] [--json]\n' +
    '   or: node scripts/check-plan-graduation.js --migrate-archive-layout ' +
    '[--repo-root <dir>] [--json]\n'
  );
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    repoRoot: null,
    backlog: null,
    changelog: null,
    plansDir: null,
    allowlist: null,
    fix: false,
    json: false,
    registerTemplate: null,
    archive: [],
    shippedIn: null,
    migrateArchiveLayout: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      if (i + 1 >= argv.length) usage(2);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') usage(0);
    else if (a === '--repo-root') out.repoRoot = need();
    else if (a === '--backlog') out.backlog = need();
    else if (a === '--changelog') out.changelog = need();
    else if (a === '--plans-dir') out.plansDir = need();
    else if (a === '--allowlist') out.allowlist = need();
    else if (a === '--fix') out.fix = true;
    else if (a === '--json') out.json = true;
    else if (a === '--register-template') out.registerTemplate = need();
    else if (a === '--archive') out.archive.push(need());
    else if (a === '--shipped-in') out.shippedIn = need();
    else if (a === '--migrate-archive-layout') out.migrateArchiveLayout = true;
    else usage(2);
  }
  return out;
}

function gitToplevel(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A slug/stem is a run of [A-Za-z0-9-]; `\b` treats `-` itself as a boundary, so
// `\bforeman-rail\b` matches inside `foreman-rail-gaps` (the character after "rail" is
// "-", not a word char, so `\b` is satisfied there too). Bound explicitly on the actual
// slug alphabet instead: the character on each side (if any) must be OUTSIDE
// [A-Za-z0-9-], so `foreman-rail` does not match inside `foreman-rail-gaps`.
function slugBoundaryRegExp(s) {
  return new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(s)}(?![A-Za-z0-9-])`);
}

// A stem-scoped rewrite/replace pattern for `docs/plans/<stem>`: matches the plan file
// itself and any of its sidecars, but never a DIFFERENT stem that happens to start with
// this one (e.g. stem "2026-01-01-widget" must not match inside "2026-01-01-widget-v2").
// Does NOT match `docs/plans/evidence/<stem>` — "evidence" sits between `docs/plans/` and
// the stem there, so this pattern never reaches it; evidencePathPrefixRegExp is the
// separate pattern for that shape (🟡 fix: the two were conflated before, so `--fix` moved
// evidence/<stem>/ but never rewrote a reference INTO it).
function planPathPrefixRegExp(stem) {
  return new RegExp(`docs/plans/${escapeRegExp(stem)}(?![A-Za-z0-9-])`, 'g');
}

// The evidence-dir counterpart of planPathPrefixRegExp: matches `docs/plans/evidence/<stem>`
// (the evidence dir itself, or any path beneath it), never a different stem with this one
// as a prefix.
function evidencePathPrefixRegExp(stem) {
  return new RegExp(`docs/plans/evidence/${escapeRegExp(stem)}(?![A-Za-z0-9-])`, 'g');
}

// --- dated archive layout ---
//
// The archive is dated: docs/plans/_archive/<YYYY>/<MM>/<stem>.md (year/month from the
// stem's own date prefix), sidecars beside it, evidence at
// docs/plans/_archive/<YYYY>/<MM>/evidence/<stem>/. Active plans stay flat. Every
// existence/no-clobber check below looks in BOTH the dated location and the legacy flat
// `_archive/<stem>.md` / `_archive/evidence/<stem>/` location (pre-dated-layout archives,
// or repos that never ran --migrate-archive-layout) — dated is preferred for NEW writes,
// legacy is still honored for reads so existing archives are not silently orphaned.

// 🟠 fix: this used to accept ANY two digits for month/day (`2026-13-99-slug` parsed as
// year=2026 month=13 day=99), which — combined with planFileMoveSet's old archiveDir
// fallback — silently misfiled a malformed-date stem into the LEGACY flat archive, where
// --migrate-archive-layout's own date-prefix filter then skips it forever (it only
// recognizes `\d{4}-\d{2}-\d{2}-` stems as migration candidates). Validate month 01-12 and
// day 01-31 (calendar-day existence per month is NOT checked — Feb 30 still passes; that is
// accepted imprecision, not silent misfiling). Returns null for undated OR malformed-date
// stems alike — callers must not fall back to a flat/legacy destination for either case
// (see plan_stem_malformed below and planFileMoveSet's removed fallback).
function stemDateParts(stem) {
  const m = stem.match(/^(\d{4})-(\d{2})-(\d{2})-/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: m[1], month: m[2], day: m[3] };
}

function datedArchiveBase(archiveDir, stem) {
  const parts = stemDateParts(stem);
  return parts ? path.join(archiveDir, parts.year, parts.month) : null;
}

function archivedPlanCandidates(archiveDir, stem) {
  const dated = datedArchiveBase(archiveDir, stem);
  const out = [];
  if (dated) out.push(path.join(dated, `${stem}.md`));
  out.push(path.join(archiveDir, `${stem}.md`)); // legacy flat
  return out;
}

function findExistingArchivedPlan(archiveDir, stem) {
  return archivedPlanCandidates(archiveDir, stem).find((p) => fs.existsSync(p)) || null;
}

function archivedEvidenceCandidates(archiveDir, stem) {
  const dated = datedArchiveBase(archiveDir, stem);
  const out = [];
  if (dated) out.push(path.join(dated, 'evidence', stem));
  out.push(path.join(archiveDir, 'evidence', stem)); // legacy flat
  return out;
}

function findExistingArchivedEvidence(archiveDir, stem) {
  return archivedEvidenceCandidates(archiveDir, stem).find((p) => fs.existsSync(p)) || null;
}

// --- docs/projects/INDEX.md plan registry ---
//
// A plan under docs/plans/ (not _archive) must have exactly one INDEX row whose Version
// column is literally `active`. Table-agnostic: scans EVERY markdown table in INDEX.md (a
// table is a `|`-line immediately followed by a `|`-separator line), finds the column
// whose header cell contains "version" case-insensitively (catches both `Version` and
// `Target version`), and treats a data row as "about" a stem only if the raw row text
// contains a `plans/<stem>.md` path (optionally through `_archive/`, dated or legacy) —
// path-scoped, not a bare-slug match, so 337 rows of Chinese prose can't false-positive.
function normalizeIndexCell(s) {
  return String(s).replace(/\*\*/g, '').trim();
}

function splitTableRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function isTableSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

function planIndexRegistration(repoRoot, stem) {
  const indexPath = path.join(repoRoot, 'docs', 'projects', 'INDEX.md');
  const text = readFileSafe(indexPath);
  if (text == null) return { indexExists: false, indexPath, matchedRows: [], activeRow: null };
  const lines = text.split(/\r?\n/);
  const stemRe = new RegExp(`plans/(?:_archive/(?:\\d{4}/\\d{2}/)?)?${escapeRegExp(stem)}\\.md`);
  const matchedRows = [];
  let activeRow = null;
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim().startsWith('|')) { i += 1; continue; }
    const headerCells = splitTableRow(lines[i]);
    const sepLine = lines[i + 1];
    if (!sepLine || !sepLine.trim().startsWith('|') || !isTableSeparatorRow(splitTableRow(sepLine))) {
      i += 1;
      continue;
    }
    const versionCol = headerCells.findIndex((c) => /version/i.test(c));
    // 🟠 fix: match the stem against the Plan-column cell ONLY when that column exists —
    // matching the whole raw row let another row's PROSE mentioning "../plans/<stem>.md"
    // (e.g. one project's Project-cell narrative referencing a different plan) register
    // that stem too, and archiveIndexRow would then rewrite/flip the WRONG row. Fall back
    // to the whole-row text only when no header cell names a Plan column at all.
    const planCol = headerCells.findIndex((c) => /plan/i.test(c));
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      const rowCells = splitTableRow(lines[j]);
      const matchTarget = planCol >= 0 && planCol < rowCells.length ? rowCells[planCol] : lines[j];
      if (stemRe.test(matchTarget)) {
        const versionCell = versionCol >= 0 && versionCol < rowCells.length
          ? normalizeIndexCell(rowCells[versionCol]) : null;
        const row = { lineIndex: j, text: lines[j], versionCell, versionCol };
        matchedRows.push(row);
        if (versionCell === 'active' && !activeRow) activeRow = row;
      }
      j += 1;
    }
    i = j;
  }
  return { indexExists: true, indexPath, matchedRows, activeRow };
}

// The row to paste for a plan that has no `active` INDEX registration yet. Date from the
// stem's own prefix (never "today" — the plan may be old); title from the plan file's own
// `# Plan — <title>` (or first `# ` heading) H1 when the file is readable, falling back to
// the slug with dashes turned to spaces. `--fix`/the gate never write this row themselves
// (design: --fix does not invent rows) — only `--register-template` prints it, and a human
// or `next-touch` pastes it.
function planTitleFromFile(plansDir, archiveDir, stem) {
  const candidates = [
    path.join(plansDir, `${stem}.md`),
    ...archivedPlanCandidates(archiveDir, stem),
  ];
  for (const p of candidates) {
    const text = readFileSafe(p);
    if (!text) continue;
    const m = text.match(/^#\s*Plan\s*[—:-]\s*(.+?)\s*$/m) || text.match(/^#\s+(.+?)\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}

function registerTemplateRow(repoRoot, plansDir, archiveDir, stem, overrides = {}) {
  const dm = stem.match(DATE_PREFIX_RE);
  const date = dm ? dm[0].replace(/-$/, '') : '(unknown-date)';
  const title = planTitleFromFile(plansDir, archiveDir, stem) || planSlug(stem).replace(/-/g, ' ');
  const version = overrides.version || 'active';
  const commit = overrides.commit || '—';
  const linkPath = overrides.linkPath || `../plans/${stem}.md`;
  return `| ${date} | [${title}](${linkPath}) | ${version} | ${commit} | [plan](${linkPath}) |`;
}

// Is `relPath` (repo-relative, POSIX) tracked by git in `repoRoot`? Used to decide whether
// a failed `git mv` may fall back to a plain filesystem rename (untracked source: no git
// history to preserve) or must instead propagate the error (tracked source: git mv failing
// is a real problem, not something to paper over with a raw rename).
function isGitTracked(repoRoot, relPath) {
  try {
    execFileSync('git', ['-C', repoRoot, 'ls-files', '--error-unmatch', '--', relPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

// Tracked files under repoRoot matching the reference-scan file-type set, excluding
// REFERENCE_SCAN_EXCLUDE. Returns repo-relative POSIX paths.
function trackedReferenceFiles(repoRoot) {
  let out;
  try {
    out = execFileSync(
      'git',
      ['-C', repoRoot, 'ls-files', '-z', '--', '*.md', '*.json', '*.sh', '*.js'],
      { encoding: 'utf8' }
    );
  } catch {
    return [];
  }
  return out.split('\0').filter(Boolean).filter((f) => !REFERENCE_SCAN_EXCLUDE.has(f));
}

// .claude/mission-routing-config.json -> its sources_path manifest -> the set of plan
// stems named by any entry's plan_path/rubric_path. Those stems are an active campaign
// lineage with a frozen source sha: archiving the plan file would silently invalidate
// that sha. Always resolved relative to repoRoot (see the --plans-dir limitation above).
function loadActiveLineageStems(repoRoot) {
  const stems = new Set();
  const routingPath = path.join(repoRoot, '.claude', 'mission-routing-config.json');
  const routingText = readFileSafe(routingPath);
  if (!routingText) return stems;
  let routing;
  try {
    routing = JSON.parse(routingText);
  } catch {
    return stems;
  }
  if (!routing || !routing.sources_path) return stems;
  const sourcesPath = path.isAbsolute(routing.sources_path)
    ? routing.sources_path
    : path.join(repoRoot, routing.sources_path);
  const sourcesText = readFileSafe(sourcesPath);
  if (!sourcesText) return stems;
  let sources;
  try {
    sources = JSON.parse(sourcesText);
  } catch {
    return stems;
  }
  const list = Array.isArray(sources.sources) ? sources.sources : [];
  for (const entry of list) {
    for (const key of ['plan_path', 'rubric_path']) {
      const rel = entry && entry[key];
      if (typeof rel !== 'string' || !rel) continue;
      // Manifest paths are docs/-relative (e.g. "plans/<stem>.md" or
      // "plans/<stem>.rubric.md") — take the basename, drop .md, then drop any further
      // dot segment (a sidecar tag) to recover the PRIMARY stem.
      const base = path.basename(rel).replace(/\.md$/, '');
      const lastDot = base.lastIndexOf('.');
      stems.add(lastDot === -1 ? base : base.slice(0, lastDot));
    }
  }
  return stems;
}

// Report-only: a tracked file names a bare docs/plans/<stem> path OR a
// docs/plans/evidence/<stem> path whose stem resolves to neither an active nor an
// archived location of that same shape. Two DISTINCT shapes, each checked against its
// own existence rule — a plan reference is dangling only if the .md is missing from both
// docs/plans/ and docs/plans/_archive/; an evidence reference is dangling only if the DIR
// is missing from both docs/plans/evidence/ and docs/plans/_archive/evidence/ (🟡 fix: a
// single "digit right after docs/plans/" pattern used to miss the evidence shape entirely
// — "evidence" is not a digit — so a stale evidence link never got reported or rewritten).
// Distinct from plan_orphan (an EXISTING plan nobody references) — this is a reference to
// something that does not exist at all, active or archived.
const DANGLING_REFERENCE_PATTERNS = [
  {
    prefix: 'docs/plans/',
    re: /docs\/plans\/(\d{4}-\d{2}-\d{2}-[A-Za-z0-9-]+)/g,
    exists: (plansDir, stem) => fs.existsSync(path.join(plansDir, `${stem}.md`))
      || Boolean(findExistingArchivedPlan(path.join(plansDir, '_archive'), stem)),
  },
  {
    prefix: 'docs/plans/evidence/',
    re: /docs\/plans\/evidence\/(\d{4}-\d{2}-\d{2}-[A-Za-z0-9-]+)/g,
    exists: (plansDir, stem) => fs.existsSync(path.join(plansDir, 'evidence', stem))
      || Boolean(findExistingArchivedEvidence(path.join(plansDir, '_archive'), stem)),
  },
];

function planReferenceDangling(repoRoot, plansDir) {
  const byKey = new Map();
  for (const rel of trackedReferenceFiles(repoRoot)) {
    const text = readFileSafe(path.join(repoRoot, rel));
    if (!text) continue;
    for (const pattern of DANGLING_REFERENCE_PATTERNS) {
      const seenInFile = new Set();
      pattern.re.lastIndex = 0;
      let m;
      while ((m = pattern.re.exec(text))) {
        const stem = m[1];
        const key = pattern.prefix + stem;
        if (seenInFile.has(key)) continue;
        seenInFile.add(key);
        if (!byKey.has(key)) byKey.set(key, { prefix: pattern.prefix, stem, exists: pattern.exists, files: new Set() });
        byKey.get(key).files.add(rel);
      }
    }
  }
  const out = [];
  for (const { prefix, stem, exists, files } of byKey.values()) {
    if (exists(plansDir, stem)) continue;
    const sortedFiles = [...files].sort();
    out.push({
      code: 'plan_reference_dangling',
      kind: 'reference',
      stem,
      path_prefix: prefix,
      files: sortedFiles,
      detail: `${sortedFiles.length} tracked file(s) reference ${prefix}${stem}, which exists in neither the active nor the archived location`,
    });
  }
  return out;
}

function loadAllowlist(p) {
  if (!p) return new Set();
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    process.stderr.write(`unreadable allowlist: ${e.message}\n`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write('unreadable allowlist: invalid JSON\n');
    process.exit(2);
  }
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.stems) ? parsed.stems : null);
  if (!list) {
    process.stderr.write('unreadable allowlist: expected a JSON array of stems (or {"stems":[...]})\n');
    process.exit(2);
  }
  return new Set(list);
}

// --- BACKLOG parsing: reuse check-backlog-entries.js's heading-style parser so this
// gate's notion of "a row" never drifts from the entry gate's. ---

function loadBacklogGate() {
  return require(path.join(SCRIPT_DIR, 'check-backlog-entries.js'));
}

function collectBacklogRows(backlogPath) {
  const text = readFileSafe(backlogPath);
  if (text == null) return { text: null, rows: [] };
  const gate = loadBacklogGate();
  const entries = gate.collectEntries(text, 'heading');
  const rows = entries
    .filter((e) => !e.unparseable && e.fields)
    .map((e) => ({
      title: (e.fields.Title || e.title || '').trim(),
      status: (e.fields.Status || '').trim(),
      pointer: (e.fields.Pointer || '').trim(),
      text: e.text,
    }));
  return { text, rows };
}

// --- plan discovery ---

const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}-/;

function isSidecar(basename) {
  // A primary plan is `<date>-<slug>.md`; a sidecar is `<same stem>.<tag>.md` — one
  // extra dot segment before the extension.
  const stem = basename.replace(/\.md$/, '');
  return /\./.test(stem);
}

function listPlanFiles(plansDir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(plansDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    if (isSidecar(ent.name)) continue;
    out.push(ent.name);
  }
  return out;
}

function planStem(basename) {
  return basename.replace(/\.md$/, '');
}

function planSlug(stem) {
  return DATE_PREFIX_RE.test(stem) ? stem.replace(DATE_PREFIX_RE, '') : stem;
}

function findSidecars(plansDir, stem) {
  let entries;
  try {
    entries = fs.readdirSync(plansDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const prefix = `${stem}.`;
  return entries
    .filter((ent) => ent.isFile() && ent.name !== `${stem}.md` && ent.name.startsWith(prefix) && ent.name.endsWith('.md'))
    .map((ent) => ent.name);
}

// A row's Pointer may name the plan itself, one of its sidecars, or anything under its
// evidence dir. Extract the candidate plan STEM (the primary `<date>-<slug>` filename,
// with no `.md` and no sidecar tag) from the pointer's shape — the caller still has to
// confirm `docs/plans/<stem>.md` (or `_archive/<stem>.md`) actually exists.
function planStemForPointer(pointer) {
  if (!pointer || pointer === 'none') return null;
  // docs/plans/<X>.md or docs/plans/_archive/<X>.md — X is either a primary plan's own
  // basename (no further dot: stem === X) or a sidecar's (`<stem>.<tag>`: strip the tag).
  let m = pointer.match(/^docs\/plans\/(?:_archive\/(?:\d{4}\/\d{2}\/)?)?([^/]+)\.md$/);
  if (m) {
    const x = m[1];
    const lastDot = x.lastIndexOf('.');
    return lastDot === -1 ? x : x.slice(0, lastDot);
  }
  // docs/plans/evidence/<stem>/... (any depth beneath the evidence dir).
  m = pointer.match(/^docs\/plans\/evidence\/([^/]+)\//);
  if (m) return m[1];
  return null;
}

// --- CHANGELOG released-section text ---

function releasedChangelogText(changelogPath) {
  const text = readFileSafe(changelogPath);
  if (text == null) return '';
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      skipping = /unreleased/i.test(m[1]);
      if (!skipping) out.push(line);
      continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

function planMentioned(released, stem, slug, pointerPathVariants) {
  for (const variant of pointerPathVariants) {
    if (released.includes(variant)) return true;
  }
  // Accept either the bare slug or the full <date>-<slug> stem, boundary-matched.
  return slugBoundaryRegExp(stem).test(released) || slugBoundaryRegExp(slug).test(released);
}

// The first (topmost = newest, CHANGELOG.md is newest-first) RELEASED `## v…` section
// whose text names the stem or its slug — used to flip an archived plan's INDEX row
// Version from `active` to a real version at archive time.
function findReleasedVersionForStem(changelogPath, stem, slug) {
  const text = readFileSafe(changelogPath);
  if (!text) return null;
  const reStem = slugBoundaryRegExp(stem);
  const reSlug = slugBoundaryRegExp(slug);
  const lines = text.split(/\r?\n/);
  let currentVersion = null;
  let currentReleased = false;
  let buffer = [];
  let found = null;
  const flush = () => {
    if (!found && currentReleased && currentVersion && buffer.length) {
      const chunk = buffer.join('\n');
      if (reStem.test(chunk) || reSlug.test(chunk)) found = currentVersion;
    }
    buffer = [];
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      flush();
      currentReleased = !/unreleased/i.test(m[1]);
      const vm = m[1].match(/v[\d.]+[\w-]*/);
      currentVersion = vm ? vm[0] : m[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return found;
}

// Rewrites EVERY matched INDEX.md row for `stem` in place — 🟡 fix: rewriting only the
// (single) "target" row left a SECOND row that also links the same plan pointing at the
// stale pre-archive path; a plan can legitimately have more than one row referencing it
// (e.g. a Fix-size follow-up row alongside the plan's own registry row). Every matched
// row's `plans/<stem>` / `plans/evidence/<stem>` occurrences are rewritten to the dated
// archive path; Version is flipped to `newVersion` on the ACTIVE row only (never invents a
// row — design). Returns `{changed:false}` when there is nothing to rewrite.
function archiveIndexRow(repoRoot, stem, { newVersion } = {}) {
  const registration = planIndexRegistration(repoRoot, stem);
  if (!registration.indexExists || !registration.matchedRows.length) return { changed: false };
  const text = fs.readFileSync(registration.indexPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const parts = stemDateParts(stem);
  const datedSeg = parts ? `${parts.year}/${parts.month}/` : '';
  let changed = false;
  const rewrittenRows = [];
  for (const row of registration.matchedRows) {
    let line = lines[row.lineIndex];
    // Matches BOTH transitions: active `plans/<stem>` -> dated archive (archiveStem's own
    // move), and legacy-flat `plans/_archive/<stem>` -> dated archive (migrateArchiveLayout,
    // which never had an active-form link to begin with) — the optional `_archive/` makes
    // this one regex serve both call sites.
    line = line.replace(
      new RegExp(`plans/(?:_archive/)?evidence/${escapeRegExp(stem)}(?![A-Za-z0-9-])`, 'g'),
      `plans/_archive/${datedSeg}evidence/${stem}`
    );
    line = line.replace(
      new RegExp(`plans/(?:_archive/)?${escapeRegExp(stem)}(?![A-Za-z0-9-])`, 'g'),
      `plans/_archive/${datedSeg}${stem}`
    );
    if (newVersion && row === registration.activeRow && row.versionCell === 'active' && row.versionCol >= 0) {
      const cells = splitTableRow(line);
      cells[row.versionCol] = newVersion;
      line = `| ${cells.join(' | ')} |`;
    }
    if (line !== lines[row.lineIndex]) {
      lines[row.lineIndex] = line;
      changed = true;
      rewrittenRows.push(line);
    }
  }
  if (!changed) return { changed: false };
  fs.writeFileSync(registration.indexPath, lines.join('\n'));
  return { changed: true, rows: rewrittenRows };
}

// --- orphan reference scan ---

function planReferenced(repoRoot, plansDir, backlogText, changelogText, stem, slug) {
  const needleStem = stem;
  const needleSlug = slug;
  const reStem = slugBoundaryRegExp(needleStem);
  const reSlug = slugBoundaryRegExp(needleSlug);
  if (changelogText && (reStem.test(changelogText) || reSlug.test(changelogText))) return true;
  if (backlogText && (reStem.test(backlogText) || reSlug.test(backlogText))) return true;
  const indexPath = path.join(repoRoot, 'docs', 'projects', 'INDEX.md');
  const indexText = readFileSafe(indexPath);
  if (indexText && (reStem.test(indexText) || reSlug.test(indexText))) return true;
  const evidenceDir = path.join(plansDir, 'evidence');
  let evidenceEntries;
  try {
    evidenceEntries = fs.readdirSync(evidenceDir, { withFileTypes: true });
  } catch {
    evidenceEntries = [];
  }
  for (const ent of evidenceEntries) {
    if (ent.isDirectory() && (ent.name === needleStem || reStem.test(ent.name) || reSlug.test(ent.name))) {
      return true;
    }
  }
  return false;
}

// --- main check ---

function run(opts) {
  const repoRoot = opts.repoRoot
    ? path.resolve(opts.repoRoot)
    : (gitToplevel(process.cwd()) || process.cwd());
  const backlogPath = opts.backlog ? path.resolve(opts.backlog) : path.join(repoRoot, 'docs', 'BACKLOG.md');
  const changelogPath = opts.changelog ? path.resolve(opts.changelog) : path.join(repoRoot, 'CHANGELOG.md');
  const plansDir = opts.plansDir ? path.resolve(opts.plansDir) : path.join(repoRoot, 'docs', 'plans');
  const archiveDir = path.join(plansDir, '_archive');
  const allowlist = loadAllowlist(opts.allowlist ? path.resolve(opts.allowlist) : null);
  const activeLineageStems = loadActiveLineageStems(repoRoot);

  const { text: backlogText, rows } = collectBacklogRows(backlogPath);
  const changelogText = readFileSafe(changelogPath) || '';
  const releasedText = releasedChangelogText(changelogPath);

  const violations = [];

  // --- BACKLOG-row checks ---
  for (const row of rows) {
    if (!row.title) continue;
    if (row.status && /^(shipped|dropped)\b/.test(row.status)) {
      violations.push({
        code: 'backlog_row_done',
        kind: 'backlog_row',
        title: row.title,
        detail: `Status: ${row.status}`,
      });
    } else if (row.pointer && row.pointer !== 'none') {
      const stem = planStemForPointer(row.pointer);
      if (stem) {
        const planExists = fs.existsSync(path.join(repoRoot, 'docs', 'plans', `${stem}.md`))
          || Boolean(findExistingArchivedPlan(path.join(repoRoot, 'docs', 'plans', '_archive'), stem));
        if (planExists) {
          violations.push({
            code: 'backlog_row_has_plan',
            kind: 'backlog_row',
            title: row.title,
            stem,
            detail: `Pointer: ${row.pointer} -> plan docs/plans/${stem}.md`,
          });
        }
      }
    }
    if (row.status === 'open' && CLOSED_MARKERS.some((marker) => row.title.includes(marker))) {
      violations.push({
        code: 'backlog_title_closed_status_open',
        kind: 'backlog_row',
        title: row.title,
        detail: 'title implies closed but Status is open',
      });
    }
  }

  // --- plan checks ---
  const activeFiles = listPlanFiles(plansDir);
  for (const basename of activeFiles) {
    const stem = planStem(basename);
    const slug = planSlug(stem);
    if (allowlist.has(stem)) continue;
    // plan_stem_malformed runs first and `continue`s — an undated or invalid-date stem
    // (month outside 01-12 / day outside 01-31) has no dated archive destination, so every
    // downstream check that assumes one (registration linking, archiving, the
    // released/lineage checks) is undefined for it. The fix is renaming the file.
    if (!stemDateParts(stem)) {
      violations.push({
        code: 'plan_stem_malformed',
        kind: 'plan',
        stem,
        path: path.join('docs', 'plans', basename),
        detail: 'stem is not a valid <YYYY-MM-DD>-<slug> (month must be 01-12, day 01-31) — '
          + 'rename the file before it can be registered or archived',
      });
      continue;
    }
    // plan_unregistered runs BEFORE the active-lineage/released `continue`s below — a live
    // campaign lineage plan is the design's most-active case and still needs a registry
    // row, and a released-but-not-yet-archived plan is still physically under docs/plans/.
    // auto-allowed (no INDEX.md at all) never fires, matching the two consumer scripts.
    const registration = planIndexRegistration(repoRoot, stem);
    if (registration.indexExists && !registration.activeRow) {
      violations.push({
        code: 'plan_unregistered',
        kind: 'plan',
        stem,
        path: path.join('docs', 'plans', basename),
        detail: `no docs/projects/INDEX.md row for this plan has Version "active" — paste: `
          + registerTemplateRow(repoRoot, plansDir, archiveDir, stem),
      });
    }
    if (activeLineageStems.has(stem)) {
      violations.push({
        code: 'plan_active_lineage',
        kind: 'plan',
        stem,
        path: path.join('docs', 'plans', basename),
        detail: 'referenced by .claude/mission-routing-config.json\'s sources manifest (active campaign lineage, frozen source sha) — excluded from plan_released_not_archived',
      });
      continue; // active lineage takes priority over released/orphan; never a move candidate
    }
    const pointerVariants = [
      `docs/plans/${basename}`,
      `docs/plans/_archive/${basename}`,
    ];
    if (planMentioned(releasedText, stem, slug, pointerVariants)) {
      violations.push({
        code: 'plan_released_not_archived',
        kind: 'plan',
        stem,
        path: path.join('docs', 'plans', basename),
        detail: `slug "${slug}" appears in a released CHANGELOG.md section`,
      });
      continue; // released takes priority; don't also report it orphaned
    }
    if (!planReferenced(repoRoot, plansDir, backlogText, changelogText, stem, slug)) {
      violations.push({
        code: 'plan_orphan',
        kind: 'plan',
        stem,
        path: path.join('docs', 'plans', basename),
        detail: 'no reference in CHANGELOG.md, docs/projects/INDEX.md, docs/plans/evidence/, or docs/BACKLOG.md',
      });
    }
  }

  // --- dangling reference scan (report-only, whole-repo) ---
  violations.push(...planReferenceDangling(repoRoot, plansDir));

  return {
    repoRoot,
    backlogPath,
    changelogPath,
    plansDir,
    archiveDir,
    allowlist,
    activeLineageStems,
    violations,
  };
}

// --- --fix ---

function fixBacklog(backlogPath, violations) {
  const rowCodes = new Set(['backlog_row_has_plan', 'backlog_row_done', 'backlog_title_closed_status_open']);
  const doomed = violations.filter((v) => v.kind === 'backlog_row' && rowCodes.has(v.code));
  if (!doomed.length) return { changed: false, removed: [] };
  const { text, rows } = collectBacklogRows(backlogPath);
  if (text == null) return { changed: false, removed: [] };
  const doomedTitles = new Set(doomed.map((v) => v.title));
  let out = text;
  const removed = [];
  for (const row of rows) {
    if (!doomedTitles.has(row.title)) continue;
    if (row.text && out.includes(row.text)) {
      out = out.replace(row.text, '');
      removed.push(row.title);
    }
  }
  if (out !== text) {
    fs.writeFileSync(backlogPath, out);
    return { changed: true, removed };
  }
  return { changed: false, removed: [] };
}

// gitMv NEVER clobbers an existing destination (🟠 fix: a plain fs.renameSync fallback
// used to silently overwrite it). Throws on any failure — the caller (fixPlans) is
// responsible for pre-checking destinations so this is normally unreached; it stays
// strict here as the last line of defense.
function gitMv(repoRoot, from, to) {
  const absTo = path.join(repoRoot, to);
  if (fs.existsSync(absTo)) {
    throw new Error(`archive destination already exists: ${to}`);
  }
  // git mv refuses when the destination directory does not already exist — make it
  // first (joined against repoRoot: `to` is repo-relative, not cwd-relative).
  fs.mkdirSync(path.join(repoRoot, path.dirname(to)), { recursive: true });
  try {
    execFileSync('git', ['-C', repoRoot, 'mv', from, to], { encoding: 'utf8' });
  } catch (err) {
    // A tracked source failing `git mv` is a real problem (permissions, a dirty index,
    // etc.) — propagate it rather than silently falling back to a raw rename that would
    // desynchronize git's index from the working tree.
    if (isGitTracked(repoRoot, from)) throw err;
    // Untracked source (never committed): safe to plain-move, but re-check the
    // destination right before the syscall — the existsSync above ran before mkdirSync,
    // and this function makes no atomicity claim across the TOCTOU gap.
    if (fs.existsSync(absTo)) {
      throw new Error(`archive destination already exists: ${to}`);
    }
    fs.renameSync(path.join(repoRoot, from), absTo);
  }
}

// Every file docs/plans/<stem>* (the plan itself, its sidecars, its evidence dir) that
// currently exists, paired with its docs/plans/_archive/ destination. Pure planning — no
// filesystem writes — so fixPlans can check every destination for a stem BEFORE moving
// anything (all-or-nothing: 🟠 fix, a partial move used to leave the stem half-archived
// when a later file in the set clashed).
function planFileMoveSet(repoRoot, plansDir, archiveDir, stem) {
  const destDir = datedArchiveBase(archiveDir, stem);
  // 🟠 fix: no flat-archiveDir fallback for an undated/malformed stem — that used to
  // misfile it into the legacy archive where --migrate-archive-layout can never find it
  // again (its date-prefix filter never matches such a stem). Callers must reject a
  // malformed stem BEFORE calling this (run()'s plan_stem_malformed / archiveStems'
  // stem_date_malformed refusal) — this is the last line of defense: no destination, no
  // moves, nothing to do.
  if (!destDir) return [];
  const moves = [];
  const basename = `${stem}.md`;
  const srcRel = path.relative(repoRoot, path.join(plansDir, basename));
  const dstRel = path.relative(repoRoot, path.join(destDir, basename));
  if (fs.existsSync(path.join(repoRoot, srcRel))) moves.push({ from: srcRel, to: dstRel });
  for (const sidecar of findSidecars(plansDir, stem)) {
    const sSrcRel = path.relative(repoRoot, path.join(plansDir, sidecar));
    const sDstRel = path.relative(repoRoot, path.join(destDir, sidecar));
    if (fs.existsSync(path.join(repoRoot, sSrcRel))) moves.push({ from: sSrcRel, to: sDstRel });
  }
  const evidenceDir = path.join(plansDir, 'evidence', stem);
  if (fs.existsSync(evidenceDir)) {
    const eSrcRel = path.relative(repoRoot, evidenceDir);
    const eDstRel = path.relative(repoRoot, path.join(destDir, 'evidence', stem));
    moves.push({ from: eSrcRel, to: eDstRel });
  }
  return moves;
}

// docs/plans/<stem> occurrences in every OTHER tracked reference file (Hardening B: no
// dangling references) — rewritten to docs/plans/_archive/<stem> so a skill doc, a
// reference, or a config that links the plan keeps resolving after the move.
function rewritePlanReferences(repoRoot, stem) {
  // Evidence pass FIRST: `docs/plans/evidence/<stem>` also contains `docs/plans/` but
  // never `docs/plans/<stem>` immediately (planPathPrefixRegExp requires the stem right
  // after `docs/plans/`, and "evidence" sits there instead) — so the two passes never
  // double-touch the same substring, and order between them does not matter for
  // correctness. Both run over every file regardless.
  // Dated archive: the replacement target includes <YYYY>/<MM> parsed from the stem's own
  // date prefix (see stemDateParts) — falls back to the legacy flat _archive/<stem> shape
  // only when the stem itself has no parseable date.
  const parts = stemDateParts(stem);
  const datedSeg = parts ? `${parts.year}/${parts.month}/` : '';
  const passes = [
    { re: evidencePathPrefixRegExp(stem), replacement: `docs/plans/_archive/${datedSeg}evidence/${stem}` },
    { re: planPathPrefixRegExp(stem), replacement: `docs/plans/_archive/${datedSeg}${stem}` },
  ];
  const rewritten = [];
  for (const rel of trackedReferenceFiles(repoRoot)) {
    const abs = path.join(repoRoot, rel);
    let text = readFileSafe(abs);
    if (text == null) continue;
    let changed = false;
    for (const { re, replacement } of passes) {
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const out = text.replace(re, replacement);
      if (out !== text) {
        text = out;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(abs, text);
      rewritten.push(rel);
    }
  }
  return rewritten;
}

// Moves every plan_released_not_archived violation's files to docs/plans/_archive/, then
// rewrites surviving references to each successfully-moved stem. All-or-nothing per stem:
// every destination in that stem's move set is checked for a pre-existing file BEFORE any
// move for that stem starts. A clash skips the WHOLE stem (nothing moves, nothing is
// rewritten) and records archive_destination_exists instead of moved/reference entries.
// The shared per-stem archive body: all-or-nothing move (plan + sidecars + evidence,
// dated destination), reference rewrite (incl. evidence paths), then — best-effort, never
// inventing a row — flip the stem's INDEX registry row. Used by both `--fix` (released
// plans; version comes from the CHANGELOG section that names it) and `--archive` (explicit
// stems; version comes from `--shipped-in` or defaults to `shipped`).
function archiveStem(repoRoot, plansDir, archiveDir, stem, { newVersion } = {}) {
  const moves = planFileMoveSet(repoRoot, plansDir, archiveDir, stem);
  if (!moves.length) return { moved: [], blocked: [], referencesRewritten: null, indexRowChanged: false };
  const clobbered = moves.filter((m) => fs.existsSync(path.join(repoRoot, m.to)));
  if (clobbered.length) {
    return {
      moved: [],
      referencesRewritten: null,
      indexRowChanged: false,
      blocked: clobbered.map((m) => ({
        code: 'archive_destination_exists',
        kind: 'plan',
        stem,
        path: m.to,
        detail: `skipped this stem's move: ${m.to} already exists`,
      })),
    };
  }
  for (const m of moves) gitMv(repoRoot, m.from, m.to);
  const rewritten = rewritePlanReferences(repoRoot, stem);
  const indexResult = archiveIndexRow(repoRoot, stem, { newVersion });
  return {
    moved: moves,
    blocked: [],
    referencesRewritten: rewritten.length ? { stem, files: rewritten } : null,
    indexRowChanged: indexResult.changed,
  };
}

function fixPlans(repoRoot, plansDir, archiveDir, violations, activeLineageStems, changelogPath) {
  const doomed = violations.filter((v) => v.kind === 'plan' && v.code === 'plan_released_not_archived');
  const moved = [];
  const referencesRewritten = [];
  const blocked = [];
  const indexRowsFlipped = [];
  for (const v of doomed) {
    const stem = v.stem;
    if (activeLineageStems && activeLineageStems.has(stem)) continue; // defense in depth
    const slug = planSlug(stem);
    const newVersion = changelogPath ? findReleasedVersionForStem(changelogPath, stem, slug) : null;
    const result = archiveStem(repoRoot, plansDir, archiveDir, stem, { newVersion });
    if (result.blocked.length) {
      blocked.push(...result.blocked);
      continue;
    }
    if (!result.moved.length) continue;
    moved.push(...result.moved);
    if (result.referencesRewritten) referencesRewritten.push(result.referencesRewritten);
    if (result.indexRowChanged) indexRowsFlipped.push(stem);
  }
  return { moved, blocked, referencesRewritten, indexRowsFlipped };
}

// The --migrate-archive-layout counterpart of rewritePlanReferences: rewrites an already
// LEGACY-FLAT archived reference (`docs/plans/_archive/<stem>` /
// `docs/plans/_archive/evidence/<stem>`) to its dated form. Distinct from
// rewritePlanReferences, which only ever matches the ACTIVE form (`docs/plans/<stem>`,
// no `_archive/`) — a legacy archived plan never had an active-form link to begin with,
// so that function's regex (by design) does not touch it.
function rewriteLegacyArchiveReferences(repoRoot, stem) {
  const parts = stemDateParts(stem);
  if (!parts) return [];
  const datedSeg = `${parts.year}/${parts.month}/`;
  const passes = [
    {
      re: new RegExp(`docs/plans/_archive/evidence/${escapeRegExp(stem)}(?![A-Za-z0-9-])`, 'g'),
      replacement: `docs/plans/_archive/${datedSeg}evidence/${stem}`,
    },
    {
      re: new RegExp(`docs/plans/_archive/${escapeRegExp(stem)}(?![A-Za-z0-9-])`, 'g'),
      replacement: `docs/plans/_archive/${datedSeg}${stem}`,
    },
  ];
  const rewritten = [];
  for (const rel of trackedReferenceFiles(repoRoot)) {
    const abs = path.join(repoRoot, rel);
    let text = readFileSafe(abs);
    if (text == null) continue;
    let changed = false;
    for (const { re, replacement } of passes) {
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const out = text.replace(re, replacement);
      if (out !== text) {
        text = out;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(abs, text);
      rewritten.push(rel);
    }
  }
  return rewritten;
}

// --archive <stem> [--archive <stem>...] [--shipped-in <v>]: an explicit archive action
// for a plan that is verified shipped but whose slug never made it into a CHANGELOG
// section (the orphan case `plan_released_not_archived` cannot catch — that check only
// fires on a CHANGELOG mention). Reuses archiveStem exactly: same all-or-nothing move
// (dated destination), no-clobber, reference rewrite (incl. evidence paths). If the plan
// has an `active` INDEX row, its Version flips to `--shipped-in` (or literal `shipped`
// when omitted) same as --fix's released-archive path; if it has NO row at all,
// --archive (unlike --fix) appends one with that Version so the archive is still
// recorded — the whole point of this action is "this WAS shipped, record it as such."
function archiveStems(repoRoot, plansDir, archiveDir, stems, shippedIn, activeLineageStems) {
  const version = shippedIn || 'shipped';
  const results = [];
  for (const stem of stems) {
    const planPath = path.join(plansDir, `${stem}.md`);
    if (!fs.existsSync(planPath)) {
      results.push({ stem, ok: false, reason: `not a live plan: docs/plans/${stem}.md does not exist` });
      continue;
    }
    if (!stemDateParts(stem)) {
      results.push({ stem, ok: false, reason: 'stem_date_malformed' });
      continue;
    }
    if (activeLineageStems && activeLineageStems.has(stem)) {
      results.push({ stem, ok: false, reason: 'active campaign lineage (frozen source sha) — refused' });
      continue;
    }
    const before = planIndexRegistration(repoRoot, stem);
    const result = archiveStem(repoRoot, plansDir, archiveDir, stem, { newVersion: version });
    if (result.blocked.length) {
      results.push({ stem, ok: false, reason: 'archive_destination_exists', blocked: result.blocked });
      continue;
    }
    let indexAction = 'unchanged';
    if (result.indexRowChanged) {
      indexAction = 'flipped';
    } else if (!before.activeRow) {
      const parts = stemDateParts(stem);
      const datedSeg = parts ? `${parts.year}/${parts.month}/` : '';
      const row = registerTemplateRow(repoRoot, plansDir, archiveDir, stem, {
        version,
        linkPath: `../plans/_archive/${datedSeg}${stem}.md`,
      });
      if (appendRegistryRow(repoRoot, row)) indexAction = 'appended';
    }
    results.push({
      stem, ok: true, moved: result.moved, referencesRewritten: result.referencesRewritten, indexAction,
    });
  }
  return results;
}

// Appends `rowText` as the newest row of the "## 進行中 (In Progress)" table — the plan
// registry's append target (same table `--register-template`'s row is meant to be pasted
// into). Never invented by --fix; only --archive appends, and only when no row exists at
// all to flip.
function appendRegistryRow(repoRoot, rowText) {
  const indexPath = path.join(repoRoot, 'docs', 'projects', 'INDEX.md');
  const text = readFileSafe(indexPath);
  if (text == null) return false;
  const lines = text.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => /^##\s+進行中/.test(l));
  if (headingIdx === -1) return false;
  let i = headingIdx + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|')) i += 1;
  if (i >= lines.length) return false;
  lines.splice(i + 2, 0, rowText);
  fs.writeFileSync(indexPath, lines.join('\n'));
  return true;
}

// --migrate-archive-layout: one-time move of every legacy FLAT archived plan (+sidecars,
// +evidence dir) into the dated layout, and every docs/projects/_archive/<date>-<name>/
// project dir into docs/projects/_archive/<YYYY>/<MM>/<name-with-date>/, rewriting
// references in tracked files (excluding CHANGELOG.md/docs/BACKLOG.md, same exclusion as
// everywhere else — those are history) as it goes. All-or-nothing per stem/dir; no-clobber.
function migrateArchiveLayout(repoRoot, plansDir, archiveDir) {
  const plansMoved = [];
  const plansBlocked = [];
  const projectsMoved = [];
  const projectsBlocked = [];
  const referencesRewritten = new Set();

  let entries = [];
  try {
    entries = fs.readdirSync(archiveDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const stems = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !isSidecar(e.name))
    .map((e) => planStem(e.name))
    .filter((s) => stemDateParts(s));
  for (const stem of stems) {
    const dated = datedArchiveBase(archiveDir, stem);
    const basename = `${stem}.md`;
    const moves = [{ from: path.join(archiveDir, basename), to: path.join(dated, basename) }];
    for (const sidecar of findSidecars(archiveDir, stem)) {
      moves.push({ from: path.join(archiveDir, sidecar), to: path.join(dated, sidecar) });
    }
    const evDir = path.join(archiveDir, 'evidence', stem);
    if (fs.existsSync(evDir)) moves.push({ from: evDir, to: path.join(dated, 'evidence', stem) });
    const clobbered = moves.filter((m) => fs.existsSync(m.to));
    if (clobbered.length) {
      plansBlocked.push({
        stem,
        code: 'archive_destination_exists',
        detail: `migrate skipped: ${path.relative(repoRoot, clobbered[0].to)} already exists`,
      });
      continue;
    }
    for (const m of moves) {
      gitMv(repoRoot, path.relative(repoRoot, m.from), path.relative(repoRoot, m.to));
      plansMoved.push({ from: path.relative(repoRoot, m.from), to: path.relative(repoRoot, m.to) });
    }
    for (const f of rewriteLegacyArchiveReferences(repoRoot, stem)) referencesRewritten.add(f);
    if (archiveIndexRow(repoRoot, stem, {}).changed) referencesRewritten.add('docs/projects/INDEX.md');
  }

  const projectsArchiveDir = path.join(repoRoot, 'docs', 'projects', '_archive');
  let projEntries = [];
  try {
    projEntries = fs.readdirSync(projectsArchiveDir, { withFileTypes: true });
  } catch {
    projEntries = [];
  }
  for (const ent of projEntries) {
    if (!ent.isDirectory()) continue;
    const m = ent.name.match(/^(\d{4})-(\d{2})-\d{2}-/);
    if (!m) continue;
    const from = path.join(projectsArchiveDir, ent.name);
    const to = path.join(projectsArchiveDir, m[1], m[2], ent.name);
    if (fs.existsSync(to)) {
      projectsBlocked.push({
        dir: ent.name,
        code: 'archive_destination_exists',
        detail: `migrate skipped: ${path.relative(repoRoot, to)} already exists`,
      });
      continue;
    }
    gitMv(repoRoot, path.relative(repoRoot, from), path.relative(repoRoot, to));
    projectsMoved.push({ from: path.relative(repoRoot, from), to: path.relative(repoRoot, to) });
    // Two link shapes to rewrite: the full repo-relative `docs/projects/_archive/<name>`
    // (skills, references, other docs reaching in from elsewhere), and the BARE
    // `_archive/<name>` shape INDEX.md itself uses (INDEX.md lives inside docs/projects/,
    // so its own links to `_archive/` never carry the `docs/projects/` prefix).
    const fromRel = `docs/projects/_archive/${ent.name}`;
    const toRel = `docs/projects/_archive/${m[1]}/${m[2]}/${ent.name}`;
    const bareFrom = `_archive/${ent.name}`;
    const bareTo = `_archive/${m[1]}/${m[2]}/${ent.name}`;
    const boundaryRe = new RegExp(`${escapeRegExp(fromRel)}(?![A-Za-z0-9-])`, 'g');
    const bareRe = new RegExp(`(?<![A-Za-z0-9-/])${escapeRegExp(bareFrom)}(?![A-Za-z0-9-])`, 'g');
    for (const rel of trackedReferenceFiles(repoRoot)) {
      const abs = path.join(repoRoot, rel);
      let t = readFileSafe(abs);
      if (t == null) continue;
      let changed = false;
      boundaryRe.lastIndex = 0;
      if (boundaryRe.test(t)) {
        boundaryRe.lastIndex = 0;
        t = t.replace(boundaryRe, toRel);
        changed = true;
      }
      bareRe.lastIndex = 0;
      if (bareRe.test(t)) {
        bareRe.lastIndex = 0;
        t = t.replace(bareRe, bareTo);
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(abs, t);
        referencesRewritten.add(rel);
      }
    }
  }

  return {
    plansMoved,
    plansBlocked,
    projectsMoved,
    projectsBlocked,
    referencesRewritten: [...referencesRewritten].sort(),
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.registerTemplate) {
    const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : (gitToplevel(process.cwd()) || process.cwd());
    const plansDir = opts.plansDir ? path.resolve(opts.plansDir) : path.join(repoRoot, 'docs', 'plans');
    const archiveDir = path.join(plansDir, '_archive');
    process.stdout.write(`${registerTemplateRow(repoRoot, plansDir, archiveDir, opts.registerTemplate)}\n`);
    process.exit(0);
  }

  if (opts.migrateArchiveLayout) {
    const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : (gitToplevel(process.cwd()) || process.cwd());
    const plansDir = opts.plansDir ? path.resolve(opts.plansDir) : path.join(repoRoot, 'docs', 'plans');
    const archiveDir = path.join(plansDir, '_archive');
    const result = migrateArchiveLayout(repoRoot, plansDir, archiveDir);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stdout.write(`--migrate-archive-layout: moved ${result.plansMoved.length} plan file(s), `
        + `${result.projectsMoved.length} project dir(s); rewrote ${result.referencesRewritten.length} file(s); `
        + `${result.plansBlocked.length + result.projectsBlocked.length} blocked\n`);
    }
    process.exit((result.plansBlocked.length || result.projectsBlocked.length) ? 1 : 0);
  }

  if (opts.archive.length) {
    const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : (gitToplevel(process.cwd()) || process.cwd());
    const plansDir = opts.plansDir ? path.resolve(opts.plansDir) : path.join(repoRoot, 'docs', 'plans');
    const archiveDir = path.join(plansDir, '_archive');
    const activeLineageStems = loadActiveLineageStems(repoRoot);
    const results = archiveStems(repoRoot, plansDir, archiveDir, opts.archive, opts.shippedIn, activeLineageStems);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ results })}\n`);
    } else {
      for (const r of results) {
        if (r.ok) process.stdout.write(`archived ${r.stem}: index ${r.indexAction}\n`);
        else process.stdout.write(`refused ${r.stem}: ${r.reason}\n`);
      }
    }
    process.exit(results.every((r) => r.ok) ? 0 : (results.some((r) => r.reason === 'archive_destination_exists') ? 1 : 2));
  }

  const preFix = run(opts);
  let backlogFix = { changed: false, removed: [] };
  let plansFix = { moved: [], blocked: [], referencesRewritten: [] };
  let finalResult = preFix;
  if (opts.fix) {
    backlogFix = fixBacklog(preFix.backlogPath, preFix.violations);
    plansFix = fixPlans(
      preFix.repoRoot, preFix.plansDir, preFix.archiveDir, preFix.violations, preFix.activeLineageStems,
      preFix.changelogPath
    );
    // Re-run the full check against the now-fixed repo: exit/ok are derived from what
    // --fix actually left behind, not from the pre-fix snapshot (🟡 fix).
    finalResult = run(opts);
    // archive_destination_exists is discovered DURING the fix attempt, not by run() — it
    // is not naturally re-derivable from a fresh scan (the corresponding
    // plan_released_not_archived violation IS re-derivable and will already be back in
    // finalResult.violations for that stem; this adds the more specific reason).
    finalResult.violations = finalResult.violations.concat(plansFix.blocked);
  }

  const blocking = finalResult.violations.filter((v) => BLOCKING_CODES.has(v.code));
  const byCode = {};
  for (const code of CODES) byCode[code] = 0;
  for (const v of finalResult.violations) byCode[v.code] = (byCode[v.code] || 0) + 1;

  const exitCode = blocking.length ? 1 : 0;
  const payload = {
    ok: exitCode === 0,
    exit: exitCode,
    violations: finalResult.violations,
    fixed: opts.fix ? preFix.violations : undefined,
    counts: byCode,
    fix: opts.fix ? {
      backlog_rows_removed: backlogFix.removed,
      plans_moved: plansFix.moved,
      references_rewritten: plansFix.referencesRewritten,
    } : undefined,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    if (finalResult.violations.length === 0) {
      process.stdout.write('check-plan-graduation: clean\n');
    } else {
      for (const v of finalResult.violations) {
        const where = v.kind === 'backlog_row' ? `BACKLOG row "${v.title}"`
          : v.kind === 'reference' ? `docs/plans/${v.stem}`
            : v.path;
        const tag = BLOCKING_CODES.has(v.code) ? v.code : `${v.code} (report-only)`;
        process.stdout.write(`${tag}: ${where} — ${v.detail}\n`);
      }
    }
    if (opts.fix) {
      if (backlogFix.removed.length) {
        process.stdout.write(`--fix: removed ${backlogFix.removed.length} BACKLOG row(s):\n`);
        for (const t of backlogFix.removed) process.stdout.write(`  - ${t}\n`);
      }
      if (plansFix.moved.length) {
        process.stdout.write(`--fix: moved ${plansFix.moved.length} plan file(s) into _archive:\n`);
        for (const m of plansFix.moved) process.stdout.write(`  - ${m.from} -> ${m.to}\n`);
      }
      if (plansFix.referencesRewritten.length) {
        process.stdout.write('--fix: rewrote surviving references:\n');
        for (const r of plansFix.referencesRewritten) {
          process.stdout.write(`  - ${r.stem}: ${r.files.join(', ')}\n`);
        }
      }
      if (plansFix.blocked.length) {
        process.stdout.write(`--fix: ${plansFix.blocked.length} stem(s) skipped (archive_destination_exists)\n`);
      }
    }
  }
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  CODES,
  BLOCKING_CODES,
  REPORT_ONLY_CODES,
  CLOSED_MARKERS,
  run,
  fixBacklog,
  fixPlans,
  listPlanFiles,
  planStem,
  planSlug,
  isSidecar,
  releasedChangelogText,
  planMentioned,
  planReferenced,
  collectBacklogRows,
  planStemForPointer,
  slugBoundaryRegExp,
  loadActiveLineageStems,
  planReferenceDangling,
  rewritePlanReferences,
  isGitTracked,
  trackedReferenceFiles,
  planPathPrefixRegExp,
  evidencePathPrefixRegExp,
  stemDateParts,
  datedArchiveBase,
  findExistingArchivedPlan,
  findExistingArchivedEvidence,
  planIndexRegistration,
  registerTemplateRow,
  findReleasedVersionForStem,
  archiveIndexRow,
  archiveStem,
  archiveStems,
  appendRegistryRow,
  migrateArchiveLayout,
  rewriteLegacyArchiveReferences,
  planFileMoveSet,
  gitMv,
};
