// mods/live/pages/spend.test.ts — page 7 花費 (plan r2 §2 row 7, §3.1, §5): golden rows at 160x40, 120x30, 80x24 and 80x24 stale,
// fixed height H across every size and state, fold pair (collapsed / expanded) + overflow row, red stale/no-source wrapping, [5] & [z] Buttons, and empty states.
import type { EngineInterface, On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY } from '../pane'
import { makeT } from '../i18n'
import * as M from '../model'
import { displayWidth } from '../model'
import { paneKey } from '../register'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import type { ConsoleSnapshot } from '../console'
import { actionRows, brokenRow as frameBroken, frameRows, staleBadge as frameBadge } from './frame'
import type { PageCtx, Row } from './frame'
import { PAGES } from './index'
import { seatQuota } from './now'
import { brokenRow, staleBadge } from './rows'
import { renderSpend, spendFocusRows, spendPage } from './spend'

const t = makeT('zh-TW')
const MIN = 60_000
// 2026-11-18 12:00 Taipei (Wednesday); resets at 03:40 Taipei and 2026-11-21 (Saturday) 12:00 Taipei
const NOW = Date.UTC(2026, 10, 18, 4, 0, 0)
const RESET_5H = Date.UTC(2026, 10, 18, 19, 40, 0)
const RESET_7D = Date.UTC(2026, 10, 21, 4, 0, 0)

const HOURLY_WIDE = [0, 0, 1, 2, 4, 1, 0, 0, 0, 1, 1, 2, 0, 0, 0, 0, 1, 4, 7, 2, 1, 0, 0, 0]
const HOURLY_NARROW = [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 1, 0, 1, 4, 6, 2]
const SEAT_JSON = JSON.stringify([
  { seat: 'codeforge--claude', pool_key: 'team', five_hour_pct: 17.4, seven_day_pct: 68.2, stale: false, self: true },
  { seat: 'other--claude', pool_key: 'personal', five_hour_pct: 5, seven_day_pct: 20, stale: false, self: false },
])

const okRun = (stdout: string) => async () => ({ exitCode: 0, stdout })
const failRun = async () => ({ exitCode: 1, stdout: '' })
const text = (row: { text: string }[]): string => row.map(s => s.text).join('')

function calmConsole(over: Partial<ConsoleSnapshot> = {}): ConsoleSnapshot {
  const okSrc = { at_ms: NOW - 12_000, state: 'ok' as const }
  return {
    generated_at_ms: NOW - 12_000,
    sources: {
      tasks: okSrc,
      hosts: okSrc,
      cards: okSrc,
      quota_now: { at_ms: NOW - 40_000, state: 'ok' as const },
      quota_forecast: { at_ms: NOW - 40_000, state: 'ok' as const },
    },
    counts: {
      decisions: 0,
      exceptions: 0,
      quota_risk: 0,
      tabs: {},
      summary: { lines: { running: 2, waiting: 4, stalled: 0 }, hosts: { online: 4, total: 4 }, hints: 0, quota_worst: null },
    },
    items: [],
    cards: [],
    lines: [],
    quota: {
      pools: [{
        pool: 'team',
        seven_day_pct: 68,
        five_hour_pct: 17,
        resets_at_ms: RESET_7D,
        burn_pct_per_h: 1.4,
        burn_window_h: 6,
        projected_pct_at_reset: 98,
        projected_exhaustion_at_ms: null,
        seat_count: 3,
        limit_hit: false,
        stale: false,
        stale_age_min: null,
        stale_note: null,
        observed_at_ms: NOW - 40_000,
        stranded_seats: 0,
        switched: null,
        switch_suggestion: null,
      }],
      seats: [],
    },
    ...over,
  } as ConsoleSnapshot
}

function liveOf(hourly: number[] | null = HOURLY_WIDE, over: Record<string, unknown> = {}): M.LiveSnapshot {
  return {
    state: 'ok',
    text: '',
    header: '',
    band: null,
    pending: [],
    project_key: 'plan/shared-tui',
    root_run_id: null,
    link: null,
    rows: [],
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
      project: 'plan/shared-tui',
      spend: { session: '$3.10', host_all: '', host_all_n: null, brain: null, cap: null, mode: 'warn', hourly },
    },
    account: {
      account: undefined,
      quota: [
        { kind: 'five_hour', pct: 17.4, resetsAtMs: RESET_5H },
        { kind: 'seven_day', pct: 68.2, resetsAtMs: RESET_7D },
      ],
    },
    ...over,
  } as unknown as M.LiveSnapshot
}

const ctxOf = (cols: number, rows: number, con: ConsoleSnapshot | null = calmConsole(), live: M.LiveSnapshot | null = liveOf()): PageCtx => ({
  live,
  console: con,
  size: { cols, rows },
  t,
  nowMs: NOW,
})

async function feedFresh(): Promise<void> {
  seatQuota.reset()
  await seatQuota.refresh(okRun(SEAT_JSON), NOW - 40_000)
}

