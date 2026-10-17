// mods/viewer/register.ts — the `viewer` mod (Claude Code only): the `show` tool, a window that shows a file or a git diff to the owner without the text passing
// through the model.
//
// The model calls `mcp__autopilot__show` with a file path (optionally a line range) or git diff arguments. This module reads the file (or runs `git diff` by argv, no shell),
// opens a dialog-style pane with the text, and answers the model with ONE short line (model.ts summaryOf*): the path, the line numbers, the counts — never the text.
// The live mod's pressable file paths call the same tool through `$.tool.call`, so one window serves both. Esc closes the window (closeOnEscape) and the keyboard goes back.
//
//   tool     show { path, start?, end? } | { diff: ["HEAD~1", "--", "src"] }
//   command  /show <path[:line]> | /show diff <git diff arguments>     (opens the same window; answers no text, so nothing reaches the model)
//   pane     id autopilot-viewer; scrolling is the engine's (arrows, PgUp, PgDn, Home, End)

import type { EngineInterface, Register } from 'claude-code'

import { errorOf, fileView, parseShowInput } from './model'
import type { ShowInput, ShowRequest } from './model'
import { Viewer } from './pane'
import { PANE_ID, TOOL_DESCRIPTION, TOOL_FULL, TOOL_NAME, TOOL_SCHEMA, currentView, reopenWindow, setCurrentView, shownFile, show } from './show'
import { makeVT } from './strings'
import type { VT } from './strings'

// the registrations that need a bound session; run from `session.start`
export async function startViewer($: EngineInterface): Promise<void> {
  await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
  await $.command.register({ name: 'show', description: 'Show a file or a git diff in a window (the text does not go to the model)', argumentHint: '<path[:line]> | diff <git diff arguments>' })
}

// every hook of the mod except `session.start` (the composed module hands startViewer to the live mod's session.start)
export function registerViewer(on: Parameters<Register>[0]): void {

  on('tool.call', { tool: TOOL_FULL }, async ($, e) => {
    const parsed = parseShowInput(e as unknown as ShowInput)
    if (!parsed.ok) return { deny: errorOf(parsed.why) }
    const out = await show($, parsed.req)
    if (out.ok && !out.placed) $.ui.toast(makeVT(currentView()?.locale ?? 'en')('viewer.waiting')) // the owner's way in is /show, which is placed at any width
    return out.ok ? { result: out.summary } : { deny: errorOf(out.why) }
  })

  on('command.run', { command: 'show' }, async ($, e) => {
    const arg = e.args.trim()
    const t = makeVT(currentView()?.locale ?? 'en')
    if (arg === '') {
      if (!(await reopenWindow($))) $.ui.toast(t('viewer.nothing'))
      return {}
    }
    let parsed
    if (arg === 'diff' || arg.startsWith('diff ')) parsed = parseShowInput({ diff: arg.slice(4).trim() })
    else {
      const m = /^(.*?):(\d+)$/.exec(arg)
      parsed = parseShowInput(m === null ? { path: arg } : { path: m[1], start: Number(m[2]) })
    }
    if (!parsed.ok) $.ui.toast(t('viewer.failed', { why: parsed.why }))
    else {
      const out = await show($, parsed.req)
      if (!out.ok) $.ui.toast(t('viewer.failed', { why: out.why }))
    }
    return {} // no text: a command's text becomes a transcript line the model reads, and the window is the point
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const cur = currentView()
    if (cur === null) return Viewer($.ui.resolve(e), { kind: 'loading' }, '', makeVT('en'), () => {})
    const c = cur
    const t: VT = makeVT(c.locale)
    return Viewer($.ui.resolve(e), c.shown, c.title, t, (start: number) => {
      if (c.shown.kind !== 'file' || c.text === null || currentView() !== c) return
      const view = fileView(c.shown.view.path, c.text, start, null)
      if (view === null) return
      setCurrentView({ ...c, shown: shownFile(view, null) })
      void $.ui.invalidate('ui.render')
      void $.ui.scroll({ in: PANE_ID, to: 'start' }).catch(() => undefined)
    })
  })
}

// standalone (the viewer's own tests): the mod with its own session.start
export const register: Register = on => {
  registerViewer(on)
  on('session.start', async ($, e, next) => {
    await startViewer($)
    return next(e)
  })
}
