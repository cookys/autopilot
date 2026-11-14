#!/usr/bin/env node
'use strict';

// check-unmerged-ship.js - flag a branch that got a SHIP-AS-IS review verdict and still is not in the target branch.
//
// Why: two reviewed branches sat unmerged for hours waiting for a batch; nothing noticed (e2e PM order 01M7E183).
//
// usage: check-unmerged-ship.js [--repo <dir>] [--target <ref>] [--max-age <minutes>] [--window-days <n>]
//          [--review-ledger <dir>]... [--runs-dir <dir>] [--merge-owner <fleet address>] [--notify] [--json] [--now <iso>]
//   --repo          repository to check (default cwd); any worktree of it works
//   --target        branch a reviewed head must reach (default origin/develop)
//   --max-age       minutes after the verdict before an unmerged head is an alert
//                   (default config `unmerged_ship.max_age_minutes`, else 60)
//   --window-days   verdicts newer than this are looked at (default 7)
//   --review-ledger extra hetero-review-loop ledger root (repeatable; the roots `autopilot status events` finds are always read)
//   --runs-dir      dispatch run manifests (default scripts/lib/runtime-paths.js runsDir)
//   --merge-owner   fleet address of the lane that must merge (default env AUTOPILOT_FLEET_ADDRESS); used by --notify
//   --notify        for each alert not yet notified for that head: print the alert line and, when the verdict carries a
//                   fleet task, mark that task blocked (markBlocked below). Dedupe state lives in the live-state dir.
//   --json          print schema autopilot.unmerged-ship/1 on stdout
// exit: 0 nothing to alert, 1 at least one alert, 2 usage.
//
// Verdict sources (the existing records, no second store):
//   review     hetero-review-loop ledgers, read through src/status/events/sources/review.js: review.collected carries the
//              reviewed head and the fleet task, review.finalized carries the verdict and its time; joined on the event id.
//   dispatch   single-seat scripts/dispatch-review.sh runs: the run manifest carries verdict, head (repo HEAD when the run
//              started, with a --diff-file), repo_root, fleet_task and ended_at.
//
// Merged = head is an ancestor of the target, OR every commit of head has a patch-equal commit in the target (`git cherry`),
// OR the net patch of head against its merge-base equals a single commit's patch in the target (a squash re-land).
// A head object missing from the repository is state `unknown`, never an alert.
//
// markBlocked needs the session running this to be the fleet task's ASSIGNEE (the requester gets `not_assignee`).
// A fleet failure (older fleet that rejects `blocked`, not_assignee, binary missing) is one stderr line; it is never retried.
// Node built-ins only.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SCHEMA = 'autopilot.unmerged-ship/1';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DEFAULT_MAX_AGE_MIN = 60;
const DEFAULT_WINDOW_DAYS = 7;
// the whole fleet call in one place: a change of the fleet verb is a one-line edit here
const FLEET_BLOCKED_ARGV = (task, blockedOn, noteWords) => ['task', 'progress', task, 'blocked', '--blocked-on', blockedOn, ...noteWords];

function usage(msg) {
  if (msg) process.stderr.write(`check-unmerged-ship: ${msg}\n`);
  process.stderr.write('usage: check-unmerged-ship.js [--repo dir] [--target ref] [--max-age minutes] [--window-days n] [--review-ledger dir]... [--runs-dir dir] [--merge-owner address] [--notify] [--json] [--now iso]\n');
  process.exit(2);
}

function parseArgs(argv) {
  const o = { repo: process.cwd(), target: 'origin/develop', maxAge: null, windowDays: DEFAULT_WINDOW_DAYS, ledgers: [], runsDir: null, owner: null, notify: false, json: false, now: null };
  const val = (i) => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) usage(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--repo') { o.repo = path.resolve(val(i)); i += 1; }
    else if (a === '--target') { o.target = val(i); i += 1; }
    else if (a === '--max-age') { o.maxAge = Number(val(i)); i += 1; if (!(o.maxAge >= 0)) usage('--max-age must be a number of minutes'); }
    else if (a === '--window-days') { o.windowDays = Number(val(i)); i += 1; if (!(o.windowDays > 0)) usage('--window-days must be positive'); }
    else if (a === '--review-ledger') { o.ledgers.push(path.resolve(val(i))); i += 1; }
    else if (a === '--runs-dir') { o.runsDir = path.resolve(val(i)); i += 1; }
    else if (a === '--merge-owner') { o.owner = val(i); i += 1; }
    else if (a === '--now') { o.now = Date.parse(val(i)); i += 1; if (!Number.isFinite(o.now)) usage('--now must be an ISO instant'); }
    else if (a === '--notify') o.notify = true;
    else if (a === '--json') o.json = true;
    else usage(`unknown argument ${a}`);
  }
  return o;
}

