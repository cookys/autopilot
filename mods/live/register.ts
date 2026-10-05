// mods/live/register.ts — the `live` mod (mods plan P1c; Claude Code only).
//
// Reads files the project watcher publishes and draws a band above the prompt, a pane in a wide fullscreen
// terminal and a toast on an axis change. It is read-only: no file is written outside its own $.state value,
// no program is started, nothing is sent to the model.
//
//   pointer  $HOME/.autopilot/live-pointer.json            (the only path built from $.env.get("HOME"))
//   project  session marker <autopilot_home>/session-mode/<sid>.json  ->  <live_base>/runs/paths/*.json longest prefix
//   roots    the marker's root_run_id + its `campaign_roots` (the Mission roots of the campaigns the session launched; P1W SCOPE):
//            every root of the set is read like the marker root, one band is merged from them
//   snapshot <live_base>/runs/<project_key>[--<root>].json, else the SSD copy <autopilot_home>/review/<key>/live/runs.<scope>.json
//   context  <live_base>/context/<sanitised sid>.json      (this sid only)
//   job page <autopilot_home>/review/<key>/<date>/<job>/current/model.json   (acceptance axis + gate rows, optional)
//   W3a      <live_base>/tasks/<sid>.json, attention/<sid>.json              (this sid only)
//            <live_base>/runs/<scope>.decisions.json, <scope>.foreman.json, sources/<scope>.json   (scope-checked sidecars)
//            <git-common-dir>/autopilot/work-orders/<root>/*.json   (campaign start = earliest bound progress receipt;
//            the common dir comes from the envelope's scope.repo_identity, a published path, never a computed live base)
//
// $.session.id() is read on EVERY tick: /clear gives the session a new id while the timer keeps running (S7).
// Every clock comparison uses $.clock.now(), so a test with a mocked clock decides fresh / stale.

import type { EngineInterface, Register } from 'claude-code'

import { Band } from './band'
import { Pane } from './pane'
import {
  acceptanceToast, bandLine1, bandView, buildSections, checkEnvelope, commonDirOf, countsOf, ctxShown, ctxText, earliestReceiptMs, executionToast,
  headerText, hhmm, isKey, isObject, isPlainRoot, jobOf, longestPrefixKey, mergeDecisions, mergeEnvelopes, mergeJobModels, NO_SECTIONS, paneRows, parseJson, portOf, readAttention, readTurn, readDecisions,
  readForeman, readJobModel, readManifest, readTasks, reviewLink, sanitizeSid, scopeKeyOf, sessionUsd, startMsOf, STATE_TEXT, POINTER_SCHEMA,
} from './model'
import type { Counts, DecisionsView, EnvelopeCheck, JobModel, Json, LiveSnapshot, Manifest, Sources } from './model'

const TICK_MS = 5000
const PANE_ID = 'autopilot-live'
const PANE_MIN_COLUMNS = 144
const MAX_PATH_FILES = 256
const MAX_RECEIPT_FILES = 64
const MAX_CAMPAIGN_ROOTS = 8 // session-mode.js CAMPAIGN_ROOTS_MAX

// Module state. A hot reload drops it and session.start rebuilds it (the first tick refills the snapshot at once).
// It is a module variable and not $.state on purpose: a $.state ref needs the plugin manifest to name a types
// contract, and this mod is wired by the hooks.json `modules` key alone.
let snapshot: LiveSnapshot | null = null
let timer: { cancel: () => void } | undefined
let viewport: { columns: number; isFullscreen?: boolean } | null = null
let paneAttempted = false
let previous: { scope: string; counts: Counts | null; acceptance: string | null } | null = null
const jobDates = new Map<string, string>()
// earliest bound progress receipt per root: receipts only accumulate, so a found start never moves earlier
const receiptStarts = new Map<string, number>()

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
    state, text, band: null, header: text, decision: null, project_key: null, root_run_id: null, link: null, rows: null, gates: null,
    sections: NO_SECTIONS, published_at: null, session_as_of: null, host_as_of: null, ...over,
  }
}

// The marker's campaign roots, oldest -> newest: plain path segments only (a root names files), not the marker's own root, no repeats.
function campaignRootsOf(marker: Json, markerRoot: string | null): string[] {
  const raw = Array.isArray(marker.campaign_roots) ? marker.campaign_roots : []
  const out: string[] = []
  for (const r of raw) {
    if (typeof r === 'string' && isPlainRoot(r) && r !== markerRoot && !out.includes(r)) out.push(r)
  }
  return out.slice(-MAX_CAMPAIGN_ROOTS)
}

