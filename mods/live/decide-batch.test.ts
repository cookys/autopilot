// mods/live/decide-batch.test.ts — answering several 待決 cards in a row: stable focus keys, focus and scroll that follow the next card, numbers that never renumber,
// answered cards that stay greyed. Pure half (decidebatch.ts + decideTabLines); fake cards only. Each test was red on the stub before the bodies were written.
import { test, expect } from 'claude-code/testing'
import { makeT } from './i18n'
import { NO_DECIDE, NO_DETAIL, NO_SECTIONS } from './model'
import type { DecideView, LiveDecision, LiveSnapshot, PaneLine } from './model'
import { decideTabLines } from './tabs'
import { NO_BATCH, SUBMIT_KEY, answerPlan, batchSync, focusRepair, inputsFor, noteKey, optKey, rowOfKey, submitSuccessor } from './decidebatch'
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
  inputs = true
  constructor(public pending: LiveDecision[]) { this.sync() }
  sync(): void { this.batch = batchSync(this.batch, this.pending, this.st, zh('decide.elsewhere')) }
  view(): DecideView { return { ...this.st, inputs: this.inputs, batch: this.batch } }
  lines(): PaneLine[] { return decideTabLines(snapOf(this.pending), { t: zh, cols: 76, expanded: new Set(), folded: new Set(), decide: this.view() }).filter(l => l.bar !== true) }
  texts(): string[] { return this.lines().map(l => l.text.trimEnd()) }
  // pick option k AND send it: since the undo window work a pick alone only selects (the card stays open); a card is answered, greyed in place, once it was sent
  answer(id: string, k = 0): { focus: string; offset: number } {
    this.st = { ...this.st, picks: { ...this.st.picks, [id]: k }, sent: { ...this.st.sent, [id]: 1 } }
    this.sync()
    const plan = answerPlan({ lines: this.lines(), batch: this.batch, pending: this.pending, st: this.st, answered: id, offset: this.offset, room: this.room })
    this.offset = plan.offset
    return plan
  }
  // another session or the CLI closes card `id`: it leaves pending; the shell repairs the focus it remembers
  closeElsewhere(id: string, focus: string): { focus: string | null; offset: number } | null {
    const prev = this.batch
    this.pending = this.pending.filter(d => d.id !== id)
    this.sync()
    const plan = focusRepair({ prev, batch: this.batch, focus, lines: this.lines(), pending: this.pending, st: this.st, offset: this.offset, room: this.room })
    if (plan !== null) this.offset = plan.offset
    return plan
  }
  // a typed-only card is sent (the submit button): the shell plans the successor of the card(s) newly sent
  send(ids: string[]): { focus: string; offset: number } | null {
    const at = submitSuccessor(this.pending, ids)
    this.st = { ...this.st, sent: { ...this.st.sent, ...Object.fromEntries(ids.map(i => [i, 1])) } }
    this.sync()
    if (at === null) return null
    const plan = answerPlan({ lines: this.lines(), batch: this.batch, pending: this.pending, st: this.st, answered: at, offset: this.offset, room: this.room })
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
  const presses = s.lines().slice(i, i + 4).flatMap(l => l.segs ?? []).filter(x => x.press !== undefined).map(x => x.press)
  expect(presses, 'no pressable option and no field on an answered card, only 改答案 (the pane lets a sent answer be corrected)').toEqual(['fix:d-fake0'])
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
    expect(plan.focus === SUBMIT_KEY || rowOfKey(s.lines(), plan.focus) >= 0, 'focus after sync ' + (i + 1) + ' is a drawn key or the send row: ' + plan.focus).toBe(true)
    if (i < 7) {
      const r = rowOfKey(s.lines(), plan.focus)
      expect(r >= plan.offset && r < plan.offset + s.room, 'focus row ' + r + ' inside window at ' + plan.offset).toBe(true)
    }
  }
  expect(seen.length).toBe(8)
  expect(s.batch.order.length).toBe(8)
})

test('DECIDE batch (A) a card closed elsewhere while it holds the focus: focus goes to the next open card, the closed card stays greyed in place, numbering holds', () => {
  const s = new Session(fakes(3))
  const plan = s.closeElsewhere('d-fake1', optKey('d-fake1', 0))
  expect(plan, 'the focused card left: a plan is made').not.toBeNull()
  expect((plan as { focus: string }).focus).toBe('opt:d-fake2:0')
  expect(s.greyed(), 'the closed card stays, greyed').toBe(1)
  const t = s.texts()
  const i = t.findIndex(x => x.includes('2. Fake question 2'))
  expect(i, 'it keeps its number and its place').toBeGreaterThan(0)
  expect(t[i + 1], 'it says it was answered elsewhere').toContain(zh('decide.elsewhere'))
  expect(s.lines().slice(i, i + 3).flatMap(l => l.segs ?? []).filter(x => x.press !== undefined)).toEqual([])
  // the focus was on the last card: the first open one before it
  const last = new Session(fakes(3))
  expect((last.closeElsewhere('d-fake2', optKey('d-fake2', 1)) as { focus: string }).focus).toBe('opt:d-fake0:0')
  // a card the focus is NOT on closing needs no repair
  const other = new Session(fakes(3))
  expect(other.closeElsewhere('d-fake2', optKey('d-fake0', 0))).toBeNull()
  // a note field is focus too
  const note = new Session(fakes(3))
  expect((note.closeElsewhere('d-fake0', noteKey('d-fake0')) as { focus: string }).focus).toBe('opt:d-fake1:0')
  // nothing left open: the send row
  const one = new Session(fakes(2))
  one.answer('d-fake0')
  expect((one.closeElsewhere('d-fake1', optKey('d-fake1', 0)) as { focus: string }).focus).toBe(SUBMIT_KEY)
})

