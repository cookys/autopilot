// mods/live/pages/now.ts — page 1 現況 (plan r2 §2 row 1, §3.1, §5; g2 folds A3, A10, A11): the fleet overview line (lines, hosts, quota), the exceptions, then this seat (position, tasks,
// background, dispatch, review, spend, residue), the recent dialogue, and jump hints to the other pages in the action area.
// Pure like the other pages: rows come from `ctx.live` and `ctx.console`; the only state is the own-seat quota feed below (`seatQuota`), which register.ts feeds with
// `seatQuota.refresh(run, nowMs)` once per tick (the 60 s cache and the keep-the-last-good rule live in the feed, nothing is spawned while drawing).
// A broken or missing source is a red row with the reason (§5): the number stays beside it, never replaced by a dash. Colours go through PALETTE only.
import type { ConsoleItem, ConsoleSnapshot } from '../console'
import type { LiveSnapshot, QcView, Seg } from '../model'
import { DEFAULT_VALID_FOR_S, TRACE_STALE_MIN, TRACE_STALE_MS, displayWidth, isStepCard, liveAgeMs, truncateToWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { fleetLines, type PmStatus } from '../v74/contract'
import { ROLE_WARNING, isUnknownPool, normalizedPools, poolKey, poolLabel, rankPools, worstPool } from './quota-pick'
import type { Verdict } from './quota-pick'
import { STRIP_SPLIT_COLS } from './layout'
import type { Page, PageCtx } from './frame'
import { WRAP_HANG, brokenRow, consoleFleetCounts, dataMissing, decisionCount, isBriefStale, lineCounts, lineState, lineStatusText, lineTotal, pendingMissingReason, pendingSourceMissing, staleBadge, stuckLinesOf, tokLabel, wrapRow } from './rows'
import type { Row } from './rows'

type T = PageCtx['t']


// ---- the own-seat quota feed (fold A3: every seat may call `fleet seats --quota --json`; 60 s cache) ----
export const SEATS_ARGV = ['fleet', 'seats', '--quota', '--json'] as const
export const SEATS_EVERY_MS = 60_000
export const SEATS_TIMEOUT_MS = 5_000
export const SEATS_RED_AFTER_MS = 10 * 60_000 // a failed command with a last good result older than this is red (A3)
export const SEATS_MAX_BYTES = 1_000_000
export type SeatQuotaRow = { seat: string | null; pool: string | null; five_hour_pct: number | null; seven_day_pct: number | null; stale: boolean; self: boolean }
export type SeatsRunner = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; isStdoutTruncated?: boolean }>
export type SeatQuotaView = { row: SeatQuotaRow | null; got_at_ms: number | null; failed: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const pct = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

// untrusted command output -> the rows (null = not the expected shape). The seat of this session is the row marked `self: true` (the bus marks the caller's own row).
export function parseSeatQuota(text: string): SeatQuotaRow[] | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.seats) ? raw.seats : null
  if (list === null) return null
  return list.filter(isObj).map(r => ({
    seat: str(r.seat) ?? str(r.name) ?? str(r.member),
    pool: str(r.pool_key) ?? str(r.pool),
    five_hour_pct: pct(r.five_hour_pct) ?? pct(r.five_hour),
    seven_day_pct: pct(r.seven_day_pct) ?? pct(r.seven_day),
    stale: r.stale === true,
    self: r.self === true,
  }))
}

export function makeSeatQuotaFeed(everyMs = SEATS_EVERY_MS) {
  let row: SeatQuotaRow | null = null
  let gotAt: number | null = null
  let failed = false
  let triedMs: number | null = null
  let busy = false
  return {
    view: (): SeatQuotaView => ({ row, got_at_ms: gotAt, failed }),
    reset: (): void => { row = null; gotAt = null; failed = false; triedMs = null; busy = false },
    refresh: async (run: SeatsRunner, nowMs: number): Promise<boolean> => {
      if (busy || (triedMs !== null && nowMs - triedMs < everyMs)) return false
      busy = true
      triedMs = nowMs
      try {
        let rows: SeatQuotaRow[] | null = null
        try {
          const r = await run(SEATS_ARGV)
          if (r.exitCode === 0 && r.isStdoutTruncated !== true && r.stdout.length <= SEATS_MAX_BYTES) rows = parseSeatQuota(r.stdout)
        } catch { rows = null }
        if (rows === null) { failed = true; return true } // the last good result stays
        row = rows.find(x => x.self) ?? null
        gotAt = nowMs
        failed = false
      } finally { busy = false }
      return true
    },
  }
}
export const seatQuota = makeSeatQuotaFeed()

