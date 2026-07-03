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

const { MAX_LINE_BYTES } = require('./state-checkpoint-lib.js');

// O(n^2) IO rationale: each post-tool-use hook re-reads and re-parses the entire
// transcript JSONL. Reading only the tail window avoids parsing large files.
// This is overridable via the env var AUTOPILOT_TAIL_WINDOW_BYTES or by modifying
// the exported TAIL_WINDOW_BYTES constant.
let TAIL_WINDOW_BYTES = 256 * 1024;

function getTailWindowBytes(env) {
  const e = env || process.env;
  if (e.AUTOPILOT_TAIL_WINDOW_BYTES !== undefined) {
    return parseInt(e.AUTOPILOT_TAIL_WINDOW_BYTES, 10);
  }
  return module.exports.TAIL_WINDOW_BYTES;
}

// Reads only the last windowBytes of the file at tpath, discarding the first partial line.
function readTailWindow(tpath, windowBytes, size) {
  const fd = fs.openSync(tpath, 'r');
  try {
    const buffer = Buffer.alloc(windowBytes);
    const position = size - windowBytes;
    let bytesRead = 0;
    while (bytesRead < windowBytes) {
      const read = fs.readSync(
        fd,
        buffer,
        bytesRead,
        windowBytes - bytesRead,
        position + bytesRead
      );
      if (read === 0) break;
      bytesRead += read;
    }
    const raw = buffer.toString('utf8', 0, bytesRead);
    const firstNewlineIdx = raw.indexOf('\n');
    if (firstNewlineIdx !== -1) {
      return raw.slice(firstNewlineIdx + 1);
    }
    return '';
  } finally {
    fs.closeSync(fd);
  }
}

// Emits a warning to stderr and writes to the transcript-canary log if not already fired in this session.
function triggerCanary({ env, homedir, sessionId, tpath, bytes }) {
  try {
    const e = env || process.env;
    // Respect kill-switch env var AUTOPILOT_NO_CANARY=1
    if (e.AUTOPILOT_NO_CANARY === '1') {
      return;
    }

    const home = homedir || os.homedir();
    const autoDir = path.join(home, '.autopilot');
    fs.mkdirSync(autoDir, { recursive: true });

    const markerPath = path.join(autoDir, `.canary-${sessionId}`);
    try {
      // wx flag: open for writing, fails if file exists (atomic creation check)
      fs.writeFileSync(markerPath, '', { flag: 'wx' });
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        return; // Already fired in this session, stay silent
      }
      return;
    }

    // Write one warning line to stderr
    process.stderr.write(`[transcript-reader-lib] WARNING: Schema canary fired. No tool events found in transcript for session ${sessionId}.\n`);

    // Append one JSON line to ~/.autopilot/transcript-canary.log
    const logPath = path.join(autoDir, 'transcript-canary.log');
    const logLine = JSON.stringify({
      ts: new Date().toISOString(),
      session_id: sessionId,
      transcript_path: tpath,
      bytes: bytes,
    }) + '\n';

    fs.appendFileSync(logPath, logLine, 'utf8');
  } catch {
    // Fail-open: ignore any canary errors
  }
}

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

  let raw = null;
  let fileSize = 0;
  let usedTail = false;
  const windowBytes = getTailWindowBytes(e);

  try {
    const stat = fs.statSync(tpath);
    fileSize = stat.size;
    if (fileSize > windowBytes) {
      raw = readTailWindow(tpath, windowBytes, fileSize);
      usedTail = true;
    } else {
      raw = fs.readFileSync(tpath, 'utf8');
    }
  } catch {
    return null;
  }

  let ev = null;
  if (raw !== null) {
    ev = findLatestToolEvent(raw);
  }

  if (usedTail && !ev) {
    try {
      raw = fs.readFileSync(tpath, 'utf8');
      ev = findLatestToolEvent(raw);
    } catch {
      return null;
    }
  }

  if (!ev && fileSize > 0) {
    triggerCanary({ env: e, homedir, sessionId, tpath, bytes: fileSize });
  }

  return ev;
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

module.exports = {
  findLatestToolEvent,
  resolveTranscriptPath,
  readLatestToolEvent,
  getToolEvent,
  TAIL_WINDOW_BYTES,
};
