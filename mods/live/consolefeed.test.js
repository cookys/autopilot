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

test('a: the command succeeds -> snapshot from the command, source ok; a second call within 60 s does not run it again', async () => {
  const feed = F.makeConsoleFeed()
  const run = calls(ok(snapText(NOW)))
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW), true)
  assert.deepEqual(run.argv, ['fleet', 'console', '--json'])
  const s = feed.current(NOW)
  assert.equal(s.sources.cards.state, 'ok')
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW + 59_000), false)
  assert.equal(run.n, 1)
  assert.equal(feed.current(NOW + 59_000), s)
  assert.equal(await feed.refresh(run, file(null), C.parseConsole, NOW + 60_000), true)
  assert.equal(run.n, 2)
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
