// mods/live/pages/fleet.ts — page 3 艦隊 (plan r2 §2 row 3, g2 folds A5/A10/A11): the production lines (one row per line, worst first, a fold after FOLD_AT), then the hosts, from ctx.console only.
// Pure. The page contract has no state, so the focus row and the fold are inputs of `fleetView` (the pane keeps them; `Page.render` draws focus 0, folded). Enter only inspects the focused row
// (press `fleet:see:<line_id>`), Space folds (`fleet:fold`), `f` fills the prompt line (`fill:` press, never sent). A stale or expired source is red with the full reason on its own row, never cut.
import type { ConsoleLine, ConsoleSnapshot } from '../console'
import { FILL_PRESS } from '../commandtab'
import { makeT } from '../i18n'
import type { T } from '../i18n'
import type { Seg } from '../model'
import { displayWidth, truncateToWidth } from '../model'
import { GLYPHS, PALETTE, STATES, type StateId } from '../ui'
import type { Page, PageCtx } from './frame'
import { STRIP_SPLIT_COLS } from './layout'
import { WRAP_HANG, brokenRow, isBriefStale, lineState, lineTotal, staleBadge, wrapRow } from './rows'
import type { Row } from './rows'


const RULE2 = GLYPHS.structure.rule.repeat(2)
export const FOLD_AT = 6 // rows shown before the fold
export type FleetView = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: FleetView = { focus: 0, expanded: false }

const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - displayWidth(s)))
const padL = (s: string, w: number): string => ' '.repeat(Math.max(0, w - displayWidth(s))) + s
const fit = (s: string, w: number): string => (displayWidth(s) <= w ? s : truncateToWidth(s, w))

type FleetRow = { line: ConsoleLine; sid: StateId; word: string; worst: ConsoleLine['issues'][number] | null }
const RANK: Record<string, number> = { failed: 0, stalled: 1 }

export function rowsOf(lines: ConsoleLine[], t: T = makeT('zh-TW')): FleetRow[] {
  const out: FleetRow[] = lines.map(line => {
    const { sid, word, worst } = lineState(line, t)
    return { line, sid, word, worst }
  })
  const rank = (r: FleetRow): number => (r.worst === null ? 9 : RANK[r.worst.state] ?? 2)
  return out.sort((a, b) => rank(a) - rank(b) || (a.worst?.since_ms ?? Infinity) - (b.worst?.since_ms ?? Infinity) || a.line.label.localeCompare(b.line.label))
}

function age(ms: number, ctx: PageCtx): string {
  const d = Math.max(0, ctx.nowMs - ms)
  if (d >= 86_400_000) return ctx.t('page.fleet.age_day', { n: Math.floor(d / 86_400_000) })
  if (d >= 3_600_000) return ctx.t('page.fleet.age_hour', { n: Math.floor(d / 3_600_000) })
  return ctx.t('page.fleet.age_min', { n: Math.floor(d / 60_000) })
}

// the full reason of one broken source (A10: never truncated here; the frame clips only a row that is wider than the pane)
function sourceReason(ctx: PageCtx, snap: ConsoleSnapshot, name: string): string | null {
  const s = snap.sources[name]
  if (s === undefined || s.state === 'ok') return null
  const min = s.at_ms === null ? '-' : String(Math.max(0, Math.floor((ctx.nowMs - s.at_ms) / 60000)))
  const word = s.state === 'stale' ? ctx.t('page.fleet.state_stale') : s.state === 'expired' ? ctx.t('page.fleet.state_expired') : ctx.t('page.fleet.state_no_source')
  return GLYPHS.state.failed + ' ' + ctx.t('page.fleet.reason', { name, min, state: word })
}

const task = (r: FleetRow): string => (r.worst === null ? GLYPHS.structure.empty : r.worst.subject + '（' + r.worst.rule + '）')
// M4: a line with no issue record is normal, said so with the reason the detail is missing (never 閒置)
const whyOf = (r: FleetRow, ctx: PageCtx): string => (r.worst === null ? ctx.t('page.fleet.no_issue_detail') : r.worst.subject + '（' + r.worst.rule + '）')

