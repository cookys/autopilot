// mods/live/pages/review.ts — page 4 審查 (ux-v7.4 S5): every review row on one page (branch/sha, per-engine verdict, round), then 推送前檢查, then 我替你決定的事.
// Pure view over ctx.live (review.code, detail.qc, detail.decisions, review.plan): fixed height via frameRows,
// colours and glyphs strictly via PALETTE / GLYPHS, stale or missing sources in red wrapped without truncation (A10),
// Enter (view.expanded) folds the decided rows; there is no action-area Button (S5 has none).
import type { CodeReviewView, DecisionRow, DecisionsView, LiveSnapshot, PlanReviewView, QcView, ReviewSeat, Seg } from '../model'
import type { KReviewCandidate } from '../v74/contract'
import { DEFAULT_VALID_FOR_S, TRACE_STALE_MIN, TRACE_STALE_MS, displayWidth, liveAgeMs, truncateToWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { STATES, stateOf, wrapPlain } from '../ui'
import type { Page, PageCtx } from './frame'
import { brokenRow } from './rows'
import type { Row } from './rows'

export type ReviewView = { focus: number; expanded: boolean }
export const DEFAULT_REVIEW_VIEW: ReviewView = { focus: 0, expanded: true }

const HOUR_CAP = 14 * 24
const RULE = GLYPHS.structure.rule

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

function isHeadDifferent(c: CodeReviewView, q: QcView | null): boolean {
  const qHead = qcHeadSha(q)
  if (c.head !== null && qHead !== null && isHexSha(c.head)) {
    const n = Math.min(c.head.length, qHead.length, 7)
    if (n >= 4 && c.head.slice(0, n).toLowerCase() !== qHead.slice(0, n).toLowerCase()) return true
  }
  return c.converged && q?.state === 'owed'
}

function seatLabel(s: ReviewSeat, seats: readonly ReviewSeat[]): string {
  if (s.family !== null && s.family !== '' && seats.filter(x => x.family === s.family).length === 1) return s.family
  return s.id
}

// one review row: `<label>  <X 引擎 VERDICT>  <Y 引擎 VERDICT>  · 第 N 輪`; a seat's verdict word is the producer's own (verdict, else status)
function reviewRow(ctx: PageCtx, label: string, seats: readonly ReviewSeat[], kind: 'code' | 'plan', gen: number | string, tail: Seg[]): Row {
  const out: Seg[] = [seg(' ' + label + '  ')]
  for (const s of seats) {
    const st = STATES[stateOf('seat', { kind, verdict: s.verdict ?? null, status: s.status }).id]
    const word = (s.verdict ?? '') !== '' ? (s.verdict as string) : (s.status ?? GLYPHS.state.unknown)
    const name = seatLabel(s, seats)
    const suffix = ctx.t('v74.e.rv_engine', { name: '' }).trim()
    out.push(seg((name.trimEnd().endsWith(suffix) ? name : ctx.t('v74.e.rv_engine', { name })) + ' '), seg(word, st.wordKey === undefined ? {} : { color: st.wordKey }), seg('  '))
  }
  out.push(seg('· ' + ctx.t('v74.e.rv_round', { n: gen })), ...tail)
  return truncateSegs(out, ctx.size.cols)
}

function codeLabel(c: CodeReviewView): string {
  if (c.branch?.trim()) return c.branch
  return c.head !== null && c.head !== '' ? c.head.slice(0, 8) : c.base !== null && c.base !== '' ? c.base.slice(0, 8) : GLYPHS.structure.empty
}

function qcWord(ctx: PageCtx, q: QcView): string {
  if (q.state === 'ok') return ctx.t('page.review.qc_ok')
  if (q.state === 'owed') return q.protected_files_count > 0 ? ctx.t('page.review.qc_owed_n', { n: q.protected_files_count }) : ctx.t('page.review.qc_owed')
  if (q.state === 'not_needed') return ctx.t('page.review.qc_not_needed')
  return ctx.t('page.review.qc_unknown')
}

function sectionRule(label: string, cols: number): Row {
  const head = GLYPHS.structure.open + ' ' + label + ' '
  return [seg(head, { color: PALETTE.idle }), seg(RULE.repeat(Math.max(2, cols - displayWidth(head) - 2)), { color: PALETTE.structure })]
}

function ageDuration(t: PageCtx['t'], ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t('page.now.age_s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('page.now.age_m', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('page.now.age_h', { n: h }) : t('page.now.age_d', { n: Math.floor(h / 24) })
}

function qcRows(ctx: PageCtx, q: QcView, qcAt?: string | null): Row[] {
  const cols = ctx.size.cols
  const st = STATES[stateOf('qc', q.state).id]
  const files = q.protected_files_count > 0 ? ctx.t('v74.e.qc_files_n', { n: q.protected_files_count }) : ctx.t('v74.e.qc_files_none')
  const qcAge = ageText(ctx, qcAt, false)
  const qcHead = ctx.t('v74.e.rv_qc', { word: qcWord(ctx, q) }) + (qcAge === '' ? '' : ' · ' + qcAge)
  return [
    sectionRule(qcHead, cols),
    truncateSegs([seg('   ' + ctx.t('v74.e.qc_range') + ' '), seg(q.range ?? GLYPHS.structure.empty)], cols),
    truncateSegs([seg('   ' + ctx.t('v74.e.qc_files') + ' '), seg(files, st.key === undefined || q.state === 'ok' || q.state === 'not_needed' ? {} : { color: st.key })], cols),
  ]
}

// 候選教訓 (fleet 01M8ARXSD4): one row per pending knowledge-review candidate; the focused row takes the ‣ cursor and a/x decide it.
// Glyph rule: ‣ (U+2023, EAW=N, width=1) is the active cursor, ▸ stays reserved for folded sections (decide.ts glyph usage).
const KR_CURSOR = '‣'
function kreviewRows(ctx: PageCtx, cands: readonly KReviewCandidate[], focusRaw: number): Row[] {
  const cols = ctx.size.cols
  // the list can shrink between keystrokes (a/x decided one); the cursor must stay on a real row
  const focus = Math.max(0, Math.min(focusRaw, cands.length - 1))
  const out: Row[] = [sectionRule(ctx.t('v74.e.kr_title', { n: cands.length }), cols)]
  cands.forEach((r, i) => {
    const meta = [r.pitfall, r.solution].filter(s => s !== '').join(GLYPHS.structure.answer)
    const src = [r.tool, r.repo].filter(s => s !== '').join('@')
    const tail: Seg[] = [
      ...(meta !== '' ? [seg(' · '), dimSeg(meta)] : []),
      ...(src !== '' ? [seg(' · '), dimSeg(src)] : []),
      ...(r.count > 1 ? [seg(' ·×'), seg(String(r.count), { color: PALETTE.idle })] : []),
    ]
    const mark = i === focus ? seg(KR_CURSOR + ' ', { color: PALETTE.idle }) : seg('  ')
    out.push(truncateSegs([mark, seg(r.topic), ...tail], cols))
  })
  return out
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

function decidedRows(ctx: PageCtx, dv: DecisionsView, folded: boolean): Row[] {
  const sorted = sortDecisions(dv.rows)
  const n = Math.max(dv.count, sorted.length)
  if (sorted.length === 0 && n <= 0) return []
  const cols = ctx.size.cols
  const out: Row[] = [sectionRule(ctx.t('v74.e.rv_decided', { n }), cols)]
  if (!folded) {
    for (const r of sorted) {
      const age = ageText(ctx, r.at, false)
      const left = [seg(' '), seg(GLYPHS.state.done, { color: PALETTE.attention }), seg(' ' + (r.decision_id !== null ? r.decision_id + ' ' : '') + firstLine(r.decision))]
      out.push(truncateSegs(age === '' ? left : [...left, dimSeg('  · ' + age)], cols))
    }
  }
  return out
}

function parsePlanIdentity(p: PlanReviewView, live: LiveSnapshot): { name: string; sha: string | null; verdictWord: string | null } {
  const rawId = p.logical_plan_id ?? live.detail.project ?? live.project_key ?? GLYPHS.structure.empty
  const idMatch = /^(.+)@([0-9a-f]{7,40})$/i.exec(rawId)
  const name = p.branch?.trim() ? p.branch : idMatch !== null ? idMatch[1] : rawId
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

export function renderReview(ctx: PageCtx, view: ReviewView = DEFAULT_REVIEW_VIEW): { body: Row[]; actions: Row[] } {
  const cols = ctx.size.cols
  const live = ctx.live
  const unknownActions = (): Row[] => [[dimSeg(ctx.t('frame.unknown'))]]
  if (live === null) {
    return { body: brokenRows(GLYPHS.state.failed + ' ' + ctx.t('page.review.no_live'), cols), actions: unknownActions() }
  }
  const body: Row[] = []
  const ageMs = liveAgeMs(live, ctx.nowMs)
  const liveBroken = live.state !== 'ok'
  const liveAgeOver = !liveBroken && ageMs !== null && ageMs > TRACE_STALE_MS
  if (liveBroken) {
    const why = live.header.trim() !== '' ? live.header : live.state
    const thresh = ageMs !== null
      ? ctx.t('trace.age_threshold', { age: ageDuration(ctx.t, ageMs), limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S })
      : ctx.t('trace.threshold_only', { limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S })
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + ctx.t('page.review.stale_live', { why }) + ' · ' + thresh, cols))
  } else if (liveAgeOver) {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + ctx.t('trace.review_age_stale', { age: ageDuration(ctx.t, ageMs), limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S }), cols))
  }
  const code = live.review?.code ?? null
  const qc = live.detail.qc ?? null
  const decisions = live.detail.decisions ?? null
  const plan = live.review?.plan ?? null

  const reviewRows: Row[] = []
  if (code !== null) {
    const diff = isHeadDifferent(code, qc)
    const codeAge = ageText(ctx, code.at, false)
    const tail: Seg[] = [
      ...(codeAge === '' ? [] : [dimSeg(' · ' + codeAge)]),
      ...(diff ? [seg('  '), seg(GLYPHS.state.need_you, { color: PALETTE.attention }), seg(' ' + ctx.t('page.review.head_diff'))] : []),
    ]
    reviewRows.push(reviewRow(ctx, codeLabel(code), code.seats, 'code', code.generation ?? GLYPHS.structure.empty, tail))
  }
  if (plan !== null) {
    const { name, verdictWord } = parsePlanIdentity(plan, live)
    const planAge = ageText(ctx, plan.updated_at, false)
    const tail: Seg[] = [
      ...(planAge === '' ? [] : [dimSeg(' · ' + planAge)]),
      ...(plan.terminal ? [seg('  '), dimSeg(ctx.t('page.review.plan_frozen'))] : verdictWord !== null ? [seg('  '), dimSeg(verdictWord)] : []),
    ]
    reviewRows.push(reviewRow(ctx, name, plan.seats, 'plan', plan.generation, tail))
  }
  if (reviewRows.length > 0) body.push(sectionRule(ctx.t('v74.e.rv_code', { n: reviewRows.length }), cols), ...reviewRows)

  const showMissingQc = qc === null && (ctx.v74 !== undefined || ctx.box === true)
  if (qc !== null) body.push(...qcRows(ctx, qc, live.detail.qc_at))
  else if (showMissingQc) {
    const qcFile = (live.project_key ?? '<project_key>') + '.qc.json'
    const qcWhy = ctx.t('trace.review_qc_missing', { file: qcFile })
    body.push(sectionRule(ctx.t('v74.c.sec_qc_missing'), cols), ...brokenRows(GLYPHS.state.failed + ' ' + qcWhy, cols))
  }

  const decisionsMissing = decisions === null && live.sections?.decisionsNotWired === true
  if (decisions !== null) body.push(...decidedRows(ctx, decisions, !view.expanded))
  else if (decisionsMissing) body.push(...brokenRows(GLYPHS.state.failed + ' ' + ctx.t('page.review.decisions_not_wired'), cols))

  const kr = ctx.v74?.kreview
  const krErr = ctx.v74?.kreviewError ?? null
  const krMissing = kr === null && krErr !== null
  const krDrawn = kr !== null && kr !== undefined && kr.length > 0
  if (krDrawn) body.push(...kreviewRows(ctx, kr, view.focus))
  else if (krMissing) body.push(...brokenRows(GLYPHS.state.failed + ' ' + ctx.t('v74.e.kr_missing', { why: krErr }), cols))

  if (body.length === 0) body.push([seg(GLYPHS.state.pending + ' ', { color: PALETTE.idle }), dimSeg(ctx.t('page.review.empty'))])

  // the a/x decision keys ride a visible action Button (`[a] …` hint → hotkey, pane.tsx drawRow); no block, no keys
  const krActions: Row[] = krDrawn ? [[
    { text: '[a] ' + ctx.t('v74.e.kr_ok') + '  ', press: 'key:a' },
    { text: '[x] ' + ctx.t('v74.e.kr_no'), press: 'key:x' },
  ]] : []

  return { body, actions: krActions.length > 0 ? krActions : liveBroken || liveAgeOver || decisionsMissing || showMissingQc || krMissing ? unknownActions() : [] }
}

export const reviewPage: Page = {
  id: 'review',
  key: '4',
  title: '審查',
  framed: true,
  render: ctx => renderReview(ctx),
}
