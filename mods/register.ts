// mods/register.ts — the plugin's one hooks module. Claude Code takes exactly one `modules` entry per plugin (hooks.json; a second entry is refused) and refuses a second
// matcher-less `session.start` hook, so this file composes the mods: each keeps its own folder, tests and hooks (registerLive, registerViewer: all but session.start), and
// the one session.start hook here starts both. What crosses between the mods is the `show` tool (`$.tool.call`), which the live mod's pressable file paths call.

import type { Register } from 'claude-code'

import { registerLive, startLive } from './live/register'
import { registerViewer, startViewer } from './viewer/register'

export const register: Register = on => {
  registerLive(on)
  registerViewer(on)
  on('session.start', async ($, e, next) => {
    await startViewer($) // first: the tool must be listed by turn one, whatever the live mod's first read does
    await startLive($)
    return next(e)
  })
}
