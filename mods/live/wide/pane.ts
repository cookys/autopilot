// mods/live/wide/pane.ts - console v5 wide pane (P2): the docked pane at 93 columns x 42 rows, drawn from a plain model. Pure, no host calls.
// Design: gen_wide_all.py compose() "right pane". Rows: 0 top frame (`<n> <page> · detail`), 1-30 the read-only upper half (PANE_TOP_N), 31 blank,
// 32 `其他頁`, 33-40 one summary row per other page (pressable, digit keys), 41 bottom frame (key hints). Text starts at column 2, 89 wide.
// The upper half is filled in order: moved steps, list continuation, pin, the context (one folded row, `e` opens it), the fleet lanes, the page's history, the local events.
// A cuttable block (history, events) takes the rows that are left; it is placed when at least PANE_MIN_CUT row fits (design fill(): `room < 1`; P5a golden 1-L / 4-M / 9-L show a one-row history).
import { GLYPHS } from '../../tux/glyphs'
import { displayWidth } from '../../tux/width'
import { clipTo, F } from './band'
import { PANE_BODY_COLS } from './geometry'

export const PANE_ROWS = 42 // the host's height at 209x49: from the top down to the prompt area
export const PANE_TOP_N = 30 // rows 1-30 are the read-only half; row 31 stays blank
export const PANE_INNER = PANE_BODY_COLS - 4 // 89: text columns 2-90
export const PANE_MIN_CUT = 1 // a cuttable block is placed only when at least this many of its rows fit (the design's fill() code; its docstring says 3, its screens show 1)
export const PANE_OTHERS_ROW = 32 // `其他頁`; the eight summaries follow on rows 33-40

export type PaneRole = 'frame' | 'text' | 'dim' | 'key' | 'ok' | 'err' | 'warn' | 'action' // action = PALETTE.action (remember); `warn` is attention yellow, which fails light-256 contrast
export type PaneSeg = { text: string; role: PaneRole }
export type PaneLane = { state: 'running' | 'failed' | 'waiting'; name: string; speed: string; task: string; ev?: string; next?: string } // ev + next: the 7 艦隊 form
export type PaneModel = {
  page: number // 1..9
  tabs: string[] // the nine page names
  moved: string[] // reply steps that did not fit in the band (band.ts overflow.reply)
  more: string[] // list rows that did not fit in the band (band.ts overflow.list): shown under `清單（續）`
  pin: string[] // always-shown fixed lines of the page
  ctx: string[] // the context (來龍去脈) rows
  ctxFold: boolean // the page folds its context (the design does this on 2 待決)
  ctxOpen: boolean // `e` has opened it
  lanes: PaneLane[] | null // null = no source: the block is left out
  lanesHead: string
  meter?: { head: string; rows: { text: string; role: PaneRole }[] } | null // page 5: the 計量覆蓋 block, drawn in place of the lanes (which are then left out)
  hist: { title: string; rows: string[] } | null // the page's own history of finished things
  events: string[] | null // local events, newest first
  summaries: (string | null)[] // nine entries by page; null = no data, drawn `無`; the current page's is never drawn
}
export type PaneClick = { row: number; page: number }
export type WidePane = { rows: string[]; segs: PaneSeg[][]; clicks: PaneClick[] }

type Row = [string, PaneRole][]
const w = (s: string): number => displayWidth(s)
const padTo = (s: string, width: number): string => s + ' '.repeat(Math.max(0, width - w(s)))
const fill = (n: number): string => F.h.repeat(Math.max(0, n))
export const PANE_NO_DATA = '無'
export const PANE_KEY_HINT = '數字鍵 跳到那一頁 · e 展開來龍去脈'
const LANE_MARK: Record<PaneLane['state'], [string, PaneRole]> = { running: [GLYPHS.state.running, 'ok'], failed: [GLYPHS.state.failed, 'err'], waiting: [GLYPHS.state.waiting, 'warn'] }

const laneRow = (l: PaneLane): Row => {
  const [mark, role] = LANE_MARK[l.state]
  if (l.ev !== undefined) { // 89 columns: name 14 · speed 18 · latest 32 · next step
    return [['  ', 'text'], [mark, role], [' ' + padTo(l.name, 13), 'dim'], [padTo(l.speed, 18), 'dim'], [padTo(l.ev, 32), 'dim'], [GLYPHS.structure.answer + ' ' + (l.next ?? ''), 'text']]
  }
  return [['  ', 'text'], [mark, role], [' ' + padTo(l.name, 13), 'dim'], [padTo(l.speed, 20), 'dim'], [l.task, 'dim']]
}
const plain = (xs: string[], role: PaneRole = 'text'): Row[] => xs.map(x => [[x, role]])

