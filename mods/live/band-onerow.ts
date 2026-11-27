// mods/live/band-onerow.ts — single-row band layout (2026-11-23-band-layout v4, Fleet-Task 01M837HGTX).
// Pure: no JSX, no engine calls, erasable TypeScript syntax with `.ts` imports so `node --test` can load it directly.
// Colours use PALETTE roles only (no theme-key literals, bold only on the reminder words, no glyph literals outside GLYPHS).
//
// Glyph usage table (disambiguated from fold marker ▸):
//   ▸ (U+25B8, GLYPHS.structure.folded) — folded section / disclosure toggle ONLY (ui.ts, band.tsx, pages/help.ts)
//   ‣ (U+2023, EAW=N, width=1, not in EMOJI_BANNED) — band reminder lead & active list/card cursor (band-onerow.ts, pages/decide.ts, pages/quota.ts, pages/todo.ts)
//   ▾ / ▴ (U+25BE / U+25B4) — pane expand/collapse toggle arrow on band right edge
//   ⏶ (U+23F6, GLYPHS.state.need_you) — QC alert marker
import { GLYPHS } from '../tux/glyphs.ts'
import { PALETTE } from '../tux/palette.ts'
import type { ThemeKey } from '../tux/palette.ts'
import { cellWidth, displayWidth } from '../tux/width.ts'
import { bandWords } from './model.ts'
import type { Seg } from './model.ts'
import type { T } from './i18n.ts'
import type { PageId } from './pages/frame.ts'

export const BAND_COL_WIDTHS = {
  line: 26,
  lineShortMax: 14,
  source: 16,
  pend: 10,
  qc: 8,
  tps: 14,
  spark: 6,
  pet: 12,
  toggle: 6,
  sep: 3,
} as const

export const BAND_STALE_MS = 5 * 60_000
export const REMIND_MIN_COLS = 28
export const REMIND_ALERT_MIN_COLS = 20
export const REMIND_DECOR_MAX_COLS = 60

export type DataState = 'normal' | 'stale' | 'missing'
export type BandSegmentId = 'remind' | 'line' | 'source' | 'pend' | 'qc' | 'tps' | 'spark' | 'pet'
export type BandRoutingTarget = BandSegmentId | 'sep' | 'blank'

export type OneRowInput = {
  reminder: { text: string | null; cardId?: string | null; state: DataState; hasRec?: boolean }
  line: { stalled: number | null; running: number | null; failed: number | null; waiting: number | null; state: DataState }
  source: { label: string | null; flags: number | null; state: DataState }
  pend: { count: number | null; hasRec?: boolean; state: DataState }
  qc: { status: 'alert' | 'ok' | 'none'; state: DataState }
  tps: { value: number | null; state: DataState }
  spark: { bars: string | null; state: DataState }
  pet: { text: string | null; state: DataState }
  expanded: boolean
}

export type OneRowSegment = {
  id: BandSegmentId
  segs: Seg[]
  width: number
  clickable: boolean
  page: PageId | null
  short?: boolean
}

export type OneRowLayout = {
  columns: number
  remind: OneRowSegment
  segments: OneRowSegment[]
  toggle: { segs: Seg[]; width: number; expanded: boolean }
  totalWidth: number
  sepPositions: number[]
  dropped: BandSegmentId[]
}

const ELLIPSIS = '\u2026'
const UP_TRI = '\u25B4' // GLYPHS.structure.open is ▾; ▴ is the collapsed/expanded opposite arrow per spec §2.5
const REMIND_LEAD = '\u2023' // ‣ (U+2023, EAW=N, width=1): reminder lead, distinct from fold glyph ▸ and QC ⏶

// Contrast: host subtle is rgb(175,175,175) on light (2.19:1) and rgb(80,80,80) on dark (2.60:1), under the 3:1 non-text bar; inactive is 5.74 / 7.37.
export const BAND_SEP_SEG: Seg = { text: ' ' + GLYPHS.structure.bandSep + ' ', color: PALETTE.idle }

