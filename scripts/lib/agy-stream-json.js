#!/usr/bin/env node
'use strict';
// agy stdin transport — the one shared path every agy prompt rail uses.
//
// WHY: agy's `-p <prompt>` puts the whole prompt in ONE argv string, which Linux caps at
// MAX_ARG_STRLEN (131071 bytes). agy >= 1.2 can instead read NDJSON from stdin
// (`--input-format stream-json`, which requires `--output-format stream-json`), so the prompt
// travels on a pipe and the 131071 argv wall is gone.
//
// BUT THE STDIN PATH HAS ITS OWN, SILENT WALL (docs/backlog BL-0021). On this deployment a tail-nonce
// probe got the nonce back at 175,145 B and NOT at 200,344 B, and above the wall agy still reports
// `status: SUCCESS` with `response: ""` (or an answer about only the head) — an empty "review" that
// reads as a clean pass. The wall is a DEPLOYMENT property (same binary, model and bytes pass on
// another host), so no constant can predict it. Until the rail self-checks with a tail nonce, this
// helper FAILS CLOSED: an encoded stdin line over STDIN_MAX_BYTES is refused (exit 3, reason
// `agy_stdin_ceiling` on stderr) and agy is never spawned. Default 170000 sits below the measured-safe
// 175,145; AUTOPILOT_AGY_STDIN_MAX_BYTES overrides it (positive integer; anything else = default).
//
// SECOND LAYER (response side): the byte cap alone cannot guarantee fail-closed because the wall is in
// tokens (~97.6k input tokens on agy 1.4.6). parseStream therefore also refuses (exit 1) a SUCCESS whose
// response is empty after trim (`agy_empty_response`) and one whose `result.usage.input_tokens` is >=
// AUTOPILOT_AGY_INPUT_TOKEN_CEILING (default 95000; non-positive-integer = default; `agy_input_truncated`),
// even when the response is non-empty. No usage field -> the token check is skipped with a stderr note.
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
//                3  agy_stdin_ceiling — the encoded prompt line is over STDIN_MAX_BYTES; agy was NOT run
//                127 the agy command could not be spawned (spawn error, stderr names it)
//                2  usage error
//   --text-compat (opt-in, for callers that replace a plain `agy -p` text run): one output rule, see
//   textCompatClose below. Default behaviour (without the flag) is unchanged.

const fs = require('fs');
const { spawn } = require('child_process');

const STREAM_FLAGS = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print='];

const DEFAULT_STDIN_MAX_BYTES = 170000;
// The wall is in TOKENS, not bytes (BL-0021, agy 1.4.6, 2026-10-24): input_tokens 87,366 answered, 97,652 and
// 97,653 came back SUCCESS with response "" (the model never saw the tail). Token-dense content (base64, some CJK)
// can cross it inside the byte cap, so the response side is checked too.
const DEFAULT_INPUT_TOKEN_CEILING = 95000;

function inputTokenCeiling(env = process.env) {
  const raw = String(env.AUTOPILOT_AGY_INPUT_TOKEN_CEILING == null ? '' : env.AUTOPILOT_AGY_INPUT_TOKEN_CEILING).trim();
  return positiveSafeInt(raw, DEFAULT_INPUT_TOKEN_CEILING);
}

// A digit string that parses to a safe positive integer, else the default. A 400-digit override would
// otherwise become Infinity and silently turn the fail-closed comparison off.
function positiveSafeInt(raw, dflt) {
  const t = String(raw == null ? '' : raw).trim();
  if (!/^[1-9][0-9]*$/.test(t)) return dflt;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : dflt;
}

function stdinMaxBytes(env = process.env) {
  const raw = env.AUTOPILOT_AGY_STDIN_MAX_BYTES;
  return positiveSafeInt(raw, DEFAULT_STDIN_MAX_BYTES);
}

function encodeUserLine(prompt) {
  return `${JSON.stringify({ event: 'user', message: { content: String(prompt) } })}\n`;
}

// The last `result` event's result object, or null.
function lastResult(text) {
  let result = null;
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch (_e) { continue; }
    if (ev && ev.event === 'result' && ev.result && typeof ev.result === 'object') result = ev.result;
  }
  return result;
}

