'use strict';

// BL-0146 D1: eligibility and sets for an incremental review of a returned review-only campaign.
// Plan: docs/plans/2026-10-17-review-only-campaign-fix-increment.md (sections 2.1-2.3, 2.5, 2.6).
//
// Pure with respect to the engine: input is Git (a repo + three shas) and the stored prior round,
// output is either `{ mode: 'full', reason }` or the sets an incremental round reviews. Nothing here
// dispatches, writes a store, or is called from the engine main flow yet (D2-D4 wire it).
// ADR-0001: every set is re-derived from Git on each call; no flag or stored list is trusted.
//
// Each fallback guard is a single line ending in `// guard:<reason>` written as `if ((cond)) ...`.
// hooks/tests/review-increment.test.sh mutates exactly those lines (in a temp copy) as its
// negative controls, so keep that shape when editing.

const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REASONS = Object.freeze([
  'opt_in_off',
  'no_carriable_seat',
  'prior_round_incremental',
  'prior_path_removed',
  'finding_unmapped',
  'base_changed',
  'roster_changed',
  'spec_changed',
  'verify_cmd_changed',
  'verification_red',
  'changed_ratio',
  'delta_packet_size',
  'reference_cap',
  'recheck_content_size',
  'shared_surface',
]);

const DEFAULT_LIMITS = Object.freeze({
  increment_max_changed_ratio: 0.5,
  increment_delta_packet_bytes: 256 * 1024,
  increment_recheck_content_bytes: 200 * 1024,
  increment_reference_cap: 20,
  // Bounds on the textual reference scan. Exceeding one means "cannot decide" -> full.
  increment_scan_file_bytes: 512 * 1024,
  increment_scan_files: 20000,
  increment_scan_total_bytes: 64 * 1024 * 1024,
});

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

const SHARED_BASENAME = /^(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml|bun\.lockb?|Cargo\.(toml|lock)|go\.(mod|sum)|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|requirements[^/]*\.txt|setup\.(py|cfg)|Gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|Makefile|GNUmakefile|Dockerfile|tsconfig[^/]*\.json|jest\.config\.[cm]?js|\.nvmrc|\.node-version|\.tool-versions|\.npmrc|Jenkinsfile|\.gitlab-ci\.yml|azure-pipelines\.ya?ml)$/;
const SHARED_PATH = [
  /^\.github\/(workflows|actions)\//,
  /^\.circleci\//,
  /^\.buildkite\//,
  /(^|\/)schemas?\//,
  /\.schema\.json$/,
  /\.(proto|xsd|graphql)$/,
];

const STOP_SYMBOLS = new Set([
  'main', 'init', 'test', 'data', 'name', 'type', 'args', 'item', 'list', 'node', 'self', 'this',
  'that', 'from', 'default', 'return', 'async', 'await', 'const', 'function', 'class', 'true',
  'false', 'null', 'undefined', 'else', 'then', 'catch', 'finally', 'value', 'values', 'result',
  'error', 'path', 'file', 'text', 'line', 'lines', 'options', 'input', 'output', 'state',
]);

// A "the question did not change" comparison needs both sides present: undefined === undefined
// must not read as unchanged.
const sameStr = (a, b) => typeof a === 'string' && a !== '' && a === b;

function inputError(message) {
  const error = new Error(`review_increment_input_invalid: ${message}`);
  error.code = 'review_increment_input_invalid';
  return error;
}

// GIT_DIFF_OPTS would change every diff's bytes; drop it from the child environment.
function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIFF_OPTS;
  return env;
}

