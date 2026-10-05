#!/usr/bin/env node
/**
 * awaiting-owner — PermissionRequest | Notification | Stop | PostToolUse | UserPromptSubmit | SubagentStart |
 * SubagentStop | SessionEnd. Default-on (mods P1W W1e). Maintains <live>/attention/<sid>.json while Claude Code
 * waits on the human. Opt-out: AUTOPILOT_AWAITING_OWNER=off.
 *
 * File shape (schema "autopilot.attention/1"), present ONLY while something is pending. ONE ENTRY PER PENDING DIALOG (mods P1W
 * FOREMAN2, additive): { schema, session_id, project_key|null, kind, tool_name|null, summary, since, updated_at,
 *   pending: [{ agent_id|null, tool_name|null, input_digest|null, kind: "permission"|"question"|"idle", summary, since, updated_at }] }
 * The top-level kind/tool_name/summary/since keep their old meaning (mods/live/model.ts and the gate kit read them): they are the OLDEST
 * permission/question entry, "idle" only when no permission/question entry exists. A file without `pending` (older writer) is read as one
 * main-thread entry and rewritten in the new shape on the next event.
 *
 * Start / end signals (spike S10, Claude Code 2.1.289). agent_id is the payload's (a subagent's tool call carries it: the base hook
 * input is built with `agent_id: toolUseContext.agentId` for every event incl. PermissionRequest); the main thread is agent_id null.
 *   PermissionRequest                 -> add / refresh the entry keyed (agent_id, tool_name, input_digest) (AskUserQuestion => question);
 *                                        input_digest = sha256 of the canonical JSON of tool_input, 16 hex; idle entries are dropped
 *   Notification idle_prompt          -> add idle (NOT Stop: idle_prompt is the +60 s confirmation) only when no permission/question entry
 *   Notification permission_prompt    -> heartbeat (updated_at) only; never creates a file, so a late Notification cannot resurrect
 *   PostToolUse                       -> end the exact (agent_id, tool_name, digest) entry; else the OLDEST permission/question entry of
 *                                        the same (agent_id, tool_name) (Tab-to-amend changes the input); NEVER another agent's entry
 *   Stop | UserPromptSubmit           -> end main-thread entries (agent_id null) and idle; subagent entries survive
 *                                        (UserPromptSubmit is the ONLY end for a human deny/Esc of a main-thread dialog)
 *   SubagentStop(agent_id)            -> end that agent's entries (the only end for a human-denied subagent dialog)
 *   SessionEnd                        -> end everything
 * Consequence: an approved subagent dialog keeps showing until that agent's PostToolUse (the main-thread limitation, now for subagents).
 * Also maintains <live>/turn/<sid>.json (schema "autopilot.session-turn/1", mods P1W TURN, same knob):
 * UserPromptSubmit -> state "active"; Stop -> "ended" (since = now); SessionEnd -> removed. Payloads with
 * agent_id (subagents) never touch it. See live-session-lib.js recordTurn().
 * SubagentStart (mods P1W FOREMAN2, payload carries agent_id + agent_type): writes the agent's stamp (last_tool_at now, last_tool_name
 * null, no ended_at; the only path that clears an earlier ended_at), same knob; touches nothing else.
 * SubagentStop (mods P1W FOREMAN, payload carries agent_id): marks <live>/agents/<sid>/<agent_id>.json `ended_at` (knob
 * AUTOPILOT_AGENT_ACTIVITY=off); touches nothing else.
 * TaskStop (mods P1W TASKSTOP, PostToolUse = a successful call; tool_input.task_id equals the agent's agent_id): ends that agent's
 * EXISTING stamp (ended_at, first end wins), because stopping a background agent fires no SubagentStop. Never creates a file (a shell
 * task id has no stamp); a non-safe id ends nothing. Same knob AUTOPILOT_AGENT_ACTIVITY=off.
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

const bySince = (x, y) => Date.parse(x.since) - Date.parse(y.since);
const agentOf = (p) => (typeof p.agent_id === 'string' && p.agent_id ? p.agent_id : null);

function inputDigest(input) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return require('crypto').createHash('sha256').update(JSON.stringify(canon(input === undefined ? null : input))).digest('hex').slice(0, 16);
}

// The entries of a parsed attention file; an old-shape file (no `pending`) is one main-thread entry.
function entriesOf(cur) {
  if (Array.isArray(cur.pending)) {
    return cur.pending.filter((e) => e && typeof e === 'object' && ['permission', 'question', 'idle'].includes(e.kind) && Number.isFinite(Date.parse(e.since)))
      .map((e) => ({ agent_id: typeof e.agent_id === 'string' && e.agent_id ? e.agent_id : null, tool_name: e.tool_name || null, input_digest: e.input_digest || null, kind: e.kind, summary: String(e.summary || ''), since: e.since, updated_at: e.updated_at || e.since }));
  }
  if (!['permission', 'question', 'idle'].includes(cur.kind) || !Number.isFinite(Date.parse(cur.since))) return [];
  return [{ agent_id: null, tool_name: cur.tool_name || null, input_digest: null, kind: cur.kind, summary: String(cur.summary || ''), since: cur.since, updated_at: cur.updated_at || cur.since }];
}

// Write the file from its entries (top-level = oldest permission/question entry, else idle) or remove it when none are left.
function writeEntries(file, p, entries, projectKey, now) {
  if (entries.length === 0) { L.removeFile(file); return; }
  const live = entries.filter((e) => e.kind !== 'idle').sort(bySince);
  const top = live[0] || entries[0];
  L.atomicWriteJson(file, {
    schema: 'autopilot.attention/1',
    session_id: p.session_id,
    project_key: projectKey === undefined ? L.projectKeyFor(p.cwd) : projectKey,
    kind: top.kind,
    tool_name: top.tool_name,
    summary: top.summary,
    since: top.since,
    updated_at: now,
    pending: entries,
  });
}

// SubagentStop: drop one agent's entries.
function endEntries(p, agentId) {
  const file = L.sessionFile(p, 'attention');
  if (!file || !require('fs').existsSync(file)) return;
  L.withLock(file, () => {
    const cur = L.readJsonFile(file);
    if (!cur || cur.schema !== 'autopilot.attention/1') return;
    const entries = entriesOf(cur);
    const next = entries.filter((e) => e.agent_id !== agentId);
    if (next.length !== entries.length) writeEntries(file, p, next, cur.project_key, new Date().toISOString());
  });
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
    if (ev === 'PostToolUse') {
      L.stampAgentActivity(p);
      // TASKSTOP: a successful TaskStop of a background agent (task_id == agent_id) ends its stamp; SubagentStop never fires for it.
      if (p.tool_name === 'TaskStop' && p.tool_input && typeof p.tool_input === 'object' && typeof p.tool_input.task_id === 'string') {
        L.endAgentActivityIfPresent({ session_id: p.session_id, agent_id: p.tool_input.task_id });
      }
    }
    else if (ev === 'SubagentStart') L.startAgentActivity(p); // FOREMAN2: the agent exists (stamp, un-ended)
    else if (ev === 'SubagentStop') L.endAgentActivity(p); // FOREMAN: the agent is done (ended_at)
    else if (ev === 'SessionEnd') L.removeAgentActivity(p);
  } catch (e) { L.failOpen('awaiting-owner/agent-activity', e); }
  if (ev === 'SubagentStart') return; // a start concerns nothing but the stamp
  if (ev === 'SubagentStop') { // attention: end that agent's entries (own knob); turn and decisions are the main thread's
    if (L.knobOff('AUTOPILOT_AWAITING_OWNER')) return;
    if (typeof p.agent_id === 'string' && p.agent_id) endEntries(p, p.agent_id);
    return;
  }
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
  const agent = agentOf(p);

  if (ev === 'PostToolUse' || ev === 'UserPromptSubmit' || ev === 'Stop' || ev === 'SessionEnd') {
    // Hot path (every tool call / prompt): one stat, no lock when nothing is pending. Removing a
    // missing file is a no-op, so skipping the lock for the end events is behaviour-identical.
    if (!require('fs').existsSync(file)) return;
  }
  if (ev === 'SessionEnd') { L.removeFile(file); return; }

  L.withLock(file, () => {
    const cur = L.readJsonFile(file);
    const hasFile = cur && cur.schema === 'autopilot.attention/1';
    const entries = hasFile ? entriesOf(cur) : [];
    const projectKey = hasFile ? cur.project_key : undefined;
    const commit = (next) => writeEntries(file, p, next, projectKey, now);
    if (ev === 'UserPromptSubmit' || ev === 'Stop') {
      commit(entries.filter((e) => e.agent_id !== null));
    } else if (ev === 'PostToolUse') {
      const live = (e) => e.kind === 'permission' || e.kind === 'question';
      const digest = inputDigest(p.tool_input);
      let hit = entries.find((e) => live(e) && e.agent_id === agent && e.tool_name === p.tool_name && e.input_digest === digest);
      if (!hit) hit = entries.filter((e) => live(e) && e.agent_id === agent && e.tool_name === p.tool_name).sort(bySince)[0];
      if (hit) commit(entries.filter((e) => e !== hit));
    } else if (ev === 'PermissionRequest') {
      const tool = typeof p.tool_name === 'string' && p.tool_name ? p.tool_name : null;
      const digest = inputDigest(p.tool_input);
      const rest = entries.filter((e) => e.kind !== 'idle'); // a real prompt outranks (and replaces) idle
      const same = rest.find((e) => e.agent_id === agent && e.tool_name === tool && e.input_digest === digest);
      if (same) {
        commit(rest.map((e) => (e === same ? { ...e, updated_at: now } : e)));
      } else {
        commit([...rest, {
          agent_id: agent, tool_name: tool, input_digest: digest, kind: tool === 'AskUserQuestion' ? 'question' : 'permission',
          summary: summarize(p), since: now, updated_at: now,
        }]);
      }
    } else if (ev === 'Notification' && notifType === 'permission_prompt') {
      if (entries.some((e) => e.kind !== 'idle')) commit(entries.map((e) => ({ ...e })));
    } else if (ev === 'Notification' && notifType === 'idle_prompt') {
      if (entries.some((e) => e.kind !== 'idle')) return; // a real prompt outranks idle
      const idle = entries.find((e) => e.kind === 'idle');
      commit([idle ? { ...idle, updated_at: now } : {
        agent_id: null, tool_name: null, input_digest: null, kind: 'idle', summary: 'waiting for your input', since: now, updated_at: now,
      }]);
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
