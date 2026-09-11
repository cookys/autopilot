#!/usr/bin/env node
/**
 * dirty-protected-paths — Stop (Claude Code) / Stop + SessionEnd (Codex package). Default-on (v2.36.11).
 *
 * Turn-end REMINDER that uncommitted work is piling up under the project's protected paths.
 * Why: on 2026-09-07 a consuming repo (308) carried ~7800 lines of uncommitted work across
 * Codex sessions for a week; commit cadence lived only in finish-flow prose, so a session that
 * never invoked finish-flow had no gate to hit. This hook is that missing signal.
 *
 * Advisory ONLY — the same doctrine as expiry warnings and advisory policy coverage: a warning
 * that is loud and recorded, never a block. It exits 0 always and never emits a Stop
 * `decision`, so it can neither stop the turn nor force a continuation.
 *
 * What it measures (git, built-ins only):
 *   dirty entries from `git status --porcelain` filtered to protected path prefixes
 *   (`.claude/qc-gate-config.md` `protected_paths`, same CSV the qc-gate reads; no config ⇒
 *   the whole tree counts), files = count, lines = `git diff --numstat HEAD` adds+dels for
 *   tracked entries + line count of untracked files (text, ≤ 2 MB each).
 * Fires when files ≥ min_files OR lines ≥ min_lines, at most once per interval per
 * (repo, session), state kept in the RAM-backed live dir (scripts/lib/live-state-dir.js).
 *
 * Output: `{"systemMessage": "…"}` on stdout (Claude shows it to the user, non-blocking) and
 * the same line on stderr (for harnesses that surface stderr). Never a decision field.
 *
 * Knobs (~/.autopilot/config.json `dirty_tree_reminder` or env):
 *   min_files        AUTOPILOT_DIRTY_TREE_MIN_FILES        default 3
 *   min_lines        AUTOPILOT_DIRTY_TREE_MIN_LINES        default 150
 *   interval_minutes AUTOPILOT_DIRTY_TREE_INTERVAL_MINUTES default 30 (0 = every turn)
 * Opt-out: AUTOPILOT_DIRTY_TREE_REMINDER=false (or `dirty_tree_reminder: false` in the config).
 *
 * Fail-open: any error → exit 0, no output.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DEFAULTS = Object.freeze({ min_files: 3, min_lines: 150, interval_minutes: 30 });
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

function readPayload() {
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = fs.readFileSync('/dev/stdin', 'utf8'); }
  const input = JSON.parse(raw);
  if (!input || typeof input !== 'object') throw new Error('payload is not an object');
  return input;
}

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: opts.buffer ? 'buffer' : 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function loadUserConfig() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.autopilot', 'config.json'), 'utf8');
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {};
  }
}

function positiveInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function resolveKnobs(env, userCfg) {
  const section = userCfg.dirty_tree_reminder;
  const fromCfg = section && typeof section === 'object' ? section : {};
  return {
    min_files: positiveInt(env.AUTOPILOT_DIRTY_TREE_MIN_FILES ?? fromCfg.min_files, DEFAULTS.min_files),
    min_lines: positiveInt(env.AUTOPILOT_DIRTY_TREE_MIN_LINES ?? fromCfg.min_lines, DEFAULTS.min_lines),
    interval_minutes: positiveInt(
      env.AUTOPILOT_DIRTY_TREE_INTERVAL_MINUTES ?? fromCfg.interval_minutes,
      DEFAULTS.interval_minutes,
    ),
  };
}

function optedOut(env, userCfg) {
  const v = env.AUTOPILOT_DIRTY_TREE_REMINDER;
  if (typeof v === 'string' && ['false', '0', 'off', 'no'].includes(v.trim().toLowerCase())) return true;
  return userCfg.dirty_tree_reminder === false;
}

// Same `- protected_paths: a/,b/` line the qc-gate reads (scripts/resolve-qc-gate.sh); the
// 4-tier ladder is collapsed to override-or-repo because a Stop hook must stay cheap.
function loadProtectedPaths(repoRoot, env) {
  const candidates = [];
  if (env.QC_GATE_CONFIG_OVERRIDE) candidates.push(env.QC_GATE_CONFIG_OVERRIDE);
  candidates.push(path.join(repoRoot, '.claude', 'qc-gate-config.md'));
  for (const file of candidates) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*-\s*protected_paths\s*:\s*(.*?)\s*$/);
      if (!m) continue;
      const list = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      return { paths: list, source: file };
    }
  }
  return { paths: [], source: null }; // no config ⇒ whole tree
}

function isProtected(file, prefixes) {
  if (prefixes.length === 0) return true;
  return prefixes.some((p) => file === p || file === p.replace(/\/$/, '') || file.startsWith(p.endsWith('/') ? p : `${p}/`) || file.startsWith(p));
}

function parsePorcelain(out) {
  // -z: entries separated by NUL; renames carry a second NUL-separated path.
  const entries = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const rec = parts[i];
    if (!rec) continue;
    const xy = rec.slice(0, 2);
    let file = rec.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') { i += 1; file = rec.slice(3); }
    entries.push({ xy, file, untracked: xy === '??' });
  }
  return entries;
}

function countUntrackedLines(repoRoot, file) {
  try {
    const full = path.join(repoRoot, file);
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > MAX_UNTRACKED_BYTES) return 0;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return 0; // binary
    let n = 0;
    for (const b of buf) if (b === 10) n += 1;
    if (buf.length > 0 && buf[buf.length - 1] !== 10) n += 1;
    return n;
  } catch {
    return 0;
  }
}

function measure(repoRoot, prefixes) {
  const dirty = parsePorcelain(git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
    .filter((e) => isProtected(e.file, prefixes));
  let lines = 0;
  const tracked = dirty.filter((e) => !e.untracked).map((e) => e.file);
  if (tracked.length > 0) {
    let numstat = '';
    try { numstat = git(repoRoot, ['diff', '--numstat', 'HEAD', '--', ...tracked]); } catch { numstat = ''; }
    for (const row of numstat.split('\n')) {
      const m = row.match(/^(\d+|-)\t(\d+|-)\t/);
      if (!m) continue;
      if (m[1] !== '-') lines += Number.parseInt(m[1], 10);
      if (m[2] !== '-') lines += Number.parseInt(m[2], 10);
    }
  }
  for (const e of dirty) if (e.untracked) lines += countUntrackedLines(repoRoot, e.file);
  return { files: dirty.length, lines, sample: dirty.slice(0, 5).map((e) => e.file) };
}

function stateFile(repoRoot, sessionId) {
  const { resolveLiveDir, sanitizeSessionId } = require(path.join(__dirname, '..', 'scripts', 'lib', 'live-state-dir.js'));
  const base = resolveLiveDir({ warn: () => {} }).base;
  const dir = path.join(base, 'dirty-tree-reminder');
  fs.mkdirSync(dir, { recursive: true });
  const repoKey = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  return path.join(dir, `${repoKey}-${sanitizeSessionId(sessionId)}.json`);
}

function main() {
  const env = process.env;
  const input = readPayload();
  const userCfg = loadUserConfig();
  if (optedOut(env, userCfg)) return;
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  let repoRoot;
  try { repoRoot = git(cwd, ['rev-parse', '--show-toplevel']).trim(); } catch { return; }
  if (!repoRoot) return;

  const knobs = resolveKnobs(env, userCfg);
  const protectedPaths = loadProtectedPaths(repoRoot, env);
  const m = measure(repoRoot, protectedPaths.paths);
  if (m.files === 0) return;
  if (m.files < knobs.min_files && m.lines < knobs.min_lines) return;

  const sessionId = input.session_id || env.CLAUDE_CODE_SESSION_ID || env.CODEX_THREAD_ID || 'unknown';
  const now = Date.now();
  let state = null;
  let file = null;
  try {
    file = stateFile(repoRoot, sessionId);
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { state = null; }
  if (state && typeof state.last_warned_at === 'number'
      && now - state.last_warned_at < knobs.interval_minutes * 60 * 1000) {
    return;
  }
  if (file) {
    try {
      fs.writeFileSync(file, JSON.stringify({ last_warned_at: now, files: m.files, lines: m.lines }));
    } catch { /* state is best-effort */ }
  }

  const scope = protectedPaths.paths.length > 0
    ? `protected paths (${protectedPaths.paths.join(', ')})`
    : 'the working tree (no .claude/qc-gate-config.md protected_paths; whole tree counted)';
  const sample = m.sample.join(', ') + (m.files > m.sample.length ? ', …' : '');
  const message = `autopilot dirty-tree reminder: ${m.files} uncommitted file(s), ~${m.lines} line(s) under ${scope} in ${path.basename(repoRoot)} — ${sample}. `
    + 'Commit a checkpoint or run finish-flow; this is a reminder, nothing is blocked. '
    + `(next reminder in ${knobs.interval_minutes} min; AUTOPILOT_DIRTY_TREE_REMINDER=false to silence)`;
  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
  try { process.stderr.write(`${message}\n`); } catch { /* ignore */ }
}

try {
  main();
} catch (e) {
  try { process.stderr.write(`dirty-protected-paths: fail-open: ${e && e.message ? e.message : e}\n`); } catch { /* ignore */ }
}
process.exit(0);
