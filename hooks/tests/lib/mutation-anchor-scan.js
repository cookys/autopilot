#!/usr/bin/env node
'use strict';
// mutation-anchor-scan.js <tests-dir> -- list negative-control mutations that would pass silently
// when their anchor stops matching the product text.
//
// Scope (what it can and cannot see):
//   shell   a `sed -i`, `sed ... > file` or `perl -pi` whose command text (with its backslash
//           continuation lines) names a product path or product variable ($REPO_ROOT, $MUT*, $LIB, $GATE,
//           $SCRIPT, $DISPATCH, $LAUNCHER, $HOOKS_DIR, $CLI, scripts/, src/ ...). It is accepted when it goes through
//           sed_mutate / sed_mutant (hooks/tests/lib.sh), when one of the next 6 lines checks the result
//           (cmp -s, grep -q, "did not apply|hit|match"), or when the line carries
//           `# mutation-anchor: intentional-miss` (a baseline that must not change the file).
//   python  a `python3 ... <<` heredoc that calls .replace( or re.sub( on file text must contain a
//           non-zero sys.exit( or an assert / raise, otherwise a missing anchor ends in success.
//   node    a `node -e` / `node - <<` body doing .replace( on a file it writes back (writeFileSync) must
//           contain `process.exit(` with a non-zero code, throw, or an assert.
// Remaining blind spots (deliberate, not hidden):
//   - the sed command form does not matter here (s, d, i, a, c are all file edits). What matters is that the
//     edit goes through sed_mutate / sed_mutant (hooks/tests/lib.sh), which accept exactly ONE sed command per
//     call and fail when it does not change the file. A bare sed with several -e is flagged even when a cmp
//     follows. A bare sed that chains commands inside ONE expression with ';' is not detected here; the helpers
//     refuse it, the scanner only sees it if no check follows.
//   - a source or destination named by a variable outside PRODUCT_VARS (or built from `$1`) is not recognised
//     as a product file; the helper's own sed line is judged instead.
//   - sed fed from a pipe, `sed -n`, and files under fixtures/ are out of scope.
//   - python/node bodies are judged by pattern (a .replace on read text with no failure exit), not executed.
//   - only *.test.sh files are scanned; the scanner's own test file is excluded (its samples are bare on purpose).
// It does not execute anything.

const fs = require('fs');
const path = require('path');

// Product variables, with or without braces ($LIB and ${LIB}), plus MUT-family names and product paths.
const PRODUCT_VARS = ['REPO_ROOT', 'NC', 'LIB', 'GATE', 'SCRIPT', 'DISPATCH', 'LAUNCHER', 'HOOKS_DIR', 'CLI', 'VERIFIER',
  'UNWIRED_SCRIPT', 'AF_MUT', 'SM', 'LOOP', 'REAPER', 'HOOK', 'GATE_JS'];
const PRODUCT = new RegExp('\\$\\{?(?:' + PRODUCT_VARS.join('|') + ')\\b\\}?'
  + '|\\$\\{?MUT(?:ROOT|_[A-Z0-9_]+|[A-Z0-9]{0,2})\\b\\}?|\\bscripts/|\\bsrc/');
