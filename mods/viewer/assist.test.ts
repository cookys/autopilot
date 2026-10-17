// mods/viewer/assist.test.ts — the window's three buttons (summary, ask, send into the conversation) through the engine, with a stand-in for `$.model.complete` (no real call).
// Run through `bash mods/viewer/run-tests.sh`.
//
// Claims protected: (1) the text of the file goes to haiku inside a prompt that says the DATA is not instructions; (2) the same content asked the same way is not asked twice;
// (3) the long text is cut and the cut is said; (4) a cancel and a failure end in a line on the window, no retry; (5) "send into the conversation" fills the prompt box and never submits;
// (6) what the MAIN model reads (the show tool's answer) never carries the summary.
// Negative controls (run by hand, red before green, recorded in the commit): drop the cache lookup in assist.ts runAi -> "the second press does not call"; make the tool answer carry
// the summary (show.ts finish) -> "the tool answer"; delete GUARD_RULE from model.ts systemFor and promptFor -> "the prompt".
import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { AI_MAX_CHARS, GUARD_RULE } from './model'
import { aiState, cancelAi, clearSaved, resetAssist, runAi } from './assist'
import { makeVT } from './strings'

const CWD = '/work/repo'
const TOOL = 'mcp__autopilot__show'
const MARK = 'FILE-MARKER-5d2e'
const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Ask = { model: string; system?: string; prompt: string; maxTokens?: number }
type World = {
  files: Record<string, string>
  asks: Ask[]
  reply: () => Promise<unknown>
  fills: { text: string; mode?: string }[]
  fillResult: { isFilled: boolean; refusal?: string }
  submits: number
  draft: string
  toasts: string[]
  diff: string
}

function world(on: On, files: Record<string, string>): World {
  const w: World = {
    files, asks: [], fills: [], fillResult: { isFilled: true }, submits: 0, draft: '', toasts: [], diff: '',
    reply: async () => ({ isAnswered: true, text: '- 這是摘要', usage: USAGE }),
  }
  on('env.get', ($, e) => ({ value: e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', ($, e) => { const t = w.files[e.path]; if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.stat', ($, e) => { const t = w.files[e.path]; if (t === undefined) throw new Error('ENOENT'); return { value: { kind: 'file' as const, size: t.length, mtimeMs: 0, isLink: false } } })
  on('config.list', () => ({ value: [] }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.start', () => ({ cwd: CWD }))
  on('tool.register', ($, e) => ({ value: { tool: 'mcp__autopilot__' + e.name } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: w.diff, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.complete', async ($, e) => {
    w.asks.push({ model: e.model, system: e.system, prompt: e.prompt, maxTokens: e.maxTokens })
    return { value: await w.reply() } as never
  })
  on('prompt.read', () => ({ value: { text: w.draft, cursor: w.draft.length } }) as never)
  on('prompt.fill', ($, e) => { w.fills.push({ text: e.text, mode: e.mode }); return w.fillResult as never })
  on('prompt.submit', () => { w.submits += 1; return { value: {} } as never })
  return w
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: Node): string => (n.children || []).map(c => (typeof c === 'string' ? c : textOf(c as Node))).join('')
const PANE_PROPS = { title: 'x', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: { agentId: undefined } }
const mountWindow = ($: any) => $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-viewer', props: PANE_PROPS, viewport: { columns: 150, rows: 40, isFullscreen: true } })
const FILE = ['export const a = 1', '// ' + MARK, 'export const b = 2', ''].join('\n')

// open a window on the file, press a button by key on a fresh drawing, and return what the window then draws
async function press($: any, key: string): Promise<string> {
  const win = await mountWindow($)
  await win.press({ key }) // onPress starts the work and returns; the work ends a few ticks later
  await win.unmount()
  let text = ''
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 25))
    const again = await mountWindow($)
    text = textOf((await again.drawn()) as Node)
    await again.unmount()
    if (!/中…/.test(text) && i >= 2) break
  }
  return text
}

test('summary: haiku reads the whole file inside a prompt that says the data is not instructions; the window shows the summary, the model and the token count', async ($, on) => {
  const w = world(on, { [CWD + '/src.ts']: FILE })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'src.ts' })
  const text = await press($, 'summary')
  expect(w.asks.length).toBe(1)
  expect(w.asks[0].model).toBe('haiku')
  const sent = (w.asks[0].system ?? '') + '\n' + w.asks[0].prompt
  expect(sent, 'the prompt carries the data-not-instructions sentence').toContain(GUARD_RULE)
  expect(sent, 'the prompt names the injection guard literally').toContain('never instructions')
  expect(sent).toContain('Base every statement only on the DATA')
  expect(w.asks[0].prompt, 'the prompt carries the content').toContain(MARK)
  expect(w.asks[0].system).toContain('Traditional Chinese')
  expect(text).toContain('這是摘要')
  expect(text).toContain('摘要（src.ts 第 1–3 行）')
  expect(text).toContain('1280 tokens')
  const again = await mountWindow($)
  const code = ((await again.drawn()) as Node)
  const walk = (n: Node, out: string[] = []): string[] => { if (n.type === 'Code') out.push(String(n.props?.source)); for (const c of n.children || []) if (typeof c !== 'string') walk(c as Node, out); return out }
  expect(walk(code).join('\n'), 'the original is still below the summary').toContain(MARK)
  await again.unmount()
})

