// mods/live/decide-batch.test.ts — answering several 待決 cards in a row: stable focus keys, focus and scroll that follow the next card, numbers that never renumber,
// answered cards that stay greyed. Pure half (decidebatch.ts + decideTabLines); fake cards only. Each test was red on the stub before the bodies were written.
import { test, expect } from 'claude-code/testing'
import { makeT } from './i18n'
import { NO_DECIDE, NO_DETAIL, NO_SECTIONS } from './model'
import type { DecideView, LiveDecision, LiveSnapshot, PaneLine } from './model'
import { decideTabLines } from './tabs'
import { NO_BATCH, SUBMIT_KEY, answerPlan, batchSync, optKey, rowOfKey } from './decidebatch'
import type { DecideBatch } from './decidebatch'

const zh = makeT('zh-TW')
const dec = (id: string, question: string, over: Partial<LiveDecision> = {}): LiveDecision => ({
  id, question, background: null, options: [{ label: 'Alpha', description: '' }, { label: 'Beta', description: '' }], recommendation: null, why: null, blocks: null, not_authorized: null, source: null,
  opened_at: null, stale: false, age_s: 60, orphaned: false, origin: null, ...over,
})
const fakes = (n: number): LiveDecision[] => Array.from({ length: n }, (_, i) => dec('d-fake' + i, 'Fake question ' + (i + 1)))
const snapOf = (pending: LiveDecision[]): LiveSnapshot => ({
  state: 'ok', text: '', header: 'h', metrics: { ctx: '37%' },
  band: { kind: 'decide', key: 'warning', why: 'r', verdictReason: null, mark: '▲', verdict: 'v', head: '', progress: '—', progressDim: false, reason: null, project: 'repo', elapsed: '10m', phase: '—', slots: [] },
  pending, project_key: null, root_run_id: null, link: null, rows: [], gates: null, sections: NO_SECTIONS, review: null, published_at: null, session_as_of: null, host_as_of: null,
  detail: { ...NO_DETAIL, now_ms: 1, counts: { confirmed_live: 0, exited: 0, unknown: 0 } }, activity: [], recent: [],
}) as never

// A small stand-in for the shell: it holds the picks and the batch, draws the cards lines the way the pane does, and applies the plan after each answer.
class Session {
  st = { ...NO_DECIDE }
  batch: DecideBatch = NO_BATCH
  offset = 0
  room = 12
  constructor(public pending: LiveDecision[]) { this.sync() }
  sync(): void { this.batch = batchSync(this.batch, this.pending, this.st) }
  view(): DecideView { return { ...this.st, inputs: true, batch: this.batch } }
  lines(): PaneLine[] { return decideTabLines(snapOf(this.pending), { t: zh, cols: 76, expanded: new Set(), folded: new Set(), decide: this.view() }).filter(l => l.bar !== true) }
  texts(): string[] { return this.lines().map(l => l.text.trimEnd()) }
  answer(id: string, k = 0): { focus: string; offset: number } {
    this.st = { ...this.st, picks: { ...this.st.picks, [id]: k } }
    this.sync()
    const plan = answerPlan({ lines: this.lines(), batch: this.batch, pending: this.pending, st: this.st, answered: id, offset: this.offset, room: this.room })
    this.offset = plan.offset
    return plan
  }
  titles(): string[] { return this.texts().filter(x => /^[▲✓●◌○·◆] \d+\. /u.test(x) || /^\S+ \d+\. /u.test(x)) }
  greyed(): number { return this.lines().filter(l => l.kind === 'item' && l.segs !== undefined && l.segs.some(s => s.role === 'title') && l.segs.filter(s => s.role === 'title').every(s => s.dim === true)).length }
}

test('DECIDE batch (1) stable keys: an option key names its card id and option number, never a position, so it survives the cards above it changing', () => {
  expect(optKey('d-fake3', 1)).toBe('opt:d-fake3:1')
  // the same card keeps the same keys whether or not the cards before it are still pending
  const all = new Session(fakes(4))
  const before = all.lines().flatMap(l => l.segs ?? []).flatMap(s => (s.press === undefined ? [] : [s.press]))
  expect(before).toContain('pick:d-fake3:1')
  const keyRow = rowOfKey(all.lines(), optKey('d-fake3', 0))
  expect(keyRow, 'the row of an option key is found in the card lines').toBeGreaterThan(0)
  expect(all.lines()[keyRow].segs?.some(s => s.press === 'pick:d-fake3:0')).toBe(true)
})

test('DECIDE batch (1) after an answer the focus goes to the first option of the NEXT card, and past the last card to the send row', () => {
  const s = new Session(fakes(3))
  expect(s.answer('d-fake0').focus).toBe('opt:d-fake1:0')
  expect(s.answer('d-fake1').focus).toBe('opt:d-fake2:0')
  expect(s.answer('d-fake2').focus).toBe(SUBMIT_KEY)
  // answering out of order: the next unanswered card after it, else the first unanswered one before it
  const o = new Session(fakes(3))
  expect(o.answer('d-fake1').focus).toBe('opt:d-fake2:0')
  expect(o.answer('d-fake2').focus).toBe('opt:d-fake0:0')
})

