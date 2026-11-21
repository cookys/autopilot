#!/usr/bin/env node
/**
 * outbound-secret-scan.js — scan a payload BEFORE it is sent to an external engine
 * (dispatch-review.sh / dispatch-author.sh / dispatch-hetero.sh call it right before the runner spawn).
 *
 *   node outbound-secret-scan.js [--categories] [--allow FILE] FILE...
 *   Exit 0 clean, 1 hit, 2 unreadable (missing file). A NUL or non-UTF-8 file is binary: scanned as latin1 with a stderr note.
 *   Output: `<file>:<line>: <category>` per hit — NEVER the matched text. With
 *   --categories: one line, the sorted unique categories joined by commas.
 *
 * Categories: pem_key, bearer_token, token_prefix, url_credentials, long_base64, long_hex,
 *   number_run, b64_key32.
 * Token-prefix patterns (ghp_/sk-/xox...) are the shared hooks/_shared/secret-patterns.js
 * list; this file adds only the shapes that list does not cover (ported from alfred's
 * tools/outbound_scan.py rules).
 *
 * False-positive rule: a 43-char base64 key candidate must contain one of [0-9+/];
 * letters-only is an identifier (Kotlin test names, camelCase). Its boundary also
 * treats . _ - as token characters, so a path segment or identifier is not a key.
 *
 * Allowlist (known-public vectors): `.autopilot/outbound-scan-allow`, one line
 * `<sha256 of the exact matched token> <category> <reason>`; `#` comments allowed.
 * The sha is of the matched token only, so the rest of the file stays scanned.
 * Lookup: --allow FILE, else $AUTOPILOT_OUTBOUND_SCAN_ALLOW, else
 * <git toplevel or cwd>/.autopilot/outbound-scan-allow.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
// scripts/ copied without its sibling hooks/ (a test fixture or a standalone copy) has no shared token-prefix
// list: scan with the local shapes only and say so on stderr, instead of crashing into a bare "unreadable".
let secrets = { patterns: [] };
let prefixListMissing = false;
try { secrets = require('../../hooks/_shared/secret-patterns'); } catch { prefixListMissing = true; }

const LONG_RUN = 512;
const NUMBER_RUN = 64;

// A long run that is one repeated character or a short cycle (a filler line, a padding test) is not a key:
// flag it only when some 64-char window has key-like entropy (random hex ~3.8 bits/char, base64 ~5.7).
const WINDOW = 64;
const WINDOW_ENTROPY_MIN = 3.2;
function windowEntropy(w) {
  const counts = new Map();
  for (const ch of w) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const c of counts.values()) { const p = c / w.length; h -= p * Math.log2(p); }
  return h;
}
function looksRandom(run) {
  for (let i = 0; i + WINDOW <= run.length; i += WINDOW / 2) {
    if (windowEntropy(run.slice(i, i + WINDOW)) >= WINDOW_ENTROPY_MIN) return true;
  }
  return windowEntropy(run.slice(-WINDOW)) >= WINDOW_ENTROPY_MIN;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function loadAllow(file) {
  const set = new Set();
  if (!file) return set;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return set; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [sha, category] = line.split(/\s+/);
    if (/^[0-9a-f]{64}$/.test(sha || '') && category) set.add(`${sha} ${category}`);
  }
  return set;
}

function defaultAllowPath() {
  if (process.env.AUTOPILOT_OUTBOUND_SCAN_ALLOW) return process.env.AUTOPILOT_OUTBOUND_SCAN_ALLOW;
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const root = top.status === 0 ? top.stdout.trim() : process.cwd();
  return path.join(root, '.autopilot', 'outbound-scan-allow');
}

const RE_PEM = /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|KEY BLOCK)-----/;
const RE_BEARER = /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{20,}/i;
// user:password in a URL authority. Category only is emitted; the match itself stays internal.
const RE_URL_CRED = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/i;
const RE_LONG = new RegExp(`[A-Za-z0-9+/]{${LONG_RUN},}={0,2}`);
// 43 base64 chars, optional '=' pad; neighbours may not continue the token.
const RE_KEY32 = /(?<![A-Za-z0-9+/=._-])([A-Za-z0-9+/]{43})(?:=)?(?![A-Za-z0-9+/=._-])/g;
const RE_NUM = /^-?\d+(?:\.\d+)?$/;

/** Every match on one line. A fresh global regex so lastIndex cannot hide a later token. */
function eachMatch(re, line) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return line.matchAll(new RegExp(re.source, flags));
}

