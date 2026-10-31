#!/usr/bin/env node
'use strict';
// affected-suites.js — select the test files a diff can affect (BL-0001: the quality gate's test step runs it first).
//
// Usage:
//   node scripts/affected-suites.js --base <ref> [--head <ref>] [--json] [--run] [--record [path]]
//     [--entry-timeout <secs>] [--attribute] [--jobs <N>]
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
//   suites:[{path, rc, seconds}, ...]} — one object per entry actually executed, in execution order
//   (suites then extra_runners when selective; always_run then extra_runners when full). rc is
//   the integer already printed as rc=N; seconds is that entry's wall time (BL-0330, additive: the
//   `rc=N <path>` output line is unchanged). A --jobs pool failure that passed its serial rerun also
//   carries `flaky_under_parallel: true`.
//
// Durations (BL-0330): every --run also merges each entry's whole-second wall time into the file
// run.sh --parallel uses, ${AUTOPILOT_TEST_DURATIONS_FILE:-${XDG_CACHE_HOME:-~/.cache}/autopilot/test-durations.tsv}
// (rel<TAB>seconds; timed-out entries are not written). For a --root other than this script's own repo it
// is written only when AUTOPILOT_TEST_DURATIONS_FILE is set, so a fixture never pollutes the shared file.
//
// --jobs <N> (BL-0331; only with --run; default 1 = the serial run above, output byte-for-byte unchanged;
// N>1 cannot be combined with --budget-seconds): suites not listed in hooks/tests/lib/serial-suites.txt (the
// single source run.sh also reads) go through a pool of N workers, slowest first by the durations file
// (no record = first, then name order); once the pool is empty the listed suites run one at a time, then
// extra_runners. Every entry, and every rerun, gets a NEW short TMPDIR (mkdtemp /tmp/asj.XXXXXX, 0700, fixed length whatever the entry count; all removed at the end); pool entries also get a private XDG_RUNTIME_DIR under a per-run 0700
// base under the caller's XDG_RUNTIME_DIR (else $HOME/.cache/autopilot-asj) whose ancestors are all non-group/world-writable and are checked before anything is created
// (none usable = not isolated, one stderr line). The serial part (listed suites, reruns, extra_runners) keeps the
// caller's XDG_RUNTIME_DIR, like a direct run (a per-entry one breaks dispatch-detach's no-setsid tuple lease). Path
// length and the other reasons: see the comment above jobEnv. When a --jobs entry finishes its process group gets
// SIGKILL and is then polled (20 ms steps, up to 5 s, AFFECTED_SUITES_GROUP_WAIT_MS) until it is gone (ESRCH; EPERM
// counts as gone); a group still alive then gets a stderr line, the entry's rc becomes 1 if it was 0 (a survivor can
// corrupt the next entry, so it must not pass silently) and the record row carries `lingering_group: true`. A process
// that left the group with setsid is outside any group and is NOT tracked (an escape, not a failure).
// AUTOPILOT_TEST_TIMING_FACTOR defaults to N for pool entries and 1 for the serial part (a value already in the environment wins). Output is buffered per
// entry and printed whole, followed by its `rc=N <path>`; the summary line is unchanged and a
// `slowest: <path> <s>s, ...` line (top 10) is printed last, after any `attribution:` and `record:` lines
// (so a consumer that reads the summary-then-record sequence sees the same order as without --jobs).
// A pool entry that exits non-zero is re-run once, alone, after the pool drains: rc 0 prints
// `flaky-under-parallel: <path> (rc=<pool rc> in pool)` (`(timeout in pool)` when the pool run was killed by
// --entry-timeout) then `rc=0 <path>` and counts green; its record entry has `flaky_under_parallel: true`,
// `pool_rc` and, for a pool timeout, `pool_timed_out: true`. A second non-zero makes the RERUN final: its output,
// rc (124 when it timed out, listed in the summary's timeout list), record entry and --attribute input; the pool rc
// is not shown. Works with --entry-timeout, --attribute and --record.
// Captured output: when an entry's process exits, its pipes get a 300 ms grace to drain; output a background
// grandchild writes later than that is cut off (the entry's group is then killed). Durations writes are
// serialised between affected-suites instances by <tsv>.lock (10 s cap, then a warning and no write); run.sh
// --parallel writes the same file with an atomic rename but does not take that lock.
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
//      function, not every suite that sources the helper. Its callers (setup_sync_version_sandbox: the sync-version-*
//      and semver suites) are still reached through scripts/sync-version.js naming README.md.
//  12. A "$VAR/name" path (a variable expansion directly before the slash, name closed by a quote or token end,
//      "$TEST_TMP/session-mode") is a directory under a runtime root, not a mention of name.js: no slash-bare edge.
//  13. Lazy require marker (BL-0332): a JavaScript line carrying `// affected-suites: lazy` declares that its
//      require() sits behind a gate that does not open under test (an env switch, a CLI branch no suite takes).
//      The specifier on that line is blanked before the mention scan: no strong edge and no bare-name edge from
//      that file. A suite that names the target itself still reaches it by its own mention. Chosen over "every
//      indented require is lazy": 192 indented requires exist, most always run when their function runs, and a weak
//      edge still lets the strong edges behind it flood (tried: 678 -> 658); only a human who has checked the gate
//      can say it stays closed under test, so the claim is explicit and greppable.
//      Conditions of use: only on a require() behind a gate that is certain NOT to run under test; re-check every
//      marker when that gate's meaning changes; list them all with `git grep 'affected-suites: lazy'`.
//      The marker and the whole `require('./x')` call must be on ONE line: a require split over lines, or a marker
//      on the line above, is not recognised and the edge stays strong (the safe direction; nothing is dropped).
// Contract/evidence: skills/quality-pipeline/references/test-policy.md, docs/plans/evidence/2026-10-13-affected-suites/miss-check.md.

