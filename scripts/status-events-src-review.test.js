'use strict';
// scripts/status-events-src-review.test.js - E2 reader of review ledgers (src/status/events/sources/review.js).
// Cases: source-review-*, degrade-review-*. Isolation: tempdirs only; the fixture env is an explicit allowlist and every
// repo (including the one a collect would write a pointer file into) lives in a tempdir.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildFixture, goldenEvents, sha256hex, FOREIGN_BASE } = require('./lib/events-fixture');
const review = require('../src/status/events/sources/review');

const cleanup = [];
test.after(() => { for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true }); });
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-events-review-'));
  cleanup.push(dir);
  return buildFixture({ dir });
}
const ctxOf = (fx, extra = {}) => ({
  project: { project_key: fx.projectKey, repo_identity: fx.identity, repo_name: fx.repoName, root: fx.repoDir, common_dir: fx.identity.slice('git-common-dir:'.length) },
  env: fx.env, home: fx.env.HOME, now: Date.parse('2026-11-02T08:00:00.000Z'),
  reviewLedgers: [fx.paths.reviewLedgers.foreign], ...extra,
});
const NO_WINDOW = { sinceTs: null, slackMs: 300000, hints: {} };
const reviewEvents = (fx) => goldenEvents(fx).filter((e) => e.kind.startsWith('review.'));
const warningCodes = (result) => result.warnings.map((w) => w.code).sort();
const base12 = (sha) => sha256hex(sha).slice(0, 12);

test('source-review: exactly the fixture review events with golden ids; the foreign ledger is filtered', () => {
  const fx = fresh();
  const result = review.read(ctxOf(fx), NO_WINDOW);
  assert.deepEqual(result.events, reviewEvents(fx));
  assert.equal(result.stats.state, 'ok');
  assert.equal(result.stats.rows_filtered, 1, 'the foreign-base entry is counted, not emitted');
  assert.deepEqual(result.warnings, []);
  assert.ok(!result.events.some((e) => e.data.base === FOREIGN_BASE));
});

test('source-review-project-filter: dropping the --review-ledger root drops nothing else, a foreign root leaks nothing', () => {
  const fx = fresh();
  const without = review.read(ctxOf(fx, { reviewLedgers: [] }), NO_WINDOW);
  assert.deepEqual(without.events, reviewEvents(fx));
  assert.equal(without.stats.rows_filtered, 0);
});

test('source-review-two-ledgers-one-phase: phase E1 of two ledgers with different bases keeps both histories', () => {
  const fx = fresh();
  const result = review.read(ctxOf(fx), NO_WINDOW);
  const collected = result.events.filter((e) => e.kind === 'review.collected' && e.data.phase === 'E1');
  assert.equal(collected.length, 2);
  assert.notEqual(collected[0].id, collected[1].id);
  const ids = collected.map((e) => e.id).sort();
  assert.deepEqual(ids, [
    `review.collected:${base12(fx.commits.c1)}:E1:g1`, `review.collected:${base12(fx.commits.c2)}:E1:g1`,
  ].sort());
  assert.equal(result.events.filter((e) => e.kind === 'review.finalized').length, 1);
});

test('source-review-mtime: an entry without collected_at / finalized_at takes the file mtime and says so', () => {
  const fx = fresh();
  const ledger = fx.paths.reviewLedgers.b;
  const chainFile = path.join(ledger, 'review-E1', 'chain.json');
  const chain = JSON.parse(fs.readFileSync(chainFile, 'utf8'));
  delete chain[0].collected_at;
  delete chain[0].finalized_at;
  fs.writeFileSync(chainFile, JSON.stringify(chain));
  const findings = path.join(ledger, 'review-E1', 'g1', 'findings.json');
  const dispositions = path.join(ledger, 'review-E1', 'g1', 'dispositions.json');
  fs.utimesSync(findings, new Date('2026-11-01T09:11:00.123Z'), new Date('2026-11-01T09:11:00.123Z'));
  fs.utimesSync(dispositions, new Date('2026-11-01T09:21:00.456Z'), new Date('2026-11-01T09:21:00.456Z'));
  const result = review.read(ctxOf(fx), NO_WINDOW);
  const key = `${base12(fx.commits.c2)}:E1:g1`;
  const collected = result.events.find((e) => e.id === `review.collected:${key}`);
  const finalized = result.events.find((e) => e.id === `review.finalized:${key}`);
  assert.equal(collected.ts, '2026-11-01T09:11:00.123Z');
  assert.equal(collected.ts_basis, 'mtime');
  assert.equal(finalized.ts, '2026-11-01T09:21:00.456Z');
  assert.equal(finalized.ts_basis, 'mtime');
  assert.equal(result.events.find((e) => e.data.phase === 'E2').ts_basis, 'source');
});

