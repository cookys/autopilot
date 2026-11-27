// mods/live/shell.ts — the O4 band shell, pure half (panel-band contract 2026-11-06): the width tiers, the frame geometry,
// transitional usage columns (readLegacyUsage from panel.ts), and the right-hand summary columns. No engine value in here and no JSX: band.tsx draws what this file plans.
// Syntax is erasable and every runtime import carries `.ts`, so `node --test` can load this file (shell.test.js).
// Colours: only PALETTE roles (ui.ts) as text colour; no background, no inverse, no bold. One colour, one meaning: main window `here`, other windows `idle`, dividers `structure`.

import type { Seg } from './model.ts'
import { STALE_MS, readLegacyUsage } from './panel.ts'
import type { PanelLine, PanelRead, SideData, Tiers } from './panel.ts'
import { GLYPHS } from '../tux/glyphs.ts'
import { PALETTE } from '../tux/palette.ts'
import { displayWidth } from '../tux/width.ts'
import { wrapPlain } from './ui.ts'

// ---- tiers (contract 1.1): written on bodyColumns, the width the band is handed. Not derived from the terminal width. The tab row's own 160/120/80 table (model.ts layoutBand) is
// another thing: neither refers to the other. ----
export type Tier = 240 | 200 | 160 | 120 | 80
export const TIER_AT: readonly (readonly [number, Tier])[] = [[235, 240], [195, 200], [155, 160], [115, 120]]
export function bandTier(bodyColumns: number): Tier {
  for (const [min, tier] of TIER_AT) if (bodyColumns >= min) return tier
  return 80
}

// ---- geometry (contract 1.2): the left column is 26 wide at every tier, the main window starts at the same column and grows to the right up to 76 ----
export const SHELL_ROWS = 12 // menu row, top frame, BODY_ROWS body rows, bottom frame, quick row (ux-v7: the progress row moved inside the main window)
// r4: the host gives the band what is left of half the terminal (49 rows with a status line: 17 to 19), so the shell takes the rows it gets: SHELL_ROWS at most, SHELL_MIN_ROWS at least
// (menu row, top frame, 2 body rows, bottom frame, quick row). From COMPACT_BELOW rows up the main window keeps its divider and progress row; under it the body is content only.
export const SHELL_MIN_ROWS = 6
export const COMPACT_BELOW = 9
export const isCompact = (rows: number): boolean => rows < COMPACT_BELOW
// the main window's content rows (no divider, no progress row) that `rows` band rows leave: the menu row, two frames and the quick row take 4; the divider and the progress row 2 more when kept
export const shellContentRows = (rows: number): number => Math.max(1, isCompact(rows) ? rows - 4 : rows - 6)
export const BODY_ROWS = 8 // the main window's last two rows are the divider ├─┤ and the progress row; the six above are its content
export const MAIN_CONTENT_ROWS = BODY_ROWS - 2
export const LEFT_COLS = 26 // the left FRAME spans columns 0–25; the drawn inner text is two cells narrower so a gap can sit at column 26
export const MAIN_MAX = 76
export const MAIN_MIN = 30
export const SHELL_MENUS = ['d', 'r', 'u', 'p', 'h'] as const
export type ShellMenuId = typeof SHELL_MENUS[number]
export function nextShellMenu(id: ShellMenuId): ShellMenuId {
  const at = SHELL_MENUS.indexOf(id)
  return SHELL_MENUS[(at + 1) % SHELL_MENUS.length]
}
export type ColId = 'roomUsage' | 'room' | 'usage' | 'fleet'
export type RightCol = { id: ColId; inner: number }
const RIGHT: Record<Tier, readonly RightCol[]> = {
  80: [],
  120: [{ id: 'roomUsage', inner: 32 }],
  160: [{ id: 'roomUsage', inner: 50 }],
  200: [{ id: 'room', inner: 44 }, { id: 'usage', inner: 45 }],
  240: [{ id: 'room', inner: 42 }, { id: 'usage', inner: 42 }, { id: 'fleet', inner: 44 }],
}
export type Geometry = { tier: Tier; left: number; main: number; right: readonly RightCol[] }
// null: the band is too narrow for a main window of MAIN_MIN cells; the caller keeps the tab-row layout
// `noRight`: the 待決 card view has no right-hand summary columns (the roundtable and the usage have their own tabs): the main window takes every cell the left list leaves, with no MAIN_MAX cap
export function shellGeometry(bodyColumns: number, noRight = false): Geometry | null {
  const tier = bandTier(bodyColumns)
  const right = noRight ? [] : RIGHT[tier]
  const fixed = right.length + 3 + LEFT_COLS + right.reduce((a, c) => a + c.inner, 0) // one vertical line per window edge
  const main = noRight ? bodyColumns - fixed : Math.min(MAIN_MAX, bodyColumns - fixed)
  if (!(main >= MAIN_MIN)) return null
  return { tier, left: LEFT_COLS, main, right }
}

