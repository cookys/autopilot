#!/usr/bin/env node
'use strict';
// affected-suites.js — select the test files a diff can affect (BL-0001: the quality gate's test step runs it first).
//
// Usage:
//   node scripts/affected-suites.js --base <ref> [--head <ref>] [--json] [--run] [--record [path]]
//     [--entry-timeout <secs>] [--attribute]
//   node scripts/affected-suites.js --files a.js b.sh [--json] [--run]   (paths relative to --root)
//   Options: --root <dir> (default: the repo containing this script), --list-all (print every
//   suite run.sh would run), --help.
//
// --run executes the selection in the foreground, one entry at a time, the same way
// hooks/tests/run.sh runs that kind of file: a .sh with bash, a .test.js with node --test.
// Selective mode runs suites then extra_runners, prints each rc, and exits non-zero if any rc
// is non-zero only after every entry has run. An empty selective list exits 0 only when every
// changed file is documentation. Full mode never executes hooks/tests/run.sh: it prints
// full_reasons and "whole suite deferred to the pre-merge run (CLAUDE.md Mission graph
// verification)", then runs only always_run plus extra_runners.
//
// --record writes one plain JSON run record after --run finishes (every entry has run, whatever
// its rc). Without --run it is a usage error (stderr, exit 2, nothing written). With --files
// (no head ref) it is a usage error (exit 2). The next argument is the output path unless it
// starts with --; otherwise the path is <git-common-dir>/autopilot/qc-runs/<full-head-sha>.json.
// The common dir is `git rev-parse --git-common-dir` inside --root, made absolute against --root
// when git prints a relative path; parent directories are created. base and head are full shas
// from git rev-parse (--head or HEAD). The file is written atomically (temp file beside it, then
// rename). A failed write prints to stderr and exits 2. After the summary line, stdout gets
// `record: <path>`. The command's exit code stays the run's (non-zero when any entry failed).
// Record schema 1, key order: {schema:1, head, base, mode:"selective"|"full",
//   suites:[{path, rc}, ...]} — one object per entry actually executed, in execution order
//   (suites then extra_runners when selective; always_run then extra_runners when full). rc is
//   the integer already printed as rc=N.
//
// --entry-timeout <secs> (only with --run; default none): each executed entry runs in its own process
// group and is killed after that many seconds (TERM, KILL 2s later); its rc is 124 and the summary
// line ends with `(timeout: <paths>)`.
// --attribute (needs --run and --base; not --files): after the run, re-run ONLY the non-zero entries at
// the base commit in a temporary detached git worktree under the OS temp dir (always removed, also
// on failure or TERM/INT), same command, env and entry timeout. An entry non-zero at base is
// `preexisting`; zero at base, or absent at base, is `new`. A base re-run killed by the entry timeout, or one that exits 124 (timeout's exit code;
// it may be a timeout inside the suite itself, indistinguishable from outside) proves nothing, so that entry
// is `unattributed` (a failure, never preexisting; fail-closed: worst case is one more failure to look at). Prints `attribution: preexisting N: ...`,
// `attribution: new N: ...` and `attribution: unattributed N: ...`. Exit code with --attribute:
// non-zero (1) if any entry is `new` or `unattributed` (or an empty selection is not a pass); 3 is
// kept for a budget stop (any suite skipped for budget, even when the executed failures are all
// preexisting); preexisting-only failures with nothing skipped (base finished normally, non-zero) exit 0.
// Order: new/unattributed -> 1; else budget stop -> 3; else 0. With --entry-timeout, TERM/INT kills every
// running entry's process group (they run detached) and exits 143/130, in the head phase as well.
// Without --attribute the exit code is unchanged. --record adds, per re-run suite, an additive
// `base_rc` after the existing keys (schema 1 keys and order unchanged; consumers read path/rc only).
//
// --budget-seconds N (only with --run; N a positive number) changes the ORDER and the STOP point of
// the run, never which entries are selected. Order: a changed suite itself, then suites that name a
// changed file (distance 1), then by chain distance (nearest first); within one distance the shorter
// recorded time first (seconds from earlier --budget-seconds records in
// <git-common-dir>/autopilot/qc-runs/*.json, newest wins), then by name; extra_runners last.
// Once N seconds have passed no new entry starts (a running one finishes); the rest print as
// `not run (budget): <path>` plus `skipped_for_budget: <count>`. Exit 3 = budget ran out and every
// executed entry is green; a red executed entry still exits 1. With --json the run ends with a JSON
// document {budget, executed, skipped_for_budget}; --record adds the same three keys and a per-suite
// `seconds`. Without the flag nothing changes: name order, no budget keys.
//
// Output (default): one test path per line; the single line `FULL` when the diff cannot be judged.
// Output (--json): {schema:1, mode:"selective"|"full", base, head, changed:[], suites:[],
//   always_run:[], extra_runners:[], full_reasons:[], unreferenced:[], chains:{suite:[path...]}, stats:{}}.
//   extra_runners = entry points outside run.sh that the diff needs (mods/live/**, mods/viewer/**, mods/register.ts => mods/live/run-tests.sh + mods/viewer/run-tests.sh);
//   present in both modes. Text output prints them as extra lines after the suites (or after FULL).
//   mode "full" means: run the whole suite (hooks/tests/run.sh); `suites` is then empty.
// Exit: 0 ok (selective or full), 2 usage/git error, 3 --budget-seconds ran out (executed entries green).
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
//      manifest, CI) => mode "full". So is any changed file that a bounded walk from that file
//      alone cannot connect to a present suite, and that is not prose (docs/, root *.md) or a
//      platforms/ mirror. Reach is per seed: the parent chain records one parent, so it is not
//      the reachability test. A suite path that the diff deletes is absent from the head tree
//      and does not force full. An empty list is never returned for a change that could matter.
//   5. A fixed always-run list (ALWAYS_RUN, with a reason each) is added to every selective result
//      that has a non-prose change: tests that scan the repo by content, which no graph can see.
//   6. An extensionless directory glob in a shared test helper (a non-suite .sh directly under
//      hooks/tests/) creates no glob edge; globs with an extension, and every glob in a suite, stay.
//      Known trade-off: a helper that executes files through such a glob (rather than symlinking
//      them) is missed; the suites that execute a script by explicit name stay covered.
//   7. A platforms/ mirror seed matches only a code file whose text contains that seed's full
//      repo-relative path; basename, bare-name, directory-segment and glob edges are not used.
//   8. For a prose seed whose path starts with docs/, the category directory names plans, evidence,
//      backlog, projects and adr are skipped like GENERIC_DIRS. Only an extensionless glob whose
//      directory has no more specific segment is skipped; a glob with an extension (docs/plans/*.md)
//      keeps its edge. A deeper specific directory name and a basename mention stay. The same
//      category names on a seed outside docs/ are not skipped.
//   9. A weak bare-name edge to a JavaScript file is not created when that stem is shared by two or
//      more code files and the mention has no slash (a backtick or quote around index, common, codex).
//      Stem counts ignore non-propagating paths (platforms/ mirrors, evals/, docs/, website/, and the
//      rest of NOT_PROPAGATING), so a codex mirror does not make a source file look generic.
//      A stem that names one propagating code file, a strong require or source, and any slash or
//      name.ext mention stay.
//  10. JavaScript comments are stripped by a string-aware scan: single-quoted, double-quoted and
//      template literals are copied through (backslash escapes honoured; ${} in a template is still
//      scanned). A // comment, line-leading or trailing, is removed through the end of its line
//      before any slash-star on that line is considered. A slash-star starts a block comment only
//      when it is the first non-blank character on its line (a line-leading JSDoc block still goes).
//      A slash-star later on the line, including inside split(/[/*]/), stays as text: over-selection
//      is safer than dropping a require. An unterminated line-leading block is removed only through
//      the closing marker, or, when none exists, only to the end of that line — never to end of file.
//      A line whose first non-blank character is * is a comment only while the scan is inside a block.
//      Shell and other non-JS files still drop full-line # and // comments only.
//  11. A shared test helper (a non-suite .sh directly under hooks/tests/) that names a prose file (.md or .txt:
//      `cp "$REPO_ROOT/hooks/README.md" ...`) creates no edge to it: it serves the few suites that call that
//      function, not every suite that sources the helper. Trade-off: those few are not selected by a prose-only change.
//  12. A prose seed whose basename is shared by two or more tracked files (README.md, CHANGELOG.md) is reached only
//      by a referrer that names a path ending in the seed's own path (hooks/README.md, "$ROOT/README.md"); a bare
//      `README.md` in a list of file names pins nothing.
//  13. A bare quoted word with no slash and no extension creates no weak edge to a JavaScript file whose stem is one
//      plain lowercase word (residue, status, tree): it is an ordinary word in any text. Hyphenated stems, name.ext,
//      slash mentions and strong require/source edges are unchanged.
//  14. A "$VAR/name" path (a variable expansion directly before the slash, name closed by a quote or token end,
//      "$TEST_TMP/session-mode") is a directory under a runtime root, not a mention of name.js: no slash-bare edge.
//  15. Lazy require marker (BL-0332): a JavaScript line carrying `// affected-suites: lazy` declares that its
//      require() sits behind a gate that does not open under test (an env switch, a CLI branch no suite takes).
//      The specifier on that line is blanked before the mention scan: no strong edge and no bare-name edge from
//      that file. A suite that names the target itself still reaches it by its own mention. Chosen over "every
//      indented require is lazy": 192 indented requires exist, most always run when their function runs, and a weak
//      edge still lets the strong edges behind it flood (tried: 678 -> 658); only a human who has checked the gate
//      can say it stays closed under test, so the claim is explicit and greppable. Use it only with that check.
// Contract/evidence: skills/quality-pipeline/references/test-policy.md, docs/plans/evidence/2026-10-13-affected-suites/miss-check.md.

