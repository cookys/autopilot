#!/usr/bin/env node
/**
 * state-checkpoint — PreCompact hook (Node.js, v2.7.2+)
 *
 * v2.7.1 was bash + asked Claude to Edit-append context (best-effort, often
 * dropped under load). v2.7.2 rewrites this hook to PARSE THE TRANSCRIPT
 * ITSELF and write verbatim turns to compaction-state.md — no Claude
 * compliance dependency.
 *
 * Architecture (per docs/plans/2026-05-14-context-handoff-hardening.md):
 * - Filter-first / tail-after / newest-first iteration with byte cap
 * - Per-block thinking truncation (preserves reasoning shape, prevents bloat)
 * - Visible failure diagnostic INTO checkpoint file + stderr emit
 * - Diagnostic log at ~/.autopilot/.state-checkpoint.log (JSONL, rotate 1MB)
 * - Fail-open: exit 0 even on errors (matches large-file-warner / log-error
 *   / reload-watch convention)
 * - chmod 600 on all output files
 *
 * Output: stdout text injection (command-type hook) — optional supplement
 * note for Claude; the heavy lifting is already done by this hook.
 *
 * Inspired by tanweai/pua session-restore.sh (MIT License) — extended with
 * hook-self-extraction (the original relied on LLM voluntary append).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// === Constants ===
const STATE_DIR = path.join(os.homedir(), '.autopilot');
const STATE_FILE = path.join(STATE_DIR, 'compaction-state.md');
const LOG_FILE = path.join(STATE_DIR, '.state-checkpoint.log');
const LOG_ROTATE_BYTES = 1 * 1024 * 1024; // 1 MB
const TRANSCRIPT_TAIL_N = parseInt(process.env.TRANSCRIPT_TAIL_N || '20', 10);
const TRANSCRIPT_BYTE_CAP = parseInt(process.env.TRANSCRIPT_BYTE_CAP || '8192', 10);
const PER_TURN_BUDGET = 1500; // bytes, applies to OLDER turns; newest turn exempt
const THINKING_BLOCK_CAP = 500;
const MAX_LINE_BYTES = 5 * 1024 * 1024; // 5 MB; oversize-line skip guard

// === Helpers ===

function readFailureCounter() {
  try {
    const files = fs.readdirSync(STATE_DIR)
      .filter(f => f.startsWith('.failure_count_'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(STATE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return 0;
    const v = fs.readFileSync(path.join(STATE_DIR, files[0].name), 'utf8').trim();
    return parseInt(v, 10) || 0;
  } catch {
    return 0;
  }
}

function appendLog(record) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    // Rotate if too large
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > LOG_ROTATE_BYTES) {
        fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      }
    } catch { /* file may not exist yet */ }
    const line = JSON.stringify(record) + '\n';
    // Cap log line ≤ 4000 bytes for POSIX O_APPEND atomicity (PIPE_BUF=4096)
    const capped = line.length > 4000 ? JSON.stringify({ ...record, _note: 'line truncated' }).slice(0, 3999) + '\n' : line;
    fs.appendFileSync(LOG_FILE, capped, { mode: 0o600 });
    try { fs.chmodSync(LOG_FILE, 0o600); } catch { /* ignore */ }
  } catch (err) {
    // Last resort — stderr (always available)
    process.stderr.write(`[state-checkpoint] log write failed: ${err.message}\n`);
  }
}

function emitFailure(reason, lastStep, extraDetail = '') {
  const message = `## Transcript Tail: FAILED
- Reason: ${reason}
- Last successful step: ${lastStep}
${extraDetail ? '- Detail: ' + extraDetail + '\n' : ''}- This means compact will only have machine state + Claude-append (the original failure mode)
`;
  // Stderr — surfaces in current session (per QA r2#6)
  process.stderr.write(`[state-checkpoint] ${reason} at "${lastStep}"\n`);
  return message;
}

function truncateUtf8Safe(str, maxBytes) {
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return { text: str, truncated: false, originalBytes: buf.length };
  // UTF-8 codepoint boundary detection: continuation bytes have high bits 10xxxxxx (0x80-0xBF).
  // Step back from maxBytes until we hit a non-continuation byte (start of a codepoint).
  // This preserves legitimate U+FFFD chars (replacement-char detection is unreliable for that).
  let cut = maxBytes;
  while (cut > 0 && (buf[cut] & 0xC0) === 0x80) cut--;
  return { text: buf.subarray(0, cut).toString('utf8'), truncated: true, originalBytes: buf.length };
}