// ---- the panel reader lives in panel.ts (tux-guidelines L19): shell.ts uses the transitional readLegacyUsage() exit only ----
const clean = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '')
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// the largest tier whose key is not wider than the column's inner width; null when none fits (a column is never given a line made for a wider one)
export function pickTier(tiers: Tiers | null, inner: number): PanelLine[] | null {
  if (tiers === null) return null
  let best = -1
  for (const k of Object.keys(tiers)) { const n = Number(k); if (n <= inner && n > best) best = n }
  return best < 0 ? null : tiers[String(best)]
}

// the usage tab's table: the largest tier that fits, else the smallest there is (the main window is at most 76 wide and codeforge writes 40 and 60; a window under 40 gets the 40 clipped)
export function pickUsageTier(tiers: Tiers | null, inner: number): PanelLine[] | null {
  if (tiers === null) return null
  const fit = pickTier(tiers, inner)
  if (fit !== null) return fit
  const keys = Object.keys(tiers).map(Number)
  return keys.length === 0 ? null : tiers[String(Math.min(...keys))]
}
// whole minutes behind, once the data is older than STALE_MS; null while fresh (or no timestamp)
export function staleMinutes(panel: PanelRead): number | null {
  return panel.status === 'ok' && panel.ageMs !== null && panel.ageMs > STALE_MS ? Math.max(1, Math.round(panel.ageMs / 60_000)) : null
}

// ---- drawing helpers ----
const sp = (n: number): string => ' '.repeat(Math.max(0, n))
export function segWidth(segs: readonly Seg[]): number { return segs.reduce((a, s) => a + displayWidth(s.text), 0) }
// cut to `width` cells, ending in `…` when something was dropped
export function clipSegs(segs: readonly Seg[], width: number): Seg[] {
  if (width < 1) return []
  if (segWidth(segs) <= width) return segs.slice()
  const out: Seg[] = []
  let used = 0
  for (const s of segs) {
    let text = ''
    for (const ch of s.text) {
      const w = displayWidth(ch)
      if (used + w > width - 1) { out.push({ ...s, text }); out.push({ text: '…' }); return out.filter(x => x.text !== '') }
      text += ch
      used += w
    }
    out.push({ ...s, text })
  }
  return out
}
export function padSegs(segs: readonly Seg[], width: number): Seg[] {
  const w = segWidth(segs)
  return w >= width ? segs.slice() : [...segs, { text: sp(width - w) }]
}
const TONE_STYLE: Record<string, Partial<Seg>> = { subtle: { color: PALETTE.structure }, inactive: { color: PALETTE.idle }, dim: { dim: true }, success: { color: PALETTE.done } }
// one panel line as segments, cut to inner-1 (the column's last cell stays empty); bold and mono tones are plain text here: bold is a whitelist and this is not on it
export function panelSegs(line: PanelLine, inner: number): Seg[] {
  return clipSegs(lineSegs(line), inner - 1)
}
const lineSegs = (line: PanelLine): Seg[] => line.map(p => ({ text: p.text, ...(p.tone === undefined ? {} : (TONE_STYLE[p.tone] ?? {})) }))

