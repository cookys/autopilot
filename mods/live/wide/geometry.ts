// mods/live/wide/geometry.ts - console v5 wide band (design: gen_wide_all.py, 209x49): the switch to the wide layout and the draft's geometry.
// Pure. The wide band is used only when the host gives >= WIDE_MIN_COLS columns and >= WIDE_MIN_ROWS rows; every other size keeps the v7.4 frame untouched.

export const WIDE_MIN_COLS = 200 // enter W at this width (209x49 is the measured case)
export const WIDE_MIN_ROWS = 17 // the band's height at 209x49 (the host's floor(rows/2) includes the prompt)
export const WIDE_HYSTERESIS_COLS = 4 // once in W, leave only at WIDE_MIN_COLS - WIDE_HYSTERESIS_COLS (196) or less: 197 stays W, 196 leaves

export const BAND_ROWS = 17
export const BAND_COLS = 110 // columns 0-109
export const BAND_LIST_COLS = 36 // the divider sits at column 36; the list column is to its left
export const BAND_REPLY_COLS = 70 // the reply column's width (columns 38-107)
export const BAND_BODY_ROWS = 12 // content rows of the two columns (rows 2-13)
export const PANE_COLS = 94 // the docked pane's width in W (host limit)
export const PANE_BODY_COLS = PANE_COLS - 1 // 93: the host draws its drag bar in the first column

export function wideNext(wasWide: boolean, cols: number, maxRows: number): boolean {
  if (!(maxRows >= WIDE_MIN_ROWS)) return false
  return wasWide ? cols > WIDE_MIN_COLS - WIDE_HYSTERESIS_COLS : cols >= WIDE_MIN_COLS
}
