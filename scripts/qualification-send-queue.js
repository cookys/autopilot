#!/usr/bin/env node
'use strict';
//
// qualification-send-queue.js — BL-0194 P3: autopilot sends exam records and strikes to the registry (llm-playground).
//
//   node scripts/qualification-send-queue.js enqueue --kind record|strike --file <payload.json>
//   node scripts/qualification-send-queue.js flush   [--force]
//   node scripts/qualification-send-queue.js status  [--json]
//
// Outbox: ~/.autopilot/qualification-outbox/outbox.jsonl (AUTOPILOT_OUTBOX_DIR overrides). Append-only event log,
// one line per event {event: enqueued|sent|acked|rejected|failed|retired, id, kind, payload_sha256, ts, line_crc};
// every append is ONE write of one line under 4096 B (a bigger payload goes to outbox.d/<id>.json, renamed in, and
// the line carries its sha256). Lock: the repo's PID lock with stale-holder breaker (scripts/lib/jsonl-store.js);
// Node has no flock, and this lock gives the same single-writer guarantee with crash recovery.
// flush: quarantines a torn/crc-bad line to outbox.jsonl.corrupt (loud warning, other lines untouched), then for each
// un-acked id: asks the transport for an ack, else sends once, polls again. Ack = the registry's DEFAULT branch holds
// the record bytes (never a bot branch, never an open PR). Permanent rejection -> `rejected`, never resent.
// `retired` only after `acked`; compaction rewrites atomically without fully retired ids. Failure -> `failed` + backoff.
// Transport is off unless qualification_outbox.transport = git (config) — flush then sends nothing.
// Test seams: injectable transport, AUTOPILOT_OUTBOX_FAILPOINT=after-enqueue|after-send|before-ack|after-ack (SIGKILL).
// Plan: docs/plans/2026-10-16-bl0194-qualification-registry-move.md section 4.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const store = require('./lib/jsonl-store.js');
const q = require('./lib/qualification-metrics.js');
const { configPath } = require('./lib/config-path.js');

const MAX_LINE = 3900;
const STALE_S = 24 * 3600;
const BOT_PREFIX = 'bot/qualification-';
const FAILPOINTS = new Set(['after-enqueue', 'after-send', 'before-ack', 'after-ack']);

function outboxDir(env = process.env) {
  return env.AUTOPILOT_OUTBOX_DIR
    ? path.resolve(store.expandTilde(env.AUTOPILOT_OUTBOX_DIR))
    : path.join(os.homedir(), '.autopilot', 'qualification-outbox');
}
function paths(dir) {
  return {
    dir, log: path.join(dir, 'outbox.jsonl'), d: path.join(dir, 'outbox.d'),
    lock: path.join(dir, '.lock'), corrupt: path.join(dir, 'outbox.jsonl.corrupt'),
  };
}

function failpoint(name) {
  if (process.env.AUTOPILOT_OUTBOX_FAILPOINT === name && FAILPOINTS.has(name)) {
    process.stderr.write(`outbox failpoint ${name}: killing self\n`);
    process.kill(process.pid, 'SIGKILL');
  }
}

// ── line format ──
let crcTable;
function crc32(text) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (const b of Buffer.from(text, 'utf8')) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}
const sha256 = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