// The usage tab's rows in the main window (`cols` = its inner width, `rows` = MAIN_CONTENT_ROWS): the picked table cut to cols-1; more lines than rows: the first rows-1 and a dim last row saying how
// many are left; stale data puts the age in front of the FIRST row (no row of its own). No data, an unknown schema and a missing layout are one dim line each.
export function usageRows(panel: PanelRead, cols: number, rows: number, t: T): Seg[][] {
  const note = (text: string): Seg[][] => [clipSegs([{ text, dim: true }], cols - 1)]
  if (panel.status === 'absent') return note(t('shell.usage_none'))
  if (panel.status !== 'ok') return note(t('shell.usage_format'))
  const lines = pickUsageTier(panel.usage, cols)
  if (lines === null || lines.length === 0) return note(t('shell.usage_nolayout'))
  const over = lines.length > rows
  const out = (over ? lines.slice(0, rows - 1) : lines).map(lineSegs)
  if (over) out.push([{ text: t('shell.usage_more', { n: lines.length - (rows - 1) }), dim: true }])
  const mins = staleMinutes(panel)
  if (mins !== null) out[0] = [{ text: t('shell.stale', { n: mins }) + ' ', dim: true }, ...out[0]]
  return out.map(r => clipSegs(r, cols - 1))
}
export function legacyUsageRows(panelRaw: unknown, nowMs: number, cols: number, rows: number, t: T): Seg[][] {
  return usageRows(readLegacyUsage(panelRaw, nowMs), cols, rows, t)
}

// ---- the roundtable summary ----
export type RoomRow = { seq: number; from: string; kind: string; text: string }
// complete lines only; a line that is not one row is skipped (the same reading as the roundtable pane's)
export function parseRoom(text: string): RoomRow[] {
  const out: RoomRow[] = []
  if (!text) return out
  const end = text.endsWith('\n') ? text.length - 1 : text.lastIndexOf('\n')
  if (end < 0) return out
  for (const line of text.slice(0, end).split('\n')) {
    if (line === '') continue
    let v: unknown
    try { v = JSON.parse(line) } catch { continue }
    if (!isObj(v) || typeof v.seq !== 'number' || !Number.isInteger(v.seq) || typeof v.from !== 'string' || typeof v.text !== 'string' || typeof v.kind !== 'string') continue
    out.push({ seq: v.seq, from: clean(v.from), kind: v.kind, text: clean(v.text.split('\n')[0]) }) // the summary shows the first line of a message
  }
  return out
}
// rows from someone else after `baseline` (the newest seq seen when the shell opened)
export function freshCount(rows: readonly RoomRow[], baseline: number | null): number {
  if (baseline === null) return 0
  return rows.filter(r => r.seq > baseline && r.from !== 'owner').length
}
export function newestSeq(rows: readonly RoomRow[]): number | null {
  return rows.length === 0 ? null : Math.max(...rows.map(r => r.seq))
}
// the last `count` rows, one line each (`from text`, first line of the text), owner rows in `here` like the roundtable pane, system rows in `attention`
export function roomLines(rows: readonly RoomRow[], inner: number, count: number): Seg[][] {
  return rows.slice(Math.max(0, rows.length - count)).map(r => {
    const style: Partial<Seg> = r.kind === 'system' ? { color: r.text.includes('send failed') ? PALETTE.broken : PALETTE.attention } : r.from === 'owner' ? { here: true } : {}
    return clipSegs([{ text: r.from + ' ', ...style }, { text: r.text }], inner - 1)
  })
}

// ---- the fleet summary (autopilot's own lanes, FleetSummary.lanes) ----
export type FleetLaneSum = { lane: string; needYou: number; failed: number; stuck: number; running: number; waiting: number }
// one row per lane that has anything: the most pressing state's glyph (busy ◉, waits for you ⏶, idle ⋯ …) and its count
export function fleetLines(lanes: readonly FleetLaneSum[], inner: number, count: number): Seg[][] {
  const g = GLYPHS.state
  const rows: { rank: number; segs: Seg[] }[] = []
  for (const l of lanes) {
    const pick: [number, string, string | undefined, number][] = [[0, g.need_you, PALETTE.attention, l.needYou], [1, g.failed, PALETTE.broken, l.failed], [2, g.stalled, PALETTE.broken, l.stuck], [3, g.running, PALETTE.running, l.running], [4, g.waiting, undefined, l.waiting]]
    const hit = pick.find(p => p[3] > 0)
    if (hit === undefined) continue
    rows.push({ rank: hit[0], segs: clipSegs([{ text: hit[1], ...(hit[2] === undefined ? {} : { color: hit[2] as Seg['color'] }) }, { text: ' ' + l.lane + ' ' + hit[3] }], inner - 1) })
  }
  return rows.sort((a, b) => a.rank - b.rank).slice(0, count).map(r => r.segs)
}

