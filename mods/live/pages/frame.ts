// mods/live/pages/frame.ts — the fixed-height frame every pane page is drawn in (plan r2 §3.1, §5) and the pane's pure key table (§3.2).
// Pure: rows of segments in, rows of segments out; pane.tsx draws them. A page fills only `body` and `actions`; the frame decides every row count, so no state of a page
// (many or few cards, folded, stale, no source) can make the pane taller or shorter than `ctx.size.rows`.
//
//   row 0          header: the page name, then the most severe broken marker (staleBadge) when a source is broken
//   body rows      the page's rows, wrapped (never cut) to the width; an overflow turns the LAST row into `↓ 還有 N 列`, the total unchanged
//   A rows         the actions (at most 6 when H >= 32 else 4), directly under the body; none -> one row: `沒有待決卡`, or `資料不足，無法判定` when a source is missing or a pool's verdict is unknown
//   Never a blank filler row between the content and the strip (gate round 1, G1): a page with little to say is drawn SHORTER than the surface, the body takes every row the actions leave.
//   last row       tab strip: `1 現況 2 待決 ...  i 說明  Esc 收起`; each tab entry carries press `tab:<digit>:<id>`; every entry 1-8, 9, 0 and i stays, the names shorten first (G7)
import type { ConsoleSnapshot } from '../console'
import type { T } from '../i18n'
import type { LiveSnapshot, Seg } from '../model'
import { displayWidth, truncateToWidth } from '../model'
import { GLYPHS, PALETTE } from '../ui'
import { PAGES } from './index'
import { brokenRow, poolsNeedLook, sourceMissing, staleBadge, unknownPoolCount } from './rows'
import type { Row } from './rows'

export type { Row } from './rows'
export interface PageCtx { live: LiveSnapshot | null; console: ConsoleSnapshot | null; size: { cols: number; rows: number }; t: T; nowMs: number }
export type PageId = 'now' | 'decide' | 'fleet' | 'quota' | 'dispatch' | 'review' | 'spend' | 'hygiene' | 'pet' | 'forge' | 'help'
// `framed` (optional, additive): true once the page is filled in; pane.tsx draws a framed page through frameRows and an unframed shell the old way, so S0 changes nothing on screen
export interface Page { id: PageId; key: string; title: string; framed?: true; render(ctx: PageCtx): { body: Row[]; actions: Row[] } }
// a tab the frame's strip shows next to the pages (the old tabs that still draw the old way): `key` is its digit
export type ExtraTab = { id: string; key: string; label: string }
export type FrameOpts = { scroll?: number; unfold?: (ctx: PageCtx) => { body: Row[]; actions: Row[] }; pages?: readonly Page[]; extra?: readonly ExtraTab[]; active?: string }

// the pane's height is fixed: the rows the host offers, at most 24, whatever the page shows (PM 01M7N33J: the screen must not jump on a page switch)
export const FRAME_MAX_ROWS = 24
export const frameHeight = (available: number): number => Math.max(0, Math.min(available, FRAME_MAX_ROWS))

export const actionRows = (rows: number): number => (rows >= 32 ? 6 : 4)

export { staleBadge, brokenRow }

const SEVERITY: Record<string, number> = { no_source: 3, expired: 2, stale: 1 }
// the most severe broken source of the console snapshot as one marker, null when every source is ok (the header shows it; the band's summary row takes the same one)
export function mostSevere(ctx: PageCtx): Seg | null {
  const sources = ctx.console === null ? [] : Object.entries(ctx.console.sources)
  let best: { name: string; state: string; at: number | null } | null = null
  for (const [name, s] of sources) {
    if ((SEVERITY[s.state] ?? 0) > (best === null ? 0 : SEVERITY[best.state] ?? 0)) best = { name, state: s.state, at: s.at_ms }
  }
  if (best === null) return null
  const mins = best.at === null ? null : Math.max(0, Math.floor((ctx.nowMs - best.at) / 60000))
  const known = ctx.t('console.command.src.' + best.name)
  const name = known === 'console.command.src.' + best.name ? best.name : known // a source with no zh-TW word keeps the feed's id; the known ones never show a field name
  return staleBadge(GLYPHS.state.failed + ' ' + ctx.t('frame.src_' + best.state, { name, min: mins === null ? '-' : String(mins) }))
}