const { execFileSync, spawnSync, spawn } = require('child_process');
const os = require('os');
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
// The live and viewer mods import each other's files (the viewer takes the live mod's locale choice and colour roles, the live mod's pressable file paths call the viewer's
// show.ts). The roundtable pane imports the same colour roles and is composed from mods/register.ts, so a change under any of them runs all three runners.
const MODS_RE = /^mods\/(live|viewer|roundtable)\/|^mods\/register\.ts$/;
const EXTRA_RUNNERS = [
  [MODS_RE, 'mods/live/run-tests.sh'],
  [MODS_RE, 'mods/viewer/run-tests.sh'],
  [MODS_RE, 'mods/roundtable/run-tests.sh'],
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
// A literal repo-relative platforms/ path. Used only when the seed is a mirror.
const RE_MIRROR_PATH = /platforms\/[A-Za-z0-9_./\-]+/g;
// "$REPO_ROOT"/scripts/* and $REPO_ROOT/scripts/*.sh both mean the repo-relative directory scripts.
const globDir = (d) => d.replace(/^"?\$\{?\w+\}?"?/, '').replace(/^\/+/, '').replace(/^\.\//, '');

// Strong edges: the text loads the file (require/import/source), so a change reaches it for sure.
const RE_REQ = /(?:require\(\s*|import\s+[^'"\n]*?from\s+|import\(\s*|import\s+)['"]([^'"\n]+)['"]/g;
const RE_SRC = /(?:^|[;&|(]|\bthen\b|\bdo\b)[ \t]*(?:source|\.)[ \t]+["']?([^\s"';)]+)/gm;

// A name directly after a shell/JS variable expansion and a slash, closed by a quote or the end of
// the token ("$TEST_TMP/session-mode"), names a directory under a runtime root, not a code file.
const VAR_DIR_BEFORE = /\$\{?[A-Za-z_]\w*\}?["']?$/;
// Lazy require (BL-0332): a JavaScript line that carries `// affected-suites: lazy` declares that its
// require is behind a gate that does not open under test (an env switch, a CLI branch no suite takes).
// The specifier on that line is blanked before the mention scan, so it makes no edge at all (strong or
// bare-name). A suite that names the target itself still reaches it by its own mention.
const LAZY_MARK = /\/\/\s*affected-suites:\s*lazy\b/;
const LAZY_REQ = /require\(\s*(['"])[^'"\n]+\1\s*\)/g;
function blankLazyRequires(raw, file) {
  if (!/\.(js|mjs|cjs)$/.test(file) || !LAZY_MARK.test(raw)) return raw;
  return raw.split('\n').map((l) => (LAZY_MARK.test(l) ? l.replace(LAZY_REQ, 'require(null)') : l)).join('\n');
}
// Rule 12 input: a prose-file mention that carries a directory part (hooks/README.md, "$ROOT/README.md").
const RE_PROSE_PATH = /[A-Za-z0-9_.\-\/$"{}]*\/[A-Za-z0-9_][A-Za-z0-9_.\-]*\.(?:md|txt)\b/g;
function mentions(text) {
  const proseNames = new Set(), exts = new Set(), bares = new Set(), slashBares = new Set(), globs = [], strong = new Set(), segs = new Set(), paths = new Set();
  for (const m of text.matchAll(RE_SEG)) segs.add(m[1]);
  for (const m of text.matchAll(RE_REQ)) if (/^[.\/]/.test(m[1])) strong.add(base(m[1]).replace(/\.(js|mjs|cjs|json)$/, ''));
  for (const m of text.matchAll(RE_SRC)) strong.add(base(m[1]).replace(/\.(sh|bash|zsh)$/, ''));
  for (const m of text.matchAll(RE_EXT)) exts.add(m[0]);
  for (const m of text.matchAll(RE_PROSE_PATH)) proseNames.add(m[0].replace(/^["{}$]*/, '').replace(/^\$\{?\w+\}?"?\//, ''));
  for (const m of text.matchAll(RE_BARE)) {
    if (m[0].startsWith('/')) {
      if (VAR_DIR_BEFORE.test(text.slice(Math.max(0, m.index - 80), m.index))) continue;
      slashBares.add(m[1]);
    } else bares.add(m[1]);
  }
  for (const m of text.matchAll(RE_GLOB)) globs.push({ dir: globDir(m[1]), ext: m[2] || '' });
  for (const m of text.matchAll(RE_MIRROR_PATH)) paths.add(m[0]);
  return { proseNames, exts, bares, slashBares, globs, strong, segs, paths };
}

const GENERIC_DIRS = new Set(['fixtures', 'fixture', 'golden', 'data', 'lib', 'tests', 'scripts', 'hooks', 'src', 'bin', 'docs', 'evals', 'platforms', 'skills', 'agents', 'references', 'schemas', 'profiles', 'mods', 'plugin', 'codex', '.claude', 'node_modules']);
// Category folders under docs/. Skipped only for a prose seed; other data files keep GENERIC_DIRS alone.
const PROSE_DIR_SKIP = new Set(['plans', 'evidence', 'backlog', 'projects', 'adr']);
// A non-suite .sh directly under hooks/tests/: shared helper, not a suite.
const isSharedTestHelper = (p) => /^hooks\/tests\/[^/]+\.sh$/.test(p) && !isSuite(p);
// Mirrors, eval fixtures and docs are copies or prose: they never propagate a change to a suite.
const NOT_PROPAGATING = /^(platforms|evals|docs|website|skill-creator-workspace|\.opencode)\//;
// Full-line # and //, plus a trailing // through end of line, so a slash-star inside that comment
// is never a block start. A slash-star starts a block only when it is the first non-blank on its
// line. Anywhere else, including a regexp, it stays text. A star line is dropped only inside a block.
function stripJsComments(src) {
  const n = src.length;
  let i = 0;
  let out = '';
  let lineStart = true;
  function append(ch) {
    out += ch;
    if (ch === '\n') lineStart = true;
    else if (ch !== ' ' && ch !== '\t' && ch !== '\r') lineStart = false;
  }
  function scan(stop) {
    let brace = 0;
    while (i < n) {
      const c = src[i];
      if (stop === '}' && c === '}' && brace === 0) return;
      if (lineStart && (c === ' ' || c === '\t' || c === '\r')) { append(c); i++; continue; }
      if (lineStart && c === '#') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (lineStart && c === '/' && src[i + 1] === '*') {
        const close = src.indexOf('*/', i + 2);
        if (close === -1) {
          while (i < n && src[i] !== '\n') i++;
          continue;
        }
        let sawNl = false;
        for (let k = i; k < close + 2; k++) if (src[k] === '\n') sawNl = true;
        i = close + 2;
        if (sawNl) lineStart = true;
        continue;
      }
      if (c === '\'' || c === '"') { copyQuoted(c); continue; }
      if (c === '`') { copyTemplate(); continue; }
      if (c === '{') { append(c); i++; brace++; continue; }
      if (c === '}') { append(c); i++; if (brace > 0) brace--; continue; }
      append(c); i++;
    }
  }
  function copyQuoted(quote) {
    append(quote); i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        append(c); i++;
        if (i < n) { append(src[i]); i++; }
        continue;
      }
      append(c); i++;
      if (c === quote || c === '\n') return;
    }
  }
  function copyTemplate() {
    append('`'); i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        append(c); i++;
        if (i < n) { append(src[i]); i++; }
        continue;
      }
      if (c === '`') { append(c); i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        append('$'); append('{'); i += 2;
        scan('}');
        if (i < n && src[i] === '}') { append('}'); i++; }
        continue;
      }
      append(c); i++;
    }
  }
  scan(null);
  return out;
}
const stripComments = (t, file) => {
  const ext = String(file || '').split('.').pop();
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return stripJsComments(t);
  return t.replace(/^[ \t]*(#|\/\/).*$/gm, '');
};

function buildGraph(tree) {
  const codeFiles = tree.files.filter((f) => isCode(f) && (isSuite(f) || !NOT_PROPAGATING.test(f)));
  const refs = new Map(); // file -> mentions
  for (const f of codeFiles) {
    const t = tree.read(f);
    if (t != null) refs.set(f, mentions(stripComments(blankLazyRequires(t, f), f)));
  }
  const byExt = new Map(), byBare = new Map(), bySlashBare = new Map(), bySeg = new Map(), byPath = new Map(); // token -> Set(referrer)
  const add = (m, k, f) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(f); };
  for (const [f, r] of refs) {
    for (const t of r.exts) add(byExt, t, f);
    for (const t of r.bares) add(byBare, t, f);
    for (const t of r.slashBares) add(bySlashBare, t, f);
    for (const t of r.segs) add(bySeg, t, f);
    for (const t of r.paths) add(byPath, t, f);
  }
  // A stem that names two or more code files cannot be pinned to one JavaScript file by a bare word.
  const stemCount = new Map();
  for (const f of tree.files) {
    if (!isCode(f) || NOT_PROPAGATING.test(f)) continue;
    const stem = base(f).replace(/\.[^.]+$/, '');
    stemCount.set(stem, (stemCount.get(stem) || 0) + 1);
  }
  // Rule 12: a prose basename shared by two or more files (README.md) cannot be pinned by a bare mention.
  const proseCount = new Map();
  for (const f of tree.files) if (/\.(md|txt)$/.test(f)) proseCount.set(base(f), (proseCount.get(base(f)) || 0) + 1);
  const genericProse = new Set([...proseCount].filter(([, n]) => n >= 2).map(([b]) => b));
  const genericStems = new Set([...stemCount].filter(([, n]) => n >= 2).map(([s]) => s));
  const globRefs = []; // {file, dir, ext}
  for (const [f, r] of refs) {
    for (const g of r.globs) {
      // A helper that iterates a whole extensionless directory does not depend on any one file in it.
      if (isSharedTestHelper(f) && !g.ext) continue;
      globRefs.push({ file: f, ...g });
    }
  }
  return { refs, byExt, byBare, bySlashBare, bySeg, byPath, globRefs, genericStems, genericProse };
}

// -> Map(referrer -> 'strong'|'weak')
function referrersOf(graph, p) {
  const out = new Map();
  // A mirror is a byte copy. Match the full path only; the source file's basename is a different seed.
  if (MIRROR.test(p)) {
    for (const f of graph.byPath.get(p) || []) out.set(f, 'weak');
    out.delete(p);
    return out;
  }
  const bareP = base(p).replace(/\.[^.]+$/, '');
  const kind = (f) => (graph.refs.get(f).strong.has(bareP) ? 'strong' : 'weak');
  const b = base(p);
  for (const f of graph.byExt.get(b) || []) {
    // Rule 11: a shared test helper (hooks/tests/lib.sh) naming a prose file (cp README.md ...) serves a few of
    // the suites that source it, not all of them. Prose is a seed only; that mention makes no edge.
    if (/^(md|txt)$/.test(extOf(p)) && isSharedTestHelper(f)) continue;
    // Rule 12: for a prose seed whose basename is shared (README.md, CHANGELOG.md), a bare `README.md` mention is no
    // edge; the referrer must name a path ending in the seed's own path (or the seed's path ends in the mention's).
    if (graph.genericProse.has(b)) {
      const names = graph.refs.get(f).proseNames;
      if (![...names].some((t) => t === p || p.endsWith('/' + t) || t.endsWith('/' + p))) continue;
    }
    out.set(f, kind(f));
  }
  if (isCode(p)) {
    const bare = b.replace(/\.[^.]+$/, '');
    const jsTarget = extOf(p) === 'js' || extOf(p) === 'mjs' || extOf(p) === 'cjs';
    const generic = jsTarget && graph.genericStems.has(bare);
    for (const f of graph.byBare.get(bare) || []) {
      if (out.has(f)) continue;
      const k = kind(f);
      if (generic && k !== 'strong') continue;
      // Rule 13: a bare quoted word with no slash or extension cannot pin a JavaScript file whose stem is one plain
      // lowercase word (residue, status, tree): it is an ordinary word in any text. Hyphenated stems stay.
      if (jsTarget && k !== 'strong' && /^[a-z]+$/.test(bare)) continue;
      out.set(f, k);
    }
    for (const f of graph.bySlashBare.get(bare) || []) if (!out.has(f)) out.set(f, kind(f));
  }
  if (!isCode(p)) {
    // data file: any text naming one of its ancestor directories (except generic top-level ones) refers to it
    const parts = p.split('/').slice(0, -1);
    for (const c of parts) {
      if (GENERIC_DIRS.has(c)) continue;
      if (p.startsWith('docs/') && isProse(p) && PROSE_DIR_SKIP.has(c)) continue;
      for (const f of graph.bySeg.get(c) || []) if (!out.has(f)) out.set(f, 'weak');
    }
  }
  for (const g of graph.globRefs) {
    if (!(g.dir && p.slice(0, Math.max(p.lastIndexOf('/'), 0)) === g.dir && (!g.ext || p.endsWith(g.ext)) && !out.has(g.file))) continue;
    // docs/plans/* names the category, not one plan. A glob with an extension reads content and stays.
    // A glob that also names a specific directory stays. Category names apply only under docs/.
    if (p.startsWith('docs/') && isProse(p) && !g.ext && g.dir.split('/').every((c) => !c || GENERIC_DIRS.has(c) || PROSE_DIR_SKIP.has(c))) continue;
    out.set(g.file, 'weak');
  }
  out.delete(p);
  return out;
}

// Same bounded reverse walk the selector uses. Cost = weak (mere mention) hops; strong
// (require/source) hops are free. One parent per node (first accepted cost wins) — that parent
// is only for chains, not for deciding which seeds were reached.
function walkParents(seeds, graph, maxWeak) {
  const parent = new Map(), cost = new Map();
  let level = [];
  for (const c of seeds) { parent.set(c, null); cost.set(c, 0); level.push(c); }
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
  return parent;
}

// Fewest referrer hops from any changed file, ignoring the weak-cost bound. Used only to order a
// budgeted run; the selector's own chain optimises weak-edge cost and may hide a direct reference.
function shortestHops(seeds, graph) {
  const hops = new Map(seeds.map((c) => [c, 0]));
  const q = seeds.slice();
  while (q.length) {
    const cur = q.shift();
    if (!isCode(cur) && hops.get(cur) !== 0) continue; // same rule as walkParents: only code propagates
    for (const [r] of referrersOf(graph, cur)) {
      if (hops.has(r)) continue;
      hops.set(r, hops.get(cur) + 1);
      q.push(r);
    }
  }
  return hops;
}

function select(changed, headTree, maxWeak = DEFAULT_MAX_WEAK) {
  const fullReasons = changed.filter((p) => FULL_TRIGGERS.some((re) => re.test(p))).map((p) => `unjudgeable change: ${p}`);
  const graph = buildGraph(headTree);
  // Unbounded textual transitivity floods (a hub script naming 40 hooks drags in every suite).
  const parent = walkParents(changed, graph, maxWeak);
  const present = new Set(headTree.files);
  const suites = [...parent.keys()].filter((p) => isSuite(p) && present.has(p)).sort();
  const chains = {};
  for (const s of suites) {
    const chain = [];
    for (let c = s; c != null; c = parent.get(c)) chain.push(c);
    chains[s] = chain;
  }
  // Reach is per seed. The chain above records one parent, so a second seed that shares a
  // referrer is missing from `reached` even when its own walk hits a present suite.
  const reached = new Set(suites.flatMap((s) => chains[s]));
  const unreferenced = [];
  for (const p of changed) {
    if (isProse(p) || MIRROR.test(p)) continue;
    if (isSuite(p) && !present.has(p)) continue; // deleted suite: nothing left to run
    if (reached.has(p)) continue;
    const alone = walkParents([p], graph, maxWeak);
    const hits = [...alone.keys()].some((x) => isSuite(x) && present.has(x));
    if (!hits) unreferenced.push(p);
  }
  for (const p of unreferenced) fullReasons.push(`unreferenced change (no suite reaches it): ${p}`);
  // Content-scanning suites ride along with every selective result that has a non-prose change.
  const alwaysRun = changed.some((p) => !isProse(p)) ? ALWAYS_RUN.map(([f]) => f).filter((f) => present.has(f)) : [];
  for (const f of alwaysRun) if (!chains[f]) chains[f] = [f];
  const all = [...new Set([...suites, ...alwaysRun])].sort();
  Object.defineProperty(chains, '__hops', { value: shortestHops(changed, graph), enumerable: false });
  return { suites: all, alwaysRun, chains, fullReasons, unreferenced, graphFiles: graph.refs.size };
}

function allSuites(tree) { return tree.files.filter(isSuite).sort(); }

// Same invocation run.sh uses for that kind of file: bash for a .sh, node --test for a .test.js.
// argv's last element is the repo-relative path; runEntry substitutes the absolute path.
function entryCommand(rel) {
  if (rel.endsWith('.test.js')) return { cmd: 'node', argv: ['--test', rel] };
  if (rel.endsWith('.sh')) return { cmd: 'bash', argv: [rel] };
  return null;
}

// Process groups of entries currently running with an --entry-timeout (killed on TERM/INT too).
const ACTIVE = new Set();
function killGroup(pid, sig) { try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* gone */ } } }

// Resolves {rc, timedOut}. With timeoutSecs the entry runs in its own process group; on expiry the
// group gets TERM, then KILL 2s later, and rc is 124. Without it the spawn is the plain inherit run.
function runEntry(root, rel, timeoutSecs, group) {
  const spec = entryCommand(rel);
  if (!spec) {
    process.stderr.write(`affected-suites: no runner for ${rel} (run.sh runs .sh with bash and .test.js with node --test)\n`);
    process.stdout.write(`rc=1 ${rel}\n`);
    return Promise.resolve({ rc: 1, timedOut: false });
  }
  const argv = spec.argv.slice();
  argv[argv.length - 1] = path.join(root, rel);
  return new Promise((resolve) => {
    const child = spawn(spec.cmd, argv, { cwd: root, stdio: 'inherit', detached: group || timeoutSecs != null });
    let timedOut = false, killTimer = null, termTimer = null, done = false;
    const grouped = group || timeoutSecs != null;
    if (grouped) ACTIVE.add(child.pid);
    if (timeoutSecs != null) {
      termTimer = setTimeout(() => {
        timedOut = true;
        killGroup(child.pid, 'SIGTERM');
        killTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 2000);
      }, timeoutSecs * 1000);
    }
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(termTimer);
      if (child.pid && grouped) { killGroup(child.pid, 'SIGKILL'); ACTIVE.delete(child.pid); }
      clearTimeout(killTimer);
      const rc = timedOut ? 124 : (code == null ? 1 : code);
      process.stdout.write(`rc=${rc} ${rel}\n`);
      resolve({ rc, timedOut });
    };
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code));
  });
}

// Distance of a suite from the change: 0 = the changed suite itself, n = hops in its chain, Infinity = unknown.
function suiteDistance(doc, rel) {
  if (doc.changed.includes(rel)) return 0;
  const hops = doc.chains && doc.chains.__hops;
  if (hops && hops.has(rel)) return hops.get(rel);
  const chain = doc.chains && doc.chains[rel];
  if (!chain || chain.length < 2) return Infinity;
  return chain.length - 1;
}

// seconds recorded by earlier budgeted runs: Map(path -> seconds), newest record wins.
function loadHistory(root) {
  const m = new Map();
  try {
    let common = git(root, ['rev-parse', '--git-common-dir']).toString('utf8').trim();
    if (!path.isAbsolute(common)) common = path.resolve(root, common);
    const dir = path.join(common, 'autopilot', 'qc-runs');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((x, y) => x.t - y.t);
    for (const { f } of files) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        for (const s of rec.suites || []) if (s && typeof s.path === 'string' && typeof s.seconds === 'number') m.set(s.path, s.seconds);
      } catch { /* an unreadable record is no history */ }
    }
  } catch { /* no git or no records */ }
  return m;
}

function orderForBudget(root, doc, suites) {
  const hist = loadHistory(root);
  const key = (rel) => [suiteDistance(doc, rel), hist.has(rel) ? hist.get(rel) : Infinity];
  return suites.map((rel, i) => ({ rel, i, k: key(rel) })).sort((a, b) => {
    for (let n = 0; n < 2; n++) if (a.k[n] !== b.k[n]) return a.k[n] < b.k[n] ? -1 : 1;
    return a.i - b.i; // incoming order is already by name
  }).map((x) => x.rel);
}

async function runSelected(root, doc, alwaysRun, budget, entryTimeout) {
  if (doc.mode === 'full') {
    for (const reason of doc.full_reasons) process.stdout.write(`${reason}\n`);
    process.stdout.write('whole suite deferred to the pre-merge run (CLAUDE.md Mission graph verification)\n');
  }
  let entries = doc.mode === 'full' ? [...alwaysRun, ...doc.extra_runners] : [...doc.suites, ...doc.extra_runners];
  const budgeted = budget != null;
  if (budgeted) {
    const first = doc.mode === 'full' ? alwaysRun : doc.suites;
    entries = [...orderForBudget(root, doc, first), ...doc.extra_runners];
  }
  const results = [];
  const skipped = [];
  let failed = 0;
  const timedOut = [];
  let emptyFail = false;
  const started = Date.now();
  for (const rel of entries) {
    if (budgeted && (Date.now() - started) / 1000 >= budget) { skipped.push(rel); continue; }
    const t0 = Date.now();
    const { rc, timedOut: to } = await runEntry(root, rel, entryTimeout);
    if (to) timedOut.push(rel);
    results.push(budgeted ? { path: rel, rc, seconds: Math.round(Date.now() - t0) / 1000 } : { path: rel, rc });
    if (rc !== 0) failed++;
  }
  if (doc.mode === 'selective' && doc.suites.length === 0 && !doc.changed.every(isProse)) {
    process.stdout.write('empty suites is not a pass: not every changed file is documentation\n');
    failed++;
    emptyFail = true;
  }
  process.stdout.write(`summary: ${results.length} run, ${failed} failed${timedOut.length ? ` (timeout: ${timedOut.join(' ')})` : ''}\n`);
  let code = failed === 0 ? 0 : 1;
  let budgetDoc = null;
  if (budgeted) {
    for (const rel of skipped) process.stdout.write(`not run (budget): ${rel}\n`);
    process.stdout.write(`skipped_for_budget: ${skipped.length}\n`);
    if (code === 0 && skipped.length > 0) code = 3;
    budgetDoc = { budget, executed: results.map((x) => x.path), skipped_for_budget: skipped };
  }
  return { code, results, budgetDoc, emptyFail };
}

// --attribute: re-run only the non-zero entries at the base commit in a temporary detached worktree
// (always removed, also on TERM/INT), then label each preexisting (non-zero at base, finished normally), new, or unattributed (base timed out or exited 124,
// which may be a timeout inside the suite; fail-closed, never washed into preexisting).
function removeWorktree(root, tmp, wt) {
  try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root, stdio: 'ignore' }); } catch { /* fall through to rm */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  try { execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'ignore' }); } catch { /* best effort */ }
}

