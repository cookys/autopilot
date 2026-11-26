// mods/live/wide/hygiene.ts — console v5 wide 6 殘留 page. Pure: snapshot.detail.residue + load_source -> WideBand fields & pane summary.
import type { LoadSourceView, ResidueView } from '../model'
import { GLYPHS } from '../../tux/glyphs'
import type { WidePageOut } from './types'

export type WideHygieneInput = {
  residue: ResidueView | null
  loadSource: LoadSourceView | null
  focus: number
  stale?: boolean
  // design states beyond the plain rows (P5a); all optional
  label?: string // the state label of the title when it is not 正常 / 過時 / 缺源 / 沒有殘留
  humanNote?: string // after the 要你處理 heading, e.g. `（2 小時前）`
  autoHeader?: string // the 自動清理 heading when it carries no count
  autoRows?: string[] // what the auto cleanup did, one row each; absent = the counts line
  loadRows?: string[] // the plugin load rows; absent = the flags / the source
  loadHeader?: string // the 外掛載入 heading when loadSource is unreadable
  recent?: string[] // today's auto-cleaned things, newest first (the pane's history)
  narrative?: string[] // the source's own words for the reply column; absent = built from the focused item
  detail?: string[] // the context rows the source gives
  warnings?: string[] // fixed warning rows (source missing / stale)
}

const FOLDED = GLYPHS.structure.folded

const KIND: Record<string, string> = { worktree: 'worktree', branch: '分支', stash: 'stash' }

export function wideHygiene(inp: WideHygieneInput): WidePageOut {
  const { residue, loadSource, focus, stale } = inp
  const extra = { pin: inp.warnings ?? [], ctx: inp.detail ?? [], hist: inp.recent !== undefined && inp.recent.length > 0 ? { title: '最近自動清理的', rows: inp.recent } : null }
  if (residue === null && loadSource === null) {
    return {
      stepTitle: '缺源',
      list: ['讀不到殘留資料'],
      reply: ['無法讀取 residue 與 load_source。'],
      hints: 'Esc 關閉',
      summary: null,
      hist: null,
      ...extra,
    }
  }
  const human = residue?.needs_human ?? []
  const autoN = (residue?.auto_removed_count ?? 0) + (residue?.auto_archived_count ?? 0)
  const flags = loadSource?.flags ?? []
  const list: string[] = []
  const items: { label: string; detail: string[] }[] = []

  list.push(residue === null ? '要你處理' : `要你處理 ${human.length}${inp.humanNote ?? ''}`)
  if (residue === null) list.push('  殘留讀不到')
  if (residue !== null && human.length === 0) list.push('  沒有殘留')
  for (const h of human) {
    const name = h.branch?.trim() || h.target
    const label = `${KIND[h.kind] ?? h.kind} ${name}`.trim()
    const idx = items.length
    items.push({
      label,
      detail: [
        `${label}${h.reason ? `：${h.reason}` : ''}`,
        ...(h.command ? [`人工處理：${h.command}`] : []),
        '看完確定不要，再自己移除（這頁只看不刪）。',
      ],
    })
    list.push(`${idx === focus ? FOLDED : ' '} ${label}${h.reason ? `（${h.reason}）` : ''}`)
  }

  if (residue !== null) {
    if (inp.autoRows !== undefined) {
      list.push(inp.autoHeader ?? `自動清理 ${inp.autoRows.length}`)
      for (const r of inp.autoRows) list.push(`  ${r}`)
    } else {
      list.push(`自動清理 ${autoN}`)
      if (autoN > 0) {
        const idx = items.length
        const detail = `已移除 ${residue.auto_removed_count} 個 worktree，歸檔 ${residue.auto_archived_count} 個分支`
        items.push({ label: detail, detail: [detail] })
        list.push(`${idx === focus ? FOLDED : ' '} ${detail}`)
      }
    }
  }

  if (inp.loadRows !== undefined) {
    list.push(`外掛載入 ${inp.loadRows.length}`)
    for (const r of inp.loadRows) list.push(`  ${r}`)
  } else if (loadSource === null && inp.loadHeader !== undefined) {
    list.push(inp.loadHeader, '  外掛載入讀不到')
  } else if (loadSource !== null) {
    list.push(`外掛載入 ${flags.length}`)
    if (flags.length > 0) {
      for (const f of flags) {
        const idx = items.length
        items.push({ label: f, detail: [`外掛載入異常：${f}`] })
        list.push(`${idx === focus ? FOLDED : ' '} ${f}`)
      }
    } else {
      list.push(`  來源：${loadSource.source}`)
    }
  }

  const cur = items[Math.max(0, Math.min(items.length - 1, focus))]
  const stepTitle = inp.label ?? (residue === null ? '缺源' : stale ? '過時' : human.length === 0 && flags.length === 0 ? '沒有殘留' : '正常')
  const summary = residue === null ? null : human.length === 0 && autoN === 0 ? '沒有殘留' : `要你處理 ${human.length} · 自動清理 ${autoN}`

  return {
    stepTitle,
    list,
    reply: inp.narrative ?? (cur ? cur.detail : ['目前沒有需要處理的殘留項目。']),
    hints: 'j/k 換筆 · o 展開 · Esc 關閉',
    summary,
    ...extra,
  }
}