function git(repo, args, opts = {}) {
  try {
    return execFileSync(
      'git',
      ['--no-pager', '--literal-pathspecs', '-c', 'core.quotepath=false', '-c', 'diff.algorithm=myers',
        '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.renames=false',
        '-c', 'diff.indentHeuristic=true', '-c', 'core.autocrlf=false',
        '-c', 'diff.ignoreSubmodules=none', '-c', 'diff.interHunkContext=0',
        '-c', 'diff.suppressBlankEmpty=false', '-c', 'diff.orderFile=/dev/null', '-C', repo, ...args],
      { maxBuffer: GIT_MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'], env: gitEnv(), ...opts },
    );
  } catch (error) {
    throw inputError(`git ${args.slice(0, 2).join(' ')} failed: ${String(error.stderr || error.message).trim().slice(0, 200)}`);
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Pinned diff settings: --binary/--full-index make a binary change hash by content (without them two
// different binary edits both print "Binary files differ" and hash alike); the prefixes and -c
// overrides below stop a user's git config from changing the bytes that get hashed.
const DIFF_FLAGS = [
  '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--binary', '--full-index',
  '--src-prefix=a/', '--dst-prefix=b/', '-U3', '--ignore-submodules=none',
];

function diffPaths(repo, from, to) {
  const out = git(repo, ['diff', '--no-renames', '--ignore-submodules=none', '--name-only', '-z', from, to]).toString('utf8');
  return out.split('\0').filter(Boolean);
}

function pathDiff(repo, from, to, paths) {
  return git(repo, ['diff', ...DIFF_FLAGS, from, to, '--', ...paths]);
}

// file_digest(P) = sha256(cumulative diff of P from `base` to `head`); null when P has no diff.
function computeFileDigests(repo, base, head) {
  const digests = new Map();
  for (const p of diffPaths(repo, base, head)) {
    digests.set(p, sha256(pathDiff(repo, base, head, [p])));
  }
  return digests;
}

// A7: a carried verdict is valid for P only while P's digest at the new head equals the digest
// recorded with the prior artifact. Recomputed from Git here, never read from a flag.
// `carried` is [{ path, file_digest }]; returns the entries that no longer match.
function verifyCarriedDigests(repo, base, head, carried) {
  const current = computeFileDigests(repo, base, head);
  return (carried || []).filter((e) => !e || current.get(e.path) !== e.file_digest);
}

function splitSections(diffText) {
  const sections = [];
  let cur = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: null, minus: null, added: [], removed: [] };
      sections.push(cur);
    } else if (cur) {
      if (line.startsWith('--- ')) cur.minus = line.slice(4);
      else if (line.startsWith('+++ ')) {
        const plus = line.slice(4);
        const pick = plus !== '/dev/null' ? plus : cur.minus;
        if (pick) cur.path = pick.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
      } else if (line.startsWith('+')) cur.added.push(line.slice(1));
      else if (line.startsWith('-')) cur.removed.push(line.slice(1));
    }
  }
  return sections.filter((s) => s.path);
}

const DECL = [
  /\b(?:function\*?|class|interface|enum|struct|trait|def|fn|func|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)/g,
  /^\s*(?:async\s+|static\s+|public\s+|private\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:\{|:\s*\w+\s*\{)/gm,
];
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'with']);

function declaredSymbols(text) {
  const out = new Set();
  for (const re of DECL) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const s = m[1];
      if (s.length >= 4 && !KEYWORDS.has(s) && !STOP_SYMBOLS.has(s)) out.add(s);
    }
  }
  return out;
}

function identifiers(text) {
  return new Set(text.match(/[A-Za-z_$][\w$]*/g) || []);
}

function pathTokens(text) {
  const bases = new Set();
  const stems = new Set();
  for (const tok of text.match(/[A-Za-z0-9_.\-/]+/g) || []) {
    const base = tok.split('/').pop();
    if (!base) continue;
    bases.add(base);
    const stem = base.replace(/\.[^.]*$/, '');
    if (stem.length >= 4) stems.add(stem);
  }
  return { bases, stems };
}

const baseOf = (p) => p.split('/').pop();
const stemOf = (p) => baseOf(p).replace(/\.[^.]*$/, '');