async function feedStale25m(): Promise<void> {
  seatQuota.reset()
  await seatQuota.refresh(okRun(SEAT_JSON), NOW - 25 * MIN)
  await seatQuota.refresh(failRun, NOW - 10_000)
}

const GOLD_WIDE_BODY = [
  '── 本席 codeforge--claude（seats --quota 那一列，40 秒前；池 team）──',
  '▸ 5 小時  ▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  17%    重置 03:40',
  '  7 天    ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱  68%    重置 11-21 週六 12:00',
  '  今天    $3.10 · 近 24 小時 ▁▁▂▃▅▂▁▁▁▂▂▃▁▁▁▁▂▅█▃▂▁▁▁',
  // X5: the former internal spacer moves to the frame's top padding.
  '  額度看 [5]',
]

const GOLD_80_BODY = [
  '── 本席（池 team，40 秒前）──',
  '▸5時 ▰▰▱▱▱▱▱▱▱▱ 17% 重置 03:40',
  ' 7天 ▰▰▰▰▰▰▰▱▱▱ 68% 重置 週六',
  ' 今天 $3.10 ▁▂▃▅▂▁▂▅▇▃',
  ' 額度看 [5]',
]

const GOLD_80_STALE_BODY = [
  '── 本席（池 team）──',
  '▸5時 ▰▰▱▱▱▱▱▱▱▱ 17% ✗ 重置 03:40',
  ' 7天 ▰▰▰▰▰▰▰▱▱▱ 68% ✗ 重置 週六',
  ' ✗ 25 分未更新，以上是舊數字',
  ' ✗ fleet seats --quota 指令失敗，用 25 分前的舊結果',
  ' 今天 $3.10 ▁▂▃▅▂▁▂▅▇▃',
  ' 額度看 [5]',
]

const diffRows = (got: string[], want: string[]): string[] => {
  const bad: string[] = []
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] !== want[i]) bad.push(`#${i} got ${JSON.stringify(got[i])} want ${JSON.stringify(want[i])}`)
  }
  return bad
}

test('spend: registry places framed spendPage at key 5 with title 花費', () => {
  const entry = PAGES.find(p => p.id === 'spend')
  expect(entry).toBe(spendPage)
  expect(spendPage.framed).toBe(true)
  expect(spendPage.key).toBe('5')
  expect(spendPage.title).toBe('花費')
})

test('spend golden: 160x40, 120x30, 80x24 and 80x24 stale match the four mockups row for row with fixed height H', async () => {
  // X5: 160x40 (header 1 + blank gap 32 + body 5 + calm empty state 1 + strip 1 = 40)
  await feedFresh()
  const out160 = frameRows(spendPage, ctxOf(160, 40)).map(text)
  expect(out160.length).toBe(40)
  expect(out160[0]).toBe('花費')
  expect(out160.slice(1, 32).every(r => r === '')).toBe(true)
  expect(diffRows(out160.slice(32, 37), GOLD_WIDE_BODY)).toEqual([])
  expect(out160[37]).toBe('沒有要你處理的事')
  expect(out160[39]).toContain('5 花費')
  expect(out160[39]).toContain('9 說明') // V5: close with host ✕ / band [-]; Escape belongs to its focused surface.

  // X5: 120x30 (header 1 + blank gap 22 + body 5 + calm empty state 1 + strip 1 = 30)
  const out120 = frameRows(spendPage, ctxOf(120, 30)).map(text)
  expect(out120.length).toBe(30)
  expect(out120[0]).toBe('花費')
  expect(out120.slice(1, 22).every(r => r === '')).toBe(true)
  expect(diffRows(out120.slice(22, 27), GOLD_WIDE_BODY)).toEqual([])
  expect(out120[27]).toBe('沒有要你處理的事')
  expect(out120[29]).toContain('5 花費')

  // 3. 80x24 fresh (header 1 + blank gap 16 + body 5 + calm empty state 1 + strip 1 = 24)
  const raw80 = frameRows(spendPage, ctxOf(80, 24, calmConsole(), liveOf(HOURLY_NARROW)))
  const out80 = raw80.map(text)
  expect(out80.length).toBe(24)
  expect(out80[0]).toBe('花費')
  expect(out80.slice(1, 16).every(r => r === '')).toBe(true)
  expect(diffRows(out80.slice(16, 21), GOLD_80_BODY)).toEqual([])
  expect(out80[21]).toBe('沒有要你處理的事')
  expect(out80[23]).toContain('5 花')
  expect(raw80[23].find(s => s.press === 'tab:5:spend')?.color).toBe(PALETTE.here)

  // 4. 80x24 stale own-seat quota after refresh failure (header 1 + blank gap 14 + body 7 + unknown action row 1 + strip 1 = 24)
  await feedStale25m()
  const rawStale = frameRows(spendPage, ctxOf(80, 24, calmConsole(), liveOf(HOURLY_NARROW)))
  const out80Stale = rawStale.map(text)
  expect(out80Stale.length).toBe(24)
  expect(out80Stale.slice(1, 14).every(r => r === '')).toBe(true)
  expect(diffRows(out80Stale.slice(14, 21), GOLD_80_STALE_BODY)).toEqual([])
  expect(out80Stale[21]).toBe('資料不足，無法判定')
  // Stale marks, age warning row and refresh failure reason row use PALETTE.broken, no background, no inverse, no bold
  expect(rawStale[15].some(s => s.text.includes(GLYPHS.state.failed) && s.color === PALETTE.broken)).toBe(true)
  expect(rawStale[16].some(s => s.text.includes(GLYPHS.state.failed) && s.color === PALETTE.broken)).toBe(true)
  expect(rawStale[17][0].color).toBe(PALETTE.broken)
  expect(rawStale[18][0].color).toBe(PALETTE.broken)
  for (const r of rawStale) {
    for (const s of r as (M.Seg & { background?: unknown; inverse?: unknown })[]) {
      expect(s.background).toBeUndefined()
      expect(s.inverse).toBeUndefined()
      expect(s.bold).toBeUndefined()
    }
  }
})

