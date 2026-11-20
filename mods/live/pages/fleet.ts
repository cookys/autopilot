// mods/live/pages/fleet.ts — v7.4 S8 艦隊 (PM 01M7N307, sub-task F): the local decision cards and the other hosts' cards on top, then the fleet's runs in three blocks, 執行中 / 失敗 / 已完成
// (the old version's running / failed split; terminal runs are listed under 已完成 instead of hidden; nothing is grouped by line name).
// Pure. Local cards come from ctx.v74.decide; the other hosts' cards from `ctx.others` (fleet.ts `othersView`, to be wired by the pane); the runs from ctx.live.rows (the rows 派工 draws).
// A missing source is the existing broken row, never an invented one. `rowsOf` / `FOLD_AT` stay: register.ts still sizes the console-line focus with them.
import type { ConsoleLine } from '../console'
import type { OthersView } from '../fleet'
import { makeT } from '../i18n'
import type { T } from '../i18n'
import type { LivePaneRow, Seg } from '../model'
import { displayWidth, runEndedMs, runSubject, truncateToWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { STATES, stateOf } from '../ui'
import type { StateId } from '../ui'
import type { Page, PageCtx } from './frame'
import { brokenRow, lineDuration, lineState } from './rows'
import type { Row } from './rows'

export const FOLD_AT = 6 // rows shown before the fold (the console-line focus clamp in register.ts)
export type FleetView = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: FleetView = { focus: 0, expanded: false }
export type FleetCtx = PageCtx & { others?: OthersView | null }

type FleetRow = { line: ConsoleLine; sid: StateId; word: string; worst: ConsoleLine['issues'][number] | null }
const RANK: Record<string, number> = { failed: 0, stalled: 1 }

export function rowsOf(lines: ConsoleLine[], t: T = makeT('zh-TW')): FleetRow[] {
  const out: FleetRow[] = lines.map(line => {
    const { sid, word, worst } = lineState(line, t)
    return { line, sid, word, worst }
  })
  const rank = (r: FleetRow): number => (r.worst === null ? 9 : RANK[r.sid] ?? 2)
  return out.sort((a, b) => rank(a) - rank(b) || (a.worst?.since_ms ?? Infinity) - (b.worst?.since_ms ?? Infinity) || a.line.label.localeCompare(b.line.label))
}


const openRule = (title: string, right: string | null, wide: boolean): Row => {
  const head = GLYPHS.structure.open + ' ' + title + ' '
  const tail = right === null ? '' : '· ' + right + ' '
  return [{ text: head + tail + (wide ? GLYPHS.structure.rule.repeat(Math.max(2, 54 - displayWidth(head + tail))) : ''), color: PALETTE.structure }]
}
const miss = (text: string): Row => brokenRow(' ' + GLYPHS.state.failed + ' ' + text)

// Y3: one duration grammar on every page (rows.ts lineDuration: 3 時 40 分)
const ageText = (t: T, ms: number): string => t('page.now.ago', { age: lineDuration(ms, t) })
const durText = (t: T, s: number): string => lineDuration(s * 1000, t)

function cardRows(ctx: FleetCtx, wide: boolean): Row[] {
  const { t } = ctx
  const cards = ctx.v74?.decide ?? null
  if (cards === null) return [miss(t('v74.f.cards_missing'))]
  return [
    openRule(t('v74.f.sec_cards', { n: cards.length }), null, wide),
    ...cards.map((c): Row => [{ text: ' ' }, { text: GLYPHS.structure.decisions + ' ', color: PALETTE.attention }, { text: c.title }]),
  ]
}

function othersRows(ctx: FleetCtx, wide: boolean): Row[] {
  const { t, nowMs } = ctx
  const o = ctx.others ?? null
  if (o === null) return [miss(t('v74.f.others_missing'))]
  if (!o.present) return [miss(t('v74.f.others_nosync'))]
  if (o.unreadable !== null) return [miss(t('v74.f.others_bad', { error: o.unreadable }))]
  const age = o.syncedMs === null ? null : ageText(t, Math.max(0, nowMs - o.syncedMs))
  const out: Row[] = [openRule(t('v74.f.sec_others', { n: o.cards.length }), age, wide)]
  for (const c of o.cards) {
    const title = c.title ?? truncateToWidth(c.question, 24)
    out.push([{ text: ' ' }, { text: GLYPHS.structure.bullet + ' ', color: PALETTE.attention }, { text: c.id + ' ' + title + ' ' + t('v74.f.others_answer', { where: c.where }) }])
  }
  return out
}

type Block = 'running' | 'failed' | 'done'
const blockOf = (sid: StateId): Block => (sid === 'failed' ? 'failed' : sid === 'done' ? 'done' : 'running')

function runRow(ctx: FleetCtx, r: LivePaneRow, sid: StateId, block: Block): Row {
  const { t, nowMs } = ctx
  const st = STATES[sid]
  const engine = [r.runner, r.model].filter((x): x is string => x !== null && x.trim() !== '').filter((x, i, a) => a.indexOf(x) === i).join('/')
  const parts = [r.run_id, ...(engine === '' ? [] : [engine]), ...(r.role === null || r.role === '' ? [] : [r.role])]
  const tail: string | null =
    block === 'done' ? (runEndedMs(r) === null ? null : t('v74.f.run_done', { age: ageText(t, Math.max(0, nowMs - (runEndedMs(r) as number))) }))
    : block === 'failed' ? (r.final_status ?? (r.rc === null ? null : 'rc ' + r.rc))
    : r.elapsed_s === null ? null : t('v74.f.run_running', { age: durText(t, r.elapsed_s) })
  const seg: Seg = { text: parts.join(' · ') + (tail === null ? '' : ' · ' + tail) }
  return [{ text: ' ' }, { text: st.glyph + ' ', ...(st.key === undefined ? {} : { color: st.key }) }, seg]
}

function runBlocks(ctx: FleetCtx, wide: boolean): Row[] {
  const { t, live } = ctx
  if (live === null) return [miss(t('v74.f.runs_missing'))]
  const out: Row[] = []
  if (live.state !== 'ok') out.push(miss(t('v74.f.runs_stale', { why: (live.header ?? '').trim() || live.state })))
  if (live.rows === null) return [...out, miss(t('page.dispatch.no_runs'))]
  const by: Record<Block, { r: LivePaneRow; sid: StateId }[]> = { running: [], failed: [], done: [] }
  for (const r of live.rows) {
    const sid = stateOf('run', runSubject(r)).id
    by[blockOf(sid)].push({ r, sid })
  }
  const marks: Record<Block, string> = { running: GLYPHS.state.running, failed: GLYPHS.state.failed, done: GLYPHS.state.done }
  const keys: Record<Block, string> = { running: 'v74.f.sec_running', failed: 'v74.f.sec_failed', done: 'v74.f.sec_done' }
  for (const b of ['running', 'failed', 'done'] as const) {
    out.push(openRule(t(keys[b], { mark: marks[b], n: by[b].length }), null, wide))
    if (by[b].length === 0) out.push([{ text: ' ' + t('v74.f.none_row'), dim: true }])
    for (const x of by[b]) out.push(runRow(ctx, x.r, x.sid, b))
  }
  return out
}

export function fleetView(ctx: FleetCtx, _view: FleetView = DEFAULT_VIEW): { body: Row[]; actions: Row[] } {
  const wide = ctx.size.cols >= 100
  return { body: [...cardRows(ctx, wide), ...othersRows(ctx, wide), ...runBlocks(ctx, wide)], actions: [] }
}

export const fleetPage: Page = { id: 'fleet', key: '3', title: '艦隊', framed: true, render: ctx => fleetView(ctx) }