const CHECK = /(cmp -s|grep -q|did not (apply|hit)|anchor drifted|not found in|assert_neq\b[^\n]*(\$\(cat|cksum|diff))/;
// A file-editing sed/perl: in place (-i, -Ei, --in-place, perl -pi) or writing a file (redirect). Runs on the
// command text AFTER backslash continuations are folded into one line.
const SED_RE = /(^|[\s;&|(])(sed\b.*(?:\s-i\b|\s-[A-Za-z]*i\b|\s--in-place)|perl\s+-[a-z]*p[a-z]*i|sed\b.*>\s*"?[$\w])/;

function shellFindings(file, lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];
    if (/^\s*#/.test(text)) continue;
    if (/\bsed_mutat(e|nt)\b/.test(text)) continue;
    if (!/(^|[\s;&|(`$])(sed|perl)\s/.test(text)) continue;
    if (/\bsed\s+(-[A-Za-z]*n[A-Za-z]*)\b/.test(text) || /\bsed\s+-n\b/.test(text)) continue;
    let j = i; // fold backslash continuation lines into ONE line before any regex runs
    while (/\\\s*$/.test(lines[j]) && j + 1 < lines.length) { j++; text = text.replace(/\\\s*$/, ' ') + lines[j].trim(); }
    if (/mutation-anchor:\s*intentional-miss/.test(text)) continue;
    if (!SED_RE.test(text)) continue;
    if (/\|\s*sed\b/.test(text)) continue; // sed filtering a stream, not editing a file
    if (!PRODUCT.test(text)) continue;
    const window = lines.slice(j, j + 7).join('\n');
    // A bare multi-command sed is judged on the whole file: one hit hides the others missing. Even with a
    // cmp/grep right after it, it has to be split into one sed_mutate / sed_mutant call per command.
    const multi = (text.match(/\s-e\s/g) || []).length >= 2;
    if (CHECK.test(window) && !multi) continue;
    out.push({ file, line: i + 1, kind: multi ? 'sed/perl multi-command' : 'sed/perl', text: lines[i].trim().slice(0, 140) });
    i = j;
  }
  return out;
}

function heredocBlocks(lines, opener) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(opener);
    if (!m) continue;
    const tag = m[1];
    let j = i + 1; const body = [];
    while (j < lines.length && lines[j].trim() !== tag) { body.push(lines[j]); j++; }
    blocks.push({ start: i + 1, body: body.join('\n') });
    i = j;
  }
  return blocks;
}

function pythonFindings(file, lines) {
  const out = [];
  for (const b of heredocBlocks(lines, /python3?\b[^<]*<<-?\s*['"]?(\w+)['"]?/)) {
    if (!/\.replace\(|re\.sub\(/.test(b.body)) continue;
    if (!/write_text|\.write\(/.test(b.body) || !/read_text|\.read\(\)/.test(b.body)) continue;
    if (/sys\.exit\(\s*[1-9]|raise\b|\bassert\b|SystemExit\(\s*[1-9]/.test(b.body)) continue;
    if (!PRODUCT.test(lines[b.start - 1] + '\n' + b.body)) continue;
    out.push({ file, line: b.start, kind: 'python', text: 'heredoc .replace()/re.sub() with no non-zero exit on a missing anchor' });
  }
  return out;
}

function nodeFindings(file, lines) {
  const out = [];
  for (const b of heredocBlocks(lines, /node\b[^<]*<<-?\s*['"]?(\w+)['"]?/)) {
    if (!/\.replace\(/.test(b.body) || !/writeFileSync|writeFile\(/.test(b.body)) continue;
    if (/process\.exit\(\s*[1-9]|\bthrow\b|\bassert\b|\.test\(|\.includes\(|indexOf\(/.test(b.body)) continue;
    if (!PRODUCT.test(lines[b.start - 1] + '\n' + b.body)) continue;
    out.push({ file, line: b.start, kind: 'node', text: 'heredoc .replace() writing a file with no failure on a missing anchor' });
  }
  return out;
}

function scan(dir) {
  const all = [];
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'fixtures' && e.name !== 'node_modules') walk(p); }
      else if (/\.test\.sh$/.test(e.name) && e.name !== 'mutation-anchor-guard.test.sh') files.push(p); // its own samples are deliberately bare
    }
  })(dir);
  files.sort();
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    all.push(...shellFindings(f, lines), ...pythonFindings(f, lines), ...nodeFindings(f, lines));
  }
  return all;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: mutation-anchor-scan.js <tests-dir>'); process.exit(2); }
  const found = scan(dir);
  for (const f of found) console.log(`${path.relative(dir, f.file)}:${f.line}\t${f.kind}\t${f.text}`);
  process.exit(found.length ? 1 : 0);
}
module.exports = { scan };
