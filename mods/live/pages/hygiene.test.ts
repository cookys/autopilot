// hygiene.test.ts — page 8 殘留 (plan r2 §2 row 8, §3.1, §3.2, §5, G11): rendered through frameRows at 160x40, 120x30 and 80x24
// against the r2 mockups (fictional fixtures), verifying fixed height H, key rows' text, the fold pair (collapsed / expanded),
// the empty state, overflow ("↓ 還有 N 列"), red stale / missing source rows (wrapped, never cut), and action Buttons bound to keys.
import { test, expect } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY, Pane } from '../pane'
import * as M from '../model'
import { displayWidth } from '../model'
import { actionRows, brokenRow as frameBroken, frameRows, staleBadge as frameBadge } from './frame'
import type { PageCtx } from './frame'
import { PAGES } from './index'
import { hygienePage, hygieneView } from './hygiene'
import type { HygieneCtx, HygieneView } from './hygiene'
import { brokenRow, staleBadge } from './rows'
import { makeT } from '../i18n'
import { PALETTE } from '../ui'
import { POOLS, closeGap, consoleOf } from './quota.fixture'

const t = makeT('zh-TW')
const NOW = 1794200000000
const HOUR = 3_600_000
const SIZES = [[160, 40], [120, 30], [80, 24]] as const
const text = (row: { text: string }[]): string => row.map(s => s.text).join('').replace(/\s+$/, '')

// Calm console fixture (all sources ok, 0 cards, 1 healthy pool) so empty action area resolves to `沒有要你處理的事`
const CALM_CON = consoleOf([POOLS[0]], {
  cards: [],
  decisions: 0,
  items: [],
  lines: [],
  sources: {
    tasks: { at_ms: NOW - 12_000, state: 'ok' },
    hosts: { at_ms: NOW - 12_000, state: 'ok' },
    cards: { at_ms: NOW - 12_000, state: 'ok' },
    quota_now: { at_ms: NOW - 40_000, state: 'ok' },
    quota_forecast: { at_ms: NOW - 40_000, state: 'ok' },
  },
}) as PageCtx['console']

const LOAD_DEV: M.LoadSourceView = {
  plugin_version: '3.0.0',
  source: 'dev',
  marketplace: 'directory',
  marketplace_path: '/work/autopilot',
  behind_upstream: 0,
  flags: [],
  stale_cache_dirs: [],
}

const MOCK_RESIDUE: M.ResidueView = {
  reapable: 2,
  by_class: { 'build 暫存': 2, '舊 worktree': 1, log: 1 },
  at: new Date(NOW - 12_000).toISOString(),
  needs_human_count: 3,
  needs_human_bytes: null,
  needs_human: [
    {
      kind: 'worktree',
      target: 'hetero-feat-fs-pane-v2-c1mhR9',
      class: 'unintegrated-branch',
      age_days: 1,
      bytes: null,
      reason: '分支已併入，可移除',
      command: null,
    },
    {
      kind: 'tmp',
      target: '/dev/shm/petshot-1001',
      class: 'clean-integrated',
      age_days: null,
      bytes: null,
      reason: '寵物截圖沙盒（重拍後）',
      command: null,
    },
    {
      kind: 'file',
      target: 'target/flaky-tests.log',
      class: 'clean-integrated',
      age_days: 7,
      bytes: null,
      reason: null,
      command: null,
    },
  ],
  auto_ran_at: new Date(NOW - 3 * HOUR).toISOString(),
  auto_removed_count: null,
  auto_archived_count: null,
}

const EMPTY_RESIDUE: M.ResidueView = {
  reapable: 0,
  by_class: {},
  at: new Date(NOW - 12_000).toISOString(),
  needs_human_count: 0,
  needs_human_bytes: null,
  needs_human: [],
  auto_ran_at: null,
  auto_removed_count: null,
  auto_archived_count: null,
}

