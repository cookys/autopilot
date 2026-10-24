#!/usr/bin/env node
'use strict';
// sed-split.js <script> -- split one sed script into its individual commands, one per NUL-terminated
// record on stdout, so sed_mutate / sed_mutant (hooks/tests/lib.sh) can require EVERY command to change
// the file. Handles newline- and ';'-separated commands, addresses (N, $, /re/, \cREc, 0,/re/, a,b, !),
// s/y with any delimiter and escaped delimiters, d p D P g G h H x n N q Q = l (single letter), a/i/c
// (text to end of line) and {...} blocks (kept as ONE unit). Exit 3 when the script cannot be parsed, so
// the caller fails loudly instead of guessing.

function split(src) {
  const out = []; let i = 0; const n = src.length;
  const fail = () => { throw new Error('cannot parse sed script near: ' + src.slice(i, i + 40)); };
  const readDelim = (d) => { // after the opening delimiter; returns index after the closing one
    while (i < n && src[i] !== d) { if (src[i] === '\\') i++; i++; }
    if (i >= n) fail();
    i++;
  };
  while (i < n) {
    while (i < n && /[\s;]/.test(src[i])) i++;
    if (i >= n) break;
    const start = i;
    // address(es)
    for (let k = 0; k < 2; k++) {
      if (src[i] === '/') { i++; readDelim('/'); }
      else if (src[i] === '\\') { i++; const d = src[i]; i++; readDelim(d); }
      else if (/[0-9$]/.test(src[i])) { if (src[i] === '$') i++; else while (i < n && /[0-9]/.test(src[i])) i++; }
      else break;
      if (src[i] === 'I' || src[i] === 'M') i++;
      if (src[i] === ',') { i++; continue; }
      break;
    }
    while (i < n && /[ \t]/.test(src[i])) i++;
    if (src[i] === '!') { i++; while (i < n && /[ \t]/.test(src[i])) i++; }
    const c = src[i];
    if (c === undefined) fail();
    if (c === 's') {
      i++; const d = src[i]; i++; readDelim(d); readDelim(d);
      while (i < n && /[gpIiMmeE0-9w]/.test(src[i])) { if (src[i] === 'w') { i = n; break; } i++; }
    } else if (c === 'y') {
      i++; const d = src[i]; i++; readDelim(d); readDelim(d);
    } else if (c === 'a' || c === 'i' || c === 'c') {
      i++; while (i < n && src[i] !== '\n') { if (src[i] === '\\' && src[i + 1] === '\n') i++; i++; }
    } else if (c === '{') {
      let depth = 0;
      while (i < n) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } else if (src[i] === '\\') i++; i++; }
      if (depth !== 0) fail();
    } else if ('dDpPgGhHxnNqQ=l'.includes(c)) {
      i++;
    } else { fail(); }
    out.push(src.slice(start, i).trim());
  }
  return out;
}

if (require.main === module) {
  try {
    const parts = split(process.argv[2] || '');
    if (!parts.length) throw new Error('empty sed script');
    process.stdout.write(parts.join('\0') + '\0');
  } catch (e) { console.error('sed-split: ' + e.message); process.exit(3); }
}
module.exports = { split };
