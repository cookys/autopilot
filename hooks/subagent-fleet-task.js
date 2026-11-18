#!/usr/bin/env node
'use strict';

// subagent-fleet-task — SubagentStop + PostToolUse(TaskStop) [default-on]
// Writes one fail-soft progress line to Fleet-Task when a bound subagent stops or is stopped.
// Never auto-marks a task done; never fails or writes to stdout.

const fs = require('fs');
const path = require('path');
const { resolveDir, firstUserMessage } = require('./subagent-budget.js');
const { readAgentFile } = require('./live-session-lib.js');
const { findTaskId, emitProgressFailSoft } = require('../scripts/lib/fleet-task-ref.js');

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

function handleHookPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  const ev = String(payload.hook_event_name || '');

  if (ev === 'PostToolUse' || payload.tool_name === 'TaskStop') {
    if (payload.tool_name !== 'TaskStop') return;
    const ti = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
    const taskIdArg = typeof ti.task_id === 'string' ? ti.task_id.trim() : '';
    if (!taskIdArg || !SAFE_ID_RE.test(taskIdArg)) return;

    const transcript = findSubagentTranscript(payload, taskIdArg);
    const stamp = payload.session_id ? readAgentFile(payload.session_id, taskIdArg) : null;
    if (!transcript && !stamp) return; // Non-subagent TaskStop (e.g. background bash) is ignored.

    const fleetTaskId = transcript ? findTaskId((() => { try { return firstUserMessage(transcript); } catch { return ''; } })()) : null;
    if (!fleetTaskId) return;
    emitProgressFailSoft(fleetTaskId, `[subagent] ${taskIdArg} cancelled`);
    return;
  }

  if (ev === 'SubagentStop' || (typeof payload.agent_id === 'string' && payload.agent_id && !payload.tool_name)) {
    const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.trim() : '';
    if (!agentId || !SAFE_ID_RE.test(agentId)) return;
    const fleetTaskId = readTaskIdFromSubagent(payload, agentId);
    if (!fleetTaskId) return;
    emitProgressFailSoft(fleetTaskId, `[subagent] ${agentId} stopped`);
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