// Installed once per process (main, when --entry-timeout is set): entries run detached, so an outer
// TERM/INT would otherwise leave their process groups behind. `cleanup` is the attribute worktree removal.
let SIG_CLEANUP = null;
let SIG_INSTALLED = false;
function installSignalKill() {
  SIG_INSTALLED = true;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      for (const pid of ACTIVE) killGroup(pid, 'SIGKILL');
      if (SIG_CLEANUP) { try { SIG_CLEANUP(); } catch { /* best effort */ } }
      process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  }
}

async function attribute(root, baseSha, results, entryTimeout) {
  const failing = results.filter((r) => r.rc !== 0);
  const groups = { preexisting: [], new: [], unattributed: [] };
  if (failing.length === 0) return groups;
  let tmp = null;
  let wt = null;
  if (!SIG_INSTALLED) installSignalKill();
  SIG_CLEANUP = () => { if (tmp) removeWorktree(root, tmp, wt); };
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-suites-base-'));
    wt = path.join(tmp, 'base');
    execFileSync('git', ['worktree', 'add', '--detach', wt, baseSha], { cwd: root, stdio: 'pipe' });
    for (const r of failing) {
      if (!fs.existsSync(path.join(wt, r.path))) { groups.new.push(r.path); continue; } // absent at base: cannot be preexisting
      const { rc, timedOut: to } = await runEntry(wt, r.path, entryTimeout, true);
      r.base_rc = rc;
      // Only a base run that finished normally and was non-zero is evidence of a preexisting failure;
      // a base run killed by the entry timeout, or exiting 124 (possibly the suite's own timeout), proves nothing.
      if (to || rc === 124) groups.unattributed.push(r.path);
      else (rc !== 0 ? groups.preexisting : groups.new).push(r.path);
    }
  } finally {
    SIG_CLEANUP = null;
    if (tmp) removeWorktree(root, tmp, wt);
  }
  return groups;
}

