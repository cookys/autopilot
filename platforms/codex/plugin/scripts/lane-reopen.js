#!/usr/bin/env node
'use strict';
/**
 * lane-reopen.js - G37 lane re-open tool (plan project/plans/2026-11-03-g37-account-switching.md 5.7, P4, N11).
 *
 *   node scripts/lane-reopen.js --alias <A> --cwd <dir> [--session S] [--window W] [--dry-run] -- [claude args...]
 *   node scripts/lane-reopen.js --pick --cwd <dir> ...
 *
 * Asks tmux for a new window that runs `node <abs>/scripts/claude-account.js exec --alias <A>
 * --purpose lane -- claude <args>` in --cwd. The tmux command line carries the alias only; the token is
 * read inside `exec` and exists only in the claude child's environment. `tmux new-window -e` is never used
 * (it would put the token in the tmux client argv). Does not kill the old lane.
 *
 * Exit codes: 0 ok / dry-run, 2 usage or invalid alias, 5 tmux failed.
 * Output: `reopened alias=<A> window=<session>:<name>` (--pick: `alias=pick`); --dry-run prints the exact command.
 * Node >= 20.10, built-ins only.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { ALIAS_RE } = require('./lib/account-registry');

const ACCOUNT_CLI = path.join(__dirname, 'claude-account.js');
const NAME_RE = /^[A-Za-z0-9._-]{1,40}$/;

function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function parse(argv) {
  const o = { claudeArgs: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o.claudeArgs = argv.slice(i + 1); break; }
    if (a === '--pick') o.pick = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--alias' || a === '--cwd' || a === '--session' || a === '--window') {
      if (i + 1 >= argv.length) return { error: `${a} needs a value` };
      o[a.slice(2)] = argv[++i];
    } else return { error: `unknown argument ${a}` };
  }
  return o;
}

function buildCommand(o) {
  const who = o.pick ? ['--pick'] : ['--alias', o.alias];
  const parts = [process.execPath, ACCOUNT_CLI, 'exec', ...who, '--purpose', 'lane', '--', 'claude', ...o.claudeArgs];
  return parts.map(shq).join(' ');
}

function main(argv, deps) {
  const d = deps || {};
  const out = d.out || ((s) => process.stdout.write(s + '\n'));
  const err = d.err || ((s) => process.stderr.write('lane-reopen: ' + s + '\n'));
  const run = d.spawnSync || spawnSync;
  const o = parse(argv);
  if (o.error) { err(o.error); return 2; }
  if ((o.alias === undefined) === (o.pick !== true)) { err('need exactly one of --alias or --pick'); return 2; }
  if (o.alias !== undefined && !ALIAS_RE.test(o.alias)) { err('alias_invalid'); return 2; }
  if (!o.cwd || !path.isAbsolute(o.cwd)) { err('--cwd must be an absolute directory'); return 2; }
  for (const k of ['session', 'window']) if (o[k] !== undefined && !NAME_RE.test(o[k])) { err(`${k} name invalid`); return 2; }
  const label = o.alias || 'pick';
  const window = o.window || `lane-${label}`;
  const cmd = buildCommand(o);
  const tmuxArgs = ['new-window', '-d', '-c', o.cwd, '-n', window];
  if (o.session) tmuxArgs.push('-t', o.session + ':');
  tmuxArgs.push(cmd);
  if (o.dryRun) { out(['tmux', ...tmuxArgs.slice(0, -1), cmd].join(' ')); return 0; }
  const r = run('tmux', tmuxArgs, { stdio: 'ignore' });
  if (r.error || r.status !== 0) { err('tmux_failed'); return 5; }
  out(`reopened alias=${label} window=${o.session || 'current'}:${window}`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, buildCommand };
