// mods/live/consolestrip.test.js — C1 U4: the operator-console tab strip (consoletabs.ts), the console.json mode finder (console.ts findConsoleMode) and the golden that pins the NON-console strips.
// Imports the REAL tabs.ts / consoletabs.ts / console.ts under node (consolestrip.golden.js registers a one-line `.ts` resolve hook). Run: node --test mods/live/consolestrip.test.js   (also run by run-tests.sh)
// Negative controls: "control:" cases turn the console mode on (a config the real finder accepts) and the golden comparison must go red; planted bad configs must leave the mode off; a mutation of
// consoletabs.ts (a badge dropped at the wrong width, the 20-column totals changed) turns the snapshots red.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const G = require('./consolestrip.golden.js')

let C
let CT
let I
test.before(async () => {
  const loaded = await G.load()
  I = loaded.i18n
  C = await import(path.join(__dirname, 'console.ts'))
  CT = await import(path.join(__dirname, 'consoletabs.ts'))
})
const FIX = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'console', name), 'utf8')
const FULL = () => C.parseConsole(FIX('c0/console-full.json'))
const GOLDEN = () => JSON.parse(FIX('golden-strip-nonconsole.json'))
const PROGRAM = '{"schema":"autopilot.console/1","mode":"program"}'

// ---- the mode finder: only the exact config opens the console; every other case is "as before" ----
const fsOf = files => async p => (Object.hasOwn(files, p) ? files[p] : null)
test('mode: no config file, a broken file, a foreign schema and any other mode leave the console off', async () => {
  const repo = { '/r/.git/HEAD': 'ref: refs/heads/x\n' }
  assert.equal(await C.findConsoleMode('/r', fsOf(repo)), false, 'no config file')
  assert.equal(await C.findConsoleMode('/r', fsOf({ ...repo, '/r/.claude/console.json': '{not json' })), false, 'broken JSON')
  assert.equal(await C.findConsoleMode('/r', fsOf({ ...repo, '/r/.claude/console.json': '{"schema":"other/1","mode":"program"}' })), false, 'schema is not autopilot.console/1')
  assert.equal(await C.findConsoleMode('/r', fsOf({ ...repo, '/r/.claude/console.json': '{"schema":"autopilot.console/1","mode":"team"}' })), false, 'mode is not program')
  assert.equal(await C.findConsoleMode('/r', fsOf({ ...repo, '/r/.claude/console.json': '{"schema":"autopilot.console/1"}' })), false, 'no mode')
  assert.equal(await C.findConsoleMode('/nowhere/deep', fsOf({})), false, 'no repo at all')
})
test('mode: the exact config opens it, from a subdirectory too; a parent repo\'s file is never borrowed', async () => {
  const repo = { '/r/.git/HEAD': 'x', '/r/.claude/console.json': PROGRAM }
  assert.equal(await C.findConsoleMode('/r', fsOf(repo)), true)
  assert.equal(await C.findConsoleMode('/r/a/b', fsOf(repo)), true, 'walks up to the first .git')
  const nested = { '/r/.git/HEAD': 'x', '/r/.claude/console.json': PROGRAM, '/r/sub/.git': 'gitdir: /somewhere\n' }
  assert.equal(await C.findConsoleMode('/r/sub/deep', fsOf(nested)), false, 'the nearest .git (a gitfile) is the repo; the parent\'s console.json is not borrowed')
})

// ---- the non-console strips are byte-identical to the golden made on the base tree ----
test('golden: without the config the pane and band strips at 120 / 80 / 20 columns equal the base tree\'s (both locales, with and without something waiting)', async () => {
  const now = await G.render()
  assert.deepEqual(Object.keys(now), Object.keys(GOLDEN()))
  assert.deepEqual(now, GOLDEN())
  assert.ok(Object.keys(now).length >= 36, 'the golden covers pane and band at three widths')
})
test('control: with the config in place (the real finder says on) the same comparison goes red', async () => {
  const on = await C.findConsoleMode('/r', fsOf({ '/r/.git/HEAD': 'x', '/r/.claude/console.json': PROGRAM }))
  assert.equal(on, true)
  const snap = FULL()
  const now = await G.render(on ? { pane: { snap, tab: 'command' }, band: { snap, tab: 'command', cols: 120 } } : {})
  assert.notDeepEqual(now, GOLDEN())
  const golden = GOLDEN()
  const differing = Object.keys(now).filter(k => JSON.stringify(now[k]) !== JSON.stringify(golden[k]))
  assert.ok(differing.some(k => k.startsWith('pane/')) && differing.some(k => k.startsWith('band/')), 'both the pane strip and the band strip change')
})

