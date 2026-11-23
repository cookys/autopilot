#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { incomingMessages } = require('./pm-offline-estimate.js');
const { scanText } = require('./lib/outbound-secret-scan.js');
const { redactText } = require('./lib/personal-data-redact.js');

const DEFAULT_QUOTA = {
  operator: 3,
  lane_result: 3,
  patrol: 1,
  inbox_batch: 1,
  stop_hook: 1,
  task_notification: 1,
};

/**
 * Centralized event classification rules (checked in order; first match wins).
 * Fallback is 'other' (counted, never sampled).
 */
const CLASSIFICATION_RULES = [
  {
    type: 'patrol',
    description: 'Fleet patrol message ([fleet patrol])',
    match: (_entry, text) => /\[fleet patrol\]/i.test(text),
  },
  {
    type: 'inbox_batch',
    description: 'Inbox batch packet ([inbox batch or PM 收件匣...批次包)',
    match: (_entry, text) => /\[inbox batch\b|PM 收件匣[^\n]*批次包/i.test(text),
  },
  {
    type: 'stop_hook',
    description: 'Stop hook feedback message',
    match: (_entry, text) => /\bstop hook\b/i.test(text),
  },
  {
    type: 'task_notification',
    description: 'Task notification (<task-notification>)',
    match: (_entry, text) => /<task-notification>/i.test(text),
  },
  {
    type: 'lane_result',
    description: 'Channel dispatch or task_result',
    match: (_entry, text) =>
      /<channel\b[^>]*\bkind=["']?(?:dispatch|task_result)\b/i.test(text) ||
      /\btask_result\b/i.test(text),
  },
  {
    type: 'operator',
    description: 'Operator prompt (type=user, not channel and not batch)',
    match: (entry, text) =>
      entry?.type === 'user' &&
      !/<channel\s/i.test(text) &&
      !/\[inbox batch\b|PM 收件匣[^\n]*批次包/i.test(text),
  },
];

/**
 * Supplementary Level-2 redaction rules beyond personal-data-redact.js.
 */
const SUPPLEMENTARY_REDACT_RULES = [
  {
    category: 'ssh_user_host',
    pattern: /\b[a-z_][a-z0-9_-]{1,31}@[a-z0-9][a-z0-9.-]{1,62}\.(?:internal|local|lan|corp|home)\b/gi,
    placeholder: '<user>@<host>',
  },
];

function classifyEvent(entry, text) {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.match(entry, text)) return rule.type;
  }
  return 'other';
}

function sliceEvents(session, options = {}) {
  const sinceMs = options.since ? Date.parse(options.since) : -Infinity;
  const messages = incomingMessages(session);
  const events = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (Number.isFinite(sinceMs) && msg.timestamp) {
      const ts = Date.parse(msg.timestamp);
      if (Number.isFinite(ts) && ts < sinceMs) continue;
    }
    const end = messages[i + 1]?.index ?? session.length;
    const entry = session[msg.index];
    const turns = session.slice(msg.index + 1, end);
    const type = classifyEvent(entry, msg.text);
    const id = crypto
      .createHash('sha256')
      .update(`${msg.index}:${msg.timestamp || ''}:${msg.text}`)
      .digest('hex')
      .slice(0, 12);
    events.push({
      id,
      index: msg.index,
      timestamp: msg.timestamp || null,
      type,
      text: msg.text,
      turns,
    });
  }
  return events;
}

function scanLevel1(text, options = {}) {
  if (options.disableLevel1) return [];
  return scanText(String(text ?? ''));
}

function scanLevel2(text) {
  let current = String(text ?? '');
  const byCategory = {};
  let totalHits = 0;

  const base = redactText(current);
  current = base.text;
  for (const hit of base.hits) {
    byCategory[hit.category] = (byCategory[hit.category] || 0) + 1;
    totalHits++;
  }

  for (const rule of SUPPLEMENTARY_REDACT_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    current = current.replace(re, () => {
      byCategory[rule.category] = (byCategory[rule.category] || 0) + 1;
      totalHits++;
      return rule.placeholder;
    });
  }

  return { text: current, hits: totalHits, byCategory };
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

function redactValue(value, stats) {
  if (typeof value === 'string') {
    const res = scanLevel2(value);
    stats.level2Replacements += res.hits;
    for (const [cat, count] of Object.entries(res.byCategory)) {
      stats.level2ByCategory[cat] = (stats.level2ByCategory[cat] || 0) + count;
    }
    return res.text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, stats));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, stats);
    }
    return out;
  }
  return value;
}

/**
 * Run two-level scan on a candidate item (event or prefix) BEFORE sampling.
 * Level 1: if any secret hits, discard the entire item and record counts/categories.
 * Level 2: redact personal identifiers and record replacement counts.
 */
