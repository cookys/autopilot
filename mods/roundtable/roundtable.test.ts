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
  throwRun: boolean
  exitCode: number
  stderr: string
}

function world(on: On): World {
  const w: World = {
    files: { [LOG]: LOG_TEXT }, env: { HOME: '/home/u', AUTOPILOT_ROOMS_DIR: ROOMS, AUTOPILOT_LOCALE: 'zh-TW' },
    opens: [], runs: [], invalidates: 0, logs: [], commands: [], tools: [], live: 0, chain: 0, throwRt: false, throwRun: false,
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
    if (w.throwRun) throw new Error('runner-blew')
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
  expect(w.runs[0].argv).toContain('--')
  expect(w.runs[0].argv.indexOf('send')).toBeLessThan(w.runs[0].argv.indexOf('--'))
  expect(w.runs[0].argv.indexOf('--')).toBeLessThan(w.runs[0].argv.indexOf(ROOM))
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

async function draftValue($: any): Promise<{ value: string; tree: Node }> {
  const win = await mount($)
  const tree = (await win.drawn()) as Node
  const inputs = find(tree, 'Input')
  const value = String(inputs[0]?.props?.value ?? '')
  await win.unmount()
  return { value, tree }
}

// # RED at 11ff68c0f: non-zero and thrown sends left Input value "" (expected "keep-me" / "keep-throw") because submitSay cleared state.draft before the run.
test('a non-zero send keeps the submitted draft and shows the failure', async ($, on) => {
  const w = world(on)
  w.exitCode = 3
  w.stderr = 'seat-down\n'
  await $.session.start({ surface: 'terminal', cwd: '/work/repo' })
  await $.command.run({ command: 'rt-room', args: ROOM })
  const win = await mount($)
  const before = w.invalidates
  await win.input({ key: 'say', text: 'keep-me' })
  await win.unmount()
  expect(w.runs.length).toBe(1)
  expect(w.invalidates).toBeGreaterThan(before)
  const { value, tree } = await draftValue($)
  expect(value).toBe('keep-me')
  expect(textOf(tree)).toContain('seat-down')
  const fail = find(tree, 'Text').find(t => textOf(t).includes('seat-down'))
  expect(fail?.props?.color).toBe(PALETTE.broken)
})

test('a thrown send keeps the submitted draft and shows the failure', async ($, on) => {
  const w = world(on)
  w.throwRun = true
  await $.session.start({ surface: 'terminal', cwd: '/work/repo' })
  await $.command.run({ command: 'rt-room', args: ROOM })
  const win = await mount($)
  await win.input({ key: 'say', text: 'keep-throw' })
  await win.unmount()
  expect(w.runs.length).toBe(1)
  const { value, tree } = await draftValue($)
  expect(value).toBe('keep-throw')
  expect(textOf(tree)).toContain('process.run')
  const fail = find(tree, 'Text').find(t => textOf(t).includes('process.run'))
  expect(fail?.props?.color).toBe(PALETTE.broken)
})

test('a successful send clears the draft', async ($, on) => {
  const w = world(on)
  w.exitCode = 0
  w.stderr = ''
  await $.session.start({ surface: 'terminal', cwd: '/work/repo' })
  await $.command.run({ command: 'rt-room', args: ROOM })
  const win = await mount($)
  await win.input({ key: 'say', text: 'sent-ok' })
  await win.unmount()
  expect(w.runs.length).toBe(1)
  expect(w.runs[0].exitCode).toBe(0)
  const { value } = await draftValue($)
  expect(value).toBe('')
})

test('empty text and no room clear the draft and do not send', async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: 'terminal', cwd: '/work/repo' })
  const bare = await mount($)
  await bare.input({ key: 'say', text: '   ' })
  await bare.unmount()
  expect(w.runs.length).toBe(0)
  expect((await draftValue($)).value).toBe('')
  const noroom = await mount($)
  await noroom.input({ key: 'say', text: 'orphan' })
  await noroom.unmount()
  expect(w.runs.length).toBe(0)
  expect((await draftValue($)).value).toBe('')
})

