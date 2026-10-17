// mods/viewer/viewer.test.ts — the viewer mod through the engine: the `show` tool, the /show command and the window it opens.
// Run through `bash mods/viewer/run-tests.sh` (a wrapper plugin named `autopilot` whose hooks module is mods/viewer/register.ts).
//
// The claim these cases protect: what reaches the MODEL is one short line, never the text. Each case that shows a file has a marker string in the file and asserts the model-side
// text (the tool result, the command result) does not carry it. Negative control (run by hand, recorded in the commit): make summaryOfFile / summaryOfDiff return the text -> the
// "model never reads the text" cases turn red.
import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { currentView, reopenWindow, show } from './show'

const CWD = '/work/repo'
const TOOL = 'mcp__autopilot__show'
const MARK = 'SECRET-MARKER-91c7'

type World = {
  files: Record<string, string>
  sizes: Record<string, number>
  opens: { id: string; title?: string; focus?: true; closeOnEscape?: true; holdToasts?: true; rows?: number; columns?: number }[]
  closes: string[]
  toasts: string[]
  runs: string[][]
  placed: boolean
  registered: { name: string; description: string; inputSchema?: Record<string, unknown> }[]
  diff: { exitCode: number; stdout: string; stderr: string }
  env: Record<string, string>
  live: number // clock.every calls: the live mod's timer
  chain: number // times the engine's own session.start was reached (next(e) called)
  throwRegister: boolean
}