function scanCandidateItem(item, options = {}) {
  const strings = collectStrings(item);
  const level1Categories = {};
  let level1Hits = 0;

  for (const s of strings) {
    const hits = scanLevel1(s, options);
    for (const h of hits) {
      level1Categories[h.category] = (level1Categories[h.category] || 0) + 1;
      level1Hits++;
    }
  }

  if (level1Hits > 0) {
    return {
      passed: false,
      discarded: true,
      level1Hits,
      level1Categories,
      level2Replacements: 0,
      level2ByCategory: {},
      item: null,
    };
  }

  const stats = { level2Replacements: 0, level2ByCategory: {} };
  const redacted = redactValue(item, stats);
  return {
    passed: true,
    discarded: false,
    level1Hits: 0,
    level1Categories: {},
    level2Replacements: stats.level2Replacements,
    level2ByCategory: stats.level2ByCategory,
    item: redacted,
  };
}

function createRng(seed = 1) {
  let a = (Number(seed) >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRng(arr, rng) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Two-level scan all candidate events, then sample by quota using a fixed seed.
 * Aborts with an error naming the insufficient type(s) if any quota cannot be met.
 */
function scanAndSampleEvents(events, quota = DEFAULT_QUOTA, seed = 1, options = {}) {
  const scanSummary = {
    totalCandidates: events.length,
    discardedCount: 0,
    discardedByCategory: {},
    level2Replacements: 0,
    level2ByCategory: {},
  };

  const passedByType = {};
  const candidateCounts = {};
  let otherCount = 0;

  for (const ev of events) {
    if (ev.type === 'other') {
      otherCount++;
      continue;
    }
    candidateCounts[ev.type] = (candidateCounts[ev.type] || 0) + 1;

    const res = scanCandidateItem(ev, options);
    if (!res.passed) {
      scanSummary.discardedCount++;
      for (const [cat, count] of Object.entries(res.level1Categories)) {
        scanSummary.discardedByCategory[cat] = (scanSummary.discardedByCategory[cat] || 0) + count;
      }
      continue;
    }

    scanSummary.level2Replacements += res.level2Replacements;
    for (const [cat, count] of Object.entries(res.level2ByCategory)) {
      scanSummary.level2ByCategory[cat] = (scanSummary.level2ByCategory[cat] || 0) + count;
    }

    if (!passedByType[ev.type]) passedByType[ev.type] = [];
    passedByType[ev.type].push(res.item);
  }

  const insufficient = [];
  for (const [type, needed] of Object.entries(quota)) {
    const available = (passedByType[type] || []).length;
    if (available < needed) {
      insufficient.push(`${type} (need ${needed}, have ${available})`);
    }
  }
  if (insufficient.length > 0) {
    throw new Error(`Insufficient quota for event type(s): ${insufficient.join(', ')}`);
  }

  const rng = createRng(seed);
  const selected = [];
  const selectedCounts = {};

  for (const [type, needed] of Object.entries(quota)) {
    const pool = shuffleWithRng(passedByType[type] || [], rng);
    const picked = pool.slice(0, needed);
    selectedCounts[type] = picked.length;
    selected.push(...picked);
  }

  return {
    selected,
    selectedCounts,
    candidateCounts,
    otherCount,
    scanSummary,
  };
}

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function estimateTurnTokens(entry) {
  const usage = entry?.message?.usage;
  if (!usage || typeof usage !== 'object') return 0;
  return (
    (Number(usage.input_tokens) || 0) +
    (Number(usage.cache_creation_input_tokens) || 0) +
    (Number(usage.cache_read_input_tokens) || 0) +
    (Number(usage.output_tokens) || 0)
  );
}

/**
 * Extract a prefill prefix from turns before `firstSelectedIndex`,
 * starting from an event boundary, accumulating usage tokens up to `level`,
 * and never splitting a tool_use / tool_result pair.
 */
function buildPrefillPrefix(session, firstSelectedIndex, level, incomingIndices = [], options = {}) {
  const limit = Math.max(0, Math.min(firstSelectedIndex, session.length));
  const boundaries = incomingIndices.filter((idx) => idx >= 0 && idx < limit);
  const startIndex = boundaries.length > 0 ? boundaries[0] : 0;

  const pendingToolUseIds = new Set();
  let lastSafeEndIndex = startIndex;
  let lastSafeTokens = 0;
  let runningTokens = 0;

  for (let i = startIndex; i < limit; i++) {
    const entry = session[i];
    const content = entry?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_use' && block.id) {
          pendingToolUseIds.add(block.id);
        } else if (block?.type === 'tool_result' && block.tool_use_id) {
          pendingToolUseIds.delete(block.tool_use_id);
        }
      }
    }

    runningTokens += estimateTurnTokens(entry);

    if (pendingToolUseIds.size === 0) {
      if (runningTokens <= level || lastSafeEndIndex === startIndex) {
        lastSafeEndIndex = i + 1;
        lastSafeTokens = runningTokens;
      }
      if (runningTokens >= level) {
        break;
      }
    }
  }

  const rawTurns = session.slice(startIndex, lastSafeEndIndex);
  const scanRes = scanCandidateItem({ level, turns: rawTurns }, options);
  if (!scanRes.passed) {
    throw new Error(`Prefix for level ${level} failed Level-1 secret scan`);
  }

  return {
    level,
    startIndex,
    endIndex: lastSafeEndIndex,
    estimatedTokens: lastSafeTokens,
    turnCount: scanRes.item.turns.length,
    turns: scanRes.item.turns,
    scanRes,
  };
}

