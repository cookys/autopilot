// mods/live/consolefeed.test.js — the console data source (consolefeed.ts): the command, the 60 s interval, the console.json fallback, staleness, and garbage input.
// Imports the REAL consolefeed.ts and console.ts (erasable syntax). Run: node --test mods/live/consolefeed.test.js   (also run by run-tests.sh)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let F, C
test.before(async () => {
  F = await import(path.join(__dirname, 'consolefeed.ts'))
  C = await import(path.join(__dirname, 'console.ts'))
})

const NOW = 1_800_000_000_000
const snapText = (genMs, extra = {}) => JSON.stringify({
  schema: 'fleet.console/1', generated_at_ms: genMs,
  sources: { cards: { at_ms: genMs, state: 'ok' }, tasks: { at_ms: genMs, state: 'ok' }, quota_now: { state: 'no_source' } },
  counts: { decisions: 1, exceptions: 0, tabs: {}, summary: { lines: {}, hosts: {}, hints: 0 } },
  items: [], ...extra,
})
const ok = stdout => async () => ({ exitCode: 0, stdout, stderr: '' })
const calls = fn => { const f = async a => { f.n++; f.argv = a; return fn(a) }; f.n = 0; return f }
const file = text => async () => text
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'console', 'fleet-real-shape.json'), 'utf8'))

const FICTIONAL_INGEST = 'ns/courier-a/capacity=pace ns/courier-a/fleet-cli=pace'

test('a: key absent -> plain fleet console --json (no env prefix), source ok; a second call within 60 s does not run it again', async () => {
  const feed = F.makeConsoleFeed()
  const run = calls(ok(snapText(NOW)))
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW), true)
  assert.deepEqual(run.argv, ['fleet', 'console', '--json'])
  assert.deepEqual(F.CONSOLE_ARGV, ['fleet', 'console', '--json'])
  assert.equal('CONSOLE_INGEST_FROM' in F, false)
  const s = feed.current(NOW)
  assert.equal(s.sources.cards.state, 'ok')
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW + 59_000), false)
  assert.equal(run.n, 1)
  assert.equal(feed.current(NOW + 59_000), s)
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW + 60_000), true)
  assert.equal(run.n, 2)
})

test('a2: ingest_from present in console.json -> env FLEET_CONSOLE_INGEST_FROM=<value> fleet console --json as one argv element', async () => {
  const repo = {
    '/r/.git/HEAD': 'ref: refs/heads/x\n',
    '/r/.claude/console.json': JSON.stringify({ schema: 'autopilot.console/1', mode: 'program', ingest_from: FICTIONAL_INGEST }),
  }
  const cfg = await C.findConsoleConfig('/r/sub', async p => (Object.hasOwn(repo, p) ? repo[p] : null))
  assert.deepEqual(cfg, { on: true, ingestFrom: FICTIONAL_INGEST })
  const feed = F.makeConsoleFeed()
  feed.setIngestFrom(cfg.ingestFrom)
  const run = calls(ok(snapText(NOW)))
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW), true)
  // the space-separated sender list stays ONE argv element after env, never split on space
  assert.deepEqual(run.argv, ['env', `FLEET_CONSOLE_INGEST_FROM=${FICTIONAL_INGEST}`, 'fleet', 'console', '--json'])
})

test('a3: ingest_from absent, blank, or non-string in console.json -> plain fleet console --json with no env prefix', async () => {
  for (const extra of [{}, { ingest_from: '' }, { ingest_from: '   \t  ' }, { ingest_from: null }, { ingest_from: 42 }, { ingest_from: [FICTIONAL_INGEST] }]) {
    const repo = {
      '/r/.git/HEAD': 'ref: refs/heads/x\n',
      '/r/.claude/console.json': JSON.stringify({ schema: 'autopilot.console/1', mode: 'program', ...extra }),
    }
    const cfg = await C.findConsoleConfig('/r', async p => (Object.hasOwn(repo, p) ? repo[p] : null))
    assert.deepEqual(cfg, { on: true, ingestFrom: null })
    const feed = F.makeConsoleFeed()
    feed.setIngestFrom(cfg.ingestFrom)
    const run = calls(ok(snapText(NOW)))
    assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW), true)
    assert.deepEqual(run.argv, ['fleet', 'console', '--json'])
  }
})

