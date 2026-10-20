'use strict';
/*
# RED at 45b1c5fff: new cases 8 fail / 1 pass (exit 1). enqueue_enabled_at absent from status; first enqueue writes no meta; ts_rejected missing (buildV2Record returns null); SECONDARY_KEY_COLLISION stays in rejected with no already_ingested array; old rejected line still parses but already_ingested is undefined. The pre-set sentinel case passed only because the base never reads outbox.meta.json.
# RED at 5a93aadcf: record stderr is the legacy_shape line (no ts_rejected) for observed_at 2026-02-30; flush summary.already_ingested is undefined (equal-hash rejected count stays on rejected; different-hash already_ingested !== 0). exit 1.
# RED at 8b89f4d5e: record still exits 0 with ts_rejected on stderr (store written); absent/corrupt meta stamp now (2026-10-20T02:05:50Z) not the earliest enqueued ts; flush orphans_removed undefined for .outbox.meta.json.tmp; v1:/v2: transcript hash undefined. 6 fail. exit 1.
# RED at 3cbbb4c18: 13-hex, 40-hex, 63-hex and v2:40 prefix candidates return undefined (12-hex and 64-hex pass; a non-prefix 13-hex finds nothing). exit 1.
*/
// Run: node --test scripts/qualification-send-queue.test.js
//
// BL-0194 P3. Fault tests (SIGKILL at every AUTOPILOT_OUTBOX_FAILPOINT, then resume: zero lost, zero duplicate) and
// NEGATIVE CONTROLS: a rule is asserted on the real module (must pass) and on a copy with that rule removed (must go
// red). Fake transports only; the git transport runs against local temp bare repos and a stub `gh`; nothing touches
// the network, a real ~/.autopilot, or llm-playground.

const DRIVER = process.argv[2] === '--driver';
// In driver mode (a killable child) no tests may register, or node:test would run them recursively.
const test = DRIVER ? () => {} : require('node:test').test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.join(__dirname, 'qualification-send-queue.js');
const FIX = path.join(__dirname, '..', 'hooks', 'tests', 'fixtures', 'qualification-registry');
const q = require('./lib/qualification-metrics.js');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `qsq-${p}-`));

// ── driver mode: a child process the test can SIGKILL ──
if (DRIVER) {
  const sq = require(SRC);
  const [, , , op, arg] = process.argv;
  const reg = process.env.TEST_REGISTRY;
  const idem = process.env.TEST_IDEMPOTENT !== '0';
  const commits = () => (fs.existsSync(reg) ? fs.readFileSync(reg, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const transport = {
    async findAck(item) {
      if (process.env.TEST_ACK_VISIBLE_FILE && !fs.existsSync(process.env.TEST_ACK_VISIBLE_FILE)) return { state: 'pending' };   // PR not merged yet
      const c = commits().find((x) => x.id === item.id); return c ? { state: 'acked', commit: c.sha } : { state: 'pending' }; },
    async send(item) {
      if (idem && commits().some((x) => x.id === item.id)) return { status: 'noop' };
      fs.appendFileSync(reg, `${JSON.stringify({ id: item.id, sha: `sha-${commits().length + 1}` })}\n`);
      return { status: 'sent' };
    },
  };
  (async () => {
    if (op === 'enqueue') console.log(JSON.stringify(sq.enqueue('record', makeRecord(Number(arg)))));
    else if (op === 'flush') console.log(JSON.stringify(await sq.flush({ transport })));
  })().then(() => process.exit(0), (e) => { console.error(e.stack); process.exit(1); });
}

function makeRecord(n) {
  const r = JSON.parse(fs.readFileSync(path.join(FIX, 'record-v2.valid.json'), 'utf8'));
  r.transcript_hash = String(n).padStart(2, '0').repeat(32).slice(0, 64);
  r.record_id = q.recordIdV1(r.producer, r.transcript_hash, r.seat, r.seat.corpus_version, r.administered_at);
  return r;
}

function driver(op, arg, env) {
  return spawnSync(process.execPath, [__filename, '--driver', op, arg === undefined ? '' : String(arg)], { env: { ...process.env, ...env }, encoding: 'utf8' });
}
function fresh() {
  const d = tmp('ob');
  return { dir: path.join(d, 'ob'), reg: path.join(d, 'registry.jsonl'), env: { AUTOPILOT_OUTBOX_DIR: path.join(d, 'ob'), TEST_REGISTRY: path.join(d, 'registry.jsonl'), AUTOPILOT_CONFIG_FILE: path.join(d, 'none.json') } };
}
function registryIds(reg) {
  return fs.existsSync(reg) ? fs.readFileSync(reg, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : [];
}
// The invariant under test: every id is in the registry exactly once.
function assertExactlyOnce(reg, ids) {
  const got = registryIds(reg);
  for (const id of ids) {
    const n = got.filter((x) => x === id).length;
    assert.equal(n, 1, `${id.slice(0, 8)} appears ${n} times in the registry (want exactly 1)`);
  }
  assert.equal(got.length, ids.length, `registry holds ${got.length} entries for ${ids.length} ids`);
}
const IDS = [1, 2, 3].map((n) => makeRecord(n).record_id);

// ── failpoints: kill, resume, zero lost, zero duplicate ──
for (const fp of ['after-enqueue', 'after-send', 'before-ack', 'after-ack']) {
  test(`failpoint ${fp}: SIGKILL then resume loses and duplicates nothing`, () => {
    const t = fresh();
    if (fp === 'after-enqueue') {
      assert.equal(driver('enqueue', 1, t.env).status, 0);
      const killed = driver('enqueue', 2, { ...t.env, AUTOPILOT_OUTBOX_FAILPOINT: fp });
      assert.equal(killed.signal, 'SIGKILL', 'the failpoint must really kill the process');
      assert.equal(driver('enqueue', 2, t.env).status, 0);   // resume: already enqueued -> duplicate, not a second line
      assert.equal(driver('enqueue', 3, t.env).status, 0);
      const lines = fs.readFileSync(path.join(t.dir, 'outbox.jsonl'), 'utf8').split('\n').filter(Boolean);
      assert.equal(lines.length, 3, 'exactly one enqueued line per id');
      assert.equal(driver('flush', undefined, t.env).status, 0);
    } else {
      for (const n of [1, 2, 3]) assert.equal(driver('enqueue', n, t.env).status, 0);
      const killed = driver('flush', undefined, { ...t.env, AUTOPILOT_OUTBOX_FAILPOINT: fp });
      assert.equal(killed.signal, 'SIGKILL');
      assert.equal(driver('flush', undefined, t.env).status, 0, driver('flush', undefined, t.env).stderr);
    }
    assertExactlyOnce(t.reg, IDS);
    assert.equal(driver('flush', undefined, t.env).status, 0);   // re-runnable
    assertExactlyOnce(t.reg, IDS);
    const left = fs.readFileSync(path.join(t.dir, 'outbox.jsonl'), 'utf8').trim();
    assert.equal(left, '', 'everything acked and retired is compacted away');
  });
}

test('NEGATIVE CONTROL: without an idempotency key the same kill produces a duplicate and the detector goes red', () => {
  const t = fresh();
  const env = { ...t.env, TEST_IDEMPOTENT: '0', TEST_ACK_VISIBLE_FILE: path.join(path.dirname(t.dir), 'never') };
  for (const n of [1, 2, 3]) driver('enqueue', n, env);
  driver('flush', undefined, { ...env, AUTOPILOT_OUTBOX_FAILPOINT: 'after-send' });   // sent, `sent` event lost
  driver('flush', undefined, env);                                                    // resend: a second copy
  assert.throws(() => assertExactlyOnce(t.reg, IDS), /appears 2 times|registry holds/);
  // and the keyed run is green (the same scenario above passes with TEST_IDEMPOTENT unset)
});

test('failpoint after-send with the PR still unmerged: resend is a keyed no-op, ack arrives after the merge', () => {
  const t = fresh();
  const visible = path.join(path.dirname(t.dir), 'visible');
  const env = { ...t.env, TEST_ACK_VISIBLE_FILE: visible };
  for (const n of [1, 2, 3]) driver('enqueue', n, env);
  assert.equal(driver('flush', undefined, { ...env, AUTOPILOT_OUTBOX_FAILPOINT: 'after-send' }).signal, 'SIGKILL');
  assert.equal(driver('flush', undefined, env).status, 0);
  assert.equal(driver('flush', undefined, env).status, 0);
  assertExactlyOnce(t.reg, IDS);
  assert.ok(fs.readFileSync(path.join(t.dir, 'outbox.jsonl'), 'utf8').trim().length > 0, 'not retired before the merge');
  fs.writeFileSync(visible, '');   // the owner merges
  assert.equal(driver('flush', undefined, env).status, 0);
  assertExactlyOnce(t.reg, IDS);
  assert.equal(fs.readFileSync(path.join(t.dir, 'outbox.jsonl'), 'utf8').trim(), '');
});

// ── in-process behaviour ──
function fakeTransport({ ackAfterPolls = 0, rejectWith = null } = {}) {
  const calls = { send: 0, find: 0 };
  const sent = new Set();
  return {
    calls,
    async findAck(item) { calls.find += 1; return sent.has(item.id) && calls.find > ackAfterPolls ? { state: 'acked', commit: 'merge-sha' } : { state: 'pending' }; },
    async send(item) { calls.send += 1; if (rejectWith) return { status: 'rejected', ...rejectWith }; sent.add(item.id); return { status: 'sent' }; },
  };
}
function loadSq(file = SRC) { delete require.cache[file]; return require(file); }

test('dropped ack: sent but not retired, not resent, not duplicated; retired once the ack shows up', async () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  sq.enqueue('record', makeRecord(1), { env });
  const tr = fakeTransport({ ackAfterPolls: 3 });
  const a = await sq.flush({ transport: tr, env, warn() {} });
  assert.equal(a.sent, 1); assert.equal(a.retired, 0);
  assert.equal(sq.status({ env }).pending.length, 1, 'still pending: ack was dropped');
  const b = await sq.flush({ transport: tr, env, warn() {} });
  assert.equal(b.retired, 0);
  const c = await sq.flush({ transport: tr, env, warn() {} });
  assert.equal(c.retired, 1);
  assert.equal(tr.calls.send, 1, 'sent exactly once across three flushes');
  assert.equal(sq.status({ env }).pending.length, 0);
});

test('permanent rejection is recorded, shown, and never resent', async () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  sq.enqueue('record', makeRecord(1), { env });
  const tr = fakeTransport({ rejectWith: { code: 'ID_CONFLICT', message: 'x' } });
  await sq.flush({ transport: tr, env, warn() {} });
  await sq.flush({ transport: tr, env, warn() {} });
  assert.equal(tr.calls.send, 1);
  const st = sq.status({ env });
  assert.equal(st.rejected.length, 1); assert.equal(st.rejected[0].code, 'ID_CONFLICT');
  assert.equal(st.pending.length, 0);
});

test('transport failure keeps the id pending with backoff, then retries', async () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  sq.enqueue('record', makeRecord(1), { env });
  const boom = { async findAck() { throw new Error('network down'); }, async send() { throw new Error('unused'); } };
  const t0 = Date.now();
  const a = await sq.flush({ transport: boom, env, nowMs: t0, warn() {} });
  assert.equal(a.failed, 1);
  const b = await sq.flush({ transport: boom, env, nowMs: t0 + 1000, warn() {} });
  assert.equal(b.backoff_skipped, 1); assert.equal(b.failed, 0);
  const ok = fakeTransport();
  const c = await sq.flush({ transport: ok, env, nowMs: t0 + 3600 * 1000, warn() {} });
  assert.equal(c.sent, 1);
});

