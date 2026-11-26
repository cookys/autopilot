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
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { PAGES } from './index'
import { ageUnit } from './now'
import { DECIDE_COMPACT_MAX_ROWS, PAGE_KEYS, STRIP_SPLIT_COLS, TINY_FRAME_ROWS, V74_STRIP_ORDER, actionRows, decideFullWidth, decideLayoutMode } from './layout'
import type { DecideLayoutMode } from './layout'
import { V74_KEY } from '../v74/contract'
import { WRAP_HANG, brokenRow, decisionCount, poolsNeedLook, sourceMissing, staleBadge, unknownPoolCount, wrapRow } from './rows'
import type { Row } from './rows'
import type { Step } from '../speed'
import type { MeterPack } from './metering'
import type { PoolEta } from './spend'
import type { V74Ctx } from '../v74/contract'
import type { ScrollModel } from '../scrollmath'

export type PendingScroll = { list: ScrollModel; detail: ScrollModel; cursor: string }

export type { Row } from './rows'
export interface PageCtx { pendingScroll?: PendingScroll; poolEta?: PoolEta | null; meter?: MeterPack | null; room?: readonly { seq: number; from: string; kind: string; text: string }[]; live: LiveSnapshot | null; console: ConsoleSnapshot | null; size: { cols: number; rows: number }; bodyColumns?: number; maxRows?: number; t: T; nowMs: number; shortBody?: boolean; steps?: readonly Step[]; pet?: unknown; v74?: V74Ctx; box?: true; decide?: { cursor?: number; picks?: Record<string, number>; notes?: Record<string, string>; textMode?: boolean; snap?: string; stale?: boolean; armed?: boolean; bgOpen?: boolean; style?: 'D' | 'C'; layoutMode?: DecideLayoutMode | null; compactExpanded?: boolean } } // box: drawn inside the v7.4 band frame (not the host Pane)
export type PageId = 'now' | 'decide' | 'fleet' | 'quota' | 'dispatch' | 'review' | 'spend' | 'hygiene' | 'pet' | 'room' | 'forge' | 'help' | 'todo'
// `framed` (optional, additive): true once the page is filled in; pane.tsx draws a framed page through frameRows and an unframed shell the old way, so S0 changes nothing on screen
export interface Page { id: PageId; key: string; title: string; framed?: true; render(ctx: PageCtx): { body: Row[]; actions: Row[]; overflow?: true } }
// a tab the frame's strip shows next to the pages (the old tabs that still draw the old way): `key` is its digit
export type ExtraTab = { id: string; key: string; label: string }
export type BodyWindow = { from: number; max: number; room: number } // the body window of the last frame: where it stands, the largest legal offset (0 = the body is not cut), the rows it shows
export type FrameOpts = { topAnchor?: true; scroll?: number; onWindow?: (w: BodyWindow) => void; unfold?: (ctx: PageCtx) => { body: Row[]; actions: Row[]; overflow?: true }; pages?: readonly Page[]; extra?: readonly ExtraTab[]; active?: string; askRows?: readonly Row[] }

// W1: the host already budgets pane borders and chat space. Use every allocated
// body row in either placement; a second inline cap leaves padding below the strip.
export const FRAME_MAX_ROWS = 24
export const ASK_BAND_MIN_AVAIL = 14
export const frameHeight = (available: number, _placement: 'dock' | 'inline' = 'inline'): number => Math.max(0, available)

export { actionRows }
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
const HOST_PREFIX = 1

const V74_BORDER_KEY: Record<string, string> = {
  now: 'v74.b.border.now', decide: 'v74.b.border.decide', dispatch: 'v74.b.border.dispatch', review: 'v74.b.border.review',
  spend: 'v74.b.border.spend', hygiene: 'v74.b.border.hygiene', fleet: 'v74.b.border.fleet', todo: 'v74.b.border.todo',
  help: 'v74.b.border.help', pet: 'v74.b.border.pet', quota: 'v74.b.border.quota', forge: 'v74.b.border.default',
}

