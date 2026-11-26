// mods/live/wide/fleet.ts — console v5 wide 7 艦隊 page. Pure: console lines + speedview.agentsColumn -> WideBand fields & pane summary.
import type { ConsoleLine } from '../console'
import type { T } from '../i18n'
import { rowsOf as fleetRowsOf } from '../pages/fleet'
import { consoleFleetCounts } from '../pages/rows'
import type { Step } from '../speed'
import { agentsColumn } from '../speedview'
import { GLYPHS } from '../../tux/glyphs'
import type { WidePageOut } from './types'

export type WideFleetInput = {
  lines: ConsoleLine[] | null
  steps: readonly Step[]
  nowMs: number
  t: T
  focus: number
  stale?: boolean
  counts?: ReturnType<typeof consoleFleetCounts> | null // from the caller's full console snapshot (consoleFleetCounts needs more than the lines)
}

const FOLDED = GLYPHS.structure.folded

export function wideFleet(inp: WideFleetInput): WidePageOut {
  const { lines, steps, nowMs, t, focus, stale } = inp
  const agents = agentsColumn(steps, nowMs, t, 36)
  const agentLines = agents.lines.slice(2).map(segs => segs.map(s => s.text).join('').trim())
  const rows = lines !== null ? fleetRowsOf(lines, t) : null

  if (rows === null && steps.length === 0) {
    return {
      stepTitle: '缺源',
      list: ['讀不到艦隊與速度資料'],
      reply: ['無法讀取 fleet lines 與 agent tok/s。'],
      hints: 'Esc 關閉',
      summary: null,
      hist: null,
    }
  }

  const list: string[] = []
  const details: string[][] = []

  if (rows !== null) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const mark = r.sid === 'failed' ? GLYPHS.state.failed : r.sid === 'running' ? GLYPHS.state.running : GLYPHS.state.waiting
      const prefix = i === focus ? FOLDED : ' '
      list.push(`${prefix} ${mark} ${r.line.label} · ${r.word}`)
      details.push([
        `${r.line.label}（${r.word}）`,
        ...(r.line.lead_display ? [r.line.lead_display] : []),
        ...(r.worst?.message ? [r.worst.message] : []),
      ])
    }
  }

  if (steps.length > 0) {
    for (const al of agentLines) {
      const idx = details.length
      const prefix = idx === focus ? FOLDED : ' '
      list.push(`${prefix} ${al}`)
      details.push([al])
    }
  }

  if (list.length === 0) {
    return {
      stepTitle: '沒有 agent',
      list: ['目前沒有執行中的 agent'],
      reply: ['沒有活躍的產線或 agent。'],
      hints: 'Esc 關閉',
      summary: '沒有 agent',
      hist: null,
    }
  }

  const cur = details[Math.max(0, Math.min(details.length - 1, focus))] ?? ['']
  const counts = inp.counts ?? null
  const summary = counts !== null ? `執行 ${counts.running} · 失敗 ${counts.failed} · ${GLYPHS.state.waiting} ${counts.stuck}` : null

  return {
    stepTitle: stale ? '過時' : '正常',
    list,
    reply: cur,
    hints: 'j/k 換筆 · o 展開 · Esc 關閉',
    summary,
    hist: null,
  }
}