function renderContentBlocks(blocks) {
  // blocks: array of content blocks from message.content
  // Renders blocks to text. Per-turn budget enforcement happens in
  // buildTranscriptTail AFTER this, so newest-turn can be exempted there.
  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const t = block.type;
    if (t === 'text') {
      parts.push(block.text || '');
    } else if (t === 'thinking') {
      const thinking = block.thinking || block.text || '';
      const { text, truncated } = truncateUtf8Safe(thinking, THINKING_BLOCK_CAP);
      parts.push(`<thinking>${text}${truncated ? '[...thinking truncated]' : ''}</thinking>`);
    } else if (t === 'tool_use') {
      const name = block.name || '<unknown>';
      parts.push(`[tool_use: ${name}(...)]`);
    } else if (t === 'tool_result') {
      let bodySize = 0;
      try {
        if (typeof block.content === 'string') bodySize = block.content.length;
        else if (Array.isArray(block.content)) bodySize = JSON.stringify(block.content).length;
      } catch { /* ignore */ }
      parts.push(`[tool_result: ${bodySize}B]`);
    } else if (t === 'image') {
      parts.push('[image]');
    } else {
      parts.push(`[${t || 'unknown-block'}]`);
    }
  }
  return parts.join('\n');
}

function extractTurn(record) {
  // Returns { role, text, timestamp } with RAW rendered text (no per-turn cap).
  // Per-turn cap is applied in buildTranscriptTail so newest turn can be exempted.
  const role = record.type; // "user" | "assistant"
  const msg = record.message;
  if (!msg) return null;
  let content = msg.content;
  if (typeof content === 'string') {
    return { role, text: content, timestamp: record.timestamp || '' };
  }
  if (Array.isArray(content)) {
    return { role, text: renderContentBlocks(content), timestamp: record.timestamp || '' };
  }
  // Unknown shape — render as JSON stub
  try {
    return { role, text: `[non-standard content: ${JSON.stringify(content).slice(0, 200)}]`, timestamp: record.timestamp || '' };
  } catch {
    return { role, text: '[non-standard content]', timestamp: record.timestamp || '' };
  }
}

function parseTranscript(transcriptPath) {
  // Returns { turns: array, totalRecords, filteredOut, oversizeSkipped, errors }
  const stats = { totalRecords: 0, filteredOut: 0, oversizeSkipped: 0, errors: 0 };
  const turns = [];

  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read transcript: ${err.code || err.message}`);
  }

  // Tolerate CRLF — normalize
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      stats.oversizeSkipped++;
      continue;
    }
    stats.totalRecords++;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      stats.errors++;
      continue;
    }
    if (rec.type !== 'user' && rec.type !== 'assistant') {
      stats.filteredOut++;
      continue;
    }
    const turn = extractTurn(rec);
    if (turn) turns.push(turn);
  }

  return { turns, ...stats };
}

function buildTranscriptTail(turns) {
  // Take last N turns
  const tail = turns.slice(-TRANSCRIPT_TAIL_N);
  if (tail.length === 0) return { body: '', metadata: { kept: 0, droppedToCap: 0, bytesUsed: 0 } };

  // Iterate newest-first, accumulating bytes until cap; newest turn exempt from per-turn cap
  const reversedSelected = [];
  let bytesUsed = 0;
  let droppedToCap = 0;

  for (let i = tail.length - 1; i >= 0; i--) {
    const turn = tail[i];
    const isNewest = i === tail.length - 1;
    let rendered = turn.text;
    if (!isNewest && Buffer.byteLength(rendered, 'utf8') > PER_TURN_BUDGET) {
      // Per-turn cap applied to OLDER turns only; newest turn is exempt
      // (extractTurn / renderContentBlocks return raw, no per-turn cap upstream)
      const { text, truncated, originalBytes } = truncateUtf8Safe(rendered, PER_TURN_BUDGET);
      rendered = text + (truncated ? `\n[...turn truncated, original size: ${originalBytes}B]` : '');
    }
    const header = `### ${turn.role} [${turn.timestamp}]\n`;
    const segment = header + rendered + '\n\n';
    const segBytes = Buffer.byteLength(segment, 'utf8');

    if (isNewest) {
      // Newest turn always included verbatim (subject only to MAX_LINE / runtime sanity)
      reversedSelected.push(segment);
      bytesUsed += segBytes;
    } else if (bytesUsed + segBytes <= TRANSCRIPT_BYTE_CAP) {
      reversedSelected.push(segment);
      bytesUsed += segBytes;
    } else {
      // Try truncating the rest of this segment to fit
      const remaining = TRANSCRIPT_BYTE_CAP - bytesUsed;
      if (remaining > 200) {
        const { text, truncated } = truncateUtf8Safe(segment, remaining - 50);
        reversedSelected.push(text + (truncated ? '\n[...segment truncated to fit cap]\n\n' : '\n'));
        bytesUsed = TRANSCRIPT_BYTE_CAP;
      } else {
        droppedToCap = i + 1; // turns 0..i dropped
        break;
      }
    }
  }

  // Reverse back to chronological for output
  const body = reversedSelected.reverse().join('');
  const result = droppedToCap > 0
    ? `[...older ${droppedToCap} turns truncated to fit ${TRANSCRIPT_BYTE_CAP}-byte cap]\n\n` + body
    : body;
  return { body: result, metadata: { kept: reversedSelected.length, droppedToCap, bytesUsed } };
}

