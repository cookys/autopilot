// mods/live/pages/rows.ts — the section 5 red marker helpers, shared by frame.ts and every page (plan r2 §5).
// A leaf module: it imports only types, ui.ts and quota-pick.ts (no page), never pages/index or a page, so a page can import it without a load cycle (frame -> index -> page -> frame).
import { isStepCard } from '../model'
import type { LiveSnapshot, Seg } from '../model'
import { PALETTE } from '../ui'

export type Row = Seg[]

// §5: stale, expired and no_source all use the broken role (red text colour, no background, no inverse); the number stays, the reason is written beside it
export const staleBadge = (text: string): Seg => ({ text, color: PALETTE.broken })
export const brokenRow = (text: string): Row => [staleBadge(text)]

// ---- shared across pages (gate round 1) ----
import type { ConsoleIssue, ConsoleLine, ConsoleSnapshot } from '../console'
import type { T } from '../i18n'
import { ROLE_SUCCESS, normalizedPools, rankPools } from './quota-pick'

const ISSUE_RANK: Record<string, number> = { failed: 0, stalled: 1 }

// pending decision cards across console.cards (plus counts.decisions) and this seat's own live.pending (step / look items excluded), deduplicated by id
export function decisionCount(ctx: { console: ConsoleSnapshot | null; live: LiveSnapshot | null }): number {
  const { console: con, live } = ctx
  const own = live === null ? [] : live.pending.filter(d => !isStepCard(d))
  const ownOnly = own.filter(d => !(con?.cards ?? []).some(c => c.id === d.id)).length
  return con !== null ? Math.max(con.counts.decisions, (con.cards?.length ?? 0) + ownOnly) : own.length
}

// production lines that carry at least one issue, ordered failed -> stalled -> console-surfaced -> oldest issue first
export function stuckLinesOf(con: ConsoleSnapshot | null): { line: ConsoleLine; worst: ConsoleIssue }[] {
  if (con === null || con.lines === null) return []
  const rank = (x: ConsoleIssue): number => ISSUE_RANK[x.state] ?? 2
  const surfaced = (x: ConsoleIssue): number => (x.to_console ? 0 : 1)
  return con.lines
    .filter(l => l.issues.length > 0)
    .map(line => {
      const worst = [...line.issues].sort((a, b) => rank(a) - rank(b) || surfaced(a) - surfaced(b) || a.since_ms - b.since_ms)[0]
      return { line, worst }
    })
    .sort((a, b) => rank(a.worst) - rank(b.worst) || surfaced(a.worst) - surfaced(b.worst) || a.worst.since_ms - b.worst.since_ms || a.line.label.localeCompare(b.line.label))
}

// the ONE production-line total of a snapshot: the console summary's own counts when it has them (現況, 艦隊 and the band read the same number), else the listed lines (G3)
export function lineTotal(con: ConsoleSnapshot): number {
  const listed = con.lines === null ? 0 : con.lines.length
  return Math.max(Object.values(con.counts.summary.lines).reduce((a, b) => a + b, 0), listed) // never fewer than the lines the 艦隊 page lists
}

// true when a source is really missing or not ok (no console, or any source whose state is not ok): the one case the empty state says 資料不足 (item 6)
export function sourceMissing(con: ConsoleSnapshot | null): boolean {
  return con === null || Object.values(con.sources).some(x => x.state !== 'ok')
}

// how many pools have an unknown verdict (used up or forecast to run out, with no rebalance data)
export function unknownPoolCount(con: ConsoleSnapshot | null, nowMs: number, t: T): number {
  if (con === null) return 0
  const pools = normalizedPools(con)
  return pools === null ? 0 : rankPools(pools, nowMs, t).filter(v => v.kind === 'limit_nosw' || v.kind === 'exhaust_nosw').length
}

// the pool verdicts that need a look (red or unknown or yellow): the calm line is never said beside one
export function poolsNeedLook(con: ConsoleSnapshot | null, nowMs: number, t: T): boolean {
  if (con === null) return false
  const pools = normalizedPools(con)
  return pools === null ? false : rankPools(pools, nowMs, t).some(v => v.role !== ROLE_SUCCESS)
}

// true when the verdict of the page's data cannot be made: a missing source, or a pool whose verdict is unknown (G4, G5)
export function dataMissing(con: ConsoleSnapshot | null, nowMs: number, t: T): boolean {
  return sourceMissing(con) || unknownPoolCount(con, nowMs, t) > 0
}