// ---- the plan ----
export type T = (id: string, vars?: Record<string, string | number>) => string
// The title of the left frame says what the left column lists: the open tab's name while it lists cards (the 待決 card view), the menu word while it lists the tabs.
export function leftTitle(listing: 'cards' | 'tabs', tabName: string, t: T): string {
  return listing === 'cards' ? tabName : t('shell.menu')
}
export type ShellInput = {
  columns: number // bodyColumns
  t: T
  menuTitle: string
  mainTitle: string
  room: { rows: readonly RoomRow[]; fresh: number }
  panel?: PanelRead
  panelRaw?: unknown
  nowMs?: number
  fleet: readonly FleetLaneSum[]
  footLeft?: string // right-aligned in the bottom frame of the left window (the card position, `3/8`)
  footMain?: string // right-aligned in the bottom frame of the main window (the one-line hint)
  noRight?: boolean // the card view: no right-hand columns, the main window is as wide as the band allows (shellGeometry)
  bodyRows?: number // the frame's body rows when the content grows up past BODY_ROWS (the card view) or is cut to what a short band leaves (r4); right-hand columns are only drawn at BODY_ROWS
  compact?: boolean // r4: a band under COMPACT_BELOW rows: the body is content only (no divider, no progress row)
  awaiting?: number // the count is drawn on the top menu row (band.tsx), not in a window title
}
export type ShellColumn = { id: ColId; inner: number; rows: Seg[][] } // BODY_ROWS rows, each padded to exactly `inner` cells
export type ShellPlan = { geo: Geometry; bodyRows: number; compact: boolean; top: Seg[]; bottom: Seg[]; verts: Seg[]; columns: ShellColumn[]; divider: { left: Seg; right: Seg; rule: Seg }; separate: boolean; leftInner: number }

const border = (role: 'here' | 'idle'): Partial<Seg> => ({ color: PALETTE[role] })
function frameRow(kind: 'top' | 'bottom', widths: readonly number[], titles: readonly Seg[][], separate = false): Seg[] {
  const f = GLYPHS.structure
  const [l, r, mid] = kind === 'top' ? [f.frameTL, f.frameTR, f.frameDown] : [f.frameBL, f.frameBR, f.frameUp]
  const MAIN = 1
  const out: Seg[] = []
  widths.forEach((w, i) => {
    const edge = border(i === MAIN ? 'here' : 'idle')
    if (separate) {
      if (i > 0) out.push({ text: ' ' })
      out.push({ text: l, ...edge })
    } else out.push({ text: i === 0 ? l : mid, ...border(i === MAIN || i - 1 === MAIN ? 'here' : 'idle') })
    const style = border(i === MAIN ? 'here' : 'idle')
    const title = clipSegs(titles[i] ?? [], Math.max(0, w - 4))
    if (kind === 'bottom') {
      // a foot title sits at the right end: `───── 3/8 ─`
      if (title.length === 0) out.push({ text: f.rule.repeat(w), ...style })
      else out.push({ text: f.rule.repeat(Math.max(0, w - 3 - segWidth(title))) + ' ', ...style }, ...title, { text: ' ' + f.rule, ...style })
    } else if (title.length === 0) out.push({ text: f.rule.repeat(w), ...style })
    else out.push({ text: f.rule + ' ', ...style }, ...title, { text: ' ' + f.rule.repeat(Math.max(0, w - 3 - segWidth(title))), ...style })
    if (separate) out.push({ text: r, ...edge })
  })
  if (!separate) out.push({ text: r, ...border(widths.length - 1 === MAIN ? 'here' : 'idle') })
  return out
}

// rows[0..BODY_ROWS): `head` bottom-anchored in the room it is given (the newest at the foot, as in a chat), then a divider and `foot` (a separate block: usage, memory)
function stack(head: readonly Seg[][], foot: readonly Seg[][], inner: number, lead: Seg[] | null): Seg[][] {
  const footRows = foot.slice(0, BODY_ROWS - 2)
  const divider: Seg[][] = footRows.length === 0 ? [] : [[{ text: GLYPHS.structure.rule.repeat(inner), color: PALETTE.structure }]]
  const room = BODY_ROWS - footRows.length - divider.length - (lead === null ? 0 : 1)
  const shown = head.slice(Math.max(0, head.length - room))
  const blank = Array.from({ length: Math.max(0, room - shown.length) }, () => [] as Seg[])
  const rows = [...(lead === null ? [] : [lead]), ...blank, ...shown, ...divider, ...footRows]
  return rows.map(r => padSegs(r, inner))
}

