#!/usr/bin/env node
'use strict';

// land-branch.js — merge a reviewed branch into the base and optionally push develop.
// Runs in the current git repo (a scratch clone). Stops at the first failure.
// Stdout is exactly one JSON line. Command output goes to the log file.
//
// Usage:
//   node scripts/land-branch.js --branch <ref> --review-json <file> --fleet-task <id> --body-file <file>
//     [--base-ref origin/develop] [--known-red <file>] [--suites affected|none] [--push] [--remote origin]
//
// Exit: 0 only for status landed or merged_not_pushed. Usage errors exit 2. Every other
// failure exits 1. Never force-pushes and never passes --no-verify.
//
// Status: landed | merged_not_pushed | dirty_worktree | review_not_ship | conflict
//   | new_red | check_failed | base_moved | push_failed | fetch_failed | checkout_failed
//   | merge_failed | commit_failed | not_a_repo | usage
// conflict adds conflicted (paths). push_failed adds stderr_tail. new_red lists the names.
// checks maps each check that ran to its exit code.
//
// A parseable review object is accepted. A verdict other than SHIP-AS-IS, including
// null or a missing verdict, is review_not_ship (exit 1). Unparseable JSON or a
// non-object is usage (exit 2).
// While a merge is in progress, .hippo/.cache/index.sqlite is restored from HEAD
// before other conflicts are judged (checkout HEAD -- <path>, then add when that
// path is unmerged). A failed restore aborts the merge. Remaining conflicted paths
// are conflict; if none remain and the merge failed for another reason, merge_failed.
//
// --suites affected (default) runs `node scripts/affected-suites.js --base <base-ref> --run`.
// Failing suites are `rc=<nonzero> <path>` lines (the affected-suites contract). --known-red
// is one suite path per line; only names not listed count as new red. --suites none skips
// that step. Every child is spawned with stdin from /dev/null.
//
// Test-only (not for a real landing): LAND_BRANCH_SUITES_CMD is a JSON array of strings, the
// argv that replaces the affected-suites command. LAND_BRANCH_CHECK_CMDS is a JSON array of
// argv arrays that replaces the four landing checks.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HIPPO_CACHE = '.hippo/.cache/index.sqlite';
const COAUTHOR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

function usage(stream) {
  stream.write(
    'Usage: node scripts/land-branch.js --branch <ref> --review-json <file> --fleet-task <id> --body-file <file>\n' +
    '  [--base-ref origin/develop] [--known-red <file>] [--suites affected|none] [--push] [--remote origin]\n' +
    'Stdout is one JSON line: {"status","sha","new_red","checks","log"}.\n' +
    'Exit 0 only for landed or merged_not_pushed.\n',
  );
}