function configMaxAge(env) {
  try {
    const { configPath } = require('./lib/config-path.js');
    const cfg = JSON.parse(fs.readFileSync(configPath({ env }), 'utf8'));
    const v = cfg && cfg.unmerged_ship && cfg.unmerged_ship.max_age_minutes;
    return typeof v === 'number' && v >= 0 ? v : null;
  } catch (_e) { return null; }
}

function git(repo, args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 * 1024, input: opts.input });
  return { ok: !r.error && r.status === 0, status: r.status, out: r.stdout || '' };
}

// ---- verdict sources ---------------------------------------------------------------------------------------------------

function fromReviewLedgers(project, o, nowMs, sinceMs) {
  const { read } = require('../src/status/events/sources/review.js');
  const ctx = { project, env: process.env, home: os.homedir(), now: nowMs, reviewLedgers: o.ledgers };
  const res = read(ctx, { sinceTs: sinceMs - 24 * 3600 * 1000, slackMs: 0, hints: {} });
  const collected = new Map();
  for (const e of res.events) if (e.kind === 'review.collected') collected.set(e.id.slice('review.collected:'.length), e);
  const out = [];
  for (const e of res.events) {
    if (e.kind !== 'review.finalized' || !e.data || e.data.verdict !== 'SHIP-AS-IS') continue;
    const at = Date.parse(e.ts);
    if (!(at >= sinceMs)) continue;
    const c = collected.get(e.id.slice('review.finalized:'.length));
    if (!c || !c.data || typeof c.data.head !== 'string') continue;
    out.push({ head: c.data.head, at, fleet_task: e.data.fleet_task || c.data.fleet_task || null, source: 'review' });
  }
  return out;
}

function fromManifests(project, o, sinceMs, env) {
  let dir = o.runsDir;
  if (!dir) { try { dir = require('./lib/runtime-paths.js').runsDir(env); } catch (_e) { return []; } }
  let names;
  try { names = fs.readdirSync(dir); } catch (_e) { return []; }
  const rootReal = project.root ? realOrSelf(project.root) : null;
  const out = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.manifest.json') || name.startsWith('panel-')) continue;
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_e) { continue; }
    if (!m || m.role !== 'reviewer' || m.verdict !== 'SHIP-AS-IS' || typeof m.head !== 'string') continue;
    const sameRepo = (m.repo_identity && m.repo_identity === project.repo_identity)
      || (rootReal && typeof m.repo_root === 'string' && realOrSelf(m.repo_root) === rootReal);
    if (!sameRepo) continue;
    const at = Number.isFinite(m.ended_epoch) ? m.ended_epoch * 1000 : Date.parse(m.ended_at);
    if (!(at >= sinceMs)) continue;
    out.push({ head: m.head, at, fleet_task: typeof m.fleet_task === 'string' && ULID_RE.test(m.fleet_task) ? m.fleet_task : null, source: 'dispatch' });
  }
  return out;
}

function realOrSelf(p) { try { return fs.realpathSync(p); } catch (_e) { return path.resolve(p); } }

// ---- merged? -----------------------------------------------------------------------------------------------------------

// -> 'merged' | 'unmerged' | 'unknown'
function mergeState(repo, head, target) {
  if (!git(repo, ['cat-file', '-e', `${head}^{commit}`]).ok) return 'unknown';
  if (!git(repo, ['rev-parse', '--verify', '--quiet', `${target}^{commit}`]).ok) return 'unknown';
  if (git(repo, ['merge-base', '--is-ancestor', head, target]).ok) return 'merged';
  const cherry = git(repo, ['cherry', target, head]);
  if (cherry.ok) {
    const lines = cherry.out.split('\n').filter(Boolean);
    if (lines.length > 0 && lines.every((l) => l.startsWith('-'))) return 'merged';
  }
  const mb = git(repo, ['merge-base', head, target]);
  if (!mb.ok) return 'unmerged';
  const base = mb.out.trim();
  const net = git(repo, ['diff', base, head]);
  if (!net.ok) return 'unknown';
  if (net.out === '') return 'merged'; // nothing left to land
  const pid = git(repo, ['patch-id', '--stable'], { input: net.out });
  const want = pid.ok ? pid.out.split(' ')[0] : '';
  if (!want) return 'unmerged';
  const log = git(repo, ['log', '-p', '--no-merges', '-n', '500', '--format=commit %H', `${base}..${target}`]);
  if (!log.ok) return 'unmerged';
  const ids = git(repo, ['patch-id', '--stable'], { input: log.out });
  if (ids.ok && ids.out.split('\n').some((l) => l.split(' ')[0] === want)) return 'merged';
  return 'unmerged';
}

