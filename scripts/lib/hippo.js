#!/usr/bin/env node
'use strict';
// scripts/lib/hippo.js - autopilot's door to the hippo record store (plan 2026-11-02-oc-a3-writers-use-hippo, A3.1, §3.3).
//
// Library API (CommonJS, Node >= 20.10, built-ins only):
//   detect(target?)                    -> {state, reason, problems[], repo_root, store_id, hippo_version, bin}
//                                         state: files | hippo | hippo-problems | spool. Throws HippoError (exit 2) when the
//                                         target is not in a git work tree or its root is this plugin's own install directory.
//   run(repo, argv, {input}?)          -> parsed `hippo/1` document plus `exit`. Always `--json -C <repo>`, argv array, no shell.
//                                         Non-JSON stdout -> exit 1 / error.code "internal"; binary missing -> exit 5 / "environment".
//   spoolWrite(repo, {subcommand, plan, key?}) / spoolList(repo) / flush(repo, {drop?})
//                                      Write spool at <git common dir>/autopilot/hippo-spool/<key>.json (never in the worktree).
//   execute(repo, plan, {log?})        -> {ok, exit, ids, created[], skipped[], warnings[], failed_step?, spool?, reason?}
//                                         Idempotent step runner; plan format in the comment above execute().
//   spoolWarning(reason, n)            -> the one-line "record store degraded" warning text.
//
// CLI: node scripts/lib/hippo.js detect [--target <dir>] [--json]
//      node scripts/lib/hippo.js flush [--target <dir>] [--drop <key>]
// Exit codes: 0 ok (detect: any state; flush: nothing left to do for this worktree/branch);
//             2 usage, not a git repo, plugin directory refused, or flush in state `files` with a non-empty spool;
//             3 flush: a spooled write was refused by a hippo rule (entry kept, refusal recorded) - hippo's own code is used
//               (2/3/4) when the first refusal carried it;
//             5 flush: record store degraded (binary missing, no actor, lock timeout, unsupported format) - nothing replayed.
// Fault injection (tests only): PROJECT_RECORD_FAULT=after-create|after-first-link|after-first-child|before-spool-remove makes the
// process exit 70 at that point. Counts actual writes only, so a rerun that skips existing steps does not re-trigger early points.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

class HippoError extends Error {
  constructor(message, exit = 2, code = 'usage') {
    super(message);
    this.name = 'HippoError';
    this.exit = exit;
    this.code = code;
  }
}

function bin() { return process.env.HIPPO_BIN || 'hippo'; }

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function repoRoot(target) {
  const dir = path.resolve(target || process.cwd());
  let top;
  try { top = git(dir, ['rev-parse', '--show-toplevel']); } catch { throw new HippoError(`not inside a git work tree: ${dir}`, 2, 'not-a-repo'); }
  return fs.realpathSync(top);
}

function currentBranch(root) {
  try { return git(root, ['symbolic-ref', '-q', '--short', 'HEAD']); } catch { return '(detached)'; }
}

function parseDoc(stdout) {
  try {
    const d = JSON.parse(stdout);
    return d && typeof d === 'object' && d.schema === 'hippo/1' ? d : null;
  } catch { return null; }
}

