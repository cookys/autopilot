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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isEnabled } = require('./_shared/opt-in');

const SCHEMA = 'autopilot.askpm/1';
// mods/live/console.ts inlines this schema inside consoleModeOf and does not export it.
// That reader also requires mode "program" and stops at the first .git; this gate does neither.
const CONSOLE_SCHEMA = 'autopilot.console/1';
const MAX_TEXT = 4000;
const INJECTED_PREFIXES = ['<system-reminder>', '<task-notification>', '<local-command-', '<command-name>', '<command-message>', '<command-args>'];
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

function isPmSession(input) {
  const given = input && typeof input.cwd === 'string' ? input.cwd : '';
  return hasPmConsole(given !== '' ? given : process.cwd());
}

function stateDir(env) {
  const abs = (v) => (typeof v === 'string' && path.isAbsolute(v) ? v : '');
  const over = abs(env.AUTOPILOT_STATE_DIR);
  if (over) return over;
  const xdg = abs(env.XDG_STATE_HOME);
  if (xdg) return path.join(xdg, 'autopilot');
  const home = abs(env.HOME) || os.homedir();
  return path.join(home, '.local', 'state', 'autopilot');
}

function isInjected(prompt) {
  if (typeof prompt !== 'string') return true;
  const trimmed = prompt.trim();
  if (trimmed === '') return true;
  const first = trimmed.split(/\r?\n/, 1)[0].trim();
  // [待決回覆·更正] does not start with [待決回覆]: the bracket closes before the dot.
  if (first.startsWith('[待決回覆]') || first.startsWith('[待決回覆·更正]')) return true;
  if (INJECTED_PREFIXES.some((p) => trimmed.startsWith(p))) return true;
  if (FLEET_CHANNEL.test(prompt)) return true;
  if (trimmed.startsWith('{') && (trimmed.includes('"additionalContext"') || trimmed.includes('"hookSpecificOutput"'))) return true;
  return false;
}

function logFile(env) {
  return path.join(stateDir(env), 'askpm.jsonl');
}

function append(env, row) {
  const dir = stateDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(logFile(env), 'a', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(row) + '\n');
  } finally {
    fs.closeSync(fd);
  }
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

// Rows this hook wrote. null when the log cannot be read (nothing recorded yet).
function relevantRows(env) {
  let raw;
  try { raw = fs.readFileSync(logFile(env), 'utf8'); } catch { return null; }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || row.schema !== SCHEMA) continue;
    if (row.kind !== 'ask' && row.kind !== 'reply' && row.kind !== 'turn') continue;
    rows.push(row);
  }
  return rows;
}

// The open ask is the newest ask that no later reply or turn row has closed.
// A turn row is an injected UserPromptSubmit: that Stop is not the operator's turn.
// null askText with closed false: no log yet, so a Stop still records (no ask to guard).
// closed true: a reply is already stored, or a turn row closed the ask.
function replyGate(env) {
  const rows = relevantRows(env);
  if (rows === null || rows.length === 0) return { closed: false, askText: null };
  let ask = null;
  for (const row of rows) {
    if (row.kind === 'ask') ask = row;
    else ask = null;
  }
  if (!ask) return { closed: true, askText: null };
  return { closed: false, askText: typeof ask.text === 'string' ? ask.text : '' };
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

function onPrompt(input, env) {
  if (input.agent_id) return;
  if (isInjected(input.prompt)) {
    append(env, { schema: SCHEMA, kind: 'turn', at: new Date().toISOString(), injected: true });
    return;
  }
  append(env, { schema: SCHEMA, kind: 'ask', at: new Date().toISOString(), text: normClip(input.prompt) });
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

function onStop(input, env) {
  if (input.agent_id) return;
  // stop_hook_active true is the re-entry after another Stop hook blocked. That
  // call is the one that ends the turn, so it still records when the first Stop
  // wrote nothing. It does not record a second row for the same ask. A turn row
  // after the ask means this Stop ends a turn the operator did not start.
  const gate = replyGate(env);
  if (gate.closed) return;
  if (gate.askText !== null && !transcriptMatchesAsk(input, gate.askText)) return;
  const text = replyBody(input);
  if (!text) return;
  const norm = text.replace(/\r\n/g, '\n');
  append(env, { schema: SCHEMA, kind: 'reply', at: new Date().toISOString(), lines: norm.split('\n').slice(0, 2), text: clip(norm) });
}

function handle(input, env) {
  if (!isEnabled('askpm-log')) return;
  if (!input || typeof input !== 'object') return;
  if (!isPmSession(input)) return;
  if (input.hook_event_name === 'UserPromptSubmit') onPrompt(input, env);
  else if (input.hook_event_name === 'Stop') onStop(input, env);
}

function main() {
  try {
    if (!isEnabled('askpm-log')) return;
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    handle(input, { AUTOPILOT_STATE_DIR: process.env.AUTOPILOT_STATE_DIR, XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME });
  } catch (err) {
    process.stderr.write(`askpm-log: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();
module.exports = { isPmSession, isInjected, handle, lastAssistantText, SCHEMA };
