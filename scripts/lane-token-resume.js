#!/usr/bin/env node
'use strict';
/**
 * lane-token-resume.js — start a seat whose login is a token file.
 *
 *   node scripts/lane-token-resume.js --token-file PATH --cwd ABS [--session S] [--window W] [--dry-run] -- [args...]
 *   node scripts/lane-token-resume.js --exec --token-file PATH -- <cmd> [args...]
 *
 * The tmux command line is this program's --exec form plus the token-file path. The token
 * is read inside --exec and exists only in the child environment, with AUTOPILOT_TOKEN_SEAT=1.
 * It is never printed and never placed in argv. tmux new-window -e is never used.
 * A missing or empty token file exits 2 and does not spawn.
 *
 * Exit: 0 ok / dry-run, 2 usage or token file unusable, 5 tmux failed.
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const NAME_RE = /^[A-Za-z0-9._-]{1,40}$/;

function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function parse(argv) {
  const o = { cmd: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o.cmd = argv.slice(i + 1); break; }
    if (a === '--exec') o.exec = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--token-file' || a === '--cwd' || a === '--session' || a === '--window') {
      if (i + 1 >= argv.length) return { error: `${a} needs a value` };
      o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else return { error: `unknown argument ${a}` };
  }
  return o;
}

function readToken(file) {
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { error: 'token_file_unreadable' };
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return { error: 'token_file_unreadable' };
  }
  const token = text.replace(/\r?\n$/, '');
  if (token.length === 0) return { error: 'token_file_empty' };
  return { token };
}

function buildCommand(o) {
  const self = path.join(__dirname, 'lane-token-resume.js');
  const parts = [process.execPath, self, '--exec', '--token-file', o.tokenFile, '--', ...o.cmd];
  return parts.map(shq).join(' ');
}

function main(argv, deps) {
  const d = deps || {};
  const out = d.out || ((s) => process.stdout.write(s + '\n'));
  const err = d.err || ((s) => process.stderr.write('lane-token-resume: ' + s + '\n'));
  const run = d.spawnSync || spawnSync;
  const o = parse(argv);
  if (o.error) { err(o.error); return 2; }
  if (!o.tokenFile) { err('--token-file is required'); return 2; }
  if (o.exec) {
    if (o.dryRun || o.cwd || o.session || o.window) { err('--exec does not take tmux options'); return 2; }
    if (o.cmd.length === 0) { err('--exec requires -- <cmd> [args...]'); return 2; }
    const got = readToken(o.tokenFile);
    if (got.error) { err(got.error); return 2; }
    const childEnv = Object.assign({}, process.env, {
      CLAUDE_CODE_OAUTH_TOKEN: got.token,
      AUTOPILOT_TOKEN_SEAT: '1',
    });
    const child = spawn(o.cmd[0], o.cmd.slice(1), { stdio: 'inherit', env: childEnv });
    return new Promise((resolve) => {
      child.on('error', () => { err('spawn_failed'); resolve(127); });
      child.on('exit', (code, signal) => {
        if (signal) resolve(1);
        else resolve(code == null ? 1 : code);
      });
    });
  }
  if (!o.cwd || !path.isAbsolute(o.cwd)) { err('--cwd must be an absolute directory'); return 2; }
  for (const k of ['session', 'window']) if (o[k] !== undefined && !NAME_RE.test(o[k])) { err(`${k} name invalid`); return 2; }
  const window = o.window || 'lane-token';
  const cmd = buildCommand(o);
  const tmuxArgs = ['new-window', '-d', '-c', o.cwd, '-n', window];
  if (o.session) tmuxArgs.push('-t', o.session + ':');
  tmuxArgs.push(cmd);
  if (o.dryRun) { out(['tmux', ...tmuxArgs.slice(0, -1), cmd].join(' ')); return 0; }
  const got = readToken(o.tokenFile);
  if (got.error) { err(got.error); return 2; }
  const r = run('tmux', tmuxArgs, { stdio: 'ignore' });
  if (r.error || r.status !== 0) { err('tmux_failed'); return 5; }
  out(`resumed window=${o.session || 'current'}:${window}`);
  return 0;
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  if (code && typeof code.then === 'function') code.then((c) => { process.exitCode = c; });
  else process.exitCode = code;
}
module.exports = { main, buildCommand, parse };
