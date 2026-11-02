#!/usr/bin/env node
'use strict';
// relayout-p1.js -- generator for the 3.0.0 relayout phase P1 "docs split" (plan section 3, P1; F2, F5, D9.4, D9.5).
// Node built-ins only. This round implements the dry run only: `plan` classifies every tracked file under docs/, writes a
// layout-map and a human summary, and changes nothing in the repo. `apply` is an interface stub (exit 2).
//
//   plan  [--root <dir>] [--out-dir <dir>] [--registry <file>] [--archived-evidence move|stay] [--with-refs] [--simulate]
//     Writes into --out-dir (default: print the summary to stdout and write nothing):
//       layout-map.json   { "<old path>": "<new path>" } -- one-to-one renames ONLY (the shape seal-baseline and suite-baseline read)
//       plan.json         everything machine-readable: counts per category, pending rulings, content operations, registry
//                         changes, no-rewrite overlap, reference-rewrite estimate, sync/run.sh coverage, residual lint
//       summary.md        the human summary
//       by-target.txt     every target directory with its full file list
//     Classification follows the registry's placement rules AS IF the stage were P1 and in the registry's own order (first
//     claim wins, so the F2 correction -- work records before reader docs -- is the registry's order, not a constant here).
//     A file the rules claim but this tool has no destination for, and a file nothing claims, is never guessed: it stays put
//     and goes on the "pending ruling" list.
//     --archived-evidence: where the evidence trees INSIDE docs/plans/_archive and docs/projects/_archive go (stay = left for P2,
//       with rule 6 and 7 excluding them and rule 8 claiming them; move = rule 6 as written, they travel with their archive). Default stay (D10.3).
//     --with-refs: also estimate the reference rewrite (git-tracked text files that name a path in the layout-map).
//     --simulate: apply the layout-map in a throwaway shared clone, commit it, and run seal-baseline check-rewrite over it.
//   check-f2 [--root <dir>] [--registry <file>]
//     F2 negative control probe: one plan md and one handoff md must classify to project/. Exit 1 when either does not.
//   classify <path>... [--root <dir>] [--registry <file>]   print the category and destination of the given paths
//   apply --phase rename|refs-code|refs-docs|content [--root <dir>] [--log <file>]
//     Mutates the work tree of --root (it never commits). rename: git-less file moves per the layout-map plus the registry patch of
//     scripts/lib/repo-layout.js (stage P1, path keys, project/ top dir, exceptions, archived-evidence rule excludes).
//     refs-code / refs-docs: rewrite exact layout-map keys (full file paths) in tracked text files, markdown relative links in
//     docs; never in sealed (no-rewrite) files, evidence, profiles, platforms mirrors, this tool, or the D9.5 / routing files.
//     content: merge the two HANDOFF.md (the absorbed file is deleted), create docs/README.md, delete docs/training/README.md, follow the
//       decide.test.ts card selector (見 docs/plans -> 見 project/plans), keep the stay-behind archive evidence out of check-stage-vocab.
//     Not in apply: profiles repin, mirror regeneration (sync-all.sh) and the no-rewrite.json path update.
//
// Exit: 0 ok, 1 check-f2 failed or the plan found an internal inconsistency, 2 bad input.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

class InputError extends Error {}
const posix = (p) => p.split(path.sep).join('/');
const sortedObj = (o) => { const r = {}; for (const k of Object.keys(o).sort()) r[k] = o[k]; return r; };