// ---- chat-room layout: the control area (failure row + Say field) is fixed at the bottom; the log is bottom-anchored; scroll state is the first content row ----
const longLog = (n: number) => Array.from({ length: n }, (_, i) => one({ seq: i + 1, from: i % 2 === 0 ? 'owner' : 'cuda', kind: 'say', text: '第 ' + (i + 1) + ' 則發言' })).join('\n') + '\n'
const frameOf = (tree: Node) => {
  const fixed = ((tree.children || []) as Node[]).find(k => k.props?.key === 'fixed') as Node
  const kids = (fixed.children || []) as Node[]
  const ci = kids.findIndex(k => k.props?.key === 'content')
  const own = ((((kids[ci].children || []) as Node[]).find(k => k.props?.key === 'rows') as Node).children || []) as Node[]
  const rows = own.flatMap(r => (r.props?.key === 'pad' ? Array.from({ length: Number(r.props?.height) }, () => ({ ...r, children: [] })) : [r])) // the pad Box is `height` blank rows
  // the screen row of the Say field: rows above the content, the content rows drawn, the rule, the failure row
  const bar = ((kids[ci].children || []) as Node[]).find(k => k.props?.key === 'scrollbar')
  const thumb = ((bar?.children || []) as Node[]).map(textOf).join('') // the scrollbar column top to bottom: █ is the thumb
  return { thumb, texts: rows.map(textOf), keys: rows.map(r => String(r.props?.key ?? '')), sayAt: ci + rows.length + 2, below: kids.length - ci - 2 }
}
async function shape($: any, key: string | null, bodyRows = 24, cols = 80) {
  const props = { ...PANE_PROPS, bodyColumns: cols, scroll: { offset: 0, bodyRows } }
  const m = () => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-roundtable', props, viewport: { columns: 120, rows: 40, isFullscreen: true } })
  if (key !== null) { const p = await m(); await p.press({ key }); await p.unmount() }
  const win = await m()
  const tree = (await win.drawn()) as Node
  await win.unmount()
  return frameOf(tree)
}
async function open($: any, on: On, log: string) {
  const w = world(on)
  w.files[LOG] = log
  await $.session.start({ surface: 'terminal', cwd: '/work/repo' })
  await $.command.run({ command: 'rt-room', args: ROOM })
  return w
}

test('CHAT roundtable: a short log is bottom-anchored (blank rows at the top, the newest row right above the rule)', async ($, on) => {
  await open($, on, longLog(3))
  const s = await shape($, null)
  expect(s.keys[0]).toMatch(/^pad/)
  expect(s.texts[0].trim()).toBe('')
  expect(s.texts[s.texts.length - 1]).toContain('第 3 則發言')
  expect(s.texts.join('\n')).not.toContain('上方還有')
})

test('CHAT roundtable: overflow keeps the Say field on one screen row while scrolling up, down and End; the hint is the first content row', async ($, on) => {
  await open($, on, longLog(40))
  const bottom = await shape($, null)
  expect(bottom.texts[bottom.texts.length - 1]).toContain('第 40 則發言')
  expect(bottom.texts[0].trim()).toMatch(/^上方還有 \d+ 行$/)
  const top = await shape($, 'sbj0')
  expect(top.texts.join('\n')).toContain('第 1 則發言')
  expect(top.texts[0].trim(), 'nothing above at the top').toBe('')
  const mid = await shape($, 'sbj10')
  expect(mid.texts[0].trim()).toMatch(/^上方還有 \d+ 行$/)
  expect(mid.texts.join('\n')).not.toContain('第 40 則發言')
  const end = await shape($, 'sbj19')
  expect(end.texts.join('\n')).toContain('第 40 則發言')
  for (const s of [bottom, top, mid, end]) {
    expect(s.sayAt, 'the Say field never changes its screen row').toBe(bottom.sayAt)
    expect(s.below, 'the control area keeps its height').toBe(bottom.below)
  }
})