test('a4: malformed ingest_from tokens are dropped; surviving tokens get the env prefix, and all-malformed gets no prefix', async () => {
  const mixed = [
    'ns/courier-a/capacity=pace',
    'UPPER/courier-a/x=pace',
    'not-an-address',
    'ns/only-two=pace',
    'ns/a/b/extra=pace',
    'ns/a/b=pace1',
    'ns/a/b=p_q',
    'ns/a/b=',
    'ns/a/b=pace;id',
    '$HOME/a/b=pace',
    'ns/courier-a/fleet-cli=pace',
  ].join('   ')
  const cfg = C.consoleConfigOf(JSON.stringify({ schema: 'autopilot.console/1', mode: 'program', ingest_from: mixed }))
  assert.deepEqual(cfg, { on: true, ingestFrom: FICTIONAL_INGEST })
  // consolefeed.ts also enforces the token grammar at its own boundary
  const directFeed = F.makeConsoleFeed(F.CONSOLE_EVERY_MS, F.CONSOLE_STALE_MS, mixed)
  const runMixed = calls(ok(snapText(NOW)))
  assert.equal(await directFeed.refresh(runMixed, file(null), C.parseConsole, NOW), true)
  assert.deepEqual(runMixed.argv, ['env', `FLEET_CONSOLE_INGEST_FROM=${FICTIONAL_INGEST}`, 'fleet', 'console', '--json'])

  const allBad = 'UPPER/a/b=pace bad-token ns/a/b=123 ns/two=pace ns/a/b/c=pace'
  const badCfg = C.consoleConfigOf(JSON.stringify({ schema: 'autopilot.console/1', mode: 'program', ingest_from: allBad }))
  assert.deepEqual(badCfg, { on: true, ingestFrom: null })
  const badFeed = F.makeConsoleFeed(F.CONSOLE_EVERY_MS, F.CONSOLE_STALE_MS, allBad)
  const runBad = calls(ok(snapText(NOW)))
  assert.equal(await badFeed.refresh(runBad, file(null), C.parseConsole, NOW), true)
  assert.deepEqual(runBad.argv, ['fleet', 'console', '--json'])

  // clearing ingest_from removes the env prefix and allows an immediate refresh
  directFeed.setIngestFrom(allBad)
  const runCleared = calls(ok(snapText(NOW + 1000)))
  assert.equal(await directFeed.refresh(runCleared, file(null), C.parseConsole, NOW + 1000), true)
  assert.deepEqual(runCleared.argv, ['fleet', 'console', '--json'])
})

test('b: the command exits non-zero or throws (a timeout) -> the console.json fallback is read and a console/1 file is accepted', async () => {
  for (const run of [calls(async () => ({ exitCode: 1, stdout: '', stderr: 'boom' })), calls(async () => { throw new Error('timeout') })]) {
    const feed = F.makeConsoleFeed()
    await feed.refresh(run, file(snapText(NOW - 1000)), C.parseConsole, NOW)
    const s = feed.current(NOW)
    assert.notEqual(s, null)
    assert.equal(s.generated_at_ms, NOW - 1000)
    assert.equal(s.sources.cards.state, 'ok')
  }
})

test('c: a fallback older than 5 minutes is stale (ok sources become stale, identity is stable); a fresh one is not', async () => {
  const feed = F.makeConsoleFeed()
  await feed.refresh(calls(ok('nope')), file(snapText(NOW - 301_000)), C.parseConsole, NOW)
  const s = feed.current(NOW)
  assert.equal(s.sources.cards.state, 'stale')
  assert.equal(s.sources.cards.at_ms, NOW - 301_000)
  assert.equal(s.sources.quota_now.state, 'no_source')
  assert.equal(feed.current(NOW + 5000), s)
  const fresh = F.makeConsoleFeed()
  await fresh.refresh(calls(ok('nope')), file(snapText(NOW - 299_000)), C.parseConsole, NOW)
  assert.equal(fresh.current(NOW).sources.cards.state, 'ok')
  assert.equal(fresh.current(NOW + 2_000_000).sources.cards.state, 'stale') // it ages while it sits
})

test('d: command fails and the file is missing or is a fleet.brief/1 -> no source', async () => {
  const bad = calls(async () => ({ exitCode: 2, stdout: '', stderr: '' }))
  for (const f of [file(null), async () => { throw new Error('ENOENT') }, file(JSON.stringify({ schema: 'fleet.brief/1', generated_at_ms: NOW }))]) {
    const feed = F.makeConsoleFeed()
    await feed.refresh(bad, f, C.parseConsole, NOW)
    assert.equal(feed.current(NOW), null)
  }
})

