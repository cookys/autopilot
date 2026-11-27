#!/usr/bin/env node
/**
 * pm-intake-b — Stop, PM seat only (default-on).
 *
 * Advice or a dispatch (mechanical): the last assistant reply contains a fenced
 * block whose body matches /\bdispatch\b/ (covers `fleet dispatch` and `dispatch`),
 * OR one of 建議 / 推薦 / 我會派 / 派給.
 *
 * Such a reply must contain a verdict line `判定：已經有|部分有|沒有|衝突`.
 * Evidence is on that line or the next line: path@sha (`[\w./-]+@[0-9a-f]{7,40}`)
 * or a 26-char Crockford task id. `已經有` / `部分有` also need the owning lane's
 * confirm id: `待確認 <26-char id>`, or a task id that is not the only evidence
 * id when the evidence itself is a task id (a path@sha plus one task id is enough).
 * `沒有` must name the owning lane (`擁有 lane：<name>` or `lane：<name>`) or contain
 * the words `requested.md` (plan 7.6).
 *
 * Missing pieces block once: `{"decision":"block","reason":...}`. A payload with
 * `stop_hook_active: true` does not block again.
 *
 * Every parsed verdict is one JSON line in `$PM_INTAKE_LOG`, after a host-name
 * scan of that line against `$PM_HOST_DENY_FILE` (default /etc/lab/deny.txt).
 * A missing deny file means no scan. A hit refuses the write and blocks (the
 * reason names the hit). Fail-open on internal errors: one stderr line, exit 0.
 */
'use strict';

const fs = require('fs');
const { resolveFleetSeat } = require('./_shared/fleet-seat.js');

const VERDICT_RE = /判定：(已經有|部分有|沒有|衝突)/;
const REF_RE = /[\w./-]+@[0-9a-f]{7,40}/gi;
const TASK_RE = /[0-9A-HJKMNP-TV-Z]{26}/g;
const ADVICE_WORD_RE = /建議|推薦|我會派|派給/;
const LANE_RE = /擁有(?:的)?(?:\s*lane)?\s*[：:]\s*\S+|lane\s*[：:]\s*\S+|requested\.md/;

function lastAssistantText(raw) {
  const lines = String(raw).split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    const role = entry && (entry.type || (entry.message && entry.message.role));
    if (role !== 'assistant') continue;
    const content = entry.message && entry.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    }
    return '';
  }
  return '';
}

function isAdvice(text) {
  if (ADVICE_WORD_RE.test(text)) return true;
  const fences = text.match(/```[\s\S]*?```/g) || [];
  return fences.some((block) => /\bdispatch\b/.test(block));
}

function verdictAt(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(VERDICT_RE);
    if (m) return { kind: m[1], index: i, window: [lines[i], lines[i + 1] || ''].join('\n') };
  }
  return null;
}

function taskIds(s) {
  return [...String(s).matchAll(TASK_RE)].map((m) => m[0]);
}

function missingPieces(text, verdict) {
  const missing = [];
  if (!verdict) {
    missing.push('判定行 `判定：已經有|部分有|沒有|衝突`');
    return missing;
  }
  const refs = verdict.window.match(new RegExp(REF_RE.source, 'gi')) || [];
  const windowIds = taskIds(verdict.window);
  if (refs.length === 0 && windowIds.length === 0) missing.push('證據 path@sha 或 26 字 task id（寫在判定行或下一行）');
  if (verdict.kind === '已經有' || verdict.kind === '部分有') {
    const pending = text.match(/待確認\s+([0-9A-HJKMNP-TV-Z]{26})/);
    const allIds = taskIds(text);
    const evidenceIsTask = refs.length === 0 && windowIds.length > 0;
    const extra = evidenceIsTask ? allIds.filter((id) => id !== windowIds[0]).length > 0 : allIds.length > 0;
    if (!pending && !extra) missing.push('擁有 lane 的確認 task id，或這一行：`待確認 <26 字 task id>`');
  }
  if (verdict.kind === '沒有' && !LANE_RE.test(text)) missing.push('擁有 lane（`擁有 lane：<name>`）或 `requested.md`');
  return missing;
}

function denyNames(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.length >= 2);
}

function hostHit(line, names) {
  return names.find((name) => line.includes(name)) || null;
}

function decide(input) {
  if (resolveFleetSeat(input) !== 'pm') return { action: 'silent' };
  if (input && input.stop_hook_active === true) return { action: 'pass' };
  const tp = input && input.transcript_path;
  if (typeof tp !== 'string' || !tp) return { action: 'pass' };
  const text = lastAssistantText(fs.readFileSync(tp, 'utf8'));
  if (!text.trim() || !isAdvice(text)) return { action: 'pass' };
  const verdict = verdictAt(text);
  const missing = missingPieces(text, verdict);
  const denyFile = process.env.PM_HOST_DENY_FILE || '/etc/lab/deny.txt';
  const record = verdict ? JSON.stringify({
    ts: new Date().toISOString(),
    verdict: verdict.kind,
    window: verdict.window,
  }) : null;
  const hit = record ? hostHit(record, denyNames(denyFile)) : null;
  if (hit) {
    return { action: 'block', reason: `主機名稱掃描命中 ${hit}，拒絕寫入 intake 紀錄`, log: null };
  }
  if (missing.length) {
    return {
      action: 'block',
      reason: `intake 判定缺：${missing.join('；')}`,
      log: record,
    };
  }
  return { action: 'pass', log: record };
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const result = decide(input && typeof input === 'object' ? input : {});
    if (result.log) {
      const logPath = process.env.PM_INTAKE_LOG;
      if (!logPath) throw new Error('PM_INTAKE_LOG unset');
      fs.mkdirSync(require('path').dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${result.log}\n`);
    }
    if (result.action === 'block') {
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason: result.reason })}\n`);
    }
  } catch (err) {
    process.stderr.write(`pm-intake-b: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();

module.exports = { decide, isAdvice, missingPieces };
