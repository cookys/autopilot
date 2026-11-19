#!/usr/bin/env node
'use strict';

// fleet-replay.js — offline replay of fleet inbox/sent JSONL messages through:
//   1. scripts/pm-switchboard.js (`classifyItem`) for switchboard rule evaluation
//   2. hooks/fleet-send-work-order-guard.js (`decide`) for PM send work-order guard evaluation
//
// Reads only local JSONL/JSON files and writes to stdout / local --out dir.
// Never makes network or fleet calls. Node built-ins only.
//
// Usage:
//   node scripts/fleet-replay.js --input <file.jsonl> [--mode switchboard|guard]
//                                [--operator <addr>...] [--pm <addr>...] [--member <addr>]
//                                [--tasks <tasks.json>] [--out <dir>] [--human]
//
// Exit codes: 0 ok | 1 runtime error | 2 CLI usage or unreadable input.

const fs = require('fs');
const path = require('path');
const { classifyItem } = require('./pm-switchboard.js');

const SWITCHBOARD_SCHEMA = 'autopilot.fleet-replay.switchboard/1';
const GUARD_SCHEMA = 'autopilot.fleet-replay.guard/1';
const SAMPLE_LIMIT_SWITCHBOARD = 50;
const SAMPLE_LIMIT_GUARD_EACH = 3;
const TOP_FROM_LIMIT = 20;
const ONE_HOUR_MS = 3600 * 1000;
const TASK_LINE_RE = /^\s*(?:[-*]\s*)?(?:task|task[-_]id|fleet[-_]task)\s*[:=：]\s*(\S+)\s*$/im;

function usageError(message) {
  const err = new Error(`fleet-replay: ${message}`);
  err.exitCode = 2;
  return err;
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/fleet-replay.js --input <file.jsonl> [--mode switchboard|guard]',
    '                               [--operator <addr>...] [--pm <addr>...] [--member <addr>]',
    '                               [--tasks <tasks.json>] [--out <dir>] [--human]',
    '',
    'Options:',
    '  --input <file.jsonl>    Local JSONL file of fleet messages (required)',
    '  --mode <mode>           switchboard (default) or guard',
    '  --operator <addr>       Operator sender address or * glob (repeatable)',
    '  --pm <addr>             Extra PM sender address or * glob for guard mode (repeatable)',
    '  --member <addr>         PM handle for waiting_on / PM sender matching (default: pm--claude)',
    '  --tasks <tasks.json>    Optional task metadata JSON for task_result auto-accept checks',
    '  --out <dir>             Directory for deterministic sample JSONL files',
    '  --human                 Print short zh-TW table/summary instead of JSON',
    '  -h, --help              Show this help and exit',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    help: false,
    input: null,
    mode: 'switchboard',
    operators: [],
    pms: [],
    member: 'pm--claude',
    tasksFile: null,
    outDir: null,
    human: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      return opts;
    }
    if (arg === '--human') {
      opts.human = true;
    } else if (arg === '--input') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--input requires a file path');
      opts.input = path.resolve(argv[++i]);
    } else if (arg.startsWith('--input=')) {
      const val = arg.slice('--input='.length);
      if (!val) throw usageError('--input requires a file path');
      opts.input = path.resolve(val);
    } else if (arg === '--mode') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--mode requires switchboard or guard');
      opts.mode = argv[++i].trim().toLowerCase();
    } else if (arg.startsWith('--mode=')) {
      opts.mode = arg.slice('--mode='.length).trim().toLowerCase();
    } else if (arg === '--operator') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--operator requires an address pattern');
      opts.operators.push(argv[++i].trim());
    } else if (arg.startsWith('--operator=')) {
      const val = arg.slice('--operator='.length).trim();
      if (!val) throw usageError('--operator requires an address pattern');
      opts.operators.push(val);
    } else if (arg === '--pm') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--pm requires an address pattern');
      opts.pms.push(argv[++i].trim());
    } else if (arg.startsWith('--pm=')) {
      const val = arg.slice('--pm='.length).trim();
      if (!val) throw usageError('--pm requires an address pattern');
      opts.pms.push(val);
    } else if (arg === '--member') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--member requires a handle');
      opts.member = argv[++i].trim();
    } else if (arg.startsWith('--member=')) {
      const val = arg.slice('--member='.length).trim();
      if (!val) throw usageError('--member requires a handle');
      opts.member = val;
    } else if (arg === '--tasks') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--tasks requires a file path');
      opts.tasksFile = path.resolve(argv[++i]);
    } else if (arg.startsWith('--tasks=')) {
      const val = arg.slice('--tasks='.length);
      if (!val) throw usageError('--tasks requires a file path');
      opts.tasksFile = path.resolve(val);
    } else if (arg === '--out') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--out requires a directory path');
      opts.outDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--out=')) {
      const val = arg.slice('--out='.length);
      if (!val) throw usageError('--out requires a directory path');
      opts.outDir = path.resolve(val);
    } else {
      throw usageError(`unknown argument "${arg}"`);
    }
  }

  if (!opts.input) {
    throw usageError('missing required --input <file.jsonl>');
  }
  if (opts.mode !== 'switchboard' && opts.mode !== 'guard') {
    throw usageError(`invalid --mode "${opts.mode}" (expected switchboard or guard)`);
  }
  return opts;
}