function run(repo, argv, opts = {}) {
  const r = spawnSync(bin(), ['--json', '-C', repo, ...argv], {
    encoding: 'utf8', input: opts.input === undefined || opts.input === null ? undefined : opts.input, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error && (r.error.code === 'ENOENT' || r.error.code === 'EACCES')) {
    return { schema: 'hippo/1', ok: false, data: null, warnings: [], missing_binary: true, exit: 5,
      error: { code: 'environment', rule: null, message: `hippo binary not found or not executable: ${bin()}`, file: null, hint: null } };
  }
  const doc = r.status === null ? null : parseDoc(r.stdout);
  if (!doc) {
    return { schema: 'hippo/1', ok: false, data: null, warnings: [], exit: 1, raw: r.stdout || '',
      error: { code: 'internal', rule: null, message: `hippo printed no hippo/1 document (status ${r.status}, signal ${r.signal})${r.stderr ? ': ' + r.stderr.trim() : ''}`, file: null, hint: null } };
  }
  doc.exit = r.status;
  return doc;
}

function detect(target) {
  const root = repoRoot(target);
  if (root === fs.realpathSync(PLUGIN_ROOT)) throw new HippoError(`refusing to use the plugin's own install directory as a record store: ${root}`, 2, 'plugin-dir');
  const out = { state: 'files', reason: `no .hippo store in ${root}`, problems: [], repo_root: root, store_id: null, hippo_version: null, bin: bin() };
  const toml = path.join(root, '.hippo', 'repo.toml');
  if (!fs.existsSync(toml)) return out;
  const m = /^id\s*=\s*"([^"]*)"/m.exec(fs.readFileSync(toml, 'utf8'));
  out.store_id = m ? m[1] : null;
  const ver = spawnSync(bin(), ['--version'], { encoding: 'utf8' });
  if (ver.error) { out.state = 'spool'; out.reason = `hippo binary missing or not executable: ${bin()}`; return out; }
  const vm = /(\d+\.\d+\.\d+\S*)/.exec(ver.stdout || '');
  out.hippo_version = vm ? vm[1] : null;
  const chk = run(root, ['check']);
  if (chk.exit === 0) { out.state = 'hippo'; out.reason = 'hippo check passed'; return out; }
  if (chk.exit === 3) {
    const human = spawnSync(bin(), ['-C', root, 'check'], { encoding: 'utf8' });
    out.state = 'hippo-problems';
    out.problems = (human.stdout || '').split('\n').filter((l) => l.startsWith('problem:'));
    out.reason = `hippo check found ${out.problems.length} problem(s)`;
    return out;
  }
  out.state = 'spool';
  out.reason = chk.exit === 5 ? chk.error.message : `hippo check exit ${chk.exit}: ${chk.error && chk.error.message}`;
  return out;
}

// ---- spool -----------------------------------------------------------------------------------------------------------

function spoolDir(root) {
  return path.join(path.resolve(root, git(root, ['rev-parse', '--git-common-dir'])), 'autopilot', 'hippo-spool');
}

function spoolWarning(reason, n) {
  return `WARNING record store degraded: ${reason}; ${n} write(s) spooled; run project-record.js flush once hippo works`;
}

