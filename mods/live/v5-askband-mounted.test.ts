// console v5 wide band ask strip through the real register.ts (AUTOPILOT_LIVE_V5=1, 209x49):
// draws the 「我問」 strip with per-item status when ask rows exist, and draws nothing when there are none.
import { test, expect, mock } from 'claude-code/testing'

const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.width === 0 || n?.props?.height === 0 ? '' : text(n?.children ?? [])

const ASKS_JSON = JSON.stringify([
  { status: '未答', count: 1, at: '2026-11-27T00:10:00Z', ask: '需要確認部署嗎？', answer: null },
  { status: '已答', count: 1, at: '2026-11-27T00:05:00Z', ask: '測試跑完了嗎？', answer: '跑完了' },
])

async function host($, on, asksJson: string | null) {
  const root = '/fixture/v5-askband'
  const clock = mock.clock(on, { now: Date.parse('2026-11-27T01:00:00Z') })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : e.name === 'AUTOPILOT_LIVE_V5' ? '1' : undefined }))
  on('fs.read', (_, e) => { if (e.path.endsWith('/.git/HEAD')) return { value: 'ref: refs/heads/main\n' }; throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'v5-askband-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'v5-askband-fixture' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    if (asksJson !== null && e.argv.some(a => a.endsWith('pm-ask.js'))) {
      return { value: { exitCode: 0, stdout: asksJson, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ surface: 'terminal', cwd: root })
  await clock.advance(5000)
  await $.command.run({ command: 'live-pane', args: '' })
  const band = await $.ui.mount({
    plugin: 'autopilot',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    props: { bodyColumns: 209, maxRows: 33 },
    viewport: { columns: 209, rows: 49, isFullscreen: true },
  })
  return await band.drawn()
}

test('v5 wide band: draws 「我問」 strip with per-item status at 209x49 when ask rows exist', async ($, on) => {
  const tree = await host($, on, ASKS_JSON)
  const all = text(tree)
  expect(all).toContain('我問：')
  expect(all).toContain('1 未答')
  expect(all).toContain('未答 需要確認部署嗎？')
  expect(all).toContain('已答')
  expect(all).toContain('現況')
})

test('v5 wide band: draws no 「我問」 strip when there are no ask rows', async ($, on) => {
  const tree = await host($, on, null)
  const all = text(tree)
  expect(all).not.toContain('我問：')
  expect(all).toContain('現況')
})
