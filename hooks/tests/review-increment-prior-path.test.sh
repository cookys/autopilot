#!/usr/bin/env bash
# BL-0203: a carried prior finding whose path was deleted or renamed between
# priorHead and newHead falls back to a full review (prior_path_removed).
# RED at f276a233b: observed_delete=incremental: observed_rename=incremental: untouched_stays_incremental=true; guard line absent so neg_guard_off_not_prior_path_removed=true (mutated copy is the real module)
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const SRC = path.join(root, 'src', 'engine', 'review-increment.js');

const gitIn = (repo, ...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=T', ...a], { encoding: 'utf8' }).trim();
function commit(repo, writes, msg) {
  for (const [p, c] of Object.entries(writes)) {
    const f = path.join(repo, p);
    if (c === null) { fs.rmSync(f, { force: true }); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, c);
  }
  gitIn(repo, 'add', '-A');
  gitIn(repo, 'commit', '-q', '--allow-empty', '-m', msg);
  return gitIn(repo, 'rev-parse', 'HEAD');
}
function fixture(name, h1) {
  const repo = path.join(tmp, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const body = 'function tax(n) { return n / 0; }\nmodule.exports = { tax };\n';
  const baseFiles = { 'src/tax.js': body, 'src/invoice.js': "const { tax } = require('./tax');\ntax(1);\n", 'src/other.js': 'function other() { return 1; }\n' };
  for (let i = 1; i <= 20; i += 1) baseFiles[`src/feat${String(i).padStart(2, '0')}.js`] = `function feat${i}() { return ${i}; }\n`;
  const B = commit(repo, baseFiles, 'base');
  const h0 = { 'src/tax.js': body + '// reviewed\n' };
  for (let i = 1; i <= 10; i += 1) h0[`src/feat${String(i).padStart(2, '0')}.js`] = `function feat${i}() { return ${i}; }\n// reviewed\n`;
  const H0 = commit(repo, h0, 'reviewed');
  const H1 = commit(repo, h1, 'fix');
  return { repo, B, H0, H1 };
}
const deleted = fixture('deleted', { 'src/tax.js': null, 'src/other.js': 'function other() { return 2; }\n' });
const renamed = fixture('renamed', { 'src/tax.js': null, 'src/vat.js': 'function tax(n) { return n / 1; }\nmodule.exports = { tax };\n' });
const untouched = fixture('untouched', { 'src/other.js': 'function other() { return 3; }\n' });

function input(fx) {
  return {
    repo: fx.repo, baseSha: fx.B, priorHead: fx.H0, newHead: fx.H1, returnReview: 'incremental',
    prior: {
      mode: 'full', baseSha: fx.B, rosterDigest: 'r', specDigest: 's', verifyCmd: 'node scripts/check.js',
      seats: [{ seatId: 's1', carriable: true, findings: [{ id: 'F1', path: 'src/tax.js:1' }] }],
    },
    current: { rosterDigest: 'r', specDigest: 's', verifyCmd: 'node scripts/check.js', verificationGreen: true },
  };
}
function load(srcText, name) {
  const dir = path.join(tmp, 'mod', name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'review-increment.js');
  fs.writeFileSync(f, srcText);
  return require(f);
}
const realSrc = fs.readFileSync(SRC, 'utf8');
const real = require(SRC);
const reasonOf = (m, fx) => {
  const r = m.evaluateReturnIncrement(input(fx));
  return `${r.mode}:${r.reason || ''}`;
};
const guardRe = /if \(\((.*)\)\) (.*)\/\/ guard:prior_path_removed$/m;
const mutatedSrc = realSrc.replace(guardRe, (all) => all.replace('if ((', 'if (false && ('));
const mutated = guardRe.test(realSrc) ? load(mutatedSrc, 'off') : real;

const deleteHit = reasonOf(real, deleted) === 'full:prior_path_removed';
const renameHit = reasonOf(real, renamed) === 'full:prior_path_removed';
const stayInc = reasonOf(real, untouched) === 'incremental:';
const neg = reasonOf(mutated, deleted) !== 'full:prior_path_removed';
console.log(`delete_prior_path_removed=${deleteHit}`);
console.log(`rename_prior_path_removed=${renameHit}`);
console.log(`untouched_stays_incremental=${stayInc}`);
console.log(`neg_guard_off_not_prior_path_removed=${neg}`);
console.log(`observed_delete=${reasonOf(real, deleted)}`);
console.log(`observed_rename=${reasonOf(real, renamed)}`);
process.exit(deleteHit && renameHit && stayInc && neg ? 0 : 1);
NODE
)"
assert_exit_code "$?" "0" "review-increment-prior-path: $OUT"
assert_contains "$OUT" "delete_prior_path_removed=true" "delete falls back"
assert_contains "$OUT" "rename_prior_path_removed=true" "rename falls back"
assert_contains "$OUT" "untouched_stays_incremental=true" "untouched path stays incremental"
assert_contains "$OUT" "neg_guard_off_not_prior_path_removed=true" "guard mutation drops the reason"
finalize_test
