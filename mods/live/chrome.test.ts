// UX gate round 2 part B: exercise the pane chrome through the real components.
import { test, expect } from 'claude-code/testing'
import { PALETTE } from '../tux/palette.ts'
import { actionSeg } from './ui'
import { BAND_SEP_SEG } from './band-onerow'
import { BandBar } from './band'
import { consoleOf, NOW } from './pages/quota.fixture'
import type { ConsoleSnapshot } from './console'
import { Pane, FOCUS_ANCHOR_KEY } from './pane'
import { routeKey } from './pages/keys'
import { frameHeight, frameRows, STRIP_SPLIT_COLS } from './pages/frame'
import { PAGES } from './pages/index'
import { seatQuota } from './pages/now'
import { makeT } from './i18n'
import { displayWidth } from './model'

type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
const walk = (n: any): Node[] => n == null || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [...(n.kind ? [n] : []), ...walk(n.props?.children)]
const flat = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : n?.props ? flat(n.props.children) : ''
const hostWidth = (n: any): number => typeof n === 'string' ? displayWidth(n) : Array.isArray(n) ? n.reduce((w, c) => w + hostWidth(c), 0) : n?.props ? hostWidth(n.props.children) + (n.kind === 'Button' && n.props.hotkey ? 3 : 0) : 0

test('R6: strip at 80, 70 and 60 columns binds 1-8, 9, 0 with named labels and no action-letter label', () => {
  for (const cols of [80, 70, 60]) for (const locale of ['zh-TW', 'en']) {
    const pressed: string[] = []
    const tree = Pane(EL as never, null, 'now', () => {}, makeT(locale), cols, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: PAGES, pageId: 'now', onPage: id => pressed.push(id), console: null, nowMs: 0, rows: 24 })
    const buttons = walk(tree).filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && /^[0-9]$/.test(n.props.hotkey ?? ''))
    expect(buttons.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
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
    // M6: the open-pane control names the pane, distinct from the band's own fold control.
    expect(flat(rows[0])).toContain(makeT(locale)('band.open_pane'))
    const buttons = walk(rows[1]).filter(n => n.kind === 'Button')
    expect(buttons.every(b => b.props.hotkey === undefined)).toBe(true)
    const decide = buttons.find(b => b.props.key === 'tab:decide')!
    const fleet = buttons.find(b => b.props.key === 'tab:fleet')!
    expect(flat(decide).trim().endsWith('(3)'), locale + ' ' + cols + ' decide: ' + flat(decide)).toBe(count > 0)
    expect(flat(fleet).trim().endsWith('(✗2 ○4)'), locale + ' ' + cols + ' fleet: ' + flat(fleet)).toBe(count > 0) // X3: include the same four unlisted/normal lines as the page summary.
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

// Host 2.1.326 theme values (chrome-host-contract.txt): light inactive rgb(102,102,102), dark inactive rgb(153,153,153);
// the old separator colour subtle is rgb(175,175,175) light and rgb(80,80,80) dark. A separator is a non-text component: >= 3:1 on both themes.
test('R13: the band separator keeps contrast >= 3:1 on light and dark backgrounds', () => {
  const luminance = (rgb: number[]) => rgb.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
  const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
  const host: Record<string, { light: number[]; dark: number[] }> = { inactive: { light: [102, 102, 102], dark: [153, 153, 153] }, subtle: { light: [175, 175, 175], dark: [80, 80, 80] } }
  expect(contrast(host.subtle.light, [255, 255, 255])).toBeLessThan(3)
  expect(contrast(host.subtle.dark, [0, 0, 0])).toBeLessThan(3)
  const key = BAND_SEP_SEG.color as string
  expect(host[key], 'separator colour ' + key + ' has no host RGB in this test').toBeDefined()
  for (const bg of [[255, 255, 255], [245, 245, 245]]) expect(contrast(host[key].light, bg)).toBeGreaterThanOrEqual(3)
  for (const bg of [[0, 0, 0], [30, 30, 30]]) expect(contrast(host[key].dark, bg)).toBeGreaterThanOrEqual(3)
})

test('W1: dock and inline use all host body rows with the strip last', () => {
  for (const [placement, available, want] of [['dock', 40, 40], ['dock', 30, 30], ['inline', 40, 40], ['inline', 24, 24], ['inline', 12, 12]] as const) {
    const height = frameHeight(available, placement)
    expect(height, placement + ' ' + available).toBe(want)
    const rows = frameRows(PAGES[0], { live: null, console: null, t: makeT('zh-TW'), nowMs: 0, size: { cols: 80, rows: height } })
    expect(rows.length).toBe(want)
    expect(rows[want - 1].some(s => s.press === 'tab:1:now')).toBe(true)
  }
})

test('W1: mounted dock and inline bodyRows reach the last host body row', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  for (const [columns, rows, placement, available, want] of [[160, 40, 'dock', 40, 40], [120, 30, 'dock', 30, 30], [80, 24, 'inline', 30, 30]] as const) {
    const pane = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { title: 'Autopilot', isFocused: true, bodyColumns: placement === 'dock' ? columns / 2 : columns, placement, scroll: { offset: 0, bodyRows: available }, view: { agentId: undefined } }, viewport: { columns, rows, isFullscreen: true } })
    const boxes = await pane.findAll({ type: 'Box' })
    const framed = boxes.filter((b: any) => /^f\d+$/.test(b.props?.key ?? ''))
    expect(framed.length).toBe(want)
    expect(framed[want - 1].props.key).toBe('f' + (want - 1))
    const contents = JSON.stringify(framed[want - 1])
    expect(contents).toContain('"hotkey":"0"') // v7.4: the strip ends on 0 寵物 (no i)
    await pane.unmount()
  }
})