function liveOf(over: { state?: M.LiveSnapshot['state']; header?: string; residue?: M.ResidueView | null; load_source?: M.LoadSourceView | null } = {}): M.LiveSnapshot {
  return {
    state: over.state ?? 'ok',
    text: '',
    header: over.header ?? '',
    band: null,
    pending: [],
    project_key: '0000000000000001',
    root_run_id: null,
    link: null,
    rows: null,
    gates: null,
    sections: M.NO_SECTIONS,
    review: null,
    published_at: null,
    watcher_note: null,
    session_as_of: null,
    host_as_of: null,
    detail: {
      ...M.NO_DETAIL,
      now_ms: NOW,
      residue: over.residue === undefined ? MOCK_RESIDUE : over.residue,
      load_source: over.load_source === undefined ? LOAD_DEV : over.load_source,
    },
  }
}

const ctxOf = (cols: number, rows: number, live: M.LiveSnapshot | null = liveOf(), con: PageCtx['console'] = CALM_CON, locale: 'zh-TW' | 'en' = 'zh-TW', view?: Partial<HygieneView>): HygieneCtx => ({
  live,
  console: con,
  size: { cols, rows },
  t: locale === 'zh-TW' ? t : makeT('en'),
  nowMs: NOW,
  ...(view === undefined ? {} : { hygiene: view }),
})

// Note on wide (160x40 / 120x30) action rows: G11 ("Every clickable action is a Button bound to its key; a hint text must have a matching Button")
// adds `[z] 收合自動清理` to the wide action area alongside `[o]` and `[x]` because the body header displays `（z 收合）`.
const GOLDEN = {
  wide: [
    '殘留',
    '── 要你處理 ─────────────────────────────────────────────',
    '  ▲ worktree hetero-feat-fs-pane-v2-c1mhR9：分支已併入，可移除',
    '── 可清除 2 ──',
    '▸ ○ /dev/shm/petshot-1001 寵物截圖沙盒（重拍後）',
    '  ○ target/flaky-tests.log 7 天前',
    '── 自動清理紀錄 4 項（z 收合）──────────────────────',
    '  3 時前 · 清掉 4 項：build 暫存 2、舊 worktree 1、log 1',
    '── 外掛來源 ── ✓ autopilot 從主 clone develop 載入',
    '▸ 焦點：/dev/shm/petshot-1001',
    '[o] 清掉焦點這項',
    '[x] 全部清除（可清除 2 項）',
    '[z] 收合自動清理',
  ],
  open80: [
    '殘留',
    '── 要你處理 ──',
    ' ▲ worktree c1mhR9 已併入，可移除',
    '── 可清除 2 ──',
    '▸○ petshot-1001 沙盒',
    ' ○ flaky-tests.log',
    '── 自動清理 4 項（z 收合）──',
    ' 3 時前 · build 暫存 2、worktree 1、log 1',
    '── 外掛 ✓ develop',
    '[o] 清掉焦點這項',
    '[x] 全部清除 2 項',
    '[z] 收合自動清理',
  ],
  folded80: [
    '殘留',
    '── 要你處理 ──',
    ' ▲ worktree c1mhR9 已併入，可移除',
    '── 可清除 2 ──',
    '▸○ petshot-1001 沙盒',
    ' ○ flaky-tests.log',
    '── 自動清理 4 項（z 展開）──',
    '── 外掛 ✓ develop',
    '[o] 清掉焦點這項',
    '[x] 全部清除 2 項',
    '[z] 展開自動清理',
  ],
  empty: [
    '殘留',
    '○ 沒有要清的殘留',
    '沒有要你處理的事',
  ],
}