function parseJsonl(rawText) {
  const lines = String(rawText || '').split(/\r?\n/);
  const messages = [];
  let badLines = 0;

  for (const line of lines) {
    if (line.trim() === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      badLines += 1;
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      badLines += 1;
      continue;
    }
    messages.push(parsed);
  }

  return { messages, bad_lines: badLines };
}

function compileAddressMatcher(pattern) {
  const pat = String(pattern || '').trim().toLowerCase();
  if (!pat) return () => false;
  if (pat.includes('*') || pat.includes('?')) {
    const escaped = pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const re = new RegExp(`^${escaped}$`);
    return (addr) => re.test(addr);
  }
  return (addr) => addr === pat;
}

function buildMatchers(patterns) {
  return (patterns || []).filter(Boolean).map(compileAddressMatcher);
}

function matchesAny(addr, matchers) {
  const low = String(addr || '').trim().toLowerCase();
  if (!low || matchers.length === 0) return false;
  return matchers.some((fn) => fn(low));
}

function isPmSender(from, opts = {}) {
  const raw = String(from || '').trim().toLowerCase();
  if (!raw) return false;
  if (opts.pmMatchers && matchesAny(raw, opts.pmMatchers)) return true;
  const noSess = raw.replace(/@[^/]*$/, '');
  const tail = noSess.includes('/') ? noSess.slice(noSess.lastIndexOf('/') + 1) : noSess;
  if (tail === 'pm' || tail.startsWith('pm--')) return true;
  const member = String(opts.member || '').trim().toLowerCase();
  if (member && (raw === member || noSess === member || tail === member)) return true;
  return false;
}

function normalizeTaskRecord(raw, fallbackTaskId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const taskObj = (raw.task && typeof raw.task === 'object' && !Array.isArray(raw.task))
    ? raw.task
    : raw;
  const taskId = typeof taskObj.task_id === 'string' && taskObj.task_id.trim() !== ''
    ? taskObj.task_id.trim()
    : (typeof taskObj.id === 'string' && taskObj.id.trim() !== '' ? taskObj.id.trim() : String(fallbackTaskId || '').trim());
  const assignee = typeof taskObj.assignee === 'string' && taskObj.assignee.trim() !== ''
    ? taskObj.assignee.trim()
    : (typeof taskObj.to === 'string' && taskObj.to.trim() !== '' ? taskObj.to.trim() : '');
  const rawAttempt = taskObj.attempt !== undefined && taskObj.attempt !== null
    ? taskObj.attempt
    : taskObj.generation;
  const parsedAttempt = rawAttempt !== undefined && rawAttempt !== null && String(rawAttempt).trim() !== ''
    ? Number(rawAttempt)
    : null;
  const attempt = Number.isInteger(parsedAttempt) && parsedAttempt > 0 ? parsedAttempt : null;
  const dispatchedAt = typeof taskObj.dispatched_at === 'string' && taskObj.dispatched_at.trim() !== ''
    ? taskObj.dispatched_at.trim()
    : (typeof taskObj.created_at === 'string' && taskObj.created_at.trim() !== '' ? taskObj.created_at.trim() : '');
  const acceptance = Array.isArray(taskObj.acceptance)
    ? taskObj.acceptance.map((item) => String(item))
    : [];
  const repo = typeof taskObj.repo === 'string' && taskObj.repo.trim() !== ''
    ? taskObj.repo.trim()
    : undefined;

  const normalized = {
    task_id: taskId,
    assignee,
    attempt,
    dispatched_at: dispatchedAt,
    acceptance,
  };
  if (repo) normalized.repo = repo;
  return normalized;
}