function parseArgs(argv) {
  const opts = {
    baseRef: 'origin/develop',
    suites: 'affected',
    push: false,
    remote: 'origin',
    knownRed: null,
  };
  const valued = {
    branch: 'branch',
    'review-json': 'reviewJson',
    'fleet-task': 'fleetTask',
    'body-file': 'bodyFile',
    'base-ref': 'baseRef',
    'known-red': 'knownRed',
    suites: 'suites',
    remote: 'remote',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--push') {
      opts.push = true;
      continue;
    }
    if (!flag || !flag.startsWith('--')) throw new Error(`unknown argument: ${flag || '<missing>'}`);
    const name = flag.slice(2);
    if (!Object.prototype.hasOwnProperty.call(valued, name)) throw new Error(`unknown argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    opts[valued[name]] = value;
    i += 1;
  }
  if (!opts.branch) throw new Error('--branch is required');
  if (!opts.reviewJson) throw new Error('--review-json is required');
  if (!opts.fleetTask) throw new Error('--fleet-task is required');
  if (!opts.bodyFile) throw new Error('--body-file is required');
  if (opts.suites !== 'affected' && opts.suites !== 'none') throw new Error('--suites must be affected or none');
  for (const [label, value] of [['--branch', opts.branch], ['--base-ref', opts.baseRef], ['--remote', opts.remote]]) {
    if (value.startsWith('-') || /\s/.test(value)) throw new Error(`${label} is not a single ref`);
  }
  if (!opts.fleetTask.trim() || /\s/.test(opts.fleetTask)) throw new Error('--fleet-task must be one token');
  return opts;
}

function openLog() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'land-branch-'));
  const logPath = path.join(dir, 'land.log');
  fs.writeFileSync(logPath, '');
  return { dir, logPath };
}

function tail(text) {
  const s = String(text || '').replace(/\s+$/, '');
  return s.length <= 2000 ? s : s.slice(-2000);
}

function makeRunner(logPath) {
  return function run(argv) {
    const result = spawnSync(argv[0], argv.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const status = result.status === null ? 1 : result.status;
    const note = result.error ? ` ${result.error.message}` : '';
    fs.appendFileSync(logPath, `$ ${argv.map(String).join(' ')}\n${stdout}${stderr}[rc=${status}${note}]\n`);
    return { status, stdout, stderr };
  };
}

function readReview(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`unreadable review json: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`review json: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('review json must be an object');
  return parsed;
}

function readBody(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`unreadable body file: ${error.message}`);
  }
}

function readKnown(file) {
  if (!file) return new Set();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`unreadable known-red file: ${error.message}`);
  }
  const names = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    names.add(trimmed);
  }
  return names;
}

function branchLabel(ref) {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

function commitMessage(branch, bodyText, model, fleetTask) {
  const norm = bodyText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const splitAt = norm.indexOf('\n');
  const first = (splitAt === -1 ? norm : norm.slice(0, splitAt)).replace(/[ \t]+$/g, '');
  const rest = (splitAt === -1 ? '' : norm.slice(splitAt + 1)).replace(/^\s+/, '').replace(/\s+$/, '');
  const trailers = [
    `QC-Verdict: SHIP-AS-IS (${model})`,
    `Fleet-Task: ${fleetTask}`,
    COAUTHOR,
  ].join('\n');
  const parts = [`Merge ${branchLabel(branch)}: ${first}`, ''];
  if (rest) parts.push(rest, '');
  parts.push(trailers);
  return `${parts.join('\n')}\n`;
}

function suitesArgv(baseRef) {
  const raw = process.env.LAND_BRANCH_SUITES_CMD;
  if (!raw) return ['node', 'scripts/affected-suites.js', '--base', baseRef, '--run'];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`LAND_BRANCH_SUITES_CMD: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== 'string')) {
    throw new Error('LAND_BRANCH_SUITES_CMD must be a JSON array of strings');
  }
  return parsed;
}

