// mods/live/pages/spend.test.ts — page 7 花費 (plan r2 §2 row 7, §3.1, §5): golden rows at 160x40, 120x30, 80x24 and 80x24 stale,
// fixed height H across every size and state, fold pair (collapsed / expanded) + overflow row, red stale/no-source wrapping, [5] & [z] Buttons, and empty states.
import type { EngineInterface, On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY, Pane } from '../pane'
import { makeT } from '../i18n'
import * as M from '../model'
import { displayWidth } from '../model'
import { pageNeedsSteps, paneKey } from '../register'
import type { Step } from '../speed'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import type { ConsoleSnapshot } from '../console'
import { actionRows, brokenRow as frameBroken, frameRows, staleBadge as frameBadge } from './frame'
import type { PageCtx, Row } from './frame'
import { PAGES } from './index'
import { seatQuota } from './now'
import { brokenRow, staleBadge } from './rows'
import { poolEtaRows, renderSpend, spendFocusRows, spendPage } from './spend'

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

test('r10b #6: an unknown 5h value draws no empty bar, it says 未接通 (negative: a known value keeps its bar)', () => {
  seatQuota.reset()
  const live = liveOf(HOURLY_WIDE, { account: { account: undefined, quota: [{ kind: 'five_hour', pct: null, resetsAtMs: null }, { kind: 'seven_day', pct: 68.2, resetsAtMs: RESET_7D }] } })
  const rows = renderSpend(ctxOf(120, 40, calmConsole(), live)).body.map(text)
  const five = rows.find(r => r.includes('5 小時') || r.includes('5時'))!
  expect(five).toContain('— 未接通')
  expect(five).not.toContain(GLYPHS.chart.meterOff)
  const seven = rows.find(r => r.includes('7 天') || r.includes('7天'))!
  expect(seven).toContain(GLYPHS.chart.meterOn)
})

const stepOf = (over: Partial<Step> = {}): Step => ({
  at: NOW - 30_000,
  model: 'claude-opus-4',
  isSubagent: false,
  ttftMs: 200,
  decodeMs: 1000,
  outTokens: 1250,
  tps: 1250,
  ...over,
})

test('G03: register passes steps to spend page, and spend renders exact 1k+ tok/s, source turn.step, age, and sparkline', async () => {
  expect(pageNeedsSteps('spend')).toBe(true)
  expect(pageNeedsSteps('forge')).toBe(true)
  expect(pageNeedsSteps('now')).toBe(false)

  await feedFresh()
  const steps: Step[] = [
    stepOf({ at: NOW - 60_000, outTokens: 420, tps: 420 }),
    stepOf({ at: NOW - 30_000, outTokens: 1250, tps: 1250 }),
  ]
  const rendered = renderSpend({ ...ctxOf(120, 40), steps })
  const all = rendered.body.map(text).join('\n')
  expect(all).toContain('本席速度（來源 turn.step）')
  expect(all).toContain('1250 tok/s')
  expect(all).not.toContain('1k+')
  expect(all).toContain('30 秒前')
  expect(all).toContain('2 次請求')
  expect(all).toContain('最佳 1250')
  expect(rendered.body.some(r => r.some(s => s.color === PALETTE.running && /[▁▂▃▄▅▆▇█]/.test(s.text)))).toBe(true)

  // Pane wiring forwards frame.steps into spendPage
  const mk = (kind: string) => (props: any) => ({ kind, props })
  const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link') }
  const textOf = (n: any): string => n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.props?.children)
  const paneText = textOf(Pane(el, liveOf(), 'spend', () => {}, t, 120, undefined, undefined, undefined, undefined, null, null, null, null, null, {
    pages: PAGES, pageId: 'spend', console: calmConsole(), nowMs: NOW, rows: 30, steps,
  } as any))
  expect(paneText).toContain('1250 tok/s')
  expect(paneText).toContain('turn.step')
})

test('G03: stale tok/s (>5 min) shows exact value, last request age, and red >5 min stale warning', async () => {
  await feedFresh()
  const steps: Step[] = [stepOf({ at: NOW - 6 * MIN, tps: 1250 })]
  const rendered = renderSpend({ ...ctxOf(120, 40), steps })
  const all = rendered.body.map(text).join('\n')
  expect(all).toContain('1250 tok/s')
  expect(all).toContain('6 分前')
  expect(all).toContain('>5 分')
  expect(rendered.body.some(r => r.some(s => s.color === PALETTE.broken) && text(r).includes('>5 分'))).toBe(true)
})

