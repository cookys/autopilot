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
// response is empty after trim (`agy_empty_response`) and one whose PROMPT size is >=
// AUTOPILOT_AGY_INPUT_TOKEN_CEILING (default 95000; non-positive-integer = default; `agy_input_truncated`),
// even when the response is non-empty. No usage field at all -> the token check is skipped with a stderr note.
//
// WHAT "PROMPT SIZE" MEANS (hotfix 2026-11-04; basis: peer-measured agy 1.4.12, 2026-11-04). The wall is
// on the prompt that came in on stdin, NOT on the whole run. `result.usage.input_tokens` is the SUM over every
// step (a 3-file read: steps 1/3/5/7 = 7030+4556+3109+4076 = 18771 = result.usage.input_tokens), so a multi-step
// tool task crosses 95k with no truncation at all (511,413 was wrongly refused). Tool-read context does not drop
// the tail either (a 764 KB file read: single-step context 244,944, mid and tail nonces both correct, SUCCESS).
// So the gate measures the FIRST per-step usage event: `{"event":"step_update","step_update":{"step_type":
// "agent_response","state":"DONE","usage":{"input_tokens":N,"cache_read_tokens":M,...}}}` (only DONE
// agent_response steps carry usage; step 0 `user_input` and tool / ACTIVE / text_delta events have none), and
// compares input_tokens + cache_read_tokens. Only when no step event carries usage does it fall back to
// `result.usage.input_tokens` (a sum, so conservative: it can over-refuse, never under-refuse).
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

// Scan the stream once: the last `result` object, and the first per-step usage (the prompt-sized turn).
// Basis for the step shape: peer-measured agy 1.4.12, 2026-11-04 (step_update.usage on DONE agent_response).
function scanStream(text) {
  let result = null;
  let firstStep = null;
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch (_e) { continue; }
    if (!ev) continue;
    if (ev.event === 'result' && ev.result && typeof ev.result === 'object') result = ev.result;
    else if (ev.event === 'step_update' && firstStep === null && ev.step_update && typeof ev.step_update === 'object') {
      const u = ev.step_update.usage;
      if (u && typeof u === 'object' && Number.isFinite(u.input_tokens)) {
        const cr = Number.isFinite(u.cache_read_tokens) ? u.cache_read_tokens : 0;
        firstStep = { tokens: u.input_tokens + cr, step_index: ev.step_update.step_index };
      }
    }
  }
  return { result, firstStep };
}

// The one token-ceiling decision both exits share. Returns null when no usage exists to judge, else
// {over, tokens, ceiling, basis} where basis names the event that was measured.
function promptTokenGate(firstStep, result, env = process.env) {
  const ceiling = inputTokenCeiling(env);
  if (firstStep) {
    return { over: firstStep.tokens >= ceiling, tokens: firstStep.tokens, ceiling,
      basis: `the first per-step usage event (step_update step ${firstStep.step_index}, input_tokens + cache_read_tokens)` };
  }
  const used = result && result.usage && typeof result.usage === 'object' ? result.usage.input_tokens : undefined;
  if (typeof used === 'number' && Number.isFinite(used)) {
    return { over: used >= ceiling, tokens: used, ceiling,
      basis: 'result.usage.input_tokens (no per-step usage event was present, so this is the all-steps sum, not the prompt alone)' };
  }
  return null;
}

// Returns {ok:true, result} for SUCCESS, {ok:false, reason} for ERROR / no result event.
function parseStream(text, env = process.env) {
  const { result, firstStep } = scanStream(text);
  if (!result) return { ok: false, reason: 'agy emitted no result event' };
  if (result.status !== 'SUCCESS') {
    const err = result.error == null ? '(no error text)' : (typeof result.error === 'string' ? result.error : JSON.stringify(result.error));
    return { ok: false, reason: `agy result status ${String(result.status)}: ${err}` };
  }
  if (typeof result.response !== 'string') return { ok: false, reason: 'agy result has no string response' };
  if (result.response.trim() === '') {
    return { ok: false, reason: 'agy_empty_response: agy reported SUCCESS with an empty response (the silent truncation signature, BL-0021); treated as a failure, not a clean pass' };
  }
  const gate = promptTokenGate(firstStep, result, env);
  if (gate) {
    if (gate.over) {
      return { ok: false, reason: `agy_input_truncated: the prompt itself was ${gate.tokens} tokens (measured from ${gate.basis}), at or over the ${gate.ceiling}-token fail-closed ceiling (about 97.6k is where agy 1.4.6 silently drops the prompt tail, BL-0021); the answer cannot be trusted. Split the unit or raise AUTOPILOT_AGY_INPUT_TOKEN_CEILING where you measured it` };
    }
    return { ok: true, result };
  }
  return { ok: true, result, note: 'agy emitted no usage (neither a per-step usage event nor result.usage.input_tokens); the token-ceiling check was skipped (only the empty-response and byte-cap checks apply)' };
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
  const { result: r, firstStep } = scanStream(raw.toString('utf8'));
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
  const gate = promptTokenGate(firstStep, r);
  if (gate && gate.over) {
    process.stderr.write(`agy-stream-json.js: agy_input_truncated: the prompt itself was ${gate.tokens} tokens (measured from ${gate.basis}), at or over the ${gate.ceiling}-token fail-closed ceiling (BL-0021)\n`);
    return 1;
  }
  return 0;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { encodeUserLine, parseStream, STREAM_FLAGS, stdinMaxBytes, DEFAULT_STDIN_MAX_BYTES, inputTokenCeiling, DEFAULT_INPUT_TOKEN_CEILING };
