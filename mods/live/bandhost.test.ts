// v7.4 band host: the page is a full-width framed tree inside the AbovePrompt band (closed = one band row, open = frame + tab row + band row), at every width.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { displayWidth } from '../tux/width.ts'
import full from './fixtures/console/console-full.fixture'

const HOME = '/fake/ux-home'
const LIVE = '/fake/ux-live'
const REPO = '/work/ux-repo'
const SID = 'v74-bandhost'
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

const mountBand = ($: any, columns: number, maxRows: number) => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: columns, maxRows, view: { agentId: undefined } }, viewport: { columns, rows: 60, isFullscreen: true } })
const lines = (n: any): string[] => (n?.children ?? []).map((c: any) => text(c))
const rowsOf = (tree: Node): Node[] => {
  const out: Node[] = []
  const visit = (n: any) => { if (n?.type === 'Box' && n.props?.height === 1 && n.props?.width !== undefined) out.push(n); else for (const c of n?.children ?? []) visit(c) }
  visit(tree)
  return out
}
const DESIGN_TABS = '  1 現況  2 待決  3 派工  4 審查  5 花費  6 殘留  7 艦隊  8 待辦  9 說明'

for (const cols of [209, 120, 80]) {
  test(`v74 host: closed at ${cols} columns is one band row, no O4 shell rows`, async ($, on) => {
    const h = host(on)
    await $.session.start({ surface: 'terminal', cwd: REPO })
    await h.clock.advance(5000)
    const band = await mountBand($, cols, 46)
    const tree = await band.drawn() as Node
    const all = text(tree)
    expect(tree.children?.length, 'exactly one row').toBe(1)
    expect(all).not.toContain('圓桌')
    expect(all).not.toContain('d: 待決')
    expect(all).not.toContain('送出')
    expect(all).not.toContain('1: 現況')
    expect(all.endsWith('▴')).toBe(true)
    expect(displayWidth(all)).toBeLessThanOrEqual(cols)
    expect(h.isOpen(), 'the host Pane is never opened').toBe(false)
    await band.unmount()
    await $.session.end({ reason: 'exit' })
  })
}

test('v74 host: /live-pane opens the full-width page at 209 columns: title in the top border, hint in the bottom border, tab row, then the band row', async ($, on) => {
  const h = host(on)
  await $.session.start({ surface: 'terminal', cwd: REPO })
  await h.clock.advance(5000)
  await $.command.run({ command: 'live-pane', args: '' })
  expect(h.isOpen(), 'no host Pane is opened in v7.4').toBe(false)
  const band = await mountBand($, 209, 46)
  const tree = await band.drawn() as Node
  expect(tree.children?.length, 'page tree + band row').toBe(2)
  const page = tree.children![0] as Node
  const rows = lines(page)
  expect(rows.length, 'top + 41 body rows + bottom + tab row').toBe(46 - 1)
  expect(rows[0].startsWith('╭─ 現況')).toBe(true)
  expect(rows[0].endsWith('╮')).toBe(true)
  expect(rows[rows.length - 2].startsWith('╰─  捲動 · Enter 摺疊 · ctrl+x tab 拿鍵盤 · Esc 還給輸入框  ─')).toBe(true)
  expect(rows[rows.length - 2].endsWith('╯')).toBe(true)
  expect(rows[rows.length - 1]).toBe(DESIGN_TABS)
  for (const r of [rows[0], rows[rows.length - 2]]) expect(displayWidth(r), r).toBe(209) // the borders; a body row's right `│` is pushed to the edge by the engine (flexGrow)
  for (const r of rows.slice(1, -2)) { expect(r.startsWith('│ ')).toBe(true); expect(r.endsWith(' │')).toBe(true) }
  const bandRow = text(tree.children![1])
  expect(bandRow.endsWith('▾')).toBe(true)
  expect(bandRow).not.toContain('圓桌')
  expect(displayWidth(bandRow)).toBeLessThanOrEqual(209)
  await band.unmount()
  await $.session.end({ reason: 'exit' })
})

for (const cols of [120, 80]) {
  test(`v74 host: the open page is ${cols} columns wide, every row, and the tab row keeps the design form`, async ($, on) => {
    const h = host(on)
    await $.session.start({ surface: 'terminal', cwd: REPO })
    await h.clock.advance(5000)
    await $.command.run({ command: 'live-pane', args: '' })
    const band = await mountBand($, cols, 24)
    const tree = await band.drawn() as Node
    const rows = lines(tree.children![0])
    expect(rows.length).toBe(24 - 2 + 1)
    for (const r of [rows[0], rows[rows.length - 2]]) expect(displayWidth(r), r).toBe(cols)
    for (const r of rows.slice(1, -2)) expect(r.startsWith('│ ') && r.endsWith(' │')).toBe(true)
    expect(rows[rows.length - 1]).toBe(DESIGN_TABS)
    expect(text(tree)).not.toContain('圓桌')
    await band.unmount()
    await $.session.end({ reason: 'exit' })
  })
}

test('v74 host: a tab press switches the page, the band toggle closes it, no host Pane is touched', async ($, on) => {
  const h = host(on)
  await $.session.start({ surface: 'terminal', cwd: REPO })
  await h.clock.advance(5000)
  await $.command.run({ command: 'live-pane', args: '' })
  let band = await mountBand($, 209, 46)
  const tab = (await band.findAll({ type: 'Button' }) as Node[]).find(b => b.props?.key === 'tab:decide')
  expect(tab, 'the 待決 tab is a Button').toBeDefined()
  expect(tab!.props?.hotkey, 'no hotkey: the host would draw `2: 待決`').toBeUndefined()
  await band.press({ key: 'tab:decide' })
  await h.clock.advance(0)
  await band.unmount()
  band = await mountBand($, 209, 46)
  expect(lines((await band.drawn() as Node).children![0])[0].startsWith('╭─ 待決')).toBe(true)
  await band.press({ key: 'pane-toggle' })
  await h.clock.advance(0)
  await band.unmount()
  band = await mountBand($, 209, 46)
  expect((await band.drawn() as Node).children?.length, 'closed again: one row').toBe(1)
  expect(h.isOpen()).toBe(false)
  await band.unmount()
  await $.session.end({ reason: 'exit' })
})