function loadTasksStore(tasksFile) {
  if (!tasksFile) return null;
  let raw;
  try {
    raw = fs.readFileSync(tasksFile, 'utf8');
  } catch (err) {
    throw usageError(`cannot read --tasks file ${tasksFile}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw usageError(`invalid JSON in --tasks file ${tasksFile}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw usageError(`--tasks file ${tasksFile} must contain a JSON object or array`);
  }

  const map = new Map();
  const addCollection = (col) => {
    if (!col || typeof col !== 'object') return;
    if (Array.isArray(col)) {
      for (const row of col) {
        if (!row || typeof row !== 'object') continue;
        const id = typeof row.task_id === 'string' ? row.task_id.trim() : (typeof row.id === 'string' ? row.id.trim() : '');
        if (id) map.set(id, normalizeTaskRecord(row, id));
      }
      return;
    }
    if (col.tasks && typeof col.tasks === 'object') {
      addCollection(col.tasks);
    }
    for (const [k, v] of Object.entries(col)) {
      if (k === 'tasks') continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        map.set(k, normalizeTaskRecord(v, k));
      }
    }
  };
  addCollection(parsed);
  return map;
}

function extractBody(msg) {
  if (msg && typeof msg.body === 'string') return msg.body;
  if (msg && typeof msg.content === 'string') return msg.content;
  return '';
}

function extractTaskIdFromBody(body) {
  const m = String(body || '').match(TASK_LINE_RE);
  return m && m[1] ? m[1].trim() : '';
}

function firstString(obj, keys) {
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k].trim() !== '') return obj[k].trim();
  }
  return '';
}

// Real fleet CLI inbox lines carry id / received_ms and may carry object-valued
// disposition / reply_to; fold them into the legacy message_id / seen_at / string shape.
function normalizeInboxMessage(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const out = { ...msg };
  if (out.message_id == null && out.id != null) out.message_id = out.id;
  if (typeof msg.received_ms === 'number' && Number.isFinite(msg.received_ms)) {
    out.seen_at = msg.received_ms;
  }
  const d = msg.disposition;
  if (d && typeof d === 'object') {
    out.disposition = firstString(d, ['state', 'disposition', 'result', 'status', 'kind', 'value', 'name']);
  }
  const r = msg.reply_to;
  if (r && typeof r === 'object') {
    out.reply_to = firstString(r, ['id', 'message_id', 'ref']);
  }
  return out;
}

function mapMessageToSwitchboardItem(msg, isOperator = false) {
  const body = extractBody(msg);
  const from = msg && typeof msg.from === 'string' ? msg.from : '';
  const messageId = msg && msg.message_id != null ? String(msg.message_id) : '';
  const kind = msg && typeof msg.kind === 'string' ? msg.kind : '';

  const item = {
    message_id: messageId,
    from,
    kind,
    content: body,
    fyi: Boolean(msg && msg.fyi === true),
  };

  if (msg && typeof msg.category === 'string' && msg.category.trim() !== '') {
    item.category = msg.category.trim();
  } else if (isOperator) {
    item.category = 'operator';
  }

  for (const key of ['status', 'waiting_on', 'repo', 'lane', 'commit', 'verify']) {
    if (msg && typeof msg[key] === 'string' && msg[key].trim() !== '') {
      item[key] = msg[key].trim();
    }
  }
  if (msg && msg.attempt !== undefined && msg.attempt !== null) {
    item.attempt = msg.attempt;
  }

  if (msg && typeof msg.task_id === 'string' && msg.task_id.trim() !== '') {
    item.task_id = msg.task_id.trim();
  } else {
    const fromBody = extractTaskIdFromBody(body);
    if (fromBody) item.task_id = fromBody;
  }

  return item;
}

function classOfDecision(decision) {
  if (decision && decision.isResidue) return 'residue';
  if (decision && decision.disposition === 'done') return 'auto_accept';
  if (decision && decision.disposition === 'no_action') return 'no_action';
  return 'needs_decision';
}

function parseTimestampMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw !== 'string' || raw.trim() === '') return NaN;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(trimmed);
}

