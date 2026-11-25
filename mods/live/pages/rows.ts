// mods/live/pages/rows.ts — the section 5 red marker helpers, shared by frame.ts and every page (plan r2 §5).
// A leaf module: it imports only types, ui.ts and quota-pick.ts (no page), never pages/index or a page, so a page can import it without a load cycle (frame -> index -> page -> frame).
import { isStepCard, truncateToWidth } from '../model'
import type { LiveSnapshot, Seg } from '../model'
import { PALETTE } from '../../tux/palette.ts'
import { displayWidth } from '../../tux/width.ts'
import { STATES, type StateId } from '../ui'
import { fmtCount } from '../speed'

export type Row = Seg[]

// §5: stale, expired and no_source all use the broken role (red text colour, no background, no inverse); the number stays, the reason is written beside it
export const staleBadge = (text: string): Seg => ({ text, color: PALETTE.broken })
// a token count for display (never money): `12k tok`, `1.2M tok`; callers pass the real token field and say 'unknown' themselves when there is none
export const tokLabel = (n: number, t: (id: string, a?: Record<string, string | number>) => string): string => t('v74.c.tok', { n: n >= 1_000_000 ? fmtCount(n) : n >= 1000 ? String(Math.round(n / 1000)) + 'k' : String(n) })
export const brokenRow = (text: string): Row => [staleBadge(text)]

// Wrap a row onto further rows at `cols` without dropping or truncating characters, so a broken/no-source reason is never cut with `…` (A10, G6, M7).
// `hang` > 0 (N3): every continuation row starts with `hang` blank cells (a hanging indent, so the left status-glyph column stays clean), and a row breaks after a clause
// boundary (：，、；。· ） / blank) when that boundary is in the second half of the row; otherwise it breaks at the width as before.
const CLAUSE_END = /[：，、；。·）／\s]/
const STRONG_CLAUSE_END = /[：，、；。／]/
export const WRAP_HANG = 2 // the hang the frame wraps a body row with (frame.ts re-exports it)
export function wrapRow(row: Row, cols: number, hang = 0): Row[] {
  if (cols <= 0 || row.reduce((w, x) => w + displayWidth(x.text), 0) <= cols) return [row]
  if (hang > 0 && hang < cols - 1) return wrapHanging(row, cols, hang)
  const out: Row[] = []
  let cur: Row = []
  let used = 0
  for (const seg of row) {
    let buf = ''
    for (const ch of seg.text) {
      const w = displayWidth(ch)
      if (used + w > cols) {
        if (buf !== '') cur.push({ ...seg, text: buf })
        out.push(cur)
        cur = []
        buf = ''
        used = 0
      }
      buf += ch
      used += w
    }
    if (buf !== '') cur.push({ ...seg, text: buf })
  }
  if (cur.length > 0) out.push(cur)
  return out
}

