#!/usr/bin/env node
'use strict';
/**
 * lane-switch.js - move a lane to another login profile (plan docs/plans/2026-11-10-profile-switch.md, P2).
 *
 *   node scripts/lane-switch.js --lane L --profile P --order <fleet message id> [--dry-run]
 *
 * P2a scope: argument parsing, the lane manifest and journal, and --dry-run, which prints the exact ordered
 * steps 1-8 and the reverse (rollback) command and executes nothing. Without --dry-run it refuses
 * ("P2 execution not enabled in P2a", exit 3). --order is mandatory (constraint 5: the PM orders, no automatic
 * switching). No credential file is opened here; the account hash comes only from lib/account-alias.js at run time.
 * Overrides for tests: AUTOPILOT_LANE_BASE_DIR (manifest + journal base), deps.home.
 *
 * Exit codes: 0 ok / dry-run, 2 usage, 3 execution not enabled, 4 manifest or journal error.
 * Node >= 20.10, built-ins only.
 */
const os = require('os');
const path = require('path');
const { readManifest } = require('./lib/lane-manifest');
const { appendJournal } = require('./lib/switch-journal');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ORDER_RE = /^[A-Za-z0-9._-]{4,64}$/;
// Same list as scripts/profile-health.js DROP_ENV, plus AUTOPILOT_ACCOUNT (tier 1 would defeat attribution).
const DROP_ENV = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AUTOPILOT_ACCOUNT'];

function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
// Quote only when needed, so a command nested inside another shq() stays readable.
function q(s) { return /^[A-Za-z0-9_@%+=:,./-]+$/.test(String(s)) ? String(s) : shq(s); }

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--lane' || a === '--profile' || a === '--order') {
      if (i + 1 >= argv.length) return { error: `${a} needs a value` };
      o[a.slice(2)] = argv[++i];
    } else return { error: `unknown argument ${a}` };
  }
  return o;
}

function profileDir(home, profile) { return profile === 'home' ? null : path.join(home, '.claude-profiles', profile); }

// Start line of step 5: scrubbed env, CLAUDE_CONFIG_DIR of the profile (unset for home), claude --resume.
function startLine(dir, sid, flags) {
  const env = ['env', ...DROP_ENV.flatMap((k) => ['-u', k]), ...(dir ? [`CLAUDE_CONFIG_DIR=${q(dir)}`] : ['-u', 'CLAUDE_CONFIG_DIR'])];
  return [...env, 'claude', '--resume', sid, ...flags].join(' ');
}