test('source-review-window: findings.json is read only for entries inside the window', () => {
  const fx = fresh();
  // window from 09:25 with 5 min slack -> floor 09:20: phase E2 (09:30) and the finalized event of b (09:20) remain
  const window = { sinceTs: Date.parse('2026-11-01T09:25:00.000Z'), slackMs: 300000, hints: {} };
  for (const name of ['a', 'b']) fs.chmodSync(path.join(fx.paths.reviewLedgers[name], 'review-E1', 'g1', 'findings.json'), 0o000);
  const result = review.read(ctxOf(fx), window);
  assert.deepEqual(result.events.map((e) => e.id), reviewEvents(fx).filter((e) => e.ts >= '2026-11-01T09:20:00.000Z').map((e) => e.id));
  assert.deepEqual(result.warnings, [], 'unreadable findings.json of out-of-window entries was never touched');
});

test('source-review-one-git: a poll spawns exactly one git process for the base filter', () => {
  const fx = fresh();
  const shimDir = path.join(fx.dir, 'shim');
  fs.mkdirSync(shimDir);
  const log = path.join(fx.dir, 'git-calls.log');
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8', env: fx.env }).stdout.trim();
  fs.writeFileSync(path.join(shimDir, 'git'), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  const env = { ...fx.env, PATH: `${shimDir}:${fx.env.PATH}` };
  const result = review.read(ctxOf(fx, { env }), NO_WINDOW);
  assert.equal(result.events.length, reviewEvents(fx).length);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /cat-file --batch-check/);
});

test('source-review-archive: an archive copy of a live ledger collapses by id; another repo\'s archive is filtered', () => {
  const fx = fresh();
  const archive = path.join(fx.dir, 'archive');
  const copyInto = (src, id, identity) => {
    const dest = path.join(archive, 'bucket-12345678', '2026-11', id);
    fs.cpSync(src, dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'archive.json'), JSON.stringify({ repo_identity: identity }));
    return dest;
  };
  copyInto(fx.paths.reviewLedgers.a, 'l-a', fx.identity);
  copyInto(fx.paths.reviewLedgers.b, 'l-b', fx.foreignIdentity);
  fs.mkdirSync(path.join(archive, 'bucket-12345678', '.ledger-id.lock'));
  const env = { ...fx.env, AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR: archive };
  const result = review.read(ctxOf(fx, { env }), NO_WINDOW);
  assert.deepEqual(result.events, reviewEvents(fx));
  assert.equal(result.stats.rows_filtered, 2, 'foreign entry + the other repo\'s archive ledger');
});

test('source-review-archive-only: with the live ledgers gone the archive copy still yields the history', () => {
  const fx = fresh();
  const archive = path.join(fx.dir, 'archive');
  const dest = path.join(archive, 'b', '2026-11', 'l-a');
  fs.cpSync(fx.paths.reviewLedgers.a, dest, { recursive: true });
  fs.rmSync(fx.paths.reviewPointer);
  const env = { ...fx.env, AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR: archive };
  const result = review.read(ctxOf(fx, { env, reviewLedgers: [] }), NO_WINDOW);
  assert.deepEqual(result.events.map((e) => e.id), reviewEvents(fx).filter((e) => e.data.phase_base12 === base12(fx.commits.c1)).map((e) => e.id));
});

test('degrade-review-absent: a pointer root that was removed is silent; a configured root that is absent is one source_absent', () => {
  const fx = fresh();
  fs.rmSync(fx.paths.reviewLedgers.a, { recursive: true });
  const silent = review.read(ctxOf(fx, { reviewLedgers: [] }), NO_WINDOW);
  assert.deepEqual(silent.warnings, []);
  assert.equal(silent.stats.state, 'ok');
  assert.equal(silent.stats.rows_filtered, 1);
  const loud = review.read(ctxOf(fx, { reviewLedgers: [path.join(fx.dir, 'nope'), path.join(fx.dir, 'nope2')] }), NO_WINDOW);
  assert.deepEqual(loud.warnings, [{ source: 'review', code: 'source_absent', detail: 'review-ledger', count: 2 }]);
});

test('degrade-review-nothing: no pointer file, no roots, an empty existing ledger: no events, no warning', () => {
  const fx = fresh();
  fs.rmSync(fx.paths.reviewPointer);
  const empty = path.join(fx.dir, 'empty-ledger');
  fs.mkdirSync(empty);
  const result = review.read(ctxOf(fx, { reviewLedgers: [empty] }), NO_WINDOW);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.stats.state, 'ok');
});

