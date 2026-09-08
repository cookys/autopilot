#!/usr/bin/env node
/**
 * run-approval-gate — PreToolUse|PostToolUse Task|Agent (wired default-on, INERT until configured)
 *
 * One confirmation per RUN, then autonomous to the end of it. The owner's ask:
 * "開工前問一次 = 本 run 以後都做到底不問，直到下一 run 啟動我再告訴你要做什麼".
 *
 * WHY A HOOK AND NOT SKILL PROSE: a front-door run (/l3-/l6) is defined by NOT stopping
 * to ask (level-front-door.md: "should I continue?" is not an escalation trigger), so a
 * prose instruction to pause is exactly the instruction a fully-autonomous posture is
 * built to skip. The gate has to be mechanical.
 *
 * WHAT THE RECEIPT PROVES, PRECISELY: this hook asked (a `pending` record, written by the
 * PreToolUse half under exclusive create) AND the gated call then executed (PostToolUse
 * promotes `pending` to `approved`, and no-ops when there is no pending for the run). It
 * is therefore never model-authored — a model cannot mint it by asserting consent, and a
 * PostToolUse that never had a matching ask leaves no receipt. It does NOT prove a dialog
 * was rendered and answered: this hook is not told the permission outcome, so a host that
 * auto-allows the call (a settings allowlist, a bypass mode) would execute it after the
 * ask was emitted. That degradation is documented rather than papered over; closing it
 * would need the host to report the decision back, which the hook API does not offer.
 * Do NOT add trust machinery here (ADR-0001): the answer is a narrower claim, not a
 * tamper-evident one.
 *
 * FIRES ONLY WHEN ALL HOLD (any miss ⇒ exit 0, no output):
 *   - mode is `ask-once` (see MODES) — the default `off` keeps every existing run unchanged
 *   - the payload carries NO `agent_id` (depth-0 only; a foreman/worker subagent is
 *     foreman-guard.js's territory and must never be asked — nobody is watching it)
 *   - the session-mode marker is ACTIVE with level l3|l4|l5|l6 (scripts/session-mode.js
 *     readMarker; absent/expired/corrupt ⇒ inert — a plain session is not a "run")
 *   - this run has no approval receipt yet
 *
 * RUN IDENTITY: `<level>:<started_at>` from the marker, so a SECOND front-door command in
 * the same session (a fresh `session-mode.js set`, hence a new `started_at` —
 * scripts/session-mode.js stamps one on EVERY set) asks again. That is the owner's
 * "直到下一 run 啟動" boundary, taken from state that already exists rather than a new
 * lifetime concept. Marker TTL (24h) and session binding therefore also bound the
 * approval: expiry returns the session to asking, never to blanket permission.
 *
 * A mid-run `--fallback solo|precondition_failed` re-set (level-front-door.md's foreman
 * degradation path) also mints a new `started_at`, so it asks again. That is INTENDED, not
 * a leak: the owner approved a /l4-/l6 run that would offload to a foreman, and what will
 * now run is an inline /l3 with a different posture. Approval covers the run that was
 * described, and a degraded run is a different description.
 *
 * WHAT APPROVAL DOES NOT BUY: red lines, DOA-external irreversible operations, quota
 * death, and the stall fuse still stop the run. This gate removes the ordinary
 * "should I continue?" checkpoints only. It can never widen an authority boundary,
 * matching the `-x` rule (a run may ADD red lines, never remove project ones).
 *
 * HEADLESS: `ask` is auto-denied in a non-interactive session (`claude -p`), because
 * there is no human to answer. That is the honest outcome — an unattended run cannot
 * hold a human approval — but it means an unattended front-door run must leave this
 * knob `off`. Documented in hooks/README.md.
 *
 * MODES: ~/.autopilot/config.json {"run_approval": {"mode": "off"|"ask-once"}} or
 * AUTOPILOT_RUN_APPROVAL_MODE. Unrecognised value ⇒ `off` (fail-inert: an unreadable
 * knob must not start gating dispatches).
 * State: `<live-dir>/run-approval/<sid>.json` (+ AUTOPILOT_RUN_APPROVAL_DIR override),
 * same live-dir resolution as every other v2.36.1+ consumer (scripts/lib/live-state-dir.js).
 * Fail-open: any internal error ⇒ exit 0.
 *
 * KNOWN: a parallel first batch (N simultaneous Task calls) emits N asks — each call needs
 * its own permission decision, and suppressing the others would let them run past this gate
 * with no decision at all. Noisy beats permissive.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
// `require`d lazily inside main(), AFTER the mode check: these two pull in a filesystem
// probe and the session-mode module (~38ms combined), and the default-off majority pays
// that twice per Task/Agent call (Pre + Post) for a hook that is about to exit 0.
let resolveLiveDir; let sanitizeSessionId; let readMarker;

const RUN_LEVELS = new Set(['l3', 'l4', 'l5', 'l6']);
const GATED_TOOLS = new Set(['Task', 'Agent']);
const VALID_MODES = new Set(['off', 'ask-once']);

// Deliberately duplicated from foreman-guard.js / depth0-delegate-gate.js rather than
// imported: single-crash isolation between hooks is the house rule for config reads.
function loadMode() {
  let mode = 'off';
  try {
    const file = path.join(os.homedir(), '.autopilot', 'config.json');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.run_approval && typeof j.run_approval.mode === 'string') mode = j.run_approval.mode;
  } catch { /* absent/corrupt config ⇒ default */ }
  const env = process.env.AUTOPILOT_RUN_APPROVAL_MODE;
  if (typeof env === 'string' && env) mode = env;
  return VALID_MODES.has(mode) ? mode : 'off';
}

