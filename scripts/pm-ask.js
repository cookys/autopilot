#!/usr/bin/env node
/**
 * pm-ask.js — Request register CLI for PM operator asks (askpm.jsonl).
 *
 * Subcommands:
 *   close <ask_id> --evidence <ref>   Dispose ask as closed (sha 7-40 hex, 26-char ULID, d-8hex, https URL, or existing absolute path)
 *   progress <ask_id> --task <ulid>   Dispose ask as tracked under a 26-char fleet task ULID
 *   supersede <old_id> <new_id>       Dispose <old_id> as superseded by newer <new_id>
 *   list [--open]                     List asks (<= 30 lines, `id age first-60-chars`, `… N more`)
 *   overdue [--hours 24]              List open asks older than N hours (default 24, <= 30 lines)
 *
 * Exit codes: 0 ok, 2 usage/validation error.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { SCHEMA, append, readRows } = require('../hooks/askpm-log');

const MAX_VIEW_LINES = 30;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const CARD_RE = /^d-[0-9a-f]{8}$/i;

function envFromProcess() {
  return {
    AUTOPILOT_STATE_DIR: process.env.AUTOPILOT_STATE_DIR,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    HOME: process.env.HOME,
  };
}

function isValidUlid(v) {
  return typeof v === 'string' && ULID_RE.test(v);
}

function isValidHttpsUrl(ref) {
  if (typeof ref !== 'string' || !/^https:\/\//i.test(ref)) return false;
  if (/\s/.test(ref)) return false;
  try {
    const u = new URL(ref);
    return u.protocol === 'https:' && typeof u.hostname === 'string' && u.hostname.length > 0;
  } catch {
    return false;
  }
}

function isValidEvidence(ref) {
  if (typeof ref !== 'string' || ref === '') return false;
  if (ref.trim() !== ref) return false;
  if (SHA_RE.test(ref)) return true;
  if (isValidUlid(ref)) return true;
  if (CARD_RE.test(ref)) return true;
  if (isValidHttpsUrl(ref)) return true;
  if (path.isAbsolute(ref) && fs.existsSync(ref)) return true;
  return false;
}

// Legacy rows before the first row carrying an ask_id are ignored by every pm-ask view.
function loadState(env) {
  const rawRows = readRows(env);
  if (!rawRows || rawRows.length === 0) {
    return { asks: [], askById: new Map(), disposed: new Set() };
  }
  const cutoff = rawRows.findIndex((r) => typeof r.ask_id === 'string' && r.ask_id !== '');
  if (cutoff < 0) {
    return { asks: [], askById: new Map(), disposed: new Set() };
  }
  const rows = rawRows.slice(cutoff);
  const asks = [];
  const askById = new Map();
  const disposed = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.kind === 'ask' && typeof r.ask_id === 'string' && r.ask_id !== '') {
      const entry = { row: r, index: i };
      asks.push(entry);
      askById.set(r.ask_id, entry);
    } else if (r.kind === 'disposition' && typeof r.ask_id === 'string' && r.ask_id !== '') {
      if (r.action === 'close' || r.action === 'progress' || r.action === 'supersede') {
        disposed.add(r.ask_id);
      }
    }
  }
  return { asks, askById, disposed };
}

function formatAge(atIso, nowMs) {
  const ts = Date.parse(atIso);
  if (!Number.isFinite(ts)) return '?';
  const diffMs = Math.max(0, nowMs - ts);
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatAskLine(row, nowMs) {
  const age = formatAge(row.at, nowMs);
  const summary = (typeof row.text === 'string' ? row.text : '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${row.ask_id} ${age} ${summary}`;
}

function formatList(entries, nowMs = Date.now()) {
  if (entries.length === 0) return '';
  const shown = entries.slice(0, MAX_VIEW_LINES).map((e) => formatAskLine(e.row, nowMs));
  if (entries.length > MAX_VIEW_LINES) {
    shown.push(`… ${entries.length - MAX_VIEW_LINES} more`);
  }
  return shown.join('\n');
}

function listOutput(env, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const { asks, disposed } = loadState(env);
  const selected = opts.open ? asks.filter((e) => !disposed.has(e.row.ask_id)) : asks;
  return formatList(selected, nowMs);
}

function overdueOutput(env, hours = 24, nowMs = Date.now()) {
  const { asks, disposed } = loadState(env);
  const cutoffMs = hours * 3600 * 1000;
  const selected = asks.filter((e) => {
    if (disposed.has(e.row.ask_id)) return false;
    const ts = Date.parse(e.row.at);
    if (!Number.isFinite(ts)) return false;
    return (nowMs - ts) > cutoffMs;
  });
  return formatList(selected, nowMs);
}

function usageError(msg) {
  const err = new Error(msg);
  err.exitCode = 2;
  return err;
}

function runCommand(argv, env = envFromProcess(), nowMs = Date.now()) {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    if (!cmd) throw usageError('pm-ask: missing subcommand (close|progress|supersede|list|overdue)');
    return [
      'Usage:',
      '  pm-ask.js close <ask_id> --evidence <ref>',
      '  pm-ask.js progress <ask_id> --task <ulid>',
      '  pm-ask.js supersede <old_id> <new_id>',
      '  pm-ask.js list [--open]',
      '  pm-ask.js overdue [--hours 24]',
    ].join('\n');
  }

  const rest = argv.slice(1);

  if (cmd === 'close') {
    let askId = null;
    let evidence = null;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === '--evidence') {
        if (i + 1 >= rest.length) throw usageError('pm-ask close: --evidence requires a value');
        evidence = rest[++i];
      } else if (arg.startsWith('--evidence=')) {
        evidence = arg.slice('--evidence='.length);
      } else if (arg.startsWith('-')) {
        throw usageError(`pm-ask close: unknown option ${arg}`);
      } else if (askId === null) {
        askId = arg;
      } else {
        throw usageError(`pm-ask close: unexpected argument ${arg}`);
      }
    }
    if (!askId) throw usageError('pm-ask close: missing <ask_id>');
    if (!evidence) throw usageError('pm-ask close: missing --evidence <ref>');
    if (!isValidEvidence(evidence)) throw usageError(`pm-ask close: invalid --evidence "${evidence}"`);
    const { askById } = loadState(env);
    if (!askById.has(askId)) throw usageError(`pm-ask close: unknown ask_id ${askId}`);
    append(env, {
      schema: SCHEMA,
      kind: 'disposition',
      at: new Date().toISOString(),
      ask_id: askId,
      action: 'close',
      evidence,
    });
    return `closed ${askId}`;
  }

  if (cmd === 'progress') {
    let askId = null;
    let task = null;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === '--task') {
        if (i + 1 >= rest.length) throw usageError('pm-ask progress: --task requires a value');
        task = rest[++i];
      } else if (arg.startsWith('--task=')) {
        task = arg.slice('--task='.length);
      } else if (arg.startsWith('-')) {
        throw usageError(`pm-ask progress: unknown option ${arg}`);
      } else if (askId === null) {
        askId = arg;
      } else {
        throw usageError(`pm-ask progress: unexpected argument ${arg}`);
      }
    }
    if (!askId) throw usageError('pm-ask progress: missing <ask_id>');
    if (!task) throw usageError('pm-ask progress: missing --task <ulid>');
    if (!isValidUlid(task)) throw usageError(`pm-ask progress: invalid --task ULID "${task}"`);
    const { askById } = loadState(env);
    if (!askById.has(askId)) throw usageError(`pm-ask progress: unknown ask_id ${askId}`);
    append(env, {
      schema: SCHEMA,
      kind: 'disposition',
      at: new Date().toISOString(),
      ask_id: askId,
      action: 'progress',
      task,
    });
    return `progress ${askId} -> ${task}`;
  }

  if (cmd === 'supersede') {
    const positional = [];
    for (const arg of rest) {
      if (arg.startsWith('-')) throw usageError(`pm-ask supersede: unknown option ${arg}`);
      positional.push(arg);
    }
    if (positional.length !== 2) throw usageError('pm-ask supersede: requires <old_id> <new_id>');
    const [oldId, newId] = positional;
    if (oldId === newId) throw usageError(`pm-ask supersede: old and new must differ (${oldId})`);
    const { askById } = loadState(env);
    const oldEntry = askById.get(oldId);
    if (!oldEntry) throw usageError(`pm-ask supersede: unknown ask_id ${oldId}`);
    const newEntry = askById.get(newId);
    if (!newEntry) throw usageError(`pm-ask supersede: unknown ask_id ${newId}`);
    const tOld = Date.parse(oldEntry.row.at);
    const tNew = Date.parse(newEntry.row.at);
    const isNewer = (Number.isFinite(tOld) && Number.isFinite(tNew))
      ? (tNew > tOld || (tNew === tOld && newEntry.index > oldEntry.index))
      : (newEntry.index > oldEntry.index);
    if (!isNewer) throw usageError(`pm-ask supersede: ${newId} is not newer than ${oldId}`);
    append(env, {
      schema: SCHEMA,
      kind: 'disposition',
      at: new Date().toISOString(),
      ask_id: oldId,
      action: 'supersede',
      superseded_by: newId,
    });
    return `superseded ${oldId} -> ${newId}`;
  }

  if (cmd === 'list') {
    let openOnly = false;
    for (const arg of rest) {
      if (arg === '--open') openOnly = true;
      else throw usageError(`pm-ask list: unknown argument ${arg}`);
    }
    return listOutput(env, { open: openOnly, nowMs });
  }

  if (cmd === 'overdue') {
    let hours = 24;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === '--hours') {
        if (i + 1 >= rest.length) throw usageError('pm-ask overdue: --hours requires a value');
        const raw = rest[++i];
        const parsed = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
          throw usageError(`pm-ask overdue: invalid --hours "${raw}"`);
        }
        hours = parsed;
      } else if (arg.startsWith('--hours=')) {
        const raw = arg.slice('--hours='.length);
        const parsed = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
          throw usageError(`pm-ask overdue: invalid --hours "${raw}"`);
        }
        hours = parsed;
      } else {
        throw usageError(`pm-ask overdue: unknown argument ${arg}`);
      }
    }
    return overdueOutput(env, hours, nowMs);
  }

  throw usageError(`pm-ask: unknown subcommand ${cmd}`);
}

function main() {
  try {
    const out = runCommand(process.argv.slice(2));
    if (out) process.stdout.write(`${out}\n`);
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(err && typeof err.exitCode === 'number' ? err.exitCode : 2);
  }
}

if (require.main === module) main();

module.exports = {
  isValidEvidence,
  isValidUlid,
  loadState,
  formatAge,
  formatAskLine,
  formatList,
  listOutput,
  overdueOutput,
  runCommand,
};
