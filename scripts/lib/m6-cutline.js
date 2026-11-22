'use strict';

// S3 plan upsert and S2 must route store writes through guardedStoreWrite.
// AUTOPILOT_M6_CUTLINE is an internal test-only override; production sets CUTLINE
// to the P3 merge day. Null means the cutline has not yet been set.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const CUTLINE = null;

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function isBeforeCutline(repo, relPath) {
  const cutline = process.env.AUTOPILOT_M6_CUTLINE || CUTLINE;
  if (!cutline) return false;
  const dates = git(repo, ['log', '--diff-filter=A', '--format=%cI', '--', relPath]);
  return dates.split('\n').filter(Boolean).some(date => date.slice(0, 10) < cutline);
}

function registryPath(repo) {
  return path.join(git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'autopilot', 'm6-registry.json');
}

function list(repo) {
  const file = registryPath(repo);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}

function isRegistered(repo, relPath) { return list(repo).includes(relPath); }
function register(repo, relPath) {
  if (isBeforeCutline(repo, relPath)) return false;
  const entries = list(repo);
  if (!entries.includes(relPath)) {
    entries.push(relPath);
    const file = registryPath(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entries, null, 2) + '\n');
  }
  return true;
}

function guardedStoreWrite(repo, relPath, doWrite) {
  if (isBeforeCutline(repo, relPath)) return { skipped: true };
  doWrite();
  register(repo, relPath);
  return { skipped: false };
}

module.exports = { CUTLINE, isBeforeCutline, register, isRegistered, list, guardedStoreWrite };
