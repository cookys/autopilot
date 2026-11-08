// mods/live/commandtab.test.js — C1 U5: the operator console's 指揮 page builder (commandtab.ts). Imports the REAL commandtab.ts / tabs.ts under node (consolestrip.golden.js registers the one-line `.ts`
// resolve hook); the snapshots are fixtures (c0/console-full.json etc.), injected into the pure builder. Run: node --test mods/live/commandtab.test.js   (also run by run-tests.sh)
// Negative controls: flipping one exception's to_console to false removes its row; a mirror card never enters the queue; a stale / expired source is drawn as such, not as fresh.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const G = require('./consolestrip.golden.js')

let C
let V
let I
test.before(async () => {
  const loaded = await G.load()
  I = loaded.i18n
  C = await import(path.join(__dirname, 'console.ts'))
  V = await import(path.join(__dirname, 'commandtab.ts'))
})
const FIX = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'console', name), 'utf8')
const FULL = () => C.parseConsole(FIX('c0/console-full.json'))
const NOW = 1794200000000
const HELD = { id: 'd-fx000001', title: null, question: '記憶線：測試綠了，合併到 develop 嗎？', background: 'fixture：--no-ff，測試在 tip 全綠。', options: [{ label: '准合併', description: '' }, { label: '再看 diff', description: '' }], recommendation: '准合併', why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 7200 }
const LIVE = { pending: [HELD] }
const rows = (v, which) => v[which].map(l => (l.segs === undefined ? l.text : l.segs.map(s => s.text).join('')))
const view = (con, { cols = 120, locale = 'zh-TW', live = LIVE, folded } = {}) => V.commandView(con, live, { t: I.makeT(locale), cols, ...(folded === undefined ? {} : { folded }) }, NOW)
const width = s => [...s].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0)

test('page order: summary, exceptions, queue, then the fixed bottom (hint, data age); the order never changes', () => {
  const v = view(FULL())
  const body = rows(v, 'body')
  const at = needle => body.findIndex(r => r.includes(needle))
  assert.ok(at('產線') === 0, 'the summary line comes first: ' + body[0])
  assert.ok(at('例外') > 0 && at('待決') > at('例外'), 'exceptions before the queue')
  const bar = rows(v, 'bar')
  assert.ok(bar[bar.length - 1].startsWith('資料'), 'the data-age line is the last bar row: ' + bar[bar.length - 1])
})

test('summary: every figure comes from counts (running 2, waiting 1, stalled 3, hosts 2/3, gpu 5/7, quota worst, hints 2)', () => {
  const s = rows(view(FULL()), 'body')[0]
  for (const part of ['2', '1', '3', '在線 2/3', 'GPU 忙 5/7', 'pool-b', '改善 2']) assert.ok(s.includes(part), part + ' in ' + s)
})

test('exceptions: only to_console === true rows (quota + exceptions); a card item never; the T7 own-card exception is drawn', () => {
  const body = rows(view(FULL()), 'body').join('\n')
  for (const t of ['B 池重置前用完', '遊戲線一件工作遺失', '倉儲線自己開了卡']) assert.ok(body.includes(t), t)
  assert.ok(!body.includes('遊戲線閒置 50 分'), 'to_console false: not drawn')
  assert.ok(!body.includes('fleet 線一件工作疑似卡住'), 'to_console false: not drawn')
  assert.ok(!body.includes('GPU lead 證據時間少'), 'a hint is not an exception')
})

test('negative control: flipping one exception to_console to false removes it from the page (red before green)', () => {
  const con = FULL()
  const target = con.items.find(i => i.id.startsWith('exc:T6:'))
  assert.ok(rows(view(con), 'body').join('\n').includes('下一格沒有 preflight'), 'drawn while to_console is true')
  target.to_console = false
  assert.ok(!rows(view(con), 'body').join('\n').includes('下一格沒有 preflight'), 'gone once to_console is false')
  target.to_console = true
  assert.ok(rows(view(con), 'body').join('\n').includes('下一格沒有 preflight'), 'back when restored')
})