const { execFileSync, spawnSync, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
// Paths come from the layout registry (scripts/lib/repo-layout.js), never from literals here.
const LAYOUT = require('./lib/repo-layout.js');
const HOOKS_DIR = LAYOUT.path('hooks_dir');
const HOOKS_JSON = LAYOUT.path('hooks_json');
const HOOK_TESTS_DIR = LAYOUT.path('hook_tests_dir');
const SUITE_RUNNER = LAYOUT.path('suite_runner');
const SERIAL_SUITES = LAYOUT.path('serial_suites');
const SCRIPTS_LIB_DIR = LAYOUT.path('scripts_lib_dir');
const EVALS_DIR = LAYOUT.path('evals_dir');
const PACK_MANIFEST = LAYOUT.path('skill_onoff_pack_manifest');
const SCRIPTS_DIR = LAYOUT.path('scripts_dir');
const DOCS_DIR = LAYOUT.path('docs_dir');
const CLAUDE_DIR = LAYOUT.path('claude_dir');
const PLANS_DIR = LAYOUT.path('plans_dir');
const PLANS_EVIDENCE_DIR = LAYOUT.path('plans_evidence_dir');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
const SUITE_IN_SCRIPTS_RE = new RegExp(`^${reEsc(SCRIPTS_DIR)}/[^/]+\\.test\\.(js|sh)$`);

const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'sh', 'bash', 'zsh', 'py', 'ps1']);
const DEFAULT_MAX_WEAK = 2;
const MAX_BYTES = 1024 * 1024;