// design-narrow: the short form of the hint keeps every key class (move, pick, send, Esc) and drops only the words and the ctrl+x tab clause
const V74_SHORT_KEY: Record<string, string> = {
  decide: 'v74.b.short.decide', todo: 'v74.b.short.todo', pet: 'v74.b.short.pet',
  now: 'v74.b.short.scroll', dispatch: 'v74.b.short.scroll', review: 'v74.b.short.scroll', spend: 'v74.b.short.scroll', hygiene: 'v74.b.short.scroll',
  fleet: 'v74.b.short.scroll', help: 'v74.b.short.scroll', quota: 'v74.b.short.scroll', forge: 'v74.b.short.scroll',
}
// the keyboard state is words, not colour: `ctrl+x tab` until a key reached the pane, `keys in pane` after
const keysWord = (ctx: PageCtx): string => (ctx.v74?.keysHeld === true ? ctx.t('v74.b.keys_held') : ctx.t('v74.b.keys_take'))
// r8 #10: a card page with no cards (no source, or an empty list) has nothing to pick or send: its hint is the scroll hint, not `a/b/c · s`
const cardless = (page: Page, ctx: PageCtx): boolean => (page.id === 'decide' || page.id === 'todo') && ctx.v74 !== undefined && (ctx.v74[page.id] ?? []).length === 0
// r11 #4: while the send preview is up, Esc means one thing (cancel the preview), so the border says so and nothing else
const armed = (page: Page, ctx: PageCtx): boolean => page.id === 'decide' && ctx.decide?.armed === true && !cardless(page, ctx)
const bgOpen = (page: Page, ctx: PageCtx): boolean => page.id === 'decide' && ctx.decide?.bgOpen === true && !cardless(page, ctx)
const compactDecide = (page: Page, ctx: PageCtx): boolean =>
  page.id === 'decide' && ctx.v74 !== undefined && ctx.box === true && (ctx.maxRows ?? ctx.size.rows) < DECIDE_COMPACT_MAX_ROWS && ctx.decide?.compactExpanded !== true && !cardless(page, ctx)
const styleC = (page: Page, ctx: PageCtx): boolean => page.id === 'decide' && ctx.decide?.style === 'C' && !cardless(page, ctx)
export const frameHintText = (page: Page, ctx: PageCtx): string => armed(page, ctx) ? ctx.t('v74.b.border.armed') : bgOpen(page, ctx) ? ctx.t('v74.b.border.decide_bg', { ud: GLYPHS.structure.up + GLYPHS.structure.behind }) : compactDecide(page, ctx) ? ctx.t('v74.b.border.decide_compact', { ud: GLYPHS.structure.up + GLYPHS.structure.behind, keys: keysWord(ctx) }) : styleC(page, ctx) ? ctx.t('v74.b.border.decide_c', { keys: keysWord(ctx) }) : ctx.t(cardless(page, ctx) ? 'v74.b.border.cardless' : V74_BORDER_KEY[page.id] ?? 'v74.b.border.default', { ud: GLYPHS.structure.up + GLYPHS.structure.behind, keys: keysWord(ctx) })
export const frameHintShort = (page: Page, ctx: PageCtx): string => armed(page, ctx) ? ctx.t('v74.b.short.armed') : bgOpen(page, ctx) ? ctx.t('v74.b.short.decide_bg', { ud: GLYPHS.structure.up + GLYPHS.structure.behind }) : compactDecide(page, ctx) ? ctx.t('v74.b.short.decide_compact', { ud: GLYPHS.structure.up + GLYPHS.structure.behind }) : styleC(page, ctx) ? ctx.t('v74.b.short.decide_c') : ctx.t(cardless(page, ctx) ? 'v74.b.short.scroll' : V74_SHORT_KEY[page.id] ?? 'v74.b.short.scroll', { ud: GLYPHS.structure.up + GLYPHS.structure.behind })
export const frameHintMin = (page: Page, ctx: PageCtx): string => armed(page, ctx) || bgOpen(page, ctx) || cardless(page, ctx) ? '' : compactDecide(page, ctx) ? ctx.t('v74.b.min.decide_compact') : styleC(page, ctx) ? ctx.t('v74.b.min.decide_c') : page.id === 'decide' ? ctx.t('v74.b.min.decide') : ''
export function frameBorderRow(page: Page, ctx: PageCtx): Row {
  const lead = GLYPHS.structure.frameBL + GLYPHS.structure.rule + ' '
  const avail = Math.max(0, ctx.size.cols - displayWidth(lead))
  const full = frameHintText(page, ctx)
  if (displayWidth(full) <= avail) return [{ text: lead + full, dim: true }]
  // Narrow frames drop secondary clauses first rather than letting clip() emit `…`.
  const keys = keysWord(ctx)
  const withoutKeys = full.replace(' · ' + keys, '').replace(keys + ' · ', '')
  if (withoutKeys !== full && displayWidth(withoutKeys) <= avail) return [{ text: lead + withoutKeys, dim: true }]
  const short = frameHintShort(page, ctx)
  if (displayWidth(short) <= avail) return [{ text: lead + short, dim: true }]
  const min = frameHintMin(page, ctx)
  if (min !== '' && displayWidth(min) <= avail) return [{ text: lead + min, dim: true }]
  return [{ text: GLYPHS.structure.frameBL + GLYPHS.structure.rule, dim: true }]
}

