#!/usr/bin/env node
/**
 * state-checkpoint — PreCompact hook (Node.js, v2.7.2+)
 *
 * v2.7.1 was bash + asked Claude to Edit-append context (best-effort, often
 * dropped under load). v2.7.2 rewrites this hook to PARSE THE TRANSCRIPT
 * ITSELF and write verbatim turns to compaction-state-<session_id>.md — no Claude
 * compliance dependency.
 *
 * Architecture (per docs/plans/_archive/2026/05/2026-05-14-context-handoff-hardening.md):
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
  dropToolNoise,
  selectFailureCounter,
  compactionStateName,
  PER_TURN_BUDGET,
  THINKING_BLOCK_CAP,
  MAX_LINE_BYTES,
} = lib;

const STATE_DIR = path.join(os.homedir(), '.autopilot');
const LOG_FILE = path.join(STATE_DIR, '.state-checkpoint.log');
const LOG_ROTATE_BYTES = 1 * 1024 * 1024; // 1 MB
// The tail is the supplement, not the state: the workflow snapshot leads the file (plan
// docs/plans/2026-10-13-workflow-snapshot-at-compaction.md). 4 turns / 3 KB of text-bearing turns, and the
// tail now goes LAST, after the repo/dispatch/marker/model-handoff sections (scripts/lib/compaction-handoff.js).
const TRANSCRIPT_TAIL_N = parseInt(process.env.TRANSCRIPT_TAIL_N || '4', 10);
const TRANSCRIPT_BYTE_CAP = parseInt(process.env.TRANSCRIPT_BYTE_CAP || '3072', 10);
const SNAPSHOT_FILE_BYTES = 6000;
const SNAPSHOT_STDOUT_BYTES = 3000;

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
  return libBuildTranscriptTail(dropToolNoise(turns), {
    tailN: TRANSCRIPT_TAIL_N,
    byteCap: TRANSCRIPT_BYTE_CAP,
  });
}

// The workflow snapshot (scripts/lib/workflow-snapshot.js). Every source inside it is fail-open; these
// wrappers cover the require itself, so a missing or broken collector never costs the checkpoint file.
// Collect once (it runs git and reads several files), render once per size: the saved file and the
// PreCompact stdout want different byte budgets of the same snapshot.
function collectWorkflowSnapshot(input) {
  try {
    const { collect } = require('../scripts/lib/workflow-snapshot.js');
    return { snapshot: collect({ sessionId: input.session_id, cwd: input.cwd }) };
  } catch (err) {
    return { error: String(err && err.message).slice(0, 120) };
  }
}

function renderWorkflowSnapshot(collected, maxBytes) {
  if (collected.error !== undefined) return `Workflow state: unavailable (collector failed: ${collected.error})`;
  try {
    const { render } = require('../scripts/lib/workflow-snapshot.js');
    return render(collected.snapshot, { maxBytes });
  } catch (err) {
    return `Workflow state: unavailable (collector failed: ${String(err && err.message).slice(0, 120)})`;
  }
}

// PostCompact (plan §2.6, P4): did the summary keep the branch and the stage the session was on?
// Advisory only: PostCompact has no decision control, and the model still gets the checkpoint file
// from session-start. One advisory row for the owner when the summary lacks either; one log line always.
function postCompactCheck(input) {
  const summary = typeof input.compact_summary === 'string' ? input.compact_summary : '';
  const { facts } = require('../scripts/lib/workflow-snapshot.js');
  const f = facts({ sessionId: input.session_id, cwd: input.cwd });
  const missing = [];
  if (f.branch && !summary.includes(f.branch)) missing.push(`branch ${f.branch}`);
  if (f.stage && !new RegExp(`(^|[^A-Za-z0-9_-])${f.stage.replace(/[^A-Za-z0-9_-]/g, '')}($|[^A-Za-z0-9_-])`, 'i').test(summary)) missing.push(`stage ${f.stage}`);
  appendLog({ ts: new Date().toISOString(), hostname: os.hostname(), session_id: input.session_id || '<unknown>', status: missing.length ? 'postcompact_summary_missing' : 'postcompact_ok', missing, summary_bytes: Buffer.byteLength(summary) });
  if (missing.length && input.session_id) {
    require('./_shared/advisory-sink.js').writeAdvisory({
      sid: input.session_id,
      kind: 'compact-summary-lost-state',
      severity: 'info',
      text: `The compaction summary does not mention the ${missing.join(' or the ')} this session was on. The saved checkpoint is re-injected after compaction, so re-check it before continuing.`,
    });
  }
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
    // Read fd 0, not the '/dev/stdin' PATH: Claude Code hands hooks a socket,
    // and opening /dev/stdin on a socket throws ENXIO. The 2026-05-14 reading
    // ("/compact pipes no payload") was this bug; it skipped every real
    // auto-compact too (live CC 2.1.296, 2026-10-12; #6305, context-budget.js).
    // ENXIO/EAGAIN can still mean no usable stdin: skip without a checkpoint.
    let stdin = '';
    try {
      stdin = fs.readFileSync(0, 'utf8');
    } catch (err) {
      if (err.code === 'ENXIO' || err.code === 'EAGAIN') {
        // No payload available: nothing useful to capture without
        // transcript_path, so log a skip and exit cleanly.
        process.stderr.write(`[state-checkpoint] no stdin payload — skipping\n`);
        appendLog({ ts: timestamp, hostname: os.hostname(), session_id: '<no-stdin>', status: 'no_payload_skip', reason: `${err.code}: stdin not piped` });
        return process.exit(0);
      }
      throw err; // any other stdin read error → real catastrophic, fall through
    }
    const input = stdin.trim() ? JSON.parse(stdin) : {};
    if (input.hook_event_name === 'PostCompact') {
      try { postCompactCheck(input); } catch (err) { process.stderr.write(`[state-checkpoint] postcompact check failed: ${err.message}\n`); }
      return process.exit(0);
    }
    sessionId = input.session_id || '<unknown>';
    transcriptPath = input.transcript_path || '';
    const trigger = input.trigger === 'manual' ? 'manual' : 'automatic';
    const stateName = compactionStateName(input.session_id);

    // Ensure state dir exists
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

    appendLog({ ts: timestamp, hostname: os.hostname(), session_id: sessionId, status: 'start', transcript_path: transcriptPath });

    // Build machine state header
    const failureCount = readFailureCounter();
    const collectedSnapshot = collectWorkflowSnapshot(input);
    const snapshotFile = renderWorkflowSnapshot(collectedSnapshot, SNAPSHOT_FILE_BYTES);
    // snapshotFile (the flat one-block rendering) is no longer written to the file: its sources are
    // split across the handoff sections below. The same snapshot still feeds the PreCompact stdout.
    void snapshotFile;
    const machineState = `## Machine State (guaranteed accurate)
- Timestamp: ${timestamp}
- Hostname: ${os.hostname()}
- Session: ${sessionId}
- Failure counter: ${failureCount}
- Compaction trigger: ${trigger}
- Hook: state-checkpoint.js (v2.7.2+, Node JSONL parser)
`;
    let tailBlock = null; // { header, body }, placed last by buildHandoff

    // Extract transcript tail
    if (!transcriptPath) {
      tailBlock = { header: '', body: emitFailure('empty transcript_path', 'stdin parse') };
      status = 'failed';
      failureReason = 'empty_transcript_path';
    } else if (!fs.existsSync(transcriptPath)) {
      tailBlock = { header: '', body: emitFailure('transcript file not found', 'fs.existsSync check', transcriptPath) };
      status = 'failed';
      failureReason = 'transcript_not_found';
    } else {
      try {
        // Symlink reject: resolve and check stays within $HOME
        const realTranscript = fs.realpathSync(transcriptPath);
        if (!realTranscript.startsWith(os.homedir())) {
          // Include the resolved $HOME so the user can see WHY the path was
          // rejected (e.g. CLAUDE_CONFIG_DIR override / cross-volume symlink).
          tailBlock = { header: '', body: emitFailure(
            'transcript path resolves outside HOME',
            'symlink check',
            `resolved=${realTranscript} (HOME=${os.homedir()})`
          ) };
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

          tailBlock = { header: `## Transcript Tail (hook-extracted, auxiliary reference)
- Method: Node JSONL parser (v2.7.2)
- Hostname: ${os.hostname()}
- Turns captured: ${kept} (of ${parsed.turns.length} filtered turns / ${total} total records)
- Filtered out: ${filteredOut} non-conversation records, ${oversizeSkipped} oversize lines
- Bytes used: ${bytesUsed} (cap: ${TRANSCRIPT_BYTE_CAP})
- Order: newest-first selection, output chronological

`, body };

          if (kept === 0 && parsed.turns.length > 0) {
            tailBlock.body += `\n[NOTE: all turns filtered or empty after content extraction — check transcript or filter logic]\n`;
          }
          status = 'ok';
        }
      } catch (err) {
        tailBlock = { header: '', body: emitFailure(err.message || 'unknown parse error', 'parseTranscript', err.stack ? err.stack.split('\n')[0] : '') };
        status = 'failed';
        failureReason = err.message;
      }
    }

    // LLM-append section — now bonus, not load-bearing.
    //
    // The Transcript Tail above is bounded (TRANSCRIPT_TAIL_N turns /
    // TRANSCRIPT_BYTE_CAP bytes, newest-first): anything said EARLIER in a long
    // session — a constraint stated in turn 3, an option ruled out in turn 8 —
    // can fall outside that window and be gone once compaction runs. This
    // section is the only place left to catch it. Per Anthropic's "Prompting
    // Claude Fable 5.1" guide, section "Tell the model what to preserve in
    // compaction summaries" (platform.claude.com/docs/en/build-with-claude/
    // prompt-engineering/prompting-claude-fable-5-1), a compaction summary must
    // explicitly preserve: (1) difficulties/problems encountered, (2) options
    // considered, (3) anything asked for/decided/agreed/ruled out, or
    // established as a preference/constraint/boundary — quoted EXACTLY, not
    // paraphrased, (4) current state of the work, (5) open items / what
    // remains, (6) exact names, paths, and values.
    // Handoff sections (scripts/lib/compaction-handoff.js): repo state, dispatches, marker/ledger, model note,
    // machine state, then the transcript tail. Every section is fail-open and bounded.
    let handoffBody;
    try {
      handoffBody = require('../scripts/lib/compaction-handoff.js').buildHandoff({
        sessionId: input.session_id, cwd: input.cwd || process.cwd(), snapshot: collectedSnapshot, machineState, tail: tailBlock,
      });
    } catch (err) {
      handoffBody = `## Handoff sections\nunavailable: ${String(err && err.message).slice(0, 120)}\n\n${machineState}\n${tailBlock ? tailBlock.header + tailBlock.body : ''}`;
    }
    let stateContent = `# Autopilot Compaction Checkpoint\n${handoffBody}`;
    stateContent += `

## LLM Context (Claude-appended, optional supplement)
<!-- Claude: this section is OPTIONAL. The Transcript Tail above is already
     captured verbatim by the hook, but only its tail — earlier turns may
     already be out of the window. Use this section to carry forward, from
     ANYWHERE in the session (not just the tail), whatever the six categories
     below need and the tail doesn't already show:
     1. Difficulties or problems encountered.
     2. Options considered (including ones ruled out, and why).
     3. Anything asked for, decided, agreed, ruled out, or established as a
        preference/constraint/boundary — quote it EXACTLY, do not paraphrase.
     4. Current state of the work.
     5. Open items / what remains.
     6. Exact names, paths, and values (files touched, flags, IDs, numbers).
     If the tail above already shows a category verbatim, leave this section
     to the rest; don't restate what's already captured. -->
`;

    // Write state file
    // No usable session id: session-start matches the file to the resuming
    // session's id, so an unkeyed file could never be injected. Write nothing.
    if (!stateName) {
      process.stderr.write(`[state-checkpoint] no usable session_id in the payload — checkpoint not written\n`);
      status = 'failed';
      failureReason = 'no_session_id';
    } else try {
      const stateFile = path.join(STATE_DIR, stateName);
      fs.writeFileSync(stateFile, stateContent, { mode: 0o600 });
      try { fs.chmodSync(stateFile, 0o600); } catch { /* ignore */ }
    } catch (err) {
      // State file IO failure — diagnostic only goes to stderr + log
      process.stderr.write(`[state-checkpoint] CRITICAL: state file write failed: ${err.message}\n`);
      status = 'failed';
      failureReason = `state_file_write: ${err.message}`;
    }

    // stdout: on exit 0 Claude Code merges PreCompact stdout into the compaction summarizer's
    // custom instructions (binary 2.1.296 + docs; plan §2.1). It never reaches the model directly,
    // so it is addressed to the summarizer, bounded, and turned off by AUTOPILOT_PRECOMPACT_STDOUT=0.
    // The model gets the same state a second time from the file session-start injects. Diagnostics
    // stay on stderr and in the log.
    if (input.session_id && process.env.AUTOPILOT_PRECOMPACT_STDOUT !== '0') {
      const snap = renderWorkflowSnapshot(collectedSnapshot, SNAPSHOT_STDOUT_BYTES);
      process.stdout.write(`Preserve the following workflow state verbatim in the compaction summary (branch, stage, open tasks, dispatches, review state):\n${snap}\n`);
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
