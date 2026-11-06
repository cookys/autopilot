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

// Split a shell command into command segments. Not a shell parser: a small
// recursive scanner that knows quotes ('..', "..", $'..' with \' escapes), backslash
// escapes, `$( )` / backtick substitutions (also inside double quotes, where the
// body is a fresh command context: separators split and quotes nest), `$(( ))`
// arithmetic (skipped, so its `<<` is not a heredoc), here-strings `<<<` and
// heredocs. Separators (newline ; & | ( ) and backtick) end a segment; inside quotes
// they are neutralised to \u0001. Heredoc bodies are dropped up to the closing line,
// except that an UNQUOTED delimiter (<<W, <<-W) runs `$( )` / backticks in its body,
// so only those spans are scanned as commands; a quoted delimiter (<<'W', <<"W",
// <<\W, <<W"x") has a literal body and is dropped whole. A heredoc whose closing
// line is never found is not a body: scanning rewinds and the lines are judged as
// commands (fail closed).
const NEUTRAL = '\u0001';
const neut = (t) => t.replace(/[;&|\n<>()`]/g, NEUTRAL);

// Index of the last `)` of a `$((` ... `))` that starts at s[i] === '$', or -1.
function arithEnd(s, i) {
  let depth = 2;
  for (let k = i + 3; k < s.length; k++) {
    if (s[k] === '(') depth++;
    else if (s[k] === ')' && --depth === 0) return k;
  }
  return -1;
}

// Scan `$( )` / backtick spans of an unquoted-heredoc body as commands.
function scanBody(text, st) {
  const sub = { segs: st.segs, pending: [] };
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '\\') k++;
    else if (text[k] === '$' && text[k + 1] === '(' && text[k + 2] !== '(') k = scan(text, k + 2, ')', sub);
    else if (text[k] === '`') k = scan(text, k + 1, '`', sub);
  }
}

// Consume the bodies of the heredocs queued on the line ending at s[nl]; return the
// index of the last consumed newline (nl itself when nothing was consumed).
function readBodies(s, nl, st) {
  let p = nl;
  while (st.pending.length) {
    const { dash, word, quoted } = st.pending.shift();
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
    if (!found) { st.pending.length = 0; return p; } // rewind: not a body, judge the lines
    p = q;
    if (!quoted) scanBody(body.join('\n'), st);
  }
  return p;
}

// Double-quoted string starting after the opening quote; returns [text, index of closing quote].
function dquote(s, i, st) {
  let out = '';
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') return [out, i];
    if (c === '\\') { out += c + (s[i + 1] === undefined ? '' : NEUTRAL); i++; continue; }
    if (c === '$' && s[i + 1] === '(' && s[i + 2] === '(') {
      const e = arithEnd(s, i);
      if (e !== -1) { out += '0'; i = e; continue; }
    }
    if (c === '`') { out += '$'; i = scan(s, i + 1, '`', st); continue; }
    if (c === '$' && s[i + 1] === '(') { out += '$'; i = scan(s, i + 2, ')', st); continue; }
    out += neut(c);
  }
  return [out, s.length];
}

// Heredoc delimiter word at s[j]; returns { word, quoted, end } or null.
function heredocWord(s, j) {
  let word = '';
  let quoted = false;
  const start = j;
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

// Scan s from i until the terminator `term` ('' = end of input; ')' or '`' for a
// substitution body); every finished segment goes to st.segs. Returns the index of
// the terminator (s.length when absent).
function scan(s, i, term, st) {
  let cur = '';
  let depth = 0;
  const flush = () => { if (cur.trim()) st.segs.push(cur); cur = ''; };
  for (; i < s.length; i++) {
    const c = s[i];
    if (term === ')' && c === ')' && depth === 0) { flush(); return i; }
    if (term === '`' && c === '`') { flush(); return i; }
    if (c === '\\') {
      const n = s[i + 1];
      if (n === '\n') cur += ' ';
      else if (n !== undefined) cur += /[;&|()`'"<>\s]/.test(n) ? NEUTRAL : n;
      i++;
      continue;
    }
    if (c === '\'') {
      const k = s.indexOf('\'', i + 1);
      cur += '\'' + neut(s.slice(i + 1, k === -1 ? s.length : k)) + (k === -1 ? '' : '\'');
      i = k === -1 ? s.length : k;
      continue;
    }
    if (c === '$' && s[i + 1] === '\'') { // ANSI-C quoting: backslash escapes the next char
      let k = i + 2;
      let body = '';
      while (k < s.length && s[k] !== '\'') {
        if (s[k] === '\\' && k + 1 < s.length) { body += NEUTRAL + NEUTRAL; k += 2; } else { body += neut(s[k]); k++; }
      }
      cur += '$\'' + body + (k < s.length ? '\'' : '');
      i = k;
      continue;
    }
    if (c === '"') { const [t, k] = dquote(s, i + 1, st); cur += '"' + t + (k < s.length ? '"' : ''); i = k; continue; }
    if (c === '$' && s[i + 1] === '(' && s[i + 2] === '(') {
      const e = arithEnd(s, i);
      if (e !== -1) { cur += '0'; i = e; continue; }
    }
    if (c === '$' && s[i + 1] === '(') { cur += '$'; i = scan(s, i + 2, ')', st); continue; }
    if (c === '`') { cur += '$'; i = scan(s, i + 1, '`', st); continue; }
    if (c === '#' && (cur === '' || /\s$/.test(cur))) { while (i < s.length && s[i] !== '\n') i++; i--; continue; }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] === '<') { cur += ' '; i += 2; continue; } // here-string
    if (c === '<' && s[i + 1] === '<') {
      const dash = s[i + 2] === '-';
      let j = i + 2 + (dash ? 1 : 0);
      while (s[j] === ' ' || s[j] === '\t') j++;
      const w = heredocWord(s, j);
      if (w) {
        st.pending.push({ dash, word: w.word, quoted: w.quoted });
        i = w.end - 1;
        continue;
      }
    }
    if (c === '\n') {
      flush();
      if (st.pending.length) i = readBodies(s, i, st);
      continue;
    }
    if (c === '(') { flush(); depth++; continue; }
    if (c === ')') { flush(); if (depth > 0) depth--; continue; }
    if (/[;&|]/.test(c)) { flush(); continue; }
    cur += c;
  }
  flush();
  return s.length;
}

function commandSegments(cmd) {
  const st = { segs: [], pending: [] };
  scan(cmd, 0, '', st);
  return st.segs;
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

  // E2 — recursive rm outside sanctioned roots. The command is first split into
  // command segments (commandSegments: newline and shell separators; heredoc
  // bodies dropped; separators inside quotes neutralised), then rm is judged only
  // where it is the command word of a segment (after env assignments / sudo /
  // command / builtin / exec ...). Prose mentions in quoted arguments, heredoc
  // bodies and later lines are therefore not rm targets (live false DENYs
  // 2026-08-16 and 2026-11-05). Literal `cd <abs>` is tracked so `cd / && rm -rf *`
  // judges `*` against `/`.
  // Deliberately still DENY (fail closed): rm after a real separator, in `$( )` or
  // backticks (also inside double quotes, where the shell runs them), `rm` fed by
  // `xargs`/`find -exec`/`bash -c` strings is NOT seen (never was), and any
  // unterminated quote or heredoc is read to the end as one segment.
  const roots = [
    os.tmpdir(), '/tmp', process.cwd(),
    ...(process.env.TMPDIR ? [process.env.TMPDIR] : []),
    ...cfg.roots,
  ].map((r) => path.resolve(r));
  const inRoots = (abs) => abs !== '/' && roots.some((r) => abs === r || abs.startsWith(r + path.sep));
  let simCwd = process.cwd();
  for (const seg of commandSegments(command)) {
    const toks = seg.split(/\s+/).filter(Boolean);
    let k = 0;
    while (k < toks.length) {
      if (/^[A-Za-z_]\w*=/.test(toks[k])) { k++; continue; }
      if (/^(sudo|command|builtin|exec|nohup|time)$/.test(toks[k])) {
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
    if (head !== 'rm') continue;
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
