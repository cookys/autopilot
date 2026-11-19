// UX gate round 2: mounted band/page navigation, with the real register.ts hooks.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PAGES } from './pages/index'
import { displayWidth, PALETTE, drawSeg } from './ui'
import { makeT } from './i18n'
import full from './fixtures/console/console-full.fixture'

const HOME = '/fake/ux-home'
const LIVE = '/fake/ux-live'
const REPO = '/work/ux-repo'
const SID = 'ux-gate2'
const KEY = '0000000000000002'
const PUBLISHED = '2026-10-04T10:00:00.000Z'
const NOW = Date.parse(PUBLISHED) + 30_000
const PANE = 'autopilot-live'
type Node = { type?: string; props?: Record<string, any>; children?: any[] }
const text = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.label ?? text(n?.children ?? [])
const walk = (n: any): Node[] => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.children)]
const buttons = (n: any): Node[] => walk(n).filter(n => n.type === 'Button')

function host(on: On, now = NOW, expiredConsole = false, consoleMode = expiredConsole, consoleFixture?: unknown) {
  const files: Record<string, string> = {
    [HOME + '/.autopilot/live-pointer.json']: JSON.stringify({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: HOME + '/.autopilot' }),
    [HOME + '/.autopilot/session-mode/' + SID + '.json']: JSON.stringify({ session_id: SID, project_key: KEY, expires_at: '2026-10-05T10:00:00.000Z' }),
    [LIVE + '/runs/' + KEY + '.json']: JSON.stringify({ schema: 'autopilot.runs-live/1', scope: { project_key: KEY, root_run_id: null }, published_at: PUBLISHED, valid_for_s: 180, runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0 } }),
    [REPO + '/.git/HEAD']: 'ref: refs/heads/main\n',
  }
  if (consoleMode) files[REPO + '/.claude/console.json'] = JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' })
  let open = false
  const scrolls: any[] = []
  const clock = mock.clock(on, { now })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : undefined }))
  on('fs.read', (_, e) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] } })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => {
    if (!(e.path in files) && e.path !== REPO) throw new Error('ENOENT')
    return { value: { kind: e.path === REPO ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.root', () => ({ value: REPO }))
  on('session.start', () => ({ cwd: REPO }))
  on('session.end', () => ({ sessionId: SID }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => { open = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { open = false; return { value: undefined } })
  on('ui.panes', () => ({ value: open ? [{ id: PANE, title: 'Autopilot', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('ui.scroll', (_, e) => { scrolls.push(e); return { value: undefined } })
  on('process.run', (_, e) => ({ value: { exitCode: expiredConsole && e.argv.includes('console') ? 0 : 1, stdout: expiredConsole && e.argv.includes('console') ? JSON.stringify(consoleFixture ?? { ...full, generated_at_ms: now, sources: { tasks: { at_ms: now - 12 * 60_000, state: 'expired' }, quota: { at_ms: now, state: 'ok' } } }) : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return { clock, scrolls, isOpen: () => open, close: () => { open = false } }
}

for (const cols of [120, 160]) for (const mode of [false, true]) test(`X4: ${cols} columns expired console source stays visible beside a fresh live snapshot, console mode ${mode}`, async ($, on) => {
  const h = host(on, NOW, true, mode)
  await $.session.start({ surface: 'terminal', cwd: REPO })
  await h.clock.advance(5000)
  await h.clock.advance(5000) // The first tick fetches; the next consumes its result.
  const band = await mountBand($, cols, 30)
  const tree = await band.drawn() as Node
  const summary = text(tree)
  expect(summary).toContain('視窗高度不足')
  expect(summary).toContain('目前 2')
  expect(summary).not.toContain('1 現況')
  expect(displayWidth(text(tree.children?.[0]))).toBeLessThanOrEqual(cols - 4)
  expect(tree.children?.filter(n => n?.type === 'Box').length).toBe(1)
  await band.unmount()
  await $.session.end({ reason: 'exit' })
})

for (const [cols, rows] of [[120, 30], [160, 40]]) for (const open of [false, true]) {
  test(`X4: ${cols}x${rows} stale 12 minutes, pane ${open ? 'open' : 'closed'}, keeps the full reason and repair in two band rows`, async ($, on) => {
    host(on, Date.parse(PUBLISHED) + 12 * 60_000)
    await $.session.start({ surface: 'terminal', cwd: REPO })
    if (open) await $.command.run({ command: 'live-pane', args: '' })
    const band = await mountBand($, cols, rows)
    const tree = await band.drawn() as Node
    const summary = text(tree)
    expect(summary).toContain('視窗高度不足')
    expect(summary).toContain('目前 2')
    expect(summary).not.toContain('1 現況')
    expect(summary).not.toContain('watcher 沒有在發佈')
    expect(displayWidth(text(tree.children?.[0]))).toBeLessThanOrEqual(cols - 4)
    expect(tree.children?.filter(n => n?.type === 'Box').length).toBe(1)
    await band.unmount()
    await $.session.end({ reason: 'exit' })
  })
}
const mountBand = ($: any, columns: number, rows: number) => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: columns, maxRows: 2, view: { agentId: undefined } }, viewport: { columns, rows, isFullscreen: true } })
const mountPane = ($: any, columns: number, rows: number, offset = 0) => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Autopilot', isFocused: true, bodyColumns: columns, placement: 'inline', scroll: { offset, bodyRows: rows }, view: { agentId: undefined } }, viewport: { columns, rows, isFullscreen: true } })

for (const [cols, rows] of [[120, 30], [160, 40]]) {
  test(`X1: ${cols}x${rows} open pane leaves only its shared navigation on screen`, async ($, on) => {
    host(on)
    await $.session.start({ surface: 'terminal', cwd: REPO })
    await $.command.run({ command: 'live-pane', args: '' })
    const pane = await mountPane($, cols, rows)
    const band = await mountBand($, cols, rows)
    const nav = buttons(await pane.drawn()).filter(n => /^[0-9]$/.test(n.props?.hotkey ?? ''))
    expect(nav.map(n => n.props?.hotkey)).toEqual(PAGES.filter(p => p.id !== 'help').map(p => p.key))
    expect(buttons(await band.drawn()).filter(n => /^(tab:|forge$)/.test(n.props?.key ?? '')).map(n => n.props?.key)).toEqual([])
    await band.unmount()
    await pane.unmount()
    await $.session.end({ reason: 'exit' })
  })
  test(`X1: ${cols}x${rows} closed band lists shared page numbers 1-9 and 0`, async ($, on) => {
    host(on)
    await $.session.start({ surface: 'terminal', cwd: REPO })
    const band = await mountBand($, cols, rows)
    const drawn = await band.drawn()
    const nav = buttons(drawn).filter(n => /^(tab:|forge$)/.test(n.props?.key ?? ''))
    expect(nav).toEqual([])
    expect(text(drawn)).toContain('視窗高度不足')
    await band.unmount()
    await $.session.end({ reason: 'exit' })
  })
}

test('K1: at 80x24 pressing 0 after an old scroll offset shows the forge header on the first row', async ($, on) => {
  host(on)
  await $.session.start({ surface: 'terminal', cwd: REPO })
  await $.command.run({ command: 'live-pane', args: '' })
  const before = await mountPane($, 80, 24, 18)
  await before.press({ key: 'forge' })
  await before.unmount()
  const after = await mountPane($, 80, 24)
  const rows = walk(await after.drawn()).filter(n => /^f\d+$/.test(n.props?.key ?? ''))
  expect(text(rows[0])).toBe(makeT('zh-TW')('tab.forge'))
  expect(rows.length).toBe(24)
  expect(text(await after.drawn())).not.toContain('上面還有 18 行')
  await after.unmount()
  await $.session.end({ reason: 'exit' })
})

test('K1: every page has exactly one shared strip with the same digit mapping and labels at 80x24', async ($, on) => {
  host(on)
  await $.session.start({ surface: 'terminal', cwd: REPO })
  await $.command.run({ command: 'live-pane', args: '' })
  let current = await mountPane($, 80, 24)
  const labels = buttons(await current.drawn()).filter(n => /^[0-9]$/.test(n.props?.hotkey ?? '')).map(n => [n.props?.hotkey, text(n)])
  for (const p of PAGES) {
    const target = buttons(await current.drawn()).find(n => n.props?.hotkey === p.key)
    expect(target, p.id + ' can be reached from the shared strip').toBeDefined()
    await current.press({ key: target!.props!.key })
    await current.unmount()
    current = await mountPane($, 80, 24)
    const tree = await current.drawn()
    const nav = buttons(tree).filter(n => /^[0-9]$/.test(n.props?.hotkey ?? ''))
    expect(nav.map(n => [n.props?.hotkey, text(n)]), p.id + ' navigation').toEqual(labels)
    const navRows = walk(tree).filter(n => /^f\d+$/.test(n.props?.key ?? '') && buttons(n).some(b => b.props?.hotkey === '1'))
    expect(navRows.length, p.id + ' has one navigation row').toBe(1)
  }
  await current.unmount()
  await $.session.end({ reason: 'exit' })
})

for (const cols of [80, 120, 160]) test(`Z3: page 0 is labelled 鍛 in both shared strips at ${cols} columns`, async ($, on) => {
  host(on)
  await $.session.start({ surface: 'terminal', cwd: REPO })
  const band = await mountBand($, cols, 30)
  const drawn = await band.drawn()
  const forgeBand = buttons(drawn).find(n => n.props?.key === 'forge')
  expect(forgeBand).toBeUndefined()
  expect(text(drawn)).toContain('視窗高度不足')
  await band.unmount()
  const pane = await mountPane($, cols, 24)
  const forgePane = buttons(await pane.drawn()).find(n => n.props?.hotkey === '0')
  expect(text(forgePane).trim()).toBe('鍛')
  await pane.unmount()
  await $.session.end({ reason: 'exit' })
})

test('X1: a closed band under 12 rows is one height hint and opens no page', async ($, on) => {
  const h = host(on)
  await $.session.start({ surface: 'terminal', cwd: REPO })
  const band = await mountBand($, 120, 30)
  const tree = await band.drawn() as Node
  expect(text(tree)).toContain('視窗高度不足')
  expect(buttons(tree).filter(n => /^(tab:|forge$)/.test(n.props?.key ?? ''))).toEqual([])
  expect(h.isOpen()).toBe(false)
  await band.unmount()
  await $.session.end({ reason: 'exit' })
})

test('Y6: the drawing helper admits semantic theme roles and rejects legacy raw colour escapes', () => {
  for (const color of Object.values(PALETTE)) expect(drawSeg({ text: '合成文字', color }).color).toBe(color)
  for (const color of ['\u001b[38;5;153m', '\u001b[38;5;220m', '38;5;153', '38;5;220', '#afd7ff', '#ffd700']) {
    expect(drawSeg({ text: '合成文字', color: color as never }).color).toBeUndefined()
  }
})

// W3: exercise the production register.ts detail handler, not only a callback spy.
test('W3: mounted remote detail buttons page through the full text and return to the answer summary', async ($, on) => {
  const long = '合成背景：' + '需要確認排程與回歸邊界。'.repeat(36) + '背景全文末尾'
  const h = host(on, NOW, true, true, { ...full, generated_at_ms: NOW,
      sources: { cards: { at_ms: NOW, state: 'ok' } },
      cards: [{ id: 'd-0a1b2c3d', question: '合成長卡', status: 'open', executor_display: 'h1', opened_at_ms: NOW - 60000,
        background: long, blocks: '等確認才能繼續', options: [{ label: '先跑回歸', description: '', recommended: true }, { label: '暫緩', description: '' }], recommendation: '先跑回歸' }], items: [],
    })
  await $.session.start({ surface: 'terminal', cwd: REPO })
  await h.clock.advance(5000)
  await h.clock.advance(5000)
  let pane = await mountPane($, 80, 10)
  await pane.press({ key: 'decide' })
  await pane.unmount()
  pane = await mountPane($, 80, 10)
  const drawn = text(await pane.drawn())
  expect(drawn).toContain('待決在 band 上（d）')
  expect(drawn).not.toContain('展開答題區')
  expect(drawn).not.toContain('[a] 先跑回歸')
  expect(buttons(await pane.drawn()).some(n => n.props?.hotkey === 'a' || n.props?.hotkey === 'b')).toBe(false)
  await pane.unmount()
  await $.session.end({ reason: 'exit' })
})
