// UX gate round 2 part B: exercise the pane chrome through the real components.
import { test, expect } from 'claude-code/testing'
import { PALETTE, actionSeg } from './ui'
import { BandBar } from './band'
import { consoleOf, NOW } from './pages/quota.fixture'
import type { ConsoleSnapshot } from './console'
import { Pane, FOCUS_ANCHOR_KEY } from './pane'
import { routeKey } from './pages/keys'
import { frameHeight, frameRows } from './pages/frame'
import { PAGES } from './pages/index'
import { makeT } from './i18n'
import { displayWidth } from './model'

type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
const walk = (n: any): Node[] => n == null || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [...(n.kind ? [n] : []), ...walk(n.props?.children)]
const flat = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : n?.props ? flat(n.props.children) : ''
const hostWidth = (n: any): number => typeof n === 'string' ? displayWidth(n) : Array.isArray(n) ? n.reduce((w, c) => w + hostWidth(c), 0) : n?.props ? hostWidth(n.props.children) + (n.kind === 'Button' && n.props.hotkey ? 3 : 0) : 0

test('R6: strip at 80, 70 and 60 columns binds 1-8, 9, 0, i with named labels and no action-letter label', () => {
  for (const cols of [80, 70, 60]) for (const locale of ['zh-TW', 'en']) {
    const pressed: string[] = []
    const tree = Pane(EL as never, null, 'now', () => {}, makeT(locale), cols, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: PAGES, pageId: 'now', onPage: id => pressed.push(id), console: null, nowMs: 0, rows: 24 })
    const buttons = walk(tree).filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && /^[0-9i]$/.test(n.props.hotkey ?? ''))
    expect(buttons.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'i'])
    for (const b of buttons) {
      const label = flat(b).trim()
      expect(label.length).toBeGreaterThan(0)
      expect(['o', 'z', 'f'].includes(label.toLowerCase()), locale + ' ' + cols + ': ' + label).toBe(false)
      b.props.onPress()
    }
    expect(pressed).toEqual(PAGES.map(p => p.id))
    const rows = walk(tree).filter(n => /^f\d+$/.test(n.props.key ?? ''))
    for (const row of rows.slice(cols < 66 ? -2 : -1)) expect(hostWidth(row)).toBeLessThanOrEqual(cols)
  }
})

test('R7: pressing 1 on 現況 keeps the pane open on 現況', () => {
  let open = true
  let page = 'now'
  const act = routeKey('1', { page, paneFocus: true, focusedButton: false, textMode: false })
  if (act.kind === 'close') open = false
  if (act.kind === 'page') page = act.to
  expect(open).toBe(true)
  expect(page).toBe('now')
  expect(act.kind).toBe('none')
})

test('R7 mounted: current-page digit Button does not call ui.close or change the 現況 header', async ($, on) => {
  on('clock.now', () => ({ value: 1794200000000 }))
  const closes: string[] = []
  on('ui.close', (_, e) => { closes.push(e.id); return { value: undefined } })
  const pane = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { title: 'Autopilot', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: { agentId: undefined } }, viewport: { columns: 160, rows: 40, isFullscreen: true } })
  const before = await pane.drawn()
  const button = (await pane.findAll({ type: 'Button' })).find((b: any) => b.props.hotkey === '1')
  expect(button).toBeDefined()
  await pane.press({ key: button!.props.key })
  const after = await pane.drawn()
  await pane.unmount()
  expect(closes).toEqual([])
  expect(after).toEqual(before)
})

