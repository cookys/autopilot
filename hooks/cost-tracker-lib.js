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

// Cache WRITE is billed at 125% of a model's input rate (5-minute ephemeral cache create).
// Cache READ is NOT a uniform fraction of input any more (0.25/10 for fable-5-1 but 1.00/10 for
// fable-5, 0.20/4 for opus-5-5, ...), so every row carries its own absolute `cacheRead` price.
// CACHE_READ_MULT is kept exported for compatibility only; it no longer drives any pricing.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

// Per-model-id pricing, USD per 1M tokens (source: claude-api skill price table, cached 2026-10-06).
// Update when Anthropic changes pricing. Rows already written to costs.jsonl keep their old
// `cost_usd`: they are NOT repriced (no backfill) -- only new rows use this table.
// haiku-5-5 has a long-prompt tier (prompts >100K tokens: 0.50 in / 2.50 out). Per-request prompt
// size is unknown at costOf time (the ledger aggregates many turns), so the <=100K rate is used:
// a known under-estimate for >100K-prompt haiku-5-5 turns.
const PRICING = {
  'claude-fable-5-1':   { input: 10,   output: 50,  cacheRead: 0.25 },
  'claude-mythos-5-1':  { input: 10,   output: 50,  cacheRead: 0.25 },
  'claude-fable-5':     { input: 10,   output: 50,  cacheRead: 1.00 },
  'claude-mythos-5':    { input: 10,   output: 50,  cacheRead: 1.00 },
  'claude-opus-5-5':    { input: 4,    output: 20,  cacheRead: 0.20 },
  'claude-opus-5':      { input: 5,    output: 25,  cacheRead: 0.50 },
  'claude-opus-4-8':    { input: 5,    output: 25,  cacheRead: 0.50 },
  'claude-opus-4-7':    { input: 5,    output: 25,  cacheRead: 0.50 },
  'claude-opus-4-6':    { input: 5,    output: 25,  cacheRead: 0.50 },
  'claude-sonnet-5-5':  { input: 2,    output: 10,  cacheRead: 0.20 },
  'claude-sonnet-5':    { input: 2,    output: 10,  cacheRead: 0.20 },
  'claude-sonnet-4-6':  { input: 3,    output: 15,  cacheRead: 0.30 },
  'claude-haiku-5-5':   { input: 0.10, output: 0.50, cacheRead: 0.01 },
  'claude-haiku-4-5':   { input: 1,    output: 5,   cacheRead: 0.10 },
};

// Unknown models fall back to this row for arithmetic ONLY (do NOT invent pricing for an
// unverified tier -- hasPriceRow() stays false so callers print "cost unknown", not a guess).
const FALLBACK_ID = 'claude-sonnet-5-5';
// parseAssistantTurns defaults a missing model to the bare word 'sonnet'; keep that priced as the
// sonnet-5-5 row (callers relied on hasPriceRow('sonnet') === true). Other bare family words are unknown.
const BARE_ALIASES = { sonnet: FALLBACK_ID };

// Normalise a transcript model id: lowercase, strip provider prefix (`us.anthropic.`, `anthropic.`),
// a `[...]` suffix (e.g. `[1m]`), and a trailing `-YYYYMMDD` date.
function normalizeModel(model) {
  let m = String(model || '').toLowerCase().trim();
  m = m.replace(/\[[^\]]*\]\s*$/, '');
  m = m.replace(/^(?:[a-z]{2}\.)?anthropic\./, '');
  m = m.replace(/-v\d+(?::\d+)?$/, ''); // bedrock `-v1:0`
  m = m.replace(/-\d{8}$/, '');
  return m;
}

// Row id for a model, or null. Exact match after normalisation, else longest row id that is a
// prefix at a `-` boundary; so `claude-opus-5-5` never resolves to `claude-opus-5`.
function resolveRowId(model) {
  const m = normalizeModel(model);
  if (BARE_ALIASES[m]) return BARE_ALIASES[m];
  if (PRICING[m]) return m;
  let best = null;
  for (const id of Object.keys(PRICING)) {
    if (m.startsWith(id + '-') && (!best || id.length > best.length)) best = id;
  }
  return best;
}

function getRate(model) {
  return PRICING[resolveRowId(model) || FALLBACK_ID];
}

// True when the model has its OWN price row (getRate's fallback is not a price row).
// Callers that print dollars use this to say "cost unknown" instead of presenting a guess.
function hasPriceRow(model) {
  return resolveRowId(model) !== null;
}

