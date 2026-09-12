#!/usr/bin/env node
'use strict';

// Method-selected post-merge-back containment check.
// Read-only: never checkout, fetch, write a ref, or commit.
//
// Usage:
//   node scripts/check-containment.js --edge <receipt.json> --target <ref> [--repo <dir>]
//
// Consumes v2.36.28 merge_execution_receipt fields (source_sha, accepted_sha,
// integration_method, source_ref). Does not redefine the schema.
//
// Post-condition by integration_method:
//   merge, ff
//     git merge-base --is-ancestor <source_sha> <target> MUST succeed
//   cherry-pick, rebase, squash, apply+fresh-commit
//     that same command MUST fail (source is not an ancestor — that is correct)
//     containment is asserted on accepted_sha being an ancestor of target
//   apply+fresh-commit additionally requires source_sha in the accepted commit
//     message, and reports (never enforces) whether source_ref still exists.
//
// Exit: 0 = post-condition holds
//       1 = post-condition failed (operands + command named)
//       2 = usage, unreadable receipt, or parser refusal (never a silent pass)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ANCESTOR_ARGS = ['merge-base', '--is-ancestor'];
const MERGE_METHODS = new Set(['merge', 'ff']);
const COPY_METHODS = new Set(['cherry-pick', 'rebase', 'squash', 'apply+fresh-commit']);
const APPLY_STYLE = 'apply+fresh-commit';

