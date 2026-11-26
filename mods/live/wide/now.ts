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
  const stepTitle = i.missingPm && i.missingConsole
    ? '缺源（pm 和 console 都讀不到）'
    : i.missingPm
      ? '缺源（pm 讀不到）'
      : i.stale
        ? '過時'
        : '正常'

  const list = [
    '要你處理',
    `${GLYPHS.structure.folded} 待決 ${n(i.pending)} 張 · 動手 ${n(i.act)} 張`,
    `  殘留 ${n(i.residue)} 項`,
    '艦隊',
    `  產線 ${n(i.fleetTotal)}：執行 ${n(i.running)} · 失敗 ${n(i.failed)} · 等 ${n(i.stalled)}`,
    '本席與審查',
    `  本席 ctx ${i.ctxPct === null ? '—' : `${i.ctxPct}%`} · QC 欠審 ${n(i.qcOwed)}`,
  ]

  const reply: string[] = []
  if (i.pending !== null && i.pending > 0) {
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

  const pin: string[] = []
  if (i.pmUpdatedAt !== null) {
    pin.push(`pm status ${i.pmUpdatedAt} 更新${i.pmAge !== null ? `（${i.pmAge}）` : ''}。`)
  }
  if (i.fleetTotal !== null) {
    pin.push(`艦隊 ${i.fleetTotal} 條產線：執行 ${n(i.running)}、失敗 ${n(i.failed)}、卡住 ${n(i.stalled)}。`)
  }
  if (i.failedNames.length > 0) {
    pin.push(`失敗：${i.failedNames.join('、')}。`)
  }
  if (i.ctxPct !== null || i.sessionTokens !== null) {
    pin.push(`本席 ctx ${i.ctxPct === null ? '—' : `${i.ctxPct}%`}，本 session ${i.sessionTokens ?? '—'} tokens。`)
  }
  if (i.qcOwed !== null || i.proxyDecided !== null) {
    pin.push(`QC 欠審 ${n(i.qcOwed)} 條；代理決策 ${n(i.proxyDecided)} 條（今天）。`)
  }

  return {
    stepTitle,
    list,
    reply,
    hints: 'j/k 換段 · o 展開 · 2 去待決 · Esc 關閉',
    pin,
    ctx: [],
    hist: i.recentDone.length > 0 ? { title: '今天結束的事', rows: i.recentDone } : null,
    events: null,
    summary: wideNowSummary(i),
  }
}
