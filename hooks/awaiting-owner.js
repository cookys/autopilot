#!/usr/bin/env node
/**
 * awaiting-owner — PermissionRequest | Notification | Stop | PostToolUse | UserPromptSubmit |
 * SessionEnd. Default-on (mods P1W W1e). Maintains <live>/attention/<sid>.json while Claude Code
 * waits on the human. Opt-out: AUTOPILOT_AWAITING_OWNER=off.
 *
 * File shape (schema "autopilot.attention/1"), present ONLY while waiting:
 *   { schema, session_id, project_key|null, kind: "permission"|"question"|"idle",
 *     tool_name|null, summary, since, updated_at }
 *
 * Start / end signals (spike S10, Claude Code 2.1.289):
 *   PermissionRequest                 -> start permission (AskUserQuestion => question)
 *   Notification idle_prompt          -> start idle (NOT Stop: idle_prompt is the +60 s confirmation)
 *   Notification permission_prompt    -> heartbeat only (updated_at) on an existing permission/question
 *                                        file; never creates one, so a late Notification cannot resurrect
 *   PostToolUse of the SAME tool_name -> end permission/question (approve / answer)
 *   Stop | UserPromptSubmit | SessionEnd -> end everything (UserPromptSubmit is the ONLY end for a
 *                                        human deny/Esc; the file lingers until then, `since` = age)
 * summary: question text for AskUserQuestion; else "<tool>: <command|file_path>" run through
 * hooks/_shared/secret-patterns redact(), newlines flattened, truncated to 120 chars.
 * Fail-open: any error -> one stderr line, exit 0.
 */
'use strict';

const L = require('./live-session-lib.js');
const { redact } = require('./_shared/secret-patterns.js');

const MAX = 120;

function flat(s) {
  const t = redact(String(s)).replace(/\s+/g, ' ').trim();
  return t.length > MAX ? `${t.slice(0, MAX - 1)}…` : t;
}

function summarize(p) {
  const tool = typeof p.tool_name === 'string' ? p.tool_name : '';
  const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  if (tool === 'AskUserQuestion') {
    const qs = Array.isArray(input.questions) ? input.questions : [];
    const q = qs[0] && typeof qs[0].question === 'string' ? qs[0].question : '';
    if (q) return flat(qs.length > 1 ? `${q} (+${qs.length - 1} more)` : q);
    return 'AskUserQuestion';
  }
  const detail = typeof input.command === 'string' ? input.command
    : typeof input.file_path === 'string' ? input.file_path
      : typeof input.path === 'string' ? input.path : '';
  return flat(detail ? `${tool}: ${detail}` : tool);
}

function main() {
  if (L.knobOff('AUTOPILOT_AWAITING_OWNER')) return;
  const p = L.readStdinJson();
  const ev = p.hook_event_name;
  const notifType = p.notification_type;
  const file = L.sessionFile(p, 'attention');
  if (!file) return;
  const now = new Date().toISOString();

  if (ev === 'PostToolUse') {
    // Hot path (every tool call): bail before the lock when nothing is pending.
    if (!require('fs').existsSync(file)) return;
  }

  L.withLock(file, () => {
    const cur = L.readJsonFile(file);
    const pending = cur && cur.schema === 'autopilot.attention/1' ? cur : null;
    if (ev === 'UserPromptSubmit' || ev === 'Stop' || ev === 'SessionEnd') {
      L.removeFile(file);
    } else if (ev === 'PostToolUse') {
      if (pending && (pending.kind === 'permission' || pending.kind === 'question')
        && pending.tool_name === p.tool_name) L.removeFile(file);
    } else if (ev === 'PermissionRequest') {
      const tool = typeof p.tool_name === 'string' && p.tool_name ? p.tool_name : null;
      const kind = tool === 'AskUserQuestion' ? 'question' : 'permission';
      const summary = summarize(p);
      const same = pending && pending.kind === kind && pending.tool_name === tool && pending.summary === summary;
      L.atomicWriteJson(file, {
        schema: 'autopilot.attention/1',
        session_id: p.session_id,
        project_key: same ? pending.project_key : L.projectKeyFor(p.cwd),
        kind,
        tool_name: tool,
        summary,
        since: same ? pending.since : now,
        updated_at: now,
      });
    } else if (ev === 'Notification' && notifType === 'permission_prompt') {
      if (pending && (pending.kind === 'permission' || pending.kind === 'question')) {
        L.atomicWriteJson(file, { ...pending, updated_at: now });
      }
    } else if (ev === 'Notification' && notifType === 'idle_prompt') {
      if (pending && pending.kind !== 'idle') return; // a real prompt outranks idle
      L.atomicWriteJson(file, {
        schema: 'autopilot.attention/1',
        session_id: p.session_id,
        project_key: pending ? pending.project_key : L.projectKeyFor(p.cwd),
        kind: 'idle',
        tool_name: null,
        summary: 'waiting for your input',
        since: pending ? pending.since : now,
        updated_at: now,
      });
    }
  });
}

try { main(); } catch (e) { L.failOpen('awaiting-owner', e); }
process.exit(0);
