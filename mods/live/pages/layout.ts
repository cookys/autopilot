// Shared frame geometry. Keep this module independent of the page registry so
// page renderers can budget their content without importing the frame.
import { PET_KEY, V74_KEY, V74_PAGES } from '../v74/contract.ts'

export const STRIP_SPLIT_COLS = 66
// the action area of a frame: 6 rows from 32 rows up, else 4 (the 待決 send preview lists its cards inside this)
// at <= 3 rows (the host's 80x16 inline allocation) the frame drops its key-hint border row (frame.ts foot)
export const TINY_FRAME_ROWS = 3
export const actionRows = (rows: number): number => (rows >= 32 ? 6 : 4)

// v7.4 tab digits (sub-task B); quota is not a tab (folded into spend).
export const PAGE_KEYS: Record<string, string> = { ...V74_KEY, pet: PET_KEY, quota: '5' }

export const V74_STRIP_ORDER = [...V74_PAGES, 'pet'] as const

// Decide page C degradation rules (PM 01M837ZECP):
// Based on band bodyColumns only: >=83 dual-column (equal widths, >=40 each, 3-cell separator),
// <83 single-column, +/-2 col hysteresis around 83 (81..85), maxRows < 10 collapses to 1-row-per-card list.
export const DECIDE_DUAL_MIN_COLS = 83
export const DECIDE_HYSTERESIS = 2
export const DECIDE_MIN_COL_W = 40
export const DECIDE_COL_SEP_W = 3
export const DECIDE_COMPACT_MAX_ROWS = 10

export type DecideLayoutMode = 'dual' | 'single'

export function decideLayoutMode(bodyColumns: number, prevMode: DecideLayoutMode | null = null): DecideLayoutMode {
  if (prevMode === 'dual') return bodyColumns < DECIDE_DUAL_MIN_COLS - DECIDE_HYSTERESIS ? 'single' : 'dual'
  if (prevMode === 'single') return bodyColumns >= DECIDE_DUAL_MIN_COLS + DECIDE_HYSTERESIS ? 'dual' : 'single'
  return bodyColumns >= DECIDE_DUAL_MIN_COLS ? 'dual' : 'single'
}

// wantLeft = the display width the list actually needs (longest card row). Given, the left column takes just that, at most 40% of the
// usable width and at least DECIDE_LIST_MIN_W, so the detail on the right gets the rest. Omitted, the columns stay equal.
export const DECIDE_LIST_MIN_W = 34
export const DECIDE_LIST_MAX_FRAC = 0.4
export function decideColumnWidths(availCols: number, wantLeft?: number): { leftW: number; rightW: number; sepW: number } {
  const sepW = DECIDE_COL_SEP_W
  const usable = Math.max(2, availCols - sepW)
  const leftW = wantLeft === undefined
    ? Math.floor(usable / 2)
    : Math.max(Math.min(DECIDE_LIST_MIN_W, usable - 1), Math.min(wantLeft, Math.floor(usable * DECIDE_LIST_MAX_FRAC)))
  const rightW = usable - leftW
  return { leftW, rightW, sepW }
}