// Which project / root does this session belong to? marker first (an unexpired one with a project_key), then the
// longest path-boundary prefix of the real cwd among the watchers' runs/paths files. Never git, never a hash.
type Scope = { key: string; root: string | null; marker: Json | null; campaign: string[] }

async function resolveScope($: EngineInterface, autopilotHome: string, liveBase: string, sid: string, nowMs: number): Promise<Scope | null> {
  if (sid) {
    const marker = await readObject($, autopilotHome + '/session-mode/' + sid + '.json')
    if (marker && isKey(marker.project_key) && typeof marker.expires_at === 'string' && Date.parse(marker.expires_at) > nowMs) {
      const root = typeof marker.root_run_id === 'string' && marker.root_run_id ? marker.root_run_id : null
      return { key: marker.project_key, root, marker, campaign: campaignRootsOf(marker, root) }
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
  return key === null ? null : { key, root: null, marker: null, campaign: [] }
}

// The envelope of one scope: the tmpfs file, then the SSD copy; a fresh one beats a stale one.
async function findEnvelope($: EngineInterface, autopilotHome: string, liveBase: string, scope: Scope, nowMs: number): Promise<EnvelopeCheck> {
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

// The earliest bound progress receipt of a campaign root (W3a elapsed). The root names a directory, so only a plain
// segment is used; an unreadable / absent directory is "no receipt" and the earliest run start takes over.
async function receiptStart($: EngineInterface, identity: unknown, root: string): Promise<number | null> {
  const cached = receiptStarts.get(root)
  if (cached !== undefined) return cached
  const common = commonDirOf(identity)
  if (common === null || !isPlainRoot(root)) return null
  const dir = common + '/autopilot/work-orders/' + root
  let names: string[] = []
  try {
    names = (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.json')).map(entry => entry.name).sort().slice(0, MAX_RECEIPT_FILES)
  } catch (_e) { return null }
  const texts: string[] = []
  for (const name of names) {
    const text = await readText($, dir + '/' + name)
    if (text !== null) texts.push(text)
  }
  const ms = earliestReceiptMs(texts, root)
  if (ms !== null) receiptStarts.set(root, ms)
  return ms
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

  // The root set: the marker root first, then the campaign roots (oldest -> newest). Each root is read like the marker root alone
  // used to be; a root whose envelope is missing / stale / malformed is left out and never hides the others.
  const primaryFind = { scope, found: await findEnvelope($, autopilotHome, liveBase, scope, nowMs) }
  const finds: { scope: Scope; found: EnvelopeCheck }[] = [primaryFind]
  for (const root of scope.campaign) {
    const member: Scope = { key: scope.key, root, marker: null, campaign: [] }
    finds.push({ scope: member, found: await findEnvelope($, autopilotHome, liveBase, member, nowMs) })
  }
  const fresh = finds.filter(f => f.found.status === 'fresh')
  // the base envelope: the marker root's when fresh, else the first fresh campaign root's; with none fresh, the marker root's (stale /
  // unavailable / unreadable exactly as before), else the first member that has any envelope
  const baseFind = fresh[0] ?? (primaryFind.found.envelope !== null ? primaryFind : (finds.find(f => f.found.envelope !== null) ?? primaryFind))
  const found = baseFind.found
  const keyed = { project_key: scope.key, root_run_id: scope.root }
  if (found.envelope === null) {
    const malformed = finds.some(f => f.found.status === 'malformed')
    return none(malformed ? plain('unreadable', STATE_TEXT.unreadable, keyed) : plain('unavailable', STATE_TEXT.unavailable(scope.key), keyed))
  }
  const published = typeof found.envelope.published_at === 'string' ? found.envelope.published_at : null

  // pane data: the job page's model.json of each fresh root when it exists (acceptance axis, gate rows, progress, phase), a Link either way
  const jobModelOf = async (root: string | null, env: Json): Promise<{ date: string | null; job: string; model: JobModel | null }> => {
    const jobName = jobOf(env, root)
    const jobDate = await findJobDate($, autopilotHome, scope.key, jobName)
    let m: JobModel | null = null
    if (jobDate !== null) {
      m = readJobModel(await readText($, autopilotHome + '/review/' + scope.key + '/' + jobDate + '/' + jobName + '/current/model.json'))
      if (m === null) jobDates.delete(scope.key + '/' + jobName)
    }
    return { date: jobDate, job: jobName, model: m }
  }
  const baseJob = await jobModelOf(baseFind.scope.root, found.envelope)
  const primaryFresh = primaryFind.found.status === 'fresh'
  // the marker root's own job model, kept apart: the sources-manifest fallback and the review Link belong to the marker root
  const primaryJob = baseFind.scope === scope ? baseJob : null
  const campaignJobs: JobModel[] = []
  for (const f of fresh) {
    if (f.scope === scope) continue
    const cj = f.scope === baseFind.scope ? baseJob : await jobModelOf(f.scope.root, f.found.envelope as Json)
    if (cj.model !== null) campaignJobs.push(cj.model)
  }
  const jobModel: JobModel | null = fresh.length > 0
    ? mergeJobModels(primaryFresh && primaryJob !== null ? primaryJob.model : null, campaignJobs)
    : baseJob.model
  const env: Json = fresh.length > 0
    ? mergeEnvelopes(found.envelope, fresh.filter(f => f !== baseFind).map(f => f.found.envelope as Json))
    : found.envelope
  const port = portOf(await readText($, liveBase + '/review/server.json'))
  const common = {
    ...keyed,
    link: reviewLink(port, scope.key, baseJob.date, baseJob.job),
    rows: paneRows(env),
    gates: jobModel === null ? null : jobModel.gates,
    published_at: published,
    session_as_of: sessionUsd(env, sid).as_of,
    host_as_of: typeof env.host_today_as_of === 'string' ? env.host_today_as_of : null,
  }
  if (fresh.length === 0) {
    const at = published !== null && Number.isFinite(Date.parse(published)) ? hhmm(Date.parse(published)) : null
    return { snap: plain('stale', STATE_TEXT.stale(scope.key, at), common), counts: null, acceptance: null }
  }
  // W3a sources. The per-session files are named by the sanitised sid; every sidecar is read for THIS scope only.
  const fileSid = sanitizeSid(sid)
  const want = { project_key: scope.key, root_run_id: scope.root }
  const scopeKey = scopeKeyOf(scope.key, scope.root)
  const manifestText = await readText($, liveBase + '/runs/sources/' + scopeKey + '.json')
  const manifestParsed = manifestText === null ? null : parseJson(manifestText)
  const manifest: Manifest | null = (manifestParsed !== null && manifestParsed.ok ? readManifest(manifestParsed.value, want) : null)
    || (primaryJob === null || primaryJob.model === null ? null : readManifest(primaryJob.model.sources_manifest, want))
  const tasks = readTasks(await readText($, liveBase + '/tasks/' + fileSid + '.json'), sid)
  const attention = readAttention(await readText($, liveBase + '/attention/' + fileSid + '.json'), sid)
  const turn = readTurn(await readText($, liveBase + '/turn/' + fileSid + '.json'), sid, nowMs, await readText($, liveBase + '/turn-effective/' + fileSid + '.json'))
  // decisions: the proxy decisions of every fresh root of the set, summed; the foreman sidecar of the marker root (it is bound by session)
  const decisionViews: DecisionsView[] = []
  for (const f of fresh) {
    const ds = f.scope.root === null ? scopeKey : scopeKeyOf(scope.key, f.scope.root)
    const view = readDecisions(await readText($, liveBase + '/runs/' + ds + '.decisions.json'), { project_key: scope.key, root_run_id: f.scope.root })
    if (view !== null) decisionViews.push(view)
  }
  const decisions = mergeDecisions(decisionViews)
  const foreman = readForeman(await readText($, liveBase + '/runs/' + scopeKey + '.foreman.json'), want)
  const identity = isObject(env.scope) ? env.scope.repo_identity : null
  // elapsed: the newest campaign root's bound receipt, else the marker root's
  let receiptMs: number | null = null
  let receiptRoot: string | null = null
  for (const r of [...scope.campaign].reverse().concat(scope.root === null ? [] : [scope.root])) {
    receiptMs = await receiptStart($, identity, r)
    if (receiptMs !== null) { receiptRoot = r; break }
  }
  const src: Sources = { tasks, attention, turn, decisions, manifest, foreman, startMs: startMsOf(receiptRoot, env, tasks, scope.marker === null ? null : scope.marker.started_at, receiptMs) }
  const ctx = ctxShown(ctxText(await readText($, liveBase + '/context/' + fileSid + '.json'), nowMs), manifest)
  const band = bandView(env, jobModel, scope.key, nowMs, src)
  return {
    snap: plain('ok', bandLine1(band) + (band.reason === null ? '' : '\n' + band.reason), {
      ...common, band, header: headerText(env, sid, ctx), decision: jobModel === null || !jobModel.needs_decision ? null : jobModel.decision,
      sections: buildSections(src, foreman, identity, nowMs),
    }),
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
    return Band($.ui.resolve(e), snapshot === null ? 'live · waiting for the first snapshot' : snapshot.text, snapshot === null ? null : snapshot.band)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => Pane($.ui.resolve(e), snapshot))
}
