#!/usr/bin/env node
/**
 * pm-ask.js — Request register CLI for PM operator asks (askpm.jsonl).
 *
 * Subcommands:
 *   close <ask_id> --evidence <ref>   Dispose ask as closed (sha 7-40 hex, 26-char ULID, d-8hex, https URL, or existing absolute path)
 *   progress <ask_id> --task <ulid>   Dispose ask as tracked under a 26-char fleet task ULID
 *   supersede <old_id> <new_id>       Dispose <old_id> as superseded by newer <new_id>
 *   list [--open] [--answers [--json]]         List asks (<= 30 lines, `id age first-60-chars`, `… N more`)
 *   overdue [--hours 24]              List open asks older than N hours (default 24, <= 30 lines)
 *   purge-injected [--drop-prefix <text>]... [--apply]  Remove injected/voided asks and paired rows
 *
 * Exit codes: 0 ok, 2 usage/validation error.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { SCHEMA, append, readRows, isHandoffResume, isInjected, typedText, logFile, stateDir } = require('../hooks/askpm-log');
const { withWriteLock } = require('./lib/jsonl-store');
const { groupKey, normalizeQuestion } = require('./lib/ask-group-key');
const { maskSecrets } = require('./lib/mask-secrets');

const MAX_VIEW_LINES = 30;
const ARCHIVE_DAYS_MS = 14 * 24 * 3600 * 1000;
const PREFIX_WINDOW_MS = 30 * 60 * 1000;
const MIN_PREFIX_LEN = 8;
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
    return { asks: [], askById: new Map(), disposed: new Set(), repliesByAskId: new Map(), replyCutoffMs: null };
  }
  const cutoff = rawRows.findIndex((r) => typeof r.ask_id === 'string' && r.ask_id !== '');
  if (cutoff < 0) {
    return { asks: [], askById: new Map(), disposed: new Set(), repliesByAskId: new Map(), replyCutoffMs: null };
  }
  const rows = rawRows.slice(cutoff);
  const asks = [];
  const askById = new Map();
  const disposed = new Set();
  const repliesByAskId = new Map();
  let replyCutoffMs = null;
  for (let i = 0; i < rows.length; i += 1) {
    let r = typeof rows[i].text === 'string' ? { ...rows[i], text: maskSecrets(rows[i].text) } : rows[i];
    if (r.kind === 'ask' && typeof r.ask_id === 'string' && r.ask_id !== '' && !isHandoffResume(r.text) && !isInjected(r.text)) {
      const entry = { row: r, index: i };
      asks.push(entry);
      askById.set(r.ask_id, entry);
    } else if (r.kind === 'void') {
      if (typeof r.ask_id === 'string' && r.ask_id !== '') {
        for (let j = asks.length - 1; j >= 0; j -= 1) {
          if (asks[j].row.ask_id === r.ask_id) {
            asks.splice(j, 1);
            break;
          }
        }
        askById.delete(r.ask_id);
      } else if (asks.length > 0) {
        const removed = asks.pop();
        if (removed && removed.row && removed.row.ask_id) askById.delete(removed.row.ask_id);
      }
    } else if ((r.kind === 'reply' || r.kind === 'disposition') && typeof r.ask_id === 'string' && r.ask_id !== '') {
      // hooks/askpm-log.js writes the PM's answer as kind 'reply'; the older writer and hand-made rows use disposition + action 'reply'
      if (r.kind === 'reply') r = { ...r, action: 'reply' };
      if (r.action === 'close' || r.action === 'progress' || r.action === 'supersede') {
        disposed.add(r.ask_id);
      } else if (r.action === 'reply') {
        const list = repliesByAskId.get(r.ask_id) || [];
        list.push({ text: typeof r.text === 'string' ? r.text : '', at: r.at || null, index: i });
        repliesByAskId.set(r.ask_id, list);
        const ts = r.at ? Date.parse(r.at) : NaN;
        if (Number.isFinite(ts) && (replyCutoffMs === null || ts < replyCutoffMs)) {
          replyCutoffMs = ts;
        }
      }
    }
  }
  return { asks, askById, disposed, repliesByAskId, replyCutoffMs };
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

function formatAskLine(row, nowMs, extra = {}) {
  const age = formatAge(extra.last_at || row.at, nowMs);
  const summary = (typeof row.text === 'string' ? row.text : '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const countTag = extra.count && extra.count > 1 ? ` (x${extra.count})` : '';
  const archivedTag = extra.archived ? ' [archived]' : '';
  return `${row.ask_id} ${age}${countTag}${archivedTag} ${summary}`;
}

function getScopeKey(row) {
  if (typeof row.operator === 'string' && row.operator !== '') {
    return `op:${row.operator}`;
  }
  if (typeof row.session_id === 'string' && row.session_id !== '') {
    return `sess:${row.session_id}`;
  }
  return 'default';
}

function isPrefixMatch(normA, normB) {
  if (!normA || !normB) return false;
  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length <= normB.length ? normB : normA;
  return shorter.length >= MIN_PREFIX_LEN && longer.startsWith(shorter);
}

function mergeIntoGroup(existing, entry, nowMs) {
  const row = entry.row;
  const at = row.at || null;
  existing.count += 1;
  if (!existing.ask_ids.includes(row.ask_id)) {
    existing.ask_ids.push(row.ask_id);
  }
  if (at) {
    const atMs = Date.parse(at);
    const firstMs = existing.first_at ? Date.parse(existing.first_at) : NaN;
    const lastMs = existing.last_at ? Date.parse(existing.last_at) : NaN;
    if (!Number.isFinite(firstMs) || (Number.isFinite(atMs) && atMs < firstMs)) {
      existing.first_at = at;
    }
    if (!Number.isFinite(lastMs) || (Number.isFinite(atMs) && atMs >= lastMs)) {
      existing.last_at = at;
      existing.row = row;
      existing.index = entry.index;
    }
  }
  const finalLastMs = existing.last_at ? Date.parse(existing.last_at) : NaN;
  existing.archived = Number.isFinite(finalLastMs) ? (nowMs - finalLastMs) >= ARCHIVE_DAYS_MS : false;
}

function groupAsks(entries, nowMs = Date.now()) {
  const groups = [];
  const byKey = new Map();

  for (const entry of entries) {
    const row = entry.row;
    const scope = getScopeKey(row);
    const gk = typeof row.group_key === 'string' && row.group_key !== '' ? row.group_key : groupKey(row.text);
    const norm = normalizeQuestion(row.text);
    const at = row.at || null;
    const atMs = at ? Date.parse(at) : NaN;

    let existing = gk ? byKey.get(`${gk}::${scope}`) : null;
    if (!existing && norm.length >= MIN_PREFIX_LEN && Number.isFinite(atMs)) {
      for (const g of groups) {
        if (g.scope !== scope) continue;
        const gLastMs = g.last_at ? Date.parse(g.last_at) : NaN;
        if (!Number.isFinite(gLastMs) || Math.abs(atMs - gLastMs) > PREFIX_WINDOW_MS) continue;
        if (isPrefixMatch(norm, normalizeQuestion(g.row.text))) {
          existing = g;
          break;
        }
      }
    }

    if (!existing) {
      const lastMs = atMs;
      const grouped = {
        ...entry,
        scope,
        ask_ids: [row.ask_id],
        group_key: gk || null,
        count: 1,
        first_at: at,
        last_at: at,
        archived: Number.isFinite(lastMs) ? (nowMs - lastMs) >= ARCHIVE_DAYS_MS : false,
      };
      if (gk) byKey.set(`${gk}::${scope}`, grouped);
      groups.push(grouped);
    } else {
      mergeIntoGroup(existing, entry, nowMs);
    }
  }

  return groups;
}

function withGroupKey(row) {
  if (!row || typeof row !== 'object') return row;
  const gk = groupKey(row.text);
  if (!gk) return { ...row };
  return { ...row, group_key: gk };
}

function formatList(entries, nowMs = Date.now()) {
  if (entries.length === 0) return '';
  const shown = entries.slice(0, MAX_VIEW_LINES).map((e) => formatAskLine(e.row, nowMs, e));
  if (entries.length > MAX_VIEW_LINES) {
    shown.push(`… ${entries.length - MAX_VIEW_LINES} more`);
  }
  return shown.join('\n');
}

function formatTaipeiTime(atIso) {
  const ts = Date.parse(atIso);
  if (!Number.isFinite(ts)) return '??-?? ??:??';
  const d = new Date(ts + 8 * 3600 * 1000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

function pickLatestReply(askIds, repliesByAskId) {
  let best = null;
  for (const id of askIds) {
    const list = repliesByAskId.get(id);
    if (!list) continue;
    for (const r of list) {
      if (!best) {
        best = r;
        continue;
      }
      const rMs = r.at ? Date.parse(r.at) : NaN;
      const bMs = best.at ? Date.parse(best.at) : NaN;
      if (Number.isFinite(rMs) && Number.isFinite(bMs)) {
        if (rMs > bMs || (rMs === bMs && r.index > best.index)) best = r;
      } else if (Number.isFinite(rMs) && !Number.isFinite(bMs)) {
        best = r;
      } else if (r.index > best.index) {
        best = r;
      }
    }
  }
  return best;
}

const RECENT_MS = 24 * 3600 * 1000;

// An ask from the last 24 h is never an old record: the reply writer may simply not have run yet on this host.
function statusOf(entry, disposed, repliesByAskId, replyCutoffMs, nowMs) {
  const row = entry.row;
  const askIds = entry.ask_ids || [row.ask_id];
  const latestReply = pickLatestReply(askIds, repliesByAskId);
  if (latestReply) return { status: '已答', latestReply };
  if (askIds.some((id) => disposed.has(id))) return { status: '已處置', latestReply: null };
  const askMs = Date.parse(entry.last_at || row.at);
  const recent = Number.isFinite(askMs) && nowMs - askMs < RECENT_MS;
  // With a known first-linked-reply time, anything asked before it can never be linked (older writers stored replies without ask_id), recent or not; the grace only covers a store with no linked reply at all.
  const isOld = replyCutoffMs === null ? !recent : Number.isFinite(askMs) && askMs < replyCutoffMs;
  return { status: isOld ? '舊紀錄' : '未答', latestReply: null };
}

function formatAnswerLine(entry, disposed, repliesByAskId, replyCutoffMs, nowMs) {
  const row = entry.row;
  const { status, latestReply } = statusOf(entry, disposed, repliesByAskId, replyCutoffMs, nowMs);
  const timeStr = formatTaipeiTime(entry.last_at || row.at);
  const summary = (typeof row.text === 'string' ? row.text : '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const countTag = entry.count && entry.count > 1 ? ` ×${entry.count}` : '';
  const answer = latestReply
    ? String(latestReply.text || '').split(/\r?\n/)[0].trim().slice(0, 60)
    : '（尚無答案）';
  return `${status}${countTag} ${timeStr} ${summary} ｜ ${answer}`;
}

function formatAnswersList(entries, disposed, repliesByAskId, replyCutoffMs, nowMs) {
  if (entries.length === 0) return '';
  const shown = entries.slice(0, MAX_VIEW_LINES).map((e) => formatAnswerLine(e, disposed, repliesByAskId, replyCutoffMs, nowMs));
  if (entries.length > MAX_VIEW_LINES) {
    shown.push(`… ${entries.length - MAX_VIEW_LINES} more`);
  }
  return shown.join('\n');
}

function answerRecord(entry, disposed, repliesByAskId, replyCutoffMs, nowMs) {
  const row = entry.row;
  const { status, latestReply } = statusOf(entry, disposed, repliesByAskId, replyCutoffMs, nowMs);
  return {
    status,
    count: entry.count || 1,
    at: entry.last_at || row.at,
    ask: (typeof row.text === 'string' ? row.text : '').replace(/\s+/g, ' ').trim(),
    answer: latestReply ? String(latestReply.text || '') : null,
  };
}

function listOutput(env, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const { asks, disposed, repliesByAskId, replyCutoffMs } = loadState(env);
  const selected = opts.open ? asks.filter((e) => !disposed.has(e.row.ask_id)) : asks;
  const grouped = groupAsks(selected, nowMs);
  if (opts.answers) {
    const shown = opts.open
      ? grouped.filter((e) => statusOf(e, disposed, repliesByAskId, replyCutoffMs, nowMs).status !== '舊紀錄')
      : grouped;
    // Newest first: the 30-line cap must cut the oldest rows, not the ones the operator asked today.
    const newestFirst = [...shown].sort((a, b) => (Date.parse(b.last_at || b.row.at) || 0) - (Date.parse(a.last_at || a.row.at) || 0));
    if (opts.json) return JSON.stringify(newestFirst.map((e) => answerRecord(e, disposed, repliesByAskId, replyCutoffMs, nowMs)));
    return formatAnswersList(newestFirst, disposed, repliesByAskId, replyCutoffMs, nowMs);
  }
  return formatList(grouped, nowMs);
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
    if (!cmd) throw usageError('pm-ask: missing subcommand (close|progress|supersede|list|overdue|where)');
    return [
      'Usage:',
      '  pm-ask.js close <ask_id> --evidence <ref>',
      '  pm-ask.js progress <ask_id> --task <ulid>',
      '  pm-ask.js supersede <old_id> <new_id>',
      '  pm-ask.js list [--open] [--answers]',
      '  pm-ask.js overdue [--hours 24]',
      '  pm-ask.js purge-injected [--drop-prefix <text>]... [--apply]',
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
    let answers = false;
    let json = false;
    for (const arg of rest) {
      if (arg === '--open') openOnly = true;
      else if (arg === '--answers') answers = true;
      else if (arg === '--json') json = true;
      else throw usageError(`pm-ask list: unknown argument ${arg}`);
    }
    if (json && !answers) throw usageError('pm-ask list: --json needs --answers');
    return listOutput(env, { open: openOnly, answers, json, nowMs });
  }

  if (cmd === 'where') {
    const { isEnabled } = require('../hooks/_shared/opt-in');
    const { logFile } = require('../hooks/askpm-log');
    const rows = readRows(env) || [];
    const asks = rows.filter((r) => r.kind === 'ask');
    const last = asks.length > 0 ? asks[asks.length - 1].at : '（無）';
    return [
      `file ${logFile(env)}`,
      `hook_enabled ${isEnabled('askpm-log') ? 'yes' : 'no'}（開法：~/.autopilot/config.json 設 hooks.askpm-log=true，或 AUTOPILOT_HOOK_ASKPM_LOG=1）`,
      `rows ${rows.length} asks ${asks.length} last_ask_at ${asks.length > 0 ? formatTaipeiTime(last) + ' 台北' : last}`,
    ].join('\n');
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

  if (cmd === 'purge-injected') {
    const dropPrefixes = [];
    let apply = false;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === '--drop-prefix') {
        if (i + 1 >= rest.length) throw usageError('pm-ask purge-injected: --drop-prefix requires a value');
        dropPrefixes.push(rest[++i]);
      } else if (arg.startsWith('--drop-prefix=')) {
        dropPrefixes.push(arg.slice('--drop-prefix='.length));
      } else if (arg === '--apply') {
        apply = true;
      } else {
        throw usageError(`pm-ask purge-injected: unknown argument ${arg}`);
      }
    }
    return purgeInjected(env, { dropPrefixes, apply });
  }

  throw usageError(`pm-ask: unknown subcommand ${cmd}`);
}

function planPurge(raw, dropPrefixes) {
  const lines = raw.split('\n');
  const parsed = lines.map((line) => {
    if (!line) return null;
    try { return JSON.parse(line); } catch { return null; }
  });
  const totalRows = lines.filter((l) => l.length > 0).length;

  const voidedAskLines = new Set();
  const voidLineToAskLine = new Map();
  let lastAskLine = -1;
  for (let i = 0; i < parsed.length; i += 1) {
    const r = parsed[i];
    if (!r) continue;
    if (r.kind === 'ask') {
      lastAskLine = i;
    } else if (r.kind === 'void') {
      if (typeof r.ask_id === 'string' && r.ask_id !== '') {
        for (let j = i - 1; j >= 0; j -= 1) {
          if (parsed[j] && parsed[j].kind === 'ask' && parsed[j].ask_id === r.ask_id) {
            voidedAskLines.add(j);
            voidLineToAskLine.set(i, j);
            break;
          }
        }
      } else if (lastAskLine >= 0) {
        voidedAskLines.add(lastAskLine);
        voidLineToAskLine.set(i, lastAskLine);
      }
    }
  }

  const removedAskLines = new Set();
  const removedAskIds = new Set();
  for (let i = 0; i < parsed.length; i += 1) {
    const r = parsed[i];
    if (!r || r.kind !== 'ask') continue;
    const typed = typedText(r.text);
    const dropByPrefix = dropPrefixes.some((p) => typed.startsWith(p));
    if (voidedAskLines.has(i) || isInjected(r.text) || dropByPrefix) {
      removedAskLines.add(i);
      if (typeof r.ask_id === 'string' && r.ask_id !== '') {
        removedAskIds.add(r.ask_id);
      }
    }
  }

  const removedLines = new Set(removedAskLines);
  let inRemovedAsk = false;
  for (let i = 0; i < parsed.length; i += 1) {
    const r = parsed[i];
    if (!r) continue;
    if (r.kind === 'ask') {
      inRemovedAsk = removedAskLines.has(i);
      continue;
    }
    if (r.kind === 'turn') {
      inRemovedAsk = false;
      continue;
    }
    if (typeof r.ask_id === 'string' && r.ask_id !== '') {
      if ((r.kind === 'reply' || r.kind === 'disposition' || r.kind === 'void') && removedAskIds.has(r.ask_id)) {
        removedLines.add(i);
      }
    } else if (r.kind === 'void') {
      const targetAsk = voidLineToAskLine.get(i);
      if (targetAsk !== undefined && removedAskLines.has(targetAsk)) {
        removedLines.add(i);
      }
    } else if (r.kind === 'reply' && inRemovedAsk) {
      removedLines.add(i);
    }
  }

  return { lines, removedLines, removedAsks: removedAskLines.size, totalRows };
}

function purgeInjected(env, { dropPrefixes = [], apply = false } = {}) {
  const file = logFile(env);
  if (!apply) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return 'would remove 0 rows (0 asks) of 0'; }
    const { removedLines, removedAsks, totalRows } = planPurge(raw, dropPrefixes);
    return `would remove ${removedLines.size} rows (${removedAsks} asks) of ${totalRows}`;
  }
  const dir = stateDir(env);
  return withWriteLock(
    { storeDir: dir, lockFile: path.join(dir, 'askpm.jsonl.lock'), name: 'askpm' },
    () => {
      let raw;
      try { raw = fs.readFileSync(file, 'utf8'); } catch { return 'removed 0 rows (0 asks) of 0'; }
      const { lines, removedLines, removedAsks, totalRows } = planPurge(raw, dropPrefixes);
      const bak = `${file}.bak.${Date.now()}`;
      fs.copyFileSync(file, bak);
      const kept = lines.filter((_, idx) => !removedLines.has(idx));
      let out = kept.join('\n');
      if (raw.endsWith('\n') && out.length > 0 && !out.endsWith('\n')) out += '\n';
      const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmp, out, { encoding: 'utf8', mode: fs.statSync(file).mode });
      fs.renameSync(tmp, file);
      return [
        `removed ${removedLines.size} rows (${removedAsks} asks) of ${totalRows}`,
        `backup ${bak}`,
        `restore: cp ${bak} ${file}`,
      ].join('\n');
    },
  );
}

function main() {
  try {
    const fixedNow = Date.parse(process.env.AUTOPILOT_PM_ASK_NOW || '');
    const out = runCommand(process.argv.slice(2), undefined, Number.isFinite(fixedNow) ? fixedNow : undefined);
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
  groupAsks,
  withGroupKey,
  formatAge,
  formatAskLine,
  formatList,
  listOutput,
  overdueOutput,
  runCommand,
};
