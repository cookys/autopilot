#!/usr/bin/env node
'use strict';

/**
 * task-card.js — the session's task card: what it was asked to do, in a file the workflow
 * snapshot (scripts/lib/workflow-snapshot.js) can read back after a compaction or /clear.
 * Plan: docs/plans/2026-10-13-workflow-snapshot-at-compaction.md (P2).
 *
 *   node scripts/task-card.js set [--goal <text>] [--success <text>]... [--plan <path>]
 *        [--review-ledger <path>] [--ledger <decisions.jsonl>] [--requirement <text>]...
 *        [--session <id>]
 *   node scripts/task-card.js show  [--session <id>]
 *   node scripts/task-card.js clear [--session <id>]
 *
 * File: ${AUTOPILOT_TASK_CARD_DIR:-~/.autopilot/task-card}/<session id>.json, mode 600, atomic write.
 * `set` merges: a scalar flag replaces that field, a repeated flag replaces that list (given again
 * in full), fields not named are kept. Field caps: goal 600, each list item 300, 10 items, paths 400.
 * Session id: --session, else AUTOPILOT_SESSION_ID / CLAUDE_CODE_SESSION_ID / CLAUDE_SESSION_ID; no
 * cwd fallback (a card keyed by a path would belong to no session). Exit: 0 ok, 2 usage.
 * Not a gate and not an attestation: a card is the owner's or depth-0's statement of intent, read
 * back as text. Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA = 'autopilot.task-card/1';
const CAPS = { goal: 600, item: 300, path: 400, items: 10 };

function die(msg) { process.stderr.write(`task-card: ${msg}\n`); process.exit(2); }
function dir() { return process.env.AUTOPILOT_TASK_CARD_DIR || path.join(os.homedir(), '.autopilot', 'task-card'); }
function norm(raw) { return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64); }
function sessionId(arg) {
  const raw = arg || process.env.AUTOPILOT_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (!raw) die('no session id: pass --session or run inside a Claude Code session');
  return norm(raw);
}
function cap(s, n) { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) : t; }

function parse(argv) {
  const o = { lists: { success: [], requirement: [] }, scalars: {} };
  const scalar = { '--goal': 'goal', '--plan': 'plan', '--review-ledger': 'review_ledger', '--ledger': 'ledger', '--session': 'session' };
  const list = { '--success': 'success', '--requirement': 'requirement' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (scalar[a] || list[a]) {
      if (v === undefined) die(`${a} needs a value`);
      i++;
      if (scalar[a]) o.scalars[scalar[a]] = v; else o.lists[list[a]].push(v);
    } else die(`unknown argument ${a}`);
  }
  return o;
}

function read(file) {
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); return c && c.schema === SCHEMA ? c : null; } catch { return null; }
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!['set', 'show', 'clear'].includes(cmd)) die('usage: task-card.js set|show|clear [flags] (see the script header)');
  const o = parse(rest);
  const sid = sessionId(o.scalars.session);
  const file = path.join(dir(), `${sid}.json`);
  if (cmd === 'show') {
    const c = read(file);
    if (!c) { process.stderr.write('task-card: no card for this session\n'); return; }
    process.stdout.write(`${JSON.stringify(c, null, 2)}\n`);
    return;
  }
  if (cmd === 'clear') { try { fs.unlinkSync(file); } catch { /* none */ } return; }
  const cur = read(file) || { schema: SCHEMA };
  const next = { ...cur, schema: SCHEMA, session_id: sid };
  const s = o.scalars;
  if (s.goal !== undefined) next.goal = cap(s.goal, CAPS.goal);
  for (const k of ['plan', 'review_ledger', 'ledger']) if (s[k] !== undefined) next[k] = cap(s[k], CAPS.path);
  if (o.lists.success.length) next.success = o.lists.success.slice(0, CAPS.items).map((x) => cap(x, CAPS.item));
  if (o.lists.requirement.length) next.requirements = o.lists.requirement.slice(0, CAPS.items).map((x) => cap(x, CAPS.item));
  next.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

main();
