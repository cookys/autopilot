#!/usr/bin/env node
'use strict';
// agy stdin transport — the one shared path every agy prompt rail uses.
//
// WHY: agy's `-p <prompt>` puts the whole prompt in ONE argv string, which Linux caps at
// MAX_ARG_STRLEN (131071 bytes). agy >= 1.2 can instead read NDJSON from stdin
// (`--input-format stream-json`, which requires `--output-format stream-json`), so the prompt
// travels on a pipe and has no size ceiling (verified on agy 1.4.6 with a 212901-byte prompt).
//
// Verified wire facts (agy 1.4.6):
//   * the flag is `--print=` — it NEEDS the `=`; a bare `--print` swallows the next flag as its
//     prompt and exits 2.
//   * input line:  {"event":"user","message":{"content":"<prompt>"}}   (`message.text` fails;
//     event names user_message/message/prompt are ignored).
//   * output: NDJSON; the event that matters is
//     {"event":"result","result":{"status":"SUCCESS","response":"...",...}}; on failure
//     `status` is `ERROR` and the message is in `result.error`.
//
// CLI:  node agy-stream-json.js run [--prompt-file F] [--prefix TEXT] [--emit response|envelope]
//                                   -- <agy command and its flags...>
//   Appends `--input-format stream-json --output-format stream-json --print=` to the command,
//   writes the prompt (prefix + file) as one NDJSON line on the child's stdin, and parses the
//   `result` event.
//   Exit codes:  0  SUCCESS — stdout carries `result.response` (--emit response, default) or the
//                   `result` object as one JSON line (--emit envelope: the legacy
//                   `--output-format json` envelope shape dispatch-status.js --agy-envelope reads)
//                1  `result.status` ERROR, or no `result` event at all — reason on stderr
//                   (the rails already treat any non-zero runner exit as their engine failure)
//                N  agy itself exited non-zero (N, passed through; stdout stays empty)
//                2  usage error

const fs = require('fs');
const { spawn } = require('child_process');

const STREAM_FLAGS = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print='];

function encodeUserLine(prompt) {
  return `${JSON.stringify({ event: 'user', message: { content: String(prompt) } })}\n`;
}

// Returns {ok:true, result} for SUCCESS, {ok:false, reason} for ERROR / no result event.
function parseStream(text) {
  let result = null;
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch (_e) { continue; }
    if (ev && ev.event === 'result' && ev.result && typeof ev.result === 'object') result = ev.result;
  }
  if (!result) return { ok: false, reason: 'agy emitted no result event' };
  if (result.status !== 'SUCCESS') {
    const err = result.error == null ? '(no error text)' : (typeof result.error === 'string' ? result.error : JSON.stringify(result.error));
    return { ok: false, reason: `agy result status ${String(result.status)}: ${err}` };
  }
  if (typeof result.response !== 'string') return { ok: false, reason: 'agy result has no string response' };
  return { ok: true, result };
}

function usage(msg) {
  process.stderr.write(`agy-stream-json.js: ${msg}\nusage: agy-stream-json.js run [--prompt-file F] [--prefix TEXT] [--emit response|envelope] -- <agy cmd...>\n`);
  process.exit(2);
}

function main(argv) {
  if (argv[0] !== 'run') usage('first argument must be `run`');
  let promptFile = '';
  let prefix = '';
  let emit = 'response';
  let i = 1;
  for (; i < argv.length && argv[i] !== '--'; i += 2) {
    if (argv[i] === '--prompt-file') promptFile = argv[i + 1] || '';
    else if (argv[i] === '--prefix') prefix = argv[i + 1] || '';
    else if (argv[i] === '--emit') emit = argv[i + 1] || '';
    else usage(`unknown option ${argv[i]}`);
  }
  if (argv[i] !== '--') usage('missing -- before the agy command');
  const cmd = argv.slice(i + 1);
  if (cmd.length === 0) usage('empty agy command');
  if (emit !== 'response' && emit !== 'envelope') usage('--emit must be response|envelope');
  let prompt = prefix;
  if (promptFile) {
    try { prompt += fs.readFileSync(promptFile, 'utf8'); } catch (e) { usage(`cannot read prompt file: ${e.message}`); }
  }

  const child = spawn(cmd[0], [...cmd.slice(1), ...STREAM_FLAGS], { stdio: ['pipe', 'pipe', 'inherit'] });
  const chunks = [];
  child.stdout.on('data', (d) => chunks.push(d));
  child.stdin.on('error', () => {}); // agy may exit before reading everything: its exit code speaks
  child.stdin.end(encodeUserLine(prompt));
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => { try { child.kill(sig); } catch (_e) { /* gone */ } });
  }
  child.on('error', (e) => {
    process.stderr.write(`agy-stream-json.js: cannot start ${cmd[0]}: ${e.message}\n`);
    process.exit(127);
  });
  child.on('close', (code, signal) => {
    if (code !== 0) process.exit(code == null ? 128 + ({ SIGTERM: 15, SIGKILL: 9, SIGINT: 2, SIGHUP: 1 }[signal] || 1) : code);
    const parsed = parseStream(Buffer.concat(chunks).toString('utf8'));
    if (!parsed.ok) {
      process.stderr.write(`agy-stream-json.js: ${parsed.reason}\n`);
      process.exit(1);
    }
    process.stdout.write(emit === 'envelope' ? `${JSON.stringify(parsed.result)}\n` : parsed.result.response);
  });
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { encodeUserLine, parseStream, STREAM_FLAGS };
