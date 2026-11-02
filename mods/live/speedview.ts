// mods/live/speedview.ts — what the speed measurement (speed.ts) looks like (BL-0359): the label on the band's left and the speed view under the tabs.
// Pure: it returns segments and lines, band.tsx draws them. Colours are PALETTE roles only (plan section 12): the rate is `running` (how fast the running work goes: `ϟ` and the
// trend, the same reading as the label of section 12.11), a value is default text, a unit or a key is dim, a bullet or separator is `structure`, a rate nobody measured is `idle`.
// No bold (it is not on the whitelist), no background, no inverse. Glyphs come from GLYPHS.

import type { T } from './i18n'
import type { Seg } from './model'
import { fmtCount, fmtMs, fmtTps, mainSteps, recentTimed, shortModel, summarize } from './speed'
import type { Step } from './speed'
import { displayWidth, GLYPHS, PALETTE } from './ui'
import type { ForgeSegment } from './ui'

const DASH = GLYPHS.structure.empty
const seg = (text: string, o: Partial<Seg> = {}): Seg => ({ text, role: 'prose', ...o })
const padRight = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - displayWidth(text)))
/** `text` cut to at most `w` display cells (whole characters). */
function cutCells(text: string, w: number): string {
  let out = ''
  for (const ch of text) { if (displayWidth(out + ch) > w) break; out += ch }
  return out
}
const padLeft = (text: string, w: number): string => ' '.repeat(Math.max(0, w - displayWidth(text))) + text

/** One spark cell per value, scaled to the largest; a missing value draws as the lowest step. */
export function sparkline(values: readonly (number | null)[]): string {
  const top = GLYPHS.spark.length - 1
  const max = Math.max(0, ...values.map(v => v ?? 0))
  return values.map(v => (v === null || max <= 0 ? GLYPHS.spark[0] : GLYPHS.spark[Math.min(top, Math.floor((v / max) * top + 0.5))])).join('')
}

// ---- the label on the band's left: `ϟ 83 tok/s ▁▂▃▅▇` and, when asked, ` · Ferris Lv.1` ----

/** The label's parts, widest form first (ui.ts forgeFit narrows them); null while nothing was measured, so a session that has made no request draws no label. */
export function speedLabelParts(steps: readonly Step[], pet: string | null = null): ForgeSegment[] | null {
  if (steps.length === 0) return null
  const latest = summarize(mainSteps(steps)).latestTps
  const spark = recentTimed(steps, 5)
  const out: ForgeSegment[] = [{ role: 'bolt', text: GLYPHS.structure.speed + ' ' }, { role: 'value', text: fmtTps(latest, DASH) }, { role: 'unit', text: ' tok/s' }]
  if (spark.length >= 2) out.push({ role: 'gap', text: ' ' }, { role: 'trend', text: sparkline(spark.map(s => s.tps)) })
  if (pet !== null) out.push({ role: 'sep', text: ' · ' }, { role: 'pet', text: pet })
  return out
}

// ---- the speed view: a speed column and the recent-requests table ----

export type SpeedColumn = { lines: Seg[][]; width: number }
const KEY_W = 12
export const SPEED_COL_W = 34
export const RECENT_COL_W = 46
export const COL_GAP = 2
/** The recent table's number columns, in cells. fmtTps, fmtMs and fmtCount are each never wider than their column (speed.ts), so padLeft only ever pads. */
export const RECENT_W = { tps: 6, ttft: 7, out: 7 }
/** Narrower than this the speed view is not drawn (the key column and the longest value would not fit); from here up the speed column takes `min(34, columns)`. */
export const SPEED_MIN_COLS = 26
/** The rows the speed column takes (title + average, best, latest, first token, trend, requests); the table is cut to the rows left. */
export const SPEED_ROWS = 8

const kv = (key: string, ...value: Seg[]): Seg[] => [seg(padRight(key, KEY_W), { dim: true }), ...value]

