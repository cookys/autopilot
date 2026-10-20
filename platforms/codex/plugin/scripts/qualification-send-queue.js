#!/usr/bin/env node
'use strict';
//
// qualification-send-queue.js — BL-0194 P3: autopilot sends exam records and strikes to the registry (llm-playground).
//
//   node scripts/qualification-send-queue.js enqueue --kind record|strike --file <payload.json>
//   node scripts/qualification-send-queue.js flush   [--force]
//   node scripts/qualification-send-queue.js status  [--json]
//
// Outbox: ~/.autopilot/qualification-outbox/outbox.jsonl (AUTOPILOT_OUTBOX_DIR overrides) and outbox.meta.json
// (enqueue_enabled_at, written once). Append-only event log,
// one line per event {event: enqueued|sent|acked|rejected|failed|retired, id, kind, payload_sha256, ts, line_crc};
// every append is ONE write of one line under 4096 B (a bigger payload goes to outbox.d/<id>.json, renamed in, and
// the line carries its sha256). Lock: the repo's PID lock with stale-holder breaker (scripts/lib/jsonl-store.js);
// Node has no flock, and this lock gives the same single-writer guarantee with crash recovery.
// flush: quarantines a torn/crc-bad line to outbox.jsonl.corrupt (loud warning, other lines untouched), then for each
// outbox.meta.json sits next to the log and is never an orphan. The sweep unlinks stray
// meta temp files named by metaTmpBasename (META_TMP_PREFIX + pid) in the outbox directory and files inside outbox.d.
// It never unlinks outbox.meta.json or outbox.jsonl.
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
    meta: path.join(dir, 'outbox.meta.json'),
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

function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { /* best effort where a directory cannot be opened */ }
}

function appendEvent(p, obj) {
  const created = !fs.existsSync(p.log);
  const line = makeLine({ ts: nowIso(), ...obj });
  if (Buffer.byteLength(line) >= 4096) throw new Error(`outbox line ${Buffer.byteLength(line)} B >= PIPE_BUF`);
  const fd = fs.openSync(p.log, 'a', 0o600);
  try {
    fs.writeSync(fd, line);   // exactly one write
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (created) fsyncDir(p.dir);   // the new file's directory entry must survive a crash too
}

function trim(s) { return String(s === undefined ? '' : s).replace(/\s+/g, ' ').slice(0, 300); }

function readMeta(p) {
  try {
    const o = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { corrupt: true };
    return { ok: o };
  } catch (e) {
    if (e.code === 'ENOENT') return { absent: true };
    return { corrupt: true };
  }
}

const META_TMP_PREFIX = '.outbox.meta.json.tmp.';

function metaTmpBasename(pid = process.pid) {
  return `${META_TMP_PREFIX}${pid}`;
}

function writeMetaAtomic(p, obj) {
  const tmp = path.join(p.dir, metaTmpBasename());
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(obj));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, p.meta);
  fs.chmodSync(p.meta, 0o600);
  fsyncDir(p.dir);
}

function earliestEnqueuedTs(p) {
  const { events } = readLog(p);
  let best = null;
  let bestMs = Infinity;
  for (const e of events) {
    if (!e || e.event !== 'enqueued' || typeof e.ts !== 'string' || !e.ts) continue;
    const ms = Date.parse(e.ts);
    if (!Number.isFinite(ms) || ms >= bestMs) continue;
    bestMs = ms;
    best = e.ts;
  }
  return best;
}

/** First successful append records enqueue_enabled_at once. A corrupt meta file is rewritten.
 *  Absent or corrupt meta with events already in the log uses the earliest enqueued ts
 *  (this runs before the append of the enqueue in progress). An empty log stamps now. */
