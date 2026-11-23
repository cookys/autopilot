'use strict';

const { computeWeightedCost } = require('./pm-seat-cost-metrics.js');

function autocompact(sessions, window = 200000, summaryTokens = 10000) {
  let actual = 0, simulated = 0, compressions = 0, totalContext = 0, turns = 0;
  for (const session of sessions) {
    let offset = 0;
    for (const entry of session) {
      if (entry.type !== 'assistant' || !entry.message?.usage) continue;
      const u = entry.message.usage;
      const context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      actual += computeWeightedCost(u);
      totalContext += context;
      turns++;
      let adjusted = Math.max(0, context - offset);
      if (adjusted > window - 33000) {
        simulated += computeWeightedCost({ cache_read_input_tokens: adjusted, output_tokens: summaryTokens, cache_creation_input_tokens: summaryTokens });
        offset = context - summaryTokens;
        adjusted = summaryTokens;
        compressions++;
      }
      if (offset === 0) simulated += computeWeightedCost(u);
      else {
        const input = Math.min(u.input_tokens || 0, adjusted);
        const write = Math.min(u.cache_creation_input_tokens || 0, adjusted - input);
        const originalWrite = u.cache_creation_input_tokens || 0;
        const ratio = originalWrite ? write / originalWrite : 0;
        const creation = u.cache_creation && { ephemeral_5m_input_tokens: (u.cache_creation.ephemeral_5m_input_tokens || 0) * ratio, ephemeral_1h_input_tokens: (u.cache_creation.ephemeral_1h_input_tokens || 0) * ratio };
        simulated += computeWeightedCost({ input_tokens: input, output_tokens: u.output_tokens || 0, cache_read_input_tokens: adjusted - input - write, cache_creation_input_tokens: write, cache_creation: creation });
      }
    }
  }
  return { actual_cost: actual, simulated_cost: simulated, difference: actual - simulated, compressions, average_context: turns ? totalContext / turns : 0 };
}
function messageText(entry) {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(x => x.type === 'text').map(x => x.text || '').join('\n') : '';
}
function fields(entry) {
  try { const value = JSON.parse(messageText(entry)); return value && typeof value === 'object' ? value : entry; } catch { return entry; }
}
function incoming(entry) {
  return entry.type === 'user' && !entry.isMeta && !!messageText(entry);
}
function prescreen(sessions, rules) {
  if (!rules) return null;
  const classes = rules.auto_classes.map(c => ({ rule: c.match, result: { name: c.name, messages: 0, turns: 0, weighted_cost: 0 } }));
  for (const session of sessions) {
    let active = null;
    for (const entry of session) {
      if (incoming(entry)) {
        const text = messageText(entry);
        const metadata = fields(entry);
        active = classes.find(({ rule }) => (!rule.kind || rule.kind === metadata.kind) && (!rule.from || rule.from === metadata.from) && (!rule.pattern || new RegExp(rule.pattern).test(text))) || null;
        if (active) active.result.messages++;
      } else if (entry.type === 'assistant' && entry.message?.usage && active) {
        active.result.turns++;
        active.result.weighted_cost += computeWeightedCost(entry.message.usage);
      }
    }
  }
  return classes.map(c => c.result);
}
function batch(sessions, seconds = 300) {
  let saved_turns = 0, weighted_cost = 0;
  for (const session of sessions) {
    const first = new Map();
    let pending = false;
    for (const entry of session) {
      if (incoming(entry)) {
        const kind = fields(entry).kind || messageText(entry).match(/^\s*\[([a-zA-Z0-9_-]+)\]/)?.[1];
        const time = Date.parse(entry.timestamp);
        const previous = first.get(kind);
        pending = kind != null && Number.isFinite(time) && previous !== undefined && time >= previous && time - previous <= seconds * 1000;
        if (kind != null && !pending && Number.isFinite(time)) first.set(kind, time);
      } else if (pending && entry.type === 'assistant' && entry.message?.usage) {
        saved_turns++;
        weighted_cost += computeWeightedCost(entry.message.usage);
        pending = false;
      }
    }
  }
  return { saved_turns, weighted_cost };
}
function failures(sessions) {
  const categories = new Map();
  for (const session of sessions) {
    let lastAssistant = null, failed = null;
    for (const entry of session) {
      if (entry.type === 'assistant' && entry.message?.usage) {
        if (failed) {
          failed.retry_turns++;
          failed.weighted_cost += computeWeightedCost(entry.message.usage);
          failed = null;
        }
        lastAssistant = entry;
      } else if (lastAssistant && ((entry.type === 'system' && entry.subtype === 'stop_hook' && entry.decision === 'block') || (entry.hookEvent && entry.decision === 'block') || entry.stopHookResult?.decision === 'block')) {
        const category = 'hook_block';
        if (!categories.has(category)) categories.set(category, { category, failures: 0, retry_turns: 0, weighted_cost: 0 });
        failed = categories.get(category);
        failed.failures++;
        lastAssistant = null;
      } else if (entry.type === 'user' && lastAssistant) {
        const blocks = Array.isArray(entry.message?.content) ? entry.message.content : [];
        const results = blocks.filter(b => b.type === 'tool_result');
        const hookBlocked = results.some(b => /(?:^PreToolUse:|hook (?:error|blocked|denied)|\bblocked by hook\b)/i.test(typeof b.content === 'string' ? b.content : ''));
        if (hookBlocked || results.some(b => b.is_error)) {
          const category = hookBlocked ? 'hook_block' : 'tool_error';
          if (!categories.has(category)) categories.set(category, { category, failures: 0, retry_turns: 0, weighted_cost: 0 });
          failed = categories.get(category);
          failed.failures++;
          lastAssistant = null;
        } else if (incoming(entry)) {
          failed = null;
          lastAssistant = null;
        }
      }
    }
  }
  return [...categories.values()];
}
module.exports = { autocompact, prescreen, batch, failures };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const args = process.argv.slice(2), dirs = [], windows = [];
  let since = -Infinity, out, rules = null, summary = 10000, batchWindow = 300;
  for (let i = 0; i < args.length; i++) {
    const value = args[++i];
    switch (args[i - 1]) {
      case '--sessions-dir': dirs.push(value); break;
      case '--window': windows.push(Number(value)); break;
      case '--since': since = Date.parse(value); break;
      case '--out': out = value; break;
      case '--rules': rules = JSON.parse(value.trimStart().startsWith('{') ? value : fs.readFileSync(value, 'utf8')); break;
      case '--summary-tokens': summary = Number(value); break;
      case '--batch-window-sec': batchWindow = Number(value); break;
      default: throw new Error('Unknown argument');
    }
  }
  if (!Number.isFinite(since) && since !== -Infinity) throw new Error('Invalid since');
  if (!windows.length) windows.push(200000);
  if (windows.some(w => !Number.isFinite(w) || w <= 33000) || !Number.isFinite(summary) || summary < 0 || !Number.isFinite(batchWindow) || batchWindow < 0) throw new Error('Invalid numeric option');
  const sessions = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile() && item.name.endsWith('.jsonl')) {
        const entries = [];
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
          try {
            const entry = JSON.parse(line);
            if (since === -Infinity || Date.parse(entry.timestamp) >= since) entries.push(entry);
          } catch { /* Ignore malformed lines. */ }
        }
        sessions.push(entries);
      }
    }
  }
  dirs.forEach(visit);
  const result = { autocompact: windows.map(window => ({ window, ...autocompact(sessions, window, summary) })), s4: prescreen(sessions, rules), s5a: batch(sessions, batchWindow), s2: failures(sessions) };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (out) fs.writeFileSync(out, json); else process.stdout.write(json);
}
