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
import { brokenRow, dataMissing, staleBadge } from './rows'
import type { Row } from './rows'

export type { Row } from './rows'
export interface PageCtx { live: LiveSnapshot | null; console: ConsoleSnapshot | null; size: { cols: number; rows: number }; t: T; nowMs: number }
export type PageId = 'now' | 'decide' | 'fleet' | 'quota' | 'dispatch' | 'review' | 'spend' | 'hygiene' | 'pet' | 'forge' | 'help'
// `framed` (optional, additive): true once the page is filled in; pane.tsx draws a framed page through frameRows and an unframed shell the old way, so S0 changes nothing on screen
export interface Page { id: PageId; key: string; title: string; framed?: true; render(ctx: PageCtx): { body: Row[]; actions: Row[] } }
// a tab the frame's strip shows next to the pages (the old tabs that still draw the old way): `key` is its digit
export type ExtraTab = { id: string; key: string; label: string }
export type FrameOpts = { scroll?: number; pages?: readonly Page[]; extra?: readonly ExtraTab[]; active?: string }

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
// neighbouring Buttons has a one-cell separator. When the row does not fit: the page labels shrink to their first character, then the Esc hint goes, then the labels go and only the
// keys stay. Every entry (1-8, 9, 0, i) is always there: nothing folds into a `…` (G7). The row is always one row, never wider than the surface.
const HOST_PREFIX = 1
const HELP_KEY = 'i'
function strip(page: Page, ctx: PageCtx, opts: FrameOpts): Row {
  const pages = opts.pages ?? PAGES
  const active = opts.active ?? page.id
  const all = [...pages.filter(p => p.id !== 'help').map(p => ({ id: p.id as string, key: p.key, label: ctx.t('tab.' + p.id) })), ...(opts.extra ?? [])]
  const first = (s: string): string => [...s][0] ?? s
  const helpLabel = ctx.t('frame.help')
  const esc = '  Esc ' + ctx.t('frame.close')
  type Form = 'full' | 'short' | 'keys'
  const labelOf = (x: { label: string }, f: Form): string => (f === 'full' ? x.label : f === 'short' ? first(x.label) : '')
  const entry = (x: { id: string; key: string; label: string }, f: Form): Row => {
    const on = x.id === active
    const l = labelOf(x, f)
    return [{ text: l === '' ? x.key : x.key + ' ' + l, press: 'tab:' + x.key + ':' + x.id, ...(on ? { color: PALETTE.here } : {}) }, { text: ' ' }]
  }
  const entryW = (x: { key: string; label: string }, f: Form): number => displayWidth(x.key) + (labelOf(x, f) === '' ? 0 : 1 + displayWidth(labelOf(x, f))) + HOST_PREFIX + 1
  const build = (f: Form, help: string, tail: string): { row: Row; width: number } => ({
    row: [...all.flatMap(x => entry(x, f)), { text: ' ' }, { text: HELP_KEY + (help === '' ? '' : ' ' + help) + tail, dim: true }],
    width: all.reduce((w, x) => w + entryW(x, f), 1) + displayWidth(HELP_KEY) + HOST_PREFIX + (help === '' ? 0 : 1 + displayWidth(help)) + displayWidth(tail),
  })
  const tries = [build('full', helpLabel, esc), build('short', helpLabel, esc), build('short', helpLabel, ''), build('keys', helpLabel, ''), build('keys', '', '')]
  const fits = tries.find(x => x.width <= ctx.size.cols)
  return clip((fits ?? tries[tries.length - 1]).row, ctx.size.cols)
}

// <= ctx.size.rows rows, whatever the page returned: head, the (wrapped) body, the actions right under it, the strip. No blank row fills the gap when the page is short (G1).
export function frameRows(page: Page, ctx: PageCtx, opts: FrameOpts = {}): Row[] {
  const H = ctx.size.rows
  const full = actionRows(H)
  const { body: raw, actions } = page.render(ctx)
  if (actions.length > full) throw new Error('frame: ' + page.id + ' returned ' + actions.length + ' actions, the action area holds ' + full)
  if (H <= 0) return []
  if (H === 1) return [clip(strip(page, ctx, opts), ctx.size.cols)]
  const body = raw.flatMap(r => wrapRow(r, ctx.size.cols))
  const acts: Row[] = actions.length === 0 ? [[{ text: ctx.t(dataMissing(ctx.console, ctx.nowMs, ctx.t) ? 'frame.unknown' : 'frame.nothing'), dim: true }]] : actions
  const A = Math.min(acts.length, H - 2) // the action rows give way last-first only when the surface is under 3 rows
  const room = H - 2 - A
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
  return [head, ...shown, ...(A === 0 ? [] : acts.slice(-A)), strip(page, ctx, opts)].map(r => clip(r, ctx.size.cols))
}