function world(on: On, files: Record<string, string> = {}, locale: 'en' | 'zh-TW' = 'en'): World {
  const w: World = { files, sizes: {}, opens: [], closes: [], toasts: [], runs: [], placed: true, registered: [], diff: { exitCode: 0, stdout: '', stderr: '' }, env: { AUTOPILOT_LOCALE: locale, HOME: '/home/u' }, live: 0, chain: 0, throwRegister: false }
  on('env.get', ($, e) => ({ value: w.env[e.name] }))
  on('fs.read', ($, e) => {
    const t = w.files[e.path]
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: t }
  })
  on('fs.stat', ($, e) => {
    const t = w.files[e.path]
    if (t === undefined && e.path === CWD + '/src') return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: { kind: 'file' as const, size: w.sizes[e.path] ?? t.length, mtimeMs: 0, isLink: false } }
  })
  on('config.list', () => ({ value: [] }))
  on('clock.every', () => { w.live += 1; return { value: { cancel: () => {} } } })
  on('session.cwd', () => ({ value: CWD }))
  on('session.start', () => { w.chain += 1; return { cwd: CWD } })
  on('tool.register', ($, e) => { if (w.throwRegister) throw new Error('registration refused'); w.registered.push(e as never); return { value: { tool: 'mcp__autopilot__' + e.name } } })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', ($, e) => {
    w.opens.push({ id: e.id, title: e.title, focus: e.focus, closeOnEscape: e.closeOnEscape, holdToasts: e.holdToasts, rows: e.rows, columns: e.columns })
    return { value: w.placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'unasked below 144 columns' } }
  })
  on('ui.close', ($, e) => { w.closes.push(e.id); return { value: undefined } })
  on('process.run', ($, e) => { w.runs.push([...e.argv]); return { value: { ...w.diff, isStdoutTruncated: false, isStderrTruncated: false } } })
  return w
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: Node): string => (n.children || []).map(c => (typeof c === 'string' ? c : textOf(c as Node))).join('')
function find(n: Node, type: string, out: Node[] = []): Node[] {
  if (n.type === type) out.push(n)
  for (const c of n.children || []) if (typeof c !== 'string') find(c as Node, type, out)
  return out
}
const PANE_PROPS = { title: 'x', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: { agentId: undefined } }
const mountWindow = ($: any, surface = 'terminal') => $.ui.mount({ plugin: 'autopilot', surface, component: 'Pane', requestId: 'autopilot-viewer', props: PANE_PROPS, viewport: { columns: 120, rows: 40, isFullscreen: true } })
// what the model reads: the answered text, or the refusal's text (a failure is a deny: the model gets it as an error result)
const call = async ($: any, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => {
  const r = await $.tool.call({ tool: TOOL, ...input })
  return r.deny !== undefined ? { text: String(r.deny), isError: true } : { text: String(r.result), isError: false }
}

const FILE = ['first line', 'second ' + MARK, 'third line', ''].join('\n')

test('show path: the model reads one line with the path and the line numbers, never the text; the window opens as a dialog', async ($, on) => {
  const w = world(on, { [CWD + '/notes.md']: FILE })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  const r = await call($, { path: 'notes.md' })
  expect(r.isError).not.toBe(true)
  expect(r.text).toContain('notes.md')
  expect(r.text).toContain('lines 1-3 of 3')
  expect(r.text).not.toContain(MARK)
  expect(r.text).not.toContain('second')
  expect(r.text.length).toBeLessThan(400)
  expect(w.opens).toEqual([{ id: 'autopilot-viewer', title: 'notes.md', focus: true, closeOnEscape: true, holdToasts: true, rows: 30, columns: 100 }])
})

test('show path: the window draws the file with line numbers from the first line shown, highlighted by its path', async ($, on) => {
  world(on, { [CWD + '/src/a.ts']: 'const a = 1\nconst b = "' + MARK + '"\nconst c = 3\n' })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await call($, { path: 'src/a.ts', start: 2, end: 3 })
  const win = await mountWindow($)
  const tree = (await win.drawn()) as Node
  const code = find(tree, 'Code')
  expect(code.length).toBe(1)
  expect(code[0].props?.source).toBe('const b = "' + MARK + '"\nconst c = 3')
  expect(code[0].props?.startLine).toBe(2)
  expect(code[0].props?.path).toBe('src/a.ts')
  expect(textOf(tree)).toContain('src/a.ts') // the path is the window's first line (a lone pane draws no title row)
  expect(textOf(tree)).toContain('lines 2 to 3 of 3')
  await win.unmount()
})

test('show path: a range past the end is clamped; the line count is the file\'s', async ($, on) => {
  world(on, { [CWD + '/n.txt']: 'a\nb\nc\n' })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  const r = await call($, { path: 'n.txt', start: 2, end: 99 })
  expect(r.text).toContain('lines 2-3 of 3')
})

test('show path: an empty file, a missing file, a directory, a binary file and an oversize file each answer with a reason and no text', async ($, on) => {
  const w = world(on, { [CWD + '/empty.txt']: '', [CWD + '/bin.dat']: 'a\u0000' + MARK, [CWD + '/big.txt']: MARK })
  w.sizes[CWD + '/big.txt'] = 5 * 1024 * 1024
  await $.session.start({ surface: 'terminal', cwd: CWD })
  const empty = await call($, { path: 'empty.txt' })
  expect(empty.isError).not.toBe(true)
  expect(empty.text).toContain('empty')
  for (const [input, why] of [[{ path: 'nope.txt' }, 'cannot read nope.txt'], [{ path: 'src' }, 'is not a file'], [{ path: 'bin.dat' }, 'looks binary'], [{ path: 'big.txt' }, '4 MiB']] as const) {
    const r = await call($, input)
    expect(r.isError, JSON.stringify(input)).toBe(true)
    expect(r.text).toContain('show failed')
    expect(r.text).toContain(why)
    expect(r.text).not.toContain(MARK)
  }
  expect(w.closes.length).toBe(0) // a tool call opens only after it has read: a failed one never flashed a window
})

test('show input: exactly one of path and diff; bad lines are refused before anything is read', async ($, on) => {
  const w = world(on, { [CWD + '/a.txt']: 'x' })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  for (const input of [{}, { path: 'a.txt', diff: ['HEAD'] }, { path: 'a.txt', start: 0 }, { path: 'a.txt', start: 3, end: 2 }, { diff: ['HEAD'], start: 1 }, { path: '' }]) {
    const r = await call($, input)
    expect(r.isError, JSON.stringify(input)).toBe(true)
  }
  expect(w.opens.length).toBe(0)
  expect(w.runs.length).toBe(0)
})

const DIFF = [
  'diff --git a/a.ts b/a.ts', 'index 1..2 100644', '--- a/a.ts', '+++ b/a.ts',
  '@@ -1,2 +1,2 @@', ' keep', '-old ' + MARK, '+new ' + MARK,
  'diff --git a/b.ts b/b.ts', 'index 3..4 100644', '--- a/b.ts', '+++ b/b.ts',
  '@@ -5,1 +5,2 @@', ' ctx', '+added', '',
].join('\n')

test('show diff: git runs by argument vector with fixed options; the model reads the counts, never the diff; the window draws it as a diff', async ($, on) => {
  const w = world(on)
  w.diff = { exitCode: 0, stdout: DIFF, stderr: '' }
  await $.session.start({ surface: 'terminal', cwd: CWD })
  const r = await call($, { diff: ['HEAD~1', '--', 'src'] })
  expect(w.runs).toEqual([['git', '--no-pager', 'diff', '--no-color', 'HEAD~1', '--no-ext-diff', '--no-textconv', '--', 'src']])
  expect(r.isError).not.toBe(true)
  expect(r.text).toContain('2 files, 2 hunks')
  expect(r.text).not.toContain(MARK)
  expect(r.text).not.toContain('added')
  expect(w.opens[0].title).toBe('git diff HEAD~1 -- src')
  const win = await mountWindow($)
  const tree = (await win.drawn()) as Node
  const codes = find(tree, 'Code')
  expect(codes.map(c => c.props?.format)).toEqual(['diff', 'diff'])
  expect(codes[0].props?.source).toContain('-old ' + MARK)
  expect(String(codes[0].props?.source).startsWith('@@')).toBe(true) // the file header lines are not part of the hunks
  expect(textOf(tree)).toContain('a.ts')
  expect(textOf(tree)).toContain('b.ts')
  await win.unmount()
})

test('show diff: an option that writes a file or runs a program is refused and git never runs; a failing git is a reason', async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: 'terminal', cwd: CWD })
  for (const bad of ['--output=/tmp/x', '--outp', '--ext-diff', '--ext', '--textconv', '--textc', '-O', '--no-index', '--open', '--open-files-in-pager']) {
    const r = await call($, { diff: ['HEAD', bad] })
    expect(r.isError, bad).toBe(true)
  }
  expect(w.runs.length).toBe(0)
  w.diff = { exitCode: 128, stdout: '', stderr: 'fatal: bad revision \'nope\'\nmore' }
  const r = await call($, { diff: ['nope'] })
  expect(r.isError).toBe(true)
  expect(r.text).toContain('git diff failed: fatal: bad revision')
  w.diff = { exitCode: 0, stdout: '', stderr: '' }
  const same = await call($, { diff: ['HEAD'] })
  expect(same.isError).not.toBe(true)
  expect(same.text).toContain('empty')
})

