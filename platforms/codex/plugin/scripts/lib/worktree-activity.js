'use strict';

/**
 * worktree-activity.js — on-disk activity facts for a working tree.
 *
 * Single owner for two primitives that two different consumers need:
 *   - agent-liveness-check.js  (a human/agent asking "is anything happening in there?")
 *   - watch-foreman.js         (the condition line that must not call a live CC-native
 *                               foreman `dead` just because a recorded PID exited)
 *
 * They are here rather than copied into each caller for the reason the runner→binary map was
 * consolidated in v2.34.44: two hand-maintained copies of the same rule drift while both test
 * suites stay green.
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const path = require('path');

// Directory names whose mtimes move for reasons unrelated to agent work (installs, caches, git's
// own bookkeeping), and which are expensive to walk.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'target', 'dist', 'build', '.next', '.cache']);
const DEFAULT_MAX_ENTRIES = 20000;

/**
 * Newest file mtime under `root`.
 * @returns {{ mtime: number|null, truncated: boolean }} epoch ms, and whether the walk hit its
 * entry budget. `truncated` matters: a truncated walk can only UNDER-report freshness, so a stale
 * answer from one is not evidence of inactivity.
 */
function newestMtime(root, { maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  let newest = 0;
  let seen = 0;
  let truncated = false;
  const stack = [root];
  while (stack.length) {
    if (seen >= maxEntries) { truncated = true; break; }
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { continue; }
    for (const entry of entries) {
      if (seen >= maxEntries) { truncated = true; break; }
      seen += 1;
      // Never follow symlinks: a link out of the tree is not this tree's evidence.
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch (_e) { /* raced with the agent's own writes; ignore */ }
    }
  }
  return { mtime: newest || null, truncated };
}

/**
 * PID holding an advisory lock on `file`, read from /proc/locks.
 * @returns {number|null} null when there is no holder AND when the answer cannot be determined
 * (no /proc, file missing) — callers must treat null as "unknown", never as "nobody holds it".
 */
function lockHolderPid(file) {
  let st;
  try { st = fs.statSync(file); } catch (_e) { return null; }
  let locks;
  try { locks = fs.readFileSync('/proc/locks', 'utf8'); } catch (_e) { return null; }
  // Format: "1: FLOCK  ADVISORY  WRITE 12345 08:02:1234567 0 EOF". A line whose second field is
  // "->" describes a BLOCKED waiter, not the holder, and shifts every field right by one — skip
  // it rather than mistake a waiter for the owner.
  const inodeStr = `${st.ino}`;
  for (const line of locks.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6 || parts[1] === '->') continue;
    const pid = Number(parts[4]);
    const inode = (parts[5] || '').split(':')[2];
    if (inode === inodeStr && Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

/**
 * Classify a worktree by what is visible on disk, with a short-lived memo so a per-event caller
 * does not re-walk the tree on every line.
 *
 * @returns {{ state: 'absent'|'active'|'idle'|'unreadable', ageSeconds: number|null,
 *             truncated: boolean }}
 *   absent     — the path is gone. The one STRONG death signal available on disk.
 *   active     — something was written within `freshSeconds`.
 *   idle       — the tree exists but nothing recent. NOT death: an agent that is thinking, or
 *                waiting on a leaf, writes nothing for long stretches.
 *   unreadable — the path exists but could not be walked.
 */
const memo = new Map();   // path -> { atMs, value }
const MEMO_TTL_MS = 5000;

function classifyWorktree(worktreePath, { freshSeconds = 600, nowMs = Date.now(), maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  if (!worktreePath) return { state: 'unreadable', ageSeconds: null, truncated: false };
  const cached = memo.get(worktreePath);
  if (cached && (nowMs - cached.atMs) < MEMO_TTL_MS) return cached.value;

  let value;
  if (!fs.existsSync(worktreePath)) {
    value = { state: 'absent', ageSeconds: null, truncated: false };
  } else {
    const scan = newestMtime(worktreePath, { maxEntries });
    if (scan.mtime === null) {
      value = { state: 'unreadable', ageSeconds: null, truncated: scan.truncated };
    } else {
      const ageSeconds = Math.max(0, Math.round((nowMs - scan.mtime) / 1000));
      value = {
        state: (freshSeconds > 0 && ageSeconds <= freshSeconds) ? 'active' : 'idle',
        ageSeconds,
        truncated: scan.truncated,
      };
    }
  }
  memo.set(worktreePath, { atMs: nowMs, value });
  return value;
}

module.exports = { newestMtime, lockHolderPid, classifyWorktree, SKIP_DIRS, DEFAULT_MAX_ENTRIES };
