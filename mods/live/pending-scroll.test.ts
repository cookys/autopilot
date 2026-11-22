import { test, expect, mock } from 'claude-code/testing'
import { routeKey } from './pages/keys'
import { decidePage, decideReduce, NO_NAV } from './pages/decide'
import { frameRows } from './pages/frame'
import { newScroll, applyScroll } from './scrollmath'
import { displayWidth } from './ui'
import { GLYPHS } from '../tux/glyphs'
import { makeT } from './i18n'
import fixture from './fixtures/v74/decide.fixture'
import { Pane } from './pane'
import { PAGES } from './pages/index'
import { v75ScrollRoute } from './v75'

const cards = Array.from({ length: 21 }, (_, i) => ({ ...fixture[0], id: 'scroll-' + i, title: 'Card ' + (i + 1) }))
const ctx = (extra = {}) => ({ live: null, console: null, t: makeT('zh-TW'), nowMs: 0, size: { cols: 120, rows: 22 }, v74: { pm: null, pmFetchedMs: null, decide: cards, todo: [], nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } }, ...extra })
const keyState = { page: 'decide', paneFocus: true, focusedButton: false, textMode: false }

test('pending scroll: p/n change cards, j/k retain their meaning, arrows and page keys never change cards', () => {
  let nav = { ...NO_NAV }
  for (const [key, cursor] of [['n', 1], ['n', 2], ['p', 1], ['j', 2], ['k', 1]] as const) {
    nav = decideReduce(nav, routeKey(key, keyState), ctx(), 0).nav
    expect(nav.cursor, key).toBe(cursor)
  }
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']) {
    const action = routeKey(key, keyState)
    expect(action.kind, key).toBe('scroll')
    expect(decideReduce(nav, action, ctx(), 0).nav.cursor, key).toBe(1)
  }
  expect(routeKey('m', keyState).kind).toBe('note')
  expect(routeKey('p', { ...keyState, page: 'now' })).toEqual({ kind: 'page', to: 'pet' })
  expect(routeKey('n', { ...keyState, textMode: true })).toEqual({ kind: 'text', ch: 'n' })
})

const text = row => row.map(s => s.text).join('')
const windows = () => ({ list: newScroll(), detail: newScroll(), cursor: '' })
test('pending scroll: host arrows/pages scroll detail, pointer wheels scroll the queue, note mode owns its keys', () => {
  const open = { paneOpen: true, note: false }
  for (const by of [1, -1, 22, -22]) expect(v75ScrollRoute({ component: 'Pane', by }, open)).toBe('pane')
  for (const by of [1, -1, 3, -3]) expect(v75ScrollRoute({ component: 'Pane', by, pointer: { x: 4, y: 3 } }, open)).toBe('queue')
  expect(v75ScrollRoute({ component: 'Pane', by: 1 }, { ...open, note: true })).toBe('swallow')
})

const el = Object.fromEntries(['Box', 'Text', 'Link', 'Button', 'Input'].map(type => [type, props => ({ type, props })]))
function nodes(node): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== 'object') return []
  if (typeof node.type === 'function') return nodes(node.type(node.props))
  return [node, ...nodes(node.props?.children)]
}
test('pending scroll: the real Pane draws the queue and binds p/n, m and unchanged j/k in both locales', () => {
  for (const locale of ['zh-TW', 'en']) {
    const c = ctx({ t: makeT(locale) })
    const pendingScroll = windows()
    const pressed: any[] = []
    const tree = Pane(el, null, 'decide', () => {}, c.t, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: PAGES, pageId: 'decide', console: null, nowMs: 0, rows: 22, v74: c.v74, decide: { ...NO_NAV }, pendingScroll, onKey: k => pressed.push(k) })
    const all = nodes(tree)
    const labels = all.filter(n => n.type === 'Text').flatMap(n => [n.props.children].flat(Infinity)).join('')
    expect(labels).toContain(c.t('page.decide.range', { a: 1, b: 8, n: 21 }))
    const rows = all.filter(n => n.type === 'Box' && /^f\d+$/.test(n.props.key ?? ''))
    expect(rows.length).toBe(22)
    expect(rows.every(n => n.props.width === 120 && n.props.height === 1), '120x22 row geometry').toBe(true)
    const buttons = all.filter(n => n.type === 'Button')
    for (const key of ['p', 'n', 'j', 'k', 'm']) {
      const button = buttons.find(b => b.props.hotkey === key)
      expect(button !== undefined, key).toBe(true)
      button.props.onPress()
      expect(pressed.pop(), key).toEqual(routeKey(key, keyState))
    }
    expect(labels).toContain('p/n')
    expect(labels).toContain('PgUp/PgDn')
  }
})

