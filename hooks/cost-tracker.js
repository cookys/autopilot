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

const { parseAssistantTurns, aggregateSince, getRate, hasPriceRow, CACHE_READ_MULT } = require('./cost-tracker-lib');
const { resolveTranscriptPath } = require('./transcript-reader-lib');

function sanitizeSession(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
}

// Real window fill, read the way context-budget reads it: the statusline live file
// (<live-dir>/context/<sid>.json), fresh <=120s and schema-valid, else null (unknown).
// Never throws.
function readContextNow(sid) {
  try {
    const { resolveLiveDir, sanitizeSessionId, readLive } = require('../scripts/lib/live-state-dir.js');
    const live = readLive(resolveLiveDir().base, sanitizeSessionId(sid), { kind: 'main' });
    const cw = live && live.context_window;
    if (!cw) return null;
    const window = Number(cw.context_window_size);
    const tokens = Number(cw.total_input_tokens);
    if (!(window > 0) || !Number.isFinite(tokens)) return null;
    const pct = Number.isFinite(Number(cw.used_percentage))
      ? Math.round(Number(cw.used_percentage)) : Math.round((tokens / window) * 100);
    return { pct, tokens, window };
  } catch { return null; }
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
  let cursor = {};
  try { cursor = JSON.parse(fs.readFileSync(cursorFile, 'utf8')) || {}; processed = Number(cursor.turns) || 0; }
  catch { /* first run for this session → 0 */ }
  // Cursor writes are tmp+rename and PRESERVE unrelated fields (cache_read_warned lives
  // here too; the plain overwrite reset it every turn — review round 1, gpt-5.6-sol).
  const writeCursor = (patch) => {
    cursor = { ...cursor, ...patch };
    const tmp = `${cursorFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cursor));
    fs.renameSync(tmp, cursorFile);
  };

  const { totalTurns, deltas } = aggregateSince(turns, processed);

  // Always advance the cursor (covers the no-new-turns and shrink/re-baseline
  // cases) so a stuck cursor never re-logs. The cursor read→write + costs.jsonl
  // append are unlocked; correctness relies on the Stop hook firing serially per
  // session (it does — one Stop per assistant turn). Per-session cursor files
  // mean different sessions never contend.
  const ts = new Date().toISOString();
  writeCursor({ turns: totalTurns, ts });

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
    // What this counts: the SUM of cache_read_tokens over every call of this session
    // (calls x window) — a spend figure, NOT how full the window is. Alongside it we gather
    // the call count and its dollar share, so the message can say so.
    let cacheRead = 0;
    let calls = 0;
    let readUsd = 0;
    let totalUsd = 0;
    let priced = true;
    for (const line of fs.readFileSync(costsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.session !== session) continue;
        const cr = Number(r.cache_read_tokens) || 0;
        cacheRead += cr;
        calls += Number(r.turns) || 0;
        totalUsd += Number(r.cost_usd) || 0;
        if (!hasPriceRow(r.model)) priced = false;
        else readUsd += (cr * getRate(r.model).input * CACHE_READ_MULT) / 1_000_000;
      } catch { /* skip */ }
    }
    const warned = Number(cursor.cache_read_warned) || 0;
    let next = warned ? warned * 2 : threshold;
    if (cacheRead >= next) {
      while (cacheRead >= next * 2) next *= 2;
      const fmt = (n) => n.toLocaleString('en-US');
      const spend = priced && totalUsd > 0
        ? `~$${readUsd.toFixed(2)} ≈ ${Math.round((readUsd / totalUsd) * 100)}% of this session's spend, at ledger rates`
        : 'cost unknown (a model in this session has no price row)';
      const ctx = readContextNow(input.session_id || session);
      const ctxText = ctx
        ? `context now ${ctx.pct}% (${fmt(ctx.tokens)} of ${fmt(ctx.window)} tokens)`
        : 'context % unknown (no fresh statusline live file)';
      // Recommend handoff + /clear ONLY when the real window fill is at/above the threshold.
      // Below it the window is healthy and the money is calls x window (so split the work or
      // push mechanical work to cheaper hands); with no fresh live file there is no % to act on,
      // so no /clear advice at all.
      let clearPct = 50;
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.autopilot', 'config.json'), 'utf8'));
        const c = cfg && cfg.cost_tracker && Number(cfg.cost_tracker.context_clear_pct);
        if (Number.isFinite(c) && c > 0) clearPct = c;
      } catch { /* default */ }
      const envC = Number(process.env.AUTOPILOT_COST_TRACKER_CLEAR_PCT);
      if (Number.isFinite(envC) && envC > 0) clearPct = envC;
      let advice;
      if (ctx && ctx.pct >= clearPct) {
        advice = `The window is ${ctx.pct}% full (≥ ${clearPct}%): write a handoff and /clear, or split the work.`;
      } else if (ctx) {
        advice = 'The window is fine; the cost comes from calls × window — consider splitting the work or dispatching mechanical work to cheaper hands.';
      } else {
        advice = 'No window reading is available, so the window itself is not judged; if the work is mechanical, consider splitting it or dispatching it to cheaper hands.';
      }
      const msg = `cost-tracker: session ${session} has read ${fmt(cacheRead)} cache tokens cumulatively across ${fmt(calls)} calls (threshold ${fmt(next)}) — ${spend}; this is a cost sum (calls × window), not window fill. ${ctxText}. ${advice}`;
      process.stderr.write(`${msg}\n`);
      try {
        const sid = input.session_id;
        const qtext = msg;
        if (typeof sid === 'string' && sid.length > 0 && require('./_shared/advisory-sink.js').advisoryMode('cost_tracker') === 'sink') {
          // P7a advisory bridge: the owner's nudge goes to <live>/advisories/<sid>.jsonl (shown by the live mod), not the
          // model's context. AUTOPILOT_ADVISORY_BRIDGE_COST_TRACKER=inject restores the advisory-queue -> advisory-relay path.
          require('./_shared/advisory-sink.js').writeAdvisory({ sid, kind: 'cost-tracker', severity: 'warn', text: qtext });
        } else if (typeof sid === 'string' && sid.length > 0) {
          const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
          const qdir = path.join(resolveLiveDir().base, 'advisory-queue');
          fs.mkdirSync(qdir, { recursive: true });
          const qfile = path.join(qdir, `${sanitizeSessionId(sid)}.jsonl`);
          const qfd = fs.openSync(qfile, 'a');
          try {
            fs.writeSync(qfd, `${JSON.stringify({ ts: new Date().toISOString(), source: 'cost-tracker', text: qtext })}\n`);
          } finally { fs.closeSync(qfd); }
          const qlines = fs.readFileSync(qfile, 'utf8').split('\n').filter((l) => l.length > 0);
          const qents = [];
          for (const ql of qlines) {
            try { qents.push(JSON.parse(ql)); } catch {
              process.stderr.write('cost-tracker: debug dropped corrupt advisory-queue line\n');
            }
          }
          const qdump = () => qents.map((e) => `${JSON.stringify(e)}\n`).join('');
          while (qents.length > 20) {
            qents.shift();
            process.stderr.write('cost-tracker: debug dropped advisory-queue entry (cap eviction)\n');
          }
          while (qents.length > 1 && Buffer.byteLength(qdump(), 'utf8') > 8192) {
            qents.shift();
            process.stderr.write('cost-tracker: debug dropped advisory-queue entry (cap eviction)\n');
          }
          if (qents.length === 1 && Buffer.byteLength(qdump(), 'utf8') > 8192) {
            let t = typeof qents[0].text === 'string' ? qents[0].text : '';
            while (t.length > 0 && Buffer.byteLength(`${JSON.stringify({ ...qents[0], text: t })}\n`, 'utf8') > 8192) t = t.slice(0, -1);
            qents[0].text = t;
            process.stderr.write('cost-tracker: debug dropped advisory-queue entry (cap eviction)\n');
          }
          const tmpPath = `${qfile}.tmp.${process.pid}`;
          fs.writeFileSync(tmpPath, qdump());
          fs.renameSync(tmpPath, qfile);
        } else {
          process.stderr.write('cost-tracker: debug missing/empty session_id; advisory not enqueued\n');
        }
      } catch { /* queue is best-effort */ }
      writeCursor({ cache_read_warned: next });
    }
  } catch { /* report is best-effort */ }
  process.exit(0);
} catch (e) {
  process.stderr.write(`cost-tracker error: ${e.message}\n`);
  process.exit(0);
}
