#!/usr/bin/env node
/**
 * session-tasks — TaskCreated | TaskCompleted | PostToolUse(TaskCreate|TaskUpdate|TaskList).
 * Default-on (mods P1W W1d). Maintains <live>/tasks/<sid>.json, the per-session task list the
 * `live` mod reads. Opt-out: AUTOPILOT_SESSION_TASKS=off.
 *
 * File shape (schema "autopilot.session-tasks/1"):
 *   { schema, session_id, cwd, project_key|null, updated_at, first_created_at,
 *     tasks:[{id, subject, status: pending|in_progress|completed|deleted, started_seq: int|null}],
 *     counts:{total, completed, in_progress}   // total/completed exclude `deleted`
 *     current:{id, subject}|null }             // most recently started in_progress task
 *
 * Folding rules (Claude Code 2.1.289 spike S11; no TaskUpdated event exists):
 *   TaskCreated / PostToolUse TaskCreate -> upsert, new tasks are pending, an existing status is kept
 *   TaskCompleted                        -> completed (never resurrects a deleted task)
 *   PostToolUse TaskUpdate               -> statusChange.to (fallback tool_input.status); applied only
 *                                           when `from` is absent or equals the current status, so replays
 *                                           and out-of-order duplicates are no-ops
 *   PostToolUse TaskList                 -> authoritative snapshot of the listed tasks
 * No change => no write (replays are byte-idempotent). Task tools are gated for sonnet/opus
 * unless CLAUDE_CODE_ENABLE_TODO_TOOLS=1: with no tool, no event arrives and no file is written.
 * Fail-open: any error -> one stderr line, exit 0.
 */
'use strict';

const L = require('./live-session-lib.js');

const STATUSES = new Set(['pending', 'in_progress', 'completed', 'deleted']);

function str(v) { return typeof v === 'string' || typeof v === 'number' ? String(v) : ''; }

function parseMaybeJson(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

function nextSeq(state) {
  return state.tasks.reduce((m, t) => Math.max(m, Number.isInteger(t.started_seq) ? t.started_seq : 0), 0) + 1;
}

function upsert(state, id, subject) {
  let t = state.tasks.find((x) => x.id === id);
  let isNew = false;
  if (!t) {
    t = { id, subject: subject || '', status: 'pending', started_seq: null };
    state.tasks.push(t);
    isNew = true;
  } else if (subject && t.subject !== subject) {
    t.subject = subject;
  }
  return { t, isNew };
}

function setStatus(state, t, to) {
  if (!STATUSES.has(to) || t.status === to) return;
  t.status = to;
  if (to === 'in_progress') t.started_seq = nextSeq(state);
}

function applyEvent(state, p) {
  const ev = p.hook_event_name;
  if (ev === 'TaskCreated') {
    const id = str(p.task_id);
    if (id) upsert(state, id, str(p.task_subject));
  } else if (ev === 'TaskCompleted') {
    const id = str(p.task_id);
    if (!id) return;
    const { t } = upsert(state, id, str(p.task_subject));
    if (t.status !== 'deleted') setStatus(state, t, 'completed');
  } else if (ev === 'PostToolUse') {
    const resp = parseMaybeJson(p.tool_response);
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
    if (p.tool_name === 'TaskCreate') {
      const task = resp && resp.task;
      if (task && str(task.id)) upsert(state, str(task.id), str(task.subject));
    } else if (p.tool_name === 'TaskUpdate') {
      if (resp && typeof resp === 'object' && resp.success === false) return;
      const id = str((resp && resp.taskId) || input.taskId);
      if (!id) return;
      const change = resp && resp.statusChange;
      const to = str((change && change.to) || input.status);
      const from = change && change.from ? str(change.from) : '';
      const { t, isNew } = upsert(state, id, str(input.subject));
      if (!to) return;
      if (isNew || !from || from === t.status) setStatus(state, t, to);
    } else if (p.tool_name === 'TaskList') {
      const list = resp && Array.isArray(resp.tasks) ? resp.tasks : [];
      for (const it of list) {
        if (!it || !str(it.id)) continue;
        const { t } = upsert(state, str(it.id), str(it.subject));
        if (STATUSES.has(it.status)) setStatus(state, t, it.status);
      }
    }
  }
}

function derive(state) {
  const live = state.tasks.filter((t) => t.status !== 'deleted');
  state.counts = {
    total: live.length,
    completed: live.filter((t) => t.status === 'completed').length,
    in_progress: live.filter((t) => t.status === 'in_progress').length,
  };
  const ip = live.filter((t) => t.status === 'in_progress')
    .sort((a, b) => (b.started_seq || 0) - (a.started_seq || 0));
  state.current = ip.length ? { id: ip[0].id, subject: ip[0].subject } : null;
}

function relevant(p) {
  const ev = p.hook_event_name;
  if (ev === 'TaskCreated' || ev === 'TaskCompleted') return true;
  return ev === 'PostToolUse' && ['TaskCreate', 'TaskUpdate', 'TaskList'].includes(p.tool_name);
}

function main() {
  if (L.knobOff('AUTOPILOT_SESSION_TASKS')) return;
  const p = L.readStdinJson();
  if (!relevant(p)) return;
  const file = L.sessionFile(p, 'tasks');
  if (!file) return;
  L.withLock(file, () => {
    const prev = L.readJsonFile(file);
    const valid = prev && prev.schema === 'autopilot.session-tasks/1' && Array.isArray(prev.tasks);
    const state = valid ? prev : {
      schema: 'autopilot.session-tasks/1',
      session_id: p.session_id,
      cwd: typeof p.cwd === 'string' ? p.cwd : null,
      project_key: null,
      updated_at: null,
      first_created_at: null,
      tasks: [],
      counts: { total: 0, completed: 0, in_progress: 0 },
      current: null,
    };
    const before = JSON.stringify(state);
    applyEvent(state, p);
    derive(state);
    const cwd = typeof p.cwd === 'string' ? p.cwd : null;
    if (!valid || (cwd && state.cwd !== cwd)) {
      if (cwd) state.cwd = cwd;
      state.project_key = L.projectKeyFor(state.cwd);
    }
    if (valid && JSON.stringify(state) === before) return;
    const now = new Date().toISOString();
    state.updated_at = now;
    if (!state.first_created_at && state.tasks.length) state.first_created_at = now;
    if (!valid && !state.tasks.length) return;
    L.atomicWriteJson(file, state);
  });
}

try { main(); } catch (e) { L.failOpen('session-tasks', e); }
process.exit(0);
