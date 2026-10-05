'use strict';

// src/status/planned-input.js — the "planned" list of a watcher scope (mods P1W W1g). Display-only: it never enters a
// denominator (the renderer keeps `progress` for that).
//   campaign scope  -> the deliverable list of the controller progress receipt already read by work-order-progress.js:
//                      completed_deliverables then remaining_deliverables, `title` from receipt.deliverable_titles[id] when present.
//   other scopes    -> the union of <live>/tasks/<sid>.json (autopilot.session-tasks/1) of the sessions that belong to the scope:
//                      project_key equal, updated_at within WINDOW_MS, and the session's UNEXPIRED marker root_run_id equals the
//                      scope root (a session with no unexpired marker counts as root null, i.e. the unbound scope). Ordered by
//                      the file's first_created_at, then task order inside the file; deleted tasks dropped.
// Returns { value: [{id, title}], sha256, label } or null when there is nothing to show (not provided).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WINDOW_MS = 24 * 3600 * 1000;

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function fromReceipt(receipt) {
  if (!isObject(receipt)) return null;
  const done = Array.isArray(receipt.completed_deliverables) ? receipt.completed_deliverables : [];
  const open = Array.isArray(receipt.remaining_deliverables) ? receipt.remaining_deliverables : [];
  const titles = isObject(receipt.deliverable_titles) ? receipt.deliverable_titles : {};
  const value = [...done, ...open].map(String).map((id) => ({ id, title: typeof titles[id] === 'string' && titles[id] ? titles[id] : null }));
  return value.length ? { value, sha256: digest(value), label: 'controller_progress_receipt deliverables' } : null;
}

function fromTasks({ liveBase, key, root, markers, nowMs }) {
  const dir = path.join(liveBase, 'tasks');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch (_error) { return null; }
  // session id -> marker root (unexpired markers of this project only; the file name is the sanitized session id)
  const markerRoot = new Map();
  for (const m of markers || []) if (m && typeof m.session_id === 'string') markerRoot.set(m.session_id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), typeof m.root_run_id === 'string' ? m.root_run_id : null);
  const sessions = [];
  for (const name of names) {
    let v;
    try { v = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_error) { continue; }
    if (!isObject(v) || v.schema !== 'autopilot.session-tasks/1' || v.project_key !== key || !Array.isArray(v.tasks)) continue;
    const updated = Date.parse(v.updated_at);
    if (!Number.isFinite(updated) || nowMs - updated > WINDOW_MS) continue;
    const sid = typeof v.session_id === 'string' ? v.session_id : name.replace(/\.json$/, '');
    const norm = sid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const sessionRoot = markerRoot.has(norm) ? markerRoot.get(norm) : null;
    if ((sessionRoot || null) !== (root || null)) continue;
    const created = Date.parse(v.first_created_at);
    sessions.push({ sid, created: Number.isFinite(created) ? created : Infinity, tasks: v.tasks });
  }
  sessions.sort((a, b) => a.created - b.created || a.sid.localeCompare(b.sid));
  const value = [];
  for (const s of sessions) {
    for (const t of s.tasks) {
      if (!isObject(t) || t.status === 'deleted' || t.id == null) continue;
      const id = sessions.length > 1 ? `${s.sid.slice(0, 8)}#${t.id}` : String(t.id);
      value.push({ id, title: typeof t.subject === 'string' && t.subject ? t.subject : null });
    }
  }
  return value.length ? { value, sha256: digest(value), label: `session-tasks (${sessions.length} session${sessions.length === 1 ? '' : 's'})` } : null;
}

function readPlanned({ liveBase, key, root, progressReceipt, markers, nowMs }) {
  try {
    if (root && progressReceipt) {
      const c = fromReceipt(progressReceipt);
      if (c) return c;
    }
    return fromTasks({ liveBase, key, root, markers, nowMs });
  } catch (_error) {
    return null;
  }
}

module.exports = { readPlanned, WINDOW_MS };
