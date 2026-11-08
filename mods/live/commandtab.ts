// mods/live/commandtab.ts — the operator console's 指揮 page (plan §3.1, §3.3, §3.5): summary line, exceptions, the decision queue, then the data-age line, the send row and the key
// hint fixed at the bottom. Pure: the snapshots come in as arguments (the console feed, the live snapshot for the cards the host really holds), no `$`, no engine, no file, no clock
// (`now` is passed). Every number is `counts` from the feed or the age of a timestamp; this file counts nothing itself. Lines are made by ui.ts components only.
//
// Which items are drawn is the feed's decision, not this file's: an exception or quota item shows only when `to_console === true`; a card item is never drawn from `items`
// (the queue comes from `cards`). A card from another host, seen through the mirror, is not a card here: the feed turns it into a T7 exception item, drawn in the exceptions.
// The cards the live snapshot holds (`pending`) are drawn by decideCards (options, background, note field, send row); a console card the host does not hold is a plain row.

import type { ConsoleCard, ConsoleItem, ConsoleSnapshot } from './console'
import { cardTitleOf } from './cardtitle'
import type { LiveSnapshot, PaneCtx, PaneLine } from './model'
import { consoleDecideCards } from './tabs'
import * as ui from './ui'
import type { Ctx as UiCtx, Frag } from './ui'

const F = 'decide.cards' as const
const C = 'pane.chrome' as const
export const COMMAND_EXC_ID = 'sec:console.exceptions'
export const COMMAND_QUEUE_ID = 'sec:console.queue'
// the press id of a waiting_step card's report button; register.ts fills the prompt box with the report text (it does not submit)
export const FILL_PRESS = 'fill:'

export type CommandView = { body: PaneLine[]; bar: PaneLine[] }

