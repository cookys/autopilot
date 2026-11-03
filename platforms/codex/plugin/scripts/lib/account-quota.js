'use strict';

// scripts/lib/account-quota.js — reader/interpreter for G36 quota snapshots (plan 5.3, 4.3).
// Snapshot path: <live_base>/codeforge/usage/quota/<alias>.json, schema `codeforge.quota/1`.
// live_base comes from live-state-dir.js resolveLiveDir() (never re-implemented here).
//
// interpretSnapshot() is pure (no fs): it turns a parsed snapshot into
//   { state: 'known'|'unknown', used, source: 'snapshot'|'none', note, tight_resets }
// Rules: a window whose resets_at has passed is ignored; a snapshot older than 6 h is dropped
// (unknown); an unrecognised schema is unknown with note quota_schema_unsupported; a snapshot whose
// alias or root does not match is ignored (note snapshot_root_mismatch). Silence is never "ok".
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'codeforge.quota/1';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_BYTES = 4096;
const TIGHT_THRESHOLD = 0.90;
const PCT_MAX = 1.5;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const ALIAS_RE = /^[a-z0-9-]{1,24}$/;

// First 8 hex of sha256 of the canonical config-dir path bytes (codeforge alias.rs:29-33).
function hash8(canonicalDir) {
  return crypto.createHash('sha256').update(Buffer.from(String(canonicalDir), 'utf8')).digest('hex').slice(0, 8);
}

function quotaDir(liveBase) {
  return path.join(liveBase, 'codeforge', 'usage', 'quota');
}

function unknown(note) {
  return { state: 'unknown', used: null, source: 'none', note: note || null, tight_resets: [] };
}

// opts: { alias, expectedRoot (hash8 of the alias config dir, optional), nowMs }
function interpretSnapshot(snap, opts) {
  const o = opts || {};
  const nowMs = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
  if (snap === null || snap === undefined) return unknown(null);
  if (typeof snap !== 'object' || Array.isArray(snap)) return unknown('quota_invalid');
  if (snap.schema !== SCHEMA) return unknown('quota_schema_unsupported');
  if (o.alias !== undefined && snap.alias !== o.alias) return unknown('snapshot_root_mismatch');
  if (snap.root !== null && snap.root !== undefined && o.expectedRoot !== undefined &&
      snap.root !== o.expectedRoot) {
    return unknown('snapshot_root_mismatch');
  }
  const w = snap.written_at_ms;
  if (!Number.isFinite(w)) return unknown('quota_invalid');
  if (nowMs - w > MAX_AGE_MS) return unknown('quota_stale');
  if (w - nowMs > FUTURE_SKEW_MS) return unknown('quota_invalid');

  const usedList = [];
  const windows = [];
  for (const name of ['five_hour', 'seven_day']) {
    const win = snap[name];
    if (win === null || win === undefined) continue;
    if (typeof win !== 'object') return unknown('quota_invalid');
    const pct = win.pct;
    const resets = win.resets_at;
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > PCT_MAX) return unknown('quota_invalid');
    if (!Number.isFinite(resets)) return unknown('quota_invalid');
    if (resets * 1000 <= nowMs) continue; // window already reset: unknown, ignored
    usedList.push(pct);
    windows.push({ pct, resets_at: resets });
  }
  if (usedList.length === 0) return unknown('quota_windows_expired');
  const used = Math.max(...usedList);
  const tightResets = windows.filter((x) => x.pct >= TIGHT_THRESHOLD).map((x) => x.resets_at);
  return { state: 'known', used, source: 'snapshot', note: null, tight_resets: tightResets };
}

// Reads one snapshot file. Returns the parsed object, or { __error: note } for unusable files,
// or null when the file is absent. Never throws on expected-bad input.
function readSnapshotFile(liveBase, alias) {
  if (!ALIAS_RE.test(String(alias))) return { __error: 'quota_invalid' };
  const file = path.join(quotaDir(liveBase), alias + '.json');
  let st;
  try { st = fs.lstatSync(file); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return { __error: 'quota_unreadable' };
  }
  if (!st.isFile() || st.isSymbolicLink()) return { __error: 'quota_invalid' };
  if (st.size > MAX_BYTES) return { __error: 'quota_invalid' };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return { __error: 'quota_unreadable' }; }
  try { return JSON.parse(text); } catch (_) { return { __error: 'quota_invalid' }; }
}

// opts: { liveBase (required), nowMs, expectedRoot }
function readQuota(alias, opts) {
  const o = opts || {};
  const raw = readSnapshotFile(o.liveBase, alias);
  if (raw && raw.__error) return unknown(raw.__error);
  return interpretSnapshot(raw, { alias, expectedRoot: o.expectedRoot, nowMs: o.nowMs });
}

module.exports = {
  SCHEMA, MAX_AGE_MS, TIGHT_THRESHOLD,
  hash8, quotaDir, interpretSnapshot, readSnapshotFile, readQuota,
};