function readBlobs(repo, entries) {
  // entries: [{ sha }]; one cat-file process. Returns Map sha -> Buffer.
  const out = new Map();
  if (entries.length === 0) return out;
  const raw = git(repo, ['cat-file', '--batch'], { input: `${[...new Set(entries.map((e) => e.sha))].join('\n')}\n` });
  let pos = 0;
  while (pos < raw.length) {
    const nl = raw.indexOf(0x0a, pos);
    if (nl < 0) break;
    const [sha, type, sizeStr] = raw.slice(pos, nl).toString('utf8').split(' ');
    if (type === 'missing') { pos = nl + 1; continue; }
    const size = Number(sizeStr);
    out.set(sha, raw.slice(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
  return out;
}

function listTree(repo, head) {
  const raw = git(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', head]).toString('utf8');
  const entries = [];
  for (const rec of raw.split('\0').filter(Boolean)) {
    const tab = rec.indexOf('\t');
    const [mode, type, sha, size] = rec.slice(0, tab).split(/\s+/);
    entries.push({ mode, type, sha, size: size === '-' ? 0 : Number(size), path: rec.slice(tab + 1) });
  }
  return entries;
}

function isSharedSurface(p, extra) {
  if (SHARED_BASENAME.test(baseOf(p))) return true;
  if (SHARED_PATH.some((re) => re.test(p))) return true;
  return (extra || []).some((t) => p === t || p.startsWith(`${t.replace(/\/$/, '')}/`));
}

function verifyCmdTargets(verifyCmd, treeEntries) {
  const files = new Set(treeEntries.map((e) => e.path));
  const dirs = new Set();
  for (const p of files) {
    let i = p.lastIndexOf('/');
    while (i > 0) { dirs.add(p.slice(0, i)); i = p.lastIndexOf('/', i - 1); }
  }
  const targets = [];
  for (const raw of String(verifyCmd || '').split(/[\s;&|<>()]+/)) {
    const tok = raw.replace(/^['"]|['"]$/g, '').replace(/^\.\//, '').replace(/\/$/, '');
    if (!tok || tok.startsWith('-')) continue;
    if (files.has(tok) || dirs.has(tok)) targets.push(tok);
  }
  return targets;
}

function normalizeFindingPath(p) {
  if (typeof p !== 'string') return null;
  const clean = p.replace(/:\d+(:\d+)?$/, '').replace(/^\.\//, '');
  if (!clean || clean.startsWith('/') || clean.split('/').includes('..')) return null;
  return clean;
}

function blobExists(repo, rev, filePath) {
  try {
    git(repo, ['cat-file', '-e', `${rev}:${filePath}`]);
    return true;
  } catch (error) {
    return false;
  }
}

function renameMap(repo, from, to) {
  const raw = git(repo, ['diff', '-M', '--ignore-submodules=none', '--name-status', '-z', from, to]).toString('utf8').split('\0');
  const map = new Map();
  for (let i = 0; i < raw.length;) {
    const status = raw[i++];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const oldP = raw[i++]; const newP = raw[i++];
      if (status[0] === 'R') map.set(oldP, newP);
    } else i += 1;
  }
  return map;
}

const full = (reason) => ({ mode: 'full', reason });

function evaluateReturnIncrement(input) {
  const {
    repo, baseSha, priorHead, newHead, returnReview, prior, current,
  } = input || {};
  if (typeof repo !== 'string' || !repo) throw inputError('repo is required');
  for (const [k, v] of [['baseSha', baseSha], ['priorHead', priorHead], ['newHead', newHead]]) {
    if (typeof v !== 'string' || !SHA.test(v)) throw inputError(`${k} must be a full commit sha`);
  }
  if (!prior || typeof prior !== 'object' || !current || typeof current !== 'object') {
    throw inputError('prior and current are required');
  }
  const limits = { ...DEFAULT_LIMITS, ...(input.limits || {}) };
  const seats = Array.isArray(prior.seats) ? prior.seats : [];

  // 1. contract opt-in
  if ((returnReview !== 'incremental')) return full('opt_in_off'); // guard:opt_in_off
  // 2. at least one seat carries (per seat, not per round)
  const carriableSeats = seats.filter((s) => s && s.carriable === true);
  if ((carriableSeats.length === 0)) return full('no_carriable_seat'); // guard:no_carriable_seat
  // 3. a conclusion is carried only from a full round (never through two hops)
  if ((prior.mode !== 'full')) return full('prior_round_incremental'); // guard:prior_round_incremental

  try {
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', priorHead, newHead], { stdio: 'ignore' });
  } catch (error) {
    throw inputError('priorHead is not an ancestor of newHead');
  }

  const digests0 = computeFileDigests(repo, baseSha, priorHead);
  const digests1 = computeFileDigests(repo, baseSha, newHead);
  const union = new Set([...digests0.keys(), ...digests1.keys()]);
  const changed = [...union].filter((p) => digests0.get(p) !== digests1.get(p)).sort();
  const changedSet = new Set(changed);

  // 4. every open finding maps to a path in the cumulative base..new_head diff
  const renames = renameMap(repo, priorHead, newHead);
  const findings = [];
  let unmapped = false;
  let priorPathRemoved = false;
  for (const seat of carriableSeats) {
    if (!Array.isArray(seat.findings)) unmapped = true; // a malformed findings list is never "no findings"
    for (const f of Array.isArray(seat.findings) ? seat.findings : []) {
      const p = normalizeFindingPath(f && f.path);
      let mapped = null;
      if (p !== null) {
        // Git, not a stored flag: the path is a rename source in priorHead..newHead, or a blob at priorHead that is gone at newHead.
        if (renames.has(p) || (blobExists(repo, priorHead, p) && !blobExists(repo, newHead, p))) priorPathRemoved = true;
        if (digests1.has(p)) mapped = p;
        else if (renames.has(p) && digests1.has(renames.get(p))) mapped = renames.get(p);
      }
      if (mapped === null) unmapped = true;
      findings.push({ seat_id: seat.seatId, id: f && f.id, path: mapped });
    }
  }
  if ((priorPathRemoved)) return full('prior_path_removed'); // guard:prior_path_removed
  if ((unmapped)) return full('finding_unmapped'); // guard:finding_unmapped

  // 5. the question did not change
  if ((!sameStr(prior.baseSha, baseSha))) return full('base_changed'); // guard:base_changed
  if ((!sameStr(prior.rosterDigest, current.rosterDigest))) return full('roster_changed'); // guard:roster_changed
  if ((!sameStr(prior.specDigest, current.specDigest))) return full('spec_changed'); // guard:spec_changed
  if ((!sameStr(prior.verifyCmd, current.verifyCmd))) return full('verify_cmd_changed'); // guard:verify_cmd_changed
  // 6. verification at the new head is green (anything but literal true fails closed)
  if ((current.verificationGreen !== true)) return full('verification_red'); // guard:verification_red

  // 7. size guard
  const ratio = union.size === 0 ? 0 : changed.length / union.size;
  if ((ratio > limits.increment_max_changed_ratio)) return full('changed_ratio'); // guard:changed_ratio
  const deltaDiff = git(repo, ['diff', ...DIFF_FLAGS, priorHead, newHead]);
  if ((deltaDiff.length > limits.increment_delta_packet_bytes)) return full('delta_packet_size'); // guard:delta_packet_size

  // Re-check set (section 2.3 step 1): changed + open-finding paths + references in both directions.
  const why = new Map();
  const addWhy = (p, reason) => {
    if (!why.has(p)) why.set(p, []);
    if (!why.get(p).includes(reason)) why.get(p).push(reason);
  };
  for (const p of changed) addWhy(p, 'changed');
  for (const f of findings) if (f.path) addWhy(f.path, `open_finding:${f.id}`);

  const tree = listTree(repo, newHead);
  const treeByPath = new Map(tree.map((e) => [e.path, e]));
  // Symlinks are scanned too: the blob is the target string.
  const scannable = tree.filter((e) => e.type === 'blob');
  const sections = splitSections(deltaDiff.toString('utf8'));
  const removedSymbols = new Map(); // symbol -> changed path it was removed from
  const addedBy = new Map(); // changed path -> { tokens, idents }
  for (const s of sections) {
    for (const sym of declaredSymbols(s.removed.join('\n'))) if (!removedSymbols.has(sym)) removedSymbols.set(sym, s.path);
    const text = s.added.join('\n');
    const prev = addedBy.get(s.path);
    addedBy.set(s.path, { text: prev ? `${prev.text}\n${text}` : text });
  }
  for (const v of addedBy.values()) { v.tokens = pathTokens(v.text); v.idents = identifiers(v.text); }
  const changedBases = new Map();
  for (const p of changed) {
    changedBases.set(baseOf(p), p);
    if (stemOf(p).length >= 4) changedBases.set(stemOf(p), p);
  }

  const candidates = scannable.filter((e) => !changedSet.has(e.path));
  const refs = new Set();
  const tooBig = (candidates.length > limits.increment_scan_files);
  const scanTotal = candidates.reduce((n, e) => n + e.size, 0);
  let cannotScan = tooBig || scanTotal > limits.increment_scan_total_bytes;
  if (!cannotScan) {
    const blobs = readBlobs(repo, candidates);
    for (const e of candidates) {
      const buf = blobs.get(e.sha);
      if (!buf) { cannotScan = true; break; } // unreadable candidate: cannot decide
      if (buf.subarray(0, 8000).includes(0)) continue; // binary: no textual references
      // A text file over the per-file limit is not scanned, and not silently skipped either.
      if (e.size > limits.increment_scan_file_bytes) { cannotScan = true; break; }
      const text = buf.toString('utf8');
      const toks = pathTokens(text);
      const ids = identifiers(text);
      // (a) unchanged file that references a changed path or a symbol removed/renamed/re-signed.
      for (const [name, src] of changedBases) {
        if (toks.bases.has(name) || toks.stems.has(name)) { addWhy(e.path, `references_changed:${src}`); refs.add(e.path); }
      }
      for (const [sym, src] of removedSymbols) {
        if (ids.has(sym)) { addWhy(e.path, `references_removed_symbol:${sym}@${src}`); refs.add(e.path); }
      }
      // (b) unchanged file that a changed file references (path/import or a defined symbol it now uses).
      const defs = declaredSymbols(text);
      for (const [src, a] of addedBy) {
        if (!changedSet.has(src)) continue;
        if (a.tokens.bases.has(baseOf(e.path)) || a.tokens.stems.has(stemOf(e.path))) {
          addWhy(e.path, `referenced_by_changed:${src}`); refs.add(e.path);
        }
        for (const d of defs) {
          if (a.idents.has(d)) { addWhy(e.path, `referenced_by_changed:${src}:${d}`); refs.add(e.path); break; }
        }
      }
    }
  }
  if ((cannotScan || refs.size > limits.increment_reference_cap)) return full('reference_cap'); // guard:reference_cap

  // A path deleted at the new head is changed (it drives references) but is not re-check material.
  const recheckPaths = [...why.keys()].filter((p) => treeByPath.has(p)).sort();
  const inDiff = recheckPaths.filter((p) => digests1.has(p));
  const asFile = recheckPaths.filter((p) => !digests1.has(p) && treeByPath.has(p) && treeByPath.get(p).type === 'blob');
  const recheckDiff = inDiff.length > 0 ? pathDiff(repo, baseSha, newHead, inDiff) : Buffer.alloc(0);
  const fileBlobs = readBlobs(repo, asFile.map((p) => treeByPath.get(p)));
  const recheckFiles = asFile.map((p) => ({ path: p, content: fileBlobs.get(treeByPath.get(p).sha) || Buffer.alloc(0) }));
  const contentBytes = recheckDiff.length + recheckFiles.reduce((n, f) => n + f.content.length, 0);
  if ((contentBytes > limits.increment_recheck_content_bytes)) return full('recheck_content_size'); // guard:recheck_content_size

  // 8. shared-surface guard on what the delta touches
  const deltaPaths = diffPaths(repo, priorHead, newHead);
  const extra = [...verifyCmdTargets(current.verifyCmd, tree), ...(input.acceptancePaths || []), ...(input.sharedSurfacePaths || [])];
  if ((deltaPaths.some((p) => isSharedSurface(p, extra)))) return full('shared_surface'); // guard:shared_surface

  const emptyDigest = sha256(Buffer.alloc(0));
  const recheck = recheckPaths.map((p) => ({
    path: p,
    file_digest: digests1.get(p) || emptyDigest,
    blob: treeByPath.has(p) ? treeByPath.get(p).sha : null,
    source: digests1.has(p) ? 'diff' : 'file',
    why: why.get(p),
  }));
  const recheckSet = new Set(recheckPaths);
  const carried = [...union].filter((p) => !changedSet.has(p) && !recheckSet.has(p)).sort()
    .map((p) => ({ path: p, file_digest: digests1.get(p) }));

  const seatPackets = {};
  for (const s of seats) if (s) seatPackets[s.seatId] = s.carriable === true ? 'incremental' : 'full';

  return {
    mode: 'incremental',
    reason: null,
    base_sha: baseSha,
    prior_head: priorHead,
    new_head: newHead,
    delta: { diff: deltaDiff, digest: sha256(deltaDiff), bytes: deltaDiff.length },
    changed,
    carried,
    recheck,
    recheck_diff: recheckDiff,
    recheck_diff_paths: inDiff,
    recheck_files: recheckFiles,
    recheck_content_bytes: contentBytes,
    seat_packets: seatPackets,
    findings,
  };
}

module.exports = {
  REASONS,
  DEFAULT_LIMITS,
  evaluateReturnIncrement,
  computeFileDigests,
  pathDiff,
  verifyCarriedDigests,
  isSharedSurface,
};