export function dataStateOf(ageMs: number | null, missing: boolean, staleFlag = false): DataState {
  if (missing) return 'missing'
  if (staleFlag || (ageMs !== null && ageMs > BAND_STALE_MS)) return 'stale'
  return 'normal'
}

export function clipToWidth(text: string, maxCols: number): string {
  if (maxCols <= 0) return ''
  if (displayWidth(text) <= maxCols) return text
  if (maxCols === 1) return ELLIPSIS
  let out = ''
  let used = 0
  const limit = maxCols - 1
  for (const ch of text) {
    const w = cellWidth(ch.codePointAt(0) as number)
    if (used + w > limit) break
    out += ch
    used += w
  }
  return out + ELLIPSIS
}

export function padRightToWidth(text: string, width: number): string {
  const cut = displayWidth(text) > width ? clipToWidth(text, width) : text
  const w = displayWidth(cut)
  return w >= width ? cut : cut + ' '.repeat(width - w)
}

export function padLeftToWidth(text: string, width: number): string {
  const w = displayWidth(text)
  return w >= width ? text : ' '.repeat(width - w) + text
}

// Right-aligned 3-column count: normal caps at 99+, stale adds ? suffix (99+? when >99, absorbing its leading space), missing uses em-dash.
export function fmtCount3(n: number | null, state: DataState): string {
  if (state === 'missing' || n === null || !Number.isFinite(n)) return '  ' + GLYPHS.structure.empty
  const v = Math.max(0, Math.floor(n))
  if (state === 'stale') {
    const s = v > 99 ? '99+?' : String(v) + '?'
    return padLeftToWidth(s, 3)
  }
  const s = v > 99 ? '99+' : String(v)
  return padLeftToWidth(s, 3)
}

// Right-aligned 3-column tok/s value: caps >999 at 1k+, missing uses em-dash.
export function fmtTps3(tps: number | null, state: DataState): string {
  if (state === 'missing' || tps === null || !Number.isFinite(tps)) return '  ' + GLYPHS.structure.empty
  const v = Math.max(0, Math.round(tps))
  const s = v > 999 ? '1k+' : String(v)
  return padLeftToWidth(s, 3)
}

const idleTone = (): { color: ThemeKey } => ({ color: PALETTE.idle })

// Routing table (§2.3, aligned by trace-inventory G01/G02): click and digit key go to the exact same page; decorations/separators/idle never trigger.
export function bandSlotPage(target: BandRoutingTarget, idleRemind = false): PageId | null {
  switch (target) {
    case 'remind': return idleRemind ? null : 'decide'
    case 'line': return 'dispatch'
    case 'source': return 'hygiene'
    case 'pend': return 'decide'
    case 'qc': return 'review'
    case 'tps': return 'spend'
    case 'spark':
    case 'pet':
    case 'sep':
    case 'blank':
      return null
  }
}

export function hasLineAlert(line: OneRowInput['line']): boolean {
  if (line.state === 'missing') return false
  return (line.failed ?? 0) > 0 || (line.stalled ?? 0) > 0
}

export function hasQcAlert(qc: OneRowInput['qc']): boolean {
  return qc.state !== 'missing' && qc.status === 'alert'
}

function fixedLabel(word: string, width: number): string {
  return padRightToWidth(word, width)
}

// 3 產線 ⊘99+ ◉99+ ✗99+ ⋯99+ (26 cols)
export function formatLineFull(line: OneRowInput['line'], t: T): OneRowSegment {
  const st = line.state
  const word = fixedLabel(t('band.onerow.line'), 4)
  const prefixBase = (st === 'stale' ? '~3' : '3 ') + word
  const prefix = prefixBase + ' '
  const items: { glyph: string; val: number | null; alert: boolean }[] = [
    { glyph: GLYPHS.state.stalled, val: line.stalled, alert: (line.stalled ?? 0) > 0 },
    { glyph: GLYPHS.state.running, val: line.running, alert: false },
    { glyph: GLYPHS.state.failed, val: line.failed, alert: (line.failed ?? 0) > 0 },
    { glyph: GLYPHS.state.waiting, val: line.waiting, alert: false },
  ]
  const segs: Seg[] = []
  if (st === 'stale' || st === 'missing') {
    const body = items.map(it => {
      const c = fmtCount3(it.val, st)
      return (displayWidth(c) > 3 ? '' : ' ') + it.glyph + c
    }).join('')
    segs.push({ text: prefixBase + body, ...idleTone() })
  } else {
    segs.push({ text: prefix })
    items.forEach((it, idx) => {
      if (idx > 0) segs.push({ text: ' ' })
      const txt = it.glyph + fmtCount3(it.val, st)
      segs.push(it.alert ? { text: txt, color: PALETTE.broken } : { text: txt })
    })
  }
  return { id: 'line', segs, width: BAND_COL_WIDTHS.line, clickable: true, page: 'dispatch' }
}