// Changes the static graph cannot judge: they alter how every hook / test / release is wired.
const FULL_TRIGGERS = [
  new RegExp(`^${reEsc(HOOKS_JSON)}$`),
  new RegExp(`^${reEsc(SUITE_RUNNER)}$`),
  /^package(-lock)?\.json$/,
  /^\.claude-plugin\//,
  /^\.github\//,
  /^\.githooks\//,
  new RegExp(`^${reEsc(CLAUDE_DIR)}/quality-gate-config\\.md$`),
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
  [`${HOOK_TESTS_DIR}/resolve-review-loop-consult-discuss-switch.test.sh`, 'Population B scans every file under hooks/ for reviewer_engine lines'],
  [`${HOOK_TESTS_DIR}/check-js-syntax.test.sh`, 'syntax-checks every tracked JS file'],
  [`${HOOK_TESTS_DIR}/codex-plugin-package.test.sh`, 'codex mirror must equal its sources (source edit without mirror sync, or mirror-only edit)'],
  [`${HOOK_TESTS_DIR}/test-identity-guard.test.sh`, 'scans every *.test.sh for git identity writes'],
  [`${HOOK_TESTS_DIR}/test-suite-finalize-gate.test.sh`, 'scans every *.test.sh for the finalize counter'],
  [`${HOOK_TESTS_DIR}/check-test-integrity.test.sh`, 'real config must match every real suite file'],
  [`${HOOK_TESTS_DIR}/check-tmp-residue-registry.test.sh`, 'scans the git index for tmp residue'],
  [`${HOOK_TESTS_DIR}/check-claude-md-inventory.test.sh`, 'every shipped script must be named in CLAUDE.md'],
  [`${HOOK_TESTS_DIR}/check-hook-inventory.test.sh`, 'hook files vs hooks.json vs docs'],
  [`${HOOK_TESTS_DIR}/check-canonical-invariants.test.sh`, 'cross-file invariants over the real tree'],
  [`${HOOK_TESTS_DIR}/p6d-gates-repair-ladder.test.sh`, 'grep -rln repair_lock over all of src/'],
  [`${HOOK_TESTS_DIR}/qualify-scorecard-vocabulary.test.sh`, 'grep -rl a model-id charset over scripts/ and src/'],
  [`${HOOK_TESTS_DIR}/skill-onoff-stage-graph.test.sh`, 'greps all of scripts/ for the probe ladder field (only probe-unknown.js may print it)'],
  [`${HOOK_TESTS_DIR}/skill-count-metadata.test.sh`, 'counts the skills/ directories against the documented count (a new skill dir changes it)'],
  [`${HOOK_TESTS_DIR}/qualify-recipe-credential-staging.test.sh`, `greps every ${PLANS_EVIDENCE_DIR}/*/administration/*/run.sh for staging variables`],
];
// A repo file that an evaluation pack copies (pack manifest entry `<pack id>/<relative path>`) is compared against the
// repo by the pack's content suite, and no source reference shows it. [pack id regex, suite]
const PACK_CONTENT_SUITES = [[/bpack/, `${HOOK_TESTS_DIR}/bpack-content.test.sh`]];
// -> Map(content suite -> changed files) for the changed files that some pack's manifest entry copies.
function packContentSuites(changed, headTree) {
  const out = new Map();
  let man;
  try { man = JSON.parse(headTree.read(PACK_MANIFEST)).packs; } catch { return out; }
  if (!man || typeof man !== 'object') return out;
  for (const [id, files] of Object.entries(man)) {
    const hit = PACK_CONTENT_SUITES.find(([re]) => re.test(id));
    if (!hit || !files || typeof files !== 'object') continue;
    for (const entry of Object.keys(files)) {
      if (!entry.startsWith(id + '/')) continue;
      const rel = entry.slice(id.length + 1);
      // A skill pack is `<skill>-...` holding that skill's own relative paths; other packs hold repo paths whole.
      for (const p of changed) {
        if (p === rel || (p.startsWith('skills/') && id.startsWith(p.split('/')[1] + '-') && p === `skills/${p.split('/')[1]}/${rel}`)) {
          if (!out.has(hit[1])) out.set(hit[1], new Set());
          out.get(hit[1]).add(p);
        }
      }
    }
  }
  return out;
}
// Prose cannot break a suite; mirrors are covered by the always-run codex-plugin-package suite.
const PURE_DOC = new RegExp(`^(${reEsc(DOCS_DIR)}|website|skill-creator-workspace)\\/|^[^/]+\\.(md|txt)$`);
const MIRROR = /^platforms\//;
// A script under docs/ is code, not prose (a suite may scan it).
const isProse = (p) => PURE_DOC.test(p) && !isCode(p);