test('spend: negative control confirms diffRows reports planted golden drift', async () => {
  await feedFresh()
  const out80 = frameRows(spendPage, ctxOf(80, 24, calmConsole(), liveOf(HOURLY_NARROW))).map(text)
  const mutated = GOLD_80_BODY.slice()
  mutated[1] = '▸5時 ▰▰▱▱▱▱▱▱▱▱ 18% 重置 03:40'
  expect(diffRows(out80.slice(16, 21), mutated).length).toBe(1)
})

type HostNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const hostNodeText = (n: HostNode): string =>
  (n.type === 'Link' || n.type === 'Button') && typeof n.props?.label === 'string'
    ? (n.props.label as string)
    : (n.children || []).map(c => (typeof c === 'string' ? c : hostNodeText(c as HostNode))).join('')

const framedRowsOf = (tree: HostNode): string[] => {
  const out: string[] = []
  const walk = (n: HostNode) => {
    for (const c of (n.children || []) as HostNode[]) {
      if (typeof c === 'string') continue
      if (/^f\d+$/.test(String(c.props?.key))) out.push(hostNodeText(c))
      else walk(c)
    }
  }
  walk(tree)
  return out
}

const HOME = '/fake/home'
const AHOME = HOME + '/.autopilot'
const LIVE = '/fake/live'
const REPO = '/work/repo'
const CWD = REPO + '/sub'
const KEY = '0000000000000001'
const ROOT = 'root-spend'
const SID = 'sid-spend'
const PUBLISHED = new Date(NOW - 10_000).toISOString()