export function fleetView(ctx: PageCtx, view: FleetView = DEFAULT_VIEW): { body: Row[]; actions: Row[] } {
  const snap = ctx.console
  const none = (): { body: Row[]; actions: Row[] } => ({ body: [brokenRow(GLYPHS.state.failed + ' ' + ctx.t('page.fleet.no_source'))], actions: [] })
  if (snap === null || snap.lines === null) return none()
  const tasks = snap.sources.tasks
  if (tasks === undefined || tasks.state === 'no_source') return none()
  const wide = ctx.size.cols >= 100
  const cols = ctx.size.cols
  const bs = isBriefStale(snap, ctx.nowMs)
  const stale = tasks.state !== 'ok' || bs.stale
  const rows = rowsOf(snap.lines, ctx.t)
  const total = Math.max(lineTotal(snap), rows.length) // the same number 現況 shows (G3); never fewer than the lines listed
  const head = rows.slice(0, Math.min(FOLD_AT, rows.length))
  const expandedNamed = Math.max(0, rows.length - head.length)
  const unlisted = Math.max(0, total - rows.length)
  const shown = view.expanded ? rows.length : head.length
  const rest = total - head.length // shown + rest = total when folded
  const focus = Math.max(0, Math.min(view.focus, Math.max(0, shown - 1)))
  const sum = snap.counts.summary.lines
  const run = sum.running ?? 0, wait = sum.waiting ?? 0, stuck = sum.stalled ?? 0
  const body: Row[] = []

  const tasksReason = sourceReason(ctx, snap, 'tasks')
  if (tasksReason !== null) body.push(brokenRow(tasksReason))
  else if (bs.stale) body.push(brokenRow(GLYPHS.state.failed + ' ' + ctx.t('page.fleet.reason', { name: 'fleet.brief', min: String(bs.min), state: ctx.t('page.fleet.state_stale') })))
  const num = (text: string, color?: Seg['color']): Seg => (stale ? staleBadge(text + GLYPHS.state.failed) : { text, ...(color === undefined ? {} : { color }) })
  // M1: the narrow summary keeps the hosts in one short note (`✗ 離線 2 台主機`), so a cut list never hides an offline host; the short body says `主機 4/6` when none is offline
  const hostNote = (): Seg[] => {
    const hs = snap.sources.hosts
    const h = snap.counts.summary.hosts
    if (hs === undefined || hs.state === 'no_source' || typeof h.online !== 'number' || typeof h.total !== 'number') return []
    const off = Math.max(0, h.total - h.online)
    if (off > 0) return [{ text: ' · ' }, { text: GLYPHS.state.failed + ' ' + ctx.t('page.fleet.hosts_off_short', { n: off }), color: PALETTE.broken }]
    return ctx.shortBody ? [{ text: ' · ' + ctx.t('page.fleet.hosts_ok_short', { online: h.online, total: h.total }) }] : []
  }
  if (!ctx.shortBody || !wide) {
    const staleNote = bs.stale ? GLYPHS.state.failed + ' ' + ctx.t('page.fleet.sum_stale', { min: bs.min, why: ctx.t('page.now.hosts_expired') }) : null
    if (wide) {
      const core: Row = [{ text: RULE2 + ' ' + ctx.t('page.fleet.lines_title', { n: total }) + '：', color: PALETTE.structure },
        { text: STATES.running.glyph + ' ' + ctx.t('page.fleet.w_run') + ' ' }, num(String(run), STATES.running.key),
        { text: '  ' + STATES.waiting.glyph + ' ' + ctx.t('page.fleet.w_wait') + ' ' }, num(String(wait), STATES.waiting.key),
        { text: '  ' + STATES.stalled.glyph + ' ' + ctx.t('page.fleet.w_stuck') + ' ' }, num(String(stuck), STATES.stalled.key)]
      if (staleNote !== null) {
        core.push(staleBadge('  ' + staleNote))
        const used = core.reduce((w, s) => w + displayWidth(s.text), 0)
        if (used + 4 <= cols) core.push({ text: ' ' + GLYPHS.structure.rule.repeat(cols - used - 1), color: PALETTE.structure })
        body.push(core)
      } else {
        core.push({ text: ' ' + GLYPHS.structure.rule.repeat(Math.max(3, cols - 56)), color: PALETTE.structure })
        body.push(core)
      }
    } else {
      const core: Row = [{ text: ctx.t('page.fleet.lines_title', { n: total }) + ' ' }, num(STATES.running.glyph + String(run), STATES.running.key), { text: ' ' }, num(STATES.waiting.glyph + String(wait), STATES.waiting.key), { text: ' ' }, num(STATES.stalled.glyph + String(stuck), STATES.stalled.key), ...hostNote()]
      if (staleNote !== null) core.push(staleBadge('  ' + staleNote))
      body.push(core)
    }
  }
  if (total === 0) body.push([{ text: ctx.t('page.fleet.none'), dim: true }])

  const wLine = 20, wState = 8, wOwner = 14, wLast = 7, wLastNarrow = 7
  if (!ctx.shortBody && wide && total > 0) body.push([{ text: '  ' + pad(ctx.t('page.fleet.col_line'), wLine + 2) + pad(ctx.t('page.fleet.col_state'), wState) + pad(ctx.t('page.fleet.col_owner'), wOwner) + pad(ctx.t('page.fleet.col_task'), Math.max(10, cols - 2 - wLine - 2 - wState - wOwner - wLast)) + padL(ctx.t('page.fleet.col_last'), wLast), color: PALETTE.structure }])
  const lineRow = (r: FleetRow, i: number): Row => {
    const st = STATES[r.sid]
    const mark = i === focus ? GLYPHS.structure.folded : ' '
    const word = r.word
    const last = r.worst === null ? GLYPHS.structure.empty : age(r.worst.since_ms, ctx)
    const press = 'fleet:see:' + r.line.line_id
    if (wide) {
      const lastText = padL((stale ? GLYPHS.state.failed : '') + last, wLast)
      const lastSeg: Seg = stale ? staleBadge(lastText) : { text: lastText, ...(st.wordKey === undefined ? {} : { color: st.wordKey }) }
      const taskW = Math.max(10, cols - 2 - 2 - wLine - wState - wOwner - wLast)
      return [{ text: mark + ' ', press }, { text: st.glyph + ' ', ...(st.key === undefined ? {} : { color: st.key }), press },
        { text: pad(fit(r.line.label, wLine), wLine), press }, { text: pad(word, wState), ...(st.wordKey === undefined ? {} : { color: st.wordKey }) },
        { text: pad(fit(r.line.lead_display ?? GLYPHS.structure.empty, wOwner - 1), wOwner) }, { text: pad(fit(task(r), taskW - 1), taskW) }, lastSeg]
    }
    const lastText = padL((stale ? GLYPHS.state.failed : '') + last, wLastNarrow)
    const lastSeg: Seg = stale ? staleBadge(lastText) : { text: lastText, ...(st.wordKey === undefined ? {} : { color: st.wordKey }) }
    const labelShown = fit(r.line.label, Math.max(8, cols - 22))
    const usedLeft = 1 + 2 + displayWidth(labelShown) + 1 + displayWidth(word) + 1
    const taskW = Math.max(2, cols - usedLeft - wLastNarrow)
    return [{ text: mark, press }, { text: st.glyph + ' ', ...(st.key === undefined ? {} : { color: st.key }), press }, { text: labelShown + ' ', press },
      { text: word + ' ', ...(st.wordKey === undefined ? {} : { color: st.wordKey }) }, { text: pad(fit(task(r), Math.max(1, taskW - 1)), taskW) }, lastSeg]
  }
  head.forEach((r, i) => body.push(lineRow(r, i)))
  if (rest > 0) {
    const foldText = unlisted === 0
      ? (view.expanded ? ctx.t('page.fleet.unfolded', { rest: expandedNamed, shown: head.length, total }) : ctx.t('page.fleet.folded', { rest: expandedNamed, shown: head.length, total }))
      : expandedNamed > 0
        ? (view.expanded ? ctx.t('page.fleet.unfolded_unlisted', { exp: expandedNamed, shown: head.length, listed: rows.length, unlisted, total }) : ctx.t('page.fleet.folded_unlisted', { exp: expandedNamed, unlisted, shown: head.length, rest, total }))
        : ctx.t('page.fleet.unlisted_only', { unlisted, shown: head.length, total })
    body.push([{ text: (wide ? '  ' : ' ') + (stale ? GLYPHS.state.failed + ' ' : '') + GLYPHS.state.pending + ' ' + foldText, color: stale ? PALETTE.broken : PALETTE.idle, ...(expandedNamed > 0 ? { press: 'fleet:fold' } : {}) }])
    if (view.expanded && expandedNamed > 0) rows.slice(FOLD_AT).forEach((r, i) => body.push(lineRow(r, FOLD_AT + i)))
  }

  // hosts: the console's own counts (summary.hosts); the per-host list is not in the parsed snapshot
  if (!ctx.shortBody) body.push(...hostsRows(ctx, snap, wide))

  const f = rows[focus]
  const actions: Row[] = []
  if (f !== undefined) {
    const label = f.line.label
    if (wide) {
      actions.push([{ text: GLYPHS.structure.folded + ' ' + ctx.t('page.fleet.focus', { label, why: whyOf(f, ctx) }), color: PALETTE.structure }])
      actions.push([{ text: (stale ? ctx.t('page.fleet.act_see_stale', { label }) : ctx.t('page.fleet.act_see', { label })), color: PALETTE.action, press: 'fleet:see:' + f.line.line_id }])
      if (rest > 0) actions.push([{ text: ctx.t('page.fleet.act_fold', { rest: expandedNamed }), color: PALETTE.action, press: 'fleet:fold' }])
      actions.push([{ text: ctx.t('page.fleet.act_nudge'), color: PALETTE.action, press: FILL_PRESS + ctx.t('page.fleet.nudge_text', { label, why: whyOf(f, ctx) }) }])
    } else {
      // R10: at 80x24 (< 100 cols), o/z/f actions share one row `o 看 · z 展開 · f 催辦` with each a clickable Button with a non-empty label
      actions.push([
        { text: ctx.t(stale ? 'page.fleet.act_see_c_stale' : 'page.fleet.act_see_c'), color: PALETTE.action, press: 'fleet:see:' + f.line.line_id },
        { text: ' · ', dim: true },
        { text: ctx.t(view.expanded && expandedNamed > 0 ? 'page.fleet.act_fold_c_open' : 'page.fleet.act_fold_c'), color: PALETTE.action, press: 'fleet:fold' },
        { text: ' · ', dim: true },
        { text: ctx.t('page.fleet.act_nudge_c'), color: PALETTE.action, press: FILL_PRESS + ctx.t('page.fleet.nudge_text', { label, why: whyOf(f, ctx) }) },
      ])
    }
  }
  // M1: a short body (<= 4 rows) that cannot hold every row ends in `↓ 還有 N 項` instead of dropping rows without a word (the frame drops its own hint in short mode)
  if (ctx.shortBody === true) {
    const stripLen = cols < STRIP_SPLIT_COLS ? Math.min(2, ctx.size.rows) : Math.min(1, ctx.size.rows)
    const avail = Math.max(0, ctx.size.rows - 1 - stripLen)
    const room = Math.max(0, avail - Math.min(Math.max(1, actions.length), avail))
    const flat = body.flatMap(r => wrapRow(r, cols, WRAP_HANG))
    if (room >= 2 && flat.length > room) {
      const keep = flat.slice(0, room - 1)
      return { body: [...keep, [{ text: (wide ? '  ' : ' ') + ctx.t('page.fleet.more_items', { n: flat.length - keep.length, arrow: GLYPHS.structure.behind }), color: stale ? PALETTE.broken : PALETTE.idle }]], actions }
    }
  }
  return { body, actions }
}