// ---- the console strip: five tabs, badges from counts.tabs, given up from the tail ----
const T_ZH = () => I.makeT('zh-TW')
const labels = strip => strip.tabs.map(x => x.label.text)
const paneAt = async (cols, tab = 'command', snap = FULL()) => (await G.load()).tabs.stripOf(null, { t: T_ZH(), cols }, tab, true, { snap, tab })
const bandAt = async (cols, tab = 'command', snap = FULL()) => (await G.load()).tabs.barStrip(null, T_ZH(), tab, null, true, { snap, tab, cols })

test('console strip 120: five tabs, each with its two most severe non-zero badges (the c0 console-full counts)', async () => {
  const s = await paneAt(120)
  assert.deepEqual(labels(s), [' 指揮 ▲ 4  ✗ 3 ', ' 團隊 ✗ 2  ⊘ 4 ', ' 額度 ✗ 1  △ 2 ', ' 主機 ⊘ 1 ', ' 本席 '])
  assert.deepEqual(s.tabs.map(x => x.id), ['command', 'team', 'quota', 'hosts', 'self'])
  assert.equal(s.exact, true)
})
test('console strip 80: the △ is given up, ▲N and ✗N stay', async () => {
  const s = await paneAt(80)
  assert.deepEqual(labels(s), [' 指揮 ▲ 4  ✗ 3 ', ' 團隊 ✗ 2  ⊘ 4 ', ' 額度 ✗ 1 ', ' 主機 ⊘ 1 ', ' 本席 '])
  assert.ok(!labels(s).join('').includes('△'))
})
test('console strip 20: the active page name and the program-wide ▲N ✗N (the sum over every page), nothing else', async () => {
  const snap = FULL()
  const sum = { need_you: 0, failed: 0 }
  for (const pairs of Object.values(snap.counts.tabs)) for (const [k, n] of pairs) if (k in sum) sum[k] += n
  assert.deepEqual(sum, { need_you: 4, failed: 6 }, 'the fixture sums as the test expects')
  for (const tab of ['command', 'quota', 'self']) {
    const s = await paneAt(20, tab)
    assert.deepEqual(labels(s), [' ' + T_ZH()('console.tab.' + tab) + ' ▲ 4  ✗ 6 '])
    assert.equal(s.exact, true, 'one row at 20 columns')
  }
})
test('console strip: at every width ▲N and ✗N are never given up, the strip is one row, and a drawn △ means room was left', async () => {
  const snap = FULL()
  for (let cols = 20; cols <= 140; cols++) {
    const s = await paneAt(cols, 'command', snap)
    assert.equal(s.exact, true, 'one row at ' + cols)
    const text = labels(s).join('')
    if (labels(s).length === 5) {
      assert.ok(text.includes('▲ 4') && text.includes('✗ 3') && text.includes('✗ 2') && text.includes('✗ 1'), 'every ▲ / ✗ of the five tabs is drawn at ' + cols)
      assert.equal(text.includes('△'), cols >= CT.CONSOLE_FULL_MIN_COLS, '△ only from the full width, at ' + cols)
    } else {
      assert.ok(text.includes('▲ 4') && text.includes('✗ 6'), 'the compact form keeps the totals at ' + cols)
    }
  }
})
test('console strip: a zero count is not drawn, only the first two non-zero entries are, and a state without a mark is skipped', () => {
  const snap = { counts: { tabs: { 指揮: [['need_you', 0], ['failed', 2], ['stalled', 5], ['findings', 7]], 團隊: [['mystery', 3], ['hint', 1]], 額度: [], 主機: [['stalled', 0]] } } }
  assert.deepEqual(CT.badgesOf(snap, 'command'), [{ mark: 'failed', n: 2 }, { mark: 'stalled', n: 5 }])
  assert.deepEqual(CT.badgesOf(snap, 'team'), [{ mark: 'findings', n: 1 }])
  assert.deepEqual(CT.badgesOf(snap, 'quota'), [])
  assert.deepEqual(CT.badgesOf(snap, 'hosts'), [])
  assert.deepEqual(CT.badgesOf(snap, 'self'), [])
  assert.deepEqual(CT.badgesOf(null, 'command'), [])
})
test('console strip: the ⊘ number goes before the ▲ / ✗ numbers, in the middle widths', async () => {
  const s = await paneAt(60)
  assert.deepEqual(labels(s), [' 指揮 ▲ 4  ✗ 3 ', ' 團隊 ✗ 2  ⊘ ', ' 額度 ✗ 1 ', ' 主機 ⊘ ', ' 本席 '])
})
test('console strip: no source (null snapshot) draws the five names with no badge', async () => {
  const s = await paneAt(120, 'command', null)
  assert.deepEqual(labels(s), [' 指揮 ', ' 團隊 ', ' 額度 ', ' 主機 ', ' 本席 '])
})
test('console tabs: the list has no 待決 / 用量 / 艦隊 (in either locale) and none of their ids', async () => {
  for (const locale of ['zh-TW', 'en']) {
    const t = I.makeT(locale)
    const { tabs } = await G.load()
    for (const cols of [120, 80, 20]) {
      const s = tabs.stripOf(null, { t, cols }, 'command', true, { snap: FULL(), tab: 'command' })
      const text = labels(s).join('')
      for (const banned of ['待決', '用量', '艦隊', 'Decide', 'Usage', 'Fleet']) assert.ok(!text.includes(banned), banned + ' in ' + locale + ' ' + cols)
      for (const x of s.tabs) assert.ok(['command', 'team', 'quota', 'hosts', 'self'].includes(x.id), x.id)
    }
    const b = tabs.barStrip(null, t, 'command', null, true, { snap: FULL(), tab: 'command', cols: 120 })
    assert.deepEqual(b.tabs.map(x => x.id), ['command', 'team', 'quota', 'hosts', 'self'])
  }
  assert.deepEqual([...CT.CONSOLE_TABS], ['command', 'team', 'quota', 'hosts', 'self'])
})
test('console band: the same five tabs and badges as the pane; narrow it falls to the compact form; the forge tab stays after them', async () => {
  const wide = await bandAt(120)
  assert.deepEqual(wide.tabs.map(x => x.label.text), [' 指揮 ▲ 4  ✗ 3 ', ' 團隊 ✗ 2  ⊘ 4 ', ' 額度 ✗ 1  △ 2 ', ' 主機 ⊘ 1 ', ' 本席 '])
  const narrow = await bandAt(20)
  assert.deepEqual(narrow.tabs.map(x => x.label.text), [' 指揮 ▲ 4  ✗ 6 '])
  const { tabs } = await G.load()
  const withForge = tabs.barStrip(null, T_ZH(), 'command', 'ϟ', true, { snap: FULL(), tab: 'command', cols: 120 })
  assert.deepEqual(withForge.tabs.map(x => x.id), ['command', 'team', 'quota', 'hosts', 'self', 'forge'])
})
test('console nav: the active tab is the shared one, ⓘ steps through the five, a slot lands on 指揮 or 本席', async () => {
  const s = await paneAt(120, 'quota')
  assert.deepEqual(s.tabs.filter(x => x.on).map(x => x.id), ['quota'])
  const b = await bandAt(120, 'hosts')
  assert.equal(b.tabs.length, 5)
  assert.deepEqual(CT.CONSOLE_TABS.map(CT.nextConsoleTab), ['team', 'quota', 'hosts', 'self', 'command'])
  assert.equal(CT.consoleSlotTab('decisions'), 'command')
  for (const slot of ['verdict', 'position', 'unit', 'dispatch', 'review', 'spend', 'quota', 'hygiene']) assert.equal(CT.consoleSlotTab(slot), 'self')
})