function drawn(cols: number, rows: number, live: M.LiveSnapshot | null = liveOf(), con: PageCtx['console'] = CALM_CON, view?: Partial<HygieneView>): string[] {
  const ctx = ctxOf(cols, rows, live, con, 'zh-TW', view)
  const out = frameRows(hygienePage, ctx)
  expect(out.length, `fixed height ${cols}x${rows}`).toBe(rows)
  expect(text(out[out.length - 1]), 'tab strip is last row').toMatch(/1\D*2\D*3\D*4\D*5\D*6\D*7\D*8/)
  return closeGap(out.slice(0, -1).map(text), Math.max(1, hygienePage.render(ctx).actions.length))
}

test('hygiene registry: replaces the shell at key 8 with a framed page', () => {
  const p = PAGES.find(x => x.id === 'hygiene')
  expect(p).toBe(hygienePage)
  expect(p?.key).toBe('8')
  expect(p?.title).toBe('殘留')
  expect(p?.framed).toBe(true)
})

test('hygiene golden: 160x40, 120x30 and 80x24 match the mockup rows in content and order, with exact height H', () => {
  expect(frameRows(hygienePage, ctxOf(160, 40)).length).toBe(40)
  expect(frameRows(hygienePage, ctxOf(120, 30)).length).toBe(30)
  expect(frameRows(hygienePage, ctxOf(80, 24)).length).toBe(24)

  expect(drawn(160, 40)).toEqual(GOLDEN.wide)
  expect(drawn(120, 30)).toEqual(GOLDEN.wide)
  expect(drawn(80, 24)).toEqual(GOLDEN.open80)

  // Negative control: mutating a row is detected
  const mutated = GOLDEN.open80.slice()
  mutated[4] = '▸○ other-1001 沙盒'
  expect(drawn(80, 24)).not.toEqual(mutated)
})

test('hygiene fold pair: collapsed (z 展開) hides the auto-cleanup detail row and flips [z] button; expanded (z 收合) shows it', () => {
  const folded80 = drawn(80, 24, liveOf(), CALM_CON, { focus: 0, expanded: false })
  const open80 = drawn(80, 24, liveOf(), CALM_CON, { focus: 0, expanded: true })
  expect(folded80).toEqual(GOLDEN.folded80)
  expect(open80).toEqual(GOLDEN.open80)
  expect(folded80.some(r => r.includes('3 時前'))).toBe(false)
  expect(open80.some(r => r.includes('3 時前 · build 暫存 2、worktree 1、log 1'))).toBe(true)

  // Wide fold pair (120x30) also toggles header hint and [z] action label while preserving H=30
  const folded120 = drawn(120, 30, liveOf(), CALM_CON, { focus: 0, expanded: false })
  expect(folded120.some(r => r.startsWith('── 自動清理紀錄 4 項（z 展開）'))).toBe(true)
  expect(folded120.some(r => r.includes('3 時前'))).toBe(false)
  expect(folded120[folded120.length - 1]).toBe('[z] 展開自動清理')
})