function computeWakesPerHour(entries) {
  const hourBuckets = new Map();
  let invalidSeenAt = 0;

  for (const entry of entries) {
    const ts = parseTimestampMs(entry.seen_at);
    if (!Number.isFinite(ts)) {
      invalidSeenAt += 1;
      continue;
    }
    const hourEpoch = Math.floor(ts / ONE_HOUR_MS);
    const isWakeClass = entry.cls === 'needs_decision' || entry.cls === 'residue';
    const prev = hourBuckets.get(hourEpoch) || false;
    hourBuckets.set(hourEpoch, prev || isWakeClass);
  }

  if (hourBuckets.size === 0) {
    return {
      span_hours: 0,
      wake_hours: 0,
      mean: 0,
      max: 0,
      invalid_seen_at: invalidSeenAt,
      first_hour_utc: null,
      last_hour_utc: null,
    };
  }

  let minHour = Infinity;
  let maxHour = -Infinity;
  let wakeHours = 0;
  for (const [h, woke] of hourBuckets.entries()) {
    if (h < minHour) minHour = h;
    if (h > maxHour) maxHour = h;
    if (woke) wakeHours += 1;
  }

  const spanHours = (maxHour - minHour) + 1;
  const mean = Number((wakeHours / spanHours).toFixed(6));
  const max = wakeHours > 0 ? 1 : 0;

  return {
    span_hours: spanHours,
    wake_hours: wakeHours,
    mean,
    max,
    invalid_seen_at: invalidSeenAt,
    first_hour_utc: new Date(minHour * ONE_HOUR_MS).toISOString(),
    last_hour_utc: new Date(maxHour * ONE_HOUR_MS).toISOString(),
  };
}

function deterministicSample(records, limit) {
  const indexed = records.map((rec, idx) => ({ rec, idx }));
  indexed.sort((a, b) => {
    const idA = String(a.rec.message_id || '');
    const idB = String(b.rec.message_id || '');
    if (idA < idB) return -1;
    if (idA > idB) return 1;
    return a.idx - b.idx;
  });
  if (indexed.length <= limit) {
    return indexed.map((x) => x.rec);
  }
  const out = [];
  for (let i = 0; i < limit; i += 1) {
    const pick = Math.floor((i * indexed.length) / limit);
    out.push(indexed[pick].rec);
  }
  return out;
}

function verdictForRatio(ratioAll) {
  if (ratioAll <= 0.10) return 'keep_rules';
  if (ratioAll > 0.15) return 'add_sonnet_fallback';
  return 'borderline';
}

function emptyClassBucket() {
  return {
    total: 0,
    auto_accept: 0,
    needs_decision: 0,
    no_action: 0,
    residue: 0,
  };
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
}

