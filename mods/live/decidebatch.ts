// mods/live/decidebatch.ts — the 待決 tab across several answers in a row: one batch of cards with stable numbers, answered cards that stay (greyed), stable focus keys, and the
// focus / scroll plan after an answer. Pure: the shell (register.ts) holds the batch and applies the plan through the host's focus call and its own scroll model.
//
// A batch is the run of cards from the first pending question until nothing is pending (or the view is opened again). A card is ANSWERED once an option is picked or it was sent; it then
// stays where it is, greyed, with the chosen answer, and takes no focus. A card that only wants a typed reply is answered when sent (typing must not move the focus mid-word).
import { decideDialog, decidePick } from './model'
import { GLYPHS } from './ui'
import type { DecideState, LiveDecision, PaneLine } from './model'

export type DecideBatch = {
  order: string[] // card keys in the order they first appeared; an answered card stays here after it left the pending list
  num: Record<string, number> // the number shown (第 N 題), given once and never reused
  next: number
  q: Record<string, string> // the question text, kept so an answered card can still be drawn after it left the list
  ans: Record<string, string> // the answer shown on an answered card
}
export const NO_BATCH: DecideBatch = { order: [], num: {}, next: 1, q: {}, ans: {} }
export const SUBMIT_KEY = 'submit'

// the element key of an option Button: the card id and the option number, never a position in a list that shrinks
export const optKey = (id: string, k: number): string => 'opt:' + id + ':' + k
export const noteKey = (id: string): string => 'note:' + id
export const cardKey = (d: LiveDecision): string => d.id ?? 'q:' + d.question

// the answer an answered card shows, or null while the card is still open (or cannot be answered here)
export function answerOf(d: LiveDecision, st: DecideState): string | null {
  if (d.id === null || decideDialog(d)) return null
  const pick = decidePick(d, st)
  if (pick !== null) return d.options[pick].label
  if (st.sent[d.id] !== undefined) {
    const note = (st.notes[d.id] ?? '').replace(/\s+/g, ' ').trim()
    return note === '' ? GLYPHS.state.done : note
  }
  return null
}

// the batch after the list or the picks changed. Nothing pending closes it.
export function batchSync(prev: DecideBatch, pending: readonly LiveDecision[], st: DecideState): DecideBatch {
  if (pending.length === 0) return NO_BATCH
  const b: DecideBatch = { order: [...prev.order], num: { ...prev.num }, next: prev.next, q: { ...prev.q }, ans: { ...prev.ans } }
  const here = new Set<string>()
  for (const d of pending) {
    const k = cardKey(d)
    here.add(k)
    if (b.num[k] === undefined) { b.num[k] = b.next++; b.order.push(k) }
    b.q[k] = d.question
    const a = answerOf(d, st)
    if (a === null) delete b.ans[k]
    else b.ans[k] = a
  }
  b.order = b.order.filter(k => here.has(k) || b.ans[k] !== undefined) // a card that left unanswered goes; an answered one stays until the batch closes
  return b
}

// the line index of an element key in the card lines: `opt:<id>:<k>` is the Button of that option, `note:<id>` its field; -1 when it is not drawn (the send row is in the fixed bar)
export function rowOfKey(lines: readonly PaneLine[], key: string): number {
  const m = /^opt:(.+):(\d+)$/.exec(key)
  if (m !== null) return lines.findIndex(l => (l.segs ?? []).some(s => s.press === 'pick:' + m[1] + ':' + m[2]))
  return lines.findIndex(l => l.field?.key === key)
}
const titleRow = (lines: readonly PaneLine[], n: number): number => lines.findIndex(l => l.kind === 'item' && new RegExp('^\\S+ ' + n + '\\. ', 'u').test(l.text))

export type AnswerPlan = { focus: string; offset: number }
// After card `answered` got its answer: where the focus goes (the first option of the next open card in order, else the first open one before it, else the send row) and the scroll
// offset (the next card takes the place of the answered one on screen; the focused row is then brought into the window). `lines` are the card lines drawn AFTER the answer.
export function answerPlan(o: { lines: readonly PaneLine[]; batch: DecideBatch; pending: readonly LiveDecision[]; st: DecideState; answered: string; offset: number; room: number }): AnswerPlan {
  const { lines, batch, pending, st, answered, room } = o
  const open = (k: string): LiveDecision | undefined => pending.find(d => cardKey(d) === k && d.id !== null && !decideDialog(d) && answerOf(d, st) === null)
  const at = batch.order.indexOf(answered)
  const after = batch.order.slice(at + 1).find(k => open(k) !== undefined)
  const nextKey = after ?? batch.order.slice(0, Math.max(0, at)).find(k => open(k) !== undefined)
  const maxOff = Math.max(0, lines.length - room)
  const clamp = (n: number): number => Math.max(0, Math.min(maxOff, n))
  if (nextKey === undefined) return { focus: SUBMIT_KEY, offset: clamp(o.offset) }
  const d = open(nextKey) as LiveDecision
  const focus = d.options.length > 0 ? optKey(d.id as string, 0) : noteKey(d.id as string)
  let off = o.offset
  const a = titleRow(lines, batch.num[answered])
  const n = titleRow(lines, batch.num[nextKey])
  if (a >= off && a < off + room && n >= 0) off += n - a
  const f = rowOfKey(lines, focus)
  if (f >= 0) { if (f < off) off = f; else if (f >= off + room) off = f - room + 1 }
  return { focus, offset: clamp(off) }
}
