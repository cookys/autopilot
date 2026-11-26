// mods/live/wide/band.ts - console v5 wide band (P1 skeleton): 17 rows x 115 columns, drawn from a plain model. Pure, no host calls.
// Rows (design gen_wide_all.py compose()): 1 top frame (left `<n> <page> · list`, right step title, `[-]` fold at the right), 2-13 two columns split at column 38
// (list left, reply right), 14 divider, 15 global status, 16 nine page tabs, 17 bottom frame carrying the page's key hints and always ending `Tab 換頁`.
// The list and reply rows are whatever the page already has (P3/P4 re-skin them); over 12 rows the last one reads `…` (P2 moves the rest to the pane).
import { GLYPHS } from '../../tux/glyphs'
import { displayWidth } from '../../tux/width'
import { BAND_BODY_ROWS, BAND_COLS, BAND_LIST_COLS, BAND_REPLY_COLS, BAND_ROWS } from './geometry'

export type WideRole = 'frame' | 'text' | 'fold' | 'current' // what a piece is; tree.tsx maps each to a PALETTE role
export type WideSpan = { col: number; width: number; role: WideRole }
export type WideModel = {
  page: number // 1..9, the current page
  tabs: string[] // the nine page names
  stepTitle: string
  list: string[] // list-column rows, already text
  reply: string[] // reply-column rows, already text
  status: string // the global status text
  hints: string // the page's key hints; `Tab 換頁` is appended when missing
}
export type WideSeg = { text: string; role: WideRole }
export type WideBand = { rows: string[]; roles: WideSpan[][]; segs: WideSeg[][] } // segs: each row cut into same-role pieces, for the drawing

export const WIDE_TABS = ['現況', '待決', '派工', '審查', '花費', '殘留', '艦隊', '待辦', '說明'] // the nine pages, keys 1..9 (P3 moves the words into the locale tables)
export const WIDE_TAB_HINT = 'Tab 換頁'
const STUCK_WORD = '卡住' // never drawn in the band (operator R7): a stalled line is the `⋯` mark
const ELLIPSIS = '…'
// the frame glyphs as code points: the glyph lint (L2) keeps drawing characters out of mod sources except tux/glyphs.ts
const F = { h: '\u2500', v: '\u2502', tl: '\u256D', tr: '\u256E', bl: '\u2570', br: '\u256F', down: '\u252C', up: '\u2534', right: '\u251C', left: '\u2524' }
const FOLD = '[-]'

type Seg = [string, WideRole]
const w = (s: string): number => displayWidth(s)

// cut to a display width (a CJK glyph is 2); the cut shows `…` as its last cell
export function clipTo(s: string, width: number): string {
  if (w(s) <= width) return s
  let out = ''
  for (const ch of s) {
    if (w(out) + w(ch) > width - 1) break
    out += ch
  }
  return out + ELLIPSIS
}
const padTo = (s: string, width: number): string => s + ' '.repeat(Math.max(0, width - w(s)))
const fill = (n: number): string => F.h.repeat(Math.max(0, n))

// at most `n` rows; more than that: the first n-1 and a last row `…`
export function limitRows(rows: string[], n: number): string[] {
  return rows.length <= n ? rows : [...rows.slice(0, n - 1), ELLIPSIS]
}

export function wideStatusText(s: { verdict: string; running: number | null; failed: number | null; stalled: number | null; pending: number | null; act: number | null; tps: number | null; spark: string | null; labels: { fleet: string; pending: string; act: string } }): string {
  const n = (v: number | null): string => (v === null ? '—' : String(v))
  const speed = s.tps === null ? 'ϟ —' : `ϟ ${s.tps} tok/s${s.spark === null || s.spark === '' ? '' : ' ' + s.spark}`
  const g = GLYPHS.state // the design draws the running dot as a plain circle (East Asian Width A); the repo's glyph table has the width-safe one
  return `${g.running} ${s.verdict} ${F.v} ${s.labels.fleet} ${g.running} ${n(s.running)} ${g.failed} ${n(s.failed)} ${g.waiting} ${n(s.stalled)} ${F.v} ${s.labels.pending} ${n(s.pending)} · ${s.labels.act} ${n(s.act)} ${F.v} ${speed}`
}

