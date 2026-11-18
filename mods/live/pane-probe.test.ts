import { test, expect } from 'claude-code/testing'

const PATH = '/tmp/pane-r4-host.jsonl'
const NOW = 1794200000000
const mount = ($: any, columns: number, rows: number, placement: string, bodyRows?: number, legacyTabs = false) => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live',
  props: { title: 'Autopilot', isFocused: true, bodyColumns: Math.floor(columns / 2), placement, ...(bodyRows === undefined ? {} : { scroll: { offset: 0, bodyRows } }), view: { agentId: undefined }, legacyTabs },
  viewport: { columns, rows, isFullscreen: true } })

test('R4-5: opt-in probe appends one JSON line per Pane render with actual host props and returned rows', async ($, on) => {
  let file = '{"previous":true}\n'
  const writes: string[] = []
  on('clock.now', () => ({ value: NOW }))
  on('env.get', (_, e) => ({ value: e.name === 'AUTOPILOT_MODS_PANE_PROBE' ? PATH : undefined }))
  on('fs.read', (_, e) => { if (e.path !== PATH) throw new Error('ENOENT'); return { value: file } })
  on('fs.write', (_, e) => { expect(e.path).toBe(PATH); file = e.text; writes.push(e.text); return { value: undefined } })
  const cases = [[160, 40, 'dock', 34], [120, 30, 'inline', 25], [80, 16, 'inline', 3]] as const
  for (const [columns, rows, placement, bodyRows] of cases) {
    const pane = await mount($, columns, rows, placement, bodyRows)
    await pane.drawn()
    await pane.unmount()
  }
  expect(writes.length).toBe(cases.length)
  const lines = file.trimEnd().split('\n').map(l => JSON.parse(l))
  expect(lines[0]).toEqual({ previous: true })
  for (const [i, [termCols, termRows, placement, bodyRows]] of cases.entries()) {
    expect(lines[i + 1]).toEqual({ ts: NOW, placement, bodyRows, renderedRows: bodyRows, lastRowHasTabs: true, termCols, termRows })
  }
})

test('R4-5: unset probe env performs no probe file I/O after checking the opt-in', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  let checked = false
  const io: string[] = []
  on('env.get', (_, e) => { if (e.name === 'AUTOPILOT_MODS_PANE_PROBE') checked = true; return { value: undefined } })
  on('fs.read', (_, e) => { if (checked) io.push('read ' + e.path); throw new Error('ENOENT') })
  on('fs.write', (_, e) => { if (checked) io.push('write ' + e.path); return { value: undefined } })
  on('fs.exists', (_, e) => { if (checked) io.push('exists ' + e.path); return { value: false } })
  on('fs.list', (_, e) => { if (checked) io.push('list ' + e.path); return { value: [] } })
  on('fs.stat', (_, e) => { if (checked) io.push('stat ' + e.path); throw new Error('ENOENT') })
  const pane = await mount($, 160, 40, 'dock', 34)
  await pane.drawn()
  expect(checked).toBe(true)
  expect(io).toEqual([])
  await pane.unmount()
})

test('R4-5: unavailable env access leaves the pane intact and performs no probe I/O', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('env.get', () => { throw new Error('env access unavailable') })
  const writes: string[] = []
  on('fs.write', (_, e) => { writes.push(e.path); return { value: undefined } })
  const pane = await mount($, 160, 40, 'dock', 34)
  const boxes = await pane.findAll({ type: 'Box' })
  expect(boxes.filter((b: any) => /^f\d+$/.test(b.props?.key ?? '')).length).toBe(34)
  expect(writes).toEqual([])
  await pane.unmount()
})
