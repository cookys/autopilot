// mods/live/pages/rows.ts — the section 5 red marker helpers, shared by frame.ts and every page (plan r2 §5).
// A leaf module: it imports only types, ui.ts and quota-pick.ts (no page), never pages/index or a page, so a page can import it without a load cycle (frame -> index -> page -> frame).
import type { Seg } from '../model'
import { PALETTE } from '../ui'

export type Row = Seg[]

// §5: stale, expired and no_source all use the broken role (red text colour, no background, no inverse); the number stays, the reason is written beside it
export const staleBadge = (text: string): Seg => ({ text, color: PALETTE.broken })
export const brokenRow = (text: string): Row => [staleBadge(text)]

// ---- shared across pages (gate round 1) ----
import type { ConsoleSnapshot } from '../console'
import type { T } from '../i18n'
import { normalizedPools, rankPools } from './quota-pick'

// the ONE production-line total of a snapshot: the console summary's own counts when it has them (現況, 艦隊 and the band read the same number), else the listed lines (G3)
export function lineTotal(con: ConsoleSnapshot): number {
  const counts = Object.values(con.counts.summary.lines)
  return counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : con.lines === null ? 0 : con.lines.length
}

// true when the verdict of the page's data cannot be made: no console, any source that is not ok, or a pool whose verdict is unknown (G4, G5)
export function dataMissing(con: ConsoleSnapshot | null, nowMs: number, t: T): boolean {
  if (con === null) return true
  if (Object.values(con.sources).some(x => x.state !== 'ok')) return true
  const pools = normalizedPools(con)
  return pools !== null && rankPools(pools, nowMs, t).some(v => v.kind === 'limit_nosw' || v.kind === 'exhaust_nosw')
}