function buildResidueBreakdown(residueRecords) {
  const groups = new Map();
  const byKind = {};
  for (const r of residueRecords) {
    const kind = r.kind || '(empty)';
    const from = r.from || '(empty)';
    const key = `${kind}\u0000${from}`;
    groups.set(key, (groups.get(key) || 0) + 1);
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  const sorted = [...groups.entries()]
    .map(([key, count]) => {
      const [kind, from] = key.split('\u0000');
      return { kind, from, count };
    })
    .sort((a, b) => b.count - a.count
      || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
      || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const top = sorted.slice(0, 10);
  const topSum = top.reduce((n, g) => n + g.count, 0);
  return {
    total: residueRecords.length,
    top_groups: top,
    other_count: residueRecords.length - topSum,
    by_kind: byKind,
  };
}

function replaySwitchboard(messages, opts = {}) {
  messages = messages.map(normalizeInboxMessage);
  const operatorPatterns = Array.isArray(opts.operators) ? opts.operators.filter(Boolean) : [];
  const operatorMatchers = buildMatchers(operatorPatterns);
  const member = opts.member || 'pm--claude';
  const tasksMap = opts.tasksMap || loadTasksStore(opts.tasksFile);
  const classifyFn = typeof opts.classifyFn === 'function' ? opts.classifyFn : classifyItem;
  const badLines = Number.isInteger(opts.bad_lines) ? opts.bad_lines : 0;

  const counts = emptyClassBucket();
  const byKindMap = new Map();
  const byFromMap = new Map();
  const byRule = {};
  const residueRecords = [];
  const noActionRecords = [];
  const wakeEntries = [];
  let operatorMessages = 0;

  for (const msg of messages) {
    const rawFrom = msg && typeof msg.from === 'string' ? msg.from : '';
    const isOperator = matchesAny(rawFrom, operatorMatchers);
    if (isOperator) operatorMessages += 1;

    const item = mapMessageToSwitchboardItem(msg, isOperator);
    const hasInlineTask = Boolean(msg && msg.task && typeof msg.task === 'object' && !Array.isArray(msg.task));
    const canShowTask = Boolean(tasksMap || typeof opts.getTask === 'function' || hasInlineTask);

    const decision = classifyFn(item, {
      member,
      canAccept: opts.canAccept !== false,
      canShowTask,
      autoAccept: opts.autoAccept !== false,
      getTask: (taskId) => {
        if (typeof opts.getTask === 'function') {
          const got = opts.getTask(taskId);
          if (got) return got;
        }
        if (tasksMap && tasksMap.has(taskId)) return tasksMap.get(taskId);
        if (hasInlineTask) return normalizeTaskRecord(msg.task, taskId);
        return null;
      },
      ...(opts.resultRuleOpts ? { resultRuleOpts: opts.resultRuleOpts } : {}),
    });

    const cls = classOfDecision(decision);
    counts.total += 1;
    counts[cls] += 1;

    const ruleName = (decision && typeof decision.rule === 'string' && decision.rule) || 'unknown';
    byRule[ruleName] = (byRule[ruleName] || 0) + 1;

    const kindKey = item.kind || '(empty)';
    if (!byKindMap.has(kindKey)) byKindMap.set(kindKey, emptyClassBucket());
    const kb = byKindMap.get(kindKey);
    kb.total += 1;
    kb[cls] += 1;

    const fromKey = rawFrom || '(empty)';
    if (!byFromMap.has(fromKey)) byFromMap.set(fromKey, emptyClassBucket());
    const fb = byFromMap.get(fromKey);
    fb.total += 1;
    fb[cls] += 1;

    wakeEntries.push({ seen_at: msg ? msg.seen_at : null, cls });

    if (cls === 'residue' || cls === 'no_action') {
      const sampleRow = {
        message_id: item.message_id,
        kind: item.kind,
        from: item.from,
        body120: item.content.slice(0, 120),
      };
      if (cls === 'residue') residueRecords.push(sampleRow);
      else noActionRecords.push(sampleRow);
    }
  }

  const totalMessages = counts.total;
  const nonOperatorMessages = Math.max(0, totalMessages - operatorMessages);
  const ratioAll = totalMessages === 0 ? 0 : Number((counts.residue / totalMessages).toFixed(6));
  const ratioNonOp = nonOperatorMessages === 0 ? 0 : Number((counts.residue / nonOperatorMessages).toFixed(6));

  const byKindSorted = [...byKindMap.entries()]
    .sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const byKind = Object.fromEntries(byKindSorted);

  const byFromTop20 = [...byFromMap.entries()]
    .sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, TOP_FROM_LIMIT)
    .map(([from, bucket]) => ({ from, ...bucket }));

  const wakesPerHour = computeWakesPerHour(wakeEntries);
  const verdict = verdictForRatio(ratioAll);
  const pctStr = `${(ratioAll * 100).toFixed(2)}%`;

  let samplesInfo = null;
  if (opts.outDir) {
    const outDir = path.resolve(opts.outDir);
    const residueSample = deterministicSample(residueRecords, SAMPLE_LIMIT_SWITCHBOARD);
    const noActionSample = deterministicSample(noActionRecords, SAMPLE_LIMIT_SWITCHBOARD);
    const residueFile = path.join(outDir, 'residue-sample.jsonl');
    const noActionFile = path.join(outDir, 'no-action-sample.jsonl');
    writeJsonl(residueFile, residueSample);
    writeJsonl(noActionFile, noActionSample);
    samplesInfo = {
      dir: outDir,
      residue_file: residueFile,
      residue_count: residueSample.length,
      no_action_file: noActionFile,
      no_action_count: noActionSample.length,
    };
  }

  return {
    schema: SWITCHBOARD_SCHEMA,
    mode: 'switchboard',
    total_messages: totalMessages,
    bad_lines: badLines,
    operator_patterns: operatorPatterns,
    operator_messages: operatorMessages,
    non_operator_messages: nonOperatorMessages,
    operator_filter_note: operatorPatterns.length === 0
      ? 'none (--operator not specified; non_operator_messages equals total_messages)'
      : `matched ${operatorMessages} operator message(s) across ${operatorPatterns.length} pattern(s)`,
    counts: {
      auto_accept: counts.auto_accept,
      needs_decision: counts.needs_decision,
      no_action: counts.no_action,
      residue: counts.residue,
      needs_decision_incl_residue: counts.needs_decision + counts.residue,
    },
    residue_ratio: {
      all: ratioAll,
      non_operator: ratioNonOp,
    },
    by_kind: byKind,
    by_from_top20: byFromTop20,
    by_rule: byRule,
    wakes_per_hour: wakesPerHour,
    residue_breakdown: buildResidueBreakdown(residueRecords),
    verdict,
    verdict_line: `verdict=${verdict} residue_ratio_all=${pctStr} (<=10% keep_rules, >15% add_sonnet_fallback, else borderline)`,
    human_check_note: 'Swallowed real decision requests cannot be detected by rules alone; human or engine review of no-action-sample.jsonl and residue-sample.jsonl is required.',
    samples: samplesInfo,
  };
}

function loadGuardDecide() {
  const hookPath = path.resolve(__dirname, '..', 'hooks', 'fleet-send-work-order-guard.js');
  if (!fs.existsSync(hookPath)) {
    throw usageError(`work-order guard hook not found at ${hookPath}`);
  }
  return require(hookPath).decide;
}

function buildGuardSendInput(msg) {
  const body = extractBody(msg);
  const to = msg && typeof msg.to === 'string'
    ? msg.to
    : (msg && typeof msg.recipient === 'string'
      ? msg.recipient
      : (msg && typeof msg.target === 'string' ? msg.target : ''));
  return {
    tool_name: 'mcp__fleet__send',
    tool_input: {
      content: body,
      fyi: Boolean(msg && msg.fyi === true),
      to,
    },
  };
}

function renderGuardReviewMarkdown(denySample, allowSample) {
  const lines = [
    '# Guard 誤殺人工標記樣本（Misfire judgement is human）',
    '',
    '請人工審閱以下 `deny`（疑似派工阻擋）與 `allow`（放行）抽樣訊息，勾選是否誤殺（misfire）：',
    '- `deny` 樣本若其實是純通知／非派工，請標記 `[x] 誤殺 (false_positive)`。',
    '- `allow` 樣本若其實是偷偷派工，請標記 `[x] 漏放 (false_negative)`。',
    '',
  ];

  const appendGroup = (title, rows, promptLabel) => {
    lines.push(`## ${title}（${rows.length} 筆）`, '');
    if (rows.length === 0) {
      lines.push('（無樣本）', '');
      return;
    }
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      lines.push(
        `### ${i + 1}. \`${r.message_id || '(no-id)'}\` — decision=${r.decision}`,
        `- 判定標記：\`[ ] 正常 (ok)\`  \`[ ] ${promptLabel}\``,
        `- 阻擋原因：${r.reason || '（放行，無阻擋原因）'}`,
        `- 內容前 120 字：\`${String(r.body120 || '').replace(/[\r\n]+/g, ' ').replace(/`/g, "'")}\``,
        '- 備註：',
        '',
      );
    }
  };

  appendGroup('Deny 抽樣', denySample, '誤殺 (false_positive)');
  appendGroup('Allow 抽樣', allowSample, '漏放 (false_negative)');
  return `${lines.join('\n')}\n`;
}