// Shortened alert-only line form (§2.6): `3 產線 ⊘ 4 ✗ 2` (matches wide ⊘ ◉ ✗ ⋯ order, space between glyph and count, max 3, width <= 14).
// Drops the redundant label word (and then inner space before `+`/`?`) when counts would exceed 14 cols so `+` and `?` are preserved.
export function formatLineShort(line: OneRowInput['line'], t: T): OneRowSegment {
  const st = line.state
  const word = fixedLabel(t('band.onerow.line'), 4)
  const compactCount = (n: number): string => {
    const v = Math.max(0, Math.floor(n))
    if (st === 'stale') return v > 99 ? '99+?' : String(v) + '?'
    return v > 99 ? '99+' : String(v)
  }
  const alerts: { glyph: string; count: string }[] = []
  if ((line.stalled ?? 0) > 0) alerts.push({ glyph: GLYPHS.state.stalled, count: compactCount(line.stalled as number) })
  if ((line.failed ?? 0) > 0) alerts.push({ glyph: GLYPHS.state.failed, count: compactCount(line.failed as number) })
  const picked = alerts.slice(0, 3)
  const pfxFull = (st === 'stale' ? '~3' : '3 ') + word + ' '
  const pfxDigit = st === 'stale' ? '~3 ' : '3 '
  const pfxTight = st === 'stale' ? '~3' : '3'
  const joinedSpaced = picked.map(a => a.glyph + ' ' + a.count).join(' ')
  const joinedTight = picked.map(a => a.glyph + a.count).join(' ')
  let head = pfxFull
  let body = joinedSpaced
  if (displayWidth(head + body) > BAND_COL_WIDTHS.lineShortMax) {
    head = pfxDigit
    if (displayWidth(head + body) > BAND_COL_WIDTHS.lineShortMax) {
      body = joinedTight
    }
    if (displayWidth(head + body) > BAND_COL_WIDTHS.lineShortMax) {
      head = pfxTight + ' '
    }
    if (displayWidth(head + body) > BAND_COL_WIDTHS.lineShortMax) {
      const avail = Math.max(1, BAND_COL_WIDTHS.lineShortMax - displayWidth(head))
      body = st === 'stale' && avail >= 2 ? clipToWidth(body, avail - 1) + '?' : clipToWidth(body, avail)
    }
  }
  const segs: Seg[] = st === 'stale'
    ? [{ text: head + body, ...idleTone() }]
    : [{ text: head }, { text: body, color: PALETTE.broken }]
  return { id: 'line', segs, width: displayWidth(head + body), clickable: true, page: 'dispatch', short: true }
}

// 6 來源 開發 ⚑99+ (16 cols)
export function formatSource(source: OneRowInput['source'], t: T): OneRowSegment {
  const st = source.state
  const word = fixedLabel(t('band.onerow.source'), 4)
  const prefix = (st === 'stale' ? '~6' : '6 ') + word + ' '
  const name = st === 'missing' || source.label === null || source.label === ''
    ? padRightToWidth(GLYPHS.structure.empty, 4)
    : padRightToWidth(source.label === t('band.onerow.source') ? '' : source.label, 4)
  const num = fmtCount3(source.flags, st)
  const tail = (displayWidth(num) > 3 ? '' : ' ') + GLYPHS.structure.residue + num
  const full = prefix + name + tail
  const segs: Seg[] = st === 'stale' || st === 'missing' ? [{ text: full, ...idleTone() }] : [{ text: full }]
  return { id: 'source', segs, width: BAND_COL_WIDTHS.source, clickable: true, page: 'hygiene' }
}