// ---- notify ------------------------------------------------------------------------------------------------------------

// The only fleet call. blockedOn is a structured value (fleet address); the reason travels in the note words only.
function markBlocked({ task, blockedOn, note }) {
  const argv = FLEET_BLOCKED_ARGV(task, blockedOn, note.split(/\s+/).filter(Boolean));
  const r = spawnSync('fleet', argv, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : String(r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`;
    process.stderr.write(`check-unmerged-ship: fleet task progress failed for ${task}: ${why}\n`);
    return false;
  }
  return true;
}

function notifiedFile(repo, head) {
  const { resolveLiveDir } = require('./lib/live-state-dir.js');
  const dir = path.join(resolveLiveDir({ warn: () => {} }).base, 'unmerged-ship');
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.createHash('sha256').update(`${repo}\0${head}`).digest('hex').slice(0, 24);
  return path.join(dir, `notified-${key}`);
}

// true when this call is the first to notify for (repo, head)
function claimNotice(repo, head) {
  try {
    fs.writeFileSync(notifiedFile(repo, head), `${new Date().toISOString()}\n`, { flag: 'wx' });
    return true;
  } catch (e) {
    return !(e && e.code === 'EEXIST');
  }
}

// ---- main --------------------------------------------------------------------------------------------------------------

function main() {
  const o = parseArgs(process.argv.slice(2));
  const nowMs = o.now !== null ? o.now : Date.now();
  const maxAge = o.maxAge !== null ? o.maxAge : (configMaxAge(process.env) ?? DEFAULT_MAX_AGE_MIN);
  const { resolveProject } = require('../src/status/events/index.js');
  const project = resolveProject({ cwd: o.repo, env: process.env });
  if (!project || !project.root) usage(`${o.repo} is not inside a git work tree`);
  const repo = project.root;
  const sinceMs = nowMs - o.windowDays * 24 * 3600 * 1000;

  const found = [...fromReviewLedgers(project, o, nowMs, sinceMs), ...fromManifests(project, o, sinceMs, process.env)];
  // one item per head: the earliest SHIP-AS-IS verdict counts (the wait began there)
  const byHead = new Map();
  for (const f of found.sort((a, b) => a.at - b.at)) {
    const prev = byHead.get(f.head);
    if (!prev) byHead.set(f.head, { ...f });
    else if (!prev.fleet_task && f.fleet_task) prev.fleet_task = f.fleet_task;
  }
  const items = [];
  for (const f of byHead.values()) {
    items.push({
      repo, head: f.head, verdict_at: new Date(f.at).toISOString(), age_min: Math.max(0, Math.floor((nowMs - f.at) / 60000)),
      fleet_task: f.fleet_task, source: f.source, state: mergeState(repo, f.head, o.target),
    });
  }
  items.sort((a, b) => a.verdict_at.localeCompare(b.verdict_at));
  const alerts = items.filter((i) => i.state === 'unmerged' && i.age_min > maxAge);
  const line = (i) => `unmerged-ship: ${i.head.slice(0, 12)} reviewed SHIP-AS-IS ${i.age_min}m ago, not in ${o.target} (${path.basename(repo)}${i.fleet_task ? `, task ${i.fleet_task}` : ''}) - merge it now, do not hold it for a batch`;

  if (o.notify) {
    const owner = o.owner || process.env.AUTOPILOT_FLEET_ADDRESS || '';
    for (const i of alerts) {
      if (!claimNotice(repo, i.head)) continue;
      (o.json ? process.stderr : process.stdout).write(`${line(i)}\n`);
      if (!i.fleet_task) continue;
      if (!owner) {
        process.stderr.write('check-unmerged-ship: no --merge-owner / AUTOPILOT_FLEET_ADDRESS, task not marked blocked\n');
        continue;
      }
      markBlocked({ task: i.fleet_task, blockedOn: owner, note: `unmerged ${i.head.slice(0, 12)} SHIP-AS-IS ${i.age_min}m ago, not in ${o.target}` });
    }
  } else if (!o.json) {
    for (const i of alerts) process.stdout.write(`${line(i)}\n`);
  }
  if (o.json) process.stdout.write(`${JSON.stringify({ schema: SCHEMA, target: o.target, max_age_min: maxAge, items })}\n`);
  process.exit(alerts.length > 0 ? 1 : 0);
}

main();
