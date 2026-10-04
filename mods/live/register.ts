// mods/live/register.ts — the `live` mod (mods plan P1c; Claude Code only).
//
// Reads files the project watcher publishes and draws a band above the prompt, a pane in a wide fullscreen
// terminal and a toast on an axis change. It is read-only: no file is written outside its own $.state value,
// no program is started, nothing is sent to the model.
//
//   pointer  $HOME/.autopilot/live-pointer.json            (the only path built from $.env.get("HOME"))
//   project  session marker <autopilot_home>/session-mode/<sid>.json  ->  <live_base>/runs/paths/*.json longest prefix
//   snapshot <live_base>/runs/<project_key>[--<root>].json, else the SSD copy <autopilot_home>/review/<key>/live/runs.<scope>.json
//   context  <live_base>/context/<sid>.json                (this sid only)
//   job page <autopilot_home>/review/<key>/<date>/<job>/current/model.json   (acceptance axis + gate rows, optional)
//
// $.session.id() is read on EVERY tick: /clear gives the session a new id while the timer keeps running (S7).
// Every clock comparison uses $.clock.now(), so a test with a mocked clock decides fresh / stale.

import type { EngineInterface, Register } from 'claude-code'

import { Band } from './band'
import { Pane } from './pane'
import {
  acceptanceToast, bandText, checkEnvelope, countsOf, ctxText, executionToast, hhmm, isKey, isObject, jobOf,
  longestPrefixKey, paneRows, parseJson, portOf, readJobModel, reviewLink, scopeKeyOf, sessionUsd, STATE_TEXT,
  POINTER_SCHEMA,
} from './model'
import type { Counts, EnvelopeCheck, Json, LiveSnapshot } from './model'

const TICK_MS = 5000
const PANE_ID = 'autopilot-live'
const PANE_MIN_COLUMNS = 144
const MAX_PATH_FILES = 256

// Module state. A hot reload drops it and session.start rebuilds it (the first tick refills the snapshot at once).
// It is a module variable and not $.state on purpose: a $.state ref needs the plugin manifest to name a types
// contract, and this mod is wired by the hooks.json `modules` key alone.
let snapshot: LiveSnapshot | null = null
let timer: { cancel: () => void } | undefined
let viewport: { columns: number; isFullscreen?: boolean } | null = null
let paneAttempted = false
let previous: { scope: string; counts: Counts | null; acceptance: string | null } | null = null
const jobDates = new Map<string, string>()

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    const v = await $.fs.read(path)
    return typeof v === 'string' ? v : null
  } catch (_e) {
    return null
  }
}

async function readObject($: EngineInterface, path: string): Promise<Json | null> {
  const text = await readText($, path)
  if (text === null) return null
  const parsed = parseJson(text)
  return parsed.ok && isObject(parsed.value) ? parsed.value : null
}

function plain(state: LiveSnapshot['state'], text: string, over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    state, text, project_key: null, root_run_id: null, link: null, rows: null, gates: null,
    published_at: null, session_as_of: null, host_as_of: null, ...over,
  }
}