// 2 待決 99+ (10 cols)
export function formatPend(pend: OneRowInput['pend'], t: T): OneRowSegment {
  const st = pend.state
  const word = fixedLabel(t('band.onerow.pend'), 4)
  const num = fmtCount3(pend.count, st)
  const prefix = (st === 'stale' ? '~2' : '2 ') + word + (displayWidth(num) > 3 ? '' : ' ')
  // Keep at most one yellow (PALETTE.attention) focus per row (owned by remind); pending count uses non-yellow PALETTE.needs_human.
  const segs: Seg[] = st === 'stale' || st === 'missing'
    ? [{ text: prefix + num, ...idleTone() }]
    : pend.hasRec === true && (pend.count ?? 0) > 0
      ? [{ text: prefix }, { text: num, color: PALETTE.needs_human }]
      : [{ text: prefix + num }]
  return { id: 'pend', segs, width: BAND_COL_WIDTHS.pend, clickable: true, page: 'decide' }
}

// 4 QC ⏶   (8 cols)
export function formatQc(qc: OneRowInput['qc'], t: T): OneRowSegment {
  const st = qc.state
  const label = fixedLabel(t('band.onerow.qc'), 2)
  const prefix = (st === 'stale' ? '~4' : '4 ') + label + ' '
  const mark = st === 'missing'
    ? GLYPHS.structure.empty
    : qc.status === 'alert'
      ? GLYPHS.state.need_you
      : qc.status === 'ok'
        ? GLYPHS.state.done
        : GLYPHS.structure.empty
  const suffix = st === 'stale' ? '? ' : '  '
  const segs: Seg[] = st === 'stale' || st === 'missing'
    ? [{ text: prefix + mark + suffix, ...idleTone() }]
    : qc.status === 'alert'
      ? [{ text: prefix }, { text: mark, color: PALETTE.broken }, { text: suffix }]
      : [{ text: prefix + mark + suffix }]
  return { id: 'qc', segs, width: BAND_COL_WIDTHS.qc, clickable: true, page: 'review' }
}

// 5 ϟ 999 tok/s  (14 cols; suffix ` tok/s` stays at fixed offset 7 as 9 -> 78 -> 120)
export function formatTps(tps: OneRowInput['tps'], t: T): OneRowSegment {
  const st = tps.state
  const unit = t('band.onerow.tps_unit')
  const num = fmtTps3(tps.value, st === 'stale' ? (tps.value === null ? 'missing' : 'normal') : st)
  if (st === 'stale') {
    const full = '~5' + GLYPHS.structure.speed + ' ' + num + '? ' + unit
    return { id: 'tps', segs: [{ text: padRightToWidth(full, BAND_COL_WIDTHS.tps), ...idleTone() }], width: BAND_COL_WIDTHS.tps, clickable: true, page: 'spend' }
  }
  const full = '5 ' + GLYPHS.structure.speed + ' ' + num + ' ' + unit + ' '
  const segs: Seg[] = st === 'missing' || tps.value === null
    ? [{ text: padRightToWidth(full, BAND_COL_WIDTHS.tps), ...idleTone() }]
    : [{ text: padRightToWidth(full, BAND_COL_WIDTHS.tps) }]
  return { id: 'tps', segs, width: BAND_COL_WIDTHS.tps, clickable: true, page: 'spend' }
}

