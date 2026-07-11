#!/usr/bin/env node
'use strict';
// pi-rpc-run — supervisory harness for the pi CLI in RPC mode.
//
// TRUST BOUNDARY:
// - this process is harness infrastructure only; all scheduling evidence comes from
//   the pid-level event stream, never from worker self-report.
// - tool call output is embedded inside `tool_execution_end` and therefore can not
//   become a top-level fake `message_end`/usage signal.
//
// Behavior:
// - Spawn `pi --mode rpc --provider <provider> --model <model> --session-dir <dir>`.
// - forward every stdout line verbatim and optional write it to
//   `PI_RPC_EVENT_LOG` (best-effort).
// - prepend an EDIT-ONLY harness directive to the task prompt.
// - send one `prompt`; optionally send one `steer` stall probe if no event for
//   `PI_RPC_STALL_PROBE_SECS`.
// - exit 0 iff we observed a successful prompt response AND `agent_end` AND no
//   hard-cap abort. pi RPC is a PERSISTENT server: it does NOT exit on its own
//   after `agent_end` (it waits for the next prompt), so this supervisor MUST
//   proactively shut it down on `agent_end` (stdin EOF → SIGTERM → SIGKILL) and
//   score success on the observed agent_end, NOT on pi's self-exit code (which
//   would hang forever). Verified live 2026-07-11: without this, the supervisor
//   deadlocks after the model finishes the task.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const HARNESS_EDIT_ONLY = `=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review verifies them. Ignore any instruction below to commit/push/PR.