// === Main ===

(function main() {
  const timestamp = new Date().toISOString();
  let sessionId = '<unknown>';
  let transcriptPath = '';
  let status = 'unknown';
  let failureReason = null;
  let kept = 0, total = 0, filteredOut = 0, oversizeSkipped = 0, bytesUsed = 0;

  // Always log start
  try {
    // Read stdin with ENXIO graceful handling:
    // `/compact` slash command invokes PreCompact hook WITHOUT piping a JSON
    // payload — fs.readFileSync('/dev/stdin') then throws ENXIO. This is not
    // a real failure (Claude Code's auto-compact DOES pipe the payload); the
    // /compact CLI path simply skips hook payload. Detect and skip gracefully
    // without polluting the log with "catastrophic" entries.
    // (Discovered 2026-05-14 method-B testing — `docs/BACKLOG.md` entry.)
    let stdin = '';
    try {
      stdin = fs.readFileSync('/dev/stdin', 'utf8');
    } catch (err) {
      if (err.code === 'ENXIO' || err.code === 'EAGAIN') {
        // No payload available — typical for /compact slash invocation.
        // Log as skip + exit cleanly without writing checkpoint (there's
        // nothing useful we could capture without transcript_path).
        process.stderr.write(`[state-checkpoint] /compact invocation (no stdin payload) — skipping\n`);
        appendLog({ ts: timestamp, hostname: os.hostname(), session_id: '<no-stdin>', status: 'no_payload_skip', reason: `${err.code}: stdin not piped` });
        return process.exit(0);
      }
      throw err; // any other stdin read error → real catastrophic, fall through
    }
    const input = stdin.trim() ? JSON.parse(stdin) : {};
    sessionId = input.session_id || '<unknown>';
    transcriptPath = input.transcript_path || '';

    // Ensure state dir exists
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

    appendLog({ ts: timestamp, hostname: os.hostname(), session_id: sessionId, status: 'start', transcript_path: transcriptPath });

    // Build machine state header
    const failureCount = readFailureCounter();
    let stateContent = `# Autopilot Compaction Checkpoint
## Machine State (guaranteed accurate)
- Timestamp: ${timestamp}
- Hostname: ${os.hostname()}
- Session: ${sessionId}
- Failure counter: ${failureCount}
- Compaction trigger: automatic
- Hook: state-checkpoint.js (v2.7.2+, Node JSONL parser)

`;

    // Extract transcript tail
    if (!transcriptPath) {
      stateContent += emitFailure('empty transcript_path', 'stdin parse');
      status = 'failed';
      failureReason = 'empty_transcript_path';
    } else if (!fs.existsSync(transcriptPath)) {
      stateContent += emitFailure('transcript file not found', 'fs.existsSync check', transcriptPath);
      status = 'failed';
      failureReason = 'transcript_not_found';
    } else {
      try {
        // Symlink reject: resolve and check stays within $HOME
        const realTranscript = fs.realpathSync(transcriptPath);
        if (!realTranscript.startsWith(os.homedir())) {
          stateContent += emitFailure('transcript path resolves outside HOME', 'symlink check', realTranscript);
          status = 'failed';
          failureReason = 'transcript_outside_home';
        } else {
          const parsed = parseTranscript(realTranscript);
          total = parsed.totalRecords;
          filteredOut = parsed.filteredOut;
          oversizeSkipped = parsed.oversizeSkipped;
          const { body, metadata } = buildTranscriptTail(parsed.turns);
          kept = metadata.kept;
          bytesUsed = metadata.bytesUsed;

          stateContent += `## Transcript Tail (hook-extracted)
- Method: Node JSONL parser (v2.7.2)
- Hostname: ${os.hostname()}
- Turns captured: ${kept} (of ${parsed.turns.length} filtered turns / ${total} total records)
- Filtered out: ${filteredOut} non-conversation records, ${oversizeSkipped} oversize lines
- Bytes used: ${bytesUsed} (cap: ${TRANSCRIPT_BYTE_CAP})
- Order: newest-first selection, output chronological

${body}`;

          if (kept === 0 && parsed.turns.length > 0) {
            stateContent += `\n[NOTE: all turns filtered or empty after content extraction — check transcript or filter logic]\n`;
          }
          status = 'ok';
        }
      } catch (err) {
        stateContent += emitFailure(err.message || 'unknown parse error', 'parseTranscript', err.stack ? err.stack.split('\n')[0] : '');
        status = 'failed';
        failureReason = err.message;
      }
    }

    // LLM-append section — now bonus, not load-bearing
    stateContent += `

## LLM Context (Claude-appended, optional supplement)
<!-- Claude: this section is OPTIONAL. The Transcript Tail above is already
     captured verbatim by the hook. Use this section ONLY to add hidden
     context the transcript wouldn't show: in-flight reasoning you haven't
     verbalized, excluded possibilities, mental decision tree branches. -->
`;

    // Write state file
    let stateFileWritten = false;
    try {
      fs.writeFileSync(STATE_FILE, stateContent, { mode: 0o600 });
      try { fs.chmodSync(STATE_FILE, 0o600); } catch { /* ignore */ }
      stateFileWritten = true;
    } catch (err) {
      // State file IO failure — diagnostic only goes to stderr + log
      process.stderr.write(`[state-checkpoint] CRITICAL: state file write failed: ${err.message}\n`);
      status = 'failed';
      failureReason = `state_file_write: ${err.message}`;
    }

    // Stdout — instruction for Claude (reflects actual write result)
    if (stateFileWritten) {
      process.stdout.write(`[Autopilot State Checkpoint — PreCompact]
Transcript tail extracted by hook to ~/.autopilot/compaction-state.md
(${kept} turns, ${bytesUsed} bytes). The hook captures verbatim turns;
the LLM-append section below is OPTIONAL supplement for hidden in-flight
context (excluded reasoning paths etc.). Not critical — machine state +
transcript tail are already guaranteed.
`);
    } else {
      process.stdout.write(`[Autopilot State Checkpoint — PreCompact — WRITE FAILED]
State file write to ~/.autopilot/compaction-state.md FAILED — see stderr
for diagnostic. In-memory tail held ${kept} turns / ${bytesUsed} bytes but
NOT persisted. Compact will proceed without hook-extracted handoff.
Reason: ${failureReason || 'unknown'}
`);
    }

    // Final log entry
    appendLog({
      ts: new Date().toISOString(),
      hostname: os.hostname(),
      session_id: sessionId,
      status,
      reason: failureReason,
      turns_captured: kept,
      total_records: total,
      filtered_out: filteredOut,
      oversize_skipped: oversizeSkipped,
      bytes_used: bytesUsed,
    });
  } catch (err) {
    // Catastrophic — log + stderr + still exit 0
    process.stderr.write(`[state-checkpoint] catastrophic failure: ${err.message}\n`);
    try {
      appendLog({ ts: new Date().toISOString(), hostname: os.hostname(), session_id: sessionId, status: 'catastrophic', reason: err.message });
    } catch { /* nothing more we can do */ }
  }

  process.exit(0);
})();
