// mods/roundtable/register.ts — window B. Command /rt-room [id] opens the pane. The log is re-read about once a second.
// Rooms directory: AUTOPILOT_ROOMS_DIR, else HOME/.autopilot/rooms (plan §6). When $.env.get throws, or neither variable is a non-empty string, the directory is unresolved: the pane says so and does not guess a path. The mod host's own environment is not read.
// Enter runs `node <plugin root>/scripts/roundtable-window.js send ROOM TEXT` (the same send as window A). A non-zero exit is drawn as a broken line. Success is never reported when the run failed.
// closeOnEscape is not set: Esc returns the keyboard and leaves the pane open.
// The one-second read starts on the first open, not at session start, so a failed start cannot leave a timer behind.

import type { EngineInterface, Register } from 'claude-code'

import { resolveLocale } from '../live/i18n'
import type { Locale } from '../live/i18n'
import { newScroll, scrollHook } from '../live/scroll'
import { displayLines, parseRoomLog } from './model'
import type { RoomRow } from './model'
import { RoundtablePane } from './pane'
import { makeRT } from './strings'
import type { RT } from './strings'

export const PANE_ID = 'autopilot-roundtable'
const ROOM_RE = /^[a-z0-9-]+$/
const POLL_MS = 1000

type State = {
  room: string | null
  raw: string
  rows: RoomRow[]
  failure: string | null
  note: string | null
  draft: string
  locale: Locale
}

const state: State = { room: null, raw: '', rows: [], failure: null, note: null, draft: '', locale: 'en' }
const scroll = newScroll()
let timer: { cancel: () => void } | undefined
let seen: string | null = null

export async function roomsDirectory($: EngineInterface): Promise<string | null> {
  let over: string | undefined
  let home: string | undefined
  try { over = await $.env.get('AUTOPILOT_ROOMS_DIR') } catch { over = undefined }
  if (typeof over === 'string' && over.trim() !== '') return over.trim()
  try { home = await $.env.get('HOME') } catch { home = undefined }
  if (typeof home !== 'string' || home.trim() === '') return null
  return home.replace(/\/$/, '') + '/.autopilot/rooms'
}

async function localeOf($: EngineInterface): Promise<Locale> {
  const home = await $.env.get('HOME').catch(() => undefined)
  let ui: unknown
  if (home) {
    try {
      const cfg = JSON.parse(String(await $.fs.read(home + '/.autopilot/config.json')))
      ui = cfg && typeof cfg === 'object' ? (cfg as { ui?: { locale?: unknown } }).ui?.locale : undefined
    } catch (_e) { /* no config */ }
  }
  const envLocale = await $.env.get('AUTOPILOT_LOCALE').catch(() => undefined)
  const lang = (await $.env.get('LC_ALL').catch(() => undefined)) || (await $.env.get('LANG').catch(() => undefined))
  let language: string | null = null
  if (ui !== 'en' && ui !== 'zh-TW' && envLocale !== 'en' && envLocale !== 'zh-TW') {
    try {
      const rows = await $.config.list()
      const row = rows.find(r => r.key === 'language')
      if (row && typeof row.value === 'string') language = row.value
    } catch (_e) { /* unread */ }
  }
  return resolveLocale({ config: ui, env: envLocale, language, lang })
}

async function newestRoom($: EngineInterface, dir: string): Promise<string | null> {
  let entries: { name: string; kind: string; mtimeMs?: number }[]
  try { entries = await $.fs.list(dir) } catch { return null }
  let best: { name: string; mt: number } | null = null
  for (const e of entries) {
    if (e.kind !== 'dir' || !ROOM_RE.test(e.name)) continue
    const mt = typeof e.mtimeMs === 'number' ? e.mtimeMs : 0
    if (best === null || mt >= best.mt) best = { name: e.name, mt }
  }
  return best === null ? null : best.name
}

export async function pollRoundtable($: EngineInterface): Promise<void> {
  if (state.room === null) return
  const dir = await roomsDirectory($)
  if (dir === null) { state.note = makeRT(state.locale)('rt.unresolved'); return }
  const path = dir.replace(/\/$/, '') + '/' + state.room + '/room.jsonl'
  let text = ''
  try { text = String(await $.fs.read(path)) } catch { text = '' }
  if (seen !== null && text === seen) return
  seen = text
  state.raw = text
  state.rows = parseRoomLog(text)
  state.note = text === '' ? makeRT(state.locale)('rt.missing') : null
  void $.ui.invalidate('ui.render')
}