function buildPlan(o, m, home) {
  const from = (m && m.profile) || '<manifest profile>';
  const fromDir = m && m.profile ? profileDir(home, m.profile) : null;
  const fromDirTxt = m && m.profile ? (fromDir || '(home: unset)') : '<old profile dir>';
  const toDir = profileDir(home, o.profile);
  const pane = (m && m.pane) || '<pane>';
  const cwd = (m && m.cwd) || '<cwd>';
  const sid = (m && m.session_id) || '<session id>';
  const seat = (m && m.seat) || '<fleet seat>';
  const flags = ((m && m.launch_flags) || []).map(q);
  const dev = path.join(__dirname, 'accept-dev-channel-prompt.sh');
  const steps = [
    ['1 before', `fleet whoami / directory: confirm seat ${seat} is live; record session id ${sid} (transcript <old dir>/projects/<cwd-slug>/${sid}.jsonl) and pane cwd (tmux display -p -t ${shq(pane)} '#{pane_current_path}') into the manifest`],
    ['1 before', `env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u AUTOPILOT_ACCOUNT claude auth status --json   # old profile ${from}: loggedIn + alias via lib/account-alias.js (never e-mail); latest cost-row account of the session`],
    ['1 before', `profile-health.js check --json   # target ${o.profile} logged in and not expiring`],
    ['2 handoff', `fleet send ${shq(seat)} "autopilot:handoff"; proceed only when a handoff file newer than the request exists and the lane is idle`],
    ['3 stop', `tmux send-keys -t ${shq(pane)} '/exit' Enter; wait until #{pane_current_command} is the shell; confirm the old session released seat ${seat} (else a -2 seat)`],
    ['4 collect+copy', `CLAUDE_CONFIG_DIR=${shq(fromDir || path.join(home, '.claude'))} codeforge usage collect > /dev/null   # no --quiet; CODEFORGE_DATA_DIR never set`],
    ['4 collect+copy', `cp -a <old dir>/projects/<cwd-slug>/${sid}.jsonl <old dir>/projects/<cwd-slug>/${sid} -> ${toDir || path.join(home, '.claude')}/projects/<cwd-slug>/   # copy, never move`],
    ['5 start', `tmux send-keys -t ${shq(pane)} ${shq(`cd ${q(cwd)} && ${startLine(toDir, sid, flags)}`)} Enter`],
    ['6 dev-channel', `${shq(dev)} --pane ${shq(pane)} --timeout 90   # exit 1 (incl. folder-trust/login screen): send /exit, C-c, wait for shell, run the reverse start`],
    ['7 after', `check: same seat ${seat}, pane cwd ${cwd}, session id ${sid}; claude auth status --json of ${o.profile} loggedIn; alias of the target dir (lib/account-alias.js) differs from the old one and equals the first-login record. Mismatch = reverse + failure report to the PM; absence of a cost row never reverses`],
    ['8 confirm', `poll for the first cost row of session ${sid} after the switch (bounded 30 min after the next turn): account must equal the ${o.profile} alias; then codeforge usage --by account shows the pre-switch part under the old account`],
  ];
  const rollback = `node ${shq(path.join(__dirname, 'lane-switch.js'))} --lane ${shq(o.lane)} --profile ${shq(m && m.profile ? m.profile : '<original profile>')} --order ${shq(o.order)} --dry-run   # rollback = the same command with the original profile (drop --dry-run when execution is enabled)`;
  return { steps, rollback, from };
}

function main(argv, deps) {
  const d = deps || {};
  const out = d.out || ((s) => process.stdout.write(s + '\n'));
  const err = d.err || ((s) => process.stderr.write('lane-switch: ' + s + '\n'));
  const home = d.home || os.homedir();
  const base = d.baseDir || process.env.AUTOPILOT_LANE_BASE_DIR || path.join(home, '.config', 'autopilot');
  const o = parse(argv);
  if (o.error) { err(o.error); return 2; }
  if (!o.order) { err('--order <fleet message id> is required (the PM orders every switch)'); return 2; }
  if (!ORDER_RE.test(o.order)) { err('--order is not a fleet message id'); return 2; }
  if (!o.lane || !NAME_RE.test(o.lane)) { err('--lane missing or invalid'); return 2; }
  if (!o.profile || !NAME_RE.test(o.profile)) { err('--profile missing or invalid'); return 2; }
  if (!o.dryRun) { err('P2 execution not enabled in P2a'); return 3; }
  let m;
  try { m = readManifest(base, o.lane); } catch (e) { err(e.message); return 4; }
  const plan = buildPlan(o, m, home);
  out(`# lane-switch dry-run lane=${o.lane} from=${plan.from} to=${o.profile} order=${o.order}${m ? '' : ' (no lane manifest: placeholders)'}`);
  plan.steps.forEach(([n, c], i) => out(`${String(i + 1).padStart(2, '0')} [${n}] ${c}`));
  out(`RB [rollback] ${plan.rollback}`);
  try {
    appendJournal(base, { order: o.order, lane: o.lane, step: 'dry-run', from: plan.from, to: o.profile, outcome: 'dry-run' }, d.now);
  } catch (e) { err(e.message); return 4; }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parse, buildPlan, startLine, DROP_ENV };