// ▇█▆▅▆  (6 cols, non-clickable)
export function formatSpark(spark: OneRowInput['spark']): OneRowSegment {
  const st = spark.state
  const raw = spark.bars ?? ''
  const chars = [...raw]
  if (st === 'missing' || chars.length === 0) {
    return { id: 'spark', segs: [{ text: padRightToWidth(GLYPHS.structure.empty, BAND_COL_WIDTHS.spark), ...idleTone() }], width: BAND_COL_WIDTHS.spark, clickable: false, page: null }
  }
  if (st === 'stale') {
    const tail = chars.slice(-4).join('')
    const text = '~' + padRightToWidth(tail, 4) + '?'
    return { id: 'spark', segs: [{ text, ...idleTone() }], width: BAND_COL_WIDTHS.spark, clickable: false, page: null }
  }
  const tail = chars.slice(-5).join('')
  return { id: 'spark', segs: [{ text: padRightToWidth(tail, 5) + ' ' }], width: BAND_COL_WIDTHS.spark, clickable: false, page: null }
}

// Ferris Lv.1  (12 cols, non-clickable, keeps pet name unlocalized per §2.4)
export function formatPet(pet: OneRowInput['pet']): OneRowSegment {
  const st = pet.state
  const raw = pet.text ?? ''
  if (st === 'missing' || raw === '') {
    return { id: 'pet', segs: [{ text: padRightToWidth(GLYPHS.structure.empty, BAND_COL_WIDTHS.pet), ...idleTone() }], width: BAND_COL_WIDTHS.pet, clickable: false, page: null }
  }
  if (st === 'stale') {
    const inner = padRightToWidth(clipToWidth(raw, 10), 10)
    return { id: 'pet', segs: [{ text: '~' + inner + '?', ...idleTone() }], width: BAND_COL_WIDTHS.pet, clickable: false, page: null }
  }
  return { id: 'pet', segs: [{ text: padRightToWidth(raw, BAND_COL_WIDTHS.pet) }], width: BAND_COL_WIDTHS.pet, clickable: false, page: null }
}

function buildToggle(expanded: boolean, maxCols: number, t: T): { segs: Seg[]; width: number; expanded: boolean } {
  // §2.5: ▾展開 = currently collapsed; ▴收合 = currently expanded.
  const arrow = expanded ? UP_TRI : GLYPHS.structure.open
  const word = expanded ? t('band.onerow.collapse') : t('band.onerow.expand')
  const full = ' ' + arrow + word
  if (maxCols >= displayWidth(full)) return { segs: [{ text: full, color: PALETTE.action }], width: displayWidth(full), expanded }
  const compact = arrow + word
  if (maxCols >= displayWidth(compact)) return { segs: [{ text: compact, color: PALETTE.action }], width: displayWidth(compact), expanded }
  return { segs: [{ text: arrow, color: PALETTE.action }], width: displayWidth(arrow), expanded }
}

// Yellow stays on the lead mark only; the words are default bold, so they read on every theme
// (`warning` is ~2.1 on white under light-daltonized).
function reminderSegs(text: string, color: ThemeKey | undefined): Seg[] {
  if (color === PALETTE.attention && text.startsWith(REMIND_LEAD)) {
    return [{ text: REMIND_LEAD, color }, bandWords(text.slice(REMIND_LEAD.length))]
  }
  return [{ text, ...(color !== undefined ? { color } : {}) }]
}

function buildReminderRaw(inp: OneRowInput, t: T): { text: string; idle: boolean; stale: boolean; color?: ThemeKey } {
  const raw = inp.reminder.text?.trim() ?? ''
  const dataNormal = inp.reminder.state === 'normal' && inp.pend.state === 'normal'
  if (dataNormal && inp.pend.count === 0 && raw === '') {
    return { text: t('band.onerow.idle'), idle: true, stale: false, color: PALETTE.idle }
  }
  if (inp.reminder.state === 'missing' || (raw === '' && (inp.pend.state === 'missing' || inp.pend.count === null))) {
    return { text: t('band.onerow.missing'), idle: false, stale: false, color: PALETTE.idle }
  }
  const isStale = inp.reminder.state === 'stale' || (raw === '' && inp.pend.state === 'stale')
  const body = raw !== '' ? raw : inp.pend.count === 0 ? t('band.onerow.idle') : t('band.onerow.remind_prefix') + GLYPHS.structure.empty
  if (isStale) {
    return { text: '~' + body + '?', idle: false, stale: true, color: PALETTE.idle }
  }
  // Use triangular bullet ‣ (U+2023, EAW=N, width=1) instead of fold glyph ▸ (GLYPHS.structure.folded) or banned ▹, distinct from QC ⏶.
  const withLead = REMIND_LEAD + ' ' + body
  return { text: withLead, idle: false, stale: false, ...(inp.reminder.hasRec === true ? { color: PALETTE.attention } : {}) }
}

