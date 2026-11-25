#!/usr/bin/env node
// hooks/askpm-log.js — PM session only. UserPromptSubmit appends the operator's prompt.
// An injected prompt appends a turn marker instead of an ask. Stop appends the first
// two lines of the reply of the turn that ask started (the payload's
// last_assistant_message when that string is non-blank, else the last assistant
// text of that turn in transcript_path). A Stop for any other turn appends nothing.
// One reply per ask: the re-entry after another
// Stop hook blocked (stop_hook_active) still writes when the first Stop wrote nothing,
// and a second Stop in the same turn does not append again. One jsonl under the account
// state dir (absolute AUTOPILOT_STATE_DIR, else $XDG_STATE_HOME/autopilot, else
// ~/.local/state/autopilot). Silent: never writes stdout. Fail-open: one stderr line, exit 0.
//
// Tier B opt-in (default-off), same gate as the other opt-in hooks
// (hooks/_shared/opt-in.js): ~/.autopilot/config.json {"hooks":{"askpm-log":true}}
// or AUTOPILOT_HOOK_ASKPM_LOG=1. Without that, this process exits before any read.
// UserPromptSubmit does not spawn this file: advisory-relay.js hosts handle() in
// its own process, and only when the opt-in is on. Stop is spawned by
// opt-in-multiplexer.js only when the opt-in is on.
//
// PM gate (only after the opt-in gate): the hook input cwd (when that string is
// empty, process.cwd()) has .claude/console.json in that directory or an ancestor
// up to the filesystem root, and the file parses as JSON with schema
// autopilot.console/1. FLEET_ADDRESS and FLEET_MEMBER are not read. No fleet
// whoami on this path.
//
// An injected prompt is not an ask. UserPromptSubmit appends {schema, kind:'turn',
// at, injected:true} for a first line starting with [待決回覆] or [待決回覆·更正],
// a harness prefix, a fleet <channel source="fleet"> turn, or advisory-relay's
// additionalContext JSON. That turn marker closes the open ask, so the following
// Stop records no reply. A fleet channel notification has no UserPromptSubmit;
// Stop then skips the reply when the transcript's last real user text is not the
// open ask. A payload that carries agent_id appends nothing.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isEnabled } = require('./_shared/opt-in');
const { isPmConsole } = require('./_shared/pm-console');
const { maskSecrets } = require('../scripts/lib/mask-secrets');
const { withWriteLock, appendRow } = require('../scripts/lib/jsonl-store');
const { groupKey } = require('../scripts/lib/ask-group-key');
const { stateDir } = require('../scripts/lib/state-dir');

const SCHEMA = 'autopilot.askpm/1';
// mods/live/console.ts inlines this schema inside consoleModeOf and does not export it.
// That reader also requires mode "program" and stops at the first .git; this gate does neither.
const CONSOLE_SCHEMA = 'autopilot.console/1';
const MAX_TEXT = 4000;
const INJECTED_PREFIXES = ['<system-reminder>', '<task-notification>', '<local-command-', '<command-name>', '<command-message>', '<command-args>'];
// "read <path>/handoff/<id>.md 接續" is a restart instruction, not a question for the PM.
const HANDOFF_RESUME = /^read\s+\S*handoff\S*\.md\s+接續\s*$/i;
function isHandoffResume(text) { return typeof text === 'string' && HANDOFF_RESUME.test(text.trim()); }
const FLEET_CHANNEL = /<channel\b[^>]*\bsource\s*=\s*["']fleet["']/;

function consoleSchemaMatches(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, '.claude', 'console.json'), 'utf8');
  } catch {
    return false;
  }
  let raw;
  try { raw = JSON.parse(text); } catch { return false; }
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && raw.schema === CONSOLE_SCHEMA;
}