test('CHAT roundtable: rows appended while scrolled up show the new-messages line and do not move the view; the line returns to the bottom; at the bottom the view follows', async ($, on) => {
  const w = await open($, on, longLog(40))
  const top = await shape($, 'sbj0')
  expect(top.texts.join('\n')).not.toContain('有新訊息')
  w.files[LOG] = longLog(46)
  await $.command.run({ command: 'rt-room', args: ROOM })
  const still = await shape($, null)
  expect(still.texts[still.texts.length - 1].trim(), 'the row just above the control area').toBe('有新訊息 ↓')
  expect(still.texts[1], 'the first content row of the view did not move').toBe(top.texts[1])
  expect(still.sayAt).toBe(top.sayAt)
  expect(still.below).toBe(top.below)
  const back = await shape($, 'newerb')
  expect(back.texts.join('\n')).toContain('第 46 則發言')
  expect(back.texts.join('\n')).not.toContain('有新訊息')
  w.files[LOG] = longLog(50)
  await $.command.run({ command: 'rt-room', args: ROOM })
  const followed = await shape($, null)
  expect(followed.texts[followed.texts.length - 1]).toContain('第 50 則發言')
  expect(followed.texts.join('\n'), 'a view at the bottom never shows the line').not.toContain('有新訊息')
})

test('CHAT roundtable: a send failure uses its reserved row (the control area keeps its height) and a resize keeps the bottom anchor', async ($, on) => {
  const w = await open($, on, longLog(40))
  const before = await shape($, null)
  w.exitCode = 3
  w.stderr = 'seat-down\n'
  const win = await mount($)
  await win.input({ key: 'say', text: 'x' })
  await win.unmount()
  const after = await shape($, null)
  expect(after.below).toBe(before.below)
  expect(after.sayAt).toBe(before.sayAt)
  expect(after.texts).toEqual(before.texts)
  const small = await shape($, null, 12)
  expect(small.texts[small.texts.length - 1], 'still at the newest row after the pane got shorter').toContain('第 40 則發言')
  expect(small.below).toBe(before.below)
})

test('CHAT roundtable: the thumb is flush with the top at Home and flush with the bottom of the track at End', async ($, on) => {
  await open($, on, longLog(40))
  const end = await shape($, null)
  expect(end.thumb.endsWith('█'), 'bottom position: the thumb reaches the last track cell').toBe(true)
  const top = await shape($, 'sbj0')
  expect(top.thumb.startsWith('█')).toBe(true)
})

const wideLog = (n: number) => Array.from({ length: n }, (_, i) => one({ seq: i + 1, from: 'owner', kind: 'say', text: 'm' + (i + 1) + ' ' + 'x'.repeat(100) })).join('\n') + '\n'
test('CHAT roundtable: narrowing the pane while scrolled up re-wraps rows but never says new messages; while following it stays at the bottom', async ($, on) => {
  await open($, on, wideLog(40))
  const wide = await shape($, 'sbj0', 24, 120)
  expect(wide.texts.join('\n')).not.toContain('有新訊息')
  const narrow = await shape($, null, 24, 40)
  expect(narrow.texts.join('\n'), 'a width change is not an appended message').not.toContain('有新訊息')
  const again = await shape($, null, 24, 120)
  expect(again.texts.join('\n')).not.toContain('有新訊息')
  const end = await shape($, 'sbj19', 24, 120)
  expect(end.texts[end.texts.length - 1]).toContain('m40 ')
  const follow = await shape($, null, 24, 40)
  expect(follow.texts[follow.texts.length - 1], 'following: still at the newest row after narrowing').toMatch(/^\s*x+$/)
  expect(follow.texts.join('\n')).not.toContain('有新訊息')
})

test('CHAT roundtable: a stale new-messages line is cleared when the message count drops while still scrolled up', async ($, on) => {
  const w = await open($, on, longLog(40))
  await shape($, 'sbj0')
  w.files[LOG] = longLog(46)
  await $.command.run({ command: 'rt-room', args: ROOM })
  const set = await shape($, null)
  expect(set.texts.join('\n')).toContain('有新訊息')
  w.files[LOG] = longLog(43)
  await $.command.run({ command: 'rt-room', args: ROOM })
  const after = await shape($, null)
  expect(after.texts.join('\n'), 'fewer messages than before: no stale line').not.toContain('有新訊息')
  expect(after.texts[0].trim()).toBe('')
})

test('CHAT roundtable: switching to another room resets the view: no new-messages line, and the new room opens at its newest message', async ($, on) => {
  const w = await open($, on, longLog(40))
  await shape($, 'sbj0')
  w.files[ROOMS + '/other/room.jsonl'] = longLog(60)
  await $.command.run({ command: 'rt-room', args: 'other' })
  const b = await shape($, null)
  expect(b.texts.join('\n')).not.toContain('有新訊息')
  expect(b.texts[b.texts.length - 1], 'opens at the newest message').toContain('第 60 則發言')
})