// ---- small drawing helpers ----
const ageOf = (t: T, ms: number, ago = true): string => {
  const a = ageUnit(t, ms)
  return ago ? t('page.now.ago', { age: a }) : a
}
export const ageUnit = (t: T, ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t('page.now.age_s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('page.now.age_m', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('page.now.age_h', { n: h }) : t('page.now.age_d', { n: Math.floor(h / 24) })
}
const blank = (): Row => [{ text: '' }]
const plain = (text: string, extra: Partial<Seg> = {}): Seg => ({ text, ...extra })
const dim = (text: string): Seg => ({ text, dim: true })
const broken = (text: string): Row => brokenRow(GLYPHS.state.failed + ' ' + text)
const glyph = (state: string): { text: string; color?: Seg['color'] } => {
  const g = (GLYPHS.state as Record<string, string>)[state] ?? GLYPHS.state.need_you
  const color = state === 'failed' || state === 'stalled' ? PALETTE.broken : state === 'running' ? PALETTE.running : state === 'need_you' ? PALETTE.attention : undefined
  return { text: g, ...(color === undefined ? {} : { color }) }
}
// `── title ──` filled with rules to 54 cells on a wide page (the mockup's section rule), short on a narrow one
const ruleRow = (title: string, wide: boolean): Row => {
  const head = GLYPHS.structure.rule + GLYPHS.structure.rule + ' ' + title + ' ' + GLYPHS.structure.rule + GLYPHS.structure.rule
  return [{ text: head + (wide ? GLYPHS.structure.rule.repeat(Math.max(0, 54 - displayWidth(head))) : ''), color: PALETTE.structure }]
}
// truncate a single-row item with `…` so it never wraps onto a second row (R11; stale/no-source reasons do not call this)
function truncateSegs(row: Row, cols: number): Row {
  if (cols <= 0) return [{ text: '' }]
  const total = row.reduce((w, s) => w + displayWidth(s.text), 0)
  if (total <= cols) return row
  const out: Row = []
  let used = 0
  for (const s of row) {
    const w = displayWidth(s.text)
    if (used + w <= cols) { out.push(s); used += w; continue }
    const room = cols - used
    if (room > 0) out.push({ ...s, text: truncateToWidth(s.text, room) })
    break
  }
  return out.length === 0 ? [{ text: '' }] : out
}
// the left part (cut with `…` when too wide), then `right` fixed against the right edge, never wrapped (R11)
function rightAlign(left: Seg[], right: string, cols: number): Row {
  const rw = displayWidth(right)
  if (rw === 0 || cols <= rw + 2) return truncateSegs(left, cols)
  const cut = truncateSegs(left, cols - 2 - rw)
  const lw = cut.reduce((w, s) => w + displayWidth(s.text), 0)
  return [...cut, plain(' '.repeat(Math.max(2, cols - lw - rw))), dim(right)]
}
const labelled = (label: string, wide: boolean, ...rest: Seg[]): Row => (wide ? [dim('  ' + label + ' '.repeat(Math.max(1, 7 - displayWidth(label)))), ...rest] : rest)

// ---- the fleet overview + exceptions ----
// The quota overview line names the pool the band and the quota page name: `worstPool` of pages/quota-pick.ts, the first of the same order. The pools are the parsed console's
// `quota.pools` (null = no source: the §5 row).
function quotaWorstSeg(ctx: PageCtx, wide: boolean): Seg[] {
  const { t } = ctx
  const pools = normalizedPools(ctx.console)
  if (pools === null) return [staleBadge(GLYPHS.state.failed + ' ' + t('page.now.quota_no_source'))]
  const w = worstPool(pools, ctx.nowMs, t)
  if (w === null) return [dim(t('page.now.quota_empty'))]
  const color = w.role === 'broken' ? PALETTE.broken : w.role === ROLE_WARNING ? PALETTE.attention : PALETTE.done
  return [{ text: (w.role === 'broken' && !wide ? GLYPHS.state.failed + ' ' : '') + (wide ? t('page.now.quota_worst') + ' ' : '') + w.pool + ' ' + w.text, color }]
}

const LINE_ORDER = ['failed', 'stalled', 'running', 'waiting', 'pending'] as const
const lineWord = (t: T, k: (typeof LINE_ORDER)[number]): string => (k === 'running' ? t('page.now.line_running') : k === 'waiting' ? t('page.now.line_waiting') : k === 'stalled' ? t('page.now.line_stalled') : k === 'pending' ? t('page.fleet.w_normal') : t('page.now.line_failed'))
function overviewRows(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean): Row[] {
  const { t, size } = ctx
  const s = con.counts.summary
  const counts = lineCounts(con, t)
  const total = lineTotal(con)
  // N4: an old snapshot keeps its old values, each with the ✗ mark, and says its age once (`產線 9✗ ◉2 ⋯1 ⊘6 · 主機 4/6✗ · ✗ 資料已過期 12 分前`)
  const bs = isBriefStale(con, ctx.nowMs)
  const totalText = String(total)
  const totalSeg: Seg = bs.stale ? staleBadge(totalText + GLYPHS.state.failed) : plain(totalText)
  const lead: Seg[] = wide ? [plain('  ' + t('page.now.lines') + ' '), totalSeg, plain(' ｜ ')] : [plain(t('page.now.lines') + ' '), totalSeg, plain(' ')]
  const chips: Seg[] = []
  for (const k of LINE_ORDER) {
    const n = counts[k]
    if (n === undefined || n === 0) continue
    const g = glyph(k)
    const word = wide ? ' ' + lineWord(t, k) + ' ' + n : n + ''
    chips.push({ text: (chips.length > 0 ? (wide ? '  ' : ' ') : '') + g.text + word, ...(g.color === undefined ? {} : { color: g.color }) })
  }
  const hosts: Seg[] = []
  const h = s.hosts
  const hs = con.sources.hosts
  const hasCounts = typeof h.online === 'number' && typeof h.total === 'number'
  if (hs !== undefined && hs.state === 'expired' && hasCounts) hosts.push(staleBadge(h.online + '/' + h.total + GLYPHS.state.failed + (wide ? ' ' + t('page.now.hosts_online') : '')))
  else if (hs !== undefined && (hs.state === 'expired' || hs.state === 'no_source')) hosts.push(staleBadge(GLYPHS.state.failed + ' ' + t(hs.state === 'expired' ? 'page.now.hosts_expired' : 'page.now.hosts_no_source')))
  else if (hasCounts) hosts.push(plain(h.online + '/' + h.total + (wide ? ' ' + t('page.now.hosts_online') : '')))
  const sep = wide ? plain(' ｜ ') : plain(' · ')
  const staleSegs: Seg[] = bs.stale ? [sep, staleBadge(GLYPHS.state.failed + ' ' + t('page.now.brief_stale', { min: bs.min, why: t('page.now.hosts_expired') }))] : []
  const main: Seg[] = [...lead, ...chips, ...(hosts.length > 0 ? [sep, ...(wide ? [plain(t('page.now.hosts') + ' ')] : [plain(t('page.now.hosts') + ' ')]), ...hosts] : []), ...staleSegs]
  // the pools that need a look are listed one per row under the exceptions (poolRows); the overview names the worst one only when there is nothing to list
  if (poolRows(ctx, con, wide).length > 0) return [main]
  const q = quotaWorstSeg(ctx, wide)
  const qSegs: Seg[] = [wide ? dim(t('page.now.quota') + ' ') : plain(t('page.now.quota') + ' '), ...q]
  if (wide && size.cols < 150) return [main, labelled(t('page.now.quota'), true, ...q)]
  return [[...main, wide ? plain(' ｜ ') : plain(' · '), ...qSegs]]
}

// every pool that is red or whose verdict is unknown, in danger order, one row each and in full (the row wraps in the frame, never "+N"); the verdict text is the quota page's (G2, G5, G10, R4)
function poolRowOf(ctx: PageCtx, v: Verdict, wide: boolean): Row {
  const red = v.role === 'broken'
  const icon = red ? GLYPHS.state.failed : isUnknownPool(v) ? GLYPHS.state.unknown : GLYPHS.state.need_you
  return [dim(wide ? '  ' : ''), { text: icon + ' ' + ctx.t('page.now.quota') + ' ' + poolLabel(v.pool) + ' ' + v.text, color: red ? PALETTE.broken : PALETTE.attention }]
}
function poolRows(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean, includeWaste = true): Row[] {
  const pools = normalizedPools(con)
  if (pools === null) return []
  return rankPools(pools, ctx.nowMs, ctx.t).filter(v => v.role === 'broken' || isUnknownPool(v) || (includeWaste && v.role === ROLE_WARNING)).map(v => poolRowOf(ctx, v, wide))
}

// the items the exceptions block draws: non-quota exceptions, surfaced line issues (via shared lineState, R3), and `seat_blocked` items whose pool is not already in quota.pools (R1)
const isSeatBlocked = (i: ConsoleItem): boolean => i.kind === 'seat_blocked'
const HOST_OFFLINE_RE = /主機.*離線|離線.*主機|\bhosts?\b.*\boffline\b|\boffline\b.*\bhosts?\b/i
const isOfflineHostExc = (i: ConsoleItem): boolean =>
  i.kind === 'exception' && i.to_console === true && !i.id.startsWith('quota:') && i.line_id === null
  && (/^exc:host[_:-]?offline\b/i.test(i.id) || HOST_OFFLINE_RE.test(i.title) || HOST_OFFLINE_RE.test(i.text))
// r8-3 #5: pools with the same verdict text share one row that names them all (`✗ 額度 a、b、c 沒有額度資料`), so five identical errors do not push the lines down
export function mergedPoolRows(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean): Row[] {
  const pools = normalizedPools(con)
  if (pools === null) return []
  const groups = new Map<string, { v: Verdict; names: string[] }>()
  for (const v of rankPools(pools, ctx.nowMs, ctx.t).filter(x => x.role === 'broken' || isUnknownPool(x) || x.role === ROLE_WARNING)) {
    const key = v.role + '|' + v.text
    const g = groups.get(key)
    if (g === undefined) groups.set(key, { v, names: [poolLabel(v.pool)] })
    else g.names.push(poolLabel(v.pool))
  }
  return [...groups.values()].map(({ v, names }) => {
    const red = v.role === 'broken'
    const icon = red ? GLYPHS.state.failed : isUnknownPool(v) ? GLYPHS.state.unknown : GLYPHS.state.need_you
    return [dim(wide ? '  ' : ''), { text: icon + ' ' + ctx.t('page.now.quota') + ' ' + names.join('、') + ' ' + v.text, color: red ? PALETTE.broken : PALETTE.attention }]
  })
}
function exceptionRows(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean): Row[] {
  const { t, nowMs, size } = ctx
  const pools = normalizedPools(con)
  const seenPools = new Set((pools ?? []).map(p => poolKey(p.pool)))
  const lineMap = new Map((con.lines ?? []).map(l => [l.line_id, l]))
  const stateWords = [t('page.fleet.w_offline'), t('page.fleet.idle'), t('page.fleet.w_stuck')]
  const items = con.items.filter((i: ConsoleItem) => {
    if (i.kind === 'quota' || i.id.startsWith('quota:')) return false
    if (isSeatBlocked(i)) {
      if (i.to_console === false) return false
      if (typeof i.facts.pool !== 'string') return true
      const pk = poolKey(i.facts.pool)
      if (seenPools.has(pk)) return false
      seenPools.add(pk)
      return true
    }
    if (i.kind !== 'exception' || i.to_console !== true) return false
    if (i.line_id !== null && i.id.startsWith('exc:T3:')) {
      const ln = lineMap.get(i.line_id)
      if (ln !== undefined && ln.issues.some(x => x.to_console) && lineState(ln, t).word === t('page.fleet.w_offline')) return false
    }
    return true
  })
  const coveredLines = new Set<string>()
  // N2: this page has no row action, so no row carries the ▸ focus mark; the production-line rows take the 艦隊 page's order (failed, then stalled, each longest first)
  // in the places line rows hold, and a narrow line row says how long (`甲線 離線：成員離線（20 分）`), like the wide row's right-hand age
  const RANK: Record<string, number> = { failed: 0, stalled: 1 }
  type Entry = { row: Row; line: boolean; rank: number; since: number }
  const entries: Entry[] = items.map(it => {
    if (it.line_id !== null) coveredLines.add(it.line_id)
    const ln = it.line_id === null ? undefined : lineMap.get(it.line_id)
    const ls = ln !== undefined && ln.issues.some(x => x.to_console) ? lineState(ln, t) : null
    const useLs = ls !== null && (it.id.startsWith('exc:T3:') || it.id.startsWith('exc:T4:'))
    const g = glyph(useLs ? ls.sid : it.state)
    const f = it.facts
    const stale = isSeatBlocked(it) && f.stale === true
    let body = wide ? it.text : it.title
    if (useLs && !stateWords.some(w => body.includes(w))) body = (ln?.label ?? '') + ' ' + ls.word + '：' + body
    const line = ln !== undefined
    const since = useLs && ls.worst !== null ? ls.worst.since_ms : it.since_ms
    const meta = { line, rank: RANK[useLs ? ls.sid : it.state] ?? 2, since }
    const lead: Seg[] = [dim(' ' + (wide ? ' ' : '')), { text: g.text, ...(g.color === undefined ? {} : { color: g.color }) }]
    if (stale) return { row: [...lead, staleBadge(' ' + body + ' ' + GLYPHS.state.failed + ' ' + t('page.now.seat_blocked_stale', { source: String(f.source ?? '?') }))], ...meta }
    const detail = line && ls?.word !== t('page.fleet.idle') ? '：' + body : ''
    const left: Seg[] = [...lead, plain(' ' + (line ? lineStatusText(ln!, t, nowMs) + detail : body))]
    return { row: line ? truncateSegs(left, size.cols) : wide ? rightAlign(left, ageOf(t, nowMs - it.since_ms), size.cols - 1) : truncateSegs(left, size.cols), ...meta }
  })
  for (const ln of con.lines ?? []) {
    if (coveredLines.has(ln.line_id) || !ln.issues.some(x => x.to_console)) continue
    const ls = lineState(ln, t)
    if (ls.worst === null) continue
    const g = glyph(ls.sid)
    const lead: Seg[] = [dim(' ' + (wide ? ' ' : '')), { text: g.text, ...(g.color === undefined ? {} : { color: g.color }) }]
    const subject = typeof ls.worst.subject === 'string' ? ls.worst.subject : ''
    const detail = ls.word !== t('page.fleet.idle') && subject !== '' ? '：' + subject : ''
    const left: Seg[] = [...lead, plain(' ' + lineStatusText(ln, t, nowMs) + detail)]
    entries.push({ row: truncateSegs(left, size.cols), line: true, rank: RANK[ls.sid] ?? 2, since: ls.worst.since_ms })
  }
  const lineSorted = entries.filter(e => e.line).sort((a, b) => a.rank - b.rank || a.since - b.since)
  let k = 0
  return entries.map(e => (e.line ? lineSorted[k++] : e).row)
}

// ---- this seat ----
// own-seat quota (A3): wide = `本席（池 team）5 小時 17% · 7 天 68% · 今天 $3.10（seats --quota 40 秒前）`, compact = `7 天 68%`. No source, no row for the seat and a failed command
// are red or yellow with the reason (§5); a failed command with a cached result keeps its numbers and says `指令失敗，用 N 秒前的結果` (yellow, red after 10 minutes).
function spendSegs(ctx: PageCtx, live: LiveSnapshot, wide: boolean): Seg[] {
  const { t, nowMs } = ctx
  const v = seatQuota.view()
  const today = live.detail.spend?.session ?? null
  const todayText = today === null || !wide ? '' : ' · ' + t('page.now.today', { v: today })
  if (v.got_at_ms === null) return [staleBadge(GLYPHS.state.failed + ' ' + t(v.failed ? 'page.now.q_failed_none' : 'page.now.q_none')), ...(todayText === '' ? [] : [plain(todayText)])]
  const ageMs = nowMs - v.got_at_ms
  const r = v.row
  if (r === null) return [staleBadge(GLYPHS.state.failed + ' ' + t('page.now.q_no_self', { age: ageOf(t, ageMs) }))]
  const five = r.five_hour_pct === null ? '—' : Math.floor(r.five_hour_pct) + '%'
  const seven = r.seven_day_pct === null ? '—' : Math.floor(r.seven_day_pct) + '%'
  const mark = r.stale ? GLYPHS.state.failed + ' ' : ''
  const figures = wide ? mark + t('page.now.q_5h') + ' ' + five + ' · ' + t('page.now.q_7d') + ' ' + seven : mark + t('page.now.q_7d') + ' ' + seven
  const lead = wide ? t('page.now.mine') + (r.pool === null ? ' ' : '（' + t('page.now.pool', { pool: poolLabel(r.pool) }) + '）') : ''
  const segs: Seg[] = [{ text: lead + figures, ...(r.stale ? { color: PALETTE.broken } : {}) }, ...(todayText === '' ? [] : [plain(todayText)])]
  if (v.failed) {
    const red = ageMs > SEATS_RED_AFTER_MS
    segs.push({ text: '（' + t('page.now.q_failed', { n: Math.floor(ageMs / 1000) }) + '）', color: red ? PALETTE.broken : PALETTE.attention })
  } else if (wide) segs.push(dim('（seats --quota ' + ageOf(t, ageMs) + '）'))
  return segs
}

function seatRows(ctx: PageCtx, live: LiveSnapshot, wide: boolean): Row[] {
  const { t, nowMs } = ctx
  const d = live.detail
  const out: Row[] = []
  const stage = d.marker?.stage ?? d.stage?.current ?? null
  const proj = d.project ?? live.project_key
  const project = proj !== null && stage === null && /^[0-9a-f]{16,64}$/i.test(proj) ? t('page.now.project_unknown', { id: proj }) : proj
  const where = [project, stage === null ? null : wide ? t('page.now.stage', { stage }) : stage, live.metrics === undefined ? null : t('header.ctx') + ' ' + live.metrics.ctx].filter((x): x is string => x !== null)
  if (where.length > 0) out.push(labelled(t('page.now.l_where'), wide, plain(where.join(' · '))))
  const tasks = live.sections.tasks
  if (tasks !== null && tasks.total > 0) {
    const open = tasks.rows.filter(r => r.status !== 'completed')
    const cur = tasks.current ?? open[0]?.subject ?? null
    out.push(labelled(t('page.now.l_tasks'), wide, plain(cur === null ? t('page.now.tasks_n', { done: tasks.completed, total: tasks.total }) : GLYPHS.state.waiting + ' ' + cur + (wide ? ' · ' + t('page.now.tasks_n', { done: tasks.completed, total: tasks.total }) : ''))))
  }
  const act = live.activity ?? []
  if (act.length > 0) {
    const shown = act.slice(0, wide ? 3 : 2).map(a => GLYPHS.state.running + ' ' + a.label)
    const bg = plain(shown.join(' · ') + (act.length > shown.length ? ' +' + (act.length - shown.length) : ''))
    out.push(wide ? labelled(t('page.now.l_bg'), true, bg) : [plain(t('page.now.l_bg') + ' '), bg])
  }
  const rows = live.rows ?? []
  const running = d.counts?.confirmed_live ?? rows.filter(r => !r.stall).length
  const dispatch: Seg[] = []
  if (d.counts !== null || rows.length > 0) {
    const first = rows.find(r => !r.stall)
    const name = first === undefined ? '' : [first.runner, first.role].filter(Boolean).join(' ') + (first.elapsed_s === null ? '' : ' ' + ageOf(t, first.elapsed_s * 1000, false))
    dispatch.push(plain(GLYPHS.state.running + ' ' + (wide ? t('page.now.running_n', { n: running }) + (name === '' ? '' : '（' + name + '）') : String(running))))
    if (d.stalled > 0) dispatch.push({ text: ' · ' + GLYPHS.state.stalled + ' ' + t('page.now.stalled_n', { n: d.stalled }), color: PALETTE.broken })
  }
  const rv = live.review
  const bits: string[] = []
  if (rv?.plan != null) {
    const back = rv.plan.seats.filter(s => s.status !== null && s.status !== 'pending' && s.status !== 'running').length
    bits.push(wide ? t('page.now.plan_gen', { gen: rv.plan.generation, back, total: rv.plan.seats.length }) : back + '/' + rv.plan.seats.length)
  }
  if (wide && rv?.code != null && rv.code.generation !== null) bits.push(t('page.now.code_gen', { gen: rv.code.generation, ok: rv.code.converged ? GLYPHS.state.done : GLYPHS.state.waiting }))
  if (wide) {
    if (dispatch.length > 0) out.push(labelled(t('page.now.l_dispatch'), true, ...dispatch))
    if (bits.length > 0) out.push(labelled(t('page.now.l_review'), true, plain(bits.join(' · '))))
    out.push(labelled(t('page.now.l_spend'), true, ...spendSegs(ctx, live, true)))
    if (d.residue !== null && d.residue.reapable > 0) out.push(labelled(t('page.now.l_residue'), true, plain(t('page.now.residue_n', { n: d.residue.reapable }))))
  } else {
    // 80 columns: dispatch, review and spend share one row (the residue count is the action row below)
    const parts: Seg[][] = []
    if (dispatch.length > 0) parts.push([plain(t('page.now.l_dispatch') + ' '), ...dispatch])
    if (bits.length > 0) parts.push([plain(t('page.now.l_review') + ' ' + bits.join(' · '))])
    parts.push([plain(t('page.now.l_spend') + ' '), ...spendSegs(ctx, live, false)])
    out.push(parts.flatMap((p, i) => (i === 0 ? p : [plain(' · '), ...p])))
  }
  void nowMs
  return out
}

const firstLine = (s: string): string => (s.split('\n').find(l => l.trim() !== '') ?? '').trim()
function recentRows(live: LiveSnapshot, wide: boolean, cols: number): Row[] {
  const groups = (live.recent ?? []).slice(0, 2)
  const padW = wide ? 2 : 0
  return groups.map(g => [plain((wide ? '  ' : '') + truncateToWidth(firstLine(g.prompt), Math.max(8, cols - padW)))])
}

// oldest open decision card across console.cards and this seat's live.pending (excluding step/look items)
function oldestDecision(ctx: PageCtx): { question: string; openedMs: number | null } | null {
  const { console: con, live, nowMs } = ctx
  const entries: { id: string; question: string; openedMs: number | null }[] = []
  const seen = new Set<string>()
  for (const c of con?.cards ?? []) {
    seen.add(c.id)
    entries.push({ id: c.id, question: c.question, openedMs: c.opened_at_ms })
  }
  for (const d of (live?.pending ?? []).filter(x => !isStepCard(x))) {
    if (d.id !== null && seen.has(d.id)) continue
    const openedMs = d.age_s !== null ? nowMs - d.age_s * 1000 : d.opened_at !== null ? (Date.parse(d.opened_at) || null) : null
    entries.push({ id: d.id ?? '', question: d.question, openedMs })
  }
  if (entries.length === 0) return null
  const dated = entries.filter((x): x is { id: string; question: string; openedMs: number } => x.openedMs !== null).sort((a, b) => a.openedMs - b.openedMs)
  return dated[0] ?? entries[0]
}

// combined pending Button + summary row (R2, R8, R11): single-row `…` cut on title when fresh; `✗` + short reason when seat pending snapshot is stale
function pendingRowOf(ctx: PageCtx, decisions: number, short: boolean): Row | null {
  const { t, size, live, nowMs } = ctx
  const liveStale = live !== null && live.state !== 'ok'
  if (pendingSourceMissing(ctx)) {
    const why = pendingMissingReason(ctx, t)
    if (live !== null && live.state === 'stale') {
      const raw = (live.header ?? '').trim()
      const shortWhy = (raw.split(' · ')[0] ?? '').trim() || t('page.fleet.state_stale')
      return [staleBadge(GLYPHS.state.failed + ' ' + t('page.now.pending_no_source', { why }) + '  ' + GLYPHS.state.failed + ' ' + t('page.now.pending_stale', { why: shortWhy }))]
    }
    return [staleBadge(GLYPHS.state.failed + ' ' + t('page.now.pending_no_source', { why }))]
  }
  if (decisions <= 0 && !liveStale) return null
  const oldest = oldestDecision(ctx)
  const countText = t(short ? 'page.now.pending_short' : 'page.now.go_decide', { n: decisions })
  const age = oldest === null || oldest.openedMs === null ? '' : t('page.now.oldest', { age: ageOf(t, nowMs - oldest.openedMs, false) })
  const prefix = GLYPHS.structure.answer + ' ' + countText + age
  if (liveStale) {
    const raw = (live.header ?? '').trim()
    const shortWhy = (raw.split(' · ')[0] ?? '').trim() || t('page.fleet.state_stale')
    const staleMark = GLYPHS.state.failed + ' ' + t('page.now.pending_stale', { why: shortWhy })
    if (decisions > 0) {
      const q = oldest === null ? '' : firstLine(oldest.question)
      const head = q === '' ? prefix : prefix + '：' + truncateToWidth(q, Math.max(4, Math.floor(size.cols / 3)))
      return [{ text: head, color: PALETTE.attention, press: 'tab:2:decide' }, staleBadge('  ' + staleMark)]
    }
    return [staleBadge(staleMark)]
  }
  const q = oldest === null ? '' : firstLine(oldest.question)
  let text = prefix
  if (q !== '') {
    const rem = size.cols - displayWidth(prefix) - displayWidth('：')
    if (rem >= 2) text = prefix + '：' + truncateToWidth(q, rem)
  }
  return [{ text: truncateToWidth(text, size.cols), color: PALETTE.attention, press: 'tab:2:decide' }]
}

// ---- C1 short-body class summaries (one row per class: pending -> fleet -> quota -> 另有 N 項) ----
type ShortEntry = { rows: Row[]; count: number; summary?: string }
const SHORT_SEVERITY = [GLYPHS.state.failed, GLYPHS.state.stalled, GLYPHS.state.unknown, GLYPHS.state.need_you, GLYPHS.state.findings]
function shortSeverity(e: ShortEntry): number {
  const rank = SHORT_SEVERITY.findIndex(mark => e.rows.flat().some(s => s.text.trimStart().startsWith(mark)))
  return rank < 0 ? SHORT_SEVERITY.length : rank
}
// X2: overflow retains the category and severity of the items that are hidden.
function severitySummary(category: string, rows: Row[], count = rows.length): string {
  const counts = new Map<string, number>()
  const marks = ['failed', 'unknown', 'stalled', 'need_you', 'findings', 'running', 'waiting', 'pending', 'done'].map(k => (GLYPHS.state as Record<string, string>)[k])
  for (const r of rows) {
    const text = r.map(s => s.text).join('').trimStart()
    const g = marks.find(g => text.startsWith(g))
    if (g !== undefined) counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  const badges = marks.filter(g => counts.has(g)).map(g => g + counts.get(g))
  return category + ' ' + (badges.length > 0 ? badges.join(' ') : count)
}
function moreItems(ctx: PageCtx, n: number, summaries: string[]): Row {
  return truncateSegs([{ text: ctx.t('page.now.more_items', { n }) + (summaries.length === 0 ? '' : '（' + summaries.join(' · ') + '）'), dim: true }], ctx.size.cols)
}
const rowWidth = (r: Row): number => r.reduce((w, s) => w + displayWidth(s.text), 0)
const joinSummaryParts = (parts: string[]): string =>
  parts.reduce((acc, p, i) => (i === 0 ? p : acc + (acc.endsWith('）') ? '· ' : ' · ') + p), '')

function fitNameList(names: string[], listSep: string, innerBudget: number): string | null {
  if (names.length === 0 || innerBudget < 1) return null
  const full = names.join(listSep)
  if (displayWidth(full) <= innerBudget) return full
  for (let k = names.length - 1; k >= 1; k--) {
    const cand = names.slice(0, k).join(listSep) + listSep + '…'
    if (displayWidth(cand) <= innerBudget) return cand
  }
  const cut = truncateToWidth(full, innerBudget)
  return cut === '' ? null : cut
}

function formatFleetBody(groups: { labels: string[]; fmt: (names: string | null) => string }[], hostPart: string | null, head: string, listSep: string, availCols: number): string {
  if (groups.length === 0) return hostPart ?? ''
  const fullNames = groups.map(g => g.labels.join(listSep))
  const build = (picked: (string | null)[]): string =>
    joinSummaryParts([...groups.map((g, i) => g.fmt(picked[i])), ...(hostPart === null ? [] : [hostPart])])
  const fullStr = build(fullNames)
  if (displayWidth(head + fullStr) <= availCols) return fullStr
  for (let m = groups.length; m >= 1; m--) {
    const shell = build(groups.map((_, i) => (i < m ? '' : null)))
    const totalInner = availCols - displayWidth(head + shell)
    if (totalInner < m) continue
    const picked: (string | null)[] = Array.from({ length: groups.length }, () => null)
    const needCut: number[] = []
    let rem = totalInner
    const minSlot = (idx: number): number => Math.min(Math.max(1, displayWidth(fullNames[idx])), Math.max(1, displayWidth(truncateToWidth(groups[idx].labels[0] ?? '', 3))))
    const equalShare = Math.floor(totalInner / m)
    for (let i = 0; i < m; i++) {
      const w = displayWidth(fullNames[i])
      if (w <= equalShare && w >= 1) {
        picked[i] = fullNames[i]
        rem -= w
      } else {
        needCut.push(i)
      }
    }
    needCut.forEach((idx, k) => {
      const left = needCut.length - k
      const laterMin = needCut.slice(k + 1).reduce((s, j) => s + minSlot(j), 0)
      const w = displayWidth(fullNames[idx])
      if (w >= 1 && w <= rem - laterMin) {
        picked[idx] = fullNames[idx]
        rem -= w
        return
      }
      const budget = Math.max(1, k === needCut.length - 1 ? rem : Math.ceil(rem / left))
      const got = fitNameList(groups[idx].labels, listSep, budget) ?? '…'
      picked[idx] = got
      rem -= displayWidth(got)
    })
    return build(picked)
  }
  return build(groups.map(() => null))
}

function fleetShortSummary(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean): { entry: ShortEntry | null; seenLines: Set<string> } {
  const { t, size } = ctx
  const stuck = stuckLinesOf(con)
  const seenLines = new Set(stuck.map(s => s.line.line_id))
  const lineMap = new Map((con.lines ?? []).map(l => [l.line_id, l]))
  const offlineLabels: string[] = []
  const stuckLabels: string[] = []
  const idleLabels: string[] = []
  let hasFailedLine = false
  for (const { line } of stuck) {
    const ls = lineState(line, t)
    if (ls.sid === 'failed') hasFailedLine = true
    if (ls.word === t('page.fleet.w_offline')) offlineLabels.push(line.label)
    else if (ls.word === t('page.fleet.idle')) idleLabels.push(line.label)
    else stuckLabels.push(line.label)
  }
  for (const i of con.items) {
    if (i.kind !== 'exception' || i.to_console !== true || i.id.startsWith('quota:') || isOfflineHostExc(i) || i.line_id === null || seenLines.has(i.line_id)) continue
    if (i.state !== 'failed' && i.state !== 'stalled') continue
    const ln = lineMap.get(i.line_id)
    const label = ln?.label ?? i.line_id
    seenLines.add(i.line_id)
    if (i.state === 'failed') hasFailedLine = true
    if (/^exc:T4:/i.test(i.id) || /offline|離線/i.test(i.title) || /offline|離線/i.test(i.text)) offlineLabels.push(label)
    else if (/^exc:T3:/i.test(i.id) || /閒置|\bidle\b/i.test(i.title)) idleLabels.push(label)
    else stuckLabels.push(label)
  }
  const hostExcItems = con.items.filter(isOfflineHostExc)
  const hs = con.sources.hosts
  const h = con.counts.summary.hosts
  const hasHostCounts = hs?.state !== 'no_source' && typeof h.online === 'number' && typeof h.total === 'number'
  const summaryOffline = hasHostCounts ? Math.max(0, h.total - h.online) : 0
  const offlineHostCount = Math.max(summaryOffline, hostExcItems.length)
  let hostPart: string | null = null
  if (offlineHostCount > 0) {
    if (hasHostCounts) {
      const total = Math.max(h.total, offlineHostCount)
      const online = Math.max(0, Math.min(h.online, total - offlineHostCount))
      hostPart = t('page.now.fleet_hosts_off', { online, total, off: offlineHostCount })
    } else {
      hostPart = t('page.now.hosts') + ' ' + t('page.fleet.hosts_off', { n: offlineHostCount })
    }
  }
  const lineCount = offlineLabels.length + stuckLabels.length + idleLabels.length
  const fleetCount = lineCount + offlineHostCount
  if (fleetCount === 0) return { entry: null, seenLines }
  const groups: { labels: string[]; fmt: (names: string | null) => string }[] = []
  if (offlineLabels.length > 0) {
    const n = offlineLabels.length
    groups.push({ labels: offlineLabels, fmt: names => (names === null ? t('page.now.fleet_offline_bare', { n }) : t('page.now.fleet_offline_named', { n, names })) })
  }
  if (stuckLabels.length > 0) {
    const n = stuckLabels.length
    groups.push({ labels: stuckLabels, fmt: names => (names === null ? t('page.now.fleet_stuck_bare', { n }) : t('page.now.fleet_stuck_named', { n, names })) })
  }
  if (idleLabels.length > 0) {
    const n = idleLabels.length
    groups.push({ labels: idleLabels, fmt: names => (names === null ? t('page.now.fleet_idle_bare', { n }) : t('page.now.fleet_idle_named', { n, names })) })
  }
  const icon = offlineLabels.length > 0 || offlineHostCount > 0 || hasFailedLine ? GLYPHS.state.failed : GLYPHS.state.stalled
  const head = icon + ' ' + t('tab.fleet') + ' '
  const availCols = Math.max(1, size.cols - (wide ? 2 : 0))
  const bodyText = formatFleetBody(groups, hostPart, head, t('sep.list'), availCols)
  const row = truncateSegs([...(wide ? [dim('  ')] : []), { text: head + bodyText, color: PALETTE.broken }], size.cols)
  return { entry: { rows: [row], count: fleetCount }, seenLines }
}

function quotaShortSummary(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean): { entry: ShortEntry | null; yellowPools: Verdict[] } {
  const { t, size, nowMs } = ctx
  const pools = normalizedPools(con)
  const seenPools = new Set((pools ?? []).map(p => poolKey(p.pool)))
  const ranked = pools === null ? [] : rankPools(pools, nowMs, t)
  const stalePools = ranked.filter(v => v.kind === 'stale' || v.kind === 'stale_seat')
  const staleAges = stalePools.map(v => v.staleMin).filter((min): min is number => min !== null)
  const staleNote = stalePools.length === 0 ? '' : ' · ' + (staleAges.length === 0 ? t('page.now.quota_stale_plain') : t('page.now.quota_stale', { min: Math.max(...staleAges) }))
  const redLabels = ranked.filter(v => v.role === 'broken').map(v => poolLabel(v.pool))
  for (const i of con.items) {
    if (!isSeatBlocked(i) || i.to_console === false) continue
    if (typeof i.facts.pool === 'string') {
      const pk = poolKey(i.facts.pool)
      if (seenPools.has(pk)) continue
      seenPools.add(pk)
      redLabels.push(poolLabel(i.facts.pool))
    } else {
      redLabels.push(typeof i.facts.seat === 'string' ? i.facts.seat : i.title)
    }
  }
  const unkLabels = ranked.filter(isUnknownPool).map(v => poolLabel(v.pool))
  const yellowPools = ranked.filter(v => v.role === ROLE_WARNING && !isUnknownPool(v))
  const quotaCount = redLabels.length + unkLabels.length
  if (quotaCount === 0) return { entry: null, yellowPools }
  const listSep = t('sep.list')
  const availCols = Math.max(1, size.cols - (wide ? 2 : 0))
  const rn = redLabels.length
  const un = unkLabels.length
  if (rn > 0 && un === 0) {
    const lead = GLYPHS.state.failed + ' ' + t('page.now.quota') + ' '
    const inner = availCols - displayWidth(lead + t('page.now.quota_red_named', { n: rn, names: '' }))
    const names = fitNameList(redLabels, listSep, inner)
    const redStr = names === null ? t('page.now.quota_red_bare', { n: rn }) : t('page.now.quota_red_named', { n: rn, names })
    return { entry: { rows: [truncateSegs([...(wide ? [dim('  ')] : []), { text: lead + redStr + staleNote, color: PALETTE.broken }], size.cols)], count: quotaCount }, yellowPools }
  }
  if (rn === 0) {
    const lead = GLYPHS.state.unknown + ' ' + t('page.now.quota') + ' '
    const inner = availCols - displayWidth(lead + t('page.now.quota_unknown_named', { n: un, names: '' }))
    const names = fitNameList(unkLabels, listSep, inner)
    const unkStr = names === null ? t('page.now.quota_unknown_bare', { n: un }) : t('page.now.quota_unknown_named', { n: un, names })
    return { entry: { rows: [truncateSegs([...(wide ? [dim('  ')] : []), { text: lead + unkStr, color: PALETTE.attention }], size.cols)], count: quotaCount }, yellowPools }
  }
  const lead = GLYPHS.state.failed + ' ' + t('page.now.quota') + ' '
  const unkLead = GLYPHS.state.unknown + ' '
  const buildBoth = (rNames: string | null, uNames: string | null): Row => {
    const rStr = rNames === null ? t('page.now.quota_red_bare', { n: rn }) : t('page.now.quota_red_named', { n: rn, names: rNames })
    const uStr = uNames === null ? t('page.now.quota_unknown_bare', { n: un }) : t('page.now.quota_unknown_named', { n: un, names: uNames })
    const sep = rStr.endsWith('）') ? '· ' : ' · '
    return [...(wide ? [dim('  ')] : []), { text: lead + rStr + staleNote, color: PALETTE.broken }, plain(sep), { text: unkLead + uStr, color: PALETTE.attention }]
  }
  const rFull = redLabels.join(listSep)
  const uFull = unkLabels.join(listSep)
  const candFull = buildBoth(rFull, uFull)
  if (rowWidth(candFull) <= size.cols) return { entry: { rows: [candFull], count: quotaCount }, yellowPools }
  const totalInner = size.cols - rowWidth(buildBoth('', ''))
  let row: Row
  if (totalInner >= 2) {
    const wR = displayWidth(rFull)
    const wU = displayWidth(uFull)
    const half = Math.floor(totalInner / 2)
    let rPicked: string
    let uPicked: string
    if (wR <= half) {
      rPicked = rFull
      uPicked = fitNameList(unkLabels, listSep, totalInner - wR) ?? '…'
    } else if (wU <= totalInner - half) {
      uPicked = uFull
      rPicked = fitNameList(redLabels, listSep, totalInner - wU) ?? '…'
    } else {
      rPicked = fitNameList(redLabels, listSep, Math.ceil(totalInner / 2)) ?? '…'
      uPicked = fitNameList(unkLabels, listSep, Math.max(1, totalInner - displayWidth(rPicked))) ?? '…'
    }
    row = truncateSegs(buildBoth(rPicked, uPicked), size.cols)
  } else {
    const rOnlyInner = size.cols - rowWidth(buildBoth('', null))
    row = truncateSegs(rOnlyInner >= 1 ? buildBoth(fitNameList(redLabels, listSep, rOnlyInner), null) : buildBoth(null, null), size.cols)
  }
  return { entry: { rows: [row], count: quotaCount }, yellowPools }
}

// ---- ux-v7.4 S2 現況 (sub-task C): fleet.pm.status first, then own seat, pre-push qc and proxy decisions folded in ----
const V74_PM_SOURCE = 'fleet pm status --json'
const V74_PM_SCHEMA = 'fleet.pm.status v1'
const rowText = (r: Row): string => r.map(s => s.text).join('')

const v74OpenRule = (title: string, wide: boolean): Row => {
  const head = GLYPHS.structure.open + ' ' + title + ' '
  const fill = wide ? GLYPHS.structure.rule.repeat(Math.max(2, 54 - displayWidth(head))) : ''
  return [{ text: head, color: PALETTE.idle }, ...(fill === '' ? [] : [{ text: fill, color: PALETTE.structure }])]
}

export const v74PmCounts = (pm: PmStatus): { total: number; fail: number; idle: number; ok: number; unknown: number } => {
  const lines = fleetLines(pm)
  let fail = 0
  let idle = 0
  let ok = 0
  let unknown = 0
  for (const l of lines) {
    if (l.mark === 'fail') fail++
    else if (l.mark === 'parked') idle++
    else if (l.mark === 'unknown') unknown++
    else ok++
  }
  return { total: pm.projects.length, fail, idle, ok, unknown }
}

const v74ShortRange = (range: string): string => {
  const parts = range.split('..').map(p => p.trim())
  if (parts.length >= 2) {
    const a = parts[0].length > 8 ? parts[0].slice(0, 8) : parts[0]
    const b = parts[1]
    return a + '..' + b
  }
  return range.length > 24 ? range.slice(0, 24) : range
}

const v74QcWord = (ctx: PageCtx, q: QcView): string => {
  if (q.state === 'ok') return ctx.t('page.review.qc_ok')
  if (q.state === 'owed') return q.protected_files_count > 0 ? ctx.t('page.review.qc_owed_n', { n: q.protected_files_count }) : ctx.t('page.review.qc_owed')
  if (q.state === 'not_needed') return ctx.t('page.review.qc_not_needed')
  return ctx.t('page.review.qc_unknown')
}

// Minimal s2/feed trace extension: read optional error/fallback fields when wired without blocking on s2's V74Ctx edit.
type V74NowTrace = {
  pmError?: string | null
  fleetError?: string | null
  fleetSummary?: { fetchedMs: number | null; error: string | null; totals: { stuck: number; running: number; waiting: number; failed: number } } | null
  // now = PM feed error message (aligned with V74Ctx.errors / ages keyed by page id).
  errors?: { now?: string | null; fleet?: string | null }
}

const brokenWrapped = (text: string, cols: number): Row[] => wrapRow(broken(text), Math.max(8, cols), WRAP_HANG)

function v74TasksStaleRows(ctx: PageCtx, con: ConsoleSnapshot): Row[] {
  const { t, size, nowMs } = ctx
  const tasksSrc = con.sources.tasks
  if (tasksSrc?.state === 'no_source') return brokenWrapped(t('frame.src_no_source', { name: t('console.command.src.tasks') }), size.cols)
  const taskAgeMs = tasksSrc?.at_ms != null ? Math.max(0, nowMs - tasksSrc.at_ms) : (con.generated_at_ms > 0 ? Math.max(0, nowMs - con.generated_at_ms) : null)
  const bs = isBriefStale(con, nowMs)
  const isStale = tasksSrc?.state === 'stale' || tasksSrc?.state === 'expired' || (taskAgeMs !== null && taskAgeMs > TRACE_STALE_MS) || bs.stale
  if (!isStale) return []
  const stWord = tasksSrc !== undefined && tasksSrc.state !== 'ok' ? tasksSrc.state : bs.expired ? 'expired' : 'stale'
  const msg = taskAgeMs !== null
    ? t('trace.now_tasks_stale', { state: stWord, age: ageUnit(t, taskAgeMs), limit: TRACE_STALE_MIN })
    : t('trace.now_tasks_stale_noage', { state: stWord, limit: TRACE_STALE_MIN })
  return brokenWrapped(msg, size.cols)
}

function v74FleetSection(ctx: PageCtx, wide: boolean): Row[] {
  const { t, v74, console: con, size, nowMs } = ctx
  const pm = v74!.pm
  const vExt = v74 as V74NowTrace
  const pmErr = (vExt.pmError ?? vExt.errors?.now ?? '').trim()
  const fleetSum = vExt.fleetSummary ?? null
  const fleetErr = (vExt.fleetError ?? vExt.errors?.fleet ?? fleetSum?.error ?? '').trim()
  if (pm === null) {
    const head = v74OpenRule(t('v74.c.sec_fleet_src', { source: V74_PM_SOURCE }), wide)
    const rows: Row[] = [head, ...brokenWrapped(pmErr !== '' ? t('v74.c.pm_missing') + '：' + pmErr : t('v74.c.pm_missing'), size.cols)]
    if (con !== null) {
      const fc = consoleFleetCounts(con, t)
      const tot = lineTotal(con)
      const tasksSrc = con.sources.tasks
      const srcAgeMs = tasksSrc?.at_ms != null ? Math.max(0, nowMs - tasksSrc.at_ms) : (con.generated_at_ms > 0 ? Math.max(0, nowMs - con.generated_at_ms) : null)
      rows.push([dim(wide ? '  ' : ''), plain(t('trace.now_fallback_src', { source: 'console' }) + (srcAgeMs === null ? '' : ' · ' + ageOf(t, srcAgeMs)))])
      rows.push(...v74TasksStaleRows(ctx, con))
      const summary: Seg[] = [
        ...(wide ? [dim('  ')] : []),
        plain(t('v74.c.lines') + '       ' + String(tot) + '  '),
        ...(fc.failed > 0 ? [{ text: GLYPHS.state.failed + String(fc.failed), color: PALETTE.broken }] : []),
        ...(fc.stuck > 0 ? [plain(' ' + GLYPHS.state.stalled + String(fc.stuck))] : []),
        ...(fc.running > 0 ? [plain(' ' + GLYPHS.state.running + String(fc.running))] : []),
        ...(fc.waiting > 0 ? [plain(' ' + GLYPHS.state.waiting + String(fc.waiting))] : []),
        ...(fc.normal > 0 ? [plain(' ' + GLYPHS.state.pending + String(fc.normal))] : []),
      ]
      const h = con.counts.summary.hosts
      const hs = con.sources.hosts
      if (hs !== undefined && hs.state === 'no_source') {
        summary.push(plain('  · ' + t('page.now.hosts') + ' '), staleBadge(GLYPHS.state.failed + ' ' + t('page.now.hosts_no_source')))
      } else if (hs !== undefined && typeof h.online === 'number' && typeof h.total === 'number') {
        summary.push(plain('  · ' + t('page.now.hosts') + ' ' + h.online + '/' + h.total))
      }
      rows.push(summary)
      for (const r of mergedPoolRows(ctx, con, wide)) rows.push(r)
    } else if (fleetSum !== null && fleetSum.fetchedMs !== null) {
      const fAgeMs = Math.max(0, nowMs - fleetSum.fetchedMs)
      rows.push([dim(wide ? '  ' : ''), plain(t('trace.now_fallback_src', { source: t('fleet.source_cmd') }) + ' · ' + ageOf(t, fAgeMs))])
      if (fAgeMs > TRACE_STALE_MS) {
        rows.push(...brokenWrapped(t('trace.hygiene_src_stale', { source: t('fleet.source_cmd'), age: ageUnit(t, fAgeMs), limit: TRACE_STALE_MIN }), size.cols))
      }
      const tot = fleetSum.totals
      rows.push([
        ...(wide ? [dim('  ')] : []),
        plain(t('v74.c.lines') + '  '),
        { text: GLYPHS.state.failed + String(tot.failed), ...(tot.failed > 0 ? { color: PALETTE.broken } : {}) },
        plain(' ' + GLYPHS.state.stalled + String(tot.stuck) + ' ' + GLYPHS.state.running + String(tot.running) + ' ' + GLYPHS.state.waiting + String(tot.waiting)),
      ])
      rows.push(...brokenWrapped(t('trace.now_no_console_hosts'), size.cols))
    } else {
      const whyParts = [t('page.now.nosrc_console'), fleetErr !== '' ? t('fleet.error', { error: fleetErr }) : t('fleet.source_cmd') + ' ' + t('fleet.never')]
      rows.push(...brokenWrapped(t('trace.now_no_fallback', { why: whyParts.join(t('sep.list')) }), size.cols))
      rows.push(...brokenWrapped(t('trace.now_no_console_hosts'), size.cols))
    }
    return rows
  }
  const pmAt = pm.generated_at_ms > 0 ? pm.generated_at_ms : v74!.pmFetchedMs
  const pmAgeMs = pmAt !== null ? Math.max(0, nowMs - pmAt) : null
  const fetchAgeMs = v74!.pmFetchedMs !== null ? Math.max(0, nowMs - v74!.pmFetchedMs) : null
  const headTitle = t('v74.c.sec_fleet_src', { source: V74_PM_SOURCE }) + (pmAgeMs === null ? '' : ' · ' + ageOf(t, pmAgeMs))
  const head = v74OpenRule(headTitle, wide)
  const { total, fail, idle, ok, unknown } = v74PmCounts(pm)
  const summary: Seg[] = [
    ...(wide ? [dim('  ')] : []),
    plain(t('v74.c.lines') + '       ' + String(total) + '  '),
    ...(fail > 0 ? [{ text: GLYPHS.state.failed + String(fail), color: PALETTE.broken }] : []),
    ...(idle > 0 ? [plain(' ' + GLYPHS.state.stalled + String(idle))] : []),
    ...(unknown > 0 ? [plain(' ' + GLYPHS.structure.empty + String(unknown))] : []),
    ...(ok > 0 ? [plain(' ' + GLYPHS.state.running + String(ok))] : []),
  ]
  if (con !== null) {
    const h = con.counts.summary.hosts
    const hs = con.sources.hosts
    if (hs !== undefined && hs.state === 'no_source') {
      summary.push(plain('  · ' + t('page.now.hosts') + ' '), staleBadge(GLYPHS.state.failed + ' ' + t('page.now.hosts_no_source')))
    } else if (hs !== undefined && typeof h.online === 'number' && typeof h.total === 'number') {
      summary.push(plain('  · ' + t('page.now.hosts') + ' ' + h.online + '/' + h.total))
    }
  }
  const rows: Row[] = [head]
  if ((pmAgeMs !== null && pmAgeMs > TRACE_STALE_MS) || (fetchAgeMs !== null && fetchAgeMs > TRACE_STALE_MS)) {
    const worstAge = Math.max(pmAgeMs ?? 0, fetchAgeMs ?? 0)
    rows.push(...brokenWrapped(t('trace.now_pm_stale', { age: ageUnit(t, worstAge), limit: TRACE_STALE_MIN }), size.cols))
  }
  if (con !== null) rows.push(...v74TasksStaleRows(ctx, con))
  rows.push(summary)
  // r8 #13: failures first, then the quota exception (it is a ✗ too), then the parked and unknown lines
  const parked: Row[] = []
  let quotaDone = false
  const quotaFirst = (): void => {
    if (con === null || quotaDone) return
    quotaDone = true
    for (const r of mergedPoolRows(ctx, con, wide)) rows.push(r)
  }
  const lines = fleetLines(pm).filter(l => l.mark !== 'ok')
  for (const line of [...lines.filter(l => l.mark === 'fail'), ...lines.filter(l => l.mark !== 'fail')]) {
    if (line.mark !== 'fail' && parked.length === 0) quotaFirst()
    const g = line.mark === 'fail' ? GLYPHS.state.failed : line.mark === 'unknown' ? GLYPHS.structure.empty : GLYPHS.state.stalled
    const n = (v: number | null): number | string => v ?? GLYPHS.structure.empty
    const body = line.mark === 'fail'
      ? t('v74.c.line_fail', { project: line.project, stuck: n(line.counts.stuck), overdue: n(line.counts.overdue) })
      : line.mark === 'unknown'
        ? t('v74.c.line_unknown', { project: line.project })
        : t('v74.c.line_parked', { project: line.project, waiting: n(line.counts.waiting) })
    const row = truncateSegs([
      dim(wide ? ' ' : ''),
      { text: g + ' ' + body, ...(line.mark === 'fail' ? { color: PALETTE.broken } : {}) },
    ], size.cols)
    if (line.mark !== 'fail') parked.push(row)
    rows.push(row)
  }
  quotaFirst()
  if (con === null) rows.push(...brokenWrapped(t('trace.now_no_console_hosts'), size.cols))
  return rows
}

function v74SeatSection(ctx: PageCtx, wide: boolean): Row[] {
  const { t, live, size, nowMs } = ctx
  if (live === null) {
    return [v74OpenRule(t('v74.c.sec_seat', { project: '?' }), wide), broken(t('page.now.no_live'))]
  }
  const proj = live.detail.project ?? live.project_key ?? t('v74.c.project_unknown')
  const seatAge = liveAgeMs(live, nowMs)
  if (live.state !== 'ok') {
    const why = live.header.trim() !== '' ? live.header : live.state
    const head = t('v74.c.sec_seat', { project: String(proj) }) + (seatAge === null ? '' : ' · ' + ageOf(t, seatAge))
    return [v74OpenRule(head, wide), ...brokenWrapped(t('trace.now_seat_stale', { why, limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S }), size.cols)]
  }
  const head = t('v74.c.sec_seat', { project: String(proj) }) + (seatAge === null ? '' : ' · ' + ageOf(t, seatAge))
  const rows: Row[] = [v74OpenRule(head, wide)]
  if (seatAge !== null && seatAge > TRACE_STALE_MS) {
    rows.push(...brokenWrapped(t('trace.seat_age_stale', { age: ageUnit(t, seatAge), limit: TRACE_STALE_MIN }), size.cols))
  }
  const band = live.band
  const mark = band?.mark ?? GLYPHS.state.running
  const status = band !== null && band.verdict?.trim() ? band.verdict : t('v74.c.status_running')
  const elapsed = band?.elapsed ?? GLYPHS.structure.empty
  const ctxPct = live.metrics?.ctx ?? GLYPHS.structure.empty
  rows.push(labelled(t('v74.c.l_status'), wide,
    { text: mark, ...(band === null ? {} : { color: PALETTE.running }) },
    plain(' ' + status),
    plain('  ' + t('v74.c.elapsed', { e: elapsed })),
    plain('  ' + t('header.ctx') + ' ' + ctxPct)))
  const spend = live.detail.spend
  const sessTok = spend?.tok?.session != null ? tokLabel(spend.tok.session, t) : t('v74.c.tok_unknown')
  const hostTok = spend?.tok?.host != null ? tokLabel(spend.tok.host, t) : null
  const sessSegs: Seg[] = [plain(sessTok)]
  if (hostTok !== null) sessSegs.push(plain('  ' + t('v74.c.today_host', { v: hostTok })))
  rows.push(labelled(t('v74.c.l_session'), wide, ...sessSegs))
  return rows
}

function v74QcSection(ctx: PageCtx, wide: boolean): Row[] {
  const { t, live } = ctx
  if (live === null) return []
  const q = live.detail.qc
  if (q === null) return [v74OpenRule(t('v74.c.sec_qc_missing'), wide), broken(t('nodata.qc'))]
  const word = v74QcWord(ctx, q)
  const rows: Row[] = [v74OpenRule(t('v74.c.sec_qc', { state: word }), wide)]
  if (q.range !== null) rows.push(labelled(t('v74.c.l_range'), wide, plain(v74ShortRange(q.range))))
  const prot = q.protected_files_count === 0 ? t('v74.c.no_protected') : t('review.protected.other', { n: q.protected_files_count })
  rows.push(labelled(t('v74.c.l_protected'), wide, plain(prot)))
  return rows
}

function v74ProxySection(ctx: PageCtx, wide: boolean): Row[] {
  const { t, live, size, nowMs } = ctx
  if (live === null) return []
  const dv = live.detail.decisions
  if (dv === null) {
    if (live.sections?.decisionsNotWired === true) return [v74OpenRule(t('v74.c.sec_proxy'), wide), broken(t('page.review.decisions_not_wired'))]
    return [v74OpenRule(t('v74.c.sec_proxy_empty'), wide)]
  }
  const n = Math.max(dv.count, dv.rows.length)
  if (n === 0) return [v74OpenRule(t('v74.c.sec_proxy_empty'), wide)]
  const rows: Row[] = [v74OpenRule(t('v74.c.sec_proxy_n', { n }), wide)]
  for (const r of dv.rows) {
    const ageMs = r.at != null && Number.isFinite(Date.parse(r.at)) ? nowMs - Date.parse(r.at) : null
    const age = ageMs === null ? '' : '  · ' + t('page.now.ago', { age: ageUnit(t, ageMs) })
    const summary = r.decision.split('\n').find(l => l.trim() !== '')?.trim() ?? r.decision
    rows.push(truncateSegs([dim(wide ? '  ' : ' '), plain(GLYPHS.state.done + ' ' + summary + age)], size.cols))
  }
  return rows
}

function renderV74(ctx: PageCtx): { body: Row[]; actions: Row[] } {
  const wide = ctx.size.cols >= 100
  const body: Row[] = [
    ...v74FleetSection(ctx, wide),
    blank(),
    ...v74SeatSection(ctx, wide),
    blank(),
    ...v74QcSection(ctx, wide),
    blank(),
    ...v74ProxySection(ctx, wide),
  ]
  return { body, actions: [] }
}

/** Suffix segments for the framed header when v7.4 wires pm fetch age (sub-task B may compose with tab title). */
export function nowV74HeaderExtra(ctx: PageCtx): Seg[] {
  if (ctx.v74 === undefined) return []
  const { t, nowMs, v74 } = ctx
  if (v74.pmFetchedMs === null) return [staleBadge(' ' + t('v74.c.src_missing'))]
  const age = ageUnit(t, nowMs - v74.pmFetchedMs)
  return [dim(' · ' + t('v74.c.header', { source: V74_PM_SOURCE, schema: V74_PM_SCHEMA, age }))]
}

// ---- the page ----
function render(ctx: PageCtx): { body: Row[]; actions: Row[] } {
  if (ctx.v74 !== undefined) return renderV74(ctx)
  const { t, size, console: con, live, nowMs } = ctx
  const wide = size.cols >= 100
  const decisions = decisionCount(ctx)
  const actions: Row[] = []
  // the pending sentence is the first body row; the action row is only the jump (item 5: one sentence, not two)
  if (decisions > 0) actions.push([plain(GLYPHS.structure.answer + ' ' + t('page.now.jump_decide')), plain('  '), { text: '[2]', press: 'tab:2:decide', color: PALETTE.action }])
  const residue = live?.detail.residue?.reapable ?? 0
  if (wide && residue > 0) actions.push([plain(GLYPHS.structure.answer + ' ' + t('page.now.go_residue', { n: residue })), plain('  '), { text: '[6]', press: 'tab:6:hygiene', color: PALETTE.action }]) // X2: narrow panes use the fixed tab 6 Button.

  const stripLen = size.cols < STRIP_SPLIT_COLS ? Math.min(2, size.rows) : Math.min(1, size.rows)
  const avail = Math.max(0, size.rows - 2 - stripLen)
  const firstActLen = Math.max(1, actions.length)
  const firstRoom = Math.max(0, avail - Math.min(firstActLen, avail))
  if (ctx.shortBody === true || avail <= 4 || firstRoom <= 4) {
    // C1: Short body (<= 4 rows) renders one summary row per CLASS (pending -> fleet -> quota -> `另有 N 項` for what is still not shown).
    const shortActions: Row[] = decisions > 0 ? actions.slice(1) : actions
    const actLen = decisions > 0 ? shortActions.length : Math.max(1, shortActions.length)
    const room = Math.max(0, avail - Math.min(actLen, avail))
    const entries: ShortEntry[] = []
    const pRow = pendingRowOf(ctx, decisions, true)
    const pNoTruncate = pendingSourceMissing(ctx) || (live !== null && live.state !== 'ok')
    if (pRow !== null) entries.push({ rows: pNoTruncate ? wrapRow(pRow, size.cols, WRAP_HANG) : [truncateSegs(pRow, size.cols)], count: decisions, summary: t('page.now.pending_short', { n: decisions }) })
    let extraRows: Row[] = []
    if (con !== null) {
      const fleet = fleetShortSummary(ctx, con, wide)
      const quota = quotaShortSummary(ctx, con, wide)
      // X2b: miscellaneous exceptions belong to 現況, not the fleet class.
      if (fleet.entry !== null) fleet.entry.summary = severitySummary(t('tab.fleet'), exceptionRows(ctx, {
        ...con,
        items: con.items.filter(i => isOfflineHostExc(i) || (i.line_id !== null && fleet.seenLines.has(i.line_id))),
        lines: con.lines === null ? null : con.lines.filter(l => fleet.seenLines.has(l.line_id)),
      }, wide), fleet.entry.count)
      if (quota.entry !== null) quota.entry.summary = severitySummary(t('page.now.quota'), poolRows(ctx, con, wide, false)) // W4: the waste entry owns its own pool count.
      if (fleet.entry !== null) entries.push(fleet.entry)
      if (quota.entry !== null) entries.push(quota.entry)
      const toShortExc = (it: ConsoleItem): Row => {
        const g = glyph(it.state)
        const body = wide ? it.text : it.title
        return truncateSegs([...(wide ? [dim('  ')] : []), { text: g.text, ...(g.color === undefined ? {} : { color: g.color }) }, plain(' ' + body)], size.cols)
      }
      const seenExcLines = new Set(fleet.seenLines)
      const otherExc = con.items
        .filter((i: ConsoleItem) => {
          if (i.kind !== 'exception' || i.to_console !== true || i.id.startsWith('quota:') || isOfflineHostExc(i)) return false
          if (i.line_id === null) return true
          if (seenExcLines.has(i.line_id)) return false
          seenExcLines.add(i.line_id)
          return true
        })
        .map(toShortExc)
      // W2: waste is quota data, even when five pools collapse to one row.
      if (quota.yellowPools.length > 0) {
        const summary = t('page.now.quota_waste') + ' ' + GLYPHS.state.need_you + quota.yellowPools.length
        entries.push({ rows: [[{ text: summary, color: PALETTE.attention }]], count: quota.yellowPools.length, summary })
      }
      extraRows = otherExc
    }
    if (con === null) entries.push({ rows: wrapRow(broken(t('page.now.no_console')), size.cols), count: 1 })
    else if (entries.length === 0 && extraRows.length === 0 && dataMissing(con, nowMs, t)) entries.push({ rows: wrapRow(broken(t('frame.unknown')), size.cols), count: 1 })
    if (entries.length === 0 && extraRows.length > 0) {
      for (const r of extraRows) entries.push({ rows: [r], count: 1, summary: severitySummary(t('tab.fleet'), [r]) })
      extraRows = []
    }
    if (entries.length === 0) {
      if (live !== null) {
        for (const r of seatRows(ctx, live, wide)) entries.push({ rows: [truncateSegs(r, size.cols)], count: 1 })
      } else {
        entries.push({ rows: wrapRow(broken(t('page.now.no_live')), size.cols), count: 1 })
      }
    }
    if (entries.length === 0) entries.push({ rows: [[dim((wide ? '  ' : '') + t('page.now.exc_none'))]], count: 1 })
    // X2b: omitted exceptions also compete for constrained rows. Group each
    // severity into one class row so repeated failures cannot hide the count.
    if (extraRows.length > 0 && (room <= 1 || entries.reduce((n, e) => n + e.rows.length, 0) + 1 > room)) {
      const groups = new Map<number, Row[]>()
      for (const row of extraRows) {
        const rank = shortSeverity({ rows: [row], count: 1 })
        const group = groups.get(rank) ?? []
        group.push(row)
        groups.set(rank, group)
      }
      for (const [rank, rows] of groups) {
        const summary = severitySummary(t('tab.fleet'), rows)
        const mark = SHORT_SEVERITY[rank]
        const color = rows.flat().find(s => mark !== undefined && s.text.trimStart().startsWith(mark))?.color
        const grouped: Row = [{ text: (mark === undefined ? '' : mark + ' ') + summary, ...(color === undefined ? {} : { color }) }]
        entries.push({ rows: rows.length === 1 ? rows : [grouped], count: rows.length, summary })
      }
      extraRows = []
    }
    const extraCount = extraRows.length
    const extraSummary = extraCount > 0 ? [severitySummary(t('tab.fleet'), extraRows)] : []
    // X2b: the single row starts with the most severe class, keeping the pool
    // identity and an overflow count even when there is no room for details.
    if (room <= 1 && con !== null) {
      entries.sort((a, b) => shortSeverity(a) - shortSeverity(b))
      const q = entries.find(e => e.summary?.startsWith(t('page.now.quota') + ' '))
      const ranked = rankPools(normalizedPools(con) ?? [], nowMs, t)
      const summaries = [...entries.map(e => (e.summary ?? t('page.now.pending_short', { n: e.count })) + (e !== q || ranked.length === 0 ? '' : ' ' + poolLabel(ranked[0].pool))), ...extraSummary]
      // W4: a category printed on this row is represented, not "another" item.
      let shown = summaries.length
      let hiddenCount = extraCount
      let tail = ''
      while (shown > 0 && displayWidth(summaries.slice(0, shown).join(' · ') + tail) + 2 > size.cols) {
        shown--
        hiddenCount += entries[shown]?.count ?? 0
        tail = ' · ' + t('page.now.more_items', { n: hiddenCount })
      }
      const mark = SHORT_SEVERITY[shortSeverity(entries[0])]
      const lead = mark === undefined ? '' : mark + ' '
      const color = entries[0].rows.flat().find(s => s.text.trimStart().startsWith(mark ?? ''))?.color
      const summary = [{ text: lead + summaries.slice(0, shown).join(' · '), ...(color === undefined ? {} : { color }) }, dim(tail)]
      return decisions > 0 || avail > 1 ? { body: [summary], actions: [] } : { body: [], actions: [summary] }
    }
    const totalNeeded = entries.reduce((sum, e) => sum + e.rows.length, 0) + (extraCount > 0 ? 1 : 0)
    if (room <= 0 || totalNeeded <= room) {
      const out: Row[] = entries.flatMap(e => e.rows)
      if (extraCount > 0) out.push(moreItems(ctx, extraCount, extraSummary))
      return { body: out, actions: shortActions }
    }
    // X2b: when classes compete for rows, failed/stalled/unknown facts precede
    // a normal pending card. Keep the established class order when all fit.
    entries.sort((a, b) => shortSeverity(a) - shortSeverity(b))
    const budget = room - 1
    let used = 0
    let kept = 0
    for (const e of entries) {
      if (used + e.rows.length > budget) break
      used += e.rows.length
      kept++
    }
    const hiddenCount = entries.slice(kept).reduce((sum, e) => sum + e.count, 0) + extraCount
    const out: Row[] = entries.slice(0, kept).flatMap(e => e.rows)
    if (hiddenCount > 0) out.push(moreItems(ctx, hiddenCount, [...entries.slice(kept).map(e => e.summary ?? t('page.now.pending_short', { n: e.count })), ...extraSummary]))
    return { body: out, actions: shortActions }
  }

  const body: Row[] = []
  const categories = new Map<Row, string>()
  // 1. the pending count and the oldest card's title come first (G2, R2, R8); the [2] jump stays in the action area
  const pRow = pendingRowOf(ctx, decisions, false)
  // N3: a pending reason kept whole wraps at a clause boundary with the 2-cell hanging indent, so no orphan word sits under the status-glyph column
  if (pRow !== null) body.push(...(pendingSourceMissing(ctx) || (live !== null && live.state !== 'ok') ? wrapRow(pRow, size.cols, WRAP_HANG) : [pRow]))
  body.push(ruleRow(t('page.now.fleet'), wide))
  if (con === null) body.push(broken(t('page.now.no_console')))
  else {
    body.push(...overviewRows(ctx, con, wide))
    // 2. the stuck lines and the other exceptions, 3. every red pool in full
    const exc = exceptionRows(ctx, con, wide)
    const pr = poolRows(ctx, con, wide)
    const room = firstRoom
    const overflowing = [...body, ...exc, ...pr].reduce((n, r) => n + wrapRow(r, size.cols, WRAP_HANG).length, 0) > room
    // X2: the worst quota pool is visible before a long exception list can hide it.
    body.push(...(overflowing && pr.length > 0 ? [pr[0], ...exc, ...pr.slice(1)] : [...exc, ...pr]))
    for (const r of exc) categories.set(r, t('tab.fleet'))
    const verdicts = rankPools(normalizedPools(con) ?? [], nowMs, t).filter(v => v.role === 'broken' || v.role === ROLE_WARNING)
    pr.forEach((r, i) => categories.set(r, t(verdicts[i]?.kind === 'waste' ? 'page.now.quota_waste' : 'page.now.quota'))) // W2: source and waste remain explicit in overflow.
    // "no exceptions" is only said when nothing is missing and no pool needs a look (G4)
    if (exc.length === 0 && pr.length === 0) body.push(dataMissing(con, nowMs, t) ? broken(t('frame.unknown')) : [dim((wide ? '  ' : '') + t('page.now.exc_none'))])
  }
  body.push(blank())
  if (live === null) {
    body.push(ruleRow(seatName(wide) === '' ? t('page.now.seat_plain') : t('page.now.seat', { seat: seatName(wide) }), wide))
    body.push(broken(t('page.now.no_live')))
  } else {
    body.push(ruleRow(seatName(wide) === '' ? t('page.now.seat_plain') : t('page.now.seat', { seat: seatName(wide) }), wide))
    body.push(...seatRows(ctx, live, wide))
    const rec = recentRows(live, wide, size.cols)
    if (rec.length > 0) body.push(blank(), ruleRow(t('page.now.recent'), wide), ...rec)
  }
  if (body.reduce((n, r) => n + wrapRow(r, size.cols, WRAP_HANG).length, 0) > firstRoom) {
    // Keep a hidden spend error visible without removing section headings.
    const spendError = body.findIndex(r => r.some((s, i) => s.text.trim() === t('page.now.l_spend') && r[i + 1]?.text.startsWith(GLYPHS.state.failed)))
    const kept: Row[] = []
    let i = 0
    for (; i < body.length; i++) {
      const wrapped = wrapRow(body[i], size.cols, WRAP_HANG)
      if (kept.length + wrapped.length > firstRoom - 1) break
      kept.push(...wrapped)
    }
    if (spendError >= i) {
      const spend = wrapRow(truncateSegs(body[spendError], size.cols), size.cols, WRAP_HANG)
      const i0 = i
      const kept0 = kept.slice()
      let placed = false
      while (i > 0) {
        const last = body[i - 1]
        if (last.some(s => s.text.startsWith(GLYPHS.structure.rule))) break
        i--
        kept.splice(kept.length - wrapRow(last, size.cols, WRAP_HANG).length)
        if (kept.length + spend.length <= firstRoom - 1) {
          kept.push(...spend)
          placed = true
          break
        }
      }
      if (!placed) { i = i0; kept.splice(0, kept.length, ...kept0) } // no room before a heading: hide nothing extra
    }
    const hidden = body.slice(i).filter(r => categories.has(r)) // W4: count bus items/pools, never seat chrome or wrapped rows.
    const groups = new Map<string, Row[]>()
    for (const r of hidden) {
      const category = categories.get(r)!
      groups.set(category, [...(groups.get(category) ?? []), r])
    }
    const summaries = [...groups].sort(([a], [b]) => Number(b === t('page.now.quota')) - Number(a === t('page.now.quota'))).map(([c, rs]) => severitySummary(c, rs))
    return { body: [...kept, moreItems(ctx, hidden.length, summaries)], actions }
  }
  return { body, actions }
}
// the seat's name comes from the quota feed's own row; unknown until the first good `seats --quota`
const seatName = (wide: boolean): string => { const n = seatQuota.view().row?.seat ?? ''; return wide ? n : n.replace(/--.*$/, '') }

export const nowPage: Page = { id: 'now', key: '1', title: '現況', framed: true, render }
