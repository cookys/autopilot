'use strict';

// src/status/events/jsonl-tail.js - the one line reader of the events feed (autopilot.events/1, plan E2 step 1).
// Read-only, synchronous, never throws, built-ins only.
//
//   readLines(file, opts) -> {
//     state: 'ok' | 'absent' | 'unreadable',        absent = ENOENT (the caller decides whether that is worth a warning)
//     warnings: [{code, detail, count}],            line_too_long, line_unparseable (parse mode), file_unreadable, cursor_hint_stale
//     lines: [line],                                only when opts.onLine is not given
//     size, head, startOffset, endOffset, hinted,   head = sha256(first 256 bytes)[0:12]; endOffset = first byte not consumed
//     lineCount }
//   line = { raw, offset, end, value?, bad? }       raw = the line without '\n'; offset/end = byte range incl. the '\n';
//                                                   in parse mode value = JSON.parse(raw), or bad:'unparseable'
//
// opts:
//   fromOffset + headHash   an explicit hint {offset, head}
//   hints + hintPrefix      a cursor-style map {"<prefix>:<head>": offset}; the hint is found by the file's own head hash,
//                           so a segment renamed <p> -> <p>.1 keeps its offset (rotation-stable)
//   maxLineBytes (1 MiB)    a longer line is skipped (line_too_long) and reading goes on after the next '\n'
//   parse (false)           JSON.parse each line; a failure or a NUL byte -> bad:'unparseable' + line_unparseable
//   onLine(line, info)      stream the lines instead of collecting them; info = the result object being filled (head, size known)
//
// Rules: 64 KiB chunks; split on '\n'; a final line without '\n' is not consumed (a write in progress, the next read resumes at
// its start). A hint exists only for files >= HINT_MIN_BYTES (the 256-byte head is stable by then); it is used only when the head
// matches and offset <= size, else a full re-read with cursor_hint_stale. Under the threshold a file is always read whole, silently.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHUNK_BYTES = 64 * 1024;
const HINT_MIN_BYTES = 64 * 1024;
const HEAD_BYTES = 256;
const MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_SLACK_MS = 300000;

const headHashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

function addWarning(list, code, detail) {
  const hit = list.find((w) => w.code === code && w.detail === detail);
  if (hit) hit.count += 1;
  else list.push({ code, detail, count: 1 });
}

function readLines(file, opts = {}) {
  const maxLine = Number.isInteger(opts.maxLineBytes) && opts.maxLineBytes > 0 ? opts.maxLineBytes : MAX_LINE_BYTES;
  const detail = path.basename(String(file));
  const out = {
    state: 'ok', warnings: [], size: 0, head: null, startOffset: 0, endOffset: 0, hinted: false, lineCount: 0,
  };
  if (!opts.onLine) out.lines = [];
  let fd = null;
  try {
    try {
      fd = fs.openSync(file, 'r');
    } catch (error) {
      if (error && error.code === 'ENOENT') { out.state = 'absent'; return out; }
      throw error;
    }
    const stat = fs.fstatSync(fd);
    if (stat.isDirectory()) { const e = new Error('EISDIR'); e.code = 'EISDIR'; throw e; }
    out.size = stat.size;
    if (stat.size > 0) {
      const headBuf = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
      const got = fs.readSync(fd, headBuf, 0, headBuf.length, 0);
      out.head = headHashOf(headBuf.subarray(0, got));
    }

    // ---- hint resolution -------------------------------------------------------------------------------------------
    let start = 0;
    if (stat.size >= HINT_MIN_BYTES) {
      let hintOffset = null;
      let headOk = true;
      if (opts.fromOffset !== undefined && opts.fromOffset !== null) {
        hintOffset = opts.fromOffset;
        headOk = typeof opts.headHash === 'string' && opts.headHash === out.head;
      } else if (opts.hints && typeof opts.hints === 'object' && out.head) {
        const keyed = opts.hints[`${opts.hintPrefix || ''}:${out.head}`];
        if (keyed !== undefined && keyed !== null) hintOffset = keyed;
      }
      if (hintOffset !== null) {
        if (headOk && Number.isInteger(hintOffset) && hintOffset >= 0 && hintOffset <= stat.size) {
          start = hintOffset;
          out.hinted = hintOffset > 0;
        } else {
          addWarning(out.warnings, 'cursor_hint_stale', detail);
        }
      }
    }
    out.startOffset = start;
    out.endOffset = start;

    // ---- chunked line split ----------------------------------------------------------------------------------------
    const emit = (raw, offset, end) => {
      if (raw.trim() === '') return; // a blank line is not a row
      const line = { raw, offset, end };
      if (opts.parse) {
        if (raw.includes('\0')) {
          line.bad = 'unparseable';
        } else {
          try { line.value = JSON.parse(raw); } catch (_error) { line.bad = 'unparseable'; }
        }
        if (line.bad) addWarning(out.warnings, 'line_unparseable', detail);
      }
      out.lineCount += 1;
      if (opts.onLine) opts.onLine(line, out); else out.lines.push(line);
    };

    let pos = start;
    let lineStart = start;
    let pending = [];
    let pendingLen = 0;
    let skipping = false;
    for (;;) {
      const buf = Buffer.allocUnsafe(CHUNK_BYTES);
      const n = fs.readSync(fd, buf, 0, CHUNK_BYTES, pos);
      if (n <= 0) break;
      let i = 0;
      while (i < n) {
        const nl = buf.indexOf(10, i);
        if (nl === -1 || nl >= n) {
          if (!skipping) {
            pendingLen += n - i;
            if (pendingLen > maxLine) { skipping = true; pending = []; pendingLen = 0; } else pending.push(buf.subarray(i, n));
          }
          break;
        }
        const end = pos + nl + 1;
        if (skipping) {
          addWarning(out.warnings, 'line_too_long', detail);
          skipping = false;
        } else if (pendingLen + (nl - i) > maxLine) {
          addWarning(out.warnings, 'line_too_long', detail);
        } else {
          const piece = buf.subarray(i, nl);
          const text = (pending.length ? Buffer.concat([...pending, piece]) : piece).toString('utf8');
          emit(text, lineStart, end);
        }
        pending = [];
        pendingLen = 0;
        lineStart = end;
        out.endOffset = end;
        i = nl + 1;
      }
      pos += n;
    }
  } catch (error) {
    out.state = 'unreadable';
    addWarning(out.warnings, 'file_unreadable', detail);
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_error) { /* nothing to do */ } }
  }
  return out;
}

// window.sinceTs (ISO instant or epoch ms) minus window.slackMs -> epoch ms floor, or null when the read has no window.
// An event strictly older than the floor is dropped by the reader; lines are still counted (the cost `#n` rule).
function windowFloorMs(window) {
  if (!window || window.sinceTs === undefined || window.sinceTs === null) return null;
  const since = typeof window.sinceTs === 'number' ? window.sinceTs : require('./instant').parseInstantMs(window.sinceTs);
  if (!Number.isFinite(since)) return null;
  // slackMs absent -> the default 300000 (plan E3); an explicit 0 stays 0.
  const slack = window.slackMs === undefined ? DEFAULT_SLACK_MS : (Number.isFinite(window.slackMs) && window.slackMs > 0 ? window.slackMs : 0);
  return since - slack;
}

module.exports = { readLines, headHashOf, addWarning, windowFloorMs, CHUNK_BYTES, HINT_MIN_BYTES, HEAD_BYTES, MAX_LINE_BYTES };
