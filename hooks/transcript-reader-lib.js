// transcript-reader-lib.js — recover the latest tool event from the Claude Code
// session transcript JSONL, for tool-event hooks that cannot read stdin.
//
// WHY: opening the /dev/stdin PATH throws ENXIO in the Bun-spawned hook
// environment (verified across 2.1.128→2.1.159; upstream #6305). The payload IS
// delivered on fd 0 — read it directly (fs.readFileSync(0), verified 2.1.186),
// which is the fix the PreToolUse blockers use. This transcript route remains
// the recovery path for PostToolUse hooks that need tool_response/is_error
// fields (absent pre-run) and as a fallback when fd 0 is empty.
// PostToolUse hooks can instead reconstruct the stdin-equivalent payload
// ({tool_name, tool_input, tool_response, is_error}) from the transcript, which
// Claude Code writes incrementally during the session.
//
// Path discovery uses CLAUDE_CODE_SESSION_ID (a UUID) and locates the matching
// <id>.jsonl under ~/.claude/projects/*/ — we do NOT assume the cwd→dir encoding
// rule (unverified), the UUID filename is unique on its own.
//
// Everything here is fail-open: any error → returns null. A hook must treat null
// as "no data this invocation" and never block.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LINE_BYTES = 1024 * 1024; // skip pathological oversized lines (match state-checkpoint-lib)

// --- pure: extract the latest tool event from transcript JSONL text ----------
// Returns { tool_name, tool_input, tool_response, is_error, tool_use_id } for the
// LAST tool_use in the transcript, with its matching result; or null if none.
function findLatestToolEvent(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  let lastToolUse = null;             // { id, name, input }
  const resultById = new Map();       // tool_use_id -> { content, is_error }

  for (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) continue;

    let rec;
    try { rec = JSON.parse(line); } catch { continue; }

    const msg = rec && rec.message;
    const content = msg && Array.isArray(msg.content) ? msg.content : null;

    if (content) {
      for (const blk of content) {
        if (!blk || typeof blk !== 'object') continue;
        if (blk.type === 'tool_use') {
          lastToolUse = {
            id: blk.id || '',
            name: blk.name || '<unknown>',
            input: blk.input || {},
          };
        } else if (blk.type === 'tool_result' && blk.tool_use_id) {
          resultById.set(blk.tool_use_id, {
            content: blk.content,
            is_error: blk.is_error === true,
          });
        }
      }
    }

    // Some records carry a richer top-level toolUseResult alongside the
    // tool_result block in the same user turn. Prefer it when present.
    if (rec && rec.toolUseResult !== undefined && content) {
      for (const blk of content) {
        if (blk && blk.type === 'tool_result' && blk.tool_use_id) {
          const existing = resultById.get(blk.tool_use_id) || { is_error: blk.is_error === true };
          existing.content = rec.toolUseResult;
          resultById.set(blk.tool_use_id, existing);
        }
      }
    }
  }

  if (!lastToolUse) return null;

  const result = resultById.get(lastToolUse.id) || null;
  return {
    tool_name: lastToolUse.name,
    tool_input: lastToolUse.input,
    tool_response: result ? result.content : undefined,
    is_error: result ? result.is_error : false,
    tool_use_id: lastToolUse.id,
  };
}

// --- IO: locate the transcript file for a session id -------------------------
// UUID glob: scan ~/.claude/projects/*/<sessionId>.jsonl. Returns path or null.
function resolveTranscriptPath({ sessionId, homedir } = {}) {
  if (!sessionId) return null;
  const home = homedir || os.homedir();
  const base = path.join(home, '.claude', 'projects');
  let dirs;
  try { dirs = fs.readdirSync(base); } catch { return null; }
  for (const d of dirs) {
    const candidate = path.join(base, d, `${sessionId}.jsonl`);
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep scanning */ }
  }
  return null;
}

// --- IO wrapper: read the latest tool event for the current session ----------
// env defaults to process.env. Fail-open: any failure → null.
function readLatestToolEvent({ env, homedir } = {}) {
  const e = env || process.env;
  const sessionId = e.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) return null;
  const tpath = resolveTranscriptPath({ sessionId, homedir });
  if (!tpath) return null;
  let raw;
  try { raw = fs.readFileSync(tpath, 'utf8'); } catch { return null; }
  return findLatestToolEvent(raw);
}

// --- convenience: unified tool-event accessor for tool-event hooks ----------
// stdin-first (works if Claude Code ever fixes the pipe), transcript-fallback
// otherwise. Returns { tool_name, tool_input, tool_response, is_error, source }.
// source ∈ 'stdin' | 'transcript' | 'none'. Never throws (fail-open → 'none').
function getToolEvent({ stdin, env, homedir } = {}) {
  // 1. injected stdin value (callers read fd 0 directly — that works; this is the
  //    fast path when the caller already has the payload + keeps the lib test-friendly)
  if (typeof stdin === 'string' && stdin.trim()) {
    try {
      const input = JSON.parse(stdin);
      if (input && input.tool_name) {
        return {
          tool_name: input.tool_name,
          tool_input: input.tool_input || {},
          tool_response: input.tool_response,
          is_error: input.is_error === true,
          source: 'stdin',
        };
      }
    } catch { /* fall through to transcript */ }
  }
  // 2. transcript fallback
  const ev = readLatestToolEvent({ env, homedir });
  if (ev && ev.tool_name) return { ...ev, source: 'transcript' };
  return { tool_name: '<unknown>', tool_input: {}, tool_response: undefined, is_error: false, source: 'none' };
}

module.exports = { findLatestToolEvent, resolveTranscriptPath, readLatestToolEvent, getToolEvent };