// Returns {ok:true, result} for SUCCESS, {ok:false, reason} for ERROR / no result event.
function parseStream(text, env = process.env) {
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
  if (result.response.trim() === '') {
    return { ok: false, reason: 'agy_empty_response: agy reported SUCCESS with an empty response (the silent truncation signature, BL-0021); treated as a failure, not a clean pass' };
  }
  const used = result.usage && typeof result.usage === 'object' ? result.usage.input_tokens : undefined;
  const ceiling = inputTokenCeiling(env);
  if (typeof used === 'number' && Number.isFinite(used)) {
    if (used >= ceiling) {
      return { ok: false, reason: `agy_input_truncated: agy consumed ${used} input tokens, at or over the ${ceiling}-token fail-closed ceiling (about 97.6k is where agy 1.4.6 silently drops the prompt tail, BL-0021); the answer cannot be trusted. Split the unit or raise AUTOPILOT_AGY_INPUT_TOKEN_CEILING where you measured it` };
    }
    return { ok: true, result };
  }
  return { ok: true, result, note: 'agy result carries no usage.input_tokens; the token-ceiling check was skipped (only the empty-response and byte-cap checks apply)' };
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
  let textCompat = false;
  let i = 1;
  for (; i < argv.length && argv[i] !== '--'; i += 2) {
    if (argv[i] === '--text-compat') { textCompat = true; i -= 1; continue; }
    if (argv[i] === '--prompt-file') promptFile = argv[i + 1] || '';
    else if (argv[i] === '--prefix') prefix = argv[i + 1] || '';
    else if (argv[i] === '--emit') emit = argv[i + 1] || '';
    else usage(`unknown option ${argv[i]}`);
  }
  if (argv[i] !== '--') usage('missing -- before the agy command');
  const cmd = argv.slice(i + 1);
  if (cmd.length === 0) usage('empty agy command');
  if (emit !== 'response' && emit !== 'envelope') usage('--emit must be response|envelope');
  if (textCompat && emit !== 'response') usage('--text-compat only combines with --emit response');
  let prompt = prefix;
  if (promptFile) {
    try { prompt += fs.readFileSync(promptFile, 'utf8'); } catch (e) { usage(`cannot read prompt file: ${e.message}`); }
  }

  const line = encodeUserLine(prompt);
  const lineBytes = Buffer.byteLength(line, 'utf8');
  const maxBytes = stdinMaxBytes();
  if (lineBytes > maxBytes) {
    process.stderr.write(`agy-stream-json.js: agy_stdin_ceiling: the encoded prompt is ${lineBytes} bytes, over the ${maxBytes}-byte fail-closed stdin ceiling; agy was not run. Above roughly 175-200 KB agy can return status SUCCESS with an empty response (BL-0021), so an oversized prompt is refused rather than sent — split the unit, or raise AUTOPILOT_AGY_STDIN_MAX_BYTES on a host where you measured it\n`);
    process.exit(3);
  }
  const child = spawn(cmd[0], [...cmd.slice(1), ...STREAM_FLAGS], { stdio: ['pipe', 'pipe', 'inherit'] });
  const chunks = [];
  child.stdout.on('data', (d) => chunks.push(d));
  child.stdin.on('error', () => {}); // agy may exit before reading everything: its exit code speaks
  child.stdin.end(line);
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => { try { child.kill(sig); } catch (_e) { /* gone */ } });
  }
  child.on('error', (e) => {
    process.stderr.write(`agy-stream-json.js: cannot start ${cmd[0]}: ${e.message}\n`);
    process.exit(127);
  });
  child.on('close', (code, signal) => {
    const exitCode = () => (code == null ? 128 + ({ SIGTERM: 15, SIGKILL: 9, SIGINT: 2, SIGHUP: 1 }[signal] || 1) : code);
    if (textCompat) { // --text-compat has ONE output rule, see textCompatClose
      const raw = Buffer.concat(chunks);
      process.exit(textCompatClose(raw, code === 0 ? 0 : exitCode()));
    }
    if (code !== 0) process.exit(exitCode());
    const parsed = parseStream(Buffer.concat(chunks).toString('utf8'));
    if (!parsed.ok) {
      process.stderr.write(`agy-stream-json.js: ${parsed.reason}\n`);
      process.exit(1);
    }
    if (parsed.note) process.stderr.write(`agy-stream-json.js: ${parsed.note}\n`);
    process.stdout.write(emit === 'envelope' ? `${JSON.stringify(parsed.result)}\n` : parsed.result.response);
  });
}

// --text-compat: stands in for a plain `agy -p` text run. The old text mode printed whatever agy produced, then a
// newline, and callers classify failures from that text (authentication wording, ...). One rule, no branch on
// the text's content (no trim, no length): when a `result` event parses, write its text byte for byte (response
// when it is a string, else error) plus one newline; when none parses, replay agy's raw stdout.
// Exit code: agy's own non-zero code passes through; with agy exit 0 it is 0 for status SUCCESS with a string
// response (empty or whitespace-only included: the old text mode exited 0 there and the caller's own
// empty-output / oracle classification decides), 1 otherwise (status not SUCCESS, no result event, or the
// input-token ceiling reached: the BL-0021 silent-truncation guard stays on).
function textCompatClose(raw, agyCode) {
  const r = lastResult(raw.toString('utf8'));
  if (!r) {
    if (raw.length) fs.writeSync(1, raw);
    if (agyCode === 0) process.stderr.write('agy-stream-json.js: agy emitted no result event\n');
    return agyCode === 0 ? 1 : agyCode;
  }
  const text = typeof r.response === 'string' ? r.response
    : (r.error == null ? '' : (typeof r.error === 'string' ? r.error : JSON.stringify(r.error)));
  fs.writeSync(1, `${text}\n`);
  if (agyCode !== 0) return agyCode;
  if (r.status !== 'SUCCESS' || typeof r.response !== 'string') return 1;
  const used = r.usage && typeof r.usage === 'object' ? r.usage.input_tokens : undefined;
  if (typeof used === 'number' && Number.isFinite(used) && used >= inputTokenCeiling()) {
    process.stderr.write(`agy-stream-json.js: agy_input_truncated: ${used} input tokens at or over the ${inputTokenCeiling()}-token fail-closed ceiling (BL-0021)\n`);
    return 1;
  }
  return 0;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { encodeUserLine, parseStream, STREAM_FLAGS, stdinMaxBytes, DEFAULT_STDIN_MAX_BYTES, inputTokenCeiling, DEFAULT_INPUT_TOKEN_CEILING };
