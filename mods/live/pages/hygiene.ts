// mods/live/pages/hygiene.ts — v7.4 S7 殘留 (PM 01M7N307, sub-task F): three blocks, 要你處理 / 自動清理 / 外掛來源, every row with its full description, no buttons, no fold.
// Pure: rows come from `ctx.live.detail.residue` and `ctx.live.detail.load_source`. A stale or missing source is red and wrapped in full, never truncated.
// The old 可清除 block and its [o]/[x]/[z] buttons are gone with the buttons (the auto-cleanup block says what was cleared).
//
// Import order: pages/frame.ts imports ./index, which imports this file; import ./frame (or ./index) before ./hygiene in tests.
import type { LoadSourceView, NeedsHumanEntry, ResidueView } from '../model'
import { DEFAULT_VALID_FOR_S, TRACE_STALE_MIN, TRACE_STALE_MS, displayWidth, liveAgeMs, residueTally } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { residueNameOf, residueWhy, wrapPlain } from '../ui'
import type { Page, PageCtx } from './frame'
import { brokenRow } from './rows'
import type { Row } from './rows'

type T = PageCtx['t']

export type HygieneView = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: HygieneView = { focus: 0, expanded: true }
export type HygieneCtx = PageCtx & { hygiene?: Partial<HygieneView> }

const WIDE_COLS = 100
const RULE2 = GLYPHS.structure.rule.repeat(2)
const BAD_SOURCE_FLAGS = ['marketplace_not_directory', 'marketplace_not_this_repo', 'dev_link_missing_or_stale']
const SCAN_CLASSES = new Set(['live', 'busy', 'missing-dir', 'dirty', 'clean-integrated', 'clean-unintegrated', 'unintegrated-branch', 'unverifiable'])

type AutoInfo = { total: number; age: string; wideDetail: string; narrowDetail: string }

const brokenRows = (text: string, cols: number): Row[] =>
  wrapPlain(text, Math.max(1, cols), Math.max(1, cols)).map(l => brokenRow(l))