test('torn tail and crc-bad line are quarantined loudly; the other lines are still sent', async () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  sq.enqueue('record', makeRecord(1), { env });
  sq.enqueue('record', makeRecord(2), { env });
  const log = path.join(t.dir, 'outbox.jsonl');
  const good = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const tampered = good[1].replace('"enqueued"', '"enqueueD"');   // crc no longer matches
  const torn = JSON.stringify({ event: 'enqueued', id: 'ab'.repeat(32) }).slice(0, 40);   // crash mid-write, no newline
  fs.writeFileSync(log, `${good[0]}\n${tampered}\n${torn}`);
  const warns = [];
  const tr = fakeTransport();
  const r = await sq.flush({ transport: tr, env, warn: (m) => warns.push(m) });
  assert.equal(r.quarantined, 2);
  assert.match(warns.join('\n'), /WARNING.*corrupt/);
  assert.ok(fs.readFileSync(path.join(t.dir, 'outbox.jsonl.corrupt'), 'utf8').includes('line_crc mismatch'));
  assert.equal(tr.calls.send, 1, 'the intact line is still sent');
});

test('enqueue: one entry per id, invalid record refused, big payload goes to outbox.d with a sha256, lines < 4096 B', () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  assert.equal(sq.enqueue('record', makeRecord(1), { env }).status, 'enqueued');
  assert.equal(sq.enqueue('record', makeRecord(1), { env }).status, 'duplicate');
  const bad = makeRecord(2); bad.record_id = '0'.repeat(64);
  assert.throws(() => sq.enqueue('record', bad, { env }), /refused/);
  const big = makeRecord(3); big.raw = { blob: 'x'.repeat(20000) };
  big.record_id = q.recordIdV1(big.producer, big.transcript_hash, big.seat, big.seat.corpus_version, big.administered_at);
  sq.enqueue('record', big, { env });
  const lines = fs.readFileSync(path.join(t.dir, 'outbox.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(Buffer.byteLength(`${l}\n`) < 4096);
  const bigLine = JSON.parse(lines[1]);
  assert.equal(bigLine.payload_ref, `outbox.d/${big.record_id}.json`);
  assert.equal(require('crypto').createHash('sha256').update(fs.readFileSync(path.join(t.dir, bigLine.payload_ref))).digest('hex'), bigLine.payload_sha256);
  assert.ok(sq.parseLine(lines[0]).ok);
});

test('strike takes the same path (strike_id derived, registry assigns strike_seq)', async () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  const rec = makeRecord(1);
  const strike = { seat: { engine: rec.seat.engine, runner: rec.seat.runner, role: rec.seat.role }, effort: rec.seat.effort, reason: 'canary', record_id: rec.record_id, administered_at: rec.administered_at };
  const r = sq.enqueue('strike', strike, { env });
  assert.equal(r.id, q.strikeId(strike.seat, strike.effort, strike.reason, strike.administered_at, strike.record_id));
  const tr = fakeTransport();
  assert.equal((await sq.flush({ transport: tr, env, warn() {} })).sent, 1);
});

