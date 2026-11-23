#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
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
};
