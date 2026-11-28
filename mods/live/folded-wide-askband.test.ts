// The folded wide v5 band (AUTOPILOT_LIVE_V5=1, no live-pane open) draws only the wide band itself: no 「我問」 ask row, no history row. Real register.ts, mounted.
import { test, expect, mock } from 'claude-code/testing'

const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.width === 0 || n?.props?.height === 0 ? '' : text(n?.children ?? [])

const ASKS_MANY = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ status: '未答', count: 1, at: '2026-11-27T00:10:00Z', ask: `需要確認部署嗎${i}？`, answer: null })))

async function host($, on, asksJson: string | null, columns: number, vrows: number) {
  const root = '/fixture/wide-folded'
  const clock = mock.clock(on, { now: Date.parse('2026-11-27T01:00:00Z') })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : e.name === 'AUTOPILOT_LIVE_V5' ? '1' : undefined }))
  on('fs.read', (_, e) => { if (e.path.endsWith('/.git/HEAD')) return { value: 'ref: refs/heads/main\n' }; throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'wide-folded-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'wide-folded-fixture' }))
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
  const band = await $.ui.mount({
    plugin: 'autopilot',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    props: { bodyColumns: columns, maxRows: 33 },
    viewport: { columns, rows: vrows, isFullscreen: true },
  })
  return await band.drawn()
}

const rowsOf = tree => Array.isArray(tree?.children) ? tree.children : Array.isArray(tree?.props?.children) ? tree.props.children : [tree]
const cjkWidth = (s: string) => [...s].reduce((w, c) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1), 0)

test('folded wide v5 band at 209x49: no ask or history row stacked under the band, each row within the pane width', async ($, on) => {
  const columns = 209
  const tree = await host($, on, ASKS_MANY, columns, 49)
  expect(text(tree)).not.toContain('我問：')
  expect(text(tree)).toContain('現況')
  for (const r of rowsOf(tree)) expect(cjkWidth(text(r))).toBeLessThanOrEqual(columns)
})