function noteEnqueueEnabled(p) {
  const cur = readMeta(p);
  if (cur.ok && typeof cur.ok.enqueue_enabled_at === 'string' && cur.ok.enqueue_enabled_at) return;
  const next = cur.ok ? { ...cur.ok } : {};
  const fromLog = cur.ok ? null : earliestEnqueuedTs(p);
  next.enqueue_enabled_at = fromLog || nowIso();
  writeMetaAtomic(p, next);
}

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
      fsyncDir(p.d);
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
    noteEnqueueEnabled(p);
    appendEvent(p, head);
    failpoint('after-enqueue');
    return { status: 'enqueued', id };
  });
}

// ── flush ──
function backoffS(failures) { return Math.min(3600, 60 * 2 ** Math.max(0, failures - 1)); }

function isAlreadyIngested(code, transcriptHash, existingTranscriptHash) {
  return code === 'SECONDARY_KEY_COLLISION' && typeof transcriptHash === 'string' && transcriptHash
    && transcriptHash === existingTranscriptHash;
}

function quarantine(p, bad, events, warn) {
  fs.appendFileSync(p.corrupt, bad.map((b) => `${JSON.stringify({ at: nowIso(), line_no: b.line_no, reason: b.reason, raw: b.raw })}\n`).join(''), { mode: 0o600 });
  store.writeSnapshot(p.log, events);
  warn(`WARNING qualification outbox: ${bad.length} corrupt line(s) moved to ${p.corrupt} (${bad.map((b) => b.reason).join('; ')}); other lines untouched`);
}