function parseArgs(argv) {
  const o = { _: [], flags: new Set() };
  const bool = new Set(['with-refs', 'simulate']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (bool.has(k)) { o.flags.add(k); continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new InputError(`${a} needs a value`);
    o[k] = v; i++;
  }
  return o;
}

function gitRoot(dir) {
  try { return cp.execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
function resolveRoot(o) {
  const root = path.resolve(o.root || gitRoot(process.cwd()) || '');
  if (!o.root && !gitRoot(process.cwd())) throw new InputError('not inside a git repository; pass --root');
  if (!fs.existsSync(root)) throw new InputError(`--root ${root} does not exist`);
  return root;
}
function trackedFiles(root) {
  const out = cp.execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  return out.split('\0').filter(Boolean).sort();
}

// ------------------------------------------------------------------ registry
function loadRegistry(layout, o) {
  const reg = layout.load(o.registry ? { registry: path.resolve(o.registry) } : undefined);
  const errs = layout.validate(reg);
  if (errs.length) throw new InputError('registry is invalid: ' + errs.join('; '));
  return reg;
}
const STAGE_ORDER = ['bootstrap', 'P1', 'P2', 'P3', 'P4', 'P5'];
const activeAtP1 = (rule) => STAGE_ORDER.indexOf(rule.active_from) <= STAGE_ORDER.indexOf('P1');

// ------------------------------------------------------------------ destination tables (the only place a destination is chosen)
// Rule 6 (work records -> project/). Ordered; first hit wins.
const DEST6 = [
  { re: /^docs\/(HANDOFF[^/]*\.md)$/, handoff: true },
  { re: /^docs\/projects\/ongoing-maintenance\/(HANDOFF[^/]*\.md)$/, handoff: true },
  { re: /^docs\/plans\/_archive\/(.+)$/, to: (m) => `project/plans/_archive/${m[1]}`, archivedEvidence: true },
  { re: /^docs\/plans\/research\/(.+)$/, to: (m) => `project/plans/research/${m[1]}` },
  { re: /^docs\/plans\/([^/]+)$/, plan: true },
  { re: /^docs\/projects\/_archive\/(.+)$/, to: (m) => `project/projects/_archive/${m[1]}`, archivedEvidence: true },
  { re: /^docs\/projects\/(.+)$/, to: (m) => `project/projects/${m[1]}` },
  { re: /^docs\/backlog\/(.+)$/, to: (m) => `project/backlog/${m[1]}` },
  { re: /^docs\/BACKLOG\.md$/, to: () => 'project/backlog/BACKLOG.md' },
  { re: /^docs\/(mission-[^/]+\.json)$/, to: (m) => `project/missions/${m[1]}` },
];
// Rule 7 (reader docs). Explicit per-file table: guide = users, dev = contributors. Seeded from docs-inventory section 2.
const GUIDE = ['review-candidate.md', 'installation.md', 'configuration.md', 'settings-reference.md', 'skills.md', 'coexistence.md', 'token-discipline.md'];
const DEV = ['architecture.md', 'hook-harness-matrix.md', 'ironlaw-to-gate-map.md', 'fleet-child-contract.md', 'ladder-run.md', 'qc-metric-emit.md'];
const DEV_DIRS = ['adr', 'upstream-bugs'];
// D10.1 rulings (depth-0, 2026-11-02): the four files the dry run left unclassified.
const PENDING_FIXED = {}; // nothing is left pending; a new unclassifiable file still lands here, never guessed
const DELETE = { 'docs/training/README.md': 'D10.1: a 6-line tombstone ("moved to its own repo"); deleted in the content phase' };
const DECIDED_MOVES = { 'docs/COEXISTENCE-fable5.md': 'project/handoff/COEXISTENCE-fable5.md' }; // D10.1
// D10.1 / D10.4: per-file registry exceptions that stay in docs/ (rule 7 = reader docs / docs data, rule 6 = work records)
const DECIDED_EXCEPTIONS = [
  { path: 'docs/metrics/surface-lines.json', rule: 7, reason: 'D10.1: release-gate baseline read through paths.surface_lines_baseline (repo-layout.js, preflight-release.sh); not markdown, stays in docs/metrics/' },
  { path: 'docs/projects/_archive/2026/08/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json', rule: 6, reason: 'D10.4 / D9.7: dispatch-hetero.sh:2125, dispatch-review.sh:299 and sync-codex-plugin-skills.sh:102 hard-code this path; the C2 lane (D9.7, a or b) decides its future, so it stays and those three scripts are not changed' },
];
const ASSET_PREFIX = 'docs/assets/';
const SHIP_CUTOFF = '2026-09-01'; // plan section 3 P1: plans dated before September that have shipped are archived

const PATH_KEY_MAP = {
  plans_dir: 'project/plans', plans_archive_dir: 'project/plans/_archive', projects_dir: 'project/projects',
  projects_index: 'project/projects/INDEX.md', projects_archive_dir: 'project/projects/_archive',
  backlog_file: 'project/backlog/BACKLOG.md', missions_dir: 'project/missions', manifest_plan_base: 'project',
  settings_reference: 'docs/guide/settings-reference.md', hook_harness_matrix_doc: 'docs/dev/hook-harness-matrix.md',
};
const PATH_KEY_STAYS = {
  docs_dir: 'docs/ still holds guide/, dev/, assets/ and README.md',
  plans_evidence_dir: 'evidence moves in P2, not P1',
  metrics_dir: 'docs/metrics/surface-lines.json is on the pending list (no rule claims it)',
  surface_lines_baseline: 'same file, pending ruling',
  scripts_inventory_doc: 'F5: pinned in place by a per-file exception until P4',
};

// ------------------------------------------------------------------ inputs read from the work tree
function readJson(root, rel) { try { return JSON.parse(fs.readFileSync(path.resolve(root, rel), 'utf8')); } catch { return null; } }
function planStem(name) { const m = /^(\d{4})-(\d{2})-(\d{2})-([A-Za-z0-9-]+)/.exec(name); return m ? { stem: m[0], y: m[1], mo: m[2], d: m[3], date: `${m[1]}-${m[2]}-${m[3]}` } : null; }

/** INDEX.md rows per plan stem -> 'in-flight' | 'shipped' | 'unregistered'. */
function indexVerdicts(root, stems) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, 'docs/projects/INDEX.md'), 'utf8'); } catch { /* none */ }
  const rows = {};
  let h2 = '', h3 = '';
  for (const l of text.split('\n')) {
    if (/^## /.test(l)) { h2 = l.slice(3); h3 = ''; continue; }
    if (/^### /.test(l)) { h3 = l.slice(4); continue; }
    if (!l.startsWith('|')) continue;
    const inflight = /^(進行中|規劃中)/.test(h2) && !/^Plan-only/.test(h3);
    for (const m of l.matchAll(/plans\/(?:_archive\/\d{4}\/\d{2}\/)?(\d{4}-\d{2}-\d{2}-[A-Za-z0-9-]+)/g)) {
      (rows[m[1]] = rows[m[1]] || new Set()).add(inflight ? 'in-flight' : 'shipped');
    }
  }
  const out = {};
  for (const s of stems) { const c = rows[s]; out[s] = !c ? 'unregistered' : c.has('in-flight') ? 'in-flight' : 'shipped'; }
  return out;
}

/** The sources manifests: which plan/rubric files they pin, relative to the registry's manifest base. */
function manifestPins(root, files, reg) {
  const pins = [];
  for (const f of files) {
    if (!/^docs\/mission-.*-sources\.json$/.test(f)) continue;
    const j = readJson(root, f);
    if (!j || !Array.isArray(j.sources)) continue;
    for (const s of j.sources) for (const k of ['plan_path', 'rubric_path']) {
      if (typeof s[k] === 'string') pins.push({ manifest: f, key: k, rel: s[k], abs: posix(path.posix.join(reg.paths.manifest_plan_base, s[k])) });
    }
  }
  return pins;
}

// ------------------------------------------------------------------ classification
function compileRules(reg) {
  return reg.rules.map((r) => ({ r, inc: r.match ? r.match.include.map((p) => new RegExp(p)) : null, exc: r.match ? r.match.exclude.map((p) => new RegExp(p)) : null }));
}
/** First rule (in registry order) that claims f, active or not; null when none. Same semantics as scripts/layout-lint.js. */
function claimingRule(compiled, f) {
  for (const c of compiled) {
    if (!c.inc) continue;
    if (!c.inc.some((re) => re.test(f)) || c.exc.some((re) => re.test(f))) continue;
    return c.r;
  }
  return null;
}

function buildContext(root, reg, files, opts) {
  const compiled = compileRules(reg);
  const exceptions = new Map(reg.exceptions.map((e) => [e.path, e]));
  // D9.5: the blind-review-2d-snapshot mission is still routed -> its six files stay (proposed exceptions).
  const routing = readJson(root, reg.paths.mission_routing_config);
  const proposedExceptions = [];
  const sourcesFile = routing && routing.sources_path;
  if (sourcesFile && files.includes(sourcesFile)) {
    const slug = path.posix.basename(sourcesFile).replace(/-sources\.json$/, '');
    const src = readJson(root, sourcesFile);
    const stems = new Set();
    for (const s of (src && src.sources) || []) for (const k of ['plan_path', 'rubric_path']) {
      if (s[k]) { const ps = planStem(path.posix.basename(s[k])); if (ps) stems.add(ps.stem); }
    }
    const cand = files.filter((f) => f.startsWith(`docs/${slug}-`) && f.endsWith('.json'))
      .concat(files.filter((f) => /^docs\/plans\/[^/]+$/.test(f) && [...stems].some((s) => path.posix.basename(f).startsWith(s + '.'))));
    for (const f of [...new Set(cand)].sort()) {
      const e = { path: f, rule: 6, reason: `D9.5: ${slug} is still named by ${reg.paths.mission_routing_config} (active mission, frozen source sha); stays in docs/ until the mission retires` };
      if (f === sourcesFile) e.plan_base = 'docs';
      proposedExceptions.push(e);
    }
  }
  for (const e of DECIDED_EXCEPTIONS) if (files.includes(e.path)) proposedExceptions.push(Object.assign({}, e));
  for (const e of proposedExceptions) exceptions.set(e.path, e);
  const activeStems = new Set();
  for (const e of proposedExceptions) { const ps = planStem(path.posix.basename(e.path)); if (ps && e.path.startsWith('docs/plans/')) activeStems.add(ps.stem); }

  const stemOf = {};
  for (const f of files) { if (!/^docs\/plans\/[^/]+$/.test(f)) continue; const ps = planStem(path.posix.basename(f)); if (ps) stemOf[f] = ps; }
  const verdict = indexVerdicts(root, new Set(Object.values(stemOf).map((s) => s.stem)));
  const pins = manifestPins(root, files, reg);
  const pinnedStems = new Set();
  for (const p of pins) { const ps = planStem(path.posix.basename(p.abs)); if (ps) pinnedStems.add(ps.stem); }
  return { compiled, exceptions, proposedExceptions, activeStems, stemOf, verdict, pins, pinnedStems, opts, reg };
}

/** Classify one tracked path. Returns {cat, to?, rule?, why?}. Never guesses. */
function classify(f, ctx) {
  if (!f.startsWith('docs/')) return { cat: 'outside-docs' };
  if (ctx.exceptions.has(f)) { const e = ctx.exceptions.get(f); return { cat: 'exception-stay', rule: e.rule, why: e.reason }; }
  if (DELETE[f]) return { cat: 'delete', why: DELETE[f] };
  if (DECIDED_MOVES[f]) return { cat: 'handoff-other', rule: 7, to: DECIDED_MOVES[f] };
  if (PENDING_FIXED[f]) return { cat: 'pending', why: PENDING_FIXED[f].why, proposal: PENDING_FIXED[f].proposal };
  if (f.startsWith(ASSET_PREFIX)) return { cat: 'asset-stay', why: 'docs/assets stays in docs/ (rule 7 excludes it)' };
  const rule = claimingRule(ctx.compiled, f);
  if (!rule) return { cat: 'pending', why: 'no placement rule claims this file', proposal: 'leave in place' };
  if (!activeAtP1(rule)) return { cat: 'evidence-p2-stay', rule: rule.id, why: `rule #${rule.id} (${rule.name}) is not active until ${rule.active_from}` };
  const name = path.posix.basename(f);
  if (rule.name === 'work-records') {
    for (const d of DEST6) {
      const m = d.re.exec(f); if (!m) continue;
      if (d.handoff) return { cat: 'handoff', rule: rule.id, handoffName: m[1] };
      if (d.archivedEvidence && /\/evidence\//.test(f)) {
        if (ctx.opts.archivedEvidence === 'stay') return { cat: 'archived-evidence-stay', rule: rule.id, why: 'left for P2 (--archived-evidence stay)' };
        return { cat: 'archived-evidence', rule: rule.id, to: d.to(m) };
      }
      if (d.plan) return classifyTopPlan(f, name, ctx, rule);
      const cat = /^docs\/mission-/.test(f) ? 'mission' : /^docs\/plans\/_archive\//.test(f) ? 'plan-archived' : /^docs\/plans\/research\//.test(f) ? 'plan-research'
        : /^docs\/projects\/_archive\//.test(f) ? 'project-archived' : f === 'docs/projects/INDEX.md' ? 'project-index' : /^docs\/projects\//.test(f) ? 'project'
        : f === 'docs/BACKLOG.md' ? 'backlog-main' : 'backlog';
      return { cat, rule: rule.id, to: d.to(m) };
    }
    return { cat: 'pending', rule: rule.id, why: `rule #${rule.id} claims it but this tool has no destination for it`, proposal: 'rule a destination' };
  }
  if (rule.name === 'reader-docs') {
    const rel = f.slice('docs/'.length);
    if (GUIDE.includes(rel)) return { cat: 'guide', rule: rule.id, to: `docs/guide/${rel}` };
    if (DEV.includes(rel)) return { cat: 'dev', rule: rule.id, to: `docs/dev/${rel}` };
    if (rel.includes('/') && DEV_DIRS.includes(rel.split('/')[0])) return { cat: 'dev', rule: rule.id, to: `docs/dev/${rel}` };
    return { cat: 'pending', rule: rule.id, why: 'reader doc with no entry in the guide/dev table', proposal: 'rule guide or dev' };
  }
  return { cat: 'pending', rule: rule.id, why: `rule #${rule.id} (${rule.name}) is active but P1 does not move it` };
}
function classifyTopPlan(f, name, ctx, rule) {
  const ps = ctx.stemOf[f];
  if (!ps) return { cat: 'pending', rule: rule.id, why: 'a plan-dir file whose name does not start with YYYY-MM-DD-slug', proposal: 'rule a destination' };
  if (+ps.mo < 1 || +ps.mo > 12) return { cat: 'pending', rule: rule.id, why: `malformed month in ${ps.stem}`, proposal: 'rule a destination' };
  const v = ctx.verdict[ps.stem];
  if (ps.date < SHIP_CUTOFF && !ctx.activeStems.has(ps.stem)) {
    if (v === 'shipped' && !ctx.pinnedStems.has(ps.stem)) return { cat: 'plan-archived-now', rule: rule.id, to: `project/plans/_archive/${ps.y}/${ps.mo}/${name}`, stem: ps.stem };
    const pinned = v === 'shipped';
    const why = pinned ? 'a sealed sources manifest pins "plans/<this file>" under the manifest base; archiving would break that path (manifest bytes cannot change)'
      : v === 'in-flight' ? 'INDEX lists it as in progress or drafted, not shipped' : 'no INDEX row, so "shipped" cannot be shown';
    return { cat: 'plan-pre-sept-not-archived', rule: rule.id, to: `project/plans/${name}`, stem: ps.stem, why, kind: pinned ? 'manifest-pinned' : v };
  }
  return { cat: 'plan-active', rule: rule.id, to: `project/plans/${name}`, stem: ps.stem };
}

// ------------------------------------------------------------------ plan
function buildPlan(root, o) {
  const layout = require(path.join(root, 'scripts/lib/repo-layout.js'));
  const reg = loadRegistry(layout, o);
  const files = trackedFiles(root);
  const opts = { archivedEvidence: o['archived-evidence'] || 'stay' };
  if (!['move', 'stay'].includes(opts.archivedEvidence)) throw new InputError('--archived-evidence must be move or stay');
  const ctx = buildContext(root, reg, files, opts);
  const docs = files.filter((f) => f.startsWith('docs/'));
  const cls = {}; const byCat = {};
  for (const f of docs) { const c = classify(f, ctx); cls[f] = c; (byCat[c.cat] = byCat[c.cat] || []).push(f); }

  const map = {};
  for (const f of docs) { const c = cls[f]; if (c.to) map[f] = c.to; }
  // handoff: both live HANDOFF.md are plain renames here (commit 2 stays 100% renames); the content phase appends the second to
  // the first and removes it. References to the absorbed file are rewritten to the merged target (refAlias).
  const merge = { target: 'project/handoff/HANDOFF.md', sources: [], absorbed_old: 'docs/projects/ongoing-maintenance/HANDOFF.md', absorbed_new: 'project/handoff/HANDOFF-ongoing-maintenance.md' };
  for (const f of byCat.handoff || []) {
    const c = cls[f];
    if (f === 'docs/HANDOFF.md') map[f] = merge.target;
    else if (f === merge.absorbed_old) map[f] = merge.absorbed_new;
    else map[f] = `project/handoff/${c.handoffName}`;
  }
  const handoffs = (byCat.handoff || []).map((f) => ({ f, c: cls[f] }));

  const problems = [];
  const seen = new Map(); const tracked = new Set(files);
  for (const [a, b] of Object.entries(map)) {
    if (seen.has(b)) problems.push(`collision: ${a} and ${seen.get(b)} both map to ${b}`);
    seen.set(b, a);
    if (tracked.has(b)) problems.push(`destination already tracked: ${b}`);
  }
  if (tracked.has(merge.target)) problems.push(`destination already tracked: ${merge.target}`);

  const counts = {};
  for (const [k, v] of Object.entries(byCat)) counts[k] = v.length;
  const contentOps = {
    new_files: [{ path: 'docs/README.md', note: 'new: entry page that links docs/guide/, docs/dev/, docs/assets/ and says where plans, backlog and handoff went' }],
    handoff_merge: handoffMerge(root, merge, handoffs),
    index_split: indexSplit(root),
  };
  return { options: opts, counts: sortedObj(counts), moved: Object.keys(map).length, map, merge, cls, byCat, ctx, files, problems, contentOps, reg };
}

function handoffMerge(root, merge, handoffs) {
  const sizes = ['docs/HANDOFF.md', merge.absorbed_old].map((f) => ({ path: f, lines: fs.readFileSync(path.join(root, f), 'utf8').split('\n').length }));
  return {
    target: merge.target, sources: sizes,
    kept_separate: handoffs.filter(({ f }) => f !== 'docs/HANDOFF.md' && f !== merge.absorbed_old).map(({ f, c }) => ({ path: f, to: `project/handoff/${c.handoffName}` })),
    proposal: 'Interpretation to confirm: "the two HANDOFF files" = the two live HANDOFF.md (docs/ root; projects/ongoing-maintenance/). Concatenate them under one H1 with an H2 per source (its original first heading kept verbatim, with an italic line giving the source path and its last-touch commit), write the result to the target, and git rm both sources. Nothing is dropped; git history keeps each original. The other two (HANDOFF-l6-resilience.md is a completed-campaign tombstone; HANDOFF-engine-qualify-seats.md says it is a different line "do not overwrite") are plain renames into project/handoff/. References to either merged source are rewritten to the target.',
  };
}

function indexSplit(root) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, 'docs/projects/INDEX.md'), 'utf8'); } catch { return null; }
  const lines = text.split('\n');
  const secs = []; let cur = null;
  lines.forEach((l, i) => {
    if (/^## /.test(l)) { cur = { heading: l.slice(3).trim(), line: i + 1, rows: 0, years: {} }; secs.push(cur); return; }
    if (!cur || !l.startsWith('|') || /^\|[-\s|]*$/.test(l) || /^\|\s*(Date|Plan|Project)\b/.test(l)) return;
    cur.rows++;
    const y = /(\d{4})-\d{2}-\d{2}/.exec(l);
    if (y) cur.years[y[1]] = (cur.years[y[1]] || 0) + 1;
  });
  const keep = /^(進行中|規劃中)/;
  const sections = secs.map((s) => ({ heading: s.heading, line: s.line, rows: s.rows, years: s.years, target: keep.test(s.heading) ? 'project/projects/INDEX.md' : 'project/projects/_archive/<YYYY>/INDEX.md' }));
  return {
    bytes: Buffer.byteLength(text), lines: lines.length, sections,
    proposal: 'Keep the preamble, "進行中" and "規劃中" in project/projects/INDEX.md (the live queue). Every other section (已完成, Fix ships, 歷史債, 歸檔) goes to project/projects/_archive/<YYYY>/INDEX.md by the row date (all current rows are 2026, so one 2026 file unless a month split is wanted), headings and table headers repeated verbatim, and the live INDEX ends with a link list to the yearly files. This is a MECHANISM change, not a rename: check-plan-graduation.js reads one projects_index and archiveIndexRow flips a row from in-progress to archived inside that file, so a row now crosses files. Consumers to adapt in a separate commit: check-plan-graduation.js, preflight-release.sh, check-phase-review-receipt.js, dispatch-plan-review.js, scaffold-mission.js. Links into ../plans/ are rewritten by the reference rewriter like any other.',
  };
}

