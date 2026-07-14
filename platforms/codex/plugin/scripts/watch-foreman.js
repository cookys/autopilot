#!/usr/bin/env node
'use strict';
// watch-foreman.js — depth-0 LIVE SENSING for a dispatched /l4 /l5 /l6 foreman run
// (dispatch-observability S3-lite: sensing ONLY, no scheduling, no intervention).
//
// Composes the two observation substrates that already exist:
//   - the foreman's run-ledger (scripts/run-ledger.sh JSONL: stage acquire /
//     transition / heartbeat records) — the foreman-level phase view;
//   - the dispatch run-manifest dir (dispatch-status.js contract) — the leaf
//     hetero-dispatch view (implementer/reviewer runs the foreman spawns).
//
// Emits ONE LINE PER EVENT on stdout (line-buffered), designed to sit behind the
// CC Monitor tool — or run with --once as a plain snapshot poller on any harness:
//   STAGE run=<id> <stage> <state> gen=<g> reason=<r>     ledger stage change
//   LEAF_START <run-id> role=<role> <runner>/<model>      new dispatch manifest
//   LEAF_END <run-id> <final_status>                      manifest finalized
//   LEAF_STALL <run-id> log quiet <age>s (report-only)    live leaf log went quiet
//   QUIET <age>s since last ledger event (report-only)    foreman ledger went quiet
//   WAIT ledger not created yet                           foreman not started
//
// REPORT-ONLY DISCIPLINE (l6-resilience R6, the 2026-07-08 two-cooks crash):
// QUIET / LEAF_STALL are observations, never verdicts. A quiet foreman is usually
// doing between-turns work. The consumer MUST first cross-check (ledger tail, leaf
// liveness via dispatch-status.js --run, git activity) and must NEVER grab a stage
// the foreman holds a lease on. This tool deliberately has no kill/steer surface.
//
// Usage:
//   node scripts/watch-foreman.js --ledger <path> [--runs-dir <dir>]
//     [--interval-secs 30] [--quiet-secs 600] [--max-secs 0] [--once]
//
// Exit: 0 (clean end / --once / --max-secs reached), 2 usage.

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    ledger: '',
    runsDir: process.env.AUTOPILOT_DISPATCH_RUNS_DIR
      || path.join(process.env.TMPDIR || '/tmp', 'autopilot-dispatch-runs'),
    intervalSecs: 30,
    quietSecs: 600,
    maxSecs: 0,
    once: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--ledger') args.ledger = argv[++i] || '';
    else if (a === '--runs-dir') args.runsDir = argv[++i] || '';
    else if (a === '--interval-secs') args.intervalSecs = Number(argv[++i]);
    else if (a === '--quiet-secs') args.quietSecs = Number(argv[++i]);
    else if (a === '--max-secs') args.maxSecs = Number(argv[++i]);
    else if (a === '--once') args.once = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { process.stderr.write(`unknown argument: ${a}\n`); process.exit(2); }
  }
  if (!args.ledger) { process.stderr.write('--ledger is required\n'); process.exit(2); }
  for (const [k, v] of [['interval-secs', args.intervalSecs], ['quiet-secs', args.quietSecs], ['max-secs', args.maxSecs]]) {
    if (!Number.isFinite(v) || v < 0) { process.stderr.write(`--${k} must be a non-negative number\n`); process.exit(2); }
  }
  return args;
}

function printHelp() {
  const src = fs.readFileSync(__filename, 'utf8');
  for (const line of src.split('\n')) {
    if (line.startsWith('//')) process.stdout.write(`${line.replace(/^\/\/ ?/, '')}\n`);
    else if (!line.startsWith('#!') && !line.startsWith("'use strict'")) break;
  }
}