test('hygiene empty state: renders ○ 沒有要清的殘留 only when load_source is present and clean; missing load_source renders red error', () => {
  for (const [cols, rows] of SIZES) {
    const emptyLive = liveOf({ residue: EMPTY_RESIDUE, load_source: LOAD_DEV })
    const rendered = hygienePage.render(ctxOf(cols, rows, emptyLive, CALM_CON))
    expect(rendered.actions).toEqual([])
    expect(rendered.body.length).toBe(1)
    expect(rendered.body[0][0].color).toBe(PALETTE.idle)
    expect(rendered.body[0][1].dim).toBe(true)
    expect(drawn(cols, rows, emptyLive, CALM_CON)).toEqual(GOLDEN.empty)

    // Absent load_source with zero residue must NOT suppress the missing source as a calm empty state
    const missingLoadEmpty = liveOf({ residue: EMPTY_RESIDUE, load_source: null })
    const missingRendered = hygienePage.render(ctxOf(cols, rows, missingLoadEmpty, CALM_CON))
    expect(missingRendered.actions).toEqual([])
    expect(missingRendered.body.map(text).join('\n')).not.toContain('沒有要清的殘留')
    expect(missingRendered.body.some(r => r.some(s => s.color === PALETTE.broken && s.text.includes('✗ 無來源：沒有載入來源資料')))).toBe(true)
    const missingDrawn = drawn(cols, rows, missingLoadEmpty, CALM_CON)
    expect(missingDrawn).not.toEqual(GOLDEN.empty)
    expect(missingDrawn.some(r => r.includes('沒有要清的殘留'))).toBe(false)
    expect(missingDrawn.some(r => r.includes('✗ 無來源：沒有載入來源資料'))).toBe(true)
  }
  expect(drawn(80, 24, liveOf({ residue: EMPTY_RESIDUE, load_source: null }), CALM_CON)).toEqual([
    '殘留',
    '── 外掛 ✗ 無來源：沒有載入來源資料',
    '沒有要你處理的事',
  ])
  expect(drawn(120, 30, liveOf({ residue: EMPTY_RESIDUE, load_source: null }), CALM_CON)).toEqual([
    '殘留',
    '── 外掛來源 ── ✗ 無來源：沒有載入來源資料',
    '沒有要你處理的事',
  ])
})

test('hygiene fixed height & overflow: many items end in ↓ 還有 N 列 and never push the tab strip across all sizes and locales', () => {
  const manyClean: M.NeedsHumanEntry[] = Array.from({ length: 36 }, (_, i) => ({
    kind: 'worktree',
    target: `/tmp/wt-clean-${String(i).padStart(2, '0')}`,
    class: 'clean-integrated',
    age_days: i + 1,
    bytes: 4096,
    reason: null,
    command: null,
  }))
  const bigLive = liveOf({
    residue: { ...MOCK_RESIDUE, reapable: 36, needs_human_count: 37, needs_human: [MOCK_RESIDUE.needs_human[0], ...manyClean] },
  })
  for (const locale of ['zh-TW', 'en'] as const) {
    for (const [cols, rows] of SIZES) {
      const ctx = ctxOf(cols, rows, bigLive, CALM_CON, locale)
      const rendered = hygienePage.render(ctx)
      expect(rendered.actions.length).toBeLessThanOrEqual(actionRows(rows))
      const out = frameRows(hygienePage, ctx)
      expect(out.length).toBe(rows)
      for (const r of out) expect(displayWidth(text(r))).toBeLessThanOrEqual(cols)
      const moreWord = locale === 'zh-TW' ? '↓ 還有 ' : '↓ '
      expect(out.some(r => text(r).startsWith(moreWord))).toBe(true)
      const actStart = rows - 1 - rendered.actions.length
      expect(text(out[actStart - 1]).startsWith(moreWord)).toBe(true)
    }
  }
})

