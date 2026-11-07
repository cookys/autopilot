// mods/live/shell.ts — the O4 band shell, pure half (panel-band contract 2026-11-06): the width tiers, the frame geometry, the reader of codeforge's `forge-stats.panel`
// (`codeforge.panel/1` with the optional `side`), and the right-hand summary columns. No engine value in here and no JSX: band.tsx draws what this file plans.
// Syntax is erasable and every runtime import carries `.ts`, so `node --test` can load this file (shell.test.js).
// Colours: only PALETTE roles (ui.ts) as text colour; no background, no inverse, no bold. One colour, one meaning: main window `here`, other windows `idle`, dividers `structure`.

import type { Seg } from './model.ts'
import { GLYPHS, PALETTE, displayWidth } from './ui.ts'

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
export const BODY_ROWS = 8 // the main window's last two rows are the divider ├─┤ and the progress row; the six above are its content
export const MAIN_CONTENT_ROWS = BODY_ROWS - 2
export const LEFT_COLS = 26
export const MAIN_MAX = 76
export const MAIN_MIN = 30
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
export function shellGeometry(bodyColumns: number): Geometry | null {
  const tier = bandTier(bodyColumns)
  const right = RIGHT[tier]
  const fixed = right.length + 3 + LEFT_COLS + right.reduce((a, c) => a + c.inner, 0) // one vertical line per window edge
  const main = Math.min(MAIN_MAX, bodyColumns - fixed)
  if (!(main >= MAIN_MIN)) return null
  return { tier, left: LEFT_COLS, main, right }
}

// ---- the panel reader (contract 2): forge-stats writes `codeforge.panel/1`; we only read it ----
export type PanelLine = { text: string; tone?: string }[]
export type Tiers = Record<string, PanelLine[]>
export type SideData = { usage: Tiers | null; usageFull: Tiers | null; memory: Tiers | null }
// absent: nothing written (null / undefined); bad: not an object; old: another schema (or none); ok: codeforge.panel/1
// usage: the top-level `usage` tiers (the 用量 tab of the band), money lines already dropped
export type PanelRead = { status: 'absent' | 'bad' | 'old' | 'ok'; ageMs: number | null; side: SideData | null; usage: Tiers | null }
export const PANEL_SCHEMA = 'codeforge.panel/1'
export const STALE_MS = 60_000
// codeforge's tone words (PanelTone); written as one string so no theme-key literal stands here (ui-lint L8: colours are PALETTE roles)
const TONES = new Set('subtle inactive dim bold mono success'.split(' '))
// text read from another process's file is cleaned once, here at the trust boundary: C0 (ESC, CR, TAB…), DEL and C1 controls become nothing, a newline a space
const clean = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '')
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// a tiers table: numeric keys, each a list of lines, each line a list of {text, tone?}. A tier that breaks the shape is dropped; a table with no tier left is null.
// noMoney: a line any of whose parts carries `$` is dropped (the usage tab draws no money; the same rule as for `side`, per line)
function tiersOf(v: unknown, noMoney = false): Tiers | null {
  if (!isObj(v) || !isObj(v.tiers)) return null
  const out: Tiers = {}
  for (const [k, lines] of Object.entries(v.tiers)) {
    if (!/^\d+$/.test(k) || !Array.isArray(lines)) continue
    const rows: PanelLine[] = []
    let ok = true
    for (const line of lines) {
      if (!Array.isArray(line)) { ok = false; break }
      const parts: PanelLine = []
      for (const p of line) {
        if (!isObj(p) || typeof p.text !== 'string') { ok = false; break }
        parts.push(typeof p.tone === 'string' && TONES.has(p.tone) ? { text: clean(p.text), tone: p.tone } : { text: clean(p.text) })
      }
      if (!ok) break
      rows.push(parts)
    }
    if (ok) out[k] = noMoney ? rows.filter(r => !r.some(p => p.text.includes('$'))) : rows
  }
  return Object.keys(out).length === 0 ? null : out
}

// A side table that carries money is not drawn at all (the producer already refuses to write one; this is the second lock). Each part of `side` is read on its own: a broken `usage`
// does not take `memory` down. Unknown fields are ignored.
export function parsePanel(value: unknown, nowMs: number): PanelRead {
  if (value === null || value === undefined) return { status: 'absent', ageMs: null, side: null, usage: null }
  if (!isObj(value)) return { status: 'bad', ageMs: null, side: null, usage: null }
  if (value.schema !== PANEL_SCHEMA) return { status: 'old', ageMs: null, side: null, usage: null }
  const at = value.updated_at_ms
  const ageMs = typeof at === 'number' && Number.isFinite(at) ? Math.max(0, nowMs - at) : null
  const usage = tiersOf(value.usage, true)
  const s = value.side
  if (!isObj(s) || JSON.stringify(s).includes('$')) return { status: 'ok', ageMs, side: null, usage }
  const side = { usage: tiersOf(s.usage), usageFull: tiersOf(s.usage_full), memory: tiersOf(s.memory) }
  return { status: 'ok', ageMs, side: side.usage === null && side.usageFull === null && side.memory === null ? null : side, usage }
}

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
    const style: Partial<Seg> = r.kind === 'system' ? { color: r.text.includes('send failed') ? PALETTE.broken : PALETTE.attention } : r.from === 'owner' ? { color: PALETTE.here } : {}
    return clipSegs([{ text: r.from + ' ', ...style }, { text: r.text }], inner - 1)
  })
}