test('status lists pending older than 24h', () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  sq.enqueue('record', makeRecord(1), { env });
  const st = sq.status({ env, nowMs: Date.now() + 25 * 3600 * 1000 });
  assert.equal(st.stale_24h.length, 1);
  assert.match(sq.statusLines(st).join('\n'), /STALE>24h/);
});

test('scorecard hook: off by default, one entry when qualification_outbox.enqueue is on, legacy shape not queued', () => {
  const t = fresh();
  const sq = loadSq();
  const rec = makeRecord(1);
  const row = { ...rec.seat, status: 'qualified', date: '2026-10-16', evidence: { evidence_id: 'e', observed_at: rec.administered_at }, evidence_store: { producer: rec.producer, transcript_hash: rec.transcript_hash } };
  const cfgOn = path.join(path.dirname(t.dir), 'on.json');
  fs.writeFileSync(cfgOn, JSON.stringify({ qualification_outbox: { enqueue: true } }));
  const off = { AUTOPILOT_OUTBOX_DIR: t.dir, AUTOPILOT_CONFIG_FILE: path.join(path.dirname(t.dir), 'none.json') };
  assert.equal(sq.enqueueScorecardRow(row, { env: off }).status, 'off');
  assert.ok(!fs.existsSync(path.join(t.dir, 'outbox.jsonl')));
  const on = { AUTOPILOT_OUTBOX_DIR: t.dir, AUTOPILOT_CONFIG_FILE: cfgOn };
  assert.equal(sq.enqueueScorecardRow(row, { env: on }).status, 'enqueued');
  assert.equal(sq.enqueueScorecardRow(row, { env: on }).status, 'duplicate');
  const legacy = { ...row, evidence_store: {} };
  assert.equal(sq.enqueueScorecardRow(legacy, { env: on }).status, 'legacy_shape');
});

function recordEnv(home, store, outbox, cfg) {
  const env = {
    ...process.env,
    HOME: home,
    AUTOPILOT_CONFIG_FILE: cfg,
    AUTOPILOT_OUTBOX_DIR: outbox,
    ENGINE_SCORECARD_DIR: store,
    ENGINE_CAPABILITY_DIR: store,
    AUTOPILOT_STRIKE_WRITER: 'off',
  };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}

function externalPriorRow(observedAt) {
  const hash = 'ab'.repeat(32);
  return {
    engine: 'grok-4.6', runner: 'grok', family: 'f', role: 'reviewer', effort: 'default',
    model_version: 'v1', version_source: 'manual', corpus_version: null,
    harness_version: 'h1', runner_version: 'rv1', prompt_config_hash: hash,
    date: '2026-06-30', quality: { corpus_pass: '10/10' }, capability_score: 0.9,
    cost: { source: 'manual' }, latency: { sample_wall_time_s: 0 },
    status: 'failed', qualified_at: '2026-03-02', expires: '2026-04-02',
    evidence_store: { producer: 'p', transcript_hash: hash },
    evidence: {
      schema_version: 1, source: 'external_prior', source_ref: 'src', state: 'provisional', role: 'reviewer',
      scope: { task_classes: ['t'], domains: ['d'], languages: ['js'], tool_surface: [] },
      identity: {
        identity: 'grok-4.6', model_alias: 'grok-4.6', model_version: 'v1', family: 'f', runner: 'grok',
        runner_version: 'rv1', harness_version: 'h1', effort: 'default', prompt_config_hash: hash,
        semantic_fingerprint: hash, containment_fingerprint: hash, identity_resolved: false,
      },
      issued_at: '2026-03-02T00:00:00.000Z', observed_at: observedAt, expires_at: '2026-04-02T00:00:00.000Z',
      methodology: {
        kind: 'external_prior', name: 'ext', version: '1', corpus_version: null, corpus_manifest_hash: null, thresholds: null,
        basis: { cohort: 'c', cohort_hash: hash, observation_hash: hash, dimensions: ['x'], applicability: [] },
      },
      trials: [], revocation: null, supersedes: null,
    },
  };
}

test('record rejects an impossible evidence date and writes nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qsq-rec-'));
  const store = path.join(home, 'score');
  const outbox = path.join(home, 'ob');
  const cfg = path.join(home, 'cfg.json');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ qualification_outbox: { enqueue: true } }));
  const row = externalPriorRow('2026-02-30T00:00:00Z');
  const file = path.join(home, 'row.json');
  fs.writeFileSync(file, JSON.stringify(row));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'engine-scorecard.js'), 'record', '--file', file], {
    env: recordEnv(home, store, outbox, cfg), encoding: 'utf8',
  });
  assert.notEqual(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stderr, /observed_at/);
  assert.match(r.stderr, /2026-02-30T00:00:00Z/);
  assert.ok(!fs.existsSync(path.join(store, 'scorecard.jsonl')));
  assert.ok(!fs.existsSync(path.join(outbox, 'outbox.jsonl')));
});

test('record accepts a toISOString evidence timestamp', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qsq-rec-ok-'));
  const store = path.join(home, 'score');
  const outbox = path.join(home, 'ob');
  const cfg = path.join(home, 'cfg.json');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ qualification_outbox: { enqueue: true } }));
  const observed = new Date('2026-03-01T00:00:00.000Z').toISOString();
  const row = externalPriorRow(observed);
  const file = path.join(home, 'row.json');
  fs.writeFileSync(file, JSON.stringify(row));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'engine-scorecard.js'), 'record', '--file', file], {
    env: recordEnv(home, store, outbox, cfg), encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const lines = fs.readFileSync(path.join(store, 'scorecard.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).evidence.observed_at, observed);
});

function isoCase() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qsq-home-'));
  const dir = path.join(home, 'ob');
  return {
    home, dir,
    env: { HOME: home, AUTOPILOT_OUTBOX_DIR: dir, AUTOPILOT_CONFIG_FILE: path.join(home, 'none.json') },
  };
}

test('enqueue_enabled_at is absent before any enqueue', () => {
  const t = isoCase();
  const sq = loadSq();
  const st = sq.status({ env: t.env });
  assert.equal(st.enqueue_enabled_at, null);
  assert.ok(!fs.existsSync(path.join(t.dir, 'outbox.meta.json')));
  assert.doesNotMatch(sq.statusLines(st).join('\n'), /enqueue_enabled_at/);
});