// the one row an action area with no action says: a missing / not ok source -> 資料不足; unknown pools -> how many; else 沒有待決卡 (item 6)
// three ways: a missing / not ok source (the console's, or the seat's own feed on the pages that read it) -> 資料不足; else unknown pools -> how many, beside the scoped 沒有待決卡; else 沒有待決卡,
// or 沒有要你處理的事 only when every source is ok, no pool needs a look and nothing is unknown (calm)
function emptyState(ctx: PageCtx, page: Page): string {
  const liveBacked = page.id === 'now' || page.id === 'decide'
  if (sourceMissing(ctx.console) || (page.id === 'fleet' && ctx.console !== null && ctx.console.lines === null) || (liveBacked && (ctx.live === null || ctx.live.state !== 'ok'))) return ctx.t('frame.unknown')
  const n = unknownPoolCount(ctx.console, ctx.nowMs, ctx.t)
  if (n > 0) return ctx.t('frame.unknown_pools', { n }) + '；' + ctx.t('frame.nothing')
  return poolsNeedLook(ctx.console, ctx.nowMs, ctx.t) ? ctx.t('frame.nothing') : ctx.t('frame.calm')
}

// ---- drawing helpers ----
const blank = (): Row => [{ text: '' }]
function clip(row: Row, cols: number): Row {
  const out: Row = []
  let used = 0
  for (const s of row) {
    const w = displayWidth(s.text)
    if (used + w <= cols) { out.push(s); used += w; continue }
    const room = cols - used
    if (room > 0) out.push({ ...s, text: truncateToWidth(s.text, room) })
    break
  }
  return out.length === 0 ? blank() : out
}

// A row wider than the pane is wrapped onto further rows at the width, never cut with an ellipsis: a reason or a command shown half is worse than a taller page (A10, G6).
function wrapRow(row: Row, cols: number): Row[] {
  if (cols <= 0 || row.reduce((w, x) => w + displayWidth(x.text), 0) <= cols) return [row]
  const out: Row[] = []
  let cur: Row = []
  let used = 0
  for (const seg of row) {
    let buf = ''
    for (const ch of seg.text) {
      const w = displayWidth(ch)
      if (used + w > cols) {
        if (buf !== '') cur.push({ ...seg, text: buf })
        out.push(cur)
        cur = []
        buf = ''
        used = 0
      }
      buf += ch
      used += w
    }
    if (buf !== '') cur.push({ ...seg, text: buf })
  }
  if (cur.length > 0) out.push(cur)
  return out
}