function wrapHanging(row: Row, cols: number, hang: number): Row[] {
  const chars: { ch: string; si: number; w: number }[] = []
  row.forEach((s, si) => { for (const ch of s.text) chars.push({ ch, si, w: displayWidth(ch) }) })
  const lines: { ch: string; si: number; w: number }[][] = []
  let i = 0
  while (i < chars.length) {
    const lim = lines.length === 0 ? cols : cols - hang
    let used = 0
    let j = i
    while (j < chars.length && used + chars[j].w <= lim) { used += chars[j].w; j++ }
    if (j < chars.length) {
      // Z1: punctuation outranks spaces inside a clause. A middle dot belongs
      // to the following hint, so `· z 收合` moves together to the next row.
      let clause = -1
      for (let k = i + 1; k <= j; k++) {
        if (STRONG_CLAUSE_END.test(chars[k - 1].ch)) clause = k
        if (chars[k]?.ch === '·') clause = k
      }
      const clauseWidth = chars.slice(i, Math.max(i, clause)).reduce((w, c) => w + c.w, 0)
      if (clause > i && clauseWidth * 2 >= used) j = clause
      else {
        let k = j
        while (k > i && !CLAUSE_END.test(chars[k - 1].ch)) k--
        if (k > i && (k - i) * 2 >= j - i) j = k
      }
    }
    // Keep closing punctuation with its preceding character without exceeding the row width.
    if (j < chars.length && /[。，、；：！？）］｝〉》」』】]/.test(chars[j].ch)) {
      while (j > i + 1 && /[。，、；：！？）］｝〉》」』】]/.test(chars[j].ch)) j--
    }
    if (j === i) j = i + 1
    lines.push(chars.slice(i, j))
    i = j
    while (i < chars.length && chars[i].ch === ' ') i++ // a continuation never starts with a blank of its own (the indent is the hang)
  }
  return lines.map((ln, li) => {
    // N3: the hanging indent keeps the continued text's colour, including a wholly red source-reason row.
    const out: Row = li === 0 ? [] : [{ text: ' '.repeat(hang), color: row[ln[0].si].color }]
    let lastSi = -1
    for (const c of ln) {
      if (c.si === lastSi) { const prev = out[out.length - 1]; out[out.length - 1] = { ...prev, text: prev.text + c.ch } }
      else { out.push({ ...row[c.si], text: c.ch }); lastSi = c.si }
    }
    return out
  })
}

// ---- shared across pages (gate round 1 & round 2) ----
import type { ConsoleIssue, ConsoleLine, ConsoleSnapshot } from '../console'
import type { T } from '../i18n'
import { ROLE_SUCCESS, isUnknownPool, normalizedPools, rankPools } from './quota-pick'

const ISSUE_RANK: Record<string, number> = { failed: 0, stalled: 1 }
export const BRIEF_STALE_MS = 10 * 60_000

export type LineStateInfo = { sid: StateId; word: string; worst: ConsoleIssue | null }

// ONE shared production-line state classifier used by both 現況 and 艦隊 so the same line always gets the same state word (離線 / 閒置 / 卡住)
export function lineState(line: ConsoleLine, t: T): LineStateInfo {
  const rank = (x: ConsoleIssue): number => ISSUE_RANK[x.state] ?? 2
  const surfaced = (x: ConsoleIssue): number => (x.to_console ? 0 : 1)
  const worst = [...line.issues].sort((a, b) => rank(a) - rank(b) || surfaced(a) - surfaced(b) || a.since_ms - b.since_ms)[0] ?? null
  // M4: a line with no issue record is a normal line (the feed's summary counts it as running / waiting); it is never drawn as 閒置
  if (worst === null) return { sid: 'pending', word: t('page.fleet.no_issue_detail'), worst: null }
  const subj = typeof worst.subject === 'string' ? worst.subject : ''
  const isOffline = /^T4$/i.test(worst.rule) || /offline|離線/i.test(worst.rule) || /offline|離線/i.test(subj)
  const isIdle = !isOffline && (/^T3$/i.test(worst.rule) || /(?:^|[_-])idle(?:$|[_-])|閒置/i.test(worst.rule) || /閒置|\bidle\b/i.test(subj))
  const word = isOffline ? t('page.fleet.w_offline') : isIdle ? t('page.fleet.idle') : t('page.fleet.w_stuck')
  const sid: StateId = isOffline ? 'failed' : worst.state in STATES ? (worst.state as StateId) : 'stalled' // X3: offline is always ✗.
  return { sid, word, worst }
}

// X3: bus line detail is authoritative wherever available. Unlisted lines carry
// no state detail; keep their count as ○ rather than inventing running/idle states.
export function lineCounts(con: ConsoleSnapshot, t: T): Partial<Record<StateId, number>> {
  if (con.lines === null || con.lines.length === 0) return { ...con.counts.summary.lines }
  const counts: Partial<Record<StateId, number>> = {}
  for (const line of con.lines) {
    const { sid } = lineState(line, t)
    counts[sid] = (counts[sid] ?? 0) + 1
  }
  const unlisted = Math.max(0, lineTotal(con) - con.lines.length)
  if (unlisted > 0) counts.pending = (counts.pending ?? 0) + unlisted
  return counts
}