function hostsRows(ctx: PageCtx, snap: ConsoleSnapshot, wide: boolean): Row[] {
  const hosts = snap.sources.hosts
  if (hosts === undefined || hosts.state === 'no_source') return [[], brokenRow(GLYPHS.state.failed + ' ' + ctx.t('page.fleet.hosts_no_source'))].filter(r => r.length > 0)
  const h = snap.counts.summary.hosts
  const reason = sourceReason(ctx, snap, 'hosts')
  const stale = reason !== null
  const online = h.online ?? 0, total = h.total ?? 0
  const title = ctx.t('page.fleet.hosts_title', { online, total })
  const out: Row[] = []
  if (reason !== null) out.push(brokenRow(reason))
  out.push([{ text: RULE2 + ' ' + title + ' ' + GLYPHS.structure.rule.repeat(wide ? Math.max(3, ctx.size.cols - 8 - displayWidth(title)) : 2), color: stale ? PALETTE.broken : PALETTE.structure }])
  const offline = Math.max(0, total - online)
  out.push([{ text: '  ' }, ...(offline > 0 ? [{ text: STATES.failed.glyph + ' ' + ctx.t('page.fleet.hosts_off', { n: offline }) + '  ', color: PALETTE.broken }] : []),
    { text: ctx.t('page.fleet.hosts_gpu', { busy: h.gpu_busy ?? 0, total: h.gpu_total ?? 0 }), ...(stale ? { color: PALETTE.broken } : {}) }])
  return out
}

export const fleetPage: Page = { id: 'fleet', key: '3', title: '艦隊', framed: true, render: ctx => fleetView(ctx) }