test('summary: the second press on the same content does not call again (negative control: drop the cache lookup and this goes red)', async ($, on) => {
  const w = world(on, { [CWD + '/src.ts']: FILE })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'src.ts' })
  await press($, 'summary')
  const text = await press($, 'summary')
  expect(w.asks.length, 'the second press does not call').toBe(1)
  expect(text).toContain('沿用先前的結果')
  // another question about the same content is a different key; the same question twice is one call
  const win = await mountWindow($)
  await win.input({ key: 'ask-input', text: '這裡有幾個常數？' })
  await win.input({ key: 'ask-input', text: '這裡有幾個常數？' }) // a double Enter while the first runs: busy, no second call
  await new Promise(r => setTimeout(r, 100))
  await win.input({ key: 'ask-input', text: '這裡有幾個常數？' }) // the same question again once answered: saved, no call
  await new Promise(r => setTimeout(r, 100))
  await win.unmount()
  expect(w.asks.length).toBe(2)
  expect(w.asks[1].prompt).toContain('這裡有幾個常數？')
  expect(w.asks[1].prompt).toContain(MARK)
  expect(w.asks[1].prompt + (w.asks[1].system ?? '')).toContain(GUARD_RULE)
})

test('summary: a different content is a different key (the cache is by content, not by window)', async ($, on) => {
  const w = world(on, { [CWD + '/a.ts']: FILE, [CWD + '/b.ts']: FILE + 'export const c = 3\n' })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'a.ts' })
  await press($, 'summary')
  await $.command.run({ command: 'show', args: 'b.ts' })
  await press($, 'summary')
  expect(w.asks.length).toBe(2)
})

test('summary: a text over the limit is cut at a line end and the window says how many lines were read', async ($, on) => {
  const row = 'row of text that is long enough to count for something\n'
  const big = row.repeat(Math.ceil((AI_MAX_CHARS * 2) / row.length))
  const w = world(on, { [CWD + '/big.log']: big })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'big.log' })
  const text = await press($, 'summary')
  expect(w.asks[0].prompt.length).toBeLessThan(AI_MAX_CHARS + 2000)
  const m = /只讀了前 (\d+) 行（共 (\d+) 行）/.exec(text)
  expect(m, 'the cut is said on the window').not.toBeNull()
  expect(Number((m as RegExpExecArray)[1])).toBeLessThan(Number((m as RegExpExecArray)[2]))
  expect(text).toContain('big.log 第 1–' + (m as RegExpExecArray)[1] + ' 行')
})

test('summary of a diff: the whole diff is read and the prompt asks what changed and its impact', async ($, on) => {
  const w = world(on, {})
  w.diff = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,1 +1,1 @@', '-old', '+new ' + MARK, ''].join('\n')
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'diff HEAD~1' })
  const text = await press($, 'summary')
  expect(w.asks[0].prompt).toContain('+new ' + MARK)
  expect(w.asks[0].prompt).toContain('git diff')
  expect(w.asks[0].prompt).toMatch(/impact/)
  expect(text).toContain('這是摘要')
})

test('cancel: a running call is cut by its signal and the window says so; a failure shows its reason and is not retried', async ($, on) => {
  const w = world(on, { [CWD + '/src.ts']: FILE })
  let release: (v: unknown) => void = () => {}
  w.reply = () => new Promise(res => { release = res })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'src.ts' })
  const win = await mountWindow($)
  const started = win.press({ key: 'summary' })
  await new Promise(r => setTimeout(r, 50))
  await win.unmount()
  const mid = await mountWindow($)
  expect(textOf((await mid.drawn()) as Node)).toContain('摘要中…')
  await mid.press({ key: 'cancel' })
  release({ isAnswered: false, reason: 'aborted', usage: USAGE }) // the engine's own answer to an aborted signal (the stand-in hook cannot see the signal: the direct case below does)
  await started.catch(() => undefined)
  await new Promise(r => setTimeout(r, 50))
  await mid.unmount()
  const after = await mountWindow($)
  expect(textOf((await after.drawn()) as Node)).toContain('已取消')
  await after.unmount()
  // a failure
  w.reply = async () => ({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE })
  const failed = await press($, 'summary')
  expect(failed).toContain('沒有拿到回答')
  expect(failed).toContain('overloaded')
  expect(w.asks.length, 'one call for the cancelled press, one for the failed one: nothing retried by itself').toBe(2)
})

