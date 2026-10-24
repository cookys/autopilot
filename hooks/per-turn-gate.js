#!/usr/bin/env node
'use strict';

/**
 * per-turn-gate — opt-in Stop hook (BL-0055 phase 2, plan docs/plans/2026-10-24-per-turn-gate-phase2.md).
 *
 * At the end of every turn it runs a project-supplied verifier and, when the verifier reports a
 * violation, blocks the stop once with the verifier's text so the model fixes it inside the same
 * session. Default OFF: it does nothing until `hooks.per-turn-gate` is enabled (opt-in.js) AND a
 * verifier command is configured.
 *
 * Knobs (config.json, no environment variables):
 *   per_turn_gate.verifier    command run as `<command> --turn <n> --repo <cwd> --json`
 *                             (same interface and exit codes as the t14 verify-turn.js: 0 clean,
 *                              1 violations, anything else is an error). It is exec'd through
 *                              `sh -c`, so give a simple command, not a pipeline.
 *   per_turn_gate.mode        "violations" (default): only exit 1 can block.
 *                             "violations+features" (W4, guidance): exit 0 with a non-empty
 *                             feature_gaps list blocks too, and the retry text lists the violations,
 *                             then the gaps, then a keep-what-works line. UNEVALUATED: the W4 trigger
 *                             and text have no ON/OFF evaluation until plan P2-4 returns PASS.
 *   per_turn_gate.max_blocks  blocks allowed per (session, turn); default 2 (the historical cap).
 *   per_turn_gate.timeout_ms  hard timeout for the verifier; default 30000.
 *
 * Decision: reportable and counter below the cap -> print {"decision":"block","reason":...} and
 * count it. Not reportable, cap reached, verifier error (crash, timeout, unparseable output, missing
 * command) or knob off -> allow. An error NEVER blocks.
 *
 * Log contract: every invocation appends exactly ONE record to
 * <live-state>/per-turn-gate/<session>.jsonl before it exits:
 *   {session, turn, prompt_id, decision: allow|block, reason: block|clean|cap|error|off, counter}
 * (prompt_id is the stdin field of that name, or null when absent)
 * so the record count equals the invocation count. `off` is written only when a verifier is
 * configured but the hook is not enabled (a hook nobody configured leaves no trace); in that case
 * `turn` is null and no counter state is touched.
 *
 * State (same directory): <session>.turn holds the current turn index; <session>.t<turn>.count holds
 * the number of blocks given in that turn.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isEnabled } = require('./_shared/opt-in.js');
const { configPath } = require('../scripts/lib/config-path.js');
const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');

const HOOK_STEM = 'per-turn-gate';
const DEFAULT_MAX_BLOCKS = 2;
const DEFAULT_TIMEOUT_MS = 30000;
const MODES = ['violations', 'violations+features'];

/**
 * TURN BOUNDARY RULE (single function so it can be replaced).
 * Confirmed by P2-0 on CLI 2.1.309 (docs/plans/evidence/2026-10-24-per-turn-gate-p2-0/README.md on
 * branch hands/ptg-p20/1): the first Stop of every turn has stop_hook_active false (also in a
 * resumed turn), a re-entry after a block has it true, and session_id is stable across resume.
 * stdin also carries prompt_id (constant within a turn, new on the next); it is logged as a
 * cross-check but is not the boundary rule.
 */
function startsNewTurn(payload) {
  return payload.stop_hook_active !== true;
}

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (_e) {
    return {};
  }
}

function intKnob(v, dflt, min) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min ? n : dflt;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return '';
  }
}