test('pending scroll: 21 cards have an eight-card window, wheel/page bounds, numeric hints and cursor following', () => {
  for (const locale of ['zh-TW', 'en']) {
    const pendingScroll = windows()
    let nav = { ...NO_NAV }
    const c = ctx({ pendingScroll, t: makeT(locale) })
    const draw = () => frameRows(decidePage, { ...c, decide: nav })
    const screen = () => draw().map(text).join('\n')
    expect(screen()).toContain(c.t('page.decide.range', { a: 1, b: 8, n: 21 }))
    expect(screen()).toContain(c.t('page.decide.more_down', { n: 13, arrow: GLYPHS.structure.behind }))
    expect(screen()).not.toContain(c.t('page.decide.more_up', { n: 0, arrow: GLYPHS.structure.up }))
    const footer = draw().slice(-3).map(text)
    // j keeps moving the cursor; crossing the edge opens the next list page.
    for (let i = 0; i < 8; i++) nav = decideReduce(nav, routeKey('j', keyState), c, 0).nav
    expect(screen()).toContain(c.t('page.decide.range', { a: 9, b: 16, n: 21 }))
    expect(screen()).toContain(c.t('page.decide.more_up', { n: 8, arrow: GLYPHS.structure.up }))
    expect(screen()).toContain(c.t('page.decide.more_down', { n: 5, arrow: GLYPHS.structure.behind }))
    expect(applyScroll(pendingScroll.list, { by: 3, contentRows: 21 })).toBe(true)
    expect(screen()).toContain(c.t('page.decide.range', { a: 12, b: 19, n: 21 }))
    applyScroll(pendingScroll.list, { by: 22, contentRows: 1000 })
    expect(screen()).toContain(c.t('page.decide.range', { a: 14, b: 21, n: 21 }))
    expect(applyScroll(pendingScroll.list, { by: 1, contentRows: 21 })).toBe(false)
    nav = decideReduce(nav, routeKey('p', keyState), c, 0).nav
    expect(screen()).toContain(c.t('page.decide.range', { a: 1, b: 8, n: 21 }))
    applyScroll(pendingScroll.list, { by: -22, contentRows: 21 })
    expect(applyScroll(pendingScroll.list, { by: -1, contentRows: 21 })).toBe(false)
    for (let i = 0; i < 22; i++) {
      nav = decideReduce(nav, routeKey('n', keyState), c, 0).nav
      const rows = draw()
      expect(rows.length).toBe(22)
      expect(rows.slice(-3).map(text)).toEqual(footer)
      expect(rows.every(r => displayWidth(text(r)) <= 120)).toBe(true)
    }
    expect(nav.cursor).toBe(20)
    expect(screen()).toContain(c.t('page.decide.range', { a: 14, b: 21, n: 21 }))
    for (let i = 0; i < 22; i++) nav = decideReduce(nav, routeKey('p', keyState), c, 0).nav
    expect(nav.cursor).toBe(0)
    expect(screen()).toContain(c.t('page.decide.range', { a: 1, b: 8, n: 21 }))
  }
})

test('pending scroll: a long question, background and option details reach the last line with actions fixed at 120x22', () => {
  const pendingScroll = windows()
  const long = { ...cards[0], question: 'Question start\n' + 'Long question '.repeat(40) + 'QUESTION-END', background: Array.from({ length: 90 }, (_, i) => '背景 ' + i).join('\n') + '\nBACKGROUND-END', options: [{ label: 'Long option '.repeat(30) + 'OPTION-END', detail: 'Detail '.repeat(40) + 'DETAIL-END', recommended: true }] }
  const c = ctx({ pendingScroll, v74: { ...ctx().v74, decide: [long] } })
  const seen: string[] = []
  let footer = ''
  for (let n = 0; n < 200; n++) {
    const rows = frameRows(decidePage, c)
    expect(rows.length).toBe(22)
    expect(rows.every(r => displayWidth(text(r)) <= 120)).toBe(true)
    const currentFooter = rows.slice(-3).map(text).join('\n')
    if (n === 0) footer = currentFooter
    expect(currentFooter).toBe(footer)
    expect(text(rows[19])).toContain('[s]')
    seen.push(...rows.map(text))
    if (!applyScroll(pendingScroll.detail, { by: 22, contentRows: 10000 })) break
  }
  const all = seen.join('\n')
  for (const marker of ['QUESTION-END', 'BACKGROUND-END', 'OPTION-END', 'DETAIL-END']) expect(all).toContain(marker)
  expect(pendingScroll.detail.offset).toBe(pendingScroll.detail.max)
  expect(applyScroll(pendingScroll.detail, { by: 1, contentRows: 10000 })).toBe(false)
  expect(applyScroll(pendingScroll.detail, { by: -10000, contentRows: 10000 })).toBe(true)
  expect(pendingScroll.detail.offset).toBe(0)
})

