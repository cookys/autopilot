import type { Register } from 'claude-code'
import { Variant } from './variants'
import { V4, Legend, PANE_ID } from './v4'

let sel = 'v4a1'
let vp: any = null
let lastOpen = ''
let paneCols: number | null = null

function b64(words: number[]): string {
  const u = new Uint8Array(new Uint32Array(words).buffer)
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return btoa(s)
}
function gaugeCells(cols: number, frac: number): string {
  const w: number[] = []
  for (let i = 0; i < cols; i++) {
    if (i < Math.round(cols * frac)) w.push(0x2588, 0x33dd55, 0x01000000)
    else w.push(0x2591, 0x666666, 0x01000000)
  }
  return b64(w)
}
const BL = [0x20, 0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588]
function sparkCells(cols: number, vals: number[]): string {
  const w: number[] = []
  for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
    const lv = Math.round(vals[c % vals.length] * 16)
    const inRow = r === 0 ? Math.max(0, lv - 8) : Math.min(8, lv)
    w.push(BL[inRow], r === 0 ? 0x55aaff : 0x33dd55, 0x01000000)
  }
  return b64(w)
}

const Cap = (el: any, t: string) => <el.Text dimColor>{t}</el.Text>

function S1(el: any, sel = '') {
  const { Box, Text } = el
  const badge = (label: string, bg: string) => <Text inverse backgroundColor={bg} bold>{' ' + label + ' '}</Text>
  const fmt = (label: string, bg: string) => <Box><Text inverse backgroundColor={bg}>{' ' + label + ' '}</Text><Text dimColor>{' bg=' + bg + ' '}</Text><Text color={bg}>{'fg=' + bg}</Text></Box>
  return (
    <Box flexDirection="column">
      {Cap(el, '[S1] verdict badges (inverse+backgroundColor hex) + line 1 + reason line 2')}
      <Box>{badge('要你決定', '#ff5555')}{badge('疑似卡住', '#f1c40f')}{badge('完成待驗收', '#2ecc71')}{badge('進行中', '#3498db')}<Text>{' gate-sandbox4 │ 實作 │ ██████░░░░ 60% (3/5) │ 12m'}</Text></Box>
      <Box>{[['要你決定','#ff5555'],['疑似卡住','#f1c40f'],['完成待驗收','#2ecc71'],['進行中','#3498db']].map(([l,c]) => <Text backgroundColor={c} color="#000000" bold>{' ' + l + ' '}</Text>)}<Text dimColor>{'  <- [S1b] backgroundColor + color, NO inverse'}</Text></Box>
      <Text dimColor>等你選 A 或 B（原因行）</Text>
      {Cap(el, '[S1] color formats (badge, then fg of same value)')}
      <Box>
        {fmt('hex', '#ff5555')}<Text> </Text>{fmt('rgb()', 'rgb(255,85,85)')}<Text> </Text>{fmt('ansi256', 'ansi256(203)')}<Text> </Text>{fmt('red', 'red')}
      </Box>
      {Cap(el, '[S1] theme keys (inverse bg, then fg)')}
      <Box>
        {['warning', 'permission', 'inactive', 'success', 'error'].map(k => <Box><Text inverse backgroundColor={k}>{' ' + k + ' '}</Text><Text color={k}>{'fg:' + k}</Text><Text> </Text></Box>)}
      </Box>
      {sel.includes('x') ? <Box flexDirection="column">{Cap(el, '[S1x] bare inverse+color / bg-only')}
      <Box><Text inverse color="red">{' red-inverse '}</Text><Text inverse color="#2ecc71">{' hex-inverse '}</Text><Text backgroundColor="#3498db" color="#ffffff">{' bg-only '}</Text></Box></Box> : null}
    </Box>
  )
}

