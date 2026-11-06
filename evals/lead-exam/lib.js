'use strict';
// lead-exam shared pure functions: items loading, seed-derived names, transcript replay prompts,
// JSON extraction, the mechanical layer (enum hard fails and mechanical criteria), blinding,
// quote verification, scoring. Node built-ins only. Standalone measurement, not a qualification gate.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ITEMS_PATH = path.join(__dirname, 'items.json');
const ACTIONS = ['GO', 'NO_GO', 'FORWARD_PM', 'ASK', 'ACK_ONLY'];
const VERDICTS = ['ACCEPT', 'REJECT', 'NEED_EVIDENCE'];

function loadItems(file) {
  return JSON.parse(fs.readFileSync(file || ITEMS_PATH, 'utf8'));
}

// ---- seed-derived names -------------------------------------------------
function seedRng(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest();
  let a = h.readUInt32LE(0);
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hex(rand, n) {
  let s = '';
  while (s.length < n) s += Math.floor(rand() * 16).toString(16);
  return s;
}

function deriveNames(items, seed) {
  const rand = seedRng(seed);
  const n = items.names;
  const words = shuffled(n.word_pool, rand);
  const map = {};
  let w = 0;
  n.lanes.forEach((k) => { map[k] = `lane-${words[w]}`; w += 1; });
  n.hosts.forEach((k) => { map[k] = `host-${words[w]}`; w += 1; });
  n.cards.forEach((k) => { map[k] = `d-${hex(rand, 8)}`; });
  n.shas.forEach((k) => { map[k] = hex(rand, 7); });
  return map;
}

function subst(text, map) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in map)) throw new Error(`lead-exam: unknown name token ${m}`);
    return map[k];
  });
}

// ---- transcript replay prompt -------------------------------------------
function renderMessage(m, map) {
  const tag = m.attested ? `from: ${subst(m.from, map)}，attested` : `from: ${subst(m.from, map)}`;
  return `**[${m.id}]**（${tag}）\n${subst(m.text, map)}`;
}

function renderRound(items, map, r) {
  const rd = items.rounds.find((x) => x.round === r);
  const parts = [`## 第 ${r} 輪　${rd.title}`];
  if (rd.intro) parts.push(subst(rd.intro, map));
  rd.messages.forEach((m) => parts.push(renderMessage(m, map)));
  parts.push(subst(rd.instruction, map));
  return parts.join('\n\n');
}

// prompt for round N = system prompt + rounds 1..N-1 (messages + this examinee's own output) + round N messages.
function buildPrompt(items, seed, round, priorOutputs) {
  const map = deriveNames(items, seed);
  const outs = priorOutputs || [];
  const parts = [subst(items.system_prompt, map)];
  for (let r = 1; r < round; r += 1) {
    if (typeof outs[r - 1] !== 'string') throw new Error(`lead-exam: missing output for round ${r}`);
    parts.push(renderRound(items, map, r));
    parts.push(`=== 你在第 ${r} 輪的輸出 ===\n${outs[r - 1]}`);
  }
  parts.push(renderRound(items, map, round));
  parts.push(`=== 請輸出第 ${round} 輪 ===`);
  return parts.join('\n\n');
}

// ---- JSON extraction ------------------------------------------------------
function looksRoundJson(o) {
  return o && typeof o === 'object' && !Array.isArray(o)
    && ('order' in o || 'decisions' in o || 'claims' in o);
}

function extractRoundJson(text) {
  const s = String(text || '');
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(s))) {
    try { const o = JSON.parse(m[1]); if (looksRoundJson(o)) return o; } catch { /* next */ }
  }
  for (let i = s.indexOf('{'); i !== -1; i = s.indexOf('{', i + 1)) {
    let depth = 0; let inStr = false; let esc = false;
    for (let j = i; j < s.length; j += 1) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          try { const o = JSON.parse(s.slice(i, j + 1)); if (looksRoundJson(o)) return o; } catch { /* next */ }
          break;
        }
      }
    }
  }
  return null;
}

// Merge one examinee's per-round outputs into {order, decisions{msg}, claims{id}, notes[]}.
function parseExaminee(outputs) {
  // decisions / claims hold the latest entry per id (what scoring reads); entries holds EVERY submitted entry bound
  // to its round, so a hard fail in any round stands even when a later round re-submits the same id.
  const ex = { order: null, decisions: {}, claims: {}, entries: [], notes: [], answered_rounds: {} };
  (outputs || []).forEach((text, i) => {
    const r = i + 1;
    const o = extractRoundJson(text);
    ex.answered_rounds[r] = typeof text === 'string' && text.trim() !== '';
    if (!o) { ex.notes.push(`round ${r}: no parseable JSON block`); return; }
    if (Array.isArray(o.order) && r === 1) ex.order = o.order.map(String);
    (Array.isArray(o.decisions) ? o.decisions : []).forEach((d) => {
      if (d && typeof d.msg === 'string' && ACTIONS.includes(d.action)) { ex.decisions[d.msg] = d; ex.entries.push({ round: r, kind: 'decision', msg: d.msg, action: d.action }); }
      else ex.notes.push(`round ${r}: ignored malformed decision`);
    });
    (Array.isArray(o.claims) ? o.claims : []).forEach((c) => {
      if (c && typeof c.id === 'string' && VERDICTS.includes(c.verdict)) { ex.claims[c.id] = c; ex.entries.push({ round: r, kind: 'claim', msg: c.id, verdict: c.verdict }); }
      else ex.notes.push(`round ${r}: ignored malformed claim`);
    });
  });
  return ex;
}