function normalizeParams(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input ?? {};
  const sorted = {};
  for (const key of Object.keys(input).sort()) {
    sorted[key] = input[key];
  }
  return sorted;
}

const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'WebFetch',
  'WebSearch',
  'TodoRead',
]);

function extractToolCallsAndDecision(turns) {
  const resultByToolUseId = new Map();
  for (const turn of turns) {
    const content = turn?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_result' && block.tool_use_id) {
        resultByToolUseId.set(block.tool_use_id, block.content ?? null);
      }
    }
  }

  const toolCalls = [];
  const intents = [];
  let hasAssistantText = false;

  for (const turn of turns) {
    if (turn?.type !== 'assistant') continue;
    const content = turn?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'text' && String(block.text || '').trim()) {
        hasAssistantText = true;
      } else if (block?.type === 'tool_use') {
        const normalizedInput = normalizeParams(block.input);
        const rawResult = resultByToolUseId.has(block.id)
          ? resultByToolUseId.get(block.id)
          : null;
        toolCalls.push({
          id: block.id || null,
          name: block.name,
          normalizedInput,
          rawResult,
        });
        if (!READ_ONLY_TOOLS.has(block.name)) {
          const target =
            normalizedInput.file_path ||
            normalizedInput.path ||
            normalizedInput.command ||
            normalizedInput.url ||
            null;
          intents.push({
            actionCategory: block.name,
            target,
            keyParams: normalizedInput,
          });
        }
      }
    }
  }

  return {
    toolCalls,
    decision: {
      intents,
      replyCategory: intents.length > 0 ? 'tool_action' : hasAssistantText ? 'text_reply' : 'no_reply',
    },
  };
}

function serializeEvent(ev) {
  const { toolCalls, decision } = extractToolCallsAndDecision(ev.turns || []);
  return {
    id: ev.id,
    type: ev.type,
    timestamp: ev.timestamp,
    inputText: ev.text,
    toolCalls,
    decision,
  };
}

function ensureEmptyOutDir(outDir) {
  if (fs.existsSync(outDir)) {
    const entries = fs.readdirSync(outDir);
    if (entries.length > 0) {
      throw new Error(`Output directory is not empty: ${outDir}`);
    }
  } else {
    fs.mkdirSync(outDir, { recursive: true });
  }
}