// Same chain as foreman-guard.js:305 — CLAUDE_CODE_SESSION_ID is the one actually set in
// the tool environment, and omitting it made the state key disagree with the marker's.
function sessionId(payload) {
  const raw = payload.session_id
    || process.env.AUTOPILOT_SESSION_ID
    || process.env.CLAUDE_CODE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.cwd();
  return sanitizeSessionId(raw);
}

function stateFile(sid) {
  const base = process.env.AUTOPILOT_RUN_APPROVAL_DIR
    || path.join(resolveLiveDir().base, 'run-approval');
  return path.join(base, `${sid}.json`);
}

function runKey(marker) {
  return `${marker.level}:${marker.started_at}`;
}

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s === 'object') return s;
  } catch { /* absent or corrupt ⇒ no state, never "approved" */ }
  return null;
}

function isApproved(state, key) {
  return !!(state && state.run_key === key && state.approved_at);
}

// The PreToolUse half's record that IT asked. Exclusive create so a parallel first batch
// leaves one pending, not N; an existing pending for the same run is left untouched.
function markPending(file, key) {
  const st = readState(file);
  if (st && st.run_key === key && st.pending_at) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeState(file, { run_key: key, pending_at: new Date().toISOString() });
}

// Promote pending → approved. Returns false when there is no pending for THIS run, which
// is what makes a PostToolUse without a matching ask (e.g. the knob flipped to `ask-once`
// between an in-flight call's Pre and Post — exactly what the round-end persist question
// does) leave no receipt: the next dispatch asks instead of inheriting a phantom approval.
function promoteApproval(file, key) {
  const st = readState(file);
  if (!st || st.run_key !== key || !st.pending_at) return false;
  writeState(file, { run_key: key, pending_at: st.pending_at, approved_at: new Date().toISOString() });
  return true;
}

function writeState(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function askReason(marker) {
  return `run-approval-gate: this is the first dispatch of the ${marker.level} run started at `
    + `${marker.started_at}. Approving it approves THE WHOLE RUN — the ordinary `
    + `"should I continue?" checkpoints are skipped until the next run starts (a new `
    + `session-mode marker) or the marker's TTL expires. Still stopping regardless: project `
    + `red lines, irreversible operations outside the DOA boundary, quota death, and the `
    + `stall fuse. Deny to keep the step-by-step posture for this run.`;
}

function emitAsk(reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  })}\n`);
}

(function main() {
  try {
    const event = process.argv[2] === 'PostToolUse' ? 'PostToolUse' : 'PreToolUse';
    if (loadMode() !== 'ask-once') process.exit(0);
    ({ resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js'));
    ({ readMarker } = require('../scripts/session-mode.js'));

    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
    let payload = {};
    try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { process.exit(0); }
    if (!payload || typeof payload !== 'object') process.exit(0);
    // Presence, not truthiness (same rule as depth0-delegate-gate.js): an empty/null
    // agent_id still marks a subagent fire, and a subagent must never be asked.
    if (Object.prototype.hasOwnProperty.call(payload, 'agent_id')) process.exit(0);
    if (!GATED_TOOLS.has(payload.tool_name || '')) process.exit(0);

    const marker = readMarker();
    if (!marker || !RUN_LEVELS.has(marker.level)) process.exit(0);

    const key = runKey(marker);
    const file = stateFile(sessionId(payload));
    if (isApproved(readState(file), key)) process.exit(0);

    if (event === 'PostToolUse') {
      // The gated call executed after THIS hook asked ⇒ receipt. No pending ⇒ no receipt.
      promoteApproval(file, key);
      process.exit(0);
    }
    markPending(file, key);
    emitAsk(askReason(marker));
    process.exit(0);
  } catch { process.exit(0); }
})();
