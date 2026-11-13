#!/usr/bin/env node
/**
 * owner-question-guard — Stop. Default-on.
 *
 * Owner rule: anything that needs the owner's decision or answer is opened as a card
 * (`node scripts/open-decision.js open ...`) and the reply names the card id (`d-` + 8 hex);
 * a question that lives only in the chat gets scrolled away. hooks/ask-decision.js covers the
 * AskUserQuestion tool; this hook covers the plain-text question that nobody else watches.
 *
 * Behaviour: read the LAST assistant text of the turn. HIT_PATTERNS detects questions,
 * operator steps and reminder promises. Each hit needs a same-sentence live local card
 * (open / awaiting_operator_action) or a fleet task with an explicit due date.
 * Repeated Stops are checked again. False positives may be named individually using
 * OWNER-GUARD-FALSE-POSITIVE [class,...] exact sentence :: reason (at most 8 per reply).
 * Full syntax, quote exclusions and replay contract: references/owner-question-guard.md.
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

const REQUEST_ID = /\br-[0-9a-f]{8}\b/i;

function teamRole() {
  try { return require('../scripts/lib/team.js').resolve().role; } catch { return 'lane'; }
}
const CARD_ID = /\bd-[0-9a-f]{8}\b/gi;
// A textual scheduling reference, not a claim that this hook queried the fleet.
// ISO calendar day, optionally a UTC/offset timestamp; invalid calendar days do not qualify.
const FLEET_DUE = /\b(?:fleet\s+task\s+[^\n]*?\s--due(?:=|\s+)|task_id=[A-Za-z0-9][A-Za-z0-9_-]{2,63}\s+due=)["']?(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?)(?=["'\s)\],.;:?!，。；：、）？！】]|$)/g;
const ESCAPE_PREFIX = 'OWNER-GUARD-FALSE-POSITIVE';
const MAX_ESCAPES = 8;

// All positive phrase patterns live in this table, matched per clause.
const HIT_PATTERNS = {
  question: [
  // explicit waiting phrases (zh)
  /請(?:你|您)?(?:決定|確認|選|回覆|核准|批准|同意|授權|回答|指示)/, /你說可以我再/, /等你(回答|決定|回覆|確認|說)/, /請你(決定|確認|回答|選)/, /你選好我就/, /你(決定|確認)後我再/,
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
  /\bplease (?:confirm|approve|decide|advise|reply|respond|choose|sign off|let me know)\b/i, /\bshall I\b/i, /\bshould I\b/i, /\bdo you want\b/i, /\bwant me to\b/i, /\bwould you like\b/i,
  /\blet me know (if|whether|which)\b/i, /\bwaiting for (your|you)\b/i,
  /\b(?:awaiting|pending|need|needs|require|requires|waiting (?:on|for))\s+(?:your|the owner'?s?)\s+(?:approval|go-?ahead|decision|confirmation|sign-?off|ok|okay|permission)\b/i,
  /\b(?:waiting|waits) (?:on|for) (?:the )?owner\b/i,
  /\b(?:may I|can I (?:go ahead|proceed|push|merge)|ok(?:ay)? to (?:push|merge|proceed))\b/i,
  // Additional asks from the retired PM Stop hook (bare 要不要 is only a question with ?).
  /你覺得(?:可以|如何|呢|怎樣)|請你(?:看|回)|你(?:同意|決定|選)(?:嗎|哪)/,
  /跟我說一聲|告訴我你|你看(?:要|是)|等你(?:回|選)|你希望.{0,20}(?:就|再)|你點頭|你拍板|由你決定/,
  ],
  'operator-step': [
    /要[你您]本人|[你您]自己(?:執行|做|登入|操作)|有空時照做|[你您]要做的事|[你您]只要(?:貼|輸入|執行)/,
    /(?:輸入|打)\s*\/login\b|下次(?:到場|到公司)|登入[^。？！\n]{0,30}一次/,
    /(?:需要|要|等)[你您](?:重新)?登入|[你您](?:親手|親自)(?:執行|登入|操作)/,
    /\b(?:you|please)\s+(?:run|execute|log\s*in|sign\s*in|enter|type|click|install)\b/i,
  ],
  promise: [
    /(?:我會|會提前|到時|再|我)(?:先|再|提前)?開(?:一張)?卡|會提醒[你您]/,
    /(?:併進|加進|列入)[^。？！\n]{0,40}清單|明(?:天|早)[^。？！\n]{0,40}[你您]/,
    /我會(?:集中|收成)[^。？！\n]{0,20}(?:卡|清單)|我收成一張卡給[你您]/,
    /\bI(?:['’]ll| will)\s+(?:open\s+(?:a\s+)?(?:decision\s+)?card|remind\s+you)\b/i,
  ],
};
// Preserve the existing exported question-pattern API; there is only one source table.
const OWNER_WAIT_PATTERNS = HIT_PATTERNS.question;
// Decision order (recall-biased: a missed owner question costs far more than one extra card prompt):
//   1. strip quotes, code, quote lines, source-comment lines and markdown headings (stripCode); `* ` / `- ` list markers are body text and stay;
//   2. split into sentences, then each sentence into clauses;
//   3. MAIN RULE: a sentence that ENDS with ？ or ? is a question to the owner, unless it is rhetorical (RHETORICAL, a small explicit list)
//      or a title-style sentence ("章節標題：如何…？", TITLE_STYLE);
//   4. WAIT RULE (statements): per clause, CONDITION_ON_OWNER ("沒有你的批准就不能…") is a wait; a NEGATED clause ("沒有要你決定的事") awaits
//      nothing and ONLY that clause is skipped; any other clause that matches OWNER_WAIT_PATTERNS is a wait.
const RHETORICAL = [/不是[^。？?！]*嗎/, /難道/, /豈不是|何嘗不|誰不/, /還有什麼[^。？?！]*嗎|有什麼好[^。？?！]*嗎|怎麼可能/, /\bisn'?t it\b|\bright\?$/i];
const TITLE_STYLE = /^[^：:，,。]{0,16}(?:標題|章節|題目|主題|title|heading|section)\s*[：:]/i;
const ENDS_WITH_QUESTION = /[？?][\s)）"'*_~]*$/;
const CONDITION_ON_OWNER = /(?:沒有|沒|未經|未獲|未得到|缺少)[你您]的?(?:批准|核准|同意|授權|許可|確認)/;
// Explicit negators only. A bare 不 is NOT one: "能不能請你確認", "是不是要你批准" are A-not-A questions, not denials.
const NEGATED = /(?:沒有|沒|無需|不需要|不用|不必|毋須|不會|不要)[^，。,；;、]{0,6}[你您]|\b(?:no|not|nothing|don'?t|doesn'?t|isn'?t)\b[^.,;]{0,24}\b(?:you|your)\b|\bno (?:approval|decision|confirmation)\b/i;
const CLAUSE_SPLIT = /[，,；;：:、]|但是|但|不過|而是|\bbut\b|\bhowever\b/i;

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
const QUOTED = [/「[^」]*」/g, /『[^』]*』/g, /“[^”]*”/g, /"[^"]*"/g];
const HEADING_MARK = '\u0001';
function stripCode(text) {
  let t = text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`([^`\n]*)`/g,
    (_, code) => /^(?:\/login\b|d-[0-9a-f]{8}$|fleet\s+task\s|task_id=)/i.test(code) ? code : ' ');
  // Quoting a due value is shell syntax, not a relayed lane quote.
  t = t.replace(/((?:--due(?:=|\s+)|due=))["'](\d{4}-\d{2}-\d{2}(?:T[\d:+Z-]+)?)["']/g, '$1$2');
  // quote lines, `//` comment lines, markdown headings, and the lines of a real (unclosed-until-`*/`) block comment; list bullets `* ` / `- ` stay
  let inBlock = false;
  t = t.split('\n').filter((l) => {
    if (inBlock) { if (l.includes('*/')) inBlock = false; return false; }
    if (/^\s*\/\*/.test(l)) { if (!l.includes('*/')) inBlock = true; return false; }
    return !/^\s*(>|\/\/)/.test(l);
  }).map((l) => l.replace(/^\s*#{1,6}\s+/, HEADING_MARK)).join('\n'); // a heading keeps its text; HEADING_MARK only switches off the question-mark rule for it
  for (const re of QUOTED) t = t.replace(re, ' ');
  return t;
}

// ASCII ? ! . end a sentence before whitespace, the end of text, or a CJK / full-width character ("嗎?如果"); a URL query "a?b=1" and "v1.2" are not sentence ends.
function sentences(text) {
  const body = stripCode(text).split('\n').filter((line) => !parseEscape(line.trim())).join('\n');
  return body.split(/(?<=[。？！])\s*|(?<=[?!.])(?=\s|$|[\u3000-\u9fff\uff00-\uffef])\s*|\n+/).map((s) => s.trim()).filter(Boolean);
}

// One hit per sentence, with every matching class. Exemptions are evaluated separately.
function findHits(text) {
  const hits = [];
  for (const raw of sentences(text)) {
    const heading = raw.startsWith(HEADING_MARK);
    const s = heading ? raw.slice(1).trim() : raw;
    // exclusions are scoped to the question-mark rule only; the wait rule below always runs
    const classes = new Set();
    if (!heading && !TITLE_STYLE.test(s) && ENDS_WITH_QUESTION.test(s) && !RHETORICAL.some((re) => re.test(s))) classes.add('question');
    for (const clause of s.split(CLAUSE_SPLIT)) {
      if (CONDITION_ON_OWNER.test(clause)) classes.add('question');
      if (NEGATED.test(clause)) continue;
      for (const [kind, patterns] of Object.entries(HIT_PATTERNS)) {
        if (patterns.some((re) => re.test(clause))) classes.add(kind);
      }
    }
    if (classes.size) hits.push({ sentence: s, classes: [...classes] });
  }
  return hits;
}

function findOwnerQuestion(text) { return findHits(text)[0]?.sentence || null; }

function hasDueTask(sentence) {
  return [...sentence.matchAll(FLEET_DUE)].some(([, due]) => {
    const day = due.slice(0, 10);
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
      && Number.isFinite(Date.parse(due));
  });
}

function hasLiveCard(sentence, cwd, excludedIds = null) {
  const ids = [...sentence.matchAll(CARD_ID)];
  if (!ids.length) return false;
  try {
    const { findCard } = require('../scripts/open-decision.js');
    const { cardState } = require('../src/status/scope-key.js');
    return ids.some(([id]) => {
      const norm = id.toLowerCase();
      if (excludedIds && excludedIds.has(norm)) return false;
      const card = findCard(cwd, norm, { all: true });
      return card && ['open', 'awaiting_operator_action'].includes(cardState(card.entry));
    });
  } catch {
    return false;
  }
}

function parseEscape(line) {
  const m = line.match(/^OWNER-GUARD-FALSE-POSITIVE \[([a-z,-]+)\] (.+) :: (\S.{0,239})$/);
  if (!m) return null;
  const classes = m[1].split(',');
  if (classes.some((c) => !Object.hasOwn(HIT_PATTERNS, c))) return null;
  return { sentence: m[2], classes: [...new Set(classes)].sort().join(',') };
}

function unresolvedHits(text, cwd = process.cwd(), excludedIds = null) {
  const lines = stripCode(text).split('\n').map((l) => l.trim()).filter((l) => l.startsWith(ESCAPE_PREFIX));
  const escapes = lines.length > MAX_ESCAPES ? [] : lines.map(parseEscape).filter(Boolean);
  return findHits(text).filter(({ sentence, classes }) => !hasLiveCard(sentence, cwd, excludedIds) && !hasDueTask(sentence)
    && !escapes.some((e) => e.sentence === sentence && e.classes === [...classes].sort().join(',')));
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

// Autonomous = an unexpired orchestrator marker (level l3-l6) for this session. Fail-open: any error => false.
function isAutonomous(sessionId) {
  try {
    if (typeof sessionId !== 'string' || !sessionId) return false;
    return require('../scripts/session-mode.js').isAutonomousSession(sessionId);
  } catch { return false; }
}

function decide(input) {
  const tp = input.transcript_path;
  if (typeof tp !== 'string' || !tp) return null;
  const text = lastAssistantText(fs.readFileSync(tp, 'utf8'));
  if (!text) return null;
  const rs = rootState(input);
  const unboundIds = rs.root && rs.unbound.length ? new Set(rs.unbound.map((u) => u.id.toLowerCase())) : null;
  const hits = unresolvedHits(text, input.cwd || process.cwd(), unboundIds);
  const mentioned = unboundIds ? new Set([...stripCode(text).matchAll(CARD_ID)].map(([id]) => id.toLowerCase())) : null;
  const namedUnbound = mentioned ? rs.unbound.filter((u) => mentioned.has(u.id.toLowerCase())) : [];
  if (!hits.length && !namedUnbound.length) return null;
  const role = teamRole();
  if (!namedUnbound.length && role !== 'solo' && role !== 'pm') {
    // Non-PM lane sessions keep the pre-v2 rule: a request id or any d- card id in the reply silences the guard.
    if (REQUEST_ID.test(text) || /\bd-[0-9a-f]{8}\b/i.test(text)) return null;
    const first = hits[0].sentence;
    const quoted = first.length > 120 ? `${first.slice(0, 120)}…` : first;
    const req = shellQuotePath(path.join(__dirname, '..', 'scripts', 'request-decision.js'));
    return {
      decision: 'block',
      reason: `偵測到這則回覆在等 owner 回答，但沒有請求編號。偵測到的句子：「${quoted}」。`
        + `請用 node ${req} send --question <問題> --option <標籤>::<說明> --option <標籤>::<說明> --recommendation <建議> --boundary <邊界> 把問題、選項與建議送給 PM。`
        + '不可逆還要帶 --snapshot 與 --blast-radius。回覆必須寫出請求編號（r- 加 8 個 hex）。'
        + '若這句不是要 owner 回答（修辭、轉述別人的問題、列舉選項），請改寫句子避免誤判。',
    };
  }
  const shown = hits.map((h) => `[${h.classes.join(',')}] ${h.sentence}`).join('\n');
  const autonomous = isAutonomous(input.session_id);
  const rootFlag = rs.root ? ` --root-run-id ${rs.root}` : '';
  const unboundNote = namedUnbound.map((u) =>
    `回覆提到的卡片 ${u.id} 落在未綁定範圍（本 session 的 root 是 ${rs.root}，root 面板看不到未綁定卡片）：請先執行 node ${OPEN_DECISION_CMD} close --id ${u.id}，再用 node ${OPEN_DECISION_CMD} open --root-run-id ${rs.root} 重新開卡並更新回覆中的卡號。`
  ).join('\n');
  const lead = [
    ...(unboundNote ? [unboundNote] : []),
    ...(hits.length ? [`以下句子需要 owner 回答、操作或後續提醒，但同句沒有本地 live 卡片或有 due 的 fleet task：\n${shown}`] : []),
  ].join('\n');
  return {
    decision: 'block',
    reason: `${lead}\n`
      + `請用 node ${OPEN_DECISION_CMD} open${rootFlag} --executor <執行者位址> --question <問題> [--background <背景>] --option <標籤>::<說明> --option <標籤>::<說明> [--recommendation <標籤>] [--why <理由>] [--blocks <卡住什麼>] --not-authorized <邊界>[:<為何必須由 owner 決定>] [--source <誰/哪裡>] 把這件事寫進面板「待決」。`
      + '--not-authorized 必填，邊界只能是 read_only、reversible、external、irreversible（resolve-doa 的行動類別）或 goal-change、scope-expansion、resources-2x、red-line（董事會批准項）；'
      + '本 session 的 DOA 內會自動放行的類別，open 會拒絕（exit 3）。'
      + (autonomous ? '本 session 是自主模式（l3–l6）：若這件事在 DOA 內請自行決定，不要開卡，直接改寫回覆、不要再問 owner。' : '')
      + (rs.root
        ? `本 session 的 root 是 ${rs.root}，帶 --root-run-id 可將卡片綁定此 root。`
        : '本 session 沒有可用的 root，卡片會放在本專案的未綁定範圍。')
      + 'open 必填 --executor（執行答覆的位址，沒帶 exit 2）、非空的 --question 與至少兩個 --option（沒有或只有一個會被擋，exit 2；純打字回答的問題改帶 --free-text 且不能同時帶 --option）；其餘旗標可省略。'
      + '每個命中句必須寫出自己的 live 卡片編號（d- 加 8 個 hex，狀態 open 或 awaiting_operator_action）；closed、pending_dispatch、未知卡號及其他句的卡號都不算。'
      + '或在同句寫 fleet task <args> --due YYYY-MM-DD（可帶 ISO 時間），或 task_id=<id> due=YYYY-MM-DD。'
      + `owner 從即時面板回答後，會送來第一行是 [待決回覆] 的訊息，卡片會自動關閉；手動關閉用 node ${OPEN_DECISION_CMD} close --id <id>。`
      + '再次 Stop 仍會檢查。若為誤判，可改寫、引用，或每個命中各加一行 OWNER-GUARD-FALSE-POSITIVE [class,...] 完整命中句 :: 理由（照上面句子與所有 class；理由 1–240 字元，每則回覆最多 8 行，不接受萬用字元）。',
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
module.exports = { findOwnerQuestion, findHits, unresolvedHits, lastAssistantText, decide, OWNER_WAIT_PATTERNS, HIT_PATTERNS };