test('enqueue_enabled_at is written on the first enqueue and status shows it', () => {
  const t = isoCase();
  const sq = loadSq();
  const before = Date.now();
  assert.equal(sq.enqueue('record', makeRecord(1), { env: t.env }).status, 'enqueued');
  const meta = JSON.parse(fs.readFileSync(path.join(t.dir, 'outbox.meta.json'), 'utf8'));
  assert.match(meta.enqueue_enabled_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  assert.ok(Math.abs(Date.parse(meta.enqueue_enabled_at) - before) < 60_000);
  assert.equal((fs.statSync(path.join(t.dir, 'outbox.meta.json')).mode & 0o777), 0o600);
  const st = sq.status({ env: t.env });
  assert.equal(st.enqueue_enabled_at, meta.enqueue_enabled_at);
  assert.match(sq.statusLines(st).join('\n'), new RegExp(`enqueue_enabled_at ${meta.enqueue_enabled_at}`));
});

test('a second enqueue does not change a pre-set enqueue_enabled_at', () => {
  const t = isoCase();
  const sq = loadSq();
  fs.mkdirSync(t.dir, { recursive: true });
  const sentinel = '2001-01-01T00:00:00Z';
  fs.writeFileSync(path.join(t.dir, 'outbox.meta.json'), JSON.stringify({ enqueue_enabled_at: sentinel, keep: 1 }), { mode: 0o600 });
  assert.equal(sq.enqueue('record', makeRecord(1), { env: t.env }).status, 'enqueued');
  assert.equal(sq.enqueue('record', makeRecord(2), { env: t.env }).status, 'enqueued');
  const meta = JSON.parse(fs.readFileSync(path.join(t.dir, 'outbox.meta.json'), 'utf8'));
  assert.equal(meta.enqueue_enabled_at, sentinel);
  assert.equal(meta.keep, 1);
});

test('a corrupt outbox.meta.json is repaired on enqueue', () => {
  const t = isoCase();
  const sq = loadSq();
  fs.mkdirSync(t.dir, { recursive: true });
  fs.writeFileSync(path.join(t.dir, 'outbox.meta.json'), '{not json', { mode: 0o600 });
  assert.equal(sq.enqueue('record', makeRecord(1), { env: t.env }).status, 'enqueued');
  const meta = JSON.parse(fs.readFileSync(path.join(t.dir, 'outbox.meta.json'), 'utf8'));
  assert.match(meta.enqueue_enabled_at, /^\d{4}-\d{2}-\d{2}T/);
});

function plantEnqueuedLog(sq, dir, stamps) {
  fs.mkdirSync(dir, { recursive: true });
  const body = stamps.map((ts, i) => sq.makeLine({
    event: 'enqueued', id: `${i}`.padStart(64, 'a'), kind: 'record', payload_sha256: 'cd'.repeat(32), ts,
  })).join('');
  fs.writeFileSync(path.join(dir, 'outbox.jsonl'), body);
}

test('absent meta with existing enqueued events uses the earliest enqueued ts', () => {
  const t = isoCase();
  const sq = loadSq();
  const early = '2020-01-02T03:04:05.000Z';
  const late = '2024-05-06T07:08:09.000Z';
  plantEnqueuedLog(sq, t.dir, [late, early]);
  assert.equal(sq.enqueue('record', makeRecord(1), { env: t.env }).status, 'enqueued');
  const meta = JSON.parse(fs.readFileSync(path.join(t.dir, 'outbox.meta.json'), 'utf8'));
  assert.equal(meta.enqueue_enabled_at, early);
});

test('corrupt meta with existing enqueued events uses the earliest enqueued ts', () => {
  const t = isoCase();
  const sq = loadSq();
  const early = '2019-11-11T11:11:11.000Z';
  plantEnqueuedLog(sq, t.dir, ['2021-01-01T00:00:00.000Z', early]);
  fs.writeFileSync(path.join(t.dir, 'outbox.meta.json'), '{not json', { mode: 0o600 });
  assert.equal(sq.enqueue('record', makeRecord(2), { env: t.env }).status, 'enqueued');
  const meta = JSON.parse(fs.readFileSync(path.join(t.dir, 'outbox.meta.json'), 'utf8'));
  assert.equal(meta.enqueue_enabled_at, early);
});

test('fresh enqueue with no prior enqueued event stamps the current time', () => {
  const t = isoCase();
  const sq = loadSq();
  const before = Date.now();
  assert.equal(sq.enqueue('record', makeRecord(3), { env: t.env }).status, 'enqueued');
  const meta = JSON.parse(fs.readFileSync(path.join(t.dir, 'outbox.meta.json'), 'utf8'));
  const ms = Date.parse(meta.enqueue_enabled_at);
  assert.ok(ms >= before - 1000 && ms <= Date.now() + 1000);
});

test('enqueueScorecardRow returns ts_rejected instead of throwing on a bad timestamp', () => {
  const t = isoCase();
  const sq = loadSq();
  const cfg = path.join(t.home, 'on.json');
  fs.writeFileSync(cfg, JSON.stringify({ qualification_outbox: { enqueue: true } }));
  const rec = makeRecord(1);
  const row = { ...rec.seat, status: 'qualified', date: '2026-10-16', evidence: { observed_at: '2026-02-30T00:00:00Z' }, evidence_store: { producer: rec.producer, transcript_hash: rec.transcript_hash } };
  const r = sq.enqueueScorecardRow(row, { env: { ...t.env, AUTOPILOT_CONFIG_FILE: cfg } });
  assert.equal(r.status, 'ts_rejected');
  assert.equal(typeof r.message, 'string');
  assert.ok(!fs.existsSync(path.join(t.dir, 'outbox.jsonl')));
});

function rejectTransport(fields) {
  return {
    async findAck() { return { state: 'pending' }; },
    async send() { return { status: 'rejected', ...fields }; },
  };
}

test('flush counts an equal-hash SECONDARY_KEY_COLLISION as already_ingested', async () => {
  const t = isoCase();
  const sq = loadSq();
  const rec = makeRecord(1);
  sq.enqueue('record', rec, { env: t.env });
  const summary = await sq.flush({ transport: rejectTransport({ code: 'SECONDARY_KEY_COLLISION', message: 'exists', existing_transcript_hash: rec.transcript_hash }), env: t.env, warn() {} });
  assert.equal(summary.already_ingested, 1);
  assert.equal(summary.rejected, 0);
  const log = fs.readFileSync(path.join(t.dir, 'outbox.jsonl'), 'utf8');
  assert.match(log, /"event":"rejected"/);
  assert.match(log, new RegExp(rec.transcript_hash));
  assert.match(log, /existing_transcript_hash/);
});

test('flush counts a different-hash SECONDARY_KEY_COLLISION as rejected', async () => {
  const t = isoCase();
  const sq = loadSq();
  const rec = makeRecord(2);
  sq.enqueue('record', rec, { env: t.env });
  const summary = await sq.flush({ transport: rejectTransport({ code: 'SECONDARY_KEY_COLLISION', message: 'diff', existing_transcript_hash: 'b'.repeat(64) }), env: t.env, warn() {} });
  assert.equal(summary.rejected, 1);
  assert.equal(summary.already_ingested, 0);
});

test('equal SECONDARY_KEY_COLLISION hashes are already_ingested and absent from pending and rejected', async () => {
  const t = isoCase();
  const sq = loadSq();
  const rec = makeRecord(1);
  sq.enqueue('record', rec, { env: t.env });
  await sq.flush({ transport: rejectTransport({ code: 'SECONDARY_KEY_COLLISION', message: 'exists', existing_transcript_hash: rec.transcript_hash }), env: t.env, warn() {} });
  const st = sq.status({ env: t.env });
  assert.equal(st.already_ingested.length, 1);
  assert.equal(st.already_ingested[0].id, rec.record_id);
  assert.equal(st.already_ingested[0].kind, 'record');
  assert.equal(st.already_ingested[0].code, 'SECONDARY_KEY_COLLISION');
  assert.equal(st.already_ingested[0].transcript_hash, rec.transcript_hash);
  assert.equal(st.pending.length, 0);
  assert.equal(st.rejected.length, 0);
  const lines = sq.statusLines(st).join('\n');
  assert.match(lines, /1 already_ingested/);
  assert.match(lines, new RegExp(`already_ingested record ${rec.record_id.slice(0, 12)}`));
});

test('SECONDARY_KEY_COLLISION with different hashes stays rejected', async () => {
  const t = isoCase();
  const sq = loadSq();
  const rec = makeRecord(2);
  sq.enqueue('record', rec, { env: t.env });
  await sq.flush({ transport: rejectTransport({ code: 'SECONDARY_KEY_COLLISION', message: 'diff', existing_transcript_hash: 'b'.repeat(64) }), env: t.env, warn() {} });
  const st = sq.status({ env: t.env });
  assert.equal(st.rejected.length, 1);
  assert.equal(st.rejected[0].code, 'SECONDARY_KEY_COLLISION');
  assert.equal(st.already_ingested.length, 0);
  assert.equal(st.pending.length, 0);
});

test('SECONDARY_KEY_COLLISION with no hashes stays rejected', async () => {
  const t = isoCase();
  const sq = loadSq();
  const rec = makeRecord(3);
  sq.enqueue('record', rec, { env: t.env });
  await sq.flush({ transport: rejectTransport({ code: 'SECONDARY_KEY_COLLISION', message: 'no hash' }), env: t.env, warn() {} });
  const st = sq.status({ env: t.env });
  assert.equal(st.rejected.length, 1);
  assert.equal(st.already_ingested.length, 0);
  assert.equal(st.pending.length, 0);
});

test('another code with equal hashes stays rejected', async () => {
  const t = isoCase();
  const sq = loadSq();
  const rec = makeRecord(4);
  sq.enqueue('record', rec, { env: t.env });
  await sq.flush({ transport: rejectTransport({ code: 'SCHEMA', message: 'no', existing_transcript_hash: rec.transcript_hash }), env: t.env, warn() {} });
  const st = sq.status({ env: t.env });
  assert.equal(st.rejected.length, 1);
  assert.equal(st.rejected[0].code, 'SCHEMA');
  assert.equal(st.already_ingested.length, 0);
});

test('an old-format rejected event stays rejected', () => {
  const t = isoCase();
  const sq = loadSq();
  fs.mkdirSync(t.dir, { recursive: true });
  const id = 'c'.repeat(64);
  const line = sq.makeLine({ event: 'rejected', id, kind: 'record', payload_sha256: 'd'.repeat(64), code: 'SECONDARY_KEY_COLLISION', message: 'old' });
  fs.writeFileSync(path.join(t.dir, 'outbox.jsonl'), line);
  const parsed = sq.parseLine(line.trim());
  assert.ok(parsed.ok);
  assert.equal(parsed.ok.code, 'SECONDARY_KEY_COLLISION');
  const st = sq.status({ env: t.env });
  assert.equal(st.rejected.length, 1);
  assert.equal(st.rejected[0].id, id);
  assert.equal(st.already_ingested.length, 0);
});

// ── git transport against a local bare repo and a stub gh ──
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function registryFixture() {
  const root = tmp('git');
  const bare = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  fs.mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'master');
  fs.mkdirSync(path.join(seed, 'benchmarks', 'qualification', 'cookys'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'benchmarks', 'qualification', 'cookys', '.keep'), '');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'seed');
  git(root, 'clone', '-q', '--bare', seed, bare);
  const bot = path.join(root, 'bot');
  git(root, 'clone', '-q', bare, bot);
  const owner = path.join(root, 'owner');
  git(root, 'clone', '-q', bare, owner);
  // stub ingest with the real CLI contract: writes <root>/<ws>/<id>.json, prints a status line, exit 3 on reject
  const ingest = path.join(root, 'ingest-stub.js');
  fs.writeFileSync(ingest, `
const fs=require('fs'),path=require('path');const a=process.argv.slice(2);
const kind=a[a.indexOf('--kind')+1],ws=a[a.indexOf('--workspace')+1],root=a[a.indexOf('--root')+1],pf=a[a.length-1];
const p=JSON.parse(fs.readFileSync(pf,'utf8'));
if(p.reason==='REJECTME'){console.log(JSON.stringify({status:'rejected',code:'SCHEMA',message:'no'}));process.exit(3);}
const dir=path.join(root,ws);fs.mkdirSync(dir,{recursive:true});
const f=path.join(dir,p.record_id+'.json'),body=JSON.stringify(p,null,1)+'\\n';
if(fs.existsSync(f)&&fs.readFileSync(f,'utf8')===body){console.log(JSON.stringify({status:'noop',record_id:p.record_id}));process.exit(0);}
fs.writeFileSync(f,body);console.log(JSON.stringify({status:'created',record_id:p.record_id,path:f}));`);
  const ghLog = [];
  const prs = [];            // stateful stub: PRs that were really created
  const ghState = { failCreates: 0 };
  const gh = (args) => {
    ghLog.push(args);
    if (args[1] === 'list') return { status: 0, stdout: JSON.stringify(prs), stderr: '' };
    if (ghState.failCreates > 0) { ghState.failCreates -= 1; return { status: 1, stdout: '', stderr: 'HTTP 502' }; }
    prs.push({ number: prs.length + 1, state: 'OPEN' });
    return { status: 0, stdout: 'https://example.invalid/pr/1\n', stderr: '' };
  };
  let tick = 0;
  const pushes = [];
  const rawGit = (args) => {
    if (args[0] === 'push') pushes.push(args.slice());
    tick += 1;   // a different commit time per call: rebuilding the same branch gives a NEW sha, as in real life
    const stamp = `2026-01-01T00:00:${String(tick % 60).padStart(2, '0')}Z`;
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: bot, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } });
    return { status: r.status === null ? 1 : r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { root, bare, bot, owner, ingest, gh, ghLog, ghState, prs, pushes, rawGit };
}
function mkTransport(f, srcFile = SRC) {
  const sq = loadSq(srcFile);
  return sq.gitTransport({ repo: f.bot, git: f.rawGit, gh: f.gh, python: process.execPath, ingestScript: f.ingest, defaultBranch: 'master' });
}
function mergeBranch(f, branch, { ff = false } = {}) {
  git(f.owner, 'fetch', '-q', 'origin');
  git(f.owner, 'checkout', '-q', 'master');
  git(f.owner, 'pull', '-q', 'origin', 'master');
  git(f.owner, 'merge', '-q', ff ? '--ff-only' : '--no-ff', '-m', `Merge ${branch}`, `origin/${branch}`);
  git(f.owner, 'push', '-q', 'origin', 'master');
  return git(f.owner, 'rev-parse', 'HEAD');
}
const botBranch = (id) => `bot/qualification-${id.slice(0, 12)}`;

