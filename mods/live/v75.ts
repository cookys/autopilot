// mods/live/v75.ts — v7.5: the band (below) and the host Pane (beside) share ONE pending-card state. Pure: plans, focus, rows of segments; band75.tsx draws them, register.ts wires them.
// Spec: v75-spec.md and the frozen compare page (band-pane-compare.md §2, §3, §7, §8). The state itself stays where it already was (the DECIDE atom for picks/notes, decideLocal for cursor / preview /
// note mode, panePage for the page): v75State() in register.ts is the ONE reader, frameKey the ONE writer, so a key pressed in either place lands in the same reducer (pages/decide.ts decideReduce).
import { GLYPHS } from '../tux/glyphs.ts'
import { PALETTE } from '../tux/palette.ts'
import type { T } from './i18n'
import { displayWidth, truncateToWidth } from './model'
import type { Seg } from './model'
import type { DecideCard } from './v74/contract'

// K2: AUTOPILOT_LIVE_V75=0 puts every v7.5 behaviour behind this one switch (register.ts reads the env at each draw and sets it)
let v75Switch = true
export const v75On = (): boolean => v75Switch
export const setV75On = (on: boolean): void => { v75Switch = on }
export const V75_BAND_ROWS = 5 // a band with a pending card: card head, options, note / preview, hint, status row
export const V75_PANE_MIN_CONTENT = 8 // the Pane needs this many content rows ...
export const V75_PANE_CHROME = 2 // ... plus its title row and its tab border
export const V75_PANE_MIN_ROWS = V75_BAND_ROWS + V75_PANE_MIN_CONTENT + V75_PANE_CHROME

export type V75Focus = 'prompt' | 'band' | 'pane'
export type V75Why = 'ok' | 'closed' | 'rows' | 'not_placed'
export type V75Plan = { bandRows: 1 | 5; pane: boolean; why: V75Why }

// §7.4: the band is 5 rows with a pending card and 1 without; while the Pane is open the height is locked to what it was when the Pane opened (`locked`), so a new card changes content, never the layout
// (§8 #8: 0 -> 1 card grows the band only while the Pane is closed; with the Pane open the 1-row band carries `+N 新卡` in its status row and grows when the Pane closes).
// The Pane opens only when the host's room holds band + 8 content rows + its two chrome rows, and never after the host answered isPlaced=false; otherwise the band falls back to the single v7.4 band.
export function v75Plan(i: { maxRows: number; pending: number; paneWanted: boolean; notPlaced: boolean; locked: number | null }): V75Plan {
  const want = i.locked ?? (i.pending > 0 ? V75_BAND_ROWS : 1)
  const bandRows: 1 | 5 = want >= V75_BAND_ROWS && i.maxRows >= V75_BAND_ROWS ? 5 : 1
  if (!i.paneWanted) return { bandRows, pane: false, why: 'closed' }
  if (i.notPlaced) return { bandRows, pane: false, why: 'not_placed' }
  if (i.maxRows < V75_PANE_MIN_ROWS) return { bandRows, pane: false, why: 'rows' }
  return { bandRows, pane: true, why: 'ok' }
}

// ---- focus (three places, the note is a mode of one of them, not a fourth) ----
export type V75FocusEvent =
  | { kind: 'focus'; component: string | undefined; named: string | undefined } // a host focus event: which surface, which element it names
  | { kind: 'open-pane' } // the program raised the Pane's focus itself (a digit in the band)
  | { kind: 'pane-gone' } // the Pane closed, or could not be placed
export const bandElementName = (named: string | undefined): boolean => named !== undefined && /^(tab:|card:|letter:|hotkey:|opt:|v74-note$|v75:)/.test(named)
export function v75FocusNext(was: V75Focus, ev: V75FocusEvent): V75Focus {
  if (ev.kind === 'open-pane') return 'pane'
  if (ev.kind === 'pane-gone') return was === 'pane' ? 'band' : was // a focus never stays where nothing is drawn
  if (ev.component === 'Pane' && ev.named !== undefined) return 'pane'
  if (ev.component === 'AbovePrompt' && bandElementName(ev.named)) return 'band'
  if (ev.named === undefined || ev.named === '') return 'prompt'
  return was
}