/** Scan decoded text. Returns [{line, category, token}] (token is for allowlisting only). */
function scanText(text, allow = new Set()) {
  const hits = [];
  const add = (line, category, token) => {
    if (allow.has(`${sha256(token)} ${category}`)) return;
    hits.push({ line, category, token });
  };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    for (const m of eachMatch(RE_PEM, line)) add(n, 'pem_key', m[0]);
    for (const m of eachMatch(RE_BEARER, line)) add(n, 'bearer_token', m[0]);
    for (const m of eachMatch(RE_URL_CRED, line)) add(n, 'url_credentials', m[0]);
    for (const { pattern } of secrets.patterns) {
      for (const m of eachMatch(pattern, line)) add(n, 'token_prefix', m[0]);
    }
    for (const m of eachMatch(RE_LONG, line)) {
      if (!looksRandom(m[0])) continue;
      add(n, /^[0-9a-fA-F]+$/.test(m[0]) ? 'long_hex' : 'long_base64', m[0]);
    }
    if (line.length >= NUMBER_RUN * 2 - 1) {
      let run = 0;
      let start = 0;
      let off = 0;
      for (const part of line.split(',')) {
        const t = part.replace(/^[\s[\](){}]+|[\s[\](){}]+$/g, '');
        if (RE_NUM.test(t)) {
          if (run === 0) start = off;
          run++;
          if (run === NUMBER_RUN) { add(n, 'number_run', line.slice(start, off + part.length)); break; }
        } else run = 0;
        off += part.length + 1;
      }
    }
    RE_KEY32.lastIndex = 0;
    let m;
    while ((m = RE_KEY32.exec(line))) {
      if (/[0-9+/]/.test(m[1])) add(n, 'b64_key32', m[0]);
    }
  }
  return hits;
}

/** Decode a buffer strictly: NUL or invalid UTF-8 returns null (the caller decides what binary means). */
function decodeStrict(buf) {
  if (buf.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return null; }
}

function main(argv) {
  let allowFile;
  let categoriesOnly = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow') allowFile = argv[++i];
    else if (argv[i] === '--categories') categoriesOnly = true;
    else if (argv[i] === '-h' || argv[i] === '--help') {
      process.stdout.write('Usage: outbound-secret-scan.js [--categories] [--allow FILE] FILE...\n');
      return 0;
    } else files.push(argv[i]);
  }
  if (files.length === 0) { process.stderr.write('outbound-secret-scan: no files\n'); return 2; }
  if (prefixListMissing) process.stderr.write('outbound-secret-scan: hooks/_shared/secret-patterns.js not found next to scripts/, token-prefix list skipped\n');
  const allow = loadAllow(allowFile || defaultAllowPath());
  const out = [];
  const cats = new Set();
  let unreadable = false;
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(f); } catch { out.push(`${f}: unreadable`); cats.add('unreadable'); unreadable = true; continue; }
    let text = decodeStrict(buf);
    if (text === null) {
      // An image or other binary attachment inside the prompt is not refused: every byte maps to one char
      // (latin1), so an ASCII token hidden in the binary is still found. One reason line on stderr.
      process.stderr.write(`outbound-secret-scan: ${f}: binary payload (NUL or not UTF-8), scanned as latin1, not refused\n`);
      text = buf.toString('latin1');
    }
    for (const h of scanText(text, allow)) { out.push(`${f}:${h.line}: ${h.category}`); cats.add(h.category); }
  }
  if (categoriesOnly) { if (cats.size) process.stdout.write([...cats].sort().join(',') + '\n'); }
  else if (out.length) process.stdout.write(out.join('\n') + '\n');
  return unreadable ? 2 : cats.size ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { scanText, decodeStrict, loadAllow, sha256 };