export function wideBand(m: WideModel): WideBand {
  const rows: string[] = []
  const roles: WideSpan[][] = []
  const segs: WideSeg[][] = []
  const push = (parts: Seg[]): void => {
    let col = 0
    const spans: WideSpan[] = []
    let text = ''
    const segs0: WideSeg[] = []
    for (const [t, role] of parts) {
      const width = w(t)
      if (width > 0) { spans.push({ col, width, role }); segs0.push({ text: t, role }) }
      text += t
      col += width
    }
    rows.push(text)
    roles.push(spans)
    segs.push(segs0)
  }
  const last = BAND_COLS - 1 // 114
  const left = clipTo(`${m.page} ${m.tabs[m.page - 1] ?? ''} · 清單`, BAND_LIST_COLS - 6)
  const leftTitle = ` ${left} `
  const rightRoom = last - 5 - (BAND_LIST_COLS + 2) - 2 // between the title start (col 40) and the fold button's left edge
  const rightTitle = ` ${clipTo(m.stepTitle, rightRoom)} `
  // top: ╭─ <title> ───┬─ <step> ───[-]──╮
  push([
    [F.tl + F.h, 'frame'], [leftTitle, 'text'], [fill(BAND_LIST_COLS - 2 - w(leftTitle)), 'frame'],
    [F.down + F.h, 'frame'], [rightTitle, 'text'], [fill(last - 5 - (BAND_LIST_COLS + 2) - w(rightTitle)), 'frame'],
    [FOLD, 'fold'], [F.h + F.h + F.tr, 'frame'],
  ])
  const list = limitRows(m.list, BAND_BODY_ROWS)
  const reply = limitRows(m.reply, BAND_BODY_ROWS)
  for (let i = 0; i < BAND_BODY_ROWS; i++) {
    const a = padTo(clipTo(list[i] ?? '', BAND_LIST_COLS - 2), BAND_LIST_COLS - 2) // columns 2-37
    const b = padTo(clipTo(reply[i] ?? '', BAND_REPLY_COLS), BAND_REPLY_COLS + 1) // columns 40-113 (113 stays blank)
    push([[F.v + ' ', 'frame'], [a, 'text'], [F.v, 'frame'], [' ' + b, 'text'], [F.v, 'frame']])
  }
  push([[F.right + fill(BAND_LIST_COLS - 1) + F.up + fill(last - BAND_LIST_COLS - 1) + F.left, 'frame']])
  const inner = BAND_COLS - 4 // text columns 2-112; column 113 is blank
  const status = m.status.split(STUCK_WORD).join(GLYPHS.state.waiting)
  push([[F.v + ' ', 'frame'], [padTo(clipTo(status, inner), inner), 'text'], [' ' + F.v, 'frame']])
  // tabs: `1 現況  2 待決 ...`, the current page in warning
  const tabSegs: Seg[] = [[F.v + ' ', 'frame']]
  let used = 0
  m.tabs.forEach((name, i) => {
    const t = `${i + 1} ${name}`
    const sep = i === 0 ? '' : '  '
    tabSegs.push([sep, 'text'], [t, i + 1 === m.page ? 'current' : 'text'])
    used += w(sep) + w(t)
  })
  tabSegs.push([' '.repeat(Math.max(0, inner - used)), 'text'], [' ' + F.v, 'frame'])
  push(tabSegs)
  const hints = m.hints.endsWith(WIDE_TAB_HINT) ? m.hints : m.hints === '' ? WIDE_TAB_HINT : `${m.hints} · ${WIDE_TAB_HINT}`
  // keep the fixed ending when the hints are too long: cut the front part, never the end
  const room = BAND_COLS - 6 // `╰─ ` + hints + ` ` + at least one `─` + `╯`
  const head = hints.slice(0, hints.length - WIDE_TAB_HINT.length)
  const shown = w(hints) <= room ? hints : clipTo(head, room - w(WIDE_TAB_HINT)) + WIDE_TAB_HINT
  const foot = ` ${shown} `
  push([[F.bl + F.h, 'frame'], [foot, 'text'], [fill(BAND_COLS - 3 - w(foot)) + F.br, 'frame']])
  if (rows.length !== BAND_ROWS) throw new Error('wide band: ' + rows.length + ' rows')
  return { rows, roles, segs }
}
