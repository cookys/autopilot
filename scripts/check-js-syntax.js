#!/usr/bin/env node
/**
 * check-js-syntax.js — syntax-check every tracked .js/.cjs/.mjs file in the repo.
 *
 * Incident this closes (CHANGELOG v2.34.41): a block comment containing the comment-close
 * sequence (asterisk-slash) inside it early-terminated the comment and left
 * scripts/dispatch-plan-review.js and its
 * committed Codex mirror syntactically INVALID. The commit described itself as
 * "comment-only" and carried QC-Verdict: PASS from two review seats — nothing in the
 * repo actually parsed the JS. This does.
 *
 * File set: `git ls-files -z '*.js' '*.cjs' '*.mjs'` — the TRACKED set, not a filesystem
 * walk (which would pick up node_modules/, build output, scratch files). As of the last
 * sweep the repo has 0 tracked .mjs files; both extensions are still swept in case one
 * is added later.
 *
 * Module-type correctness (the trap): `node --check` itself resolves a .js file's module
 * type from its own module system — walking up to the NEAREST tracked package.json for
 * an explicit "type" field, and (Node >= 22, --experimental-detect-module, on by default)
 * falling back to syntax-based detection when no package.json / no "type" field is found.
 * .cjs is always CommonJS and .mjs is always ESM regardless of package.json.
 *
 * This script deliberately does NOT reimplement that resolution — it just runs
 * `node --check <path>` per file and lets Node's own module system decide, which by
 * construction matches exactly what Node would do if the file were actually loaded.
 * Verified against this repo's real package.json layout (no root package.json; three
 * subtrees — .opencode/plugin-package/, platforms/opencode/plugin/, website/ — declare
 * "type":"module"; everything else is unmarked/CommonJS with syntax-detection fallback)
 * plus a scratch reproduction: a .js with `import` syntax and no package.json passes
 * (detected as ESM); the same file under an explicit "type":"commonjs" package.json
 * fails with Node's real "Cannot use import statement outside a module" error.
 *
 * Exclusion list: EXCLUDED_PREFIXES below. Must be an explicit, narrow, documented path
 * prefix list — never a silent skip, never a wildcard. The script FAILS CLOSED (exit 2)
 * if a listed prefix does not match any tracked file, so a stale exclusion can never
 * silently cover nothing. Currently empty: the full tracked-JS sweep is clean.
 *
 * Exit contract:
 *   0 — every checked file parses; prints a count.
 *   1 — one or more files fail to parse; every failing file is named with Node's actual
 *       stderr message (not just the first).
 *   2 — usage/precondition error (git unavailable, not a git repo, a listed exclusion
 *       prefix matches nothing).
 */
'use strict';

const { execFileSync, execFile } = require('child_process');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');

// Explicit, narrow, documented exclusions only — see header. Empty: nothing needs it.
const EXCLUDED_PREFIXES = [];

function usage() {
  console.log('Usage: node scripts/check-js-syntax.js');
  console.log('  Syntax-check every git-tracked .js/.cjs/.mjs file via `node --check`.');
  console.log('  Exit 0 = all parse, 1 = one or more fail (all named), 2 = usage/precondition error.');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  usage();
  process.exit(0);
}

function listTrackedFiles() {
  let out;
  try {
    out = execFileSync(
      'git',
      ['ls-files', '-z', '--', '*.js', '*.cjs', '*.mjs'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (err) {
    console.error(`check-js-syntax: git ls-files failed: ${err.message}`);
    process.exit(2);
  }
  return out.split('\0').filter(Boolean);
}

function checkExclusions(files) {
  for (const prefix of EXCLUDED_PREFIXES) {
    const matches = files.some((f) => f === prefix || f.startsWith(prefix));
    if (!matches) {
      console.error(
        `check-js-syntax: exclusion prefix "${prefix}" matches no tracked file — stale exclusion, refusing to run (fail-closed)`
      );
      process.exit(2);
    }
  }
}

function isExcluded(f) {
  return EXCLUDED_PREFIXES.some((prefix) => f === prefix || f.startsWith(prefix));
}

function checkOne(relPath, cb) {
  const abs = path.join(REPO_ROOT, relPath);
  execFile(process.execPath, ['--check', abs], { cwd: REPO_ROOT }, (err, _stdout, stderr) => {
    if (err) {
      cb({ file: relPath, message: (stderr || err.message || '').trim() });
    } else {
      cb(null);
    }
  });
}

function runPool(files, concurrency, cb) {
  const failures = [];
  let idx = 0;
  let active = 0;
  let settled = false;

  function maybeFinish() {
    if (settled) return;
    if (idx >= files.length && active === 0) {
      settled = true;
      cb(failures);
    }
  }

  function pump() {
    while (active < concurrency && idx < files.length) {
      const f = files[idx++];
      active++;
      checkOne(f, (failure) => {
        active--;
        if (failure) failures.push(failure);
        if (idx < files.length) pump();
        else maybeFinish();
      });
    }
    maybeFinish();
  }

  pump();
}

function main() {
  const allFiles = listTrackedFiles();
  if (allFiles.length === 0) {
    console.error('check-js-syntax: git ls-files returned zero tracked .js/.cjs/.mjs files — precondition failure, refusing to report a false-green pass');
    process.exit(2);
  }

  checkExclusions(allFiles);

  const files = allFiles.filter((f) => !isExcluded(f));

  const concurrency = Math.max(1, Math.min(8, os.cpus().length));
  const start = Date.now();

  runPool(files, concurrency, (failures) => {
    const elapsedMs = Date.now() - start;
    if (failures.length > 0) {
      console.error(`check-js-syntax: ${failures.length} of ${files.length} tracked file(s) FAILED to parse:\n`);
      for (const f of failures) {
        console.error(`✗ ${f.file}`);
        console.error(f.message.split('\n').map((l) => `    ${l}`).join('\n'));
        console.error('');
      }
      process.exit(1);
    }
    console.log(`✓ check-js-syntax: ${files.length} tracked .js/.cjs/.mjs file(s) parse cleanly (${elapsedMs}ms)`);
    process.exit(0);
  });
}

main();