export function shellPlan(inp: ShellInput): ShellPlan | null {
  const geo = shellGeometry(inp.columns, inp.noRight === true)
  if (geo === null) return null
  const bodyRows = inp.bodyRows ?? BODY_ROWS
  const compact = inp.compact === true
  const { t } = inp
  const panel = inp.panel ?? readLegacyUsage(inp.panelRaw, inp.nowMs ?? 0)
  const side = panel.side
  const mins = staleMinutes(panel)
  const lead: Seg[] | null = mins !== null ? [{ text: t('shell.stale', { n: mins }), dim: true }] : null
  const usageOf = (tiers: Tiers | null, inner: number, cap: number): PanelLine[] => (pickTier(tiers, inner) ?? []).slice(0, cap)
  const roomRows = (inner: number): Seg[][] => {
    const all = roomLines(inp.room.rows, inner, BODY_ROWS)
    return all.length === 0 ? [[{ text: t('shell.room_none'), dim: true }]] : all
  }
  const hasUsage = (inner: number, full: boolean): boolean => usageOf(full ? side?.usageFull ?? null : side?.usage ?? null, inner, BODY_ROWS).length > 0
  const freshTitle: Seg[] = inp.room.fresh > 0 ? [{ text: ' ' + GLYPHS.structure.fresh + ' ' + inp.room.fresh }] : []
  const roomTitle: Seg[] = [{ text: t('shell.room') }, ...freshTitle]

  // the columns that have something to show; a column with nothing is not drawn and its width goes to the roundtable (no hole)
  let spec = geo.right.map(c => ({ ...c }))
  if (geo.right.length > 0 && geo.tier === 200 && !hasUsage(spec[1].inner, true)) spec = [{ id: 'room', inner: spec[0].inner + spec[1].inner + 1 }]
  if (geo.right.length > 0 && geo.tier === 240) {
    const usage = hasUsage(spec[1].inner, true)
    const foot = inp.fleet.length > 0 || usageOf(side?.memory ?? null, spec[2].inner, 2).length > 0
    if (!usage && !foot) spec = [{ id: 'room', inner: spec[0].inner + spec[1].inner + spec[2].inner + 2 }]
    else if (!usage) spec = [{ id: 'room', inner: spec[0].inner + spec[1].inner + 1 }, spec[2]]
    else if (!foot) spec = [spec[0], { id: 'usage', inner: spec[1].inner + spec[2].inner + 1 }]
  }

  // 「待你動手 N」is the top menu row's (band.tsx), at every tier. A window title never carries it.
  const separate = inp.noRight === true
  const leftInner = separate ? geo.left - 2 : geo.left
  const titles: Seg[][] = [[{ text: inp.menuTitle }], [{ text: inp.mainTitle }]]
  const columns: ShellColumn[] = []
  spec.forEach((c, idx) => {
    const lead1 = idx === 0 ? lead : null
    if (c.id === 'roomUsage') {
      const usage = usageOf(side?.usage ?? null, c.inner, 3).map(l => panelSegs(l, c.inner))
      titles.push(usage.length > 0 ? [...roomTitle, { text: ' · ' + t('shell.usage') }] : roomTitle)
      columns.push({ id: c.id, inner: c.inner, rows: stack(roomRows(c.inner), usage, c.inner, lead1) })
    } else if (c.id === 'room') {
      titles.push(roomTitle)
      columns.push({ id: c.id, inner: c.inner, rows: stack(roomRows(c.inner), [], c.inner, lead1) })
    } else if (c.id === 'usage') {
      const usage = usageOf(side?.usageFull ?? null, c.inner, BODY_ROWS).map(l => panelSegs(l, c.inner))
      titles.push([{ text: t('shell.usage') }])
      columns.push({ id: c.id, inner: c.inner, rows: Array.from({ length: BODY_ROWS }, (_x, i) => padSegs(usage[i] ?? [], c.inner)) })
    } else {
      const memory = usageOf(side?.memory ?? null, c.inner, 2).map(l => panelSegs(l, c.inner))
      titles.push([{ text: memory.length > 0 ? t('shell.fleet') + ' · ' + t('shell.memory') : t('shell.fleet') }])
      const lanes = fleetLines(inp.fleet, c.inner, BODY_ROWS - (memory.length > 0 ? memory.length + 1 : 0))
      // a lane list reads top-down (the most pressing first): top-anchored, with the memory block at the foot
      const divider: Seg[][] = memory.length === 0 ? [] : [[{ text: GLYPHS.structure.rule.repeat(c.inner), color: PALETTE.structure }]]
      const gap = Array.from({ length: Math.max(0, BODY_ROWS - lanes.length - divider.length - memory.length) }, () => [] as Seg[])
      columns.push({ id: c.id, inner: c.inner, rows: [...lanes, ...gap, ...divider, ...memory].map(r => padSegs(r, c.inner)) })
    }
  })

  // a band shorter than BODY_ROWS body rows draws the first rows of each column (a room column keeps its newest, the bottom ones)
  if (bodyRows < BODY_ROWS) for (const c of columns) c.rows = c.id === 'room' || c.id === 'roomUsage' ? c.rows.slice(BODY_ROWS - bodyRows) : c.rows.slice(0, bodyRows)
  const widths = [leftInner, geo.main, ...columns.map(c => c.inner)]
  const v = GLYPHS.structure.bandSep
  const verts = widths.concat([0]).map((_w, i) => ({ text: v, ...border(i === 1 || i === 2 ? 'here' : 'idle') }) as Seg)
  const f = GLYPHS.structure
  const divider = { left: { text: f.frameLeftT, ...border('here') } as Seg, right: { text: f.frameRightT, ...border('here') } as Seg, rule: { text: f.rule.repeat(geo.main), color: PALETTE.structure } as Seg }
  const foot = (text: string | undefined): Seg[] => (text === undefined || text === '' ? [] : [{ text }])
  const bottomTitles: Seg[][] = [foot(inp.footLeft), foot(inp.footMain)]
  return { geo, bodyRows, compact, top: frameRow('top', widths, titles, separate), bottom: frameRow('bottom', widths, bottomTitles, separate), verts, columns, divider, separate, leftInner }
}

