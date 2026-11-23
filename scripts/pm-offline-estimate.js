'use strict';

const { computeWeightedCost } = require('./pm-seat-cost-metrics.js');

function autocompact(sessions, window = 200000, summaryTokens = 10000, prefixTokens = 40000) {
  let actual = 0, simulated = 0, compressions = 0, totalContext = 0, turns = 0;
  for (const session of sessions) {
    let offset = 0, previous = 0;
    const base = prefixTokens + summaryTokens;
    for (const entry of session) {
      if (entry.type !== 'assistant' || !entry.message?.usage) continue;
      const u = entry.message.usage;
      const context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      actual += computeWeightedCost(u);
      totalContext += context;
      turns++;
      // A real compaction or /clear shows as a context drop: restart the simulation from the real value.
      if (previous && context < previous * 0.6) offset = 0;
      previous = context;
      let adjusted = context - offset;
      if (adjusted > window - 33000) {
        // Summary call: reads the whole context, writes the summary; then the fixed prefix plus summary is rewritten (1h cache).
        simulated += computeWeightedCost({ cache_read_input_tokens: adjusted, output_tokens: summaryTokens, cache_creation: { ephemeral_1h_input_tokens: base } });
        offset = context - base;
        adjusted = base;
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
function incomingMessages(session) {
  const crypto = require('node:crypto');
  const seen = new Map(), result = [];
  session.forEach((entry, index) => {
    let text;
    if (incoming(entry)) text = messageText(entry);
    else if (entry.type === 'attachment' && entry.attachment?.type === 'queued_command') text = entry.attachment.prompt;
    else if (entry.type === 'queue-operation') text = entry.content;
    if (typeof text !== 'string' || !text) return;
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const time = Date.parse(entry.timestamp);
    const prior = seen.get(hash) || [];
    if (prior.some(p => p.type !== entry.type && Number.isFinite(time) && Number.isFinite(p.time) && Math.abs(time - p.time) <= 5000)) return;
    prior.push({ type: entry.type, time });
    seen.set(hash, prior);
    result.push({ text, timestamp: entry.timestamp, index });
  });
  return result;
}
function unpack(text) {
  if (!/\[inbox batch\b|PM 收件匣[^\n]*批次包/i.test(text)) return [text];
  const parts = text.split(/(?:^|\n)(?=\s*(?:#\d+\b|###\s*項目\s*\d+\b))/).slice(1);
  return parts.length ? parts : [text];
}
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'TaskGet', 'TaskList', ...['recent', 'directory', 'whoami', 'state', 'fetch', 'watch', 'list_claims', 'task_status'].map(name => `mcp__fleet__${name}`)]);
const UNMATCHED_OTHER_BUCKETS = [
  ['task_notification', text => /^\s*<task-notification/i.test(text)],
  ['system_reminder', text => /<system-reminder>/i.test(text)],
  ['hook_feedback', text => /Stop hook|hook feedback/i.test(text)],
  ['channel_other', text => /<channel\s/i.test(text)],
  ['rest', () => true],
];
function prescreen(sessions, rules, dispositions = null) {
  if (!rules && !dispositions) return null;
  const rows = dispositions && (Array.isArray(dispositions) ? dispositions : dispositions.items);
  const lookup = rows && new Map(rows.map(row => [String(row.message_id), row]));
  const baseline = rows ? Math.min(...rows.map(row => Date.parse(row.delivered_at)).filter(Number.isFinite)) : Infinity;
  const classes = rules && !lookup ? rules.auto_classes.map(c => ({ rule: c.match, result: { name: c.name, messages: 0, turns: 0, weighted_cost: 0 } })) : [];
  const totals = new Map();
  const breakdown = Object.fromEntries(UNMATCHED_OTHER_BUCKETS.map(([name]) => [name, { messages: 0, weighted_cost: 0 }]));
  for (const session of sessions) {
    const messages = incomingMessages(session);
    messages.forEach((message, i) => {
      const items = unpack(message.text);
      const end = messages[i + 1]?.index ?? session.length;
      const turns = session.slice(message.index + 1, end).filter(e => e.type === 'assistant' && e.message?.usage);
      const cost = turns.reduce((sum, e) => sum + computeWeightedCost(e.message.usage), 0);
      const sideEffect = lookup && session.slice(message.index + 1, end).some(e => e.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some(block => block.type === 'tool_use' && !READ_ONLY_TOOLS.has(block.name)));
      for (const text of items) {
        if (lookup) {
          const id = text.match(/\bmessage_id="([^"]+)"/)?.[1];
          const row = id && lookup.get(id);
          const channel = /<channel\s/i.test(message.text);
          const packed = /\[inbox batch\b|PM 收件匣[^\n]*批次包/i.test(message.text);
          const operator = session[message.index].type === 'user' && !channel && !packed;
          const name = row ? (row.category || 'unmatched_other') : operator ? 'unmatched_operator' : channel && Number.isFinite(baseline) && Date.parse(message.timestamp) < baseline ? 'unmatched_pre_baseline' : 'unmatched_other';
          if (!totals.has(name)) totals.set(name, { name, messages: 0, turns: 0, weighted_cost: 0, matched: 0, auto_processable: 0, auto_weighted_cost: 0, auto_with_side_effect: 0, auto_with_side_effect_weighted_cost: 0, ...(['task_result', 'credential_redline'].includes(name) ? { bypass_candidates: 0 } : {}), ...(name === 'unmatched_operator' && !row ? { excluded_from_s4: true } : {}) });
          if (name === 'unmatched_other') {
            const bucket = breakdown[UNMATCHED_OTHER_BUCKETS.find(([, matches]) => matches(text))[0]];
            bucket.messages++; bucket.weighted_cost += cost / items.length;
          }
          const result = totals.get(name);
          result.messages++; result.turns += turns.length / items.length; result.weighted_cost += cost / items.length;
          if (row) { result.matched++; if (row.disposition === 'no_action' || (row.disposition === 'done' && (row.fyi === true || !!row.no_action_reason))) { result.auto_processable++; result.auto_weighted_cost += cost / items.length; if (sideEffect) { result.auto_with_side_effect++; result.auto_with_side_effect_weighted_cost += cost / items.length; if ('bypass_candidates' in result) result.bypass_candidates++; } } }
        } else {
          const entry = session[message.index];
          const metadata = fields(entry);
          const active = classes.find(({ rule }) => (!rule.kind || rule.kind === metadata.kind) && (!rule.from || rule.from === metadata.from) && (!rule.pattern || new RegExp(rule.pattern).test(text)));
          if (active) { active.result.messages++; active.result.turns += turns.length / items.length; active.result.weighted_cost += cost / items.length; }
        }
      }
    });
  }
  if (lookup) {
    const result = [...totals.values()];
    Object.defineProperty(result, 'unmatched_other_breakdown', { value: breakdown });
    return result;
  }
  return classes.map(c => c.result);
}
// Inbox messages reach the PM wrapped as <channel ... kind="wake">; a patrol line names its class after the tag.
function batchKey(entry) {
  const text = messageText(entry);
  const kind = fields(entry).kind || text.match(/\bkind="([a-z_]+)"/)?.[1] || text.match(/^\s*\[([a-zA-Z0-9_-]+)\]/)?.[1];
  if (kind == null) return null;
  const cls = text.match(/\[fleet patrol\]\s+([a-z0-9_]+)/)?.[1] || text.match(/\[fleet patrol\]\s+(\d+ tasks held)/) && 'tasks_held';
  return cls ? `${kind}:${cls}` : kind;
}
function batch(sessions, seconds = 300) {
  let saved_turns = 0, weighted_cost = 0, already_batched_items = 0;
  for (const session of sessions) {
    const first = new Map(), messages = incomingMessages(session);
    messages.forEach((message, i) => {
      const items = unpack(message.text), time = Date.parse(message.timestamp);
      if (items.length > 1) already_batched_items += items.length;
      const keys = new Set();
      for (const text of items) {
        const entry = { ...session[message.index], message: { content: text } };
        const kind = batchKey(entry) || batchKey({ ...session[message.index], message: { content: message.text } });
        if (kind == null || keys.has(kind) || !Number.isFinite(time)) continue;
        keys.add(kind);
        const previous = first.get(kind);
        if (previous !== undefined && time >= previous && time - previous <= seconds * 1000) {
          const end = messages[i + 1]?.index ?? session.length;
          const turn = session.slice(message.index + 1, end).find(e => e.type === 'assistant' && e.message?.usage);
          if (turn) { saved_turns += 1 / items.length; weighted_cost += computeWeightedCost(turn.message.usage) / items.length; }
        } else first.set(kind, time);
      }
    });
  }
  return { already_batched_items, saved_turns, weighted_cost };
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
module.exports = { autocompact, prescreen, batch, failures, incomingMessages };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const args = process.argv.slice(2), dirs = [], windows = [];
  let since = -Infinity, out, rules = null, dispositions = null, summary = 10000, prefix = 40000, batchWindow = 300;
  for (let i = 0; i < args.length; i++) {
    const value = args[++i];
    switch (args[i - 1]) {
      case '--sessions-dir': dirs.push(value); break;
      case '--window': windows.push(Number(value)); break;
      case '--since': since = Date.parse(value); break;
      case '--out': out = value; break;
      case '--dispositions': dispositions = JSON.parse(fs.readFileSync(value, 'utf8')); break;
      case '--rules': rules = JSON.parse(value.trimStart().startsWith('{') ? value : fs.readFileSync(value, 'utf8')); break;
      case '--summary-tokens': summary = Number(value); break;
      case '--prefix-tokens': prefix = Number(value); break;
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
  const result = { autocompact: windows.map(window => ({ window, ...autocompact(sessions, window, summary, prefix) })), s4: prescreen(sessions, rules, dispositions), s5a: batch(sessions, batchWindow), s2: failures(sessions) };
  if (dispositions) {
    result.unmatched_other_breakdown = result.s4.unmatched_other_breakdown;
    const total_weighted_cost = result.s4.reduce((sum, row) => sum + row.weighted_cost, 0);
    const excluded_operator_weighted_cost = result.s4.filter(row => row.excluded_from_s4).reduce((sum, row) => sum + row.weighted_cost, 0);
    const s4_base_weighted_cost = total_weighted_cost - excluded_operator_weighted_cost;
    const auto_weighted_cost = result.s4.reduce((sum, row) => sum + row.auto_weighted_cost, 0);
    const bypass_candidates = result.s4.reduce((sum, row) => sum + row.auto_with_side_effect, 0);
    result.s4_summary = { bypass_candidates, total_weighted_cost, excluded_operator_weighted_cost, s4_base_weighted_cost, auto_weighted_cost, auto_share_of_base: s4_base_weighted_cost ? auto_weighted_cost / s4_base_weighted_cost : 0 };
  }
  const json = JSON.stringify(result, null, 2) + '\n';
  if (out) fs.writeFileSync(out, json); else process.stdout.write(json);
}