// The host draws every hotkey Button as `<key>: <label>`, so each Button is one cell wider than its text (`1 現況` -> `1: 現況`). A Button is measured with that prefix, and every pair of
// neighbouring Buttons has a one-cell separator. When the row does not fit: the page labels shrink to their first character, then the Esc hint goes, then the help label shrinks to its
// first character. Every Button keeps a non-empty label (the host would draw a bare `k:`). Only when even that is wider than the surface (under about 56 columns) do the last page entries
// give way, from the end; the help entry `i` always stays.
const HOST_PREFIX = 1
const HELP_KEY = 'i'
function strip(page: Page, ctx: PageCtx, opts: FrameOpts): Row {
  const pages = opts.pages ?? PAGES
  const active = opts.active ?? page.id
  const all = [...pages.filter(p => p.id !== 'help').map(p => ({ id: p.id as string, key: p.key, label: ctx.t('tab.' + p.id) })), ...(opts.extra ?? [])]
  const first = (s: string): string => [...s][0] ?? s
  const helpLabel = ctx.t('frame.help')
  const esc = '  Esc ' + ctx.t('frame.close')
  type Form = 'full' | 'short'
  const labelOf = (x: { label: string }, f: Form): string => (f === 'full' ? x.label : first(x.label))
  const entry = (x: { id: string; key: string; label: string }, f: Form): Row => {
    const on = x.id === active
    return [{ text: x.key + ' ' + labelOf(x, f), press: 'tab:' + x.key + ':' + x.id, ...(on ? { color: PALETTE.here } : {}) }, { text: ' ' }]
  }
  const entryW = (x: { key: string; label: string }, f: Form): number => displayWidth(x.key) + 1 + displayWidth(labelOf(x, f)) + HOST_PREFIX + 1
  const build = (list: typeof all, f: Form, help: string, tail: string): { row: Row; width: number } => ({
    row: [...list.flatMap(x => entry(x, f)), { text: ' ' }, { text: HELP_KEY + ' ' + help + tail, dim: true }],
    width: list.reduce((w, x) => w + entryW(x, f), 1) + displayWidth(HELP_KEY) + HOST_PREFIX + 1 + displayWidth(help) + displayWidth(tail),
  })
  const tries = [build(all, 'full', helpLabel, esc), build(all, 'short', helpLabel, esc), build(all, 'short', helpLabel, ''), build(all, 'short', first(helpLabel), '')]
  const fits = tries.find(x => x.width <= ctx.size.cols)
  if (fits !== undefined) return fits.row
  let list = all
  let last = tries[tries.length - 1]
  while (last.width > ctx.size.cols && list.length > 0) { list = list.slice(0, -1); last = build(list, 'short', first(helpLabel), '') }
  return last.row
}

// EXACTLY ctx.size.rows rows, whatever the page returned, and the strip is always the last row (fixed height, PM 01M7N33J): head, the body laid out from the top, the actions right above the strip.
// Free rows go to content first: when the body is shorter than its room and the caller offers `unfold` (the page drawn with its folds open), the unfolded body is used if it fits whole.
// Only the rows that are really left over stay blank, between the body and the action rows (G1: never squeeze the content to nothing while blank rows exist).
export function frameRows(page: Page, ctx: PageCtx, opts: FrameOpts = {}): Row[] {
  const H = ctx.size.rows
  const full = actionRows(H)
  const first = page.render(ctx)
  if (first.actions.length > full) throw new Error('frame: ' + page.id + ' returned ' + first.actions.length + ' actions, the action area holds ' + full)
  if (H <= 0) return []
  if (H === 1) return [clip(strip(page, ctx, opts), ctx.size.cols)]
  const layout = (r: { body: Row[]; actions: Row[] }) => {
    const body = r.body.flatMap(x => wrapRow(x, ctx.size.cols))
    const acts: Row[] = r.actions.length === 0 ? [[{ text: emptyState(ctx, page), dim: true }]] : r.actions
    return { body, acts, room: H - 2 - Math.min(acts.length, H - 2) }
  }
  let lay = layout(first)
  if (opts.unfold !== undefined && lay.body.length < lay.room) {
    const open = opts.unfold(ctx)
    if (open.actions.length <= full) {
      const alt = layout(open)
      if (alt.body.length <= alt.room) lay = alt
    }
  }
  const { body, acts, room } = lay
  const A = Math.min(acts.length, H - 2) // the action rows give way last-first only when the surface is under 3 rows
  const head: Row = [{ text: ctx.t('tab.' + page.id) }, ...(mostSevere(ctx) === null ? [] : [{ text: '  ' }, mostSevere(ctx) as Seg])]
  let shown: Row[]
  if (body.length <= room) shown = body
  else {
    const from = Math.max(0, Math.min(opts.scroll ?? 0, body.length - room))
    if (from + room >= body.length) shown = body.slice(from) // the window reached the end: every row is a body row
    else {
      const keep = Math.max(0, room - 1)
      shown = [...body.slice(from, from + keep), ...(room === 0 ? [] : [[{ text: ctx.t('frame.more', { n: body.length - from - keep, arrow: GLYPHS.structure.behind }), dim: true }] as Row])]
    }
  }
  const gap: Row[] = Array.from({ length: room - shown.length }, blank)
  return [head, ...shown, ...gap, ...(A === 0 ? [] : acts.slice(-A)), strip(page, ctx, opts)].map(r => clip(r, ctx.size.cols))
}