test('R12 legend: action help follows the link role instead of promising purple', () => {
  expect(makeT('en')('legend.action')).not.toContain('purple')
  expect(makeT('zh-TW')('legend.action')).not.toContain('紫色')
})

test('M7: missing pending-card source shows ? (never 0) on 現況, 待決 and band row 2; real source with 0 cards keeps current text', () => {
  seatQuota.reset()
  const nowPage = PAGES.find(p => p.id === 'now')!
  const decidePage = PAGES.find(p => p.id === 'decide')!
  const rowText = (r: { text: string }[]): string => r.map(s => s.text).join('')
  const makeLive = (state: string, header: string) => ({
    state, text: header, band: null, header, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null,
    sections: { attention: null, attentionNotWired: false, tasks: null, tasksNote: null, decisionsNotWired: false, foreman: null },
    review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null,
    detail: { counts: null, stalled: 0, now_ms: null, project: null, marker: null, qc: null, stage: null, decisions: null, load_source: null, residue: null, spend: null },
  })
  const baseCon = { ...(consoleOf([], { cards: null, lines: [] }) as ConsoleSnapshot), items: [], counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: {}, hosts: {}, hints: 0, quota_worst: null } } }
  const conCardsNull: ConsoleSnapshot = { ...baseCon, cards: null, sources: { cards: { at_ms: null, state: 'no_source' }, tasks: { at_ms: NOW, state: 'ok' }, hosts: { at_ms: NOW, state: 'ok' }, quota_now: { at_ms: NOW, state: 'ok' }, quota_forecast: { at_ms: NOW, state: 'ok' } } }
  const conCardsNoSrc: ConsoleSnapshot = { ...conCardsNull, cards: [] }
  const missingCases: [string, unknown, ConsoleSnapshot | null, string, string][] = [
    ['null/null', null, null, '待決 ? 張（無來源：沒有指標檔、沒有 console 快照）', 'Pending ? (no source: no pointer file, no console snapshot)'],
    ['null/cards-null', null, conCardsNull, '待決 ? 張（無來源：沒有指標檔）', 'Pending ? (no source: no pointer file)'],
    ['no-project/null', makeLive('no-project', 'no project'), null, '待決 ? 張（無來源：沒有 console 快照）', 'Pending ? (no source: no console snapshot)'],
    ['stale/cards-no-source', makeLive('stale', 'stale'), conCardsNoSrc, '待決 ? 張（無來源：console 沒有卡片資料來源）', 'Pending ? (no source: the console has no card source)'],
  ]

  for (const locale of ['zh-TW', 'en'] as const) {
    const t = makeT(locale)
    const wantNoSourcePrefix = locale === 'zh-TW' ? '待決 ? 張（無來源' : 'Pending ? (no source'
    const wantBandFull = locale === 'zh-TW' ? '待決(?)' : 'Decide(?)'
    const wantBandShort = locale === 'zh-TW' ? '待(?)' : 'D(?)'
    const wantBandZero = locale === 'zh-TW' ? '待決' : 'Decide'

    for (const [name, live, con, wantZh, wantEn] of missingCases) {
      const wantPage = locale === 'zh-TW' ? wantZh : wantEn
      for (const [cols, rows] of [[160, 40], [120, 30], [80, 24], [80, 7]] as const) {
        const stripLen = cols < STRIP_SPLIT_COLS ? 2 : 1
        const ctx = { live: live as never, console: con, size: { cols, rows }, t, nowMs: NOW }
        const msg = `${locale} ${name} ${cols}x${rows}`
        const nowAboveStrip = frameRows(nowPage, ctx).slice(0, -stripLen).map(rowText).join('\n')
        const decAboveStrip = frameRows(decidePage, ctx).slice(0, -stripLen).map(rowText).join('\n')
        expect(nowAboveStrip, msg + ' now has ?').toContain(wantPage)
        expect(decAboveStrip, msg + ' decide is the band line').toContain(t('shell.on_band'))
        expect(decAboveStrip, msg + ' decide does not repeat the pending count').not.toContain(wantPage)
        expect(nowAboveStrip, msg + ' now no 0 pending').not.toMatch(/待決\s*0|Pending\s*0|\b0\s*cards|\(0\)|沒有待決卡|No open decision|No pending cards/)
        expect(decAboveStrip, msg + ' decide no 0').not.toContain('0')
        expect(decAboveStrip, msg + ' decide no none_cards').not.toMatch(/沒有待決卡|No open decision|No pending cards/)
        if (con === null) expect(nowAboveStrip, msg + ' now no 0').not.toContain('0')
      }

      for (const cols of [160, 120, 80, 40] as const) {
        const msg = `${locale} ${name} band@${cols}`
        const tree = BandBar(EL as never, live as never, cols, t, { onInfo() {}, onSlot() {}, onTab() {} }, null, null, true, null, { snap: con, tab: 'command', cols }).node as Node
        const bandRows = (tree.props.children as Node[]).flat().filter(Boolean)
        const decideBtn = walk(bandRows[1]).find(n => n.kind === 'Button' && n.props.key === 'tab:decide')!
        // M6: the extra pet/forge pages make the English menu use short names at 80 columns.
        // X1: the shared strip adds page numbers; page 0 is a tab, not a pending-card count.
        expect(flat(decideBtn).trim(), msg).toBe((cols >= 80 ? '2 ' : '') + (cols >= (locale === 'en' ? 120 : 80) ? wantBandFull : wantBandShort))
        expect(walk(bandRows[1]).filter(n => n.kind === 'Button').map(n => flat(n).trim().replace(/^\d\s+/, '')).join(' '), msg + ' no 0 count').not.toContain('0')
      }
    }

    // Positive control: a real source with 0 cards keeps current text (no ?)
    const okConZero: ConsoleSnapshot = { ...conCardsNull, cards: [], sources: { ...conCardsNull.sources, cards: { at_ms: NOW, state: 'ok' } } }
    const okLiveZero = makeLive('ok', '')
    for (const [live, con] of [[null, okConZero], [okLiveZero, null], [okLiveZero, okConZero]] as const) {
      const tree = BandBar(EL as never, live as never, 120, t, { onInfo() {}, onSlot() {}, onTab() {} }, null, null, true, null, { snap: con, tab: 'command', cols: 120 }).node as Node
      const bandRows = (tree.props.children as Node[]).flat().filter(Boolean)
      const decideBtn = walk(bandRows[1]).find(n => n.kind === 'Button' && n.props.key === 'tab:decide')!
      expect(flat(decideBtn).trim()).toBe('2 ' + wantBandZero) // X1: shared page number.
      const nowText = frameRows(nowPage, { live: live as never, console: con, size: { cols: 120, rows: 30 }, t, nowMs: NOW }).map(rowText).join('\n')
      expect(nowText).not.toContain(wantNoSourcePrefix)
    }
    const zeroDecText = frameRows(decidePage, { live: okLiveZero as never, console: okConZero, size: { cols: 120, rows: 30 }, t, nowMs: NOW }).map(rowText).join('\n')
    expect(zeroDecText).toContain(t('shell.on_band'))
    expect(zeroDecText).not.toContain(t('page.decide.none_cards'))
    expect(zeroDecText).not.toContain(wantNoSourcePrefix)
  }
})