async function flush({ transport, env = process.env, force = false, nowMs = Date.now(), warn = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const p = paths(outboxDir(env));
  store.ensureDir(p.dir);
  const out = { sent: 0, acked: 0, retired: 0, rejected: 0, already_ingested: 0, failed: 0, backoff_skipped: 0, quarantined: 0, compacted: 0 };
  // The lock is synchronous (PID lock); transport calls are awaited inside the held section.
  store.acquireLock({ storeDir: p.dir, lockFile: p.lock, name: 'qualification-outbox' });
  try {
    let { events, bad, unterminated } = readLog(p);
    if (bad.length) { quarantine(p, bad, events, warn); out.quarantined = bad.length; }
    else if (unterminated) store.writeSnapshot(p.log, events);
    const state = fold(events);
    for (const s of state.values()) {
      if (s.retired || s.rejected || !s.enqueued) continue;
      const rej = async (code, message, extra) => {
        const ev = { event: 'rejected', id: s.id, kind: s.kind, payload_sha256: s.payload_sha256, code, message: trim(message) };
        if (s.kind === 'record' && payload && typeof payload === 'object') {
          const es = payload.evidence_store;
          const th = es && typeof es === 'object' && typeof es.transcript_hash === 'string' && es.transcript_hash
            ? es.transcript_hash : payload.transcript_hash;
          if (typeof th === 'string' && th) ev.transcript_hash = th;
        }
        if (extra && typeof extra.existing_transcript_hash === 'string' && extra.existing_transcript_hash) {
          ev.existing_transcript_hash = extra.existing_transcript_hash;
        }
        appendEvent(p, ev);
        const ex = extra && typeof extra.existing_transcript_hash === 'string' ? extra.existing_transcript_hash : undefined;
        if (isAlreadyIngested(code, ev.transcript_hash, ex)) out.already_ingested += 1;
        else out.rejected += 1;
      };
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
      // During backoff only the send is skipped; the ack poll still runs so a just-merged PR is acked at once.
      const inBackoff = !force && s.failures > 0 && nowMs - Date.parse(s.last_failed_ts) < backoffS(s.failures) * 1000;
      const item = { id: s.id, kind: s.kind, payload };
      const fail = (m) => { if (inBackoff) { out.backoff_skipped += 1; return; } appendEvent(p, { event: 'failed', id: s.id, kind: s.kind, payload_sha256: s.payload_sha256, message: trim(m) }); out.failed += 1; };
      try {
        let a = await transport.findAck(item);
        if (a.state === 'conflict') { await rej('ACK_CONFLICT', a.message); continue; }
        if (a.state !== 'acked' && inBackoff) { out.backoff_skipped += 1; continue; }
        if (a.state !== 'acked' && !s.sent) {
          const r = await transport.send(item);
          if (r.status === 'rejected') { await rej(r.code || 'REJECTED', r.message, r); continue; }
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
    // orphans: a payload file with no enqueued line (crash between rename and append) and stray temp files
    const live = new Set(readLog(p).events.filter((e) => e.event === 'enqueued').map((e) => e.id));
    let names = [];
    try { names = fs.readdirSync(p.d); } catch { /* no outbox.d yet */ }
    for (const n of names) {
      const m = /^([0-9a-f]{64})\.json$/.exec(n);
      if (n.startsWith('.') || (m && !live.has(m[1]))) {
        try { fs.unlinkSync(path.join(p.d, n)); out.orphans_removed = (out.orphans_removed || 0) + 1; } catch { /* raced away */ }
      }
    }
    let rootNames = [];
    try { rootNames = fs.readdirSync(p.dir); } catch { /* dir vanished */ }
    for (const n of rootNames) {
      if (!n.startsWith(META_TMP_PREFIX)) continue;
      try { fs.unlinkSync(path.join(p.dir, n)); out.orphans_removed = (out.orphans_removed || 0) + 1; } catch { /* raced away */ }
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
  const already_ingested = [];
  for (const s of fold(events).values()) {
    if (s.rejected) {
      const code = s.rejected.code;
      const th = s.rejected.transcript_hash;
      const ex = s.rejected.existing_transcript_hash;
      if (isAlreadyIngested(code, th, ex)) {
        already_ingested.push({ id: s.id, kind: s.kind, code, transcript_hash: th });
        continue;
      }
      rejected.push({ id: s.id, kind: s.kind, code, message: s.rejected.message });
      continue;
    }
    if (!s.enqueued || s.retired) continue;
    const age = Math.floor((nowMs - Date.parse(s.enqueued.ts)) / 1000);
    pending.push({ id: s.id, kind: s.kind, age_s: Number.isFinite(age) ? age : null, sent: !!s.sent, acked: !!s.acked, failures: s.failures, last_error: s.last_error || null, stale_24h: age > STALE_S });
  }
  let quarantinedBytes = 0;
  try { quarantinedBytes = fs.statSync(p.corrupt).size; } catch { /* none */ }
  const meta = readMeta(p);
  const enqueue_enabled_at = meta.ok && typeof meta.ok.enqueue_enabled_at === 'string' ? meta.ok.enqueue_enabled_at : null;
  return { dir: p.dir, pending, rejected, already_ingested, enqueue_enabled_at, stale_24h: pending.filter((x) => x.stale_24h), unreadable_lines: bad.length, quarantined_bytes: quarantinedBytes };
}

function statusLines(st) {
  const ingested = st.already_ingested || [];
  const l = [`qualification outbox: ${st.pending.length} pending, ${st.rejected.length} rejected, ${st.stale_24h.length} older than 24h, ${ingested.length} already_ingested`];
  for (const x of st.pending) l.push(`  pending ${x.kind} ${x.id.slice(0, 12)} age=${x.age_s}s sent=${x.sent} failures=${x.failures}${x.stale_24h ? ' STALE>24h' : ''}`);
  for (const x of st.rejected) l.push(`  rejected ${x.kind} ${x.id.slice(0, 12)} ${x.code}: ${x.message || ''}`);
  for (const x of ingested) l.push(`  already_ingested ${x.kind} ${x.id.slice(0, 12)} ${x.code}`);
  if (st.enqueue_enabled_at) l.push(`  enqueue_enabled_at ${st.enqueue_enabled_at}`);
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
  let i = 0;   // skip git's global options (-c k=v, -C dir) so a prefixed push cannot slip past
  while (i < args.length && (args[i] === '-c' || args[i] === '-C')) i += 2;
  const rest = args.slice(i);
  if (rest[0] === 'push' && !(rest.length === 3 && rest[1] === remote && /^HEAD:refs\/heads\/bot\/qualification-[0-9a-f]{12}$/.test(rest[2]))) {
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
    if (r.status !== 0 || !r.stdout.trim()) throw new Error(`refs/remotes/${remote}/HEAD is not set in the registry clone (run: git remote set-head ${remote} -a); not guessing the default branch`);
    return r.stdout.trim().replace(`${remote}/`, '');
  };
  const qualDir = `benchmarks/qualification/${workspace}`;

  function idCandidates(message) {
    const out = [];
    const re = /(?:v\d+:)?[0-9a-fA-F]{12,}/gi;
    const text = String(message || '');
    let m;
    while ((m = re.exec(text))) out.push(m[0]);
    return out;
  }

  function recordIdMatches(recordId, candidate) {
    const rec = String(recordId).toLowerCase();
    const cand = String(candidate).toLowerCase();
    if (rec === cand) return true;
    const strip = (s) => s.replace(/^v\d+:/, '');
    const recBody = strip(rec);
    const candBody = strip(cand);
    if (candBody.length > 0 && candBody === recBody) return true;
    if (/^[0-9a-f]{12,}$/.test(candBody) && recBody.startsWith(candBody)) return true;
    return false;
  }

  function existingTranscriptHash(message) {
    const candidates = idCandidates(message);
    if (!candidates.length) return undefined;
    const root = path.join(repo, 'benchmarks', 'qualification');
    const matches = (recordId) => candidates.some((cand) => recordIdMatches(recordId, cand));
    let hit;
    const walk = (dir) => {
      if (hit) return;
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of ents) {
        if (hit) return;
        const fp = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(fp);
        else if (ent.isFile() && ent.name.endsWith('.json')) {
          try {
            const rec = JSON.parse(fs.readFileSync(fp, 'utf8'));
            if (rec && typeof rec.record_id === 'string' && matches(rec.record_id)
              && typeof rec.transcript_hash === 'string' && rec.transcript_hash) hit = rec.transcript_hash;
          } catch { /* skip an unreadable record */ }
        }
      }
    };
    try { walk(root); } catch { return undefined; }
    return hit;
  }

  function rejectedFromIngest(j) {
    const out = { status: 'rejected', code: j && j.code, message: j && j.message };
    if (j && j.code === 'SECONDARY_KEY_COLLISION') {
      try {
        const h = existingTranscriptHash(j.message);
        if (h) out.existing_transcript_hash = h;
      } catch { /* omit the field */ }
    }
    return out;
  }

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

  function holds(ref, item, ex) {   // does `ref` hold exactly this payload? 'same' | 'different'
    if (item.kind === 'record') {
      const f = git(['show', `${ref}:${qualDir}/${ex.name}`]);
      return f.status === 0 && f.stdout === ex.bytes ? 'same' : 'different';
    }
    const f = git(['show', `${ref}:${qualDir}/strike-events.jsonl`]);
    if (f.status !== 0) return 'different';
    const row = f.stdout.split('\n').filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).find((r) => r && r.strike_id === ex.strike_id);
    return row && row.record_id === item.payload.record_id ? 'same' : 'different';
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
      must(git(['fetch', '--prune', remote]), 'git fetch');
      const title = `qualification: ${item.kind} ${item.id.slice(0, 12)}`;
      const ensurePr = () => {   // reuse an open or merged PR for this branch; open one only when there is none
        if (!openPr) return;
        const l = must(gh(['pr', 'list', '--head', bot, '--state', 'all', '--json', 'number,state']), 'gh pr list');
        let prs = [];
        try { prs = JSON.parse(l.stdout || '[]'); } catch { /* treat as none */ }
        if (prs.some((x) => ['open', 'merged'].includes(String(x.state).toLowerCase()))) return;
        must(gh(['pr', 'create', '--base', def, '--head', bot, '--title', title,
          '--body', `Qualification-Id: ${item.id}\n\nSent by autopilot qualification-send-queue. CI checks schema, byte cap and leaks; merge is the ack.`]), 'gh pr create');
      };
      // Re-entry: the bot branch may already be on the remote (crash after push, or push ok and PR creation failed).
      // Rebuilding it would give a new sha on the same parent and a rejected plain push, so: identical content -> only
      // make sure a PR exists; different content -> conflict (never a force push).
      if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${bot}`]).status === 0) {
        const ex = expected(item);
        if (ex.rejected) return rejectedFromIngest(ex.rejected);
        if (holds(`${remote}/${bot}`, item, ex) !== 'same') {
          return { status: 'rejected', code: 'BOT_BRANCH_CONFLICT', message: `${bot} on ${remote} holds different content for this id` };
        }
        ensurePr();
        return { status: 'sent' };
      }
      if (must(git(['status', '--porcelain']), 'git status').stdout.trim()) {
        // Self-heal only a dirty bot branch (our own interrupted run); anything else is somebody's work tree.
        const head = must(git(['rev-parse', '--abbrev-ref', 'HEAD']), 'git rev-parse').stdout.trim();
        if (!head.startsWith(BOT_PREFIX)) return { status: 'error', message: `registry clone is dirty on ${head}, not a ${BOT_PREFIX}* branch; refusing to touch it` };
        must(git(['reset', '--hard']), 'git reset');
        must(git(['clean', '-fd']), 'git clean');
      }
      must(git(['checkout', '-B', bot, `${remote}/${def}`]), 'git checkout');
      let tmp;
      try {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-send-'));
        const pf = path.join(tmp, 'payload.json');
        fs.writeFileSync(pf, JSON.stringify(item.payload));
        const r = ingest(['--kind', item.kind, '--workspace', workspace, '--root', path.join(repo, 'benchmarks', 'qualification'), pf]);
        let j = null;
        try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* below */ }
        if (r.status === 3 && j) return rejectedFromIngest(j);
        if (r.status !== 0 || !j) return { status: 'error', message: `ingest exit ${r.status}: ${trim(r.stderr || r.stdout)}` };
        if (j.status === 'noop') return { status: 'noop' };   // already on the default branch
        must(git(['add', '-A', '--', 'benchmarks/qualification']), 'git add');
        must(git(['-c', 'user.name=autopilot-outbox', '-c', 'user.email=autopilot-outbox@users.noreply.invalid', 'commit', '-m',
          `${title}\n\nQualification-Id: ${item.id}`]), 'git commit');
        must(git(['push', remote, `HEAD:refs/heads/${bot}`]), 'git push');
        ensurePr();
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
    workspace: typeof o.workspace === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(o.workspace) ? o.workspace : 'cookys',
    registry_repo: typeof o.registry_repo === 'string' ? store.expandTilde(o.registry_repo) : null,
  };
}

function transportFromConfig(env = process.env) {
  const c = readOutboxConfig(env);
  if (c.transport !== 'git') return null;
  if (!c.registry_repo) throw new Error('qualification_outbox.transport=git needs qualification_outbox.registry_repo');
  return gitTransport({ repo: c.registry_repo, workspace: c.workspace });
}

/** Hook for engine-scorecard `record`: queue a completed administration when qualification_outbox.enqueue is on. */
function enqueueScorecardRow(row, { env = process.env } = {}) {
  if (!readOutboxConfig(env).enqueue) return { status: 'off' };
  let record;
  try {
    record = require('./lib/qualification-record-v2.js').buildV2Record(row);
  } catch (e) {
    return { status: 'ts_rejected', message: e.message };
  }
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

module.exports = { enqueueScorecardRow, outboxDir, enqueue, flush, status, statusLines, gitTransport, assertPushAllowed, readOutboxConfig, crc32, makeLine, parseLine, idOf, BOT_PREFIX, META_TMP_PREFIX, metaTmpBasename };

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`${e.stack || e}\n`); process.exit(1); });