function checkCommands(baseRef) {
  const raw = process.env.LAND_BRANCH_CHECK_CMDS;
  if (!raw) {
    const range = `${baseRef}..HEAD`;
    return [
      { key: 'leak-guard', argv: ['node', 'scripts/leak-guard.js', '--range', range] },
      { key: 'sync-all', argv: ['bash', 'scripts/sync-all.sh', '--check'] },
      { key: 'validate', argv: ['bash', 'scripts/validate.sh'] },
      {
        key: 'check-backlog-entries',
        argv: ['node', 'scripts/check-backlog-entries.js', '--backlog', 'project/backlog/BACKLOG.md', '--mode', 'block'],
      },
    ];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`LAND_BRANCH_CHECK_CMDS: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('LAND_BRANCH_CHECK_CMDS must be a JSON array');
  return parsed.map((cmd, index) => {
    if (!Array.isArray(cmd) || cmd.length === 0 || cmd.some((part) => typeof part !== 'string')) {
      throw new Error(`LAND_BRANCH_CHECK_CMDS[${index}] must be a non-empty argv array`);
    }
    return { key: cmd.join(' '), argv: cmd };
  });
}

function failingSuites(stdout) {
  const names = [];
  for (const line of String(stdout).split('\n')) {
    const match = /^rc=(\d+)\s+(.+?)\s*$/.exec(line);
    if (match && Number(match[1]) !== 0) names.push(match[2]);
  }
  return names;
}

function conflictPaths(git) {
  const names = new Set();
  const diff = git(['diff', '--name-only', '--diff-filter=U']);
  for (const line of diff.stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) names.add(trimmed);
  }
  const status = git(['status', '--porcelain']);
  for (const line of status.stdout.split('\n')) {
    if (!line || !/^(DD|AU|UD|UA|DU|AA|UU)/.test(line)) continue;
    let filePath = line.slice(3);
    const arrow = filePath.indexOf(' -> ');
    if (arrow >= 0) filePath = filePath.slice(arrow + 4);
    if (filePath) names.add(filePath);
  }
  return [...names].sort();
}

function merging(git) {
  return git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0;
}

function restoreHippo(git) {
  const unmerged = conflictPaths(git).includes(HIPPO_CACHE);
  const listed = `${git(['diff', '--name-only', 'HEAD', '--', HIPPO_CACHE]).stdout}\n${git(['diff', '--name-only', '--cached', '--', HIPPO_CACHE]).stdout}`;
  const touched = unmerged || listed.split('\n').some((line) => line.trim() === HIPPO_CACHE);
  if (!touched) return null;
  if (git(['cat-file', '-e', `HEAD:${HIPPO_CACHE}`]).status === 0) {
    const restored = git(['checkout', 'HEAD', '--', HIPPO_CACHE]);
    if (restored.status !== 0) return tail(restored.stderr || restored.stdout);
    if (unmerged) {
      const added = git(['add', '--', HIPPO_CACHE]);
      if (added.status !== 0) return tail(added.stderr || added.stdout);
    }
    return null;
  }
  const removed = git(['rm', '-f', '--cached', '--ignore-unmatch', '--', HIPPO_CACHE]);
  if (removed.status !== 0) return tail(removed.stderr || removed.stdout);
  if (fs.existsSync(HIPPO_CACHE)) fs.rmSync(HIPPO_CACHE, { force: true });
  return null;
}

function headSha(git) {
  const result = git(['rev-parse', 'HEAD']);
  return result.status === 0 ? result.stdout.trim() : null;
}

function emit(logPath, git, result, code) {
  const payload = {
    status: result.status,
    sha: Object.prototype.hasOwnProperty.call(result, 'sha') ? result.sha : headSha(git),
    new_red: result.new_red || [],
    checks: result.checks || {},
    log: logPath,
  };
  if (result.conflicted) payload.conflicted = result.conflicted;
  if (result.stderr_tail !== undefined) payload.stderr_tail = result.stderr_tail;
  if (result.detail) payload.detail = result.detail;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage(process.stdout);
    process.exit(0);
  }
  let log;
  try {
    log = openLog();
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      status: 'usage', sha: null, new_red: [], checks: {}, log: null, detail: error.message,
    })}\n`);
    process.exit(2);
  }
  const run = makeRunner(log.logPath);
  const git = (args) => run(['git', ...args]);
  const finish = (result, code) => emit(log.logPath, git, result, code);
  let opts;
  try {
    opts = parseArgs(argv);
    opts.review = readReview(opts.reviewJson);
    opts.body = readBody(opts.bodyFile);
    opts.known = readKnown(opts.knownRed);
    opts.suiteCmd = opts.suites === 'none' ? null : suitesArgv(opts.baseRef);
    opts.checks = checkCommands(opts.baseRef);
  } catch (error) {
    finish({ status: 'usage', detail: error.message }, 2);
  }

  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    finish({ status: 'not_a_repo', detail: tail(inside.stderr || inside.stdout) }, 1);
  }

  const fetched = git(['fetch', opts.remote]);
  if (fetched.status !== 0) finish({ status: 'fetch_failed', detail: tail(fetched.stderr || fetched.stdout) }, 1);

  const porcelain = git(['status', '--porcelain']);
  if (porcelain.status !== 0 || porcelain.stdout.split('\n').some((line) => line.length > 0)) {
    finish({ status: 'dirty_worktree', detail: porcelain.status === 0 ? undefined : tail(porcelain.stderr) }, 1);
  }

  fs.appendFileSync(log.logPath, `review verdict=${opts.review.verdict} model=${opts.review.model ?? ''} runner=${opts.review.runner ?? ''}\n`);
  if (opts.review.verdict !== 'SHIP-AS-IS') finish({ status: 'review_not_ship' }, 1);
  if (typeof opts.review.model !== 'string' || !opts.review.model.trim() || /[\r\n]/.test(opts.review.model)) {
    finish({ status: 'usage', detail: 'SHIP-AS-IS review is missing a one-line model' }, 2);
  }

  const detached = git(['checkout', '--detach', opts.baseRef]);
  if (detached.status !== 0) finish({ status: 'checkout_failed', detail: tail(detached.stderr || detached.stdout) }, 1);

  const merged = git(['merge', '--no-ff', '--no-commit', opts.branch]);
  const inMerge = merging(git);
  let hippoOnlyConflict = false;
  if (inMerge) {
    const before = conflictPaths(git);
    hippoOnlyConflict = before.length > 0 && before.every((name) => name === HIPPO_CACHE);
    const hippoError = restoreHippo(git);
    if (hippoError) {
      git(['merge', '--abort']);
      finish({ status: 'merge_failed', detail: `hippo cache restore: ${hippoError}` }, 1);
    }
  }
  if (merged.status !== 0) {
    const paths = conflictPaths(git);
    if (paths.length > 0) {
      if (merging(git)) git(['merge', '--abort']);
      finish({ status: 'conflict', conflicted: paths }, 1);
    }
    if (!hippoOnlyConflict) {
      if (merging(git)) git(['merge', '--abort']);
      finish({ status: 'merge_failed', detail: tail(merged.stderr || merged.stdout) }, 1);
    }
  }
  if (!merging(git)) finish({ status: 'merge_failed', detail: tail(merged.stdout || merged.stderr) || 'merge did not start' }, 1);

  const messagePath = path.join(log.dir, 'message.txt');
  fs.writeFileSync(messagePath, commitMessage(opts.branch, opts.body, opts.review.model, opts.fleetTask));
  const committed = git(['commit', '-F', messagePath, '--cleanup=verbatim']);
  if (committed.status !== 0) finish({ status: 'commit_failed', detail: tail(committed.stderr || committed.stdout) }, 1);

  if (opts.suiteCmd) {
    const suites = run(opts.suiteCmd);
    const failed = failingSuites(suites.stdout);
    let fresh = failed.filter((name) => !opts.known.has(name));
    if (suites.status !== 0 && failed.length === 0) fresh = [`(suites exit ${suites.status})`];
    if (fresh.length > 0) finish({ status: 'new_red', new_red: fresh }, 1);
  }

  const checks = {};
  for (const cmd of opts.checks) {
    const result = run(cmd.argv);
    checks[cmd.key] = result.status;
    if (result.status !== 0) finish({ status: 'check_failed', checks }, 1);
  }

  if (!opts.push) finish({ status: 'merged_not_pushed', checks }, 0);

  const again = git(['fetch', opts.remote]);
  if (again.status !== 0) finish({ status: 'fetch_failed', detail: tail(again.stderr || again.stdout), checks }, 1);
  const ancestor = git(['merge-base', '--is-ancestor', opts.baseRef, 'HEAD']);
  if (ancestor.status === 1) finish({ status: 'base_moved', checks }, 1);
  if (ancestor.status !== 0) finish({ status: 'base_check_failed', detail: tail(ancestor.stderr || ancestor.stdout), checks }, 1);
  const pushed = git(['push', opts.remote, 'HEAD:develop']);
  if (pushed.status !== 0) {
    finish({ status: 'push_failed', stderr_tail: tail(pushed.stderr || pushed.stdout), checks }, 1);
  }
  finish({ status: 'landed', checks }, 0);
}

main();
