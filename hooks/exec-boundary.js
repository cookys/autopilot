#!/usr/bin/env node
/**
 * exec-boundary — PreToolUse/Bash (opt-in)
 *
 * Non-LLM execution-boundary deny gate (four-layer Kernel rule K2,
 * project/plans/_archive/2026/08/2026-08-16-four-layer-redesign.md D3). The survey lesson it encodes: a
 * natural-language constraint the model agrees with is not an enforcement mechanism
 * (Replit incident — "the freeze lived only in the instructions"), and LLM verifiers are
 * narrative-steerable; this gate makes no LLM calls and cannot be argued with.
 *
 * Deny classes (allow-by-default outside them):
 *   E1 protected-ref force-push        — deliberate defense-in-depth OVERLAP with
 *                                        branch-protection.js (two hooks covering the same
 *                                        accident class is redundancy, not conflict). BOTH
 *                                        are opt-in: neither protects anything until
 *                                        enabled (oracle: check-hook-inventory.js)
 *   E2 recursive rm outside sanctioned roots — absolute/home paths not under cwd,
 *                                        $TMPDIR, /tmp, or configured sanctioned_roots
 *   E3 raw destructive SQL             — DROP TABLE / TRUNCATE in a shell command
 *   E4 sudo rm                         — root-privileged deletion
 *
 * Config (optional): .claude/execution-boundary-config.md — `key: value` lines:
 *   protected_refs: main|master|develop     (regex alternation)
 *   sanctioned_roots: /tmp,/var/tmp         (comma list, prefixes)
 *   allow_sql: true                         (disables E3, e.g. DB-tooling repos)
 * Enable: ~/.autopilot/config.json {"hooks":{"exec-boundary":true}} or
 *         AUTOPILOT_HOOK_EXEC_BOUNDARY=1.
 * Deny = stderr message naming the matched rule + exit 2. Internal errors fail open
 * (exit 0), matching sibling hooks.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isEnabled } = require('./_shared/opt-in');

if (!isEnabled('exec-boundary')) process.exit(0);

function readConfig() {
  const cfg = { protectedRefs: 'main|master', roots: [], allowSql: false };
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.claude', 'execution-boundary-config.md'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([a-z_]+):\s*(.+?)\s*$/);
      if (!m) continue;
      if (m[1] === 'protected_refs') cfg.protectedRefs = m[2];
      else if (m[1] === 'sanctioned_roots') cfg.roots = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      else if (m[1] === 'allow_sql') cfg.allowSql = m[2] === 'true';
    }
  } catch { /* no config — shipped defaults */ }
  return cfg;
}

// ── E2 command splitter: mask the inert spans, scan everything else ──────────────────
//
// DESIGN (final shape after three review generations; do not reopen it as a false DENY).
// A hand-written splitter that enumerates the ACTIVE shell constructs never converged:
// each review round found another executed rm it skipped (arithmetic with a command
// substitution inside, process substitution, continuation lines, comments and escaped
// backticks inside backticks, heredoc state across recursion, <<$'EOF', bare ((..))).
// So the model is inverted. Only a small CLOSED set of spans is provably inert and is
// masked (their text can never be executed):
//   - single-quoted text '..' and ANSI-C $'..' (only \' and \\ matter for its end);
//   - the LITERAL text of a double-quoted string (the $( ), backtick, $(( )) and ${ }
//     inside it stay active);
//   - the body of a heredoc, and only when the operator is << or <<- (never <<<), it is
//     not inside arithmetic, the delimiter word is quoted (<<'X' <<"X" <<\X <<E"OF") and
//     the terminator line exists;
//   - a # comment at top level (outside every substitution), to the end of the line.
// Everything else is ACTIVE and scanned: unquoted or unterminated heredoc bodies,
// arithmetic, process substitution, $( ), backticks (comments inside them included).
// \<newline> is deleted (nothing inserted) everywhere except inside single quotes.
// A quote with no closing quote is not a span: the quote char is dropped and the rest is
// read as active text. The rm decision (E2 loop below) then splits in two:
//   - top level: a simple-command rm judged by the literal-target scope rules;
//   - nested (inside $( ), backticks, (( )) / $(( )), <( ) / >( ), or active heredoc text):
//     any recursive rm is DENIED whatever its target looks like.
// This is a deliberate fail-closed trade: an rm that merely sits in an active nested span
// (e.g. `echo $(rm -rf ./build)`, an unquoted heredoc that describes rm) is refused even
// when it would be harmless. Quote the heredoc delimiter (<<'EOF') to write rm prose.
// Not seen, as before: rm fed through xargs / find -exec / `bash -c` strings or a heredoc
// piped to a shell, and command words built by expansion ($RM, ${a:-rm}).
// Nesting deeper than MAX_DEPTH fails closed (E2-nesting) so a pathological command can
// neither overflow the JS stack nor hide an rm.
const NEUTRAL = '\u0001';
const MAX_DEPTH = 64;
class DepthError extends Error {}
// Text that cannot split a segment, start a quote or substitution, or break a token.
const inert = (t) => t.replace(/[\s;&|<>()`'"{}\\]/g, NEUTRAL);

// Closing backtick of the backtick span at s[i] (escapes: \` \\ \$ are unescaped, as the
// shell does before parsing the body). Returns { inner, end } (end = s.length if open).
function backtick(s, i) {
  let inner = '';
  for (let j = i + 1; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\' && j + 1 < s.length) {
      const n = s[j + 1];
      inner += (n === '`' || n === '\\' || n === '$') ? n : ch + n;
      j++;
    } else if (ch === '`') return { inner, end: j };
    else inner += ch;
  }
  return { inner, end: s.length };
}

