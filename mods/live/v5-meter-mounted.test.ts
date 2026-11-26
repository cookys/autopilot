// console v5 spend page through the real register.ts (AUTOPILOT_LIVE_V5=1, 209x49): the wide band's list rows for the metering block fit the list column without `…`,
// the over-10% row is drawn in the action colour, and the docked pane shows the metering block (not the fleet lanes) on page 5.
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
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : e.name === 'AUTOPILOT_LIVE_V5' ? '1' : e.name === 'AUTOPILOT_R5_FEEDBACK_DIR' ? dir : undefined }))
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
    band = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', requestId: 'above-prompt', props: { bodyColumns: 209, maxRows: 33 }, viewport: { columns: 209, rows: 49, isFullscreen: true } })
    return await band.drawn()
  }
  const key = async letter => {
    const tree = await draw()
    await band.press({ key: walk(tree).find(n => n.type === 'Button' && n.props?.hotkey === letter).props.key })
    await clock.advance(50)
    return await draw()
  }
  await draw()
  const pane = async () => {
    const p = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { title: 'Autopilot', isFocused: true, bodyColumns: 93, placement: 'dock', scroll: { offset: 0, bodyRows: 42 }, view: { agentId: undefined } }, viewport: { columns: 115, rows: 49, isFullscreen: true } })
    const tree = await p.drawn()
    await p.unmount()
    return tree
  }
  return { key, pane }
}
// every Text of a row Box of the band/pane, with its colour: [text, color]
const pieces = tree => walk(tree).filter(n => n.type === 'Text').map(n => [text(n), n.props?.color])

test('v5 spend page: the wide band draws the three metering rows whole (no …) and only 4124gs in the action colour', async ($, on) => {
  const h = await host($, on, PACK)
  const tree = await h.key('5')
  const all = text(tree)
  expect(all).toContain('5 花費')
  for (const row of ['4124gs 88/137 缺 49 · 留 7 日', 'c4140  86/81 缺 5 · 留 4 日', 'xl270d 125/137 缺 12 · 留 7 日']) expect(all, row).toContain(row)
  expect(all).not.toContain('…')
  const colour = (needle: string) => pieces(tree).find(([t]) => t.includes(needle))?.[1]
  expect(colour('4124gs 88/137')).toBe('remember')
  expect(colour('c4140  86/81')).toBeUndefined()
  expect(colour('xl270d 125/137')).toBeUndefined()
})

test('v5 spend page: the docked pane draws the metering block in place of the fleet lanes', async ($, on) => {
  const h = await host($, on, PACK)
  await h.key('5')
  const tree = await h.pane()
  const all = text(tree)
  expect(all).toContain('計量覆蓋')
  expect(all).toContain('4124gs  覆蓋 88/137（缺 49）· 保留 7 日')
  expect(all).toContain('c4140   覆蓋 86/81（缺 5）· 保留 4 日')
  expect(all).toContain('xl270d  覆蓋 125/137（缺 12）· 保留 7 日')
  expect(all).toContain('證據：尚無生產者（約 11-30）')
  expect(all).not.toContain('艦隊 ·')
  const colour = (needle: string) => pieces(tree).find(([t]) => t.includes(needle))?.[1]
  expect(colour('4124gs  覆蓋')).toBe('remember')
  expect(colour('c4140   覆蓋')).toBeUndefined()
})

test('v5 spend page: a missing pack draws the broken row in the pane and the band, never a count', async ($, on) => {
  const h = await host($, on, null)
  const band = text(await h.key('5'))
  expect(band).toContain('無來源：計量覆蓋讀不了')
  const pane = text(await h.pane())
  expect(pane).toContain('計量覆蓋')
  expect(pane).toContain('無來源：計量覆蓋檔不存在或讀不了')
  expect(pane).not.toContain('88/137')
})
