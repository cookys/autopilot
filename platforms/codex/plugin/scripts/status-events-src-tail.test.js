'use strict';
require('./lib/test-git-env'); // drop ambient GIT_DIR & co so fixture git cannot write into the launching repo
// scripts/status-events-src-tail.test.js - E2 lane "tail": jsonl-tail.js plus the readers cost, decision and runledger of the events
// feed (autopilot.events/1). Plan: project/plans/2026-11-02-oc-a1-events-contract.md, E2 steps 1, 2, 6, 7.
// Lane file (plan deviation, approved): the three E2 lanes would otherwise all edit scripts/status-events.test.js.
// Isolation: every dir is an os.tmpdir() mkdtemp dir; the fixture env is an explicit allowlist (events-fixture.js); the readers get
// ctx.env everywhere; nothing touches the real ~/.claude, ~/.autopilot, live dir or dispatch dir.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixtureLib = require('./lib/events-fixture');
const { readLines, headHashOf, HINT_MIN_BYTES } = require('../src/status/events/jsonl-tail');
const cost = require('../src/status/events/sources/cost');
const decision = require('../src/status/events/sources/decision');
const runledger = require('../src/status/events/sources/runledger');
const { buildFixture, goldenEvents, sha256hex } = fixtureLib;

const cleanup = [];
test.after(() => { for (const dir of cleanup) { try { fs.chmodSync(dir, 0o700); } catch (_e) { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); } });
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-events-tail-'));
  cleanup.push(dir);
  return dir;
}
const fresh = () => buildFixture({ dir: tmp() });
const ctxOf = (fx) => ({
  project: { project_key: fx.projectKey, repo_identity: fx.identity, repo_name: fx.repoName, root: fx.repoDir, common_dir: fx.identity.slice('git-common-dir:'.length) },
  env: fx.env, home: fx.env.HOME, now: Date.parse('2026-11-02T08:00:00.000Z'),
});
const byTsId = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const goldenOf = (fx, kind) => goldenEvents(fx).filter((e) => e.kind === kind);
const sorted = (events) => [...events].sort(byTsId);
const codes = (result) => result.warnings.map((w) => `${w.code}:${w.count}`).sort();
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const lines = (...rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

// ---- jsonl-tail -------------------------------------------------------------------------------------------------------

test('source-jsonl-tail-splits-lines-and-keeps-byte-offsets', () => {
  const file = path.join(tmp(), 'a.jsonl');
  write(file, '{"a":1}\n\n{"b":2}\n{"c":');
  const res = readLines(file, { parse: true });
  assert.equal(res.state, 'ok');
  assert.deepEqual(res.lines.map((l) => [l.raw, l.offset, l.end]), [['{"a":1}', 0, 8], ['{"b":2}', 9, 17]]);
  assert.equal(res.endOffset, 17, 'the partial last line is not consumed');
  assert.deepEqual(res.warnings, []);
});

test('source-jsonl-tail-hints-need-size-head-and-offset', () => {
  const dir = tmp();
  const file = path.join(dir, 'big.jsonl');
  const rows = [];
  for (let i = 0; i < 600; i += 1) rows.push(JSON.stringify({ i, pad: 'x'.repeat(100) }));
  write(file, lines(...rows));
  const whole = readLines(file, { parse: true });
  assert.ok(whole.size >= HINT_MIN_BYTES);
  assert.equal(whole.lines.length, 600);
  const at = whole.lines[500];
  // explicit hint with a matching head
  const hinted = readLines(file, { parse: true, fromOffset: at.offset, headHash: whole.head });
  assert.equal(hinted.lines.length, 100);
  assert.equal(hinted.hinted, true);
  // keyed hint (found by head)
  const keyed = readLines(file, { parse: true, hints: { [`cost:${whole.head}`]: at.offset }, hintPrefix: 'cost' });
  assert.equal(keyed.lines.length, 100);
  // wrong head -> full re-read + cursor_hint_stale
  const stale = readLines(file, { parse: true, fromOffset: at.offset, headHash: 'deadbeef0000' });
  assert.equal(stale.lines.length, 600);
  assert.deepEqual(stale.warnings.map((w) => w.code), ['cursor_hint_stale']);
  // offset past EOF -> full re-read + cursor_hint_stale
  const beyond = readLines(file, { parse: true, hints: { [`cost:${whole.head}`]: whole.size + 5 }, hintPrefix: 'cost' });
  assert.equal(beyond.lines.length, 600);
  assert.deepEqual(beyond.warnings.map((w) => w.code), ['cursor_hint_stale']);
  // a file under the threshold is read whole and silently, hint or not
  const small = path.join(dir, 'small.jsonl');
  write(small, lines({ a: 1 }, { a: 2 }));
  const smallRes = readLines(small, { parse: true, fromOffset: 8, headHash: headHashOf(Buffer.from(lines({ a: 1 }, { a: 2 }))) });
  assert.equal(smallRes.lines.length, 2);
  assert.deepEqual(smallRes.warnings, []);
});

test('source-jsonl-tail-states', () => {
  const dir = tmp();
  assert.equal(readLines(path.join(dir, 'nope.jsonl'), {}).state, 'absent');
  const res = readLines(dir, {});
  assert.equal(res.state, 'unreadable');
  assert.deepEqual(res.warnings.map((w) => w.code), ['file_unreadable']);
});

// ---- cost -------------------------------------------------------------------------------------------------------------

test('source-cost', () => {
  const fx = fresh();
  const res = cost.read(ctxOf(fx), {});
  assert.deepEqual(sorted(res.events), sorted(goldenOf(fx, 'cost.turn')));
  assert.equal(res.events.length, 5);
  assert.deepEqual(res.stats, { state: 'degraded', rows_read: 7, rows_skipped: 1, rows_filtered: 1, redactions: 0 });
  assert.deepEqual(res.warnings.map((w) => `${w.source}:${w.code}:${w.detail}:${w.count}`), ['cost:ts_invalid:costs.jsonl:1']);
  // the sum of cost_usd over events equals the file sum of the project rows (cost-digest style), byte-identical pair included
  const fileSum = [fx.cost.main, fx.cost.sub, fx.cost.removedWorktree, fx.cost.identical, fx.cost.identical].reduce((s, r) => s + JSON.parse(r).cost_usd, 0);
  assert.ok(Math.abs(res.events.reduce((s, e) => s + e.data.cost_usd, 0) - fileSum) < 1e-12);
  // ids are all distinct (the identical pair is #1 and #2)
  assert.equal(new Set(res.events.map((e) => e.id)).size, 5);
  // every event carries its source offset internally, not in the JSON
  assert.ok(res.events.every((e) => e._src && Number.isInteger(e._src.offset)));
  assert.ok(!JSON.stringify(res.events[0]).includes('_src'));
});

test('source-cost-filter-and-worktree-fallback', () => {
  const fx = fresh();
  const res = cost.read(ctxOf(fx), {});
  assert.ok(!res.events.some((e) => e.data.session === 's-fx-9'), 'foreign cwd row must not appear');
  assert.ok(res.events.some((e) => e.data.session === 's-fx-2'), 'row of a reaped worktree stays in the feed (manifest worktree prefix)');
  // a cwd that matches nothing and no longer exists: filtered, no warning
  const gone = JSON.stringify({ ...JSON.parse(fx.cost.main), session: 's-gone', cwd: path.join(fx.dir, 'elsewhere', 'deleted') });
  fs.appendFileSync(fx.paths.costsFile, gone + '\n');
  const again = cost.read(ctxOf(fx), {});
  assert.equal(again.stats.rows_filtered, 2);
  assert.ok(!again.events.some((e) => e.data.session === 's-gone'));
  assert.deepEqual(codes(again), ['ts_invalid:1']);
});

test('source-cost-id-is-position-free-and-n-counts-from-read-start', () => {
  const fx = fresh();
  const base = JSON.parse(fx.cost.main);
  const filler = [];
  for (let i = 0; i < 400; i += 1) filler.push(JSON.stringify({ ...base, session: `s-fill-${i}`, ts: '2026-11-01T07:00:00.000Z' }));
  const twin = JSON.stringify({ ...base, session: 's-twin', ts: '2026-11-01T09:00:00.000Z' });
  write(fx.paths.costsFile, lines(...filler, twin));
  const ctx = ctxOf(fx);
  const cold = cost.read(ctx, {});
  assert.ok(cold.files[0].size >= HINT_MIN_BYTES);
  const first = cold.events.find((e) => e.data.session === 's-twin');
  assert.equal(first.id, `cost.turn:${sha256hex(twin).slice(0, 24)}#1`);
  // a hint at the first line of the resume window (the first twin), then the second twin is appended
  fs.appendFileSync(fx.paths.costsFile, twin + '\n');
  const window = { sinceTs: '2026-11-01T09:00:00.000Z', slackMs: 300000 };
  const hints = { [cold.files[0].key]: first._src.offset };
  const hinted = cost.read(ctx, { ...window, hints });
  const unhinted = cost.read(ctx, window);
  const idsOf = (r) => r.events.filter((e) => e.data.session === 's-twin').map((e) => e.id).sort();
  assert.deepEqual(idsOf(unhinted), [`cost.turn:${sha256hex(twin).slice(0, 24)}#1`, `cost.turn:${sha256hex(twin).slice(0, 24)}#2`]);
  assert.deepEqual(idsOf(hinted), idsOf(unhinted), 'hinted and unhinted reads give the twin the same ids');
  // the hinted read really started late (line numbers would differ), the ids do not depend on it
  assert.ok(hinted.files[0].startOffset > 0 && hinted.stats.rows_read < unhinted.stats.rows_read);
  // the ordinal memo lives inside one call: a second identical call gives the same ids again
  assert.deepEqual(idsOf(cost.read(ctx, { ...window, hints })), idsOf(hinted));
});

test('source-cost-slack-defaults-to-five-minutes-when-omitted', () => {
  const fx = fresh();
  // floor = 08:26 - 5 min = 08:21 by default; an explicit 0 gives floor 08:26
  const base = { sinceTs: '2026-11-01T08:26:00.000Z' };
  const late = JSON.stringify({ ...JSON.parse(fx.cost.main), session: 's-late', ts: '2026-11-01T08:22:00.000Z' });
  fs.appendFileSync(fx.paths.costsFile, late + '\n');
  assert.ok(cost.read(ctxOf(fx), base).events.some((e) => e.data.session === 's-late'), 'a row 4 min behind the watermark is kept');
  assert.ok(!cost.read(ctxOf(fx), { ...base, slackMs: 0 }).events.some((e) => e.data.session === 's-late'), 'explicit 0 stays 0');
});

test('source-cost-slack-window-keeps-late-rows-and-drops-older', () => {
  const fx = fresh();
  const res = cost.read(ctxOf(fx), { sinceTs: '2026-11-01T08:26:00.000Z', slackMs: 300000 });
  // floor = 08:21: only the two identical rows (08:26) remain; 08:12-08:14 rows are older than the slack
  assert.deepEqual(res.events.map((e) => e.data.session), ['s-fx-3', 's-fx-3']);
  const wide = cost.read(ctxOf(fx), { sinceTs: '2026-11-01T08:26:00.000Z', slackMs: 15 * 60 * 1000 });
  assert.equal(wide.events.length, 5, 'a 15 min slack reaches back to 08:11 and keeps the 08:12/08:13 rows');
});

for (const [name, mutate] of [
  ['absent', (fx) => fs.rmSync(fx.paths.costsFile)],
  ['empty', (fx) => write(fx.paths.costsFile, '')],
]) {
  test(`degrade-cost-${name}`, () => {
    const fx = fresh();
    mutate(fx);
    const res = cost.read(ctxOf(fx), {});
    assert.deepEqual(res.events, []);
    if (name === 'absent') {
      assert.equal(res.stats.state, 'absent');
      assert.deepEqual(res.warnings.map((w) => `${w.code}:${w.detail}:${w.count}`), ['source_absent:costs.jsonl:1']);
    } else {
      assert.equal(res.stats.state, 'ok');
      assert.deepEqual(res.warnings, []);
    }
  });
}

test('degrade-cost-unreadable', { skip: isRoot ? 'uid 0 ignores file modes' : false }, () => {
  const fx = fresh();
  fs.chmodSync(fx.paths.costsFile, 0o000);
  const res = cost.read(ctxOf(fx), {});
  fs.chmodSync(fx.paths.costsFile, 0o600);
  assert.deepEqual(res.events, []);
  assert.equal(res.stats.state, 'degraded');
  assert.deepEqual(codes(res), ['file_unreadable:1']);
});

test('degrade-cost-truncated', () => {
  const fx = fresh();
  const tail = JSON.stringify({ ...JSON.parse(fx.cost.main), session: 's-tail', ts: '2026-11-01T09:05:00.000Z' });
  write(fx.paths.costsFile, lines(fx.cost.main) + tail.slice(0, 40));
  const ctx = ctxOf(fx);
  const partial = cost.read(ctx, {});
  assert.deepEqual(partial.events.map((e) => e.data.session), ['s-fx-1'], 'the write in progress is not an event');
  assert.deepEqual(partial.warnings, [], 'and not a warning either');
  assert.equal(partial.stats.state, 'ok');
  fs.appendFileSync(fx.paths.costsFile, tail.slice(40) + '\n');
  assert.deepEqual(cost.read(ctx, {}).events.map((e) => e.data.session), ['s-fx-1', 's-tail']);
});

test('degrade-cost-binary-wrong-schema-bad-ts-and-long-line', () => {
  const fx = fresh();
  const wrong = JSON.stringify({ cwd: fx.repoDir, foo: 'bar' });
  const badType = JSON.stringify({ ...JSON.parse(fx.cost.main), input_tokens: 'many', session: 's-bt' });
  const badTs = JSON.stringify({ ...JSON.parse(fx.cost.main), ts: 'yesterday', session: 's-ts' });
  const huge = `{"cwd":"${fx.repoDir}","pad":"${'x'.repeat(10 * 1024 * 1024)}"}`;
  write(fx.paths.costsFile, lines(fx.cost.main, '\u0000\u0001binary\u0002junk', wrong, '[1,2,3]', badType, badTs, huge, fx.cost.sub));
  const res = cost.read(ctxOf(fx), {});
  assert.deepEqual(res.events.map((e) => e.data.session).sort(), ['s-fx-1', 's-fx-1']);
  assert.equal(res.stats.state, 'degraded');
  assert.deepEqual(codes(res), ['line_too_long:1', 'line_unparseable:1', 'schema_mismatch:3', 'ts_invalid:1']);
  assert.equal(res.stats.rows_skipped, 5, 'a too-long line is skipped before it is a row');
});

test('degrade-cost-git-failure-is-one-warning-not-a-silent-filter', () => {
  const fx = fresh();
  const bin = path.join(tmp(), 'bin');
  const shim = (name, body) => { write(path.join(bin, name), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  const realGit = require('child_process').execFileSync('sh', ['-c', 'command -v git'], { env: fx.env, encoding: 'utf8' }).trim();
  // only `rev-parse` (the project identity of a cwd) is sabotaged; `worktree list` is the real git
  const run = (body) => { shim('git', `case "$*" in *worktree*) exec ${realGit} "$@";; esac; ${body}`); return cost.read({ ...ctxOf(fx), env: { ...fx.env, PATH: `${bin}:${fx.env.PATH}` } }, {}); };
  // dubious ownership / broken .git / timeout-like failure: exit 128 with another message, or a kill
  for (const body of ['echo "fatal: detected dubious ownership" >&2; exit 128', 'exit 1', 'kill -9 $$']) {
    const res = run(body);
    assert.equal(res.stats.state, 'degraded', body);
    assert.deepEqual(res.warnings.filter((w) => w.code === 'git_unavailable').map((w) => w.count), [1], `${body}: one aggregated warning`);
    assert.ok(res.events.some((e) => e.data.session === 's-fx-2'), 'the reaped-worktree prefix fallback still works');
  }
  // "not a git repository (or any of the parent directories)" for a cwd with no .git above it is a definite other project
  const plain = path.join(fx.dir, 'plain-dir');
  fs.mkdirSync(plain, { recursive: true });
  write(fx.paths.costsFile, lines({ ...JSON.parse(fx.cost.main), session: 's-plain', cwd: plain }));
  const clean = run('echo "fatal: not a git repository (or any of the parent directories): .git" >&2; exit 128');
  assert.ok(!clean.warnings.some((w) => w.code === 'git_unavailable'));
  assert.equal(clean.events.length, 0);
  assert.equal(clean.stats.rows_filtered, 1);
});

test('degrade-cost-broken-dot-git-is-not-a-git-failure', () => {
  const fx = fresh();
  const { execFileSync } = require('child_process');
  const wt = (name) => path.join(fx.dir, 'worktrees', name);
  const other = (name) => path.join(fx.dir, 'elsewhere', name);
  // 1: a .git file pointing at a gitdir that does not exist; 2: a .git directory without HEAD
  const breakAt = (dir, kind) => {
    if (kind === 'ptr') write(path.join(dir, '.git'), `gitdir: ${path.join(fx.dir, 'no-such-gitdir')}\n`);
    else { fs.mkdirSync(dir, { recursive: true }); execFileSync('git', ['init', '-q', '--template=', dir], { env: fx.env }); fs.rmSync(path.join(dir, '.git', 'HEAD')); }
  };
  const rows = [];
  for (const [name, kind] of [['broken-ptr', 'ptr'], ['broken-head', 'head']]) {
    breakAt(wt(name), kind);
    write(path.join(fx.paths.runsDir, `fx-run-${name}.manifest.json`), JSON.stringify({ ...fx.manifests.done, run_id: `fx-run-${name}`, worktree: wt(name) }) + '\n');
    rows.push(JSON.stringify({ ...JSON.parse(fx.cost.main), session: `s-${name}`, cwd: wt(name) }));
    breakAt(other(name), kind);
    rows.push(JSON.stringify({ ...JSON.parse(fx.cost.main), session: `s-other-${name}`, cwd: other(name) }));
  }
  fs.appendFileSync(fx.paths.costsFile, rows.join('\n') + '\n');
  const res = cost.read(ctxOf(fx), {});
  assert.deepEqual(res.warnings.filter((w) => w.code === 'git_unavailable'), [], 'a broken .git never warns, however often it is read');
  assert.equal(res.stats.state, 'degraded', 'the fixture still holds its ts_invalid row');
  assert.ok(!res.warnings.some((w) => w.code === 'git_unavailable' || w.code === 'source_failed'));
  for (const name of ['broken-ptr', 'broken-head']) {
    assert.ok(res.events.some((e) => e.data.session === `s-${name}`), `${name}: under a project worktree prefix, kept`);
    assert.ok(!res.events.some((e) => e.data.session === `s-other-${name}`), `${name}: outside the prefixes, filtered`);
  }
  // only the broken .git rows: state stays ok and nothing is said
  write(fx.paths.costsFile, rows.join('\n') + '\n');
  const quiet = cost.read(ctxOf(fx), {});
  assert.equal(quiet.stats.state, 'ok');
  assert.deepEqual(quiet.warnings, []);
  assert.equal(quiet.stats.rows_filtered, 2);
});

test('degrade-cost-git-binary-missing-or-timeout-stays-one-warning', () => {
  const fx = fresh();
  const emptyBin = path.join(tmp(), 'empty-bin');
  fs.mkdirSync(emptyBin, { recursive: true });
  const noGit = cost.read({ ...ctxOf(fx), env: { ...fx.env, PATH: emptyBin } }, {});
  assert.equal(noGit.stats.state, 'degraded');
  assert.deepEqual(noGit.warnings.filter((w) => w.code === 'git_unavailable').map((w) => w.count), [1], 'git not on PATH: one warning per read');
  const bin = path.join(tmp(), 'bin');
  write(path.join(bin, 'git'), '#!/bin/sh\nkill -TERM $$\n');
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  const killed = cost.read({ ...ctxOf(fx), env: { ...fx.env, PATH: `${bin}:${fx.env.PATH}` } }, {});
  assert.equal(killed.stats.state, 'degraded');
  assert.deepEqual(killed.warnings.filter((w) => w.code === 'git_unavailable').map((w) => w.count), [1]);
});

test('degrade-cost-git-messages-are-read-in-the-c-locale', () => {
  const fx = fresh();
  const bin = path.join(tmp(), 'bin');
  const realGit = require('child_process').execFileSync('sh', ['-c', 'command -v git'], { env: fx.env, encoding: 'utf8' }).trim();
  // a translating git: any locale but C gets a German message
  write(path.join(bin, 'git'), `#!/bin/sh
case "$*" in *worktree*) exec ${realGit} "$@";; esac
if [ "$LC_ALL" = "C" ]; then echo "fatal: not a git repository (or any of the parent directories): .git" >&2; else echo "fatal: kein Git-Repository (oder irgendein Elternverzeichnis): .git" >&2; fi
exit 128
`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  const plain = path.join(fx.dir, 'plain-dir');
  fs.mkdirSync(plain, { recursive: true });
  write(fx.paths.costsFile, lines({ ...JSON.parse(fx.cost.main), session: 's-plain', cwd: plain }));
  const res = cost.read({ ...ctxOf(fx), env: { ...fx.env, PATH: `${bin}:${fx.env.PATH}`, LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', LANGUAGE: 'de' } }, {});
  assert.ok(!res.warnings.some((w) => w.code === 'git_unavailable'), 'a cwd outside any repo is not a resolution failure');
});

test('degrade-cost-empty-rev-parse-answer-is-a-resolution-failure', () => {
  const fx = fresh();
  const bin = path.join(tmp(), 'bin');
  const realGit = require('child_process').execFileSync('sh', ['-c', 'command -v git'], { env: fx.env, encoding: 'utf8' }).trim();
  write(path.join(bin, 'git'), `#!/bin/sh\ncase "$*" in *worktree*) exec ${realGit} "$@";; esac\nexit 0\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  const res = cost.read({ ...ctxOf(fx), env: { ...fx.env, PATH: `${bin}:${fx.env.PATH}` } }, {});
  assert.equal(res.stats.state, 'degraded');
  assert.deepEqual(res.warnings.filter((w) => w.code === 'git_unavailable').map((w) => w.count), [1]);
});

test('degrade-cost-never-throws-on-a-hostile-hint', () => {
  const fx = fresh();
  const res = cost.read(ctxOf(fx), { hints: { 'cost:abc': -4, 'cost:def': 'x' }, sinceTs: 'garbage', slackMs: 'nope' });
  assert.equal(res.events.length, 5);
});

// ---- decision ---------------------------------------------------------------------------------------------------------

test('source-decision', () => {
  const fx = fresh();
  const res = decision.read(ctxOf(fx), {});
  assert.deepEqual(sorted(res.events), sorted(goldenOf(fx, 'decision.row')));
  assert.equal(res.events.length, 7);
  assert.deepEqual(res.stats, { state: 'ok', rows_read: 8, rows_skipped: 0, rows_filtered: 1, redactions: 1 });
  assert.deepEqual(res.warnings, []);
  assert.ok(res.events.every((e) => e.data.basis === 'self_reported'));
  // two rows sharing decision_id and kind with different content are two events
  assert.equal(res.events.filter((e) => e.data.decision_id === 'D-002').length, 2);
  // the token is gone from the whole output
  assert.ok(!JSON.stringify(res).includes(fx.tokenShaped));
});

test('source-decision-rationale-is-capped-at-240-and-marked', () => {
  const fx = fresh();
  const long = JSON.stringify({ schema_version: 1, repo_identity: fx.identity, ts: '2026-11-01T11:00:00.000Z', kind: 'decision', decision_id: 'D-LONG', round: 1, class: 'routine', rationale: 'a'.repeat(300), reversibility: 'two-way', refs: [] });
  fs.appendFileSync(fx.paths.decisionLedger, long + '\n');
  const res = decision.read(ctxOf(fx), {});
  const ev = res.events.find((e) => e.data.decision_id === 'D-LONG');
  assert.equal(Array.from(ev.data.rationale).length, 240);
  assert.ok(ev.data.rationale.endsWith('…'));
  assert.equal(ev.data.rationale.slice(0, 239), 'a'.repeat(239));
});

test('source-decision-redacts-free-text-through-the-call-point', () => {
  const fx = fresh();
  const secretRow = JSON.stringify({ schema_version: 1, repo_identity: fx.identity, ts: '2026-11-01T11:05:00.000Z', kind: 'decision', decision_id: 'D-SEC', round: 1, class: 'routine', rationale: `key ${fx.tokenShaped} and ${fx.tokenShaped}`, reversibility: 'two-way', refs: [] });
  fs.appendFileSync(fx.paths.decisionLedger, secretRow + '\n');
  const res = decision.read(ctxOf(fx), {});
  assert.equal(res.events.find((e) => e.data.decision_id === 'D-SEC').data.rationale, 'key [redacted] and [redacted]');
  assert.equal(res.stats.redactions, 3);
});

test('source-decision-unknown-kind-kept-and-identical-rows-collapse', () => {
  const fx = fresh();
  const odd = { schema_version: 1, repo_identity: fx.identity, ts: '2026-11-01T11:10:00.000Z', kind: 'brand-new-kind', round: 2 };
  fs.appendFileSync(fx.paths.decisionLedger, lines(odd, odd));
  const res = decision.read(ctxOf(fx), {});
  const hits = res.events.filter((e) => e.data.row_kind === 'brand-new-kind');
  assert.equal(hits.length, 1);
  assert.match(hits[0].id, /^decision\.row:[0-9a-f]{24}$/);
});

for (const [name, mutate] of [
  ['absent', (fx) => { fs.rmSync(fx.paths.decisionLedger); fs.rmSync(fx.paths.workOrderLedger); }],
  ['empty', (fx) => { write(fx.paths.decisionLedger, ''); fs.rmSync(fx.paths.workOrderLedger); }],
]) {
  test(`degrade-decision-${name}`, () => {
    const fx = fresh();
    mutate(fx);
    const res = decision.read(ctxOf(fx), {});
    assert.deepEqual(res.events, []);
    assert.deepEqual(res.warnings, [], 'an absent default ledger is normal in a fresh repo');
    assert.equal(res.stats.state, name === 'absent' ? 'absent' : 'ok');
  });
}

test('degrade-decision-unreadable', { skip: isRoot ? 'uid 0 ignores file modes' : false }, () => {
  const fx = fresh();
  fs.chmodSync(fx.paths.decisionLedger, 0o000);
  const res = decision.read(ctxOf(fx), {});
  fs.chmodSync(fx.paths.decisionLedger, 0o600);
  assert.equal(res.stats.state, 'degraded');
  assert.deepEqual(codes(res), ['file_unreadable:1']);
  assert.equal(res.events.length, 1, 'the work-order ledger is still read');
});

test('degrade-decision-truncated', () => {
  const fx = fresh();
  const row = JSON.stringify({ schema_version: 1, repo_identity: fx.identity, ts: '2026-11-01T11:00:00.000Z', kind: 'note', round: 3, text: 'late' });
  write(fx.paths.decisionLedger, lines(fx.decisionRows.d4) + row.slice(0, 30));
  fs.rmSync(fx.paths.workOrderLedger);
  const ctx = ctxOf(fx);
  const partial = decision.read(ctx, {});
  assert.equal(partial.events.length, 1);
  assert.deepEqual(partial.warnings, []);
  fs.appendFileSync(fx.paths.decisionLedger, row.slice(30) + '\n');
  assert.equal(decision.read(ctx, {}).events.length, 2);
});

test('degrade-decision-binary-wrong-schema-bad-ts-and-long-line', () => {
  const fx = fresh();
  const noKind = JSON.stringify({ schema_version: 1, ts: '2026-11-01T11:00:00.000Z', text: 'x' });
  const badTs = JSON.stringify({ schema_version: 1, ts: '2026-02-30T00:00:00Z', kind: 'note', round: 1 });
  const huge = `{"kind":"note","pad":"${'y'.repeat(10 * 1024 * 1024)}"}`;
  write(fx.paths.decisionLedger, lines(fx.decisionRows.d4, '\u0000junk\u0001', noKind, '"just a string"', badTs, huge, fx.decisionRows.d1));
  fs.rmSync(fx.paths.workOrderLedger);
  const res = decision.read(ctxOf(fx), {});
  assert.deepEqual(res.events.map((e) => e.data.row_kind).sort(), ['decision', 'note']);
  assert.deepEqual(codes(res), ['line_too_long:1', 'line_unparseable:1', 'schema_mismatch:2', 'ts_invalid:1']);
});

// ---- runledger --------------------------------------------------------------------------------------------------------

test('source-runledger', () => {
  const fx = fresh();
  const res = runledger.read(ctxOf(fx), {});
  assert.deepEqual(sorted(res.events), sorted(goldenOf(fx, 'run.stage')));
  assert.equal(res.events.length, 4);
  // 7 rows over the rotated set; heartbeat x2 + journal are volume, not events
  assert.deepEqual(res.stats, { state: 'ok', rows_read: 7, rows_skipped: 0, rows_filtered: 3, redactions: 0 });
  assert.deepEqual(res.warnings.map((w) => `${w.source}:${w.code}:${w.count}`), fixtureLib.goldenWarnings(fx).map((w) => `${w.source}:${w.code}:${w.count}`));
  assert.ok(res.events.every((e) => e.data.basis === 'self_reported'));
});

test('source-runledger-status-state-rule', () => {
  const fx = fresh();
  const res = runledger.read(ctxOf(fx), {});
  const status = (stage) => res.events.find((e) => e.data.stage === stage).data;
  assert.equal(status('implement').status, 'running', 'only state -> state');
  assert.equal(status('verify').status, 'ok', 'both, different -> status wins');
  assert.equal(status('review').status, 'done', 'only status');
  assert.equal(status('merge').status, '', 'an empty status property still wins over state');
});

test('source-runledger-reaped-ledger-is-silent', () => {
  const fx = fresh();
  fs.rmSync(fx.paths.runLedger);
  fs.rmSync(fx.paths.runLedgerRotated);
  const res = runledger.read(ctxOf(fx), {});
  assert.deepEqual(res.events, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.stats.state, 'absent');
  assert.equal(res.stats.rows_filtered, 1);
});

test('source-runledger-rotation', () => {
  const fx = fresh();
  const mk = (tag, count) => {
    const rows = [];
    for (let i = 0; i < count; i += 1) rows.push({ kind: 'stage', ts: `2026-11-01T08:${String(30 + (i % 20)).padStart(2, '0')}:00.000Z`, run_id: `fx-${tag}-${i}`, stage: 'implement', state: 'running', generation: i, nonce: `${tag}-${i}`, pad: 'p'.repeat(90) });
    return rows;
  };
  const oldRows = mk('old', 500);
  write(fx.paths.runLedgerRotated, '');
  write(fx.paths.runLedger, lines(...oldRows));
  const ctx = ctxOf(fx);
  const cold = runledger.read(ctx, {});
  const big = cold.files.find((f) => f.size >= HINT_MIN_BYTES);
  assert.ok(big, 'the live ledger is big enough to carry a hint');
  const delivered = new Set(cold.events.map((e) => e.id));
  assert.equal(delivered.size, 500);
  // rotation: the live file is renamed to .1, a new (also big) live file appears with different content
  fs.renameSync(fx.paths.runLedger, fx.paths.runLedgerRotated);
  write(fx.paths.runLedger, lines(...mk('new', 500)));
  const hints = { [big.key]: big.endOffset };
  const hinted = runledger.read(ctx, { hints });
  const full = runledger.read(ctx, {});
  assert.deepEqual(hinted.warnings, []);
  // delivered-before union hinted == full read: no gap and no duplicate id
  const union = new Set([...delivered, ...hinted.events.map((e) => e.id)]);
  assert.deepEqual([...union].sort(), full.events.map((e) => e.id).sort());
  assert.equal(hinted.events.length, 500, 'only the new live file is read; the renamed segment resumes at its old offset (nothing left)');
  assert.equal(hinted.events.filter((e) => delivered.has(e.id)).length, 0, 'no duplicate of an event delivered before the rotation');
  // the segment renamed to .1 keeps its offset through its head hash
  assert.ok(hinted.files.some((f) => f.file === fx.paths.runLedgerRotated && f.startOffset === big.endOffset));
});

for (const [name, mutate] of [
  ['absent', (fx) => { fs.rmSync(fx.paths.runLedger); fs.rmSync(fx.paths.runLedgerRotated); }],
  ['empty', (fx) => { write(fx.paths.runLedger, ''); fs.rmSync(fx.paths.runLedgerRotated); }],
]) {
  test(`degrade-runledger-${name}`, () => {
    const fx = fresh();
    mutate(fx);
    const res = runledger.read(ctxOf(fx), {});
    assert.deepEqual(res.events, []);
    assert.deepEqual(res.warnings, []);
    assert.equal(res.stats.state, name === 'absent' ? 'absent' : 'ok');
  });
}

test('degrade-runledger-unreadable', { skip: isRoot ? 'uid 0 ignores file modes' : false }, () => {
  const fx = fresh();
  fs.chmodSync(fx.paths.runLedger, 0o000);
  const res = runledger.read(ctxOf(fx), {});
  fs.chmodSync(fx.paths.runLedger, 0o600);
  assert.equal(res.stats.state, 'degraded');
  assert.deepEqual(codes(res), ['file_unreadable:1']);
  assert.equal(res.events.length, 1, 'the rotated segment is still read');
});

test('degrade-runledger-truncated', () => {
  const fx = fresh();
  const row = JSON.stringify({ kind: 'stage', ts: '2026-11-01T11:00:00.000Z', run_id: 'fx-run-done', stage: 'late', generation: 9, status: 'ok' });
  write(fx.paths.runLedger, lines(fx.runRows.stage3) + row.slice(0, 25));
  fs.rmSync(fx.paths.runLedgerRotated);
  const ctx = ctxOf(fx);
  const partial = runledger.read(ctx, {});
  assert.equal(partial.events.length, 1);
  assert.deepEqual(partial.warnings, []);
  fs.appendFileSync(fx.paths.runLedger, row.slice(25) + '\n');
  assert.equal(runledger.read(ctx, {}).events.length, 2);
});

test('degrade-runledger-binary-wrong-schema-bad-ts-and-long-line', () => {
  const fx = fresh();
  const noStage = JSON.stringify({ kind: 'stage', ts: '2026-11-01T11:00:00.000Z', run_id: 'fx-run-done', generation: 1 });
  const badGen = JSON.stringify({ kind: 'stage', ts: '2026-11-01T11:00:00.000Z', run_id: 'fx-run-done', stage: 's', generation: 'one' });
  const badTs = JSON.stringify({ kind: 'stage', ts: 'not a time', run_id: 'fx-run-done', stage: 's', generation: 1 });
  const huge = `{"kind":"stage","pad":"${'z'.repeat(10 * 1024 * 1024)}"}`;
  write(fx.paths.runLedger, lines(fx.runRows.stage2, '\u0000\u0001junk', noStage, badGen, '[]', badTs, huge, fx.runRows.stage3));
  fs.rmSync(fx.paths.runLedgerRotated);
  const res = runledger.read(ctxOf(fx), {});
  assert.deepEqual(res.events.map((e) => e.data.stage).sort(), ['review', 'verify']);
  assert.deepEqual(codes(res), ['line_too_long:1', 'line_unparseable:1', 'schema_mismatch:3', 'status_state_conflict:1', 'ts_invalid:1']);
});

test('source-runledger-reason-is-redacted-and-capped', () => {
  const fx = fresh();
  const row = { kind: 'stage', ts: '2026-11-01T11:00:00.000Z', run_id: 'fx-run-done', stage: 'x', generation: 7, status: 'ok', reason: `${fx.tokenShaped} ${'r'.repeat(200)}` };
  fs.appendFileSync(fx.paths.runLedger, JSON.stringify(row) + '\n');
  const res = runledger.read(ctxOf(fx), {});
  const reason = res.events.find((e) => e.data.generation === 7).data.reason;
  assert.equal(Array.from(reason).length, 120);
  assert.ok(reason.startsWith('[redacted] rrr') && reason.endsWith('…'));
  assert.equal(res.stats.redactions, 1);
});

// ---- structure --------------------------------------------------------------------------------------------------------

test('source-readers-do-not-import-each-other', () => {
  const dir = path.join(__dirname, '..', 'src', 'status', 'events', 'sources');
  for (const file of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(!/require\(['"]\.\/[^'"]*['"]\)/.test(text), `${file} requires a sibling reader`);
  }
});

test('source-readers-write-nothing', () => {
  const dir = path.join(__dirname, '..', 'src', 'status', 'events');
  for (const file of ['jsonl-tail.js', 'sources/cost.js', 'sources/decision.js', 'sources/runledger.js']) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(!/\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdirSync|rmSync|renameSync|unlinkSync|openSync\([^)]*['"][wa])/.test(text.replace(/\/\/.*$/gm, '')), `${file} must be read-only`);
  }
});
