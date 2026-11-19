'use strict';

// root-scan-shim.js <tool> [args...]
// Refuse a filesystem-root search (exit 126 + one JSON audit line) or exec the
// first real binary of <tool> on PATH outside scripts/shims/root-scan.
// Audit file: $AUTOPILOT_ROOT_SCAN_AUDIT (created mode 0600). Missing binary: 127.
// Contract: references/hetero-dispatch.md § Kimi broker implementer (Root-scan guard).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { classify } = require('./lib/root-scan-guard.js');

function auditLine(tool, args, reason) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    tool,
    argv: args,
    cwd: process.cwd(),
    reason,
    pid: process.pid,
  }) + '\n';
}

function writeAudit(line) {
  const dest = process.env.AUTOPILOT_ROOT_SCAN_AUDIT;
  if (!dest) return;
  // O_WRONLY is required to append. O_NOFOLLOW refuses a symlink audit path.
  const flags = fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_WRONLY;
  const fd = fs.openSync(dest, flags, 0o600);
  try {
    try { fs.fchmodSync(fd, 0o600); } catch (e) { /* still write the line */ }
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
}

function shimDir() {
  try {
    return fs.realpathSync(path.join(__dirname, 'shims', 'root-scan'));
  } catch (e) {
    return null;
  }
}

function isExecutableFile(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (e) {
    return false;
  }
}

function findReal(tool, skipDir) {
  const parts = (process.env.PATH || '').split(path.delimiter);
  for (const dir of parts) {
    if (!dir) continue;
    let realDir;
    try { realDir = fs.realpathSync(dir); } catch (e) { continue; }
    if (skipDir && realDir === skipDir) continue;
    const candidate = path.join(realDir, tool);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function execReal(real, args) {
  // spawnSync cannot forward SIGTERM/SIGINT/SIGHUP to the child while it blocks
  // this process, so the child is spawned and those signals are relayed.
  const child = spawn(real, args, { stdio: 'inherit' });
  let settled = false;
  const finish = (code) => {
    if (settled) return;
    settled = true;
    process.exit(code);
  };
  const forward = (sig) => {
    if (!child.pid) return;
    try { child.kill(sig); } catch (e) { /* child already gone */ }
  };
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGHUP', () => forward('SIGHUP'));
  child.on('error', (err) => {
    process.stderr.write(`root-scan-guard: exec failed: ${err.message}\n`);
    finish(err.code === 'ENOENT' ? 127 : 126);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      const n = os.constants.signals[signal] || 1;
      finish(128 + n);
      return;
    }
    finish(code === null ? 1 : code);
  });
}

function main() {
  const tool = process.argv[2];
  const args = process.argv.slice(3);
  if (!tool) {
    process.stderr.write('root-scan-guard: usage: root-scan-shim.js <tool> [args...]\n');
    process.exit(127);
  }
  const verdict = classify({ tool, args, cwd: process.cwd() });
  if (verdict.refuse) {
    const line = auditLine(tool, args, verdict.reason);
    try { writeAudit(line); } catch (e) {
      process.stderr.write(`root-scan-guard: audit write failed: ${e.message}\n`);
    }
    process.stderr.write(`root-scan-guard: refused: ${line}`);
    process.exit(126);
  }
  const real = findReal(tool, shimDir());
  if (!real) {
    process.stderr.write(`root-scan-guard: no real binary: ${tool}\n`);
    process.exit(127);
  }
  execReal(real, args);
}

main();
