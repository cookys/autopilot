'use strict';

// review-packets.js — packet sets for ranges too big for one review packet.
//
// A packet set splits a base..head range BY PATH without hiding any path: every changed file is in
// exactly one packet, each packet is its own review phase (`<set>-<id>`), and the set check in
// check-phase-review-receipt.js (--packets) proves the cover. This module is the shared, side-effect
// free part: file validation, the changed-path list, the packet diff and the cover comparison.
// It is deliberately NOT an exclusion mechanism — see exclude-allowlist.js, which stays the only
// place that decides what a review may leave out. Plan: docs/plans/2026-10-11-review-packet-mode.md.

const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PACKETS_SCHEMA = 'autopilot.review-packets/1';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/;

function validId(id) {
  return typeof id === 'string' && ID_RE.test(id) && !id.includes('..');
}

function packetPhase(set, id) {
  return `${set}-${id}`;
}

function validPath(p) {
  if (typeof p !== 'string' || !p || p !== p.trim()) return false;
  if (p.startsWith('/') || p.endsWith('/') || p.includes('\0') || p.includes('\n')) return false;
  if (p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  return true;
}

// Parse + validate packets.json text. Returns { ok, errors, set, packets (id -> [paths]), sha256 }.
function parsePackets(text) {
  const errors = [];
  const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`packets file is not valid JSON: ${e.message}`], sha256 };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['packets file must be a JSON object'], sha256 };
  }
  if (obj.schema !== PACKETS_SCHEMA) errors.push(`schema must be '${PACKETS_SCHEMA}'`);
  if (!validId(obj.set)) errors.push(`set '${obj.set}' is not a valid id`);
  const packets = {};
  if (!obj.packets || typeof obj.packets !== 'object' || Array.isArray(obj.packets) || Object.keys(obj.packets).length === 0) {
    errors.push('packets must be a non-empty object of id -> [paths]');
  } else {
    const owner = new Map();
    for (const [id, list] of Object.entries(obj.packets)) {
      if (!validId(id)) { errors.push(`packet id '${id}' is not valid`); continue; }
      if (!Array.isArray(list) || list.length === 0) { errors.push(`packet '${id}' must list at least one path`); continue; }
      const seen = new Set();
      for (const p of list) {
        if (!validPath(p)) { errors.push(`packet '${id}': '${p}' is not an exact repo-relative file path (no directories, '..', or absolute paths)`); continue; }
        if (seen.has(p)) { errors.push(`packet '${id}': duplicate path '${p}'`); continue; }
        seen.add(p);
        if (owner.has(p)) errors.push(`overlap: '${p}' is in both packet '${owner.get(p)}' and packet '${id}'`);
        else owner.set(p, id);
      }
      packets[id] = [...seen].sort();
    }
  }
  return { ok: errors.length === 0, errors, set: obj.set, packets, sha256 };
}

function loadPacketsFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, errors: [`cannot read packets file ${file}: ${e.message}`] };
  }
  return parsePackets(text);
}

function union(packets) {
  const all = new Set();
  for (const list of Object.values(packets)) for (const p of list) all.add(p);
  return all;
}

function git(repoRoot, args, opts = {}) {
  return spawnSync('git', ['--literal-pathspecs', ...args], {
    cwd: repoRoot || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

// Sorted changed paths of base..head (renames split into delete + add so the list is the set of
// files a packet must own).
function rangeNames(repoRoot, base, head) {
  const res = git(repoRoot, ['diff', '--no-renames', '--name-only', '-z', `${base}..${head}`]);
  if (res.status !== 0) throw new Error(`git diff --name-only ${base}..${head} failed: ${res.stderr || res.stdout}`);
  return res.stdout.split('\0').filter(Boolean).sort();
}

// The diff a packet's seats review: base..head restricted to exactly the packet's files.
function packetDiff(repoRoot, base, head, paths) {
  const res = git(repoRoot, ['diff', '--no-renames', `${base}..${head}`, '--', ...paths]);
  if (res.status !== 0) throw new Error(`git diff ${base}..${head} (packet) failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

// Compare the changed list against the packet cover. exact=true (generation 1 / set check):
// the union must EQUAL the list. exact=false (later generations): the list must be inside the union.
function coverErrors(names, packets, exact) {
  const errors = [];
  const cover = union(packets);
  const have = new Set(names);
  for (const n of names) if (!cover.has(n)) errors.push(`missing: '${n}' changed in the range but is in no packet`);
  if (exact) for (const p of cover) if (!have.has(p)) errors.push(`extra: '${p}' is in a packet but did not change in the range`);
  return errors;
}

module.exports = {
  PACKETS_SCHEMA,
  validId,
  packetPhase,
  parsePackets,
  loadPacketsFile,
  union,
  rangeNames,
  packetDiff,
  coverErrors,
};