// ------------------------------------------------------------------ registry changes (listed, never written)
function registryChanges(P) {
  const { reg, map, ctx } = P;
  const paths = []; const stays = [];
  for (const [k, to] of Object.entries(PATH_KEY_MAP)) {
    if (!(k in reg.paths)) continue;
    const from = reg.paths[k];
    const isFile = Object.prototype.hasOwnProperty.call(map, from);
    const dirOk = Object.keys(map).some((a) => a.startsWith(from + '/'));
    let check = 'ok';
    if (isFile && map[from] !== to) check = `MISMATCH layout-map says ${map[from]}`;
    else if (!isFile && !dirOk) check = 'MISMATCH no file under it moves';
    paths.push({ key: k, from, to, kind: isFile ? 'file' : 'dir', check });
  }
  for (const [k, why] of Object.entries(PATH_KEY_STAYS)) if (k in reg.paths) stays.push({ key: k, value: reg.paths[k], why });
  const covered = new Set([...Object.keys(PATH_KEY_MAP), ...Object.keys(PATH_KEY_STAYS)]);
  return {
    stage: { from: reg.stage, to: 'P1' },
    paths, paths_unchanged: stays,
    paths_not_reviewed_by_this_tool: Object.entries(reg.paths).filter(([k, v]) => !covered.has(k) && (v === 'docs' || v.startsWith('docs/'))).map(([k, v]) => ({ key: k, value: v })),
    rules_in_force_at_P1: reg.rules.filter(activeAtP1).map((r) => ({ id: r.id, name: r.name, position_in_registry: reg.rules.indexOf(r) + 1 })),
    rule_order_in_registry: reg.rules.map((r) => `#${r.id} ${r.name}`),
    allowlists_add: [{ list: 'top_dirs', name: 'project', since: 'P1', purpose: 'work records: plans, projects, backlog, missions, handoff (moved out of docs/ by P1)' }],
    tools_allowlist: { value: reg.allowlists.tools_subdirs.map((e) => e.name), note: 'F2: unchanged -- tools/ may hold only migrate/ until P4 adds gates/, sync/, evals/' },
    exceptions_add: ctx.proposedExceptions,
    exceptions_kept: reg.exceptions.map((e) => ({ path: e.path, rule: e.rule, reason: e.reason })),
    pinned_move_not_an_exception: {
      path: 'docs/plans/2026-08-04-platform-capability-trigger-activation.md', rule: 6,
      decision: 'D9.4: moves byte-identical into project/ with its plan siblings. The exception schema has no destination field and an exception means "escapes the rule", so it is NOT proposed as one; it is asserted instead (no_rewrite.d94). Needs a ruling on how to record it.',
    },
  };
}

