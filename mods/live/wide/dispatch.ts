// mods/live/wide/dispatch.ts — console v5 wide page 3 派工 (P4a): pure projection from existing dispatch runs.
import { GLYPHS } from '../../tux/glyphs'

export type WideDispatchItem = {
  state: 'running' | 'failed' | 'done'
  label: string
  engine: string
  dur: string
  runId?: string
  branch?: string
  startedAt?: string
  commits?: number
  lastCommitAt?: string
  fleetTask?: string
  summary?: string
  nextStep?: string
}

export type WideDispatchInput = {
  items: WideDispatchItem[]
  cursor: number
  recentRounds: string[]
  stale: boolean
  missing: boolean
}

export type WideDispatchOutput = {
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

export function wideDispatchSummary(i: Pick<WideDispatchInput, 'items' | 'missing'>): string | null {
  if (i.missing) return null
  const r = i.items.filter(x => x.state === 'running').length
  const f = i.items.filter(x => x.state === 'failed').length
  const d = i.items.filter(x => x.state === 'done').length
  return `執行中 ${r} 輪 · 失敗 ${f} 輪 · 完成 ${d} 輪`
}

export function wideDispatch(i: WideDispatchInput): WideDispatchOutput {
  const running = i.items.filter(x => x.state === 'running')
  const failed = i.items.filter(x => x.state === 'failed')
  const done = i.items.filter(x => x.state === 'done')

  const stepTitle = i.missing
    ? '缺源'
    : i.stale
      ? '過時'
      : i.items.length === 0
        ? '沒有派工'
        : '正常'

  const list: string[] = []
  if (i.items.length === 0) {
    list.push(i.missing ? '讀不到派工資料。' : '目前沒有派工輪次。')
  } else {
    let idx = 0
    const pushGroup = (title: string, group: WideDispatchItem[]) => {
      if (group.length === 0) return
      list.push(`${title} ${group.length} 輪`)
      for (const item of group) {
        const mark = idx === i.cursor ? GLYPHS.structure.folded : ' '
        list.push(`${mark} ${item.label} · ${item.engine} · ${item.dur}`)
        idx++
      }
    }
    pushGroup('執行中', running)
    pushGroup('失敗', failed)
    pushGroup('完成', done)
  }

  const cur = i.items[Math.max(0, Math.min(i.items.length - 1, i.cursor))] ?? null
  const reply: string[] = []
  if (cur !== null) {
    if (cur.summary) reply.push(cur.summary)
    else reply.push(`${cur.label} · ${cur.engine} · ${cur.dur}`)
    if (cur.nextStep) reply.push(cur.nextStep)
  } else {
    reply.push(i.missing ? '讀不到派工來源。' : '目前沒有進行中的派工。')
  }

  const pin: string[] = []
  if (cur !== null) {
    if (cur.runId) pin.push(`run ${cur.runId} · ${cur.engine}`)
    if (cur.startedAt || cur.branch) pin.push(`${cur.startedAt ? `${cur.startedAt} 開始；` : ''}${cur.branch ? `分支 ${cur.branch}` : ''}`)
    if (cur.commits !== undefined) pin.push(`已 commit ${cur.commits} 次${cur.lastCommitAt ? `；最後一次 ${cur.lastCommitAt}` : ''}`)
    if (cur.fleetTask) pin.push(`Fleet-Task ${cur.fleetTask}`)
  }

  return {
    stepTitle,
    list,
    reply,
    hints: 'j/k 換筆 · o 展開 · Esc 關閉',
    pin,
    ctx: [],
    hist: i.recentRounds.length > 0 ? { title: '今天結束的輪次', rows: i.recentRounds } : null,
    events: null,
    summary: wideDispatchSummary(i),
  }
}
