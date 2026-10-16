#!/usr/bin/env node
'use strict';
// scan-fixture-literals.js — flag fixture literals that a hands diff wrote into PRODUCTION code.
//
// Why: references/evidence-discipline.md §23 — a hands cut added `phase === 'p7'` to a handler so a
// test case could collect behind a non-finalized generation. The suite was green (it existed for
// that branch) and only three hetero reviewers saw the backdoor. The special path belongs in the
// fixture, never in the program. This scans the ADDED lines of base..head in non-test files.
//
// Rules (a hit is a lead for a human or reviewer, not a verdict):
//   literal_compare   ==/===/!=/!==/case against a fixture-looking name: p<N>, fixture*, test*,
//                     dummy*, fake*, mock*, foo, bar, example*
//   fixture_const     a FIXTURE_* / TEST_FIXTURE* identifier
//   fake_sha          a quoted run of one repeated hex digit (40-64 long) or deadbeef/cafebabe
//   fake_path         a quoted /tmp|/var/tmp/(fixture|fake|dummy|test)* path, or /path/to/
//   test_mode_branch  NODE_ENV === 'test'
// Skipped: test/fixture/eval/doc paths, *.test.* / *.spec.* / *_test.* files, non-code extensions,
// comment-only lines, and any line carrying the marker `fixture-literal-ok` (an explicit, greppable
// waiver for a legitimate use).
//
// Usage: scan-fixture-literals.js --repo <dir> --base <ref> [--head <ref>]   (head defaults to HEAD)
// Output: JSON {ok, base, head, hits:[{file,line,rule,text}], files_scanned}
// Exit: 0 clean / 1 hits / 2 usage / 3 could not run (never read 3 as clean).

const { spawnSync } = require('child_process');

const RULES = [
  ['literal_compare', /(?:[!=]==?\s*|\bcase\s+)(['"])(?:p\d+|fixture[\w-]*|test[\w-]*|dummy[\w-]*|fake[\w-]*|mock[\w-]*|foo|bar|example[\w-]*)\1|(['"])(?:p\d+|fixture[\w-]*|test[\w-]*|dummy[\w-]*|fake[\w-]*|mock[\w-]*|foo|bar|example[\w-]*)\2\s*[!=]==?/i],
  ['fixture_const', /\b(?:FIXTURE_[A-Z0-9_]+|TEST_FIXTURE\w*)\b/],
  ['fake_sha', /(['"])(?:([0-9a-f])\2{39,63}|[0-9a-f]*(?:deadbeef|cafebabe)[0-9a-f]*)\1/i],
  ['fake_path', /(['"])(?:\/(?:var\/)?tmp\/(?:fixture|fake|dummy|test)[\w./-]*|\/path\/to\/[\w./-]*)\1/],
  ['test_mode_branch', /NODE_ENV\s*[!=]==?\s*(['"])test\1/],
];
const CODE_EXT = /\.(?:js|mjs|cjs|ts|tsx|jsx|sh|bash|py)$/;
const NON_PROD_PATH = /(?:^|\/)(?:tests?|__tests__|fixtures?|evals?|docs|references|examples?|\.claude|\.qc|node_modules)\//;
const TEST_FILE = /(?:\.test\.|\.spec\.|_test\.|\.fixture\.)/;
const WAIVER = 'fixture-literal-ok';

function usage(msg) {
  if (msg) process.stderr.write(`scan-fixture-literals: ${msg}\n`);
  process.stderr.write('usage: scan-fixture-literals.js --repo <dir> --base <ref> [--head <ref>]\n');
  process.exit(2);
}

function isProductionCode(file) {
  return CODE_EXT.test(file) && !NON_PROD_PATH.test(file) && !TEST_FILE.test(file);
}

function isCommentOnly(text) {
  return /^\s*(?:\/\/|#|\*|\/\*)/.test(text);
}

// Scan a unified diff (-U0, no renames). Pure: exported for the test.
function scanDiff(diffText) {
  const hits = [];
  const scanned = new Set();
  let file = null;
  let lineNo = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).replace(/^b\//, '');
      file = p === '/dev/null' ? null : p;
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) { lineNo = Number(h[1]); continue; }
    if (!file || !raw.startsWith('+') || raw.startsWith('+++')) continue;
    const text = raw.slice(1);
    const here = lineNo++;
    if (!isProductionCode(file)) continue;
    scanned.add(file);
    if (isCommentOnly(text) || text.includes(WAIVER)) continue;
    for (const [rule, rx] of RULES) {
      if (rx.test(text)) hits.push({ file, line: here, rule, text: text.trim().slice(0, 200) });
    }
  }
  return { hits, files_scanned: scanned.size };
}

function main() {
  const args = process.argv.slice(2);
  const o = { head: 'HEAD' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => { if (i + 1 >= args.length) usage(`${a} requires a value`); return args[++i]; };
    if (a === '--repo') o.repo = next();
    else if (a === '--base') o.base = next();
    else if (a === '--head') o.head = next();
    else if (a === '-h' || a === '--help') usage();
    else usage(`unknown argument: ${a}`);
  }
  if (!o.repo || !o.base) usage('--repo and --base are required');
  const r = spawnSync('git', ['-C', o.repo, 'diff', '--no-renames', '--no-color', '-U0', '--diff-filter=AM', `${o.base}..${o.head}`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    process.stdout.write(JSON.stringify({ ok: false, error: `git diff failed: ${(r.stderr || '').trim()}` }) + '\n');
    process.exit(3);
  }
  const { hits, files_scanned } = scanDiff(r.stdout);
  process.stdout.write(JSON.stringify({ ok: hits.length === 0, base: o.base, head: o.head, hits, files_scanned }, null, 2) + '\n');
  process.exit(hits.length === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { scanDiff, isProductionCode };
