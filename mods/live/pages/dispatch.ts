// mods/live/pages/dispatch.ts — page 3 派工 (ux-v7.4 S4): ONE section 派工 N 筆, columns 線 / 引擎 / 工作 / 狀態 from ctx.live rows (running first, then recent finished); no foreman / 其他分頁 block, no action buttons.
// Pure: PageCtx in, body and action rows out; frameRows draws the header, padding, empty-action fallback, overflow hint, and bottom tab strip.
// Missing or stale live sources render in PALETTE.broken with the full wrapped reason (never cut with an ellipsis). Every key hint has a matching Button.
import type { LivePaneRow, Seg } from '../model'
import { TRACE_STALE_MIN, TRACE_STALE_MS, runAgedOut, runEndedMs, runSubject, truncateToWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { displayWidth } from '../../tux/width.ts'
import { STATES, stateOf, wrapPlain } from '../ui'
import type { StateId } from '../ui'
import { fleetLines } from '../v74/contract'
import type { Page, PageCtx } from './frame'
import { brokenRow, consoleFleetCounts, isBriefStale, staleBadge } from './rows'
import type { Row } from './rows'

type T = PageCtx['t']

export type DispatchView = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: DispatchView = { focus: 0, expanded: true }
export type DispatchCtx = PageCtx & { dispatch?: Partial<DispatchView> }

const W_LINE = 12
const W_ENGINE = 14
const W_WORK_MAX = 34
const STATUS_MIN = 14
const TIMEOUT_RE = /time[-_ ]?out|timed[-_ ]?out/i

const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - displayWidth(s)))
const fit = (s: string, w: number): string => (displayWidth(s) <= w ? s : truncateToWidth(s, w))

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

const brokenRows = (text: string, cols: number): Row[] =>
  wrapPlain(text, Math.max(1, cols), Math.max(1, cols)).map(line => brokenRow(line))

