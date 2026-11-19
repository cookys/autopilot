#!/usr/bin/env node
'use strict';

// subagent-fleet-task — SubagentStop + PostToolUse(TaskStop) [default-on]
// Writes ONE fail-soft progress line `[dispatch:<role>] <run_id> <status> sha=<sha|-> log=<path|->` to the Fleet-Task
// named by the subagent's brief (first user message) or, failing that, the session marker's fleet_task_id, when a
// subagent stops (stopped) or is stopped (cancelled). PostToolUse(Agent) at launch never writes.
// Never auto-marks a task done; fleet failure/timeout -> swallowed, exit 0, nothing on stdout.

const fs = require('fs');
const path = require('path');
const { resolveDir, firstUserMessage } = require('./subagent-budget.js');
const { liveBase, readJsonFile } = require('./live-session-lib.js');
const { sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
const { findTaskId, isValidTaskId } = require('../scripts/lib/fleet-task-ref.js');
const { dispatchEnding } = require('../scripts/lib/fleet-task.js');

const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function findSubagentTranscript(payload, agentId) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.agent_transcript_path === 'string' && payload.agent_transcript_path) {
    try {
      if (fs.statSync(payload.agent_transcript_path).isFile()) return payload.agent_transcript_path;
    } catch { /* fall through */ }
  }
  if (agentId && SAFE_ID_RE.test(agentId) && typeof payload.transcript_path === 'string' && payload.transcript_path) {
    const dir = resolveDir(payload);
    if (dir) {
      const candidate = path.join(dir, `agent-${agentId}.jsonl`);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* fall through */ }
    }
    if (path.basename(payload.transcript_path) === `agent-${agentId}.jsonl`) {
      try {
        if (fs.statSync(payload.transcript_path).isFile()) return payload.transcript_path;
      } catch { /* fall through */ }
    }
  }
  return null;
}

function readTaskIdFromSubagent(payload, agentId) {
  const file = findSubagentTranscript(payload, agentId);
  if (!file) return null;
  try {
    return findTaskId(firstUserMessage(file));
  } catch {
    return null;
  }
}

function readAgentStamp(sessionId, agentId) {
  if (typeof sessionId !== 'string' || !sessionId || typeof agentId !== 'string' || !agentId) return null;
  try {
    const file = path.join(liveBase(), 'agents', sanitizeSessionId(sessionId), `${sanitizeSessionId(agentId)}.json`);
    const v = readJsonFile(file);
    return v && v.schema === 'autopilot.agent-activity/1' ? v : null;
  } catch {
    return null;
  }
}

function markerTaskId(sessionId) {
  try {
    const { readSessionRecord } = require('../scripts/session-mode.js');
    const rec = typeof sessionId === 'string' && sessionId ? readSessionRecord(sessionId) : null;
    const id = rec && typeof rec.fleet_task_id === 'string' ? rec.fleet_task_id.trim() : '';
    return isValidTaskId(id) ? id : null;
  } catch {
    return null;
  }
}

function briefOf(file) {
  try { return file ? firstUserMessage(file) : ''; } catch { return ''; }
}

function roleOf(brief) {
  const m = /^Role:[ \t]*([A-Za-z0-9][A-Za-z0-9._-]{0,63})[ \t]*$/m.exec(brief);
  return m ? m[1] : 'subagent';
}

// Last 40-hex commit sha in the subagent's final assistant text, else '-'.
function lastShaOf(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"assistant"')) continue;
      const found = lines[i].match(/\b[0-9a-f]{40}\b/g);
      if (found) return found[found.length - 1];
      break;
    }
  } catch { /* none */ }
  return '-';
}

function writeBack(payload, agentId, status) {
  const transcript = findSubagentTranscript(payload, agentId);
  const brief = briefOf(transcript);
  const taskId = findTaskId(brief) || markerTaskId(payload.session_id);
  if (!taskId) return;
  const t = Number(process.env.AUTOPILOT_FLEET_WRITEBACK_TIMEOUT_MS);
  try {
    dispatchEnding(taskId, {
      role: roleOf(brief),
      runId: agentId,
      status,
      sha: transcript ? lastShaOf(transcript) : '-',
      log: transcript || '-',
    }, Number.isFinite(t) && t > 0 ? { timeoutMs: t } : {});
  } catch { /* fail-soft */ }
}

// Only SubagentStop and PostToolUse(TaskStop) write; PostToolUse(Agent) at launch never does.
function handleHookPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  const ev = String(payload.hook_event_name || '');

  if (ev === 'PostToolUse' || payload.tool_name === 'TaskStop') {
    if (payload.tool_name !== 'TaskStop') return;
    const ti = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
    const taskIdArg = typeof ti.task_id === 'string' ? ti.task_id.trim() : '';
    if (!taskIdArg || !SAFE_ID_RE.test(taskIdArg)) return;
    // Non-subagent TaskStop (e.g. background bash) is ignored.
    if (!findSubagentTranscript(payload, taskIdArg) && !readAgentStamp(payload.session_id, taskIdArg)) return;
    writeBack(payload, taskIdArg, 'cancelled');
    return;
  }

  if (ev === 'SubagentStop' || (typeof payload.agent_id === 'string' && payload.agent_id && !payload.tool_name)) {
    const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.trim() : '';
    if (!agentId || !SAFE_ID_RE.test(agentId)) return;
    writeBack(payload, agentId, 'stopped');
  }
}

if (require.main === module) {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = raw.trim() ? JSON.parse(raw) : {};
    handleHookPayload(payload);
  } catch (e) {
    try { process.stderr.write(`subagent-fleet-task: ${e && e.message ? e.message : e} (fail-open)\n`); } catch { /* ignore */ }
  }
  process.exit(0);
}

module.exports = { handleHookPayload, findSubagentTranscript, readTaskIdFromSubagent };