// The document main prints for `--base <base> [--head <head>]` (head defaults to HEAD).
// `runAlways` is the always-run list a full-mode --run still executes; it is not part of the document.
function computeDoc(root, base, head) {
  const headRef = head || 'HEAD';
  const tree = gitTree(root, headRef);
  const changed = git(root, ['diff', '--name-only', '--no-renames', '-z', base, headRef]).toString('utf8').split('\0').filter(Boolean);
  const r = select(changed, tree, DEFAULT_MAX_WEAK);
  const full = r.fullReasons.length > 0;
  const doc = {
    schema: 1, mode: full ? 'full' : 'selective', base, head: headRef, changed: changed.slice().sort(),
    suites: full ? [] : r.suites, always_run: full ? [] : r.alwaysRun, extra_runners: extraRunners(changed), full_reasons: r.fullReasons, unreferenced: r.unreferenced,
    chains: full ? {} : r.chains, stats: { changed: changed.length, selected: full ? null : r.suites.length, total_suites: allSuites(tree).length, graph_files: r.graphFiles },
  };
  Object.defineProperty(doc, 'runAlways', { value: r.alwaysRun, enumerable: false });
  return doc;
}

function fullRef(root, ref) {
  return git(root, ['rev-parse', ref]).toString('utf8').trim();
}

