#!/usr/bin/env node
/**
 * session-handoff — SessionEnd hook (Node.js, opt-in / Tier B)
 *
 * Reworked to write machine handoff state only under ~/.autopilot (no repo writes).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { parseTranscriptText } = require('./state-checkpoint-lib.js');

const ACT_REASONS = new Set(['clear', 'logout']);
const MIN_USER_TURNS = parseInt(process.env.AUTOPILOT_HANDOFF_MIN_USER_TURNS || '3', 10);
const MIN_TOOL_CALLS = parseInt(process.env.AUTOPILOT_HANDOFF_MIN_TOOL_CALLS || '12', 10);
const TRANSCRIPT_READ_CAP = parseInt(process.env.AUTOPILOT_HANDOFF_TRANSCRIPT_CAP || String(16 * 1024 * 1024), 10);
const LAST_ACTION_CAP = 280;

const STATE_DIR = path.join(os.homedir(), '.autopilot');
const HANDOFF_DIR = path.join(STATE_DIR, 'handoff');
const LOG_FILE = path.join(STATE_DIR, '.session-handoff.log');
const LOG_ROTATE_BYTES = 1 * 1024 * 1024;

function appendLog(record) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > LOG_ROTATE_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    } catch { /* file may not exist yet */ }
    let line = JSON.stringify(record) + '\n';
    if (line.length > 4000) line = JSON.stringify({ ts: record.ts, status: record.status, _note: 'line truncated' }) + '\n';
    fs.appendFileSync(LOG_FILE, line);
    try { fs.chmodSync(LOG_FILE, 0o600); } catch { /* ignore */ }
  } catch (err) {
    process.stderr.write(`[session-handoff] log write failed: ${err.message}\n`);
  }
}