function S2(el: any) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {['round', 'single', 'double'].map(st => (
          <Box flexDirection="column" marginRight={1}>
            {Cap(el, '[S2] ' + st)}
            <Box borderStyle={st} borderColor="#ff5555" paddingX={1} flexDirection="column"><Text>{'要你決定 │ 實作 │ 60%'}</Text><Text dimColor>等你選 A 或 B</Text></Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function S3(el: any) {
  const { Box, Text, Raster } = el
  return (
    <Box flexDirection="column">
      {Cap(el, '[S3] Raster 20x1 truecolor gauge, then 20x2 sparkline')}
      <Box>
        <Raster key="g1" columns={20} rows={1} cells={gaugeCells(20, 0.6)} />
        <Text>{' 60% (3/5)'}</Text>
      </Box>
      <Raster key="sp" columns={20} rows={2} cells={sparkCells(20, [0.1, 0.3, 0.2, 0.5, 0.8, 0.6, 0.9, 0.7, 0.4, 0.3])} />
    </Box>
  )
}

function S4(el: any) {
  const { Box, Client } = el
  return (
    <Box flexDirection="column">
      {Cap(el, '[S4] Client module with 1s every spinner')}
      <Client key="spin" module="./spin.tsx" />
    </Box>
  )
}

function Table(el: any) {
  const { Box, Text, Raster } = el
  const W = [14, 10, 10, 8, 8]
  const row = (cells: string[], hdr: boolean, i: number) => (
    <Box>
      {cells.map((c, k) => <Box width={W[k]} flexShrink={0}><Text bold={hdr}>{c}</Text></Box>)}
      {!hdr ? <Raster key={'rg' + i} columns={10} rows={1} cells={gaugeCells(10, [0.8, 0.5, 0.2][i])} /> : null}
    </Box>
  )
  const rows = [['實作 hand', 'grok-4.7', '實作', '0:15', '—'], ['審查', 'codex', '審查', '3:20', '3m ⏸'], ['工頭', 'sonnet', '等待處置', '12:04', '—']]
  return (
    <Box flexDirection="column">
      <Text dimColor>{'[S5] pane table; vp=' + JSON.stringify(vp) + ' paneBodyColumns=' + paneCols}</Text>
      <Box borderStyle="round" borderColor="#3498db" flexDirection="column" paddingX={1}>
        {row(['派工', 'runner', '階段', '經過', '安靜'], true, -1)}
        {rows.map((r, i) => row(r, false, i))}
      </Box>
      <Text dimColor>{'ruler 0123456789012345678901234567890123456789'}</Text>
      <Text>{'ASCII ref: 12345678901234|grok-4.7  |'}</Text>
    </Box>
  )
}

async function toggle($: any) {
  const up = (await $.ui.panes()).some((p: any) => p.id === PANE_ID)
  if (up) { await $.ui.close({ id: PANE_ID }); return 'closed' }
  const r = await $.ui.open({ id: PANE_ID, title: '圖例', focus: true, closeOnEscape: true })
  lastOpen = JSON.stringify(r)
  return 'open ' + lastOpen
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'spike-pane', description: 'open the spike pane' })
    await $.command.register({ name: 'spike-legend', description: 'toggle the legend pane' })
    await $.command.register({ name: 'spike-band', description: 'spike-band s123 | s4' })
    return next(e)
  })
  on('command.run', { command: 'spike-pane' }, async ($, e: any) => {
    const r = await $.ui.open({ id: 'spike', title: 'spike' })
    return { text: 'presentation=' + JSON.stringify(e.presentation) + ' open=' + JSON.stringify(r) }
  })
  on('command.run', { command: 'spike-legend' }, async ($, e: any) => ({ text: 'legend ' + await toggle($) }))
  on('command.run', { command: 'spike-band' }, async ($, e: any) => {
    sel = String(e.args ?? '').trim() || 's123'
    await $.ui.invalidate('ui.render')
    return { text: 'band sel=' + sel }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    vp = e.viewport ? { c: e.viewport.columns, fs: e.viewport.isFullscreen } : null
    const el: any = $.ui.resolve(e)
    const { Box, Text } = el
    const p: any = e.props
    return (
      <Box flexDirection="column">
        <Text dimColor>{'[band] sel=' + sel + ' bodyColumns=' + p.bodyColumns + ' maxRows=' + p.maxRows + ' vp=' + JSON.stringify(vp)}</Text>
        {/^v4/.test(sel) ? V4(el, sel, () => { void toggle($) }) : null}
        {/^v[123]b?$/.test(sel) ? Variant(el, sel, p.bodyColumns) : null}
        {/^v/.test(sel) ? null : sel.includes('1') ? S1(el, sel) : null}
        {/^v/.test(sel) ? null : sel.includes('2') ? S2(el) : null}
        {/^v/.test(sel) ? null : sel.includes('3') ? S3(el) : null}
        {/^v/.test(sel) ? null : sel.includes('4') ? S4(el) : null}
      </Box>
    )
  })
  on('ui.render', { component: 'Pane', requestId: 'spike' }, ($, e: any) => {
    paneCols = e.props?.bodyColumns ?? null
    return Table($.ui.resolve(e))
  })
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e: any) => Legend($.ui.resolve(e), () => { void $.ui.close({ id: PANE_ID }) }))
}
