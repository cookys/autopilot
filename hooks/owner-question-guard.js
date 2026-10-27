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
const path = require('path');
const { configPath } = require('../scripts/lib/config-path.js');

const OPEN_DECISION_JS = path.join(__dirname, '..', 'scripts', 'open-decision.js');

// Safe path characters stay bare so today's copy-paste text does not change.
// Anything else is a single-quoted shell word, with ' written as '\'' .
function shellQuotePath(p) {
  if (/^[A-Za-z0-9_/.:@%+=,-]+$/.test(p)) return p;
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}
const OPEN_DECISION_CMD = shellQuotePath(OPEN_DECISION_JS);

const CARD_ID = /\bd-[0-9a-f]{8}\b/i;

// Phrases that mean "I am waiting for the owner to answer or decide". One list on purpose:
// add a pattern here, never a new if. Matched per sentence (see sentences()).
const OWNER_WAIT_PATTERNS = [
  // explicit waiting phrases (zh)
  /請(決定|確認|選|回覆)/, /你說可以我再/, /等你(回答|決定|回覆|確認|說)/, /請你(決定|確認|回答|選)/, /你選好我就/, /你(決定|確認)後我再/,
  // "needs / waits for your <approval verb>": 要你批准、會等你批准、需要您同意、待你授權、等你點頭
  /[要需會得待等請](?:要)?[你您](?:的)?(?:批准|核准|同意|授權|確認|決定|許可|首肯|點頭|拍板|放行|回覆|回答|指示|表態)/,
  /等(?:待|候)?\s*(?:owner|你|您)/i,
  /(?:須|必須|需)經(?:過)?\s*(?:owner|你|您)/i,
  // "after you approve I will ..."
  /[你您](?:批准|核准|同意|授權|確認|決定|點頭)(?:之後|後|才|再)/,
  // "should I / may I ...嗎": a yes-no question put to the reader, with or without the question mark
  /(?:要我|讓我|需要我|是否要我|我可以|我能|我要不要|我該不該|我應不應該)[^。？?！\n]{0,40}嗎/,
  /(?:可以|能不能|能否|行不行|好不好|對不對|同意|批准|核准|沒問題|ok)\s*嗎/i,
  // explicit waiting phrases (en)
  /\bshall I\b/i, /\bshould I\b/i, /\bdo you want\b/i, /\bwant me to\b/i, /\bwould you like\b/i,
  /\blet me know (if|whether|which)\b/i, /\bwaiting for (your|you)\b/i,
  /\b(?:awaiting|pending|need|needs|require|requires|waiting (?:on|for))\s+(?:your|the owner'?s?)\s+(?:approval|go-?ahead|decision|confirmation|sign-?off|ok|okay|permission)\b/i,
  /\b(?:waiting|waits) (?:on|for) (?:the )?owner\b/i,
  /\b(?:may I|can I (?:go ahead|proceed|push|merge)|ok(?:ay)? to (?:push|merge|proceed))\b/i,
];
// A question mark (full or half width) in a sentence that addresses the reader.
const QUESTION_MARK = /[?？]/;
const ADDRESSES_OWNER = [
  /你|您/, /要不要/, /可以嗎/, /好嗎/, /行嗎/, /還是/, /哪一個|哪個|選哪/, /是否/, /要我|讓我|我可以|我要/, /嗎/,
  /\byou\b/i, /\byour\b/i, /\bor\b/i, /\bwhich\b/i, /\bshall\b/i, /\bok(?:ay)?\b/i,
];

// A rhetorical question ("這不是很簡單嗎？", "難道...？") is not put to the owner: it only skips the question-mark rule, never an explicit wait phrase.
const RHETORICAL = [/不是[^。？?！]*嗎/, /難道/, /豈不是|何嘗不|誰不/, /\bisn'?t it\b|\bright\?$/i];

// "沒有要你決定的事", "不需要你批准": the phrase is negated, nothing is awaited.
const NEGATED = /(?:沒有|沒|無需|不需要|不用|不必|毋須|不會|不要|\bno\b|\bnot\b|\bnothing\b)[^，。,；;]{0,6}[你您]|\b(?:no|not|nothing)\b[^.,;]{0,20}\byour\b/i;

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
// Also drop quoted text (「」 『』 “” "") and Markdown quote lines (> ...): a relayed question is not ours to the owner.
const QUOTED = [/「[^」\n]*」/g, /『[^』\n]*』/g, /“[^”\n]*”/g, /"[^"\n]*"/g];
function stripCode(text) {
  let t = text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  t = t.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  for (const re of QUOTED) t = t.replace(re, ' ');
  return t;
}

function sentences(text) {
  return stripCode(text).split(/(?<=[。？?！!.])\s*|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Returns the first sentence that waits for the owner, or null.
function findOwnerQuestion(text) {
  for (const s of sentences(text)) {
    if (!NEGATED.test(s) && OWNER_WAIT_PATTERNS.some((re) => re.test(s))) return s;
    if (QUESTION_MARK.test(s) && !RHETORICAL.some((re) => re.test(s)) && ADDRESSES_OWNER.some((re) => re.test(s))) return s;
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

// Where this session's root is and whether a card it already opened landed outside it. Fail-open: any error => { root: null, unbound: [] }.
function rootState(input) {
  try {
    if (typeof input.session_id !== 'string' || !input.session_id) return { root: null, unbound: [] };
    const sm = require('../scripts/session-mode.js');
    const { root, session } = sm.readSessionRoot(input.session_id, { liveBase: require('./live-session-lib.js').liveBase() });
    if (!root) return { root: null, unbound: [] };
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    return { root, unbound: require('../scripts/open-decision.js').unboundCardsOf(cwd, session) };
  } catch { return { root: null, unbound: [] }; }
}

function decide(input) {
  if (input.stop_hook_active === true) return null;
  const tp = input.transcript_path;
  if (typeof tp !== 'string' || !tp) return null;
  const text = lastAssistantText(fs.readFileSync(tp, 'utf8'));
  if (!text) return null;
  const rs = rootState(input);
  if (CARD_ID.test(text)) {
    // The reply names a card. If this session has a root and the named card sits in the UNBOUND scope, a root-scoped panel
    // will not list it: block once and say how to re-open it under the root.
    const named = rs.unbound.filter((c) => text.includes(c.id));
    if (!rs.root || named.length === 0) return null;
    return {
      decision: 'block',
      reason: `回覆裡的待決卡片 ${named.map((c) => c.id).join('、')} 落在未綁定範圍（${named[0].file}），這個 session 的 root 是 ${rs.root}，以 root 為範圍的面板看不到它。`
        + `請 node ${OPEN_DECISION_CMD} close --id ${named[0].id} 關掉，再用 node ${OPEN_DECISION_CMD} open --root-run-id ${rs.root} ... 重開同一題，並在回覆寫出新卡片編號。`,
    };
  }
  const hit = findOwnerQuestion(text);
  if (!hit) return null;
  const shown = hit.length > 120 ? `${hit.slice(0, 120)}…` : hit;
  const rootFlag = rs.root ? ` --root-run-id ${rs.root}` : '';
  return {
    decision: 'block',
    reason: `偵測到這則回覆在等 owner 回答，但沒有待決卡片編號。偵測到的句子：「${shown}」。`
      + `請用 node ${OPEN_DECISION_CMD} open${rootFlag} --question <問題> [--background <背景>] [--option <標籤>::<說明>]... [--recommendation <標籤>] [--why <理由>] [--blocks <卡住什麼>] [--not-authorized <為何必須由 owner 決定>] [--source <誰/哪裡>] 把這件事寫進面板「待決」。`
      + (rs.root
        ? `本 session 的 root 是 ${rs.root}，務必照上面帶 --root-run-id，否則卡片會落在未綁定範圍、面板看不到。`
          + (rs.unbound.length ? `注意：本 session 先前開的卡片 ${rs.unbound.map((c) => c.id).join('、')} 已落在未綁定範圍（${rs.unbound[0].file}），請一併用 close --id 關掉並以 --root-run-id 重開。` : '')
        : '本 session 沒有可用的 root（open 會在 stderr 警告卡片落在未綁定範圍）。')
      + 'open 必填非空的 --question；--option 可重複（零個，或至少兩個，只有一個是用法錯誤）；其餘旗標可省略。'
      + '回覆必須寫出卡片編號（d- 加 8 個 hex）。'
      + `owner 從即時面板回答後，會送來第一行是 [待決回覆] 的訊息，卡片會自動關閉；手動關閉用 node ${OPEN_DECISION_CMD} close --id <id>。`
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
