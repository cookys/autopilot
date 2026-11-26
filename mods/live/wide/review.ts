// mods/live/wide/review.ts — console v5 wide page 4 審查 (P4a): pure projection from existing review / qc / decisions data.
import { GLYPHS } from '../../tux/glyphs'

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
  const stepTitle = i.missing
    ? '缺源'
    : i.stale
      ? '過時'
      : i.items.length === 0 && (i.qcOwed ?? 0) === 0
        ? '沒有審查'
        : '正常'

  const list: string[] = []
  if (i.items.length === 0 && i.qcOwed === null && i.decidedCount === null) {
    list.push(i.missing ? '讀不到審查資料。' : '目前沒有審查紀錄。')
  } else {
    if (i.items.length > 0) {
      list.push('程式碼審查')
      i.items.forEach((item, idx) => {
        const mark = idx === i.cursor ? GLYPHS.structure.folded : ' '
        list.push(`${mark} ${item.label} · ${item.engine} ${item.verdict}`)
      })
    }
    if (i.qcOwed !== null) {
      list.push('QC')
      list.push(`  欠審 ${i.qcOwed}${i.qcTarget ? `：${i.qcTarget}` : ''}`)
    }
    if (i.decidedCount !== null) {
      list.push(`我替你決定的事 ${i.decidedCount}`)
      if (i.decidedSummary) list.push(`  ${i.decidedSummary}`)
    }
  }

  const cur = i.items[Math.max(0, Math.min(i.items.length - 1, i.cursor))] ?? null
  const reply: string[] = []
  if (cur !== null) {
    reply.push(cur.detail ?? `${cur.label}：${cur.engine} ${cur.verdict}。`)
    if (cur.note) reply.push(cur.note)
  } else {
    reply.push(i.missing ? '讀不到審查來源。' : '目前沒有進行中的審查。')
  }

  const pin: string[] = []
  if (cur !== null) {
    if (cur.range) pin.push(`審查範圍 ${cur.range}。`)
    if (cur.rounds) pin.push(...cur.rounds)
  }

  return {
    stepTitle,
    list,
    reply,
    hints: 'j/k 換筆 · o 展開 · Esc 關閉',
    pin,
    ctx: [],
    hist: i.recentReviews.length > 0 ? { title: '今天的審查紀錄', rows: i.recentReviews } : null,
    events: null,
    summary: wideReviewSummary(i),
  }
}
