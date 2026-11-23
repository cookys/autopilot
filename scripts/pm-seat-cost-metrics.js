#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CORRECTION_PHRASES = [
  '不是這個意思',
  '不對',
  '你搞錯',
  '我不是說',
  '又',
];

const MECHANICAL_COMMANDS = [
  'inbox mark',
  'inbox-done',
  'task accept',
  'task comment',
  'task show',
  'date',
];

const MECHANICAL_MCP_TOOLS = new Set([
  'mcp__fleet__inbox_mark',
  'mcp__fleet__inbox_done',
  'mcp__fleet__task_accept',
  'mcp__fleet__task_comment',
  'mcp__fleet__task_show',
]);

function parseArgs(argv) {
  const opts = {
    sessionsDirs: [],
    ledger: null,
    courierLog: null,
    rotationLog: null,
    day: null,
    since: null,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--sessions-dir') {
      opts.sessionsDirs.push(argv[++i]);
    } else if (arg === '--ledger') {
      opts.ledger = argv[++i];
    } else if (arg === '--courier-log') {
      opts.courierLog = argv[++i];
    } else if (arg === '--rotation-log') {
      opts.rotationLog = argv[++i];
    } else if (arg === '--day') {
      opts.day = argv[++i];
    } else if (arg === '--since') {
      opts.since = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function collectJsonlFiles(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

function* iterJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    const dec = new (require('node:string_decoder').StringDecoder)('utf8');
    let rest = '';
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      const parts = (rest + dec.write(buf.subarray(0, n))).split('\n');
      rest = parts.pop();
      for (const line of parts) {
        const row = parseLine(line);
        if (row !== undefined) yield row;
      }
    }
    const row = parseLine(rest);
    if (row !== undefined) yield row;
  } finally {
    fs.closeSync(fd);
  }
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined; // skip malformed JSONL lines
  }
}

function readJsonl(filePath) {
  return [...iterJsonl(filePath)];
}