function tsToMs(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

const state = {
  ledgerOffset: 0,
  ledgerSeenWait: false,
  lastLedgerEventMs: null,
  quietAnnounced: false,
  stageState: new Map(),   // stage -> `${state}:${generation}`
  leaves: new Map(),       // run_id -> { ended: bool, stallAnnounced: bool }
};

function emit(line) {
  process.stdout.write(`${line}\n`);
}

function tickLedger(args, nowMs) {
  let stat;
  try { stat = fs.statSync(args.ledger); } catch (_e) {
    if (!state.ledgerSeenWait) { emit('WAIT ledger not created yet'); state.ledgerSeenWait = true; }
    return;
  }
  if (stat.size > state.ledgerOffset) {
    const fd = fs.openSync(args.ledger, 'r');
    const buf = Buffer.alloc(stat.size - state.ledgerOffset);
    fs.readSync(fd, buf, 0, buf.length, state.ledgerOffset);
    fs.closeSync(fd);
    state.ledgerOffset = stat.size;
    for (const line of buf.toString('utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let rec;
      try { rec = JSON.parse(t); } catch (_e) { continue; }
      const ms = tsToMs(rec.heartbeat_ts) || tsToMs(rec.ts);
      if (ms && (!state.lastLedgerEventMs || ms > state.lastLedgerEventMs)) state.lastLedgerEventMs = ms;
      if (rec.kind !== 'stage' || !rec.stage) continue;
      if (rec.reason === 'heartbeat') continue; // liveness signal, not an event
      const key = `${rec.state}:${rec.generation}`;
      if (state.stageState.get(rec.stage) !== key) {
        state.stageState.set(rec.stage, key);
        emit(`STAGE run=${rec.run_id || '?'} ${rec.stage} ${rec.state} gen=${rec.generation} reason=${rec.reason || ''}`);
      }
    }
  }
  // Use file mtime as the freshest liveness signal (covers heartbeat rewrites too).
  const mtimeMs = stat.mtimeMs;
  if (!state.lastLedgerEventMs || mtimeMs > state.lastLedgerEventMs) state.lastLedgerEventMs = mtimeMs;
  const ageS = Math.round((nowMs - state.lastLedgerEventMs) / 1000);
  if (args.quietSecs > 0 && ageS > args.quietSecs) {
    if (!state.quietAnnounced) {
      emit(`QUIET ${ageS}s since last ledger event (report-only: check between-turns work / leaf liveness BEFORE intervening; never grab a leased stage — R6 two-cooks rule)`);
      state.quietAnnounced = true;
    }
  } else {
    state.quietAnnounced = false;
  }
}

function tickLeaves(args, nowMs) {
  let entries = [];
  try {
    entries = fs.readdirSync(args.runsDir).filter((f) => f.endsWith('.manifest.json'));
  } catch (_e) { return; }
  for (const f of entries) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(args.runsDir, f), 'utf8')); } catch (_e) { continue; }
    if (!m || typeof m !== 'object' || !m.run_id) continue;
    // Only report leaves born after the watcher started (historic manifests are noise).
    const startedMs = tsToMs(m.started_epoch) || tsToMs(m.started_at);
    if (startedMs !== null && startedMs < state.watchStartMs && !state.leaves.has(m.run_id)) continue;
    const ended = Boolean(m.ended_at || m.final_status);
    const known = state.leaves.get(m.run_id);
    let entry = known;
    if (!entry) {
      entry = { ended, stallAnnounced: false };
      state.leaves.set(m.run_id, entry);
      emit(`LEAF_START ${m.run_id} role=${m.role || '?'} ${m.runner || '?'}/${m.model || '?'}`);
      if (ended) { emit(`LEAF_END ${m.run_id} ${m.final_status || 'ended'}`); continue; }
      // fall through: a live leaf gets its stall check on FIRST sighting too
    } else if (!entry.ended && ended) {
      entry.ended = true;
      emit(`LEAF_END ${m.run_id} ${m.final_status || 'ended'}`);
      continue;
    }
    const known2 = entry;
    if (!ended && args.quietSecs > 0 && m.log_path) {
      let logStat = null;
      try { logStat = fs.statSync(m.log_path); } catch (_e) { /* log gone */ }
      if (logStat) {
        const ageS = Math.round((nowMs - logStat.mtimeMs) / 1000);
        if (ageS > args.quietSecs && !known2.stallAnnounced) {
          known2.stallAnnounced = true;
          emit(`LEAF_STALL ${m.run_id} log quiet ${ageS}s (report-only — confirm with dispatch-status.js --run ${m.run_id})`);
        } else if (ageS <= args.quietSecs) {
          known2.stallAnnounced = false;
        }
      }
    }
  }
}

function snapshot(args) {
  // --once: current view, then exit — the non-Monitor / non-CC fallback.
  state.watchStartMs = 0; // include historic leaves in a snapshot
  tickLedger(args, Date.now());
  tickLeaves(args, Date.now());
  const stages = Array.from(state.stageState.entries()).map(([s, v]) => `${s}=${v}`).join(' ') || '(none)';
  const live = Array.from(state.leaves.entries()).filter(([, v]) => !v.ended).map(([k]) => k).join(' ') || '(none)';
  emit(`SNAPSHOT stages: ${stages} | live leaves: ${live}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  state.watchStartMs = Date.now();
  if (args.once) { snapshot(args); return; }
  const startMs = Date.now();
  const tick = () => {
    const nowMs = Date.now();
    tickLedger(args, nowMs);
    tickLeaves(args, nowMs);
    if (args.maxSecs > 0 && (nowMs - startMs) / 1000 >= args.maxSecs) process.exit(0);
  };
  tick();
  setInterval(tick, Math.max(1, args.intervalSecs) * 1000);
}

main();
