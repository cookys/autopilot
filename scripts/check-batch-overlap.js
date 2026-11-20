#!/usr/bin/env node
'use strict';
// check-batch-overlap.js — refuse a parallel batch whose tickets share a file.
//
// Two tickets that both edit src/register.ts waste one result (codeforge v74).
// Run this on the briefs before dispatch-batch hands them out in parallel.
//
// Usage:
//   node scripts/check-batch-overlap.js --repo <dir> <brief.md> ...
//   node scripts/check-batch-overlap.js --repo <dir> --manifest <file.json>
//   repeatable --allow <glob> adds exemptions on top of the default platforms/**
//
// A brief's scope is the comma-separated list on the line that starts with "Scope:".
// Text in parentheses after an entry is a comment and is dropped. The ticket id is
// the brief basename without extension. A brief with no Scope: line is exit 2.
// Manifest shape: { "tickets": [ { "id": "A", "scope": ["src/register.ts"] } ] }.
//
// A literal path is itself. A glob (*, **, ?) is expanded against
// `git -C <repo> ls-files` and also compared pattern-to-pattern, so a file that
// is not tracked yet still collides. ** is any depth including zero directories,
// * is one path segment, ? is one character. No npm dependencies.
//
// Exempt by default: platforms/** (generated mirrors). --allow <glob> is repeatable.
//
// stdout JSON { schema, tickets, overlaps:[{a,b,files}] } via fs.writeSync.
// stderr: one line per overlapping file,
//   overlap: ticket A and ticket B both edit src/register.ts
// Exit 0 no overlap, 1 overlap, 2 usage or input error.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA = 'autopilot.batch-overlap/1';
const DEFAULT_ALLOW = ['platforms/**'];

function usage(msg) {
  if (msg) process.stderr.write(`check-batch-overlap: ${msg}\n`);
  process.stderr.write(
    'usage: check-batch-overlap.js --repo <dir> [--allow <glob>]... <brief.md>...\n' +
    '       check-batch-overlap.js --repo <dir> [--allow <glob>]... --manifest <file.json>\n',
  );
  process.exit(2);
}

function fail(msg) {
  process.stderr.write(`check-batch-overlap: ${msg}\n`);
  process.exit(2);
}

// Glob language: ** any depth incl. zero directories, * one segment, ? one char.
// Segment-token product: two patterns overlap when some path matches both.
function tokens(glob) {
  const parts = String(glob).split('/');
  const out = [];
  for (const seg of parts) {
    if (seg === '**') {
      if (out.length && out[out.length - 1].type === 'dstar') continue;
      out.push({ type: 'dstar' });
    } else {
      out.push({ type: 'seg', pat: seg });
    }
  }
  return out;
}

function segOverlap(a, b) {
  const memo = new Map();
  function rec(i, j) {
    const k = i + ',' + j;
    if (memo.has(k)) return memo.get(k);
    let ans;
    if (i === a.length && j === b.length) ans = true;
    else if (i < a.length && a[i] === '*' && j < b.length && b[j] === '*') {
      ans = rec(i + 1, j) || rec(i, j + 1) || rec(i + 1, j + 1);
    } else if (i < a.length && a[i] === '*') {
      ans = rec(i + 1, j) || (j < b.length && rec(i, j + 1));
    } else if (j < b.length && b[j] === '*') {
      ans = rec(i, j + 1) || (i < a.length && rec(i + 1, j));
    } else if (i < a.length && j < b.length && (a[i] === '?' || b[j] === '?' || a[i] === b[j])) {
      ans = rec(i + 1, j + 1);
    } else ans = false;
    memo.set(k, ans);
    return ans;
  }
  return rec(0, 0);
}

function globsOverlap(ga, gb) {
  const A = tokens(ga);
  const B = tokens(gb);
  const memo = new Map();
  function rec(i, j) {
    const k = i + ',' + j;
    if (memo.has(k)) return memo.get(k);
    let ans = false;
    const aDone = i >= A.length;
    const bDone = j >= B.length;
    if (aDone && bDone) ans = true;
    else if (!aDone && A[i].type === 'dstar' && !bDone && B[j].type === 'dstar') {
      ans = rec(i + 1, j) || rec(i, j + 1) || rec(i + 1, j + 1);
    } else if (!aDone && A[i].type === 'dstar') {
      ans = rec(i + 1, j);
      if (!bDone && B[j].type === 'seg') ans = ans || rec(i, j + 1);
    } else if (!bDone && B[j].type === 'dstar') {
      ans = rec(i, j + 1);
      if (!aDone && A[i].type === 'seg') ans = ans || rec(i + 1, j);
    } else if (!aDone && !bDone && segOverlap(A[i].pat, B[j].pat)) {
      ans = rec(i + 1, j + 1);
    }
    memo.set(k, ans);
    return ans;
  }
  return rec(0, 0);
}

function isGlob(p) {
  return /[*?]/.test(p);
}

