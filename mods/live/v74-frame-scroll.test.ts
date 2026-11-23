import { test, expect, mock } from 'claude-code/testing'

const cards = Array.from({ length: 5 }, (_, i) => ({ id: 'v74-scroll-' + i, title: 'Card ' + (i + 1) }))
const walk = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.children)]
const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.width === 0 || n?.props?.height === 0 ? '' : text(n?.children ?? [])

async function host($, on, maxRows = 34) {
  const root = '/fixture/v74-frame-scroll'
  const now = Date.parse('2026-11-01T00:00:00Z')
  const clock = mock.clock(on, { now })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : undefined }))
  on('fs.read', (_, e) => { if (e.path.endsWith('/.git/HEAD')) return { value: 'ref: refs/heads/main\n' }; throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'v74-frame-scroll-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'v74-frame-scroll-fixture' }))
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
        cards: cards.map((c, i) => ({
          card: {
            card_id: c.id,
            title: c.title,
            question: 'Question ' + (i + 1),
            background: i === 0
              ? Array.from({ length: 80 }, (_, n) => 'Background line ' + n).join('\n') + '\nMOUNTED-END'
              : 'Short background ' + (i + 1),
            options: [{ label: 'Option A', description: 'Option detail' }],
            recommendation: 'Option A',
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
      props: { bodyColumns: 209, maxRows },
      viewport: { columns: 209, rows: 50, isFullscreen: true },
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
  return { draw, key, close: async () => { await band.unmount(); await $.session.end({ reason: 'exit' }) } }
}

test('v7.4 frame: ui.scroll by=50 scrolls detail without changing card, by=-50 returns, bottom clamps', async ($, on) => {
  const h = await host($, on)
  const initial = text(await h.draw())
  expect(initial).toContain('卡 #01 / 5')

  const scroll = by => $.ui.scroll({
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    by,
    offset: 0,
    bodyRows: 34,
    contentRows: 34,
    origin: { kind: 'person' },
  })

  await scroll(50)
  const afterDown = text(await h.draw())
  expect(afterDown).not.toBe(initial)
  expect(afterDown).toContain('卡 #01 / 5')
  expect(afterDown).toContain('上面還有')

  await scroll(-50)
  const afterUp = text(await h.draw())
  expect(afterUp).toContain('卡 #01 / 5')
  expect(afterUp).not.toContain('上面還有')

  let prev = afterUp
  for (let i = 0; i < 20; i++) {
    await scroll(50)
    const cur = text(await h.draw())
    expect(cur).toContain('卡 #01 / 5')
    if (cur === prev) break
    prev = cur
  }
  await scroll(50)
  expect(text(await h.draw())).toBe(prev)

  await h.close()
})

test('v7.4 frame: ui.focus step scrolls detail 1 line without changing card, key(n) resets scroll', async ($, on) => {
  const h = await host($, on)
  const before = text(await h.draw())
  expect(before).toContain('卡 #01 / 5')

  await $.ui.focus({
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    element: 'tab:dispatch',
    origin: { kind: 'person' },
  })
  const afterFocus = text(await h.draw())
  expect(afterFocus).not.toBe(before)
  expect(afterFocus).toContain('卡 #01 / 5')
  expect(afterFocus).toContain('↑ 上面還有 1 行')

  const nextCard = text(await h.key('n'))
  expect(nextCard).toContain('卡 #02 / 5')
  expect(nextCard).not.toContain('上面還有')

  await h.close()
})