test('placement: a window the engine leaves undrawn (a narrow terminal) tells the model and the owner how to open it', async ($, on) => {
  const w = world(on, { [CWD + '/notes.md']: FILE })
  w.placed = false
  await $.session.start({ surface: 'terminal', cwd: CWD })
  const r = await call($, { path: 'notes.md' })
  expect(r.isError).not.toBe(true)
  expect(r.text).toContain('/show')
  expect(r.text).not.toContain(MARK)
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('/show')
  // /show with nothing after it draws the last window again, as the owner's own open
  w.placed = true
  await $.command.run({ command: 'show', args: '' })
  expect(w.opens.length).toBe(2)
  expect(w.opens[1].title).toBe('notes.md')
})

test('the /show command opens the window and answers no text, so nothing of it reaches the model', async ($, on) => {
  const w = world(on, { [CWD + '/notes.md']: FILE })
  w.diff = { exitCode: 0, stdout: DIFF, stderr: '' }
  await $.session.start({ surface: 'terminal', cwd: CWD })
  const a = await $.command.run({ command: 'show', args: 'notes.md:2' })
  expect(a.text).toBeUndefined()
  const b = await $.command.run({ command: 'show', args: 'diff HEAD~1 -- a.ts' })
  expect(b.text).toBeUndefined()
  expect(w.opens.map(o => o.title)).toEqual(['notes.md', 'git diff HEAD~1 -- a.ts'])
  const win = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-viewer', props: PANE_PROPS, viewport: { columns: 120, rows: 40, isFullscreen: true } })
  await win.unmount()
  // a failure is a toast, not a transcript line
  const c = await $.command.run({ command: 'show', args: 'missing.md' })
  expect(c.text).toBeUndefined()
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('cannot read missing.md')
  // nothing to show yet: the last window is gone in a fresh test, so a bare /show with no history says so
})

