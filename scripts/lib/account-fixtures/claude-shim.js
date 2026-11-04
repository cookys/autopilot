#!/usr/bin/env node
'use strict';
/**
 * claude-shim.js - Node test double for the `claude` binary (G37 plan 2.5, 7).
 * Installed by shim-install.js as <tmp>/bin/claude (mode 0755). Test-only: never reads a real
 * credential, never prints the token it was handed except in the deliberate leak modes.
 *
 * Control file: shim-control.json next to the installed shim (the child env is an allowlist, so no
 * env var can carry the control path):
 *   { "log": "<abs file>", "default": <response>, "tokens": { "<token>": <response> } }
 * <response> = { "exit": 0, "stdout": "...", "stderr": "...", "leak": "plain"|"split"|"prefix", "hangMs": 0 }
 * Dual-format response (BL-0372 Task 3): when <response> carries a `result` OBJECT (and no static `stdout` is needed),
 * the shim renders it by the --output-format in argv, both from that one object:
 *   json         JSON.stringify(result) + "\n"
 *   stream-json  system/init line, assistant line, rate_limit_event line (`rate_limit_event` object overrides the
 *                default), then the SAME JSON.stringify(result) line + "\n" (plus the optional `stream_result_extra`
 *                keys appended, to model a CLI whose stream result line carries extra keys)
 *   text/absent  result.result + "\n"
 * A response without `result` keeps the old behaviour: the static `stdout` string, whatever the argv says.
 *
 * Each call appends one JSON line to `log`: argv, env NAMES (sorted), a sha256-first-8 fingerprint
 * of the presented token (never the token), HOME, CLAUDE_CONFIG_DIR, cwd, AUTOPILOT_ACCOUNT, and
 * whether an ambient credential file was reachable. Ambient fallback is simulated on purpose: if
 * $CLAUDE_CONFIG_DIR/.credentials.json or $HOME/.claude/.credentials.json (or a listed decoy)
 * exists, the shim "opens" it (decoy_read) and answers with a success envelope. A correct caller
 * never lets that happen.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sleep(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function w(fd, s) { fs.writeSync(fd, s); }

function renderResult(resp, argv) {
  const i = argv.indexOf('--output-format');
  const fmt = i >= 0 ? argv[i + 1] : 'text';
  const line = JSON.stringify(resp.result);
  if (fmt === 'json') return line + '\n';
  if (fmt === 'stream-json') {
    const sid = resp.result.session_id || 'S';
    const last = resp.stream_result_extra ? JSON.stringify(Object.assign({}, resp.result, resp.stream_result_extra)) : line;
    return [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: sid }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: String(resp.result.result) }] }, session_id: sid }),
      JSON.stringify(resp.rate_limit_event || { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' }, session_id: sid }),
      last,
    ].join('\n') + '\n';
  }
  return String(resp.result.result) + '\n';
}

function main() {
  const dir = path.dirname(fs.realpathSync(process.argv[1]));
  const ctl = JSON.parse(fs.readFileSync(path.join(dir, 'shim-control.json'), 'utf8'));
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN || '';
  const fp = token ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 8) : '';

  const ambient = [];
  for (const base of [process.env.CLAUDE_CONFIG_DIR, process.env.HOME && path.join(process.env.HOME, '.claude')]) {
    if (base) ambient.push(path.join(base, '.credentials.json'));
  }
  let decoyRead = false;
  for (const p of ambient) {
    try { fs.readFileSync(p); decoyRead = true; break; } catch (_) { /* not reachable */ }
  }

  fs.appendFileSync(ctl.log, JSON.stringify({
    argv: process.argv.slice(2),
    env_names: Object.keys(process.env).sort(),
    fp,
    home: process.env.HOME || null,
    config_dir: process.env.CLAUDE_CONFIG_DIR || null,
    account: process.env.AUTOPILOT_ACCOUNT || null,
    cwd: process.cwd(),
    decoy_read: decoyRead,
    locators: {
      accounts: process.env.AUTOPILOT_ACCOUNTS_DIR || null,
      live: process.env.AUTOPILOT_LIVE_DIR || null,
      state: process.env.AUTOPILOT_STATE_DIR || null,
      config: process.env.AUTOPILOT_CONFIG || null,
      runtime: process.env.XDG_RUNTIME_DIR || null,
    },
  }) + '\n');

  if (decoyRead) {
    w(1, JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK-FROM-AMBIENT' }) + '\n');
    return 0;
  }
  const resp = (ctl.tokens && ctl.tokens[token]) || ctl.default
    || { exit: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' }) + '\n' };
  sleep(resp.hangMs || 0);
  if (resp.leak) {
    for (const fd of [1, 2]) {
      if (resp.leak === 'prefix') {
        w(fd, 'leak:' + token.slice(0, -1));
      } else if (resp.leak === 'split') {
        const h = Math.floor(token.length / 2);
        w(fd, 'leak:' + token.slice(0, h));
        sleep(60);
        w(fd, token.slice(h) + '\n');
      } else {
        w(fd, 'leak:' + token + '\n');
      }
    }
  }
  const stdout = resp.result && typeof resp.result === 'object' ? renderResult(resp, process.argv.slice(2)) : resp.stdout;
  if (stdout) w(1, stdout);
  if (resp.stderr) w(2, resp.stderr);
  return resp.exit || 0;
}

process.exitCode = main();
