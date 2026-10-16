#!/usr/bin/env node
'use strict';
// affected-suites.js — select the test files a diff can affect (BL-0001: the quality gate's test step runs it first).
//
// Usage:
//   node scripts/affected-suites.js --base <ref> [--head <ref>] [--json]
//   node scripts/affected-suites.js --files a.js b.sh [--json]        (paths relative to --root)
//   Options: --root <dir> (default: the repo containing this script), --list-all (print every
//   suite run.sh would run), --help.
//
// Output (default): one test path per line; the single line `FULL` when the diff cannot be judged.
// Output (--json): {schema:1, mode:"selective"|"full", base, head, changed:[], suites:[],
//   always_run:[], extra_runners:[], full_reasons:[], unreferenced:[], chains:{suite:[path...]}, stats:{}}.
//   extra_runners = entry points outside run.sh that the diff needs (mods/live/** => mods/live/run-tests.sh);
//   present in both modes. Text output prints them as extra lines after the suites (or after FULL).
//   mode "full" means: run the whole suite (hooks/tests/run.sh); `suites` is then empty.
// Exit: 0 ok (selective or full), 2 usage/git error.
//
// How it selects (static, conservative = over-select rather than miss):
//   1. Index every code file (js/mjs/cjs/sh/bash/zsh/py/ps1) in the head tree by the file names it
//      mentions: `name.ext` anywhere in the text, extensionless `name` of a code file when quoted or
//      after `/`, and directory globs (`scripts/*.sh`).
//   2. Seeds = changed files (added/modified/deleted). Walk the reverse graph: a code file that
//      mentions a changed file is affected, and is itself walked (shared lib -> script -> test).
//      Non-code files (docs, json, md) are seeds only, never intermediates.
//   3. The result is the affected files that run.sh runs as suites: hooks/*.test.js,
//      scripts/*.test.js, scripts/lib/*.test.js, hooks/tests/*.test.sh, scripts/*.test.sh.
//      A data file (fixture, golden) is reached through the non-generic directory names a test uses
//      to build its path.
//   4. Anything that cannot be judged statically (hooks/hooks.json, package files, run.sh, plugin
//      manifest, CI) => mode "full". So is any changed file that no selected suite reaches and that
//      is not prose (docs/, root *.md) or a platforms/ mirror: an empty list is never returned for a
//      change that could matter.
//   5. A fixed always-run list (ALWAYS_RUN, with a reason each) is added to every selective result
//      that has a non-prose change: tests that scan the repo by content, which no graph can see.
// Contract/evidence: skills/quality-pipeline/references/test-policy.md, docs/plans/evidence/2026-10-13-affected-suites/miss-check.md.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'sh', 'bash', 'zsh', 'py', 'ps1']);
const DEFAULT_MAX_WEAK = 2;
const MAX_BYTES = 1024 * 1024;

// Changes the static graph cannot judge: they alter how every hook / test / release is wired.
const FULL_TRIGGERS = [
  /^hooks\/hooks\.json$/,
  /^hooks\/tests\/run\.sh$/,
  /^package(-lock)?\.json$/,
  /^\.claude-plugin\//,
  /^\.github\//,
  /^\.githooks\//,
  /^\.claude\/quality-gate-config\.md$/,
];

