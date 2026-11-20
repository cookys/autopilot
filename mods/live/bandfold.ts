// mods/live/bandfold.ts — the band fold decisions, pure. register.ts holds the state and calls these; it does not decide.
// No engine value and no JSX. Syntax is erasable and every runtime import carries `.ts`, so `node --test` can load this file (bandfold.test.js).
import type { ShellMenuId } from './shell.ts'

// The band starts as one row. A session reset calls this; the caller stores the boolean.
export function initialBandCollapsed(): boolean {
  return true
}

export type BandFold = { collapsed: boolean; menu: ShellMenuId }
// 'row' is a click on the collapsed row body (the gaps, the note, the trailing blank). 'blank' is a click on empty space in the expanded band.
export type BandTarget = ShellMenuId | 'row' | 'blank'

// The fixed fold cell. Flips collapsed and leaves the open menu alone. Always a new object.
export function toggleFold(state: BandFold): BandFold {
  return { collapsed: !state.collapsed, menu: state.menu }
}

// A no-op returns the same state object, so a caller can see that nothing changed.
export function toggleBand(state: BandFold, target: BandTarget): BandFold {
  if (target === 'blank') return state
  if (target === 'row') return state.collapsed ? { collapsed: false, menu: state.menu } : state
  if (state.collapsed) return { collapsed: false, menu: target }
  if (target === 'd' && state.menu === 'd') return { collapsed: true, menu: 'd' }
  return { collapsed: false, menu: target }
}

// Where the one-cell fold glyph sits. `closeRoom` is the right-hand columns the glyph must not enter.
// The glyph column is `columns - closeRoom - 1` when that column exists; otherwise the toggle is omitted and the body width is 0.
// A padding space is the cell before the glyph, and only when that cell exists. The body fills everything to the left of that pair.
export type FoldPlace = { body: number; pad: boolean; toggleCol: number | null }

export function foldPlace(columns: number, closeRoom: number): FoldPlace {
  const toggleCol = columns - closeRoom - 1
  if (toggleCol < 0) return { body: 0, pad: false, toggleCol: null }
  const pad = toggleCol >= 1
  return { body: toggleCol - (pad ? 1 : 0), pad, toggleCol }
}

// True when the pending count grew past what the row has already shown. The caller clears it by advancing the seen count once the band is expanded.
export function collapsedRowMark(prevSeenCount: number, count: number): boolean {
  return count > prevSeenCount
}