// Parse transcript JSONL text → ordered list of assistant-turn usage records.
// Each: { model, input, output, cacheRead, cacheWrite, ts? }. Order = file order
// (append-only), which the cursor relies on. Extra fields: sidechain, agentId.
//
// DEDUP: Claude Code writes ONE API response as several transcript lines (one per content
// block), each repeating the response's `message.usage`. Counting every line inflates a long
// session ~2.5x (measured locally: 813 assistant lines = 391 distinct responses; cache_creation
// 8.8M raw vs 3.5M deduped). Lines are keyed by (message.id, requestId) and counted once, at the
// position of the first line; the per-field MAX is kept because output_tokens can grow while a
// response streams. A line with no message.id cannot be keyed and counts as its own turn.
//
// SIDECHAIN: `rec.isSidechain === true` / `rec.agentId` mark subagent lines. Claude Code stores
// subagent transcripts in separate files (<session>/subagents/agent-<id>.jsonl), not in the main
// transcript, so cost-tracker.js reads those files itself; the flag keeps the parser correct for
// those files (every line carries it) and if a transcript ever inlines sidechain lines.
function parseAssistantTurns(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const turns = [];
  const seen = new Map(); // dedup key -> turn
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.type !== 'assistant' || !rec.message) continue;
    const u = rec.message.usage;
    if (!u || typeof u !== 'object') continue;
    const t = {
      model: rec.message.model || 'sonnet',
      input: Number(u.input_tokens || 0),
      output: Number(u.output_tokens || 0),
      cacheRead: Number(u.cache_read_input_tokens || 0),
      cacheWrite: Number(u.cache_creation_input_tokens || 0),
      sidechain: rec.isSidechain === true,
      agentId: typeof rec.agentId === 'string' && rec.agentId ? rec.agentId : null,
    };
    // Additive: the record's timestamp in epoch ms, present only when it parses (hooks/subagent-budget.js windows on it).
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    if (Number.isFinite(ts)) t.ts = ts;
    const mid = rec.message.id;
    if (typeof mid === 'string' && mid) {
      const key = `${mid}|${typeof rec.requestId === 'string' ? rec.requestId : ''}`;
      const prev = seen.get(key);
      if (prev) {
        prev.input = Math.max(prev.input, t.input);
        prev.output = Math.max(prev.output, t.output);
        prev.cacheRead = Math.max(prev.cacheRead, t.cacheRead);
        prev.cacheWrite = Math.max(prev.cacheWrite, t.cacheWrite);
        continue;
      }
      seen.set(key, t);
    }
    turns.push(t);
  }
  return turns;
}

// USD cost of an aggregated {model, input, output, cacheRead, cacheWrite} group.
function costOf(g) {
  const r = getRate(g.model);
  const usd = (
    g.input * r.input +
    g.output * r.output +
    g.cacheRead * r.cacheRead +
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
    const key = `${t.model}\0${t.agentId || ''}`;
    const g = byModel.get(key) ||
      { model: t.model, agentId: t.agentId || null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    g.input += t.input;
    g.output += t.output;
    g.cacheRead += t.cacheRead;
    g.cacheWrite += t.cacheWrite;
    g.turns += 1;
    byModel.set(key, g);
  }
  const deltas = [...byModel.values()].map((g) => ({ ...g, cost_usd: costOf(g) }));
  return { totalTurns: total, deltas };
}

// Agent-tree fields from a subagent sidecar (agent-<id>.meta.json): {parentAgentId?, depth, agentType?}.
// Absent parentAgentId = parent is the main session. Returns {} when the sidecar is missing/unreadable/not
// an object, so callers write rows exactly as before. Never throws.
function readAgentTree(metaPath) {
  try {
    const m = JSON.parse(require('fs').readFileSync(metaPath, 'utf8'));
    if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
    const out = {};
    if (typeof m.parentAgentId === 'string' && m.parentAgentId) out.parentAgentId = m.parentAgentId;
    out.depth = Number.isInteger(m.spawnDepth) && m.spawnDepth > 0 ? m.spawnDepth : 1;
    if (typeof m.agentType === 'string' && m.agentType) out.agentType = m.agentType;
    return out;
  } catch { return {}; }
}

module.exports = {
  readAgentTree,
  PRICING, CACHE_READ_MULT, CACHE_WRITE_MULT, normalizeModel,
  getRate, hasPriceRow, parseAssistantTurns, costOf, aggregateSince,
};