// Entry points that run.sh does NOT run. Any changed path matching `re` adds `runner` to the result's
// extra_runners (selective AND full: a full run.sh still skips them). [re, runner]
const EXTRA_RUNNERS = [
  [/^mods\/live\//, 'mods/live/run-tests.sh'],
];
function extraRunners(changed) {
  return EXTRA_RUNNERS.filter(([re]) => changed.some((p) => re.test(p))).map(([, r]) => r);
}

// Suites that read repo files by CONTENT or compare whole trees: no reference graph can see what
// breaks them (a new file anywhere can turn them red), so they run on every selective result.
// [path, why]
const ALWAYS_RUN = [
  ['hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh', 'Population B scans every file under hooks/ for reviewer_engine lines'],
  ['hooks/tests/check-js-syntax.test.sh', 'syntax-checks every tracked JS file'],
  ['hooks/tests/codex-plugin-package.test.sh', 'codex mirror must equal its sources (source edit without mirror sync, or mirror-only edit)'],
  ['hooks/tests/test-identity-guard.test.sh', 'scans every *.test.sh for git identity writes'],
  ['hooks/tests/test-suite-finalize-gate.test.sh', 'scans every *.test.sh for the finalize counter'],
  ['hooks/tests/check-test-integrity.test.sh', 'real config must match every real suite file'],
  ['hooks/tests/check-tmp-residue-registry.test.sh', 'scans the git index for tmp residue'],
  ['hooks/tests/check-claude-md-inventory.test.sh', 'every shipped script must be named in CLAUDE.md'],
  ['hooks/tests/check-hook-inventory.test.sh', 'hook files vs hooks.json vs docs'],
  ['hooks/tests/check-canonical-invariants.test.sh', 'cross-file invariants over the real tree'],
  ['hooks/tests/p6d-gates-repair-ladder.test.sh', 'grep -rln repair_lock over all of src/'],
  ['hooks/tests/qualify-scorecard-vocabulary.test.sh', 'grep -rl a model-id charset over scripts/ and src/'],
  ['hooks/tests/skill-onoff-stage-graph.test.sh', 'greps all of scripts/ for the probe ladder field (only probe-unknown.js may print it)'],
  ['hooks/tests/skill-count-metadata.test.sh', 'counts the skills/ directories against the documented count (a new skill dir changes it)'],
  ['hooks/tests/qualify-recipe-credential-staging.test.sh', 'greps every docs/plans/evidence/*/administration/*/run.sh for staging variables'],
];
// Prose cannot break a suite; mirrors are covered by the always-run codex-plugin-package suite.
const PURE_DOC = /^(docs|website|skill-creator-workspace)\/|^[^/]+\.(md|txt)$/;
const MIRROR = /^platforms\//;
// A script under docs/ is code, not prose (a suite may scan it).
const isProse = (p) => PURE_DOC.test(p) && !isCode(p);

function isSuite(p) {
  return /^hooks\/[^/]+\.test\.js$/.test(p) || /^scripts\/[^/]+\.test\.js$/.test(p) ||
    /^scripts\/lib\/[^/]+\.test\.js$/.test(p) || /^hooks\/tests\/[^/]+\.test\.sh$/.test(p) ||
    /^scripts\/[^/]+\.test\.sh$/.test(p);
}
const extOf = (p) => { const m = /\.([A-Za-z0-9]+)$/.exec(p); return m ? m[1] : ''; };
const isCode = (p) => CODE_EXT.has(extOf(p));
const base = (p) => p.slice(p.lastIndexOf('/') + 1);

function git(root, args, input) {
  return execFileSync('git', args, { cwd: root, input, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
}

// A tree = {files: [paths], read(path) -> string|null}
function gitTree(root, ref) {
  const out = git(root, ['ls-tree', '-r', '-z', ref]).toString('utf8').split('\0').filter(Boolean);
  const blobs = new Map();
  for (const line of out) {
    const m = /^(\d+) blob ([0-9a-f]+)\t(.*)$/.exec(line);
    if (m) blobs.set(m[3], m[2]);
  }
  let cache = null;
  function load() {
    cache = new Map();
    const want = [...blobs].filter(([p]) => isCode(p));
    if (!want.length) return;
    const buf = git(root, ['cat-file', '--batch'], want.map(([, sha]) => sha).join('\n') + '\n');
    let off = 0;
    for (const [p] of want) {
      const nl = buf.indexOf(10, off);
      const header = buf.slice(off, nl).toString('utf8').split(' ');
      const size = Number(header[2]);
      off = nl + 1;
      if (header[1] === 'blob' && size <= MAX_BYTES) cache.set(p, buf.slice(off, off + size).toString('utf8'));
      off += size + 1;
    }
  }
  return {
    files: [...blobs.keys()],
    read(p) { if (!cache) load(); return cache.has(p) ? cache.get(p) : null; },
  };
}

function diskTree(root) {
  const files = git(root, ['ls-files', '-co', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean)
    .filter((p) => fs.existsSync(path.join(root, p)));
  return {
    files,
    read(p) {
      try { const b = fs.readFileSync(path.join(root, p)); return b.length <= MAX_BYTES ? b.toString('utf8') : null; } catch { return null; }
    },
  };
}

// Tokens a text can use to refer to other files.
const RE_EXT = /[A-Za-z0-9_][A-Za-z0-9_.\-]*\.[A-Za-z0-9]{1,12}\b/g;
// A directory name used as a path segment ("$FX"/session-marker/...): a data file under that directory
// is referenced by any text that names the directory (tests build fixture paths from a dir variable).
const RE_SEG = /\/([A-Za-z0-9_][A-Za-z0-9_.\-]*)(?=[\/"'\s)}\]$]|$)/g;
const RE_BARE = /(?:^|[\/'"`])([A-Za-z0-9_][A-Za-z0-9_\-]*)(?=['"`)\/\s,;:]|$)/gm;
const RE_GLOB = /((?:"?\$\{?[A-Za-z_]\w*\}?"?)?[A-Za-z0-9_.\-\/]*)\/\*(\.[A-Za-z0-9]+)?/g;
// "$REPO_ROOT"/scripts/* and $REPO_ROOT/scripts/*.sh both mean the repo-relative directory scripts.
const globDir = (d) => d.replace(/^"?\$\{?\w+\}?"?/, '').replace(/^\/+/, '').replace(/^\.\//, '');

// Strong edges: the text loads the file (require/import/source), so a change reaches it for sure.
const RE_REQ = /(?:require\(\s*|import\s+[^'"\n]*?from\s+|import\(\s*|import\s+)['"]([^'"\n]+)['"]/g;
const RE_SRC = /(?:^|[;&|(]|\bthen\b|\bdo\b)[ \t]*(?:source|\.)[ \t]+["']?([^\s"';)]+)/gm;

function mentions(text) {
  const exts = new Set(), bares = new Set(), globs = [], strong = new Set(), segs = new Set();
  for (const m of text.matchAll(RE_SEG)) segs.add(m[1]);
  for (const m of text.matchAll(RE_REQ)) if (/^[.\/]/.test(m[1])) strong.add(base(m[1]).replace(/\.(js|mjs|cjs|json)$/, ''));
  for (const m of text.matchAll(RE_SRC)) strong.add(base(m[1]).replace(/\.(sh|bash|zsh)$/, ''));
  for (const m of text.matchAll(RE_EXT)) exts.add(m[0]);
  for (const m of text.matchAll(RE_BARE)) bares.add(m[1]);
  for (const m of text.matchAll(RE_GLOB)) globs.push({ dir: globDir(m[1]), ext: m[2] || '' });
  return { exts, bares, globs, strong, segs };
}

const GENERIC_DIRS = new Set(['fixtures', 'fixture', 'golden', 'data', 'lib', 'tests', 'scripts', 'hooks', 'src', 'bin', 'docs', 'evals', 'platforms', 'skills', 'agents', 'references', 'schemas', 'profiles', 'mods', 'plugin', 'codex', '.claude', 'node_modules']);
// Mirrors, eval fixtures and docs are copies or prose: they never propagate a change to a suite.
const NOT_PROPAGATING = /^(platforms|evals|docs|website|skill-creator-workspace|\.opencode)\//;
const stripComments = (t) => t.replace(/^[ \t]*(#|\/\/).*$/gm, '');

function buildGraph(tree) {
  const codeFiles = tree.files.filter((f) => isCode(f) && (isSuite(f) || !NOT_PROPAGATING.test(f)));
  const refs = new Map(); // file -> mentions
  for (const f of codeFiles) {
    const t = tree.read(f);
    if (t != null) refs.set(f, mentions(stripComments(t)));
  }
  const byExt = new Map(), byBare = new Map(), bySeg = new Map(); // token -> Set(referrer)
  const add = (m, k, f) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(f); };
  for (const [f, r] of refs) {
    for (const t of r.exts) add(byExt, t, f);
    for (const t of r.bares) add(byBare, t, f);
    for (const t of r.segs) add(bySeg, t, f);
  }
  const globRefs = []; // {file, dir, ext}
  for (const [f, r] of refs) for (const g of r.globs) globRefs.push({ file: f, ...g });
  return { refs, byExt, byBare, bySeg, globRefs };
}

// -> Map(referrer -> 'strong'|'weak')
function referrersOf(graph, p) {
  const out = new Map();
  const bareP = base(p).replace(/\.[^.]+$/, '');
  const kind = (f) => (graph.refs.get(f).strong.has(bareP) ? 'strong' : 'weak');
  const b = base(p);
  for (const f of graph.byExt.get(b) || []) out.set(f, kind(f));
  if (isCode(p)) {
    const bare = b.replace(/\.[^.]+$/, '');
    for (const f of graph.byBare.get(bare) || []) if (!out.has(f)) out.set(f, kind(f));
  }
  if (!isCode(p)) {
    // data file: any text naming one of its ancestor directories (except generic top-level ones) refers to it
    const parts = p.split('/').slice(0, -1);
    for (const c of parts) {
      if (GENERIC_DIRS.has(c)) continue;
      for (const f of graph.bySeg.get(c) || []) if (!out.has(f)) out.set(f, 'weak');
    }
  }
  for (const g of graph.globRefs) {
    if (g.dir && p.slice(0, Math.max(p.lastIndexOf('/'), 0)) === g.dir && (!g.ext || p.endsWith(g.ext)) && !out.has(g.file)) out.set(g.file, 'weak');
  }
  out.delete(p);
  return out;
}

function select(changed, headTree, maxWeak = DEFAULT_MAX_WEAK) {
  const fullReasons = changed.filter((p) => FULL_TRIGGERS.some((re) => re.test(p))).map((p) => `unjudgeable change: ${p}`);
  const graph = buildGraph(headTree);
  // Cost = weak (mere mention) hops on the path; strong (require/source) hops are free. A diff
  // reaches a suite within maxWeak weak hops: lib -(strong)-> lib -(weak)-> script -(weak)-> test.
  // Unbounded textual transitivity floods (a hub script naming 40 hooks drags in every suite).
  const parent = new Map(), cost = new Map();
  let level = [];
  for (const c of changed) { parent.set(c, null); cost.set(c, 0); level.push(c); }
  for (let w = 0; w <= maxWeak && level.length; w++) {
    const next = [];
    const q = level.slice();
    while (q.length) {
      const cur = q.shift();
      if (!isCode(cur) && parent.get(cur) !== null) continue; // only code files propagate
      for (const [r, k] of referrersOf(graph, cur)) {
        const nc = w + (k === 'weak' ? 1 : 0);
        if (nc > maxWeak || (cost.has(r) && cost.get(r) <= nc)) continue;
        cost.set(r, nc); parent.set(r, cur);
        if (k === 'strong') q.push(r); else next.push(r);
      }
    }
    level = next;
  }
  const present = new Set(headTree.files);
  const suites = [...parent.keys()].filter((p) => isSuite(p) && present.has(p)).sort();
  const chains = {};
  for (const s of suites) {
    const chain = [];
    for (let c = s; c != null; c = parent.get(c)) chain.push(c);
    chains[s] = chain;
  }
  // A changed file that no selected suite reaches and that is not prose cannot be judged: run everything.
  const reached = new Set(suites.flatMap((s) => chains[s]));
  const unreferenced = changed.filter((p) => !isProse(p) && !MIRROR.test(p) && !reached.has(p));
  for (const p of unreferenced) fullReasons.push(`unreferenced change (no suite reaches it): ${p}`);
  // Content-scanning suites ride along with every selective result that has a non-prose change.
  const alwaysRun = changed.some((p) => !isProse(p)) ? ALWAYS_RUN.map(([f]) => f).filter((f) => present.has(f)) : [];
  for (const f of alwaysRun) if (!chains[f]) chains[f] = [f];
  const all = [...new Set([...suites, ...alwaysRun])].sort();
  return { suites: all, alwaysRun, chains, fullReasons, unreferenced, graphFiles: graph.refs.size };
}

function allSuites(tree) { return tree.files.filter(isSuite).sort(); }

function parseArgs(argv) {
  const a = { files: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--base') a.base = argv[++i];
    else if (x === '--head') a.head = argv[++i];
    else if (x === '--root') a.root = argv[++i];
    else if (x === '--json') a.json = true;
    else if (x === '--max-weak') a.maxWeak = Number(argv[++i]);
    else if (x === '--list-all') a.listAll = true;
    else if (x === '--files') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) a.files.push(argv[++i]); a.useFiles = true; }
    else if (x === '--help' || x === '-h') a.help = true;
    else throw new Error(`unknown argument: ${x}`);
  }
  return a;
}

function main(argv) {
  let a;
  try { a = parseArgs(argv); } catch (e) { process.stderr.write(e.message + '\n'); return 2; }
  if (a.help) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 21).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    return 0;
  }
  const root = path.resolve(a.root || path.join(__dirname, '..'));
  try {
    let tree, changed, baseRef = a.base || null, headRef = a.head || null;
    if (a.useFiles) {
      tree = diskTree(root);
      changed = a.files.map((f) => f.replace(/^\.\//, ''));
      baseRef = headRef = null;
    } else if (a.listAll) {
      tree = a.head ? gitTree(root, a.head) : diskTree(root);
      changed = [];
    } else {
      if (!a.base) { process.stderr.write('need --base <ref> or --files\n'); return 2; }
      headRef = a.head || 'HEAD';
      tree = gitTree(root, headRef);
      changed = git(root, ['diff', '--name-only', '--no-renames', '-z', a.base, headRef]).toString('utf8').split('\0').filter(Boolean);
    }
    if (a.listAll) { process.stdout.write(allSuites(tree).join('\n') + '\n'); return 0; }
    const r = select(changed, tree, a.maxWeak == null ? DEFAULT_MAX_WEAK : a.maxWeak);
    const full = r.fullReasons.length > 0;
    const doc = {
      schema: 1, mode: full ? 'full' : 'selective', base: baseRef, head: headRef, changed: changed.slice().sort(),
      suites: full ? [] : r.suites, always_run: full ? [] : r.alwaysRun, extra_runners: extraRunners(changed), full_reasons: r.fullReasons, unreferenced: r.unreferenced,
      chains: full ? {} : r.chains, stats: { changed: changed.length, selected: full ? null : r.suites.length, total_suites: allSuites(tree).length, graph_files: r.graphFiles },
    };
    const extra = doc.extra_runners.map((x) => x + '\n').join('');
    process.stdout.write(a.json ? JSON.stringify(doc, null, 2) + '\n' : (full ? 'FULL\n' : r.suites.join('\n') + (r.suites.length ? '\n' : '')) + extra);
    return 0;
  } catch (e) {
    process.stderr.write(`affected-suites: ${e.message}\n`);
    return 2;
  }
}

module.exports = { extraRunners, select, mentions, buildGraph, isSuite, FULL_TRIGGERS, gitTree, diskTree };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
