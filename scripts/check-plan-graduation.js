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
 *   - DANGLING_REFERENCE_RE (plan_reference_dangling) matches within a single line; a
 *     `docs/plans/<stem>` mention word-wrapped across a line break in a long comment (the
 *     stem hyphenated at the line boundary) is truncated at the break and reported
 *     dangling even when the real, unbroken stem exists (observed: evals/consult-eval-
 *     generator.js, evals/discuss-eval-grader.js)
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
    '[--allowlist <file>] [--fix] [--json]\n'
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
// itself, any of its sidecars, and its evidence dir, but never a DIFFERENT stem that
// happens to start with this one (e.g. stem "2026-01-01-widget" must not match inside
// "2026-01-01-widget-v2").
function planPathPrefixRegExp(stem) {
  return new RegExp(`docs/plans/${escapeRegExp(stem)}(?![A-Za-z0-9-])`, 'g');
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

// Report-only: a tracked file names a bare docs/plans/<stem> path (NOT under evidence/ or
// _archive/ — this is specifically about the direct plan-file/sidecar shape) whose stem
// resolves to neither an active nor an archived plan file. Distinct from plan_orphan
// (an EXISTING plan nobody references) — this is a reference to a plan that does not
// exist at all, active or archived.
const DANGLING_REFERENCE_RE = /docs\/plans\/(\d{4}-\d{2}-\d{2}-[A-Za-z0-9-]+)/g;

function planReferenceDangling(repoRoot, plansDir) {
  const byStem = new Map();
  for (const rel of trackedReferenceFiles(repoRoot)) {
    const text = readFileSafe(path.join(repoRoot, rel));
    if (!text) continue;
    const seenInFile = new Set();
    DANGLING_REFERENCE_RE.lastIndex = 0;
    let m;
    while ((m = DANGLING_REFERENCE_RE.exec(text))) {
      const stem = m[1];
      if (seenInFile.has(stem)) continue;
      seenInFile.add(stem);
      if (!byStem.has(stem)) byStem.set(stem, new Set());
      byStem.get(stem).add(rel);
    }
  }
  const out = [];
  for (const [stem, files] of byStem) {
    const exists = fs.existsSync(path.join(plansDir, `${stem}.md`))
      || fs.existsSync(path.join(plansDir, '_archive', `${stem}.md`));
    if (exists) continue;
    const sortedFiles = [...files].sort();
    out.push({
      code: 'plan_reference_dangling',
      kind: 'reference',
      stem,
      files: sortedFiles,
      detail: `${sortedFiles.length} tracked file(s) reference docs/plans/${stem}, which exists in neither docs/plans/ nor docs/plans/_archive/`,
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
  let m = pointer.match(/^docs\/plans\/(?:_archive\/)?([^/]+)\.md$/);
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
          || fs.existsSync(path.join(repoRoot, 'docs', 'plans', '_archive', `${stem}.md`));
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
  const moves = [];
  const basename = `${stem}.md`;
  const srcRel = path.relative(repoRoot, path.join(plansDir, basename));
  const dstRel = path.relative(repoRoot, path.join(archiveDir, basename));
  if (fs.existsSync(path.join(repoRoot, srcRel))) moves.push({ from: srcRel, to: dstRel });
  for (const sidecar of findSidecars(plansDir, stem)) {
    const sSrcRel = path.relative(repoRoot, path.join(plansDir, sidecar));
    const sDstRel = path.relative(repoRoot, path.join(archiveDir, sidecar));
    if (fs.existsSync(path.join(repoRoot, sSrcRel))) moves.push({ from: sSrcRel, to: sDstRel });
  }
  const evidenceDir = path.join(plansDir, 'evidence', stem);
  if (fs.existsSync(evidenceDir)) {
    const eSrcRel = path.relative(repoRoot, evidenceDir);
    const eDstRel = path.relative(repoRoot, path.join(archiveDir, 'evidence', stem));
    moves.push({ from: eSrcRel, to: eDstRel });
  }
  return moves;
}

// docs/plans/<stem> occurrences in every OTHER tracked reference file (Hardening B: no
// dangling references) — rewritten to docs/plans/_archive/<stem> so a skill doc, a
// reference, or a config that links the plan keeps resolving after the move.
function rewritePlanReferences(repoRoot, stem) {
  const re = planPathPrefixRegExp(stem);
  const replacement = `docs/plans/_archive/${stem}`;
  const rewritten = [];
  for (const rel of trackedReferenceFiles(repoRoot)) {
    const abs = path.join(repoRoot, rel);
    const text = readFileSafe(abs);
    if (text == null) continue;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const out = text.replace(re, replacement);
    if (out !== text) {
      fs.writeFileSync(abs, out);
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
function fixPlans(repoRoot, plansDir, archiveDir, violations, activeLineageStems) {
  const doomed = violations.filter((v) => v.kind === 'plan' && v.code === 'plan_released_not_archived');
  const moved = [];
  const referencesRewritten = [];
  const blocked = [];
  for (const v of doomed) {
    const stem = v.stem;
    if (activeLineageStems && activeLineageStems.has(stem)) continue; // defense in depth
    const moves = planFileMoveSet(repoRoot, plansDir, archiveDir, stem);
    if (!moves.length) continue;
    const clobbered = moves.filter((m) => fs.existsSync(path.join(repoRoot, m.to)));
    if (clobbered.length) {
      for (const m of clobbered) {
        blocked.push({
          code: 'archive_destination_exists',
          kind: 'plan',
          stem,
          path: m.to,
          detail: `--fix skipped this stem's move: ${m.to} already exists`,
        });
      }
      continue; // all-or-nothing: do not move ANY file for this stem
    }
    for (const m of moves) {
      gitMv(repoRoot, m.from, m.to);
      moved.push(m);
    }
    const rewritten = rewritePlanReferences(repoRoot, stem);
    if (rewritten.length) referencesRewritten.push({ stem, files: rewritten });
  }
  return { moved, blocked, referencesRewritten };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const preFix = run(opts);
  let backlogFix = { changed: false, removed: [] };
  let plansFix = { moved: [], blocked: [], referencesRewritten: [] };
  let finalResult = preFix;
  if (opts.fix) {
    backlogFix = fixBacklog(preFix.backlogPath, preFix.violations);
    plansFix = fixPlans(
      preFix.repoRoot, preFix.plansDir, preFix.archiveDir, preFix.violations, preFix.activeLineageStems
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
};
