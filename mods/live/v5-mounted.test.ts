// console v5: the wide band drawn through the real register.ts (AUTOPILOT_LIVE_V5=1, 209x49). The pure wide/* goldens never load register,
// so a throw in the per-page projection (P5b calls every page each draw) blanked the whole band in a real session and no test saw it.
import { test, expect, mock } from 'claude-code/testing'

const walk = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.children)]
const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.width === 0 || n?.props?.height === 0 ? '' : text(n?.children ?? [])

const longCards = [
  {
    card_id: 'cstyle-1',
    title: 'Long Card 1',
    question: 'Which approach should we take for the migration?',
    background: Array.from({ length: 80 }, (_, n) => 'Background detail line ' + n).join('\n') + '\nBG-END-1',
    options: [
      { label: 'Option Alpha', detail: 'First detailed explanation', recommended: true },
      { label: 'Option Beta', detail: 'Second detailed explanation', recommended: false },
      { label: 'Option Gamma', detail: 'Third detailed explanation', recommended: false },
    ],
  },
  {
    card_id: 'cstyle-2',
    title: 'Long Card 2',
    question: 'Should we enable strict validation by default?',
    background: Array.from({ length: 40 }, (_, n) => 'Context line ' + n).join('\n') + '\nBG-END-2',
    options: [
      { label: 'Enable Strict', detail: 'Catch errors early', recommended: true },
      { label: 'Warn Only', detail: 'Log warnings without blocking', recommended: false },
      { label: 'Disable', detail: 'Skip validation', recommended: false },
    ],
  },
  {
    card_id: 'cstyle-3',
    title: 'Long Card 3',
    question: 'How should we handle legacy configs?',
    background: Array.from({ length: 20 }, (_, n) => 'Legacy note ' + n).join('\n') + '\nBG-END-3',
    options: [
      { label: 'Auto-migrate', detail: 'Convert on load', recommended: false },
      { label: 'Dual-read', detail: 'Support both formats', recommended: true },
      { label: 'Reject', detail: 'Require manual update', recommended: false },
    ],
  },
]

