#!/usr/bin/env node
/**
 * context-budget — PostToolUse * (opt-in, default-off; v2.32.26)
 *
 * Measures the REAL context size (last assistant `message.usage` in the
 * transcript: input + cache_read + cache_creation) and nudges/directs session
 * splitting at thresholds. Born of the 2026-07-14 transcript study: 96%+ of
 * all tokens were cache_read on ever-growing depth-0 sessions (1.12B-token
 * single session worst case) — context cost ≈ length × remaining messages,
 * quadratic in session length. suggest-compact counts tool calls (a proxy);
 * this hook reads the actual curve.
 *
 * Tiers (defaults; override via ~/.autopilot/config.json context_budget
 * {t1,t2,mode} or env AUTOPILOT_CONTEXT_BUDGET_T1/T2/MODE):
 *  - T1 (100k): stderr nudge, exit 0 (user-visible). Refire ≤ every 20 calls.
 *  - T2 (150k): escalated advisory, exit 2 (stderr fed to the MODEL): write a
 *    handoff NOW + user-facing "/clear after it lands". Refire ≤ every 10
 *    calls. PostToolUse cannot deny and /clear is a USER action — no pretend
 *    enforcement (MiniMax panel finding). T3 deny tier deliberately DEFERRED
 *    until warn-mode calibration exists (see plan §Out of scope).
 *
 * Cost control: below T1 the transcript is parsed only every 5th call; at/after
 * T1, every call (burst-overshoot finding). State (call counters, last-fire
 * marks) lives in ~/.autopilot/context-budget/<sid>.json — host-stable, NOT
 * TMPDIR (docker-exec visibility); corrupt state ⇒ reset-and-continue.
 *
 * Enable: ~/.autopilot/config.json {"hooks":{"context-budget":true}} or
 * AUTOPILOT_HOOK_CONTEXT_BUDGET=1.
 * Fail-open: any error ⇒ exit 0. Separate state/script from
 * orchestrator-edit-gate (single-crash isolation, panel finding).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isEnabled } = require('./_shared/opt-in');
const { readContextTokens, budgetDecision } = require('./context-budget-lib.js');

const PARSE_EVERY_BELOW_T1 = 5;

function getSessionId() {
  const raw = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.cwd();
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function stateDir() {
  return process.env.AUTOPILOT_CONTEXT_BUDGET_DIR
    || path.join(os.homedir(), '.autopilot', 'context-budget');
}

function loadConfig() {
  const cfg = { t1: 100_000, t2: 150_000, mode: 'warn' };
  try {
    const file = path.join(os.homedir(), '.autopilot', 'config.json');
    const user = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cb = user && user.context_budget;
    if (cb && typeof cb === 'object') {
      if (Number.isFinite(cb.t1)) cfg.t1 = cb.t1;
      if (Number.isFinite(cb.t2)) cfg.t2 = cb.t2;
      if (cb.mode === 'off' || cb.mode === 'warn') cfg.mode = cb.mode;
    }
  } catch { /* absent/corrupt config → defaults */ }
  const envT1 = Number(process.env.AUTOPILOT_CONTEXT_BUDGET_T1);
  const envT2 = Number(process.env.AUTOPILOT_CONTEXT_BUDGET_T2);
  if (Number.isFinite(envT1) && envT1 > 0) cfg.t1 = envT1;
  if (Number.isFinite(envT2) && envT2 > 0) cfg.t2 = envT2;
  if (process.env.AUTOPILOT_CONTEXT_BUDGET_MODE === 'off') cfg.mode = 'off';
  return cfg;
}

function loadState(file) {
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (st && typeof st === 'object' && Number.isFinite(st.calls)) return st;
  } catch { /* corrupt/absent ⇒ reset-and-continue */ }
  return { calls: 0, lastT1Call: 0, lastT2Call: 0, lastContext: 0 };
}

function saveState(file, st) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
}

(function main() {
  let exitCode = 0;
  try {
    if (!isEnabled('context-budget')) process.exit(0);
    const cfg = loadConfig();
    if (cfg.mode === 'off') process.exit(0);

    let payload = {};
    // fd 0, not '/dev/stdin': the device path throws ENXIO under piped spawns
    // (#6305 — the same trap documented in suggest-compact.js).
    try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* fail-open */ }
    const tpath = payload && payload.transcript_path;
    if (!tpath || typeof tpath !== 'string') process.exit(0);

    fs.mkdirSync(stateDir(), { recursive: true });
    const stateFile = path.join(stateDir(), `${getSessionId()}.json`);
    const st = loadState(stateFile);
    st.calls += 1;

    // Cheap path below T1: parse only every Nth call. Once T1 territory has
    // been seen, parse every call (a burst can overshoot fast).
    const mustParse = st.lastContext >= cfg.t1 || st.calls % PARSE_EVERY_BELOW_T1 === 0 || st.calls === 1;
    if (mustParse) {
      const tokens = readContextTokens(tpath);
      if (tokens !== null) {
        st.lastContext = tokens;
        const d = budgetDecision(
          { contextTokens: tokens, calls: st.calls, lastT1Call: st.lastT1Call, lastT2Call: st.lastT2Call },
          cfg,
        );
        if (d.tier === 't1') {
          st.lastT1Call = st.calls;
          process.stderr.write(`${d.message}\n`);
        } else if (d.tier === 't2') {
          st.lastT2Call = st.calls;
          process.stderr.write(`${d.message}\n`);
          exitCode = 2; // PostToolUse exit 2 ⇒ stderr reaches the model
        }
      }
    }
    saveState(stateFile, st);
  } catch (e) {
    try { process.stderr.write(`context-budget error (fail-open): ${e.message}\n`); } catch { /* ignore */ }
    exitCode = 0;
  }
  process.exit(exitCode);
})();