test('DECIDE batch (2) scroll anchoring: the next card takes the place of the answered one, and the focused option is always inside the window', () => {
  const s = new Session(fakes(8))
  const rowOfTitle = (n: number): number => s.texts().findIndex(x => x.includes('. Fake question ' + n))
  for (let i = 0; i < 7; i++) {
    const was = rowOfTitle(i + 1) - s.offset // where the answered card's title stands on screen
    const plan = s.answer('d-fake' + i)
    const lines = s.lines()
    const total = lines.length
    expect(plan.offset, 'never past the end of the content').toBeLessThanOrEqual(Math.max(0, total - s.room))
    const focusRow = rowOfKey(lines, plan.focus)
    expect(focusRow, 'the focused option is in the window after answer ' + (i + 1)).toBeGreaterThanOrEqual(plan.offset)
    expect(focusRow).toBeLessThan(plan.offset + s.room)
    const now = rowOfTitle(i + 2) - plan.offset
    if (plan.offset < Math.max(0, total - s.room)) expect(now, 'the next card stands where the answered one stood (answer ' + (i + 1) + ')').toBe(was)
  }
})

test('DECIDE batch (3) numbering is assigned once per batch and does not renumber when an earlier card is answered or leaves the list', () => {
  const s = new Session(fakes(3))
  expect(s.titles().map(x => x.replace(/^\S+ /, '').split('. ')[0])).toEqual(['1', '2', '3'])
  s.answer('d-fake0')
  expect(s.texts().some(x => x.includes('2. Fake question 2'))).toBe(true)
  // the session closes card 1: it leaves pending, the other numbers stay
  s.pending = s.pending.filter(d => d.id !== 'd-fake0')
  s.sync()
  expect(s.texts().some(x => x.includes('1. Fake question 1')), 'the answered card stays in place after it left pending').toBe(true)
  expect(s.texts().some(x => x.includes('2. Fake question 2'))).toBe(true)
  expect(s.texts().some(x => x.includes('3. Fake question 3'))).toBe(true)
  // a card that arrives later takes the next number, never a freed one
  s.pending = [...s.pending, dec('d-fake9', 'Fake question late')]
  s.sync()
  expect(s.texts().some(x => x.includes('4. Fake question late'))).toBe(true)
})

test('DECIDE batch (4) an answered card stays, greyed, shows the chosen answer, takes no focus, and leaves when the batch closes', () => {
  const s = new Session(fakes(3))
  s.answer('d-fake0', 1)
  expect(s.greyed()).toBe(1)
  const t = s.texts()
  const i = t.findIndex(x => x.includes('1. Fake question 1'))
  expect(t[i + 1], 'the chosen answer is shown on the card').toContain('Beta')
  const presses = s.lines().slice(i, i + 3).flatMap(l => l.segs ?? []).filter(x => x.press !== undefined)
  expect(presses, 'no pressable option and no field on an answered card').toEqual([])
  expect(s.lines().some(l => l.field?.key === 'note:d-fake0')).toBe(false)
  expect(s.lines().some(l => l.field?.key === 'note:d-fake1')).toBe(true)
  // the batch closes (nothing pending): the answered cards go, and the next batch counts from 1 again
  s.pending = []
  s.sync()
  expect(s.batch).toEqual(NO_BATCH)
  s.pending = [dec('d-new', 'Fake question new')]
  s.sync()
  expect(s.texts().some(x => x.includes('1. Fake question new'))).toBe(true)
})

test('DECIDE batch: answer 8 cards in a row — focus, scroll, numbering and the greyed count after every answer', () => {
  const s = new Session(fakes(8))
  const seen: string[] = []
  for (let i = 0; i < 8; i++) {
    const plan = s.answer('d-fake' + i)
    seen.push(plan.focus)
    expect(plan.focus, 'focus after answer ' + (i + 1)).toBe(i < 7 ? 'opt:d-fake' + (i + 1) + ':0' : SUBMIT_KEY)
    expect(s.greyed(), 'greyed count after answer ' + (i + 1)).toBe(i + 1)
    expect(s.texts().filter(x => /\d+\. Fake question \d+$/.test(x)).map(x => Number(x.split('. ')[0].replace(/^\S+ /, ''))), 'numbering after answer ' + (i + 1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    const total = s.lines().length
    expect(plan.offset, 'scroll in range after answer ' + (i + 1)).toBeGreaterThanOrEqual(0)
    expect(plan.offset).toBeLessThanOrEqual(Math.max(0, total - s.room))
    if (i < 7) {
      const r = rowOfKey(s.lines(), plan.focus)
      expect(r >= plan.offset && r < plan.offset + s.room, 'focus row ' + r + ' inside window at ' + plan.offset).toBe(true)
    }
  }
  expect(seen.length).toBe(8)
  expect(s.batch.order.length).toBe(8)
})