// Mount the registered production hook against an in-memory filesystem. No live
// state or credentials are read; process.run only returns fictional cards.
test('pending scroll: mounted v75 Pane scrolls past 400 rows, wheels the list and keeps p/n and arrow navigation distinct', async ($, on) => {
  const root = '/fixture/pending-scroll'
  const now = Date.parse('2026-11-01T00:00:00Z')
  const clock = mock.clock(on, { now })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'en' : e.name === 'AUTOPILOT_LIVE_V75' ? '1' : undefined }))
  on('fs.read', (_, e) => { if (e.path.endsWith('/.git/HEAD')) return { value: 'ref: refs/heads/main\n' }; throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'pending-scroll-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'pending-scroll-fixture' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', (_, e) => ({ value: { exitCode: e.argv.includes('decision') ? 0 : 1, stdout: e.argv.includes('decision') ? JSON.stringify({ cards: cards.map((c, i) => ({ card: { card_id: c.id, title: c.title, question: 'Question ' + (i + 1), background: i === 0 ? Array.from({ length: 450 }, (_, n) => 'Background line ' + n).join('\n') + '\nMOUNTED-END' : 'Short background', options: [{ label: 'Option A', description: 'Option detail' }], recommendation: 'Option A' } })) }) : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ surface: 'terminal', cwd: root })
  await clock.advance(5000)
  await $.command.run({ command: 'live-pane', args: '' })
  const band = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', requestId: 'above-prompt', props: { bodyColumns: 120, maxRows: 40 }, viewport: { columns: 120, rows: 45, isFullscreen: true } })
  await band.drawn()
  let pane = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { bodyColumns: 120, scroll: { offset: 0, bodyRows: 22 }, isFocused: true }, viewport: { columns: 120, rows: 22, isFullscreen: true } })
  await pane.press({ key: 'decide' })
  await clock.advance(50)
  const visible = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(visible).join('') : n?.props?.width === 0 || n?.props?.height === 0 ? '' : visible(n?.children ?? [])
  const screen = async () => {
    await pane.unmount()
    pane = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { bodyColumns: 120, scroll: { offset: 0, bodyRows: 22 }, isFocused: true }, viewport: { columns: 120, rows: 22, isFullscreen: true } })
    return visible(await pane.drawn())
  }
  expect(await screen()).toContain('Cards 1–8 of 21')
  const scroll = (by, pointer?) => $.ui.scroll({ component: 'Pane', requestId: 'autopilot-live', by, offset: 0, bodyRows: 22, contentRows: 22, origin: { kind: 'person' }, ...(pointer === undefined ? {} : { pointer }) })
  const focus = element => $.ui.focus({ component: 'Pane', requestId: 'autopilot-live', element, origin: { kind: 'person' } })
  await focus('focus')
  let before = await screen()
  for (const element of ['pn:j', 'pn:k', 'pn:n', 'pn:p', 'pn:m']) {
    await focus(element)
    const after = await screen()
    expect(after, element + ' must scroll rather than switch cards').not.toBe(before)
    before = after
  }
  await scroll(3, { x: 3, y: 4 })
  expect(await screen()).toContain('Cards 4–11 of 21')
  await scroll(1)
  expect(await screen()).toContain('Cards 4–11 of 21')
  for (let i = 0; i < 90; i++) { await scroll(22); await screen() }
  expect(await screen()).toContain('MOUNTED-END')
  expect(await screen()).toContain('Option detail')
  await pane.press({ key: 'pn:n' })
  await clock.advance(50)
  expect(await screen()).toContain('Question 2')
  expect(await screen()).toContain('Cards 1–8 of 21')
  await pane.press({ key: 'pn:p' })
  await clock.advance(50)
  expect(await screen()).toContain('Background line 0')
  await pane.unmount()
  await band.unmount()
  await $.session.end({ reason: 'exit' })
})
