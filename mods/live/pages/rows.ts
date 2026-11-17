// mods/live/pages/rows.ts — the section 5 red marker helpers, shared by frame.ts and every page (plan r2 §5).
// A leaf module: it imports only types and ui.ts, never pages/index or a page, so a page can import it without a load cycle (frame -> index -> page -> frame).
import type { Seg } from '../model'
import { PALETTE } from '../ui'

export type Row = Seg[]

// §5: stale, expired and no_source all use the broken role (red text colour, no background, no inverse); the number stays, the reason is written beside it
export const staleBadge = (text: string): Seg => ({ text, color: PALETTE.broken })
export const brokenRow = (text: string): Row => [staleBadge(text)]
