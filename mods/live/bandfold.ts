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

// True when the pending count grew past what the row has already shown. The caller clears it by advancing the seen count once the band is expanded.
export function collapsedRowMark(prevSeenCount: number, count: number): boolean {
  return count > prevSeenCount
}
