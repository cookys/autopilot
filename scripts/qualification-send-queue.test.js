'use strict';
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

test('workspace comes from qualification_outbox.workspace (default cookys)', () => {
  const sq = loadSq();
  const d = tmp('cfg');
  fs.writeFileSync(path.join(d, 'c.json'), JSON.stringify({ qualification_outbox: { workspace: 'team-a' } }));
  assert.equal(sq.readOutboxConfig({ AUTOPILOT_CONFIG_FILE: path.join(d, 'c.json') }).workspace, 'team-a');
  assert.equal(sq.readOutboxConfig({ AUTOPILOT_CONFIG_FILE: path.join(d, 'none.json') }).workspace, 'cookys');
});
