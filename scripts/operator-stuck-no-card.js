#!/usr/bin/env node
/**
 * operator-stuck-no-card — list open fleet tasks stuck on the operator that have no live decision card.
 *
 * A task counts as "stuck on the operator" when any of these holds:
 *   - state is blocked_human, or state_note starts with it
 *   - waiting_on names the operator (operator / 操作員)
 *   - its latest progress or comment says the operator must act (要/等 操作員, waiting_on_operator)
 * It has "no matching card" when no d-<8 hex> id is found in those texts, the id is not in
 * `fleet decision list --all --json`, or that card is closed / answered / withdrawn.
 *
 * Usage: node scripts/operator-stuck-no-card.js [--send <address>] [--json]
 *   default: print the rows. --send: one fleet message to <address>, nothing when there are no rows.
 * Env: OPERATOR_STUCK_FLEET_BIN (default `fleet`).
 * Exit: 0 ok (rows or not), 1 fleet error.
 */
'use strict';

const { spawnSync } = require('child_process');

const OPEN_STATES = new Set(['running', 'waiting', 'result_reported', 'blocked_human']);
const DEAD_CARD_STATES = new Set(['closed', 'answered', 'withdrawn']);
const CARD_ID_RE = /d-[0-9a-f]{8}/g;
const WAITING_OPERATOR_RE = /operator|操作員/i;
const TEXT_OPERATOR_RE = /(?:要|等|需要|請)操作員(?:本人|動手|親自|答|處理|登入|試用)|waiting_on_operator/;

function runFleet(bin, args) {
  const res = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60000 });
  if (res.error) throw new Error(`fleet ${args[0]} failed: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`fleet ${args.join(' ')} exited ${res.status}: ${(res.stderr || '').trim().slice(0, 200)}`);
  return res.stdout;
}

function parseJson(raw) {
  const i = raw.search(/[[{]/);
  return JSON.parse(i < 0 ? raw : raw.slice(i));
}

function taskTexts(t) {
  const out = [];
  if (t.waiting_on) out.push(String(t.waiting_on));
  if (t.state_note) out.push(String(t.state_note));
  if (t.next_step) out.push(String(t.next_step));
  if (t.progress) out.push(String(t.progress));
  const cs = Array.isArray(t.comments) ? t.comments.slice(-2) : [];
  for (const c of cs) if (c && c.text) out.push(String(c.text));
  return out;
}

function stuckReason(t) {
  if (t.state === 'blocked_human' || /^\s*blocked_human/.test(String(t.state_note || ''))) return 'blocked_human';
  if (t.waiting_on && WAITING_OPERATOR_RE.test(String(t.waiting_on))) return `waiting_on: ${String(t.waiting_on).slice(0, 80)}`;
  const hit = taskTexts(t).find((s) => TEXT_OPERATOR_RE.test(s));
  return hit ? `文字寫著要操作員動手: ${hit.replace(/\s+/g, ' ').slice(0, 80)}` : null;
}

function findRows(tasks, cards) {
  const cardState = new Map(cards.map((c) => [c.card && c.card.card_id, c.state]));
  const rows = [];
  for (const t of tasks) {
    if (!OPEN_STATES.has(t.state)) continue;
    const why = stuckReason(t);
    if (!why) continue;
    const ids = [...new Set(taskTexts(t).flatMap((s) => s.match(CARD_ID_RE) || []))];
    const live = ids.filter((id) => cardState.has(id) && !DEAD_CARD_STATES.has(cardState.get(id)));
    if (live.length) continue;
    const missing = ids.length === 0 ? '抽不到 d- 編號' : ids.some((id) => !cardState.has(id)) ? `查不到卡 ${ids.join(',')}` : `卡已結 ${ids.join(',')}`;
    const lane = String(t.assignee || '').split('/').slice(-1)[0] || '-';
    rows.push({ task_id: t.task_id, lane, need: why, missing });
  }
  return rows;
}

function main() {
  const argv = process.argv.slice(2);
  const sendIdx = argv.indexOf('--send');
  const sendTo = sendIdx >= 0 ? argv[sendIdx + 1] : null;
  const bin = process.env.OPERATOR_STUCK_FLEET_BIN || 'fleet';
  try {
    const tasks = parseJson(runFleet(bin, ['tasks', '--all', '--json']));
    const cards = parseJson(runFleet(bin, ['decision', 'list', '--all', '--json'])).cards || [];
    const rows = findRows(Array.isArray(tasks) ? tasks : tasks.tasks || [], cards);
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(rows)}\n`);
    else for (const r of rows) process.stdout.write(`${r.task_id}\t${r.lane}\t${r.need}\t${r.missing}\n`);
    if (sendTo && rows.length) {
      const body = [`操作員待辦缺卡 ${rows.length} 張（單號 | lane | 要操作員做什麼 | 缺項目原因）`]
        .concat(rows.map((r) => `${r.task_id} | ${r.lane} | ${r.need} | ${r.missing}`)).join('\n');
      runFleet(bin, ['send', sendTo, body]);
    }
  } catch (err) {
    process.stderr.write(`operator-stuck-no-card: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { findRows, stuckReason };