function writeSliceOutput(outDir, session, sampleResult, options = {}) {
  ensureEmptyOutDir(outDir);
  const eventsDir = path.join(outDir, 'events');
  fs.mkdirSync(eventsDir, { recursive: true });

  const seed = options.seed ?? 1;
  const levels = options.levels ?? [200000, 300000];
  const incomingIndices = incomingMessages(session).map((m) => m.index);
  const firstSelectedIndex =
    sampleResult.selected.length > 0
      ? Math.min(...sampleResult.selected.map((e) => e.index))
      : session.length;

  const files = {};
  const writeJson = (relPath, data) => {
    const content = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(path.join(outDir, relPath), content, 'utf8');
    files[relPath] = sha256Hex(content);
  };

  for (const ev of sampleResult.selected) {
    const relPath = `events/${ev.id}.json`;
    writeJson(relPath, serializeEvent(ev));
  }

  const prefixes = [];
  let prefixLevel2Replacements = 0;
  const prefixLevel2ByCategory = {};

  for (const level of levels) {
    const prefix = buildPrefillPrefix(session, firstSelectedIndex, level, incomingIndices, options);
    prefixLevel2Replacements += prefix.scanRes.level2Replacements;
    for (const [cat, count] of Object.entries(prefix.scanRes.level2ByCategory)) {
      prefixLevel2ByCategory[cat] = (prefixLevel2ByCategory[cat] || 0) + count;
    }
    const relPath = `prefix-${level}.json`;
    writeJson(relPath, {
      level: prefix.level,
      startIndex: prefix.startIndex,
      endIndex: prefix.endIndex,
      estimatedTokens: prefix.estimatedTokens,
      turns: prefix.turns,
    });
    prefixes.push({
      level: prefix.level,
      file: relPath,
      startIndex: prefix.startIndex,
      endIndex: prefix.endIndex,
      estimatedTokens: prefix.estimatedTokens,
      turnCount: prefix.turnCount,
    });
  }

  const scanReport = {
    level1: {
      discardedCount: sampleResult.scanSummary.discardedCount,
      discardedByCategory: sampleResult.scanSummary.discardedByCategory,
    },
    level2: {
      replacements: sampleResult.scanSummary.level2Replacements + prefixLevel2Replacements,
      byCategory: { ...sampleResult.scanSummary.level2ByCategory },
    },
  };
  for (const [cat, count] of Object.entries(prefixLevel2ByCategory)) {
    scanReport.level2.byCategory[cat] = (scanReport.level2.byCategory[cat] || 0) + count;
  }
  writeJson('scan-report.json', scanReport);

  const classificationRulesSha256 = sha256Hex(
    JSON.stringify(CLASSIFICATION_RULES.map((r) => ({ type: r.type, description: r.description })))
  );
  const scanRulesSha256 = sha256Hex(
    JSON.stringify(
      SUPPLEMENTARY_REDACT_RULES.map((r) => ({
        category: r.category,
        pattern: r.pattern.source,
        placeholder: r.placeholder,
      }))
    )
  );
  const scriptSha256 = sha256Hex(fs.readFileSync(__filename, 'utf8'));
  const sortedFiles = {};
  for (const k of Object.keys(files).sort()) {
    sortedFiles[k] = files[k];
  }
  const batchSha256 = sha256Hex(JSON.stringify(sortedFiles));

  const manifest = {
    seed,
    classificationRulesSha256,
    scanRulesSha256,
    scriptSha256,
    files: sortedFiles,
    batchSha256,
    candidateCounts: sampleResult.candidateCounts,
    selectedCounts: sampleResult.selectedCounts,
    otherCount: sampleResult.otherCount,
    discardedCount: sampleResult.scanSummary.discardedCount,
    level2Replacements: scanReport.level2.replacements,
    prefixes,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return { manifest, scanReport };
}

function parseArgs(argv) {
  const args = {
    sessionsDirs: [],
    out: null,
    seed: 1,
    levels: [200000, 300000],
    quota: { ...DEFAULT_QUOTA },
    since: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sessions-dir' && argv[i + 1]) {
      args.sessionsDirs.push(argv[++i]);
    } else if (arg === '--out' && argv[i + 1]) {
      args.out = argv[++i];
    } else if (arg === '--seed' && argv[i + 1]) {
      args.seed = Number(argv[++i]);
    } else if (arg === '--levels' && argv[i + 1]) {
      args.levels = argv[++i].split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
    } else if (arg === '--quota' && argv[i + 1]) {
      const q = {};
      for (const pair of argv[++i].split(',')) {
        const [k, v] = pair.split('=').map((s) => s.trim());
        if (k && Number.isFinite(Number(v))) q[k] = Number(v);
      }
      args.quota = q;
    } else if (arg === '--since' && argv[i + 1]) {
      args.since = argv[++i];
    }
  }
  return args;
}

function loadSessionsFromDirs(dirs) {
  const combined = [];
  for (const dir of dirs) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    for (const file of files) {
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        combined.push(JSON.parse(line));
      }
    }
  }
  return combined;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.out || args.sessionsDirs.length === 0) {
    throw new Error('Usage: pm-replay-slice.js --sessions-dir <dir> --out <dir> [--seed N] [--levels 200000,300000] [--quota ...] [--since ISO]');
  }
  const session = loadSessionsFromDirs(args.sessionsDirs);
  const events = sliceEvents(session, { since: args.since });
  const sampleResult = scanAndSampleEvents(events, args.quota, args.seed);
  writeSliceOutput(args.out, session, sampleResult, { seed: args.seed, levels: args.levels });
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_QUOTA,
  CLASSIFICATION_RULES,
  SUPPLEMENTARY_REDACT_RULES,
  classifyEvent,
  sliceEvents,
  scanLevel1,
  scanLevel2,
  scanCandidateItem,
  scanAndSampleEvents,
  createRng,
  buildPrefillPrefix,
  serializeEvent,
  writeSliceOutput,
  parseArgs,
};
