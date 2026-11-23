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
import { PALETTE } from '../../tux/palette.ts'
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
    '  ⏶ worktree hetero-feat-fs-pane-v2-c1mhR9：分支已併入，可移除',
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
    ' ⏶ worktree c1mhR9 已併入，可移除',
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
    ' ⏶ worktree c1mhR9 已併入，可移除',
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
  return closeGap(out.slice(0, -2).map(text), Math.max(1, hygienePage.render(ctx).actions.length))
}

test('hygiene registry: replaces the shell at key 6 with a framed page', () => {
  const p = PAGES.find(x => x.id === 'hygiene')
  expect(p).toBe(hygienePage)
  expect(p?.key).toBe('6')
  expect(p?.title).toBe('殘留')
  expect(p?.framed).toBe(true)
})