// the upper half: the blocks in order, the cuttable ones to the rows that are left (design fill())
export function paneUpper(m: PaneModel): Row[] {
  const top: Row[] = []
  const add = (head: string, rows: Row[], cut: boolean): void => {
    if (rows.length === 0) return
    const room = PANE_TOP_N - top.length - (top.length > 0 ? 2 : 1)
    if (cut ? room < PANE_MIN_CUT : room < rows.length) return
    const take = rows.slice(0, room)
    if (top.length > 0) top.push([])
    top.push([[head, 'text']])
    top.push(...take)
  }
  top.push(...plain(m.moved))
  if (m.more.length > 0) top.push([['清單（續）', 'dim']], ...plain(m.more), [])
  top.push(...plain(m.pin))
  if (m.ctxFold && !m.ctxOpen) top.push([[`來龍去脈 ${m.ctx.length} 列 · 收起`, 'dim']])
  else {
    if (m.ctxFold) top.push([[`來龍去脈 ${m.ctx.length} 列 · 展開`, 'dim']])
    top.push(...plain(m.ctx))
  }
  const fixed = top.slice(0, PANE_TOP_N)
  top.length = 0
  top.push(...fixed)
  if (m.meter != null) add(m.meter.head, m.meter.rows.map((r): Row => [[r.text, r.role]]), false)
  else if (m.lanes !== null) add(m.lanesHead, m.lanes.map(laneRow), false)
  if (m.hist !== null) {
    const rows = plain(m.hist.rows.map(x => '  ' + x), 'dim')
    const room = PANE_TOP_N - top.length - (top.length > 0 ? 2 : 1)
    add(`${m.hist.title} · 最近 ${Math.min(rows.length, Math.max(0, room))} 筆`, rows, true)
  }
  if (m.events !== null) {
    const rows = plain(m.events.map(x => '  ' + x), 'dim')
    const room = PANE_TOP_N - top.length - (top.length > 0 ? 2 : 1)
    add(`本機事件 · 最近 ${Math.min(rows.length, Math.max(0, room))} 筆`, rows, true)
  }
  return top
}

export function widePane(m: PaneModel): WidePane {
  const rows: string[] = []
  const segs: PaneSeg[][] = []
  const clicks: PaneClick[] = []
  const push = (parts: [string, PaneRole][]): void => {
    rows.push(parts.map(p => p[0]).join(''))
    segs.push(parts.filter(p => w(p[0]) > 0).map(p => ({ text: p[0], role: p[1] })))
  }
  const inner = (parts: Row): void => { // `│ ` + 89 columns + ` │`
    const cut: Row = []
    let used = 0
    for (const [t, role] of parts) {
      const room = PANE_INNER - used
      const c = clipTo(t, room)
      cut.push([c, role])
      used += w(c)
      if (w(t) > room) break
    }
    push([[F.v + ' ', 'frame'], ...cut, [' '.repeat(PANE_INNER - used) + ' ' + F.v, 'frame']])
  }
  const title = ` ${m.page} ${m.tabs[m.page - 1] ?? ''} · 詳情 `
  push([[F.tl + F.h, 'frame'], [title, 'text'], [fill(PANE_BODY_COLS - 3 - w(title)) + F.tr, 'frame']])
  const upper = paneUpper(m)
  for (let y = 0; y < PANE_OTHERS_ROW - 1; y++) inner(upper[y] ?? [])
  inner([['其他頁', 'dim']])
  let y = PANE_OTHERS_ROW + 1
  m.tabs.forEach((name, i) => {
    const k = i + 1
    if (k === m.page) return
    inner([[`${k} ${name}`, 'key'], ['  ' + (m.summaries[i] ?? PANE_NO_DATA), 'dim']])
    clicks.push({ row: y, page: k })
    y++
  })
  const foot = ` ${PANE_KEY_HINT} `
  push([[F.bl + F.h, 'frame'], [foot, 'text'], [fill(PANE_BODY_COLS - 3 - w(foot)) + F.br, 'frame']])
  if (rows.length !== PANE_ROWS) throw new Error('wide pane: ' + rows.length + ' rows')
  return { rows, segs, clicks }
}
