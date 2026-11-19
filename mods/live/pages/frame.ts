// mods/live/pages/frame.ts — the fixed-height frame every pane page is drawn in (plan r2 §3.1, §5) and the pane's pure key table (§3.2).
// Pure: rows of segments in, rows of segments out; pane.tsx draws them. A page fills only `body` and `actions`; the frame decides every row count, so no state of a page
// (many or few cards, folded, stale, no source) can make the pane taller or shorter than `ctx.size.rows`.
//
//   row 0          header: the page name, then the most severe broken marker (staleBadge) when a source is broken
//   body rows      the page's rows, wrapped (never cut) to the width; an overflow turns the LAST row into `↓ 還有 N 列`, the total unchanged
//   A rows         the actions (at most 6 when H >= 32 else 4), directly under the body; none -> one row: `沒有待決卡`, or `資料不足，無法判定` when a source is missing or a pool's verdict is unknown
//   Spare body rows go ABOVE the content (R14): the pane keeps its fixed height and the last content row touches the actions.
//   last row       tab strip: `1 現況 2 待決 ...  i 說明` (V5: the host ✕ and band [-] close it); each tab entry carries press `tab:<digit>:<id>`; every entry 1-8, 9, 0 and i stays, the names shorten first (G7)
import type { ConsoleSnapshot } from '../console'
import type { T } from '../i18n'
import type { LiveSnapshot, Seg } from '../model'
import { displayWidth, truncateToWidth } from '../model'
import { GLYPHS, PALETTE } from '../ui'
import { PAGES } from './index'
import { STRIP_SPLIT_COLS } from './layout'
import { WRAP_HANG, brokenRow, decisionCount, poolsNeedLook, sourceMissing, staleBadge, unknownPoolCount, wrapRow } from './rows'
import type { Row } from './rows'
import type { Step } from '../speed'

export type { Row } from './rows'
export interface PageCtx { live: LiveSnapshot | null; console: ConsoleSnapshot | null; size: { cols: number; rows: number }; t: T; nowMs: number; shortBody?: boolean; steps?: readonly Step[] }
export type PageId = 'now' | 'decide' | 'fleet' | 'quota' | 'dispatch' | 'review' | 'spend' | 'hygiene' | 'pet' | 'forge' | 'help'
// `framed` (optional, additive): true once the page is filled in; pane.tsx draws a framed page through frameRows and an unframed shell the old way, so S0 changes nothing on screen
export interface Page { id: PageId; key: string; title: string; framed?: true; render(ctx: PageCtx): { body: Row[]; actions: Row[]; overflow?: true } }
// a tab the frame's strip shows next to the pages (the old tabs that still draw the old way): `key` is its digit
export type ExtraTab = { id: string; key: string; label: string }
export type FrameOpts = { scroll?: number; unfold?: (ctx: PageCtx) => { body: Row[]; actions: Row[]; overflow?: true }; pages?: readonly Page[]; extra?: readonly ExtraTab[]; active?: string }

// W1: the host already budgets pane borders and chat space. Use every allocated
// body row in either placement; a second inline cap leaves padding below the strip.
export const FRAME_MAX_ROWS = 24
export const frameHeight = (available: number, _placement: 'dock' | 'inline' = 'inline'): number => Math.max(0, available)

export const actionRows = (rows: number): number => (rows >= 32 ? 6 : 4)
// N3: the hanging indent of a body row the frame has to wrap (the cells under the left status-glyph column stay blank); rows.ts owns the number so a page can measure the same way
export { WRAP_HANG }

export { staleBadge, brokenRow }

