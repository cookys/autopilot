/**
 * state-checkpoint-lib — pure helpers extracted from state-checkpoint.js for
 * unit testability. No fs/os/process IO. The wrapper (state-checkpoint.js)
 * keeps all process/fs side-effects.
 *
 * Stability contract: these signatures are exercised by hooks/state-checkpoint.test.js
 * (L1 unit tests) and indirectly via hooks/tests/state-checkpoint-*.test.sh
 * (L2 integration tests). Behavior changes here require updating both layers.
 */

'use strict';

// === Constants (overridable via env in the wrapper; defaults are the contract here) ===
const PER_TURN_BUDGET = 1500;            // bytes, applies to OLDER turns; newest turn exempt
const THINKING_BLOCK_CAP = 500;          // bytes per thinking block
const MAX_LINE_BYTES = 5 * 1024 * 1024;  // 5 MB; oversize-line skip guard
const FAILURE_COUNTER_STALE_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

// Pure selector for the failure-counter scan. Given the list of
// `.failure_count_*` files (each {name, mtimeMs}), decide which one is the
// current counter and which are stale orphans the wrapper should unlink.
//
// Returns { current: name|null, stale: [names] }.
// - current = freshest file whose age <= staleMs (null if none qualify)
// - stale   = every file older than staleMs (orphans worth cleaning up)
function selectFailureCounter(files, nowMs, staleMs = FAILURE_COUNTER_STALE_MS) {
  const fresh = [];
  const stale = [];
  for (const f of files) {
    if (nowMs - f.mtimeMs > staleMs) stale.push(f.name);
    else fresh.push(f);
  }
  fresh.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { current: fresh.length ? fresh[0].name : null, stale };
}

// === Helpers ===

function emitFailure(reason, lastStep, extraDetail = '', stderr = null) {
  // Note: the wrapper hooks/state-checkpoint.js calls this with process.stderr
  // so the diag surfaces in the active session. Library form accepts an
  // optional stderr-like object for unit-test isolation.
  const message = `## Transcript Tail: FAILED
- Reason: ${reason}
- Last successful step: ${lastStep}
${extraDetail ? '- Detail: ' + extraDetail + '\n' : ''}- This means compact will only have machine state + Claude-append (the original failure mode)
`;
  if (stderr && typeof stderr.write === 'function') {
    stderr.write(`[state-checkpoint] ${reason} at "${lastStep}"\n`);
  }
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

function parseTranscriptText(raw) {
  // Pure parse of transcript JSONL text. Returns the same shape as
  // parseTranscript in the wrapper, minus the fs.readFileSync. Wrapper calls:
  //   parseTranscriptText(fs.readFileSync(path, 'utf8'))
  const stats = { totalRecords: 0, filteredOut: 0, oversizeSkipped: 0, errors: 0 };
  const turns = [];

  // Tolerate CRLF — normalize
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = normalized.split('\n');
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

function buildTranscriptTail(turns, { tailN, byteCap } = {}) {
  // tailN / byteCap injected from the wrapper (which honors env overrides).
  // Defaults here match the wrapper's defaults so unit tests don't need to pass them.
  const TAIL_N = tailN || 20;
  const BYTE_CAP = byteCap || 8192;

  const tail = turns.slice(-TAIL_N);
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
      const { text, truncated, originalBytes } = truncateUtf8Safe(rendered, PER_TURN_BUDGET);
      rendered = text + (truncated ? `\n[...turn truncated, original size: ${originalBytes}B]` : '');
    }
    const header = `### ${turn.role} [${turn.timestamp}]\n`;
    const segment = header + rendered + '\n\n';
    const segBytes = Buffer.byteLength(segment, 'utf8');

    if (isNewest) {
      reversedSelected.push(segment);
      bytesUsed += segBytes;
    } else if (bytesUsed + segBytes <= BYTE_CAP) {
      reversedSelected.push(segment);
      bytesUsed += segBytes;
    } else {
      const remaining = BYTE_CAP - bytesUsed;
      if (remaining > 200) {
        const { text, truncated } = truncateUtf8Safe(segment, remaining - 50);
        reversedSelected.push(text + (truncated ? '\n[...segment truncated to fit cap]\n\n' : '\n'));
        bytesUsed = BYTE_CAP;
      } else {
        droppedToCap = i + 1;
        break;
      }
    }
  }

  const body = reversedSelected.reverse().join('');
  const result = droppedToCap > 0
    ? `[...older ${droppedToCap} turns truncated to fit ${BYTE_CAP}-byte cap]\n\n` + body
    : body;
  return { body: result, metadata: { kept: reversedSelected.length, droppedToCap, bytesUsed } };
}

module.exports = {
  // Constants
  PER_TURN_BUDGET,
  THINKING_BLOCK_CAP,
  MAX_LINE_BYTES,
  FAILURE_COUNTER_STALE_MS,
  // Pure helpers
  emitFailure,
  truncateUtf8Safe,
  renderContentBlocks,
  extractTurn,
  parseTranscriptText,
  buildTranscriptTail,
  selectFailureCounter,
};
