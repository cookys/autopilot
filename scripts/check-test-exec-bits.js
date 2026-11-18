#!/usr/bin/env node
'use strict';

/**
 * check-test-exec-bits.js — verify every tracked hooks/tests/*.test.sh has index mode 100755.
 *
 * hooks/tests/run.sh aborts the entire L2 layer if any hooks/tests/*.test.sh lacks the
 * executable bit. This gate reads `git ls-files -s 'hooks/tests/*.test.sh'` and fails
 * (exit 1) when any tracked suite has an index mode other than 100755.
 *
 * Usage:
 *   node scripts/check-test-exec-bits.js [--root <dir>]
 *
 * Exit codes:
 *   0 = every tracked hooks/tests/*.test.sh has mode 100755
 *   1 = one or more tracked suites are not mode 100755
 *   2 = usage or git precondition error
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_SELECTING_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
];

function usage(code) {
  const out = code === 0 ? process.stdout : process.stderr;
  out.write(
    'Usage: node scripts/check-test-exec-bits.js [--root <dir>]\n'
    + '  Check `git ls-files -s hooks/tests/*.test.sh` for mode 100755.\n'
    + '  Exit 0 = all 100755, 1 = non-executable suite(s) found, 2 = usage/git error.\n',
  );
  process.exit(code);
}

function parseArgs(argv) {
  let root = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage(0);
    } else if (arg === '--root' || arg.startsWith('--root=')) {
      const val = arg === '--root' ? argv[++i] : arg.slice('--root='.length);
      if (!val || (arg === '--root' && val.startsWith('--'))) {
        process.stderr.write('check-test-exec-bits: --root requires a directory path\n');
        process.exit(2);
      }
      root = path.resolve(val);
    } else {
      process.stderr.write(`check-test-exec-bits: unknown argument: ${arg}\n`);
      process.exit(2);
    }
  }
  return { root };
}

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of REPO_SELECTING_ENV) delete env[key];
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

function resolveTarget(explicitRoot) {
  if (explicitRoot !== null) {
    return { cwd: explicitRoot, env: cleanGitEnv() };
  }
  const topRes = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  if (!topRes.error && topRes.status === 0 && topRes.stdout.trim()) {
    return { cwd: topRes.stdout.trim(), env: process.env };
  }
  return { cwd: path.resolve(__dirname, '..'), env: cleanGitEnv() };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  if (root !== null) {
    let st;
    try {
      st = fs.statSync(root);
    } catch (err) {
      process.stderr.write(`check-test-exec-bits: cannot access ${root}: ${err.message}\n`);
      process.exit(2);
    }
    if (!st.isDirectory()) {
      process.stderr.write(`check-test-exec-bits: not a directory: ${root}\n`);
      process.exit(2);
    }
  }

  const target = resolveTarget(root);
  const lsRes = spawnSync('git', ['ls-files', '-s', '-z', '--', 'hooks/tests/*.test.sh'], {
    cwd: target.cwd,
    env: target.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (lsRes.error || lsRes.status !== 0) {
    const detail = lsRes.error ? lsRes.error.message : (lsRes.stderr || '').trim();
    process.stderr.write(`check-test-exec-bits: git ls-files failed: ${detail}\n`);
    process.exit(2);
  }

  const records = (lsRes.stdout || '').split('\0').filter(Boolean);
  const bad = [];
  for (const rec of records) {
    const tab = rec.indexOf('\t');
    if (tab === -1) continue;
    const meta = rec.slice(0, tab).trim().split(/\s+/);
    const mode = meta[0];
    const filePath = rec.slice(tab + 1);
    if (mode !== '100755') {
      bad.push({ path: filePath, mode });
    }
  }

  if (bad.length > 0) {
    process.stderr.write(
      `check-test-exec-bits: ${bad.length} of ${records.length} tracked hooks/tests/*.test.sh file(s) are not mode 100755:\n`,
    );
    for (const item of bad) {
      process.stderr.write(`  - ${item.path} (mode ${item.mode})\n`);
      process.stderr.write(`    fix: git update-index --chmod=+x ${item.path} && chmod +x ${item.path}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `✓ check-test-exec-bits: ${records.length} tracked hooks/tests/*.test.sh file(s) have mode 100755\n`,
  );
  process.exit(0);
}

main();