// after /reload-plugins the host closes the plugin's Pane and the module's variables are gone; $.state keeps "the owner wants the Pane open". Reopen (no focus) only when it was wanted, the host has none and this module has not opened one.
export const v75ReopenAfterReload = (i: { wanted: boolean; hostOpen: boolean; paneOn: boolean; open: boolean }): boolean => i.wanted && !i.hostOpen && !i.paneOn && !i.open

// PgUp / PgDn in the Pane scroll the open card's detail by this many rows
export const V75_DETAIL_STEP = 12
export const v75DetailOffset = (off: number, by: number): number => Math.max(0, off + Math.sign(by) * Math.min(Math.abs(by), V75_DETAIL_STEP))

// §7.3: one Esc, one layer: the note, then the preview, then the keyboard goes back to the input box.
export type V75EscStep = 'cancel_note' | 'cancel_preview' | 'to_prompt'
export const v75EscStep = (s: { note: boolean; armed: boolean }): V75EscStep => (s.note ? 'cancel_note' : s.armed ? 'cancel_preview' : 'to_prompt')

// §7.3 hint row: the band cannot read whether it holds the keyboard (d.ts: no isFocused on the band; the host marks the focused element in reverse, :2917), so the text is the same wherever the keys are:
// the take key first, then the keys, the last clause says what ONE more Esc does; fitRow cuts from the end, so a narrow band loses the Esc clause first.
export function v75Hint(i: { note: boolean; armed: boolean; stale: boolean; sending: boolean; pane: boolean }, t: T): string {
  if (i.note) return t('v75.hint.note')
  if (i.sending) return t('v75.hint.sending')
  if (i.armed) return t(i.stale ? 'v75.hint.stale' : 'v75.hint.armed')
  return t(i.pane ? 'v75.hint.band' : 'v75.hint.band_nopane', { ud: GLYPHS.structure.up + GLYPHS.structure.behind })
}

// ---- scroll (§5): the screen has ONE scrolling part, the Pane's card area. The band never scrolls. ----
export type V75Scroll = 'cursor' | 'pane' | 'swallow' | 'pass'
// A one-row step is the arrow: it moves the cursor (the window follows it) wherever the keyboard is. A bigger step (PgUp / PgDn) scrolls the Pane's window, whichever surface it arrived on, and is swallowed when no Pane is open
// (the band has nothing to scroll, and a band that took it would scroll the chat under the prompt).
export function v75ScrollRoute(e: { component?: string; by?: number }, s: { paneOpen: boolean; note: boolean }): V75Scroll {
  if (typeof e.by !== 'number' || e.by === 0) return 'pass'
  if (s.note) return 'swallow' // §8 #3: in the note mode the arrows belong to the text field
  if (Math.abs(e.by) === 1) return 'cursor'
  return s.paneOpen ? 'pane' : 'swallow'
}

