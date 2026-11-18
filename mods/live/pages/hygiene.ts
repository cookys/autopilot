// mods/live/pages/hygiene.ts — page 8 殘留 (plan r2 §2 row 8, §3.1, §3.2, §5): what needs your judgement (要你處理),
// what is safe to clear (可清除), the foldable auto-cleanup log (自動清理紀錄 / 自動清理), and the plugin load source (外掛來源).
// Pure: rows come from `ctx.live.detail.residue` and `ctx.live.detail.load_source`. Table rows carry no buttons; all buttons live
// in the action area (`[o]` clear focused, `[x]` clear all, `[z]` fold/unfold auto-cleanup). Stale or missing sources are red and
// wrapped in full, never truncated.
//
// Import order: pages/frame.ts imports ./index, which imports this file; import ./frame (or ./index) before ./hygiene in tests.
import type { LoadSourceView, NeedsHumanEntry, ResidueView } from '../model'
import { displayWidth, residueTally, truncateToWidth } from '../model'
import { GLYPHS, PALETTE, residueNameOf, residueWhy, wrapPlain } from '../ui'
import type { Page, PageCtx } from './frame'
import { brokenRow, staleBadge } from './rows'
import type { Row } from './rows'

type T = PageCtx['t']

export type HygieneView = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: HygieneView = { focus: 0, expanded: true }
export type HygieneCtx = PageCtx & { hygiene?: Partial<HygieneView> }

const WIDE_COLS = 100
const WIDE_RULE_ATTENTION = 57
const WIDE_RULE_AUTO = 52
const RULE2 = GLYPHS.structure.rule.repeat(2)
const BAD_SOURCE_FLAGS = ['marketplace_not_directory', 'marketplace_not_this_repo', 'dev_link_missing_or_stale']
const SCAN_CLASSES = new Set(['live', 'busy', 'missing-dir', 'dirty', 'clean-integrated', 'clean-unintegrated', 'unintegrated-branch', 'unverifiable'])

type CleanItem = { target: string; shortName: string; wideTail: string; narrowTail: string }
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

function secRule(label: string, wide: boolean, cols: number, wideTarget: number): Row {
  const r = GLYPHS.structure.rule
  const prefix = RULE2 + ' ' + label + (label.endsWith('）') || label.endsWith(')') ? '' : ' ')
  const count = wide ? Math.max(2, Math.min(wideTarget, cols) - displayWidth(prefix)) : 2
  return [{ text: prefix + r.repeat(count), color: PALETTE.structure }]
}

function judgeRow(e: NeedsHumanEntry, wide: boolean, t: T): Row {
  const entry = { kind: e.kind, target: e.target, cls: e.class, ageMs: null, bytes: e.bytes, reason: e.reason, command: e.command }
  const rawName = residueNameOf(entry)
  const shortName = !wide && e.kind === 'worktree' && rawName.length > 16 && /-[A-Za-z0-9]{4,10}$/.test(rawName)
    ? rawName.slice(rawName.lastIndexOf('-') + 1)
    : rawName
  const kindPrefix = e.kind !== '' && e.kind !== GLYPHS.structure.empty && !shortName.startsWith(e.kind + ' ') ? e.kind + ' ' : ''
  const hasHumanReason = e.reason !== null && !/^\d+ uncommitted$/.test(e.reason) && !/^[a-z0-9_]+$/.test(e.reason)
  const fullWhy = hasHumanReason ? (e.reason as string) : (residueWhy(t, entry)[0] ?? '')
  const why = wide ? fullWhy : fullWhy.replace(/^分支/, '').replace(/^branch\s+/i, '')
  const sep = why === '' ? '' : wide ? t('residue.why.hyg_judge_sep') : ' '
  return [
    { text: wide ? '  ' : ' ' },
    { text: GLYPHS.state.need_you + ' ', color: PALETTE.attention },
    { text: kindPrefix + shortName + sep + why },
  ]
}

function shortenCleanReason(reason: string): string {
  const stripped = reason.replace(/（[^）]*）|\([^)]*\)/g, '').trim()
  if (stripped.endsWith('沙盒') && displayWidth(stripped) > 6) return '沙盒'
  return stripped
}

function collectCleanItems(clean: readonly NeedsHumanEntry[], ls: LoadSourceView | null, t: T): CleanItem[] {
  const out: CleanItem[] = []
  const seen = new Set<string>()
  for (const e of clean) {
    seen.add(e.target)
    const entry = { kind: e.kind, target: e.target, cls: e.class, ageMs: null, bytes: e.bytes, reason: e.reason, command: e.command }
    const shortName = residueNameOf(entry)
    const wideTail = e.reason !== null
      ? e.reason
      : e.age_days !== null
        ? t('page.now.ago', { age: t('page.now.age_d', { n: Math.max(0, Math.floor(e.age_days)) }) })
        : (residueWhy(t, entry)[0] ?? '')
    const narrowTail = e.reason !== null ? shortenCleanReason(e.reason) : ''
    out.push({ target: e.target, shortName, wideTail, narrowTail })
  }
  for (const d of ls?.stale_cache_dirs ?? []) {
    if (d.alive.length > 0 || seen.has(d.dir)) continue
    seen.add(d.dir)
    const v = d.dir.split('/').filter(x => x !== '').pop() ?? d.dir
    out.push({
      target: d.dir,
      shortName: v,
      wideTail: t('residue.why.hyg_cache_why_w', { v }),
      narrowTail: t('residue.why.hyg_cache_why_c'),
    })
  }
  return out
}