// PM 01M7XB0B: one bottom border. Hints on the left, page tabs on the right, the current page marked.
// Short width: shorten the hint first, then tabs become digits (the current page keeps its name). Never a second row.
export type BorderTab = { key: string; id: string; text: string }
const RULE_MIN = 8 // dashes the bottom border keeps between the hint and the tabs before the names are given up
export const TAB_GAP = 2 // blanks between two tabs of the bottom border (design)
export function frameBottomFit(cols: number, hintFull: string, hintShort: string, tabs: readonly BorderTab[], active: string, hintMin = ''): { hint: string; tabs: BorderTab[] } {
  const digits = tabs.map(x => ({ ...x, text: x.id === active ? x.key + ' ' + x.text.replace(/^\d+\s+/, '') : x.key }))
  const fullTabs = tabs.map(x => ({ ...x, text: x.text }))
  // design (narrow sheet): `╰─  <hint>  ────  1 現況  2 待決 … 9 說明  ─╯`: two blanks around the hint, at least two dashes, two blanks between tabs and at both ends of them
  const chrome = 2 + 2 + 2 + 2 + 2 + 2 + 2 // ╰─, blanks, blanks, two dashes, blanks, blanks, ─╯
  const tabW = (list: readonly BorderTab[]): number => list.reduce((n, x, i) => n + (i === 0 ? 0 : TAB_GAP) + displayWidth(x.text), 0)
  const fits = (hint: string, list: readonly BorderTab[]): boolean => chrome + displayWidth(hint) + tabW(list) <= cols
  // r10 #1: when the full hint and every name do not fit, the shortest hint stays and the tabs become digits (the current page keeps its name); the hint goes only when even that does not fit.
  if (fits(hintFull, fullTabs)) return { hint: hintFull, tabs: fullTabs }
  // the shortest hint keeps every name only while the border still shows a readable rule (RULE_MIN dashes); on a tighter border the names give way, not the hint
  if (chrome + displayWidth(hintShort) + tabW(fullTabs) + RULE_MIN <= cols) return { hint: hintShort, tabs: fullTabs }
  for (const hint of [hintShort, ...(hintMin !== '' ? [hintMin] : []), '']) {
    if (fits(hint, digits)) return { hint, tabs: digits }
  }
  return { hint: '', tabs: digits }
}