// "N 秒前" .. "N 天前": the unit by size, the number tagged as an age
export function ageText(t: ui.Ctx['t'], ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t('console.command.age_s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('console.command.age_m', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('console.command.age_h', { n: h }) : t('console.command.age_d', { n: Math.floor(h / 24) })
}

const dimWord = (s: string): Frag => ui.val(s, { role: 'prose', tone: 'dim' })
const word = (s: string): Frag => ui.val(s, { role: 'prose' })
const num = (n: number): Frag => ui.fmtd('count', String(n))
const gap = (): Frag => ui.val('  ', { role: 'prose' })
const stateChip = (u: UiCtx, key: string, n: number): Frag => ui.cat(ui.stateLead(u, ui.stateOf('console', key), { word: false }), word(' '), num(n))

// the summary line (§3.5): 產線 ● 9 ⋯ 3 ⊘ 1  主機 在線 12/13 · GPU 忙 5/7  額度 pool-b ✗ 2  改善 3 則. Parts from the right give way when the row is narrow. An expired or missing
// source says so where its figures would be.
function summaryParts(u: UiCtx, con: ConsoleSnapshot): Frag[] {
  const t = u.t
  const s = con.counts.summary
  const parts: Frag[] = []
  const lines = Object.entries(s.lines).filter(([, n]) => n > 0)
  if (lines.length > 0) parts.push(ui.cat(dimWord(t('console.command.sum_lines') + ' '), ...lines.flatMap(([k, n], i) => [...(i > 0 ? [word(' ')] : []), stateChip(u, k, n)])))
  const hostSrc = con.sources.hosts
  const h = s.hosts
  if (hostSrc !== undefined && (hostSrc.state === 'expired' || hostSrc.state === 'no_source')) parts.push(ui.cat(dimWord(t('console.command.sum_hosts') + ' '), word(t(hostSrc.state === 'expired' ? 'console.command.expired' : 'console.command.no_source'))))
  else if (typeof h.online === 'number' && typeof h.total === 'number') {
    const gpu = typeof h.gpu_busy === 'number' && typeof h.gpu_total === 'number' ? [dimWord(' · ' + t('console.command.sum_gpu') + ' '), num(h.gpu_busy), word('/'), num(h.gpu_total)] : []
    parts.push(ui.cat(dimWord(t('console.command.sum_hosts') + ' ' + t('console.command.sum_online') + ' '), num(h.online), word('/'), num(h.total), ...gpu))
  }
  if (s.quota_worst !== null) parts.push(ui.cat(dimWord(t('console.command.sum_quota') + ' '), word(s.quota_worst + ' '), stateChip(u, 'FAILED', con.counts.quota_risk)))
  if (s.hints > 0) parts.push(ui.cat(dimWord(t('console.command.hints') + ' '), num(s.hints)))
  return parts
}
function summaryRow(u: UiCtx, con: ConsoleSnapshot): PaneLine {
  const parts = summaryParts(u, con)
  const width = (ps: Frag[]): number => ps.reduce((w, p, i) => w + ui.displayWidth(p.text) + (i > 0 ? 2 : 0), 0)
  while (parts.length > 1 && width(parts) > u.cols - 1) parts.pop()
  return ui.rowOf(u, parts.flatMap((p, i) => (i > 0 ? [gap(), p] : [p])), { fact: C })
}

const exceptionsOf = (con: ConsoleSnapshot): ConsoleItem[] => con.items.filter(i => (i.kind === 'exception' || i.kind === 'quota') && i.to_console === true)

function exceptionRows(u: UiCtx, con: ConsoleSnapshot, now: number): PaneLine[] {
  return exceptionsOf(con).map(it => ui.item(u, ui.stateOf('console', it.state), u.cols >= 60 ? it.text : it.title, [{ text: ageText(u.t, now - it.since_ms), fmt: 'ago' }], { fact: C, word: false }))
}

// a console card the host's own pending store does not hold: one plain row (a waiting_step card also gets its report button)
function plainCardRows(u: UiCtx, c: ConsoleCard, now: number, itemTitle: string | undefined): PaneLine[] {
  const t = u.t
  const age = { text: ageText(t, now - c.opened_at_ms), fmt: 'ago' as const }
  const title = itemTitle ?? cardTitleOf({ question: c.question }) // the feed's own title for the card (KR8: the same title in every frontend); the question only when the feed has no item for it
  if (c.status === 'open') return [ui.item(u, ui.stateOf('console', 'PENDING'), title, [age], { fact: F, word: false })]
  const why = c.status === 'waiting_step' ? 'console.command.waiting_step' : c.status === 'relayed_unconfirmed' ? 'console.command.relayed' : 'console.command.awaiting'
  const row = ui.item(u, ui.stateOf('console', 'NEED_YOU'), title, [t(why), age], { fact: F, word: false })
  return c.status === 'waiting_step' ? [row, ui.buttonRow(u, t('console.command.report'), { press: FILL_PRESS + c.id, fact: F })] : [row]
}

// the age line (§3.5 top-right, here in the fixed bottom): 資料 21:40 · 卡 12 秒前 · 額度 4 分前, then every other source that is not fresh. A source past its stale bound says its age,
// past its expired bound it says 過期 and nothing else; a source that never reported says 無來源. The states come from the feed.
export function ageParts(t: UiCtx['t'], con: ConsoleSnapshot, now: number): string[] {
  const out: string[] = []
  const always = ['cards', 'quota_now']
  const ordered = [...always, ...Object.keys(con.sources).filter(k => !always.includes(k))]
  for (const key of ordered) {
    const s = con.sources[key]
    if (s === undefined) continue
    const label = t('console.command.src.' + key)
    if (s.state === 'expired') out.push(label + ' ' + t('console.command.expired'))
    else if (s.state === 'no_source' || s.at_ms === null) out.push(label + ' ' + t('console.command.no_source'))
    else if (s.state === 'stale' || always.includes(key)) out.push(label + ' ' + ageText(t, now - s.at_ms))
  }
  return out
}
function ageRow(u: UiCtx, con: ConsoleSnapshot, now: number): PaneLine {
  const parts = [u.t('console.command.data') + ' ' + ui.clock(con.generated_at_ms, now), ...ageParts(u.t, con, now)]
  const frags: Frag[] = []
  const fit = (): number => frags.reduce((w, f) => w + ui.displayWidth(f.text), 0)
  for (const p of parts) {
    const next = ui.fmtd('ago', (frags.length > 0 ? ' · ' : '') + p)
    if (frags.length > 0 && fit() + ui.displayWidth(next.text) > u.cols - 1) break
    frags.push(next)
  }
  return ui.rowOf(u, frags, { fact: C })
}

export function commandView(con: ConsoleSnapshot, live: LiveSnapshot | null, ctx: PaneCtx, now: number): CommandView {
  const t = ctx.t
  const u: UiCtx = { t, cols: ctx.cols, ...(ctx.expanded === undefined ? {} : { expanded: ctx.expanded }) }
  const body: PaneLine[] = [summaryRow(u, con), ui.blank()]
  const excOpen = ui.sectionOpen(ctx.folded, COMMAND_EXC_ID)
  const excs = exceptionRows(u, con, now)
  body.push(ui.header(u, t('console.command.exceptions'), { id: COMMAND_EXC_ID, open: excOpen }, {}))
  if (excOpen) body.push(...(excs.length === 0 ? [ui.empty(t('console.command.exceptions_none'), C)] : excs))
  body.push(ui.blank())
  const qOpen = ui.sectionOpen(ctx.folded, COMMAND_QUEUE_ID)
  body.push(ui.header(u, t('console.command.queue'), { id: COMMAND_QUEUE_ID, open: qOpen }, { right: ui.countChip(u, ui.stateOf('console', 'NEED_YOU'), con.counts.decisions, F), fact: F }))
  let bar: PaneLine[] = []
  if (qOpen) {
    const held = live === null ? [] : live.pending
    const heldIds = new Set(held.map(d => d.id))
    const rows: PaneLine[] = []
    if (live !== null && held.length > 0) {
      const lines = consoleDecideCards(live, ctx).slice(1) // the first line is decideCards' own header; this page has its own
      rows.push(...lines.filter(l => l.bar !== true))
      bar = lines.filter(l => l.bar === true)
    }
    // the feed's `items` order (severity) is the order in every frontend (KR8): the cards follow their `card:<id>` item's place, a card with no item goes last
    const cardItems = con.items.filter(i => i.kind === 'card')
    const place = (c: ConsoleCard): number => { const k = cardItems.findIndex(i => i.id === 'card:' + c.id); return k === -1 ? cardItems.length : k }
    for (const c of [...con.cards].sort((a, b) => place(a) - place(b))) if (!heldIds.has(c.id)) rows.push(...plainCardRows(u, c, now, cardItems.find(i => i.id === 'card:' + c.id)?.title))
    body.push(...(rows.length === 0 ? [ui.empty(t('console.command.queue_none'), F)] : rows))
  }
  return { body, bar: [...bar, ui.rowOf(u, [dimWord(t('console.command.hint'))], { fact: C }), ageRow(u, con, now)] }
}