test('/show with a range: path:line starts the window at that line', async ($, on) => {
  const w = world(on, { [CWD + '/n.txt']: 'l1\nl2\nl3\nl4\n' })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'n.txt:3' })
  expect(w.opens.length).toBe(1)
  const win = await mountWindow($)
  const code = find((await win.drawn()) as Node, 'Code')
  expect(code[0].props?.source).toBe('l3\nl4')
  expect(code[0].props?.startLine).toBe(3)
  await win.unmount()
})

test('a long file is shown in parts: the first part says which lines, the next-part button moves on and the previous one comes back', async ($, on) => {
  const long = Array.from({ length: 5000 }, (_, i) => 'row ' + (i + 1)).join('\n') + '\n'
  world(on, { [CWD + '/long.txt']: long })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  const r = await call($, { path: 'long.txt' })
  const m = /lines 1-(\d+) of 5000/.exec(r.text)
  expect(m).not.toBeNull()
  const last = Number((m as RegExpExecArray)[1])
  expect(last).toBeLessThanOrEqual(2000)
  let win = await mountWindow($)
  const code = (n: Node) => find(n, 'Code')[0]
  // the window draws only the rows that fit (the frame cuts the part into rows itself); it starts at the part's first line and is shorter than the part
  const firstWindow = code((await win.drawn()) as Node)
  expect(firstWindow.props?.startLine).toBe(1)
  expect(String(firstWindow.props?.source).split('\n').length).toBeLessThan(last)
  expect(String(firstWindow.props?.source).startsWith('row 1\n')).toBe(true)
  await win.press({ key: 'next part' })
  await win.unmount()
  win = await mountWindow($) // the engine draws the pane again after the press (ui.invalidate); the mock does not
  const second = code((await win.drawn()) as Node)
  expect(second.props?.startLine).toBe(last + 1)
  expect(String(second.props?.source).startsWith('row ' + (last + 1))).toBe(true)
  await win.press({ key: 'previous part' })
  await win.unmount()
  win = await mountWindow($)
  expect(code((await win.drawn()) as Node).props?.startLine).toBe(1)
  await win.unmount()
})

test('words: the window speaks zh-TW when the locale says so', async ($, on) => {
  world(on, { [CWD + '/notes.md']: FILE }, 'zh-TW')
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await call($, { path: 'notes.md', start: 2 })
  const win = await mountWindow($)
  const text = textOf((await win.drawn()) as Node)
  expect(text).toContain('第 2 到 3 行，共 3 行')
  expect(text).toContain('Esc 關閉')
  await win.unmount()
})

test('the tool says in its description that the content is shown to the user only and is not returned', async ($, on) => {
  const w = world(on, {})
  await $.session.start({ surface: 'terminal', cwd: CWD })
  expect(w.registered.length).toBe(1)
  const s = w.registered[0] as unknown as { name: string; description: string; inputSchema: { properties: Record<string, unknown> } }
  expect(s.name).toBe('show')
  expect(s.description).toMatch(/NOT returned to you/)
  expect(s.description).toMatch(/read the file/i)
  expect(Object.keys(s.inputSchema.properties).sort()).toEqual(['diff', 'end', 'path', 'start'])
})

