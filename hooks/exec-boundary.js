#!/usr/bin/env node
/**
 * exec-boundary — PreToolUse/Bash (opt-in)
 *
 * Non-LLM execution-boundary deny gate (four-layer Kernel rule K2,
 * docs/plans/2026-08-16-four-layer-redesign.md D3). The survey lesson it encodes: a
 * natural-language constraint the model agrees with is not an enforcement mechanism
 * (Replit incident — "the freeze lived only in the instructions"), and LLM verifiers are
 * narrative-steerable; this gate makes no LLM calls and cannot be argued with.
 *
 * Deny classes (allow-by-default outside them):
 *   E1 protected-ref force-push        — deliberate defense-in-depth OVERLAP with the
 *                                        default-on branch-protection.js (an opt-in and a
 *                                        default-on hook covering the same accident class
 *                                        is redundancy, not conflict)
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

  // E2 — recursive rm outside sanctioned roots. Anchored to COMMAND POSITION
  // (start / ; / && / || / | / $( / backtick) so prose mentions inside quoted
  // arguments (e.g. commit messages) do not false-positive — found live, twice,
  // on this repo's own D5 commit (execution notes, 2026-08-16).
  const rm = command.match(/(?:^|[;&|]\s*|\$\(\s*|`\s*)rm\s+((?:-[a-zA-Z-]+\s+)*)([^|;&]*)/);
  if (rm && /(^|\s)-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive/.test(rm[1] + ' ' + command)) {
    const roots = [
      os.tmpdir(), '/tmp', process.cwd(),
      ...(process.env.TMPDIR ? [process.env.TMPDIR] : []),
      ...cfg.roots,
    ].map((r) => path.resolve(r));
    for (const tok of rm[2].split(/\s+/).filter((t) => t && !t.startsWith('-'))) {
      const expanded = tok.replace(/^~(?=$|\/)/, os.homedir()).replace(/["']/g, '');
      if (!expanded.startsWith('/') && !expanded.startsWith(os.homedir())) continue; // relative = inside cwd
      const abs = path.resolve(expanded);
      if (abs === '/' || !roots.some((r) => abs === r || abs.startsWith(r + path.sep))) {
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
