#!/usr/bin/env node
'use strict';
// scripts/register-external-run.js — make a long job that does NOT go through a dispatch rail visible to the
// autopilot panel. The panel's only evidence that "a run is going" is <runs dir>/<run_id>.manifest.json; this
// script writes (and later closes) such a manifest. It touches no other state file. Node built-ins only.
//
//   start --role R --label TEXT [--model M] [--log PATH] (--pid N | --lock PATH)
//         [--session SID] [--root-run-id ID] [--cwd DIR] [--json]
//       writes the manifest, prints the run_id (--json: {run_id, manifest}). rc 2 if neither --pid nor --lock
//       (a run with no liveness basis is "unknown" forever and never counts as live).
//   end   --run-id ID [--rc N] [--status S]
//       back-fills ended_at / ended_epoch / final_status / rc (default status: completed when rc=0, else failed).
//   wrap  [start options except --pid/--lock] -- <argv...>
//       spawns argv, records the child's pid, ends the manifest when it exits and exits with the child's rc.
//       SIGTERM / SIGINT are forwarded to the child; the run is then ended with status "killed".
//
// The manifest dir is runtime-paths ensureRunsDir() ($AUTOPILOT_DISPATCH_RUNS_DIR, else $TMPDIR/autopilot-dispatch-runs).
// root_run_id / session_id default from the session marker of --session or $CLAUDE_CODE_SESSION_ID; with none found
// root_run_id stays null (the run lands in the project's overall file) and stderr says so.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SELF_DIR = __dirname;

function fail(msg, rc = 2) {
  process.stderr.write(`register-external-run: ${msg}\n`);
  process.exit(rc);
}

function parseOpts(argv, valued, flags) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (flags.includes(a)) { o[a.slice(2)] = true; continue; }
    if (!valued.includes(a)) fail(`unknown option ${a}`);
    if (i + 1 >= argv.length) fail(`${a} needs a value`);
    o[a.slice(2)] = argv[i + 1];
    i += 1;
  }
  return o;
}

function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

function runsDirOrFail() {
  const r = require('./lib/runtime-paths').ensureRunsDir(process.env);
  if (!r.ok) fail(`runs dir unusable: ${r.reason}`, 1);
  return r.path;
}

function repoIdentityOf(dir) {
  try { return require('../src/status/task-runtime').repoIdentity(dir) || null; } catch (_e) { return null; }
}

function resolveSession(opts, cwd, identity) {
  const sm = require('./session-mode');
  const sid = opts.session || process.env.CLAUDE_CODE_SESSION_ID || '';
  let root = opts['root-run-id'] || null;
  let sessionId = sid ? sm.normalizeSessionId(sid) : null;
  let note = null;
  if (sid) {
    const rec = sm.readSessionRecord(sid);
    if (!rec) note = `no live session marker for session ${sessionId}`;
    else if (typeof rec.repo_identity === 'string' && identity && rec.repo_identity !== identity) note = `session ${sessionId} belongs to another project (${rec.repo_identity})`;
    else if (!root && typeof rec.root_run_id === 'string' && rec.root_run_id) root = rec.root_run_id;
    else if (!root) note = `session marker of ${sessionId} carries no root_run_id`;
  } else if (!root) note = 'no --session and no CLAUDE_CODE_SESSION_ID';
  if (!root) process.stderr.write(`register-external-run: root_run_id left empty (${note}); the run lands in the project overall file\n`);
  return { root, sessionId };
}