function replayGuard(messages, opts = {}) {
  messages = messages.map(normalizeInboxMessage);
  const decideFn = typeof opts.decideFn === 'function' ? opts.decideFn : loadGuardDecide();
  const pmMatchers = buildMatchers(opts.pms || []);
  const member = opts.member || 'pm--claude';
  const badLines = Number.isInteger(opts.bad_lines) ? opts.bad_lines : 0;

  let evaluated = 0;
  let skipped = 0;
  const denyRecords = [];
  const allowRecords = [];
  const denyByReason = {};

  for (const msg of messages) {
    const kind = msg && typeof msg.kind === 'string' ? msg.kind.trim().toLowerCase() : '';
    const from = msg && typeof msg.from === 'string' ? msg.from : '';
    if ((kind !== 'chat' && kind !== 'dispatch') || !isPmSender(from, { pmMatchers, member })) {
      skipped += 1;
      continue;
    }

    evaluated += 1;
    const hookInput = buildGuardSendInput(msg);
    // Pass clean env so host AUTOPILOT_* off-knobs cannot disable offline rule evaluation.
    const res = decideFn(hookInput, {});
    const messageId = msg && msg.message_id != null ? String(msg.message_id) : '';
    const body120 = hookInput.tool_input.content.slice(0, 120);

    if (res && res.hookSpecificOutput && res.hookSpecificOutput.permissionDecision === 'deny') {
      const reason = String(res.hookSpecificOutput.permissionDecisionReason || 'denied');
      denyByReason[reason] = (denyByReason[reason] || 0) + 1;
      denyRecords.push({
        message_id: messageId,
        decision: 'deny',
        reason,
        body120,
      });
    } else {
      allowRecords.push({
        message_id: messageId,
        decision: 'allow',
        reason: null,
        body120,
      });
    }
  }

  let samplesInfo = null;
  if (opts.outDir) {
    const outDir = path.resolve(opts.outDir);
    const denySample = deterministicSample(denyRecords, SAMPLE_LIMIT_GUARD_EACH);
    const allowSample = deterministicSample(allowRecords, SAMPLE_LIMIT_GUARD_EACH);
    const sampleFile = path.join(outDir, 'guard-sample.jsonl');
    const reviewFile = path.join(outDir, 'guard-sample-review.md');
    writeJsonl(sampleFile, [...denySample, ...allowSample]);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(reviewFile, renderGuardReviewMarkdown(denySample, allowSample), 'utf8');
    samplesInfo = {
      dir: outDir,
      sample_file: sampleFile,
      review_file: reviewFile,
      deny_count: denySample.length,
      allow_count: allowSample.length,
    };
  }

  return {
    schema: GUARD_SCHEMA,
    mode: 'guard',
    total_messages: messages.length,
    bad_lines: badLines,
    evaluated,
    skipped,
    allow_count: allowRecords.length,
    deny_count: denyRecords.length,
    deny_by_reason: denyByReason,
    human_judgement_note: 'Misfire judgement is human: inspect guard-sample.jsonl and mark guard-sample-review.md for false positives/negatives.',
    samples: samplesInfo,
  };
}

