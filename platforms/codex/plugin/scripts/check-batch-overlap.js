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
// `git -C <repo> ls-files` and also intersected pattern-to-pattern, so a file
// that is not tracked yet still collides. ** is any depth including zero
// directories, * is one path segment, ? is one character. Intersection is the
// product of the two segment automata and yields a concrete witness path.
// No npm dependencies.
//
// Exempt by default: platforms/** (generated mirrors). --allow <glob> is repeatable.
// An exemption clears an overlap only when every path in the intersection is
// exempt (the intersection is a subset of the allow list). A witness that is
// itself exempt is discarded and the search continues. If that subset cannot
// be decided, the overlap is reported.
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

const OTHER = '\u0000other';
const SEARCH_LIMIT = 20000;

function globNfa(glob) {
  const toks = tokens(glob);
  const n = toks.length;
  const eps = Array.from({ length: n + 1 }, () => []);
  const segs = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < n; i++) {
    if (toks[i].type === 'dstar') {
      eps[i].push(i + 1);
      segs[i].push({ pat: null, to: i });
    } else {
      segs[i].push({ pat: toks[i].pat, to: i + 1 });
    }
  }
  return { eps, segs, accept: n };
}

function eclose(nfa, seed) {
  const out = new Set(seed);
  const st = [...seed];
  while (st.length) {
    const s = st.pop();
    for (const t of nfa.eps[s]) {
      if (!out.has(t)) { out.add(t); st.push(t); }
    }
  }
  return out;
}

function segNfa(pat) {
  const p = pat == null ? '?*' : pat;
  const eps = Array.from({ length: p.length + 1 }, () => []);
  const any = Array.from({ length: p.length + 1 }, () => []);
  const lit = Array.from({ length: p.length + 1 }, () => new Map());
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') { eps[i].push(i + 1); any[i].push(i); }
    else if (c === '?') any[i].push(i + 1);
    else {
      if (!lit[i].has(c)) lit[i].set(c, []);
      lit[i].get(c).push(i + 1);
    }
  }
  return { eps, any, lit, accept: p.length };
}

function segClose(nfa, seed) {
  const out = new Set(seed);
  const st = [...seed];
  while (st.length) {
    const s = st.pop();
    for (const t of nfa.eps[s]) {
      if (!out.has(t)) { out.add(t); st.push(t); }
    }
  }
  return out;
}

function segMove(nfa, set, sym) {
  const next = [];
  for (const s of set) {
    if (nfa.any[s].length) next.push(...nfa.any[s]);
    if (sym !== OTHER) {
      const hit = nfa.lit[s].get(sym);
      if (hit) next.push(...hit);
    }
  }
  return segClose(nfa, next);
}

function setKey(set) {
  return [...set].sort((a, b) => a - b).join(',');
}