async function gitScenarioUnmerged(srcFile) {
  const f = registryFixture();
  const tr = mkTransport(f, srcFile);
  const rec = makeRecord(1);
  const item = { id: rec.record_id, kind: 'record', payload: rec };
  assert.equal((await tr.findAck(item)).state, 'pending');
  assert.equal((await tr.send(item)).status, 'sent');
  assert.ok(git(f.bot, 'ls-remote', 'origin', botBranch(item.id)).includes(botBranch(item.id)), 'bot branch pushed');
  return { f, tr, item, ack: await tr.findAck(item) };
}

test('git transport: push bot branch + PR is NOT an ack; the merge on master is, and the sha is the merge commit', async () => {
  const { f, tr, item, ack } = await gitScenarioUnmerged(SRC);
  assert.equal(ack.state, 'pending', 'unmerged bot branch must not be acked');
  assert.equal(f.ghLog.filter((a) => a[1] === 'create').length, 1, 'a PR was opened');
  const merge = mergeBranch(f, botBranch(item.id));
  const a2 = await tr.findAck(item);
  assert.deepEqual(a2, { state: 'acked', commit: merge });
  const pushesBefore = f.pushes.length;
  assert.equal((await tr.send(item)).status, 'sent', 're-entry on an existing identical bot branch');
  assert.equal(f.pushes.length, pushesBefore, 'and it pushes nothing');
});

