// mods/live/pages/fleet.ts — v7.4 S8 艦隊 (PM 01M7N307, sub-task F): the local decision cards and the other hosts' cards on top, then the fleet's runs in three blocks, 執行中 / 失敗 / 已完成
// (the old version's running / failed split; terminal runs are listed under 已完成 instead of hidden; nothing is grouped by line name).
// Pure. Local cards come from ctx.v74.decide; the other hosts' cards from `ctx.others` (fleet.ts `othersView`, to be wired by the pane); the runs from ctx.live.rows (the rows 派工 draws).
// A missing source is the existing broken row, never an invented one. `rowsOf` / `FOLD_AT` stay: register.ts still sizes the console-line focus with them.
import type { ConsoleLine } from '../console'
import type { OthersView } from '../fleet'
import { makeT } from '../i18n'
import type { T } from '../i18n'
import type { LivePaneRow, Seg } from '../model'
import { DEFAULT_VALID_FOR_S, TRACE_STALE_MIN, TRACE_STALE_MS, displayWidth, liveAgeMs, runEndedMs, runSubject, truncateToWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { STATES, stateOf, wrapPlain } from '../ui'
import type { StateId } from '../ui'
import { fleetLines } from '../v74/contract'
import type { Page, PageCtx } from './frame'
import { brokenRow, consoleFleetCounts, lineDuration, lineState, lineTotal } from './rows'
import type { Row } from './rows'

export const FOLD_AT = 6 // rows shown before the fold (the console-line focus clamp in register.ts)
export type FleetView = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: FleetView = { focus: 0, expanded: false }
// Minimal s2/feed trace extension: pages read optional error/summary fields when wired without blocking on s2's V74Ctx edit.
export type FleetFeedInfo = {
  fetchedMs: number | null
  error: string | null
  totals?: { stuck: number; running: number; waiting: number; failed: number } | null
}
export type FleetCtx = PageCtx & { others?: OthersView | null; fleetFeed?: FleetFeedInfo | null }
// now = PM feed error message (aligned with V74Ctx.errors / ages keyed by page id).
type V74FleetTrace = { pmError?: string | null; fleetError?: string | null; fleetSummary?: FleetFeedInfo | null; errors?: { now?: string | null; fleet?: string | null } }

type FleetRow = { line: ConsoleLine; sid: StateId; word: string; worst: ConsoleLine['issues'][number] | null }
const RANK: Record<string, number> = { failed: 0, stalled: 1 }

export function rowsOf(lines: ConsoleLine[], t: T = makeT('zh-TW')): FleetRow[] {
  const out: FleetRow[] = lines.map(line => {
    const { sid, word, worst } = lineState(line, t)
    return { line, sid, word, worst }
  })
  const rank = (r: FleetRow): number => (r.worst === null ? 9 : RANK[r.sid] ?? 2)
  return out.sort((a, b) => rank(a) - rank(b) || (a.worst?.since_ms ?? Infinity) - (b.worst?.since_ms ?? Infinity) || a.line.label.localeCompare(b.line.label))
}


const openRule = (title: string, right: string | null, wide: boolean): Row => {
  const head = GLYPHS.structure.open + ' ' + title + ' '
  const tail = right === null ? '' : '· ' + right + ' '
  const fill = wide ? GLYPHS.structure.rule.repeat(Math.max(2, 54 - displayWidth(head + tail))) : ''
  return [{ text: head + tail, color: PALETTE.idle }, ...(fill === '' ? [] : [{ text: fill, color: PALETTE.structure }])]
}
const miss = (text: string): Row => brokenRow(' ' + GLYPHS.state.failed + ' ' + text)
const missRows = (text: string, cols: number): Row[] => wrapPlain(' ' + GLYPHS.state.failed + ' ' + text, Math.max(8, cols), Math.max(8, cols)).map(l => brokenRow(l))

// Y3: one duration grammar on every page (rows.ts lineDuration: 3 時 40 分)
const ageText = (t: T, ms: number): string => t('page.now.ago', { age: lineDuration(ms, t) })
const durText = (t: T, s: number): string => lineDuration(s * 1000, t)
const ageUnitShort = (t: T, ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t('page.now.age_s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('page.now.age_m', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('page.now.age_h', { n: h }) : t('page.now.age_d', { n: Math.floor(h / 24) })
}

function cardRows(ctx: FleetCtx, wide: boolean): Row[] {
  const { t, nowMs, size } = ctx
  const cards = ctx.v74?.decide ?? null
  if (cards === null) return [miss(t('v74.f.cards_missing'))]
  const decideFetched = ctx.v74?.ages?.decide ?? null
  const decideAge = decideFetched === null ? null : Math.max(0, nowMs - decideFetched)
  const out: Row[] = [openRule(t('v74.f.sec_cards', { n: cards.length }), decideAge === null ? null : ageText(t, decideAge), wide)]
  if (decideAge !== null && decideAge > TRACE_STALE_MS) {
    out.push(...missRows(t('trace.fleet_cards_stale', { age: ageUnitShort(t, decideAge), limit: TRACE_STALE_MIN }), size.cols))
  }
  for (const c of cards) out.push([{ text: ' ' }, { text: GLYPHS.structure.decisions + ' ', color: PALETTE.attention }, { text: c.title }])
  return out
}

function othersRows(ctx: FleetCtx, wide: boolean): Row[] {
  const { t, nowMs, size } = ctx
  const o = ctx.others ?? null
  if (o === null) return [miss(t('v74.f.others_missing'))]
  if (!o.present) return [miss(t('v74.f.others_nosync'))]
  if (o.unreadable !== null) return [miss(t('v74.f.others_bad', { error: o.unreadable }))]
  const age = o.syncedMs === null ? null : ageText(t, Math.max(0, nowMs - o.syncedMs))
  const out: Row[] = [openRule(t('v74.f.sec_others', { n: o.cards.length }), age, wide)]
  if (o.stale) out.push(...missRows(t('fleet.others_stale'), size.cols))
  if (o.lastError !== null) out.push(...missRows(t('fleet.others_error', { error: o.lastError }), size.cols))
  for (const c of o.cards) {
    const title = c.title ?? truncateToWidth(c.question, 24)
    out.push([{ text: ' ' }, { text: GLYPHS.structure.remoteDecision + ' ', color: PALETTE.attention }, { text: c.id + ' ' + title + '  ' + t('v74.f.others_answer', { where: c.where.split('/').filter(Boolean).pop() ?? c.where }) }])
  }
  return out
}

function lineSummaryBlock(ctx: FleetCtx, wide: boolean): Row[] {
  const { t, nowMs, size, console: con } = ctx
  const vExt = ctx.v74 as V74FleetTrace | undefined
  const pm = ctx.v74?.pm ?? null
  const pmErr = (vExt?.pmError ?? vExt?.errors?.now ?? '').trim()
  const fleetInfo = ctx.fleetFeed ?? vExt?.fleetSummary ?? null
  const fleetErr = (fleetInfo?.error ?? vExt?.fleetError ?? vExt?.errors?.fleet ?? '').trim()
  const out: Row[] = []

  if (pm !== null) {
    const lines = fleetLines(pm)
    let fail = 0, idle = 0, ok = 0, unknown = 0
    for (const l of lines) {
      if (l.mark === 'fail') fail++
      else if (l.mark === 'parked') idle++
      else if (l.mark === 'unknown') unknown++
      else ok++
    }
    const pmAt = pm.generated_at_ms > 0 ? pm.generated_at_ms : (ctx.v74?.pmFetchedMs ?? null)
    const pmAgeMs = pmAt === null ? null : Math.max(0, nowMs - pmAt)
    const fetchAgeMs = ctx.v74?.pmFetchedMs != null ? Math.max(0, nowMs - ctx.v74.pmFetchedMs) : null
    const worstAge = Math.max(pmAgeMs ?? 0, fetchAgeMs ?? 0)
    out.push(openRule(t('trace.fleet_lines_sec', { source: 'fleet pm status --json' }), pmAgeMs === null ? null : ageText(t, pmAgeMs), wide))
    if ((pmAgeMs !== null && pmAgeMs > TRACE_STALE_MS) || (fetchAgeMs !== null && fetchAgeMs > TRACE_STALE_MS)) {
      out.push(...missRows(t('trace.now_pm_stale', { age: ageUnitShort(t, worstAge), limit: TRACE_STALE_MIN }), size.cols))
    }
    out.push([
      { text: ' ' + t('v74.c.lines') + ' ' + String(pm.projects.length) + '  ' },
      { text: GLYPHS.state.failed + String(fail), ...(fail > 0 ? { color: PALETTE.broken } : {}) },
      { text: ' ' + GLYPHS.state.stalled + String(idle) + ' ' + GLYPHS.state.running + String(ok) + (unknown > 0 ? ' ' + GLYPHS.state.waiting + String(unknown) : '') },
    ])
  } else if (pmErr !== '') {
    out.push(...missRows(t('trace.fleet_pm_error', { error: pmErr }), size.cols))
  }

  if (pm === null && con !== null) {
    const fc = consoleFleetCounts(con, t)
    const tot = lineTotal(con)
    const tasksSrc = con.sources.tasks
    const srcAgeMs = tasksSrc?.at_ms != null ? Math.max(0, nowMs - tasksSrc.at_ms) : (con.generated_at_ms > 0 ? Math.max(0, nowMs - con.generated_at_ms) : null)
    out.push(openRule(t('trace.fleet_lines_sec', { source: 'console' }), srcAgeMs === null ? null : ageText(t, srcAgeMs), wide))
    if (tasksSrc?.state === 'no_source') {
      out.push(...missRows(t('frame.src_no_source', { name: t('console.command.src.tasks') }), size.cols))
    } else if (tasksSrc?.state === 'stale' || tasksSrc?.state === 'expired' || (srcAgeMs !== null && srcAgeMs > TRACE_STALE_MS)) {
      const stateWord = tasksSrc !== undefined && tasksSrc.state !== 'ok' ? tasksSrc.state : 'stale'
      const msg = srcAgeMs !== null
        ? t('trace.now_tasks_stale', { state: stateWord, age: ageUnitShort(t, srcAgeMs), limit: TRACE_STALE_MIN })
        : t('trace.now_tasks_stale_noage', { state: stateWord, limit: TRACE_STALE_MIN })
      out.push(...missRows(msg, size.cols))
    }
    out.push([
      { text: ' ' + t('v74.c.lines') + ' ' + String(tot) + '  ' },
      { text: GLYPHS.state.failed + String(fc.failed), ...(fc.failed > 0 ? { color: PALETTE.broken } : {}) },
      { text: ' ' + GLYPHS.state.stalled + String(fc.stuck) + ' ' + GLYPHS.state.running + String(fc.running) + ' ' + GLYPHS.state.waiting + String(fc.waiting) + (fc.normal > 0 ? ' ' + GLYPHS.state.pending + String(fc.normal) : '') },
    ])
  }

  if (fleetErr !== '') {
    out.push(...missRows(t('fleet.error', { error: fleetErr }), size.cols))
  }

  if (pm === null && con === null && fleetInfo?.totals != null && fleetInfo.fetchedMs !== null) {
    const fAgeMs = Math.max(0, nowMs - fleetInfo.fetchedMs)
    const totals = fleetInfo.totals
    out.push(openRule(t('trace.fleet_lines_sec', { source: t('fleet.source_cmd') }), ageText(t, fAgeMs), wide))
    if (fAgeMs > TRACE_STALE_MS) {
      out.push(...missRows(t('trace.hygiene_src_stale', { source: t('fleet.source_cmd'), age: ageUnitShort(t, fAgeMs), limit: TRACE_STALE_MIN }), size.cols))
    }
    out.push([
      { text: ' ' + t('v74.c.lines') + '  ' },
      { text: GLYPHS.state.failed + String(totals.failed), ...(totals.failed > 0 ? { color: PALETTE.broken } : {}) },
      { text: ' ' + GLYPHS.state.stalled + String(totals.stuck) + ' ' + GLYPHS.state.running + String(totals.running) + ' ' + GLYPHS.state.waiting + String(totals.waiting) },
    ])
  }

  return out
}

type Block = 'running' | 'failed' | 'done'
const blockOf = (sid: StateId): Block => (sid === 'failed' ? 'failed' : sid === 'done' ? 'done' : 'running')

function runRow(ctx: FleetCtx, r: LivePaneRow, sid: StateId, block: Block): Row {
  const { t, nowMs } = ctx
  const st = STATES[sid]
  const engine = [r.runner, r.model].filter((x): x is string => x !== null && x.trim() !== '').filter((x, i, a) => a.indexOf(x) === i).join('/')
  const parts = [[r.run_id, engine].filter(Boolean).join(' '), ...(r.role === null || r.role === '' ? [] : [r.role])]
  const tail: string | null =
    block === 'done' ? (runEndedMs(r) === null ? null : t('v74.f.run_done', { age: ageText(t, Math.max(0, nowMs - (runEndedMs(r) as number))) }))
    : block === 'failed' ? (r.final_status !== null && /time[-_ ]?out|timed[-_ ]?out/i.test(r.final_status) ? (r.elapsed_s === null ? t('v74.e.st_timeout_unknown') : t('v74.e.st_timeout', { n: r.elapsed_s })) : r.final_status ?? (r.rc === null ? null : 'rc ' + r.rc))
    : r.elapsed_s === null ? null : t('v74.f.run_running', { age: durText(t, r.elapsed_s) })
  const seg: Seg = { text: parts.join(' · ') + (tail === null ? '' : '  · ' + tail) }
  return [{ text: ' ' }, { text: st.glyph + ' ', ...(st.key === undefined ? {} : { color: st.key }) }, seg]
}

function runBlocks(ctx: FleetCtx, wide: boolean): Row[] {
  const { t, live, nowMs, size } = ctx
  if (live === null) return [miss(t('v74.f.runs_missing'))]
  const out: Row[] = []
  const liveAge = liveAgeMs(live, nowMs)
  if (live.state !== 'ok') {
    const thresh = liveAge !== null
      ? t('trace.age_threshold', { age: ageUnitShort(t, liveAge), limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S })
      : t('trace.threshold_only', { limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S })
    out.push(...missRows(t('v74.f.runs_stale', { why: (live.header ?? '').trim() || live.state }) + ' · ' + thresh, size.cols))
  } else if (liveAge !== null && liveAge > TRACE_STALE_MS) {
    out.push(...missRows(t('trace.fleet_live_age_stale', { age: ageUnitShort(t, liveAge), limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S }), size.cols))
  }
  if (live.rows === null) return [...out, miss(t('page.dispatch.no_runs'))]
  const by: Record<Block, { r: LivePaneRow; sid: StateId }[]> = { running: [], failed: [], done: [] }
  for (const r of live.rows) {
    const sid = stateOf('run', runSubject(r)).id
    by[blockOf(sid)].push({ r, sid })
  }
  const marks: Record<Block, string> = { running: GLYPHS.state.running, failed: GLYPHS.state.failed, done: GLYPHS.state.done }
  const keys: Record<Block, string> = { running: 'v74.f.sec_running', failed: 'v74.f.sec_failed', done: 'v74.f.sec_done' }
  for (const b of ['running', 'failed', 'done'] as const) {
    out.push(openRule(t(keys[b], { mark: marks[b], n: by[b].length }), null, wide))
    if (by[b].length === 0) out.push([{ text: ' ' + t('v74.f.none_row'), dim: true }])
    for (const x of by[b]) out.push(runRow(ctx, x.r, x.sid, b))
  }
  return out
}

export function fleetView(ctx: FleetCtx, _view: FleetView = DEFAULT_VIEW): { body: Row[]; actions: Row[] } {
  const wide = ctx.size.cols >= 100
  return { body: [...cardRows(ctx, wide), ...othersRows(ctx, wide), ...runBlocks(ctx, wide), ...lineSummaryBlock(ctx, wide)], actions: [] }
}

export const fleetPage: Page = { id: 'fleet', key: '7', title: '艦隊', framed: true, render: ctx => fleetView(ctx) }