function formatHumanSwitchboard(report) {
  const pct = (n) => `${(n * 100).toFixed(2)}%`;
  const opText = report.operator_patterns.length === 0
    ? '無（未指定 --operator，non_operator 等同全體）'
    : `${report.operator_patterns.join(', ')}（命中 ${report.operator_messages} 筆）`;

  const lines = [
    '=== Fleet Switchboard 離線重播報告 ===',
    `總有效訊息：${report.total_messages} | 壞行 (bad_lines)：${report.bad_lines}`,
    `操作員地址篩選：${opText}`,
    '',
    '| 分類 | 筆數 | 佔全體 |',
    '|---|---:|---:|',
    `| 自動驗收 (auto_accept) | ${report.counts.auto_accept} | ${pct(report.total_messages ? report.counts.auto_accept / report.total_messages : 0)} |`,
    `| 待裁 (needs_decision) | ${report.counts.needs_decision} | ${pct(report.total_messages ? report.counts.needs_decision / report.total_messages : 0)} |`,
    `| 不需處理 (no_action) | ${report.counts.no_action} | ${pct(report.total_messages ? report.counts.no_action / report.total_messages : 0)} |`,
    `| 殘餘 (residue) | ${report.counts.residue} | ${pct(report.residue_ratio.all)} |`,
    `| 待裁含殘餘 (needs_decision_incl_residue) | ${report.counts.needs_decision_incl_residue} | ${pct(report.total_messages ? report.counts.needs_decision_incl_residue / report.total_messages : 0)} |`,
    '',
    `殘餘率（全體）：${pct(report.residue_ratio.all)} (${report.counts.residue}/${report.total_messages})`,
    `殘餘率（非操作員）：${pct(report.residue_ratio.non_operator)} (${report.counts.residue}/${report.non_operator_messages})`,
    `每小時喚醒：span=${report.wakes_per_hour.span_hours}h | wake_hours=${report.wakes_per_hour.wake_hours} | mean=${report.wakes_per_hour.mean}/h | max=${report.wakes_per_hour.max}/h`,
    '',
    '依 kind 統計：',
    '| kind | total | auto_accept | needs_decision | no_action | residue |',
    '|---|---:|---:|---:|---:|---:|',
  ];

  for (const [k, b] of Object.entries(report.by_kind)) {
    lines.push(`| ${k} | ${b.total} | ${b.auto_accept} | ${b.needs_decision} | ${b.no_action} | ${b.residue} |`);
  }

  lines.push('', '依 from 前 20 名：', '| from | total | auto_accept | needs_decision | no_action | residue |', '|---|---:|---:|---:|---:|---:|');
  for (const row of report.by_from_top20) {
    lines.push(`| ${row.from} | ${row.total} | ${row.auto_accept} | ${row.needs_decision} | ${row.no_action} | ${row.residue} |`);
  }

  const rb = report.residue_breakdown;
  if (rb) {
    lines.push('', `殘餘分組（kind, from）前 10 名，共 ${rb.total} 筆（其餘 ${rb.other_count}）：`, '| kind | from | count |', '|---|---|---:|');
    for (const g of rb.top_groups) lines.push(`| ${g.kind} | ${g.from} | ${g.count} |`);
    lines.push('', `殘餘依 kind：${Object.entries(rb.by_kind).map(([k, n]) => `${k}=${n}`).join(' ') || '(none)'}`);
  }

  lines.push(
    '',
    `切換判定：${report.verdict_line}`,
    '提醒：是否有真實待裁決請求被誤判為不需處理而吞掉，仍需人工或引擎抽檢樣本檔（no-action-sample.jsonl / residue-sample.jsonl）。',
  );

  return lines.join('\n');
}

