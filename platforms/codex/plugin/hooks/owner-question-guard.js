#!/usr/bin/env node
/**
 * owner-question-guard — Stop. Default-on.
 * Shared rules: hooks/lib/owner-question-rules.js.
 *
 * Owner rule: anything that needs the owner's decision or answer is opened as a card
 * (`node scripts/open-decision.js open ...`) and the reply names the card id (`d-` + 8 hex);
 * a question that lives only in the chat gets scrolled away. hooks/ask-decision.js covers the
 * AskUserQuestion tool; this hook covers the plain-text question that nobody else watches.
 *
 * Behaviour: read the LAST assistant text of the turn. The shared rule module detects questions,
 * operator steps and reminder promises. Each hit needs a same-sentence live local card
 * (open / awaiting_operator_action) or a fleet task with an explicit due date.
 * A short correction (<= 400 chars) after a blocked assistant message in the same turn is judged
 * as a pair: each prior ask is resolved only by a sentence that restates that ask and carries a live card or a due task.
 * Repeated Stops are checked again. False positives may be named individually using
 * OWNER-GUARD-FALSE-POSITIVE [class,...] exact sentence :: reason (at most 8 per reply).
 * Full syntax: references/owner-question-guard.md.
 *
 * Opt-out: AUTOPILOT_OWNER_QUESTION_GUARD=off (false/0/no) or `owner_question_guard: false`
 * in ~/.autopilot/config.json. Bare-id check only: AUTOPILOT_BARE_CARD_ID_LINT=off.
 * Reply language: AUTOPILOT_REPLY_LANGUAGE=zh-Hant or config `reply_language`.
 * Fail-open: any error -> one stderr line, exit 0.
 */
'use strict';

const fs = require('fs');
const rules = require('./lib/owner-question-rules.js');

// Claude Code can run Stop hooks before the turn's final reply line reaches the transcript. When the newest
// entry is not assistant text, re-read for up to READ_SETTLE_MS before deciding (a real session missed every reply).
const READ_SETTLE_MS = 2000;
const READ_STEP_MS = 100;
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function lastEntryIsAssistantText(raw) {
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e && (e.type || (e.message && e.message.role));
    if (role !== 'user' && role !== 'assistant') continue;
    if (role === 'user') return false;
    const c = e.message && e.message.content;
    return typeof c === 'string' ? Boolean(c.trim()) : Array.isArray(c) && c.some((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim());
  }
  return false;
}
function readSettledTranscript(tp, settleMs = READ_SETTLE_MS) {
  let raw = fs.readFileSync(tp, 'utf8');
  const until = Date.now() + settleMs;
  while (!lastEntryIsAssistantText(raw) && Date.now() < until) {
    sleepMs(READ_STEP_MS);
    raw = fs.readFileSync(tp, 'utf8');
  }
  return { raw, waitedMs: settleMs - Math.max(0, until - Date.now()) };
}

function logLanguage(rec) {
  try {
    const dir = require('./live-session-lib.js').liveBase();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(require('path').join(dir, 'reply-language.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), ...rec })}\n`);
  } catch { /* diagnostics never block a Stop */ }
}

function decide(input, opts = {}) {
  const tp = input.transcript_path;
  const langOn = rules.replyLanguageActive();
  const guardOn = opts.guardOn !== false;
  if (typeof tp !== 'string' || !tp) {
    if (langOn) logLanguage({ session: input.session_id || null, active: true, outcome: 'no_transcript_path' });
    return null;
  }
  const { raw, waitedMs } = langOn ? readSettledTranscript(tp, opts.settleMs) : { raw: fs.readFileSync(tp, 'utf8'), waitedMs: 0 };
  const texts = rules.assistantTextsThisTurn(raw);
  const text = texts.length ? texts[texts.length - 1] : null;
  const prev = texts.length >= 2 ? texts[texts.length - 2] : null;
  const lang = langOn && text ? rules.languageCheck(text) : null;
  if (langOn) {
    const st = text ? rules.stripForLanguage(text) : '';
    const cjk = (st.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
    const letters = (st.match(/[A-Za-z]/g) || []).length;
    logLanguage({ session: input.session_id || null, active: true, guard_on: guardOn, waited_ms: waitedMs, outcome: !text ? 'no_text' : lang ? 'block' : 'pass', cjk, letters });
  }
  if (!text) return null;
  if (!guardOn) return lang ? { decision: 'block', reason: lang.reason } : null;
  const reason = rules.reasonForTurn(input, text, prev);
  if (!reason) return null;
  return { decision: 'block', reason };
}

function main() {
  try {
    const guardOn = !rules.optedOut(rules.envBag(), rules.loadCfg());
    if (!guardOn && !rules.replyLanguageActive()) return;
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const out = decide(input && typeof input === 'object' ? input : {}, { guardOn });
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`owner-question-guard: fail-open: ${err && err.message}\n`);
  }
}

function replayLanguage(tp, n = 2) {
  const out = [];
  const lines = fs.readFileSync(tp, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < n; i -= 1) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (!e || e.type !== 'assistant') continue;
    const c = e.message && e.message.content;
    const text = Array.isArray(c) ? c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : typeof c === 'string' ? c : '';
    if (!text.trim()) continue;
    out.push({ line: i + 1, chars: text.length, cjk: (rules.stripForLanguage(text).match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length, letters: (rules.stripForLanguage(text).match(/[A-Za-z]/g) || []).length, verdict: rules.languageCheck(text) ? 'block' : 'pass' });
  }
  return out;
}

if (require.main === module) {
  if (process.argv[2] === '--replay-language') {
    process.stdout.write(`${JSON.stringify(replayLanguage(process.argv[3], Number(process.argv[4]) || 2))}\n`);
  } else main();
}

module.exports = {
  ...rules,
  decide,
  replayLanguage,
  lastEntryIsAssistantText,
};
