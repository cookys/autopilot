// # RED at 0de69d4e5: mods/roundtable/register.ts is not on the plugin yet — command rt-room is absent and the pane cases fail to mount.
// The roundtable pane through the engine. Run: bash mods/roundtable/run-tests.sh
import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { PALETTE } from '../live/ui'

const ROOMS = '/rooms'
const ROOM = 'design'
const LOG = ROOMS + '/' + ROOM + '/room.jsonl'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: Node): string => (n.children || []).map(c => (typeof c === 'string' ? c : textOf(c as Node))).join('')
function find(n: Node, type: string, out: Node[] = []): Node[] {
  if (n.type === type) out.push(n)
  for (const c of n.children || []) if (typeof c !== 'string') find(c as Node, type, out)
  return out
}

const one = (over: Record<string, unknown>) => JSON.stringify({
  ts: '2026-10-19T00:00:00.000Z', room: ROOM, seq: 1, from: 'owner', kind: 'say', text: 'hi', reply_to: null, ...over,
})

const LOG_TEXT = [
  one({ seq: 1, from: 'owner', kind: 'say', text: '你好' }),
  one({ seq: 2, from: 'cuda', kind: 'say', text: '立場' }),
  one({ seq: 3, from: 'moderator', kind: 'system', text: 'seat added cuda' }),
  one({ seq: 4, from: 'moderator', kind: 'system', text: 'send failed handle=cuda status=1 stderr=nope' }),
].join('\n') + '\n'

type World = {
  files: Record<string, string>
  env: Record<string, string>
  opens: { id: string; closeOnEscape?: boolean; focus?: boolean }[]
  runs: { argv: string[]; exitCode: number; stderr: string }[]
  invalidates: number
  logs: string[]
  commands: string[]
  tools: string[]
  live: number
  chain: number
  throwRt: boolean
  exitCode: number
  stderr: string
}

function world(on: On): World {
  const w: World = {
    files: { [LOG]: LOG_TEXT }, env: { HOME: '/home/u', AUTOPILOT_ROOMS_DIR: ROOMS, AUTOPILOT_LOCALE: 'zh-TW' },
    opens: [], runs: [], invalidates: 0, logs: [], commands: [], tools: [], live: 0, chain: 0, throwRt: false,
    exitCode: 1, stderr: 'boom-fail\n',
  }
  on('env.get', (_$, e) => ({ value: w.env[e.name] }))
  on('fs.read', (_$, e) => {
    const t = w.files[e.path]
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: t }
  })
  on('fs.stat', (_$, e) => {
    if (w.files[e.path] === undefined && e.path !== ROOMS && e.path !== ROOMS + '/' + ROOM) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: (w.files[e.path] || '').length, mtimeMs: 10, isLink: false } }
  })
  on('fs.list', (_$, e) => {
    if (e.path.replace(/\/$/, '') !== ROOMS) throw new Error('ENOENT')
    return { value: [{ name: ROOM, kind: 'dir' as const, size: 0, mtimeMs: 50, isLink: false }, { name: 'older', kind: 'dir' as const, size: 0, mtimeMs: 1, isLink: false }] }
  })
  on('fs.exists', (_$, e) => ({ value: w.files[e.path] !== undefined }))
  on('config.list', () => ({ value: [] }))
  on('clock.every', () => { w.live += 1; return { value: { cancel: () => {} } } })
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.start', () => { w.chain += 1; return { cwd: '/work/repo' } })
  on('tool.register', (_$, e) => { w.tools.push(e.name); return { value: { tool: 'mcp__autopilot__' + e.name } } })
  on('command.register', (_$, e) => {
    if (w.throwRt && e.name === 'rt-room') throw new Error('rt refused')
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.invalidate', () => { w.invalidates += 1; return { value: undefined } })
  on('ui.log', (_$, e) => { w.logs.push(String((e as { text?: string }).text ?? e)); return { value: undefined } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_$, e) => {
    w.opens.push({ id: e.id, closeOnEscape: e.closeOnEscape, focus: e.focus })
    return { value: { isPlaced: true as const } }
  })
  on('process.run', (_$, e) => {
    w.runs.push({ argv: [...e.argv], exitCode: w.exitCode, stderr: w.stderr })
    return { value: { exitCode: w.exitCode, stdout: '', stderr: w.stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}

const PANE_PROPS = { title: 'x', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 24 }, view: { agentId: undefined } }
const mount = ($: any) => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-roundtable', props: PANE_PROPS, viewport: { columns: 120, rows: 40, isFullscreen: true } })

test('register wiring: live and viewer still register, and a thrown startRoundtable does not stop them', async ($, on) => {
  const w = world(on)
  w.throwRt = true
  await $.session.start({ surface: 'terminal', cwd: '/work/repo' })
  expect(w.tools).toContain('show')
  expect(w.commands).toContain('show')
  expect(w.commands).not.toContain('rt-room')
  expect(w.live).toBeGreaterThan(0)
  expect(w.chain).toBeGreaterThan(0)
  expect(w.logs.join('\n')).toMatch(/roundtable/)
})

test('the pane paints owner, system, failure and seat rows with PALETTE roles and a bottom Input', async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: 'terminal', cwd: '/work/repo' })
  expect(w.commands).toContain('rt-room')
  await $.command.run({ command: 'rt-room', args: ROOM })
  expect(w.opens[0].id).toBe('autopilot-roundtable')
  expect(w.opens[0].closeOnEscape).toBeUndefined()
  expect(w.opens[0].focus).toBe(true)
  const win = await mount($)
  const tree = (await win.drawn()) as Node
  const body = textOf(tree)
  expect(body).toContain(ROOM)
  expect(body).toContain('4')
  expect(body).toContain('你好')
  expect(body).toContain('立場')
  const texts = find(tree, 'Text')
  const colored = (needle: string) => texts.find(t => textOf(t).includes(needle))
  expect(colored('你好')?.props?.color).toBe(PALETTE.here)
  expect(colored('seat added')?.props?.color).toBe(PALETTE.attention)
  expect(colored('send failed')?.props?.color).toBe(PALETTE.broken)
  const seat = colored('立場')
  expect(seat?.props?.color).toBeUndefined()
  const inputs = find(tree, 'Input')
  expect(inputs.length).toBe(1)
  expect(inputs[0].props?.autoFocus).toBe(true)
  const label = String(inputs[0].props?.label ?? '')
  expect(label.endsWith(':')).toBe(false)
  expect(String(inputs[0].props?.submitLabel ?? '').length).toBeGreaterThan(0)
  await win.unmount()
})

test('submit failure shows the stderr as a broken line and does not claim success', async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: 'terminal', cwd: '/work/repo' })
  await $.command.run({ command: 'rt-room', args: ROOM })
  const win = await mount($)
  await win.input({ key: 'say', text: '下一句' })
  await win.unmount()
  expect(w.runs.length).toBe(1)
  expect(w.runs[0].argv[0]).toBe('node')
  expect(w.runs[0].argv.join(' ')).toContain('scripts/roundtable-window.js')
  expect(w.runs[0].argv).toContain('send')
  expect(w.runs[0].argv).toContain(ROOM)
  expect(w.runs[0].argv).toContain('下一句')
  const again = await mount($)
  const tree = (await again.drawn()) as Node
  expect(textOf(tree)).toContain('boom-fail')
  const fail = find(tree, 'Text').find(t => textOf(t).includes('boom-fail'))
  expect(fail?.props?.color).toBe(PALETTE.broken)
  expect(textOf(tree)).not.toContain('已送出')
  await again.unmount()
})