function spoolWrite(repo, { subcommand, plan, key }) {
  const root = repoRoot(repo);
  const k = key || plan.key;
  if (!/^[0-9a-f]{16}$/.test(k)) throw new HippoError(`bad spool key: ${k}`);
  const dir = spoolDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const entry = { v: 1, key: k, created: new Date().toISOString(), worktree: root, branch: currentBranch(root), target: root, subcommand, plan };
  const file = path.join(dir, `${k}.json`);
  fs.writeFileSync(file + '.tmp', JSON.stringify(entry, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  return { file, entry };
}

function spoolNames(repo) {
  const dir = spoolDir(repoRoot(repo));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^[0-9a-f]{16}\.json$/.test(f)).sort();
}

// Reads every entry; an entry that vanished between the listing and the read is skipped.
function spoolList(repo) {
  const dir = spoolDir(repoRoot(repo));
  const out = [];
  for (const f of spoolNames(repo)) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return out;
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Publish a lock file atomically with its content: write the pid to a unique temp file, then link() it into place
// (EEXIST when held). Returns true when taken.
function tryPublish(lock) {
  const tmp = `${lock}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, String(process.pid), { flag: 'wx' });
  try {
    fs.linkSync(tmp, lock);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  } finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
}

// Owner pid of a lock file: a positive integer, or null when the file is gone, or NaN when its content is not a pid
// (such a lock is held, never dead).
function lockOwner(lock) {
  let txt;
  try { txt = fs.readFileSync(lock, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return /^[1-9][0-9]*\s*$/.test(txt) ? parseInt(txt, 10) : NaN;
}

function releaseIfOwned(lock) {
  if (lockOwner(lock) === process.pid) { try { fs.unlinkSync(lock); } catch { /* gone */ } }
}

// Remove a dead-owner lock without letting two reclaimers delete each other's fresh lock: reclaims are serialized by
// `<lock>.reclaim`, itself taken atomically. An existing `.reclaim` (any owner, dead or alive) is never taken over:
// two processes cannot tell a dead file from a fresh one safely, so the caller waits and the timeout names the file.
// Returns true when the dead lock was handled by us, false when `.reclaim` is held.
function reclaimStale(lock, deadPid) {
  const rl = `${lock}.reclaim`;
  if (!tryPublish(rl)) return false;
  try {
    if (lockOwner(lock) === deadPid) { try { fs.unlinkSync(lock); } catch { /* gone */ } }
  } finally { releaseIfOwned(rl); }
  return true;
}

// Atomically-published lockfile holding our pid. Dead-pid holder -> serialized reclaim and retake. Live or unreadable holder -> wait, then HippoError exit 5.
function withLock(dir, fn, timeoutMs = 30000) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.lock');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (tryPublish(lock)) break;
    const pid = lockOwner(lock);
    if (pid === null) continue;
    let reclaimBlocked = false;
    if (!Number.isNaN(pid) && !pidAlive(pid)) {
      if (reclaimStale(lock, pid)) continue;
      reclaimBlocked = true;
    }
    if (Date.now() > deadline) {
      if (reclaimBlocked) throw new HippoError(`spool lock ${lock} is held by dead pid ${pid} and ${lock}.reclaim exists; remove ${lock}.reclaim only if no flush is running`, 5, 'environment');
      throw new HippoError(`spool lock held by ${Number.isNaN(pid) ? 'an unreadable owner' : 'pid ' + pid}`, 5, 'environment');
    }
    sleepMs(50);
  }
  try { return fn(); } finally { releaseIfOwned(lock); }
}

function fault(point) {
  if (process.env.PROJECT_RECORD_FAULT === point) {
    process.stderr.write(`PROJECT_RECORD_FAULT: exiting 70 at ${point}\n`);
    process.exit(70);
  }
}

function flush(repo, opts = {}) {
  const log = opts.log || ((s) => process.stderr.write(s + '\n'));
  const det = detect(repo);
  const root = det.repo_root;
  const dir = spoolDir(root);
  const res = { exit: 0, state: det.state, replayed: [], kept: [], other: [], dropped: [] };
  if (opts.drop) {
    if (!/^[0-9a-f]{16}$/.test(opts.drop)) throw new HippoError(`bad spool key: ${opts.drop}`);
    const f = path.join(dir, `${opts.drop}.json`);
    if (!fs.existsSync(f)) throw new HippoError(`no spool entry ${opts.drop}`);
    withLock(dir, () => fs.unlinkSync(f));
    res.dropped.push(opts.drop);
    return res;
  }
  const pending = spoolNames(root);
  if (det.state === 'files') {
    if (pending.length) { res.exit = 2; log(`${pending.length} spooled write(s) target a hippo store that no longer exists; see the rollback note`); }
    return res;
  }
  if (!pending.length) return res;
  if (det.state === 'spool') { res.exit = 5; log(spoolWarning(det.reason, pending.length)); return res; }
  const branch = currentBranch(root);
  try {
    withLock(dir, () => {
      for (const e of spoolList(root)) {
        if (e.worktree !== root || e.branch !== branch) { res.other.push(e.key); continue; }
        const r = execute(e.target, e.plan, { log });
        if (r.ok) {
          fault('before-spool-remove');
          fs.unlinkSync(path.join(dir, `${e.key}.json`));
          res.replayed.push(e.key);
          continue;
        }
        res.kept.push(e.key);
        if (r.spool) { res.exit = 5; log(spoolWarning(r.reason, res.kept.length)); break; }
        e.refusal = { exit: r.exit, code: r.error.code, rule: r.error.rule || null, message: r.error.message, step: r.failed_step.index };
        fs.writeFileSync(path.join(dir, `${e.key}.json`), JSON.stringify(e, null, 2) + '\n');
        if (res.exit === 0) res.exit = r.exit;
      }
    }, opts.lockTimeoutMs);
  } catch (err) {
    if (!(err instanceof HippoError) || err.exit !== 5) throw err;
    res.exit = 5; log(`WARNING record store degraded: ${err.message}`);
  }
  if (res.other.length) log(`${res.other.length} spooled write(s) belong to another worktree or branch, not replayed: ${res.other.join(' ')}`);
  return res;
}

// ---- step runner -----------------------------------------------------------------------------------------------------
//
// plan = { key: '<16 lowercase hex>', steps: [
//   {op:'create', ref, kind, argv:[...flags after `new <kind>`, no key tag, no --body-file], body:'<text>'|null, key:'<k>'|'<k>.<n>'},
//   {op:'link', from:'<ref>'|'<ULID>', rel, to:'<ref>'|'<ULID>'|'<target string>', leak_ok:true|false},
//   {op:'close', id:'<ref>'|'<ULID>', status:'done'|'cancelled'|'superseded'},
//   {op:'edit', id:'<ref>'|'<ULID>', body:'<text>'} ] }

const nl = (s) => String(s).replace(/\n*$/, '\n');

function execute(repo, plan, opts = {}) {
  const log = opts.log || ((s) => process.stderr.write(s + '\n'));
  const out = { ok: false, exit: 0, ids: {}, created: [], skipped: [], warnings: [] };
  let creates = 0;
  let links = 0;
  const ref = (x) => (Object.prototype.hasOwnProperty.call(out.ids, x) ? out.ids[x] : x);

  const fail = (index, step, r) => {
    out.exit = r.exit;
    out.error = r.error;
    if (r.exit === 5) { out.spool = true; out.reason = r.error.message; }
    out.failed_step = { index, step, exit: r.exit, error: r.error };
    log(`step ${index} (${step.op}) failed: exit ${r.exit} ${r.error.code}${r.error.rule ? '/' + r.error.rule : ''}: ${r.error.message}${r.error.hint ? ' (hint: ' + r.error.hint + ')' : ''}`);
    log(`created so far: ${JSON.stringify(out.ids)}`);
    return out;
  };

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (step.op === 'create') {
      const found = run(repo, ['list', '--tag', `key:${step.key}`, '--history']);
      if (found.exit !== 0) return fail(i, step, found);
      const recs = found.data.records.slice().sort((a, b) => String(a.created).localeCompare(String(b.created)));
      if (recs.length) {
        out.ids[step.ref] = recs[0].id;
        out.skipped.push({ index: i, op: 'create', ref: step.ref, id: recs[0].id, reason: 'key exists' });
        continue;
      }
      const argv = ['new', step.kind, ...step.argv, '--tag', `key:${step.key}`];
      const hasBody = step.body !== null && step.body !== undefined;
      if (hasBody) argv.push('--body-file', '-');
      const r = run(repo, argv, { input: hasBody ? step.body : undefined });
      if (r.exit !== 0) return fail(i, step, r);
      const id = r.data.ids[0];
      if (!ULID_RE.test(id)) return fail(i, step, { exit: 1, error: { code: 'internal', rule: null, message: `new returned a non-ULID id: ${id}` } });
      out.ids[step.ref] = id;
      out.created.push({ index: i, op: 'create', ref: step.ref, id });
      creates++;
      if (creates === 1) fault('after-create');
      if (creates === 2) fault('after-first-child');
    } else if (step.op === 'link') {
      const from = ref(step.from);
      const to = ref(step.to);
      const rel = run(repo, ['related', from, '--rel', step.rel, '--depth', '1']);
      if (rel.exit !== 0) return fail(i, step, rel);
      const has = rel.data.edges.some((e) => e.rel === step.rel && e.state === 'present'
        && ((e.source === from && e.target === to) || (e.source === to && e.target === from)));
      if (has) { out.skipped.push({ index: i, op: 'link', from, rel: step.rel, to, reason: 'edge exists' }); continue; }
      const r = run(repo, ['link', from, step.rel, to]);
      if (r.exit === 3 && r.error.rule === 'leak' && step.leak_ok) {
        const w = `step ${i}: ${step.rel} link refused by the leak guard; counted as done without the link`;
        out.warnings.push(w); log(`WARNING ${w}`);
        continue;
      }
      if (r.exit !== 0) return fail(i, step, r);
      out.created.push({ index: i, op: 'link', from, rel: step.rel, to });
      links++;
      if (links === 1) fault('after-first-link');
    } else if (step.op === 'close') {
      const id = ref(step.id);
      const s = run(repo, ['show', id]);
      if (s.exit !== 0) return fail(i, step, s);
      if (s.data.record.status === step.status) { out.skipped.push({ index: i, op: 'close', id, reason: `already ${step.status}` }); continue; }
      const r = run(repo, ['close', id, step.status]);
      if (r.exit !== 0) return fail(i, step, r);
      out.created.push({ index: i, op: 'close', id, status: step.status });
    } else if (step.op === 'edit') {
      const id = ref(step.id);
      const s = run(repo, ['show', id]);
      if (s.exit !== 0) return fail(i, step, s);
      if (nl(s.data.record.body || '') === nl(step.body)) { out.skipped.push({ index: i, op: 'edit', id, reason: 'body equal' }); continue; }
      const r = run(repo, ['edit', id, '--body-file', '-'], { input: nl(step.body) });
      if (r.exit !== 0) return fail(i, step, r);
      out.created.push({ index: i, op: 'edit', id });
    } else {
      throw new HippoError(`unknown step op: ${step.op}`);
    }
  }
  out.ok = true;
  return out;
}

// ---- CLI -------------------------------------------------------------------------------------------------------------

function cli(argv) {
  const [cmd, ...rest] = argv;
  const opt = { json: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') opt.json = true;
    else if (a === '--target' || a === '--drop' || a === '--lock-timeout-ms') {
      if (rest[i + 1] === undefined) throw new HippoError(`${a} needs a value`);
      opt[a.slice(2)] = rest[++i];
      if (a === '--lock-timeout-ms') opt.lockTimeoutMs = Number(opt['lock-timeout-ms']);
    } else throw new HippoError(`unknown argument: ${a}`);
  }
  if (cmd === 'detect') {
    const d = detect(opt.target);
    if (opt.json) process.stdout.write(JSON.stringify(d) + '\n');
    else {
      process.stdout.write(`record store: ${d.state} (${d.reason})\n`);
      for (const p of d.problems) process.stdout.write(p + '\n');
    }
    return 0;
  }
  if (cmd === 'flush') {
    const r = flush(opt.target, { drop: opt.drop, lockTimeoutMs: opt.lockTimeoutMs });
    return r.exit;
  }
  throw new HippoError('usage: hippo.js detect [--target <dir>] [--json] | flush [--target <dir>] [--drop <key>]');
}

module.exports = { withLock, HippoError, detect, run, spoolDir, spoolWarning, spoolWrite, spoolList, flush, execute };

if (require.main === module) {
  try {
    process.exitCode = cli(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof HippoError)) throw e;
    process.stderr.write(`hippo.js: ${e.message}\n`);
    process.exitCode = e.exit;
  }
}