function formatHumanGuard(report) {
  const lines = [
    '=== Fleet Work-Order Guard 離線重播報告 ===',
    `總有效訊息：${report.total_messages} | 壞行 (bad_lines)：${report.bad_lines}`,
    `受測 PM chat/dispatch：${report.evaluated} | 略過：${report.skipped}`,
    `放行 (allow)：${report.allow_count} | 阻擋 (deny)：${report.deny_count}`,
    '',
    '依阻擋原因統計：',
  ];
  const entries = Object.entries(report.deny_by_reason);
  if (entries.length === 0) {
    lines.push('  （無阻擋）');
  } else {
    for (const [reason, count] of entries) {
      lines.push(`  - ${count} 筆：${reason}`);
    }
  }
  lines.push('', '人工誤殺判斷：Misfire judgement is human — 請檢視 guard-sample.jsonl 與 guard-sample-review.md 並標記誤殺/漏放。');
  return lines.join('\n');
}

function runCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    return usageText();
  }

  let raw;
  try {
    raw = fs.readFileSync(opts.input, 'utf8');
  } catch (err) {
    throw usageError(`cannot read --input file ${opts.input}: ${err.message}`);
  }

  const parsed = parseJsonl(raw);
  const report = opts.mode === 'guard'
    ? replayGuard(parsed.messages, {
      bad_lines: parsed.bad_lines,
      pms: opts.pms,
      member: opts.member,
      outDir: opts.outDir,
    })
    : replaySwitchboard(parsed.messages, {
      bad_lines: parsed.bad_lines,
      operators: opts.operators,
      member: opts.member,
      tasksFile: opts.tasksFile,
      outDir: opts.outDir,
    });

  if (opts.human) {
    return opts.mode === 'guard' ? formatHumanGuard(report) : formatHumanSwitchboard(report);
  }
  return JSON.stringify(report, null, 2);
}

function main() {
  try {
    const out = runCli(process.argv.slice(2));
    if (out) process.stdout.write(`${out}\n`);
    process.exit(0);
  } catch (err) {
    const code = err && Number.isInteger(err.exitCode) ? err.exitCode : 1;
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(code);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  SWITCHBOARD_SCHEMA,
  GUARD_SCHEMA,
  SAMPLE_LIMIT_SWITCHBOARD,
  SAMPLE_LIMIT_GUARD_EACH,
  parseArgs,
  parseJsonl,
  compileAddressMatcher,
  isPmSender,
  mapMessageToSwitchboardItem,
  normalizeInboxMessage,
  classOfDecision,
  computeWakesPerHour,
  deterministicSample,
  verdictForRatio,
  buildGuardSendInput,
  replaySwitchboard,
  replayGuard,
  formatHumanSwitchboard,
  formatHumanGuard,
  runCli,
};
