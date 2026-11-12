#!/usr/bin/env node
// hooks/askpm-log.js — PM session only. UserPromptSubmit appends the operator's prompt;
// Stop appends the first two lines of that turn's reply (the payload's
// last_assistant_message when that string is non-blank, else transcript_path).
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
// Skips plugin-injected prompts: a first line starting with [待決回覆] (covers
// [待決回覆·更正]), harness prefixes, a fleet <channel source="fleet"> turn,
// advisory-relay's additionalContext JSON, and any payload that carries agent_id.
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

// True when the newest ask already has its reply. A second Stop in the same turn
// (the re-entry after another Stop hook blocked) must not append again.
function openAskAnswered(env) {
  let raw;
  try { raw = fs.readFileSync(logFile(env), 'utf8'); } catch { return false; }
  let kind = '';
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || row.schema !== SCHEMA || (row.kind !== 'ask' && row.kind !== 'reply')) continue;
    kind = row.kind;
  }
  return kind === 'reply';
}

function clip(text) {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

// Last assistant text after the last real user turn. A tool_result-only user turn is not that turn.
function lastAssistantText(transcript) {
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e && (e.type || (e.message && e.message.role));
    const content = e && e.message && e.message.content;
    if (role === 'user') {
      const onlyToolResult = Array.isArray(content) && content.length > 0 && content.every((b) => b && b.type === 'tool_result');
      if (!onlyToolResult) return null;
      continue;
    }
    if (role !== 'assistant') continue;
    const text = typeof content === 'string' ? content
      : Array.isArray(content) ? content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '';
    if (text.trim()) return text;
  }
  return null;
}

function onPrompt(input, env) {
  if (input.agent_id) return;
  if (isInjected(input.prompt)) return;
  append(env, { schema: SCHEMA, kind: 'ask', at: new Date().toISOString(), text: clip(input.prompt) });
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
  // wrote nothing. It does not record a second row for the same ask.
  if (openAskAnswered(env)) return;
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
