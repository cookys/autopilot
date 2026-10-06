#!/usr/bin/env node
'use strict';
// lib/semver.js — the one version parser for release tooling.
//
// Accepts `X.Y.Z` and `X.Y.Z-(alpha|beta|rc).N` (N a non-negative integer, no
// leading zeros except `0`). Orders per semver §11: a pre-release sorts below
// its release; alpha < beta < rc; N compares numerically. Built-ins only.
//
// Library: parse(v) -> {major,minor,patch,pre:null|{tag,n},raw} | null
//          isValid(v), compare(a,b) (strings or parsed; throws on malformed),
//          format(parsed), badgeEscape(v) ('-' -> '--', shields.io),
//          VERSION_PATTERN (regex source, unanchored, for embedding).
// CLI (one JSON object on stdout, diagnostics on stderr):
//   node scripts/lib/semver.js compare A B    -> {"cmp":-1|0|1}   exit 0; 2 if malformed
//   node scripts/lib/semver.js valid V        -> {"valid":bool}   exit 0 valid, 1 invalid
//   node scripts/lib/semver.js badge V        -> {"badge":"..."}  exit 0; 2 if malformed
//   node scripts/lib/semver.js from-json FILE -> {"version":"..."} exit 0; 1 if absent/invalid
// Exit codes: 0 ok, 1 invalid/absent (valid, from-json), 2 usage or malformed input.

const NUM = '(?:0|[1-9]\\d*)';
const VERSION_PATTERN = `${NUM}\\.${NUM}\\.${NUM}(?:-(?:alpha|beta|rc)\\.${NUM})?`;
const VERSION_RE = new RegExp(`^(${NUM})\\.(${NUM})\\.(${NUM})(?:-(alpha|beta|rc)\\.(${NUM}))?$`);
const PRE_RANK = { alpha: 0, beta: 1, rc: 2 };

function parse(value) {
  if (typeof value !== 'string') return null;
  const m = VERSION_RE.exec(value.trim());
  if (!m) return null;
  const nums = [m[1], m[2], m[3]].map(Number);
  if (!nums.every(Number.isSafeInteger)) return null;
  let pre = null;
  if (m[4]) {
    const n = Number(m[5]);
    if (!Number.isSafeInteger(n)) return null;
    pre = { tag: m[4], n };
  }
  return { major: nums[0], minor: nums[1], patch: nums[2], pre, raw: value.trim() };
}

function isValid(value) {
  return parse(value) !== null;
}

function coerce(v) {
  const p = typeof v === 'string' ? parse(v) : v;
  if (!p || typeof p !== 'object') throw new Error(`malformed version: ${JSON.stringify(v)}`);
  return p;
}

function compare(a, b) {
  const pa = coerce(a);
  const pb = coerce(b);
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  if (pa.pre.tag !== pb.pre.tag) return PRE_RANK[pa.pre.tag] < PRE_RANK[pb.pre.tag] ? -1 : 1;
  if (pa.pre.n !== pb.pre.n) return pa.pre.n < pb.pre.n ? -1 : 1;
  return 0;
}

function format(p) {
  const x = coerce(p);
  const base = `${x.major}.${x.minor}.${x.patch}`;
  return x.pre ? `${base}-${x.pre.tag}.${x.pre.n}` : base;
}

// shields.io static badges: a literal '-' in a segment is written '--'.
function badgeEscape(value) {
  return String(value).replace(/-/g, '--');
}

module.exports = { VERSION_PATTERN, parse, isValid, compare, format, badgeEscape };

function main(argv) {
  const [cmd, ...rest] = argv;
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  if (cmd === 'compare' && rest.length === 2) {
    if (!isValid(rest[0]) || !isValid(rest[1])) {
      console.error(`semver: malformed version in: ${rest.join(' ')}`);
      return 2;
    }
    out({ cmp: compare(rest[0], rest[1]) });
    return 0;
  }
  if (cmd === 'valid' && rest.length === 1) {
    const v = isValid(rest[0]);
    out({ valid: v });
    return v ? 0 : 1;
  }
  if (cmd === 'badge' && rest.length === 1) {
    if (!isValid(rest[0])) { console.error(`semver: malformed version: ${rest[0]}`); return 2; }
    out({ badge: badgeEscape(rest[0]) });
    return 0;
  }
  if (cmd === 'from-json' && rest.length === 1) {
    try {
      const v = JSON.parse(require('fs').readFileSync(rest[0], 'utf8')).version;
      if (isValid(v)) { out({ version: v }); return 0; }
    } catch (e) { console.error(`semver: ${e.message}`); }
    out({ version: null });
    return 1;
  }
  console.error('usage: semver.js compare A B | valid V | badge V | from-json FILE');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
