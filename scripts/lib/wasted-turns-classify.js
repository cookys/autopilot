'use strict';

/**
 * Shared classification and cost-projection logic for wasted-turns-report.js.
 * Node >= 20.10 built-ins only.
 * Reuses hooks/cost-tracker-lib.js for assistant turn usage deduplication.
 */

const fs = require('fs');
const { StringDecoder } = require('string_decoder');
const { parseAssistantTurns } = require('../../hooks/cost-tracker-lib.js');

const DEFAULT_HIT_FACTOR = 0.10;
const DEFAULT_MISS_FACTOR = 2.0;
const MAX_LINE_BYTES = 64 * 1024 * 1024; // 64 MB
const DEFAULT_MAX_CHUNK = 64 * 1024; // 64 KiB

/**
 * Format epoch ms (or Date) as Taipei time (UTC+8) ISO-8601 string, never trailing Z.
 */
function toTaipeiIso(msOrDate) {
  const ms = msOrDate instanceof Date ? msOrDate.getTime() : Number(msOrDate);
  if (!Number.isFinite(ms)) return null;
  const taipeiMs = ms + 8 * 3600 * 1000;
  const d = new Date(taipeiMs);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`
  );
}

/**
 * Normalize command text: trim leading/trailing whitespace and collapse
 * consecutive whitespace into a single space.
 */
function normalizeCommand(cmd) {
  if (typeof cmd !== 'string') return '';
  return cmd.trim().replace(/\s+/g, ' ');
}

/**
 * Extract tool_input command string (for Bash/shell tools) or stable serialized input.
 */
function extractCommandText(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (typeof toolInput.command === 'string') return toolInput.command;
  if (typeof toolInput.cmd === 'string') return toolInput.cmd;
  return JSON.stringify(toolInput);
}

/**
 * Check if a Bash command is a help_lookup:
 * last argument is --help, -h, or help, or command is man.
 */
function isHelpLookup(toolName, cmdText) {
  if (toolName !== 'Bash' && toolName !== 'bash' && toolName !== 'shell') return false;
  const norm = normalizeCommand(cmdText);
  if (!norm) return false;
  const tokens = norm.split(' ');
  if (tokens[0] === 'man') return true;
  const last = tokens[tokens.length - 1];
  return last === '--help' || last === '-h' || last === 'help';
}

/**
 * Extract hook name from a PreToolUse deny or hook error result text prefix.
 * Returns hook name string or null if not a hook block.
 */
function extractHookBlockName(resultText, isError) {
  if (typeof resultText !== 'string') return null;
  const trimmed = resultText.trim();
  // Common patterns:
  // "[hook-name] ..." or "PreToolUse:hook-name ..." or "Hook <name> denied/blocked" or "<hook-name>: denied/blocked"
  const bracketMatch = trimmed.match(/^\[([a-zA-Z0-9_.:-]+)\]/);
  if (bracketMatch) {
    if (isError || /deny|denied|block|blocked|hook error|forbidden|refused/i.test(trimmed)) {
      return bracketMatch[1];
    }
  }
  const preToolMatch = trimmed.match(/^PreToolUse:([a-zA-Z0-9_.-]+)/);
  if (preToolMatch) {
    // Real shape: "PreToolUse:<Tool> hook error: <message> [hook-name]<fix>"; the hook name is the last [bracket] token.
    const named = [...trimmed.matchAll(/\[([a-z0-9][a-z0-9_.-]*)\]/g)].map((m) => m[1]);
    return named.length ? named[named.length - 1] : preToolMatch[1];
  }
  const colonMatch = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(?:deny|denied|block|blocked|hook error)/i);
  if (colonMatch) {
    return colonMatch[1];
  }
  if (isError && /^hook error\b/i.test(trimmed)) {
    return 'unknown-hook';
  }
  return null;
}

/**
 * Usage-only projection: reads ONLY model, token counts, and timestamp.
 * Message content NEVER enters the returned objects.
 */
function projectUsageOnly(raw, windowFromMs, windowToMs) {
  const turns = parseAssistantTurns(raw);
  const filtered = turns.filter((t) => {
    if (t.ts === undefined) return true;
    return t.ts >= windowFromMs && t.ts <= windowToMs;
  });
  let ctxTokens = 0;
  for (const t of filtered) {
    ctxTokens += t.input + t.cacheRead + t.cacheWrite;
  }
  return {
    turns_total: filtered.length,
    turns: filtered.map((t) => ({
      model: t.model,
      input: t.input,
      output: t.output,
      cacheRead: t.cacheRead,
      cacheWrite: t.cacheWrite,
      ts: t.ts !== undefined ? toTaipeiIso(t.ts) : null,
    })),
    ctx_tokens: ctxTokens,
  };
}

/**
 * Stream lines from a file without loading the entire file into a single string.
 * Skips lines exceeding maxLineBytes (default 64 MB).
 */
async function* readLinesFromFile(filePath, options = {}) {
  const envChunk = Number(process.env.WASTED_TURNS_MAX_CHUNK);
  const maxChunk = Number.isFinite(options.maxChunk) && options.maxChunk > 0
    ? options.maxChunk
    : (Number.isFinite(envChunk) && envChunk > 0 ? envChunk : DEFAULT_MAX_CHUNK);
  const maxLineBytes = Number.isFinite(options.maxLineBytes) && options.maxLineBytes > 0
    ? options.maxLineBytes
    : MAX_LINE_BYTES;
  const onOversized = typeof options.onOversized === 'function' ? options.onOversized : null;

  const stream = fs.createReadStream(filePath, { highWaterMark: maxChunk });
  const decoder = new StringDecoder('utf8');
  let carry = '';
  let carryBytes = 0;
  let skippingOversized = false;

  for await (const chunk of stream) {
    const text = decoder.write(chunk);
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        if (skippingOversized) {
          skippingOversized = false;
          carry = '';
          carryBytes = 0;
        } else {
          const segment = text.slice(start, i);
          const line = (carry + segment).replace(/\r$/, '');
          carry = '';
          carryBytes = 0;
          if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
            if (onOversized) onOversized();
          } else {
            yield line;
          }
        }
        start = i + 1;
      }
    }
    if (start < text.length) {
      const rem = text.slice(start);
      if (!skippingOversized) {
        const remBytes = Buffer.byteLength(rem, 'utf8');
        if (carryBytes + remBytes > maxLineBytes) {
          skippingOversized = true;
          carry = '';
          carryBytes = 0;
          if (onOversized) onOversized();
        } else {
          carry += rem;
          carryBytes += remBytes;
        }
      }
    }
  }

  const tail = decoder.end();
  if (!skippingOversized) {
    const line = (carry + tail).replace(/\r$/, '');
    if (line.length > 0) {
      if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
        if (onOversized) onOversized();
      } else {
        yield line;
      }
    }
  }
}

/**
 * Streaming usage-only projection: reads ONLY model, token counts, and timestamp.
 */
async function projectUsageOnlyStream(filePathOrLines, windowFromMs, windowToMs, options = {}) {
  const fromMs = Number.isFinite(windowFromMs) ? windowFromMs : -Infinity;
  const toMs = Number.isFinite(windowToMs) ? windowToMs : Infinity;
  const lines = typeof filePathOrLines === 'string'
    ? readLinesFromFile(filePathOrLines, options)
    : filePathOrLines;

  let turnsTotal = 0;
  let ctxTokens = 0;
  for await (const line of lines) {
    if (!line || !line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.type !== 'assistant' || !rec.message || typeof rec.message !== 'object') continue;
    const u = rec.message.usage;
    if (!u || typeof u !== 'object') continue;
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    if (Number.isFinite(ts) && (ts < fromMs || ts > toMs)) continue;
    const input = Number(u.input_tokens || 0);
    const cacheRead = Number(u.cache_read_input_tokens || 0);
    const cacheWrite = Number(u.cache_creation_input_tokens || 0);
    ctxTokens += input + cacheRead + cacheWrite;
    turnsTotal += 1;
  }

  return {
    turns_total: turnsTotal,
    ctx_tokens: ctxTokens,
  };
}

function emptyBucket() {
  return { turns: 0, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 };
}

function addCost(bucket, ctxTokens, cacheRead, hitFactor, missFactor) {
  bucket.turns += 1;
  bucket.ctx_tokens += ctxTokens;
  if (cacheRead > 0) {
    bucket.cost_hit += Math.round(ctxTokens * hitFactor);
  } else {
    bucket.cost_miss += Math.round(ctxTokens * missFactor);
  }
}

/**
 * Classify a transcript JSONL string in --self mode.
 * Returns { turns_total, whiff, whiff_turns, whiff_per_100, whiff_share }.
 */
function classifyTranscript(raw, options = {}) {
  const hitFactor = Number.isFinite(options.hitFactor) ? options.hitFactor : DEFAULT_HIT_FACTOR;
  const missFactor = Number.isFinite(options.missFactor) ? options.missFactor : DEFAULT_MISS_FACTOR;
  const windowFromMs = Number.isFinite(options.windowFromMs) ? options.windowFromMs : -Infinity;
  const windowToMs = Number.isFinite(options.windowToMs) ? options.windowToMs : Infinity;

  const lines = typeof raw === 'string'
    ? raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    : [];

  // Parse records in file order
  const records = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    if (Number.isFinite(ts) && (ts < windowFromMs || ts > windowToMs)) {
      continue;
    }
    records.push(rec);
  }

  // Build ordered events:
  // - assistant tool_use turns (with preceding assistant usage)
  // - tool_result map by tool_use_id
  // - stop_block markers
  const toolEvents = [];
  const resultById = new Map();
  let lastAssistantUsage = { input: 0, cacheRead: 0, cacheWrite: 0 };
  let pendingStopBlock = false;

  for (const rec of records) {
    // Detect Stop hook block
    if (
      (rec.type === 'system' && rec.subtype === 'stop_hook' && rec.decision === 'block') ||
      (rec.hookEvent === 'Stop' && rec.decision === 'block') ||
      (rec.stopHookResult && rec.stopHookResult.decision === 'block')
    ) {
      pendingStopBlock = true;
      continue;
    }

    const msg = rec && rec.message;
    if (rec.type === 'assistant' && msg) {
      const u = msg.usage;
      if (u && typeof u === 'object') {
        lastAssistantUsage = {
          input: Number(u.input_tokens || 0),
          cacheRead: Number(u.cache_read_input_tokens || 0),
          cacheWrite: Number(u.cache_creation_input_tokens || 0),
        };
      }
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const blk of content) {
        if (!blk || typeof blk !== 'object') continue;
        if (blk.type === 'tool_use') {
          const cmdText = extractCommandText(blk.name || '', blk.input || {});
          toolEvents.push({
            id: blk.id || '',
            name: blk.name || '<unknown>',
            cmdText,
            normCmd: normalizeCommand(cmdText),
            usage: { ...lastAssistantUsage },
            afterStopBlock: pendingStopBlock,
          });
          pendingStopBlock = false;
        }
      }
      continue;
    }

    if (msg && Array.isArray(msg.content)) {
      for (const blk of msg.content) {
        if (!blk || typeof blk !== 'object') continue;
        if (blk.type === 'tool_result' && blk.tool_use_id) {
          const text = typeof blk.content === 'string'
            ? blk.content
            : Array.isArray(blk.content)
              ? blk.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n')
              : JSON.stringify(blk.content || '');
          resultById.set(blk.tool_use_id, {
            text,
            isError: blk.is_error === true,
          });
        }
      }
    }
  }

  const stopBlock = emptyBucket();
  const hookBlock = { turns: 0, by_hook: {}, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 };
  const helpLookup = emptyBucket();
  const errorRetry = emptyBucket();

  // Track recent errors for error_retry: { toolName, normCmd, index }
  const recentErrors = [];

  for (let i = 0; i < toolEvents.length; i++) {
    const ev = toolEvents[i];
    const res = resultById.get(ev.id) || { text: '', isError: false };
    const ctxTokens = ev.usage.input + ev.usage.cacheRead + ev.usage.cacheWrite;

    // Priority 1: stop_block
    if (ev.afterStopBlock) {
      addCost(stopBlock, ctxTokens, ev.usage.cacheRead, hitFactor, missFactor);
    } else {
      // Priority 2: hook_block
      const hookName = extractHookBlockName(res.text, res.isError);
      if (hookName) {
        addCost(hookBlock, ctxTokens, ev.usage.cacheRead, hitFactor, missFactor);
        hookBlock.by_hook[hookName] = (hookBlock.by_hook[hookName] || 0) + 1;
      } else if (isHelpLookup(ev.name, ev.cmdText)) {
        // Priority 3: help_lookup
        addCost(helpLookup, ctxTokens, ev.usage.cacheRead, hitFactor, missFactor);
      } else {
        // Priority 4: error_retry
        // Within next 3 turns, same tool AND exact same normalized command text
        const matchedError = recentErrors.find(
          (err) =>
            i - err.index >= 1 &&
            i - err.index <= 3 &&
            err.toolName === ev.name &&
            err.normCmd !== '' &&
            err.normCmd === ev.normCmd
        );
        if (matchedError) {
          addCost(errorRetry, ctxTokens, ev.usage.cacheRead, hitFactor, missFactor);
        }
      }
    }

    if (res.isError) {
      recentErrors.push({ toolName: ev.name, normCmd: ev.normCmd, index: i });
    }
  }

  // Priority 5 (separate, not in whiff_turns): repeat_chain
  // Sequence of >= 2 consecutive normalized shell commands appearing >= 2 times
  const shellCmds = toolEvents
    .filter((ev) => ev.name === 'Bash' || ev.name === 'bash' || ev.name === 'shell')
    .map((ev) => ev.normCmd)
    .filter(Boolean);

  const chainCounts = new Map();
  // A single command that already chains two or more steps (a && b, a ; b) is a chain by itself.
  for (const cmd of shellCmds) {
    if (/&&|;/.test(cmd)) chainCounts.set(cmd, (chainCounts.get(cmd) || 0) + 1);
  }
  for (let i = 0; i < shellCmds.length - 1; i++) {
    const shape = `${shellCmds[i]} && ${shellCmds[i + 1]}`;
    chainCounts.set(shape, (chainCounts.get(shape) || 0) + 1);
  }
  const chains = [];
  for (const [shape, count] of chainCounts.entries()) {
    if (count >= 2) {
      chains.push({ shape, count });
    }
  }
  chains.sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape));

  const turnsTotal = toolEvents.length;
  const whiffTurns = stopBlock.turns + hookBlock.turns + helpLookup.turns + errorRetry.turns;
  const whiffPer100 = turnsTotal > 0 ? Number(((whiffTurns / turnsTotal) * 100).toFixed(2)) : 0;
  const whiffShare = turnsTotal > 0 ? Number((whiffTurns / turnsTotal).toFixed(4)) : 0;

  return {
    turns_total: turnsTotal,
    whiff: {
      stop_block: stopBlock,
      hook_block: hookBlock,
      help_lookup: helpLookup,
      error_retry: errorRetry,
      repeat_chain: { chains },
    },
    whiff_turns: whiffTurns,
    whiff_per_100: whiffPer100,
    whiff_share: whiffShare,
  };
}

/**
 * Classify a transcript from an async iterable of lines or array of file paths.
 * Returns { turns_total, whiff, whiff_turns, whiff_per_100, whiff_share }.
 */
async function classifyTranscriptStream(linesOrPaths, options = {}) {
  const hitFactor = Number.isFinite(options.hitFactor) ? options.hitFactor : DEFAULT_HIT_FACTOR;
  const missFactor = Number.isFinite(options.missFactor) ? options.missFactor : DEFAULT_MISS_FACTOR;
  const windowFromMs = Number.isFinite(options.windowFromMs) ? options.windowFromMs : -Infinity;
  const windowToMs = Number.isFinite(options.windowToMs) ? options.windowToMs : Infinity;

  const toolEvents = [];
  const resultById = new Map();
  let lastAssistantUsage = { input: 0, cacheRead: 0, cacheWrite: 0 };
  let pendingStopBlock = false;

  const processLine = (line) => {
    if (!line || !line.trim()) return;
    let rec;
    try { rec = JSON.parse(line); } catch { return; }
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    if (Number.isFinite(ts) && (ts < windowFromMs || ts > windowToMs)) {
      return;
    }

    if (
      (rec.type === 'system' && rec.subtype === 'stop_hook' && rec.decision === 'block') ||
      (rec.hookEvent === 'Stop' && rec.decision === 'block') ||
      (rec.stopHookResult && rec.stopHookResult.decision === 'block')
    ) {
      pendingStopBlock = true;
      return;
    }

    const msg = rec && rec.message;
    if (rec.type === 'assistant' && msg) {
      const u = msg.usage;
      if (u && typeof u === 'object') {
        lastAssistantUsage = {
          input: Number(u.input_tokens || 0),
          cacheRead: Number(u.cache_read_input_tokens || 0),
          cacheWrite: Number(u.cache_creation_input_tokens || 0),
        };
      }
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const blk of content) {
        if (!blk || typeof blk !== 'object') continue;
        if (blk.type === 'tool_use') {
          const cmdText = extractCommandText(blk.name || '', blk.input || {});
          toolEvents.push({
            id: blk.id || '',
            name: blk.name || '<unknown>',
            cmdText,
            normCmd: normalizeCommand(cmdText),
            usage: { ...lastAssistantUsage },
            afterStopBlock: pendingStopBlock,
          });
          pendingStopBlock = false;
        }
      }
      return;
    }

    if (msg && Array.isArray(msg.content)) {
      for (const blk of msg.content) {
        if (!blk || typeof blk !== 'object') continue;
        if (blk.type === 'tool_result' && blk.tool_use_id) {
          const text = typeof blk.content === 'string'
            ? blk.content
            : Array.isArray(blk.content)
              ? blk.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n')
              : JSON.stringify(blk.content || '');
          resultById.set(blk.tool_use_id, {
            text,
            isError: blk.is_error === true,
          });
        }
      }
    }
  };

  if (Array.isArray(linesOrPaths)) {
    for (const filePath of linesOrPaths) {
      for await (const line of readLinesFromFile(filePath, options)) {
        processLine(line);
      }
    }
  } else {
    for await (const line of linesOrPaths) {
      processLine(line);
    }
  }

  const stopBlock = emptyBucket();
  const hookBlock = { turns: 0, by_hook: {}, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 };
  const helpLookup = emptyBucket();
  const errorRetry = emptyBucket();
  const recentErrors = [];

  for (let i = 0; i < toolEvents.length; i++) {
    const ev = toolEvents[i];
    const res = resultById.get(ev.id) || { text: '', isError: false };
    const ctxTokens = ev.usage.input + ev.usage.cacheRead + ev.usage.cacheWrite;

    if (ev.afterStopBlock) {
      addCost(stopBlock, ctxTokens, ev.usage.cacheRead, hitFactor, missFactor);
    } else {
      const hookName = extractHookBlockName(res.text, res.isError);
      if (hookName) {
        addCost(hookBlock, ctxTokens, ev.usage.cacheRead, hitFactor, missFactor);
        hookBlock.by_hook[hookName] = (hookBlock.by_hook[hookName] || 0) + 1;
      } else if (isHelpLookup(ev.name, ev.cmdText)) {
        addCost(helpLookup, ctxTokens, ev.usage.cacheRead, hitFactor, missFactor);
      } else {
        const matchedError = recentErrors.find(
          (err) =>
            i - err.index >= 1 &&
            i - err.index <= 3 &&
            err.toolName === ev.name &&
            err.normCmd !== '' &&
            err.normCmd === ev.normCmd
        );
        if (matchedError) {
          addCost(errorRetry, ctxTokens, ev.usage.cacheRead, hitFactor, missFactor);
        }
      }
    }

    if (res.isError) {
      recentErrors.push({ toolName: ev.name, normCmd: ev.normCmd, index: i });
    }
  }

  const shellCmds = toolEvents
    .filter((ev) => ev.name === 'Bash' || ev.name === 'bash' || ev.name === 'shell')
    .map((ev) => ev.normCmd)
    .filter(Boolean);

  const chainCounts = new Map();
  for (const cmd of shellCmds) {
    if (/&&|;/.test(cmd)) chainCounts.set(cmd, (chainCounts.get(cmd) || 0) + 1);
  }
  for (let i = 0; i < shellCmds.length - 1; i++) {
    const shape = `${shellCmds[i]} && ${shellCmds[i + 1]}`;
    chainCounts.set(shape, (chainCounts.get(shape) || 0) + 1);
  }
  const chains = [];
  for (const [shape, count] of chainCounts.entries()) {
    if (count >= 2) {
      chains.push({ shape, count });
    }
  }
  chains.sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape));

  const turnsTotal = toolEvents.length;
  const whiffTurns = stopBlock.turns + hookBlock.turns + helpLookup.turns + errorRetry.turns;
  const whiffPer100 = turnsTotal > 0 ? Number(((whiffTurns / turnsTotal) * 100).toFixed(2)) : 0;
  const whiffShare = turnsTotal > 0 ? Number((whiffTurns / turnsTotal).toFixed(4)) : 0;

  return {
    turns_total: turnsTotal,
    whiff: {
      stop_block: stopBlock,
      hook_block: hookBlock,
      help_lookup: helpLookup,
      error_retry: errorRetry,
      repeat_chain: { chains },
    },
    whiff_turns: whiffTurns,
    whiff_per_100: whiffPer100,
    whiff_share: whiffShare,
  };
}

module.exports = {
  DEFAULT_HIT_FACTOR,
  DEFAULT_MISS_FACTOR,
  MAX_LINE_BYTES,
  toTaipeiIso,
  normalizeCommand,
  isHelpLookup,
  extractHookBlockName,
  readLinesFromFile,
  projectUsageOnly,
  projectUsageOnlyStream,
  classifyTranscript,
  classifyTranscriptStream,
};
