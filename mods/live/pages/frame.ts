// mods/live/pages/frame.ts — the fixed-height frame every pane page is drawn in (plan r2 §3.1, §5) and the pane's pure key table (§3.2).
// Pure: rows of segments in, rows of segments out; pane.tsx draws them. A page fills only `body` and `actions`; the frame decides every row count, so no state of a page
// (many or few cards, folded, stale, no source) can make the pane taller or shorter than `ctx.size.rows`.
//
//   row 0          header: the page name, then the most severe broken marker (staleBadge) when a source is broken
//   H-2-A rows     body, bottom-anchored; an overflow turns its LAST row into `↓ 還有 N 列`, the total unchanged
//   A rows         action area, A = 6 when H >= 32 else 4; the last action is the bottom row (next to the tab strip), the rest stand above it in order; none -> `沒有要你處理的事` on the bottom row
//   last row       tab strip: `1 現況 2 待決 ...  i 說明  Esc 收起`; each tab entry carries press `tab:<digit>:<id>`
import type { ConsoleSnapshot } from '../console'
import type { T } from '../i18n'
import type { LiveSnapshot, Seg } from '../model'
import { displayWidth, truncateToWidth } from '../model'
import { GLYPHS, PALETTE } from '../ui'
import { PAGES } from './index'
import { brokenRow, staleBadge } from './rows'
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
  return staleBadge(GLYPHS.state.failed + ' ' + ctx.t('frame.src_' + best.state, { name: best.name, min: mins === null ? '-' : String(mins) }))
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

function strip(page: Page, ctx: PageCtx, opts: FrameOpts): Row {
  const pages = opts.pages ?? PAGES
  const active = opts.active ?? page.id
  const entry = (id: string, key: string, label: string): Row => {
    const on = id === active
    return [{ text: key + ' ' + label, press: 'tab:' + key + ':' + id, ...(on ? { color: PALETTE.here } : {}) }, { text: ' ' }]
  }
  const tabs = [...pages.filter(p => p.id !== 'help').map(p => entry(p.id, p.key, ctx.t('tab.' + p.id))), ...(opts.extra ?? []).map(x => entry(x.id, x.key, x.label))].flat()
  return clip([...tabs, { text: ' ' }, { text: 'i ' + ctx.t('frame.help') + '  Esc ' + ctx.t('frame.close'), dim: true }], ctx.size.cols)
}

// exactly ctx.size.rows rows, whatever the page returned
export function frameRows(page: Page, ctx: PageCtx, opts: FrameOpts = {}): Row[] {
  const H = ctx.size.rows
  const full = actionRows(H)
  const { body, actions } = page.render(ctx)
  if (actions.length > full) throw new Error('frame: ' + page.id + ' returned ' + actions.length + ' actions, the action area holds ' + full)
  if (H <= 0) return []
  if (H === 1) return [clip(strip(page, ctx, opts), ctx.size.cols)]
  const A = Math.min(full, H - 2) // under 6 rows the action area gives way (the last actions stay), then the body: head and strip are always drawn
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
  const bodyBlock: Row[] = [...Array.from({ length: room - shown.length }, blank), ...shown]
  const actionBlock: Row[] = Array.from({ length: A }, blank)
  if (A === 0) { /* no room for an action row */ }
  else if (actions.length === 0) actionBlock[A - 1] = [{ text: ctx.t('frame.nothing'), dim: true }]
  else actions.slice(-A).forEach((r, i, kept) => { actionBlock[A - kept.length + i] = r })
  return [head, ...bodyBlock, ...actionBlock, strip(page, ctx, opts)].map(r => clip(r, ctx.size.cols))
}
