import type { Row } from './rows'

// Inspect the framed rows, including the tab strip when it falls in this region.
export const upperClickables = (rows: Row[], height: number): number[] =>
  rows.flatMap((row, i) => i < Math.floor(height / 2) && row.some(s => s.press !== undefined) ? [i] : [])
