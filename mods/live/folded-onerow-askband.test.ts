// The folded one-row band (not v5, collapsed) draws exactly ONE row: no 「我問」 ask row, no history row. Real register.ts, mounted.
import { test, expect, mock } from 'claude-code/testing'

const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.width === 0 || n?.props?.height === 0 ? '' : text(n?.children ?? [])

const ASKS_MANY = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ status: '未答', count: 1, at: '2026-11-27T00:10:00Z', ask: `需要確認部署嗎${i}？`, answer: null })))

async function host($, on, asksJson: string | null, columns: number, vrows: number) {
  const root = '/fixture/folded-onerow'
  const clock = mock.clock(on, { now: Date.parse('2026-11-27T01:00:00Z') })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? root : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : undefined }))
  on('fs.read', (_, e) => { if (e.path.endsWith('/.git/HEAD')) return { value: 'ref: refs/heads/main\n' }; throw new Error('ENOENT') })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => ({ value: { kind: e.path === root ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'folded-onerow-fixture' }))
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.start', () => ({ cwd: root }))
  on('session.end', () => ({ sessionId: 'folded-onerow-fixture' }))
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

for (const [columns, vrows] of [[120, 40], [105, 40]]) {
  test(`folded one-row band at ${columns}x${vrows}: exactly 1 row, no ask or history row, each row within the pane width`, async ($, on) => {
    const tree = await host($, on, ASKS_MANY, columns, vrows)
    const rows = rowsOf(tree)
    expect(text(tree)).not.toContain('我問：')
    expect(rows.length).toBe(1)
    for (const r of rows) expect(cjkWidth(text(r))).toBeLessThanOrEqual(columns)
  })
}