export function consoleFleetCounts(con: ConsoleSnapshot, t: T) {
  const c = lineCounts(con, t)
  return { failed: c.failed ?? 0, stuck: c.stalled ?? 0, running: c.running ?? 0, waiting: c.waiting ?? 0, normal: c.pending ?? 0 }
}

// Y3: one duration and one line/status grammar on both pages; issue subjects
// often contain an older rounded duration and must not supply the status text.
export function lineDuration(ms: number, t: T): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h === 0 ? t('page.fleet.age_min', { n: m }) : t('page.fleet.age_hour', { n: h }) + (m === 0 ? '' : ' ' + t('page.fleet.age_min', { n: m }))
}
export function lineStatusText(line: ConsoleLine, t: T, nowMs: number, cols = Infinity): string {
  const s = lineState(line, t)
  const suffix = ' ' + s.word + (s.worst === null ? '' : '（' + lineDuration(nowMs - s.worst.since_ms, t) + '）')
  return truncateToWidth(line.label, Math.max(1, cols - displayWidth(suffix))) + suffix
}

// true when fleet.brief (console snapshot / tasks source) is older than 10 minutes or expired (R8)
export function isBriefStale(con: ConsoleSnapshot, nowMs: number): { stale: boolean; min: number; expired: boolean } {
  const tasks = con.sources.tasks
  const expired = tasks?.state === 'expired'
  const genAge = con.generated_at_ms > 0 ? nowMs - con.generated_at_ms : 0
  const taskAge = tasks?.at_ms != null ? nowMs - tasks.at_ms : 0
  const over10 = (con.generated_at_ms > 0 && genAge > BRIEF_STALE_MS) || (tasks?.at_ms != null && taskAge > BRIEF_STALE_MS)
  const ageMs = Math.max(genAge, taskAge)
  return { stale: over10 || expired, min: Math.max(0, Math.floor(ageMs / 60_000)), expired }
}

// pending decision cards across console.cards (plus counts.decisions) and this seat's own live.pending (step / look items excluded), deduplicated by id
export function decisionCount(ctx: { console: ConsoleSnapshot | null; live: LiveSnapshot | null }): number {
  const { console: con, live } = ctx
  const own = live === null ? [] : live.pending.filter(d => !isStepCard(d))
  const ownOnly = own.filter(d => !(con?.cards ?? []).some(c => c.id === d.id)).length
  return con !== null ? Math.max(con.counts.decisions, (con.cards?.length ?? 0) + ownOnly) : own.length
}

// true when neither console.cards nor live.pending has a card source (the source is missing, not empty)
export function pendingSourceMissing(ctx: { console: ConsoleSnapshot | null; live: LiveSnapshot | null }): boolean {
  const { console: con, live } = ctx
  const hasConsole = con !== null && con.cards !== null && con.sources.cards?.state !== 'no_source'
  const hasLive = live !== null && (live.state === 'ok' || live.pending.some(d => !isStepCard(d)))
  return !hasConsole && !hasLive
}

// why pendingSourceMissing is true: list only the sources that are actually absent (pointer file absent, console snapshot absent)
export function pendingMissingReason(ctx: { console: ConsoleSnapshot | null; live: LiveSnapshot | null }, t: T): string {
  const { console: con, live } = ctx
  const reasons: string[] = []
  if (live === null || live.state === 'no-pointer') reasons.push(t('page.now.nosrc_pointer'))
  if (con === null) reasons.push(t('page.now.nosrc_console'))
  if (reasons.length === 0) {
    if (con !== null && (con.cards === null || con.sources.cards?.state === 'no_source')) reasons.push(t('page.decide.nosrc_cards'))
    else reasons.push(t('page.decide.nosrc_live'))
  }
  return reasons.join(t('sep.list'))
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
  return pools === null ? 0 : rankPools(pools, nowMs, t).filter(isUnknownPool).length
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
