// mods/viewer/show.ts — what the `show` tool does: read a file (or run `git diff` by argv), remember what the window draws, open the window, and say in ONE line what was shown.
// Lives apart from register.ts so the live mod's pressable file paths can call it directly: `$.tool.call` of a plugin's own tool is not served to the same plugin
// (the engine answers "no tool.call hook answered this call"), so a press in the live pane cannot go through the tool; it calls `showPath` instead.

import type { EngineInterface } from 'claude-code'

import { resolveLocale } from '../live/i18n'
import type { Locale } from '../live/i18n'
import { MAX_FILE_BYTES, TAIL_LINES, diffView, startAbove, fileView, gitDiffArgv, nextStart, prevStart, splitLines, summaryOfDiff, summaryOfEmpty, summaryOfFile } from './model'
import type { DiffView, FileView, ShowRequest } from './model'
import type { Shown } from './pane'
import { makeVT } from './strings'

export const PANE_ID = 'autopilot-viewer'
export const TOOL_NAME = 'show'
export const TOOL_FULL = 'mcp__autopilot__show'

export const TOOL_DESCRIPTION =
  'Show a file or a git diff to the USER in a window on their screen. Use it when the user asks to see, open or look at a file or a diff, instead of reading it and retyping it. ' +
  'The content is displayed to the user only and is NOT returned to you: you get one line saying what was shown. If you need to analyze the content yourself, read the file or run the diff separately. ' +
  'Give exactly one of: path (optionally start and end, 1-based inclusive line numbers), or diff (the arguments after "git diff", one string each, e.g. ["HEAD~1"] or ["HEAD~1", "--", "src/a.ts"]).'

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File to show (absolute, or relative to the working directory).' },
    start: { type: 'integer', minimum: 1, description: 'First line to show (with path).' },
    end: { type: 'integer', minimum: 1, description: 'Last line to show (with path).' },
    diff: { type: 'array', items: { type: 'string' }, description: 'Arguments of git diff, e.g. ["HEAD~1"] or ["--", "path"].' },
  },
}

export type Current = { shown: Shown; title: string; text: string | null; locale: Locale }
let current: Current | null = null
export const currentView = (): Current | null => current
export const setCurrentView = (c: Current): void => { current = c }

// Same inputs as the live mod's resolveT (config ui.locale > AUTOPILOT_LOCALE > Claude Code language > LC_ALL / LANG > en), with the literal names the engine's analysis wants.
async function localeOf($: EngineInterface): Promise<Locale> {
  const home = await $.env.get('HOME').catch(() => undefined)
  let ui: unknown
  if (home) {
    try {
      const cfg = JSON.parse(String(await $.fs.read(home + '/.autopilot/config.json')))
      ui = cfg && typeof cfg === 'object' ? (cfg as { ui?: { locale?: unknown } }).ui?.locale : undefined
    } catch (_e) { /* no config: fall through */ }
  }
  const envLocale = await $.env.get('AUTOPILOT_LOCALE').catch(() => undefined)
  const lang = (await $.env.get('LC_ALL').catch(() => undefined)) || (await $.env.get('LANG').catch(() => undefined))
  let language: string | null = null
  if (ui !== 'en' && ui !== 'zh-TW' && envLocale !== 'en' && envLocale !== 'zh-TW') {
    try {
      const rows = await $.config.list()
      const row = rows.find(r => r.key === 'language')
      if (row && typeof row.value === 'string') language = row.value
    } catch (_e) { /* settings menu unreadable */ }
    if (language === null && home) {
      try {
        const s = JSON.parse(String(await $.fs.read(home + '/.claude/settings.json')))
        if (s && typeof s.language === 'string') language = s.language
      } catch (_e) { /* none */ }
    }
  }
  return resolveLocale({ config: ui, env: envLocale, language, lang })
}

async function cwdPath($: EngineInterface, p: string): Promise<string> {
  return p.startsWith('/') ? p : (await $.session.cwd()).replace(/\/+$/, '') + '/' + p
}

// Open (or retitle) the window; the answer says whether it was drawn. Measured on Claude Code 2.1.302 (docs/plans/evidence/2026-10-17-viewer/README.md): an open that answers the
// person's typed command is placed at any width; an open from a pressed Button is placed at any width ONLY when it is made in the press's own turn (before the first await);
// an open from the model's tool call is placed from 144 columns (110 once the person opened this id before) and waits undrawn below that.
async function openWindow($: EngineInterface, title: string): Promise<boolean> {
  const r = await $.ui.open({ id: PANE_ID, title, focus: true, closeOnEscape: true, holdToasts: true, rows: WINDOW_ROWS, columns: WINDOW_COLUMNS })
  return r.isPlaced
}

