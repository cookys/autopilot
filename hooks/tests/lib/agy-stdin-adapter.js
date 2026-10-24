#!/usr/bin/env node
'use strict';
// Test double for agy >= 1.2's stdin transport (`--input-format stream-json --output-format
// stream-json --print=`). Usage:  agy-stdin-adapter.js <legacy-stub> [agy argv...]
//
// WHY: the agy rails now pipe the prompt as ONE NDJSON line on stdin. Existing suites already own
// stubs that were written against the old `-p <prompt>` argv; this adapter lets them keep
// working (it decodes the line and hands the prompt to the legacy stub as `-p <prompt>`) while it
// ENFORCES the real wire contract, so a rail that regresses fails the suite:
//   * a bare `--print` (no `=`) or any `-p`/`--prompt` on the rail's argv        -> exit 2
//   * a stdin line without {"event":"user","message":{"content":<string>}}       -> exit 2
// Invocations without `--input-format` (version/models probes, legacy shapes) are passed through.
// Controls (env):
//   AGY_STUB_RESULT=error  emit a `result` with status ERROR (text from AGY_STUB_ERROR_TEXT)
//   AGY_STUB_RESULT=none   emit step_update events but NO `result` event
//   AGY_STUB_CAPTURE=1     answer with `AGY-STUB bytes=N sha256=H tailsha=T argv=[...]` (T = sha256 of the
//                          last AGY_STUB_TAIL bytes) instead of running the legacy stub
//   AGY_STUB_NEEDLE_FILE=f in capture mode, append `needle=found|missing`: whether the prompt contains
//                          file f byte-for-byte (for rails that wrap the payload in their own framing)
//   AGY_STUB_RESPONSE_EMPTY=1  answer SUCCESS with response "" (the BL-0021 silent-truncation signature)
//   AGY_STUB_INPUT_TOKENS=N    attach usage:{input_tokens:N,...} to the result, like real agy 1.4.6
// A prompt over 120000 bytes is NOT forwarded to the legacy stub (it would hit E2BIG): the
// adapter answers itself with response "BIG-OK".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const [inner, ...args] = process.argv.slice(2);
if (!args.includes('--input-format')) {
  const r = spawnSync(inner, args, { stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}
const die = (msg) => { process.stderr.write(`agy-stdin-adapter: ${msg}\n`); process.exit(2); };
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (flag('--input-format') !== 'stream-json') die('--input-format must be stream-json');
if (flag('--output-format') !== 'stream-json') die('--output-format must be stream-json');
if (!args.includes('--print=')) die('`--print=` (with the =) is required');
if (args.some((a) => a === '--print' || a === '-p' || a === '--prompt')) die('bare --print / -p / --prompt on argv');

const raw = fs.readFileSync(0);
const lines = raw.toString('utf8').split('\n').filter((l) => l.trim());
if (lines.length !== 1) die(`expected exactly 1 NDJSON line, got ${lines.length}`);
let ev;
try { ev = JSON.parse(lines[0]); } catch (e) { die(`stdin is not JSON: ${e.message}`); }
if (!ev || ev.event !== 'user' || !ev.message || typeof ev.message.content !== 'string') {
  die('stdin line is not {"event":"user","message":{"content":<string>}}');
}
const prompt = ev.message.content;
const promptBytes = Buffer.from(prompt, 'utf8');

// Capture: the rails run agy inside bwrap with a private /tmp, so a side-channel file would not be
// visible to the test. The capture therefore travels back IN the response (which every rail keeps in
// its raw log): bytes, sha256 of the whole prompt, sha256 of its last AGY_STUB_TAIL bytes, and argv.
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let captureLine = '';
if (process.env.AGY_STUB_CAPTURE) {
  const tail = Number(process.env.AGY_STUB_TAIL || 0);
  captureLine = `AGY-STUB bytes=${promptBytes.length} sha256=${sha(promptBytes)} tailsha=${tail ? sha(promptBytes.subarray(promptBytes.length - tail)) : ''} argv=[${args.join('|')}]`;
  if (process.env.AGY_STUB_NEEDLE_FILE) {
    captureLine += ` needle=${promptBytes.includes(fs.readFileSync(process.env.AGY_STUB_NEEDLE_FILE)) ? 'found' : 'missing'}`;
  }
}
if (captureLine) process.stderr.write(`${captureLine}\n`); // rails that never parse the response (containment breach) still keep stderr
const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
emit({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', text_delta: 'x' } });
if (process.env.AGY_STUB_RESULT === 'none') process.exit(0);
if (process.env.AGY_STUB_RESULT === 'error') {
  emit({ event: 'result', result: { status: 'ERROR', error: process.env.AGY_STUB_ERROR_TEXT || 'stub agy error' } });
  process.exit(0);
}

const rest = args.filter((a, i) => !['--input-format', '--output-format'].includes(a)
  && !['--input-format', '--output-format'].includes(args[i - 1]) && a !== '--print=');
let stdout; let status = 0;
if (captureLine) {
  stdout = captureLine;
} else if (promptBytes.length > 120000) {
  stdout = 'BIG-OK';
} else {
  const r = spawnSync(inner, ['-p', prompt, ...rest, '--output-format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
  status = r.status == null ? 1 : r.status;
  stdout = r.stdout || '';
}
if (status !== 0) process.exit(status);
let result = null;
try {
  const o = JSON.parse(stdout);
  if (o && typeof o === 'object' && typeof o.response === 'string') result = o;
} catch (_e) { /* legacy stub printed plain text */ }
if (!result) result = { status: 'SUCCESS', response: stdout };
if (!result.status) result.status = 'SUCCESS';
if (process.env.AGY_STUB_RESPONSE_EMPTY) result.response = '';
if (process.env.AGY_STUB_INPUT_TOKENS) {
  const n = Number(process.env.AGY_STUB_INPUT_TOKENS);
  result.usage = { input_tokens: n, output_tokens: 217, thinking_tokens: 208, cache_read_tokens: 0, total_tokens: n + 217 };
}
emit({ event: 'result', result });
