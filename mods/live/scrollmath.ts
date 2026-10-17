// mods/live/scrollmath.ts — the arithmetic of the scrolling window (design plan §12.10), apart from the drawing in scroll.tsx so node --test can load it (no JSX here).
import { displayWidth } from './ui'

// a window's state: which content it is for, how far down it stands, and the largest legal offset (the frame writes it each draw, the scroll hook clamps to it)
// `framed` is whether the LAST draw was a frame (the draw sets it, either way); `room` the content rows that draw showed (a page move is capped to it, so no row is skipped)
export type ScrollModel = { key: string; offset: number; max: number; room: number; framed: boolean }
export const newScroll = (): ScrollModel => ({ key: '', offset: 0, max: 0, room: 0, framed: false })
// The ONE test for whether the mod, not the engine, takes a ui.scroll: only while the last draw was a frame. Drawn as a plain tree (no Button, no bodyColumns, no band, another tab) the
// engine scrolls it, so the hook must hand the event to `next`.
// `e.offset` is the TARGET the engine would move its window to (the row it shows now plus `by`, clamped to the tree; host types, UiScrollInput.offset), not where the window stands. So a
// move down from 0 always has offset > 0 and says nothing about the window. The engine window stood off 0 only when the target minus the move is still above 0 and the target was not
// clamped at the top (offset 0 tells nothing): `offset > 0 && offset - by > 0`. Then the engine brings it home; every other framed event is the mod's, up or down.
export const takesScroll = (m: ScrollModel, e: { bodyRows: number; by?: number; offset?: number }): boolean =>
  m.framed && e.bodyRows > 0 && !(typeof e.offset === 'number' && e.offset > 0 && e.offset - (e.by ?? 0) > 0)
// the whole `ui.scroll` hook of a window, one body for the viewer and the live decide tab: the mod's own window moves its offset and asks for a redraw; anything else is the engine's
export function scrollHook<E extends { by: number; contentRows: number; bodyRows: number; offset?: number }, R>(model: ScrollModel, e: E, next: (e: E) => R, redraw: () => void): R | Record<string, never> {
  if (!takesScroll(model, e)) return next(e)
  if (applyScroll(model, e)) redraw()
  return {}
}
// a list that only GREW (new ids appended or inserted, none gone) keeps its place; anything else is another content and starts at the top
export function keyedGrow(model: ScrollModel, ids: readonly string[]): void {
  const prev = model.key === '' ? [] : model.key.split('\u0001')
  const now = new Set(ids)
  if (!prev.every(i => now.has(i))) { model.offset = 0; model.max = 0 }
  model.key = ids.join('\u0001')
}
// a new content (another file, another list) starts at the top
export function keyed(model: ScrollModel, key: string): void {
  if (model.key !== key) { model.key = key; model.offset = 0; model.max = 0 }
}

// the pane's room as its render hook sees it: null when the engine gave none (an older host, a test with no scroll prop), and the caller draws the plain tree
export function frameOf(props: unknown): { rows: number; cols: number } | null {
  const p = props as { scroll?: { bodyRows?: unknown }; bodyColumns?: unknown } | undefined
  const rows = p?.scroll?.bodyRows
  const cols = p?.bodyColumns
  return typeof rows === 'number' && rows > 0 && typeof cols === 'number' && cols > 0 ? { rows, cols } : null
}

// where the thumb sits in a track of `room` cells: its length is visible / total of the track (at least 1 cell), its top the offset's share of the movable distance, so offset 0
// is flush with the top and the last offset flush with the bottom. null when everything is visible (no scrollbar).
export function thumbOf(total: number, room: number, offset: number): { top: number; len: number } | null {
  if (room <= 0 || total <= room) return null
  const len = Math.min(room, Math.max(1, Math.round((room * room) / total)))
  const movable = total - room
  const top = Math.round((Math.min(Math.max(offset, 0), movable) / movable) * (room - len))
  return { top, len }
}

// What one `ui.scroll` does to the offset. `by` is the engine's: an arrow a row, PgUp / PgDn `bodyRows`, Home / End `contentRows` (signed), the wheel a few rows. A move as big as
// the whole tree is Home or End; anything else is relative. Always clamped to [0, max]. Returns true when the offset changed.
export function applyScroll(model: ScrollModel, e: { by: number; contentRows: number }): boolean {
  const before = model.offset
  const room = model.room > 0 ? model.room : Math.max(1, Math.abs(e.by)) // a page move never passes the rows on screen
  const target = Math.abs(e.by) >= e.contentRows && e.contentRows > 0 ? (e.by < 0 ? 0 : model.max) : Math.max(-room, Math.min(room, e.by)) + model.offset
  model.offset = Math.max(0, Math.min(model.max, target))
  return model.offset !== before
}

// cut `text` into rows of at most `width` terminal cells (a CJK character is 2); an explicit newline starts a row
export function wrapCells(text: string, width: number): string[] {
  const w = Math.max(2, width)
  const out: string[] = []
  for (const para of text.split('\n')) {
    let row = ''
    let used = 0
    for (const ch of Array.from(para)) {
      const cw = displayWidth(ch)
      if (used + cw > w) { out.push(row); row = ''; used = 0 }
      row += ch
      used += cw
    }
    out.push(row)
  }
  return out
}


// the frame's room for content: what is left after the head, the rule and the action strip (at least 1 row)
export const roomOf = (o: { rows: number; headRows: number; barRows: number }): number => Math.max(1, o.rows - o.headRows - 1 - o.barRows)