// Heredoc delimiter word at s[j]; returns { word, quoted, end } or null.
function heredocWord(s, j) {
  let word = '';
  let quoted = false;
  const start = j;
  if (s[j] === '$' && (s[j + 1] === '\'' || s[j + 1] === '"')) j++; // <<$'EOF' <<$"EOF"
  while (j < s.length && !/[\s;&|<>()]/.test(s[j])) {
    const ch = s[j];
    if (ch === '\'' || ch === '"') {
      const k = s.indexOf(ch, j + 1);
      if (k === -1) return null;
      word += s.slice(j + 1, k);
      quoted = true;
      j = k + 1;
    } else if (ch === '\\') {
      if (j + 1 >= s.length) return null;
      word += s[j + 1];
      quoted = true;
      j += 2;
    } else { word += ch; j++; }
  }
  return j === start ? null : { word, quoted, end: j };
}

const push = (st, text, nested, sub) => st.segs.push({ text, nested, sub });

// Body of an UNQUOTED heredoc: literal text whose expansions run. The text is nested
// active text (any recursive rm in it is denied); $( ), backticks and ${ } are scanned.
function scanBody(text, c, st) {
  const t = text.replace(/\\\n/g, '');
  let cur = '';
  let sub = false;
  const out = () => { if (cur.trim()) push(st, cur, true, sub); cur = ''; sub = false; };
  const next = { nested: true, depth: c.depth + 1 };
  for (let k = 0; k < t.length; k++) {
    const ch = t[k];
    if (ch === '\\' && k + 1 < t.length) { cur += t[k + 1] === '\n' ? '' : t[k + 1]; k++; continue; }
    if (ch === '\n') { out(); continue; }
    if (ch === '$' && t[k + 1] === '(') { k = scan(t, k + 2, { ...next, term: ')', noHere: t[k + 2] === '(' }, st); cur += '$(' + NEUTRAL; sub = true; continue; }
    if (ch === '`') { const b = backtick(t, k); scan(b.inner, 0, { ...next, term: '' }, st); k = b.end; cur += '$(' + NEUTRAL; sub = true; continue; }
    if (ch === '$' && t[k + 1] === '{' && t.indexOf('}', k + 2) !== -1) { k = scan(t, k + 2, { ...next, term: '}', word: true }, st); cur += '${' + NEUTRAL; continue; }
    cur += ch;
  }
  out();
}

// Consume the bodies of the heredocs queued on the line ending at s[nl]; return the
// index of the last consumed newline (nl itself when nothing was consumed). A heredoc
// whose terminator line is never found is not a body: everything stays active.
function readBodies(s, nl, pending, missing, c, st) {
  let p = nl;
  while (pending.length) {
    const { dash, word, quoted } = pending.shift();
    const key = (dash ? '-' : '') + word;
    if (missing.has(key)) { pending.length = 0; return p; }
    const body = [];
    let q = p;
    let found = false;
    while (q + 1 < s.length) {
      const eol = s.indexOf('\n', q + 1);
      const line = s.slice(q + 1, eol === -1 ? s.length : eol);
      q = eol === -1 ? s.length : eol;
      if ((dash ? line.replace(/^\t+/, '') : line) === word) { found = true; break; }
      body.push(line);
    }
    if (!found) { missing.add(key); pending.length = 0; return p; }
    p = q;
    if (!quoted) scanBody(body.join('\n'), c, st);
  }
  return p;
}