const SUITE_RES = [
  new RegExp(`^${reEsc(HOOKS_DIR)}/[^/]+\\.test\\.js$`),
  new RegExp(`^${reEsc(SCRIPTS_LIB_DIR)}/[^/]+\\.test\\.js$`),
  new RegExp(`^${reEsc(HOOK_TESTS_DIR)}/[^/]+\\.test\\.sh$`),
];
function isSuite(p) {
  return SUITE_RES.some((re) => re.test(p)) || SUITE_IN_SCRIPTS_RE.test(p);
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
    read(p) {
      if (!cache) load();
      if (cache.has(p)) return cache.get(p);
      // Only code files are batch-loaded; a single data file (the pack manifest) is read on demand.
      if (!blobs.has(p) || isCode(p)) return null;
      try { const b = git(root, ['cat-file', 'blob', blobs.get(p)]); return b.length <= MAX_BYTES ? b.toString('utf8') : null; } catch { return null; }
    },
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
function mentions(text) {
  const exts = new Set(), bares = new Set(), slashBares = new Set(), globs = [], strong = new Set(), segs = new Set(), paths = new Set();
  for (const m of text.matchAll(RE_SEG)) segs.add(m[1]);
  for (const m of text.matchAll(RE_REQ)) if (/^[.\/]/.test(m[1])) strong.add(base(m[1]).replace(/\.(js|mjs|cjs|json)$/, ''));
  for (const m of text.matchAll(RE_SRC)) strong.add(base(m[1]).replace(/\.(sh|bash|zsh)$/, ''));
  for (const m of text.matchAll(RE_EXT)) exts.add(m[0]);
  for (const m of text.matchAll(RE_BARE)) {
    if (m[0].startsWith('/')) {
      if (VAR_DIR_BEFORE.test(text.slice(Math.max(0, m.index - 80), m.index))) continue;
      slashBares.add(m[1]);
    } else bares.add(m[1]);
  }
  for (const m of text.matchAll(RE_GLOB)) globs.push({ dir: globDir(m[1]), ext: m[2] || '' });
  for (const m of text.matchAll(RE_MIRROR_PATH)) paths.add(m[0]);
  return { exts, bares, slashBares, globs, strong, segs, paths };
}

const GENERIC_DIRS = new Set(['fixtures', 'fixture', 'golden', 'data', 'lib', 'tests', 'scripts', 'hooks', 'src', 'bin', 'docs', 'evals', 'platforms', 'skills', 'agents', 'references', 'schemas', 'profiles', 'mods', 'plugin', 'codex', 'node_modules',
  // the registry's own top-level directory names, so a moved docs/scripts/hooks/evals tree stays generic
  ...[CLAUDE_DIR, DOCS_DIR, SCRIPTS_DIR, HOOKS_DIR, EVALS_DIR].map((d) => d.split('/')[0])]);
// Category folders under docs/. Skipped only for a prose seed; other data files keep GENERIC_DIRS alone.
const PROSE_DIR_SKIP = new Set([path.posix.basename(PLANS_DIR), path.posix.basename(PLANS_EVIDENCE_DIR), 'backlog', 'projects', 'adr']);
// A non-suite .sh directly under hooks/tests/: shared helper, not a suite.
const isSharedTestHelper = (p) => new RegExp(`^${reEsc(HOOK_TESTS_DIR)}/[^/]+\\.sh$`).test(p) && !isSuite(p);
// Mirrors, eval fixtures and docs are copies or prose: they never propagate a change to a suite.
const NOT_PROPAGATING = new RegExp(`^(platforms|${reEsc(EVALS_DIR)}|${reEsc(DOCS_DIR)}|website|skill-creator-workspace|\\.opencode)/`);
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
  const genericStems = new Set([...stemCount].filter(([, n]) => n >= 2).map(([s]) => s));
  const globRefs = []; // {file, dir, ext}
  for (const [f, r] of refs) {
    for (const g of r.globs) {
      // A helper that iterates a whole extensionless directory does not depend on any one file in it.
      if (isSharedTestHelper(f) && !g.ext) continue;
      globRefs.push({ file: f, ...g });
    }
  }
  return { refs, byExt, byBare, bySlashBare, bySeg, byPath, globRefs, genericStems };
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
      out.set(f, k);
    }
    for (const f of graph.bySlashBare.get(bare) || []) if (!out.has(f)) out.set(f, kind(f));
  }
  if (!isCode(p)) {
    // data file: any text naming one of its ancestor directories (except generic top-level ones) refers to it
    const parts = p.split('/').slice(0, -1);
    for (const c of parts) {
      if (GENERIC_DIRS.has(c)) continue;
      if (p.startsWith(`${DOCS_DIR}/`) && isProse(p) && PROSE_DIR_SKIP.has(c)) continue;
      for (const f of graph.bySeg.get(c) || []) if (!out.has(f)) out.set(f, 'weak');
    }
  }
  for (const g of graph.globRefs) {
    if (!(g.dir && p.slice(0, Math.max(p.lastIndexOf('/'), 0)) === g.dir && (!g.ext || p.endsWith(g.ext)) && !out.has(g.file))) continue;
    // docs/plans/* names the category, not one plan. A glob with an extension reads content and stays.
    // A glob that also names a specific directory stays. Category names apply only under docs/.
    if (p.startsWith(`${DOCS_DIR}/`) && isProse(p) && !g.ext && g.dir.split('/').every((c) => !c || GENERIC_DIRS.has(c) || PROSE_DIR_SKIP.has(c))) continue;
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
  const packed = packContentSuites(changed, headTree);
  const packedFiles = new Set([...packed].filter(([f]) => present.has(f)).flatMap(([, ps]) => [...ps]));
  for (const p of changed) {
    if (isProse(p) || MIRROR.test(p)) continue;
    if (packedFiles.has(p)) continue; // a pack content suite checks this file

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
  const packSuites = [...packed.keys()].filter((f) => present.has(f));
  for (const f of packSuites) if (!chains[f]) chains[f] = [f];
  const all = [...new Set([...suites, ...alwaysRun, ...packSuites])].sort();
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
// Signals the group only. No fallback to the positive pid: once the leader is gone its pid may belong to someone else.
function killGroup(pid, sig) { try { process.kill(-pid, sig); } catch { /* ESRCH: the group is already gone */ } }

// How long a --jobs entry's process group may outlive the entry after SIGKILL (AFFECTED_SUITES_GROUP_WAIT_MS, default 5000).
function groupWaitMs() { const n = Number(process.env.AFFECTED_SUITES_GROUP_WAIT_MS); return Number.isFinite(n) && n >= 0 && process.env.AFFECTED_SUITES_GROUP_WAIT_MS !== undefined ? n : 5000; }

// Resolves {rc, timedOut}. With timeoutSecs the entry runs in its own process group; on expiry the
// group gets TERM, then KILL 2s later, and rc is 124. Without it the spawn is the plain inherit run.
function runEntry(root, rel, timeoutSecs, group, opts) {
  const capture = !!(opts && opts.capture); // --jobs: buffer output, the caller prints it with the rc line
  const env = opts && opts.env ? opts.env : undefined;
  const spec = entryCommand(rel);
  if (!spec) {
    const msg = `affected-suites: no runner for ${rel} (run.sh runs .sh with bash and .test.js with node --test)\n`;
    if (capture) return Promise.resolve({ rc: 1, timedOut: false, chunks: [['err', msg]] });
    process.stderr.write(msg);
    process.stdout.write(`rc=1 ${rel}\n`);
    return Promise.resolve({ rc: 1, timedOut: false });
  }
  const argv = spec.argv.slice();
  argv[argv.length - 1] = path.join(root, rel);
  return new Promise((resolve) => {
    const child = spawn(spec.cmd, argv, { cwd: root, env, stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit', detached: group || timeoutSecs != null });
    const chunks = [];
    if (capture) {
      child.stdout.on('data', (d) => chunks.push(['out', d]));
      child.stderr.on('data', (d) => chunks.push(['err', d]));
    }
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
      clearTimeout(killTimer);
      const pid = child.pid;
      if (pid && grouped) killGroup(pid, 'SIGKILL');
      const settle = (lingering) => {
        if (pid && grouped) ACTIVE.delete(pid);
        let rc = timedOut ? 124 : (code == null ? 1 : code);
        if (lingering) {
          process.stderr.write(`affected-suites: ${rel}: process group ${pid} still alive ${groupWaitMs()} ms after SIGKILL; entry marked failed\n`);
          if (rc === 0) rc = 1;
        }
        if (!capture) process.stdout.write(`rc=${rc} ${rel}\n`);
        resolve({ rc, timedOut, chunks, lingering: !!lingering });
      };
      // --jobs only (opts.confirmGroup): wait, bounded, until the group is gone (ESRCH; EPERM = no longer ours = gone).
      // The pid is seconds old here, so it cannot have been recycled into someone else's group.
      if (pid && grouped && opts && opts.confirmGroup) {
        const t0 = Date.now();
        const poll = () => {
          let alive = true;
          try { process.kill(-pid, 0); } catch { alive = false; }
          if (!alive) settle(false);
          else if (Date.now() - t0 >= groupWaitMs()) settle(true);
          else setTimeout(poll, 20);
        };
        poll();
      } else settle(false);
    };
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code));
    // A suite that leaves a background process holding the pipe open would keep 'close' from firing.
    if (capture) child.on('exit', (code) => setTimeout(() => finish(code), 300));
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

// ---- --jobs N (BL-0331) ----

// hooks/tests/lib/serial-suites.txt: one repo-relative path per line, # comments. Missing file = no serial suites.
function loadSerialSuites(root) {
  const set = new Set();
  try {
    for (const line of fs.readFileSync(path.join(root, SERIAL_SUITES), 'utf8').split('\n')) {
      const t = line.replace(/#.*/, '').trim();
      if (t) set.add(t);
    }
  } catch { /* no list */ }
  return set;
}

// The durations file run.sh --parallel reads and writes: rel<TAB>integer seconds.
function durationsFile() {
  return process.env.AUTOPILOT_TEST_DURATIONS_FILE || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'autopilot', 'test-durations.tsv');
}
function readDurations(file) {
  const m = new Map();
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const [rel, secs] = line.split('\t');
      if (rel && /^[0-9]+$/.test(secs || '')) m.set(rel, Number(secs));
    }
  } catch { /* no file = no history */ }
  return m;
}
// Only the real repo (or an explicit AUTOPILOT_TEST_DURATIONS_FILE) feeds the shared history: a fixture --root must not write fixture paths into ~/.cache.
function durationsApply(root) {
  return !!process.env.AUTOPILOT_TEST_DURATIONS_FILE || path.resolve(root) === path.resolve(__dirname, '..');
}
// The read-merge-rename below runs under the pid-lock helper scripts/lib/jsonl-store.js (<file>.lock), so concurrent
// affected-suites runs keep each other's rows. run.sh --parallel writes the same file with its own atomic rename and no
// lock (a shell writer cannot take this pid-lock): it is not mutually excluded, only affected-suites instances are.
// A lock not obtained within 10 s skips the write with one warning on stderr; the run itself is never held up.
const lockedRun = (opts, fn) => require('./lib/jsonl-store.js').withWriteLock(opts, fn);
function recordDurations(root, results, timedOutPaths) {
  if (!durationsApply(root)) return;
  try {
    const file = durationsFile();
    lockedRun({ storeDir: path.dirname(file), lockFile: `${file}.lock`, name: 'durations', timeoutMs: 10000 }, () => {
      const merged = readDurations(file);
      for (const r of results) if (!timedOutPaths.includes(r.path) && typeof r.seconds === 'number') merged.set(r.path, Math.round(r.seconds));
      const tmp = `${file}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, [...merged.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([k, v]) => `${k}\t${v}\n`).join(''));
      fs.renameSync(tmp, file);
    });
  } catch (e) { process.stderr.write(`affected-suites: durations not recorded: ${e.message}\n`); }
}

const JOB_TMPS = new Set();
function emitChunks(chunks) {
  for (const [kind, d] of chunks || []) (kind === 'err' ? process.stderr : process.stdout).write(d);
}

// Per-entry env: every call (pool run or rerun) makes its own fresh directories with mkdtemp, so a name never depends
// on how many entries ran before (a counter in the path once pushed engine-qualify-a's socket past sun_path at entry 1000).
// - TMPDIR is <tmpParent>/asj.XXXXXX = /tmp/asj.XXXXXX, 15 characters, 0700, new each time. Suites build unix socket
//   paths under $TMPDIR (engine-qualify-a's case broker); Linux sun_path is 108 bytes of path. Measured with the real
//   suite: its socket path is TMPDIR plus 89 characters, so TMPDIR may be at most 19 characters (a 19-character one
//   passes, 20 gives 109 bytes and EINVAL). 15 leaves 4 characters. tmpParent is os.tmpdir() only when that is at most
//   5 characters ("/tmp"); a longer one falls back to /tmp with a stderr line, and when /tmp is not writable the long
//   one is kept with a stderr warning.
// - The private XDG_RUNTIME_DIR of a pool entry is <xdgBase>/asj.XXXXXX (also mkdtemp, fixed length). xdgBase is a
//   per-run 0700 directory asj.XXXXXX, tried in this order: (a) under the caller's absolute XDG_RUNTIME_DIR, (b) only if
//   (a) is unusable, under $HOME/.cache/autopilot-asj. Ancestors are checked BEFORE anything is created (an unsafe place
//   gets no directory); every ancestor must be owned by us or root and not group/world writable, except a root-owned
//   sticky directory such as /tmp (1777), where others cannot rename or delete what we create. Note external-lifecycle-witness is stricter and refuses even
//   a sticky /tmp ancestor: with the pool XDG under /tmp it fails in the pool and passes its serial rerun (labelled
//   flaky), so prefer a caller XDG_RUNTIME_DIR or a HOME outside /tmp. None
//   usable = pool entries keep the caller's value and one stderr line says the pool is not isolated.
// - Serial entries and reruns keep the caller's XDG_RUNTIME_DIR, like a direct `bash hooks/tests/x.test.sh`
//   (dispatch-detach's no-setsid tuple lease fails with a per-entry one; nothing runs beside a serial entry).
// Every directory made here is in `made` and removed when the run ends (also on TERM/INT via JOB_TMPS).
// AUTOPILOT_TEST_TIMING_FACTOR defaults to N for pool entries (a caller value wins).
function jobEnv(parent, factor, xdgBase, made) {
  const dir = fs.mkdtempSync(path.join(parent, 'asj.'));
  made.add(dir); JOB_TMPS.add(dir);
  fs.chmodSync(dir, 0o700);
  const env = { ...process.env, TMPDIR: dir };
  if (xdgBase) {
    const xdg = fs.mkdtempSync(path.join(xdgBase, 'asj.')); // inside xdgBase, removed with it
    fs.chmodSync(xdg, 0o700);
    env.XDG_RUNTIME_DIR = xdg;
  }
  if (env.AUTOPILOT_TEST_TIMING_FACTOR === undefined) env.AUTOPILOT_TEST_TIMING_FACTOR = String(factor);
  return env;
}

// A root-owned directory with the sticky bit (/tmp, mode 1777) may be group/world writable: others can add entries but
// cannot rename or delete ours, which is the usual way a shared temp root is used.
const stickyRootDir = (st) => st.uid === 0 && (st.mode & 0o1000) !== 0;

// true when every level from `dir` up to / is a real directory owned by us or root, and either not group/world writable
// or a root-owned sticky directory. (Final directories we create are 0700 and ours.)
function ancestorsSafe(dir) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  for (let d = dir; ; d = path.dirname(d)) {
    let st;
    try { st = fs.lstatSync(d); } catch { return false; }
    if (!st.isDirectory() || (uid !== null && st.uid !== uid && st.uid !== 0)) return false;
    if ((st.mode & 0o022) !== 0 && !stickyRootDir(st)) return false;
    if (path.dirname(d) === d) return true;
  }
}

// Per-run private base for the pool's XDG_RUNTIME_DIRs; null (and one stderr line) when no safe place exists.
function makeXdgBase() {
  // (a) the caller's absolute XDG_RUNTIME_DIR, (b) $HOME/.cache/autopilot-asj; only when no earlier one is usable.
  const cands = [];
  const x = process.env.XDG_RUNTIME_DIR;
  if (x && path.isAbsolute(x)) cands.push(x);
  if (process.env.HOME && path.isAbsolute(process.env.HOME)) cands.push(path.join(process.env.HOME, '.cache', 'autopilot-asj'));
  for (const parent of cands) {
    try {
      // Safety first, creation second: the nearest existing ancestor (and everything above it) must be safe, so
      // nothing is created in an unsafe place. Directories made below it are 0700.
      let e = parent;
      while (!fs.existsSync(e)) e = path.dirname(e);
      if (!ancestorsSafe(e)) continue;
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      if (!ancestorsSafe(parent)) continue;
      const b = fs.mkdtempSync(path.join(parent, 'asj.'));
      fs.chmodSync(b, 0o700);
      return b;
    } catch { /* next candidate */ }
  }
  process.stderr.write('affected-suites: no safe directory for private XDG_RUNTIME_DIRs (every ancestor must be non-group/world-writable); pool entries are not XDG-isolated\n');
  return null;
}

// Parent of the per-run TMPDIR base: os.tmpdir() when short, else /tmp (see the path-length note above).
function tmpParent() {
  const t = process.env.TMPDIR || '/tmp'; // what os.tmpdir() returns on Linux (minus the TMP/TEMP spellings)
  if (t.length <= 5) return t;
  try { fs.accessSync('/tmp', fs.constants.W_OK); process.stderr.write(`affected-suites: TMPDIR ${t} is long; per-entry TMPDIRs go under /tmp to keep unix socket paths short\n`); return '/tmp'; }
  catch { process.stderr.write(`affected-suites: TMPDIR ${t} is long and /tmp is not writable; unix socket paths under per-entry TMPDIRs may exceed sun_path\n`); return t; }
}

async function runPool(root, doc, alwaysRun, jobs, entryTimeout) {
  if (doc.mode === 'full') {
    for (const reason of doc.full_reasons) process.stdout.write(`${reason}\n`);
    process.stdout.write('whole suite deferred to the pre-merge run (CLAUDE.md Mission graph verification)\n');
  }
  const main = doc.mode === 'full' ? [...alwaysRun] : [...doc.suites];
  const serialSet = loadSerialSuites(root);
  const hist = durationsApply(root) ? readDurations(durationsFile()) : new Map();
  // Slowest first; no record = first (unknown may be slow), ties keep name order (run.sh rule).
  const poolList = main.filter((r) => !serialSet.has(r))
    .map((rel, i) => ({ rel, i, s: hist.has(rel) ? hist.get(rel) : Infinity }))
    .sort((a, b) => (a.s !== b.s ? (a.s > b.s ? -1 : 1) : a.i - b.i)).map((x) => x.rel);
  const serialList = main.filter((r) => serialSet.has(r));
  let tmpRoot = null;
  let xdgBase = null;
  const made = new Set();
  const results = [];
  const timedOut = [];
  let failed = 0;
  const callerFactor = process.env.AUTOPILOT_TEST_TIMING_FACTOR;
  const exec = async (rel, factor, isolateXdg) => {
    const t0 = Date.now();
    const env = jobEnv(tmpRoot, factor, isolateXdg ? xdgBase : null, made);
    const r = await runEntry(root, rel, entryTimeout, true, { capture: true, env, confirmGroup: true });
    return { ...r, seconds: Math.round(Date.now() - t0) / 1000 };
  };
  const emit = (rel, r, extraLine) => {
    emitChunks(r.chunks);
    if (extraLine) process.stdout.write(extraLine);
    process.stdout.write(`rc=${r.rc} ${rel}\n`);
  };
  const finalize = (rel, r, flaky) => {
    if (r.timedOut) timedOut.push(rel);
    const row = { path: rel, rc: r.rc, seconds: r.seconds };
    if (r.lingering) row.lingering_group = true;
    if (flaky && flaky.pool_lingering) row.lingering_group = true;
    if (flaky) { row.flaky_under_parallel = true; row.pool_rc = flaky.pool_rc; if (flaky.pool_timed_out) row.pool_timed_out = true; }
    results.push(row);
    if (r.rc !== 0) failed++;
  };
  try {
    tmpRoot = tmpParent();
    xdgBase = makeXdgBase();
    if (xdgBase) JOB_TMPS.add(xdgBase);
    const held = []; // non-zero pool results wait for their serial rerun before printing
    let next = 0;
    const worker = async () => {
      while (next < poolList.length) {
        const rel = poolList[next++];
        const r = await exec(rel, callerFactor === undefined ? jobs : callerFactor, true);
        if (r.rc === 0) { emit(rel, r); finalize(rel, r, null); } else held.push({ rel, r });
      }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, poolList.length) }, worker));
    // Serial rerun of every pool failure (BL-0331): green alone = flaky-under-parallel; still red = the RERUN's output,
    // rc, timeout state and record entry are final (the pool rc is not reported then).
    for (const { rel, r } of held) {
      const again = await exec(rel, 1, false);
      if (again.rc === 0) {
        emitChunks(again.chunks);
        process.stdout.write(`flaky-under-parallel: ${rel} (${r.timedOut ? 'timeout' : `rc=${r.rc}`} in pool)\n`);
        process.stdout.write(`rc=0 ${rel}\n`);
        finalize(rel, again, { pool_rc: r.rc, pool_timed_out: r.timedOut, pool_lingering: !!r.lingering });
      } else {
        emit(rel, again);
        finalize(rel, again, null);
      }
    }
    for (const rel of [...serialList, ...doc.extra_runners]) {
      const r = await exec(rel, 1, false);
      emit(rel, r);
      finalize(rel, r, null);
    }
  } finally {
    for (const d of [...made, xdgBase]) {
      if (!d) continue;
      JOB_TMPS.delete(d);
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
  let emptyFail = false;
  if (doc.mode === 'selective' && doc.suites.length === 0 && !doc.changed.every(isProse)) {
    process.stdout.write('empty suites is not a pass: not every changed file is documentation\n');
    failed++;
    emptyFail = true;
  }
  process.stdout.write(`summary: ${results.length} run, ${failed} failed${timedOut.length ? ` (timeout: ${timedOut.join(' ')})` : ''}\n`);
  const slow = results.slice().sort((a, b) => b.seconds - a.seconds).slice(0, 10).map((r) => `${r.path} ${r.seconds}s`);
  return { code: failed === 0 ? 0 : 1, results, budgetDoc: null, emptyFail, timedOutPaths: timedOut, slowest: slow.length ? `slowest: ${slow.join(', ')}\n` : '' };
}

async function runSelected(root, doc, alwaysRun, budget, entryTimeout, jobs) {
  if (jobs > 1) return runPool(root, doc, alwaysRun, jobs, entryTimeout);
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
    results.push({ path: rel, rc, seconds: Math.round(Date.now() - t0) / 1000 });
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
  return { code, results, budgetDoc, emptyFail, timedOutPaths: timedOut };
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
      for (const d of JOB_TMPS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
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
    else if (x === '--jobs') {
      const v = argv[++i];
      a.jobs = v !== undefined && /^[1-9][0-9]*$/.test(v.trim()) ? Number(v) : NaN;
      if (!Number.isInteger(a.jobs)) throw new Error(`--jobs needs a positive integer, got ${JSON.stringify(v)}`);
    }
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
  if (a.jobs != null && !a.run) {
    process.stderr.write('affected-suites: --jobs requires --run\n');
    return 2;
  }
  if (a.jobs > 1 && a.budget != null) {
    process.stderr.write('affected-suites: --jobs N (N>1) cannot be combined with --budget-seconds\n');
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
      if ((a.entryTimeout != null || a.jobs > 1) && !SIG_INSTALLED) installSignalKill();
      const ran = await runSelected(root, doc, doc.mode === 'full' ? runAlways : doc.always_run, a.budget, a.entryTimeout, a.jobs || 1);
      recordDurations(root, ran.results, ran.timedOutPaths || []);
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
      if (ran.slowest) process.stdout.write(ran.slowest);
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

module.exports = { ancestorsSafe, extraRunners, select, mentions, buildGraph, isSuite, isProse, entryCommand, computeDoc, FULL_TRIGGERS, gitTree, diskTree };
if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
