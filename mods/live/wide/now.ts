// mods/live/wide/now.ts — console v5 wide page 1 現況 (P4a): pure projection from existing snapshot / pm / console / quota data.
import { GLYPHS } from '../../tux/glyphs'

export type WideNowInput = {
  pending: number | null
  act: number | null
  residue: number | null
  fleetTotal: number | null
  running: number | null
  failed: number | null
  stalled: number | null
  ctxPct: number | null
  sessionTokens: string | null
  qcOwed: number | null
  proxyDecided: number | null
  oldestPendingAge: string | null
  oldestPendingQuestion: string | null
  pmUpdatedAt: string | null
  pmAge: string | null
  failedNames: string[]
  recentDone: string[]
  stale: boolean
  missingPm: boolean
  missingConsole: boolean
  // design states beyond the plain counts (P5a); all optional, absent = the plain form
  focus?: 'pending' | 'fleet' // which list row carries the ▸ (default the pending row)
  fleetNote?: string // after the 艦隊 heading, e.g. `（改用 console）`, `（12 分鐘前）`
  ctxNote?: string // after the ctx figure, e.g. `（12 分鐘前）`
  laneBusy?: number | null // the fleetSummary fallback: lanes busy / idle replace the 產線 row
  laneIdle?: number | null
  label?: string // the state label the title shows when it is not one of the four sources states
  narrative?: string[] // the pm status's own words for the reply column; absent = built from the counts
  detail?: string[] // the context rows the source gives (failure reasons, per-line lists); absent = built from the counts
  warnings?: string[] // fixed warning rows (source missing / stale), drawn above the context
}

export type WideNowOutput = {
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

export function wideNowSummary(i: Pick<WideNowInput, 'pending' | 'act' | 'residue' | 'missingPm' | 'missingConsole'>): string | null {
  if (i.missingPm && i.missingConsole && i.pending === null) return null
  return `待決 ${n(i.pending)} · 動手 ${n(i.act)} · 殘留 ${n(i.residue)} 項`
}

export function wideNow(i: WideNowInput): WideNowOutput {
  const stepTitle = i.label ?? (i.missingPm && i.missingConsole
    ? '缺源（pm 和 console 都讀不到）'
    : i.missingPm
      ? '缺源（pm 讀不到）'
      : i.stale
        ? '過時'
        : '正常')

  const fleetFocus = i.focus === 'fleet'
  const mark = (on: boolean): string => (on ? GLYPHS.structure.folded : ' ')
  const nothingToDo = i.pending === 0 && i.residue === 0
  const fleetParts = [
    i.running !== null ? `執行 ${i.running}` : null,
    i.failed !== null ? `失敗 ${i.failed}` : null,
    i.stalled !== null ? `等 ${i.stalled}` : null,
  ].filter((x): x is string => x !== null)
  const fleetLine = i.laneBusy != null && i.laneIdle != null
    ? `lane ${i.laneBusy + i.laneIdle}：忙 ${i.laneBusy} · 閒 ${i.laneIdle}`
    : i.fleetTotal !== null && i.failed === 0 && i.stalled === 0 && i.running === i.fleetTotal
      ? `產線 ${i.fleetTotal}：全部執行中`
      : `產線 ${n(i.fleetTotal)}：${fleetParts.join(' · ')}`
  const qc = i.qcOwed === null ? '' : ` · QC ${i.qcOwed === 0 ? '全過' : `欠審 ${i.qcOwed}`}`
  const ctxLine = i.ctxPct === null && i.qcOwed === null
    ? '  本席、QC 讀不到'
    : `  本席 ctx ${i.ctxPct === null ? '—' : `${i.ctxPct}%`}${i.ctxNote ?? ''}${qc}`

  const list = [
    '要你處理',
    ...(nothingToDo
      ? [`${mark(!fleetFocus)} 沒有待決 · 沒有殘留`]
      : [`${mark(!fleetFocus)} 待決 ${n(i.pending)} 張 · 動手 ${n(i.act)} 張`, `  殘留 ${n(i.residue)} 項`]),
    `艦隊${i.fleetNote ?? ''}`,
    `${mark(fleetFocus)} ${fleetLine}`,
    '本席與審查',
    ctxLine,
  ]

  const reply: string[] = []
  if (i.narrative !== undefined) {
    reply.push(...i.narrative)
  } else if (i.pending !== null && i.pending > 0) {
    reply.push(`待決 ${i.pending} 張要你選${i.act !== null && i.act > 0 ? `，另有 ${i.act} 張要先動手做完再選` : ''}。`)
    if (i.oldestPendingQuestion !== null) {
      reply.push(`${i.oldestPendingAge !== null ? `最舊的一張開了 ${i.oldestPendingAge}：` : ''}${i.oldestPendingQuestion}`)
    }
    reply.push('按 2 到待決頁作答；按 o 展開這一段的清單。')
  } else if (i.missingPm && i.missingConsole) {
    reply.push('pm 與 console 都讀不到資料。')
  } else {
    reply.push('目前沒有待決事項。')
  }

  const ctx: string[] = []
  if (i.detail !== undefined) {
    ctx.push(...i.detail)
  } else {
    if (i.pmUpdatedAt !== null) {
      ctx.push(`pm status ${i.pmUpdatedAt} 更新${i.pmAge !== null ? `（${i.pmAge}）` : ''}。`)
    }
    if (i.fleetTotal !== null) {
      ctx.push(`艦隊 ${i.fleetTotal} 條產線：執行 ${n(i.running)}、失敗 ${n(i.failed)}、卡住 ${n(i.stalled)}。`)
    }
    if (i.failedNames.length > 0) {
      ctx.push(`失敗：${i.failedNames.join('、')}。`)
    }
    if (i.ctxPct !== null || i.sessionTokens !== null) {
      ctx.push(`本席 ctx ${i.ctxPct === null ? '—' : `${i.ctxPct}%`}，本 session ${i.sessionTokens ?? '—'} tokens。`)
    }
    if (i.qcOwed !== null || i.proxyDecided !== null) {
      ctx.push(`QC 欠審 ${n(i.qcOwed)} 條；代理決策 ${n(i.proxyDecided)} 條（今天）。`)
    }
  }

  return {
    stepTitle,
    list,
    reply,
    hints: 'j/k 換段 · o 展開 · 2 去待決 · Esc 關閉',
    pin: i.warnings ?? [],
    ctx,
    hist: i.recentDone.length > 0 ? { title: '今天結束的事', rows: i.recentDone } : null,
    events: null,
    summary: wideNowSummary(i),
  }
}