function recordPathFor(root, given, headSha) {
  if (given) return path.resolve(given);
  let common = git(root, ['rev-parse', '--git-common-dir']).toString('utf8').trim();
  if (!path.isAbsolute(common)) common = path.resolve(root, common);
  return path.join(common, 'autopilot', 'qc-runs', `${headSha}.json`);
}

function writeRecord(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj) + '\n');
  fs.renameSync(tmp, file);
}

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
    else if (x === '--run') a.run = true;
    else if (x === '--budget-seconds') {
      const v = argv[++i];
      a.budget = v !== undefined && v.trim() !== '' ? Number(v) : NaN;
      if (!(a.budget > 0) || !Number.isFinite(a.budget)) throw new Error(`--budget-seconds needs a positive number, got ${JSON.stringify(v)}`);
    }
    else if (x === '--attribute') a.attribute = true;
    else if (x === '--entry-timeout') {
      const v = argv[++i];
      a.entryTimeout = v !== undefined && v.trim() !== '' ? Number(v) : NaN;
      if (!(a.entryTimeout > 0) || !Number.isFinite(a.entryTimeout)) throw new Error(`--entry-timeout needs a positive number, got ${JSON.stringify(v)}`);
    }
    else if (x === '--record') {
      a.record = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) a.recordPath = argv[++i];
    }
    else if (x === '--files') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) a.files.push(argv[++i]); a.useFiles = true; }
    else if (x === '--help' || x === '-h') a.help = true;
    else throw new Error(`unknown argument: ${x}`);
  }
  return a;
}

