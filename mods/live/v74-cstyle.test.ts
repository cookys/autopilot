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

async function host($, on, opts: { cols?: number; rows?: number; store?: Map<string, unknown>; cards?: typeof longCards } = {}) {
  const cols = opts.cols ?? 209
  const rows = opts.rows ?? 50
  const maxRows = Math.min(rows - 16, 34)
  const store = opts.store ?? new Map<string, unknown>()
  const cards = opts.cards ?? longCards
  const root = '/fixture/v74-cstyle'
  const now = Date.parse('2026-11-01T00:00:00Z')
  const clock = mock.clock(on, { now })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : e.name === 'AUTOPILOT_LIVE_V75' ? '0' : undefined }))
  on('fs.read', (_, e) => { if (e.path.endsWith('/.git/HEAD')) return { value: 'ref: refs/heads/main\n' }; throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('session.id', () => ({ value: 'v74-cstyle-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'v74-cstyle-fixture' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
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
  const draw = async () => {
    if (band) await band.unmount()
    band = await $.ui.mount({
      plugin: 'autopilot',
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: 'above-prompt',
      props: { bodyColumns: cols, maxRows },
      viewport: { columns: cols, rows, isFullscreen: true },
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
  await key('2')
  return {
    draw,
    key,
    restart: async () => {
      await band.unmount()
      band = undefined
      await $.session.end({ reason: 'exit' })
      await $.session.start({ surface: 'terminal', cwd: root })
      await clock.advance(5000)
      await $.command.run({ command: 'live-pane', args: '' })
      await draw()
      await key('2')
    },
    close: async () => { await band.unmount(); await $.session.end({ reason: 'exit' }) },
  }
}

test('c-style: 209x50 shows question, all options, recommendation, count, 1-line bg without scrolling', async ($, on) => {
  const h = await host($, on, { cols: 209, rows: 50 })
  const styleD = text(await h.draw())
  expect(styleD).toContain('卡 #01 / 3')

  const styleC = text(await h.key('v'))
  expect(styleC).toContain('第 1 張，共 3 張')
  expect(styleC).toContain('Which approach should we take for the migration?')
  expect(styleC).toContain('Option Alpha')
  expect(styleC).toContain('Option Beta')
  expect(styleC).toContain('Option Gamma')
  expect(styleC).toContain('建議')
  expect(styleC).toContain('e 展開')
  expect(styleC).not.toContain('BG-END-1')
  expect(styleC).not.toContain('捲卡')
  await h.close()
})

test('c-style: 120x30 shows question, all options, recommendation, count, 1-line bg without scrolling', async ($, on) => {
  const h = await host($, on, { cols: 120, rows: 30 })
  const styleD = text(await h.draw())
  expect(styleD).toContain('卡 #01 / 3')

  const styleC = text(await h.key('v'))
  expect(styleC).toContain('第 1 張，共 3 張')
  expect(styleC).toContain('Which approach should we take for the migration?')
  expect(styleC).toContain('Option Alpha')
  expect(styleC).toContain('Option Beta')
  expect(styleC).toContain('Option Gamma')
  expect(styleC).toContain('建議')
  expect(styleC).toContain('e 展開')
  expect(styleC).not.toContain('BG-END-1')
  expect(styleC).not.toContain('捲卡')
  await h.close()
})

test('c-style: v toggles D<->C and store remembers across session restart', async ($, on) => {
  const store = new Map<string, unknown>()
  const h = await host($, on, { store })
  expect(text(await h.draw())).toContain('卡 #01 / 3')
  expect(text(await h.key('v'))).toContain('第 1 張，共 3 張')
  expect(store.get('decide.style')).toBe('C')

  await h.restart()
  expect(text(await h.draw())).toContain('第 1 張，共 3 張')
  expect(text(await h.key('v'))).toContain('卡 #01 / 3')
  expect(store.get('decide.style')).toBe('D')
  await h.close()
})

test('c-style: e expands background with scroll, Esc returns to card', async ($, on) => {
  const h = await host($, on)
  await h.key('v')
  const expanded = text(await h.key('e'))
  expect(expanded).toContain('Background detail line 0')
  expect(expanded).toContain('Esc 回到卡片')

  await $.ui.scroll({
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    by: 50,
    offset: 0,
    bodyRows: 34,
    contentRows: 34,
    origin: { kind: 'person' },
  })
  const scrolled = text(await h.draw())
  expect(scrolled).toContain('上面還有')
  await h.close()
})

test('c-style: p/n switches cards and a/b/c picks option', async ($, on) => {
  const h = await host($, on)
  await h.key('v')
  const card2 = text(await h.key('n'))
  expect(card2).toContain('第 2 張，共 3 張')
  const picked = text(await h.key('b'))
  expect(picked).toContain('Warn Only →')
  const card1 = text(await h.key('p'))
  expect(card1).toContain('第 1 張，共 3 張')
  await h.close()
})

test('c-style: Esc focus event closes expanded background without changing card', async ($, on) => {
  const h = await host($, on)
  await h.key('v')
  await h.key('n')
  const expanded = text(await h.key('e'))
  expect(expanded).toContain('Context line 0')
  expect(expanded).toContain('Esc 回到卡片')

  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: '', origin: { kind: 'person' } })
  const back = text(await h.draw())
  expect(back).toContain('第 2 張，共 3 張')
  expect(back).toContain('Should we enable strict validation by default?')
  expect(back).not.toContain('Esc 回到卡片')
  await h.close()
})

test('c-style: options and note sit at bottom of body', async ($, on) => {
  const h = await host($, on, { cols: 209, rows: 50 })
  const t = text(await h.key('v'))
  const bg = t.indexOf('背景')
  const firstOpt = t.indexOf('★') - 20
  const note = t.indexOf('m 附註：')
  const send = t.indexOf('預覽並送出')
  expect(bg).toBeGreaterThan(0)
  expect(firstOpt).toBeGreaterThan(bg)
  expect(note).toBeGreaterThan(firstOpt)
  expect(send).toBeGreaterThan(note)
  // the spare rows sit between the one-line background and the options, none after the note row
  expect(t.slice(bg, firstOpt)).toMatch(/│ +││/)
  expect(t.slice(note, send).replace(/[│ ]/g, '').length).toBeLessThanOrEqual('m 附註：（空）'.length)
  await h.close()
})

test('c-style: 1-line background hides e expand hint and e is a no-op', async ($, on) => {
  const shortCards = [
    {
      card_id: 'short-1',
      title: 'Short Card',
      question: 'Pick one?',
      background: 'Single line background',
      options: [
        { label: 'Yes', detail: 'Do it', recommended: true },
        { label: 'No', detail: 'Skip it', recommended: false },
      ],
    },
  ]
  const h = await host($, on, { cards: shortCards })
  const styleC = text(await h.key('v'))
  expect(styleC).toContain('Single line background')
  expect(styleC).not.toContain('Single line background  · e 展開')
  const afterE = text(await h.key('e'))
  expect(afterE).not.toContain('Esc 回到卡片')
  expect(afterE).toContain('Pick one?')
  await h.close()
})