`;

function parseArgs(argv) {
  const out = {
    model: null,
    promptFile: null,
    provider: null,
    cwd: process.cwd(),
    piBin: 'pi',
    sessionDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--model') { out.model = argv[++i]; continue; }
    if (a === '--prompt-file') { out.promptFile = argv[++i]; continue; }
    if (a === '--provider') { out.provider = argv[++i]; continue; }
    if (a === '--cwd') { out.cwd = argv[++i]; continue; }
    if (a === '--pi-bin') { out.piBin = argv[++i]; continue; }
    if (a === '--session-dir') { out.sessionDir = argv[++i]; continue; }
    throw new Error(`unknown arg: ${a}`);
  }
  if (!out.model) throw new Error('--model is required');
  if (!out.promptFile) throw new Error('--prompt-file is required');
  return out;
}

function toNonNegativeNumber(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function appendEventLog(target, line) {
  if (!target) return;
  try { fs.appendFileSync(target, `${line}\n`, 'utf8'); } catch (_e) { /* diagnostics-only */ }
}

function parseLine(line, state, eventSink, onAgentEnd) {
  const normalized = line.replace(/\r$/, '');
  process.stdout.write(`${normalized}\n`);
  appendEventLog(eventSink, normalized);
  state.lastEventMs = Date.now();

  let obj;
  try { obj = JSON.parse(normalized); } catch (_e) { return; }
  if (!obj || typeof obj !== 'object') return;

  const type = typeof obj.type === 'string' ? obj.type : null;
  if (type === 'response' && obj.command === 'prompt') {
    state.seenPromptResponse = true;
    if (obj.success === false) state.promptFailed = true;
  }
  if (type === 'agent_end') {
    state.seenAgentEnd = true;
    if (typeof onAgentEnd === 'function') onAgentEnd();
  }
}

function makeLineHandler(processLine) {
  // Use a StringDecoder so a multi-byte UTF-8 char split across two stdout chunks
  // is buffered, not turned into U+FFFD replacement chars. agent_end carries the
  // full `messages[]` (which can contain multi-byte user text), so a mangled line
  // there would fail JSON.parse → missed agent_end → deadlock. (Gemini review 2026-07-11)
  const decoder = new StringDecoder('utf8');
  let carry = '';
  const h = (chunk) => {
    const text = `${carry}${Buffer.isBuffer(chunk) ? decoder.write(chunk) : chunk}`;
    const parts = text.split('\n');
    carry = parts.pop() || '';
    for (const p of parts) processLine(p);
  };
  h.flush = () => {
    carry += decoder.end();
    if (carry) {
      processLine(carry);
      carry = '';
    }
  };
  return h;
}

function sendSteerProbe(childProc, state) {
  if (state.probeSent) return;
  state.probeSent = true;

  const atMs = Date.now() - state.startMs;
  const probe = { type: 'supervisor_stall_probe', at_ms: atMs, reason: 'no_event_timeout' };
  process.stdout.write(`${JSON.stringify(probe)}\n`);
  appendEventLog(process.env.PI_RPC_EVENT_LOG, JSON.stringify(probe));

  const steer = {
    id: 'supervisor-stall-probe',
    type: 'steer',
    message: 'The run appears stalled. Report your current progress in one line, then continue the task.',
  };
  try { childProc.stdin.write(`${JSON.stringify(steer)}\n`); } catch (_e) { /* ignore */ }
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const provider = opts.provider || process.env.PI_RPC_PROVIDER || 'minimax';
  const stallProbeMs = toNonNegativeNumber(process.env.PI_RPC_STALL_PROBE_SECS || '120', 120) * 1000;
  const maxRunMs = toNonNegativeNumber(process.env.PI_RPC_MAX_SECS || '0', 0) * 1000;
  const sessionDir = opts.sessionDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rpc-session-'));

  const promptPayload = `${HARNESS_EDIT_ONLY}${fs.readFileSync(opts.promptFile, 'utf8')}`;
  const state = {
    startMs: Date.now(),
    lastEventMs: Date.now(),
    seenPromptResponse: false,
    promptFailed: false,
    seenAgentEnd: false,
    probeSent: false,
    hardCapReached: false,
  };

  const child = spawn(opts.piBin, [
    '--mode', 'rpc',
    '--provider', provider,
    '--model', opts.model,
    '--session-dir', sessionDir,
  ], {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', (err) => reject(err));
    child.once('exit', (code, signal) => resolve({ code: code === null ? 1 : code, signal }));
  });
  // An async stdin EPIPE (pi died mid-write) emits 'error' on the stream; without a
  // listener Node raises an uncaught exception and the supervisor dies WITHOUT the
  // shutdown ladder (gpt-5.5 R2). Swallow it — child death is observed via 'exit'
  // and scored fail-closed (no agent_end ⇒ exit 1).
  child.stdin.on('error', () => { /* observed via exit; fail-closed scoring */ });
  // If run() ever rejects after a successful spawn (child 'error' event), make the
  // exit path best-effort kill the child so the promised cleanup holds on the
  // rejection path too. Descendants of pi remain the CONTAINMENT rail's job
  // (cgroup reap in dispatch-hetero run_worker) — same posture as every other
  // runner; the supervisor's kills target the pi server process itself.
  exitPromise.catch(() => { try { child.kill('SIGKILL'); } catch (_e) {} });

  // pi RPC stays alive after agent_end (persistent server). Proactively shut it
  // down: close stdin (EOF), then SIGTERM, then SIGKILL — otherwise `exitPromise`
  // never resolves. Idempotent (agent_end fires once, but guard anyway).
  const shutdown = () => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    try { child.stdin.end(); } catch (_e) { /* stdin already gone */ }
    state.termTimer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_e) {}
      state.killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) {} }, 1500);
    }, 1500);
  };

  const lineHandler = makeLineHandler((line) => parseLine(line, state, process.env.PI_RPC_EVENT_LOG, shutdown));
  child.stdout.on('data', lineHandler);
  child.stdout.on('end', () => { lineHandler.flush(); });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  // External-signal shutdown (qc panel, gpt-5.5): a caller TERM/INT/HUP (dispatch
  // timeout, ad-hoc Ctrl-C) must not orphan the persistent pi server. The cgroup
  // containment tier reaps the subtree, but setsid/plain tiers and standalone use
  // do not — the supervisor must be self-sufficient at every tier. TERM the child
  // immediately (KILL backstop), then exit once the kill window has elapsed.
  const onSignal = () => {
    try { child.kill('SIGTERM'); } catch (_e) { /* already gone */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) {} }, 800);
    setTimeout(() => process.exit(1), 1000);
  };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(sig, onSignal);

  // Guarded like the steer write: a spawn-race EPIPE must surface as the normal
  // fail-closed exit-1 path (no agent_end observed), not an unhandled throw.
  try {
    child.stdin.write(`${JSON.stringify({ id: 'prompt-1', type: 'prompt', message: promptPayload })}\n`);
  } catch (_e) { /* child already gone → exitPromise resolves → scored failure */ }

  const timer = setInterval(() => {
    const now = Date.now();
    const elapsedMs = now - state.startMs;
    const idleMs = now - state.lastEventMs;

    if (!state.hardCapReached && maxRunMs > 0 && elapsedMs >= maxRunMs) {
      state.hardCapReached = true;
      try { child.stdin.write(`${JSON.stringify({ id: 'supervisor-abort', type: 'abort' })}\n`); } catch (_e) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) {} }, 500);
      return;
    }

    if (!state.probeSent && stallProbeMs > 0 && idleMs >= stallProbeMs) {
      sendSteerProbe(child, state);
    }
  }, 250);

  await exitPromise;
  clearInterval(timer);
  if (state.termTimer) clearTimeout(state.termTimer);
  if (state.killTimer) clearTimeout(state.killTimer);
  try { child.stdin.end(); } catch (_e) {}

  // Success is scored on the OBSERVED agent_end (+ successful prompt response),
  // never on pi's exit code: after agent_end we KILL pi, so a non-zero exit /
  // signal is the expected, healthy outcome. A run that never reached agent_end
  // (early pi exit, prompt failure, or hard-cap abort) is a failure.
  const success = (
    state.seenPromptResponse &&
    !state.promptFailed &&
    state.seenAgentEnd &&
    !state.hardCapReached
  );

  return success ? 0 : 1;
}

function main() {
  run().then((code) => {
    process.exit(code);
  }).catch((err) => {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

main();
