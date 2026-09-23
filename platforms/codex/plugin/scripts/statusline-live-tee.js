#!/usr/bin/env node
'use strict';

// scripts/statusline-live-tee.js — publish the statusline live file on hosts that do not run the
// codeforge status line, then hand the same stdin to whatever status line the host already uses.
//
// Why: context-budget.js (and depth0-delegate-gate.js) read the REAL context window from
// `<live-base>/context/<sid>.json`. Only codeforge's status line writes that file. On any other host
// the hooks fall back to inferring the window from observed usage, which cannot tell a 1M session
// from a 200K one until usage passes 200K — so a 1M session gets a spurious T2 "write a handoff"
// directive at ~150K. Claude Code already hands every status line the exact window on stdin
// (`context_window.context_window_size`); this script forwards it into the live file.
//
// Usage (settings.json):
//   "statusLine": {"type": "command",
//                  "command": "node <autopilot>/scripts/statusline-live-tee.js -- <your status line> [args…]"}
// With no wrapped command the script prints nothing (live file only).
//
// Contract: writes the `schema_version: 1` main live file from
// docs/plans/_archive/2026/09/2026-09-05-statusline-live-context-feed.md §2 — same base dir
// (resolveLiveDir), same session-id sanitiser, mode 0600, same-directory temp + rename. The tasks
// file (subagent status line) is not written here.
//
// Failure policy: the status line must never break because of this script. Any error while parsing
// or writing is swallowed; the wrapped command still runs with the original stdin bytes and its exit
// status is propagated. A payload without a positive window writes nothing (readers then keep using
// the inference path — silence is never a gate pass).
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveLiveDir, sanitizeSessionId } = require('./lib/live-state-dir.js');

const num = (v) => (Number.isFinite(v) ? v : undefined);

/**
 * Build the live-file object from a status-line payload, or null when the payload carries no
 * session id or no positive window. Exported for tests.
 */
function buildLiveRecord(payload, nowIso) {
  if (!payload || typeof payload !== 'object') return null;
  const sid = typeof payload.session_id === 'string' ? payload.session_id : '';
  const cw = payload.context_window;
  if (!sid || !cw || typeof cw !== 'object') return null;
  const size = cw.context_window_size;
  if (!Number.isFinite(size) || size <= 0) return null;

  const cu = cw.current_usage && typeof cw.current_usage === 'object' ? cw.current_usage : null;
  const model = payload.model && typeof payload.model === 'object' ? payload.model : {};
  return {
    schema_version: 1,
    session_id: sid,
    written_at: nowIso,
    cc_version: typeof payload.version === 'string' ? payload.version : undefined,
    model: {
      id: typeof model.id === 'string' ? model.id : undefined,
      display_name: typeof model.display_name === 'string' ? model.display_name : undefined,
    },
    context_window: {
      context_window_size: size,
      used_percentage: num(cw.used_percentage),
      total_input_tokens: num(cw.total_input_tokens),
      current_usage: cu ? {
        input_tokens: num(cu.input_tokens),
        cache_creation_input_tokens: num(cu.cache_creation_input_tokens),
        cache_read_input_tokens: num(cu.cache_read_input_tokens),
      } : undefined,
    },
  };
}

/** Write the record atomically under `<base>/context/<sanitised sid>.json`. Returns the path. */
function writeLiveRecord(base, record) {
  const dir = path.join(base, 'context');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${sanitizeSessionId(record.session_id)}.json`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

function main(argv) {
  let raw = Buffer.alloc(0);
  try { raw = fs.readFileSync(0); } catch { /* no stdin */ }

  try {
    const record = buildLiveRecord(JSON.parse(raw.toString('utf8')), new Date().toISOString());
    if (record) writeLiveRecord(resolveLiveDir({ warn: () => {} }).base, record);
  } catch { /* never break the status line */ }

  const sep = argv.indexOf('--');
  const cmd = sep >= 0 ? argv.slice(sep + 1) : argv;
  if (cmd.length === 0) return 0;
  const r = spawnSync(cmd[0], cmd.slice(1), { input: raw, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.error) {
    try { process.stderr.write(`statusline-live-tee: cannot run ${cmd[0]}: ${r.error.message}\n`); } catch { /* ignore */ }
    return 1;
  }
  return Number.isInteger(r.status) ? r.status : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { buildLiveRecord, writeLiveRecord, main };