test('git transport: master holding different bytes under the same name is a conflict, not an ack', async () => {
  const { f, tr, item } = await gitScenarioUnmerged(SRC);
  git(f.owner, 'pull', '-q', 'origin', 'master');
  const file = path.join(f.owner, 'benchmarks', 'qualification', 'cookys', `${item.id}.json`);
  fs.writeFileSync(file, '{"different":true}\n');
  git(f.owner, 'add', '-A'); git(f.owner, 'commit', '-q', '-m', 'other bytes'); git(f.owner, 'push', '-q', 'origin', 'master');
  assert.equal((await tr.findAck(item)).state, 'conflict');
});

test('git transport: permanent ingest rejection surfaces as rejected; adapter never pushes master/main', async () => {
  const f = registryFixture();
  const tr = mkTransport(f);
  const strike = { seat: { engine: 'e', runner: 'r', role: 'implementer' }, effort: null, reason: 'REJECTME', record_id: 'a'.repeat(64), administered_at: '2026-10-16T08:00:00Z' };
  const r = await tr.send({ id: 'b'.repeat(64), kind: 'strike', payload: strike });
  assert.equal(r.status, 'rejected'); assert.equal(r.code, 'SCHEMA');
  const rec = makeRecord(5);
  await tr.send({ id: rec.record_id, kind: 'record', payload: rec });
  assert.ok(f.pushes.length >= 1);
  for (const p of f.pushes) assert.match(p.join(' '), /^push origin HEAD:refs\/heads\/bot\/qualification-[0-9a-f]{12}$/);
});

test('flush end to end over the git transport: pending until merged, then acked + retired + compacted', async () => {
  const f = registryFixture();
  const tr = mkTransport(f);
  const sq = loadSq();
  const t = fresh();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  const rec = makeRecord(7);
  sq.enqueue('record', rec, { env });
  const a = await sq.flush({ transport: tr, env, warn() {} });
  assert.equal(a.sent, 1); assert.equal(a.retired, 0);
  const merge = mergeBranch(f, botBranch(rec.record_id));
  const b = await sq.flush({ transport: tr, env, warn() {} });
  assert.equal(b.retired, 1);
  assert.equal(sq.status({ env }).pending.length, 0);
  assert.equal(merge.length, 40);
});

// ── push guard ──
test('assertPushAllowed: only HEAD -> a bot branch', () => {
  const sq = loadSq();
  sq.assertPushAllowed('origin', ['push', 'origin', 'HEAD:refs/heads/bot/qualification-0123456789ab']);
  sq.assertPushAllowed('origin', ['fetch', 'origin']);
  for (const bad of [['push', 'origin', 'master'], ['push', 'origin', 'HEAD:refs/heads/master'], ['push', '--force', 'origin', 'HEAD:main'], ['push', 'origin', 'HEAD:refs/heads/bot/other']]) {
    assert.throws(() => sq.assertPushAllowed('origin', bad), /refusing push/);
  }
});