function fmtDur(ms: number, wide: boolean, t: T): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return wide ? t('page.dispatch.dur_s', { n: s }) : t('page.dispatch.dur_s_c', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return wide ? t('page.dispatch.dur_m', { n: m }) : t('page.dispatch.dur_m_c', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return wide ? t('page.dispatch.dur_h', { n: h }) : t('page.dispatch.dur_h_c', { n: h })
  const d = Math.floor(h / 24)
  return wide ? t('page.dispatch.dur_d', { n: d }) : t('page.dispatch.dur_d_c', { n: d })
}

function fmtAgo(ms: number, wide: boolean, t: T): string {
  const age = fmtDur(ms, wide, t)
  return wide ? t('page.dispatch.ago', { age }) : t('page.dispatch.ago_c', { age })
}

function engineOrEmpty(r: LivePaneRow): string {
  const runner = r.runner?.trim() ?? ''
  const model = r.model?.trim() ?? ''
  if (runner !== '' && model !== '') return runner === model ? runner : runner + '/' + model
  return runner || model || ''
}


const RULE = GLYPHS.structure.rule
function sectionRule(label: string, cols: number): Row {
  const head = GLYPHS.structure.open + ' ' + label + ' '
  return [{ text: head, color: PALETTE.idle }, { text: RULE.repeat(Math.max(2, cols - displayWidth(head) - 2)), color: PALETTE.structure }]
}

type ClassifiedRun = { row: LivePaneRow; sid: StateId }
const classify = (row: LivePaneRow): ClassifiedRun => ({ row, sid: stateOf('run', runSubject(row)).id })

// the 狀態 cell: what the run is doing (never progress). A timed-out run names its timeout seconds (the run's elapsed_s, which the producer freezes at the end).
export function statusText(r: LivePaneRow, sid: StateId, nowMs: number, t: T): string {
  if (r.final_status !== null && TIMEOUT_RE.test(r.final_status)) return r.elapsed_s === null ? t('v74.e.st_timeout_unknown') : t('v74.e.st_timeout', { n: r.elapsed_s })
  const elapsed = r.elapsed_s === null ? '' : ' ' + fmtDur(r.elapsed_s * 1000, true, t)
  if (r.ended) {
    const endMs = runEndedMs(r)
    const ago = endMs === null || nowMs <= 0 ? '' : ' ' + fmtAgo(Math.max(0, nowMs - endMs), true, t)
    if (sid === 'done') return t('v74.e.st_done') + ago
    if (sid === 'failed') return t('v74.e.st_failed') + ago
    return t('v74.e.st_stopped') + ago
  }
  if (sid === 'stalled') return t('v74.e.st_stalled') + elapsed
  if (sid === 'running') return t('v74.e.st_running') + elapsed
  if (sid === 'pending') return t('v74.e.st_starting')
  return t('v74.e.st_stopped') + elapsed
}

function colHeaderRow(wWork: number, t: T): Row {
  const text = '    ' + pad(t('v74.e.col_line'), W_LINE) + pad(t('v74.e.col_engine'), W_ENGINE) + pad(t('v74.e.col_work'), wWork + 2) + t('v74.e.col_status')
  return [{ text, color: PALETTE.structure }]
}

function drawRunRow(item: ClassifiedRun, wWork: number, stale: boolean, cols: number, nowMs: number, t: T): Row {
  const { row: r, sid } = item
  const st = STATES[sid]
  const eng = engineOrEmpty(r)
  const status = statusText(r, sid, nowMs, t)
  const statusSeg: Seg = stale ? staleBadge(GLYPHS.state.failed + ' ' + status) : { text: status }
  return truncateSegs([
    { text: ' ' },
    { text: st.glyph + ' ', ...(st.key === undefined ? {} : { color: st.key }) },
    { text: pad(fit(r.run_id, W_LINE - 1), W_LINE) + pad(fit(eng === '' ? GLYPHS.structure.empty : eng, W_ENGINE - 1), W_ENGINE) + pad(fit(r.role ?? GLYPHS.structure.empty, wWork), wWork + 2) },
    statusSeg,
  ], cols)
}

function fleetLineSummaryRows(ctx: PageCtx): Row[] {
  const { t, v74, console: con, size } = ctx
  if (v74 === undefined) return []
  const cols = size.cols
  const nowMs = ctx.nowMs > 0 ? ctx.nowMs : (ctx.live?.detail.now_ms ?? 0)
  const pm = v74.pm
  const pmErr = (v74.pmError ?? v74.errors?.now ?? '').trim()
  const fleetSum = v74.fleetSummary ?? null
  const fleetErr = (v74.fleetError ?? v74.errors?.fleet ?? fleetSum?.error ?? '').trim()
  const thr = t('trace.dispatch_lines_thr', { limit: TRACE_STALE_MIN })

  const countRow = (stalled: number | null, running: number | null, failed: number | null, waiting: number | null, total: number | null): Row => {
    const fmt = (n: number | null): string => (n === null ? GLYPHS.structure.empty : String(n))
    const segs: Seg[] = [
      { text: '  ' },
      { text: GLYPHS.state.stalled + fmt(stalled), ...(stalled !== null && stalled > 0 ? { color: PALETTE.broken } : stalled === null ? { dim: true } : {}) },
      { text: '  ' },
      { text: GLYPHS.state.running + fmt(running), ...(running === null ? { dim: true } : {}) },
      { text: '  ' },
      { text: GLYPHS.state.failed + fmt(failed), ...(failed !== null && failed > 0 ? { color: PALETTE.broken } : failed === null ? { dim: true } : {}) },
      { text: '  ' },
      { text: GLYPHS.state.waiting + fmt(waiting), ...(waiting === null ? { dim: true } : {}) },
      ...(total === null ? [] : [{ text: '  · ' + t('trace.dispatch_lines_total', { n: total }), dim: true }]),
    ]
    return truncateSegs(segs, cols)
  }

  const out: Row[] = []
  if (pm !== null) {
    const lines = fleetLines(pm)
    let stalled = 0
    let running = 0
    let failed = 0
    let waiting = 0
    for (const l of lines) {
      if (l.mark === 'parked') stalled++
      else if (l.mark === 'fail') failed++
      else if (l.mark === 'unknown') waiting++
      else running++
    }
    const pmAt = pm.generated_at_ms > 0 ? pm.generated_at_ms : v74.pmFetchedMs
    const pmAgeMs = pmAt !== null && nowMs > 0 ? Math.max(0, nowMs - pmAt) : null
    const fetchAgeMs = v74.pmFetchedMs !== null && nowMs > 0 ? Math.max(0, nowMs - v74.pmFetchedMs) : null
    const agePart = pmAgeMs === null ? '' : ' · ' + fmtAgo(pmAgeMs, true, t)
    out.push(sectionRule(t('trace.dispatch_lines_head', { source: 'fleet pm status --json' }) + agePart + ' · ' + thr, cols))
    out.push(countRow(stalled, running, failed, waiting, pm.projects.length))
    if ((pmAgeMs !== null && pmAgeMs > TRACE_STALE_MS) || (fetchAgeMs !== null && fetchAgeMs > TRACE_STALE_MS)) {
      const worstAge = Math.max(pmAgeMs ?? 0, fetchAgeMs ?? 0)
      out.push(...brokenRows(GLYPHS.state.failed + ' ' + t('trace.now_pm_stale', { age: fmtDur(worstAge, true, t), limit: TRACE_STALE_MIN }), cols))
    }
    return out
  }

  const pmMiss = pmErr !== '' ? t('trace.fleet_pm_error', { error: pmErr }) : t('v74.c.pm_missing')
  if (con !== null) {
    const fc = consoleFleetCounts(con, t)
    const tasksSrc = con.sources.tasks
    const srcAgeMs = tasksSrc?.at_ms != null && nowMs > 0
      ? Math.max(0, nowMs - tasksSrc.at_ms)
      : (con.generated_at_ms > 0 && nowMs > 0 ? Math.max(0, nowMs - con.generated_at_ms) : null)
    const agePart = srcAgeMs === null ? '' : ' · ' + fmtAgo(srcAgeMs, true, t)
    out.push(sectionRule(t('trace.dispatch_lines_head', { source: 'fleet console --json' }) + agePart + ' · ' + thr, cols))
    out.push(countRow(fc.stuck, fc.running, fc.failed, fc.waiting, fc.stuck + fc.running + fc.failed + fc.waiting + fc.normal))
    out.push(...brokenRows(GLYPHS.state.failed + ' ' + pmMiss, cols))
    if (tasksSrc?.state === 'no_source') {
      out.push(...brokenRows(GLYPHS.state.failed + ' ' + t('frame.src_no_source', { name: t('console.command.src.tasks') }), cols))
    } else {
      const bs = isBriefStale(con, nowMs)
      const isStale = tasksSrc?.state === 'stale' || tasksSrc?.state === 'expired' || (srcAgeMs !== null && srcAgeMs > TRACE_STALE_MS) || bs.stale
      if (isStale) {
        const stWord = tasksSrc !== undefined && tasksSrc.state !== 'ok' ? tasksSrc.state : bs.expired ? 'expired' : 'stale'
        const msg = srcAgeMs !== null
          ? t('trace.now_tasks_stale', { state: stWord, age: fmtDur(srcAgeMs, true, t), limit: TRACE_STALE_MIN })
          : t('trace.now_tasks_stale_noage', { state: stWord, limit: TRACE_STALE_MIN })
        out.push(...brokenRows(GLYPHS.state.failed + ' ' + msg, cols))
      }
    }
    return out
  }

  if (fleetSum !== null && fleetSum.fetchedMs !== null) {
    const fAgeMs = nowMs > 0 ? Math.max(0, nowMs - fleetSum.fetchedMs) : 0
    const tot = fleetSum.totals
    const srcName = t('fleet.source_cmd')
    out.push(sectionRule(t('trace.dispatch_lines_head', { source: srcName }) + ' · ' + fmtAgo(fAgeMs, true, t) + ' · ' + thr, cols))
    out.push(countRow(tot.stuck, tot.running, tot.failed, tot.waiting, tot.stuck + tot.running + tot.failed + tot.waiting))
    out.push(...brokenRows(GLYPHS.state.failed + ' ' + [pmMiss, t('page.now.nosrc_console')].join(t('sep.list')), cols))
    if (fAgeMs > TRACE_STALE_MS) {
      out.push(...brokenRows(GLYPHS.state.failed + ' ' + t('trace.hygiene_src_stale', { source: srcName, age: fmtDur(fAgeMs, true, t), limit: TRACE_STALE_MIN }), cols))
    }
    return out
  }

  out.push(sectionRule(t('trace.dispatch_lines_missing', { limit: TRACE_STALE_MIN }), cols))
  out.push(countRow(null, null, null, null, null))
  const whyParts = [t('page.now.nosrc_console'), fleetErr !== '' ? t('fleet.error', { error: fleetErr }) : t('fleet.source_cmd') + ' ' + t('fleet.never')]
  out.push(...brokenRows(GLYPHS.state.failed + ' ' + [pmMiss, t('trace.now_no_fallback', { why: whyParts.join(t('sep.list')) })].join(t('sep.list')), cols))
  return out
}

export function dispatchView(ctx: PageCtx, _view: DispatchView = DEFAULT_VIEW): { body: Row[]; actions: Row[] } {
  const { t, size } = ctx
  const cols = size.cols
  const body: Row[] = fleetLineSummaryRows(ctx)
  if (ctx.live === null) {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('page.dispatch.no_live'), cols))
    return { body, actions: [] }
  }

  const live = ctx.live
  const stale = live.state !== 'ok'
  if (stale) {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('page.dispatch.stale_live', { why: live.header }), cols))
    if (live.rows === null) return { body, actions: [] }
  } else if (live.rows === null) {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('page.dispatch.no_runs'), cols))
    return { body, actions: [] }
  }

  const nowMs = ctx.nowMs > 0 ? ctx.nowMs : (live.detail.now_ms ?? 0)
  const ageRef = nowMs > 0 ? nowMs : null
  const running = live.rows.filter(r => !r.ended).map(classify)
  const finished = live.rows.filter(r => r.ended && !runAgedOut(r, ageRef)).map(classify)
  const all = [...running, ...finished]
  if (all.length === 0) {
    body.push([{ text: GLYPHS.state.pending + ' ', color: PALETTE.idle }, { text: t('page.dispatch.none'), dim: true }])
    return { body, actions: [] }
  }

  const wWork = Math.max(8, Math.min(W_WORK_MAX, cols - 4 - W_LINE - W_ENGINE - 2 - STATUS_MIN))
  body.push(sectionRule(t('v74.e.section', { n: all.length }), cols))
  body.push(colHeaderRow(wWork, t))
  for (const item of all) body.push(drawRunRow(item, wWork, stale, cols, nowMs, t))
  body.push([{ text: '' }])
  body.push([{ text: ' ' + t('v74.e.note'), dim: true }])
  return { body, actions: [] }
}

export const dispatchPage: Page = {
  id: 'dispatch',
  key: '3',
  title: '派工',
  framed: true,
  render: ctx => dispatchView(ctx),
}