function ensureTimer($: EngineInterface): void {
  if (timer !== undefined) return
  timer = $.clock.every(POLL_MS, () => { void pollRoundtable($) })
}

async function adopt($: EngineInterface, room: string): Promise<void> {
  state.locale = await localeOf($)
  const t = makeRT(state.locale)
  if (!ROOM_RE.test(room)) { state.room = null; state.note = t('rt.badRoom'); void $.ui.invalidate('ui.render'); return }
  const dir = await roomsDirectory($)
  state.room = room
  state.failure = null
  seen = null
  if (dir === null) { state.note = t('rt.unresolved'); state.rows = []; void $.ui.invalidate('ui.render'); return }
  await pollRoundtable($)
}

// Append is the window A script. The runner is the engine's; a failed exit is shown and never treated as success.
function keepDraft(text: string): void {
  // The host clears its field on submit; put the submitted text back unless a newer draft arrived in flight.
  if (state.draft === '' || state.draft === text) state.draft = text
}

export async function submitSay($: EngineInterface, text: string): Promise<void> {
  const body = text.trim()
  if (state.room === null || body === '') {
    state.draft = ''
    void $.ui.invalidate('ui.render')
    return
  }
  state.failure = null
  const root = $.plugin.root.replace(/\/$/, '')
  const argv = ['node', root + '/scripts/roundtable-window.js', 'send', state.room, body]
  let ran: { exitCode: number; stderr?: string }
  try {
    ran = await $.process.run(argv, { timeoutMs: 30_000 })
  } catch (err) {
    state.failure = String(err)
    keepDraft(text)
    void $.ui.invalidate('ui.render')
    return
  }
  if (ran.exitCode !== 0) {
    const errText = (ran.stderr || '').trim()
    state.failure = errText !== '' ? errText : 'exit ' + ran.exitCode
    keepDraft(text)
    void $.ui.invalidate('ui.render')
    return
  }
  // Success clears only the submitted text; a draft typed while the send was in flight stays.
  if (state.draft === text) state.draft = ''
  await pollRoundtable($)
  void $.ui.invalidate('ui.render')
}

export async function startRoundtable($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'rt-room', description: 'Open the roundtable room pane', argumentHint: '[room-id]' })
}

export function registerRoundtable(on: Parameters<Register>[0]): void {
  on('command.run', { command: 'rt-room' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg !== '') {
      void $.ui.open({ id: PANE_ID, title: arg, focus: true })
      ensureTimer($)
      await adopt($, arg)
      return {}
    }
    const dir = await roomsDirectory($)
    const room = dir === null ? null : await newestRoom($, dir)
    void $.ui.open({ id: PANE_ID, title: room ?? 'roundtable', focus: true })
    ensureTimer($)
    if (room === null) {
      state.locale = await localeOf($)
      state.room = null
      state.note = makeRT(state.locale)(dir === null ? 'rt.unresolved' : 'rt.empty')
      void $.ui.invalidate('ui.render')
      return {}
    }
    await adopt($, room)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const t: RT = makeRT(state.locale)
    const cols = frameCols(e)
    scroll.redraw = () => { void $.ui.invalidate('ui.render') }
    return RoundtablePane($.ui.resolve(e), {
      room: state.room,
      count: state.rows.length,
      lines: displayLines(state.rows, Math.max(4, cols - 1)),
      failure: state.failure,
      note: state.note,
      draft: state.draft,
    }, t, (v: string) => { state.draft = v }, (v: string) => submitSay($, v), { props: (e as { props?: unknown }).props, model: scroll })
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    return scrollHook(scroll, e, next, () => { void $.ui.invalidate('ui.render') })
  })
}

function frameCols(e: unknown): number {
  const cols = (e as { props?: { bodyColumns?: unknown } }).props?.bodyColumns
  return typeof cols === 'number' && cols > 0 ? cols : 80
}

export const register: Register = on => {
  registerRoundtable(on)
  on('session.start', async ($, e, next) => {
    await startRoundtable($)
    return next(e)
  })
}
