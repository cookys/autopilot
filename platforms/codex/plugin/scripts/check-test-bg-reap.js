#!/usr/bin/env node
'use strict';
/**
 * check-test-bg-reap.js — lint: long-lived background processes in test scripts must be reaped.
 *
 *   node scripts/check-test-bg-reap.js [--root DIR] [--help]
 *
 * Scans `hooks/tests/*.sh` and `scripts/**\/*.test.sh` for lines starting a long-lived
 * background process (`tail -f`, `sleep infinity`, `sleep <n>` with n >= 60, `cat <fifo>`,
 * `while true`, `yes`) with a trailing `&`, when the file has neither a `trap ... EXIT`
 * that kills (directly or via a cleanup function) nor an explicit `kill` of that PID variable.
 *
 * Exit: 0 clean | 1 findings | 2 usage error. Node built-ins only.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

function listTestFiles(root) {
  const out = [];
  const hooksTestsDir = path.join(root, 'hooks', 'tests');
  if (fs.existsSync(hooksTestsDir)) {
    for (const ent of fs.readdirSync(hooksTestsDir, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith('.sh')) {
        out.push(`hooks/tests/${ent.name}`);
      }
    }
  }
  const scriptsDir = path.join(root, 'scripts');
  const walk = (rel) => {
    const abs = path.join(root, rel);
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(child);
      else if (ent.isFile() && ent.name.endsWith('.test.sh')) out.push(child);
    }
  };
  if (fs.existsSync(scriptsDir)) walk('scripts');
  out.sort();
  return out;
}

function isLongLivedBg(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  if (!/&\s*(?:#.*)?$/.test(trimmed)) return false;

  if (/\btail\s+-f\b/.test(trimmed)) return 'tail -f';
  if (/\bsleep\s+infinity\b/.test(trimmed)) return 'sleep infinity';
  const sleepMatch = trimmed.match(/\bsleep\s+(\d+(?:\.\d+)?)\b/);
  if (sleepMatch && Number(sleepMatch[1]) >= 60) return `sleep ${sleepMatch[1]}`;
  if (/\bcat\b/.test(trimmed) && !/<</.test(trimmed)) return 'cat';
  if (/\bwhile\s+(?:true|:)\b/.test(trimmed)) return 'while true';
  if (/(?:^|[;&|(\s])yes(?:\s|$|&)/.test(trimmed)) return 'yes';
  return false;
}

function hasExitTrapWithKill(text) {
  const lines = text.split('\n');
  const trapFns = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    if (/\btrap\b/.test(t) && /\bEXIT\b/.test(t)) {
      if (/\bkill\b/.test(t)) return true;
      const m = t.match(/\btrap\s+['"]?([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (m) trapFns.push(m[1]);
    }
  }
  for (const fn of trapFns) {
    const fnRe = new RegExp(`(?:function\\s+${fn}\\b|\\b${fn}\\s*\\(\\s*\\))\\s*\\{([\\s\\S]*?)\\n\\}`);
    const m = text.match(fnRe);
    if (m && /\bkill\b/.test(m[1])) return true;
  }
  return false;
}

function hasExplicitPidKill(lines, idx) {
  // Check if the next non-empty, non-comment line (or same line) captures $! into a variable
  let pidVar = null;
  for (let j = idx; j < Math.min(idx + 3, lines.length); j++) {
    const t = lines[j].trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/\b([A-Za-z_][A-Za-z0-9_]*)=\$!/);
    if (m) {
      pidVar = m[1];
      break;
    }
    if (j > idx) break;
  }
  if (!pidVar) return false;
  const killRe = new RegExp(`\\bkill\\b[^\\n]*\\$\\{?${pidVar}\\}?\\b`);
  return lines.some((l) => !l.trim().startsWith('#') && killRe.test(l));
}

function inspect(root) {
  const findings = [];
  for (const rel of listTestFiles(root)) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    const trapOk = hasExitTrapWithKill(text);
    for (let i = 0; i < lines.length; i++) {
      const kind = isLongLivedBg(lines[i]);
      if (!kind) continue;
      if (trapOk || hasExplicitPidKill(lines, i)) continue;
      findings.push({ file: rel, line: i + 1, kind });
    }
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  let root = REPO;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      console.log('usage: node scripts/check-test-bg-reap.js [--root DIR]');
      process.exit(0);
    } else if (args[i] === '--root') {
      if (!args[i + 1]) {
        console.error('check-test-bg-reap: --root requires a directory');
        process.exit(2);
      }
      root = path.resolve(args[++i]);
    } else {
      console.error(`check-test-bg-reap: unknown argument: ${args[i]}`);
      process.exit(2);
    }
  }

  const findings = inspect(root);
  for (const f of findings) {
    console.error(`${f.file}:${f.line}: un-reaped background '${f.kind}' (add trap ... EXIT with kill or explicit kill of PID)`);
  }
  process.exit(findings.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { inspect, isLongLivedBg, hasExitTrapWithKill };