// the size the window asks for (a request, not a grant: the engine gives what the layout spares, and a size the owner dragged wins): tall inline above the prompt, wide when docked
const WINDOW_ROWS = 30
const WINDOW_COLUMNS = 100

export type ShowOutcome = { ok: true; summary: string; title: string; placed: boolean } | { ok: false; why: string }
export type ShowOpts = { openFirst?: boolean } // true for a press: open the window before the first await (see openWindow)

const titleOf = (req: ShowRequest): string => (req.kind === 'path' ? req.path : 'git diff ' + req.args.join(' '))

// Do one request: read, remember what the window draws, open it. The returned `summary` is the only text meant for the model.
export async function show($: EngineInterface, req: ShowRequest, opts: ShowOpts = {}): Promise<ShowOutcome> {
  const title = titleOf(req)
  let early: Promise<boolean> | null = null
  const before = current // what the window showed before a press-opened one: a failed open puts it back
  if (opts.openFirst === true) {
    current = { shown: { kind: 'loading' }, title, text: null, locale: current === null ? 'en' : current.locale }
    $.ui.invalidate('ui.render')
    early = openWindow($, title)
  }
  const fail = async (why: string): Promise<ShowOutcome> => {
    if (early !== null) {
      await early.then(() => $.ui.close({ id: PANE_ID })).catch(() => undefined)
      current = before
    }
    return { ok: false, why }
  }
  const finish = async (shown: Shown, text: string | null, locale: Locale, summary: string): Promise<ShowOutcome> => {
    current = { shown, title, text, locale }
    $.ui.invalidate('ui.render')
    const placed = await (early ?? openWindow($, title))
    return { ok: true, summary: placed ? summary : summary + ' ' + WAITING_FOR_MODEL, title, placed }
  }
  const locale = await localeOf($)
  if (req.kind === 'path') {
    const abs = await cwdPath($, req.path)
    let st
    try { st = await $.fs.stat(abs) } catch (_e) { return fail('cannot read ' + req.path) }
    if (st.kind !== 'file') return fail(req.path + ' is not a file')
    if (st.size > MAX_FILE_BYTES) return fail(req.path + ' is over the 4 MiB limit')
    let text: string
    try { text = String(await $.fs.read(abs)) } catch (_e) { return fail('cannot read ' + req.path) }
    if (text.includes('\0')) return fail(req.path + ' looks binary')
    const view = fileView(req.path, text, req.tail === true ? Math.max(1, splitLines(text).length - TAIL_LINES + 1) : req.start, req.end)
    if (view === null) return finish({ kind: 'empty', what: 'file' }, null, locale, summaryOfEmpty(req.path))
    return finish(shownFile(view, req.end), text, locale, summaryOfFile(view))
  }
  let ran
  try { ran = await $.process.run(gitDiffArgv(req.args)) } catch (_e) { return fail('git could not run') }
  if (ran.exitCode !== 0) return fail('git diff failed: ' + (ran.stderr.split('\n')[0] || 'exit ' + ran.exitCode).slice(0, 200))
  const d: DiffView = diffView(ran.stdout)
  if (d.files === 0) return finish({ kind: 'empty', what: 'diff' }, null, locale, summaryOfEmpty(title))
  return finish({ kind: 'diff', view: d }, null, locale, summaryOfDiff(req.args, d))
}

export function shownFile(view: FileView, end: number | null): Shown {
  const partLines = view.last - view.first + 1
  const next = nextStart(view)
  return { kind: 'file', view, prev: prevStart(view, partLines), next: end !== null && next !== null && next > end ? null : next }
}

// What the owner is told when a window the model asked for stayed undrawn (a terminal narrower than the engine's floor for an unasked pane): the `/show` command is the owner's own
// open, which is placed at any width.
export const WAITING_FOR_MODEL = 'The window did not open because the terminal is narrow; tell the user to type /show to open it.'

// A file named by something the owner pressed (the live mod): open it a few lines above `line` (startAbove, so the line has something above it), or from the top. The window opens first (see openWindow); a failure is a toast.
export async function showPath($: EngineInterface, path: string, line: number | 'end' | null): Promise<void> {
  const out = await show($, { kind: 'path', path, start: typeof line === 'number' ? startAbove(line) : null, end: null, ...(line === 'end' ? { tail: true } : {}) }, { openFirst: true })
  if (!out.ok) $.ui.toast(makeVT(current === null ? 'en' : current.locale)('viewer.failed', { why: out.why }))
}

// `/show` with nothing after it: draw the last window again (the owner's own open, so it is placed at any width)
export async function reopenWindow($: EngineInterface): Promise<boolean> {
  if (current === null) return false
  $.ui.invalidate('ui.render')
  await openWindow($, current.title)
  return true
}
