/**
 * Shared rule module for the owner-question Stop hook and scripts/reply-precheck.js.
 * Shared rules: hooks/lib/owner-question-rules.js.
 * Pure checks live here only. The hook adds transcript settling; precheck adds the CLI.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { configPath } = require('../../scripts/lib/config-path.js');

// The whole-process.env scanner does not understand regex literals, and the
// backtick in shellQuotePath below opens a template it never closes. A
// process.env after that line is invisible, so this helper stays above it.
function envBag() {
  return process.env;
}

// Safe path characters stay bare so today's copy-paste text does not change.
// Anything else is a single-quoted shell word, with ' written as '\'' .
function shellQuotePath(p) {
  if (/^[A-Za-z0-9_/.:@%+=,-]+$/.test(p)) return p;
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}
const OPEN_DECISION_JS = path.join(__dirname, '..', '..', 'scripts', 'open-decision.js');
const OPEN_DECISION_CMD = shellQuotePath(OPEN_DECISION_JS);

const REQUEST_ID = /\br-[0-9a-f]{8}\b/i;

// The PM question-gate seat decision (hooks/lib/ask-guard.js): the seat is the session's fleet
// address, never team.json (the c4140 incident). 'allow' seats keep today's solo/pm treatment;
// every other seat is gated — blocked after the ask_guard.enforce_from + 1 h warn window.
const askGuard = require('./ask-guard.js');
// Problems that are NOT the owner-question gate itself (they keep applying to a gated seat
// inside the warn window): reply-language, root-scope and card-format lints.
const NON_GATE_RULES = new Set(['reply_language', 'unbound_card', 'bare_card_id']);
const CARD_ID = /\bd-[0-9a-f]{8}\b/gi;
// A textual scheduling reference, not a claim that this hook queried the fleet.
// ISO calendar day, optionally a UTC/offset timestamp; invalid calendar days do not qualify.
// Group 1 is the task id (only the task_id= form; the fleet task line has none), group 2 the due.
const FLEET_DUE = /\b(?:fleet\s+task\s+[^\n]*?\s--due(?:=|\s+)|task_id=([A-Za-z0-9][A-Za-z0-9_-]{2,63})\s+due=)["']?(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?)(?=["'\s)\],.;:?!，。；：、）？！】]|$)/g;
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
  /[你您](?:批准|核准|同意|授權|確認|決定|點頭|拍板)(?:之後|後|才|再)/,
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
  /跟我說一聲|告訴我你|你看(?:要|是)|等你(?:回|選)|你希望.{0,20}(?:就|再)|你點頭|由你決定/,
  ],
  'operator-step': [
    /要[你您]本人|[你您]自己(?:執行|做|登入|操作)|有空時照做|[你您]要做的事|[你您]只要(?:貼|輸入|執行)/,
    /(?:輸入|打)\s*\/login\b|下次(?:到場|到公司)|登入[^。？！\n]{0,30}一次/,
    /(?:需要|要|等|請)[你您](?:重新)?登入|[你您](?:親手|親自)(?:執行|登入|操作)/,
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
// Bare 你拍板 is an ask. The same words inside a habitual or past role split
// (一直是 / 大多是 … 我起草，你拍板，之後由我維護) describe how the roles worked, not a forward promise.
const BARE_PAIBAN = /(?<![等請要待需會得])你拍板(?!後|再|才)/;
const HABITUAL_ROLE_FRAME = /一直是|一向是|向來是|大多是/;
const ROLE_SPLIT_WORK = /我起草|提方案|由我維護|是我在維護|我在維護|討論出來/;
// A statement that says who set a rule and that changing it changes their standard, closing with the bare
// tail 要你決定, explains the rule; it does not ask for a decision now. Both markers are required and only that
// final clause is exempt, so "換掉評審的事，要你決定。" (no ownership statement) still blocks.
const RULE_OWNERSHIP = /[是由][你您](?:指定|制定|訂|定)的/;
const RULE_CONSEQUENCE = /等於(?:改|換|動)[你您]的/;
const BARE_DECIDE_TAIL = /^要[你您]決定[。.！]?$/;
function explainsOwnerRule(sentence, clause) {
  return RULE_OWNERSHIP.test(sentence) && RULE_CONSEQUENCE.test(sentence) && BARE_DECIDE_TAIL.test(clause.trim());
}
function habitualPastRole(sentence) {
  return HABITUAL_ROLE_FRAME.test(sentence) && ROLE_SPLIT_WORK.test(sentence);
}

function offValue(v) {
  return typeof v === 'string' && ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase());
}

function optedOut(env, cfg) {
  if (offValue(env.AUTOPILOT_OWNER_QUESTION_GUARD)) return true;
  return cfg.owner_question_guard === false;
}

function bareCardLintOff() {
  return offValue(envBag().AUTOPILOT_BARE_CARD_ID_LINT);
}

function loadCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return c && typeof c === 'object' ? c : {};
  } catch { return {}; }
}

function replyLanguageActive(env = envBag(), cfg = null) {
  if (env && env.AUTOPILOT_REPLY_LANGUAGE !== undefined) {
    return typeof env.AUTOPILOT_REPLY_LANGUAGE === 'string' && env.AUTOPILOT_REPLY_LANGUAGE.trim() === 'zh-Hant';
  }
  const c = cfg || loadCfg();
  return Boolean(c && typeof c.reply_language === 'string' && c.reply_language.trim() === 'zh-Hant');
}

const LANGUAGE_MIN_CHARS = 20;
const LANGUAGE_MIN_CJK_RATIO = 0.60;
const LANGUAGE_BLOCK_LEAD = '回覆要用正體中文（技術名詞和 id 可保留原文）；請改寫。';
const CJK_IDEOGRAPH_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const ASCII_LETTER_RE = /[A-Za-z]/g;
const FILE_EXT_RE = /(?<![A-Za-z0-9_])[A-Za-z0-9._~@-]+\.(?:js|cjs|mjs|jsx|ts|cts|mts|tsx|sh|bash|zsh|ps1|py|rb|go|rs|c|cc|cpp|h|hpp|java|kt|swift|php|cs|lua|pl|sql|md|mdx|txt|rst|json|jsonl|jsonc|yaml|yml|toml|ini|cfg|conf|env|xml|html|htm|css|scss|less|svg|png|jpg|jpeg|gif|webp|ico|pdf|csv|tsv|log|lock|bak|tmp|tar|gz|tgz|zip|xz|zst|patch|diff|service|timer|socket|wasm|proto|graphql|vue|svelte)(?::\d+(?::\d+)?)?(?![A-Za-z0-9_-])/gi;

const SIMPLIFIED_TO_TRADITIONAL = Object.freeze({
  这: '這', 应: '應', 该: '該', 档: '檔', 讯: '訊', 说: '說', 对: '對', 时: '時', 问: '問', 题: '題',
  们: '們', 个: '個', 会: '會', 来: '來', 过: '過', 还: '還', 没: '沒', 么: '麼', 进: '進', 发: '發',
  现: '現', 经: '經', 让: '讓', 实: '實', 码: '碼', 处: '處', 务: '務', 认: '認', 设: '設', 计: '計',
  运: '運', 关: '關', 门: '門', 间: '間', 东: '東', 写: '寫', 选: '選', 项: '項', 测: '測', 试: '試',
  错: '錯', 误: '誤', 输: '輸', 状: '狀', 态: '態', 报: '報', 达: '達', 变: '變', 将: '將', 与: '與',
  动: '動', 质: '質', 级: '級', 无: '無', 为: '為', 数: '數', 据: '據', 库: '庫', 节: '節', 点: '點',
});

// Strip code, URLs, paths and machine ids before measuring reply language; quoted 「」 Chinese stays.
function stripForLanguage(text) {
  if (typeof text !== 'string' || !text) return '';
  let t = text.replace(/```[\s\S]*?(?:```|$)/g, ' ');
  t = t.replace(/(?:^|\n)[ \t]*~~~[\s\S]*?(?:\n[ \t]*~~~|$)/g, '\n');
  t = t.replace(/(`+)((?:(?!\1)[^\n])*)\1/g, ' ');
  t = t.replace(/\bhttps?:\/\/[A-Za-z0-9._~:/?#@!$&*+=%-]+/gi, ' ');
  t = t.replace(/\b(?:localhost|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?::\d+)?\/[A-Za-z0-9._~:/?#@!$&*+=%-]*/gi, ' ');
  t = t.replace(/(?:~|\.{1,2})?\/[A-Za-z0-9._~+:@#/-]+|[A-Za-z0-9._~+@:-]+\/[A-Za-z0-9._~+:@#/-]*/g, ' ');
  t = t.replace(FILE_EXT_RE, ' ');
  t = t.replace(/\bd-[0-9a-f]{8}\b/gi, ' ');
  t = t.replace(/\br-[0-9a-f]{8}\b/gi, ' ');
  t = t.replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/gi, ' ');
  t = t.replace(/\b[0-9a-f]{7,64}\b/gi, ' ');
  return t;
}

