// Regression: 120x30 gives AbovePrompt only nine or ten rows, so the real host uses
// the boxed fallback, not the docked Pane mounted by pending-scroll.test.ts.
import { test, expect, mock } from 'claude-code/testing'
const cards = Array.from({ length: 21 }, (_, i) => ({ id: 'scroll-' + i, title: 'Card ' + (i + 1) }))
const walk = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.children)]
const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.width === 0 || n?.props?.height === 0 ? '' : text(n?.children ?? [])
async function host($, on, maxRows = 9) {
  const root = '/fixture/pending-scroll'
  const now = Date.parse('2026-11-01T00:00:00Z')
  const clock = mock.clock(on, { now })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : undefined }))
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
  on('process.run', (_, e) => ({ value: { exitCode: e.argv.includes('decision') ? 0 : 1, stdout: e.argv.includes('decision') ? JSON.stringify({ cards: cards.map((c, i) => ({ card: { card_id: c.id, title: c.title, question: 'Question ' + (i + 1), background: i === 0 ? Array.from({ length: 80 }, (_, n) => 'Background line ' + n).join('\n') + '\nMOUNTED-END' : 'Short background', options: [{ label: 'Option A', description: 'Option detail' }], recommendation: 'Option A' } })) }) : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ surface: 'terminal', cwd: root })
  await clock.advance(5000)
  await $.command.run({ command: 'live-pane', args: '' })
  let band
  const draw = async () => {
    if (band) await band.unmount()
    band = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', requestId: 'above-prompt', props: { bodyColumns: 120, maxRows }, viewport: { columns: 120, rows: 30, isFullscreen: true } })
    return await band.drawn()
  }
  const key = async letter => {
    const tree = await draw()
    // Resolve the mounted host's hotkey registration, then dispatch its press.
    // A missing binding is the exact condition that sends a real key to prompt.
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
test('pending r2: fullscreen fallback registers n/p in the mounted hotkey path', async ($, on) => {
  // 已改為雙欄：表頭為 卡 #01 / 21，n/p 仍走 mounted hotkey 切換卡
  const h = await host($, on)
  expect(text(await h.draw())).toContain('卡 #01 / 21')
  expect(text(await h.key('n'))).toContain('卡 #02 / 21')
  expect(text(await h.key('p'))).toContain('卡 #01 / 21')
  await h.close()
})

test('pending r2: 120x30 fallback shows the 21-card range and bounded card-count hints at both ends', async ($, on) => {
  // 已改為雙欄：9 列 fallback 雙欄左欄顯示 2 張卡與雙端張數提示（↓ 下面還有 19 張 / ↑ 上面還有 19 張）
  const h = await host($, on)
  let screen = text(await h.draw())
  expect(screen).toContain('清單 (21)')
  expect(screen).toContain('卡 #01 / 21')
  expect(screen).toContain('▸ 01 scroll-0')
  expect(screen).toContain('  02 scroll-1')
  expect(screen).toContain('↓ 下面還有 19 張')
  expect(screen).not.toContain('另有')
  for (let i = 0; i < 20; i++) screen = text(await h.key('n'))
  expect(screen).toContain('卡 #21 / 21')
  expect(screen).toContain('  20 scroll')
  expect(screen).toContain('▸ 21 scroll')
  expect(screen).toContain('↑ 上面還有 19 張')
  expect(screen).not.toContain('另有')
  expect(screen).not.toContain('1 2 3 4 5 6 7 8 9 10')
  await h.close()
})

test('pending r2: fallback PgDn/PgUp change detail offset, reach the end and keep actions at the bottom', async ($, on) => {
  // 已改為雙欄：9 列 fallback 右欄每頁 2 行（↑ 上面還有 2 行），卡號表頭為 卡 #01 / 21
  const h = await host($, on)
  const footer = tree => (tree.children[0].children.slice(-2)).map(text)
  const initial = await h.draw()
  const fixed = footer(initial)
  const first = text(initial)
  const page = by => $.ui.scroll({ component: 'AbovePrompt', requestId: 'above-prompt', by, offset: 0, bodyRows: 9, contentRows: 9, origin: { kind: 'person' } })
  await page(9)
  let tree = await h.draw()
  expect(text(tree)).not.toBe(first)
  expect(text(tree)).toContain('↑ 上面還有 2 行')
  const seen = [text(tree)]
  for (let i = 0; i < 100; i++) {
    await page(9)
    tree = await h.draw()
    expect(footer(tree)).toEqual(fixed)
    expect(text(tree)).toContain('卡 #01 / 21')
    seen.push(text(tree))
  }
  expect(seen.join('\n')).toContain('MOUNTED-END')
  expect(seen.join('\n')).toContain('Option detail')
  const bottom = text(tree)
  await page(9)
  expect(text(await h.draw())).toBe(bottom)
  await page(-9)
  expect(text(await h.draw())).not.toBe(bottom)
  await h.close()
})

test('pending r2: a fallback wheel scrolls current detail without moving the card queue', async ($, on) => {
  // 已改為雙欄：滾輪捲右欄詳情，左欄佇列與游標停在卡 #01 / 21
  const h = await host($, on)
  const first = text(await h.draw())
  await $.ui.scroll({ component: 'AbovePrompt', requestId: 'above-prompt', by: 3, offset: 0, bodyRows: 9, contentRows: 9, pointer: { x: 70, y: 18 }, origin: { kind: 'person' } })
  const after = text(await h.draw())
  expect(after).not.toBe(first)
  expect(after).toContain('▸ 01 scroll-0')
  expect(after).toContain('↓ 下面還有 19 張')
  expect(after).toContain('卡 #01 / 21')
  expect(after).toContain('↑ 上面還有 2 行')
  await h.close()
})


test('pending r2: fallback arrow focus steps scroll the current card instead of selecting another', async ($, on) => {
  // 已改為雙欄：方向鍵焦點步進捲右欄詳情 1 行，卡號停在 卡 #01 / 21
  const h = await host($, on)
  const before = text(await h.draw())
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'tab:dispatch', origin: { kind: 'person' } })
  const after = text(await h.draw())
  expect(after).not.toBe(before)
  expect(after).toContain('卡 #01 / 21')
  expect(after).toContain('↑ 上面還有 1 行')
  await h.close()
})


test('pending r2: the ten-row host budget captured at 120x30 shows two cards and nineteen hidden', async ($, on) => {
  // 已改為雙欄：10 列預算在雙欄下左欄可顯示 3 張卡、其餘 18 張隱藏（雙端皆有界提示）
  const h = await host($, on, 10)
  let screen = text(await h.draw())
  expect(screen).toContain('▸ 01 scroll-0')
  expect(screen).toContain('  03 scroll-2')
  expect(screen).toContain('↓ 下面還有 18 張')
  for (let i = 0; i < 20; i++) screen = text(await h.key('n'))
  expect(screen).toContain('  19 scroll')
  expect(screen).toContain('▸ 21 scroll')
  expect(screen).toContain('↑ 上面還有 18 張')
  expect(screen).not.toContain('另有')
  await h.close()
})

test('pending r2: arrow focus on a summary cannot undo the card selected by n', async ($, on) => {
  // 已改為雙欄：n 切到卡 #02 / 21 後，card:0 焦點事件不得把游標拉回
  const h = await host($, on, 10)
  expect(text(await h.key('n'))).toContain('卡 #02 / 21')
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'card:0', origin: { kind: 'person' } })
  expect(text(await h.draw())).toContain('卡 #02 / 21')
  await h.close()
})
