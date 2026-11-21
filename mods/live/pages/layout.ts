// Shared frame geometry. Keep this module independent of the page registry so
// page renderers can budget their content without importing the frame.
import { PET_KEY, V74_KEY, V74_PAGES } from '../v74/contract'

export const STRIP_SPLIT_COLS = 66
// the action area of a frame: 6 rows from 32 rows up, else 4 (the 待決 send preview lists its cards inside this)
export const actionRows = (rows: number): number => (rows >= 32 ? 6 : 4)

// v7.4 tab digits (sub-task B); quota is not a tab (folded into spend).
export const PAGE_KEYS: Record<string, string> = { ...V74_KEY, pet: PET_KEY, quota: '5' }

export const V74_STRIP_ORDER = [...V74_PAGES, 'pet'] as const