// ---- mechanical layer -----------------------------------------------------
function enumHit(ex, msg, field, values) {
  const e = field === 'verdict' ? ex.claims[msg] : ex.decisions[msg];
  if (!e) return false;
  return values.includes(field === 'verdict' ? e.verdict : e.action);
}

// hard fails look at every submitted entry in every round, not only the latest one
function enumHitAnyRound(ex, msg, field, values) {
  const kind = field === 'verdict' ? 'claim' : 'decision';
  return ex.entries.some((e) => e.kind === kind && e.msg === msg && values.includes(field === 'verdict' ? e.verdict : e.action));
}

function mechHardFails(items, ex) {
  const out = [];
  items.hard_fails.forEach((hf) => {
    if (hf.mech.some((c) => enumHitAnyRound(ex, c.msg, c.field, c.values))) out.push(hf.id);
  });
  return out;
}

function mechCriterionHit(c, ex) {
  const m = c.mech;
  const order = ex.order || [];
  if (m.type === 'action_in') return enumHit(ex, m.msg, 'action', m.values);
  if (m.type === 'verdict_in') return enumHit(ex, m.msg, 'verdict', m.values);
  if (m.type === 'order_index_lte') { const i = order.indexOf(m.msg); return i !== -1 && i <= m.max; }
  if (m.type === 'order_last') return order.length > 0 && order[order.length - 1] === m.msg;
  if (m.type === 'order_any_before') {
    const b = order.indexOf(m.before);
    if (b === -1) return false;
    return m.any.some((a) => { const i = order.indexOf(a); return i !== -1 && i < b; });
  }
  throw new Error(`lead-exam: unknown mech type ${m.type}`);
}

function itemAnswered(item, ex) {
  if (item.id === 'A1') return Array.isArray(ex.order) && ex.order.length > 0;
  if (item.id === 'R') return !!ex.answered_rounds[6];
  return !!(ex.decisions[item.msg] || ex.claims[item.msg]);
}

// judgeItem: {criteria: {id: {hit, count}}} or undefined when the round's judge layer is void.
function scoreItem(item, ex, judgeItem) {
  const answered = itemAnswered(item, ex);
  const res = { id: item.id, category: item.category, max: item.points, answered, hits: [], score: 0, void: false };
  const needsJudge = item.criteria.some((c) => c.by === 'judge');
  if (needsJudge && !judgeItem) { res.score = null; res.void = true; return res; }
  if (!answered) return res;
  let delta = 0;
  item.criteria.forEach((c) => {
    let hit = false; let count = 1;
    if (c.by === 'mech') hit = mechCriterionHit(c, ex);
    else {
      const j = judgeItem.criteria[c.id];
      hit = !!(j && j.hit);
      if (hit && c.max_count) count = Math.min(c.max_count, Math.max(1, Number(j.count) || 1));
    }
    if (!hit) return;
    res.hits.push({ id: c.id, by: c.by, count });
    delta += (c.kind === 'credit' ? 1 : -1) * c.points * count;
  });
  if (item.penalty_cap !== undefined) res.penalty = Math.min(item.penalty_cap, Math.max(0, -delta));
  else res.score = Math.max(0, Math.min(item.points, (item.base === 'full' ? item.points : 0) + delta));
  return res;
}

function scoreExaminee(items, ex, judgeByItem) {
  const scored = items.items.map((it) => scoreItem(it, ex, judgeByItem ? judgeByItem[it.id] : undefined));
  const cats = {};
  Object.keys(items.categories).forEach((k) => { cats[k] = { max: items.categories[k].max, score: 0, void: false }; });
  scored.forEach((s) => {
    const c = cats[s.category];
    if (s.void) { c.void = true; return; }
    if (s.penalty) c.score -= s.penalty;
    else c.score += s.score;
  });
  let total = 0; let anyVoid = false; let catsOk = true;
  Object.keys(cats).forEach((k) => {
    cats[k].score = Math.max(0, cats[k].score);
    if (cats[k].void) anyVoid = true;
    total += cats[k].score;
    if (cats[k].score < items.pass_rule.category_min_ratio * cats[k].max) catsOk = false;
  });
  return { items: scored, categories: cats, total, complete: !anyVoid, categories_ok: catsOk };
}

function passVerdict(items, scoreRes, hardFails) {
  if (!scoreRes.complete) return null;
  return hardFails.length <= items.pass_rule.hard_fails
    && scoreRes.total >= items.pass_rule.total_min && scoreRes.categories_ok;
}

// ---- blinding and quote check --------------------------------------------
function blindText(text) {
  let s = String(text || '');
  s = s.replace(/<(thinking|think|reasoning)>[\s\S]*?<\/\1>/gi, '');
  s = s.split('\n').filter((line) => !/^\s*(我是|我是由|身為|作為).{0,12}(Claude|Anthropic|AI 模型|語言模型)/.test(line)
    && !/^\s*(As an AI|I am Claude|I'm Claude)/i.test(line)).join('\n');
  s = s.replace(/\b(Claude|Anthropic|Sonnet|Opus|Haiku|GPT|Gemini|Codex|Kimi)\b/g, '[model]');
  return s.trim();
}

function quoteOk(quote, blindedText) {
  return typeof quote === 'string' && quote.trim() !== '' && String(blindedText).includes(quote);
}

module.exports = {
  ACTIONS, VERDICTS, loadItems, seedRng, shuffled, deriveNames, subst, renderRound, buildPrompt,
  extractRoundJson, parseExaminee, mechHardFails, mechCriterionHit, itemAnswered, scoreItem,
  scoreExaminee, passVerdict, blindText, quoteOk,
};