function concreteFrom(glob, emptyStar) {
  let s = glob;
  if (emptyStar) {
    s = s.replace(/\/\*\*\//g, '/');
    s = s.replace(/^\*\*\//, '');
    s = s.replace(/\/\*\*$/, '');
    s = s.replace(/\*\*/g, '');
  } else {
    s = s.replace(/\/\*\*\//g, '/x/');
    s = s.replace(/^\*\*\//, 'x/');
    s = s.replace(/\/\*\*$/, '/x');
    s = s.replace(/\*\*/g, 'x');
  }
  s = s.replace(/\*/g, 'x');
  s = s.replace(/\?/g, 'x');
  s = s.replace(/\/{2,}/g, '/').replace(/^\//, '').replace(/\/$/, '');
  return s;
}

function witness(ga, gb) {
  if (!isGlob(ga) && globsOverlap(ga, gb)) return ga;
  if (!isGlob(gb) && globsOverlap(gb, ga)) return gb;
  const cands = [
    concreteFrom(ga, false), concreteFrom(ga, true),
    concreteFrom(gb, false), concreteFrom(gb, true),
  ];
  for (const c of cands) {
    if (c && globsOverlap(ga, c) && globsOverlap(gb, c)) return c;
  }
  return null;
}

function parseScopeText(text) {
  const stripped = text.replace(/\s*\([^)]*\)/g, '');
  return stripped.split(',').map((s) => s.trim()).filter(Boolean);
}

function scopeFromBrief(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { fail(`cannot read ${file}: ${e.message}`); }
  const line = text.split(/\r?\n/).find((l) => l.startsWith('Scope:'));
  if (!line) fail(`no Scope: line in ${file}`);
  return parseScopeText(line.slice('Scope:'.length));
}

function loadTickets(briefs, manifest) {
  if (manifest) {
    let data;
    try { data = JSON.parse(fs.readFileSync(manifest, 'utf8')); }
    catch (e) { fail(`cannot read manifest ${manifest}: ${e.message}`); }
    if (!data || !Array.isArray(data.tickets)) fail('manifest missing tickets[]');
    return data.tickets.map((t, i) => {
      if (!t || typeof t.id !== 'string' || !t.id) fail(`manifest ticket ${i} missing id`);
      if (!Array.isArray(t.scope)) fail(`manifest ticket ${t.id} missing scope[]`);
      const scope = [];
      for (const entry of t.scope) scope.push(...parseScopeText(String(entry)));
      return { id: t.id, scope };
    });
  }
  if (briefs.length === 0) usage('pass brief files or --manifest');
  return briefs.map((file) => ({
    id: path.basename(file).replace(/\.[^.]+$/, ''),
    scope: scopeFromBrief(file),
  }));
}

function gitFiles(repo) {
  const r = spawnSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'buffer' });
  if (r.status !== 0) {
    fail(`git ls-files failed in ${repo}: ${(r.stderr || '').toString('utf8').trim()}`);
  }
  const buf = r.stdout || Buffer.alloc(0);
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      if (i > start) out.push(buf.subarray(start, i).toString('utf8'));
      start = i + 1;
    }
  }
  if (start < buf.length) out.push(buf.subarray(start).toString('utf8'));
  return out;
}

function covered(scope, tracked) {
  const set = new Set();
  for (const pat of scope) {
    // Literals go through the same matcher so a broken matcher cannot stay green.
    if (!isGlob(pat) && globsOverlap(pat, pat)) set.add(pat);
    for (const f of tracked) {
      if (globsOverlap(pat, f)) set.add(f);
    }
  }
  return set;
}

function exempt(file, allows) {
  return allows.some((g) => globsOverlap(g, file));
}

function overlapsOf(tickets, tracked, allows) {
  const coveredBy = tickets.map((t) => covered(t.scope, tracked));
  const overlaps = [];
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const files = new Set();
      for (const f of coveredBy[i]) {
        if (coveredBy[j].has(f) && !exempt(f, allows)) files.add(f);
      }
      for (const pa of tickets[i].scope) {
        for (const pb of tickets[j].scope) {
          if (!globsOverlap(pa, pb)) continue;
          const w = witness(pa, pb);
          if (w && !exempt(w, allows)) files.add(w);
        }
      }
      if (files.size) {
        overlaps.push({
          a: tickets[i].id,
          b: tickets[j].id,
          files: [...files].sort(),
        });
      }
    }
  }
  return overlaps;
}

function main(argv) {
  let repo = null;
  let manifest = null;
  const allows = DEFAULT_ALLOW.slice();
  const briefs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${a} requires a value`);
      return argv[++i];
    };
    if (a === '--repo') repo = next();
    else if (a === '--manifest') manifest = next();
    else if (a === '--allow') allows.push(next());
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown argument: ${a}`);
    else briefs.push(a);
  }
  if (!repo) usage('--repo is required');
  if (manifest && briefs.length) usage('pass briefs or --manifest, not both');
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) fail(`repo is not a directory: ${repo}`);

  const tickets = loadTickets(briefs, manifest);
  const tracked = gitFiles(repo);
  const overlaps = overlapsOf(tickets, tracked, allows);
  const body = JSON.stringify({ schema: SCHEMA, tickets: tickets.length, overlaps }) + '\n';
  fs.writeSync(1, body);
  for (const o of overlaps) {
    for (const f of o.files) {
      fs.writeSync(2, `overlap: ticket ${o.a} and ticket ${o.b} both edit ${f}\n`);
    }
  }
  process.exit(overlaps.length ? 1 : 0);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { globsOverlap, parseScopeText, main };
