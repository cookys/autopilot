#!/usr/bin/env node
/**
 * session-handoff — SessionEnd hook (Node.js, opt-in / Tier B)
 *
 * Automates the recurring "do I need to write a handoff before I /clear?"
 * decision so the user never does it by hand. On `/clear` (and logout) Claude
 * Code fires SessionEnd with `reason: "clear"` (payload: session_id,
 * transcript_path, cwd, hook_event_name, reason — verified against
 * https://code.claude.com/docs/en/hooks.md). SessionEnd is SIDE-EFFECT ONLY
 * (can write files; canNOT inject context back to Claude — that's
 * SessionStart's job, which already surfaces a resume hint from the file we
 * write here).
 *
 * Two-step automation:
 *   1. DECIDE-IF-NEEDED — write a handoff ONLY if meaningful work happened this
 *      session. ANY of:
 *        (a) dirty   — git working tree has uncommitted changes
 *        (b) commits — ≥1 commit since session start (first transcript ts)
 *        (c) active  — a non-archived docs/projects/ entry touched this session
 *        (d) subst.  — substantive transcript: ≥ AUTOPILOT_HANDOFF_MIN_USER_TURNS
 *                      user turns OR ≥ AUTOPILOT_HANDOFF_MIN_TOOL_CALLS tool calls
 *      If NONE hold, exit 0 writing nothing — that IS the automated "no handoff
 *      needed" answer.
 *   2. IF NEEDED — parse transcript_path and write/UPDATE docs/HANDOFF.md in the
 *      repo cwd: timestamp, branch, `git status -sb`, recent commits, last
 *      action, and an inferred next-step / in-flight line. Section shape mirrors
 *      the manual docs/HANDOFF.md so session-start.js + a human both read it
 *      naturally. IDEMPOTENT — overwrites cleanly (never endlessly appends).
 *      MARKER-GUARD: a hand-written HANDOFF.md (no AUTO-GENERATED marker) is
 *      NEVER clobbered — the auto handoff lands as docs/HANDOFF.auto.md instead;
 *      only an absent or prior-auto file is overwritten in place.
 *
 * Conventions mirrored from state-checkpoint.js:
 *   - Parses the transcript ITSELF via state-checkpoint-lib.js (no Claude
 *     compliance dependency); reuses parseTranscriptText.
 *   - Byte cap on transcript read (tail-read a huge transcript, never OOM).
 *   - Fail-OPEN: exit 0 on ANY error. Never blocks. Guards a non-git cwd.
 *   - JSONL diag log at ~/.autopilot/.session-handoff.log (rotate 1MB), 600.
 *
 * NOTE: docs/HANDOFF.md is a VERSION-CONTROLLED repo doc → written with normal
 * perms (NOT chmod 600 like the ~/.autopilot/* state files). Only the diag log
 * (under ~/.autopilot) is 600.
 *
 * OPT-IN ONLY — wired as an example in settings.example.json, never in the
 * default-on hooks/hooks.json (it writes into the user's repo).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseTranscriptText } = require('./state-checkpoint-lib.js');

// === Constants (env-overridable; defaults are the documented threshold) ===
const ACT_REASONS = new Set(['clear', 'logout']); // ignore resume/other → no noise
const MIN_USER_TURNS = parseInt(process.env.AUTOPILOT_HANDOFF_MIN_USER_TURNS || '3', 10);
const MIN_TOOL_CALLS = parseInt(process.env.AUTOPILOT_HANDOFF_MIN_TOOL_CALLS || '12', 10);
const TRANSCRIPT_READ_CAP = parseInt(process.env.AUTOPILOT_HANDOFF_TRANSCRIPT_CAP || String(16 * 1024 * 1024), 10); // 16 MB tail
const LAST_ACTION_CAP = 280; // bytes of last-assistant text surfaced

const STATE_DIR = path.join(os.homedir(), '.autopilot');
const LOG_FILE = path.join(STATE_DIR, '.session-handoff.log');
const LOG_ROTATE_BYTES = 1 * 1024 * 1024;

// === Diagnostics ===

function appendLog(record) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > LOG_ROTATE_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    } catch { /* file may not exist yet */ }
    let line = JSON.stringify(record) + '\n';
    if (line.length > 4000) line = JSON.stringify({ ts: record.ts, status: record.status, _note: 'line truncated' }) + '\n';
    fs.appendFileSync(LOG_FILE, line, { mode: 0o600 });
    try { fs.chmodSync(LOG_FILE, 0o600); } catch { /* ignore */ }
  } catch (err) {
    process.stderr.write(`[session-handoff] log write failed: ${err.message}\n`);
  }
}

// === Git (run against the payload cwd, not necessarily process.cwd()) ===

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, timeout: 4000, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return (r.stdout || '').replace(/\s+$/, '');
}

function isGitRepo(cwd) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 4000, encoding: 'utf8' });
  return r.status === 0 && (r.stdout || '').trim() === 'true';
}

// === Transcript read (byte-capped, tail a huge file) ===