const ageUnit = (t: T, ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t('page.now.age_s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('page.now.age_m', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('page.now.age_h', { n: h }) : t('page.now.age_d', { n: Math.floor(h / 24) })
}
const ageAgo = (t: T, ms: number): string => t('page.now.ago', { age: ageUnit(t, ms) })

// `box`: the v7.4 band frame (design S7: ◉ and two spaces); the host Pane keeps ⏶ and the locale separator
function judgeRow(e: NeedsHumanEntry, wide: boolean, t: T, box: boolean): Row {
  const entry = { kind: e.kind, target: e.target, cls: e.class, ageMs: null, bytes: e.bytes, reason: e.reason, command: e.command }
  const rawName = e.branch?.trim() ? e.branch : e.kind === 'worktree' && !e.target.startsWith('/') ? e.target : residueNameOf(entry)
  const shortName = !wide && e.kind === 'worktree' && rawName.length > 16 && /-[A-Za-z0-9]{4,10}$/.test(rawName)
    ? rawName.slice(rawName.lastIndexOf('-') + 1)
    : rawName
  const kindPrefix = e.kind !== '' && e.kind !== GLYPHS.structure.empty && !shortName.startsWith(e.kind + ' ') ? e.kind + ' ' : ''
  const hasHumanReason = e.reason !== null && !/^\d+ uncommitted$/.test(e.reason) && !/^[a-z0-9_]+$/.test(e.reason)
  const fullWhy = hasHumanReason ? (e.reason as string) : (residueWhy(t, entry)[0] ?? '')
  const why = wide ? fullWhy : fullWhy.replace(/^分支/, '').replace(/^branch\s+/i, '')
  const sep = why === '' ? '' : box ? '  ' : wide ? t('residue.why.hyg_judge_sep') : ' '
  return [
    { text: wide ? '  ' : ' ' },
    { text: (box ? GLYPHS.state.running : GLYPHS.state.need_you) + ' ', color: PALETTE.attention },
    { text: kindPrefix + shortName + sep + why },
  ]
}

function autoInfoOf(residue: ResidueView, ctx: PageCtx): AutoInfo | null {
  const { t, nowMs } = ctx
  const custom = Object.entries(residue.by_class).filter(([k, n]) => !SCAN_CLASSES.has(k) && n > 0)
  const removed = residue.auto_removed_count ?? 0
  const archived = residue.auto_archived_count ?? 0
  const customSum = custom.reduce((s, [, n]) => s + n, 0)
  const total = removed + archived > 0 ? removed + archived : customSum
  if (total <= 0) return null
  const ranMs = residue.auto_ran_at === null ? NaN : Date.parse(residue.auto_ran_at)
  const age = Number.isFinite(ranMs) ? ageAgo(t, Math.max(0, nowMs - ranMs)) : ''
  const sep = t('sep.list')
  if (custom.length > 0) {
    return {
      total,
      age,
      wideDetail: custom.map(([k, n]) => k + ' ' + n).join(sep),
      narrowDetail: custom.map(([k, n]) => k.replace(/^舊\s*/, '').replace(/^old\s+/i, '') + ' ' + n).join(sep),
    }
  }
  const wideParts = [
    ...(removed > 0 ? [t('v74.f.auto_wt', { n: removed })] : []),
    ...(archived > 0 ? [t('residue.why.hyg_auto_br', { n: archived })] : []),
  ]
  const narrowParts = [
    ...(removed > 0 ? [t('residue.why.hyg_auto_wt_c', { n: removed })] : []),
    ...(archived > 0 ? [t('residue.why.hyg_auto_br', { n: archived })] : []),
  ]
  return { total, age, wideDetail: wideParts.join(sep), narrowDetail: narrowParts.join(sep) }
}

function devRefOf(ls: LoadSourceView): string {
  if (ls.source.startsWith('dev:') && ls.source.length > 4) return ls.source.slice(4)
  if (ls.marketplace_path !== null && ls.marketplace_path.includes('@')) {
    const tail = ls.marketplace_path.slice(ls.marketplace_path.lastIndexOf('@') + 1).trim()
    if (tail !== '') return tail
  }
  return 'develop'
}

function loadSourceIssues(ls: LoadSourceView, t: T): string[] {
  const issues: string[] = []
  let marketAdded = false
  const addMarket = () => { if (!marketAdded) { marketAdded = true; issues.push(t('src.marketplace')) } }
  for (const f of ls.flags) {
    if (f === 'stale_cache_dirs' || f === 'loaded_from_cache') continue
    if (f === 'marketplace_not_directory' || f === 'marketplace_not_this_repo') addMarket()
    else if (f === 'dev_link_missing_or_stale') issues.push(t('src.devlink'))
    else issues.push(t('src.flag', { flag: f }))
  }
  if (ls.marketplace === 'missing') addMarket()
  if ((ls.behind_upstream ?? 0) > 0) issues.push(t('src.behind', { n: ls.behind_upstream as number }))
  for (const d of ls.stale_cache_dirs) {
    if (d.alive.length > 0) {
      const v = d.dir.split('/').filter(x => x !== '').pop() ?? d.dir
      issues.push(t('src.stale_busy', { v, pids: d.alive.join(', ') }))
    }
  }
  return issues
}

function isLoadSourceBroken(ls: LoadSourceView | null): boolean {
  if (ls === null) return true
  const src = ls.source.toLowerCase()
  if (src === 'unknown' || src === 'missing') return true
  return ls.marketplace === 'missing' || ls.flags.includes('dev_link_missing_or_stale')
}

function loadSourceIsClean(ls: LoadSourceView): boolean {
  if (isLoadSourceBroken(ls)) return false
  const src = ls.source.toLowerCase()
  const isDev = src === 'dev' || src === 'directory' || src.startsWith('dev:')
  if (!isDev) return false
  if ((ls.behind_upstream ?? 0) > 0) return false
  if (ls.flags.some(f => BAD_SOURCE_FLAGS.includes(f))) return false
  return ls.stale_cache_dirs.every(d => d.alive.length === 0)
}


const openRule = (title: string, wide: boolean): Row => {
  const head = GLYPHS.structure.open + ' ' + title + ' '
  const fill = wide ? GLYPHS.structure.rule.repeat(Math.max(2, 54 - displayWidth(head))) : ''
  return [{ text: head, color: PALETTE.idle }, ...(fill === '' ? [] : [{ text: fill, color: PALETTE.structure }])]
}

// the plugin-source block's rows: one full sentence (clean: `forge-stats 從 develop 主 clone 載入`), the issues appended; a missing or broken source is red
function loadSourceBody(ls: LoadSourceView | null, cols: number, t: T): Row[] {
  if (ls === null) return brokenRows(GLYPHS.state.failed + ' ' + t('residue.why.hyg_no_load_source'), cols)
  const src = ls.source.toLowerCase()
  const issues = loadSourceIssues(ls, t)
  const detailSuffix = issues.length > 0 ? '（' + issues.join('；') + '）' : ''
  if (src === 'unknown' || src === 'missing') return brokenRows(GLYPHS.state.failed + ' ' + t('src.unknown') + detailSuffix, cols)
  const cacheV = src.startsWith('cache:') ? ls.source.slice('cache:'.length) : null
  const base = cacheV !== null ? t('src.cache', { v: cacheV }) : t('v74.f.load_dev', { ref: devRefOf(ls) })
  if (isLoadSourceBroken(ls)) return brokenRows(GLYPHS.state.failed + ' ' + base + detailSuffix, cols)
  return [[{ text: ' ' + base + detailSuffix, ...(loadSourceIsClean(ls) ? {} : { color: PALETTE.attention }) }]]
}

const isoAgeMs = (iso: string | null | undefined, nowMs: number): number | null => {
  if (iso == null) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.max(0, nowMs - ms) : null
}

export function hygieneView(ctx: HygieneCtx, _view?: Partial<HygieneView>): { body: Row[]; actions: Row[] } {
  const { t, size, live, nowMs } = ctx
  const cols = size.cols
  const wide = cols >= WIDE_COLS

  if (live === null) {
    return { body: brokenRows(GLYPHS.state.failed + ' ' + t('residue.why.hyg_no_live'), cols), actions: [] }
  }

  const body: Row[] = []
  const liveAge = liveAgeMs(live, nowMs)
  if (live.state !== 'ok') {
    const thresh = liveAge !== null
      ? t('trace.age_threshold', { age: ageUnit(t, liveAge), limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S })
      : t('trace.threshold_only', { limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S })
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('residue.why.hyg_stale_live', { why: live.header }) + ' · ' + thresh, cols))
  } else if (liveAge !== null && liveAge > TRACE_STALE_MS) {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('trace.hygiene_age_stale', { age: ageUnit(t, liveAge), limit: TRACE_STALE_MIN, validS: DEFAULT_VALID_FOR_S }), cols))
  }

  const residue = live.detail.residue
  const ls = live.detail.load_source
  const sourceBlock = (): Row[] => {
    const lsAge = isoAgeMs(ls?.at, nowMs)
    const lsHead = lsAge === null ? t('hygiene.load') : t('hygiene.load') + ' · ' + ageAgo(t, lsAge)
    const out: Row[] = [openRule(lsHead, wide)]
    if (lsAge !== null && lsAge > TRACE_STALE_MS) {
      out.push(...brokenRows(GLYPHS.state.failed + ' ' + t('trace.hygiene_src_stale', { source: 'load-source.json', age: ageUnit(t, lsAge), limit: TRACE_STALE_MIN }), cols))
    }
    out.push(...loadSourceBody(ls, cols, t))
    if (ls !== null && ls.flags.length > 0) {
      const shownFlags = ls.flags.length > 10 ? [...ls.flags.slice(0, 10), '…'] : ls.flags
      out.push([{ text: ' ' + t('trace.hygiene_flags_total', { n: ls.flags.length, flags: shownFlags.join(t('sep.list')) }), dim: true }])
    }
    return out
  }
  if (residue === null) {
    if (live.state === 'ok') body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('residue.why.hyg_no_residue'), cols))
    body.push(...sourceBlock())
    return { body, actions: [] }
  }

  // v7.4 S7: three blocks, every row with its full description (the wide wording at every width, the frame wraps it), no buttons and no fold
  const tl = residueTally(residue)
  const kinds = [...new Set(tl.judge.map(e => e.kind))]
  const needTitle = tl.judgeCount === 0
    ? t('hygiene.need_you')
    : kinds.length === 1 && tl.unlisted === 0 ? t('v74.f.need_kind', { n: tl.judgeCount, kind: kinds[0] }) : t('v74.f.need_n', { n: tl.judgeCount })
  const resAge = isoAgeMs(residue.at, nowMs)
  const needHead = resAge === null ? needTitle : needTitle + ' · ' + ageAgo(t, resAge)
  body.push(openRule(needHead, wide))
  if (resAge !== null && resAge > TRACE_STALE_MS) {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('trace.hygiene_src_stale', { source: 'residue.json', age: ageUnit(t, resAge), limit: TRACE_STALE_MIN }), cols))
  }
  if (tl.cleanCount > 0) {
    body.push([{ text: ' ' + t('trace.hygiene_total_breakdown', { total: residue.needs_human_count, judge: tl.judgeCount, clean: tl.cleanCount }), dim: true }])
  }
  if (tl.judgeCount === 0) body.push([{ text: ' ' + GLYPHS.state.done + ' ', color: PALETTE.done }, { text: t('v74.f.need_none'), dim: true }])
  for (const e of tl.judge) body.push(judgeRow(e, true, t, ctx.box === true))
  if (tl.unlisted > 0) body.push([{ text: ' ' + t('hygiene.more', { n: tl.unlisted }), dim: true }])

  const auto = autoInfoOf(residue, ctx)
  body.push(openRule(auto === null || auto.age === '' ? t('v74.f.sec_auto') : t('v74.f.sec_auto_age', { age: auto.age }), wide))
  if (auto === null) body.push([{ text: ' ' + t('v74.f.auto_none'), dim: true }])
  else body.push([{ text: ' ' + auto.wideDetail }])

  body.push(...sourceBlock())
  return { body, actions: [] }
}

export const hygienePage: Page = { id: 'hygiene', key: '6', title: '殘留', framed: true, render: ctx => hygieneView(ctx) }