test('degrade-review-wrong-schema: chain.json that is not an array, and one that is not JSON', () => {
  const fx = fresh();
  fs.writeFileSync(path.join(fx.paths.reviewLedgers.a, 'review-E1', 'chain.json'), '{"generation":1}');
  fs.writeFileSync(path.join(fx.paths.reviewLedgers.b, 'review-E1', 'chain.json'), '[{"generation":1,');
  const result = review.read(ctxOf(fx), NO_WINDOW);
  assert.deepEqual(warningCodes(result), ['line_unparseable', 'schema_mismatch']);
  assert.equal(result.stats.state, 'degraded');
  assert.deepEqual(result.events.map((e) => e.data.phase), ['E2']);
});

test('degrade-review-entries: an entry without an integer generation, an aborted one and one with a bad stamp are skipped', () => {
  const fx = fresh();
  const chainFile = path.join(fx.paths.reviewLedgers.c, 'review-E2', 'chain.json');
  const [good] = JSON.parse(fs.readFileSync(chainFile, 'utf8'));
  fs.writeFileSync(chainFile, JSON.stringify([
    good, { generation: 'x', base: good.base }, { generation: 2, base: good.base, status: 'aborted' },
    { ...good, generation: 3, collected_at: '2026-02-30T00:00:00Z' },
  ]));
  const result = review.read(ctxOf(fx), NO_WINDOW);
  assert.equal(result.events.filter((e) => e.data.phase === 'E2').length, 1);
  assert.deepEqual(warningCodes(result), ['ts_invalid']);
});

test('degrade-review-mode000: an unreadable chain.json and an unreadable findings.json degrade, never throw', { skip: process.getuid && process.getuid() === 0 }, () => {
  const fx = fresh();
  fs.chmodSync(path.join(fx.paths.reviewLedgers.a, 'review-E1', 'chain.json'), 0o000);
  fs.chmodSync(path.join(fx.paths.reviewLedgers.b, 'review-E1', 'g1', 'findings.json'), 0o000);
  const result = review.read(ctxOf(fx), NO_WINDOW);
  assert.ok(warningCodes(result).includes('file_unreadable'));
  const b = result.events.find((e) => e.id === `review.collected:${base12(fx.commits.c2)}:E1:g1`);
  assert.ok(b && b.data.findings_total === undefined, 'the event survives without findings counts');
});

test('degrade-review-huge: a 10 MB chain.json is refused as unparseable, not buffered', () => {
  const fx = fresh();
  fs.writeFileSync(path.join(fx.paths.reviewLedgers.a, 'review-E1', 'chain.json'), `[${' '.repeat(10 * 1024 * 1024)}]`);
  const result = review.read(ctxOf(fx), NO_WINDOW);
  assert.ok(warningCodes(result).includes('line_unparseable'));
});

test('degrade-review-git: git missing from PATH degrades the source and emits nothing (fail closed)', () => {
  const fx = fresh();
  const env = { ...fx.env, PATH: path.join(fx.dir, 'no-such-bin') };
  const result = review.read(ctxOf(fx, { env }), NO_WINDOW);
  assert.deepEqual(result.events, []);
  assert.deepEqual(warningCodes(result), ['git_unavailable']);
  assert.equal(result.stats.state, 'degraded');
});

test('degrade-review-garbage-ctx: a context without a project never throws', () => {
  assert.doesNotThrow(() => review.read({}, null));
  assert.doesNotThrow(() => review.read(undefined, undefined));
  assert.equal(review.read({ project: {}, env: {} }, {}).stats.state, 'degraded');
});

test('degrade-review-configured-wins: a gone ledger named by the pointer AND by --review-ledger / env still raises source_absent', () => {
  const fx = fresh();
  const gone = path.join(fx.dir, 'gone-ledger');
  fs.appendFileSync(fx.paths.reviewPointer, `${gone}\n`);
  const viaCtx = review.read(ctxOf(fx, { reviewLedgers: [gone] }), NO_WINDOW);
  assert.deepEqual(viaCtx.warnings, [{ source: 'review', code: 'source_absent', detail: 'review-ledger', count: 1 }]);
  const viaEnv = review.read(ctxOf(fx, { reviewLedgers: [], env: { ...fx.env, AUTOPILOT_EVENTS_REVIEW_LEDGERS: gone } }), NO_WINDOW);
  assert.deepEqual(viaEnv.warnings, [{ source: 'review', code: 'source_absent', detail: 'review-ledger', count: 1 }]);
  const pointerOnly = review.read(ctxOf(fx, { reviewLedgers: [] }), NO_WINDOW);
  assert.deepEqual(pointerOnly.warnings, [], 'negative control: pointer alone stays silent');
});