// ── negative controls: remove the rule from a copy of the module, the matching test must go red ──
function mutantPath(mutate, label) {
  let src = fs.readFileSync(SRC, 'utf8');
  src = src.replace(/require\('\.\/lib\//g, `require('${path.join(__dirname, 'lib')}/`).replace(/require\('\.\/lib\/qualification/g, "require('./lib/qualification");
  const out = mutate(src);
  assert.notEqual(out, src, `mutation ${label} did not change the source`);
  const f = path.join(tmp('mut'), `${label}.js`);
  fs.writeFileSync(f, out);
  return f;
}
async function mustGoRed(label, mutate, scenario) {
  await scenario(SRC);   // green on the real module
  const mutant = mutantPath(mutate, label);
  await assert.rejects(async () => scenario(mutant), undefined, `${label}: removing the rule must make the scenario fail`);
}

test('NEGATIVE CONTROL: acking the bot branch instead of master turns the unmerged scenario red', async () => {
  await mustGoRed('ack-bot-branch',
    (s) => s.replace('`${remote}/${def}:${file}`]);\n        if (s.status !== 0) return { state: \'pending\' };   // on a bot branch', '`${remote}/${BOT_PREFIX}${item.id.slice(0, 12)}:${file}`]);\n        if (s.status !== 0) return { state: \'pending\' };   // on a bot branch').replace('const c = firstAckCommit(def, file, (t) => t === ex.bytes);', "const c = 'bogus';"),
    async (src) => { const { ack } = await gitScenarioUnmerged(src); assert.equal(ack.state, 'pending'); });
});

test('NEGATIVE CONTROL: dropping the push guard lets a master push through', async () => {
  await mustGoRed('no-push-guard', (s) => s.replace("if (rest[0] === 'push' && !(", "if (false && !("),
    async (src) => { const sq = loadSq(src); assert.throws(() => sq.assertPushAllowed('origin', ['push', 'origin', 'master']), /refusing push/); });
});

test('NEGATIVE CONTROL: crc check removed -> tampered line accepted', async () => {
  await mustGoRed('no-crc', (s) => s.replace("if (crc !== crc32(q.canonicalJson(body))) return { bad: 'line_crc mismatch' };", ''),
    async (src) => { const sq = loadSq(src); const l = sq.makeLine({ event: 'enqueued', id: 'x', kind: 'record', ts: 't' }).replace('"ts":"t"', '"ts":"u"'); assert.ok(sq.parseLine(l).bad); });
});

test('NEGATIVE CONTROL: duplicate enqueue guard removed -> second enqueue appends again', async () => {
  await mustGoRed('no-dedupe', (s) => s.replace("if (fold(events).has(id)) return { status: 'duplicate', id };", ''),
    async (src) => { const sq = loadSq(src); const t = fresh(); const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
      sq.enqueue('record', makeRecord(1), { env }); assert.equal(sq.enqueue('record', makeRecord(1), { env }).status, 'duplicate'); });
});

test('NEGATIVE CONTROL: forgetting `sent` -> resend on every flush', async () => {
  await mustGoRed('resend', (s) => s.replace('if (a.state !== \'acked\' && !s.sent) {', "if (a.state !== 'acked') {"),
    async (src) => { const sq = loadSq(src); const t = fresh(); const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
      sq.enqueue('record', makeRecord(1), { env }); const tr = fakeTransport({ ackAfterPolls: 99 });
      await sq.flush({ transport: tr, env, warn() {} }); await sq.flush({ transport: tr, env, warn() {} }); assert.equal(tr.calls.send, 1); });
});

test('NEGATIVE CONTROL: rejected ids resent when the skip is removed', async () => {
  await mustGoRed('resend-rejected', (s) => s.replace('if (s.retired || s.rejected || !s.enqueued) continue;', 'if (s.retired || !s.enqueued) continue;'),
    async (src) => { const sq = loadSq(src); const t = fresh(); const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
      sq.enqueue('record', makeRecord(1), { env }); const tr = fakeTransport({ rejectWith: { code: 'X', message: 'm' } });
      await sq.flush({ transport: tr, env, warn() {} }); await sq.flush({ transport: tr, env, warn() {} }); assert.equal(tr.calls.send, 1); });
});

test('NEGATIVE CONTROL: quarantine removed -> torn tail stays in the log', async () => {
  await mustGoRed('no-quarantine', (s) => s.replace('if (bad.length) { quarantine(p, bad, events, warn); out.quarantined = bad.length; }', ''),
    async (src) => { const sq = loadSq(src); const t = fresh(); const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
      sq.enqueue('record', makeRecord(1), { env }); fs.appendFileSync(path.join(t.dir, 'outbox.jsonl'), '{"event":"enq');
      const r = await sq.flush({ transport: fakeTransport(), env, warn() {} }); assert.equal(r.quarantined, 1); });
});

// ── re-entry (review fix): the bot branch may already exist on the remote ──
async function reentryScenario(srcFile) {
  const f = registryFixture();
  const tr = mkTransport(f, srcFile);
  const rec = makeRecord(1);
  const item = { id: rec.record_id, kind: 'record', payload: rec };
  assert.equal((await tr.send(item)).status, 'sent');   // pushed; imagine the process died before `sent` was written
  const r2 = await tr.send(item);                        // resume: send again
  assert.equal(r2.status, 'sent');
  return { f, tr, item };
}

test('re-entry after a crash following the push: no second push, no second PR, then acked after the merge', async () => {
  const { f, tr, item } = await reentryScenario(SRC);
  assert.equal(f.pushes.length, 1, 'exactly one push');
  assert.equal(f.ghLog.filter((a) => a[1] === 'create').length, 1, 'exactly one PR');
  const merge = mergeBranch(f, botBranch(item.id));
  assert.deepEqual(await tr.findAck(item), { state: 'acked', commit: merge });
});

test('re-entry when gh pr create failed the first time: one PR in the end, one push', async () => {
  const f = registryFixture();
  const tr = mkTransport(f);
  f.ghState.failCreates = 1;
  const rec = makeRecord(2);
  const item = { id: rec.record_id, kind: 'record', payload: rec };
  await assert.rejects(tr.send(item), /gh pr create failed/);
  assert.equal((await tr.send(item)).status, 'sent');
  assert.equal(f.pushes.length, 1);
  assert.equal(f.prs.length, 1);
});

test('re-entry: a merged PR is reused, a closed-only one is not', async () => {
  const f = registryFixture();
  const tr = mkTransport(f);
  const rec = makeRecord(3);
  const item = { id: rec.record_id, kind: 'record', payload: rec };
  await tr.send(item);
  f.prs[0].state = 'MERGED';
  await tr.send(item);
  assert.equal(f.prs.length, 1, 'merged PR reused');
  f.prs[0].state = 'CLOSED';
  await tr.send(item);
  assert.equal(f.prs.length, 2, 'a closed-unmerged PR does not count; a new one opens');
});

test('re-entry: remote bot branch with different content is a conflict, never force-pushed', async () => {
  const f = registryFixture();
  const tr = mkTransport(f);
  const rec = makeRecord(4);
  const item = { id: rec.record_id, kind: 'record', payload: rec };
  git(f.owner, 'checkout', '-q', '-b', botBranch(item.id));
  fs.writeFileSync(path.join(f.owner, 'benchmarks', 'qualification', 'cookys', `${item.id}.json`), '{"other":1}\n');
  git(f.owner, 'add', '-A'); git(f.owner, 'commit', '-q', '-m', 'someone else'); git(f.owner, 'push', '-q', 'origin', botBranch(item.id));
  const r = await tr.send(item);
  assert.equal(r.status, 'rejected'); assert.equal(r.code, 'BOT_BRANCH_CONFLICT');
  assert.equal(f.pushes.length, 0);
});

test('NEGATIVE CONTROL: rebuilding the bot branch on every send makes the re-entry scenario red (non-fast-forward)', async () => {
  await mustGoRed('rebuild-each-time', (s) => s.replace("if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${bot}`]).status === 0) {", 'if (false) {'),
    async (src) => { await reentryScenario(src); });
});

test('dirty dedicated clone on a bot branch self-heals; dirty on another branch is refused', async () => {
  const f = registryFixture();
  const tr = mkTransport(f);
  const a = makeRecord(1); const b = makeRecord(2);
  await tr.send({ id: a.record_id, kind: 'record', payload: a });   // leaves HEAD on a bot branch
  fs.writeFileSync(path.join(f.bot, 'stray.txt'), 'x');
  fs.appendFileSync(path.join(f.bot, 'benchmarks', 'qualification', 'cookys', '.keep'), 'dirt');
  assert.equal((await tr.send({ id: b.record_id, kind: 'record', payload: b })).status, 'sent');
  assert.ok(!fs.existsSync(path.join(f.bot, 'stray.txt')));
  git(f.bot, 'checkout', '-q', 'master');
  fs.writeFileSync(path.join(f.bot, 'mine.txt'), 'x');
  const c = makeRecord(3);
  const r = await tr.send({ id: c.record_id, kind: 'record', payload: c });
  assert.equal(r.status, 'error'); assert.match(r.message, /refusing to touch/);
  assert.ok(fs.existsSync(path.join(f.bot, 'mine.txt')), 'foreign work is left alone');
});

test('default branch is never guessed: refs/remotes/origin/HEAD unset -> failure', async () => {
  const f = registryFixture();
  git(f.bot, 'config', 'remote.origin.followRemoteHEAD', 'never');   // newer git re-creates origin/HEAD on fetch
  git(f.bot, 'remote', 'set-head', 'origin', '-d');
  const sq = loadSq();
  const tr = sq.gitTransport({ repo: f.bot, git: f.rawGit, gh: f.gh, python: process.execPath, ingestScript: f.ingest });
  const rec = makeRecord(1);
  await assert.rejects(tr.findAck({ id: rec.record_id, kind: 'record', payload: rec }), /not guessing the default branch/);
});

test('backoff skips the send but still polls the ack, so a just-merged PR is acked at once', async () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  sq.enqueue('record', makeRecord(1), { env });
  const t0 = Date.now();
  await sq.flush({ transport: { async findAck() { throw new Error('down'); }, async send() { throw new Error('x'); } }, env, nowMs: t0, warn() {} });
  const tr = { calls: 0, async findAck() { return { state: 'acked', commit: 'm' }; }, async send() { this.calls += 1; return { status: 'sent' }; } };
  const r = await sq.flush({ transport: tr, env, nowMs: t0 + 1000, warn() {} });
  assert.equal(r.retired, 1); assert.equal(tr.calls, 0);
  // and a failing poll during backoff does not pile up failure events
  sq.enqueue('record', makeRecord(2), { env });
  await sq.flush({ transport: { async findAck() { throw new Error('down'); }, async send() { throw new Error('x'); } }, env, nowMs: t0, warn() {} });
  await sq.flush({ transport: { async findAck() { throw new Error('down'); }, async send() { throw new Error('x'); } }, env, nowMs: t0 + 1000, warn() {} });
  assert.equal(sq.status({ env }).pending[0].failures, 1);
});

