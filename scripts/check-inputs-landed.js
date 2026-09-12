#!/usr/bin/env node
'use strict';

// Assert each declared input SHA is an ancestor of a target ref.
// Read-only: never checkout, fetch, write a ref, or commit.
//
// Usage:
//   node scripts/check-inputs-landed.js --inputs <json> --target <ref> [--repo <dir>]
//
// Inputs JSON: {"inputs":[{"id":"...","sha":"..."}]}
// Exit: 0 = every sha is an ancestor of target
//       1 = one or more entries failed (every failing id/sha named in one run)
//       2 = usage, unreadable inputs, or parser refusal (never a silent pass)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ANCESTOR_CMD = 'merge-base --is-ancestor';

function usage(stream = process.stderr) {
  stream.write(
    'Usage: check-inputs-landed.js --inputs <json> --target <ref> [--repo <dir>]\n',
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
    if (key !== 'inputs' && key !== 'target' && key !== 'repo') {
      throw new Error(`unknown or incomplete option: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`unknown or incomplete option: ${flag}`);
    }
    options[key] = value;
    index += 1;
  }
  if (!options.inputs) throw new Error('--inputs is required');
  if (!options.target) throw new Error('--target is required');
  return options;
}

function git(repo, args) {
  return spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function readInputsDocument(inputsPath) {
  let raw;
  try {
    raw = fs.readFileSync(inputsPath, 'utf8');
  } catch (error) {
    throw new Error(`REFUSED: unreadable inputs ${inputsPath}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`REFUSED: unreadable inputs ${inputsPath}: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`REFUSED: unreadable inputs ${inputsPath}: expected an object`);
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'inputs')) {
    throw new Error(`REFUSED: unreadable inputs ${inputsPath}: missing "inputs"`);
  }
  if (!Array.isArray(parsed.inputs)) {
    throw new Error(`REFUSED: unreadable inputs ${inputsPath}: "inputs" must be an array`);
  }
  return parsed.inputs;
}

function ancestorCommand(repo, sha, target) {
  return `git -C ${repo} ${ANCESTOR_CMD} ${sha} ${target}`;
}

function checkEntry(repo, target, entry, index) {
  const id = entry && typeof entry === 'object' ? String(entry.id || '') : '';
  const sha = entry && typeof entry === 'object' ? String(entry.sha || '') : '';
  const label = id || `<inputs[${index}]>`;
  if (!id || !GIT_OID.test(sha)) {
    return {
      ok: false,
      message:
        `NOT-LANDED id=${label} sha=${sha || '<missing>'} target=${target} ` +
        `command=${ancestorCommand(repo, sha || '<missing-sha>', target)} ` +
        `(entry must supply id and a full Git OID)`,
    };
  }
  const result = git(repo, ['merge-base', '--is-ancestor', sha, target]);
  const command = ancestorCommand(repo, sha, target);
  if (result.error) {
    return {
      ok: false,
      message:
        `NOT-LANDED id=${id} sha=${sha} target=${target} command=${command} ` +
        `(${result.error.message})`,
    };
  }
  if (result.status === 0) return { ok: true, id, sha };
  const detail = String(result.stderr || '').trim();
  return {
    ok: false,
    message:
      `NOT-LANDED id=${id} sha=${sha} target=${target} command=${command}` +
      (detail ? ` (${detail})` : ''),
  };
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
    const entries = readInputsDocument(options.inputs);
    const failures = [];
    for (let index = 0; index < entries.length; index += 1) {
      const result = checkEntry(repo, options.target, entries[index], index);
      if (!result.ok) failures.push(result.message);
    }
    if (failures.length > 0) {
      stderr.write(`${failures.join('\n')}\n`);
      return 1;
    }
    stdout.write(
      `LANDED ${entries.length} input(s) target=${options.target} ` +
      `command=git -C ${repo} ${ANCESTOR_CMD} <sha> ${options.target}\n`,
    );
    return 0;
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`);
    usage(stderr);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, parseArgs };