function cleanRow(it: CleanItem, focused: boolean, wide: boolean): Row {
  const mark = wide
    ? (focused ? GLYPHS.structure.folded + ' ' : '  ')
    : (focused ? GLYPHS.structure.folded : ' ')
  const name = wide ? it.target : it.shortName
  const tail = wide ? it.wideTail : it.narrowTail
  return [
    { text: mark },
    { text: GLYPHS.state.pending + ' ', color: PALETTE.idle },
    { text: name + (tail === '' ? '' : ' ' + tail) },
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
    ...(removed > 0 ? [t('residue.why.hyg_auto_wt_w', { n: removed })] : []),
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

function loadSourceIsClean(ls: LoadSourceView): boolean {
  const src = ls.source.toLowerCase()
  const isDev = src === 'dev' || src === 'directory' || src.startsWith('dev:')
  if (!isDev) return false
  if ((ls.behind_upstream ?? 0) > 0 || ls.marketplace === 'missing') return false
  if (ls.flags.some(f => BAD_SOURCE_FLAGS.includes(f))) return false
  return ls.stale_cache_dirs.every(d => d.alive.length === 0)
}

function loadSourceRows(ls: LoadSourceView | null, wide: boolean, cols: number, t: T): Row[] {
  const leadText = wide
    ? RULE2 + ' ' + t('hygiene.load') + ' ' + RULE2 + ' '
    : RULE2 + ' ' + t('residue.why.hyg_load_short') + ' '
  if (ls === null) {
    const errText = GLYPHS.state.failed + ' ' + t('residue.why.hyg_no_load_source')
    if (displayWidth(leadText) + displayWidth(errText) <= cols) {
      return [[{ text: leadText, color: PALETTE.structure }, staleBadge(errText)]]
    }
    return [[{ text: leadText.trimEnd(), color: PALETTE.structure }], ...brokenRows(errText, cols)]
  }
  if (loadSourceIsClean(ls)) {
    const ref = devRefOf(ls)
    return [[
      { text: leadText, color: PALETTE.structure },
      { text: GLYPHS.state.done, color: PALETTE.done },
      { text: ' ' + (wide ? t('residue.why.hyg_load_dev_w', { ref }) : ref) },
    ]]
  }
  const src = ls.source.toLowerCase()
  if (src === 'unknown') {
    const errText = GLYPHS.state.failed + ' ' + t('src.unknown')
    if (displayWidth(leadText) + displayWidth(errText) <= cols) {
      return [[{ text: leadText, color: PALETTE.structure }, staleBadge(errText)]]
    }
    return [[{ text: leadText.trimEnd(), color: PALETTE.structure }], ...brokenRows(errText, cols)]
  }
  const issues = loadSourceIssues(ls, t)
  const cacheV = src.startsWith('cache:') ? ls.source.slice('cache:'.length) : null
  const baseText = cacheV !== null
    ? (wide ? t('src.cache', { v: cacheV }) : t('band.src_cache') + ' ' + cacheV)
    : (wide ? t('residue.why.hyg_load_dev_w', { ref: devRefOf(ls) }) : devRefOf(ls))
  const detailSuffix = issues.length > 0 ? '（' + issues.join('；') + '）' : ''
  return [[
    { text: leadText, color: PALETTE.structure },
    { text: GLYPHS.state.need_you, color: PALETTE.attention },
    { text: ' ' + baseText + detailSuffix },
  ]]
}

export function hygieneView(ctx: HygieneCtx, view?: Partial<HygieneView>): { body: Row[]; actions: Row[] } {
  const { t, size, live } = ctx
  const cols = size.cols
  const wide = cols >= WIDE_COLS
  const expanded = view?.expanded ?? ctx.hygiene?.expanded ?? DEFAULT_VIEW.expanded
  const rawFocus = view?.focus ?? ctx.hygiene?.focus ?? DEFAULT_VIEW.focus

  if (live === null) {
    return { body: brokenRows(GLYPHS.state.failed + ' ' + t('residue.why.hyg_no_live'), cols), actions: [] }
  }

  const body: Row[] = []
  if (live.state !== 'ok') {
    body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('residue.why.hyg_stale_live', { why: live.header }), cols))
  }

  const residue = live.detail.residue
  const ls = live.detail.load_source
  if (residue === null) {
    if (live.state === 'ok') body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('residue.why.hyg_no_residue'), cols))
    if (ls !== null) body.push(...loadSourceRows(ls, wide, cols, t))
    return { body, actions: [] }
  }

  const tl = residueTally(residue)
  const cleanItems = collectCleanItems(tl.clean, ls, t)
  const auto = autoInfoOf(residue, ctx)
  const focus = Math.max(0, Math.min(rawFocus, Math.max(0, cleanItems.length - 1)))

  if (live.state === 'ok' && tl.judgeCount === 0 && cleanItems.length === 0 && auto === null && (ls === null || loadSourceIsClean(ls))) {
    return {
      body: [[{ text: GLYPHS.state.pending + ' ', color: PALETTE.idle }, { text: t('residue.why.hyg_empty'), dim: true }]],
      actions: [],
    }
  }

  if (ctx.shortBody === true) {
    for (const e of tl.judge) body.push(judgeRow(e, wide, t))
    cleanItems.forEach((it, i) => body.push(cleanRow(it, i === focus, wide)))
    if (body.length === 0 && auto !== null) {
      const text = wide
        ? '  ' + (auto.age === '' ? auto.wideDetail : t('residue.why.hyg_auto_line_w', { age: auto.age, n: auto.total, detail: auto.wideDetail }))
        : ' ' + (auto.age === '' ? auto.narrowDetail : t('residue.why.hyg_auto_line_c', { age: auto.age, detail: auto.narrowDetail }))
      body.push([{ text }])
    }
    if (body.length === 0) body.push(...loadSourceRows(ls, wide, cols, t))
    const shortActions: Row[] = cleanItems.length > 0
      ? [[{ text: t('residue.why.hyg_act_clear'), color: PALETTE.action, press: 'clean:' + cleanItems[focus].target }]]
      : []
    return { body, actions: shortActions }
  }

  // 1. 要你處理 (judge items)
  if (tl.judgeCount > 0) {
    body.push(secRule(t('hygiene.need_you'), wide, cols, WIDE_RULE_ATTENTION))
    for (const e of tl.judge) body.push(judgeRow(e, wide, t))
    if (tl.unlisted > 0) body.push([{ text: (wide ? '  ' : ' ') + t('hygiene.more', { n: tl.unlisted }), dim: true }])
  }

  // 2. 可清除 N (cleanable items; table rows themselves carry no Buttons)
  if (cleanItems.length > 0) {
    body.push([{ text: RULE2 + ' ' + t('residue.why.hyg_sec_clean', { n: cleanItems.length }) + ' ' + RULE2, color: PALETTE.structure }])
    cleanItems.forEach((it, i) => body.push(cleanRow(it, i === focus, wide)))
  }

  // 3. 自動清理紀錄 / 自動清理 (foldable via z)
  if (auto !== null) {
    const autoLabel = wide
      ? t(expanded ? 'residue.why.hyg_sec_auto_open_w' : 'residue.why.hyg_sec_auto_folded_w', { n: auto.total })
      : t(expanded ? 'residue.why.hyg_sec_auto_open_c' : 'residue.why.hyg_sec_auto_folded_c', { n: auto.total })
    body.push(secRule(autoLabel, wide, cols, WIDE_RULE_AUTO))
    if (expanded) {
      const autoText = wide
        ? '  ' + (auto.age === '' ? auto.wideDetail : t('residue.why.hyg_auto_line_w', { age: auto.age, n: auto.total, detail: auto.wideDetail }))
        : ' ' + (auto.age === '' ? auto.narrowDetail : t('residue.why.hyg_auto_line_c', { age: auto.age, detail: auto.narrowDetail }))
      body.push([{ text: autoText }])
    }
  }

  // 4. 外掛來源 / 外掛
  body.push(...loadSourceRows(ls, wide, cols, t))

  // Actions area: every clickable action and every key hint has a matching Button bound to its key
  const actions: Row[] = []
  if (cleanItems.length > 0) {
    const focused = cleanItems[focus]
    if (wide) {
      actions.push([{ text: GLYPHS.structure.folded + ' ' + truncateToWidth(t('residue.why.hyg_focus', { target: focused.target }), Math.max(8, cols - 2)), color: PALETTE.structure }])
    }
    actions.push([{ text: t('residue.why.hyg_act_clear'), color: PALETTE.action, press: 'clean:' + focused.target }])
    actions.push([{ text: t(wide ? 'residue.why.hyg_act_clear_all_w' : 'residue.why.hyg_act_clear_all_c', { n: cleanItems.length }), color: PALETTE.action, press: 'clean:all' }])
  }
  if (auto !== null) {
    actions.push([{ text: t(expanded ? 'residue.why.hyg_act_fold_close' : 'residue.why.hyg_act_fold_open'), color: PALETTE.action, press: 'key:z' }])
  }

  return { body, actions }
}

export const hygienePage: Page = { id: 'hygiene', key: '8', title: '殘留', framed: true, render: ctx => hygieneView(ctx) }
