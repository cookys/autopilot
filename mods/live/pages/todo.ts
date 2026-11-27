// mods/live/pages/todo.ts — v7.4 S9 待辦 (page id 'todo', key 8). Cards come from ctx.v74.todo (the source is not live yet: null at runtime -> the broken row; tests build it from fixtures/v74/todo.json).
// Every card top to bottom with its due date; the a/b/c options belong to the card at the cursor and sit in the action rows under it. Pure: rows in, rows out.
// Glyph usage: ▸ (GLYPHS.structure.folded) is reserved for folded sections/disclosures; selected card cursor uses ‣ (U+2023, EAW=N, width=1).
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { displayWidth, truncateToWidth } from '../model'
import type { Seg } from '../model'
import { PICK_KEYS, pickKeys } from '../v74/contract'
import type { TodoCard } from '../v74/contract'
import type { Page, PageCtx } from './frame'
import { STRIP_SPLIT_COLS } from './layout'
import { brokenRow } from './rows'
import type { Row } from './rows'

const seg = (text: string, o: Partial<Seg> = {}): Seg => ({ text, ...o })
const dimSeg = (text: string): Seg => ({ text, dim: true })
const CARD_MARK = GLYPHS.structure.bullet
const CURSOR_MARK = '\u2023' // ‣ (U+2023, EAW=N, width=1): selected card cursor, distinct from fold glyph ▸
const widthOf = (r: Row): number => r.reduce((w, s) => w + displayWidth(s.text), 0)
function fit(row: Row, cols: number): Row {
  if (widthOf(row) <= cols) return row
  const out: Row = []
  let used = 0
  for (const s of row) {
    const w = displayWidth(s.text)
    if (used + w <= cols) { out.push(s); used += w; continue }
    if (cols - used > 0) out.push({ ...s, text: truncateToWidth(s.text, cols - used) })
    break
  }
  return out
}
// MM-DD of the due time (UTC, so the draw never depends on the host's zone)
export const dueText = (dueMs: number | null): string | null => (dueMs === null ? null : new Date(dueMs).toISOString().slice(5, 10))

function todoCard(c: TodoCard, i: number, n: number, selected: boolean, notes: Record<string, string>, ctx: PageCtx): Row[] {
  const { t } = ctx
  const due = dueText(c.dueMs)
  const label = t('v74.d.todo_head', { k: i + 1, n }) + ' ' + (due === null ? t('v74.d.todo_no_due') : t('v74.d.todo_due', { date: due }))
  const head: Row = [dimSeg(GLYPHS.structure.open + ' ' + label + ' ' + GLYPHS.structure.rule.repeat(Math.max(0, ctx.size.cols - displayWidth(label) - 4)))]
  const title: Row = [seg((selected ? CURSOR_MARK : ' ') + CARD_MARK + ' '), seg(c.title, selected ? { here: true } : {})]
  const back: Row = [seg('  '), dimSeg(t('v74.d.todo_back')), seg(' ' + (due === null ? t('v74.d.todo_no_due_note') : due))]
  const note = notes[c.id] ?? ''
  return [head, title, back, [seg('  '), dimSeg(t('v74.d.note')), seg(note === '' ? t('v74.d.note_empty') : note)]].map(r => fit(r, ctx.size.cols))
}

function render(ctx: PageCtx): { body: Row[]; actions: Row[] } {
  const { t } = ctx
  const v = ctx.v74
  const cols = ctx.size.cols
  // r8 #10: the empty page says what is wrong and how to get out: the cards come from `fleet todo`; a card set aside from 待決 lands here
  if (v === undefined || v.todo === null) return { body: [brokenRow(GLYPHS.state.failed + ' ' + t('v74.d.todo_no_source') + ' · ' + t('v74.d.todo_recover'))], actions: [] }
  const cards = v.todo
  if (cards.length === 0) return { body: [[seg(GLYPHS.state.pending + ' '), dimSeg(t('v74.d.todo_none'))], [seg('  '), dimSeg(t('v74.d.todo_none_hint'))]], actions: [] }
  const cursor = Math.max(0, Math.min(cards.length - 1, v.nav.cursor))
  const cur = cards[cursor]
  const picked = v.nav.picks[cur.id]
  const opts: Row = [seg('')]
  const keys = pickKeys(cur.options) // R6: the drawn `[x]` and the press are the same key that picks
  cur.options.slice(0, PICK_KEYS.length).forEach((o, k) => {
    if (k > 0) opts.push(seg('   '))
    opts.push(seg('[' + keys[k] + '] ' + truncateToWidth(o.label, Math.max(4, Math.floor(cols / 3) - 6)), { press: 'key:' + keys[k], ...(picked === k ? { here: true } : {}) }))
  })
  const actions: Row[] = [[seg(' ' + t('v74.d.todo_for', { k: cursor + 1 }))], opts, [dimSeg(' ' + t('v74.d.todo_move'))]]
  const room = Math.max(1, ctx.size.rows - 1 - (cols < STRIP_SPLIT_COLS ? 2 : 1) - actions.length)
  const blocks = cards.map((c, i) => [...todoCard(c, i, cards.length, i === cursor, v.nav.notes, ctx), [seg('')]])
  let first = 0
  while (blocks.slice(first).reduce((n, b) => n + b.length, 0) > room && first < cursor) first++
  return { body: blocks.slice(first).flat(), actions }
}

export const todoPage: Page = { id: 'todo', key: '8', title: '待辦', framed: true, render }
