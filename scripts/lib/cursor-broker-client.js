#!/usr/bin/env node
'use strict';
// One newline-delimited JSON request/response over a Unix socket. Persist only the
// broker's allowed content fields; ok/rc/redactions are never logged or stored.
const fs = require('fs');
const net = require('net');

const EDIT_ONLY = `=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.
===

`;
const MAX_PROMPT_BYTES = 64 * 1024;
function readPrompt(file) {
  const prompt = EDIT_ONLY + fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new Error('cursor broker prompt exceeds 64 KiB (including harness directive)');
  return prompt;
}
function request({ socket, worktree, prompt, model, timeout_s }) {
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new Error('cursor broker prompt exceeds 64 KiB');
  if (!/^composer-[0-9][0-9.]*$/.test(model)) throw new Error('cursor broker requires a composer model');
  if (!Number.isInteger(timeout_s) || timeout_s < 60 || timeout_s > 3600) throw new Error('cursor broker timeout_s must be an integer 60-3600');
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socket);
    const chunks = [];
    let bytes = 0;
    // Broker queue time is not job execution time. The caller's watchdog owns
    // the wall limit; do not time out a serialized job merely for waiting.
    conn.on('connect', () => conn.write(JSON.stringify({ worktree, prompt, model, timeout_s }) + '\n'));
    conn.on('error', () => reject(new Error('cursor broker socket error')));
    conn.on('end', () => reject(new Error('cursor broker closed before a response line')));
    conn.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { conn.destroy(); reject(new Error('cursor broker response too large')); return; }
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const end = buffer.indexOf(10);
      if (end < 0) return;
      conn.destroy();
      try {
        const raw = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        if (!raw || typeof raw.ok !== 'boolean' || !['done', 'rejected', 'stopped_billing', 'timeout', 'agent_failed'].includes(raw.verdict)
          || ['diff', 'log', 'run_id', 'reason'].some(key => typeof raw[key] !== 'string')) throw new Error();
        const response = Object.fromEntries(['diff', 'log', 'run_id', 'verdict', 'reason'].map(key => [key, raw[key]]));
        resolve({ response, success: raw.ok && raw.verdict === 'done' });
      } catch { reject(new Error('cursor broker invalid response')); }
    });
  });
}
async function main(argv) {
  const args = {};
  const keys = new Set(['socket', 'worktree', 'prompt-file', 'model', 'timeout-s', 'out']);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !keys.has(key) || !argv[i + 1] || key in args) throw new Error('invalid cursor broker client arguments');
    args[key] = argv[i + 1];
  }
  for (const key of keys) if (!args[key] && key !== 'socket') throw new Error(`missing --${key}`);
  const { response, success } = await request({
    socket: process.env.AUTOPILOT_CURSOR_BROKER_SOCK || args.socket || '/srv/cursor-broker/sock',
    worktree: args.worktree, prompt: readPrompt(args['prompt-file']), model: args.model, timeout_s: Number(args['timeout-s']),
  });
  fs.writeFileSync(args.out, JSON.stringify(response) + '\n', { mode: 0o600 });
  return success ? 0 : 1;
}
module.exports = { EDIT_ONLY, MAX_PROMPT_BYTES, readPrompt, request, main };
if (require.main === module) main(process.argv.slice(2)).then(rc => { process.exitCode = rc; }).catch(err => {
  process.stderr.write(`${err.message}\n`); process.exitCode = 2;
});
