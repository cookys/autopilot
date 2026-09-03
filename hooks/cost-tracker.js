#!/usr/bin/env node
/**
 * cost-tracker — Stop (default-on since v2.35.15; opt-in before)
 * Logs per-session token usage + estimated cost to ~/.claude/metrics/costs.jsonl.
 * Opt-out: set AUTOPILOT_COST_TRACKER=false (or autopilot.costTracker=false in
 * settings.json, injected as that env var).
 *
 * The Stop hook fires once per assistant turn, but the 2.1.186 Stop payload has
 * NO usage field — so usage is summed from the transcript (`transcript_path` in
 * the payload). Because the transcript is cumulative and Stop fires per turn, a
 * per-session cursor (~/.claude/metrics/.cursors/<session>.json) tracks how many
 * assistant turns were already logged, and only NEW turns are appended each Stop.
 * Summing every row in costs.jsonl then yields the true session cost with no
 * double-count. See cost-tracker-lib.js for the aggregation.
 *
 * Fail-open: any error → exit 0, write nothing (a metrics hook must never block).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
// default-on since v2.35.15 (was opt-in); opt out with AUTOPILOT_COST_TRACKER=false.

const { parseAssistantTurns, aggregateSince } = require('./cost-tracker-lib');
const { resolveTranscriptPath } = require('./transcript-reader-lib');

function sanitizeSession(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
}

try {
  // Read fd 0 (the '/dev/stdin' PATH ENXIOs in this env; fd 0 carries the payload).
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch { raw = fs.readFileSync('/dev/stdin', 'utf8'); }
  const input = JSON.parse(raw);

  // Opt-out (settings.json injects autopilot.costTracker as this env var).
  if (process.env.AUTOPILOT_COST_TRACKER === 'false') process.exit(0);

  const session = input.session_id || process.env.CLAUDE_CODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID || 'unknown';

  // Locate the transcript: payload field first, then UUID glob fallback. The
  // glob keys on session_id (the UUID == transcript filename) — prefer the
  // payload's session_id (what `session` above uses) over the env var, else a
  // payload with session_id but an unusable transcript_path silently loses its
  // metrics when CLAUDE_CODE_SESSION_ID is unset.
  let tpath = input.transcript_path;
  if (!tpath || !fs.existsSync(tpath)) {
    tpath = resolveTranscriptPath({
      sessionId: input.session_id || process.env.CLAUDE_CODE_SESSION_ID,
    });
  }
  if (!tpath) process.exit(0);

  let transcript;
  try { transcript = fs.readFileSync(tpath, 'utf8'); } catch { process.exit(0); }

  const turns = parseAssistantTurns(transcript);
  if (turns.length === 0) process.exit(0);

  const metricsDir = path.join(os.homedir(), '.claude', 'metrics');
  const cursorDir = path.join(metricsDir, '.cursors');
  fs.mkdirSync(cursorDir, { recursive: true });
  const cursorFile = path.join(cursorDir, `${sanitizeSession(session)}.json`);

  let processed = 0;
  try { processed = Number(JSON.parse(fs.readFileSync(cursorFile, 'utf8')).turns) || 0; }
  catch { /* first run for this session → 0 */ }

  const { totalTurns, deltas } = aggregateSince(turns, processed);

  // Always advance the cursor (covers the no-new-turns and shrink/re-baseline
  // cases) so a stuck cursor never re-logs. The cursor read→write + costs.jsonl
  // append are unlocked; correctness relies on the Stop hook firing serially per
  // session (it does — one Stop per assistant turn). Per-session cursor files
  // mean different sessions never contend.
  const ts = new Date().toISOString();
  fs.writeFileSync(cursorFile, JSON.stringify({ turns: totalTurns, ts }));

  if (deltas.length === 0) process.exit(0); // nothing new since last Stop

  const cwd = input.cwd || process.cwd();
  const rows = deltas.map((d) => JSON.stringify({
    ts,
    session,
    model: d.model,
    input_tokens: d.input,
    output_tokens: d.output,
    cache_read_tokens: d.cacheRead,
    cache_write_tokens: d.cacheWrite,
    turns: d.turns,
    cost_usd: d.cost_usd,
    cwd,
  })).join('\n') + '\n';

  const costsFile = path.join(metricsDir, 'costs.jsonl');
  fs.appendFileSync(costsFile, rows);
  // Cumulative cache-read report (v2.35.15, cuda digest #6): the money is in cache_read
  // on long-lived sessions, and nobody saw it accumulate. Sum THIS session's rows and
  // print one stderr line the first time the total crosses the threshold and at each
  // doubling after. Threshold: ~/.autopilot/config.json cost_tracker.cache_read_warn_tokens
  // or AUTOPILOT_COST_TRACKER_CACHE_READ_WARN (default 50M tokens). Fail-open.
  try {
    let threshold = 50000000;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.autopilot', 'config.json'), 'utf8'));
      const t = cfg && cfg.cost_tracker && Number(cfg.cost_tracker.cache_read_warn_tokens);
      if (Number.isFinite(t) && t > 0) threshold = t;
    } catch { /* default */ }
    const envT = Number(process.env.AUTOPILOT_COST_TRACKER_CACHE_READ_WARN);
    if (Number.isFinite(envT) && envT > 0) threshold = envT;
    let cacheRead = 0;
    for (const line of fs.readFileSync(costsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.session === session) cacheRead += Number(r.cache_read_tokens) || 0; } catch { /* skip */ }
    }
    let warned = 0;
    try { warned = Number(JSON.parse(fs.readFileSync(cursorFile, 'utf8')).cache_read_warned) || 0; } catch { /* none */ }
    let next = warned ? warned * 2 : threshold;
    if (cacheRead >= next) {
      while (cacheRead >= next * 2) next *= 2;
      process.stderr.write(`cost-tracker: session ${session} has read ${cacheRead.toLocaleString('en-US')} cache tokens cumulatively (threshold ${next.toLocaleString('en-US')}) — a long-lived context is being re-read on every call; write a handoff and /clear, or split the work (docs/ironlaw-to-gate-map.md #6).\n`);
      fs.writeFileSync(cursorFile, JSON.stringify({ turns: totalTurns, ts, cache_read_warned: next }));
    }
  } catch { /* report is best-effort */ }
  process.exit(0);
} catch (e) {
  process.stderr.write(`cost-tracker error: ${e.message}\n`);
  process.exit(0);
}
