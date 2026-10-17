// mods/register.ts — the plugin's one hooks module. Claude Code takes exactly one `modules` entry per plugin (hooks.json; a second entry is refused) and refuses a second
// matcher-less `session.start` hook, so this file composes the mods: each keeps its own folder, tests and hooks (registerLive, registerViewer: all but session.start), and
// the one session.start hook here starts both. The live mod's pressable file paths import showPath directly (the spike showed a plugin's own `$.tool.call` of its own tool is not served).

import type { Register } from 'claude-code'

import { registerLive, startLive } from './live/register'
import { registerViewer, startViewer } from './viewer/register'

export const register: Register = on => {
  registerLive(on)
  registerViewer(on)
  on('session.start', async ($, e, next) => {
    await startLive($)
    // the viewer's registration failing must not stop the live mod or the chain: log it and go on (session.start is awaited before turn one either way)
    try {
      await startViewer($)
    } catch (err) {
      $.ui.log('autopilot viewer: start failed: ' + String(err))
    }
    return next(e)
  })
}