test('hygiene §5: missing and stale sources render in red (PALETTE.broken) with full reason wrapped, never truncated with …', () => {
  // 1. Null live snapshot
  for (const [cols, rows] of SIZES) {
    const res = hygienePage.render(ctxOf(cols, rows, null, null))
    expect(res.actions).toEqual([])
    expect(text(res.body[0])).toContain('無來源')
    expect(res.body[0][0].color).toBe(PALETTE.broken)
    expect(frameRows(hygienePage, ctxOf(cols, rows, null, null)).length).toBe(rows)
  }

  // 2. Null residue in live.detail
  const noResidue = hygienePage.render(ctxOf(80, 24, liveOf({ residue: null, load_source: null }), null))
  expect(text(noResidue.body[0])).toContain('沒有 worktree 殘留資料')
  expect(noResidue.body[0][0].color).toBe(PALETTE.broken)

  // 3. Stale live snapshot with a long reason wraps onto further red rows without truncation
  const longWhy = '資料過舊 · 上次發佈 08:15 · watcher 沒有在發佈，請執行 autopilot status runs --watch 重新啟動本席監看程序並確認殘留狀態'
  for (const cols of [80, 70]) {
    const staleLive = liveOf({ state: 'stale', header: longWhy, residue: null, load_source: null })
    const ctx = ctxOf(cols, 24, staleLive, CALM_CON)
    const raw = hygienePage.render(ctx)
    expect(raw.body.length).toBeGreaterThan(1)
    for (const r of raw.body) {
      expect(r[0].color).toBe(PALETTE.broken)
      expect(displayWidth(text(r))).toBeLessThanOrEqual(cols)
      expect(text(r).includes('…')).toBe(false)
    }
    const framed = frameRows(hygienePage, ctx)
    expect(framed.length).toBe(24)
    expect(framed.map(text).join('').replace(/\s+/g, '')).toContain(('本席殘留資料不是最新：' + longWhy).replace(/\s+/g, ''))
    expect(framed.map(text).filter(r => r.includes('…'))).toEqual([])
  }

  // 4. Missing load_source on non-empty residue page marks 外掛來源 red without cutting
  const missingLoad = hygienePage.render(ctxOf(80, 24, liveOf({ load_source: null }), CALM_CON))
  const loadRow = missingLoad.body[missingLoad.body.length - 1]
  expect(text(loadRow)).toContain('✗ 無來源：沒有載入來源資料')
  expect(loadRow.some(s => s.color === PALETTE.broken)).toBe(true)

  // 5. marketplace='missing' and dev_link_missing_or_stale render in red (PALETTE.broken) with ✗, never attention ▲
  const brokenLoadCases: [string, M.LoadSourceView, string][] = [
    ['marketplace missing', { ...LOAD_DEV, marketplace: 'missing' }, '市集不是指向這個 repo 的目錄，/reload-plugins 可能載到舊版'],
    ['dev link missing or stale', { ...LOAD_DEV, flags: ['dev_link_missing_or_stale'] }, '開發連結不見了或過期'],
    ['both marketplace missing and dev link stale', { ...LOAD_DEV, marketplace: 'missing', flags: ['dev_link_missing_or_stale'] }, '開發連結不見了或過期；市集不是指向這個 repo 的目錄，/reload-plugins 可能載到舊版'],
  ]
  for (const [name, lsBroken, expectedReason] of brokenLoadCases) {
    for (const [cols, rows] of SIZES) {
      const ctx = ctxOf(cols, rows, liveOf({ residue: EMPTY_RESIDUE, load_source: lsBroken }), CALM_CON)
      const rendered = hygienePage.render(ctx)
      const joined = rendered.body.map(text).join('')
      expect(joined, `${name} at ${cols}x${rows} carries ✗`).toContain('✗')
      expect(joined.replace(/\s+/g, ''), `${name} at ${cols}x${rows} keeps full reason`).toContain(expectedReason.replace(/\s+/g, ''))
      expect(joined.includes('…'), `${name} at ${cols}x${rows} never truncates`).toBe(false)
      expect(joined.includes('▲'), `${name} at ${cols}x${rows} never uses attention glyph`).toBe(false)
      for (const r of rendered.body) {
        expect(displayWidth(text(r)), `${name} at ${cols}x${rows} width <= ${cols}`).toBeLessThanOrEqual(cols)
        expect(r.some(s => s.color === PALETTE.attention), `${name} at ${cols}x${rows} never uses PALETTE.attention`).toBe(false)
      }
      const errSegs = rendered.body.flatMap(r => r.filter(s => s.color !== PALETTE.structure))
      expect(errSegs.length, `${name} at ${cols}x${rows} has error segments`).toBeGreaterThan(0)
      for (const s of errSegs) expect(s.color, `${name} at ${cols}x${rows} error segment is PALETTE.broken`).toBe(PALETTE.broken)
    }
  }

  // 6. Width-exceeding reasons on marketplace='missing' and dev_link_missing_or_stale wrap across multiple red rows without truncation
  const wrappingCases: [string, M.LoadSourceView, 'zh-TW' | 'en', number, string][] = [
    [
      'zh-TW combined missing marketplace + stale dev link at 80 cols',
      { ...LOAD_DEV, marketplace: 'missing', flags: ['dev_link_missing_or_stale'] },
      'zh-TW',
      80,
      '✗ develop（開發連結不見了或過期；市集不是指向這個 repo 的目錄，/reload-plugins 可能載到舊版）',
    ],
    [
      'en missing marketplace at 80 cols',
      { ...LOAD_DEV, marketplace: 'missing' },
      'en',
      80,
      '✗ develop（the marketplace does not point to a directory of this repo; /reload-plugins may load an old version）',
    ],
    [
      'zh-TW stale dev link on long branch ref at 80 cols',
      { ...LOAD_DEV, source: 'dev:hetero-fix-pane-b2-hygiene-r1-very-long-branch-ref-for-wrapping-check', flags: ['dev_link_missing_or_stale'] },
      'zh-TW',
      80,
      '✗ hetero-fix-pane-b2-hygiene-r1-very-long-branch-ref-for-wrapping-check（開發連結不見了或過期）',
    ],
  ]
  for (const [label, lsLong, locale, cols, fullErr] of wrappingCases) {
    expect(displayWidth(fullErr), `${label} fixture exceeds ${cols} cols`).toBeGreaterThan(cols)
    const ctx = ctxOf(cols, 24, liveOf({ residue: EMPTY_RESIDUE, load_source: lsLong }), CALM_CON, locale)
    const raw = hygienePage.render(ctx)
    // Row 0 is the section lead; rows 1+ are wrapped red error lines
    expect(raw.body.length, `${label} wraps onto multiple rows`).toBeGreaterThanOrEqual(3)
    expect(raw.body[0][0].color, `${label} row 0 is structure lead`).toBe(PALETTE.structure)
    const wrappedErrRows = raw.body.slice(1)
    for (const r of wrappedErrRows) {
      expect(r.length, `${label} wrapped row is single broken segment`).toBe(1)
      expect(r[0].color, `${label} wrapped row is PALETTE.broken`).toBe(PALETTE.broken)
      expect(displayWidth(text(r)), `${label} wrapped row fits ${cols}`).toBeLessThanOrEqual(cols)
      expect(text(r).includes('…'), `${label} wrapped row has no ellipsis`).toBe(false)
    }
    expect(wrappedErrRows.map(text).join('').replace(/\s+/g, '')).toBe(fullErr.replace(/\s+/g, ''))
    const framed = frameRows(hygienePage, ctx)
    expect(framed.length).toBe(24)
    expect(framed.map(text).join('').replace(/\s+/g, '')).toContain(fullErr.replace(/\s+/g, ''))
    expect(framed.map(text).filter(r => r.includes('…'))).toEqual([])
  }

  // Negative control: non-missing/non-stale behind_upstream keeps attention ▲ (not broken ✗)
  const behindOnly = hygienePage.render(ctxOf(80, 24, liveOf({ residue: EMPTY_RESIDUE, load_source: { ...LOAD_DEV, behind_upstream: 3 } }), CALM_CON))
  expect(behindOnly.body[0].some(s => s.color === PALETTE.attention && s.text === '▲')).toBe(true)

  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))
})