export function speedColumn(steps: readonly Step[], t: T, width: number = SPEED_COL_W): SpeedColumn {
  const title = [seg(GLYPHS.structure.speed + ' ', { color: PALETTE.running, role: 'glyph' }), seg(t('speed.title')), seg('  tok/s', { dim: true })]
  const main = mainSteps(steps)
  if (main.length === 0) return { lines: [title, [seg(DASH + ' ' + t('speed.none'), { dim: true })]], width }
  const s = summarize(main)
  const unit = seg(' tok/s', { dim: true })
  const rate = (v: number | null): Seg[] => (v === null ? [seg(DASH, { color: PALETTE.idle })] : [seg(fmtTps(v, DASH)), unit])
  const lines: Seg[][] = [
    title,
    kv(t('speed.avg'), ...rate(s.avgTps)),
    kv(t('speed.best'), ...rate(s.bestTps)),
    kv(t('speed.latest'), ...rate(s.latestTps)),
    kv(t('speed.first'), seg(fmtMs(s.medianTtft, DASH)), seg(' ' + t('speed.median'), { dim: true })),
  ]
  const timed = recentTimed(steps, width - KEY_W)
  lines.push(kv(t('speed.trend'), timed.length >= 2 ? seg(sparkline(timed.map(x => x.tps)), { color: PALETTE.running, role: 'glyph' }) : seg(DASH, { color: PALETTE.idle })))
  lines.push(kv(t('speed.requests'), seg(t('speed.count', { n: s.requests }))))
  return { lines, width }
}

/** The recent requests, newest first: tok/s, first-token delay, tokens out and the model; a subagent's request is dim and says so. */
export function recentColumn(steps: readonly Step[], rows: number, width: number, t: T): SpeedColumn {
  const title = [seg(t('reqs.title'))]
  if (steps.length === 0) return { lines: [title, [seg(DASH + ' ' + t('speed.none'), { dim: true })]], width }
  const W = RECENT_W
  const header = [seg('  ' + padLeft(t('reqs.tps'), W.tps) + ' ' + padLeft(t('reqs.ttft'), W.ttft) + ' ' + padLeft(t('reqs.out'), W.out) + '  ' + t('reqs.model'), { dim: true })]
  const shown = steps.slice(-Math.max(1, rows - 2)).reverse()
  const body = shown.map((s): Seg[] => {
    const bullet = seg(GLYPHS.structure.bullet + ' ', { color: PALETTE.structure, role: 'rule' })
    const sub = s.isSubagent ? ' · ' + t('reqs.sub') : ''
    const numbers = padLeft(fmtTps(s.tps, DASH), W.tps) + ' ' + padLeft(fmtMs(s.ttftMs, DASH), W.ttft) + ' ' + padLeft(fmtCount(s.outTokens), W.out) + '  '
    const room = Math.max(0, width - displayWidth(GLYPHS.structure.bullet + ' ') - displayWidth(numbers) - displayWidth(sub))
    const cells = numbers + cutCells(shortModel(s.model), room)
    return s.isSubagent ? [bullet, seg(cells, { dim: true }), seg(sub, { dim: true })] : [bullet, seg(cells)]
  })
  return { lines: [title, header, ...body], width }
}

/**
 * The columns the speed view draws in `columns` cells: the speed column, and the recent-requests table only when its full 46 cells are left beside it (it is never squeezed: a model name that does not fit is cut, the numbers never are). `used` is the width they take
 * with the gaps, so the caller knows what is left for the mod below.
 */
export function speedView(steps: readonly Step[], rows: number, columns: number, t: T): { columns: SpeedColumn[]; used: number } {
  if (columns < SPEED_MIN_COLS) return { columns: [], used: 0 }
  const speed = speedColumn(steps, t, Math.min(SPEED_COL_W, columns))
  const left = columns - speed.width - COL_GAP
  if (left < RECENT_COL_W) return { columns: [speed], used: speed.width }
  const recent = recentColumn(steps, rows, RECENT_COL_W, t)
  return { columns: [speed, recent], used: speed.width + COL_GAP + recent.width }
}