function runGit(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { timeout: 4000, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return (r.stdout || '').replace(/\s+$/, '');
}

function resolveRepoRoot(payloadCwd) {
  const top = runGit(payloadCwd, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  try { return fs.realpathSync(top); } catch { return null; }
}

function readTranscriptCapped(transcriptPath) {
  let real;
  try {
    real = fs.realpathSync(transcriptPath);
  } catch {
    return null;
  }
  // Keep the previous symlink safety posture.
  if (!real.startsWith(os.homedir())) return null;
  let stat;
  try { stat = fs.statSync(real); } catch { return null; }
  if (stat.size <= TRANSCRIPT_READ_CAP) {
    try { return fs.readFileSync(real, 'utf8'); } catch { return null; }
  }
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

function decide(repoRoot, parsed, sessionStartIso) {
  const reasons = [];

  const porcelain = runGit(repoRoot, ['status', '--porcelain']);
  if (porcelain && porcelain.trim()) reasons.push('dirty');

  if (sessionStartIso) {
    const since = runGit(repoRoot, ['log', '--since=' + sessionStartIso, '--oneline']);
    if (since && since.trim()) reasons.push('commits');
  }

  if (sessionStartIso) {
    try {
      const projectsDir = path.join(repoRoot, 'docs', 'projects');
      const startMs = Date.parse(sessionStartIso);
      if (!Number.isNaN(startMs) && fs.existsSync(projectsDir)) {
        for (const entry of fs.readdirSync(projectsDir)) {
          if (entry === '_archive' || entry.startsWith('.')) continue;
          const entryPath = path.join(projectsDir, entry);
          let st;
          try { st = fs.statSync(entryPath); } catch { continue; }
          if (st.mtimeMs >= startMs - 1000) {
            reasons.push('active_project');
            break;
          }
        }
      }
    } catch { /* advisory */ }
  }

  let userTurns = 0;
  let toolCalls = 0;
  if (parsed) {
    for (const t of parsed.turns) {
      if (t.role === 'user') userTurns++;
      if (t.role === 'assistant') {
        const matches = t.text && t.text.match(/\[tool_use:/g);
        if (matches) toolCalls += matches.length;
      }
    }
    if (userTurns >= MIN_USER_TURNS || toolCalls >= MIN_TOOL_CALLS) reasons.push('substantive');
  }

  return { needed: reasons.length > 0, reasons, userTurns, toolCalls };
}

function inferLastAction(parsed) {
  if (!parsed || !parsed.turns.length) return { lastAssistant: '', lastTool: '' };
  let lastAssistant = '';
  let lastTool = '';
  for (let i = parsed.turns.length - 1; i >= 0; i--) {
    const t = parsed.turns[i];
    if (t.role !== 'assistant') continue;
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
  lines.push('- `git status -sb`:');
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
  if (lastTool) {
    lines.push('');
    lines.push(`- Last tool: \`${lastTool.trim()}\``);
  }
  lines.push('');
  lines.push('## Why this handoff exists');
  lines.push('');
  lines.push(`- Reasons: ${reasons.join(', ')}`);
  lines.push(`- user turns: ${userTurns}`);
  lines.push(`- tool calls: ${toolCalls}`);
  lines.push('');
  lines.push('## Next step');
  lines.push('');
  lines.push(nextStep);
  return lines.join('\n');
}

function publishAtomic(bodyPath, metaPath, content, meta) {
  const pid = process.pid;
  const tmpMeta = `${metaPath}.tmp.${pid}`;
  const tmpBody = `${bodyPath}.tmp.${pid}`;

  fs.writeFileSync(tmpMeta, JSON.stringify(meta), { encoding: 'utf8' });
  fs.chmodSync(tmpMeta, 0o600);
  fs.renameSync(tmpMeta, metaPath);

  fs.writeFileSync(tmpBody, content, { encoding: 'utf8' });
  fs.chmodSync(tmpBody, 0o600);
  fs.renameSync(tmpBody, bodyPath);
}

(function main() {
  const ts = new Date().toISOString();
  let status = 'unknown';
  let reason = '<unknown>';
  let written = false;

  try {
    let stdin = '';
    try {
      stdin = fs.readFileSync(0, 'utf8');
    } catch {
      try { stdin = fs.readFileSync('/dev/stdin', 'utf8'); } catch { stdin = ''; }
    }
    const input = stdin.trim() ? JSON.parse(stdin) : {};
    reason = input.reason || '<none>';
    const transcriptPath = input.transcript_path || '';
    const payloadCwd = input.cwd || process.cwd();
    const repoRoot = resolveRepoRoot(payloadCwd);

    if (!ACT_REASONS.has(reason)) {
      appendLog({ ts, status: 'skip_reason', reason });
      return process.exit(0);
    }

    if (!repoRoot) {
      appendLog({ ts, status: 'skip_non_git', reason, cwd: payloadCwd });
      return process.exit(0);
    }

    let parsed = null;
    let sessionStartIso = '';
    if (transcriptPath) {
      const raw = readTranscriptCapped(transcriptPath);
      if (raw) {
        try {
          parsed = parseTranscriptText(raw);
          if (parsed.turns.length && parsed.turns[0].timestamp) sessionStartIso = parsed.turns[0].timestamp;
        } catch {
          parsed = null;
        }
      }
    }

    const decision = decide(repoRoot, parsed, sessionStartIso);
    if (!decision.needed) {
      appendLog({ ts, status: 'no_handoff_needed', reason, user_turns: decision.userTurns, tool_calls: decision.toolCalls });
      return process.exit(0);
    }

    const branch = runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || '';
    const statusSb = runGit(repoRoot, ['status', '-sb']) || '';
    const recentCommits = runGit(repoRoot, ['log', '--oneline', '-8']) || '';
    const { lastAssistant, lastTool } = inferLastAction(parsed);
    const nextStep = inferNextStep(decision.reasons);

    const content = renderHandoff({
      timestamp: ts,
      branch,
      statusSb,
      recentCommits,
      lastAssistant,
      lastTool,
      nextStep,
      reasons: decision.reasons,
      userTurns: decision.userTurns,
      toolCalls: decision.toolCalls,
    });

    const repoHash = crypto.createHash('sha1').update(repoRoot).digest('hex');
    const bodyPath = path.join(HANDOFF_DIR, `${repoHash}.md`);
    const metaPath = path.join(HANDOFF_DIR, `${repoHash}.meta.json`);
    const meta = {
      repo_root: repoRoot,
      written_at: ts,
      session_id: input.session_id || '',
      body_bytes: Buffer.byteLength(content, 'utf8'),
    };

    if (!fs.existsSync(HANDOFF_DIR)) fs.mkdirSync(HANDOFF_DIR, { recursive: true, mode: 0o700 });
    publishAtomic(bodyPath, metaPath, content, meta);
    fs.chmodSync(bodyPath, 0o600);
    fs.chmodSync(metaPath, 0o600);
    written = true;
    status = 'handoff_written';

    appendLog({ ts, status, reason, repo_hash: repoHash, handoff: bodyPath, triggers: decision.reasons, user_turns: decision.userTurns, tool_calls: decision.toolCalls });
  } catch (err) {
    process.stderr.write(`[session-handoff] ${err.message}\n`);
    try { appendLog({ ts, status: 'error', reason, error: err.message, written }); } catch { /* nothing more */ }
  }
  process.exit(0);
})();
