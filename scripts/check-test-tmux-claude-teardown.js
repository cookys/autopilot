#!/usr/bin/env node
'use strict';
/**
 * check-test-tmux-claude-teardown.js (BL-0433)
 *
 *   node scripts/check-test-tmux-claude-teardown.js [--root DIR]
 *
 * A shell file that starts a private tmux server (a code line with `tmux`, `-L <socket>` and
 * `new-session`) must call ap_arm_tmux_claude_teardown on a code line. If a code line also starts
 * `claude`, it must call ap_record_claude_pid. `pkill` on a code line of such a file is a finding.
 * The three runbooks that drive a live claude in tmux must name both calls and must mention pkill
 * (the ban). On the default root those three files must exist; on --root they are checked only
 * when present.
 *
 * Scan: scripts/ hooks/ mods/ skills/ evals/ tools/ bin/ (when the directory exists). Skips a path
 * that has a segment packs, fixtures, fixture, stubs, mutants, node_modules, .git, results or
 * results-archive. Only *.sh and *.bash. Comment lines (trim starts with #) are not code.
 *
 * stdout: one JSON object. stderr: one finding per line. Exit 0 clean, 1 findings, 2 usage.
 */
const fs = require('fs');
const path = require('path');

const SCAN_DIRS = ['scripts', 'hooks', 'mods', 'skills', 'evals', 'tools', 'bin'];
const SKIP_SEGMENTS = new Set(['packs', 'fixtures', 'fixture', 'stubs', 'mutants', 'node_modules', '.git', 'results', 'results-archive']);
const RUNBOOKS = [
  'docs/plans/evidence/2026-10-04-mods-p1c/gate/DRIVER.md',
  'docs/plans/evidence/2026-10-04-mods-p1c/gate/RUNBOOK.md',
  'references/mods.md',
];
const RUNBOOK_PHRASES = ['ap_arm_tmux_claude_teardown', 'ap_record_claude_pid', 'pkill'];
const STARTER = /\btmux\b.*(?:-L(?:\s+\S+|\S+)).*\bnew-session\b|\btmux\b.*\bnew-session\b.*-L(?:\s+\S+|\S+)/;
const CLAUDE_CMD = /(^|[^A-Za-z0-9_.-])claude([^A-Za-z0-9_.-]|$)/;

function codeLines(text) {
  return text.split('\n').filter((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('#');
  });
}

function listSh(root) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (SKIP_SEGMENTS.has(e.name)) continue;
      const child = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) walk(child);
      else if (e.isFile() && /\.(sh|bash)$/.test(e.name)) out.push(child.split(path.sep).join('/'));
    }
  };
  for (const d of SCAN_DIRS) {
    if (fs.existsSync(path.join(root, d))) walk(d);
  }
  out.sort();
  return out;
}

function inspect(root, opts = {}) {
  const findings = [];
  const starters = [];
  const files = listSh(root);
  for (const rel of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { continue; }
    const lines = codeLines(text);
    if (!lines.some((l) => STARTER.test(l))) continue;
    starters.push(rel);
    if (!lines.some((l) => l.includes('ap_arm_tmux_claude_teardown'))) {
      findings.push({ code: 'missing_arm', file: rel });
    }
    if (lines.some((l) => CLAUDE_CMD.test(l)) && !lines.some((l) => l.includes('ap_record_claude_pid'))) {
      findings.push({ code: 'missing_claude_pid', file: rel });
    }
    if (lines.some((l) => /\bpkill\b/.test(l))) {
      findings.push({ code: 'pkill_by_pattern', file: rel });
    }
  }
  const defaultRoot = opts.defaultRoot === true;
  for (const rel of RUNBOOKS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      if (defaultRoot) findings.push({ code: 'runbook_missing', file: rel });
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    for (const phrase of RUNBOOK_PHRASES) {
      if (!text.includes(phrase)) findings.push({ code: 'runbook_missing_phrase', file: rel, phrase });
    }
  }
  return { ok: findings.length === 0, scanned: files.length, starters, findings };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: node scripts/check-test-tmux-claude-teardown.js [--root DIR]\n');
    process.exit(0);
  }
  let root = path.resolve(__dirname, '..');
  let defaultRoot = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      const v = args[i + 1];
      if (!v) { process.stderr.write('check-test-tmux-claude-teardown: --root needs a directory\n'); process.exit(2); }
      root = path.resolve(v);
      defaultRoot = false;
      i += 1;
    } else {
      process.stderr.write(`check-test-tmux-claude-teardown: unknown arg: ${args[i]}\n`);
      process.exit(2);
    }
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    process.stderr.write(`check-test-tmux-claude-teardown: not a directory: ${root}\n`);
    process.exit(2);
  }
  const rep = inspect(root, { defaultRoot });
  for (const f of rep.findings) {
    process.stderr.write(`${f.code} ${f.file}${f.phrase ? ' ' + f.phrase : ''}\n`);
  }
  process.stdout.write(JSON.stringify(rep) + '\n');
  process.exit(rep.ok ? 0 : 1);
}

module.exports = { listSh, inspect, codeLines };

if (require.main === module) main();