// ---- the fleet summary (autopilot's own lanes, FleetSummary.lanes) ----
export type FleetLaneSum = { lane: string; needYou: number; failed: number; stuck: number; running: number; waiting: number }
// one row per lane that has anything: the most pressing state's glyph (busy ●, waits for you ▲, idle ⋯ …) and its count
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
  panel: PanelRead
  fleet: readonly FleetLaneSum[]
  footLeft?: string // right-aligned in the bottom frame of the left window (the card position, `3/8`)
  footMain?: string // right-aligned in the bottom frame of the main window (the one-line hint)
  awaiting?: number // answered cards still waiting for the operator's own step (status awaiting_operator_action); drawn in the main window's title at tier 80 only, and only when above 0
}
export type ShellColumn = { id: ColId; inner: number; rows: Seg[][] } // BODY_ROWS rows, each padded to exactly `inner` cells
export type ShellPlan = { geo: Geometry; top: Seg[]; bottom: Seg[]; verts: Seg[]; columns: ShellColumn[]; divider: { left: Seg; right: Seg; rule: Seg } }

const border = (role: 'here' | 'idle'): Partial<Seg> => ({ color: PALETTE[role] })
function frameRow(kind: 'top' | 'bottom', widths: readonly number[], titles: readonly Seg[][]): Seg[] {
  const f = GLYPHS.structure
  const [l, r, mid] = kind === 'top' ? [f.frameTL, f.frameTR, f.frameDown] : [f.frameBL, f.frameBR, f.frameUp]
  const MAIN = 1
  const out: Seg[] = []
  widths.forEach((w, i) => {
    out.push({ text: i === 0 ? l : mid, ...border(i === MAIN || i - 1 === MAIN ? 'here' : 'idle') })
    const style = border(i === MAIN ? 'here' : 'idle')
    if (kind === 'bottom') {
      // a foot title sits at the right end: `───── 3/8 ─`
      const title = clipSegs(titles[i] ?? [], Math.max(0, w - 4))
      if (title.length === 0) { out.push({ text: f.rule.repeat(w), ...style }); return }
      out.push({ text: f.rule.repeat(Math.max(0, w - 3 - segWidth(title))) + ' ', ...style }, ...title, { text: ' ' + f.rule, ...style })
      return
    }
    const title = clipSegs(titles[i] ?? [], Math.max(0, w - 4))
    if (title.length === 0) { out.push({ text: f.rule.repeat(w), ...style }); return }
    out.push({ text: f.rule + ' ', ...style }, ...title, { text: ' ' + f.rule.repeat(Math.max(0, w - 3 - segWidth(title))), ...style })
  })
  out.push({ text: r, ...border(widths.length - 1 === MAIN ? 'here' : 'idle') })
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
  const geo = shellGeometry(inp.columns)
  if (geo === null) return null
  const { t, panel } = inp
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
  if (geo.tier === 200 && !hasUsage(spec[1].inner, true)) spec = [{ id: 'room', inner: spec[0].inner + spec[1].inner + 1 }]
  if (geo.tier === 240) {
    const usage = hasUsage(spec[1].inner, true)
    const foot = inp.fleet.length > 0 || usageOf(side?.memory ?? null, spec[2].inner, 2).length > 0
    if (!usage && !foot) spec = [{ id: 'room', inner: spec[0].inner + spec[1].inner + spec[2].inner + 2 }]
    else if (!usage) spec = [{ id: 'room', inner: spec[0].inner + spec[1].inner + 1 }, spec[2]]
    else if (!foot) spec = [spec[0], { id: 'usage', inner: spec[1].inner + spec[2].inner + 1 }]
  }

  // tier 80 has no right-hand column to carry it, so the count rides in the main window's title; 0 draws nothing (the same as the roundtable's fresh mark)
  const awaitingTitle: Seg[] = geo.tier === 80 && (inp.awaiting ?? 0) > 0 ? [{ text: ' · ' }, { text: t('shell.awaiting', { n: inp.awaiting as number }), color: PALETTE.attention }] : []
  const titles: Seg[][] = [[{ text: inp.menuTitle }], [{ text: inp.mainTitle }, ...awaitingTitle]]
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

  const widths = [geo.left, geo.main, ...columns.map(c => c.inner)]
  const v = GLYPHS.structure.bandSep
  const verts = widths.concat([0]).map((_w, i) => ({ text: v, ...border(i === 1 || i === 2 ? 'here' : 'idle') }) as Seg)
  const f = GLYPHS.structure
  const divider = { left: { text: f.frameLeftT, ...border('here') } as Seg, right: { text: f.frameRightT, ...border('here') } as Seg, rule: { text: f.rule.repeat(geo.main), color: PALETTE.structure } as Seg }
  const foot = (text: string | undefined): Seg[] => (text === undefined || text === '' ? [] : [{ text }])
  const bottomTitles: Seg[][] = [foot(inp.footLeft), foot(inp.footMain)]
  return { geo, top: frameRow('top', widths, titles), bottom: frameRow('bottom', widths, bottomTitles), verts, columns, divider }
}