// ---- the band's four card rows (the fifth is the status row the band already draws) ----
export type V75BandIn = {
  cards: readonly DecideCard[]; cursor: number; picks: Record<string, number>; notes: Record<string, string>
  armed: boolean; stale: boolean; noteMode: boolean; noteBuf: string; sending: boolean; held: ReadonlySet<string>; sent: ReadonlySet<string>
  pane: boolean; newCards: number; cols: number; t: T
  // the frozen preview list, one item per card that would go out (card order): number, title, letter, option label, note
  preview: readonly { n: number; title: string; letter: string; label: string; note: string }[]
}
export type V75Row = Seg[]
const CUT = '…'
const DOT = '·'
const seg = (text: string, o: Partial<Seg> = {}): Seg => ({ text, ...o })
const LETTER = 'abcde'
const widthOf = (r: V75Row): number => r.reduce((n, s) => n + displayWidth(s.text), 0)
// one row, never wrapped (fixed height, §8 #5): segments are cut to the width, the last one ends in … when it was cut
export function fitRow(r: V75Row, cols: number): V75Row {
  const out: V75Row = []
  let used = 0
  for (const s of r) {
    const w = displayWidth(s.text)
    if (used + w <= cols) { out.push(s); used += w; continue }
    const room = cols - used
    if (room > 1) out.push({ ...s, text: truncateToWidth(s.text, room - 1) + CUT })
    else if (room === 1) out.push({ ...s, text: CUT })
    break
  }
  return out.length === 0 ? [seg(' ')] : out
}
export function v75BandRows(i: V75BandIn): V75Row[] {
  const { t, cols } = i
  const n = i.cards.length
  const at = Math.max(0, Math.min(n - 1, i.cursor))
  const c = i.cards[at]
  const lead = seg(GLYPHS.structure.up + ' ', { dim: true })
  if (c === undefined) return [[lead, seg(t('v75.none'), { dim: true })], [seg(' ')], [seg(' ')], [seg(v75Hint({ note: false, armed: false, stale: false, sending: false, pane: i.pane }, t), { dim: true })]].map(r => fitRow(r, cols))
  const locked = i.held.has(c.id) || i.sent.has(c.id)
  const picked = i.picks[c.id]
  // row 1: the card, its place in the list and the question; a new card never moves the cursor, it only adds `+N 新卡`
  const head: V75Row = [lead, seg(t('v75.pos', { k: at + 1, n })), seg(' ' + c.title, {}), seg('：' + c.question), ...(i.newCards > 0 ? [seg('  ' + t('v75.new', { n: i.newCards }), { color: PALETTE.attention })] : [])]
  // row 2: the card number first (a/b/c always act on THIS card), every option, the pick as `→ b`, what does not fit as `+N 見 Pane`
  const opts: V75Row = [seg(c.title + ' ' + GLYPHS.structure.folded + ' ', { dim: true })]
  const room = Math.max(0, cols - widthOf(opts) - (picked === undefined ? 0 : 6) - 14)
  let used = 0
  let shown = 0
  c.options.slice(0, LETTER.length).forEach((o, k) => {
    const rec = o.recommended ? ' ' + GLYPHS.structure.recommend : ''
    const piece = (k === 0 ? '' : ' ' + DOT + ' ') + LETTER[k] + ' ' + o.label + rec
    if (used + displayWidth(piece) > room && shown > 0) return
    used += displayWidth(piece)
    shown++
    opts.push(seg(piece, picked === k ? { color: PALETTE.done } : o.recommended ? { color: PALETTE.attention } : locked ? { dim: true } : {}))
  })
  const rest = c.options.length - shown
  if (rest > 0) opts.push(seg('  ' + t('v75.more', { n: rest }), { dim: true }))
  if (picked !== undefined && c.options[picked] !== undefined) opts.push(seg('  ' + GLYPHS.structure.answer + ' ' + LETTER[picked], { color: PALETTE.done }))
  // row 3: the note, or the frozen send list while the preview is up (every picked card, §7.2), or the reason the preview is dead
  let third: V75Row
  if (i.noteMode) third = [seg(t('v75.note_lead'), { color: PALETTE.attention }), seg(i.noteBuf + '_')]
  else if (i.armed && i.preview.length > 0) {
    if (i.stale) third = [seg(t('v75.stale'), { color: PALETTE.attention })]
    else {
      third = [seg(t('v75.preview', { n: i.preview.length }) + ' ', { color: PALETTE.attention })]
      const room3 = Math.max(0, cols - widthOf(third) - 12)
      let u = 0
      let k = 0
      for (const p of i.preview) {
        const text = (k === 0 ? '' : ' ' + DOT + ' ') + p.n + ' ' + p.letter + (p.note === '' ? '' : '+' + t('v75.note_mark'))
        if (u + displayWidth(text) > room3 && k > 0) break
        u += displayWidth(text)
        k++
        third.push(seg(text))
      }
      if (k < i.preview.length) third.push(seg('  ' + t('v75.more', { n: i.preview.length - k }), { dim: true }))
    }
  } else {
    const note = (i.notes[c.id] ?? '').trim()
    third = note === '' ? [seg(t('v75.note_none'), { dim: true })] : [seg(t('v75.note_lead'), { dim: true }), seg(note)]
  }
  const hint = v75Hint({ note: i.noteMode, armed: i.armed && i.preview.length > 0, stale: i.stale, sending: i.sending, pane: i.pane }, t)
  return [head, opts, third, [seg(hint, { dim: true })]].map(r => fitRow(r, cols))
}

// K1: one action at a time. A press that arrives while the previous one is still awaiting is dropped (onBusy tells the log), never read as the opposite action.
export function v75SingleFlight(run: () => Promise<void>, onBusy: () => void): () => Promise<void> {
  let busy = false
  return async () => {
    if (busy) { onBusy(); return }
    busy = true
    try { await run() } finally { busy = false }
  }
}