test('hygiene buttons & design rules: table rows have no Buttons; [o], [x], [z] in actions are Buttons bound to their hotkeys; no bold/bg/inverse', () => {
  type Node = { kind: string; props: Record<string, any> }
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
  const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
  const walk = (n: any, out: Node[] = []): Node[] => {
    if (!n || typeof n !== 'object') return out
    if (Array.isArray(n)) { n.forEach(c => walk(c, out)); return out }
    if (n.kind !== undefined) out.push(n)
    walk(n.props?.children, out)
    return out
  }
  const flatNode = (n: any): string => {
    const c = n?.props?.children
    return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flatNode(x) : '')).join('') : c?.props ? flatNode(c) : ''
  }

  // Check pure segments first: no press on any body row, no bold/backgroundColor/inverse anywhere
  for (const [cols, rows] of SIZES) {
    const out = hygienePage.render(ctxOf(cols, rows))
    for (const r of out.body) {
      for (const s of r) {
        expect(s.press, 'body rows carry no press buttons').toBeUndefined()
        expect(s.bold).toBeUndefined()
        expect((s as Record<string, unknown>).backgroundColor).toBeUndefined()
        expect((s as Record<string, unknown>).inverse).toBeUndefined()
      }
    }
    for (const r of out.actions) {
      for (const s of r) {
        expect(s.bold).toBeUndefined()
        expect((s as Record<string, unknown>).backgroundColor).toBeUndefined()
        expect((s as Record<string, unknown>).inverse).toBeUndefined()
      }
    }
  }

  // Mount through real Pane at 160x40, 120x30 and 80x24: verify o, x, z hotkeys and press targets
  for (const [cols, rows] of SIZES) {
    const events: string[] = []
    const tree = Pane(EL as never, liveOf(), 'hygiene', () => {}, t, cols, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
      pages: PAGES,
      pageId: 'hygiene',
      console: CALM_CON,
      nowMs: NOW,
      rows,
      onPress: id => events.push('press:' + id),
      onKey: k => events.push('key:' + k.kind),
    })
    const nodes = walk(tree)
    const rowBoxes = nodes.filter(n => n.kind === 'Box' && /^f\d+$/.test(String(n.props.key ?? '')))
    expect(rowBoxes.length).toBe(rows)

    // No Button in body rows (row 0 is header, last row is strip, actions sit right above strip)
    const actCount = hygienePage.render(ctxOf(cols, rows)).actions.length
    const bodyBoxes = rowBoxes.slice(1, rows - 1 - actCount)
    for (const b of bodyBoxes) {
      expect(walk(b).filter(n => n.kind === 'Button'), `no Button in body at ${cols}x${rows}`).toEqual([])
    }

    // No empty-label Button anywhere outside FOCUS_ANCHOR_KEY
    const nonAnchorBtns = nodes.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY)
    expect(nonAnchorBtns.filter(b => flatNode(b).trim() === '')).toEqual([])

    const btnO = nonAnchorBtns.find(b => b.props.hotkey === 'o')
    const btnX = nonAnchorBtns.find(b => b.props.hotkey === 'x')
    const btnZ = nonAnchorBtns.find(b => b.props.hotkey === 'z')
    expect(btnO, `o button at ${cols}x${rows}`).toBeDefined()
    expect(btnX, `x button at ${cols}x${rows}`).toBeDefined()
    expect(btnZ, `z button at ${cols}x${rows}`).toBeDefined()

    btnO!.props.onPress()
    btnX!.props.onPress()
    btnZ!.props.onPress()
    expect(events).toEqual(['press:clean:/dev/shm/petshot-1001', 'press:clean:all', 'key:fold'])
  }

  // Moving focus to index 1 retargets [o] to the second cleanable item (both via real hygienePage.render and hygieneView)
  const focusPage1 = hygienePage.render(ctxOf(120, 30, liveOf(), CALM_CON, 'zh-TW', { focus: 1, expanded: true }))
  expect(text(focusPage1.actions[0])).toBe('▸ 焦點：target/flaky-tests.log')
  expect(focusPage1.actions[1][0].press).toBe('clean:target/flaky-tests.log')
  const focus1 = hygieneView(ctxOf(120, 30), { focus: 1, expanded: true })
  expect(text(focus1.actions[0])).toBe('▸ 焦點：target/flaky-tests.log')
  expect(focus1.actions[1][0].press).toBe('clean:target/flaky-tests.log')
})
