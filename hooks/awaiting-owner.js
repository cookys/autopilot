#!/usr/bin/env node
/**
 * awaiting-owner — PermissionRequest | Notification | Stop | PostToolUse | UserPromptSubmit | SubagentStop |
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
 * Also maintains <live>/turn/<sid>.json (schema "autopilot.session-turn/1", mods P1W TURN, same knob):
 * UserPromptSubmit -> state "active"; Stop -> "ended" (since = now); SessionEnd -> removed. Payloads with
 * agent_id (subagents) never touch it. See live-session-lib.js recordTurn().
 * SubagentStop (mods P1W FOREMAN, payload carries agent_id): marks <live>/agents/<sid>/<agent_id>.json `ended_at` (knob
 * AUTOPILOT_AGENT_ACTIVITY=off); touches nothing else.
 * summary: question text for AskUserQuestion; else "<tool>: <command|file_path>" run through
 * hooks/_shared/secret-patterns redact(), newlines flattened, truncated to 120 chars.
 * Fail-open: any error -> one stderr line, exit 0.
 */
'use strict';

const L = require('./live-session-lib.js');

let redactFn = null;
function redact(s) { // lazy: only the summary-building (PermissionRequest) path needs it
  if (redactFn === null) redactFn = require('./_shared/secret-patterns.js').redact;
  return redactFn(s);
}

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

// One event, already parsed. Exported so the default-on hosts (audit-log.js for PostToolUse, advisory-relay.js
// for UserPromptSubmit) run this work in THEIR process instead of spawning another node per tool call /
// prompt (mods P1W PERF).
function handle(p) {
  const ev = p.hook_event_name;
  const notifType = p.notification_type;
  // STAMP (own knob, no lock, fail-open on its own): a subagent's tool call refreshes its liveness file;
  // SessionEnd drops the session's stamp dir.
  try {
    if (ev === 'PostToolUse') L.stampAgentActivity(p);
    else if (ev === 'SubagentStop') L.endAgentActivity(p); // FOREMAN: the agent is done (ended_at)
    else if (ev === 'SessionEnd') L.removeAgentActivity(p);
  } catch (e) { L.failOpen('awaiting-owner/agent-activity', e); }
  if (ev === 'SubagentStop') return; // nothing else here concerns a subagent's stop (turn and attention are the main thread's)
  // HOOKQ (mods P1W): the session ending closes the decision file its AskUserQuestion opened (knob AUTOPILOT_ASK_DECISION).
  if (ev === 'SessionEnd') {
    try { require('./ask-decision.js').onSessionEnd(p); } catch (e) { L.failOpen('awaiting-owner/ask-decision', e); }
  }
  if (L.knobOff('AUTOPILOT_AWAITING_OWNER')) return;
  // TURN (mods P1W): the session-turn file, same knob, no lock (tmp + rename), fail-open on its own.
  try { L.recordTurn(p); } catch (e) { L.failOpen('awaiting-owner/turn', e); }
  const file = L.sessionFile(p, 'attention');
  if (!file) return;
  const now = new Date().toISOString();

  if (ev === 'PostToolUse' || ev === 'UserPromptSubmit' || ev === 'Stop' || ev === 'SessionEnd') {
    // Hot path (every tool call / prompt): one stat, no lock when nothing is pending. Removing a
    // missing file is a no-op, so skipping the lock for the end events is behaviour-identical.
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

// UserPromptSubmit work for the host process (advisory-relay.js, default-on): end any pending wait, then
// ensure the project watcher. The ensure sits outside the awaiting-owner knob (it has its own
// AUTOPILOT_RUNS_WATCH_AUTOSTART switch) and never lets one job's failure stop the other.
function onUserPromptSubmit(p) {
  try { handle(p); } catch (e) { L.failOpen('awaiting-owner', e); }
  try { require('./runs-watch-autostart.js').run(p); } catch (e) { L.failOpen('runs-watch-autostart', e); }
}

function main() {
  const p = L.readStdinJson();
  handle(p);
  if (p.hook_event_name === 'UserPromptSubmit') {
    try { require('./runs-watch-autostart.js').run(p); } catch (e) { L.failOpen('runs-watch-autostart', e); }
  }
}

module.exports = { handle, onUserPromptSubmit };

if (require.main === module) {
  try { main(); } catch (e) { L.failOpen('awaiting-owner', e); }
  process.exit(0);
}