function readTranscriptCapped(transcriptPath) {
  let real;
  try {
    real = fs.realpathSync(transcriptPath);
  } catch {
    return null; // missing / unreadable → treat as no transcript
  }
  // Symlink-out-of-HOME guard, matching state-checkpoint's posture.
  if (!real.startsWith(os.homedir())) return null;
  let stat;
  try { stat = fs.statSync(real); } catch { return null; }
  if (stat.size <= TRANSCRIPT_READ_CAP) {
    try { return fs.readFileSync(real, 'utf8'); } catch { return null; }
  }
  // Tail-read the last cap bytes; drop the first (partial) line.
  try {
    const fd = fs.openSync(real, 'r');
    try {
      const buf = Buffer.allocUnsafe(TRANSCRIPT_READ_CAP);
      fs.readSync(fd, buf, 0, TRANSCRIPT_READ_CAP, stat.size - TRANSCRIPT_READ_CAP);
      const text = buf.toString('utf8');
      const nl = text.indexOf('\n');
      return nl >= 0 ? text.slice(nl + 1) : text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

// === Decision: did meaningful work happen this session? ===

function decide(cwd, parsed, sessionStartIso) {
  const reasons = [];

  // (a) dirty working tree
  const porcelain = git(cwd, ['status', '--porcelain']);
  if (porcelain && porcelain.trim()) reasons.push('dirty');

  // (b) commits since session start
  if (sessionStartIso) {
    const since = git(cwd, ['log', '--since=' + sessionStartIso, '--oneline']);
    if (since && since.trim()) reasons.push('commits');
  }

  // (c) active project/task — a non-archived docs/projects/ entry whose mtime is
  //     within the session window (session-scoped, so a stale always-present
  //     project doesn't force a write on a trivial session).
  if (sessionStartIso) {
    try {
      const projectsDir = path.join(cwd, 'docs', 'projects');
      const startMs = Date.parse(sessionStartIso);
      if (!Number.isNaN(startMs) && fs.existsSync(projectsDir)) {
        for (const entry of fs.readdirSync(projectsDir)) {
          if (entry === '_archive' || entry.startsWith('.')) continue;
          const p = path.join(projectsDir, entry);
          let st;
          try { st = fs.statSync(p); } catch { continue; }
          if (st.mtimeMs >= startMs - 1000) { reasons.push('active_project'); break; }
        }
      }
    } catch { /* ignore — advisory signal only */ }
  }

  // (d) substantive transcript
  let userTurns = 0, toolCalls = 0;
  if (parsed) {
    for (const t of parsed.turns) {
      if (t.role === 'user') userTurns++;
      if (t.role === 'assistant') {
        const m = t.text && t.text.match(/\[tool_use:/g);
        if (m) toolCalls += m.length;
      }
    }
    if (userTurns >= MIN_USER_TURNS || toolCalls >= MIN_TOOL_CALLS) reasons.push('substantive');
  }

  return { needed: reasons.length > 0, reasons, userTurns, toolCalls };
}

// === Last-action / next-step inference ===

function inferLastAction(parsed) {
  if (!parsed || !parsed.turns.length) return { lastAssistant: '', lastTool: '' };
  let lastAssistant = '';
  let lastTool = '';
  for (let i = parsed.turns.length - 1; i >= 0; i--) {
    const t = parsed.turns[i];
    if (t.role !== 'assistant') continue;
    // strip the lib's <thinking>…</thinking> and [tool_*] markers for a clean human line
    const text = (t.text || '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, ' ')
      .replace(/\[(tool_use|tool_result|image)[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!lastTool) {
      const tm = (t.text || '').match(/\[tool_use:\s*([A-Za-z0-9_./-]+)/g);
      if (tm && tm.length) lastTool = tm[tm.length - 1].replace(/\[tool_use:\s*/, '');
    }
    if (text) { lastAssistant = text.slice(0, LAST_ACTION_CAP); break; }
  }
  return { lastAssistant, lastTool };
}

function inferNextStep(reasons) {
  if (reasons.includes('dirty')) return 'Uncommitted changes in the working tree — review `git status`, then commit or discard before continuing.';
  if (reasons.includes('commits')) return 'New commits this session — push / open a PR / merge, or continue the next planned step.';
  if (reasons.includes('active_project')) return 'An active project doc was touched — resume from its current phase / next-step.';
  return 'Resume from the last action above.';
}

// === HANDOFF.md rendering (mirrors the manual file's section shape) ===

function renderHandoff({ timestamp, branch, statusSb, recentCommits, lastAssistant, lastTool, nextStep, reasons, userTurns, toolCalls }) {
  const lines = [];
  lines.push(`# Session Handoff — ${timestamp} (auto-generated)`);
  lines.push('');
  lines.push('<!-- AUTO-GENERATED by the session-handoff SessionEnd hook on /clear or logout.');
  lines.push('     Overwritten cleanly each session (idempotent); edit freely — it will be replaced. -->');
  lines.push('');
  lines.push('> Resuming after `/clear`: read this, run the Verification block, then continue.');
  lines.push('');
  lines.push('## Repo state');
  lines.push('');
  lines.push(`- Branch \`${branch || '(unknown)'}\`, snapshot at ${timestamp}.`);
  lines.push('- \`git status -sb\`:');
  lines.push('');
  lines.push('```');
  lines.push(statusSb || '(unavailable)');
  lines.push('```');
  lines.push('');
  lines.push('## Recent commits');
  lines.push('');
  lines.push('```');
  lines.push(recentCommits || '(no commits)');
  lines.push('```');
  lines.push('');
  lines.push('## Last action');
  lines.push('');
  lines.push(lastAssistant ? lastAssistant : '(no assistant turn captured)');
  if (lastTool) { lines.push(''); lines.push(`Last tool: \`${lastTool}\``); }
  lines.push('');
  lines.push('## Next step / in-flight');
  lines.push('');
  lines.push(nextStep);
  lines.push('');
  lines.push('## Why this handoff was written');
  lines.push('');
  lines.push(`- Triggers: ${reasons.join(', ')} (user turns: ${userTurns}, tool calls: ${toolCalls}).`);
  lines.push('');
  lines.push('## Verification (run on resume)');
  lines.push('');
  lines.push('```bash');
  lines.push('git status -sb | head -1');
  lines.push('git log --oneline -5');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

// === Main ===

(function main() {
  const ts = new Date().toISOString();
  let status = 'unknown';
  let reason = '<unknown>';
  let written = false;

  try {
    // Read the SessionEnd payload — fd 0 first (the '/dev/stdin' PATH ENXIOs in
    // the Bun-spawned hook env; fd 0 carries the payload), '/dev/stdin' fallback.
    let stdin = '';
    try { stdin = fs.readFileSync(0, 'utf8'); }
    catch {
      try { stdin = fs.readFileSync('/dev/stdin', 'utf8'); }
      catch { stdin = ''; }
    }
    const input = stdin.trim() ? JSON.parse(stdin) : {};
    reason = input.reason || '<none>';
    const transcriptPath = input.transcript_path || '';
    const cwd = input.cwd || process.cwd();

    // Act only on clear / logout.
    if (!ACT_REASONS.has(reason)) {
      appendLog({ ts, status: 'skip_reason', reason });
      return process.exit(0);
    }

    // Guard non-git cwd.
    if (!isGitRepo(cwd)) {
      appendLog({ ts, status: 'skip_non_git', reason, cwd });
      return process.exit(0);
    }

    // Parse transcript (byte-capped). Tolerate a missing/empty/huge transcript.
    let parsed = null;
    let sessionStartIso = '';
    if (transcriptPath) {
      const raw = readTranscriptCapped(transcriptPath);
      if (raw) {
        try {
          parsed = parseTranscriptText(raw);
          if (parsed.turns.length && parsed.turns[0].timestamp) sessionStartIso = parsed.turns[0].timestamp;
        } catch { parsed = null; }
      }
    }

    // Decide.
    const decision = decide(cwd, parsed, sessionStartIso);
    if (!decision.needed) {
      appendLog({ ts, status: 'no_handoff_needed', reason, user_turns: decision.userTurns, tool_calls: decision.toolCalls });
      return process.exit(0);
    }

    // Gather repo state + infer last action.
    const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || '';
    const statusSb = git(cwd, ['status', '-sb']) || '';
    const recentCommits = git(cwd, ['log', '--oneline', '-8']) || '';
    const { lastAssistant, lastTool } = inferLastAction(parsed);
    const nextStep = inferNextStep(decision.reasons);

    const content = renderHandoff({
      timestamp: ts, branch, statusSb, recentCommits,
      lastAssistant, lastTool, nextStep,
      reasons: decision.reasons, userTurns: decision.userTurns, toolCalls: decision.toolCalls,
    });

    // Marker-guard the write — NEVER clobber a hand-written HANDOFF.md. Overwrite
    // docs/HANDOFF.md only if it is absent OR already carries our AUTO-GENERATED
    // marker (idempotent on prior auto-runs); a MANUAL file (no marker) is left
    // untouched and the auto handoff lands alongside it as docs/HANDOFF.auto.md.
    const AUTO_MARKER = 'AUTO-GENERATED by the session-handoff';
    const handoffPath = path.join(cwd, 'docs', 'HANDOFF.md');
    let targetPath = handoffPath;
    try {
      if (fs.existsSync(handoffPath)) {
        const existing = fs.readFileSync(handoffPath, 'utf8');
        if (!existing.includes(AUTO_MARKER)) targetPath = path.join(cwd, 'docs', 'HANDOFF.auto.md');
      }
    } catch { /* unreadable existing → default to HANDOFF.md */ }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content); // normal perms — version-controlled doc
    written = true;
    status = targetPath === handoffPath ? 'handoff_written' : 'handoff_written_sidecar';

    appendLog({ ts, status, reason, handoff: targetPath, triggers: decision.reasons, user_turns: decision.userTurns, tool_calls: decision.toolCalls });
  } catch (err) {
    // Fail-open: log + stderr, still exit 0.
    process.stderr.write(`[session-handoff] ${err.message}\n`);
    try { appendLog({ ts, status: 'error', reason, error: err.message, written }); } catch { /* nothing more */ }
  }

  process.exit(0);
})();
