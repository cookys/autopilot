#!/usr/bin/env node
/**
 * owner-question-guard — Stop. Default-on.
 *
 * Owner rule: anything that needs the owner's decision or answer is opened as a card
 * (`node scripts/open-decision.js open ...`) and the reply names the card id (`d-` + 8 hex);
 * a question that lives only in the chat gets scrolled away. hooks/ask-decision.js covers the
 * AskUserQuestion tool; this hook covers the plain-text question that nobody else watches.
 *
 * Behaviour: read the LAST assistant text of the turn from the transcript (text blocks only;
 * fenced and inline code removed). If it waits for the owner (OWNER_WAIT_PATTERNS) and carries
 * no card id, emit a Stop `{"decision":"block","reason":...}` so the model must open a card
 * (or reword a sentence that was not addressed to the owner). `stop_hook_active` true => allow,
 * so it blocks at most once per stop: a strong reminder, never a deadlock.
 *
 * Opt-out: AUTOPILOT_OWNER_QUESTION_GUARD=off (false/0/no) or `owner_question_guard: false`
 * in ~/.autopilot/config.json. Fail-open: any error -> one stderr line, exit 0.
 */
'use strict';

const fs = require('fs');
const { configPath } = require('../scripts/lib/config-path.js');

const CARD_ID = /\bd-[0-9a-f]{8}\b/;

// Phrases that mean "I am waiting for the owner to answer or decide". One list on purpose:
// add a pattern here, never a new if. Matched per sentence (see sentences()).
const OWNER_WAIT_PATTERNS = [
  // explicit waiting phrases (zh)
  /你說可以我再/, /等你(回答|決定|回覆|確認|說)/, /請你(決定|確認|回答|選)/, /你選好我就/, /你(決定|確認)後我再/,
  // explicit waiting phrases (en)
  /\bshall I\b/i, /\bshould I\b/i, /\bdo you want\b/i, /\bwant me to\b/i, /\bwould you like\b/i,
  /\blet me know (if|whether|which)\b/i, /\bwaiting for (your|you)\b/i,
];
// A question mark (full or half width) in a sentence that addresses the reader.
const QUESTION_MARK = /[?？]/;
const ADDRESSES_OWNER = [
  /你|您/, /要不要/, /可以嗎/, /好嗎/, /行嗎/, /還是/, /哪一個|哪個|選哪/, /是否要/,
  /\byou\b/i, /\byour\b/i, /\bor\b/i, /\bwhich\b/i,
];

function optedOut(env, cfg) {
  const v = env.AUTOPILOT_OWNER_QUESTION_GUARD;
  if (typeof v === 'string' && ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase())) return true;
  return cfg.owner_question_guard === false;
}

function loadCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return c && typeof c === 'object' ? c : {};
  } catch { return {}; }
}

// Drop fenced blocks and inline code: a question mark inside code is not a question to the owner.
function stripCode(text) {
  return text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

function sentences(text) {
  return stripCode(text).split(/(?<=[。？?！!.])\s*|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Returns the first sentence that waits for the owner, or null.
function findOwnerQuestion(text) {
  for (const s of sentences(text)) {
    if (OWNER_WAIT_PATTERNS.some((re) => re.test(s))) return s;
    if (QUESTION_MARK.test(s) && ADDRESSES_OWNER.some((re) => re.test(s))) return s;
  }
  return null;
}

// Text of the last assistant entry that has text, after the last real user turn.
function lastAssistantText(transcript) {
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e && (e.type || (e.message && e.message.role));
    const content = e && e.message && e.message.content;
    if (role === 'user') {
      const onlyToolResult = Array.isArray(content) && content.length && content.every((b) => b && b.type === 'tool_result');
      if (!onlyToolResult) return null; // reached the owner's own message: no assistant text this turn
      continue;
    }
    if (role !== 'assistant') continue;
    const text = typeof content === 'string' ? content
      : Array.isArray(content) ? content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '';
    if (text.trim()) return text;
  }
  return null;
}

function decide(input) {
  if (input.stop_hook_active === true) return null;
  const tp = input.transcript_path;
  if (typeof tp !== 'string' || !tp) return null;
  const text = lastAssistantText(fs.readFileSync(tp, 'utf8'));
  if (!text || CARD_ID.test(text)) return null;
  const hit = findOwnerQuestion(text);
  if (!hit) return null;
  const shown = hit.length > 120 ? `${hit.slice(0, 120)}…` : hit;
  return {
    decision: 'block',
    reason: `偵測到這則回覆在等 owner 回答，但沒有待決卡片編號。偵測到的句子：「${shown}」。`
      + '請用 node scripts/open-decision.js open ... 把這件事寫進面板「待決」，並在回覆裡寫出卡片編號（d- 加 8 個 hex）。'
      + '若這句不是要 owner 回答（修辭、轉述別人的問題、列舉選項），請改寫句子避免誤判。',
  };
}

function main() {
  try {
    if (optedOut(process.env, loadCfg())) return;
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const out = decide(input && typeof input === 'object' ? input : {});
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`owner-question-guard: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();
module.exports = { findOwnerQuestion, lastAssistantText, decide, OWNER_WAIT_PATTERNS };