// Double-quoted string starting after the opening quote. Literal text is masked; the
// substitutions inside stay active. Returns { text, end, sub }, end = closing quote index.
function dquote(s, i, c, st) {
  let out = '';
  let sub = false;
  const next = { nested: true, depth: c.depth + 1 };
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === '"') return { text: out, end: j, sub };
    if (ch === '\\') {
      const n = s[j + 1];
      if (n === '\n') { j++; continue; }
      if (n !== undefined) { out += NEUTRAL + (/[$`"\\]/.test(n) ? '' : inert(n)); j++; }
      continue;
    }
    if (ch === '$' && s[j + 1] === '(') { j = scan(s, j + 2, { ...next, term: ')', noHere: s[j + 2] === '(' }, st); out += '$(' + NEUTRAL; sub = true; continue; }
    if (ch === '`') { const b = backtick(s, j); scan(b.inner, 0, { ...next, term: '' }, st); j = b.end; out += '$(' + NEUTRAL; sub = true; continue; }
    if (ch === '$' && s[j + 1] === '{' && s.indexOf('}', j + 2) !== -1) { j = scan(s, j + 2, { ...next, term: '}', word: true }, st); out += '${' + NEUTRAL; continue; }
    out += inert(ch);
  }
  return { text: out, end: s.length, sub };
}

// Scan s from i until the terminator c.term ('' = end of input, ')' closes a $( ) / <( )
// / (( )) body at paren depth 0, '}' closes a ${ } body); finished segments go to
// st.segs as { text, nested, sub }. Returns the terminator index (s.length when absent).
// c: { term, nested, depth, noHere (arithmetic: << is a shift), word (${ }: nothing splits) }.
function scan(s, i, c, st) {
  if (c.depth > MAX_DEPTH) throw new DepthError('command nesting deeper than ' + MAX_DEPTH);
  const next = { nested: true, depth: c.depth + 1 };
  let cur = '';
  let sub = false; // the segment holds a substitution marker
  let inWord = false; // a word is open (so a following # is not a comment)
  let pd = 0;
  const pending = []; // heredoc delimiters awaiting their body (this scan only)
  const missing = new Set();
  const flush = () => { if (cur.trim()) push(st, cur, c.nested, sub); cur = ''; sub = false; inWord = false; };
  const crossed = (a, b) => { if (pending.length) { const n = s.indexOf('\n', a); if (n !== -1 && n < b) pending.length = 0; } };
  for (; i < s.length; i++) {
    const ch = s[i];
    if (c.term === ')' && ch === ')' && pd === 0) { flush(); return i; }
    if (c.term === '}' && ch === '}') return i;
    if (ch === '\\') {
      const n = s[i + 1];
      if (n === '\n') { i++; continue; } // continuation: deleted, nothing inserted
      if (n !== undefined) { cur += /[A-Za-z0-9_/.:@%+=,-]/.test(n) ? n : NEUTRAL; i++; }
      inWord = true;
      continue;
    }
    if (ch === '\'') {
      const k = s.indexOf('\'', i + 1);
      if (k !== -1) { cur += inert(s.slice(i + 1, k)); crossed(i, k); i = k; inWord = true; }
      continue; // an unterminated quote is dropped; the rest stays active
    }
    if (ch === '$' && s[i + 1] === '\'') { // ANSI-C quoting: backslash escapes the next char
      let k = i + 2;
      while (k < s.length && s[k] !== '\'') k += s[k] === '\\' ? 2 : 1;
      if (k < s.length) { cur += inert(s.slice(i + 2, k)); crossed(i, k); i = k; inWord = true; } else { cur += '$'; inWord = true; }
      continue;
    }
    if (ch === '"') {
      if (s.indexOf('"', i + 1) === -1) continue; // unterminated: dropped, rest stays active
      const r = dquote(s, i + 1, c, st);
      cur += r.text; sub = sub || r.sub; crossed(i, r.end); i = r.end; inWord = true;
      continue;
    }
    if (ch === '$' && s[i + 1] === '(') { // $( ), also $(( )): the body is nested active text
      const e = scan(s, i + 2, { ...next, term: ')', noHere: s[i + 2] === '(' }, st);
      cur += '$(' + NEUTRAL; sub = true; crossed(i, e); i = e; inWord = true;
      continue;
    }
    if (ch === '`') {
      const b = backtick(s, i);
      scan(b.inner, 0, { ...next, term: '' }, st);
      cur += '$(' + NEUTRAL; sub = true; crossed(i, b.end); i = b.end; inWord = true;
      continue;
    }
    if (ch === '$' && s[i + 1] === '{' && s.indexOf('}', i + 2) !== -1) {
      const e = scan(s, i + 2, { ...next, term: '}', word: true }, st);
      cur += '${' + NEUTRAL; crossed(i, e); i = e; inWord = true;
      continue;
    }
    if (c.word) { // inside ${ }: everything else is word text, nothing splits or starts
      cur += /[\s;&|<>()#]/.test(ch) ? NEUTRAL : ch;
      continue;
    }
    if (ch === '#' && !c.nested && !inWord) { while (i + 1 < s.length && s[i + 1] !== '\n') i++; continue; }
    if ((ch === '<' || ch === '>') && s[i + 1] === '(') { // process substitution: a word, not a separator
      const e = scan(s, i + 2, { ...next, term: ')' }, st);
      cur += '$(' + NEUTRAL; sub = true; crossed(i, e); i = e; inWord = true;
      continue;
    }
    if (ch === '<' && s[i + 1] === '<' && s[i + 2] === '<') { cur += '<<<'; i += 2; inWord = true; continue; } // here-string
    if (ch === '<' && s[i + 1] === '<' && !c.noHere) {
      const dash = s[i + 2] === '-';
      let j = i + 2 + (dash ? 1 : 0);
      while (s[j] === ' ' || s[j] === '\t') j++;
      const w = heredocWord(s, j);
      if (w) { pending.push({ dash, word: w.word, quoted: w.quoted }); i = w.end - 1; inWord = true; continue; }
    }
    if (ch === '\n') {
      flush();
      if (pending.length) i = readBodies(s, i, pending, missing, c, st);
      continue;
    }
    if (ch === '(') {
      if (s[i + 1] === '(' && cur.trim() === '' && !c.noHere) { // bare ((..)): arithmetic command, nested active text
        i = scan(s, i + 1, { ...next, term: ')', noHere: true }, st);
        continue;
      }
      flush(); pd++;
      continue;
    }
    if (ch === ')') { flush(); if (pd > 0) pd--; continue; }
    if (ch === '&' && (/[<>]$/.test(cur) || s[i + 1] === '>')) { cur += ch; inWord = true; continue; } // >&2 2>&1 &>f: redirection, not a separator
    if (ch === ';' || ch === '&' || ch === '|') { flush(); continue; }
    cur += ch;
    inWord = !/\s/.test(ch);
  }
  if (!c.word) flush();
  return s.length;
}

// Returns the segment texts, with .nested and .subst: Sets of segment indexes that sit in
// a nested active span, resp. hold a substitution marker (the rm-target checks key on them).
function commandSegments(cmd) {
  const st = { segs: [] };
  scan(cmd, 0, { term: '', nested: false, depth: 0 }, st);
  const out = st.segs.map((g) => g.text);
  out.nested = new Set(st.segs.flatMap((g, k) => (g.nested ? [k] : [])));
  out.subst = new Set(st.segs.flatMap((g, k) => (g.sub ? [k] : [])));
  return out;
}

function deny(rule, detail) {
  process.stderr.write(`exec-boundary DENY [${rule}]: ${detail}\n`);
  process.exit(2);
}

try {
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch { raw = fs.readFileSync('/dev/stdin', 'utf8'); }
  const input = JSON.parse(raw);
  const command = String((input.tool_input || {}).command || '');
  if (!command) process.exit(0);

  const cfg = readConfig();

  // E1 — protected-ref force-push (defense-in-depth with branch-protection.js)
  const protectedRe = new RegExp(`^(${cfg.protectedRefs})$`);
  const push = command.match(/\bgit\s+push\b[^|;&]*/);
  if (push && /(\s|^)(--force(-with-lease)?|-f)\b/.test(push[0])) {
    const target = push[0].match(/\bgit\s+push\b(?:\s+--?[\w-]+(?:=\S+)?)*\s+\S+\s+(?:\+)?([\w./-]+)/);
    if (target && protectedRe.test(target[1].replace(/^.*:/, ''))) {
      deny('E1-force-push', `force push to protected ref '${target[1]}' (also guarded by branch-protection.js)`);
    }
  }

  // E2 — recursive rm outside sanctioned roots. The design is the header block above
  // commandSegments (mask the inert spans, scan the rest). Top-level simple commands:
  // rm is judged only where it is the command word of a segment (after env assignments /
  // sudo / command / builtin / exec / reserved words) against the literal-target scope
  // rules; literal `cd <abs>` is tracked so `cd / && rm -rf *` judges `*` against `/`.
  // Nested active spans ($( ), backticks, (( )), <( ), unquoted heredoc text): any
  // recursive rm is denied, whatever its target.
  const roots = [
    os.tmpdir(), '/tmp', process.cwd(),
    ...(process.env.TMPDIR ? [process.env.TMPDIR] : []),
    ...cfg.roots,
  ].map((r) => path.resolve(r));
  const inRoots = (abs) => abs !== '/' && roots.some((r) => abs === r || abs.startsWith(r + path.sep));
  let simCwd = process.cwd();
  let segments;
  try { segments = commandSegments(command); } catch (e) {
    if (!(e instanceof DepthError)) throw e;
    deny('E2-nesting', `${e.message}; refused (fail closed) because the nested text cannot be judged`);
  }
  for (const [segIdx, seg] of segments.entries()) {
    const toks = seg.split(/\s+/).filter(Boolean);
    if (segments.nested.has(segIdx)) {
      const at = toks.findIndex((t) => t === 'rm' || t.endsWith('/rm'));
      if (at !== -1 && /(^|\s)-[a-zA-Z]*[rR]|--recursive/.test(toks.slice(at + 1).join(' '))) {
        deny('E2-recursive-rm', 'recursive rm inside a command substitution, arithmetic, process substitution or unquoted heredoc text is refused whatever its target (fail closed; quote the heredoc delimiter to write rm prose, or run the rm as a plain top-level command)');
      }
      continue;
    }
    let k = 0;
    while (k < toks.length) {
      if (/^[A-Za-z_]\w*=/.test(toks[k])) { k++; continue; }
      if (/^(\{|!|if|then|else|elif|do|while|until)$/.test(toks[k])) { k++; continue; }
      if (/^\d*(?:>>?|<|&>)\S+$/.test(toks[k])) { k++; continue; } // leading redirection: >f 2>&1
      if (/^\d*(?:>>?|<|&>)$/.test(toks[k])) { k += 2; continue; } // > file
      if (/^(sudo|command|builtin|exec|nohup|time|env)$/.test(toks[k])) {
        k++;
        while (k < toks.length && toks[k].startsWith('-')) k++;
        continue;
      }
      break;
    }
    const head = toks[k];
    if (head === 'cd') {
      const arg = (toks[k + 1] || '').replace(/["']/g, '');
      if (arg && !arg.includes('$') && arg !== '-') {
        simCwd = path.resolve(simCwd, arg.replace(/^~(?=$|\/)/, os.homedir()));
      }
      continue;
    }
    if (head !== 'rm' && !/\/rm$/.test(head || '')) continue;
    const rest = toks.slice(k + 1);
    if (!/(^|\s)-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive/.test(rest.join(' '))) continue;
    for (const tok of rest.filter((t) => !t.startsWith('-'))) {
      const expanded = tok.replace(/^~(?=$|\/)/, os.homedir()).replace(/["']/g, '');
      let abs;
      if (expanded.startsWith('/') || expanded.startsWith(os.homedir())) abs = path.resolve(expanded);
      else if (simCwd !== process.cwd() && !expanded.startsWith('$')) abs = path.resolve(simCwd, expanded); // after a literal cd
      else continue; // relative = inside cwd
      if (!inRoots(abs)) {
        deny('E2-recursive-rm', `recursive rm targets '${tok}' outside sanctioned roots (cwd, tmp, configured sanctioned_roots)`);
      }
    }
  }

  // E3 — raw destructive SQL
  if (!cfg.allowSql && /\b(DROP\s+TABLE|TRUNCATE(\s+TABLE)?)\b/i.test(command)) {
    deny('E3-destructive-sql', 'raw DROP TABLE/TRUNCATE in a shell command (set allow_sql: true in .claude/execution-boundary-config.md if this repo legitimately does this)');
  }

  // E4 — root-privileged deletion (command-position anchored, same rationale as E2)
  if (/(?:^|[;&|]\s*|\$\(\s*|`\s*)sudo\s+rm\b/.test(command)) {
    deny('E4-sudo-rm', 'root-privileged deletion');
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`exec-boundary error: ${e.message}\n`);
  process.exit(0);
}