test('G03: missing tok/s explains no requests, <150ms decode window, no streamed output, and 0 output tokens', async () => {
  await feedFresh()
  const noReq = renderSpend({ ...ctxOf(120, 40), steps: [] }).body.map(text).join('\n')
  expect(noReq).toContain('尚未有模型請求')
  expect(noReq).toContain('turn.step')

  const shortWin = renderSpend({ ...ctxOf(120, 40), steps: [stepOf({ at: NOW - 10_000, decodeMs: 80, outTokens: 12, tps: null })] }).body.map(text).join('\n')
  expect(shortWin).toContain('80ms < 150ms')
  expect(shortWin).toContain('10 秒前')

  const noStream = renderSpend({ ...ctxOf(120, 40), steps: [stepOf({ at: NOW - 15_000, decodeMs: null, outTokens: 0, tps: null })] }).body.map(text).join('\n')
  expect(noStream).toContain('未收到串流輸出')
  expect(noStream).toContain('15 秒前')

  const zeroTok = renderSpend({ ...ctxOf(120, 40), steps: [stepOf({ at: NOW - 20_000, decodeMs: 500, outTokens: 0, tps: null })] }).body.map(text).join('\n')
  expect(zeroTok).toContain('輸出 0 token')
  expect(zeroTok).toContain('20 秒前')
})

test('G14: 24h trend missing reason, today tok unknown reason, and live published_at >5 min stale warning', async () => {
  await feedFresh()
  const noHourly = renderSpend(ctxOf(120, 40, calmConsole(), liveOf(null))).body.map(text).join('\n')
  expect(noHourly).toContain('spend-history.json')
  expect(noHourly).toContain('不足 2 筆取樣')
  expect(noHourly).toContain('token 數未知')
  expect(noHourly).toContain('watcher 尚未發佈 token 總計')

  const noLive = renderSpend(ctxOf(120, 40, calmConsole(), null)).body.map(text).join('\n')
  expect(noLive).toContain('spend-history.json')
  expect(noLive).toContain('沒有 live 資料')

  const staleLive = renderSpend(ctxOf(120, 40, calmConsole(), liveOf(HOURLY_WIDE, { published_at: new Date(NOW - 8 * MIN).toISOString() }))).body
  expect(staleLive.some(r => r.some(s => s.color === PALETTE.broken) && text(r).includes('8 分') && text(r).includes('>5 分'))).toBe(true)
})

test('G14: seatQuota failed <10m shows yellow warning, >10m shows red stale threshold and failure, pool stale shows >10m, and en locale works', async () => {
  // Failed with cached result < 10 min -> yellow (PALETTE.attention) warning
  seatQuota.reset()
  await seatQuota.refresh(okRun(SEAT_JSON), NOW - 3 * MIN)
  await seatQuota.refresh(failRun, NOW - 10_000)
  const cachedFail = renderSpend(ctxOf(120, 40)).body
  const warnRow = cachedFail.find(r => text(r).includes('fleet seats --quota 指令失敗'))
  expect(warnRow).toBeDefined()
  expect(text(warnRow!)).toContain('3 分前')
  expect(text(warnRow!)).toContain('>10 分')
  expect(warnRow!.some(s => s.color === PALETTE.attention)).toBe(true)

  // Failed and stale > 10 min -> red stale row with >10 min threshold + red failure row
  await feedStale25m()
  const staleCon = calmConsole({
    quota: {
      pools: [{
        ...calmConsole().quota.pools![0],
        stale: true,
        stale_age_min: 18,
      }],
      seats: [],
    },
  })
  const staleBody = renderSpend(ctxOf(120, 40, staleCon)).body
  const staleAll = staleBody.map(text).join('\n')
  expect(staleAll).toContain('25 分未更新，以上是舊數字（門檻 >10 分）')
  expect(staleAll).toContain('fleet seats --quota 指令失敗，沿用 25 分前舊結果')
  expect(staleAll).toContain('18 分未更新 (>10 分)')

  // poolEta stale includes numeric stale_after_s
  const etaStale = poolEtaRows({ generated_at_ms: NOW - 10 * MIN, stale_after_s: 300, pools: [], alerts: [] }, NOW, t).map(text).join('\n')
  expect(etaStale).toContain('300 秒')

  // English locale smoke check with speed + missing 24h + cached failure
  const en = makeT('en')
  const enCtx: PageCtx = {
    live: liveOf(null),
    console: staleCon,
    size: { cols: 120, rows: 30 },
    t: en,
    nowMs: NOW,
    steps: [stepOf({ at: NOW - 6 * MIN, tps: 1250 })],
  }
  const enAll = renderSpend(enCtx).body.map(text).join('\n')
  expect(enAll).toContain('1250 tok/s')
  expect(enAll).toContain('>5 min')
  expect(enAll).toContain('>10 min')
  expect(enAll).toContain('spend-history.json')
  expect(frameRows(spendPage, enCtx).length).toBe(30)
})
