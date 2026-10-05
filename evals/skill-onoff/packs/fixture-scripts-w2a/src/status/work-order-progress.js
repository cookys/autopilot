'use strict';

// src/status/work-order-progress.js — the newest controller_progress_receipt of a campaign root, read from the
// campaign's work-order directory: <git-common-dir>/autopilot/work-orders/<root_run_id>/<node>-a<N>.json
// (a campaign leaf's manifest root_run_id equals that directory name byte for byte). Read-only; shared with P4 work-round.
//
// Binding: the directory name is only where we look. A receipt counts for `root` ONLY when its own `root_run_id` equals
// `root`, and a work-order file whose own top-level `root_run_id` is present and different is unbound as a whole. Anything
// skipped is described in the optional `debug` array (`{ file, reason }`), e.g. 'root_mismatch'.
//
// Ordering key (greatest wins), all taken from the records: receipt `issued_at` (ms; missing/unparseable ranks lowest),
// receipt `generation`, the work-order's `attempt` number, then position inside the file's progress_receipts[]; file mtime
// is the LAST tiebreak only (and file name after it), so a newer-mtime but older-issued_at attempt never wins.
// Malformed or unreadable files are skipped; the function never throws and returns null when nothing qualifies.

const fs = require('fs');
const path = require('path');

const RECEIPT_TYPE = 'controller_progress_receipt';
const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function latestProgress({ commonDir, root, debug } = {}) {
  const note = (file, reason) => { if (Array.isArray(debug)) debug.push({ file, reason }); };
  try {
    if (typeof commonDir !== 'string' || !commonDir || typeof root !== 'string' || !SAFE_ROOT.test(root) || root === '.' || root === '..') return null;
    const dir = path.join(commonDir, 'autopilot', 'work-orders', root);
    let names;
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch (_error) { return null; }
    let best = null;
    for (const name of names) {
      const file = path.join(dir, name);
      let value;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(file).mtimeMs;
        value = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (_error) { note(file, 'unreadable'); continue; }
      if (isObject(value) && typeof value.root_run_id === 'string' && value.root_run_id !== root) { note(file, 'root_mismatch'); continue; }
      const list = isObject(value) && isObject(value.controller) && Array.isArray(value.controller.progress_receipts) ? value.controller.progress_receipts : [];
      const attempt = Number.isSafeInteger(value && value.attempt) ? value.attempt : 0;
      list.forEach((r, i) => {
        if (!isObject(r) || r.artifact_type !== RECEIPT_TYPE) return;
        if (r.root_run_id !== root) { note(file, 'root_mismatch'); return; }
        const t = Date.parse(r.issued_at);
        const key = [Number.isFinite(t) ? t : -Infinity, Number.isSafeInteger(r.generation) ? r.generation : 0, attempt, i, mtimeMs, name];
        if (!best || compareKey(key, best.key) >= 0) best = { key, receipt: r, file };
      });
    }
    return best ? { value: best.receipt, file: best.file } : null;
  } catch (_error) {
    return null;
  }
}

function compareKey(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

module.exports = { latestProgress, RECEIPT_TYPE };