function setupMountedSpend(on: On, rateLimits: object[] = [
  { kind: 'five_hour', percentUsed: 17.4, resetsAt: new Date(RESET_5H).toISOString() },
  { kind: 'seven_day', percentUsed: 68.2, resetsAt: new Date(RESET_7D).toISOString() },
  { kind: 'spend_limit', percentUsed: 85, resetsAt: new Date(RESET_7D).toISOString() },
]) {
  const files: Record<string, string> = {
    [AHOME + '/live-pointer.json']: JSON.stringify({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: AHOME, written_at: PUBLISHED }),
    [AHOME + '/session-mode/' + SID + '.json']: JSON.stringify({ session_id: SID, level: 'l5', project_key: KEY, root_run_id: ROOT, expires_at: new Date(NOW + 86_400_000).toISOString() }),
    [LIVE + '/runs/' + KEY + '--' + ROOT + '.json']: JSON.stringify({
      schema: 'autopilot.runs-live/1',
      scope: { project_key: KEY, repo_identity: 'git-common-dir:' + REPO + '/.git', root_run_id: ROOT },
      published_at: PUBLISHED,
      observed_at: PUBLISHED,
      valid_for_s: 180,
      writer: null,
      runs: [],
      counts: { confirmed_live: 0, exited: 0, unknown: 0, fresh_bound_s: 30 },
      sessions: { [SID]: { session_usd: 3.1, as_of: PUBLISHED } },
      host_today_usd: 12.4,
      host_today_as_of: PUBLISHED,
      host_today_brain_usd: 8.2,
      brain_cap_usd: 50,
    }),
    [LIVE + '/runs/spend-history.json']: JSON.stringify({
      schema: 'autopilot.spend-history/1',
      samples: [
        { at: new Date(NOW - 90 * MIN).toISOString(), usd: 1.0 },
        { at: new Date(NOW - 45 * MIN).toISOString(), usd: 4.5 },
        { at: new Date(NOW - 5 * MIN).toISOString(), usd: 6.5 },
      ],
    }),
    [LIVE + '/context/' + SID + '.json']: JSON.stringify({ schema_version: 1, written_at: PUBLISHED, context_window: { used_percentage: 22 } }),
    [HOME + '/.claude.json']: JSON.stringify({
      oauthAccount: {
        emailAddress: 'dev@example.com',
        displayName: 'Dev',
        organizationName: 'TeamOrg',
        organizationRole: 'member',
        organizationType: 'claude_max',
        organizationRateLimitTier: 'default_claude_max_20x',
        hasExtraUsageEnabled: true,
      },
    }),
    [REPO + '/.git/HEAD']: 'ref: refs/heads/main\n',
    [REPO + '/.claude/console.json']: JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' }),
  }
  const env: Record<string, string> = { HOME, AUTOPILOT_LOCALE: 'zh-TW' }
  let invalidates = 0
  const closes: string[] = []

  const listDir = (dirPath: string) => {
    const prefix = dirPath.replace(/\/$/, '') + '/'
    const seen = new Map<string, 'file' | 'dir'>()
    for (const p of Object.keys(files)) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) seen.set(rest, 'file')
      else if (!seen.has(rest.slice(0, slash))) seen.set(rest.slice(0, slash), 'dir')
    }
    if (seen.size === 0) throw new Error('ENOENT ' + dirPath)
    return [...seen].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: NOW - 10_000, isLink: false as const }))
  }
  const statPath = (p: string, resolve?: boolean) => {
    if (files[p] !== undefined) return { kind: 'file' as const, isLink: false as const, size: files[p].length, mtimeMs: NOW - 10_000 }
    const prefix = p.replace(/\/$/, '') + '/'
    if (p === CWD || p === REPO || Object.keys(files).some(k => k.startsWith(prefix))) {
      return { kind: 'dir' as const, isLink: false as const, size: 0, mtimeMs: NOW - 10_000, realPath: resolve ? p : undefined }
    }
    throw new Error('ENOENT ' + p)
  }

  const clock = mock.clock(on, { now: NOW })
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('fs.read', (_$, e) => {
    const v = files[e.path]
    if (v === undefined) throw new Error('ENOENT ' + e.path)
    return { value: v }
  })
  on('fs.exists', (_$, e) => ({ value: files[e.path] !== undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', (_$, e) => ({ value: listDir(e.path) }))
  on('fs.stat', (_$, e) => ({ value: statPath(e.path, e.resolve) }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: REPO }))
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', () => ({ sessionId: SID }))
  on('session.messages', () => ({ value: [] }))
  on('session.usage', () => ({ value: { rateLimits } }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
  on('ui.invalidate', () => { invalidates += 1; return { value: undefined } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_$, e) => { closes.push(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('process.run', (_$, e) => ({
    value: e.argv[0] === 'fleet' && e.argv[1] === 'seats'
      ? { exitCode: 0, stdout: SEAT_JSON, stderr: '', isStdoutTruncated: false as const, isStderrTruncated: false as const }
      : { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false as const, isStderrTruncated: false as const },
  }))

  const eng = {
    clock: { now: async () => NOW, every: () => ({ cancel: () => {} }) },
    state: { get: async () => ({ value: M.NO_DECIDE }), set: async () => undefined },
    prompt: { fill: async () => ({ isFilled: true }) },
    ui: {
      invalidate: () => { invalidates += 1 },
      toast: () => {},
      open: async () => ({ isPlaced: true }),
      close: async (a: { id: string }) => { closes.push(a.id) },
    },
  } as unknown as EngineInterface

  return { eng, clock, closes, getInvalidates: () => invalidates }
}

async function readMountedPane($: any, bodyRows: number, bodyColumns = 120) {
  const m = await $.ui.mount({
    plugin: 'autopilot',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'autopilot-live',
    props: { title: 'Autopilot', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: { agentId: undefined } },
    viewport: { columns: 160, rows: 50, isFullscreen: true },
  })
  const tree = (await m.drawn()) as HostNode
  const buttons = (await m.findAll({ type: 'Button' })) as HostNode[]
  await m.unmount()
  return { tree, rows: framedRowsOf(tree), buttons }
}

async function pressMountedButton($: any, bodyRows: number, match: (b: HostNode) => boolean, clock?: { advance: (ms: number) => Promise<void> }) {
  const m = await $.ui.mount({
    plugin: 'autopilot',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'autopilot-live',
    props: { title: 'Autopilot', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: { agentId: undefined } },
    viewport: { columns: 160, rows: 50, isFullscreen: true },
  })
  const buttons = (await m.findAll({ type: 'Button' })) as HostNode[]
  const target = buttons.find(match)
  expect(target).toBeDefined()
  await m.press({ key: target!.props?.key as string })
  if (clock !== undefined) await clock.advance(0)
  else await Promise.resolve()
  await m.unmount()
}

test('spend real path (120x13): register key handler -> mounted Pane render toggles z expand/collapse and moves focus with j/k', async ($, on) => {
  await feedFresh()
  const { eng, clock } = setupMountedSpend(on)
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await clock.advance(5_000)

  // Switch to page 7 (spend) via the mounted strip Button
  await pressMountedButton($, 13, b => b.props?.key === 'spend' && b.props?.hotkey === '5', clock)

  // Initial render at 13 rows (v7.4 border row: room = 9 < 12 expanded rows): starts collapsed, focus marker on 5 小時
  const init = await readMountedPane($, 13)
  expect(init.rows.length).toBe(13)
  expect(init.rows[0]).toContain('花費')
  expect(init.rows.some(l => l.startsWith('▸ 5 小時'))).toBe(true)
  expect(init.rows.some(l => l.startsWith('  7 天'))).toBe(true)
  expect(init.rows.some(l => l.includes('展開明細（5 列）'))).toBe(true)
  expect(init.rows.some(l => l.includes('$8.20 / $50.00'))).toBe(false)

  // Press z on the spend page -> render: expanded content shows (with overflow ↓ 還有 4 列)
  await pressMountedButton($, 13, b => b.props?.hotkey === 'z', clock)
  const open1 = await readMountedPane($, 13)
  expect(open1.rows.length).toBe(13)
  expect(open1.rows.some(l => l.includes('收合明細'))).toBe(true)
  expect(open1.rows.some(l => l.includes('brain') && l.includes('$8.20 / $50.00'))).toBe(true)
  expect(open1.rows.some(l => l.includes('本機今日 $12.40'))).toBe(true)
  expect(open1.rows.some(l => l.startsWith('↓ 還有 '))).toBe(true)

  // Press z again -> render: collapsed
  await pressMountedButton($, 13, b => b.props?.hotkey === 'z', clock)
  const shut = await readMountedPane($, 13)
  expect(shut.rows.length).toBe(13)
  expect(shut.rows.some(l => l.includes('展開明細（5 列）'))).toBe(true)
  expect(shut.rows.some(l => l.includes('$8.20 / $50.00'))).toBe(false)
  expect(shut.rows.some(l => l.startsWith('↓ 還有 '))).toBe(false)

  // Press 7 天 meter row Button -> render: focus marker moved one row while staying collapsed
  await pressMountedButton($, 13, b => String(b.props?.key ?? '').startsWith('p:') && hostNodeText(b).includes('7 天'), clock)
  const movedDown = await readMountedPane($, 13)
  expect(movedDown.rows.some(l => l.startsWith('  5 小時'))).toBe(true)
  expect(movedDown.rows.some(l => l.startsWith('▸ 7 天'))).toBe(true)
  expect(movedDown.rows.some(l => l.includes('展開明細（5 列）'))).toBe(true)

  // Press 5 小時 meter row Button -> render: focus marker moved back to 5 小時
  await pressMountedButton($, 13, b => String(b.props?.key ?? '').startsWith('p:') && hostNodeText(b).includes('5 小時'), clock)
  const movedUp = await readMountedPane($, 13)
  expect(movedUp.rows.some(l => l.startsWith('▸ 5 小時'))).toBe(true)
  expect(movedUp.rows.some(l => l.startsWith('  7 天'))).toBe(true)

  // Direct register key handler routing on '5', 'z', 'j'/'ArrowDown', and 'k'/'ArrowUp'
  expect(await paneKey(eng, '5')).toEqual({ kind: 'page', to: 'spend' })
  expect(await paneKey(eng, 'z')).toEqual({ kind: 'fold' })
  expect(await paneKey(eng, 'j')).toEqual({ kind: 'move', by: 1 })
  expect(await paneKey(eng, 'ArrowDown')).toEqual({ kind: 'move', by: 1 })
  expect(await paneKey(eng, 'k')).toEqual({ kind: 'move', by: -1 })
  expect(await paneKey(eng, 'ArrowUp')).toEqual({ kind: 'move', by: -1 })
})

test('spend real path (120x30): unfold callback, z / [z] Button, j / k focus movement, [5] quota jump, and direct renderSpend view parameter', async ($, on) => {
  await feedFresh()
  const { clock } = setupMountedSpend(on)
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await clock.advance(5_000)

  // Switch to spend via strip hotkey '5' Button
  await pressMountedButton($, 30, b => b.props?.key === 'spend' && b.props?.hotkey === '5', clock)

  // Initial tall dock render (120x30): unfold opens details when they fit whole; no empty-label or j/k Buttons
  const initial = await readMountedPane($, 30)
  expect(initial.rows.length).toBe(30)
  expect(initial.buttons.filter(b => b.props?.key !== FOCUS_ANCHOR_KEY && hostNodeText(b).trim() === '')).toEqual([])
  expect(initial.buttons.find(b => b.props?.hotkey === 'j' || b.props?.hotkey === 'k')).toBeUndefined()
  expect(initial.rows.some(l => l.startsWith('▸ 5 小時'))).toBe(true)
  expect(initial.rows.some(l => l.includes('$8.20 / $50.00'))).toBe(true)
  expect(initial.rows.some(l => l.includes('dev@example.com'))).toBe(true)

  // Press z -> render: expanded content shows
  await pressMountedButton($, 30, b => b.props?.hotkey === 'z', clock)
  const afterZ1 = await readMountedPane($, 30)
  expect(afterZ1.rows.some(l => l.includes('收合明細'))).toBe(true)
  expect(afterZ1.rows.some(l => l.includes('$8.20 / $50.00'))).toBe(true)
  expect(afterZ1.rows.some(l => l.includes('本機今日 $12.40'))).toBe(true)
  expect(afterZ1.rows.some(l => l.includes('24 時合計') && l.includes('尖峰'))).toBe(true)
  expect(afterZ1.rows.some(l => l.includes('dev@example.com'))).toBe(true)

  // Press z again -> render: collapsed (explicit fold suppresses auto-unfold)
  await pressMountedButton($, 30, b => b.props?.hotkey === 'z', clock)
  const afterZ2 = await readMountedPane($, 30)
  expect(afterZ2.rows.some(l => l.includes('展開明細（5 列）'))).toBe(true)
  expect(afterZ2.rows.some(l => l.includes('$8.20 / $50.00'))).toBe(false)
  expect(afterZ2.rows.some(l => l.includes('dev@example.com'))).toBe(false)

  // Press 7 天 meter row Button -> render: focus marker moved one row to 7 天 while staying collapsed
  await pressMountedButton($, 30, b => String(b.props?.key ?? '').startsWith('p:') && hostNodeText(b).includes('7 天'), clock)
  const afterJ = await readMountedPane($, 30)
  expect(afterJ.rows.some(l => l.startsWith('  5 小時'))).toBe(true)
  expect(afterJ.rows.some(l => l.startsWith('▸ 7 天'))).toBe(true)
  expect(afterJ.rows.some(l => l.includes('展開明細（5 列）'))).toBe(true)

  // Press visible [z] Button directly on mounted Pane -> expands while keeping focus on 7 天; press [z] Button again -> collapses
  await pressMountedButton($, 30, b => b.props?.hotkey === 'z', clock)
  const btnOpen = await readMountedPane($, 30)
  expect(btnOpen.rows.some(l => l.startsWith('▸ 7 天'))).toBe(true)
  expect(btnOpen.rows.some(l => l.includes('$8.20 / $50.00'))).toBe(true)
  await pressMountedButton($, 30, b => b.props?.hotkey === 'z', clock)
  const btnShut = await readMountedPane($, 30)
  expect(btnShut.rows.some(l => l.startsWith('▸ 7 天'))).toBe(true)
  expect(btnShut.rows.some(l => l.includes('$8.20 / $50.00'))).toBe(false)

  // Press 5 小時 meter row Button -> render: focus marker moved back to 5 小時
  await pressMountedButton($, 30, b => String(b.props?.key ?? '').startsWith('p:') && hostNodeText(b).includes('5 小時'), clock)
  const afterK = await readMountedPane($, 30)
  expect(afterK.rows.some(l => l.startsWith('▸ 5 小時'))).toBe(true)
  expect(afterK.rows.some(l => l.startsWith('  7 天'))).toBe(true)

  // Press [5] jump Button in body -> switches mounted Pane to quota (額度)
  await pressMountedButton($, 30, b => String(b.props?.key ?? '').endsWith(':quota'), clock)
  const onQuota = await readMountedPane($, 30)
  expect(onQuota.rows[0]).toContain('額度')

  // Direct caller view parameter on renderSpend and spendFocusRows row count
  expect(spendFocusRows(liveOf())).toBe(2)
  seatQuota.reset()
  expect(spendFocusRows(null)).toBe(0)
  await feedFresh()
  const direct = renderSpend(ctxOf(120, 30, calmConsole(), liveOf()), { focus: 1, expanded: false }).body.map(text)
  expect(direct[1].startsWith('  5 小時')).toBe(true)
  expect(direct[2].startsWith('▸ 7 天')).toBe(true)
})

test('spend: missing and stale sources render red reason rows, wrap without ellipsis truncation, and set empty state appropriately', async () => {
  seatQuota.reset()
  // 1. Both console and live null, seatQuota never fetched -> 資料不足，無法判定 + two red无來源 rows
  const emptyCtx = ctxOf(80, 24, null, null)
  const emptyFramed = frameRows(spendPage, emptyCtx)
  expect(emptyFramed.length).toBe(24)
  const emptyTexts = emptyFramed.map(text)
  expect(emptyTexts.some(l => l.includes('無來源：fleet seats --quota 還沒有結果'))).toBe(true)
  expect(emptyTexts.some(l => l.includes('無來源：本席沒有 live 資料'))).toBe(true)
  expect(emptyTexts[21]).toBe('資料不足，無法判定')
  const redSegs = spendPage.render(emptyCtx).body.flat().filter(s => s.text.includes('無來源'))
  expect(redSegs.length).toBe(2)
  for (const s of redSegs) expect(s.color).toBe(PALETTE.broken)

  // 2. Stale live snapshot with a long reason (> 80 cols) keeps cached spend figure with ✗ and wraps the full reason across rows without `…`
  await feedFresh()
  const longReason = '資料過舊 · 上次發佈 11:20 之後有新變化，watcher 已經停止發佈且尚未重新啟動，完整原因必須換行顯示不能截斷'
  const staleLive = liveOf(HOURLY_NARROW, { state: 'stale', header: longReason })
  const wrapped = frameRows(spendPage, ctxOf(80, 24, calmConsole(), staleLive)).map(text)
  expect(wrapped.length).toBe(24)
  for (const l of wrapped) expect(displayWidth(l)).toBeLessThanOrEqual(80)
  expect(wrapped.some(l => l.includes('$3.10 ✗'))).toBe(true)
  expect(wrapped.join('').replace(/\s+/g, '')).toContain(('本席花費資料過期：' + longReason).replace(/\s+/g, ''))
  expect(wrapped.filter(l => !l.startsWith('╰─')).some(l => l.includes('…'))).toBe(false)
  expect(wrapped[21]).toBe('資料不足，無法判定')

  // 3. Pending card on console updates empty state from 沒有要你處理的事 to 待決 1 張卡等你
  const pendingCon = calmConsole({
    counts: { ...calmConsole().counts, decisions: 1 },
    cards: [{ id: 'd-00000001', question: '是否核准預算調整', status: 'open', opened_at_ms: NOW - 5 * MIN, executor_display: 'PM' }],
  })
  const withCard = frameRows(spendPage, ctxOf(80, 24, pendingCon, liveOf(HOURLY_NARROW))).map(text)
  expect(withCard[21]).toBe('待決 1 張卡等你')

  // 4. Null spend object in ok live snapshot renders red 無來源：沒有花費資料, null pct renders — (never 0%), and empty state is 資料不足，無法判定
  await seatQuota.refresh(okRun(JSON.stringify([{ seat: 'codeforge--claude', pool_key: 'team', five_hour_pct: null, seven_day_pct: null, stale: false, self: true }])), NOW + 65_000)
  const noSpendLive = liveOf(null, {
    detail: { ...M.NO_DETAIL, now_ms: NOW + 65_000, spend: null },
    account: { account: undefined, quota: [] },
  })
  const noSpendOut = frameRows(spendPage, { ...ctxOf(120, 30, calmConsole(), noSpendLive), nowMs: NOW + 65_000 }).map(text)
  expect(noSpendOut.length).toBe(30)
  expect(noSpendOut.some(l => l.includes('無來源：沒有花費資料'))).toBe(true)
  expect(noSpendOut.some(l => /\b0%/.test(l))).toBe(false)
  expect(noSpendOut.some(l => l.includes('5 小時') && l.includes('—'))).toBe(true)
  expect(noSpendOut[27]).toBe('資料不足，無法判定')

  // 5. Missing live snapshot with ok console renders red 無來源：本席沒有 live 資料 and 資料不足，無法判定 (never 沒有要你處理的事)
  await feedFresh()
  const noLiveWithCon = frameRows(spendPage, ctxOf(80, 24, calmConsole(), null)).map(text)
  expect(noLiveWithCon.some(l => l.includes('無來源：本席沒有 live 資料'))).toBe(true)
  expect(noLiveWithCon[21]).toBe('資料不足，無法判定')

  // 6. Unfetched seatQuota feed WITH account quota windows still emits red missing-source warning, wraps without `…`, and sets unknown empty state
  seatQuota.reset()
  for (const [loc, wantMissing, wantUnknown] of [
    ['zh-TW', '無來源：fleet seats --quota 還沒有結果', '資料不足，無法判定'],
    ['en', 'no source: fleet seats --quota has no result yet', 'Not enough data to judge'],
  ] as const) {
    const tr = makeT(loc)
    const raw80 = frameRows(spendPage, { ...ctxOf(80, 24, calmConsole(), liveOf(HOURLY_NARROW)), t: tr })
    expect(raw80.length).toBe(24)
    expect(raw80.map(text).some(l => l.includes('17%'))).toBe(true)
    expect(raw80.map(text).some(l => l.includes('68%'))).toBe(true)
    const missingRow80 = raw80.find(r => text(r).includes(wantMissing))!
    expect(missingRow80).toBeDefined()
    expect(missingRow80[0].color).toBe(PALETTE.broken)
    expect(text(raw80[21])).toBe(wantUnknown)

    // At 40 cols (< 41/51 cells), the red missing-source reason wraps across multiple red rows without `…`
    const raw40 = frameRows(spendPage, { ...ctxOf(40, 24, calmConsole(), liveOf(HOURLY_NARROW)), t: tr })
    expect(raw40.length).toBe(24)
    for (const r of raw40) expect(displayWidth(text(r))).toBeLessThanOrEqual(40)
    expect(raw40.some(r => !text(r).startsWith('╰─') && text(r).includes('…'))).toBe(false)
    const redRows40 = raw40.filter(r => r.length > 0 && r.every(s => s.color === PALETTE.broken))
    expect(redRows40.length).toBeGreaterThanOrEqual(2)
    expect(redRows40.map(text).join('').replace(/\s+/g, '')).toContain(wantMissing.replace(/\s+/g, ''))
    expect(text(raw40[20])).toBe(wantUnknown)
  }

  // 7. Stale cached seatQuota row AFTER refresh failure renders BOTH red age warning AND red refresh-failure reason, wrapping without `…`
  await feedStale25m()
  for (const [loc, wantAge, wantFail, wantUnknown] of [
    ['zh-TW', '25 分未更新，以上是舊數字', 'fleet seats --quota 指令失敗，用 25 分前的舊結果', '資料不足，無法判定'],
    ['en', '25 min since update, figures above are old', 'fleet seats --quota failed, using cached result from 25m ago', 'Not enough data to judge'],
  ] as const) {
    const tr = makeT(loc)
    const raw160 = frameRows(spendPage, { ...ctxOf(160, 40, calmConsole(), liveOf(HOURLY_WIDE)), t: tr })
    const ageRow = raw160.find(r => text(r).includes(wantAge))!
    const failRow = raw160.find(r => text(r).includes(wantFail))!
    expect(ageRow).toBeDefined()
    expect(failRow).toBeDefined()
    expect(ageRow[0].color).toBe(PALETTE.broken)
    expect(failRow[0].color).toBe(PALETTE.broken)
    expect(text(raw160[37])).toBe(wantUnknown)

    // At 40 cols, the refresh-failure reason (> 40 cells) wraps across red rows without `…`
    const raw40 = frameRows(spendPage, { ...ctxOf(40, 24, calmConsole(), liveOf(HOURLY_NARROW)), t: tr })
    expect(raw40.length).toBe(24)
    for (const r of raw40) expect(displayWidth(text(r))).toBeLessThanOrEqual(40)
    expect(raw40.some(r => !text(r).startsWith('╰─') && text(r).includes('…'))).toBe(false)
    const redJoined = raw40.filter(r => r.length > 0 && r.every(s => s.color === PALETTE.broken)).map(text).join('').replace(/\s+/g, '')
    expect(redJoined).toContain(wantAge.replace(/\s+/g, ''))
    expect(redJoined).toContain(wantFail.replace(/\s+/g, ''))
    expect(text(raw40[20])).toBe(wantUnknown)
  }

  // Flagged stale row (row.stale === true, < 10 min) followed by refresh failure also emits both red rows
  seatQuota.reset()
  await seatQuota.refresh(okRun(JSON.stringify([{ seat: 'codeforge--claude', pool_key: 'team', five_hour_pct: 17.4, seven_day_pct: 68.2, stale: true, self: true }])), NOW - 40_000)
  await seatQuota.refresh(failRun, NOW + 25_000)
  const flaggedStale = spendPage.render({ ...ctxOf(120, 30, calmConsole(), liveOf(HOURLY_WIDE)), nowMs: NOW + 25_000 })
  const flaggedBroken = flaggedStale.body.filter(r => r.length > 0 && r[0].color === PALETTE.broken).map(text)
  expect(flaggedBroken.some(l => l.includes('1 分未更新，以上是舊數字'))).toBe(true)
  expect(flaggedBroken.some(l => l.includes('fleet seats --quota 指令失敗，用 1 分前的舊結果'))).toBe(true)
})

test('spend: every state is exactly H rows at 160x40, 120x30, 80x24 and short 80x7, in zh-TW and en; actions never exceed A', async () => {
  await feedFresh()
  const states: [string, ConsoleSnapshot | null, M.LiveSnapshot | null][] = [
    ['calm', calmConsole(), liveOf()],
    ['no console', null, liveOf()],
    ['no live', calmConsole(), null],
    ['neither', null, null],
    ['no hourly', calmConsole(), liveOf(null)],
  ]
  for (const loc of ['zh-TW', 'en'] as const) {
    const tr = makeT(loc)
    for (const [cols, rows] of [[160, 40], [120, 30], [80, 24], [80, 7]] as const) {
      for (const [name, c, l] of states) {
        const ctx: PageCtx = { live: l, console: c, size: { cols, rows }, t: tr, nowMs: NOW }
        const rendered = spendPage.render(ctx)
        expect(rendered.actions.length, `${loc} ${name} ${cols}x${rows} actions`).toBeLessThanOrEqual(actionRows(rows))
        const framed = frameRows(spendPage, ctx)
        expect(framed.length, `${loc} ${name} ${cols}x${rows} rows`).toBe(rows)
        for (const r of framed as Row[]) expect(displayWidth(text(r)), `${loc} ${name} ${cols}x${rows} width`).toBeLessThanOrEqual(cols)
      }
    }
  }
  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))
})