// One concrete segment per distinct allow-subset it produces. OTHER stands for
// a character that is none of the literals in play, so the finite alphabet is
// exact for '*' / '?' / literals (no complement, no union).
function segmentMoves(patA, patB, allowNfas, allowSets) {
  const edges = [];
  for (let gi = 0; gi < allowNfas.length; gi++) {
    const closed = allowSets[gi];
    for (const s of closed) {
      for (const e of allowNfas[gi].segs[s]) edges.push({ gi, to: e.to, pat: e.pat });
    }
  }
  const na = segNfa(patA);
  const nb = segNfa(patB);
  const matchers = edges.map((e) => segNfa(e.pat));
  const lits = new Set();
  for (const p of [patA, patB, ...edges.map((e) => e.pat)]) {
    if (!p) continue;
    for (const c of p) if (c !== '*' && c !== '?') lits.add(c);
  }
  const alphabet = [...lits, OTHER];
  let fresh = 'x';
  for (const c of 'xyzabcdefghijklmnopqrstuvw0123456789') {
    if (!lits.has(c)) { fresh = c; break; }
  }
  const render = (syms) => syms.map((s) => (s === OTHER ? fresh : s)).join('');
  const start = [
    segClose(na, [0]),
    segClose(nb, [0]),
    ...matchers.map((m) => segClose(m, [0])),
  ];
  const q = [{ sets: start, syms: [] }];
  const seen = new Set([start.map(setKey).join('|')]);
  const bySig = new Map();
  let visits = 0;
  while (q.length) {
    if (++visits > SEARCH_LIMIT) return { undecided: true, moves: [] };
    const cur = q.shift();
    if (cur.sets[0].has(na.accept) && cur.sets[1].has(nb.accept)) {
      let sig = '';
      for (let i = 0; i < matchers.length; i++) sig += cur.sets[i + 2].has(matchers[i].accept) ? '1' : '0';
      const text = render(cur.syms);
      const prev = bySig.get(sig);
      if (prev === undefined || (prev === '' && text !== '')) bySig.set(sig, text);
    }
    for (const sym of alphabet) {
      const sets = [
        segMove(na, cur.sets[0], sym),
        segMove(nb, cur.sets[1], sym),
        ...matchers.map((m, i) => segMove(m, cur.sets[i + 2], sym)),
      ];
      const k = sets.map(setKey).join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ sets, syms: cur.syms.concat(sym) });
    }
  }
  const grouped = new Map();
  for (const [sig, text] of bySig) {
    if (text === '') continue;
    const dest = allowNfas.map(() => new Set());
    for (let i = 0; i < edges.length; i++) {
      if (sig[i] !== '1') continue;
      dest[edges[i].gi].add(edges[i].to);
    }
    const next = dest.map((set, gi) => eclose(allowNfas[gi], set));
    const key = next.map(setKey).join('|');
    const prev = grouped.get(key);
    if (!prev || prev.text.length > text.length) grouped.set(key, { text, next });
  }
  return { undecided: false, moves: [...grouped.values()] };
}

// A path both globs match that no allow-glob matches, or null when every
// common path is exempt (or there is no common path). undecided means the
// search budget ran out — the caller reports the overlap.
function nonExemptWitness(ga, gb, allows) {
  const A = globNfa(ga);
  const B = globNfa(gb);
  const Gs = allows.map(globNfa);
  const startAllow = Gs.map((g) => eclose(g, [0]));
  const q = [{ ia: 0, ib: 0, as: startAllow, parts: [] }];
  const seen = new Set(['0,0,' + startAllow.map(setKey).join('|')]);
  let sawExempt = false;
  let visits = 0;
  while (q.length) {
    if (++visits > SEARCH_LIMIT) return { kind: 'undecided', path: null };
    const cur = q.shift();
    const path = cur.parts.join('/');
    const aAcc = eclose(A, [cur.ia]).has(A.accept);
    const bAcc = eclose(B, [cur.ib]).has(B.accept);
    if (aAcc && bAcc && path !== '') {
      const exempt = Gs.some((g, i) => cur.as[i].has(g.accept));
      if (!exempt) return { kind: 'witness', path };
      sawExempt = true;
    }
    const push = (ia, ib, as, parts) => {
      const k = ia + ',' + ib + ',' + as.map(setKey).join('|');
      if (seen.has(k)) return;
      seen.add(k);
      q.push({ ia, ib, as, parts });
    };
    for (const t of A.eps[cur.ia]) push(t, cur.ib, cur.as, cur.parts);
    for (const t of B.eps[cur.ib]) push(cur.ia, t, cur.as, cur.parts);
    for (const ea of A.segs[cur.ia]) {
      for (const eb of B.segs[cur.ib]) {
        const moved = segmentMoves(ea.pat, eb.pat, Gs, cur.as);
        if (moved.undecided) return { kind: 'undecided', path: null };
        for (const m of moved.moves) push(ea.to, eb.to, m.next, cur.parts.concat(m.text));
      }
    }
  }
  return { kind: sawExempt ? 'exempt' : 'none', path: null };
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
          const found = nonExemptWitness(pa, pb, allows);
          if (found.kind === 'witness') files.add(found.path);
          else if (found.kind !== 'exempt') files.add(!isGlob(pa) ? pa : !isGlob(pb) ? pb : pa);
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