test('session start: a viewer registration that fails does not stop the live mod or the chain (negative control: start the viewer first, uncaught, and this goes red)', async ($, on) => {
  const w = world(on)
  w.throwRegister = true
  await $.session.start({ surface: 'terminal', cwd: CWD })
  expect(w.live, 'the live mod started').toBe(1)
  expect(w.chain, 'next(e) was called: the engine\'s own session.start ran').toBeGreaterThan(0)
  expect(w.registered.length).toBe(0)
})

test('a press-opened window that fails puts the previous window back (what a bare /show reopens is A, not the failed B)', async (_$, _on) => {
  // the module is driven directly with a small stand-in engine: its module state is the test file's own copy, and `show` is what a live press calls
  const files: Record<string, string> = { [CWD + '/a.md']: 'alpha\n', [CWD + '/bin.dat']: 'x\u0000y' }
  const opens: string[] = []
  let closes = 0
  const $ = {
    env: { get: async () => undefined },
    fs: {
      read: async (p: string) => { if (files[p] === undefined) throw new Error('ENOENT'); return files[p] },
      stat: async (p: string) => { if (files[p] === undefined) throw new Error('ENOENT'); return { kind: 'file', size: files[p].length, mtimeMs: 0, isLink: false } },
    },
    config: { list: async () => [] },
    session: { cwd: async () => CWD },
    ui: { invalidate: () => {}, toast: () => {}, open: async (a: { title: string }) => { opens.push(a.title); return { isPlaced: true } }, close: async () => { closes += 1 } },
  } as never
  expect((await show($, { kind: 'path', path: 'a.md', start: null, end: null }, { openFirst: true })).ok).toBe(true)
  for (const bad of ['missing.md', 'bin.dat']) {
    expect((await show($, { kind: 'path', path: bad, start: null, end: null }, { openFirst: true })).ok, bad).toBe(false)
    expect(currentView()?.title, 'after failed ' + bad).toBe('a.md')
    expect(currentView()?.shown.kind).toBe('file')
  }
  expect(closes).toBe(2)
  expect(await reopenWindow($)).toBe(true)
  expect(opens[opens.length - 1]).toBe('a.md')
})

// ---- the scrolling window (design plan §12.10): the head, a scrolling content, a rule and a fixed action strip ----
const fixedKids = (tree: Node): Node[] => ((((tree.children || []) as Node[]).find(k => k.props?.key === 'fixed')?.children || []) as Node[])
test('SCROLL viewer: the AI buttons sit in the fixed strip under a rule, the scrollbar shows with the thumb at the top, and the count line reads the range on screen', async ($, on) => {
  const long = Array.from({ length: 300 }, (_, i) => 'row ' + (i + 1)).join('\n') + '\n'
  world(on, { [CWD + '/long.txt']: long })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await call($, { path: 'long.txt' })
  const win = await mountWindow($)
  const tree = (await win.drawn()) as Node
  const kids = fixedKids(tree)
  expect(kids.length, 'a frame was drawn').toBeGreaterThan(0)
  const ruleAt = kids.findIndex(k => /^─+$/.test(textOf(k)))
  expect(ruleAt).toBeGreaterThan(0)
  const strip = kids.slice(ruleAt + 1)
  const stripText = strip.map(textOf).join('\n')
  for (const label of ['[ summary ]', '[ ask ]', '[ send to chat ]']) expect(stripText, label).toContain(label)
  const content = kids.find(k => k.props?.key === 'content') as Node
  expect(textOf(content), 'no button inside the scrolling rows').not.toContain('[ ')
  const bar = ((content.children || []) as Node[]).find(k => k.props?.key === 'scrollbar') as Node
  expect(textOf(((bar.children || []) as Node[])[0])).toBe('█')
  expect(textOf(kids[1]), 'the count line is the second head row and names the range').toMatch(/^lines 1 to \d+ of 300$/)
  await win.unmount()
})