test('DECIDE batch (B) a typed-only card submitted: the successor plan runs, even though the send button goes away', () => {
  const typed = (id: string, q: string): LiveDecision => dec(id, q, { options: [] })
  const s = new Session([typed('d-t0', 'Typed zero'), ...fakes(2)])
  s.st = { ...s.st, notes: { 'd-t0': 'my reply' } }
  const plan = s.send(['d-t0'])
  expect(plan, 'a typed-only card sent has a plan').not.toBeNull()
  expect((plan as { focus: string }).focus).toBe('opt:d-fake0:0')
  expect(s.greyed()).toBe(1)
  // everything else already answered: the submit button is gone, focus still goes to the successor (here the send row key)
  const all = new Session([typed('d-t0', 'Typed zero'), typed('d-t1', 'Typed one')])
  all.send(['d-t0'])
  expect((all.send(['d-t1']) as { focus: string }).focus).toBe(SUBMIT_KEY)
  // an option card sent after its pick was already planned at the pick: no second plan
  const picked = new Session(fakes(2))
  picked.answer('d-fake0')
  expect(picked.send(['d-fake0'])).toBeNull()
})

test('DECIDE batch (C) planning uses the same inputs flag the pane draws with, so note rows are counted in the offset', () => {
  expect(inputsFor('terminal')).toBe(true)
  expect(inputsFor('desktop')).toBe(true)
  expect(inputsFor('vscode')).toBe(true)
  expect(inputsFor('phone')).toBe(false)
  for (const inputs of [true, false]) {
    const s = new Session(fakes(8))
    s.inputs = inputs
    for (let i = 0; i < 7; i++) {
      const plan = s.answer('d-fake' + i)
      const lines = s.lines()
      const r = rowOfKey(lines, plan.focus)
      expect(r >= plan.offset && r < plan.offset + s.room, 'inputs ' + inputs + ': focus row ' + r + ' inside window at ' + plan.offset).toBe(true)
    }
  }
  // a free-text successor: its note field is in view after the answer when inputs are on, and the field exists only then
  const f = new Session([...fakes(3), dec('d-free', 'Free text card', { options: [] })])
  f.room = 6
  f.answer('d-fake0'); f.answer('d-fake1')
  const plan = f.answer('d-fake2')
  expect(plan.focus).toBe('note:d-free')
  const r = rowOfKey(f.lines(), plan.focus)
  expect(r, 'the note field is drawn when inputs are on').toBeGreaterThanOrEqual(0)
  expect(r >= plan.offset && r < plan.offset + f.room).toBe(true)
})

test('DECIDE batch: answer 8 cards in a row with a card closed elsewhere mid-batch and a text-only card in the middle', () => {
  const typed = dec('d-typed', 'Typed middle', { options: [] })
  const cards = [...fakes(4), typed, ...fakes(8).slice(4).map((d, i) => ({ ...d, id: 'd-late' + i, question: 'Late question ' + i }))]
  const s = new Session(cards) // 4 + 1 + 4 = 9 cards
  const room = s.room
  const check = (focus: string, label: string): void => {
    const r = rowOfKey(s.lines(), focus)
    if (focus !== SUBMIT_KEY && r >= 0) expect(r >= s.offset && r < s.offset + room, label + ': focus row ' + r + ' in window at ' + s.offset).toBe(true)
  }
  for (let i = 0; i < 3; i++) { const p = s.answer('d-fake' + i); check(p.focus, 'answer ' + i) }
  // focus sits on d-fake3 (first option); the session closes it elsewhere
  const rep = s.closeElsewhere('d-fake3', optKey('d-fake3', 0)) as { focus: string; offset: number }
  expect(rep.focus).toBe('note:d-typed') // the next open card in order is the typed one: its note field
  check(rep.focus, 'after the close')
  expect(s.greyed()).toBe(4)
  // the typed card is sent (text only)
  s.st = { ...s.st, notes: { 'd-typed': 'reply' } }
  const sp = s.send(['d-typed']) as { focus: string }
  expect(sp.focus).toBe('opt:d-late0:0')
  check(sp.focus, 'after the typed send')
  for (let i = 0; i < 4; i++) { const p = s.answer('d-late' + i); check(p.focus, 'late ' + i) }
  expect(s.greyed(), 'every card ends greyed').toBe(9)
  expect(s.texts().filter(x => /^\S+ \d+\. /u.test(x)).map(x => Number(x.split('. ')[0].replace(/^\S+ /, '')))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('DECIDE batch (D) the LAST pending card closes elsewhere while it holds the focus: focus never stays on the removed key', () => {
  for (const focus of [optKey('d-fake0', 0), noteKey('d-fake0')]) {
    const s = new Session(fakes(1))
    const plan = s.closeElsewhere('d-fake0', focus)
    expect(plan, 'a repair is made for ' + focus).not.toBeNull()
    expect((plan as { focus: string | null }).focus, 'the empty state has nothing focusable').toBeNull()
    expect(s.batch, 'nothing pending: the batch closes').toEqual(NO_BATCH)
  }
  // an earlier card was answered here, the last open one closes elsewhere: the batch still has it (pending keeps the answered one), so the successor plan runs
  const two = new Session(fakes(2))
  two.answer('d-fake0')
  const p2 = two.closeElsewhere('d-fake1', optKey('d-fake1', 0)) as { focus: string | null }
  expect(p2.focus).toBe(SUBMIT_KEY)
  // focus on the send row while the list empties
  const sub = new Session(fakes(1))
  expect((sub.closeElsewhere('d-fake0', SUBMIT_KEY) as { focus: string | null }).focus).toBeNull()
})