test('R9: collapsed band shows snapshot pending and fault counts, [+], no digit keys, exactly two rows', () => {
  const cards = Array.from({ length: 3 }, (_, i) => ({ id: 'd-0000000' + i, question: 'q', status: 'open', opened_at_ms: NOW, executor_display: null }))
  const lines = Array.from({ length: 2 }, (_, i) => ({ line_id: 'line-' + i, label: 'line-' + i, lead_display: null, issues: [{ rule: 'T4', state: 'failed', subject: 'broken', since_ms: NOW, to_console: true }] }))
  for (const cols of [160, 120, 80, 70, 60, 40, 30, 20]) for (const locale of ['zh-TW', 'en']) for (const count of [0, 3]) {
    const con = consoleOf([], { cards: cards.slice(0, count), lines: count ? lines : [] }) as ConsoleSnapshot
    const tree = BandBar(EL as never, null, cols, makeT(locale), { onInfo() {}, onSlot() {}, onTab() {} }, null, null, true, null, { snap: con, tab: 'command', cols }).node as Node
    const rows = (tree.props.children as Node[]).flat().filter(Boolean)
    expect(rows.length).toBe(2)
    expect(flat(rows[0])).toContain('[+]')
    const buttons = walk(rows[1]).filter(n => n.kind === 'Button')
    expect(buttons.every(b => b.props.hotkey === undefined)).toBe(true)
    const decide = buttons.find(b => b.props.key === 'tab:decide')!
    const fleet = buttons.find(b => b.props.key === 'tab:fleet')!
    expect(flat(decide).trim().endsWith('(3)'), locale + ' ' + cols + ' decide: ' + flat(decide)).toBe(count > 0)
    expect(flat(fleet).trim().endsWith('(✗2)'), locale + ' ' + cols + ' fleet: ' + flat(fleet)).toBe(count > 0)
    expect(flat(decide)).not.toContain('(0)')
    expect(flat(fleet)).not.toContain('(✗0)')
    if (cols >= 40) expect(hostWidth(rows[1])).toBeLessThanOrEqual(cols)
  }
})

// Host 2.1.326's light theme: remember is rgb(0,0,255), xterm 21;
// the reported merged/105 clickable text is rgb(135,135,255). See chrome-host-contract.txt.
test('R12: action role uses the accessible light-theme link token with contrast >= 4.5:1', () => {
  const luminance = (rgb: number[]) => rgb.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
  const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
  expect(contrast([135, 135, 255], [255, 255, 255])).toBeLessThan(4.5)
  expect(actionSeg('open').color).toBe('remember')
  expect(PALETTE.action).toBe('remember')
  for (const light of [[255, 255, 255], [245, 245, 245]]) expect(contrast([0, 0, 255], light)).toBeGreaterThanOrEqual(4.5)
})

test('R13: dock uses all 40 available rows with strip last; inline stays capped at 24', () => {
  for (const [placement, available, want] of [['dock', 40, 40], ['dock', 30, 30], ['inline', 40, 24], ['inline', 24, 24], ['inline', 12, 12]] as const) {
    const height = frameHeight(available, placement)
    expect(height, placement + ' ' + available).toBe(want)
    const rows = frameRows(PAGES[0], { live: null, console: null, t: makeT('zh-TW'), nowMs: 0, size: { cols: 80, rows: height } })
    expect(rows.length).toBe(want)
    expect(rows[want - 1].some(s => s.press === 'tab:1:now')).toBe(true)
  }
})

test('R13 mounted: host dock bodyRows reaches the last row at 160x40 and 120x30; inline 80x24 stays capped', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  for (const [columns, rows, placement, available, want] of [[160, 40, 'dock', 40, 40], [120, 30, 'dock', 30, 30], [80, 24, 'inline', 30, 24]] as const) {
    const pane = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { title: 'Autopilot', isFocused: true, bodyColumns: placement === 'dock' ? columns / 2 : columns, placement, scroll: { offset: 0, bodyRows: available }, view: { agentId: undefined } }, viewport: { columns, rows, isFullscreen: true } })
    const boxes = await pane.findAll({ type: 'Box' })
    const framed = boxes.filter((b: any) => /^f\d+$/.test(b.props?.key ?? ''))
    expect(framed.length).toBe(want)
    expect(framed[want - 1].props.key).toBe('f' + (want - 1))
    const contents = JSON.stringify(framed[want - 1])
    expect(contents).toContain('h:i')
    await pane.unmount()
  }
})

test('R12 legend: action help follows the link role instead of promising purple', () => {
  expect(makeT('en')('legend.action')).not.toContain('purple')
  expect(makeT('zh-TW')('legend.action')).not.toContain('紫色')
})