function usage(stream = process.stderr) {
  stream.write(
    'Usage: check-containment.js --edge <receipt.json> --target <ref> [--repo <dir>]\n',
  );
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const options = { repo: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag || !flag.startsWith('--')) {
      throw new Error(`unknown or incomplete option: ${flag || '<missing>'}`);
    }
    const key = flag.slice(2);
    if (key !== 'edge' && key !== 'target' && key !== 'repo') {
      throw new Error(`unknown or incomplete option: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`unknown or incomplete option: ${flag}`);
    }
    options[key] = value;
    index += 1;
  }
  if (!options.edge) throw new Error('--edge is required');
  if (!options.target) throw new Error('--target is required');
  return options;
}

function git(repo, args) {
  return spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function loadEdge(edgePath) {
  let raw;
  try {
    raw = fs.readFileSync(edgePath, 'utf8');
  } catch (error) {
    throw new Error(`REFUSED: unreadable receipt ${edgePath}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`REFUSED: unreadable receipt ${edgePath}: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`REFUSED: unreadable receipt ${edgePath}: expected an object`);
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'edges')) {
    if (!Array.isArray(parsed.edges)) {
      throw new Error(`REFUSED: unreadable receipt ${edgePath}: "edges" must be an array`);
    }
    if (parsed.edges.length === 0) {
      throw new Error(`REFUSED: unreadable receipt ${edgePath}: edges is empty`);
    }
    return parsed.edges[0];
  }
  if (!parsed.integration_method) {
    throw new Error(`REFUSED: unreadable receipt ${edgePath}: missing integration_method`);
  }
  return parsed;
}

function ancestorCommand(repo, sha, target) {
  return `git -C ${repo} merge-base --is-ancestor ${sha} ${target}`;
}

function isAncestor(repo, sha, target) {
  const result = git(repo, [...ANCESTOR_ARGS, sha, target]);
  return {
    command: ancestorCommand(repo, sha, target),
    status: result.error ? 128 : result.status,
    stderr: String(result.stderr || result.error || '').trim(),
  };
}

function fail(stderr, message) {
  stderr.write(`${message}\n`);
  return 1;
}

function checkContainment(repo, target, edge, stderr, stdout) {
  const unitId = edge.unit_id || '<missing-unit_id>';
  const method = edge.integration_method;
  const sourceSha = edge.source_sha;
  const acceptedSha = edge.accepted_sha;
  const sourceRef = edge.source_ref;

  if (!method) {
    return fail(stderr, `REFUSED id=${unitId} target=${target}: missing integration_method`);
  }
  if (!GIT_OID.test(String(sourceSha || ''))) {
    return fail(
      stderr,
      `REFUSED id=${unitId} sha=${sourceSha || '<missing>'} target=${target}: source_sha must be a full Git OID`,
    );
  }
  if (!MERGE_METHODS.has(method) && !COPY_METHODS.has(method)) {
    return fail(
      stderr,
      `REFUSED id=${unitId} sha=${sourceSha} target=${target}: unsupported integration_method ${method}`,
    );
  }

  const sourceProbe = isAncestor(repo, sourceSha, target);

  if (MERGE_METHODS.has(method)) {
    if (sourceProbe.status !== 0) {
      return fail(
        stderr,
        `NOT-CONTAINED id=${unitId} sha=${sourceSha} target=${target} ` +
        `method=${method} command=${sourceProbe.command}` +
        (sourceProbe.stderr ? ` (${sourceProbe.stderr})` : '') +
        ` — merge/ff requires source_sha to be an ancestor of target`,
      );
    }
    stdout.write(
      `CONTAINED id=${unitId} sha=${sourceSha} target=${target} method=${method} ` +
      `command=${sourceProbe.command}\n`,
    );
    return 0;
  }

  if (sourceProbe.status === 0) {
    return fail(
      stderr,
      `NOT-CONTAINED id=${unitId} sha=${sourceSha} target=${target} ` +
      `method=${method} command=${sourceProbe.command} ` +
      `— copy/apply methods require this command to fail; source is not the contained object`,
    );
  }

  if (!GIT_OID.test(String(acceptedSha || ''))) {
    return fail(
      stderr,
      `NOT-CONTAINED id=${unitId} sha=${acceptedSha || '<missing>'} target=${target} ` +
      `method=${method} command=${ancestorCommand(repo, acceptedSha || '<missing-accepted_sha>', target)} ` +
      `— accepted_sha must be a full Git OID`,
    );
  }

  const acceptedProbe = isAncestor(repo, acceptedSha, target);
  if (acceptedProbe.status !== 0) {
    return fail(
      stderr,
      `NOT-CONTAINED id=${unitId} sha=${acceptedSha} target=${target} ` +
      `method=${method} command=${acceptedProbe.command}` +
      (acceptedProbe.stderr ? ` (${acceptedProbe.stderr})` : '') +
      ` — containment is asserted on accepted_sha, not source_sha`,
    );
  }

  if (method === APPLY_STYLE) {
    const log = git(repo, ['log', '-1', '--format=%B', acceptedSha]);
    if (log.status !== 0) {
      return fail(
        stderr,
        `NOT-CONTAINED id=${unitId} sha=${acceptedSha} target=${target} ` +
        `method=${method} command=git -C ${repo} log -1 --format=%B ${acceptedSha}` +
        ` (${String(log.stderr || '').trim()})`,
      );
    }
    const message = log.stdout || '';
    if (!message.includes(sourceSha)) {
      return fail(
        stderr,
        `NOT-CONTAINED id=${unitId} sha=${sourceSha} target=${target} ` +
        `method=${method} command=git -C ${repo} log -1 --format=%B ${acceptedSha} ` +
        `— apply-style accepted commit message must contain source_sha`,
      );
    }
    const refName = String(sourceRef || '');
    const showRef = refName
      ? git(repo, ['show-ref', '--verify', '--quiet', sourceRef])
      : { status: 1 };
    stdout.write(
      `SOURCE_BRANCH ${refName || '<missing-source_ref>'} ` +
      `${showRef.status === 0 ? 'exists' : 'absent'} (report-only; not enforced)\n`,
    );
  }

  stdout.write(
    `CONTAINED id=${unitId} sha=${acceptedSha} target=${target} method=${method} ` +
    `command=${acceptedProbe.command} ` +
    `(source_sha ${sourceSha} correctly not an ancestor; command=${sourceProbe.command})\n`,
  );
  return 0;
}

function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  try {
    const options = parseArgs(argv);
    if (options.help) {
      usage(stdout);
      return 0;
    }
    const repo = fs.realpathSync(path.resolve(options.repo));
    const edge = loadEdge(options.edge);
    return checkContainment(repo, options.target, edge, stderr, stdout);
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`);
    usage(stderr);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, parseArgs, COPY_METHODS, MERGE_METHODS };