function makeLine(obj) {
  const body = { ...obj };
  delete body.line_crc;
  return `${JSON.stringify({ ...body, line_crc: crc32(q.canonicalJson(body)) })}\n`;
}
function parseLine(text) {
  let o;
  try { o = JSON.parse(text); } catch { return { bad: 'unparsable JSON (torn line)' }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { bad: 'not an object' };
  const { line_crc: crc, ...body } = o;
  if (crc !== crc32(q.canonicalJson(body))) return { bad: 'line_crc mismatch' };
  if (!['enqueued', 'sent', 'acked', 'rejected', 'failed', 'retired'].includes(o.event) || typeof o.id !== 'string') {
    return { bad: 'unknown event shape' };
  }
  return { ok: o };
}

function readLog(p) {
  let text = '';
  try { text = fs.readFileSync(p.log, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const events = [];
  const bad = [];
  const chunks = text.split('\n');
  const unterminated = text.length > 0 && !text.endsWith('\n');
  chunks.forEach((c, i) => {
    if (c === '') return;
    const r = parseLine(c);
    if (r.ok) events.push(r.ok); else bad.push({ line_no: i + 1, raw: c, reason: r.bad });
  });
  return { events, bad, unterminated };
}

function fold(events) {
  const m = new Map();
  for (const e of events) {
    let s = m.get(e.id);
    if (!s) { s = { id: e.id, kind: e.kind, failures: 0, last_failed_ts: null }; m.set(e.id, s); }
    if (e.event === 'enqueued') Object.assign(s, { enqueued: e, payload_sha256: e.payload_sha256 });
    else if (e.event === 'sent') s.sent = e;
    else if (e.event === 'acked') s.acked = e;
    else if (e.event === 'rejected') s.rejected = e;
    else if (e.event === 'retired') s.retired = e;
    else if (e.event === 'failed') { s.failures += 1; s.last_failed_ts = e.ts; s.last_error = e.message; }
  }
  return m;
}

function payloadOf(p, s) {
  if (!s.enqueued) return null;
  let text;
  if (typeof s.enqueued.payload === 'string') text = s.enqueued.payload;
  else {
    try { text = fs.readFileSync(path.join(p.d, `${s.id}.json`), 'utf8'); } catch { return null; }
  }
  return sha256(text) === s.payload_sha256 ? JSON.parse(text) : null;
}

function withLock(p, fn) {
  return store.withWriteLock({ storeDir: p.dir, lockFile: p.lock, name: 'qualification-outbox' }, fn);
}

function appendEvent(p, obj) {
  const line = makeLine({ ts: nowIso(), ...obj });
  if (Buffer.byteLength(line) >= 4096) throw new Error(`outbox line ${Buffer.byteLength(line)} B >= PIPE_BUF`);
  const fd = fs.openSync(p.log, 'a', 0o600);
  try {
    fs.writeSync(fd, line);   // exactly one write
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function trim(s) { return String(s === undefined ? '' : s).replace(/\s+/g, ' ').slice(0, 300); }

// ── enqueue ──
function idOf(kind, payload) {
  if (kind === 'record') return payload && payload.record_id;
  if (kind === 'strike') return q.strikeId(payload.seat, payload.effort, payload.reason, payload.administered_at, payload.record_id);
  return null;
}

/** Appends exactly one `enqueued` event (fsynced) for a COMPLETED administration. Idempotent on id. */
function enqueue(kind, payload, { env = process.env } = {}) {
  if (kind !== 'record' && kind !== 'strike') throw new Error(`kind must be record|strike, got ${kind}`);
  if (kind === 'record') {
    const { errors } = q.validateRecord(JSON.stringify(payload));
    if (errors.length) throw new Error(`record refused: ${errors[0][0]} ${errors[0][1]}`);
  } else if (!payload || !payload.seat || !payload.reason || !payload.record_id || !payload.administered_at) {
    throw new Error('strike submission needs seat, effort, reason, record_id, administered_at');
  }
  const id = idOf(kind, payload);
  if (!/^[0-9a-f]{64}$/.test(String(id))) throw new Error('payload has no valid id');
  const p = paths(outboxDir(env));
  store.ensureDir(p.dir);
  const text = q.canonicalJson(payload);
  const sha = sha256(text);
  return withLock(p, () => {
    const { events } = readLog(p);
    if (fold(events).has(id)) return { status: 'duplicate', id };
    const head = { event: 'enqueued', id, kind, payload_sha256: sha };
    if (Buffer.byteLength(makeLine({ ts: nowIso(), ...head, payload: text })) < MAX_LINE) head.payload = text;
    else {
      store.ensureDir(p.d);
      const tmp = path.join(p.d, `.${id}.tmp.${process.pid}`);
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, path.join(p.d, `${id}.json`));
      head.payload_ref = `outbox.d/${id}.json`;
    }
    try {   // a torn tail from a crash must not swallow this line
      const st = fs.statSync(p.log);
      if (st.size > 0) {
        const fd = fs.openSync(p.log, 'r');
        const b = Buffer.alloc(1);
        fs.readSync(fd, b, 0, 1, st.size - 1);
        fs.closeSync(fd);
        if (b[0] !== 10) fs.appendFileSync(p.log, '\n');
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    appendEvent(p, head);
    failpoint('after-enqueue');
    return { status: 'enqueued', id };
  });
}

// ── flush ──
function backoffS(failures) { return Math.min(3600, 60 * 2 ** Math.max(0, failures - 1)); }

function quarantine(p, bad, events, warn) {
  fs.appendFileSync(p.corrupt, bad.map((b) => `${JSON.stringify({ at: nowIso(), line_no: b.line_no, reason: b.reason, raw: b.raw })}\n`).join(''), { mode: 0o600 });
  store.writeSnapshot(p.log, events);
  warn(`WARNING qualification outbox: ${bad.length} corrupt line(s) moved to ${p.corrupt} (${bad.map((b) => b.reason).join('; ')}); other lines untouched`);
}

async function flush({ transport, env = process.env, force = false, nowMs = Date.now(), warn = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const p = paths(outboxDir(env));
  store.ensureDir(p.dir);
  const out = { sent: 0, acked: 0, retired: 0, rejected: 0, failed: 0, backoff_skipped: 0, quarantined: 0, compacted: 0 };
  // The lock is synchronous (PID lock); transport calls are awaited inside the held section.
  store.acquireLock({ storeDir: p.dir, lockFile: p.lock, name: 'qualification-outbox' });
  try {
    let { events, bad, unterminated } = readLog(p);
    if (bad.length) { quarantine(p, bad, events, warn); out.quarantined = bad.length; }
    else if (unterminated) store.writeSnapshot(p.log, events);
    const state = fold(events);
    for (const s of state.values()) {
      if (s.retired || s.rejected || !s.enqueued) continue;
      const rej = async (code, message) => { appendEvent(p, { event: 'rejected', id: s.id, kind: s.kind, payload_sha256: s.payload_sha256, code, message: trim(message) }); out.rejected += 1; };
      const ackIt = async (commit) => {
        failpoint('before-ack');
        if (!s.acked) appendEvent(p, { event: 'acked', id: s.id, kind: s.kind, payload_sha256: s.payload_sha256, commit });
        out.acked += 1;
        failpoint('after-ack');
        appendEvent(p, { event: 'retired', id: s.id, kind: s.kind, payload_sha256: s.payload_sha256 });
        out.retired += 1;
      };
      if (s.acked) { await ackIt(s.acked.commit); out.acked -= 1; continue; }   // resume after a crash between acked and retired
      const payload = payloadOf(p, s);
      if (!payload) { await rej('PAYLOAD_CORRUPT', 'payload missing or sha256 mismatch'); continue; }
      if (!force && s.failures > 0) {
        const wait = backoffS(s.failures) * 1000;
        if (nowMs - Date.parse(s.last_failed_ts) < wait) { out.backoff_skipped += 1; continue; }
      }
      const item = { id: s.id, kind: s.kind, payload };
      const fail = (m) => { appendEvent(p, { event: 'failed', id: s.id, kind: s.kind, payload_sha256: s.payload_sha256, message: trim(m) }); out.failed += 1; };
      try {
        let a = await transport.findAck(item);
        if (a.state === 'conflict') { await rej('ACK_CONFLICT', a.message); continue; }
        if (a.state !== 'acked' && !s.sent) {
          const r = await transport.send(item);
          if (r.status === 'rejected') { await rej(r.code || 'REJECTED', r.message); continue; }
          if (r.status !== 'sent' && r.status !== 'noop') { fail(r.message || `transport status ${r.status}`); continue; }
          failpoint('after-send');
          appendEvent(p, { event: 'sent', id: s.id, kind: s.kind, payload_sha256: s.payload_sha256 });
          out.sent += 1;
          a = await transport.findAck(item);
          if (a.state === 'conflict') { await rej('ACK_CONFLICT', a.message); continue; }
        }
        if (a.state === 'acked') await ackIt(a.commit);
      } catch (e) { fail(e.message); }
    }
    // compaction: drop ids that are acked AND retired
    ({ events } = readLog(p));
    const done = new Set();
    for (const s of fold(events).values()) if (s.acked && s.retired) done.add(s.id);
    if (done.size) {
      store.writeSnapshot(p.log, events.filter((e) => !done.has(e.id)));
      for (const id of done) { try { fs.unlinkSync(path.join(p.d, `${id}.json`)); } catch { /* inline payload */ } }
      out.compacted = done.size;
    }
  } finally { store.releaseLock(p.lock); }
  return out;
}

// ── status ──
function status({ env = process.env, nowMs = Date.now() } = {}) {
  const p = paths(outboxDir(env));
  const { events, bad } = readLog(p);
  const pending = [];
  const rejected = [];
  for (const s of fold(events).values()) {
    if (s.rejected) { rejected.push({ id: s.id, kind: s.kind, code: s.rejected.code, message: s.rejected.message }); continue; }
    if (!s.enqueued || s.retired) continue;
    const age = Math.floor((nowMs - Date.parse(s.enqueued.ts)) / 1000);
    pending.push({ id: s.id, kind: s.kind, age_s: Number.isFinite(age) ? age : null, sent: !!s.sent, acked: !!s.acked, failures: s.failures, last_error: s.last_error || null, stale_24h: age > STALE_S });
  }
  let quarantinedBytes = 0;
  try { quarantinedBytes = fs.statSync(p.corrupt).size; } catch { /* none */ }
  return { dir: p.dir, pending, rejected, stale_24h: pending.filter((x) => x.stale_24h), unreadable_lines: bad.length, quarantined_bytes: quarantinedBytes };
}

function statusLines(st) {
  const l = [`qualification outbox: ${st.pending.length} pending, ${st.rejected.length} rejected, ${st.stale_24h.length} older than 24h`];
  for (const x of st.pending) l.push(`  pending ${x.kind} ${x.id.slice(0, 12)} age=${x.age_s}s sent=${x.sent} failures=${x.failures}${x.stale_24h ? ' STALE>24h' : ''}`);
  for (const x of st.rejected) l.push(`  rejected ${x.kind} ${x.id.slice(0, 12)} ${x.code}: ${x.message || ''}`);
  if (st.unreadable_lines) l.push(`  WARNING ${st.unreadable_lines} unreadable line(s) in the log; run flush to quarantine`);
  if (st.quarantined_bytes) l.push(`  note: outbox.jsonl.corrupt holds ${st.quarantined_bytes} B of quarantined lines`);
  return l;
}

// ── git transport (bot branch -> PR -> CI -> owner merge; never pushes the default branch) ──
function run(cmd, args, { cwd, input } = {}) {
  const r = cp.spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
}

function assertPushAllowed(remote, args) {
  if (args[0] === 'push' && !(args.length === 3 && args[1] === remote && /^HEAD:refs\/heads\/bot\/qualification-[0-9a-f]{12}$/.test(args[2]))) {
    throw new Error(`refusing push ${args.join(' ')}: only HEAD to ${BOT_PREFIX}* is allowed`);
  }
}

function gitTransport(opts) {
  const { repo, workspace = 'cookys', remote = 'origin', openPr = true } = opts;
  const python = opts.python || 'python3';
  const ingestScript = opts.ingestScript || path.join(repo, 'scripts', 'eval', 'ingest-qualification-record.py');
  const rawGit = opts.git || ((args, o) => run('git', args, { cwd: repo, ...(o || {}) }));
  const gh = opts.gh || ((args) => run('gh', args, { cwd: repo }));
  const ingest = opts.ingest || ((args) => run(python, [ingestScript, ...args], { cwd: repo }));
  // The only push this adapter can issue is HEAD -> a bot branch. Pushing the default branch is not representable.
  const git = (args, o) => { assertPushAllowed(remote, args); return rawGit(args, o); };
  const must = (r, what) => { if (r.status !== 0) throw new Error(`${what} failed: ${trim(r.stderr || r.stdout)}`); return r; };
  const defaultBranch = () => {
    if (opts.defaultBranch) return opts.defaultBranch;
    const r = rawGit(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]);
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim().replace(`${remote}/`, '') : 'master';
  };
  const qualDir = `benchmarks/qualification/${workspace}`;

  function expected(item) {   // what the ingest would write for this payload, computed in a scratch root (no network, no repo write)
    let tmp;
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-expect-'));
      const pf = path.join(tmp, 'payload.json');
      fs.writeFileSync(pf, JSON.stringify(item.payload));
      const root = path.join(tmp, 'root');
      const r = ingest(['--kind', item.kind, '--workspace', workspace, '--root', root, pf]);
      const last = r.stdout.trim().split('\n').pop();
      let j = null;
      try { j = JSON.parse(last); } catch { /* handled below */ }
      if (r.status === 3 && j) return { rejected: j };
      if (r.status !== 0 || !j) throw new Error(`ingest failed: ${trim(r.stderr || r.stdout)}`);
      if (item.kind === 'record') return { name: path.basename(j.path), bytes: fs.readFileSync(path.join(root, workspace, path.basename(j.path)), 'utf8') };
      return { strike_id: Object.entries(j).find(([k]) => k === "strike_id")[1] };
    } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  function firstAckCommit(def, file, has) {   // first merge/commit on the default first-parent chain whose tree has it
    const l = must(git(['log', '--first-parent', '--reverse', '--format=%H', `${remote}/${def}`, '--', file]), 'git log');
    for (const c of l.stdout.split('\n').filter(Boolean)) {
      const s = git(['show', `${c}:${file}`]);
      if (s.status === 0 && has(s.stdout)) return c;
    }
    return null;
  }

  return {
    async findAck(item) {
      must(git(['fetch', remote]), 'git fetch');
      const def = defaultBranch();
      const ex = expected(item);
      if (ex.rejected) return { state: 'pending' };   // send() will surface the permanent rejection
      if (item.kind === 'record') {
        const file = `${qualDir}/${ex.name}`;
        const s = git(['show', `${remote}/${def}:${file}`]);
        if (s.status !== 0) return { state: 'pending' };   // on a bot branch or open PR only: not an ack
        if (s.stdout !== ex.bytes) return { state: 'conflict', message: `${file} on ${def} differs from the payload bytes` };
        const c = firstAckCommit(def, file, (t) => t === ex.bytes);
        return c ? { state: 'acked', commit: c } : { state: 'pending' };
      }
      const file = `${qualDir}/strike-events.jsonl`;
      const s = git(['show', `${remote}/${def}:${file}`]);
      if (s.status !== 0) return { state: 'pending' };
      const rowOf = (t) => t.split('\n').filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).find((r) => r && r.strike_id === ex.strike_id);
      const row = rowOf(s.stdout);
      if (!row) return { state: 'pending' };
      if (row.record_id !== item.payload.record_id) return { state: 'conflict', message: 'strike_id on default branch carries another record_id' };
      const c = firstAckCommit(def, file, (t) => !!rowOf(t));
      return c ? { state: 'acked', commit: c } : { state: 'pending' };
    },

    async send(item) {
      const def = defaultBranch();
      const bot = `${BOT_PREFIX}${item.id.slice(0, 12)}`;
      must(git(['fetch', remote]), 'git fetch');
      if (must(git(['status', '--porcelain']), 'git status').stdout.trim()) return { status: 'error', message: 'registry clone is dirty; refusing to branch' };
      must(git(['checkout', '-B', bot, `${remote}/${def}`]), 'git checkout');
      let tmp;
      try {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-send-'));
        const pf = path.join(tmp, 'payload.json');
        fs.writeFileSync(pf, JSON.stringify(item.payload));
        const r = ingest(['--kind', item.kind, '--workspace', workspace, '--root', path.join(repo, 'benchmarks', 'qualification'), pf]);
        let j = null;
        try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* below */ }
        if (r.status === 3 && j) return { status: 'rejected', code: j.code, message: j.message };
        if (r.status !== 0 || !j) return { status: 'error', message: `ingest exit ${r.status}: ${trim(r.stderr || r.stdout)}` };
        if (j.status === 'noop') return { status: 'noop' };   // already on the default branch
        must(git(['add', '-A', '--', 'benchmarks/qualification']), 'git add');
        must(git(['-c', 'user.name=autopilot-outbox', '-c', 'user.email=autopilot-outbox@users.noreply.invalid', 'commit', '-m',
          `qualification: ${item.kind} ${item.id.slice(0, 12)}\n\nQualification-Id: ${item.id}`]), 'git commit');
        must(git(['push', remote, `HEAD:refs/heads/${bot}`]), 'git push');
        if (openPr) {
          const l = must(gh(['pr', 'list', '--head', bot, '--state', 'open', '--json', 'number']), 'gh pr list');
          let open = [];
          try { open = JSON.parse(l.stdout || '[]'); } catch { /* treat as none */ }
          if (!open.length) {
            must(gh(['pr', 'create', '--base', def, '--head', bot, '--title', `qualification: ${item.kind} ${item.id.slice(0, 12)}`,
              '--body', `Qualification-Id: ${item.id}\n\nSent by autopilot qualification-send-queue. CI checks schema, byte cap and leaks; merge is the ack.`]), 'gh pr create');
          }
        }
        return { status: 'sent' };
      } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
    },
  };
}

function readOutboxConfig(env = process.env) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath({ env }), 'utf8')) || {}; } catch { /* absent config = defaults */ }
  const o = cfg.qualification_outbox && typeof cfg.qualification_outbox === 'object' ? cfg.qualification_outbox : {};
  return {
    enqueue: o.enqueue === true,
    transport: o.transport === 'git' ? 'git' : 'off',
    registry_repo: typeof o.registry_repo === 'string' ? store.expandTilde(o.registry_repo) : null,
  };
}