async function host($, on, opts: { cols?: number; rows?: number; store?: Map<string, unknown>; cards?: typeof longCards; opens?: unknown[]; closes?: unknown[] } = {}) {
  const cols = opts.cols ?? 209
  const rows = opts.rows ?? 50
  const maxRows = Math.min(rows - 16, 34)
  const store = opts.store ?? new Map<string, unknown>()
  const cards = opts.cards ?? longCards
  const opens = opts.opens ?? []
  const closes = opts.closes ?? []
  const root = '/fixture/v5-mounted'
  const now = Date.parse('2026-11-01T00:00:00Z')
  const clock = mock.clock(on, { now })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : e.name === 'AUTOPILOT_LIVE_V5' ? '1' : undefined }))
  on('fs.read', (_, e) => { if (e.path.endsWith('/.git/HEAD')) return { value: 'ref: refs/heads/main\n' }; throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('session.id', () => ({ value: 'v5-mounted-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'v5-mounted-fixture' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: undefined }))
  on('ui.open', (_, e) => { opens.push(e); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', (_, e) => { closes.push(e); return { value: undefined } })
  on('process.run', (_, e) => ({
    value: {
      exitCode: e.argv.includes('decision') ? 0 : 1,
      stdout: e.argv.includes('decision') ? JSON.stringify({
        cards: cards.map(c => ({
          card: {
            card_id: c.card_id,
            title: c.title,
            question: c.question,
            background: c.background,
            options: c.options.map(o => ({ label: o.label, description: o.detail })),
            recommendation: c.options.find(o => o.recommended)?.label ?? null,
          },
        })),
      }) : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))

  await $.session.start({ surface: 'terminal', cwd: root })
  await clock.advance(5000)
  await $.command.run({ command: 'live-pane', args: '' })

  let band
  const draw = async (bodyCols = cols, vpCols = cols) => {
    if (band) await band.unmount()
    band = await $.ui.mount({
      plugin: 'autopilot',
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: 'above-prompt',
      props: { bodyColumns: bodyCols, maxRows },
      viewport: { columns: vpCols, rows, isFullscreen: true },
    })
    return await band.drawn()
  }

  const key = async letter => {
    const tree = await draw()
    const button = walk(tree).find(n => n.type === 'Button' && n.props?.hotkey === letter)
    expect(button !== undefined, 'registered hotkey ' + letter).toBe(true)
    await band.press({ key: button.props.key })
    await clock.advance(50)
    return await draw()
  }

  await draw()
  return { draw, key, clock }
}

test('v5 mounted: 209x49 with AUTOPILOT_LIVE_V5=1 draws the wide band; every page is projected in that draw (no snapshot review, no throw)', async ($, on) => {
  const h = await host($, on, { cols: 209, rows: 49 })
  const first = text(await h.draw())
  expect(first).toContain('現況')
  expect(first).toContain('Tab 換頁')
})

test('v5 mounted: wide band hotkeys switch pages and provide one focus anchor', async ($, on) => {
  const h = await host($, on, { cols: 209, rows: 49 })
  expect(walk(await h.draw()).filter(n => n.type === 'Button' && n.props?.autoFocus).length).toBe(1)
  expect(text(await h.key('3'))).toContain('3 派工')
  expect(text(await h.key('2'))).toContain('2 待決')
})

// the wide layout's right column is the host Pane: an operator open (/live-pane, here before the first draw) must open it at 94 columns;
// the narrow v7.4 frame keeps its page in the band and opens no host Pane
test('v5 mounted: /live-pane in the wide band opens the host Pane', async ($, on) => {
  const opens: any[] = []
  await host($, on, { cols: 209, rows: 49, opens })
  // the host's ui.open event type has no columns field (register passes it through `as never`), so only the open itself is observable here
  expect(opens.some(o => o.id === 'autopilot-live')).toBe(true)
})

test('v5 mounted: 160x40 (narrow) with AUTOPILOT_LIVE_V5=1 opens no host Pane', async ($, on) => {
  const opens: any[] = []
  await host($, on, { cols: 160, rows: 40, opens })
  expect(opens.length).toBe(0)
})

// once the host Pane docks, the band's bodyColumns drop to the band's own width (115 of 209): the switch reads the terminal width, so the band stays wide and the Pane stays open
test('v5 mounted: the band stays wide after the Pane docks (bodyColumns and viewport 115 of a 209-column terminal): no close, no reopen', async ($, on) => {
  const opens: any[] = []
  const closes: any[] = []
  const h = await host($, on, { cols: 209, rows: 49, opens, closes })
  const before = opens.length
  // the real host (2.1.332, 209x49 tmux) gives the band viewport.columns 115 and the Pane bodyColumns 93 once the Pane docks
  const docked = text(await h.draw(115, 115))
  await h.draw(115, 115)
  expect(docked).toContain('Tab 換頁')
  expect(closes.length).toBe(0)
  expect(opens.length).toBe(before)
})

// the host refuses a Button that holds a Box ("JSX element <Button> holds strings and Text, not <Box>", 209x49 tmux, CC 2.1.332) and skips the
// whole Pane render; the test host does not check it, so the docked wide Pane is walked here. Sizes are the real host's once docked.
test('v5 mounted: the docked wide Pane draws and no Button in it holds a Box', async ($, on) => {
  await host($, on, { cols: 209, rows: 49 })
  const pane = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { title: 'Autopilot', isFocused: true, bodyColumns: 93, placement: 'dock', scroll: { offset: 0, bodyRows: 42 }, view: { agentId: undefined } }, viewport: { columns: 115, rows: 49, isFullscreen: true } })
  const tree = await pane.drawn()
  expect(text(tree)).toContain('其他頁')
  const bad = walk(tree).filter(n => n.type === 'Button' && walk(n.children).some(c => c.type === 'Box'))
  expect(bad.length).toBe(0)
  await pane.unmount()
})

test('v5 mounted: docked wide Pane hotkeys switch the band page', async ($, on) => {
  const h = await host($, on, { cols: 209, rows: 49 })
  const pane = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { title: 'Autopilot', isFocused: true, bodyColumns: 93, placement: 'dock', scroll: { offset: 0, bodyRows: 42 }, view: { agentId: undefined } }, viewport: { columns: 115, rows: 49, isFullscreen: true } })
  const buttons = walk(await pane.drawn()).filter(n => n.type === 'Button')
  for (const digit of '123456789') expect(buttons.some(n => n.props?.hotkey === digit)).toBe(true)
  expect(buttons.filter(n => n.props?.autoFocus).length).toBe(1)
  const four = buttons.find(n => n.props?.hotkey === '4')
  await pane.press({ key: four.props.key })
  await h.clock.advance(50)
  expect(text(await h.draw(115, 115))).toContain('4 審查')
  await pane.unmount()
})
