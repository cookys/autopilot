// mods/live/pages/dispatch.ts — page 5 派工 (plan r2 §2 row 5, §3.1, §3.2, §5): running dispatches, foreman activity, and recent finished dispatches from ctx.live.
// Pure: PageCtx in, body and action rows out; frameRows draws the header, padding, empty-action fallback, overflow hint, and bottom tab strip.
// Missing or stale live sources render in PALETTE.broken with the full wrapped reason (never cut with an ellipsis). Every key hint has a matching Button.
import type { ForemanView, LivePaneRow, Seg } from '../model'
import { runAgedOut, runEndedMs, runSubject, truncateToWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { displayWidth } from '../../tux/width.ts'
import { SEVERITY, STATES, stateOf, wrapPlain } from '../ui'
import type { StateId } from '../ui'
import type { Page, PageCtx } from './frame'
import { brokenRow, staleBadge } from './rows'
import type { Row } from './rows'

type T = PageCtx['t']

export type DispatchView = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: DispatchView = { focus: 0, expanded: true }
export type DispatchCtx = PageCtx & { dispatch?: Partial<DispatchView> }

const WIDE_COLS = 100
const W_RUN = 26
const W_ROLE = 12
const W_ENGINE = 17
const W_ELAPSED = 9

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

function secRule(label: string, wide: boolean): Row {
  const r = GLYPHS.structure.rule
  const head = r + r + ' ' + label + (label.endsWith('）') ? '' : ' ')
  const tail = wide ? r.repeat(Math.max(2, (label.endsWith('）') ? 52 : 58) - displayWidth(head))) : r + r
  return [{ text: head + tail, color: PALETTE.structure }]
}

function foremanRule(t: T): Row {
  const r = GLYPHS.structure.rule
  return [{ text: r + r + ' ' + t('page.dispatch.sec_foreman') + ' ' + r + r, color: PALETTE.structure }]
}

type ClassifiedRun = { row: LivePaneRow; sid: StateId }

function classifyRuns(rows: readonly LivePaneRow[]): ClassifiedRun[] {
  return rows
    .map(row => ({ row, sid: stateOf('run', runSubject(row)).id }))
    .sort((a, b) => SEVERITY.indexOf(a.sid) - SEVERITY.indexOf(b.sid))
}

function colHeaderRow(t: T): Row {
  const text =
    '  '
    + pad(t('page.dispatch.col_run'), W_RUN + 2)
    + pad(t('page.dispatch.col_role'), W_ROLE)
    + pad(t('page.dispatch.col_engine'), W_ENGINE)
    + pad(t('page.dispatch.col_elapsed'), W_ELAPSED)
    + t('page.dispatch.col_last')
  return [{ text, color: PALETTE.structure }]
}

function drawRunRow(
  item: ClassifiedRun,
  focused: boolean,
  isFinished: boolean,
  wide: boolean,
  stale: boolean,
  cols: number,
  nowMs: number,
  t: T,
): Row {
  const { row: r, sid } = item
  const st = STATES[sid]
  const endMs = isFinished ? runEndedMs(r) : null
  const elapsedRaw = r.elapsed_s === null ? null : fmtDur(r.elapsed_s * 1000, wide, t)
  const lastRaw = isFinished
    ? (endMs === null || nowMs <= 0 ? null : fmtAgo(Math.max(0, nowMs - endMs), wide, t))
    : (r.probe_age_s === null ? null : fmtAgo(r.probe_age_s * 1000, wide, t))
  const eng = engineOrEmpty(r)

  if (wide) {
    const mark: Seg = { text: (focused ? GLYPHS.structure.folded : ' ') + ' ', ...(focused ? { color: PALETTE.structure } : {}) }
    const glyph: Seg = { text: st.glyph + ' ', ...(st.key === undefined ? {} : { color: st.key }) }
    const elapsedText = (elapsedRaw ?? GLYPHS.structure.empty) + (stale && elapsedRaw !== null ? GLYPHS.state.failed : '')
    const lastText = (stale && lastRaw !== null ? GLYPHS.state.failed : '') + (lastRaw ?? GLYPHS.structure.empty)
    const mid =
      pad(fit(r.run_id, W_RUN - 1), W_RUN)
      + pad(fit(r.role ?? GLYPHS.structure.empty, W_ROLE - 1), W_ROLE)
      + pad(fit(eng === '' ? GLYPHS.structure.empty : eng, W_ENGINE - 1), W_ENGINE)
    const elapsedSeg: Seg = stale && elapsedRaw !== null ? staleBadge(pad(elapsedText, W_ELAPSED)) : { text: pad(elapsedText, W_ELAPSED) }
    const lastSeg: Seg = stale && lastRaw !== null ? staleBadge(lastText) : { text: lastText }
    return truncateSegs([mark, glyph, { text: mid }, elapsedSeg, lastSeg], cols)
  }

  const mark: Seg = { text: focused ? GLYPHS.structure.folded : ' ', ...(focused ? { color: PALETTE.structure } : {}) }
  const glyph: Seg = { text: st.glyph + ' ', ...(st.key === undefined ? {} : { color: st.key }) }
  const tailParts = isFinished
    ? [r.role, elapsedRaw, lastRaw !== null && stale ? GLYPHS.state.failed + lastRaw : lastRaw]
    : [r.role, eng === '' ? null : eng, elapsedRaw !== null && stale ? elapsedRaw + GLYPHS.state.failed : elapsedRaw]
  const tail = tailParts.filter((x): x is string => x !== null && x !== '').join(' ')
  const suffix = tail === '' ? '' : ' ' + tail
  const maxRun = Math.max(4, cols - 3 - displayWidth(suffix))
  const shownRun = fit(r.run_id, maxRun)
  if (stale && (elapsedRaw !== null || lastRaw !== null)) {
    return truncateSegs([mark, glyph, { text: shownRun }, staleBadge(suffix)], cols)
  }
  return truncateSegs([mark, glyph, { text: shownRun + suffix }], cols)
}

function foremanRowsOf(fm: ForemanView | null, wide: boolean, cols: number, nowMs: number, t: T): Row[] {
  const hasForeman = fm !== null && (fm.agents.length > 0 || fm.stage !== null)
  if (!hasForeman) {
    if (!wide) return []
    return [
      foremanRule(t),
      [{ text: '  ' }, { text: GLYPHS.state.pending + ' ', color: PALETTE.idle }, { text: t('page.dispatch.foreman_none'), dim: true }],
    ]
  }
  const out: Row[] = [foremanRule(t)]
  const indent = wide ? '  ' : ' '
  for (const g of fm.agents) {
    const sid = stateOf('run', { rc: g.ended ? 0 : null, final_status: null, stall: !g.ended && g.stale, fresh: !g.ended && !g.stale }).id
    const st = STATES[sid]
    const ageMs = g.at_ms !== null && nowMs > 0 ? Math.max(0, nowMs - g.at_ms) : g.age_s !== null ? g.age_s * 1000 : null
    const ageStr = ageMs === null ? null : fmtAgo(ageMs, wide, t)
    const name = g.description || g.id
    const meta = wide
      ? [g.label, ageStr, !g.ended && g.stale ? t('foreman.quiet') : null].filter((x): x is string => x !== null && x !== '')
      : [ageStr].filter((x): x is string => x !== null && x !== '')
    const sep = wide ? ' · ' : ' '
    const tail = meta.length === 0 ? '' : sep + meta.join(sep)
    out.push(truncateSegs([{ text: indent }, { text: st.glyph + ' ', ...(st.key === undefined ? {} : { color: st.key }) }, { text: name }, ...(tail === '' ? [] : [{ text: tail, dim: true }])], cols))
  }
  if (fm.stage !== null) {
    const stMs = fm.stage_at_ms !== null && nowMs > 0 ? Math.max(0, nowMs - fm.stage_at_ms) : fm.stage_age_s !== null ? fm.stage_age_s * 1000 : null
    const stAge = stMs === null ? GLYPHS.structure.empty : fmtAgo(stMs, wide, t)
    out.push(truncateSegs([{ text: indent }, { text: t('foreman.stage', { stage: fm.stage, age: stAge }), dim: true }], cols))
  }
  return out
}

export function dispatchView(ctx: PageCtx, view: DispatchView = DEFAULT_VIEW): { body: Row[]; actions: Row[] } {
  const { t, size } = ctx
  const cols = size.cols
  const wide = cols >= WIDE_COLS
  if (ctx.live === null) return { body: brokenRows(GLYPHS.state.failed + ' ' + t('page.dispatch.no_live'), cols), actions: [] }

  const live = ctx.live
  const stale = live.state !== 'ok'
  const body: Row[] = []
  if (stale) {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('page.dispatch.stale_live', { why: live.header }), cols))
    if (live.rows === null) return { body, actions: [] }
  } else if (live.rows === null) {
    return { body: brokenRows(GLYPHS.state.failed + ' ' + t('page.dispatch.no_runs'), cols), actions: [] }
  }

  const nowMs = ctx.nowMs > 0 ? ctx.nowMs : (live.detail.now_ms ?? 0)
  const ageRef = nowMs > 0 ? nowMs : null
  const running = classifyRuns(live.rows.filter(r => !r.ended))
  const finished = classifyRuns(live.rows.filter(r => r.ended && !runAgedOut(r, ageRef)))
  const fm = live.sections.foreman
  const hasForeman = fm !== null && (fm.agents.length > 0 || fm.stage !== null)

  if (running.length === 0 && finished.length === 0 && !hasForeman) {
    body.push([{ text: GLYPHS.state.pending + ' ', color: PALETTE.idle }, { text: t('page.dispatch.none'), dim: true }])
    return { body, actions: [] }
  }

  const shownFinished = ctx.shortBody === true || view.expanded ? finished : []
  const visibleTotal = running.length + shownFinished.length
  const focus = Math.max(0, Math.min(view.focus, Math.max(0, visibleTotal - 1)))
  let rowIdx = 0

  if (ctx.shortBody === true) {
    for (const item of running) body.push(drawRunRow(item, rowIdx++ === focus, false, wide, stale, cols, nowMs, t))
    for (const item of shownFinished) body.push(drawRunRow(item, rowIdx++ === focus, true, wide, stale, cols, nowMs, t))
    if (hasForeman) body.push(...foremanRowsOf(fm, wide, cols, nowMs, t).slice(1))
    return { body, actions: [] }
  }

  body.push(secRule(t('page.dispatch.sec_running', { n: running.length }), wide))
  if (running.length === 0) {
    body.push([{ text: wide ? '  ' : ' ' }, { text: GLYPHS.state.pending + ' ', color: PALETTE.idle }, { text: t('page.dispatch.foreman_none'), dim: true }])
  } else {
    if (wide) body.push(colHeaderRow(t))
    for (const item of running) body.push(drawRunRow(item, rowIdx++ === focus, false, wide, stale, cols, nowMs, t))
  }

  body.push(...foremanRowsOf(fm, wide, cols, nowMs, t))

  const doneLabel = finished.length === 0
    ? t('page.dispatch.sec_done_plain', { n: 0 })
    : view.expanded
      ? t('page.dispatch.sec_done_open', { n: finished.length })
      : t('page.dispatch.sec_done_folded', { n: finished.length })
  body.push(secRule(doneLabel, wide))
  if (finished.length === 0) {
    body.push([{ text: wide ? '  ' : ' ' }, { text: GLYPHS.state.pending + ' ', color: PALETTE.idle }, { text: t('page.dispatch.foreman_none'), dim: true }])
  } else if (view.expanded) {
    if (wide && running.length === 0) body.push(colHeaderRow(t))
    for (const item of finished) body.push(drawRunRow(item, rowIdx++ === focus, true, wide, stale, cols, nowMs, t))
  }

  const actions: Row[] = finished.length > 0
    ? [[{ text: t(view.expanded ? 'page.dispatch.act_fold' : 'page.dispatch.act_unfold'), color: PALETTE.action, press: 'key:z' }]]
    : []

  return { body, actions }
}

export const dispatchPage: Page = {
  id: 'dispatch',
  key: '3',
  title: '派工',
  framed: true,
  render: ctx => {
    const over = (ctx as DispatchCtx).dispatch
    return dispatchView(ctx, over === undefined ? DEFAULT_VIEW : { focus: over.focus ?? DEFAULT_VIEW.focus, expanded: over.expanded ?? DEFAULT_VIEW.expanded })
  },
}
