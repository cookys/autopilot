// mods/live/pages/review.ts — page 6 審查 of the live pane (plan r2 §2 row 6, §3.1, §3.2, §5).
// Pure view over ctx.live (review.code, detail.qc, detail.decisions, review.plan): fixed height via frameRows,
// colours and glyphs strictly via PALETTE / GLYPHS, stale or missing sources in red wrapped without truncation (A10),
// and `[z]` fold/unfold as a visible action-area Button bound to key `z` whenever proxy decisions exist (G11).
import type { CodeReviewView, DecisionRow, DecisionsView, LiveSnapshot, PlanReviewView, QcView, ReviewSeat, Seg } from '../model'
import { displayWidth, truncateToWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { STATES, stateOf, wrapPlain } from '../ui'
import type { Page, PageCtx } from './frame'
import { brokenRow } from './rows'
import type { Row } from './rows'

export type ReviewView = { focus: number; expanded: boolean }
export const DEFAULT_REVIEW_VIEW: ReviewView = { focus: 0, expanded: true }

const WIDE_COLS = 100
const HOUR_CAP = 14 * 24
const RULE = GLYPHS.structure.rule
const RULE2 = RULE + RULE

const seg = (text: string, extra: Partial<Seg> = {}): Seg => ({ text, ...extra })
const dimSeg = (text: string): Seg => ({ text, dim: true })
const widthOf = (segs: readonly Seg[]): number => segs.reduce((w, s) => w + displayWidth(s.text), 0)
const firstLine = (s: string): string => (s.split('\n').find(l => l.trim() !== '') ?? '').trim()

// A10: broken/stale source reasons wrap across rows and are never cut with `…`
const brokenRows = (text: string, cols: number): Row[] => wrapPlain(text, Math.max(8, cols), Math.max(8, cols)).map(l => brokenRow(l))

function truncateSegs(row: Row, cols: number): Row {
  if (cols <= 0) return [seg('')]
  if (widthOf(row) <= cols) return row
  const out: Row = []
  let used = 0
  for (const s of row) {
    const w = displayWidth(s.text)
    if (used + w <= cols) { out.push(s); used += w; continue }
    const room = cols - used
    if (room > 0) out.push({ ...s, text: truncateToWidth(s.text, room) })
    break
  }
  return out.length === 0 ? [seg('')] : out
}

function rightAlignSegs(left: Seg[], right: Seg[], cols: number, gap = 2): Row {
  const rw = widthOf(right)
  if (rw === 0) return truncateSegs(left, cols)
  if (cols <= rw + gap) return truncateSegs([...left, seg(' '), ...right], cols)
  const cut = truncateSegs(left, cols - gap - rw)
  const lw = widthOf(cut)
  return [...cut, seg(' '.repeat(Math.max(gap, cols - lw - rw))), ...right]
}

function longRule(label: string, wide: boolean, targetCols: number): Row {
  const sep = label.endsWith('）') ? '' : ' '
  if (!wide) return [seg(RULE2 + ' ' + label + sep + RULE2, { color: PALETTE.structure })]
  const prefix = RULE2 + ' ' + label + sep
  return [seg(prefix + RULE.repeat(Math.max(2, targetCols - displayWidth(prefix))), { color: PALETTE.structure })]
}

const shortRule = (label: string): Row => [seg(RULE2 + ' ' + label + ' ' + RULE2, { color: PALETTE.structure })]

function ageText(ctx: PageCtx, iso: string | null | undefined, compact: boolean): string {
  if (iso == null) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const sec = Math.max(0, Math.floor((ctx.nowMs - ms) / 1000))
  if (sec < 60) return compact ? ctx.t('page.review.age_s_s', { n: sec }) : ctx.t('page.review.age_s', { n: sec })
  const min = Math.floor(sec / 60)
  if (min < 60) return compact ? ctx.t('page.review.age_m_s', { n: min }) : ctx.t('page.review.age_m', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < HOUR_CAP) return compact ? ctx.t('page.review.age_h_s', { n: hr }) : ctx.t('page.review.age_h', { n: hr })
  const days = Math.floor(hr / 24)
  return compact ? ctx.t('page.review.age_d_s', { n: days }) : ctx.t('page.review.age_d', { n: days })
}

const isHexSha = (s: string): boolean => /^[0-9a-f]{7,40}$/i.test(s)

function qcHeadSha(q: QcView | null): string | null {
  if (q === null || q.range === null) return null
  const parts = q.range.split('..')
  const cand = (parts.length >= 2 ? parts[parts.length - 1] : parts[0]).trim()
  return isHexSha(cand) ? cand : null
}

function qcDisplaySha(q: QcView): string | null {
  if (q.range === null) return null
  const parts = q.range.split('..').map(p => p.trim())
  if (parts.length >= 2) {
    const rhs = parts[parts.length - 1]
    if (rhs !== '' && rhs !== 'HEAD' && rhs !== GLYPHS.structure.empty) return rhs.slice(0, 8)
    const lhs = parts[0]
    if (lhs !== '' && lhs !== 'HEAD' && lhs !== GLYPHS.structure.empty) return lhs.slice(0, 8)
    return null
  }
  const single = parts[0]
  return single !== '' && single !== 'HEAD' && single !== GLYPHS.structure.empty ? single.slice(0, 8) : null
}

function isHeadDifferent(c: CodeReviewView, q: QcView | null): boolean {
  const qHead = qcHeadSha(q)
  if (c.head !== null && qHead !== null && isHexSha(c.head)) {
    const n = Math.min(c.head.length, qHead.length, 7)
    if (n >= 4 && c.head.slice(0, n).toLowerCase() !== qHead.slice(0, n).toLowerCase()) return true
  }
  return c.converged && q?.state === 'owed'
}

function codeSeatLabel(s: ReviewSeat, seats: readonly ReviewSeat[]): string {
  if (s.family !== null && seats.filter(x => x.family === s.family).length === 1) return s.family
  return s.id
}

function codeRows(ctx: PageCtx, c: CodeReviewView, q: QcView | null, wide: boolean): Row[] {
  const cols = ctx.size.cols
  const out: Row[] = []
  if (!ctx.shortBody) out.push(longRule(wide ? ctx.t('page.review.sec_code') : ctx.t('page.review.sec_code_s'), wide, 55))
  const gen = c.generation ?? GLYPHS.structure.empty
  const sha = c.head !== null ? c.head.slice(0, 8) : c.base !== null ? c.base.slice(0, 8) : GLYPHS.structure.empty
  const diff = isHeadDifferent(c, q)
  if (wide) {
    const left: Seg[] = [
      seg(GLYPHS.structure.folded + ' ', { color: PALETTE.here }),
      seg(ctx.t('page.review.code_gen', { gen }) + ' ' + sha),
    ]
    for (const s of c.seats) {
      const st = STATES[stateOf('seat', { kind: 'code', verdict: s.verdict ?? null, status: s.status }).id]
      const token = s.verdict ?? s.status ?? GLYPHS.state.unknown
      left.push(seg(' · ' + codeSeatLabel(s, c.seats) + ' '), seg(token, st.wordKey === undefined ? {} : { color: st.wordKey }))
    }
    const age = ageText(ctx, c.at, false)
    const right: Seg[] = diff
      ? [seg(GLYPHS.state.need_you, { color: PALETTE.attention }), seg(' ' + (age !== '' ? ctx.t('page.review.head_diff_age', { age }) : ctx.t('page.review.head_diff')))]
      : age !== ''
        ? [dimSeg(age)]
        : []
    out.push(rightAlignSegs(left, right, cols))
    return out
  }
  const narrow: Seg[] = [
    seg(GLYPHS.structure.folded, { color: PALETTE.here }),
    seg('g' + String(gen) + ' ' + sha),
  ]
  for (const s of c.seats) {
    const st = STATES[stateOf('seat', { kind: 'code', verdict: s.verdict ?? null, status: s.status }).id]
    narrow.push(seg(' ' + codeSeatLabel(s, c.seats)), seg(st.glyph, st.key === undefined ? {} : { color: st.key }))
  }
  if (diff) narrow.push(seg(' '), seg(GLYPHS.state.need_you, { color: PALETTE.attention }), seg(ctx.t('page.review.head_diff_s')))
  else {
    const ageS = ageText(ctx, c.at, true)
    if (ageS !== '') narrow.push(dimSeg(' ' + ageS))
  }
  out.push(truncateSegs(narrow, cols))
  return out
}

function qcWord(ctx: PageCtx, q: QcView): string {
  if (q.state === 'ok') return ctx.t('page.review.qc_ok')
  if (q.state === 'owed') return q.protected_files_count > 0 ? ctx.t('page.review.qc_owed_n', { n: q.protected_files_count }) : ctx.t('page.review.qc_owed')
  if (q.state === 'not_needed') return ctx.t('page.review.qc_not_needed')
  return ctx.t('page.review.qc_unknown')
}

function qcRows(ctx: PageCtx, q: QcView, wide: boolean): Row[] {
  const cols = ctx.size.cols
  const st = STATES[stateOf('qc', q.state).id]
  const sha = qcDisplaySha(q)
  const word = qcWord(ctx, q)
  if (wide) {
    const out: Row[] = []
    if (!ctx.shortBody) out.push(shortRule(ctx.t('page.review.sec_qc')))
    out.push(truncateSegs([
      seg('  '),
      seg(st.glyph, st.key === undefined ? {} : { color: st.key }),
      seg(' ' + word + (sha !== null ? ' · ' + sha : '')),
    ], cols))
    return out
  }
  const tail = q.state === 'ok' && sha !== null
    ? ' ' + sha
    : ' ' + word + (sha !== null ? ' ' + sha : '')
  return [truncateSegs([
    ...(ctx.shortBody ? [] : [seg(RULE2 + ' ' + ctx.t('page.review.sec_qc_s') + ' ' + RULE2 + ' ', { color: PALETTE.structure })]),
    seg(st.glyph, st.key === undefined ? {} : { color: st.key }),
    seg(tail),
  ], cols)]
}

function sortDecisions(rows: readonly DecisionRow[]): DecisionRow[] {
  return rows
    .map((r, i) => {
      const ms = r.at != null ? Date.parse(r.at) : NaN
      return { r, score: (Number.isFinite(ms) ? ms : 0) * 1000 + Math.min(i, 999) }
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.r)
}

function decidedRows(ctx: PageCtx, dv: DecisionsView, folded: boolean, wide: boolean): { rows: Row[]; foldable: boolean } {
  const sorted = sortDecisions(dv.rows)
  const foldable = sorted.length > 0
  const n = Math.max(dv.count, sorted.length)
  if (!foldable && n <= 0) return { rows: [], foldable: false }
  const cols = ctx.size.cols
  const out: Row[] = []
  if (!ctx.shortBody) {
    const label = foldable
      ? wide
        ? (folded ? ctx.t('page.review.sec_decided_folded', { n }) : ctx.t('page.review.sec_decided_open', { n }))
        : (folded ? ctx.t('page.review.sec_decided_folded_s', { n }) : ctx.t('page.review.sec_decided_open_s', { n }))
      : wide
        ? ctx.t('page.review.sec_decided_plain', { n })
        : ctx.t('page.review.sec_decided_plain_s', { n })
    out.push(longRule(label, wide, 52))
  }
  if (foldable && !folded) {
    for (const r of sorted) {
      const id = r.decision_id !== null ? r.decision_id + ' ' : ''
      const summary = firstLine(r.decision)
      if (wide) {
        const age = ageText(ctx, r.at, false)
        out.push(rightAlignSegs([seg('  ' + id + summary)], age !== '' ? [dimSeg(age)] : [], cols))
      } else {
        const ageS = ageText(ctx, r.at, true)
        const leftText = id + summary
        if (ageS === '') out.push([seg(truncateToWidth(leftText, cols))])
        else {
          const suffix = ' ' + ageS
          const room = Math.max(4, cols - displayWidth(suffix))
          out.push([seg(truncateToWidth(leftText, room)), dimSeg(suffix)])
        }
      }
    }
  }
  return { rows: out, foldable }
}

function parsePlanIdentity(p: PlanReviewView, live: LiveSnapshot): { name: string; sha: string | null; verdictWord: string | null } {
  const rawId = p.logical_plan_id ?? live.detail.project ?? live.project_key ?? GLYPHS.structure.empty
  const idMatch = /^(.+)@([0-9a-f]{7,40})$/i.exec(rawId)
  const name = idMatch !== null ? idMatch[1] : rawId
  let sha: string | null = idMatch !== null ? idMatch[2].slice(0, 8) : null
  let verdictWord: string | null = null
  if (p.verdict !== null && p.verdict.trim() !== '') {
    const trimmed = p.verdict.trim()
    if (isHexSha(trimmed)) {
      if (sha === null) sha = trimmed.slice(0, 8)
    } else {
      const vm = /^(.*\S)\s+@?([0-9a-f]{7,40})$/i.exec(trimmed)
      if (vm !== null) {
        verdictWord = vm[1]
        if (sha === null) sha = vm[2].slice(0, 8)
      } else {
        verdictWord = trimmed
      }
    }
  }
  return { name, sha, verdictWord }
}

function planScoreCompact(seats: readonly ReviewSeat[]): string {
  if (seats.length === 0) return ''
  const vals = seats.map(s => (s.status ?? s.verdict ?? '').trim())
  if (vals.every(v => /^\d+$/.test(v))) return vals.join('/')
  const back = vals.filter(v => v !== '' && !/^(pending|running)$/i.test(v)).length
  return String(back) + '/' + String(seats.length)
}

function planRows(ctx: PageCtx, p: PlanReviewView, live: LiveSnapshot, wide: boolean): Row[] {
  const cols = ctx.size.cols
  const { name, sha, verdictWord } = parsePlanIdentity(p, live)
  if (wide) {
    const out: Row[] = []
    if (!ctx.shortBody) out.push(shortRule(ctx.t('page.review.sec_plan')))
    const seats = p.seats
      .map(s => {
        const v = (s.status ?? s.verdict ?? '').trim()
        return v !== '' ? s.id + ' ' + v : s.id
      })
      .join(' · ')
    const statusBase = p.terminal ? ctx.t('page.review.plan_frozen') : (verdictWord ?? ctx.t('page.review.plan_open'))
    const statusFull = statusBase + (sha !== null ? ' ' + sha : '')
    const parts = [name + ' ' + ctx.t('page.review.code_gen', { gen: p.generation }), ...(seats !== '' ? [seats] : []), statusFull]
    out.push(truncateSegs([seg('  ' + parts.join(' · '))], cols))
    return out
  }
  const statusShort = p.terminal ? ctx.t('page.review.plan_frozen_s') : (verdictWord ?? ctx.t('page.review.plan_open_s'))
  const score = planScoreCompact(p.seats)
  const summary = [sha ?? name, statusShort, score].filter(s => s !== '').join(' ')
  return [truncateSegs([
    ...(ctx.shortBody ? [] : [seg(RULE2 + ' ' + ctx.t('page.review.sec_plan_s') + ' ' + RULE2 + ' ', { color: PALETTE.structure })]),
    seg(summary),
  ], cols)]
}

export function renderReview(ctx: PageCtx, view: ReviewView = DEFAULT_REVIEW_VIEW): { body: Row[]; actions: Row[] } {
  const cols = ctx.size.cols
  const live = ctx.live
  const unknownActions = (): Row[] => [[dimSeg(ctx.t('frame.unknown'))]]
  if (live === null) {
    return { body: brokenRows(GLYPHS.state.failed + ' ' + ctx.t('page.review.no_live'), cols), actions: unknownActions() }
  }
  const wide = cols >= WIDE_COLS
  const folded = !view.expanded
  const body: Row[] = []
  const liveBroken = live.state !== 'ok'
  if (liveBroken) {
    const why = live.header.trim() !== '' ? live.header : live.state
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + ctx.t('page.review.stale_live', { why }), cols))
  }
  const code = live.review?.code ?? null
  const qc = live.detail.qc ?? null
  const decisions = live.detail.decisions ?? null
  const plan = live.review?.plan ?? null

  if (code !== null) body.push(...codeRows(ctx, code, qc, wide))
  if (qc !== null) body.push(...qcRows(ctx, qc, wide))

  let foldable = false
  const decisionsMissing = decisions === null && live.sections?.decisionsNotWired === true
  if (decisions !== null) {
    const dec = decidedRows(ctx, decisions, folded, wide)
    body.push(...dec.rows)
    foldable = dec.foldable
  } else if (decisionsMissing) {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + ctx.t('page.review.decisions_not_wired'), cols))
  }

  if (plan !== null) body.push(...planRows(ctx, plan, live, wide))

  if (body.length === 0) {
    body.push([seg(GLYPHS.state.pending + ' ', { color: PALETTE.idle }), dimSeg(ctx.t('page.review.empty'))])
  }

  const actions: Row[] = foldable
    ? [[seg(folded ? ctx.t('page.review.act_unfold') : ctx.t('page.review.act_fold'), { color: PALETTE.action, press: 'key:z' })]]
    : liveBroken || decisionsMissing
      ? unknownActions()
      : []

  return { body, actions }
}

export const reviewPage: Page = {
  id: 'review',
  key: '4',
  title: '審查',
  framed: true,
  render: ctx => renderReview(ctx),
}