// True when dir, or an ancestor up to the filesystem root, holds a matching console.json.
function hasPmConsole(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (consoleSchemaMatches(dir)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function cwdOf(input) {
  const given = input && typeof input.cwd === 'string' ? input.cwd : '';
  return given !== '' ? given : process.cwd();
}

function isPmSession(input) {
  return hasPmConsole(cwdOf(input));
}

function isInjected(prompt) {
  if (typeof prompt !== 'string') return true;
  const trimmed = prompt.trim();
  if (trimmed === '') return true;
  const first = trimmed.split(/\r?\n/, 1)[0].trim();
  // [待決回覆·更正] does not start with [待決回覆]: the bracket closes before the dot.
  if (first.startsWith('[待決回覆]') || first.startsWith('[待決回覆·更正]') || first.startsWith('[voice call · unverified]')) return true;
  if (INJECTED_PREFIXES.some((p) => trimmed.startsWith(p))) return true;
  if (FLEET_CHANNEL.test(prompt)) return true;
  if (isHandoffResume(trimmed)) return true;
  if (trimmed.startsWith('{') && (trimmed.includes('"additionalContext"') || trimmed.includes('"hookSpecificOutput"'))) return true;
  return false;
}

function logFile(env) {
  return path.join(stateDir(env), 'askpm.jsonl');
}

function append(env, row) {
  const dir = stateDir(env);
  const file = logFile(env);
  withWriteLock(
    { storeDir: dir, lockFile: path.join(dir, 'askpm.jsonl.lock'), name: 'askpm' },
    () => appendRow(file, row),
  );
}

function clip(text) {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

// Ask-row text, and the comparison against a transcript user entry: CRLF to LF, then clip.
function normClip(text) {
  const s = typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
  return clip(s);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

function onlyToolResult(content) {
  return Array.isArray(content) && content.length > 0 && content.every((b) => b && b.type === 'tool_result');
}

// All schema-matching rows. null when the log cannot be read (nothing recorded yet).
function readRows(env) {
  let raw;
  try { raw = fs.readFileSync(logFile(env), 'utf8'); } catch { return null; }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch (err) {
      process.stderr.write(`askpm-log: skipping malformed jsonl line: ${err && err.message}\n`);
      continue;
    }
    if (!row || row.schema !== SCHEMA) continue;
    rows.push(row);
  }
  return rows;
}

// Turn-boundary rows (ask/reply/turn). null when the log cannot be read.
function relevantRows(env) {
  const all = readRows(env);
  if (all === null) return null;
  return all.filter((row) => row.kind === 'ask' || row.kind === 'reply' || row.kind === 'turn');
}

// The open ask is the newest ask that no later reply or turn row has closed.
// A turn row is an injected UserPromptSubmit: that Stop is not the operator's turn.
// null askText with closed false: no log yet, so a Stop still records (no ask to guard).
// closed true: a reply is already stored, or a turn row closed the ask.
function replyGate(env) {
  const rows = relevantRows(env);
  if (rows === null || rows.length === 0) return { closed: false, askText: null, ask: null };
  let ask = null;
  for (const row of rows) {
    if (row.kind === 'ask') ask = row;
    else ask = null;
  }
  if (!ask) return { closed: true, askText: null, ask: null };
  return { closed: false, askText: typeof ask.text === 'string' ? ask.text : '', ask };
}

// Last assistant text in the current turn, after the last real user entry.
// A tool_result-only user entry stays inside the turn. Walk from the end so the
// reply is the last assistant entry that has text, not an earlier one spoken
// before a tool call.
function lastAssistantText(transcript) {
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e && (e.type || (e.message && e.message.role));
    const content = e && e.message && e.message.content;
    if (role === 'user') {
      if (!onlyToolResult(content)) return null;
      continue;
    }
    if (role !== 'assistant') continue;
    const text = textOf(content);
    if (text.trim()) return text;
  }
  return null;
}

// Last real user text in the transcript, or null when every user entry is a tool result.
function lastRealUserText(transcript) {
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e && (e.type || (e.message && e.message.role));
    if (role !== 'user') continue;
    const content = e && e.message && e.message.content;
    if (onlyToolResult(content)) continue;
    return textOf(content);
  }
  return null;
}

// Unreadable transcript: keep recording. Readable: record only when the last real
// user text is the open ask after the same clip + CRLF normalisation as the ask row.
function transcriptMatchesAsk(input, askText) {
  const tp = input.transcript_path;
  if (typeof tp !== 'string' || tp === '') return true;
  let raw;
  try { raw = fs.readFileSync(tp, 'utf8'); } catch { return true; }
  const user = lastRealUserText(raw);
  if (user === null) return false;
  return normClip(user) === normClip(askText);
}

function computeAskId(sessionId, at, text) {
  const sid = typeof sessionId === 'string' ? sessionId : '';
  const hash = crypto.createHash('sha256').update(`${sid}\n${at}\n${text}`).digest('hex');
  return `a-${hash.slice(0, 8)}`;
}

const REEHO_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function formatTaipeiTime(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function firstReplyLine(reply) {
  const candidates = Array.isArray(reply.lines) && reply.lines.length > 0
    ? reply.lines
    : (typeof reply.text === 'string' ? reply.text.split('\n') : []);
  for (const line of candidates) {
    if (typeof line !== 'string') continue;
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 120);
  }
  return null;
}

function findReecho(env, text, currentAskId, nowIso) {
  const key = groupKey(text);
  if (!key) return undefined;
  const rows = readRows(env);
  if (!rows || rows.length === 0) return undefined;
  const nowMs = Date.parse(nowIso);
  const replyByAskId = new Map();
  for (const r of rows) {
    if (r.kind === 'reply' && typeof r.ask_id === 'string' && r.ask_id !== '' && !replyByAskId.has(r.ask_id)) {
      replyByAskId.set(r.ask_id, r);
    }
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    if (r.kind !== 'ask') continue;
    if (r.ask_id === currentAskId) continue;
    if (typeof r.ask_id !== 'string' || r.ask_id === '') continue;
    if (typeof r.text !== 'string' || groupKey(r.text) !== key) continue;
    const askMs = Date.parse(r.at || r.ts);
    if (!Number.isFinite(askMs) || nowMs - askMs > REEHO_WINDOW_MS) continue;
    const reply = replyByAskId.get(r.ask_id);
    if (!reply) continue;
    const line = firstReplyLine(reply);
    if (!line) continue;
    const taipei = formatTaipeiTime(r.at || r.ts);
    if (!taipei) continue;
    return `你問過同一件事（台北時間 ${taipei}），上次的答案：${line}`;
  }
  return undefined;
}

function onPrompt(input, env) {
  if (input.agent_id) return null;
  const at = new Date().toISOString();
  if (isInjected(input.prompt)) {
    append(env, { schema: SCHEMA, kind: 'turn', at, injected: true });
    return { kind: 'turn' };
  }
  const text = normClip(input.prompt);
  if (!isPmConsole(input.cwd)) {
    append(env, { schema: SCHEMA, kind: 'ask', at, text: maskSecrets(text) });
    return { kind: 'ask' };
  }
  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  const askId = computeAskId(sessionId, at, text);
  append(env, { schema: SCHEMA, kind: 'ask', at, ask_id: askId, session_id: sessionId, text: maskSecrets(text) });
  const reecho = findReecho(env, text, askId, at);
  return { kind: 'ask', ask_id: askId, reecho };
}

// The Stop payload's last_assistant_message is the reply of the turn that is
// stopping. The transcript can lag: its newest assistant entry may still be a
// previous turn, with no newer user line. Use the payload whenever it is a
// non-blank string, and read the transcript only when that field is missing
// or blank. A missing or unreadable transcript is not fatal.
function replyBody(input) {
  const direct = input.last_assistant_message;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const tp = input.transcript_path;
  if (typeof tp === 'string' && tp !== '') {
    try {
      const text = lastAssistantText(fs.readFileSync(tp, 'utf8'));
      if (text) return text;
    } catch { /* fall through */ }
  }
  return null;
}

function writeReply(env, text, meta = {}) {
  const norm = text.replace(/\r\n/g, '\n');
  const now = new Date().toISOString();
  const askId = meta && typeof meta.ask_id === 'string' && meta.ask_id !== '' ? meta.ask_id : null;
  const sessionId = meta && typeof meta.session_id === 'string' && meta.session_id !== '' ? meta.session_id : null;
  const turn = meta && meta.turn !== undefined ? meta.turn : null;
  const row = {
    schema: SCHEMA,
    kind: 'reply',
    at: now,
    ts: now,
    ask_id: askId,
    session_id: sessionId,
    turn,
    lines: maskSecrets(norm).split('\n').slice(0, 2),
    text: maskSecrets(clip(norm)),
  };
  const dir = stateDir(env);
  const file = logFile(env);
  withWriteLock(
    { storeDir: dir, lockFile: path.join(dir, 'askpm.jsonl.lock'), name: 'askpm' },
    () => {
      if (askId) {
        const existing = readRows(env) || [];
        const dup = existing.some((r) => r.kind === 'reply' && r.ask_id === askId && r.turn === turn);
        if (dup) return;
      }
      appendRow(file, row);
    },
  );
}

const CLOSE_PHRASE = /(?:收到|好了|可以了|ok\s*結案|結案|關掉)/i;

function classifyDisposition(askText) {
  if (typeof askText !== 'string' || !askText.trim()) return 'progress';
  if (/[?？]/.test(askText)) return 'progress';
  return CLOSE_PHRASE.test(askText) ? 'close' : 'progress';
}

function writeDisposition(env, action, meta = {}) {
  const askId = meta && typeof meta.ask_id === 'string' && meta.ask_id !== '' ? meta.ask_id : null;
  if (!askId) return;
  const sessionId = meta && typeof meta.session_id === 'string' && meta.session_id !== '' ? meta.session_id : null;
  const turn = meta && meta.turn !== undefined ? meta.turn : null;
  const now = new Date().toISOString();
  const row = {
    schema: SCHEMA,
    kind: 'disposition',
    action: action === 'close' ? 'close' : 'progress',
    ask_id: askId,
    session_id: sessionId,
    turn,
    ts: now,
  };
  const dir = stateDir(env);
  const file = logFile(env);
  withWriteLock(
    { storeDir: dir, lockFile: path.join(dir, 'askpm.jsonl.lock'), name: 'askpm' },
    () => {
      const existing = readRows(env) || [];
      const dup = existing.some((r) => r.kind === 'disposition' && r.ask_id === askId && r.turn === turn);
      if (dup) return;
      appendRow(file, row);
    },
  );
}

function onStop(input, env) {
  if (input.agent_id) return;
  // With askpm-remind on (and PM console gate passing), askpm-remind owns the reply row.
  if (isEnabled('askpm-remind') && isPmConsole(cwdOf(input))) return;
  // stop_hook_active true is the re-entry after another Stop hook blocked. That
  // call is the one that ends the turn, so it still records when the first Stop
  // wrote nothing. It does not record a second row for the same ask. A turn row
  // after the ask means this Stop ends a turn the operator did not start.
  const gate = replyGate(env);
  if (gate.closed) return;
  if (gate.askText !== null && !transcriptMatchesAsk(input, gate.askText)) return;
  const text = replyBody(input);
  if (!text) return;
  const askId = gate.ask && typeof gate.ask.ask_id === 'string' && gate.ask.ask_id !== '' ? gate.ask.ask_id : null;
  const sessionId = typeof input.session_id === 'string' && input.session_id !== ''
    ? input.session_id
    : (gate.ask && typeof gate.ask.session_id === 'string' && gate.ask.session_id !== '' ? gate.ask.session_id : null);
  const turn = input.turn !== undefined && input.turn !== null ? input.turn
    : (gate.ask && gate.ask.turn !== undefined && gate.ask.turn !== null ? gate.ask.turn : null);
  writeReply(env, text, { ask_id: askId, session_id: sessionId, turn });
  if (askId) {
    const action = classifyDisposition(gate.askText);
    writeDisposition(env, action, { ask_id: askId, session_id: sessionId, turn });
  }
}

function handle(input, env) {
  if (!isEnabled('askpm-log')) return null;
  if (!input || typeof input !== 'object') return null;
  if (!isPmSession(input)) return null;
  if (input.hook_event_name === 'UserPromptSubmit') return onPrompt(input, env);
  if (input.hook_event_name === 'Stop') onStop(input, env);
  return null;
}

function main() {
  try {
    if (!isEnabled('askpm-log')) return;
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const res = handle(input, { AUTOPILOT_STATE_DIR: process.env.AUTOPILOT_STATE_DIR, XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME });
    if (res && typeof res.reecho === 'string') {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: res.reecho } })}\n`);
    }
  } catch (err) {
    process.stderr.write(`askpm-log: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();
module.exports = {
  isHandoffResume,
  isPmSession,
  isInjected,
  handle,
  lastAssistantText,
  stateDir,
  logFile,
  append,
  readRows,
  replyGate,
  replyBody,
  transcriptMatchesAsk,
  writeReply,
  writeDisposition,
  classifyDisposition,
  normClip,
  clip,
  cwdOf,
  computeAskId,
  SCHEMA,
};