test('d2: a failed refresh after a good one drops to no source (the fallback decides), and the next interval can recover', async () => {
  const feed = F.makeConsoleFeed()
  await feed.refresh(calls(ok(snapText(NOW))), file(null), C.parseConsole, NOW)
  await feed.refresh(calls(async () => ({ exitCode: 1, stdout: '' })), file(null), C.parseConsole, NOW + 60_000)
  assert.equal(feed.current(NOW + 60_000), null)
  await feed.refresh(calls(ok(snapText(NOW + 120_000))), file(null), C.parseConsole, NOW + 120_000)
  assert.notEqual(feed.current(NOW + 120_000), null)
})

test('e: garbage stdout and a garbage file -> no exception, no source', async () => {
  for (const g of ['', 'not json', '[1,2', '{"schema":"fleet.console/1"}', '\u0000\u0001', 'null', '"x"']) {
    const feed = F.makeConsoleFeed()
    await feed.refresh(calls(ok(g)), file(g), C.parseConsole, NOW)
    assert.equal(feed.current(NOW), null)
  }
  const feed = F.makeConsoleFeed()
  await feed.refresh(calls(ok('x'.repeat(F.CONSOLE_MAX_BYTES + 1))), file('x'.repeat(F.CONSOLE_MAX_BYTES + 1)), C.parseConsole, NOW)
  assert.equal(feed.current(NOW), null)
})

test('f: an item with no line_id is kept with line_id null; a present non-string line_id is still dropped', () => {
  const snap = C.parseConsole(JSON.stringify(REAL))
  assert.notEqual(snap, null)
  assert.equal(snap.items.length, REAL.items.length - 1)
  assert.ok(snap.items.length >= 2)
  for (const it of snap.items) assert.equal(it.line_id, null)
})

test('g: an item of a kind this build does not know (seat_blocked) is kept, and the snapshot is not refused', () => {
  const snap = C.parseConsole(JSON.stringify(REAL))
  const it = snap.items.find(x => x.kind === 'seat_blocked')
  assert.notEqual(it, undefined)
  assert.equal(it.id, REAL.items.find(x => x.kind === 'seat_blocked').id)
})

test('h: null -> null refresh keeps identity', async () => {
  const feed = F.makeConsoleFeed()
  const run = ok('not json')
  const before = feed.current(NOW)
  assert.equal(before, null)
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW), true)
  assert.equal(feed.current(NOW), before)
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW + F.CONSOLE_EVERY_MS), true)
  assert.equal(feed.current(NOW + F.CONSOLE_EVERY_MS), before)
})

test('i: unchanged command JSON keeps the held snapshot', async () => {
  const feed = F.makeConsoleFeed()
  const run = ok(snapText(NOW))
  await feed.refresh(run, file(null), C.parseConsole, NOW)
  const before = feed.current(NOW)
  assert.notEqual(before, null)
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW + F.CONSOLE_EVERY_MS), true)
  assert.equal(feed.current(NOW + F.CONSOLE_EVERY_MS), before)
})

test('j: unchanged fallback JSON keeps both fresh and stale snapshot identity', async () => {
  for (const age of [0, F.CONSOLE_STALE_MS + 1]) {
    const feed = F.makeConsoleFeed()
    const readFile = file(snapText(NOW - age))
    await feed.refresh(ok('not json'), readFile, C.parseConsole, NOW)
    const before = feed.current(NOW)
    assert.equal(before.sources.cards.state, age === 0 ? 'ok' : 'stale')
    assert.equal(await feed.refresh(ok('not json'), readFile, C.parseConsole, NOW + F.CONSOLE_EVERY_MS), true)
    assert.equal(feed.current(NOW + F.CONSOLE_EVERY_MS), before)
  }
})

test('k: changed JSON replaces the held snapshot for either origin', async () => {
  for (const fromFile of [false, true]) {
    const feed = F.makeConsoleFeed()
    const refresh = (text, now) => feed.refresh(ok(fromFile ? 'not json' : text), file(fromFile ? text : null), C.parseConsole, now)
    await refresh(snapText(NOW), NOW)
    const before = feed.current(NOW)
    await refresh(snapText(NOW, { counts: { decisions: 2 } }), NOW + F.CONSOLE_EVERY_MS)
    const after = feed.current(NOW + F.CONSOLE_EVERY_MS)
    assert.notEqual(after, before)
    assert.equal(after.counts.decisions, 2)
  }
})