// ------------------------------------------------------------------ no-rewrite overlap and the move simulation
function noRewriteOverlap(root, P) {
  const nr = readJson(root, 'tools/migrate/no-rewrite.json');
  if (!nr || !Array.isArray(nr.entries)) return { error: 'tools/migrate/no-rewrite.json unreadable' };
  const ents = new Map(nr.entries.map((e) => [e.path, e]));
  const docsEnts = [...ents.keys()].filter((p) => p.startsWith('docs/'));
  const moved = docsEnts.filter((p) => Object.prototype.hasOwnProperty.call(P.map, p));
  const merged = docsEnts.filter((p) => P.merge.sources.includes(p));
  const stay = docsEnts.filter((p) => !(p in P.map) && !P.merge.sources.includes(p));
  const contentOpTargets = ['docs/projects/INDEX.md', ...P.merge.sources].filter((p) => ents.has(p));
  const d94 = 'docs/plans/2026-08-04-platform-capability-trigger-activation.md';
  const archivedMoved = moved.filter((p) => /^project\/(plans|projects)\/_archive\//.test(P.map[p]));
  return {
    listed_total: ents.size, listed_under_docs: docsEnts.length,
    will_be_renamed_only: moved.length, of_which_into_an_archive_dir: archivedMoved.length,
    stay_in_docs_evidence_p2: stay.filter((p) => p.startsWith('docs/plans/evidence/')).length,
    stay_in_docs_other: stay.filter((p) => !p.startsWith('docs/plans/evidence/')),
    listed_files_that_a_content_operation_would_write: contentOpTargets,
    listed_files_merged_away: merged,
    d94: { listed: ents.has(d94), maps_to: P.map[d94] || null, sha256_in_no_rewrite: ents.has(d94) ? ents.get(d94).sha256 : null },
  };
}

function simulate(root, P) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relayp1-sim-'));
  const res = [];
  const scrub = (s) => String(s || '').split(tmp).join('<tmp>').split(root).join('<root>').trim().split('\n').slice(0, 8);
  try {
    const c = path.join(tmp, 'c');
    const head = cp.execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    cp.execFileSync('git', ['clone', '-q', '--shared', '--no-checkout', root, c], { stdio: ['ignore', 'pipe', 'pipe'] });
    const G = (...a) => cp.execFileSync('git', ['-C', c, '-c', 'core.hooksPath=/dev/null', '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
    G('checkout', '-q', '--detach', head);
    for (const [a, to] of Object.entries(P.map)) {
      fs.mkdirSync(path.dirname(path.join(c, to)), { recursive: true });
      fs.renameSync(path.join(c, a), path.join(c, to));
    }
    G('add', '-A', 'docs', 'project');
    G('commit', '-q', '-m', 'simulated P1 renames');
    const mf = path.join(tmp, 'map.json'); fs.writeFileSync(mf, JSON.stringify(P.map));
    const r = cp.spawnSync('node', [path.join(c, 'tools/migrate/seal-baseline.js'), 'check-rewrite', '--root', c, '--range', `${head}..HEAD`, '--layout-map', mf], { encoding: 'utf8', maxBuffer: 64 << 20 });
    res.push({ check: 'seal-baseline check-rewrite --range base..simulated-head --layout-map (the renames only)', rc: r.status, out: scrub(r.stdout), err: scrub(r.stderr).filter(Boolean) });
    const fl = path.join(tmp, 'files.txt');
    fs.writeFileSync(fl, [P.merge.target, P.merge.absorbed_new, 'docs/projects/INDEX.md', 'docs/README.md'].join('\n') + '\n');
    const r2 = cp.spawnSync('node', [path.join(c, 'tools/migrate/seal-baseline.js'), 'check-rewrite', '--root', c, '--files', fl, '--layout-map', mf], { encoding: 'utf8' });
    res.push({ check: 'seal-baseline check-rewrite --files (HANDOFF sources, INDEX.md, docs/README.md: the files a content operation writes)', rc: r2.status, out: scrub(r2.stdout), err: scrub(r2.stderr).filter(Boolean) });
  } catch (e) { res.push({ check: 'simulation', rc: 2, out: [], err: scrub(e.message).slice(0, 2) }); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return res;
}

// ------------------------------------------------------------------ reference estimate
const RUNTIME_DIRS = ['skills', 'references', 'scripts', 'hooks', 'src', 'mods', 'agents', 'project-config-template'];
function refEstimate(root, P) {
  const nr = readJson(root, 'tools/migrate/no-rewrite.json');
  const sealed = new Set(((nr && nr.entries) || []).map((e) => e.path));
  const map = P.map; const mergeSrc = new Set(P.merge.sources);
  const keys = new Set(Object.keys(map));
  const stemKeys = new Set(); for (const k of keys) if (k.endsWith('.md')) stemKeys.add(k.slice(0, -3));
  const movedRoots = ['docs/plans', 'docs/projects', 'docs/backlog', 'docs/adr', 'docs/upstream-bugs'];
  const rule1 = P.ctx.compiled.find((c) => c.r.name === 'tests');
  const isTest = (f) => rule1 && rule1.inc.some((re) => re.test(f)) && !rule1.exc.some((re) => re.test(f));
  const catOf = (f) => {
    if (sealed.has(f)) return 'sealed (no-rewrite)';
    if (f.startsWith('platforms/') || f.startsWith('.opencode/')) return 'platforms mirror';
    if (f.startsWith('docs/plans/evidence/')) return 'evidence (stays, P2)';
    if (f.startsWith('docs/')) return 'docs itself';
    if (isTest(f)) return 'tests';
    if (f.startsWith('evals/')) return 'evals';
    const t = f.split('/')[0];
    if (RUNTIME_DIRS.includes(t)) return `runtime: ${t}/`;
    return `other: ${f.includes('/') ? t + '/' : f}`;
  };
  const tok = /docs\/[A-Za-z0-9_@.+\/-]+/g;
  const tally = {}; const perOld = {}; const dirRefs = {}; const sealedHits = {}; let skippedBin = 0;
  for (const f of P.files) {
    let buf; try { buf = fs.readFileSync(path.join(root, f)); } catch { continue; }
    if (buf.includes(0)) { skippedBin++; continue; }
    const s = buf.toString('utf8');
    if (!s.includes('docs/')) continue;
    let n = 0;
    for (const m of s.matchAll(tok)) {
      const t = m[0].replace(/[.,;:)\]-]+$/, '');
      let hit = null;
      if (keys.has(t)) hit = t; else if (stemKeys.has(t)) hit = t + '.md'; else if (mergeSrc.has(t)) hit = t;
      if (hit) { n++; perOld[hit] = (perOld[hit] || 0) + 1; if (sealed.has(f)) (sealedHits[f] = sealedHits[f] || new Set()).add(hit); continue; }
      const r0 = movedRoots.find((r) => t === r || t.startsWith(r + '/'));
      if (r0 && !t.startsWith('docs/plans/evidence')) { n++; dirRefs[r0] = (dirRefs[r0] || 0) + 1; }
      else if (/^docs\/mission-/.test(m[0]) && !m[0].endsWith('.json')) { n++; dirRefs['docs/mission-*'] = (dirRefs['docs/mission-*'] || 0) + 1; }
    }
    if (n) { const c = catOf(f); const t = tally[c] = tally[c] || { files: 0, refs: 0 }; t.files++; t.refs += n; }
  }
  const group = (pred) => Object.entries(tally).filter(([c]) => pred(c)).reduce((a, [, v]) => ({ files: a.files + v.files, refs: a.refs + v.refs }), { files: 0, refs: 0 });
  const pins = P.ctx.pins;
  const pinSummary = { sources_manifests: new Set(pins.map((p) => p.manifest)).size, plan_or_rubric_pins: pins.length, pinned_targets_whose_new_path_differs_from_project_plus_plan_path: 0 };
  for (const p of pins) if (map[p.abs] && map[p.abs] !== path.posix.join('project', p.rel)) pinSummary.pinned_targets_whose_new_path_differs_from_project_plus_plan_path++;
  let relLinks = 0; const relFiles = new Set();
  for (const f of P.files) {
    if (!f.startsWith('docs/') || f.startsWith('docs/plans/evidence/') || !f.endsWith('.md')) continue;
    let s; try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    for (const m of s.matchAll(/\]\((?!https?:|#|\/)([^)#\s]+)/g)) {
      const abs = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (keys.has(abs) || mergeSrc.has(abs)) { relLinks++; relFiles.add(f); }
    }
  }
  const sealedByGroup = {};
  for (const f of Object.keys(sealedHits)) {
    const g = f.startsWith('docs/mission-') ? 'docs/mission-*.json' : f.startsWith('docs/plans/_archive/') ? 'docs/plans/_archive' : f.startsWith('docs/projects/_archive/') ? 'docs/projects/_archive'
      : f.startsWith('docs/plans/evidence/') ? 'docs/plans/evidence' : f.startsWith('docs/plans/') ? 'docs/plans (top level)' : f.split('/').slice(0, 2).join('/');
    sealedByGroup[g] = (sealedByGroup[g] || 0) + 1;
  }
  return {
    method: 'every tracked non-binary text file; every token matching docs/[A-Za-z0-9_@.+/-]+ (trailing punctuation trimmed) that is an exact layout-map key, a plan stem without .md, or a merged-HANDOFF source. Directory-form tokens (docs/plans, docs/projects/..., not resolvable to one file) are counted separately.',
    by_category: sortedObj(tally),
    groups: {
      runtime_skills_references_scripts_hooks_src_mods_agents_project_config_template: group((c) => c.startsWith('runtime:')),
      tests: group((c) => c === 'tests'),
      evals: group((c) => c === 'evals'),
      docs_itself: group((c) => c === 'docs itself'),
      sealed_not_rewritable: group((c) => c === 'sealed (no-rewrite)'),
      platforms_mirror: group((c) => c === 'platforms mirror'),
      evidence_stays_p2: group((c) => c.startsWith('evidence')),
      other_roots: group((c) => c.startsWith('other:')),
    },
    sealed_files_naming_a_moved_path_by_group: sortedObj(sealedByGroup),
    directory_form_refs: sortedObj(dirRefs),
    sources_manifest_pins: pinSummary,
    docs_relative_markdown_links_into_moved_files: { files: relFiles.size, links: relLinks },
    distinct_old_paths_referenced: Object.keys(perOld).length,
    top_old_paths: Object.entries(perOld).sort((a, b) => b[1] - a[1]).slice(0, 12),
    binary_files_skipped: skippedBin,
  };
}

function coverage(root, P) {
  const keys = new Set(Object.keys(P.map)); const mergeSrc = new Set(P.merge.sources);
  const tok = /docs\/[A-Za-z0-9_@.+\/-]+/g;
  const out = [];
  for (const f of ['scripts/sync-manifest.json', 'scripts/sync-codex-plugin-skills.sh', 'scripts/sync-opencode-plugin.sh', 'hooks/tests/run.sh', 'hooks/tests/lib/serial-suites.txt', 'scripts/affected-suites.js', 'scripts/lib/sealed-docs.js']) {
    let s; try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch { out.push({ file: f, missing: true }); continue; }
    const hits = []; let docsTokens = 0;
    s.split('\n').forEach((l, i) => {
      for (const m of l.matchAll(tok)) {
        docsTokens++;
        const t = m[0].replace(/[.,;:)\]"'-]+$/, '');
        const moved = keys.has(t) || mergeSrc.has(t) || (/^docs\/(plans|projects|backlog|adr|upstream-bugs)(\/|$)/.test(t) && !/^docs\/plans\/evidence/.test(t)) || /^docs\/mission-/.test(m[0]) || t === 'docs/BACKLOG.md';
        if (moved) hits.push({ line: i + 1, token: t, to: P.map[t] || (mergeSrc.has(t) ? P.merge.target : null) });
      }
    });
    out.push({ file: f, docs_tokens: docsTokens, moved_hits: hits.length, hits: hits.slice(0, 40) });
  }
  return out;
}

// residual lint: what the P1 rules would still flag in docs/ after the move, using the registry's own rules and exceptions
function residualLint(P) {
  const excepted = new Set(P.ctx.reg.exceptions.concat(P.ctx.proposedExceptions).map((e) => `${e.rule}\0${e.path}`));
  const left = P.files.filter((f) => f.startsWith('docs/') && !(f in P.map) && !P.merge.sources.includes(f));
  const flagged = [];
  for (const f of left) {
    if (P.cls[f].cat === 'archived-evidence-stay') continue; // excluded by the rule 6/7 patch (patchRegistry)
    const r = claimingRule(P.ctx.compiled, f);
    if (r && activeAtP1(r) && !excepted.has(`${r.id}\0${f}`)) flagged.push({ file: f, rule: `#${r.id} ${r.name}`, cat: P.cls[f].cat });
  }
  const stray = [];
  for (const to of [...Object.values(P.map), P.merge.target]) {
    const r = claimingRule(P.ctx.compiled, to);
    if (r && activeAtP1(r)) stray.push({ dest: to, rule: r.id });
  }
  return { files_left_in_docs: left.length, flagged_by_active_rule_after_move: flagged, destinations_flagged_by_an_active_rule: stray };
}

// ------------------------------------------------------------------ output
function pendingList(P) {
  const files = (P.byCat.pending || []).map((f) => ({ file: f, why: P.cls[f].why, proposal: P.cls[f].proposal || null }));
  const stems = {}; const kinds = {};
  for (const f of P.byCat['plan-pre-sept-not-archived'] || []) {
    const c = P.cls[f];
    const s = stems[c.stem] = stems[c.stem] || { kind: c.kind, why: c.why, files: [] };
    s.files.push(f);
  }
  for (const s of Object.values(stems)) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  return { files, pre_sept_not_archived_stems: sortedObj(stems), pre_sept_not_archived_by_kind: sortedObj(kinds) };
}

function targets(P) {
  const t = {};
  const add = (to, label) => {
    const key = /^project\/(plans|projects)\/_archive\//.test(to) ? to.split('/').slice(0, 5).join('/') : path.posix.dirname(to);
    (t[key] = t[key] || []).push(label || to);
  };
  for (const to of Object.values(P.map)) add(to);
  add(P.merge.target, P.merge.target + ' (merged from 2 sources)');
  return sortedObj(t);
}

function renderSummary(P, X) {
  const L = [];
  L.push('# P1 docs split: dry-run plan');
  L.push('');
  L.push('Generated by tools/migrate/relayout-p1.js plan. Nothing in the repo was changed. Classification simulates stage P1 and follows the registry rule order.');
  L.push('');
  L.push('## Counts by category (tracked files under docs/)');
  L.push('');
  L.push('| category | files | destination |');
  L.push('|---|---:|---|');
  const dest = {
    guide: 'docs/guide/', dev: 'docs/dev/', handoff: 'project/handoff/ (renames; the two HANDOFF.md merge in the content phase)', 'handoff-other': 'project/handoff/', delete: 'deleted in the content phase (D10.1)', mission: 'project/missions/',
    'plan-active': 'project/plans/', 'plan-archived-now': 'project/plans/_archive/YYYY/MM/ (pre-September, shipped)', 'plan-pre-sept-not-archived': 'project/plans/ (pre-September, not provably archivable)',
    'plan-archived': 'project/plans/_archive/ (already archived)', 'plan-research': 'project/plans/research/', project: 'project/projects/', 'project-archived': 'project/projects/_archive/',
    'project-index': 'project/projects/INDEX.md (split, content operation)', 'backlog-main': 'project/backlog/BACKLOG.md', backlog: 'project/backlog/', 'archived-evidence': 'rides with its archive (see rulings)',
    'archived-evidence-stay': 'stays for P2', 'exception-stay': 'stays (per-file registry exception)', 'asset-stay': 'stays (docs/assets/)', 'evidence-p2-stay': 'stays until P2 (rule 8)', pending: 'NOT MOVED, needs a ruling',
  };
  for (const [c, k] of Object.entries(P.counts)) L.push(`| ${c} | ${k} | ${dest[c] || ''} |`);
  L.push(`| **total** | **${Object.values(P.counts).reduce((a, b) => a + b, 0)}** | |`);
  L.push('');
  L.push(`Renames in layout-map.json: ${P.moved}. Merge sources (not in the map): ${P.merge.sources.length}. New file: docs/README.md.`);
  L.push('');
  L.push('## Target directories (counts; full lists in by-target.txt)');
  L.push('');
  const tgt = targets(P);
  for (const [d, list] of Object.entries(tgt)) L.push(`- ${d}/ : ${list.length}`);
  for (const d of ['docs/guide', 'docs/dev', 'project/handoff']) { L.push(''); L.push(`### ${d}/ (${(tgt[d] || []).length})`); for (const f of tgt[d] || []) L.push(`- ${f}`); }
  L.push('');
  L.push('### docs/ files that stay (besides assets and P2 evidence)');
  for (const f of P.files.filter((f) => f.startsWith('docs/') && !(f in P.map) && !P.merge.sources.includes(f) && !f.startsWith('docs/plans/evidence/') && P.cls[f].cat !== 'asset-stay')) L.push(`- ${f} (${P.cls[f].cat})`);
  L.push(`- docs/assets/ (${(P.byCat['asset-stay'] || []).length} files), docs/plans/evidence/ (${(P.byCat['evidence-p2-stay'] || []).length} files, P2)`);
  L.push('');
  L.push('## Pending rulings (not guessed, not in the layout-map)');
  const pend = pendingList(P);
  L.push('');
  for (const p of pend.files) L.push(`- ${p.file}: ${p.why}. Proposal: ${p.proposal}`);
  L.push('');
  const stems = Object.entries(pend.pre_sept_not_archived_stems);
  L.push(`Pre-September plans NOT archived (${stems.length} stems, by kind ${JSON.stringify(pend.pre_sept_not_archived_by_kind)}; they still move to project/plans/):`);
  for (const [s, v] of stems) L.push(`- ${s} (${v.files.length} file(s)): ${v.why}`);
  L.push('');
  L.push(`Existing archive rule: check-plan-graduation.js reports 0 plan_released_not_archived today, so the plan's "121 files" is a date filter, not a shipped filter. Used here: dated before ${SHIP_CUTOFF}, an INDEX row exists and none sits in 進行中/規劃中, no sealed sources manifest pins its path, and it is not the active mission lineage.`);
  L.push('');
  L.push('## Content operations (not renames)');
  L.push('');
  L.push(`HANDOFF merge: ${P.contentOps.handoff_merge.sources.map((s) => `${s.path} (${s.lines} lines)`).join(' + ')} -> ${P.merge.target}`);
  L.push(P.contentOps.handoff_merge.proposal);
  L.push('');
  L.push(`INDEX split (${P.contentOps.index_split ? P.contentOps.index_split.bytes : '?'} bytes):`);
  for (const s of (P.contentOps.index_split || {}).sections || []) L.push(`- line ${s.line} "${s.heading}": ${s.rows} rows ${JSON.stringify(s.years)} -> ${s.target}`);
  L.push((P.contentOps.index_split || {}).proposal || '');
  const sections = [
    ['Registry changes (listed only, nothing written)', X.registry],
    ['Residual lint (what the P1 rules would still flag in docs/ after the move)', X.residual],
    ['No-rewrite overlap', X.noRewrite],
  ];
  if (X.sim) sections.push(['Move simulation in a throwaway clone', X.sim]);
  if (X.refs) { sections.push(['Reference rewrite estimate', X.refs]); sections.push(['sync, run.sh and serial-suites coverage', X.cov]); }
  for (const [h, v] of sections) { L.push(''); L.push(`## ${h}`); L.push(''); L.push('```json'); L.push(JSON.stringify(v, null, 1)); L.push('```'); }
  L.push('');
  L.push(`Problems found while planning: ${P.problems.length ? P.problems.join('; ') : 'none'}`);
  return L.join('\n') + '\n';
}

function cmdPlan(o) {
  const root = resolveRoot(o);
  const P = buildPlan(root, o);
  const X = { registry: registryChanges(P), residual: residualLint(P), noRewrite: noRewriteOverlap(root, P) };
  if (o.flags.has('simulate')) X.sim = simulate(root, P);
  if (o.flags.has('with-refs')) { X.refs = refEstimate(root, P); X.cov = coverage(root, P); }
  const regBad = X.registry.paths.filter((p) => p.check !== 'ok');
  if (regBad.length) P.problems.push('registry path key mismatch: ' + regBad.map((p) => p.key).join(', '));
  if (X.residual.destinations_flagged_by_an_active_rule.length) P.problems.push('a destination is claimed by an active rule');
  const summary = renderSummary(P, X);
  const planJson = {
    schema: 1, tool: 'relayout-p1', phase: 'P1', mode: 'plan', options: P.options, counts: P.counts, renames: P.moved,
    merge: P.merge, content_ops: P.contentOps, pending: pendingList(P), registry_changes: X.registry, residual_lint: X.residual,
    no_rewrite: X.noRewrite, simulation: X.sim || null, reference_estimate: X.refs || null, sync_coverage: X.cov || null, problems: P.problems,
  };
  if (o['out-dir']) {
    const d = path.resolve(o['out-dir']); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'layout-map.json'), JSON.stringify(sortedObj(P.map), null, 1) + '\n');
    fs.writeFileSync(path.join(d, 'plan.json'), JSON.stringify(planJson, null, 1) + '\n');
    fs.writeFileSync(path.join(d, 'summary.md'), summary);
    fs.writeFileSync(path.join(d, 'by-target.txt'), Object.entries(targets(P)).map(([k, v]) => `${k}/ (${v.length})\n${v.map((x) => '  ' + x).join('\n')}`).join('\n\n') + '\n');
    process.stdout.write(`relayout-p1 plan: ${P.moved} renames, ${P.problems.length} problem(s); wrote layout-map.json plan.json summary.md by-target.txt\n`);
  } else process.stdout.write(summary);
  return P.problems.length ? 1 : 0;
}

const F2_SAMPLES = [
  { kind: 'plan md', find: (files) => files.find((f) => /^docs\/plans\/2026-10-\d\d-[a-z0-9-]+\.md$/.test(f) && !/\.rubric\.md$/.test(f)) },
  { kind: 'handoff md', find: (files) => files.find((f) => f === 'docs/HANDOFF.md') },
];
function cmdCheckF2(o) {
  const root = resolveRoot(o); const P = buildPlan(root, o);
  let bad = 0;
  for (const s of F2_SAMPLES) {
    const f = s.find(P.files);
    if (!f) { process.stdout.write(`F2 ${s.kind}: no sample file found\n`); bad++; continue; }
    const to = P.map[f] || (P.merge.sources.includes(f) ? P.merge.target : null);
    const ok = !!to && to.startsWith('project/');
    process.stdout.write(`F2 ${s.kind}: ${f} -> ${to || '(not moved: ' + P.cls[f].cat + ')'} ${ok ? 'ok' : 'FAIL'}\n`);
    if (!ok) bad++;
  }
  return bad ? 1 : 0;
}
function cmdClassify(o) {
  const root = resolveRoot(o); const P = buildPlan(root, o);
  for (const f of o._.slice(1)) {
    const c = P.cls[f] || { cat: 'not-under-docs-or-untracked' };
    process.stdout.write(`${f}\t${c.cat}\t${P.map[f] || (P.merge.sources.includes(f) ? P.merge.target : '')}\n`);
  }
  return 0;
}


// ------------------------------------------------------------------ apply
const RULE_PATCH = { archivedEvidenceRe: '^docs/(plans|projects)/_archive/.+/evidence/' };
const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Edit the DEFAULT_REGISTRY literal of scripts/lib/repo-layout.js. Every edit must hit exactly once or the apply stops. */
function patchRegistry(src, P) {
  let t = src;
  const once = (from, to, what) => {
    const n = t.split(from).length - 1;
    if (n !== 1) throw new InputError(`registry patch "${what}" matched ${n} times (want 1)`);
    t = t.replace(from, () => to);
  };
  once("  stage: 'bootstrap',", "  stage: 'P1',", 'stage');
  for (const c of registryChanges(P).paths) once(`    ${c.key}: ${q(c.from)},`, `    ${c.key}: ${q(c.to)},`, `paths.${c.key}`);
  once("      { name: 'references',", `      { name: 'project', purpose: 'work records: plans, projects, backlog, missions, handoff (moved out of docs/ by P1)', since: 'P1' },\n      { name: 'references',`, 'top_dirs project');
  once("        exclude: ['^docs/plans/evidence/'],\n      },\n    },\n    {\n      id: 7,", `        exclude: ['^docs/plans/evidence/', ${q(RULE_PATCH.archivedEvidenceRe)}],\n      },\n    },\n    {\n      id: 7,`, 'rule 6 exclude');
  once("exclude: ['^docs/(guide|dev)/', '^docs/README\\\\.md$', '^docs/assets/', '^docs/plans/evidence/'],", `exclude: ['^docs/(guide|dev)/', '^docs/README\\\\.md$', '^docs/assets/', '^docs/plans/evidence/', ${q(RULE_PATCH.archivedEvidenceRe)}],`, 'rule 7 exclude');
  once("match: { include: ['^docs/plans/evidence/'], exclude: [] },", `match: { include: ['^docs/plans/evidence/', ${q(RULE_PATCH.archivedEvidenceRe)}], exclude: [] },`, 'rule 8 include');
  const ex = P.ctx.proposedExceptions.map((e) => `    {\n      path: ${q(e.path)},\n      rule: ${e.rule},\n      reason: ${q(e.reason)},${e.plan_base ? `\n      plan_base: ${q(e.plan_base)},` : ''}\n    },\n`).join('');
  once("    },\n  ],\n};\n\nfunction clone", `    },\n${ex}  ],\n};\n\nfunction clone`, 'exceptions');
  return t;
}

const MERGE = { target: 'project/handoff/HANDOFF.md', sources: [], absorbed_old: 'docs/projects/ongoing-maintenance/HANDOFF.md', absorbed_new: 'project/handoff/HANDOFF-ongoing-maintenance.md' };
const DEFAULT_LAYOUT_MAP = 'docs/plans/evidence/2026-10-31-repo-relayout-3-0-0/p1-plan/layout-map.json';
/** rename plans from the live tree; every later phase reads the committed layout-map (the tree is already moved). */
function applyCtx(root, o, phase) {
  const nr = readJson(root, 'tools/migrate/no-rewrite.json');
  const sealedOld = new Set(((nr && nr.entries) || []).map((e) => e.path));
  let P;
  if (phase === 'rename') {
    const st = loadRegistry(require(path.join(root, 'scripts/lib/repo-layout.js')), o).stage;
    if (st !== 'bootstrap') throw new InputError(`registry stage is ${st}; rename expects bootstrap`);
    P = buildPlan(root, o);
  }
  else {
    const layout = require(path.join(root, 'scripts/lib/repo-layout.js'));
    const map = readJson(root, o['layout-map'] || DEFAULT_LAYOUT_MAP);
    if (!map) throw new InputError(`cannot read the layout-map ${o['layout-map'] || DEFAULT_LAYOUT_MAP}`);
    const reg = loadRegistry(layout, o);
    P = { map, merge: MERGE, reg, problems: [], cls: Object.fromEntries(Object.keys(DELETE).map((k) => [k, { cat: 'delete' }])), ctx: { proposedExceptions: reg.exceptions } };
  }
  const refMap = Object.assign({}, P.map, { [P.merge.absorbed_old]: P.merge.target });
  return { P, sealedOld, refMap };
}

function cmdApply(o) {
  const root = resolveRoot(o);
  const phase = o.phase;
  if (!['rename', 'refs-code', 'refs-docs', 'content', 'no-rewrite'].includes(phase)) throw new InputError('apply --phase must be rename|refs-code|refs-docs|content|no-rewrite (profiles repin and mirror regeneration are separate steps: profiles-hash-repin skill, scripts/sync-all.sh)');
  const { P, sealedOld, refMap } = applyCtx(root, o, phase);
  if (P.problems.length) throw new InputError('plan has problems: ' + P.problems.join('; '));
  const git = (...a) => cp.execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = { phase };
  if (phase === 'rename') {
    if (P.reg.stage !== 'bootstrap') throw new InputError(`registry stage is ${P.reg.stage}; rename expects bootstrap`);
    for (const [a, b] of Object.entries(P.map)) {
      if (!fs.existsSync(path.join(root, a))) throw new InputError(`missing source ${a}`);
      fs.mkdirSync(path.dirname(path.join(root, b)), { recursive: true });
      fs.renameSync(path.join(root, a), path.join(root, b));
    }
    const rl = path.join(root, 'scripts/lib/repo-layout.js');
    fs.writeFileSync(rl, patchRegistry(fs.readFileSync(rl, 'utf8'), P));
    git('add', '-A', 'docs', 'project', 'scripts/lib/repo-layout.js');
    // destinations that .gitignore matches (e.g. */tree/events.jsonl) were tracked before: add them explicitly or the rename becomes a delete
    cp.execFileSync('git', ['-C', root, 'add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: Object.values(P.map).join('\0') + '\0', maxBuffer: 64 << 20 });
    log.renamed = Object.keys(P.map).length;
  } else if (phase === 'no-rewrite') {
    // path fields follow the layout-map; sha256 values and everything else stay byte for byte
    const f = path.join(root, 'tools/migrate/no-rewrite.json');
    let n = 0;
    const text = fs.readFileSync(f, 'utf8').replace(/("path":\s*")([^"]+)(")/g, (m, a, p, b) => { if (!P.map[p]) return m; n++; return a + P.map[p] + b; });
    fs.writeFileSync(f, text);
    log.paths_updated = n;
  } else if (phase === 'content') {
    const T = path.join(root, P.merge.target); const A = path.join(root, P.merge.absorbed_new);
    const first = fs.readFileSync(path.join(root, P.merge.target), 'utf8'); const second = fs.readFileSync(A, 'utf8');
    if (!first.includes('merged from')) {
      const fence = (src, oldPath) => `<!-- merged from ${oldPath}; the original file's history is in git -->\n`;
      const body = `# HANDOFF\n\n> Two live handoff documents were merged here (3.0.0 relayout P1). Each keeps its original text verbatim under its own heading; the originals are in git history.\n\n## A. Operator-pin work (was docs/HANDOFF.md)\n\n${fence(0, 'docs/HANDOFF.md')}\n${first.replace(/\s+$/, '')}\n\n## B. Ongoing maintenance (was docs/projects/ongoing-maintenance/HANDOFF.md)\n\n${fence(0, P.merge.absorbed_old)}\n${second.replace(/\s+$/, '')}\n`;
      fs.writeFileSync(T, body);
    }
    fs.rmSync(A, { force: true }); // plain file operations: apply never touches the index after the rename phase
    const readme = path.join(root, 'docs/README.md');
    fs.writeFileSync(readme, DOCS_README);
    for (const f of Object.keys(P.cls).filter((k) => P.cls[k].cat === 'delete')) fs.rmSync(path.join(root, f), { force: true });
    // refs-code rewrote the card text that mods/live/decide.test.ts feeds the pane (docs/plans/<file> became project/plans/<file>), but the
    // line that SELECTS that card by its leading words is a directory-form hit the rewriter leaves alone: follow it here, exactly once
    const dt = path.join(root, 'mods/live/decide.test.ts');
    if (fs.existsSync(dt)) {
      const src = fs.readFileSync(dt, 'utf8'); const from = "l.text.includes('見 docs/plans')";
      const n = src.split(from).length - 1;
      if (n === 1) { fs.writeFileSync(dt, src.replace(from, () => "l.text.includes('見 project/plans')")); log.selector_fixed = 'mods/live/decide.test.ts'; }
      else if (n > 1) throw new InputError(`mods/live/decide.test.ts selector matched ${n} times (want 1)`);
    }
    // scripts/check-stage-vocab.js excludes history by the registry's keys; once the archives moved, the evidence trees P1 leaves inside the old
    // archive directories (P2 moves them) fall out of that list. Add the two stay-behind prefixes, only for a moved layout, exactly once.
    const sv = path.join(root, 'scripts/check-stage-vocab.js');
    if (fs.existsSync(sv)) {
      const src = fs.readFileSync(sv, 'utf8');
      const a = "  EXCLUDE_PREFIXES = [\n    'CHANGELOG.md',\n    ...uniq([dirPrefix('plans_dir'), dirPrefix('plans_evidence_dir'), dirPrefix('projects_archive_dir')]),\n";
      const b = "  // P1 leaves the evidence trees INSIDE the two archives where they were (P2 moves them): they are history too, and the registry's\n  // path keys no longer name them once the archives themselves have moved\n  const stayBehind = dirPrefix('plans_dir') === 'docs/plans/' ? [] : ['docs/plans/_archive/', 'docs/projects/_archive/'];\n  EXCLUDE_PREFIXES = [\n    'CHANGELOG.md',\n    ...uniq([dirPrefix('plans_dir'), dirPrefix('plans_evidence_dir'), dirPrefix('projects_archive_dir'), ...stayBehind]),\n";
      const n = src.split(a).length - 1;
      if (n === 1) { fs.writeFileSync(sv, src.replace(a, () => b)); log.stage_vocab_fixed = 'scripts/check-stage-vocab.js'; }
      else if (n > 1 || !src.includes('const stayBehind')) throw new InputError(`scripts/check-stage-vocab.js exclude list matched ${n} times (want 1)`);
    }
    log.merged = [P.merge.target, P.merge.absorbed_old]; log.created = ['docs/README.md']; log.deleted = Object.keys(P.cls).filter((k) => P.cls[k].cat === 'delete');
  } else {
    Object.assign(log, rewriteRefs(root, P, sealedOld, refMap, phase));
  }
  if (o.log) fs.writeFileSync(path.resolve(o.log), JSON.stringify(log, null, 1) + '\n');
  process.stdout.write(`relayout-p1 apply ${phase}: ${JSON.stringify(Object.fromEntries(Object.entries(log).filter(([, v]) => typeof v !== 'object')))}\n`);
  return 0;
}

const DOCS_README = `# autopilot documentation

- [guide/](guide/): for people who use autopilot: installation, configuration, settings reference, skills, coexistence, token discipline, operator review how-to.
- [dev/](dev/): for people who work on autopilot: architecture, ADRs, hook and harness maps, contracts, upstream bug notes.
- [assets/](assets/): images used by the READMEs and the site.
- [scripts-inventory.md](scripts-inventory.md): the canonical index of every script (pinned here until the P4 move).

Work records are not documentation and live outside this directory: plans, projects, backlog, missions and handoff are under [../project/](../project/).
`;

const isTestFile = (f) => /\.test\.(js|cjs|mjs|ts|tsx|sh|py)$/.test(f) || /^(hooks|scripts)\/tests\//.test(f);
const GENERIC_KEYS = new Set(['docs/BACKLOG.md', 'docs/projects/INDEX.md']);
function rewriteRefs(root, P, sealedOld, refMap, phase) {
  const inv = {}; for (const [a, b] of Object.entries(P.map)) inv[b] = a;
  const skipPrefix = ['docs/plans/evidence/', 'profiles/', 'platforms/', '.opencode/plugin-package/', 'tools/migrate/relayout-p1.js', 'hooks/tests/relayout-p1.test.sh'];
  // O8 / O8-ext / O9 / O12 files are hash-pinned by baseline-red rows (D9.1, D9.3, D9.6): P1 leaves their bytes alone, P3 / P4 change them with a declared fingerprint change
  const nrx = readJson(root, 'tools/migrate/no-rewrite.json');
  const pinnedExcluded = ((nrx && nrx.excluded) || []).filter((e) => /^(O8|O8-ext|O9|O12)$/.test(e.class)).map((e) => e.path);
  const skipExact = new Set([...pinnedExcluded, 'tools/migrate/no-rewrite.json', 'project/plans/2026-10-31-repo-relayout-3-0-0.md', P.reg.paths.mission_routing_config, ...P.ctx.proposedExceptions.map((e) => e.path)]);
  const docsSide = (f) => f.startsWith('docs/') || f.startsWith('project/') || /^(CHANGELOG|CLAUDE|AGENTS|SECURITY|README(\.zh-TW)?)\.md$/.test(f);
  const files = cp.execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 << 20 }).split('\0').filter(Boolean).sort();
  const oldTracked = new Set(files.map((f) => inv[f] || f));
  const tok = /docs\/[A-Za-z0-9_@.+\/-]+/g;
  const dirForm = /^docs\/(plans|projects|backlog|adr|upstream-bugs)(\/|$)|^docs\/mission-/;
  const st = { skipped_generic_convention: 0, files_changed: 0, token_replacements: 0, link_rewrites: 0, skipped_sealed: 0, skipped_excluded: 0, skipped_binary_or_large: 0, skipped_embedded: 0 };
  const embedded = []; const dirHits = {}; const changed = [];
  for (const f of files) {
    if (docsSide(f) !== (phase === 'refs-docs')) continue;
    const old = inv[f] || f;
    if (sealedOld.has(old)) { st.skipped_sealed++; continue; }
    if (skipExact.has(f) || skipExact.has(old) || skipPrefix.some((p) => f.startsWith(p)) || /^docs\/(plans|projects)\/_archive\/.+\/evidence\//.test(f)) { st.skipped_excluded++; continue; }
    const abs = path.join(root, f);
    let buf; try { const stt = fs.lstatSync(abs); if (!stt.isFile() || stt.size > 6 << 20) { st.skipped_binary_or_large++; continue; } buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.includes(0)) { st.skipped_binary_or_large++; continue; }
    let text = buf.toString('utf8'); const orig = text;
    // 1. markdown relative links in files that lived under docs/ (resolved against the OLD directory, written against the NEW one)
    if (old.startsWith('docs/') && f.endsWith('.md')) {
      text = text.replace(/(\]\(|^\[[^\]\n]+\]:\s*)(<?)([^)\s>]+)/gm, (m, pre, lt, target) => {
        if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return m;
        const m2 = /^([^#?]*)([#?].*)?$/.exec(target); const bare = m2[1]; if (!bare) return m;
        const oldTarget = path.posix.normalize(path.posix.join(path.posix.dirname(old), bare));
        if (!oldTracked.has(oldTarget)) return m;
        const newTarget = refMap[oldTarget] || oldTarget;
        let rel = path.posix.relative(path.posix.dirname(f), newTarget);
        if (bare.startsWith('./') && !rel.startsWith('.')) rel = './' + rel;
        if (rel === bare) return m;
        st.link_rewrites++;
        return pre + lt + rel + (m2[2] || '');
      });
    }
    // 2. full repo-relative paths that are exact layout-map keys
    text = text.replace(tok, (m, idx, whole) => {
      const t = m.replace(/[.,;:)\]-]+$/, ''); const tail = m.slice(t.length);
      let to = refMap[t];
      // consumer-facing guidance (skills, references, agents, config templates) names docs/BACKLOG.md and docs/projects/INDEX.md as the
      // CONVENTION of whatever repo it runs in, not this repo's own layout: those two generic keys are left alone there (reported)
      if (to && GENERIC_KEYS.has(t) && /^(skills|references|agents|project-config-template)\//.test(f)) { st.skipped_generic_convention++; to = null; }
      if (!to) { if (dirForm.test(t) && !t.startsWith('docs/plans/evidence')) { const g = (/^docs\/[^/]+/.exec(t) || [''])[0]; (dirHits[g] = dirHits[g] || { count: 0, sample: [] }).count++; if (dirHits[g].sample.length < 5) dirHits[g].sample.push(`${f}: ${t}`); } return m; }
      const prev = whole[idx - 1];
      if (prev !== undefined && /[A-Za-z0-9_.-]/.test(prev)) { st.skipped_embedded++; return m; }
      if (prev === '/') {
        const before = whole.slice(Math.max(0, idx - 40), idx - 1);
        // in a test file a "$d/docs/..." or "$R/docs/..." path is a mktemp fixture tree, not this repo: only the repo-root variables count
        const repoVar = /\$\{?(REPO_ROOT|REPO|ROOT|AUTOPILOT_ROOT|SELF_DIR\/\.\.|HOOKS_DIR\/\.\.)\}?$/.test(before);
        const ok = whole.slice(idx - 3, idx) === '../' || repoVar || (!isTestFile(f) && (/[}"')]$/.test(before) || /\$[A-Za-z_]+$/.test(before)));
        if (!ok) { st.skipped_embedded++; if (embedded.length < 20) embedded.push(`${f}: ${whole.slice(Math.max(0, idx - 30), idx + t.length)}`); return m; }
      }
      st.token_replacements++;
      return to + tail;
    });
    if (text !== orig) { fs.writeFileSync(abs, text); st.files_changed++; changed.push(f); }
  }
  return Object.assign(st, { changed_files: changed, embedded_samples: embedded, directory_form_hits_left_alone: dirHits });
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  if (cmd === 'plan') return cmdPlan(o);
  if (cmd === 'check-f2') return cmdCheckF2(o);
  if (cmd === 'classify') return cmdClassify(o);
  if (cmd === 'apply') return cmdApply(o);
  throw new InputError('usage: relayout-p1.js plan|check-f2|classify|apply ... (see the file header)');
}
try { process.exitCode = main(); } catch (e) {
  if (e instanceof InputError) { process.stderr.write(`relayout-p1: ${e.message}\n`); process.exitCode = 2; } else throw e;
}
