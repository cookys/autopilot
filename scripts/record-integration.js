#!/usr/bin/env node
'use strict';

// Record an integration already performed outside the merge rail.
// This command only reads Git state and emits a receipt; it never integrates,
// checks out, commits, or writes a ref.
//
// Usage:
//   node scripts/record-integration.js --repo <worktree> \
//     --source-sha <oid> --accepted-sha <oid> \
//     --method <merge|ff|cherry-pick|rebase|squash|apply+fresh-commit> \
//     --unit-id <id>
//
// Output: schema-valid merge_execution_receipt JSON on stdout.
// Exit: 0 = emitted; 2 = invalid arguments or Git facts cannot be re-derived.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { canonicalDigest } = require('../src/engine/implementation-campaign');

const METHODS = new Set([
  'merge',
  'ff',
  'cherry-pick',
  'rebase',
  'squash',
  'apply+fresh-commit',
]);
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function usage(stream = process.stderr) {
  stream.write(
    'Usage: record-integration.js --repo <worktree> --source-sha <oid> ' +
    '--accepted-sha <oid> --method <method> --unit-id <id>\n',
  );
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const allowed = new Set(['repo', 'source-sha', 'accepted-sha', 'method', 'unit-id']);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !flag.startsWith('--') || !allowed.has(flag.slice(2)) || value === undefined) {
      throw new Error(`unknown or incomplete option: ${flag || '<missing>'}`);
    }
    const key = flag.slice(2);
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      throw new Error(`duplicate option: ${flag}`);
    }
    options[key] = value;
  }
  for (const key of allowed) {
    if (!options[key]) throw new Error(`--${key} is required`);
  }
  if (!GIT_OID.test(options['source-sha'])) throw new Error('--source-sha must be a full Git OID');
  if (!GIT_OID.test(options['accepted-sha'])) {
    throw new Error('--accepted-sha must be a full Git OID');
  }
  if (!METHODS.has(options.method)) throw new Error(`unsupported --method: ${options.method}`);
  if (options['unit-id'].startsWith('refs/')) throw new Error('--unit-id must not be a ref name');
  return options;
}

function git(repo, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.signal || result.status !== 0)) {
    const detail = String(result.stderr || result.error || result.signal || '').trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function resolveCommit(repo, oid, label) {
  const result = git(repo, ['rev-parse', '--verify', `${oid}^{commit}`]);
  const resolved = result.stdout.trim();
  if (!GIT_OID.test(resolved) || resolved !== oid) {
    throw new Error(`${label} does not resolve to the supplied full Git OID`);
  }
  return resolved;
}

function directRef(repo, oid, label) {
  const refs = git(repo, [
    'for-each-ref', '--points-at', oid, '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags',
  ]).stdout.split('\n').filter((value) => value.startsWith('refs/')).sort();
  if (refs.length === 0) throw new Error(`${label} has no direct ref`);
  return refs[0];
}

function makeReceipt(options) {
  const repo = fs.realpathSync(path.resolve(options.repo));
  const topLevel = fs.realpathSync(git(repo, ['rev-parse', '--show-toplevel']).stdout.trim());
  if (topLevel !== repo) throw new Error('--repo must name the root of a Git worktree');

  const sourceSha = resolveCommit(repo, options['source-sha'], 'source SHA');
  const acceptedSha = resolveCommit(repo, options['accepted-sha'], 'accepted SHA');
  const targetRef = git(repo, ['symbolic-ref', '-q', 'HEAD']).stdout.trim();
  if (!targetRef.startsWith('refs/')) throw new Error('target worktree HEAD must be symbolic');
  const targetHead = git(repo, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
  if (targetHead !== acceptedSha) {
    throw new Error('accepted SHA must equal the checked-out target HEAD');
  }
  const sourceRef = directRef(repo, sourceSha, 'source SHA');
  const commonBase = git(repo, ['merge-base', sourceSha, acceptedSha]).stdout.trim();
  if (!GIT_OID.test(commonBase)) throw new Error('source and accepted commits have no merge base');

  const edgeBody = {
    sequence: 1,
    source_ref: sourceRef,
    target_ref: targetRef,
    mode: options.method === 'merge' ? 'no-ff' : 'ff-only',
    status: 'executed',
    source_validation: {
      ref: sourceRef,
      expected_sha: sourceSha,
      actual_sha: sourceSha,
      from_edge: null,
    },
    target_validation: {
      ref: targetRef,
      expected_sha: acceptedSha,
      actual_sha: acceptedSha,
      from_edge: null,
    },
    before_sha: commonBase,
    after_sha: acceptedSha,
    merge_commit: options.method === 'merge' ? acceptedSha : null,
    source_sha: sourceSha,
    accepted_sha: acceptedSha,
    integration_method: options.method,
    unit_id: options['unit-id'],
    conflicts: [],
    error: null,
    preservation: {
      approved_paths: [],
      protected_paths: [],
      action: 'none',
      restored: true,
      verification: 'exact',
    },
  };
  const edge = { ...edgeBody, edge_receipt_digest: canonicalDigest(edgeBody) };
  const body = {
    schema_version: 1,
    artifact_type: 'merge_execution_receipt',
    manifest_seal: null,
    root_run_id: null,
    status: 'complete',
    halt_reason: null,
    halt_edge: null,
    edges: [edge],
  };
  return { ...body, receipt_digest: canonicalDigest(body) };
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
    stdout.write(`${JSON.stringify(makeReceipt(options), null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`);
    usage(stderr);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { METHODS, main, makeReceipt, parseArgs };
