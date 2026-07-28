#!/usr/bin/env node
'use strict';

/**
 * compaction-rehydrate.js — generic compaction-safe continuation rehydration.
 *
 * Invoked by the engine/dispatcher pre-dispatch boundary (and optionally by a
 * platform lifecycle hook). Does NOT activate Codex skills-only package hooks.
 *
 * Commands:
 *   write      --out <path> --root-run-id <id> --phase-cursor <N/M>
 *              --accepted-commit <sha|none> --next-action <text>
 *              [--project ...] [--branch ...] [--stage ...] [--base-sha ...]
 *              [--idempotency-key ...]
 *   rehydrate  --checkpoint <path>
 *   admit      --checkpoint <path>|--root-run-id <id>
 *              [--branch ...] [--stage ...] [--base-sha ...]
 *              [--manifest-dir <dir>] [--strict-match]
 *              [--matching-run <json>] (repeatable)
 *
 * Exit codes:
 *   0  rehydrated / attached / resumed / admitted / written
 *   1  not_found or reject (fail closed)
 *   2  usage error
 */

const fs = require('fs');
const path = require('path');

const {
  admitContinuation,
  buildCheckpoint,
  loadMatchingRunsFromManifestDir,
} = require('../src/engine/continuation-admission');

function usage(message) {
  if (message) process.stderr.write(`compaction-rehydrate: ${message}\n`);
  process.stderr.write(
    'usage: compaction-rehydrate.js write|rehydrate|admit [options]\n',
  );
  process.exit(2);
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === '-h' || command === '--help') usage();
  const out = { command, flags: {} };
  const multi = new Set(['matching-run']);
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) usage(`unknown argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'strict-match') {
      out.flags[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      usage(`${arg} requires a value`);
    }
    i += 1;
    if (multi.has(key)) {
      if (!Array.isArray(out.flags[key])) out.flags[key] = [];
      out.flags[key].push(value);
    } else {
      out.flags[key] = value;
    }
  }
  return out;
}

function emit(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(code);
}

function cmdWrite(flags) {
  const outPath = flags.out;
  if (!outPath) usage('write requires --out');
  let checkpoint;
  try {
    checkpoint = buildCheckpoint({
      root_run_id: flags['root-run-id'],
      phase_cursor: flags['phase-cursor'],
      accepted_commit: flags['accepted-commit'],
      next_action: flags['next-action'],
      project: flags.project,
      branch: flags.branch,
      stage: flags.stage,
      base_sha: flags['base-sha'],
      idempotency_key: flags['idempotency-key'],
    });
  } catch (error) {
    emit({
      status: 'reject',
      reason_code: error.code || 'incomplete_checkpoint',
      reason: error.message || String(error),
      missing: error.missing || null,
      duplicate_dispatch: 0,
    }, 1);
  }
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(checkpoint, null, 2)}\n`);
  fs.renameSync(tmp, resolved);
  emit({
    status: 'written',
    path: resolved,
    checkpoint,
    duplicate_dispatch: 0,
  }, 0);
}

function cmdRehydrate(flags) {
  const result = admitContinuation({
    checkpointPath: flags.checkpoint,
    identity: {
      root_run_id: flags['root-run-id'],
    },
    requireIdentity: false,
    matchingRuns: [],
  });
  // rehydrate path: if only checkpoint, surface rehydration without matching runs
  if (result.status === 'reject') {
    emit(result, 1);
  }
  if (!result.rehydrated) {
    emit({
      status: 'reject',
      reason_code: 'incomplete_checkpoint',
      reason: 'rehydrate requires --checkpoint with complete authoritative fields',
      duplicate_dispatch: 0,
    }, 1);
  }
  emit({
    status: 'rehydrated',
    reason_code: null,
    reason: null,
    duplicate_dispatch: 0,
    root_run_id: result.rehydrated.root_run_id,
    phase_cursor: result.rehydrated.phase_cursor,
    accepted_commit: result.rehydrated.accepted_commit,
    next_action: result.rehydrated.next_action,
    rehydrated: result.rehydrated,
  }, 0);
}

function cmdAdmit(flags) {
  const matchingRuns = [];
  if (Array.isArray(flags['matching-run'])) {
    for (const raw of flags['matching-run']) {
      try {
        matchingRuns.push(JSON.parse(raw));
      } catch (error) {
        usage(`--matching-run is not valid JSON: ${error.message}`);
      }
    }
  }
  const identity = {
    root_run_id: flags['root-run-id'] || null,
    branch: flags.branch || null,
    stage: flags.stage || null,
    base_sha: flags['base-sha'] || null,
  };
  if (flags['manifest-dir']) {
    matchingRuns.push(
      ...loadMatchingRunsFromManifestDir(flags['manifest-dir'], identity),
    );
  }
  const result = admitContinuation({
    identity,
    checkpointPath: flags.checkpoint || null,
    checkpoint: null,
    matchingRuns,
    requireIdentity: true,
    strictMatch: flags['strict-match'] === true,
  });
  const code = (result.status === 'reject' || result.status === 'not_found') ? 1 : 0;
  emit(result, code);
}

function main(argv) {
  const parsed = parseArgs(argv);
  switch (parsed.command) {
    case 'write':
      return cmdWrite(parsed.flags);
    case 'rehydrate':
      return cmdRehydrate(parsed.flags);
    case 'admit':
      return cmdAdmit(parsed.flags);
    default:
      usage(`unknown command: ${parsed.command}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  main,
  cmdWrite,
  cmdRehydrate,
  cmdAdmit,
};
