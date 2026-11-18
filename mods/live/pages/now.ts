// mods/live/pages/now.ts — page 1 現況 (plan r2 §2 row 1, §3.1, §5; g2 folds A3, A10, A11): the fleet overview line (lines, hosts, quota), the exceptions, then this seat (position, tasks,
// background, dispatch, review, spend, residue), the recent dialogue, and jump hints to the other pages in the action area.
// Pure like the other pages: rows come from `ctx.live` and `ctx.console`; the only state is the own-seat quota feed below (`seatQuota`), which register.ts feeds with
// `seatQuota.refresh(run, nowMs)` once per tick (the 60 s cache and the keep-the-last-good rule live in the feed, nothing is spawned while drawing).
// A broken or missing source is a red row with the reason (§5): the number stays beside it, never replaced by a dash. Colours go through PALETTE only.
import type { ConsoleItem, ConsoleSnapshot } from '../console'
import type { LiveSnapshot, Seg } from '../model'
import { displayWidth, isStepCard, truncateToWidth } from '../model'
import { GLYPHS, PALETTE } from '../ui'
import { ROLE_WARNING, isUnknownPool, normalizedPools, poolKey, poolLabel, rankPools, worstPool } from './quota-pick'
import type { Verdict } from './quota-pick'
import { STRIP_SPLIT_COLS } from './layout'
import type { Page, PageCtx } from './frame'
import { brokenRow, dataMissing, decisionCount, isBriefStale, lineState, lineTotal, staleBadge, stuckLinesOf } from './rows'
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
const ageUnit = (t: T, ms: number): string => {
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

const LINE_ORDER = ['running', 'waiting', 'stalled', 'failed'] as const
const lineWord = (t: T, k: (typeof LINE_ORDER)[number]): string => (k === 'running' ? t('page.now.line_running') : k === 'waiting' ? t('page.now.line_waiting') : k === 'stalled' ? t('page.now.line_stalled') : t('page.now.line_failed'))
function overviewRows(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean): Row[] {
  const { t, size } = ctx
  const s = con.counts.summary
  const total = lineTotal(con)
  const lead: Seg[] = wide ? [plain('  ' + t('page.now.lines') + ' ' + total + ' ｜ ')] : [plain(t('page.now.lines') + ' ' + total + ' ')]
  const chips: Seg[] = []
  for (const k of LINE_ORDER) {
    const n = s.lines[k]
    if (n === undefined || n === 0) continue
    const g = glyph(k)
    const word = wide ? ' ' + lineWord(t, k) + ' ' + n : n + ''
    chips.push({ text: (chips.length > 0 ? (wide ? '  ' : ' ') : '') + g.text + word, ...(g.color === undefined ? {} : { color: g.color }) })
  }
  const hosts: Seg[] = []
  const h = s.hosts
  const hs = con.sources.hosts
  if (hs !== undefined && (hs.state === 'expired' || hs.state === 'no_source')) hosts.push(staleBadge(GLYPHS.state.failed + ' ' + t(hs.state === 'expired' ? 'page.now.hosts_expired' : 'page.now.hosts_no_source')))
  else if (typeof h.online === 'number' && typeof h.total === 'number') hosts.push(plain(h.online + '/' + h.total + (wide ? ' ' + t('page.now.hosts_online') : '')))
  const sep = wide ? plain(' ｜ ') : plain(' · ')
  const bs = isBriefStale(con, ctx.nowMs)
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
function poolRows(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean): Row[] {
  const pools = normalizedPools(con)
  if (pools === null) return []
  return rankPools(pools, ctx.nowMs, ctx.t).filter(v => v.role === 'broken' || isUnknownPool(v)).map(v => poolRowOf(ctx, v, wide))
}

// the items the exceptions block draws: non-quota exceptions, surfaced line issues (via shared lineState, R3), and `seat_blocked` items whose pool is not already in quota.pools (R1)
const isSeatBlocked = (i: ConsoleItem): boolean => i.kind === 'seat_blocked'
function exceptionRows(ctx: PageCtx, con: ConsoleSnapshot, wide: boolean): Row[] {
  const { t, nowMs, size } = ctx
  const pools = normalizedPools(con)
  const knownPools = new Set((pools ?? []).map(p => poolKey(p.pool)))
  const lineMap = new Map((con.lines ?? []).map(l => [l.line_id, l]))
  const stateWords = [t('page.fleet.w_offline'), t('page.fleet.idle'), t('page.fleet.w_stuck')]
  const items = con.items.filter((i: ConsoleItem) => {
    if (i.kind === 'quota' || i.id.startsWith('quota:')) return false
    if (isSeatBlocked(i)) return i.to_console !== false && (pools === null || typeof i.facts.pool !== 'string' || !knownPools.has(poolKey(i.facts.pool)))
    if (i.kind !== 'exception' || i.to_console !== true) return false
    if (i.line_id !== null && i.id.startsWith('exc:T3:')) {
      const ln = lineMap.get(i.line_id)
      if (ln !== undefined && ln.issues.some(x => x.to_console) && lineState(ln, t).word === t('page.fleet.w_offline')) return false
    }
    return true
  })
  const coveredLines = new Set<string>()
  const rows: Row[] = items.map((it, idx) => {
    if (it.line_id !== null) coveredLines.add(it.line_id)
    const ln = it.line_id === null ? undefined : lineMap.get(it.line_id)
    const ls = ln !== undefined && ln.issues.some(x => x.to_console) ? lineState(ln, t) : null
    const useLs = ls !== null && (it.id.startsWith('exc:T3:') || it.id.startsWith('exc:T4:'))
    const g = glyph(useLs ? ls.sid : it.state)
    const f = it.facts
    const stale = isSeatBlocked(it) && f.stale === true
    let body = wide ? it.text : it.title
    if (useLs && !stateWords.some(w => body.includes(w))) body = (ln?.label ?? '') + ' ' + ls.word + '：' + body
    const lead: Seg[] = [dim((idx === 0 ? GLYPHS.structure.folded : ' ') + (wide ? ' ' : '')), { text: g.text, ...(g.color === undefined ? {} : { color: g.color }) }]
    if (stale) return [...lead, staleBadge(' ' + body + ' ' + GLYPHS.state.failed + ' ' + t('page.now.seat_blocked_stale', { source: String(f.source ?? '?') }))]
    const left: Seg[] = [...lead, plain(' ' + body)]
    return wide ? rightAlign(left, ageOf(t, nowMs - it.since_ms), size.cols - 1) : truncateSegs(left, size.cols)
  })
  for (const ln of con.lines ?? []) {
    if (coveredLines.has(ln.line_id) || !ln.issues.some(x => x.to_console)) continue
    const ls = lineState(ln, t)
    if (ls.worst === null) continue
    const g = glyph(ls.sid)
    const subj = typeof ls.worst.subject === 'string' ? ls.worst.subject : ''
    const body = subj !== '' && stateWords.some(w => subj.includes(w)) ? ln.label + ' ' + subj : ln.label + ' ' + ls.word + (subj === '' ? '' : '：' + subj)
    const lead: Seg[] = [dim((rows.length === 0 ? GLYPHS.structure.folded : ' ') + (wide ? ' ' : '')), { text: g.text, ...(g.color === undefined ? {} : { color: g.color }) }]
    const left: Seg[] = [...lead, plain(' ' + body)]
    rows.push(wide ? rightAlign(left, ageOf(t, nowMs - ls.worst.since_ms), size.cols - 1) : truncateSegs(left, size.cols))
  }
  return rows
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
  const where = [proj, stage === null ? null : wide ? t('page.now.stage', { stage }) : stage, live.metrics === undefined ? null : 'ctx ' + live.metrics.ctx].filter((x): x is string => x !== null)
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
    return [staleBadge(prefix + '  ' + staleMark)]
  }
  const q = oldest === null ? '' : firstLine(oldest.question)
  let text = prefix
  if (q !== '') {
    const rem = size.cols - displayWidth(prefix) - displayWidth('：')
    if (rem >= 2) text = prefix + '：' + truncateToWidth(q, rem)
  }
  return [{ text: truncateToWidth(text, size.cols), color: PALETTE.attention, press: 'tab:2:decide' }]
}

// ---- the page ----
function render(ctx: PageCtx): { body: Row[]; actions: Row[] } {
  const { t, size, console: con, live, nowMs } = ctx
  const wide = size.cols >= 100
  const decisions = decisionCount(ctx)
  const actions: Row[] = []
  // the pending sentence is the first body row; the action row is only the jump (item 5: one sentence, not two)
  if (decisions > 0) actions.push([plain(GLYPHS.structure.answer + ' ' + t('page.now.jump_decide')), plain('  '), { text: '[2]', press: 'tab:2:decide', color: PALETTE.action }])
  const residue = live?.detail.residue?.reapable ?? 0
  if (residue > 0) actions.push([plain(GLYPHS.structure.answer + ' ' + t('page.now.go_residue', { n: residue })), plain('  '), { text: '[8]', press: 'tab:8:hygiene', color: PALETTE.action }])

  if (ctx.shortBody === true) {
    // R2: Short body (<= 4 rows): pending summary (Button + summary on one row) -> red (offline/stalled lines, red pools) -> unknown pools -> yellow; overflow -> `↓ 還有 N 項`
    const shortActions: Row[] = decisions > 0 && residue > 0 ? actions.slice(1) : actions
    const stripLen = size.cols < STRIP_SPLIT_COLS ? Math.min(2, size.rows) : Math.min(1, size.rows)
    const avail = Math.max(0, size.rows - 1 - stripLen)
    const actLen = Math.max(1, shortActions.length)
    const room = Math.max(0, avail - Math.min(actLen, avail))
    const items: Row[] = []
    const pRow = pendingRowOf(ctx, decisions, true)
    if (pRow !== null) items.push(pRow)
    if (con !== null) {
      const pools = normalizedPools(con)
      const knownPools = new Set((pools ?? []).map(p => poolKey(p.pool)))
      const ranked = pools === null ? [] : rankPools(pools, nowMs, t)
      const stateWords = [t('page.fleet.w_offline'), t('page.fleet.idle'), t('page.fleet.w_stuck')]
      const stuck = stuckLinesOf(con)
      const stuckIds = new Set(stuck.map(s => s.line.line_id))
      const stuckRows: Row[] = stuck.map(({ line }) => {
        const ls = lineState(line, t)
        const g = glyph(ls.sid)
        const subj = ls.worst !== null && typeof ls.worst.subject === 'string' ? ls.worst.subject : ''
        const desc = subj !== '' && stateWords.some(w => subj.includes(w)) ? line.label + ' ' + subj : line.label + ' ' + ls.word + (subj === '' ? '' : '：' + subj)
        return truncateSegs([...(wide ? [dim('  ')] : []), { text: g.text + ' ', ...(g.color === undefined ? {} : { color: g.color }) }, plain(desc)], size.cols)
      })
      const rawExc = [...con.items]
        .filter((i: ConsoleItem) => (i.kind === 'exception' && i.to_console === true && !i.id.startsWith('quota:') && (i.line_id === null || !stuckIds.has(i.line_id)))
          || (isSeatBlocked(i) && i.to_console !== false && (pools === null || typeof i.facts.pool !== 'string' || !knownPools.has(poolKey(i.facts.pool)))))
        .sort((a, b) => (a.line_id !== null ? 0 : 1) - (b.line_id !== null ? 0 : 1))
      const toShortExc = (it: ConsoleItem): Row => {
        const g = glyph(it.state)
        const body = wide ? it.text : it.title
        return truncateSegs([...(wide ? [dim('  ')] : []), { text: g.text, ...(g.color === undefined ? {} : { color: g.color }) }, plain(' ' + body)], size.cols)
      }
      const redExc = rawExc.filter(i => i.state === 'failed' || i.state === 'stalled').map(toShortExc)
      const yellowExc = rawExc.filter(i => i.state !== 'failed' && i.state !== 'stalled').map(toShortExc)
      const redPools = ranked.filter(v => v.role === 'broken').map(v => truncateSegs(poolRowOf(ctx, v, wide), size.cols))
      const unknownPools = ranked.filter(isUnknownPool).map(v => truncateSegs(poolRowOf(ctx, v, wide), size.cols))
      const yellowPools = ranked.filter(v => v.role === ROLE_WARNING && !isUnknownPool(v)).map(v => truncateSegs(poolRowOf(ctx, v, wide), size.cols))
      items.push(...stuckRows, ...redExc, ...redPools, ...unknownPools, ...yellowPools, ...yellowExc)
    }
    if (con === null) items.push(broken(t('page.now.no_console')))
    else if (items.length === 0 && dataMissing(con, nowMs, t)) items.push(broken(t('frame.unknown')))
    if (items.length === 0) {
      if (live !== null) items.push(...seatRows(ctx, live, wide).map(r => truncateSegs(r, size.cols)))
      else items.push(broken(t('page.now.no_live')))
    }
    if (items.length === 0) items.push([dim((wide ? '  ' : '') + t('page.now.exc_none'))])
    if (room > 0 && items.length > room) {
      if (room === 1) return { body: items.slice(0, 1), actions: shortActions }
      const keep = room - 1
      return { body: [...items.slice(0, keep), [{ text: t('page.now.more_items', { n: items.length - keep, arrow: GLYPHS.structure.behind }), dim: true }]], actions: shortActions }
    }
    return { body: items, actions: shortActions }
  }

  const body: Row[] = []
  // 1. the pending count and the oldest card's title come first (G2, R2, R8); the [2] jump stays in the action area
  const pRow = pendingRowOf(ctx, decisions, false)
  if (pRow !== null) body.push(pRow)
  body.push(ruleRow(t('page.now.fleet'), wide))
  if (con === null) body.push(broken(t('page.now.no_console')))
  else {
    body.push(...overviewRows(ctx, con, wide))
    // 2. the stuck lines and the other exceptions, 3. every red pool in full
    const exc = exceptionRows(ctx, con, wide)
    const pr = poolRows(ctx, con, wide)
    body.push(...exc, ...pr)
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
  return { body, actions }
}
// the seat's name comes from the quota feed's own row; unknown until the first good `seats --quota`
const seatName = (wide: boolean): string => { const n = seatQuota.view().row?.seat ?? ''; return wide ? n : n.replace(/--.*$/, '') }

export const nowPage: Page = { id: 'now', key: '1', title: '現況', framed: true, render }