test('NEGATIVE CONTROL: skipping the whole id during backoff delays the ack', async () => {
  const scenario = async (src) => {
    const sq = loadSq(src); const t = fresh(); const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
    sq.enqueue('record', makeRecord(1), { env });
    const t0 = Date.now();
    await sq.flush({ transport: { async findAck() { throw new Error('down'); }, async send() { throw new Error('x'); } }, env, nowMs: t0, warn() {} });
    const r = await sq.flush({ transport: { async findAck() { return { state: 'acked', commit: 'm' }; }, async send() { return { status: 'sent' }; } }, env, nowMs: t0 + 1000, warn() {} });
    assert.equal(r.retired, 1);
  };
  await mustGoRed('skip-in-backoff', (s) => s.replace('if (a.state !== \'acked\' && inBackoff) { out.backoff_skipped += 1; continue; }', 'if (inBackoff) { out.backoff_skipped += 1; continue; }'), scenario);
});

test('assertPushAllowed sees through leading -c / -C pairs', () => {
  const sq = loadSq();
  sq.assertPushAllowed('origin', ['-c', 'user.name=t', 'push', 'origin', 'HEAD:refs/heads/bot/qualification-0123456789ab']);
  assert.throws(() => sq.assertPushAllowed('origin', ['-c', 'user.name=t', 'push', 'origin', 'master']), /refusing push/);
  assert.throws(() => sq.assertPushAllowed('origin', ['-C', '/x', '-c', 'a=b', 'push', 'origin', 'HEAD:main']), /refusing push/);
});

test('flush removes .outbox.meta.json.tmp crash leftovers and leaves the real meta file', async () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  sq.enqueue('record', makeRecord(1), { env });
  const metaPath = path.join(t.dir, 'outbox.meta.json');
  const before = fs.readFileSync(metaPath, 'utf8');
  const tmpName = sq.metaTmpBasename(4242);
  fs.writeFileSync(path.join(t.dir, tmpName), '{"enqueue_enabled_at":"1999-01-01T00:00:00.000Z"}');
  const r = await sq.flush({
    transport: { async findAck() { return { state: 'pending' }; }, async send() { return { status: 'sent' }; } },
    env, warn() {},
  });
  assert.equal(r.orphans_removed, 1);
  assert.ok(!fs.existsSync(path.join(t.dir, tmpName)));
  assert.equal(fs.readFileSync(metaPath, 'utf8'), before);
  assert.ok(fs.existsSync(path.join(t.dir, 'outbox.jsonl')));
});

test('orphan payload files and stray temp files are removed by flush; live payloads stay', async () => {
  const t = fresh();
  const sq = loadSq();
  const env = { AUTOPILOT_OUTBOX_DIR: t.dir };
  const big = makeRecord(3); big.raw = { blob: 'x'.repeat(20000) };
  big.record_id = q.recordIdV1(big.producer, big.transcript_hash, big.seat, big.seat.corpus_version, big.administered_at);
  sq.enqueue('record', big, { env });
  const d = path.join(t.dir, 'outbox.d');
  fs.writeFileSync(path.join(d, `${'ab'.repeat(32)}.json`), '{}');
  fs.writeFileSync(path.join(d, `.${'cd'.repeat(32)}.tmp.99`), '{}');
  const r = await sq.flush({ transport: { async findAck() { return { state: 'pending' }; }, async send() { return { status: 'sent' }; } }, env, warn() {} });
  assert.equal(r.orphans_removed, 2);
  assert.deepEqual(fs.readdirSync(d), [`${big.record_id}.json`]);
});

async function transcriptHashFor(message, records) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qsq-hash-'));
  const dir = path.join(repo, 'benchmarks', 'qualification', 'cookys');
  fs.mkdirSync(dir, { recursive: true });
  records.forEach((rec, i) => fs.writeFileSync(path.join(dir, `r${i}.json`), JSON.stringify(rec)));
  const sq = loadSq();
  const tr = sq.gitTransport({
    repo,
    defaultBranch: 'master',
    openPr: false,
    git: () => ({ status: 0, stdout: 'x\n', stderr: '' }),
    gh: () => ({ status: 0, stdout: '[]', stderr: '' }),
    ingest: () => ({ status: 3, stdout: `${JSON.stringify({ code: 'SECONDARY_KEY_COLLISION', message })}\n`, stderr: '' }),
  });
  const sent = await tr.send({ id: 'f'.repeat(64), kind: 'record', payload: { record_id: 'f'.repeat(64) } });
  return sent.existing_transcript_hash;
}

test('existingTranscriptHash matches a plain 12-hex message', async () => {
  const id = `${'abc123def456'}${'a'.repeat(52)}`;
  const hash = '11'.repeat(32);
  const got = await transcriptHashFor(`prior record ${id.slice(0, 12)} already ingested`, [
    { record_id: id, transcript_hash: hash },
  ]);
  assert.equal(got, hash);
});

test('existingTranscriptHash matches a v1:-prefixed message', async () => {
  const body = `${'b'.repeat(64)}`;
  const hash = '22'.repeat(32);
  const got = await transcriptHashFor(`collision on V1:${body}`, [
    { record_id: `v1:${body}`, transcript_hash: hash },
  ]);
  assert.equal(got, hash);
});

test('existingTranscriptHash matches a v2:-prefixed message', async () => {
  const body = `${'c'.repeat(64)}`;
  const hash = '33'.repeat(32);
  const got = await transcriptHashFor(`see v2:${body.slice(0, 12)}`, [
    { record_id: `v2:${body}`, transcript_hash: hash },
  ]);
  assert.equal(got, hash);
});

test('existingTranscriptHash matches nothing when the message has no id', async () => {
  const got = await transcriptHashFor('no identifier in this rejection', [
    { record_id: 'd'.repeat(64), transcript_hash: '44'.repeat(32) },
  ]);
  assert.equal(got, undefined);
});

for (const n of [12, 13, 40, 63, 64]) {
  test(`existingTranscriptHash prefix-matches a ${n}-hex candidate body`, async () => {
    const full = 'ab'.repeat(32);
    const hash = '55'.repeat(32);
    const cand = full.slice(0, n);
    const got = await transcriptHashFor(`collision ${cand} seen`, [
      { record_id: full, transcript_hash: hash },
    ]);
    assert.equal(got, hash);
  });
}

test('existingTranscriptHash prefix-matches a v2: 40-hex candidate', async () => {
  const body = 'cd'.repeat(32);
  const hash = '66'.repeat(32);
  const got = await transcriptHashFor(`collision v2:${body.slice(0, 40)}`, [
    { record_id: `v2:${body}`, transcript_hash: hash },
  ]);
  assert.equal(got, hash);
});

test('existingTranscriptHash finds nothing for a 13-hex candidate that is not a prefix', async () => {
  const got = await transcriptHashFor('collision 0123456789abc seen', [
    { record_id: 'ff'.repeat(32), transcript_hash: '77'.repeat(32) },
  ]);
  assert.equal(got, undefined);
});

test('workspace comes from qualification_outbox.workspace (default cookys)', () => {
  const sq = loadSq();
  const d = tmp('cfg');
  fs.writeFileSync(path.join(d, 'c.json'), JSON.stringify({ qualification_outbox: { workspace: 'team-a' } }));
  assert.equal(sq.readOutboxConfig({ AUTOPILOT_CONFIG_FILE: path.join(d, 'c.json') }).workspace, 'team-a');
  assert.equal(sq.readOutboxConfig({ AUTOPILOT_CONFIG_FILE: path.join(d, 'none.json') }).workspace, 'cookys');
});