test('l: equal JSON from a different origin replaces the snapshot and its stale view', async () => {
  const feed = F.makeConsoleFeed()
  const text = snapText(NOW - F.CONSOLE_STALE_MS - 1)
  await feed.refresh(ok('not json'), file(text), C.parseConsole, NOW)
  const stale = feed.current(NOW)
  assert.equal(stale.sources.cards.state, 'stale')
  await feed.refresh(ok(text), file(null), C.parseConsole, NOW + F.CONSOLE_EVERY_MS)
  const command = feed.current(NOW + F.CONSOLE_EVERY_MS)
  assert.notEqual(command, stale)
  assert.equal(command.sources.cards.state, 'ok')
  await feed.refresh(ok('not json'), file(text), C.parseConsole, NOW + 2 * F.CONSOLE_EVERY_MS)
  assert.notEqual(feed.current(NOW + 2 * F.CONSOLE_EVERY_MS), command)
  assert.equal(feed.current(NOW + 2 * F.CONSOLE_EVERY_MS).sources.cards.state, 'stale')
})

test('m: fresh -> stale changes current() once even when the fallback JSON is unchanged', async () => {
  const feed = F.makeConsoleFeed()
  const readFile = file(snapText(NOW))
  await feed.refresh(ok('not json'), readFile, C.parseConsole, NOW)
  const fresh = feed.current(NOW)
  const boundary = NOW + F.CONSOLE_STALE_MS
  assert.equal(feed.current(boundary), fresh)
  assert.equal(await feed.refresh(ok('not json'), readFile, C.parseConsole, boundary + 1), true)
  const stale = feed.current(boundary + 1)
  assert.notEqual(stale, fresh)
  assert.equal(stale.sources.cards.state, 'stale')
  assert.equal(await feed.refresh(ok('not json'), readFile, C.parseConsole, boundary + F.CONSOLE_EVERY_MS + 1), true)
  assert.equal(feed.current(boundary + F.CONSOLE_EVERY_MS + 1), stale)
})

// Execute the shipped function with an injected engine, without loading the UI module or a real command/file.
const consoleSourceFor = feed => {
  const { stripTypeScriptTypes } = require('node:module')
  const source = fs.readFileSync(path.join(__dirname, 'register.ts'), 'utf8')
  const start = source.indexOf('async function consoleSource(')
  const end = source.indexOf('\nasync function consoleTick(', start)
  assert.ok(start >= 0 && end > start, 'the production consoleSource function is present')
  const body = stripTypeScriptTypes(source.slice(start, end))
  return new Function('consoleFeed', 'CONSOLE_FILE', 'CONSOLE_TIMEOUT_MS', 'parseConsole', 'readText',
    body + '\nreturn consoleSource')(feed, F.CONSOLE_FILE, F.CONSOLE_TIMEOUT_MS, C.parseConsole, ($, p) => $.fs.read(p))
}
const flushRefresh = () => new Promise(resolve => setImmediate(resolve))

test('n: consoleSource does not invalidate after null -> null or unchanged command/fallback refreshes', async () => {
  for (const origin of ['none', 'command', 'file']) {
    const source = consoleSourceFor(F.makeConsoleFeed())
    let now = NOW
    const invalidations = []
    const $ = {
      clock: { now: async () => now }, env: { get: async () => '/synthetic-home' },
      process: { run: ok(origin === 'command' ? snapText(NOW) : 'not json') },
      fs: { read: file(origin === 'file' ? snapText(NOW) : null) },
      ui: { invalidate: name => invalidations.push(name) },
    }
    await source($)
    await flushRefresh()
    assert.deepEqual(invalidations, origin === 'none' ? [] : ['ui.render'], origin)
    invalidations.length = 0
    now += F.CONSOLE_EVERY_MS
    await source($)
    await flushRefresh()
    assert.deepEqual(invalidations, [], origin)
  }
})

test('o: consoleSource invalidates once when the fallback crosses the stale boundary during refresh', async () => {
  const feed = F.makeConsoleFeed()
  const readFile = file(snapText(NOW))
  await feed.refresh(ok('not json'), readFile, C.parseConsole, NOW)
  const source = consoleSourceFor(feed)
  let now = NOW + F.CONSOLE_STALE_MS
  const invalidations = []
  const $ = {
    clock: { now: async () => now }, env: { get: async () => '/synthetic-home' },
    process: { run: async () => { now++; return { exitCode: 1, stdout: '' } } },
    fs: { read: readFile }, ui: { invalidate: name => invalidations.push(name) },
  }
  await source($)
  await flushRefresh()
  assert.deepEqual(invalidations, ['ui.render'])
  now += F.CONSOLE_EVERY_MS
  await source($)
  await flushRefresh()
  assert.deepEqual(invalidations, ['ui.render'])
})