// Which project / root does this session belong to? marker first (an unexpired one with a project_key), then the
// longest path-boundary prefix of the real cwd among the watchers' runs/paths files. Never git, never a hash.
async function resolveScope($: EngineInterface, autopilotHome: string, liveBase: string, sid: string, nowMs: number): Promise<{ key: string; root: string | null } | null> {
  if (sid) {
    const marker = await readObject($, autopilotHome + '/session-mode/' + sid + '.json')
    if (marker && isKey(marker.project_key) && typeof marker.expires_at === 'string' && Date.parse(marker.expires_at) > nowMs) {
      return { key: marker.project_key, root: typeof marker.root_run_id === 'string' && marker.root_run_id ? marker.root_run_id : null }
    }
  }
  const cwd = await $.session.cwd()
  let real = cwd
  try {
    const st = await $.fs.stat(cwd, { resolve: true })
    if (typeof st.realPath === 'string' && st.realPath) real = st.realPath
  } catch (_e) { /* keep the cwd spelling */ }
  const dir = liveBase + '/runs/paths'
  let names: string[] = []
  try {
    names = (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.json')).map(entry => entry.name).slice(0, MAX_PATH_FILES)
  } catch (_e) { return null }
  const maps: Json[] = []
  for (const name of names) {
    const map = await readObject($, dir + '/' + name)
    if (map) maps.push(map)
  }
  const key = longestPrefixKey(real, maps)
  return key === null ? null : { key, root: null }
}

// The envelope of one scope: the tmpfs file, then the SSD copy; a fresh one beats a stale one.
async function findEnvelope($: EngineInterface, autopilotHome: string, liveBase: string, scope: { key: string; root: string | null }, nowMs: number): Promise<EnvelopeCheck> {
  const scopeKey = scopeKeyOf(scope.key, scope.root)
  const want = { project_key: scope.key, root_run_id: scope.root }
  const paths = [liveBase + '/runs/' + scopeKey + '.json', autopilotHome + '/review/' + scope.key + '/live/runs.' + scopeKey + '.json']
  let stale: EnvelopeCheck | null = null
  let malformed = false
  for (const path of paths) {
    const check = checkEnvelope(await readText($, path), want, nowMs)
    if (check.status === 'fresh') return check
    if (check.status === 'stale' && stale === null) stale = check
    if (check.status === 'malformed') malformed = true
  }
  if (stale !== null) return stale
  return { status: malformed ? 'malformed' : 'missing', envelope: null }
}

// date directory of a job under <autopilot_home>/review/<key>/ — the earliest one that holds the job (the
// watcher's renderer pins the earliest too); null until the job page has been published.
async function findJobDate($: EngineInterface, autopilotHome: string, key: string, job: string): Promise<string | null> {
  const base = autopilotHome + '/review/' + key
  const cacheKey = key + '/' + job
  const cached = jobDates.get(cacheKey)
  if (cached) return cached
  let dates: string[] = []
  try {
    dates = (await $.fs.list(base)).filter(entry => entry.kind === 'dir' && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)).map(entry => entry.name).sort()
  } catch (_e) { return null }
  for (const date of dates) {
    try {
      if ((await $.fs.list(base + '/' + date)).some(entry => entry.name === job)) {
        jobDates.set(cacheKey, date)
        return date
      }
    } catch (_e) { /* not a readable date dir */ }
  }
  return null
}