// the marks band.tsx draws (it sets no colour of its own): a picked option's ◆ and the `│` between the quick row's slots
export const PICK_MARK: Seg = { text: GLYPHS.structure.decisions, color: PALETTE.action }
export const QUICK_SEP: Seg = { text: ' ' + GLYPHS.structure.bandSep + ' ', color: PALETTE.structure }

// ---- the card list (ux-v7): the left column of the 待決 tab, one row per question; and the progress row inside the main window ----
export type Card = { id: string; name: string; answer: string | null; sent: boolean }
// the visible window of `count` rows around the cursor
function window(n: number, cursor: number, count: number): number {
  return Math.max(0, Math.min(n - count, cursor - Math.floor(count / 2)))
}
// ◐ the card in the main window (here), ◆ an answered one (action; done when it was sent), ○ an open one; the answer is right-aligned with one empty cell at the end
export function cardRows(cards: readonly Card[], cursor: number, inner: number): { id: string; key: string; segs: Seg[] }[] {
  const from = window(cards.length, cursor, BODY_ROWS)
  return cards.slice(from, from + BODY_ROWS).map((c, k) => {
    const here = from + k === cursor
    const answered = c.sent || c.answer !== null
    const glyph: Seg = here ? { text: GLYPHS.chart.here, color: PALETTE.here } : answered ? { text: GLYPHS.structure.decisions, color: c.sent ? PALETTE.done : PALETTE.action } : { text: GLYPHS.state.pending, color: PALETTE.idle }
    const usable = inner - 1
    const answer = c.answer === null ? '' : clipSegs([{ text: c.answer }], Math.max(1, Math.min(displayWidth(c.answer), Math.floor(usable / 2))))[0]?.text ?? ''
    const answerW = answer === '' ? 0 : displayWidth(answer) + 1
    const name = clipSegs([{ text: c.name, ...(here ? { color: PALETTE.here } : {}) }], Math.max(1, usable - 2 - answerW))
    const used = 2 + segWidth(name) + answerW
    const segs: Seg[] = [glyph, { text: ' ' }, ...name, { text: sp(usable - used) + (answer === '' ? '' : ' ' + answer), ...(answer === '' ? {} : { color: PALETTE.idle }) }]
    return { id: c.id, key: 'card:' + c.id, segs: padSegs(segs, inner) }
  })
}

// `▰▰▱▱▱▱▱▱ 2/8  ◆ 上一張 name → answer` (ux-v7 G3): one cell per card, sent done, picked action, open idle. After a send with nothing waiting the tail says `✓ 已送出 N 張`. `wide` adds `· 待送 N 張`
// and, only when every name fits, the names; a name is never cut in half. The result is never wider than `width`.
export function progressSegs(o: { cards: readonly Card[]; last: { name: string; answer: string } | null; wide: boolean; width: number; t: T }): Seg[] {
  const { cards, t } = o
  const meter: Seg[] = cards.map(c => (c.sent ? { text: GLYPHS.chart.meterOn, color: PALETTE.done } : c.answer !== null ? { text: GLYPHS.chart.meterOn, color: PALETTE.action } : { text: GLYPHS.chart.meterOff, color: PALETTE.idle }))
  const picked = cards.filter(c => !c.sent && c.answer !== null)
  const sentN = cards.filter(c => c.sent).length
  const head: Seg[] = [...meter, { text: ' ' + (picked.length + sentN) + '/' + cards.length }]
  let tail: Seg[] = []
  if (sentN > 0 && picked.length === 0) tail = [{ text: '  ' }, { text: GLYPHS.state.done, color: PALETTE.done }, { text: ' ' + t('shell.sent_n', { n: sentN }) }]
  else if (o.last !== null) tail = [{ text: '  ' }, { text: GLYPHS.structure.decisions, color: PALETTE.action }, { text: ' ' + t('shell.prev') + ' ' }, ...clipSegs([{ text: o.last.name }], 16), { text: ' ' + GLYPHS.structure.answer + ' ' + o.last.answer }]
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
    return { id: it.id, key: 'menu:' + it.id, segs: padSegs(clipSegs([{ text: (here ? GLYPHS.chart.here : ' ') + ' ', ...(here ? { color: PALETTE.here } : {}) }, { text: it.label }], inner - 1), inner) }
  })
}