// Lay out the single-row band inside `bodyColumns` (never wider, never wraps).
export function layoutOneRowBand(inp: OneRowInput, bodyColumns: number, t: T): OneRowLayout {
  const cols = Math.max(1, Math.floor(bodyColumns))
  const toggle = buildToggle(inp.expanded, cols, t)
  const remRaw = buildReminderRaw(inp, t)
  const remNaturalW = displayWidth(remRaw.text)
  const remTargetDecor = Math.min(REMIND_DECOR_MAX_COLS, remNaturalW)

  const lineAlert = hasLineAlert(inp.line)
  const qcAlert = hasQcAlert(inp.qc)
  const hasSpark = inp.spark.state !== 'missing' && (inp.spark.bars ?? '').length > 0
  const hasPet = inp.pet.state !== 'missing' && (inp.pet.text ?? '') !== ''
  const tpsEmpty = inp.tps.state === 'missing' || inp.tps.value === null

  const map = new Map<BandSegmentId, OneRowSegment>([
    ['line', formatLineFull(inp.line, t)],
    ['source', formatSource(inp.source, t)],
    ['pend', formatPend(inp.pend, t)],
    ['qc', formatQc(inp.qc, t)],
    ['tps', formatTps(inp.tps, t)],
    ['spark', formatSpark(inp.spark)],
    ['pet', formatPet(inp.pet)],
  ])
  const order: BandSegmentId[] = ['line', 'source', 'pend', 'qc', 'tps', 'spark', 'pet']
  // Carbon R3 m1: omit unlabelled decoration shells (spark, pet) when they have no data so width returns to reminder.
  const active = new Set<BandSegmentId>(order.filter(id => (id === 'spark' ? hasSpark : id === 'pet' ? hasPet : true)))
  const dropped: BandSegmentId[] = []

  const drop = (id: BandSegmentId): void => {
    if (active.delete(id)) dropped.push(id)
  }

  const rightWidth = (): number => {
    let w = toggle.width
    for (const id of order) {
      if (!active.has(id)) continue
      w += BAND_COL_WIDTHS.sep + (map.get(id) as OneRowSegment).width
    }
    return w
  }

  const remAvail = (): number => cols - rightWidth()

  // §2.6: when reminder cannot show in full (up to 60 cols), reclaim decorations first,
  // then other non-alert segments (non-alert QC, valueless tok/s, source, valued tok/s) before truncating reminder.
  if (remAvail() < remTargetDecor) drop('pet')
  if (remAvail() < remTargetDecor) drop('spark')
  if (remAvail() < remTargetDecor && !qcAlert) drop('qc')
  if (remAvail() < remTargetDecor && tpsEmpty) drop('tps')
  if (remAvail() < remTargetDecor) drop('source')
  if (remAvail() < remTargetDecor) drop('tps')

  // Priority drop order until reminder has at least REMIND_MIN_COLS (28):
  // pet -> spark -> qc (non-alert) -> source -> tps -> line (non-alert; alert switches to short form <=14) -> pend last.
  const dropOrder: BandSegmentId[] = ['pet', 'spark', 'qc', 'source', 'tps', 'line']
  for (const id of dropOrder) {
    if (remAvail() >= REMIND_MIN_COLS) break
    if (!active.has(id)) continue
    if (id === 'qc' && qcAlert) continue
    if (id === 'line') {
      if (lineAlert) {
        map.set('line', formatLineShort(inp.line, t))
      } else {
        drop('line')
      }
      continue
    }
    drop(id)
  }

  // Alert short form takes priority over REMIND_MIN_COLS (28): only drop pend if reminder would shrink below REMIND_ALERT_MIN_COLS (20).
  if (remAvail() < REMIND_ALERT_MIN_COLS && active.has('pend')) {
    drop('pend')
  }

  // Extreme narrow safety: never exceed bodyColumns; keep alert segments over reminder if needed, else drop to fit.
  if (remAvail() < 0) {
    for (const id of ['pend', 'line', 'qc'] as BandSegmentId[]) {
      if (remAvail() >= 0) break
      if (active.has(id)) drop(id)
    }
  }

  const finalRemW = Math.max(0, remAvail())
  const formatRemText = (raw: string, width: number, stale: boolean): string => {
    if (width <= 0) return ''
    if (displayWidth(raw) <= width) return padRightToWidth(raw, width)
    if (stale && raw.endsWith('?')) {
      if (width === 1) return '?'
      if (width === 2) return '~?'
      return padRightToWidth(clipToWidth(raw.slice(0, -1), width - 1) + '?', width)
    }
    return padRightToWidth(raw, width)
  }
  const remText = formatRemText(remRaw.text, finalRemW, remRaw.stale)
  const remind: OneRowSegment = {
    id: 'remind',
    segs: remText === '' ? [] : reminderSegs(remText, remRaw.color),
    width: displayWidth(remText),
    clickable: !remRaw.idle && finalRemW > 0,
    page: bandSlotPage('remind', remRaw.idle),
  }

  const segments: OneRowSegment[] = []
  const sepPositions: number[] = []
  let col = remind.width
  for (const id of order) {
    if (!active.has(id)) continue
    const seg = map.get(id) as OneRowSegment
    sepPositions.push(col)
    col += BAND_COL_WIDTHS.sep + seg.width
    segments.push(seg)
  }
  const totalWidth = col + toggle.width

  return { columns: cols, remind, segments, toggle, totalWidth, sepPositions, dropped }
}

