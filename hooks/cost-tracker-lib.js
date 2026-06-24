// cost-tracker-lib.js — pure token/cost aggregation from a Claude Code session
// transcript JSONL, for the cost-tracker Stop hook.
//
// WHY a transcript sum (not the Stop payload): the Claude Code 2.1.186 Stop
// payload carries NO `usage`/`model` field (verified v2.23.0). The per-turn
// usage lives in the transcript — each `type:"assistant"` line has
// `message.model` + `message.usage` ({input_tokens, output_tokens,
// cache_read_input_tokens, cache_creation_input_tokens}). The transcript is
// append-only, so the Stop hook (which fires once per assistant turn) tracks a
// per-session cursor (count of turns already logged) and aggregates only the
// NEW turns each time — summing all rows in costs.jsonl then equals the true
// session cost with no double-count.
//
// Everything here is pure (no IO) and fail-soft: malformed lines are skipped.

'use strict';

// Anthropic cache pricing multipliers, relative to a model's base input rate:
//   cache READ  is billed at 10% of input   (cache hit)
//   cache WRITE is billed at 125% of input  (5-minute ephemeral cache create)
// Without these, an autopilot session (cache_read dominates input ~40:1) would
// be wildly mis-priced either way.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

// Model pricing (USD per 1M tokens) — update when Anthropic changes pricing.
// Matched by substring against the transcript's `message.model` (e.g.
// "claude-opus-4-8" → opus). Unknown models fall back to sonnet (do NOT invent
// pricing for an unverified tier — default + this comment is the honest choice).
const PRICING = {
  haiku:  { input: 0.8, output: 4 },
  sonnet: { input: 3,   output: 15 },
  opus:   { input: 15,  output: 75 },
};

function getRate(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku')) return PRICING.haiku;
  if (m.includes('opus'))  return PRICING.opus;
  return PRICING.sonnet; // default (incl. unknown/sonnet)
}

// Parse transcript JSONL text → ordered list of assistant-turn usage records.
// Each: { model, input, output, cacheRead, cacheWrite }. Order = file order
// (append-only), which the cursor relies on.
function parseAssistantTurns(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const turns = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.type !== 'assistant' || !rec.message) continue;
    const u = rec.message.usage;
    if (!u || typeof u !== 'object') continue;
    turns.push({
      model: rec.message.model || 'sonnet',
      input: Number(u.input_tokens || 0),
      output: Number(u.output_tokens || 0),
      cacheRead: Number(u.cache_read_input_tokens || 0),
      cacheWrite: Number(u.cache_creation_input_tokens || 0),
    });
  }
  return turns;
}

// USD cost of an aggregated {model, input, output, cacheRead, cacheWrite} group.
function costOf(g) {
  const r = getRate(g.model);
  const usd = (
    g.input * r.input +
    g.output * r.output +
    g.cacheRead * r.input * CACHE_READ_MULT +
    g.cacheWrite * r.input * CACHE_WRITE_MULT
  ) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6; // 6dp — sub-cent costs stay meaningful
}

// Aggregate the turns at index >= startIndex, grouped by model.
// Returns { totalTurns, deltas: [{model, input, output, cacheRead, cacheWrite,
// turns, cost_usd}] }. `totalTurns` is the new cursor value to persist.
function aggregateSince(turns, startIndex) {
  const total = Array.isArray(turns) ? turns.length : 0;
  let start = Number.isFinite(startIndex) && startIndex > 0 ? Math.floor(startIndex) : 0;
  // Transcript shrank (rotation/compaction → fewer lines than already logged):
  // re-baseline to current length and emit nothing, rather than re-log the file
  // and double-count. Rare; a one-time minor undercount is the safe trade.
  if (start > total) return { totalTurns: total, deltas: [] };

  const byModel = new Map();
  for (const t of turns.slice(start)) {
    const g = byModel.get(t.model) ||
      { model: t.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    g.input += t.input;
    g.output += t.output;
    g.cacheRead += t.cacheRead;
    g.cacheWrite += t.cacheWrite;
    g.turns += 1;
    byModel.set(t.model, g);
  }
  const deltas = [...byModel.values()].map((g) => ({ ...g, cost_usd: costOf(g) }));
  return { totalTurns: total, deltas };
}

module.exports = {
  PRICING, CACHE_READ_MULT, CACHE_WRITE_MULT,
  getRate, parseAssistantTurns, costOf, aggregateSince,
};
