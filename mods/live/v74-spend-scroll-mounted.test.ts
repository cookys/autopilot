// v7.4 boxed frame (AUTOPILOT_LIVE_V5=0) through the real register.ts: a cut spend body scrolls by the j / k hotkey Buttons and by the host's ui.scroll (ArrowDown / PageDown / wheel).
import { test, expect, mock } from 'claude-code/testing'

const walk = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.children)]
const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.width === 0 || n?.props?.height === 0 ? '' : text(n?.children ?? [])
const PACK = JSON.stringify({
  generated_at: '2026-11-27T00:15:00Z',
  coverage: {
    '4124gs': { expected: 137, got: 88, missing: 49, retention_days: 7, no_data: false },
    c4140: { expected: 81, got: 86, missing: 5, retention_days: 4, no_data: false },
    xl270d: { expected: 137, got: 125, missing: 12, retention_days: 7, no_data: false },
  },
  evidence: { lines: [] },
})

async function host($, on, pack: string | null) {
  const root = '/fixture/v5-meter'
  const dir = '/fixture/r5-feedback'
  const clock = mock.clock(on, { now: Date.parse('2026-11-27T01:00:00Z') })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : e.name === 'AUTOPILOT_LIVE_V5' ? '0' : e.name === 'AUTOPILOT_R5_FEEDBACK_DIR' ? dir : undefined }))
  on('fs.read', (_, e) => { if (e.path.endsWith('/.git/HEAD')) return { value: 'ref: refs/heads/main\n' }; if (e.path === dir + '/pack.json' && pack !== null) return { value: pack }; throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', (_, e) => ({ value: e.path === dir && pack !== null ? [{ name: 'pack.json', kind: 'file', mtimeMs: 1 }] : [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'v5-meter-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'v5-meter-fixture' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ surface: 'terminal', cwd: root })
  await clock.advance(5000)
  await $.command.run({ command: 'live-pane', args: '' })
  let band
  const draw = async () => {
    if (band) await band.unmount()
    band = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', requestId: 'above-prompt', props: { bodyColumns: 209, maxRows: 9 }, viewport: { columns: 209, rows: 49, isFullscreen: true } })
    return await band.drawn()
  }
  const key = async letter => {
    const tree = await draw()
    await band.press({ key: walk(tree).find(n => n.type === 'Button' && n.props?.hotkey === letter).props.key })
    await clock.advance(50)
    return await draw()
  }
  await draw()
  const scroll = async by => { await $.ui.scroll({ component: 'AbovePrompt', requestId: 'above-prompt', by, offset: 0, bodyRows: 14, contentRows: 14, origin: { kind: 'person' } }); await clock.advance(50); return await draw() }
  const pane = async () => {
    const p = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { title: 'Autopilot', isFocused: true, bodyColumns: 93, placement: 'dock', scroll: { offset: 0, bodyRows: 42 }, view: { agentId: undefined } }, viewport: { columns: 115, rows: 49, isFullscreen: true } })
    const tree = await p.drawn()
    await p.unmount()
    return tree
  }
  return { key, scroll, draw }
}

test('v7.4 boxed spend page: j and ui.scroll scroll a cut body and the metering rows come into view', async ($, on) => {
  const h = await host($, on, PACK)
  const first = text(await h.key('5'))
  expect(first).toMatch(/↓ 還有 \d+ 列/)
  expect(first).not.toContain('88/137')
  const tree = await h.draw()
  expect(walk(tree).some(n => n.type === 'Button' && n.props?.hotkey === 'j'), 'a hotkey j Button in the mounted boxed frame').toBe(true)
  let seen = first
  for (let i = 0; i < 30 && !seen.includes('88/137'); i++) seen = text(await h.scroll(1))
  expect(seen).toContain('88/137')
  expect(seen).toMatch(/↑ 還有 \d+ 列/)
  const back = text(await h.scroll(-30))
  expect(back).toMatch(/↓ 還有 \d+ 列/)
  expect(back).not.toMatch(/↑ 還有/)
})

test('v7.4 boxed spend page: taking the keyboard (focus lands on another tab) does not move the window; a following arrow does', async ($, on) => {
  const h = await host($, on, PACK)
  const first = text(await h.key('5'))
  expect(first).not.toMatch(/↑ 還有/)
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'tab:hygiene', origin: { kind: 'person' } })
  const grabbed = text(await h.draw())
  expect(grabbed).not.toMatch(/↑ 還有/)
  expect(grabbed).toMatch(/↓ 還有 \d+ 列/)
  const moved = text(await h.scroll(1))
  expect(moved).toMatch(/↑ 還有 \d+ 列/)
})

const arrowDown = ($: any) => $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'tab:hygiene', origin: { kind: 'person' } })

test('v7.4 boxed spend page: grab then Down moves one row', async ($, on) => {
  const h = await host($, on, PACK)
  await h.key('5')
  await arrowDown($) // the grab
  expect(text(await h.draw())).not.toMatch(/↑ 還有/)
  await arrowDown($)
  expect(text(await h.draw())).toMatch(/↑ 還有 1 列/)
})

test('v7.4 boxed spend page: grab, j, Down moves two rows in all', async ($, on) => {
  const h = await host($, on, PACK)
  await h.key('5')
  await arrowDown($) // the grab
  expect(text(await h.key('j'))).toMatch(/↑ 還有 1 列/)
  await arrowDown($)
  expect(text(await h.draw())).toMatch(/↑ 還有 2 列/)
})

test('v7.4 light contrast: spend frame hint and section headings', async ($, on) => {
  const h = await host($, on, PACK)
  await h.key('5')
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'tab:hygiene', origin: { kind: 'person' } })
  const nodes = walk(await h.draw())
  const bottom = nodes.find(n => n.props?.key === 'v74-bottom')
  const hint = walk(bottom).find(n => n.type === 'Text' && text(n).includes('鍵盤在 pane'))
  expect(hint?.props?.color, 'hint uses inactive ink').toBe('inactive')
  // a fold heading `▾ title ──`: the glyph and the title are text (inactive, >= 4.5:1 on light), only the rule stays structure
  const heads = nodes.filter(n => n.type === 'Text' && /^\s*▾ \S/.test(text(n)))
  expect(heads.length).toBeGreaterThan(0)
  for (const head of heads) expect(head.props?.color, 'fold heading ' + text(head) + ' uses inactive ink').toBe('inactive')
})