export function stripRows(page: Page, ctx: PageCtx, opts: FrameOpts = {}): Row[] {
  const pages = opts.pages ?? PAGES
  const byId = new Map(pages.map(p => [p.id, p]))
  const active = opts.active ?? page.id
  const all = V74_STRIP_ORDER.filter(id => byId.has(id)).map(id => ({
    id,
    key: PAGE_KEYS[id] ?? V74_KEY[id as keyof typeof V74_KEY] ?? byId.get(id)!.key,
    label: ctx.t('tab.' + id),
  }))
  const first = (s: string): string => [...s][0] ?? s
  type Form = 'full' | 'short'
  const labelOf = (x: { id: string; label: string }, f: Form): string =>
    (f === 'full' ? x.label : x.id === 'pet' || x.id === 'fleet' ? ctx.t('tab.' + x.id + '_short') : first(x.label))
  const entrySeg = (x: { id: string; key: string; label: string }, f: Form): Seg => {
    const on = x.id === active
    return { text: x.key + ' ' + labelOf(x, f), press: 'tab:' + x.key + ':' + x.id, ...(on ? { color: PALETTE.here } : {}) }
  }
  const entryW = (x: { key: string; label: string; id: string }, f: Form): number =>
    displayWidth(x.key) + 1 + displayWidth(labelOf(x, f)) + HOST_PREFIX
  const buildEntries = (list: typeof all, f: Form): { row: Row; width: number } => ({
    row: list.flatMap((x, i) => (i === 0 ? [entrySeg(x, f)] : [{ text: ' ' }, entrySeg(x, f)])),
    width: list.reduce((w, x, i) => w + (i === 0 ? 0 : 1) + entryW(x, f), 0),
  })
  const pick = (tries: { row: Row; width: number }[]): Row => (tries.find(x => x.width <= ctx.size.cols) ?? tries[tries.length - 1]).row
  const withPet = (list: typeof all) => (ctx.size.cols >= STRIP_SPLIT_COLS ? list : list)
  if (ctx.size.cols < STRIP_SPLIT_COLS) {
    const full = withPet(all)
    const top = full.slice(0, 6)
    const bot = full.slice(6)
    const row1 = pick([buildEntries(top, 'full'), buildEntries(top, 'short')])
    const row2 = pick([buildEntries(bot, 'full'), buildEntries(bot, 'short')])
    return [row1, row2]
  }
  const one = withPet(all)
  return [pick([buildEntries(one, 'full'), buildEntries(one, 'short')])]
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
  const borderRow = frameBorderRow(page, ctx)
  const sRows = stripRows(page, ctx, opts)
  const foot = H <= TINY_FRAME_ROWS ? sRows : [borderRow, ...sRows] // at 3 rows (the host's 80x16 inline allocation) the key-hint border row gives its place to content: head + 1 content row + strip, so the most severe class stays visible
  const S = foot.length
  if (H <= S) return foot.slice(-H).map(r => clip(r, ctx.size.cols))
  const avail = H - 1 - S
  // the PM-asks band sits directly above the action rows; it is dropped when the surface is too short to keep a readable body (the 80x16 inline allocation)
  const askRows: Row[] = avail >= ASK_BAND_MIN_AVAIL ? [...(opts.askRows ?? [])] : []
  const droppedDecideAct = first.actions.some(x => x.some(s => s.press === 'tab:2:decide'))
  const layout = (r: { body: Row[]; actions: Row[] }, short = false) => {
    const read = page.id === 'decide' || page.id === 'todo' || page.id === 'help'
    // Dual-column decide (renderBoxD) and compact list (renderBoxCompactList) already lay out to exact ctx.size.cols; wrapping at 80 splits rows in half and hides bottom scroll hints.
    const bodyCols = ctx.bodyColumns ?? ctx.size.cols
    const effMaxRows = ctx.maxRows ?? ctx.size.rows
    const fullWidthDecide = page.id === 'decide' && decideFullWidth({ boxed: ctx.v74 !== undefined && ctx.box === true, effMaxRows, compactExpanded: ctx.decide?.compactExpanded === true, bodyCols, layoutMode: ctx.decide?.layoutMode ?? null, styleC: styleC(page, ctx) })
    const body = r.body.filter(x => read || x.some(s => s.text.trim() !== '')).flatMap(x => {
      if (opts.topAnchor === true && x.map(s => s.text).join('').trimStart().startsWith(GLYPHS.structure.open + ' ') && x.map(s => s.text).join('').trimEnd().endsWith(GLYPHS.structure.rule)) { // only section rules (they end in ─); a ▾ legend row is text
        const row = x.map(s => ({ ...s }))
        const last = row[row.length - 1]
        last.text = last.text.replace(new RegExp(' *' + GLYPHS.structure.rule + '+$'), '').trimEnd() + ' '
        const width = row.reduce((n, s) => n + displayWidth(s.text), 0)
        last.text += GLYPHS.structure.rule.repeat(Math.max(0, ctx.size.cols - width))
        return wrapRow(row, ctx.size.cols, WRAP_HANG)
      }
      const joined = x.map(s => s.text).join('')
      const lead = /^ */.exec(joined)?.[0].length ?? 0
      const width = read && !fullWidthDecide ? Math.min(80, ctx.size.cols) : ctx.size.cols
      const hang = read ? Math.max(WRAP_HANG, Math.min(lead, Math.max(0, width - 4))) : WRAP_HANG
      return wrapRow(x, width, hang)
    })
    while (read && body.length > 0 && body[body.length - 1].every(s => s.text.trim() === '')) body.pop() // a blank between options stays; the row that touches the actions does not
    // X5: spare rows belong above the content; N3: reasons keep their hanging indent. Reading pages (待決、待辦、說明) wrap at 70–80 columns.
    const omitEmptyAct = short && page.id === 'now' && (droppedDecideAct || decisionCount(ctx) > 0 || body.some(x => x.some(s => s.press === 'tab:2:decide')))
    const acts: Row[] = opts.topAnchor === true
      ? r.actions.filter(row => row.some(s => s.press !== undefined) || row.map(s => s.text).join('').trim() !== ctx.t('frame.unknown'))
      : r.actions.length === 0 ? (omitEmptyAct ? [] : [[{ text: emptyState(ctx, page), dim: true }]]) : r.actions
    return { body, acts, room: avail - Math.min(acts.length, avail) - askRows.length, short }
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
  const hinted = !short && room > 4 // a window with room for hint rows; a short one (<= 4 rows) shows items only
  const maxFrom = body.length <= room ? 0 : hinted ? body.length - room + 1 : body.length - room // the end of a hinted window keeps its `↑ more` row, so it stands one row further
  const from = Math.max(0, Math.min(opts.scroll ?? 0, maxFrom))
  opts.onWindow?.({ from, max: maxFrom, room })
  if (body.length <= room) shown = body
  else if (!hinted) shown = body.slice(from, from + room) // short-body mode (<= 4 rows): drop the scroll hints so every row shows an item
  else {
    const up: Row[] = from > 0 ? [[{ text: ctx.t('frame.more', { n: from, arrow: GLYPHS.structure.up }), dim: true }]] : []
    const avail = room - up.length
    if (from + avail >= body.length) shown = [...up, ...body.slice(from, from + avail)] // at the end: only the `↑ more` row remains
    else {
      const keep = Math.max(0, avail - 1)
      shown = [...up, ...body.slice(from, from + keep), [{ text: ctx.t('frame.more', { n: body.length - from - keep, arrow: GLYPHS.structure.behind }), dim: true }] as Row]
    }
  }
  const gap: Row[] = Array.from({ length: room - shown.length }, blank)
  const actRows = A === 0 ? [] : acts.slice(-A)
  // v7.4 box: the content starts on the first body row, the spare rows sit between it and the action rows (design S2/S3/S9)
  if (opts.topAnchor === true) return [head, ...shown, ...gap, ...askRows, ...actRows, ...foot].map(r => clip(r, ctx.size.cols))
  return [head, ...gap, ...shown, ...askRows, ...actRows, ...foot].map(r => clip(r, ctx.size.cols))
}

// v7.4 top border title: clean design title (page name, source, schema, optional age) with NO warnings in the border (design S1-S10).
// Stale (>5m), failure/no-source reasons, last-success age, and console source warnings live inside the page on the first body row (v74BodyStatusRow).
export const V74_STALE_MS = 5 * 60_000
const V74_STALE_MIN = 5
const V74_IGNORED_CONSOLE_SOURCES = new Set(['slots', 'metrics', 'answer_log', 'changes'])

export const V74_SOURCES: Record<string, [string, string]> = {
  now: ['fleet pm status --json', 'fleet.pm.status v1'],
  decide: ['fleet decisions list --json', 'fleet.decisions v1'],
  dispatch: ['autopilot status runs --json', 'autopilot.runs v1'],
  review: ['autopilot status review --json', 'autopilot.review v1'],
  spend: ['codeforge usage summary --json', 'usage.summary v1'],
  quota: ['fleet console --json', 'fleet.console v1'],
  hygiene: ['autopilot hygiene --json', 'autopilot.hygiene v1'],
  fleet: ['fleet tasks --tree --json', 'fleet.tasks v1'],
  todo: ['fleet todo --json', 'fleet.todo v1'],
}

type TitleFailure = { kind: 'failed' | 'nosrc'; reason: string | null }

function v74ConsoleSevere(ctx: PageCtx): Seg | null {
  if (ctx.console === null || ctx.console === undefined || ctx.console.sources === undefined || ctx.console.sources === null) return null
  const liveKeys = Object.keys(ctx.console.sources).filter(k => !V74_IGNORED_CONSOLE_SOURCES.has(k))
  return liveKeys.length === 0 ? null : mostSevere(ctx, liveKeys)
}

function v74PageFailure(page: Page, ctx: PageCtx): TitleFailure | null {
  const errOf = (k: string): string | null => {
    const v = ctx.v74?.errors?.[k]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  }
  const liveWhy = (): string | null => {
    const h = ctx.live?.header?.trim() ?? ''
    return h !== '' ? h : (ctx.live?.state ?? null)
  }
  switch (page.id) {
    case 'now': {
      const err = errOf('now') ?? (ctx.v74?.pmError?.trim() || null)
      if (err !== null) return { kind: 'failed', reason: err }
      if (ctx.v74 !== undefined && ctx.v74.pm === null) return { kind: 'failed', reason: null }
      return null
    }
    case 'decide': {
      const err = errOf('decide') ?? (ctx.v74?.decideError?.trim() || null)
      if (err !== null) return { kind: 'failed', reason: err }
      if (ctx.v74 !== undefined && ctx.v74.decide === null) return { kind: 'failed', reason: null }
      return null
    }
    case 'todo': {
      const err = errOf('todo')
      if (err !== null) return { kind: 'failed', reason: err }
      if (ctx.v74 !== undefined && ctx.v74.todo === null) return { kind: 'failed', reason: null }
      return null
    }
    case 'spend':
    case 'quota': {
      const err = errOf(page.id)
      if (err !== null) return { kind: 'failed', reason: err }
      if (ctx.console === null) return { kind: 'failed', reason: null }
      return null
    }
    case 'dispatch': {
      const err = errOf('dispatch')
      if (err !== null) return { kind: 'failed', reason: err }
      if (ctx.live === null) return { kind: 'nosrc', reason: ctx.t('v74.c.reason_no_live') }
      if (ctx.live.state !== 'ok' && ctx.live.state !== 'stale') return { kind: 'nosrc', reason: liveWhy() }
      if (ctx.live.rows === null) return { kind: 'nosrc', reason: ctx.t('v74.c.reason_no_runs') }
      return null
    }
    case 'review': {
      const err = errOf('review')
      if (err !== null) return { kind: 'failed', reason: err }
      if (ctx.live === null) return { kind: 'nosrc', reason: ctx.t('v74.c.reason_no_live') }
      if (ctx.live.state !== 'ok' && ctx.live.state !== 'stale') return { kind: 'nosrc', reason: liveWhy() }
      return null
    }
    case 'hygiene': {
      const err = errOf('hygiene')
      if (err !== null) return { kind: 'failed', reason: err }
      if (ctx.live === null) return { kind: 'nosrc', reason: ctx.t('v74.c.reason_no_live') }
      if (ctx.live.state !== 'ok' && ctx.live.state !== 'stale') return { kind: 'nosrc', reason: liveWhy() }
      if (ctx.live.detail?.residue === null && ctx.live.detail?.load_source === null) return { kind: 'nosrc', reason: ctx.t('v74.c.reason_no_hygiene') }
      return null
    }
    case 'fleet': {
      const err = errOf('fleet') ?? (ctx.v74?.fleetError?.trim() || null)
      if (err !== null) return { kind: 'failed', reason: err }
      if (ctx.live === null) return { kind: 'nosrc', reason: ctx.t('v74.c.reason_no_live') }
      if (ctx.live.state !== 'ok' && ctx.live.state !== 'stale') return { kind: 'nosrc', reason: liveWhy() }
      if (ctx.live.rows === null) return { kind: 'nosrc', reason: ctx.t('v74.c.reason_no_runs') }
      if (ctx.v74 !== undefined && ctx.v74.decide === null) return { kind: 'failed', reason: errOf('decide') ?? (ctx.v74.decideError?.trim() || null) }
      return null
    }
    default:
      return null
  }
}

const segsWidth = (segs: readonly Seg[]): number => segs.reduce((n, s) => n + displayWidth(s.text), 0)

function v74PageAgeMs(page: Page, ctx: PageCtx): number | null {
  const published = ctx.live?.published_at
  const publishedMs = typeof published === 'string' && Number.isFinite(Date.parse(published)) ? Date.parse(published) : null
  const consoleAt = ctx.console !== null && ctx.console !== undefined && ctx.console.generated_at_ms > 0 ? ctx.console.generated_at_ms : null
  const fetched = ctx.v74?.ages?.[page.id]
    ?? (page.id === 'now' ? ctx.v74?.pmFetchedMs ?? null
      : page.id === 'decide' ? ctx.v74?.decideFetchedMs ?? null
      : page.id === 'dispatch' || page.id === 'review' || page.id === 'hygiene' ? publishedMs
      : page.id === 'spend' || page.id === 'quota' ? consoleAt
      : page.id === 'fleet' ? publishedMs
      : null)
  return fetched === null || fetched === undefined ? null : Math.max(0, ctx.nowMs - fetched)
}

export function v74TitleSegs(page: Page, ctx: PageCtx, name: Seg, maxCols?: number): Seg[] {
  const { t } = ctx
  if (page.id === 'decide') {
    const ageMs = v74PageAgeMs(page, ctx)
    const out: Seg[] = ageMs === null ? [name] : [name, { text: ' · ' + t('v74.c.decide_updated', { n: Math.floor(ageMs / 1000) }), dim: true }]
    return maxCols === undefined ? out : maxCols <= 0 ? [] : clip(out, maxCols)
  }
  const src = V74_SOURCES[page.id]
  if (src === undefined) {
    const out: Seg[] = [name, { text: ' · ' + t('v74.c.help_src'), dim: true }]
    return maxCols === undefined ? out : maxCols <= 0 ? [] : clip(out, maxCols)
  }
  const ageMs = v74PageAgeMs(page, ctx)
  const failure = v74PageFailure(page, ctx)
  const failed = failure?.kind === 'failed'
  const fullSrc: Seg = {
    text: ' · ' + (failed
      ? t('v74.c.header_failed', { source: src[0], schema: src[1] })
      : ageMs !== null
        ? t('v74.c.header', { source: src[0], schema: src[1], age: ageUnit(t, ageMs) })
        : t('v74.c.header_noage', { source: src[0], schema: src[1] })),
    dim: true,
  }
  if (maxCols === undefined) return [name, fullSrc]
  if (maxCols <= 0) return []
  if (segsWidth([name, fullSrc]) <= maxCols) return [name, fullSrc]

  const tailSeg: Seg | null = failed
    ? { text: ' · ' + t('v74.c.title_failed'), dim: true }
    : ageMs === null
      ? null
      : { text: ' · ' + ageUnit(t, ageMs), dim: true }
  const shortSrc: Seg = { text: ' · ' + src[0], dim: true }
  const compact: Seg[] = tailSeg === null ? [name, shortSrc] : [name, shortSrc, tailSeg]
  if (segsWidth(compact) <= maxCols) return compact

  const tailW = tailSeg === null ? 0 : displayWidth(tailSeg.text)
  const remForSrc = maxCols - displayWidth(name.text) - tailW
  if (remForSrc >= 6) {
    const mid: Seg = { text: ' · ' + truncateToWidth(src[0], remForSrc - 3), dim: true }
    return tailSeg === null ? [name, mid] : [name, mid, tailSeg]
  }
  return clip(tailSeg === null ? [name] : [name, tailSeg], maxCols)
}

// First body row inside the v7.4 box when a source is stale (>5m or live.state=stale), failed/missing, or has a console source warning.
// Returns null when the page's data is healthy and fresh so normal pages keep their exact layout and never put warnings in the border.
export function v74BodyStatusRow(page: Page, ctx: PageCtx, maxCols?: number): Row | null {
  const { t } = ctx
  if (V74_SOURCES[page.id] === undefined) return null
  const ageMs = v74PageAgeMs(page, ctx)
  const failure = v74PageFailure(page, ctx)
  const liveBacked = page.id === 'dispatch' || page.id === 'review' || page.id === 'hygiene' || page.id === 'fleet'
  const liveStale = liveBacked && ctx.live?.state === 'stale'
  const isStale = (ageMs !== null && ageMs > V74_STALE_MS) || liveStale
  const severe = v74ConsoleSevere(ctx)
  if (failure === null && !isStale && severe === null) return null

  const tailSegs: Seg[] = []
  if (failure !== null) {
    const failBody = failure.kind === 'failed'
      ? (failure.reason === null ? t('v74.c.title_failed') : t('v74.c.title_failed_why', { reason: failure.reason }))
      : GLYPHS.state.failed + ' ' + (failure.reason === null ? t('v74.c.title_nosrc') : t('v74.c.title_nosrc_why', { reason: failure.reason }))
    tailSegs.push({ text: failBody, color: PALETTE.broken })
    if (isStale) {
      const staleText = ageMs !== null
        ? t('v74.c.title_stale', { age: ageUnit(t, ageMs), min: V74_STALE_MIN })
        : t('v74.c.title_stale_noage', { min: V74_STALE_MIN })
      tailSegs.push({ text: ' · ', dim: true })
      tailSegs.push({ text: GLYPHS.state.stale + ' ' + staleText, color: PALETTE.attention })
    } else if (ageMs !== null) {
      tailSegs.push({ text: ' · ' + t('v74.c.title_last_ok', { age: ageUnit(t, ageMs) }), dim: true })
    }
  } else if (isStale) {
    const staleText = ageMs !== null
      ? t('v74.c.title_stale', { age: ageUnit(t, ageMs), min: V74_STALE_MIN })
      : t('v74.c.title_stale_noage', { min: V74_STALE_MIN })
    tailSegs.push({ text: GLYPHS.state.stale + ' ' + staleText, color: PALETTE.attention })
  }

  const all: Seg[] = severe === null
    ? tailSegs
    : tailSegs.length === 0
      ? [severe]
      : [...tailSegs, { text: ' · ', dim: true }, severe]

  if (maxCols === undefined) return all
  if (maxCols <= 0) return []
  if (segsWidth(all) <= maxCols) return all

  const tailW = segsWidth(tailSegs)
  if (severe !== null && tailSegs.length > 0 && tailW <= maxCols) {
    const remSev = maxCols - tailW - 3
    if (remSev >= 4) return [...tailSegs, { text: ' · ', dim: true }, { ...severe, text: truncateToWidth(severe.text, remSev) }]
    return tailSegs
  }
  if (tailSegs.length >= 2) {
    const suffix = tailSegs.slice(1)
    const suffixW = segsWidth(suffix)
    const remFail = maxCols - suffixW
    if (remFail >= 6) {
      return [{ ...tailSegs[0], text: truncateToWidth(tailSegs[0].text, remFail) }, ...suffix]
    }
  }
  return clip(all, maxCols)
}
