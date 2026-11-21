#!/usr/bin/env node
'use strict';
// One newline-delimited JSON request/response over a Unix socket. Persist only the
// broker's allowed content fields; ok/rc/redactions are never logged or stored.
const fs = require('fs');
const net = require('net');
const path = require('path');

const EDIT_ONLY = `=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.
===

`;
const MAX_PROMPT_BYTES = 64 * 1024;
// Both runners share this protocol; only deployment policy differs.
function brokerConfig(runner = 'cursor', env = process.env) {
  if (runner === 'cursor') return {
    runner, socket: env.AUTOPILOT_CURSOR_BROKER_SOCK || '/srv/cursor-broker/sock',
    workRoot: env.AUTOPILOT_CURSOR_WORK_ROOT || '/srv/cursor-work',
    modelPattern: /^composer-[0-9][0-9.]*$/, defaultModel: 'composer-2.5',
    modelError: 'cursor broker requires a composer model', quotaObserver: './cursor-quota-observe',
  };
  if (runner === 'kimi') return {
    runner, socket: env.AUTOPILOT_KIMI_BROKER_SOCK || '/srv/kimi-broker/sock',
    workRoot: env.AUTOPILOT_KIMI_BROKER_WORK_ROOT || '/srv/kimi-work',
    modelPattern: new RegExp(env.AUTOPILOT_KIMI_BROKER_MODEL_PATTERN || '^kimi-code/[A-Za-z0-9._-]+$'),
    defaultModel: 'kimi-code/kimi-for-coding', modelError: 'kimi broker requires a matching model',
    quotaObserver: './kimi-quota-observe',
  };
  throw new Error('unknown broker runner');
}
function validateModel(model, runner = 'cursor') {
  const config = brokerConfig(runner);
  if (!config.modelPattern.test(model)) throw new Error(config.modelError);
}
function readPrompt(file, runner = 'cursor') {
  const prompt = EDIT_ONLY + fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new Error(`${runner} broker prompt exceeds 64 KiB (including harness directive)`);
  return prompt;
}
function request({ socket, worktree, prompt, model, timeout_s, runner = 'cursor' }) {
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new Error(`${runner} broker prompt exceeds 64 KiB`);
  validateModel(model, runner);
  if (!Number.isInteger(timeout_s) || timeout_s < 60 || timeout_s > 3600) throw new Error(`${runner} broker timeout_s must be an integer 60-3600`);
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socket);
    const chunks = [];
    let bytes = 0;
    // Broker queue time is not job execution time. The caller's watchdog owns
    // the wall limit; do not time out a serialized job merely for waiting.
    conn.on('connect', () => conn.write(JSON.stringify({ worktree, prompt, model, timeout_s }) + '\n'));
    conn.on('error', () => reject(new Error(`${runner} broker socket error`)));
    conn.on('end', () => reject(new Error(`${runner} broker closed before a response line`)));
    conn.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { conn.destroy(); reject(new Error(`${runner} broker response too large`)); return; }
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const end = buffer.indexOf(10);
      if (end < 0) return;
      conn.destroy();
      try {
        const raw = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        resolve(projectReply(raw, runner));
      } catch (err) {
        reject(err instanceof Error && /broker invalid response$/.test(err.message) ? err : new Error(`${runner} broker invalid response`));
      }
    });
  });
}
// rejected/stopped_billing/timeout/agent_failed never apply the diff.
// A missing verdict, or explicit "failed" with ok:true, still applies it so
// dispatch can commit and then classify the raw verdict.
const HARD_FAIL = new Set(['rejected', 'stopped_billing', 'timeout', 'agent_failed']);
function projectReply(raw, runner) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.ok !== 'boolean'
    || ['diff', 'log', 'run_id'].some(key => typeof raw[key] !== 'string')
    || !(raw.reason == null || typeof raw.reason === 'string')) {
    throw new Error(`${runner} broker invalid response`);
  }
  const verdict = Object.prototype.hasOwnProperty.call(raw, 'verdict') ? raw.verdict : null;
  const billing_confirmed = raw.billing_confirmed === true;
  const billing_line = typeof raw.billing_line === 'string' ? raw.billing_line.slice(0, 160) : '';
  const response = {
    diff: raw.diff, log: raw.log, run_id: raw.run_id, verdict,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    billing_confirmed, billing_line,
  };
  const hardFail = typeof verdict === 'string' && HARD_FAIL.has(verdict);
  const missing = verdict == null || verdict === '';
  const success = raw.ok === true && !hardFail && (verdict === 'done' || missing || verdict === 'failed');
  return { response, success };
}
function socketDenied(runner, env = process.env) {
  let socket;
  try { socket = brokerConfig(runner, env).socket; } catch { return false; }
  const denied = (err) => !!(err && (err.code === 'EACCES' || err.code === 'EPERM'));
  try { fs.statSync(path.dirname(socket)); } catch (err) { return denied(err); }
  try {
    if (!fs.statSync(socket).isSocket()) return false;
  } catch (err) { return denied(err); }
  try { fs.accessSync(socket, fs.constants.W_OK); } catch (err) { return denied(err); }
  return false;
}
function brokerAvailable(runner = 'kimi', { env = process.env, now } = {}) {
  try {
    const config = brokerConfig(runner, env);
    if (!fs.statSync(config.socket).isSocket()) return false;
    const quota = require(config.quotaObserver);
    return runner === 'kimi' ? !quota.exhaustedKimi({ env, now }) : quota.cursorState({ env, now }) !== 'exhausted';
  } catch { return false; }
}
function observeQuota(runner, verdict, fields = {}) {
  return require(brokerConfig(runner).quotaObserver).observe({
    verdict,
    billing_confirmed: fields.billing_confirmed === true,
    billing_line: typeof fields.billing_line === 'string' ? fields.billing_line.slice(0, 160) : '',
  });
}
async function main(argv) {
  if (argv[0] === 'available') {
    if (argv.length !== 2) throw new Error('broker available requires runner');
    if (socketDenied(argv[1])) {
      process.stderr.write(`${argv[1]} broker socket not accessible: run under the socket's group (e.g. sg lanegit -c ...)\n`);
      return 4;
    }
    return brokerAvailable(argv[1]) ? 0 : 3;
  }
  if (argv[0] === 'observe') {
    if (argv.length !== 3 && argv.length !== 5) throw new Error('broker observe requires runner and verdict');
    observeQuota(argv[1], argv[2], { billing_confirmed: argv[3] === 'true', billing_line: argv[4] || '' });
    return 0;
  }
  const args = {};
  const keys = new Set(['socket', 'worktree', 'prompt-file', 'model', 'timeout-s', 'out', 'runner']);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !keys.has(key) || !argv[i + 1] || key in args) throw new Error('invalid cursor broker client arguments');
    args[key] = argv[i + 1];
  }
  for (const key of keys) if (!args[key] && !['socket', 'runner'].includes(key)) throw new Error(`missing --${key}`);
  const runner = args.runner || 'cursor';
  const { response, success } = await request({
    runner, socket: (runner === 'cursor' && process.env.AUTOPILOT_CURSOR_BROKER_SOCK) || args.socket || brokerConfig(runner).socket,
    worktree: args.worktree, prompt: readPrompt(args['prompt-file'], runner), model: args.model, timeout_s: Number(args['timeout-s']),
  });
  fs.writeFileSync(args.out, JSON.stringify(response) + '\n', { mode: 0o600 });
  return success ? 0 : 1;
}
module.exports = { EDIT_ONLY, MAX_PROMPT_BYTES, brokerConfig, validateModel, brokerAvailable, observeQuota, readPrompt, request, projectReply, socketDenied, main };
if (require.main === module) main(process.argv.slice(2)).then(rc => { process.exitCode = rc; }).catch(err => {
  process.stderr.write(`${err.message}\n`); process.exitCode = 2;
});
