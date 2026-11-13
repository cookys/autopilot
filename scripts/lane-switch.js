#!/usr/bin/env node
'use strict';
/**
 * lane-switch.js - move a lane to another login profile (plan project/plans/2026-11-10-profile-switch.md, P2).
 *
 *   node scripts/lane-switch.js --lane L --profile P --order <fleet message id> [--dry-run]
 *
 * --dry-run prints the exact ordered steps 1-8 and the reverse (rollback) command and executes nothing.
 * Without --dry-run it runs steps 1-7 in order, journaling each one, then prints the step-8 confirm
 * command and does not wait on it. --order is mandatory (constraint 5: the PM orders, no automatic
 * switching). No credential file is opened here; the account hash comes only from lib/account-alias.js.
 * tmux, claude, fleet, codeforge and accept-dev-channel-prompt.sh all go through one runner
 * (deps.run in tests, spawnSync otherwise).
 * Overrides for tests: AUTOPILOT_LANE_BASE_DIR (manifest + journal base), deps.home, deps.run,
 * deps.now, deps.sleep, deps.fs, deps.handoffTimeoutMs (requestHandoff bound; default 15 min).
 *
 * Exit codes: 0 ok / dry-run, 1 a step failed, 2 usage, 4 manifest or journal error.
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readManifest, writeManifest } = require('./lib/lane-manifest');
const { appendJournal } = require('./lib/switch-journal');
const { preflight } = require('./lib/lane-switch-preflight');
const { requestHandoff } = require('./lib/lane-switch-handoff');
const { collectAndCopy, cwdKey } = require('./lib/lane-switch-transcript');
const { claudeAccount } = require('./lib/account-alias');
const { handoffPath } = require('./resolve-repo-placement');
const { parsePeers, rowMatchesSeat, isLive, isOffline } = require('./lib/fleet-peers');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ORDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/;
const ALIAS_RE = /^(?:acct-[0-9a-f]{8}|[a-z0-9-]{1,24})$/;
// Same list as scripts/profile-health.js DROP_ENV, plus AUTOPILOT_ACCOUNT (tier 1 would defeat attribution).
const DROP_ENV = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AUTOPILOT_ACCOUNT'];
const STOP_WAIT_MS = 120000;
const SEAT_WAIT_MS = 60000;
const POLL_MS = 1000;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'ash', 'csh', 'tcsh']);
const WHY_ZH = { alias: '別名', cwd: '工作目錄', session: 'session', auth: '登入狀態', seat: 'fleet 位址' };

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
const SID_PLACEHOLDER = '<session id>';
function startLine(dir, sid, flags) {
  const env = ['env', ...DROP_ENV.flatMap((k) => ['-u', k]), ...(dir ? [`CLAUDE_CONFIG_DIR=${q(dir)}`] : ['-u', 'CLAUDE_CONFIG_DIR'])];
  return [...env, 'claude', '--resume', sid === SID_PLACEHOLDER ? sid : q(sid), ...flags].join(' ');
}

function configDir(home, profile) {
  return profile === 'home' ? path.join(home, '.claude') : path.join(home, '.claude-profiles', profile);
}

function scrub(env) {
  const out = { ...(env || {}) };
  for (const k of DROP_ENV) delete out[k];
  delete out.CODEFORGE_DATA_DIR;
  return out;
}

function aliasEnv(home, profile) {
  const env = scrub(process.env);
  env.HOME = home;
  if (profile === 'home') delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = configDir(home, profile);
  return env;
}

function fleetBin() { return process.env.AUTOPILOT_FLEET_BIN || 'fleet'; }
function claudeBin() { return process.env.AUTOPILOT_CLAUDE_BIN || 'claude'; }

function guardRun(run) {
  return (bin, args, opts) => {
    const next = { ...(opts || {}) };
    next.env = scrub(next.env || process.env);
    return run(bin, args, next);
  };
}

function defaultRun(bin, args, opts) {
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    env: opts && opts.env,
    timeout: opts && opts.timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function makeClock(deps) {
  const readExternal = () => {
    if (typeof deps.now === 'function') {
      const v = deps.now();
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : null;
      }
      return null;
    }
    if (typeof deps.now === 'number' && Number.isFinite(deps.now)) return deps.now;
    if (typeof deps.now === 'string') {
      const t = Date.parse(deps.now);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  };
  const seed = readExternal();
  let manual = seed === null ? Date.now() : seed;
  let extra = 0;
  const now = () => {
    if (typeof deps.now === 'function') {
      const ext = readExternal();
      if (ext !== null) return ext + extra;
    }
    // No injected clock: read the wall clock every call. A one-shot Date.now()
    // (manual) ignores synchronous subprocess time, so a bounded wait overruns.
    if (deps.now == null) return Date.now() + extra;
    return manual + extra;
  };
  const sleep = async (ms) => {
    const before = now();
    if (typeof deps.sleep === 'function') await deps.sleep(ms);
    else await new Promise((resolve) => setTimeout(resolve, ms));
    if (now() <= before) extra += ms;
  };
  return { now, iso: () => new Date(now()).toISOString(), sleep };
}

function isShell(name) {
  const base = String(name || '').trim().split(/[/\\]/).pop();
  return SHELLS.has(base);
}

function okRun(r) { return !!(r && r.status === 0 && !r.error); }

function seatRow(stdout, seat) {
  const members = parsePeers(stdout);
  if (!members) return { members: null, row: null };
  return { members, row: members.find((m) => rowMatchesSeat(m, seat)) || null };
}

// Directory row gone, or present and offline. An unreadable listing is not a release.
function released(stdout, seat) {
  const { members, row } = seatRow(stdout, seat);
  if (!members) return false;
  if (!row) return true;
  return isOffline(row);
}

function addressSame(stdout, seat) {
  const { members, row } = seatRow(stdout, seat);
  if (!members || !row || !isLive(row)) return false;
  const doubled = members.some((m) => m && m.member === `${seat}-2` && isLive(m));
  return !doubled;
}

async function waitFor(clock, bound, pred) {
  const start = clock.now();
  for (;;) {
    const value = pred();
    if (value) return value;
    const elapsed = clock.now() - start;
    if (elapsed >= bound) return null;
    await clock.sleep(Math.min(POLL_MS, bound - elapsed));
  }
}

function paneField(run, env, pane, fmt) {
  let r;
  try { r = run('tmux', ['display', '-p', '-t', pane, fmt], { env, timeout: 20000 }); } catch { return null; }
  if (!okRun(r)) return null;
  const text = String(r.stdout || '').trim();
  return text || null;
}

function record(err, base, o, from, to, step, outcome, detail, iso) {
  try {
    const row = { order: o.order, lane: o.lane, step, from, to, outcome };
    if (detail) row.detail = detail;
    appendJournal(base, row, iso);
    return null;
  } catch (e) {
    err(e.message);
    return 4;
  }
}

function failReport(lane, why, profile) {
  return `[換訂閱失敗] lane=${lane} 事後檢查不符（${WHY_ZH[why] || why}），已改回 profile=${profile}。`;
}

// /exit, optionally C-c, then the shell (120s) and the fleet directory row gone or offline (60s).
async function exitToShell(run, env, pane, seat, clock, interrupt) {
  let r;
  try { r = run('tmux', ['send-keys', '-t', pane, '/exit', 'Enter'], { env, timeout: 20000 }); } catch { return 'send_failed'; }
  if (!okRun(r)) return 'send_failed';
  if (interrupt) {
    try { r = run('tmux', ['send-keys', '-t', pane, 'C-c'], { env, timeout: 20000 }); } catch { return 'send_failed'; }
    if (!okRun(r)) return 'send_failed';
  }
  const shell = await waitFor(clock, STOP_WAIT_MS, () => {
    const cmd = paneField(run, env, pane, '#{pane_current_command}');
    return isShell(cmd) ? cmd : null;
  });
  if (!shell) return 'shell_timeout';
  const free = await waitFor(clock, SEAT_WAIT_MS, () => {
    let rr;
    try { rr = run(fleetBin(), ['peers', '--json'], { env, timeout: 20000 }); } catch { return null; }
    if (!okRun(rr)) return null;
    return released(rr.stdout, seat) ? true : null;
  });
  if (!free) return 'seat_held';
  return null;
}

function sendStart(run, env, pane, cwd, dir, sid, flags) {
  const cmd = `cd ${q(cwd)} && ${startLine(dir, sid, flags)}`;
  let r;
  try { r = run('tmux', ['send-keys', '-t', pane, cmd, 'Enter'], { env, timeout: 20000 }); } catch { return false; }
  return okRun(r);
}

function targetLoggedIn(run, env) {
  let r;
  try { r = run(claudeBin(), ['auth', 'status', '--json'], { env, timeout: 20000 }); } catch { return false; }
  if (!okRun(r)) return false;
  try {
    const j = JSON.parse(r.stdout);
    return !!(j && j.loggedIn === true);
  } catch { return false; }
}

function aliasVia(run, env) {
  const script = `process.stdout.write(require(${JSON.stringify(require.resolve('./lib/account-alias'))}).claudeAccount(process.env))`;
  let r;
  try { r = run(process.execPath, ['-e', script], { env, timeout: 20000 }); } catch { return null; }
  if (!okRun(r)) return null;
  const alias = String(r.stdout || '').trim();
  return ALIAS_RE.test(alias) ? alias : null;
}

function sessionNow(fsys, home, profile, cwd) {
  const dir = path.join(configDir(home, profile), 'projects', cwdKey(cwd));
  let names;
  try { names = fsys.readdirSync(dir); } catch { return null; }
  let best = null;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const abs = path.join(dir, name);
    let st;
    try { st = fsys.lstatSync(abs); } catch { continue; }
    if (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) continue;
    if (typeof st.isFile === 'function' && !st.isFile()) continue;
    const mtime = Number(st.mtimeMs) || 0;
    if (!best || mtime >= best.mtime) best = { id: name.slice(0, -'.jsonl'.length), mtime };
  }
  return best ? best.id : null;
}

function buildPlan(o, m, home) {
  const from = (m && m.profile) || '<manifest profile>';
  const fromDir = m && m.profile ? profileDir(home, m.profile) : null;
  // Old-profile env for steps 1 and 4: its dir, or unset for home, or a placeholder without a manifest.
  const oldCfg = m && m.profile ? (fromDir ? `CLAUDE_CONFIG_DIR=${q(fromDir)}` : '-u CLAUDE_CONFIG_DIR') : 'CLAUDE_CONFIG_DIR=<old profile dir>';
  const toDir = profileDir(home, o.profile);
  const pane = (m && m.pane) || '<pane>';
  const cwd = (m && m.cwd) || '<cwd>';
  const sid = (m && m.session_id) || SID_PLACEHOLDER;
  const seat = (m && m.seat) || '<fleet seat>';
  const flags = ((m && m.launch_flags) || []).map(q);
  const dev = path.join(__dirname, 'accept-dev-channel-prompt.sh');
  const steps = [
    ['1 before', `fleet whoami / directory: confirm seat ${seat} is live; record session id ${sid} (transcript <old dir>/projects/<cwd-slug>/${sid}.jsonl) and pane cwd (tmux display -p -t ${shq(pane)} '#{pane_current_path}') into the manifest`],
    ['1 before', `env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u AUTOPILOT_ACCOUNT ${oldCfg} claude auth status --json   # old profile ${from}: loggedIn + alias via lib/account-alias.js (never e-mail); latest cost-row account of the session`],
    ['1 before', `profile-health.js check --json   # target ${o.profile} logged in and not expiring`],
    ['2 handoff', `fleet send ${shq(seat)} "autopilot:handoff"; proceed only when a handoff file newer than the request exists and the lane is idle`],
    ['3 stop', `tmux send-keys -t ${shq(pane)} '/exit' Enter; wait until #{pane_current_command} is the shell; confirm the old session released seat ${seat} (else a -2 seat)`],
    ['4 collect+copy', `env -u CODEFORGE_DATA_DIR ${oldCfg} codeforge usage collect > /dev/null   # old profile; no --quiet; CODEFORGE_DATA_DIR never set`],
    ['4 collect+copy', `cp -a <old dir>/projects/<cwd-slug>/${sid}.jsonl <old dir>/projects/<cwd-slug>/${sid} -> ${toDir || path.join(home, '.claude')}/projects/<cwd-slug>/   # copy, never move`],
    ['5 start', `tmux send-keys -t ${shq(pane)} ${shq(`cd ${q(cwd)} && ${startLine(toDir, sid, flags)}`)} Enter`],
    ['6 dev-channel', `${shq(dev)} --pane ${shq(pane)} --timeout 90   # exit 1 (incl. folder-trust/login screen): send /exit, C-c, wait for shell, run the reverse start`],
    ['7 after', `check: same seat ${seat}, pane cwd ${cwd}, session id ${sid}; claude auth status --json of ${o.profile} loggedIn; alias of the target dir (lib/account-alias.js) differs from the old one and equals the first-login record. Mismatch = reverse + failure report to the PM; absence of a cost row never reverses`],
    ['8 confirm', `poll for the first cost row of session ${sid} after the switch (bounded 30 min after the next turn): account must equal the ${o.profile} alias; then codeforge usage --by account shows the pre-switch part under the old account`],
  ];
  const rollback = `node ${shq(path.join(__dirname, 'lane-switch.js'))} --lane ${shq(o.lane)} --profile ${shq(m && m.profile ? m.profile : '<original profile>')} --order ${shq(o.order)} --dry-run   # rollback = the same command with the original profile (drop --dry-run when execution is enabled)`;
  return { steps, rollback, from };
}

async function execute(o, d, home, base) {
  const out = d.out || ((s) => process.stdout.write(s + '\n'));
  const err = d.err || ((s) => process.stderr.write('lane-switch: ' + s + '\n'));
  const clock = makeClock(d);
  const run = guardRun(d.run || defaultRun);
  const fsys = d.fs || fs;
  const env = scrub(process.env);
  env.HOME = home;
  const note = (from, to, step, outcome, detail) => record(err, base, o, from, to, step, outcome, detail, clock.iso());

  let pre;
  try {
    pre = preflight(
      { lane: o.lane, profile: o.profile, order: o.order, baseDir: base, home },
      { run, now: clock.iso(), fs: fsys, home },
    );
  } catch (e) {
    err(e && e.message ? e.message : 'preflight');
    return 1;
  }
  if (!pre.ok) {
    const bad = (pre.checks || []).find((c) => !c.ok);
    err(bad ? bad.name : 'preflight');
    return 1;
  }
  let manifest;
  try { manifest = readManifest(base, o.lane); } catch (e) { err(e.message); return 4; }
  const from = manifest.profile;
  const cwd = pre.record.pane_cwd;
  const sid = manifest.session_id;
  const pane = manifest.pane;
  const seat = manifest.seat;
  const flags = manifest.launch_flags || [];
  const oldDir = profileDir(home, from);
  const newDir = profileDir(home, o.profile);
  const oldAlias = pre.record.current_alias;
  const recorded = claudeAccount(aliasEnv(home, o.profile));
  if (!oldAlias || !recorded || recorded === oldAlias) {
    const j = note(from, o.profile, 'alias', 'fail', 'same');
    if (j) return j;
    err('alias');
    return 1;
  }

  let ho;
  try {
    const handoffOpts = {
      order: o.order, lane: o.lane, seat, handoffPath: handoffPath(cwd, 'manual', home),
      base, from, to: o.profile,
    };
    if (Number.isFinite(d.handoffTimeoutMs)) handoffOpts.timeoutMs = d.handoffTimeoutMs;
    ho = await requestHandoff(handoffOpts, { run, now: () => clock.now(), sleep: (ms) => clock.sleep(ms), fs: fsys });
  } catch { ho = { ok: false, reason: 'timeout' }; }
  if (!ho.ok) {
    err('handoff');
    return 1;
  }

  const stopped = await exitToShell(run, env, pane, seat, clock, false);
  if (stopped === 'shell_timeout' || stopped === 'send_failed') {
    const j = note(from, o.profile, 'stop', 'fail', stopped);
    if (j) return j;
    err('stop');
    return 1;
  }
  if (stopped) {
    let j = note(from, o.profile, 'stop', 'ok');
    if (j) return j;
    j = note(from, o.profile, 'seat-release', 'fail', stopped);
    if (j) return j;
    err('seat-release');
    return 1;
  }
  let j = note(from, o.profile, 'stop', 'ok');
  if (j) return j;
  j = note(from, o.profile, 'seat-release', 'ok');
  if (j) return j;

  let copied;
  try {
    copied = collectAndCopy({
      from, to: o.profile, cwd, sessionId: sid, order: o.order, lane: o.lane, home, base,
    }, { run, now: () => clock.iso(), fs: fsys, env: scrub(process.env), home, base });
  } catch {
    err('collect');
    return 1;
  }
  if (!copied.ok) {
    const back = sendStart(run, env, pane, cwd, oldDir, sid, flags);
    j = note(from, o.profile, 'reverse', back ? 'started' : 'start_failed', 'collect');
    if (j) return j;
    err('collect');
    return 1;
  }

  const since = clock.iso();
  if (!sendStart(run, env, pane, cwd, newDir, sid, flags)) {
    const back = sendStart(run, env, pane, cwd, oldDir, sid, flags);
    j = note(from, o.profile, 'reverse', back ? 'started' : 'start_failed', 'start');
    if (j) return j;
    err('start');
    return 1;
  }
  j = note(from, o.profile, 'start', 'ok');
  if (j) return j;

  const accept = path.join(__dirname, 'accept-dev-channel-prompt.sh');
  let acc;
  try { acc = run(accept, ['--pane', pane, '--timeout', '90'], { env, timeout: 120000 }); } catch { acc = { status: 1 }; }
  if (!okRun(acc)) {
    j = note(from, o.profile, 'dev-channel', 'fail');
    if (j) return j;
    const backStop = await exitToShell(run, env, pane, seat, clock, true);
    if (backStop) {
      j = note(from, o.profile, 'reverse', 'stop_failed', 'dev-channel');
      if (j) return j;
      err('dev-channel');
      return 1;
    }
    const back = sendStart(run, env, pane, cwd, oldDir, sid, flags);
    j = note(from, o.profile, 'reverse', back ? 'started' : 'start_failed', 'dev-channel');
    if (j) return j;
    err('dev-channel');
    return 1;
  }
  j = note(from, o.profile, 'dev-channel', 'ok');
  if (j) return j;

  const why = afterWhy(run, env, fsys, home, o.profile, pane, cwd, sid, seat, oldAlias, recorded);
  if (why) {
    j = note(from, o.profile, 'after', 'fail', why);
    if (j) return j;
    const backStop = await exitToShell(run, env, pane, seat, clock, false);
    let rev = 'stop_failed';
    if (!backStop) {
      const back = sendStart(run, env, pane, cwd, oldDir, sid, flags);
      rev = back ? 'started' : 'start_failed';
    }
    j = note(from, o.profile, 'reverse', rev, why);
    if (j) return j;
    err(failReport(o.lane, why, from));
    return 1;
  }
  j = note(from, o.profile, 'after', 'ok');
  if (j) return j;

  try {
    const cur = readManifest(base, o.lane);
    writeManifest(base, { ...cur, profile: o.profile });
  } catch (e) { err(e.message); return 4; }
  const confirm = path.join(__dirname, 'lib', 'lane-switch-confirm.js');
  out(['node', q(confirm), '--lane', q(o.lane), '--since', q(since), '--alias', q(recorded), '--profile', q(o.profile)].join(' '));
  j = note(from, o.profile, 'confirm', 'printed');
  if (j) return j;
  return 0;
}

function afterWhy(run, env, fsys, home, profile, pane, cwd, sid, seat, oldAlias, recorded) {
  let peers;
  try { peers = run(fleetBin(), ['peers', '--json'], { env, timeout: 20000 }); } catch { return 'seat'; }
  if (!okRun(peers) || !addressSame(peers.stdout, seat)) return 'seat';
  if (paneField(run, env, pane, '#{pane_current_path}') !== cwd) return 'cwd';
  if (sessionNow(fsys, home, profile, cwd) !== sid) return 'session';
  const authEnv = aliasEnv(home, profile);
  if (!targetLoggedIn(run, authEnv)) return 'auth';
  const nowAlias = aliasVia(run, authEnv);
  if (!nowAlias || nowAlias === oldAlias || nowAlias !== recorded) return 'alias';
  return null;
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
  if (!o.dryRun) return execute(o, d, home, base);
  let m;
  try { m = readManifest(base, o.lane); } catch (e) { err(e.message); return 4; }
  const plan = buildPlan(o, m, home);
  // Journal first: its checkRow refuses token/e-mail-shaped values before anything reaches stdout.
  try {
    appendJournal(base, { order: o.order, lane: o.lane, step: 'dry-run', from: plan.from, to: o.profile, outcome: 'dry-run' }, d.now);
  } catch (e) { err(e.message); return 4; }
  out(`# lane-switch dry-run lane=${o.lane} from=${plan.from} to=${o.profile} order=${o.order}${m ? '' : ' (no lane manifest: placeholders)'}`);
  plan.steps.forEach(([n, c], i) => out(`${String(i + 1).padStart(2, '0')} [${n}] ${c}`));
  out(`RB [rollback] ${plan.rollback}`);
  return 0;
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  if (code && typeof code.then === 'function') {
    code.then((c) => { process.exitCode = c; }, (e) => {
      process.stderr.write('lane-switch: ' + (e && e.message ? e.message : e) + '\n');
      process.exitCode = 1;
    });
  } else process.exitCode = code;
}
module.exports = { main, parse, buildPlan, startLine, DROP_ENV };
