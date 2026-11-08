// mods/live/consolepages.test.js — C1 U6: the console pane's team / quota / hosts skeleton pages (consolepages.ts). Pure: imports the real consolepages.ts, console.ts and i18n.ts under node
// (consolestrip.golden.js registers the one-line `.ts` resolve hook). Run: node --test mods/live/consolepages.test.js   (also run by run-tests.sh)
// Negative controls: the red light is the fixture with its `lines` deleted (the team page must say 無來源, not draw an empty table); a source flipped to no_source, a source key removed and a
// snapshot of null each must give the same word; a page with data must NOT say it (so a constant "no source" is red); `band.tsx` carries no `$` amount.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const G = require('./consolestrip.golden.js')

let C
let P
let tZh
let tEn
test.before(async () => {
  const loaded = await G.load()
  tZh = loaded.i18n.makeT('zh-TW')
  tEn = loaded.i18n.makeT('en')
  C = await import(path.join(__dirname, 'console.ts'))
  P = await import(path.join(__dirname, 'consolepages.ts'))
})
const FIX = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'console', name), 'utf8')
const parseRaw = raw => C.parseConsole(JSON.stringify(raw))
const FULL = () => JSON.parse(FIX('c0/console-full.json'))
const NO_SOURCE = '無來源'

test('with data: each page is one summary line from counts.summary, in both locales', () => {
  const snap = parseRaw(FULL())
  assert.deepEqual(P.consolePage(snap, 'team', tZh), { kind: 'summary', lines: ['團隊：進行中 2　等待 1　卡住 3'] })
  assert.deepEqual(P.consolePage(snap, 'quota', tZh), { kind: 'summary', lines: ['額度：風險 2 項　最差的池 pool-b'] })
  assert.deepEqual(P.consolePage(snap, 'hosts', tZh), { kind: 'summary', lines: ['主機：在線 2/3　GPU 忙 5/7'] })
  assert.deepEqual(P.consolePage(snap, 'team', tEn).lines, ['Team: running 2, waiting 1, stalled 3'])
  assert.deepEqual(P.consolePage(snap, 'hosts', tEn).lines, ['Hosts: online 2/3, GPU busy 5/7'])
  for (const tab of ['team', 'quota', 'hosts']) assert.notEqual(P.consolePage(snap, tab, tZh).kind, 'no_source', tab + ' has data and says so')
})
test('quota without a worst pool says only the risk count', () => {
  const raw = FULL()
  raw.counts.summary.quota_worst = null
  assert.deepEqual(P.consolePage(parseRaw(raw), 'quota', tZh).lines, ['額度：風險 2 項'])
})
test('red light: the fixture with its `lines` deleted gives 無來源 on the team page, not an empty table', () => {
  const raw = FULL()
  delete raw.lines
  const page = P.consolePage(parseRaw(raw), 'team', tZh)
  assert.deepEqual(page, { kind: 'no_source', lines: [NO_SOURCE] })
  console.log('red-light team page without lines: ' + page.lines.join('|'))
  // the other two pages do not read `lines`
  assert.equal(P.consolePage(parseRaw(raw), 'hosts', tZh).kind, 'summary')
})
test('sources.<k>.state = no_source, or the source missing, or no snapshot: the page says 無來源 and draws nothing else', () => {
  for (const [tab, key] of [['team', 'tasks'], ['quota', 'quota_now'], ['hosts', 'hosts']]) {
    const flipped = FULL()
    flipped.sources[key] = { state: 'no_source' }
    assert.deepEqual(P.consolePage(parseRaw(flipped), tab, tZh), { kind: 'no_source', lines: [NO_SOURCE] }, tab + ' no_source')
    const missing = FULL()
    delete missing.sources[key]
    assert.deepEqual(P.consolePage(parseRaw(missing), tab, tZh), { kind: 'no_source', lines: [NO_SOURCE] }, tab + ' key missing')
    assert.deepEqual(P.consolePage(null, tab, tZh), { kind: 'no_source', lines: [NO_SOURCE] }, tab + ' null snapshot')
  }
  const sourceless = C.parseConsole(FIX('no-source.json'))
  for (const tab of ['team', 'quota', 'hosts']) assert.equal(P.consolePage(sourceless, tab, tZh).lines.length === 1 && P.consolePage(sourceless, tab, tZh).kind !== 'summary', true, tab + ' in no-source.json')
  console.log('no_source pages: ' + ['team', 'quota', 'hosts'].map(tab => P.consolePage(sourceless, tab, tZh).lines[0]).join('|'))
})
test('an expired source says 過期 and draws no content; a stale one still draws', () => {
  const stale = parseRaw(JSON.parse(FIX('c0/console-stale.json')))
  assert.deepEqual(P.consolePage(stale, 'hosts', tZh), { kind: 'expired', lines: ['過期'] }) // hosts is expired in this fixture
  assert.equal(P.consolePage(stale, 'team', tZh).kind, 'summary') // tasks is only stale
})
test('band.tsx carries no `$` amount (plan §2.5: no money on the band): no `$` outside a // comment, and none in any locale text the band draws', () => {
  const code = fs.readFileSync(path.join(__dirname, 'band.tsx'), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  assert.equal(code.includes('$'), false)
  for (const f of ['locales/en.json', 'locales/zh-TW.json']) for (const [id, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')))) if (id.startsWith('console.')) assert.equal(v.includes('$'), false, id)
})
test('control: a band source with a dollar amount in it is caught by the same check', () => {
  const code = 'const x = "$12.40"'.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  assert.equal(code.includes('$'), true)
})