function languageCheck(text) {
  const stripped = stripForLanguage(text);
  const cjk = (stripped.match(CJK_IDEOGRAPH_RE) || []).length;
  const letters = (stripped.match(ASCII_LETTER_RE) || []).length;
  const total = letters + cjk;
  const ratio = total > 0 ? cjk / total : null;
  const lowRatio = total >= LANGUAGE_MIN_CHARS && ratio < LANGUAGE_MIN_CJK_RATIO;
  const simplified = [];
  const seen = new Set();
  for (const ch of stripped) {
    const trad = SIMPLIFIED_TO_TRADITIONAL[ch];
    if (trad && !seen.has(ch)) {
      seen.add(ch);
      simplified.push(`${ch}→${trad}`);
      if (simplified.length >= 5) break;
    }
  }
  if (!lowRatio && !simplified.length) return null;
  const parts = [LANGUAGE_BLOCK_LEAD];
  if (lowRatio) {
    const pct = Number((ratio * 100).toFixed(1));
    parts.push(`中文字比例 ${pct}%（需至少 60%）。`);
  }
  if (simplified.length) {
    parts.push(`偵測到簡體字：${simplified.join('、')}。`);
  }
  return {
    decision: 'block',
    reason: parts.join(''),
    cjk,
    letters,
    ratio,
    simplified,
  };
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
  const parts = body.split(/(?<=[。？！])\s*|(?<=[?!.])(?=\s|$|[\u3000-\u9fff\uff00-\uffef])\s*|\n+/).map((s) => s.trim()).filter(Boolean);
  // A line ending in a colon (bold allowed) and the bullet lines right under it are one sentence.
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    let cur = parts[i];
    if (COLON_HEADER.test(cur)) {
      while (i + 1 < parts.length && BULLET_START.test(parts[i + 1])) { cur += ' ' + parts[i + 1]; i += 1; }
    }
    out.push(cur);
  }
  return out;
}
const COLON_HEADER = /[：:][\s*_~]*$/;
const BULLET_START = /^[-*]\s/;

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
      if (explainsOwnerRule(s, clause)) continue;
      for (const [kind, patterns] of Object.entries(HIT_PATTERNS)) {
        if (patterns.some((re) => re.test(clause))) classes.add(kind);
      }
      if (BARE_PAIBAN.test(clause) && !habitualPastRole(s)) classes.add('question');
    }
    if (classes.size) hits.push({ sentence: s, classes: [...classes] });
  }
  return hits;
}

