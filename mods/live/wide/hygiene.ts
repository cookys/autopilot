// mods/live/wide/hygiene.ts — console v5 wide 6 殘留 page. Pure: snapshot.detail.residue + load_source -> WideBand fields & pane summary.
import type { LoadSourceView, ResidueView } from '../model'
import { GLYPHS } from '../../tux/glyphs'
import type { WidePageOut } from './types'

export type WideHygieneInput = {
  residue: ResidueView | null
  loadSource: LoadSourceView | null
  focus: number
  stale?: boolean
}

const FOLDED = GLYPHS.structure.folded

export function wideHygiene(inp: WideHygieneInput): WidePageOut {
  const { residue, loadSource, focus, stale } = inp
  if (residue === null && loadSource === null) {
    return {
      stepTitle: '缺源',
      list: ['讀不到殘留資料'],
      reply: ['無法讀取 residue 與 load_source。'],
      hints: 'Esc 關閉',
      summary: null,
      hist: null,
    }
  }
  const human = residue?.needs_human ?? []
  const autoN = (residue?.auto_removed_count ?? 0) + (residue?.auto_archived_count ?? 0)
  const flags = loadSource?.flags ?? []
  const list: string[] = []
  const items: { label: string; detail: string[] }[] = []

  list.push(`要你處理 ${human.length}`)
  for (const h of human) {
    const name = h.branch?.trim() || h.target
    const label = `${h.kind} ${name}`.trim()
    const idx = items.length
    items.push({
      label,
      detail: [
        `${label}${h.reason ? `：${h.reason}` : ''}`,
        ...(h.command ? [`人工處理：${h.command}`] : []),
        '看完確定不要，再自己移除（這頁只看不刪）。',
      ],
    })
    list.push(`${idx === focus ? FOLDED : ' '} ${label}`)
  }

  list.push(`自動清理 ${autoN}`)
  if (autoN > 0) {
    const idx = items.length
    const detail = `已移除 ${residue?.auto_removed_count ?? 0} 個 worktree，歸檔 ${residue?.auto_archived_count ?? 0} 個分支`
    items.push({ label: detail, detail: [detail] })
    list.push(`${idx === focus ? FOLDED : ' '} ${detail}`)
  }

  list.push(`外掛載入 ${flags.length}`)
  if (flags.length > 0) {
    for (const f of flags) {
      const idx = items.length
      items.push({ label: f, detail: [`外掛載入異常：${f}`] })
      list.push(`${idx === focus ? FOLDED : ' '} ${f}`)
    }
  } else if (loadSource !== null) {
    list.push(`  來源：${loadSource.source}`)
  }

  const cur = items[Math.max(0, Math.min(items.length - 1, focus))]
  const stepTitle = stale ? '過時' : items.length === 0 ? '沒有殘留' : '正常'
  const summary = residue === null ? null : human.length === 0 && autoN === 0 ? '沒有殘留' : `要你處理 ${human.length} · 自動清理 ${autoN}`

  return {
    stepTitle,
    list,
    reply: cur ? cur.detail : ['目前沒有需要處理的殘留項目。'],
    hints: items.length > 0 ? 'j/k 換筆 · o 展開 · Esc 關閉' : 'Esc 關閉',
    summary,
    hist: null,
  }
}