function writeManifestFile(file, m) {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function buildManifest(opts, pid) {
  if (!opts.role) fail('--role is required');
  if (!opts.label) fail('--label is required');
  if (pid === undefined && !opts.lock) fail('start needs --pid or --lock: a run with no liveness basis is never counted live');
  if (pid !== undefined && (!Number.isInteger(pid) || pid <= 0)) fail('--pid must be a positive integer');
  const cwd = path.resolve(opts.cwd || process.cwd());
  const identity = repoIdentityOf(cwd);
  const { root, sessionId } = resolveSession(opts, cwd, identity);
  const now = Date.now();
  const runId = `external-${Math.floor(now / 1000)}-${process.pid}-${crypto.randomBytes(2).toString('hex')}`;
  return {
    schema: 1,
    run_id: runId,
    role: opts.role,
    runner: 'external',
    model: opts.model || null,
    label: opts.label,
    lock_path: opts.lock ? path.resolve(opts.lock) : null,
    log_path: opts.log ? path.resolve(opts.log) : null,
    log_format: 'plain',
    pid: pid === undefined ? null : pid,
    started_at: iso(now),
    started_epoch: Math.floor(now / 1000),
    ended_at: null,
    ended_epoch: null,
    final_status: null,
    parent_run_id: null,
    root_run_id: root,
    depth: 0,
    repo_identity: identity,
    repo_identity_source: identity ? 'consuming_repo_root' : null,
    session_id: sessionId,
  };
}

function commitStart(manifest) {
  const dir = runsDirOrFail();
  const file = path.join(dir, `${manifest.run_id}.manifest.json`);
  writeManifestFile(file, manifest);
  return file;
}

function endManifest(runId, rc, status) {
  if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) fail('--run-id is required (letters, digits, . _ -)');
  const file = path.join(runsDirOrFail(), `${runId}.manifest.json`);
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { fail(`no manifest for run ${runId} in ${path.dirname(file)}`); }
  const now = Date.now();
  m.ended_at = iso(now);
  m.ended_epoch = Math.floor(now / 1000);
  m.rc = rc;
  m.final_status = status || (rc === 0 ? 'completed' : 'failed');
  writeManifestFile(file, m);
  return file;
}

function parseRc(v) {
  if (v === undefined) return 0;
  if (!/^-?\d+$/.test(String(v))) fail('--rc must be an integer');
  return Number(v);
}

const START_VALUED = ['--role', '--label', '--model', '--log', '--pid', '--lock', '--session', '--root-run-id', '--cwd'];

function cmdStart(argv) {
  const o = parseOpts(argv, START_VALUED, ['--json']);
  const manifest = buildManifest(o, o.pid === undefined ? undefined : Number(o.pid));
  const file = commitStart(manifest);
  process.stdout.write(o.json ? `${JSON.stringify({ run_id: manifest.run_id, manifest: file })}\n` : `${manifest.run_id}\n`);
  return 0;
}

function cmdEnd(argv) {
  const o = parseOpts(argv, ['--run-id', '--rc', '--status'], []);
  endManifest(o['run-id'], parseRc(o.rc), o.status);
  return 0;
}

function cmdWrap(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0 || sep === argv.length - 1) fail('wrap needs `-- <argv...>`');
  const o = parseOpts(argv.slice(0, sep), START_VALUED.filter((v) => v !== '--pid' && v !== '--lock'), ['--json']);
  const cmd = argv.slice(sep + 1);
  if (!o.role || !o.label) fail('--role and --label are required');
  let signalled = false;
  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  child.on('error', (e) => {
    process.stderr.write(`register-external-run: cannot start ${cmd[0]}: ${e.message}\n`);
    process.exit(127);
  });
  child.on('spawn', () => {
    const manifest = buildManifest(o, child.pid);
    commitStart(manifest);
    if (o.json) process.stderr.write(`${JSON.stringify({ run_id: manifest.run_id })}\n`);
    for (const sig of ['SIGTERM', 'SIGINT']) {
      process.on(sig, () => { signalled = true; try { child.kill(sig); } catch (_e) { /* already gone */ } });
    }
    child.on('exit', (code, sigName) => {
      const rc = code !== null ? code : 128 + (require('os').constants.signals[sigName] || 0);
      const killed = signalled || code === null;
      endManifest(manifest.run_id, rc, killed ? 'killed' : undefined);
      process.exit(rc);
    });
  });
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  switch (sub) {
    case 'start': return cmdStart(rest);
    case 'end': return cmdEnd(rest);
    case 'wrap': return cmdWrap(rest);
    default:
      process.stderr.write('usage: register-external-run.js start|end|wrap ... (see the header of this script)\n');
      return 2;
  }
}

if (require.main === module) {
  const rc = main();
  if (rc !== undefined) process.exit(rc);
}
module.exports = { main };