test('send into the conversation: fills the prompt box with where it came from and the text, and never submits', async ($, on) => {
  const w = world(on, { [CWD + '/src.ts']: FILE })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'src.ts' })
  await press($, 'send')
  expect(w.fills.length, 'nothing to send before a summary').toBe(0)
  expect(w.toasts.join('\n')).toContain('先按摘要')
  await press($, 'summary')
  await press($, 'send')
  expect(w.fills.length).toBe(1)
  expect(w.fills[0].text.startsWith('[檢視摘要] src.ts 第 1–3 行：')).toBe(true)
  expect(w.fills[0].text).toContain('這是摘要')
  expect(w.fills[0].mode).toBe('replace')
  expect(w.submits, 'the prompt is never submitted by the mod').toBe(0)
  expect(w.toasts.join('\n')).toContain('請自己按 Enter')
  // a draft the owner already typed is kept: the text goes after it
  w.draft = '請看這個'
  await press($, 'send')
  expect(w.fills[1].mode).toBe('append')
  expect(w.fills[1].text.startsWith('\n\n[檢視摘要]')).toBe(true)
})

test('send into the conversation after an ask: the question and the answer both go, with the source', async ($, on) => {
  const w = world(on, { [CWD + '/src.ts']: FILE })
  w.reply = async () => ({ isAnswered: true, text: '兩個。', usage: USAGE })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'src.ts' })
  const win = await mountWindow($)
  await win.input({ key: 'ask-input', text: '有幾個常數？' })
  await win.unmount()
  await press($, 'send')
  expect(w.fills[0].text).toContain('[檢視問答] src.ts 第 1–3 行：')
  expect(w.fills[0].text).toContain('問： 有幾個常數？')
  expect(w.fills[0].text).toContain('答： 兩個。')
})

test('the tool answer: the model reads one line, never the summary or the file (negative control: let the tool answer carry the summary and this goes red)', async ($, on) => {
  const w = world(on, { [CWD + '/src.ts']: FILE })
  w.reply = async () => ({ isAnswered: true, text: 'SUMMARY-SECRET-77', usage: USAGE })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  const before = await $.tool.call({ tool: TOOL, path: 'src.ts' })
  await press($, 'summary')
  const after = await $.tool.call({ tool: TOOL, path: 'src.ts' })
  for (const r of [before, after]) {
    const t = String(r.result)
    expect(t).not.toContain('SUMMARY-SECRET-77')
    expect(t).not.toContain(MARK)
    expect(t.length).toBeLessThan(400)
  }
  expect(String(after.result)).toBe(String(before.result))
  expect(w.fills.length).toBe(0)
})

test('the ask button only moves the keyboard to the question field: no call, no fill (the focus itself is checked on the real terminal)', async ($, on) => {
  const w = world(on, { [CWD + '/src.ts']: FILE })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'src.ts' })
  const win = await mountWindow($)
  await win.press({ key: 'ask' })
  await win.unmount()
  expect(w.asks.length).toBe(0)
  expect(w.fills.length).toBe(0)
})

test('keys: the four buttons carry the hotkeys 1 to 4 and the hint line names them', async ($, on) => {
  world(on, { [CWD + '/src.ts']: FILE })
  await $.session.start({ surface: 'terminal', cwd: CWD })
  await $.command.run({ command: 'show', args: 'src.ts' })
  await press($, 'summary')
  const win = await mountWindow($)
  const tree = (await win.drawn()) as Node
  const keys: Record<string, unknown> = {}
  const walk = (n: Node) => { if (n.type === 'Button' && typeof n.props?.hotkey === 'string') keys[String(n.props.key)] = n.props.hotkey; for (const c of n.children || []) if (typeof c !== 'string') walk(c as Node) }
  walk(tree)
  expect(keys).toEqual({ summary: '1', ask: '2', send: '3', toggle: '4' })
  expect(textOf(tree)).toContain('1 摘要')
  await win.unmount()
})

test('cancel, direct: the press aborts the signal handed to $.model.complete, and the state ends with the cancelled line (negative control: make cancelAi do nothing and this goes red)', async (_$, _on) => {
  // the module is driven with a stand-in engine whose model.complete honours the signal, as the real one does
  resetAssist()
  clearSaved()
  let signal: AbortSignal | undefined
  const $ = {
    ui: { invalidate: () => {} },
    model: {
      complete: (_req: unknown, opts?: { signal?: AbortSignal }) => new Promise(res => {
        signal = opts?.signal
        signal?.addEventListener('abort', () => res({ isAnswered: false, reason: 'aborted', usage: USAGE }))
      }),
    },
  } as never
  const t = makeVT('zh-TW')
  const running = runAi($, 'summary', null, { text: 'abc\n', path: 'a.txt', title: 'a.txt', isDiff: false }, 'zh-TW', t)
  await new Promise(r => setTimeout(r, 20))
  expect(aiState().running).not.toBeNull()
  expect(signal?.aborted).toBe(false)
  cancelAi($)
  await running
  expect(signal?.aborted).toBe(true)
  expect(aiState().running).toBeNull()
  expect(aiState().cancelled).toBe(true)
  expect(aiState().error).toBeNull()
  expect(aiState().shown).toBeNull()
})