function findOwnerQuestion(text) { return findHits(text)[0]?.sentence || null; }

// A task's fleet record as JSON (fields top level: next_evidence_due, hard_deadline, state).
// The default shells out to `fleet task show <id> --json`; tests inject a fake so a test
// never runs a real fleet. Returns the parsed object, or null when the exit status is not 0,
// the output is not a JSON object, or the fleet binary is missing.
function defaultFleetTaskLookup(id) {
  const r = spawnSync('fleet', ['task', 'show', id, '--json'], {
    encoding: 'utf8',
    timeout: 2000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (r.error || r.status !== 0) return null;
  try {
    const parsed = JSON.parse(r.stdout);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

let fleetTaskLookup = defaultFleetTaskLookup;
// One lookup per task id per run; swapping the lookup (tests) starts a fresh cache.
let taskCache = new Map();

function setFleetTaskLookup(fn) {
  fleetTaskLookup = typeof fn === 'function' ? fn : defaultFleetTaskLookup;
  taskCache = new Map();
}

function lookupTask(id) {
  if (!taskCache.has(id)) taskCache.set(id, fleetTaskLookup(id));
  return taskCache.get(id);
}

// A due field counts only when it is a non-empty value other than the fleet placeholder "-".
function realDues(task) {
  return [task.next_evidence_due, task.hard_deadline].filter((v) => typeof v === 'string' && v !== '' && v !== '-');
}

// An id written as task_id=<id> is judged with its quoted due (quotedDueIsReal), not here.
const TASK_ID = /(?<!task_id=)\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
// A 26-char fleet task id written in the sentence counts when that task really has a due.
function namesTaskWithDue(sentence) {
  return [...sentence.matchAll(TASK_ID)].some(([id]) => {
    const task = lookupTask(id);
    return Boolean(task) && typeof task === 'object' && realDues(task).length > 0;
  });
}

// A quoted `task_id=<ID> due=<T>` is real only when the task exists, <T> is not later than the
// task's earliest fleet due, and that due is not already past at `now` (opts.now, ms; Date.now()).
function quotedDueIsReal(taskId, due, now) {
  const task = lookupTask(taskId);
  if (!task || typeof task !== 'object') return false; // unknown task
  const fleet = realDues(task);
  if (!fleet.length) return false; // the task has no due
  let earliest = null;
  for (const v of fleet) {
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && (earliest === null || ms < earliest)) earliest = ms;
  }
  if (earliest === null) return false;
  if (earliest < now) return false; // the real due is already past
  return Date.parse(due) <= earliest; // the quoted time must not beat the real due
}

function hasDueTask(sentence, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  if (namesTaskWithDue(sentence)) return true;
  return [...sentence.matchAll(FLEET_DUE)].some(([, taskId, due]) => {
    const day = due.slice(0, 10);
    const date = new Date(`${day}T00:00:00Z`);
    if (!(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day)) return false;
    if (!Number.isFinite(Date.parse(due))) return false;
    if (taskId === undefined) return true; // a fleet task line has no id to check: today's behaviour
    return quotedDueIsReal(taskId, due, now);
  });
}

function hasLiveCard(sentence, cwd, excludedIds = null) {
  const ids = [...sentence.matchAll(CARD_ID)];
  if (!ids.length) return false;
  try {
    const { findCard } = require('../../scripts/open-decision.js');
    const { cardState } = require('../../src/status/scope-key.js');
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

const BARE_CARD_CLASS = 'bare_card_id';
const ESCAPE_CLASSES = new Set([...Object.keys(HIT_PATTERNS), BARE_CARD_CLASS]);
const TITLE_LABEL = /(?:標題|章節|題目|主題|title|heading|section)\s*[：:][ \t]*$/i;

function parseEscape(line) {
  const m = line.match(/^OWNER-GUARD-FALSE-POSITIVE \[([a-z_,-]+)\] (.+) :: (\S.{0,239})$/);
  if (!m) return null;
  const classes = m[1].split(',');
  if (classes.some((c) => !ESCAPE_CLASSES.has(c))) return null;
  return { sentence: m[2], classes: [...new Set(classes)].sort().join(',') };
}

function escapeRecords(text) {
  const lines = stripCode(text).split('\n').map((l) => l.trim()).filter((l) => l.startsWith(ESCAPE_PREFIX));
  if (lines.length > MAX_ESCAPES) return [];
  return lines.map(parseEscape).filter(Boolean);
}

function unresolvedHits(text, cwd = process.cwd(), excludedIds = null) {
  const escapes = escapeRecords(text);
  return findHits(text).filter(({ sentence, classes }) => !hasLiveCard(sentence, cwd, excludedIds) && !hasDueTask(sentence)
    && !escapes.some((e) => e.sentence === sentence && e.classes === [...classes].sort().join(',')));
}

function blankSpan(chars, start, end) {
  for (let i = start; i < end; i += 1) {
    if (chars[i] !== '\n') chars[i] = ' ';
  }
}

// Length-preserving copy of stripCode's exclusions, plus every inline span (a span
// whose whole content is a card id still counts for the question rule, not for this one).
// Escape lines are blanked so the id on the marker is not itself a hit. Subjects are
// judged on the original text, so a preceding 「主題」 stays visible to the check.
function maskBareExclusions(text) {
  const chars = text.split('');
  for (const m of text.matchAll(/```[\s\S]*?(```|$)/g)) blankSpan(chars, m.index, m.index + m[0].length);
  let working = chars.join('');
  for (const m of working.matchAll(/`([^`\n]*)`/g)) blankSpan(chars, m.index, m.index + m[0].length);
  working = chars.join('');
  const lines = working.split('\n');
  let offset = 0;
  let inBlock = false;
  for (const line of lines) {
    let drop = false;
    if (inBlock) {
      drop = true;
      if (line.includes('*/')) inBlock = false;
    } else if (/^\s*\/\*/.test(line)) {
      drop = true;
      if (!line.includes('*/')) inBlock = true;
    } else if (/^\s*(>|\/\/)/.test(line) || parseEscape(line.trim())) {
      drop = true;
    }
    if (drop) blankSpan(chars, offset, offset + line.length);
    offset += line.length + 1;
  }
  working = chars.join('');
  for (const re of QUOTED) {
    re.lastIndex = 0;
    for (const m of working.matchAll(re)) blankSpan(chars, m.index, m.index + m[0].length);
    re.lastIndex = 0;
  }
  return chars.join('');
}

function subjectTextOk(inner) {
  return inner.replace(/\s/g, '').length >= 2;
}

function bareSubjectOk(text, index, idLength) {
  const before = text.slice(0, index);
  const after = text.slice(index + idLength);
  const open = /^[ \t]*([（(])/.exec(after);
  if (open) {
    const close = open[1] === '（' ? '）' : ')';
    const rest = after.slice(open[0].length);
    const end = rest.indexOf(close);
    if (end >= 0 && subjectTextOk(rest.slice(0, end))) return true;
  }
  const quoted = /「([^」]*)」[ \t]*$/.exec(before);
  if (quoted && subjectTextOk(quoted[1])) return true;
  return TITLE_LABEL.test(before);
}

// Escapes apply; the bare-id off switch does not. Unique ids, first bare occurrence order.
function unresolvedBareIds(text) {
  const escapes = escapeRecords(text);
  const masked = maskBareExclusions(text);
  const out = [];
  const seen = new Set();
  for (const m of masked.matchAll(/\bd-[0-9a-f]{8}\b/gi)) {
    const id = m[0].toLowerCase();
    if (seen.has(id)) continue;
    if (bareSubjectOk(text, m.index, m[0].length)) continue;
    if (escapes.some((e) => e.classes.split(',').includes(BARE_CARD_CLASS) && e.sentence.toLowerCase() === id)) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function bareCardReason(ids) {
  return `這些卡片編號旁邊沒有白話主題，操作員看不出每張卡是什麼：${ids.join('、')}。`
    + '編號後面緊接（主題）或 (主題)，主題至少兩個非空白字；或編號前面緊接「主題」，或「標題：」「章節：」「題目：」「主題：」這類標籤。'
    + '合格例子：d-47602dd8（週一手機重連 Wi-Fi）。'
    + '若為誤判，每個編號各加一行 OWNER-GUARD-FALSE-POSITIVE [bare_card_id] <編號> :: 理由。';
}

// Where this session's root is and whether a card it already opened landed outside it. Fail-open: any error => { root: null, unbound: [] }.
function rootState(input) {
  try {
    if (typeof input.session_id !== 'string' || !input.session_id) return { root: null, unbound: [] };
    const sm = require('../../scripts/session-mode.js');
    const { root, session } = sm.readSessionRoot(input.session_id, { liveBase: require('../live-session-lib.js').liveBase() });
    if (!root) return { root: null, unbound: [] };
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    return { root, unbound: require('../../scripts/open-decision.js').unboundCardsOf(cwd, session) };
  } catch { return { root: null, unbound: [] }; }
}

// Autonomous = an unexpired orchestrator marker (level l3-l6) for this session. Fail-open: any error => false.
function isAutonomous(sessionId) {
  try {
    if (typeof sessionId !== 'string' || !sessionId) return false;
    return require('../../scripts/session-mode.js').isAutonomousSession(sessionId);
  } catch { return false; }
}


const OPEN_EXAMPLE = 'node ' + OPEN_DECISION_CMD + ' open --category <c> --executor <addr> --question <q> --option A::<desc> --option B::<desc> --recommendation A --why <r> --not-authorized <b>';
const LANE_EXAMPLE = 'node scripts/request-decision.js send --question <q> --option A::<desc> --option B::<desc> --recommendation <r> --boundary <b>';
const SHORT_CORRECTION_LINE = '只送一則短更正（補上缺的卡號／task id／改寫那一句），不要整則重寫。';
const CARD_FIX = '同句寫出 live 卡片編號（d- 加 8 hex，狀態 open 或 awaiting_operator_action）或有 due 的 fleet task。' + OPEN_EXAMPLE + '（其餘見 --help）';
const LANE_FIX = '同句寫出請求編號（r- 加 8 hex）。' + LANE_EXAMPLE;
const BARE_FIX = '編號後面緊接（主題）或 (主題)，主題至少兩個非空白字；或編號前面緊接「主題」，或「標題：」「章節：」「題目：」「主題：」。合格例子：d-47602dd8（週一手機重連 Wi-Fi）。';
const SHORT_CORRECTION_MAX = 400;

function oneLine(s) {
  return String(s).replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
}

function assistantTextsThisTurn(transcript) {
  const lines = String(transcript).split('\n');
  const texts = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e && (e.type || (e.message && e.message.role));
    const content = e && e.message && e.message.content;
    if (role === 'user') {
      const onlyToolResult = Array.isArray(content) && content.length && content.every((b) => b && b.type === 'tool_result');
      if (!onlyToolResult) break;
      continue;
    }
    if (role !== 'assistant') continue;
    const text = typeof content === 'string' ? content
      : Array.isArray(content) ? content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '';
    if (text.trim()) texts.push(text);
  }
  texts.reverse();
  return texts;
}

function lastAssistantText(transcript) {
  const texts = assistantTextsThisTurn(transcript);
  return texts.length ? texts[texts.length - 1] : null;
}

function collectProblems(text, input = {}) {
  const notes = [];
  const cwd = input.cwd || process.cwd();
  let rs = { root: null, unbound: [] };
  if (input.skipSession) {
    notes.push('session-state checks skipped (card bound to session); pass --session <id>');
  } else {
    rs = rootState({ session_id: input.session_id, cwd });
  }
  const unboundIds = !input.skipSession && rs.root && rs.unbound.length
    ? new Set(rs.unbound.map((u) => u.id.toLowerCase())) : null;
  const hits = unresolvedHits(text, cwd, unboundIds);
  const mentioned = unboundIds ? new Set([...stripCode(text).matchAll(CARD_ID)].map(([id]) => id.toLowerCase())) : null;
  const namedUnbound = mentioned ? rs.unbound.filter((u) => mentioned.has(u.id.toLowerCase())) : [];
  const bare = bareCardLintOff() ? [] : unresolvedBareIds(text);
  const problems = [];
  if (input.includeLanguage !== false && replyLanguageActive()) {
    const lang = languageCheck(text);
    if (lang) problems.push({ rule: 'reply_language', sentence: oneLine(text).slice(0, 120), fix: lang.reason });
  }
  // ask-guard seat decision (never team.json): a gated seat gets the lane treatment (LANE_FIX),
  // an allowed seat keeps the solo/pm treatment.
  const seat = askGuard.decide({ env: envBag(), cwd });
  const lane = !namedUnbound.length && seat.verdict !== 'allow';
  const silenced = lane && (REQUEST_ID.test(text) || /\bd-[0-9a-f]{8}\b/i.test(text));
  if (!silenced) {
    if (lane) {
      for (const h of hits) problems.push({ rule: [...h.classes].sort().join(','), sentence: h.sentence, fix: LANE_FIX });
    } else {
      for (const id of bare) problems.push({ rule: 'bare_card_id', sentence: id, fix: BARE_FIX });
      for (const u of namedUnbound) {
        problems.push({
          rule: 'unbound_card',
          sentence: u.id,
          fix: '卡片 ' + u.id + ' 落在未綁定範圍（本 session 的 root 是 ' + rs.root + '）：請先執行 node ' + OPEN_DECISION_CMD + ' close --id ' + u.id + '，再用 node ' + OPEN_DECISION_CMD + ' open --root-run-id ' + rs.root + ' --category <c> 重新開卡。',
        });
      }
      const fix = CARD_FIX + (isAutonomous(input.session_id) ? ' 若在 DOA 內請自行決定，不要開卡。' : '');
      for (const h of hits) problems.push({ rule: [...h.classes].sort().join(','), sentence: h.sentence, fix });
    }
  } else {
    for (const id of bare) problems.push({ rule: 'bare_card_id', sentence: id, fix: BARE_FIX });
  }
  return { problems, notes };
}

function formatReason(problems) {
  if (!problems.length) return null;
  const lines = problems.map((p) => (p.rule === 'reply_language' ? p.fix : p.rule + ': "' + oneLine(p.sentence) + '" -> ' + p.fix));
  if (problems.some((p) => p.rule !== 'reply_language')) lines.push(SHORT_CORRECTION_LINE);
  return lines.join('\n');
}

function normSentence(s) {
  return String(s).replace(/[。？！?.!\s]+$/g, '');
}

// Same ask, or the same ask with only a trailing card id or due task appended.
// A longer or shorter wording is a different ask. Substring inclusion either way is not a restatement.
function askCore(s) {
  let t = normSentence(s);
  let prev;
  do {
    prev = t;
    t = t.replace(/[，,、\s]*(?:卡號)?\s*\bd-[0-9a-f]{8}\b(?:\s*[（(][^）)]*[）)])?\s*$/i, '');
    t = t.replace(/[，,、\s]*(?:fleet\s+task\s+\S+(?:\s+\S+){0,8}\s+--due(?:=|\s+)\S+|task_id=\S+\s+due=\S+)\s*$/i, '');
    t = normSentence(t);
  } while (t !== prev);
  return t;
}

function restates(a, b) {
  const x = askCore(a);
  const y = askCore(b);
  return x.length > 0 && x === y;
}

function sentenceClearsAsk(prevSentence, corrSentence, cwd) {
  return restates(prevSentence, corrSentence) && (hasLiveCard(corrSentence, cwd) || hasDueTask(corrSentence));
}

function applyShortCorrection(prevProblems, corrText, corrProblems, cwd = process.cwd()) {
  const corrSentences = sentences(corrText);
  const fixedPrev = (p) => {
    if (p.rule === 'reply_language' || p.rule === 'unbound_card') return false;
    if (p.rule === 'bare_card_id') return !unresolvedBareIds(corrText).some((id) => id === String(p.sentence).toLowerCase());
    return corrSentences.some((s) => sentenceClearsAsk(p.sentence, s, cwd));
  };
  const stillPrev = prevProblems.filter((p) => !fixedPrev(p));
  const keptCorr = corrProblems.filter((p) => {
    if (p.rule === 'bare_card_id' || p.rule === 'reply_language' || p.rule === 'unbound_card') return true;
    return !prevProblems.some((pp) => pp.rule !== 'bare_card_id' && pp.rule !== 'reply_language' && pp.rule !== 'unbound_card'
      && corrSentences.some((s) => s === p.sentence && sentenceClearsAsk(pp.sentence, s, cwd)));
  });
  const seen = new Set();
  const out = [];
  for (const p of [...stillPrev, ...keptCorr]) {
    const key = p.rule + '\0' + p.sentence;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function reasonForTurn(input, text, prev) {
  const cur = collectProblems(text, input);
  let problems = cur.problems;
  if (prev && text.length <= SHORT_CORRECTION_MAX) {
    const prevRun = collectProblems(prev, input);
    if (prevRun.problems.length) problems = applyShortCorrection(prevRun.problems, text, problems, input.cwd || process.cwd());
  }
  // Inside the ask_guard warn window a gated seat's owner question is not blocked: the gate
  // records one hits.jsonl line and one stderr line, and lets the reply stand (rule 3 rollout,
  // same shape as foreman_guard.poll_enforce_from). After the window the same problems block.
  if (problems.length) {
    const seat = askGuard.decide({ env: envBag(), cwd: input.cwd || process.cwd() });
    if (seat.verdict === 'warn') {
      const gated = problems.filter((p) => !NON_GATE_RULES.has(p.rule));
      if (gated.length) {
        askGuard.recordHit(seat, { env: envBag(), sessionId: input.session_id });
        process.stderr.write(`${askGuard.warnLine(seat)}\n`);
        problems = problems.filter((p) => NON_GATE_RULES.has(p.rule));
      }
    }
  }
  return formatReason(problems);
}

module.exports = {
  findOwnerQuestion,
  findHits,
  unresolvedHits,
  hasDueTask,
  setFleetTaskLookup,
  unresolvedBareIds,
  lastAssistantText,
  assistantTextsThisTurn,
  stripForLanguage,
  languageCheck,
  replyLanguageActive,
  collectProblems,
  formatReason,
  reasonForTurn,
  applyShortCorrection,
  envBag,
  optedOut,
  loadCfg,
  OWNER_WAIT_PATTERNS,
  HIT_PATTERNS,
  SIMPLIFIED_TO_TRADITIONAL,
  OPEN_EXAMPLE,
  SHORT_CORRECTION_LINE,
  SHORT_CORRECTION_MAX,
};