function toUtcDay(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function computeWeightedCost(usage) {
  if (!usage) return 0;
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  let cacheWrite5m = 0;
  let cacheWrite1h = 0;
  if (usage.cache_creation && typeof usage.cache_creation === 'object') {
    cacheWrite5m = Number(usage.cache_creation.ephemeral_5m_input_tokens || 0);
    cacheWrite1h = Number(usage.cache_creation.ephemeral_1h_input_tokens || 0);
  }
  if (cacheWrite5m === 0 && cacheWrite1h === 0 && usage.cache_creation_input_tokens) {
    cacheWrite1h = Number(usage.cache_creation_input_tokens || 0);
  }
  return (
    input * 1 +
    output * 5 +
    cacheRead * 0.1 +
    cacheWrite5m * 1.25 +
    cacheWrite1h * 2.0
  );
}

function computeContextTokens(usage) {
  if (!usage) return 0;
  return (
    Number(usage.input_tokens || 0) +
    Number(usage.cache_read_input_tokens || 0) +
    Number(usage.cache_creation_input_tokens || 0)
  );
}

function isSyntheticEntry(entry) {
  if (entry.isSynthetic === true) return true;
  const model = entry.message && entry.message.model;
  if (model === '<synthetic>') return true;
  const id = entry.message && entry.message.id;
  if (typeof id === 'string' && id.startsWith('synthetic')) return true;
  return false;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function isMechanicalAssistantMessage(msg) {
  if (!msg || !Array.isArray(msg.content)) return false;
  const toolUses = msg.content.filter((b) => b && b.type === 'tool_use');
  if (toolUses.length === 0) {
    const text = extractText(msg.content).trim();
    return text.length > 0 && text.length <= 120;
  }
  return toolUses.every((tu) => {
    if (MECHANICAL_MCP_TOOLS.has(tu.name)) return true;
    if (tu.name === 'Bash' && tu.input && typeof tu.input.command === 'string') {
      const cmd = tu.input.command.trim();
      return MECHANICAL_COMMANDS.some((mc) => cmd.startsWith(mc) || cmd.includes(`fleet ${mc}`));
    }
    return false;
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function matchesCorrectionPhrase(text) {
  if (!text) return false;
  return CORRECTION_PHRASES.some((phrase) => text.includes(phrase));
}

function extractTaskIds(text) {
  if (!text) return [];
  const matches = text.match(/\b01[A-Z0-9]{24}\b/g);
  return matches ? [...new Set(matches)] : [];
}

function computeMetrics(opts) {
  const sessionFiles = [];
  for (const dir of opts.sessionsDirs) {
    sessionFiles.push(...collectJsonlFiles(dir));
  }

  const ledgerRows = opts.ledger ? readJsonl(opts.ledger) : null;
  const courierRows = opts.courierLog ? readJsonl(opts.courierLog) : null;
  const rotationRows = opts.rotationLog ? readJsonl(opts.rotationLog) : null;

  const openOperatorTasks = new Set();
  const taskLastTouch = new Map();
  const taskOrigin = new Map();
  if (ledgerRows) {
    for (const row of ledgerRows) {
      const tid = row.task_id || row.id;
      if (!tid) continue;
      if (row.origin) taskOrigin.set(tid, row.origin);
      if (row.status && row.status !== 'done' && row.status !== 'closed') {
        openOperatorTasks.add(tid);
      }
      const ts = row.timestamp ? new Date(row.timestamp).getTime() : 0;
      if (ts > (taskLastTouch.get(tid) || 0)) {
        taskLastTouch.set(tid, ts);
      }
    }
  }

  const seenAssistantIds = new Set();
  const days = new Map();

  function getDayBucket(day) {
    if (!days.has(day)) {
      days.set(day, {
        day,
        calls: 0,
        weighted_cost: 0,
        total_context: 0,
        mechanical_turns: 0,
        total_turns: 0,
        tool_calls: 0,
        failed_tool_calls: 0,
        correction_list_matches: 0,
        re_ask_count: 0,
        latencies_ms: [],
        seen_prompts: new Set(),
        seen_open_tasks_asked: new Set(),
        slices: {
          l1_rotation: { turns: 0, weighted_cost: 0 },
          l2_mechanical: { turns: 0, weighted_cost: 0 },
          l3_batching: { turns: 0, weighted_cost: 0 },
          l4_failure_recovery: { turns: 0, weighted_cost: 0 },
          l5_stop_hook: { turns: 0, weighted_cost: 0 },
          l6_two_seat: { turns: 0, weighted_cost: 0 },
          unattributed: { turns: 0, weighted_cost: 0 },
        },
      });
    }
    return days.get(day);
  }

  for (const file of sessionFiles) {
    const entries = iterJsonl(file);
    let pendingOperatorPromptTs = null;

    for (const entry of entries) {
      const day = toUtcDay(entry.timestamp);
      if (!day) continue;
      if (opts.day && day !== opts.day) continue;
      if (opts.since && day < opts.since) continue;

      const bucket = getDayBucket(day);

      if (entry.type === 'user' && entry.message && entry.message.role === 'user') {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && block.type === 'tool_result') {
              bucket.tool_calls += 1;
              if (block.is_error === true) {
                bucket.failed_tool_calls += 1;
              }
            }
          }
        }
        const text = extractText(content).trim();
        if (text && !entry.isMeta) {
          if (matchesCorrectionPhrase(text)) {
            bucket.correction_list_matches += 1;
          }
          const normalized = text.replace(/\s+/g, ' ').slice(0, 200);
          const taskIds = extractTaskIds(text);
          let isReAsk = false;
          if (bucket.seen_prompts.has(normalized)) {
            isReAsk = true;
          } else {
            for (const tid of taskIds) {
              if (openOperatorTasks.has(tid) && bucket.seen_open_tasks_asked.has(tid)) {
                isReAsk = true;
                break;
              }
            }
          }
          if (isReAsk) {
            bucket.re_ask_count += 1;
          }
          bucket.seen_prompts.add(normalized);
          for (const tid of taskIds) {
            bucket.seen_open_tasks_asked.add(tid);
          }
          const tsMs = new Date(entry.timestamp).getTime();
          if (!Number.isNaN(tsMs)) {
            pendingOperatorPromptTs = tsMs;
          }
        }
      }

      if (entry.type === 'assistant' && entry.message && entry.message.role === 'assistant') {
        if (isSyntheticEntry(entry)) continue;
        const msgId = entry.message.id || entry.uuid || entry.id;
        if (msgId) {
          if (seenAssistantIds.has(msgId)) continue;
          seenAssistantIds.add(msgId);
        }

        const usage = entry.message.usage || {};
        const cost = computeWeightedCost(usage);
        const ctx = computeContextTokens(usage);

        bucket.calls += 1;
        bucket.weighted_cost += cost;
        bucket.total_context += ctx;
        bucket.total_turns += 1;

        const isMech = isMechanicalAssistantMessage(entry.message);
        if (isMech) {
          bucket.mechanical_turns += 1;
        }

        if (pendingOperatorPromptTs !== null) {
          const text = extractText(entry.message.content).trim();
          if (text) {
            const respMs = new Date(entry.timestamp).getTime();
            if (!Number.isNaN(respMs) && respMs >= pendingOperatorPromptTs) {
              bucket.latencies_ms.push(respMs - pendingOperatorPromptTs);
            }
            pendingOperatorPromptTs = null;
          }
        }

        // Mutually exclusive slice assignment (first matching lever)
        let sliceKey = 'unattributed';
        if (ctx >= 180000) {
          sliceKey = 'l1_rotation';
        } else if (isMech) {
          sliceKey = 'l2_mechanical';
        } else if (entry.trigger === 'stop_hook') {
          sliceKey = 'l5_stop_hook';
        } else if (entry.trigger === 'fleet_batch' || entry.trigger === 'lane') {
          sliceKey = 'l3_batching';
        } else if (entry.trigger === 'operator') {
          sliceKey = 'l6_two_seat';
        }
        bucket.slices[sliceKey].turns += 1;
        bucket.slices[sliceKey].weighted_cost += cost;
      }
    }
  }

  const results = [];
  for (const day of [...days.keys()].sort()) {
    const b = days.get(day);
    const sortedLat = [...b.latencies_ms].sort((a, c) => a - c);
    const p50 = percentile(sortedLat, 50);
    const p95 = percentile(sortedLat, 95);

    let rotations = null;
    let resumeCheckPasses = null;
    let resumeCheckFallbacks = null;
    if (rotationRows !== null) {
      rotations = 0;
      resumeCheckPasses = 0;
      resumeCheckFallbacks = 0;
      for (const r of rotationRows) {
        if (toUtcDay(r.timestamp) !== day) continue;
        rotations += 1;
        if (r.resume_check === 'pass' || r.passed === true) {
          resumeCheckPasses += 1;
        } else if (r.resume_check === 'fallback' || r.fallback === true) {
          resumeCheckFallbacks += 1;
        }
      }
    }

    let bypassAutoHandled = null;
    if (courierRows !== null) {
      bypassAutoHandled = 0;
      for (const c of courierRows) {
        if (toUtcDay(c.timestamp) !== day) continue;
        if (c.bypass_class === true && c.auto_handled === true) {
          bypassAutoHandled += 1;
        }
      }
    }

    let lostAsks = null;
    if (ledgerRows !== null) {
      lostAsks = 0;
      const dayEndMs = new Date(`${day}T23:59:59.999Z`).getTime();
      for (const [tid, origin] of taskOrigin.entries()) {
        if (origin !== 'operator') continue;
        const lastTouch = taskLastTouch.get(tid) || 0;
        if (dayEndMs - lastTouch >= 24 * 60 * 60 * 1000) {
          lostAsks += 1;
        }
      }
    }

    const avgContext = b.calls > 0 ? Math.round(b.total_context / b.calls) : 0;
    const mechShare = b.total_turns > 0 ? Number((b.mechanical_turns / b.total_turns).toFixed(4)) : 0;
    const failureShare = b.tool_calls > 0 ? Number((b.failed_tool_calls / b.tool_calls).toFixed(4)) : 0;
    const operatorCorrections = b.correction_list_matches + b.re_ask_count;

    results.push({
      day,
      calls: b.calls,
      weighted_cost: Number(b.weighted_cost.toFixed(2)),
      average_context: avgContext,
      mechanical_only_share: mechShare,
      failure_share: failureShare,
      rotations,
      resume_check_passes: resumeCheckPasses,
      resume_check_fallbacks: resumeCheckFallbacks,
      bypass_auto_handled: bypassAutoHandled,
      operator_corrections: operatorCorrections,
      operator_reply_latency_p50_ms: p50,
      operator_reply_latency_p95_ms: p95,
      mutually_exclusive_slices: b.slices,
      detectors: {
        operator_correction_list_matches: b.correction_list_matches,
        re_ask_count: b.re_ask_count,
        latency_p50_ms: p50,
        latency_p95_ms: p95,
        bypass_auto_handled: bypassAutoHandled,
        lost_asks: lostAsks,
      },
      gates: {
        s2_failure_share_ok: failureShare < 0.03,
        s3_avg_context_ok: avgContext <= 170000,
        s3_resume_check_ok:
          rotations === null
            ? null
            : rotations === 0 || resumeCheckPasses === rotations || resumeCheckFallbacks > 0,
        s4_mechanical_share_ok: mechShare < 0.12,
        s4_zero_bypass_auto_handled: bypassAutoHandled === null ? null : bypassAutoHandled === 0,
        s7_zero_lost_asks: lostAsks === null ? null : lostAsks === 0,
      },
    });
  }

  return results;
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv);
    if (opts.help) {
      console.log(
        'Usage: pm-seat-cost-metrics.js --sessions-dir <dir> [--sessions-dir <dir>...] [--ledger <file>] [--courier-log <file>] [--rotation-log <file>] [--day YYYY-MM-DD] [--since YYYY-MM-DD]'
      );
      process.exit(0);
    }
    const rows = computeMetrics(opts);
    for (const row of rows) {
      console.log(JSON.stringify(row));
    }
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

module.exports = {
  parseArgs,
  computeWeightedCost,
  computeMetrics,
};
