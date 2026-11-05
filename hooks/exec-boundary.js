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

// Split a shell command into command segments. Not a shell parser: it tracks
// quotes, backslash escapes and heredocs only. Separators (newline ; & | ( ) and
// backtick) end a segment; inside quotes they are neutralised to \u0001 (except
// `$(` / backtick inside double quotes, which the shell executes, so they still
// split). Heredoc bodies (<<W, <<'W', <<-W) are dropped up to the closing W line.
function commandSegments(cmd) {
  const NEUTRAL = '\u0001';
  const segs = [];
  let cur = '';
  let quote = '';
  const pending = []; // heredoc delimiters awaiting their body
  const flush = () => { if (cur.trim()) segs.push(cur); cur = ''; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) { quote = ''; cur += c; continue; }
      if (quote === '"' && c === '\\') { cur += c + (cmd[i + 1] === undefined ? '' : NEUTRAL); i++; continue; }
      if (quote === '"' && (c === '`' || (c === '$' && cmd[i + 1] === '('))) { flush(); if (c === '$') i++; continue; }
      cur += /[;&|\n<>()`]/.test(c) ? NEUTRAL : c;
      continue;
    }
    if (c === '\\') {
      const n = cmd[i + 1];
      if (n === '\n') cur += ' ';
      else if (n !== undefined) cur += /[;&|()`'"<>\s]/.test(n) ? NEUTRAL : n;
      i++;
      continue;
    }
    if (c === '\'' || c === '"') { quote = c; cur += c; continue; }
    if (c === '#' && (cur === '' || /\s$/.test(cur))) { while (i < cmd.length && cmd[i] !== '\n') i++; i--; continue; }
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      const m = cmd.slice(i + 2).match(/^(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|([^\s;&|<>()]+))/);
      if (m) {
        pending.push({ dash: m[1] === '-', word: m[2] ?? m[3] ?? m[4] });
        i += 1 + m[0].length;
        continue;
      }
    }
    if (c === '\n') {
      flush();
      while (pending.length) {
        const { dash, word } = pending.shift();
        for (;;) {
          if (i + 1 >= cmd.length) break;
          const eol = cmd.indexOf('\n', i + 1);
          const line = cmd.slice(i + 1, eol === -1 ? cmd.length : eol);
          i = eol === -1 ? cmd.length : eol;
          if ((dash ? line.replace(/^\t+/, '') : line) === word) break;
        }
      }
      continue;
    }
    if (/[;&|()`]/.test(c)) { flush(); continue; }
    cur += c;
  }
  flush();
  return segs;
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