// the marks band.tsx draws (it sets no colour of its own): a picked option's ⬥ and the `│` between the quick row's slots
export const PICK_MARK: Seg = { text: GLYPHS.structure.answer, color: PALETTE.action }
export const QUICK_SEP: Seg = { text: ' ' + GLYPHS.structure.bandSep + ' ', color: PALETTE.structure }

// ---- the card list (ux-v7): the left column of the 待決 tab, one row per question; and the progress row inside the main window ----
// `grey`: an answered card (sent, or closed elsewhere) stays in its place with dim text, as the pane greys it; `gone`: the session or the CLI closed it, so it has no draft and its glyph is idle
export type Card = { id: string; name: string; answer: string | null; sent: boolean; grey?: boolean; gone?: boolean }
// ◐ the card in the main window (here), ⬥ an answered one (action; done when it was sent), ○ an open one; the answer is right-aligned with one empty cell at the end.
// A name is never cut (§12: the 待決 tab's text is not truncated): it wraps inside the column, the mark stays on the first row and a continuation row hangs under the name. The answer sits on the first row.
// The window is over rows: it keeps the whole current card in view (its first row when the card is taller than the window), centred as far as the list allows.
export function cardRows(cards: readonly Card[], cursor: number, inner: number, rows: number = BODY_ROWS): { id: string; key: string; segs: Seg[] }[] {
  const all: { id: string; key: string; segs: Seg[] }[] = []
  let at = 0
  let span = 1
  cards.forEach((c, n) => {
    const here = n === cursor
    const answered = c.sent || c.answer !== null
    const glyph: Seg = here ? { text: GLYPHS.chart.here, color: PALETTE.here } : c.gone === true ? { text: GLYPHS.structure.answer, color: PALETTE.idle } : answered ? { text: GLYPHS.structure.answer, color: c.sent ? PALETTE.done : PALETTE.action } : { text: GLYPHS.state.pending, color: PALETTE.idle }
    const usable = inner - 1
    const answer = c.answer === null ? '' : clipSegs([{ text: c.answer }], Math.max(1, Math.min(displayWidth(c.answer), Math.floor(usable / 2))))[0]?.text ?? ''
    const answerW = answer === '' ? 0 : displayWidth(answer) + 1
    const style = { ...(here ? { here: true } : {}), ...(c.grey === true ? { dim: true } : {}) }
    const pieces = wrapPlain(c.name, Math.max(1, usable - 2 - answerW), Math.max(1, usable - 2))
    if (pieces.length === 0) pieces.push('')
    if (n === cursor) { at = all.length; span = Math.max(1, pieces.length) }
    pieces.forEach((piece, i) => {
      const name: Seg[] = [{ text: piece, ...style }]
      const tail = i === 0 ? answerW : 0
      const used = 2 + segWidth(name) + tail
      const segs: Seg[] = [i === 0 ? glyph : { text: ' ' }, { text: ' ' }, ...name, { text: sp(usable - used) + (i === 0 && answer !== '' ? ' ' + answer : ''), ...(i === 0 && answer !== '' ? { color: PALETTE.idle, ...(c.grey === true ? { dim: true } : {}) } : {}) }]
      all.push({ id: c.id, key: i === 0 ? 'card:' + c.id : 'card:' + c.id + '#' + i, segs: padSegs(segs, inner) })
    })
  })
  const from = span >= rows ? at : Math.max(0, Math.min(all.length - rows, at - Math.floor((rows - span + 1) / 2)))
  return all.slice(from, from + rows)
}