export function oneRowText(layout: OneRowLayout): string {
  const sep = ' ' + GLYPHS.structure.bandSep + ' '
  const rem = layout.remind.segs.map(s => s.text).join('')
  const mid = layout.segments.map(seg => sep + seg.segs.map(s => s.text).join('')).join('')
  const tog = layout.toggle.segs.map(s => s.text).join('')
  return rem + mid + tog
}

// Bottom hint row (§2.3): always lists page numbers; shortens gracefully at narrow widths.
export function bandBottomHint(cols: number, expanded: boolean, t: T): string {
  const toggle = expanded ? t('band.onerow.collapse') : t('band.onerow.expand')
  const full = t('band.onerow.hint_full', { toggle })
  if (displayWidth(full) <= cols) return full
  const short = t('band.onerow.hint_short', { toggle })
  if (displayWidth(short) <= cols) return short
  const min = t('band.onerow.hint_min')
  return displayWidth(min) <= cols ? min : clipToWidth(min, cols)
}

// ---- Expand / collapse state machine (§2.5) ----
// Expand = focus pane & switch to page 1 ('now'); collapse = return to page before expand.
// State is preserved across refresh, resize (auto-drop/widen restore), and page switches.
export type BandExpandState = {
  expanded: boolean
  manualExpanded: boolean
  prevPage: PageId
  activePage: PageId
}

export function initialBandExpand(activePage: PageId = 'now'): BandExpandState {
  return { expanded: false, manualExpanded: false, prevPage: activePage, activePage }
}

export function toggleBandExpand(st: BandExpandState): BandExpandState {
  if (!st.expanded) {
    return { expanded: true, manualExpanded: true, prevPage: st.activePage, activePage: 'now' }
  }
  return { expanded: false, manualExpanded: false, prevPage: st.prevPage, activePage: st.prevPage }
}

export function bandExpandOnPageChange(st: BandExpandState, nextPage: PageId): BandExpandState {
  return { ...st, activePage: nextPage }
}

export function bandExpandOnResize(st: BandExpandState, _bodyColumns: number): BandExpandState {
  return st
}

export function bandExpandOnRefresh(st: BandExpandState): BandExpandState {
  return st
}