const SEVERITY: Record<string, number> = { no_source: 3, expired: 2, stale: 1 }
// the most severe broken source of the console snapshot as one marker, null when every source is ok (the header shows it; the band's summary row takes the same one)
// `only`: the sources that count (the band: tasks, peers, cards and quota_now; the others, such as slots, metrics, answer_log and changes, are reported no_source on purpose until fleet implements them)
export function mostSevere(ctx: PageCtx, only?: readonly string[]): Seg | null {
  const sources = ctx.console === null ? [] : Object.entries(ctx.console.sources).filter(([name]) => only === undefined || only.includes(name))
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

// the one row an action area with no action says: a missing / not ok source -> 資料不足; unknown pools -> how many, beside 待決 N 張卡等你 (when pending > 0) or 沒有待決卡;
// else 待決 N 張卡等你 when pending > 0; else 沒有待決卡 when pools need a look, or 沒有要你處理的事 only when 0 pending cards, all sources ok and no unknown or needing pool
function emptyState(ctx: PageCtx, page: Page): string {
  const liveBacked = page.id === 'now' || page.id === 'decide'
  if (sourceMissing(ctx.console) || (page.id === 'fleet' && ctx.console !== null && ctx.console.lines === null) || (liveBacked && (ctx.live === null || ctx.live.state !== 'ok'))) return ctx.t('frame.unknown')
  const pending = decisionCount(ctx)
  const tail = pending > 0 ? ctx.t('page.now.go_decide', { n: pending }) : ctx.t('frame.nothing')
  const n = unknownPoolCount(ctx.console, ctx.nowMs, ctx.t)
  if (n > 0) return ctx.t('frame.unknown_pools', { n }) + '；' + tail
  if (pending > 0) return tail
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

// The host draws every hotkey Button as `<key>: <label>`, so each Button is one cell wider than its text (`1 現況` -> `1: 現況`). A Button is measured with that prefix, and every pair of
// neighbouring Buttons has a one-cell separator. Under 66 columns the strip takes 2 rows (entries 1-6 on row 1, then 7, 8, 9, 0, i on row 2); at 66+ columns it takes 1 row. Labels shorten to
// compact localized names only when a row does not fit; pet, forge and Fleet never become ambiguous action letters. No entry is dropped.
export { STRIP_SPLIT_COLS } from './layout'
import { PAGE_KEYS } from './layout'
const HOST_PREFIX = 1
const HELP_KEY = 'i'
export function stripRows(page: Page, ctx: PageCtx, opts: FrameOpts = {}): Row[] {
  const pages = opts.pages ?? PAGES
  const active = opts.active ?? page.id
  const all = [...pages.filter(p => p.id !== 'help').map(p => ({ id: p.id as string, key: PAGE_KEYS[p.id] ?? p.key, label: ctx.t('tab.' + p.id) })), ...(opts.extra ?? [])]
  const first = (s: string): string => [...s][0] ?? s
  const helpLabel = ctx.t('frame.help')
  type Form = 'full' | 'short'
  const labelOf = (x: { id?: string; label: string }, f: Form): string => (f === 'full' ? x.label : x.id === 'pet' || x.id === 'forge' || x.id === 'fleet' ? ctx.t('tab.' + x.id + '_short') : first(x.label))
  const entrySeg = (x: { id: string; key: string; label: string }, f: Form): Seg => {
    const on = x.id === active
    return { text: x.key + ' ' + labelOf(x, f), press: 'tab:' + x.key + ':' + x.id, ...(on ? { color: PALETTE.here } : {}) }
  }
  const entryW = (x: { key: string; label: string }, f: Form): number => displayWidth(x.key) + 1 + displayWidth(labelOf(x, f)) + HOST_PREFIX
  const buildEntries = (list: typeof all, f: Form): { row: Row; width: number } => ({
    row: list.flatMap((x, i) => (i === 0 ? [entrySeg(x, f)] : [{ text: ' ' }, entrySeg(x, f)])),
    width: list.reduce((w, x, i) => w + (i === 0 ? 0 : 1) + entryW(x, f), 0),
  })
  const buildWithHelp = (list: typeof all, f: Form, gap: string, help: string): { row: Row; width: number } => {
    const head = buildEntries(list, f)
    const sep = head.row.length === 0 ? '' : gap
    return {
      row: [...head.row, ...(sep === '' ? [] : [{ text: sep }]), { text: HELP_KEY + ' ' + help, dim: true }],
      width: head.width + displayWidth(sep) + displayWidth(HELP_KEY) + HOST_PREFIX + 1 + displayWidth(help),
    }
  }
  const pick = (tries: { row: Row; width: number }[]): Row => (tries.find(x => x.width <= ctx.size.cols) ?? tries[tries.length - 1]).row
  if (ctx.size.cols < STRIP_SPLIT_COLS) {
    const top = all.slice(0, 6)
    const bot = all.slice(6)
    const row1 = pick([buildEntries(top, 'full'), buildEntries(top, 'short')])
    const row2 = pick([
      buildWithHelp(bot, 'full', '  ', helpLabel),
      buildWithHelp(bot, 'short', '  ', helpLabel),
      buildWithHelp(bot, 'short', ' ', first(helpLabel)),
    ])
    return [row1, row2]
  }
  return [pick([
    buildWithHelp(all, 'full', '  ', helpLabel),
    buildWithHelp(all, 'short', '  ', helpLabel),
    buildWithHelp(all, 'short', ' ', helpLabel),
    buildWithHelp(all, 'short', ' ', first(helpLabel)),
  ])]
}

// EXACTLY ctx.size.rows rows, whatever the page returned, and the strip is always at the bottom (fixed height, PM 01M7N33J): head, padding, bottom-anchored body, actions, strip.
// Free rows go to content first: when the body is shorter than its room and the caller offers `unfold` (the page drawn with its folds open), the unfolded body is used if it fits whole.
// Only the rows that are really left over stay blank, above the body (R14); its last content row is directly above the actions.
export function frameRows(page: Page, ctx: PageCtx, opts: FrameOpts = {}): Row[] {
  const H = ctx.size.rows
  const full = actionRows(H)
  const first = page.render(ctx)
  if (first.actions.length > full) throw new Error('frame: ' + page.id + ' returned ' + first.actions.length + ' actions, the action area holds ' + full)
  if (H <= 0) return []
  const sRows = stripRows(page, ctx, opts)
  const S = sRows.length
  if (H <= S) return sRows.slice(-H).map(r => clip(r, ctx.size.cols))
  const avail = H - 1 - S
  const droppedDecideAct = first.actions.some(x => x.some(s => s.press === 'tab:2:decide'))
  const layout = (r: { body: Row[]; actions: Row[] }, short = false) => {
    const body = r.body.filter(x => x.some(s => s.text.trim() !== '')).flatMap(x => wrapRow(x, ctx.size.cols, WRAP_HANG)) // X5: spare rows belong above the content; N3: reasons keep their hanging indent
    const omitEmptyAct = short && page.id === 'now' && (droppedDecideAct || decisionCount(ctx) > 0 || body.some(x => x.some(s => s.press === 'tab:2:decide')))
    const acts: Row[] = r.actions.length === 0 ? (omitEmptyAct ? [] : [[{ text: emptyState(ctx, page), dim: true }]]) : r.actions
    return { body, acts, room: avail - Math.min(acts.length, avail), short }
  }
  let lay = layout(first, ctx.shortBody === true || avail <= 4)
  if ((lay.room <= 4 || avail <= 4) && ctx.shortBody !== true) {
    const compact = page.render({ ...ctx, shortBody: true })
    if (compact.actions.length <= full) lay = layout(compact, true)
  } else if (opts.unfold !== undefined && lay.body.length < lay.room && lay.room > 4) {
    const open = opts.unfold(ctx)
    if (open.actions.length <= full) {
      const alt = layout(open, false)
      if (alt.body.length <= alt.room && open.overflow !== true) lay = alt // Y1: a page-budgeted overflow still does not fit whole.
    }
  }
  const { body, acts, room, short } = lay
  const A = Math.min(acts.length, avail) // the action rows give way last-first only when the surface cannot hold head + actions + strip
  const head: Row = [{ text: ctx.t('tab.' + page.id) }, ...(mostSevere(ctx) === null ? [] : [{ text: '  ' }, mostSevere(ctx) as Seg])]
  let shown: Row[]
  if (body.length <= room) shown = body
  else {
    const from = Math.max(0, Math.min(opts.scroll ?? 0, body.length - room))
    if (from + room >= body.length || short || room <= 4) shown = body.slice(from, from + room) // at the end, or in short-body mode (<= 4 rows): drop the scroll hint so every row shows an item
    else {
      const keep = Math.max(0, room - 1)
      shown = [...body.slice(from, from + keep), ...(room === 0 ? [] : [[{ text: ctx.t('frame.more', { n: body.length - from - keep, arrow: GLYPHS.structure.behind }), dim: true }] as Row])]
    }
  }
  const gap: Row[] = Array.from({ length: room - shown.length }, blank)
  return [head, ...gap, ...shown, ...(A === 0 ? [] : acts.slice(-A)), ...sRows].map(r => clip(r, ctx.size.cols))
}
