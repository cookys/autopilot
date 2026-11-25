#!/usr/bin/env node
// hooks/askpm-remind.js — PM session Stop hook (direct hooks.json entry, opt-in `askpm-remind`).
// With PM gate (hooks/_shared/pm-console.js) and opt-in `askpm-remind` on:
// - Stop 1 on an undisposed open ask: appends {kind:'reminded', ask_id, pending_reply}
//   and emits {"decision":"block","reason":"ask_id a-xxxxxxxx 尚未處置：pm-ask close/progress/supersede"}.
// - Stop 2 (reminded row exists for that ask_id): never blocks; writes the reply row from pending_reply.
// - Already disposed at Stop 1: writes the reply row as askpm-log does.
// - No open ask / fleet turn / agent_id / askpm-log off: never blocks.
'use strict';

const fs = require('fs');
const { isEnabled } = require('./_shared/opt-in');
const { gateHint } = require('./lib/gate-hint.js');
const { isPmConsole } = require('./_shared/pm-console');
const {
  SCHEMA,
  append,
  readRows,
  replyGate,
  replyBody,
  transcriptMatchesAsk,
  writeReply,
  normClip,
  cwdOf,
} = require('./askpm-log');

function findOpenAskState(rows, askId) {
  if (!Array.isArray(rows)) return { hasDisposition: false, remindedRow: null };
  let askIdx = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].kind === 'ask' && rows[i].ask_id === askId) {
      askIdx = i;
      break;
    }
  }
  let hasDisposition = false;
  let remindedRow = null;
  const start = askIdx >= 0 ? askIdx + 1 : 0;
  for (let i = start; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.ask_id !== askId) continue;
    if (r.kind === 'disposition') hasDisposition = true;
    else if (r.kind === 'reminded') remindedRow = r;
  }
  return { hasDisposition, remindedRow };
}

function handle(input, env) {
  if (!isEnabled('askpm-remind')) return null;
  if (!input || typeof input !== 'object') return null;
  if (input.agent_id) return null;
  if (!isPmConsole(cwdOf(input))) return null;
  if (!isEnabled('askpm-log')) {
    process.stderr.write('askpm-remind: askpm-log is off (no rows to read)\n');
    return null;
  }

  const gate = replyGate(env);
  if (gate.closed || !gate.ask || typeof gate.ask.ask_id !== 'string' || gate.ask.ask_id === '') {
    return null;
  }

  const askId = gate.ask.ask_id;
  const rows = readRows(env);
  const { hasDisposition, remindedRow } = findOpenAskState(rows, askId);

  if (remindedRow) {
    // Stop 2: never blocks; write the reply row from Stop 1's pending_reply without transcript match
    // because the block reason is now the last user entry in the transcript.
    const pending = typeof remindedRow.pending_reply === 'string' ? remindedRow.pending_reply : null;
    if (pending && pending.trim()) {
      writeReply(env, pending, { ask_id: askId, session_id: gate.ask.session_id });
    }
    return null;
  }

  // Stop 1: skip turns whose transcript's last real user entry is not the open ask (e.g. fleet channel turn).
  if (!transcriptMatchesAsk(input, gate.askText)) return null;

  if (hasDisposition) {
    const text = replyBody(input);
    if (text) writeReply(env, text, { ask_id: askId, session_id: gate.ask.session_id });
    return null;
  }

  const rawReply = replyBody(input);
  const pendingReply = typeof rawReply === 'string' && rawReply.trim() ? normClip(rawReply) : null;
  append(env, {
    schema: SCHEMA,
    kind: 'reminded',
    at: new Date().toISOString(),
    ask_id: askId,
    pending_reply: pendingReply,
  });

  return {
    decision: 'block',
    reason: `ask_id ${askId} 尚未處置：pm-ask close/progress/supersede`
      + gateHint('用 node scripts/pm-ask.js close|progress|supersede <ask_id> 處置後再結束', 'hooks/README.md'),
  };
}

function main() {
  try {
    if (!isEnabled('askpm-remind')) return;
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const out = handle(input, {
      AUTOPILOT_STATE_DIR: process.env.AUTOPILOT_STATE_DIR,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      HOME: process.env.HOME,
    });
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  } catch (err) {
    process.stderr.write(`askpm-remind: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();
module.exports = { handle, findOpenAskState };