async function main(argv) {
  let a;
  try { a = parseArgs(argv); } catch (e) { process.stderr.write(e.message + '\n'); return 2; }
  if (a.help) {
    const lines = fs.readFileSync(__filename, 'utf8').split('\n');
    const end = lines.findIndex((l, i) => i > 2 && l.startsWith('// Exit:'));
    process.stdout.write(lines.slice(2, end + 1).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    return 0;
  }
  if (a.budget != null && !a.run) {
    process.stderr.write('affected-suites: --budget-seconds requires --run\n');
    return 2;
  }
  if (a.attribute && (!a.run || !a.base || a.useFiles)) {
    process.stderr.write('affected-suites: --attribute requires --run and --base\n');
    return 2;
  }
  if (a.entryTimeout != null && !a.run) {
    process.stderr.write('affected-suites: --entry-timeout requires --run\n');
    return 2;
  }
  if (a.record && !a.run) {
    process.stderr.write('affected-suites: --record requires --run\n');
    return 2;
  }
  if (a.record && a.useFiles) {
    process.stderr.write('affected-suites: --record needs a head ref (--base [--head]); --files has none\n');
    return 2;
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
      baseRef = a.base;
    }
    if (a.listAll) { process.stdout.write(allSuites(tree).join('\n') + '\n'); return 0; }
    let doc;
    let runAlways;
    if (!a.useFiles && !a.listAll) {
      doc = computeDoc(root, a.base, a.head || null);
      if (a.maxWeak != null) {
        tree = gitTree(root, doc.head);
        changed = doc.changed;
        const r = select(changed, tree, a.maxWeak);
        const full = r.fullReasons.length > 0;
        doc = {
          schema: 1, mode: full ? 'full' : 'selective', base: baseRef, head: headRef, changed: changed.slice().sort(),
          suites: full ? [] : r.suites, always_run: full ? [] : r.alwaysRun, extra_runners: extraRunners(changed), full_reasons: r.fullReasons, unreferenced: r.unreferenced,
          chains: full ? {} : r.chains, stats: { changed: changed.length, selected: full ? null : r.suites.length, total_suites: allSuites(tree).length, graph_files: r.graphFiles },
        };
        runAlways = r.alwaysRun;
      } else {
        runAlways = doc.runAlways;
      }
    } else {
      const r = select(changed, tree, a.maxWeak == null ? DEFAULT_MAX_WEAK : a.maxWeak);
      const full = r.fullReasons.length > 0;
      doc = {
        schema: 1, mode: full ? 'full' : 'selective', base: baseRef, head: headRef, changed: changed.slice().sort(),
        suites: full ? [] : r.suites, always_run: full ? [] : r.alwaysRun, extra_runners: extraRunners(changed), full_reasons: r.fullReasons, unreferenced: r.unreferenced,
        chains: full ? {} : r.chains, stats: { changed: changed.length, selected: full ? null : r.suites.length, total_suites: allSuites(tree).length, graph_files: r.graphFiles },
      };
      runAlways = r.alwaysRun;
    }
    if (a.run) {
      if (a.entryTimeout != null && !SIG_INSTALLED) installSignalKill();
      const ran = await runSelected(root, doc, doc.mode === 'full' ? runAlways : doc.always_run, a.budget, a.entryTimeout);
      let attrCode = null;
      if (a.attribute) {
        const baseSha = fullRef(root, baseRef);
        const g = await attribute(root, baseSha, ran.results, a.entryTimeout);
        process.stdout.write(`attribution: preexisting ${g.preexisting.length}${g.preexisting.length ? ': ' + g.preexisting.join(' ') : ''}\n`);
        process.stdout.write(`attribution: new ${g.new.length}${g.new.length ? ': ' + g.new.join(' ') : ''}\n`);
        process.stdout.write(`attribution: unattributed ${g.unattributed.length}${g.unattributed.length ? ': ' + g.unattributed.join(' ') : ''}\n`);
        const budgetStop = ran.code === 3 || (ran.budgetDoc != null && ran.budgetDoc.skipped_for_budget.length > 0);
        attrCode = g.new.length > 0 || g.unattributed.length > 0 || ran.emptyFail ? 1 : (budgetStop ? 3 : 0);
      }
      if (a.json && ran.budgetDoc) process.stdout.write(JSON.stringify(ran.budgetDoc, null, 2) + '\n');
      if (a.record) {
        try {
          const headSha = fullRef(root, headRef);
          const baseSha = fullRef(root, baseRef);
          const file = recordPathFor(root, a.recordPath, headSha);
          writeRecord(file, { schema: 1, head: headSha, base: baseSha, mode: doc.mode, suites: ran.results, ...(ran.budgetDoc || {}) });
          process.stdout.write(`record: ${file}\n`);
        } catch (e) {
          process.stderr.write(`affected-suites: record write failed: ${e.message}\n`);
          return 2;
        }
      }
      return attrCode != null ? attrCode : ran.code;
    }
    const extra = doc.extra_runners.map((x) => x + '\n').join('');
    const full = doc.mode === 'full';
    process.stdout.write(a.json ? JSON.stringify(doc, null, 2) + '\n' : (full ? 'FULL\n' : doc.suites.join('\n') + (doc.suites.length ? '\n' : '')) + extra);
    return 0;
  } catch (e) {
    process.stderr.write(`affected-suites: ${e.message}\n`);
    return 2;
  }
}

module.exports = { extraRunners, select, mentions, buildGraph, isSuite, isProse, entryCommand, computeDoc, FULL_TRIGGERS, gitTree, diskTree };
if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
