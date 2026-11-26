// mods/live/wide/review.ts — console v5 wide page 4 審查 (P4a): pure projection from existing review / qc / decisions data.
import { GLYPHS } from '../../tux/glyphs'
import { wrapReply } from './wrap'

export type WideReviewItem = {
  label: string
  engine: string
  verdict: string
  detail?: string
  note?: string
  range?: string
  rounds?: string[]
}

export type WideReviewInput = {
  items: WideReviewItem[]
  cursor: number
  qcOwed: number | null
  qcTarget: string | null
  decidedCount: number | null
  decidedSummary: string | null
  recentReviews: string[]
  stale: boolean
  missing: boolean
  // design states beyond the plain rows (P5a); all optional
  label?: string // the state label of the title when it is not 正常 / 過時 / 缺源 / 沒有審查
  qcNote?: string // after the QC row, e.g. `（20 分鐘前）`
  decisions?: string[] // the decisions log as rows (09:41 合併 ...): when no review rows exist the list is this log, the cursor walks it
  narrative?: string[] // the source's own words for the reply column; absent = built from the focused review
  detail?: string[] // the context rows the source gives; absent = built from the focused review
  warnings?: string[] // fixed warning rows (source missing / stale)
}

export type WideReviewOutput = {
  stepTitle: string
  list: string[]
  reply: string[]
  hints: string
  pin: string[]
  ctx: string[]
  hist: { title: string; rows: string[] } | null
  events: string[] | null
  summary: string | null
}

const n = (v: number | null): string => (v === null ? '—' : String(v))

export function wideReviewSummary(i: Pick<WideReviewInput, 'qcOwed' | 'decidedCount' | 'missing'>): string | null {
  if (i.missing && i.qcOwed === null && i.decidedCount === null) return null
  return `欠審 ${n(i.qcOwed)} · 我替你決定的事 ${n(i.decidedCount)}`
}

export function wideReview(i: WideReviewInput): WideReviewOutput {
  const stepTitle = i.label ?? (i.missing
    ? '缺源'
    : i.stale
      ? '過時'
      : i.items.length === 0 && (i.qcOwed ?? 0) === 0
        ? '沒有審查'
        : '正常')

  const list: string[] = []
  const log = i.decisions ?? []
  if (i.missing && i.items.length === 0 && i.qcOwed === null && i.decidedCount === null) {
    list.push('程式碼審查', '  審查讀不到', 'QC', '  QC 讀不到', '我替你決定的事', '  決策讀不到')
  } else if (log.length > 0 && i.items.length === 0) {
    list.push(`我替你決定的事 ${n(i.decidedCount)}`)
    log.forEach((row, idx) => list.push(`${idx === i.cursor ? GLYPHS.structure.folded : ' '} ${row}`))
  } else {
    list.push('程式碼審查')
    if (i.items.length === 0) list.push('  今天還沒有審查')
    i.items.forEach((item, idx) => {
      const mark = idx === i.cursor ? GLYPHS.structure.folded : ' '
      list.push(`${mark} ${item.label} · ${item.engine} ${item.verdict}`)
    })
    list.push('QC')
    if (i.qcOwed === null) list.push('  QC 讀不到')
    else list.push(i.qcOwed === 0 ? '  沒有欠審' : `  欠審 ${i.qcOwed}${i.qcTarget ? `：${i.qcTarget}` : ''}${i.qcNote ?? ''}`)
    if (i.decidedCount !== null) {
      list.push(`我替你決定的事 ${i.decidedCount}`)
      if (i.decidedSummary) list.push(`  ${i.decidedSummary}`)
    }
  }

  const cur = i.items[Math.max(0, Math.min(i.items.length - 1, i.cursor))] ?? null
  const reply: string[] = []
  if (i.narrative !== undefined) {
    reply.push(...i.narrative.flatMap(wrapReply))
  } else if (cur !== null) {
    reply.push(cur.detail ?? `${cur.label}：${cur.engine} ${cur.verdict}。`)
    if (cur.note) reply.push(cur.note)
  } else {
    reply.push(i.missing ? '讀不到審查來源。' : i.qcOwed === 0 ? '今天還沒有審查紀錄，QC 也沒有欠審。' : i.qcOwed === null ? '今天還沒有審查紀錄，QC 讀不到。' : '今天還沒有審查紀錄。')
  }

  const ctx: string[] = []
  if (i.detail !== undefined) {
    ctx.push(...i.detail)
  } else if (cur !== null) {
    if (cur.range) ctx.push(`審查範圍 ${cur.range}。`)
    if (cur.rounds) ctx.push(...cur.rounds)
  }

  return {
    stepTitle,
    list,
    reply,
    hints: i.missing && cur === null && log.length === 0 ? 'Esc 關閉' : 'j/k 換筆 · o 展開 · Esc 關閉',
    pin: i.warnings ?? [],
    ctx,
    hist: i.recentReviews.length > 0 ? { title: '今天的審查紀錄', rows: i.recentReviews } : null,
    events: null,
    summary: wideReviewSummary(i),
  }
}
