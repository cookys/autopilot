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
// Pure helpers + invariants extracted to state-checkpoint-lib.js (2026-06-01 v2.7.5 test-suite ship).
// The wrapper here owns all fs/process IO; the lib stays unit-testable.
const lib = require('./state-checkpoint-lib.js');
const {
  truncateUtf8Safe,
  renderContentBlocks,
  extractTurn,
  parseTranscriptText,
  buildTranscriptTail: libBuildTranscriptTail,
  selectFailureCounter,
  PER_TURN_BUDGET,
  THINKING_BLOCK_CAP,
  MAX_LINE_BYTES,
} = lib;

const STATE_DIR = path.join(os.homedir(), '.autopilot');
const STATE_FILE = path.join(STATE_DIR, 'compaction-state.md');
const LOG_FILE = path.join(STATE_DIR, '.state-checkpoint.log');
const LOG_ROTATE_BYTES = 1 * 1024 * 1024; // 1 MB
const TRANSCRIPT_TAIL_N = parseInt(process.env.TRANSCRIPT_TAIL_N || '20', 10);
const TRANSCRIPT_BYTE_CAP = parseInt(process.env.TRANSCRIPT_BYTE_CAP || '8192', 10);

// === Helpers ===

function readFailureCounter() {
  try {
    const files = fs.readdirSync(STATE_DIR)
      .filter(f => f.startsWith('.failure_count_'))
      .map(f => ({ name: f, mtimeMs: fs.statSync(path.join(STATE_DIR, f)).mtimeMs }));
    const { current, stale } = selectFailureCounter(files, Date.now());
    // Opportunistically unlink orphan counters (>7d) so the scan doesn't grow
    // unbounded (backlog: "Failure counter cleanup — housekeeping").
    for (const name of stale) {
      try { fs.unlinkSync(path.join(STATE_DIR, name)); } catch { /* ignore */ }
    }
    if (!current) return 0;
    const v = fs.readFileSync(path.join(STATE_DIR, current), 'utf8').trim();
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

// Wrapper-side emitFailure — delegates to lib + writes to process.stderr so the
// diag surfaces in the active session (per QA r2#6).
function emitFailure(reason, lastStep, extraDetail = '') {
  return lib.emitFailure(reason, lastStep, extraDetail, process.stderr);
}

// truncateUtf8Safe / renderContentBlocks / extractTurn now come from the lib
// (imported above). They contain no IO so they are unit-tested directly.

function parseTranscript(transcriptPath) {
  // Thin IO wrapper around lib.parseTranscriptText. Splitting fs.readFileSync
  // from parsing lets the parser run against in-memory fixtures in unit tests.
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read transcript: ${err.code || err.message}`);
  }
  return parseTranscriptText(raw);
}

// buildTranscriptTail moved to state-checkpoint-lib.js. Wrapper calls into the
// lib with the env-overridable tail-N + byte-cap so the runtime knobs survive.
function buildTranscriptTail(turns) {
  return libBuildTranscriptTail(turns, {
    tailN: TRANSCRIPT_TAIL_N,
    byteCap: TRANSCRIPT_BYTE_CAP,
  });
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
          // Include the resolved $HOME so the user can see WHY the path was
          // rejected (e.g. CLAUDE_CONFIG_DIR override / cross-volume symlink).
          stateContent += emitFailure(
            'transcript path resolves outside HOME',
            'symlink check',
            `resolved=${realTranscript} (HOME=${os.homedir()})`
          );
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
