#!/usr/bin/env node
'use strict';

/**
 * check-plan-graduation.js — plan-graduation lifecycle gate.
 *
 * BACKLOG is a queue → a plan is the project for campaign work → a 🔵 review finding
 * never becomes a BACKLOG row. This gate enforces the first two mechanically:
 *
 *   backlog_row_has_plan          row Pointer resolves to an existing docs/plans/*.md
 *                                 (docs/plans/_archive/*.md counts too — "archived or not")
 *   backlog_row_done              row Status starts with shipped/dropped
 *   backlog_title_closed_status_open
 *                                 title contains ~~, CLOSED, SHIPPED, FIXED v, or LANDED
 *                                 but Status is still open
 *   plan_released_not_archived    a docs/plans/*.md whose slug (stem minus leading date)
 *                                 is mentioned, word-boundary, in a released
 *                                 (non-"Unreleased") `## v…` CHANGELOG.md section
 *   plan_orphan                   report-only, non-blocking: no reference to the plan in
 *                                 CHANGELOG.md, docs/projects/INDEX.md, any
 *                                 docs/plans/evidence/ dir name, or docs/BACKLOG.md
 *
 * --fix deletes the offending BACKLOG rows (backlog_row_has_plan, backlog_row_done,
 * backlog_title_closed_status_open) and git mv's released plans — plus their
 * `<same stem>.*.md` sidecars and `docs/plans/evidence/<stem>/` dir, if present —
 * into docs/plans/_archive/, preserving names. It never touches plan_orphan findings
 * (report-only).
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
 * Exit: 0 clean (plan_orphan alone never blocks) · 1 blocking violations found · 2 usage
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
]);
const REPORT_ONLY_CODES = new Set(['plan_orphan']);
const CODES = [...BLOCKING_CODES, ...REPORT_ONLY_CODES];

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
  const re = new RegExp(`\\b${escapeRegExp(slug)}\\b`);
  return re.test(released);
}

// --- orphan reference scan ---

function planReferenced(repoRoot, plansDir, backlogText, changelogText, stem, slug) {
  const needleStem = stem;
  const needleSlug = slug;
  const reStem = new RegExp(`\\b${escapeRegExp(needleStem)}\\b`);
  const reSlug = new RegExp(`\\b${escapeRegExp(needleSlug)}\\b`);
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
      const m = row.pointer.match(/^docs\/plans\/(?:_archive\/)?([^/]+\.md)$/);
      if (m) {
        const abs = path.join(repoRoot, row.pointer);
        if (fs.existsSync(abs)) {
          violations.push({
            code: 'backlog_row_has_plan',
            kind: 'backlog_row',
            title: row.title,
            detail: `Pointer: ${row.pointer}`,
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

  return {
    repoRoot,
    backlogPath,
    changelogPath,
    plansDir,
    archiveDir,
    allowlist,
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

function gitMv(repoRoot, from, to) {
  // git mv refuses when the destination directory does not already exist — make it
  // first (joined against repoRoot: `to` is repo-relative, not cwd-relative).
  fs.mkdirSync(path.join(repoRoot, path.dirname(to)), { recursive: true });
  try {
    execFileSync('git', ['-C', repoRoot, 'mv', from, to], { encoding: 'utf8' });
  } catch {
    // Not tracked yet, or git mv otherwise refused — fall back to a plain move so
    // --fix still converges; `git add` of the destination is left to the caller.
    fs.renameSync(path.join(repoRoot, from), path.join(repoRoot, to));
  }
}

function fixPlans(repoRoot, plansDir, archiveDir, violations) {
  const doomed = violations.filter((v) => v.kind === 'plan' && v.code === 'plan_released_not_archived');
  const moved = [];
  for (const v of doomed) {
    const stem = v.stem;
    const basename = `${stem}.md`;
    const srcRel = path.relative(repoRoot, path.join(plansDir, basename));
    const dstRel = path.relative(repoRoot, path.join(archiveDir, basename));
    if (!fs.existsSync(path.join(repoRoot, srcRel))) continue;
    gitMv(repoRoot, srcRel, dstRel);
    moved.push({ from: srcRel, to: dstRel });
    for (const sidecar of findSidecars(plansDir, stem)) {
      const sSrcRel = path.relative(repoRoot, path.join(plansDir, sidecar));
      const sDstRel = path.relative(repoRoot, path.join(archiveDir, sidecar));
      if (!fs.existsSync(path.join(repoRoot, sSrcRel))) continue;
      gitMv(repoRoot, sSrcRel, sDstRel);
      moved.push({ from: sSrcRel, to: sDstRel });
    }
    const evidenceDir = path.join(plansDir, 'evidence', stem);
    if (fs.existsSync(evidenceDir)) {
      const eSrcRel = path.relative(repoRoot, evidenceDir);
      const eDstRel = path.relative(repoRoot, path.join(archiveDir, 'evidence', stem));
      gitMv(repoRoot, eSrcRel, eDstRel);
      moved.push({ from: eSrcRel, to: eDstRel });
    }
  }
  return moved;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = run(opts);
  let backlogFix = { changed: false, removed: [] };
  let plansMoved = [];
  if (opts.fix) {
    backlogFix = fixBacklog(result.backlogPath, result.violations);
    plansMoved = fixPlans(result.repoRoot, result.plansDir, result.archiveDir, result.violations);
  }

  const blocking = result.violations.filter((v) => BLOCKING_CODES.has(v.code));
  const byCode = {};
  for (const code of CODES) byCode[code] = 0;
  for (const v of result.violations) byCode[v.code] = (byCode[v.code] || 0) + 1;

  const exitCode = blocking.length ? 1 : 0;
  const payload = {
    ok: exitCode === 0,
    exit: exitCode,
    violations: result.violations,
    counts: byCode,
    fix: opts.fix ? { backlog_rows_removed: backlogFix.removed, plans_moved: plansMoved } : undefined,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    if (result.violations.length === 0) {
      process.stdout.write('check-plan-graduation: clean\n');
    } else {
      for (const v of result.violations) {
        const where = v.kind === 'backlog_row' ? `BACKLOG row "${v.title}"` : v.path;
        const tag = BLOCKING_CODES.has(v.code) ? v.code : `${v.code} (report-only)`;
        process.stdout.write(`${tag}: ${where} — ${v.detail}\n`);
      }
    }
    if (opts.fix) {
      if (backlogFix.removed.length) {
        process.stdout.write(`--fix: removed ${backlogFix.removed.length} BACKLOG row(s):\n`);
        for (const t of backlogFix.removed) process.stdout.write(`  - ${t}\n`);
      }
      if (plansMoved.length) {
        process.stdout.write(`--fix: moved ${plansMoved.length} plan file(s) into _archive:\n`);
        for (const m of plansMoved) process.stdout.write(`  - ${m.from} -> ${m.to}\n`);
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
};