// `▰▰▱▱▱▱▱▱ 2/8  ⬥ 上一張 name → answer` (ux-v7 G3): one cell per card, sent done, picked action, open idle. After a send with nothing waiting the tail says `✓ 已送出 N 張`. `wide` adds `· 待送 N 張`
// and, only when every name fits, the names; a name is never cut in half. The result is never wider than `width`.
export function progressSegs(o: { cards: readonly Card[]; last: { name: string; answer: string } | null; wide: boolean; width: number; t: T }): Seg[] {
  const { cards, t } = o
  const meter: Seg[] = cards.map(c => (c.sent ? { text: GLYPHS.chart.meterOn, color: PALETTE.done } : c.answer !== null ? { text: GLYPHS.chart.meterOn, color: PALETTE.action } : { text: GLYPHS.chart.meterOff, color: PALETTE.idle }))
  const picked = cards.filter(c => !c.sent && c.answer !== null)
  const sentN = cards.filter(c => c.sent).length
  const head: Seg[] = [...meter, { text: ' ' + (picked.length + sentN) + '/' + cards.length }]
  let tail: Seg[] = []
  if (sentN > 0 && picked.length === 0) tail = [{ text: '  ' }, { text: GLYPHS.state.done, color: PALETTE.done }, { text: ' ' + t('shell.sent_n', { n: sentN }) }]
  else if (o.last !== null) tail = [{ text: '  ' }, { text: GLYPHS.structure.answer, color: PALETTE.action }, { text: ' ' + t('shell.prev') + ' ' }, ...clipSegs([{ text: o.last.name }], 16), { text: ' ' + GLYPHS.structure.answer + ' ' + o.last.answer }]
  const toSend = (names: boolean): Seg[] => {
    if (!o.wide || picked.length === 0) return []
    return [{ text: ' · ' + t('shell.to_send', { n: picked.length }) + (names ? '（' + picked.map(c => c.name).join('、') + '）' : '') }]
  }
  const variants = [[...head, ...tail, ...toSend(true)], [...head, ...tail, ...toSend(false)], [...head, ...tail]]
  for (const v of variants) if (segWidth(v) <= o.width) return v
  return clipSegs(variants[2], o.width)
}

// ---- the left column: the submenu of the open menu item (contract 3: the current one is marked ◐, shared with the 待決 list's "you are here") ----
export type MenuItem = { id: string; label: string }
export type LeftItem = { id: string; key: string; segs: Seg[] }
export function leftItems(items: readonly MenuItem[], active: string | null, inner: number): LeftItem[] {
  return items.map(it => {
    const here = it.id === active
    // `left:` not `menu:`: the top row already keys r/u/p/h as `menu:`, and the host refuses two Buttons with one key
    return { id: it.id, key: 'left:' + it.id, segs: padSegs(clipSegs([{ text: (here ? GLYPHS.chart.here : ' ') + ' ', ...(here ? { color: PALETTE.here } : {}) }, { text: it.label }], inner - 1), inner) }
  })
}
