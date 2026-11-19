// mods/tux/strip.ts — the tab strip and the prose cutter. One copy; mods/live/ui.ts re-exports them.
// cutProse is an internal helper of the strip module (not an independent shared item). The implementation lives only here.

import type { Seg, ThemeKey } from '../live/model.ts'
import { cellWidth, displayWidth } from './width.ts'
import { GLYPHS } from './glyphs.ts'
import { PALETTE } from './palette.ts'

type SegOpts = { color?: ThemeKey; bold?: boolean; dim?: boolean; role?: 'glyph' | 'tab' | 'rule'; here?: boolean }

const sg = (text: string, o: SegOpts = {}): Seg => ({ text, ...o }) as Seg

export type StripTab<Id extends string = string> = { id: Id; label: string; need?: boolean }
export type Strip<Id extends string = string> = {
  next: Seg | null
  tabs: { id: Id; on: boolean; label: Seg }[]
  rule: Seg[]
  rows: number
  exact: boolean
}

// prose too long: cut from the right with `…`
export function cutProse(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  let out = ''
  let w = 1
  for (const ch of text) {
    const cw = cellWidth(ch.codePointAt(0) as number)
    if (w + cw > width) break
    out += ch
    w += cw
  }
  return out + '…'
}

// Q1 (owner 2026-10-13, revised 2026-10-16): no background; the active tab name is bold default text (attention bold when it needs the owner) and the `here` colour
// is only the run of `━` in the baseline; a strip that wraps falls back to bold alone. The `›` next-page button is an action, not a place: dim.
export function strip<Id extends string>(u: { cols: number }, active: Id | null, tabs: readonly StripTab<Id>[], hasNext: boolean): Strip<Id> {
  const next = hasNext ? sg(GLYPHS.structure.goto, { dim: true, role: 'glyph' }) : null
  const built = tabs.map(tb => {
    const on = tb.id === active
    const needs = tb.need === true
    // any tab that needs the owner is attention bold (the active one too: the `━` run marks where you are); the active one otherwise default bold, the rest dim.
    // `here` tags the active label for I4 and the strip test; it is not a colour
    const o: SegOpts = on ? { ...(needs ? { color: PALETTE.attention } : {}), bold: true, here: true, role: 'tab' } : needs ? { color: PALETTE.attention, bold: true, role: 'tab' } : { dim: true, role: 'tab' }
    const label = sg(' ' + tb.label + ' ', o)
    return { id: tb.id, on, label, width: displayWidth(label.text) + 1 }
  })
  let rows = 1
  let x = next === null ? 0 : displayWidth(next.text) + 1
  let w = x
  let markAt = -1
  let markW = 0
  for (const b of built) {
    if (w > 0 && w + b.width > u.cols) { rows++; w = 0 }
    if (b.on) { markAt = x; markW = displayWidth(b.label.text) }
    w += b.width
    x += b.width
  }
  const exact = rows === 1
  const bar = (n: number, glyph: string, o: SegOpts): Seg[] => (n > 0 ? [sg(glyph.repeat(n), { role: 'rule', ...o })] : [])
  const rule: Seg[] = exact && markAt >= 0
    ? [...bar(markAt, GLYPHS.structure.rule, { color: PALETTE.structure }), ...bar(markW, GLYPHS.structure.tabMark, { color: PALETTE.here, here: true }), ...bar(u.cols - markAt - markW, GLYPHS.structure.rule, { color: PALETTE.structure })]
    : bar(u.cols, GLYPHS.structure.rule, { color: PALETTE.structure })
  return { next, tabs: built.map(({ id, on, label }) => ({ id, on, label })), rule, rows: rows + 1, exact }
}
