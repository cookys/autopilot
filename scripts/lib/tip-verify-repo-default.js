#!/usr/bin/env node
'use strict';
// tip-verify-repo-default.js — the one reader of a repo's default tip-verify command.
//
// Reads `.claude/quality-gate-config.md` and returns the command list under
// `## Test Command`. Same rules the rail used to inline: a fenced ``` / ```bash /
// ```sh block, or a whole line that is one inline span `...`, kept only when the
// text is executable-looking and contains no <word> placeholder. A placeholder is
// skipped, not a precondition error (the brief fence is the path that refuses).
// Anything else, including prose and a numbered step with an inline span, is not
// a command.
//
// CLI (byte-for-byte with the old heredoc): 
//   node scripts/lib/tip-verify-repo-default.js <config-file>
//   stdout: JSON array of command strings, or nothing when there is no command.
//   No trailing newline. A missing file is the Node read error (non-zero).
//
// module.exports:
//   commandsFromText(text) -> string[]
//   commandsFromFile(file) -> string[]
//   repoName(originUrl, toplevel) -> the basename of the origin URL minus a
//     trailing .git, else the toplevel directory basename
//   graceRepoCount(file) -> repos.length, or 0 when missing or unreadable
//   removeFromGrace(file, okNames) -> remaining count; drops listed names that
//     are in okNames; never adds; a missing file stays missing and returns 0

const fs = require('fs');

function executableLooking(cmd) {
  const trimmed = String(cmd).trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  const token = trimmed.split(/\s+/)[0];
  if (token.startsWith('./') || token.startsWith('../') || token.startsWith('/')) return true;
  return /^[A-Za-z][A-Za-z0-9_+-]*$/.test(token);
}

function hasPlaceholder(s) {
  return /<[A-Za-z_][A-Za-z0-9_-]*>/.test(s);
}

function commandsFromText(text) {
  const lines = text.split(/\n/);
  let inSection = false;
  let fence = null;
  const cmds = [];
  for (const line of lines) {
    if (!inSection) {
      if (/^## Test Command\s*$/.test(line)) inSection = true;
      continue;
    }
    if (/^## /.test(line)) break;
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (fence !== null) fence = null;
      else {
        const lang = trimmed.slice(3).trim().split(/\s+/)[0] || '';
        fence = (lang === '' || lang === 'bash' || lang === 'sh') ? 'cmd' : 'other';
      }
      continue;
    }
    let candidate = null;
    if (fence === 'cmd') candidate = trimmed;
    else if (fence === null) {
      const m = trimmed.match(/^`([^`\n]+)`$/);
      if (m) candidate = m[1].trim();
    }
    if (candidate === null || !candidate || hasPlaceholder(candidate)) continue;
    if (executableLooking(candidate)) cmds.push(candidate);
  }
  return cmds;
}

function commandsFromFile(file) {
  return commandsFromText(fs.readFileSync(file, 'utf8'));
}

function leafName(p) {
  let s = String(p == null ? '' : p).trim();
  s = s.replace(/[/\\]+$/, '');
  if (!s) return '';
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

function repoName(originUrl, toplevel) {
  let name = '';
  if (String(originUrl || '').trim()) {
    name = leafName(originUrl);
    if (name.endsWith('.git')) name = name.slice(0, -4);
  }
  if (!name) name = leafName(toplevel);
  return name;
}

function graceRepoCount(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && Array.isArray(j.repos)) return j.repos.length;
  } catch (e) {
    return 0;
  }
  return 0;
}

function removeFromGrace(file, okNames) {
  const drop = new Set((okNames || []).filter((n) => typeof n === 'string' && n));
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return 0;
    throw e;
  }
  const j = JSON.parse(text);
  if (!j || !Array.isArray(j.repos)) throw new Error('grace file has no repos array');
  const before = j.repos.length;
  j.repos = j.repos.filter((r) => !(r && typeof r.name === 'string' && drop.has(r.name)));
  if (j.repos.length !== before) {
    const tmp = file + '.' + process.pid + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n');
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (ignore) { /* temp already gone */ }
      throw e;
    }
  }
  return j.repos.length;
}

module.exports = {
  commandsFromText,
  commandsFromFile,
  repoName,
  graceRepoCount,
  removeFromGrace,
  executableLooking,
  hasPlaceholder,
};

if (require.main === module) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    process.stderr.write('usage: node scripts/lib/tip-verify-repo-default.js <config-file>\n');
    process.exit(2);
  }
  const cmds = commandsFromFile(file);
  if (cmds.length) process.stdout.write(JSON.stringify(cmds));
}