function readInt(file) {
  try {
    const n = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch (_e) {
    return 0;
  }
}

function writeInt(file, n) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${n}\n`);
  fs.renameSync(tmp, file);
}

/** Run the verifier. Returns {kind:'error'} or {kind:'clean'|'violations', json}. */
function runVerifier(command, turn, repo, timeoutMs) {
  if (typeof command !== 'string' || command.trim() === '') return { kind: 'error' };
  let r;
  try {
    r = spawnSync('/bin/sh', ['-c', `exec ${command} "$@"`, 'sh', '--turn', String(turn), '--repo', repo, '--json'], {
      cwd: repo,
      input: '',
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (_e) {
    return { kind: 'error' };
  }
  if (r.error || r.signal || (r.status !== 0 && r.status !== 1)) return { kind: 'error' };
  let json;
  try {
    json = JSON.parse(String(r.stdout || '').trim());
  } catch (_e) {
    return { kind: 'error' };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { kind: 'error' };
  return { kind: r.status === 1 ? 'violations' : 'clean', json };
}

/** Is this verifier result one the current mode may block on? */
function isReportable(result, mode) {
  if (result.kind === 'violations') return true;
  return mode === 'violations+features' && gapsOf(result.json).length > 0;
}

function gapsOf(json) {
  return json && Array.isArray(json.feature_gaps) ? json.feature_gaps : [];
}

/**
 * Retry text, the wording of gate_write_retry in evals/orchestration/run-orchestration-eval.sh.
 * Mode "violations+features" appends the feature gaps and the keep-what-works line (W4, unevaluated).
 */
function renderRetry(json, mode) {
  const real = Array.isArray(json.violations) ? json.violations : [];
  const gaps = gapsOf(json);
  const withGaps = mode === 'violations+features' && gaps.length > 0;
  const violations = real.length
    ? real
    : (withGaps ? [] : [{ constraint: '?', rule: 'unspecified', evidence: 'verifier reported a violation' }]);
  const lines = violations.map((v) =>
    `The change you just made breaks project rule ${v.constraint}: \`${v.rule}\`. Observed: \`${v.evidence}\`. Fix this without removing any feature you were asked for, and keep every other rule.`);
  let text = lines.length ? `${lines.join('\n\n')}\n` : '';
  if (withGaps) {
    const extra = gaps.map((g) => `A feature you were asked for so far is not working yet: \`${g}\`.`);
    extra.push('Keep the parts that already work; do not delete or break any existing feature.');
    text += `${extra.join('\n')}\n`;
  }
  return text;
}

// One record per invocation: `done` flips on the first write; `write` lets the outer catch log an error.
const LOG_STATE = { done: false, write: null };

function main() {
  const cfg = readConfig();
  const gate = cfg.per_turn_gate && typeof cfg.per_turn_gate === 'object' ? cfg.per_turn_gate : {};
  const enabled = isEnabled(HOOK_STEM);
  const hasVerifier = typeof gate.verifier === 'string' && gate.verifier.trim() !== '';
  if (!enabled && !hasVerifier) return; // never configured: leave no trace

  let payload = {};
  let payloadOk = true;
  try {
    payload = JSON.parse(readStdin() || '{}');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload');
  } catch (_e) {
    payload = {};
    payloadOk = false;
  }

  const rawSid = typeof payload.session_id === 'string' ? payload.session_id : '';
  const session = sanitizeSessionId(rawSid);
  let dir = null;
  try {
    dir = path.join(resolveLiveDir().base, HOOK_STEM);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (_e) {
    return; // no state directory: cannot count or log, so allow silently (fail-open)
  }

  const promptId = typeof payload.prompt_id === 'string' && payload.prompt_id ? payload.prompt_id : null;
  const log = (turn, decision, reason, counter) => {
    if (LOG_STATE.done) return;
    LOG_STATE.done = true;
    try {
      fs.appendFileSync(path.join(dir, `${session}.jsonl`),
        `${JSON.stringify({ session, turn, prompt_id: promptId, decision, reason, counter })}\n`);
    } catch (_e) { /* fail-open */ }
  };

  LOG_STATE.write = log;
  if (!enabled) {
    log(null, 'allow', 'off', 0);
    return;
  }

  const turnFile = path.join(dir, `${session}.turn`);
  const prevTurn = readInt(turnFile);
  const turn = prevTurn === 0 ? 1 : (startsNewTurn(payload) ? prevTurn + 1 : prevTurn);
  try { writeInt(turnFile, turn); } catch (_e) { /* fail-open */ }

  const countFile = path.join(dir, `${session}.t${turn}.count`);
  const counter = readInt(countFile);
  const maxBlocks = intKnob(gate.max_blocks, DEFAULT_MAX_BLOCKS, 0);
  const mode = MODES.includes(gate.mode) ? gate.mode : MODES[0];

  if (!payloadOk || !hasVerifier) {
    log(turn, 'allow', 'error', counter);
    return;
  }
  if (counter >= maxBlocks) {
    log(turn, 'allow', 'cap', counter);
    return;
  }

  const repo = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const result = runVerifier(gate.verifier, turn, repo, intKnob(gate.timeout_ms, DEFAULT_TIMEOUT_MS, 1));
  if (result.kind === 'error') {
    log(turn, 'allow', 'error', counter);
    return;
  }
  if (!isReportable(result, mode)) {
    log(turn, 'allow', 'clean', counter);
    return;
  }

  const next = counter + 1;
  try { writeInt(countFile, next); } catch (_e) {
    log(turn, 'allow', 'error', counter); // cannot count, so cannot bound: do not block
    return;
  }
  log(turn, 'block', 'block', next);
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: renderRetry(result.json, mode) })}\n`);
}

try {
  main();
} catch (_e) {
  // fail-open: an unexpected error never blocks a stop; it still leaves its one record
  try { if (LOG_STATE.write) LOG_STATE.write(null, 'allow', 'error', 0); } catch (_e2) { /* nothing */ }
}
process.exit(0);
