#!/usr/bin/env node
/**
 * inbox-drain-gate — Stop hook (default-on for PM seat).
 *
 * Before the turn ends, checks the PM seat's inbox via scripts/lib/pm-inbox-adapter.js.
 * If any unread / pending_decision item is older than 10 minutes, blocks the stop
 * (at most MAX_BLOCKS = 2 times per turn/sequence so it can never deadlock) and lists
 * each item's id, source, and one-line summary with instructions to close via
 * `node scripts/pm-inbox-done.js <message_id> --ref <id>` (or `--no-action <reason>`).
 *
 * Applies only to the PM seat (`resolveFleetSeat(payload) === 'pm'`), or also lead seats
 * when `inbox_drain_gate_lead` / `AUTOPILOT_INBOX_DRAIN_GATE_LEAD=1` is enabled.
 * Fail-open: any adapter or I/O error prints one line to stderr and exits 0.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readConfig } = require('../scripts/lib/config-path.js');
const { resolveLiveDir } = require('../scripts/lib/live-state-dir.js');
const { createAdapter } = require('../scripts/lib/pm-inbox-adapter.js');
const { resolveFleetSeat } = require('./_shared/fleet-seat.js');
const { lockStateFile, sessionIdOf, stateDirOf } = require('./context-budget-lib.js');
const { gateHint } = require('./lib/gate-hint.js');

const MAX_BLOCKS = 2;
const STALE_MS = 10 * 60 * 1000;

function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
}

function isLeadEnabled() {
  const envVal = process.env.AUTOPILOT_INBOX_DRAIN_GATE_LEAD;
  if (envVal === '1' || envVal === 'true') return true;
  if (envVal === '0' || envVal === 'false') return false;
  try {
    const cfg = readConfig();
    return Boolean(cfg && cfg.inbox_drain_gate_lead === true);
  } catch {
    return false;
  }
}

function itemTimestampMs(item) {
  const raw = item.created_at || item.at || item.timestamp || item.ts;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function oneLineSummary(item) {
  const raw = item.summary || item.subject || item.title || item.body || item.text || '';
  const line = String(raw).replace(/\s+/g, ' ').trim();
  if (!line) return '(no summary)';
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  if (!payload || payload.agent_id) return;

  const seat = resolveFleetSeat(payload);
  if (seat !== 'pm' && !(seat === 'lead' && isLeadEnabled())) {
    return;
  }

  let items;
  try {
    const adapter = createAdapter(process.env);
    items = adapter.listUnread();
  } catch (err) {
    process.stderr.write(`inbox-drain-gate adapter error (fail-open): ${err && err.message ? err.message : String(err)}\n`);
    return;
  }

  if (!Array.isArray(items) || items.length === 0) return;

  const now = Date.now();
  const stale = items.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const disp = item.disposition;
    if (disp && disp !== 'unread' && disp !== 'pending_decision') return false;
    const ts = itemTimestampMs(item);
    return ts !== null && (now - ts) > STALE_MS;
  });

  if (stale.length === 0) return;

  const sid = sessionIdOf(payload);
  const live = resolveLiveDir();
  const sDir = stateDirOf(live.base);
  fs.mkdirSync(sDir, { recursive: true });
  const stateFile = path.join(sDir, `${sid}.json`);
  const release = lockStateFile(stateFile);
  try {
    let st = {};
    if (fs.existsSync(stateFile)) {
      try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { st = {}; }
    }
    if (!st || typeof st !== 'object') st = {};
    // A fresh Stop (stop_hook_active not set) is a new turn: the 2-block cap counts per turn, not per session.
    const blocks = payload.stop_hook_active !== true ? 0 : (Number.isInteger(st.inboxDrainBlocks) ? st.inboxDrainBlocks : 0);
    if (blocks >= MAX_BLOCKS) {
      return;
    }
    st.inboxDrainBlocks = blocks + 1;
    fs.writeFileSync(stateFile, JSON.stringify(st));

    const lines = stale.map((item) => {
      const id = item.id || item.message_id || '(unknown)';
      const src = item.from || item.source || item.sender || '(unknown)';
      return `- ${id} [${src}]: ${oneLineSummary(item)}`;
    });
    const reason = [
      `PM 收件匣有 ${stale.length} 則超過 10 分鐘未處理的訊息（第 ${st.inboxDrainBlocks}/${MAX_BLOCKS} 次擋停）：`,
      ...lines,
      '請逐一處理並執行 `node scripts/pm-inbox-done.js <message_id> --ref <id>`（或 `--no-action <reason>`），或綁定到工作單後再結束 turn。',
    ].join('\n') + gateHint('處理並關閉上述逾期收件匣訊息，再結束 turn', 'hooks/README.md');
    block(reason);
  } finally {
    if (release) { try { release(); } catch { /* ignore */ } }
  }
}

try {
  main();
} catch (err) {
  try {
    process.stderr.write(`inbox-drain-gate error (fail-open): ${err && err.message ? err.message : String(err)}\n`);
  } catch { /* ignore */ }
}
process.exit(0);