test('queue: the held card is a full card (options), the others are plain rows; the waiting_step card has the report Button that fills, never submits', () => {
  const v = view(FULL())
  const body = rows(v, 'body')
  assert.ok(body.some(r => r.includes('准合併')), 'the held card shows its options')
  assert.ok(body.some(r => r.includes('評測機第二槽插電') && r.includes('等你做完')), 'waiting_step row says what it waits for')
  assert.ok(body.some(r => r.includes('語音線轉述') && r.includes('待你確認')), 'relayed_unconfirmed row')
  const press = v.body.flatMap(l => (l.segs ?? []).map(s => s.press)).filter(p => p !== undefined)
  assert.ok(press.includes(V.FILL_PRESS + 'd-fx000002'), 'the report press carries fill:<id>: ' + press.join(','))
  assert.equal(body.filter(r => r.includes('d-fx000001')).length, 0, 'no raw id drawn on a card row')
})

test('queue count is counts.decisions, not a count of rows', () => {
  const con = FULL()
  con.counts.decisions = 7
  const head = rows(view(con), 'body').find(r => r.includes('待決'))
  assert.ok(head.includes('7'), head)
})

test('a card of another host (the mirror) is not in the queue: no card items are drawn from items, only cards[]', () => {
  const con = FULL()
  con.items.push({ id: 'card:d-other-host', kind: 'card', severity: 1, state: 'need_you', needs_operator: true, title: '別台的卡', text: '別台的卡全文', since_ms: NOW - 1000, line_id: null, to_console: null, answerable_by: [] })
  assert.ok(!rows(view(con), 'body').join('\n').includes('別台的卡'))
})

test('data age: fresh sources say their age, expired says 過期, no_source says 無來源; the line fits every width', () => {
  const con = FULL()
  const full = rows(view(con), 'bar').pop()
  assert.ok(full.startsWith('資料 ') && full.includes('卡 ') && full.includes('額度 '), full)
  con.sources.cards = { at_ms: NOW - 20 * 60000, state: 'expired' }
  assert.ok(rows(view(con), 'bar').pop().includes('卡 過期'))
  con.sources.cards = { at_ms: NOW - 90000, state: 'stale' }
  assert.ok(rows(view(con), 'bar').pop().includes('卡 1 分前'))
  // the rows this page makes (the held card's own rows are decideCards', the 待決 tab's, drawn truncated by the pane)
  for (const cols of [120, 80, 20]) for (const l of [...rows(view(FULL(), { cols, live: null }), 'body'), ...rows(view(FULL(), { cols, live: null }), 'bar')]) assert.ok(width(l) <= cols - 1, cols + ': ' + l)
})

test('stale fixture: hosts empty but expired draws 過期 where the figures were', () => {
  const con = C.parseConsole(FIX('c0/console-stale.json'))
  assert.ok(rows(view(con), 'body')[0].includes('主機 過期') || rows(view(con), 'bar').join('\n').includes('主機 過期'), rows(view(con), 'body')[0])
})

test('empty fixture: the queue and the exceptions say there is nothing, not a blank section', () => {
  const con = C.parseConsole(FIX('c0/console-empty.json'))
  const body = rows(view(con, { live: null }), 'body').join('\n')
  assert.ok(body.includes('目前沒有要你處理的例外') && body.includes('目前沒有待你回答的問題'), body)
})

test('folding: a folded exceptions section hides its rows and keeps its header', () => {
  const v = view(FULL(), { folded: new Set([V.COMMAND_EXC_ID]) })
  const body = rows(v, 'body').join('\n')
  assert.ok(body.includes('例外') && !body.includes('遊戲線一件工作遺失'))
})

test('no raw member address, IP or login name is drawn anywhere on the page, both locales and all widths', () => {
  for (const locale of ['en', 'zh-TW']) for (const cols of [120, 80, 20]) {
    const text = [...rows(view(FULL(), { cols, locale }), 'body'), ...rows(view(FULL(), { cols, locale }), 'bar')].join('\n')
    assert.ok(!/[\w-]+\/[\w-]+\/[\w-]+--?[\w-]*/.test(text) && !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(text) && !text.includes('fx-host'), locale + cols + ' ' + text)
  }
})

test('the module copy of console-full.json (for the plugin-test drawing test) equals the official JSON', async () => {
  const src = FIX('console-full.fixture.ts').replace(/^\/\/.*\n/, '').replace(/^export default /, '')
  assert.deepEqual(JSON.parse(src), JSON.parse(FIX('c0/console-full.json')))
})
