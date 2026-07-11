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
// - exit 0 only on `agent_end` + successful prompt response + clean pi exit.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

function parseLine(line, state, eventSink) {
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
  if (type === 'agent_end') state.seenAgentEnd = true;
}

function makeLineHandler(processLine) {
  let carry = '';
  const h = (chunk) => {
    const text = `${carry}${chunk.toString('utf8')}`;
    const parts = text.split('\n');
    carry = parts.pop() || '';
    for (const p of parts) processLine(p);
  };
  h.flush = () => {
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

  const lineHandler = makeLineHandler((line) => parseLine(line, state, process.env.PI_RPC_EVENT_LOG));
  child.stdout.on('data', lineHandler);
  child.stdout.on('end', () => { lineHandler.flush(); });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  child.stdin.write(`${JSON.stringify({ id: 'prompt-1', type: 'prompt', message: promptPayload })}\n`);

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

  const exit = await exitPromise;
  clearInterval(timer);
  try { child.stdin.end(); } catch (_e) {}

  const success = (
    state.seenPromptResponse &&
    !state.promptFailed &&
    state.seenAgentEnd &&
    exit.code === 0 &&
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