function transportFromConfig(env = process.env) {
  const c = readOutboxConfig(env);
  if (c.transport !== 'git') return null;
  if (!c.registry_repo) throw new Error('qualification_outbox.transport=git needs qualification_outbox.registry_repo');
  return gitTransport({ repo: c.registry_repo });
}

/** Hook for engine-scorecard `record`: queue a completed administration when qualification_outbox.enqueue is on. */
function enqueueScorecardRow(row, { env = process.env } = {}) {
  if (!readOutboxConfig(env).enqueue) return { status: 'off' };
  const record = require('./lib/qualification-record-v2.js').buildV2Record(row);
  if (!record) return { status: 'legacy_shape' };
  return enqueue('record', record, { env });
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (n) => { const i = rest.indexOf(n); return i < 0 ? undefined : rest[i + 1]; };
  if (cmd === 'enqueue') {
    const kind = flag('--kind');
    const file = flag('--file');
    if (!kind || !file) { process.stderr.write('enqueue needs --kind and --file\n'); return 2; }
    try {
      process.stdout.write(`${JSON.stringify(enqueue(kind, JSON.parse(fs.readFileSync(file, 'utf8'))))}\n`);
      return 0;
    } catch (e) { process.stderr.write(`enqueue refused: ${e.message}\n`); return 1; }
  }
  if (cmd === 'flush') {
    let transport;
    try { transport = transportFromConfig(); } catch (e) { process.stderr.write(`${e.message}\n`); return 2; }
    if (!transport) { process.stdout.write('qualification outbox: transport is off (qualification_outbox.transport); nothing sent\n'); return 0; }
    const r = await flush({ transport, force: rest.includes('--force') });
    process.stdout.write(`${JSON.stringify(r)}\n`);
    return 0;
  }
  if (cmd === 'status') {
    const st = status();
    process.stdout.write(rest.includes('--json') ? `${JSON.stringify(st, null, 2)}\n` : `${statusLines(st).join('\n')}\n`);
    return 0;
  }
  process.stderr.write('usage: qualification-send-queue.js enqueue --kind record|strike --file <f> | flush [--force] | status [--json]\n');
  return 2;
}

module.exports = { enqueueScorecardRow, outboxDir, enqueue, flush, status, statusLines, gitTransport, assertPushAllowed, readOutboxConfig, crc32, makeLine, parseLine, idOf, BOT_PREFIX };

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`${e.stack || e}\n`); process.exit(1); });