async function buildSnapshot($: EngineInterface, nowMs: number): Promise<{ snap: LiveSnapshot; counts: Counts | null; acceptance: string | null }> {
  const none = (snap: LiveSnapshot) => ({ snap, counts: null, acceptance: null })
  const home = await $.env.get('HOME')
  if (!home) return none(plain('no-pointer', STATE_TEXT.noPointer))
  const pointerText = await readText($, home + '/.autopilot/live-pointer.json')
  if (pointerText === null) return none(plain('no-pointer', STATE_TEXT.noPointer))
  const parsed = parseJson(pointerText)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== POINTER_SCHEMA || typeof parsed.value.live_base !== 'string' || !parsed.value.live_base) {
    return none(plain('unreadable', STATE_TEXT.unreadable))
  }
  const liveBase = parsed.value.live_base.replace(/\/+$/, '')
  const autopilotHome = typeof parsed.value.autopilot_home === 'string' && parsed.value.autopilot_home ? parsed.value.autopilot_home.replace(/\/+$/, '') : home + '/.autopilot'

  const sid = await $.session.id()
  const scope = await resolveScope($, autopilotHome, liveBase, sid, nowMs)
  if (scope === null) return none(plain('no-project', STATE_TEXT.noProject))

  const found = await findEnvelope($, autopilotHome, liveBase, scope, nowMs)
  const keyed = { project_key: scope.key, root_run_id: scope.root }
  if (found.envelope === null) {
    return none(found.status === 'malformed' ? plain('unreadable', STATE_TEXT.unreadable, keyed) : plain('unavailable', STATE_TEXT.unavailable(scope.key), keyed))
  }
  const env = found.envelope
  const published = typeof env.published_at === 'string' ? env.published_at : null

  // pane data: the job page's model.json when it exists (acceptance axis, gate rows), a Link either way
  const job = jobOf(env, scope.root)
  const date = await findJobDate($, autopilotHome, scope.key, job)
  let jobModel: ReturnType<typeof readJobModel> = null
  if (date !== null) {
    jobModel = readJobModel(await readText($, autopilotHome + '/review/' + scope.key + '/' + date + '/' + job + '/current/model.json'))
    if (jobModel === null) jobDates.delete(scope.key + '/' + job)
  }
  const port = portOf(await readText($, liveBase + '/review/server.json'))
  const common = {
    ...keyed,
    link: reviewLink(port, scope.key, date, job),
    rows: paneRows(env),
    gates: jobModel === null ? null : jobModel.gates,
    published_at: published,
    session_as_of: sessionUsd(env, sid).as_of,
    host_as_of: typeof env.host_today_as_of === 'string' ? env.host_today_as_of : null,
  }
  if (found.status === 'stale') {
    const at = published !== null && Number.isFinite(Date.parse(published)) ? hhmm(Date.parse(published)) : null
    return { snap: plain('stale', STATE_TEXT.stale(scope.key, at), common), counts: null, acceptance: null }
  }
  const ctx = ctxText(await readText($, liveBase + '/context/' + sid + '.json'), nowMs)
  return {
    snap: plain('ok', bandText(env, sid, ctx), common),
    counts: countsOf(env),
    acceptance: jobModel === null ? null : jobModel.acceptance,
  }
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const nowMs = await $.clock.now()
    const built = await buildSnapshot($, nowMs)
    snapshot = built.snap
    $.ui.invalidate('ui.render')
    // toasts: only between two fresh snapshots of the same scope
    if (built.snap.state === 'ok') {
      const scope = (built.snap.project_key || '') + '/' + (built.snap.root_run_id || '')
      if (previous !== null && previous.scope === scope) {
        const texts: string[] = []
        if (previous.counts !== null && built.counts !== null) {
          const t = executionToast(previous.counts, built.counts)
          if (t !== null) texts.push(t)
        }
        if (previous.acceptance !== null && built.acceptance !== null) {
          const t = acceptanceToast(previous.acceptance, built.acceptance)
          if (t !== null) texts.push(t)
        }
        for (const text of texts) $.ui.toast(text)
      }
      previous = { scope, counts: built.counts, acceptance: built.acceptance }
    }
    // pane: asked for once, and only where it would be a sidebar (fullscreen, >= 144 columns)
    if (!paneAttempted && built.snap.project_key !== null && viewport !== null && viewport.isFullscreen === true && viewport.columns >= PANE_MIN_COLUMNS) {
      paneAttempted = true
      await $.ui.open({ id: PANE_ID, title: 'Dispatch' })
    }
  } catch (_e) {
    // a bad tick must never take the session down; the next tick tries again
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (timer === undefined) timer = $.clock.every(TICK_MS, () => refresh($))
    await refresh($)
    return next(e)
  })

  // /clear ends the session but no session.start follows and the timer survives it (S7): only a real exit stops it.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && timer !== undefined) {
      timer.cancel()
      timer = undefined
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    viewport = e.viewport ? { columns: e.viewport.columns, isFullscreen: e.viewport.isFullscreen } : null
    if (e.props.hasSurvey) return next(e)
    return Band($.ui.resolve(e), snapshot === null ? 'live · waiting for the first snapshot' : snapshot.text)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => Pane($.ui.resolve(e), snapshot))
}
