// mods/live/register.ts — the `live` mod (mods plan P1c; Claude Code only).
//
// Reads files the project watcher publishes and draws a band above the prompt, a pane in a wide fullscreen
// terminal and a toast on an axis change. It writes no file and starts no program. The one thing it sends to the model is the owner's
// answer from the 待決 tab: the send Button submits one prompt (`$.prompt.submit`, not as the user).
//
//   pointer  $HOME/.autopilot/live-pointer.json
//   project  session marker <autopilot_home>/session-mode/<sid>.json  ->  <live_base>/runs/paths/*.json longest prefix
//   roots    the marker's root_run_id + its `campaign_roots` (the Mission roots of the campaigns the session launched; P1W SCOPE):
//            every root of the set is read like the marker root, one band is merged from them
//   snapshot <live_base>/runs/<project_key>[--<root>].json, else the SSD copy <autopilot_home>/review/<key>/live/runs.<scope>.json
//   context  <live_base>/context/<sanitised sid>.json      (this sid only)
//   account  $CLAUDE_CONFIG_DIR or $HOME /.claude.json `oauthAccount` (Claude Code's own file: email, org, plan; re-read only when its
//            size or mtime changed, at most every 30 s)
//   quota    $.session.usage().rateLimits                  (polled each tick; the `session.measure` event is not used, the tick already redraws)
//   job page <autopilot_home>/review/<key>/<date>/<job>/current/model.json   (acceptance axis + gate rows, optional)
//   W3a      <live_base>/tasks/<sid>.json, attention/<sid>.json              (this sid only)
//            <live_base>/runs/<scope>.decisions.json, <scope>.foreman.json, sources/<scope>.json   (scope-checked sidecars)
//            <git-common-dir>/autopilot/work-orders/<root>/*.json   (campaign start = earliest bound progress receipt;
//            the common dir comes from the envelope's scope.repo_identity, a published path, never a computed live base)
//
//   spend    <live_base>/runs/spend-history.json (host-wide, schema autopilot.spend-history/1): the Spend tab's hourly sparkline; absent / < 2 samples -> a note
//   P7       <live_base>/runs/<project_key>.qc.json, .residue.json, .review.json; <live_base>/stage/<sid>.json; load-source.json; the marker's
//            §2.9 fields (size, urgent, level, stage, stage_set_at, unit, review_families); the envelope's host_today_brain_usd / brain_cap_usd;
//            the decisions sidecar's `ladder`. Each is optional: absent -> its slot is left out and its tab says "no data".
//            The band is ONE line (band.tsx, layout in model.ts layoutBand); the ⓘ opens the pane on the Now tab (7 tabs: Now Decide Dispatch Review Spend Hygiene ?).
//
//   i18n     every word comes from mods/live/locales/{en,zh-TW}.json (compiled to locales.ts) through `t`; the locale is resolved on every tick:
//            ~/.autopilot/config.json ui.locale > AUTOPILOT_LOCALE > Claude Code's language setting ($.config.list() row `language`, else the
//            user settings.json) > LC_ALL / LANG > en
//
// $.session.id() is read on EVERY tick: /clear gives the session a new id while the timer keeps running (S7).
// Every clock comparison uses $.clock.now(), so a test with a mocked clock decides fresh / stale.

import type { EngineInterface, Register } from 'claude-code'

import { newTracker, parseAdvisories, takeNew } from './advisories'
import { makeT, resolveLocale, T_EN } from './i18n'
import type { T } from './i18n'
import { atom, read, update } from 'claude-code'
import type { AdvisoryTracker } from './advisories'
import { SHOW_PRESS, showTarget } from './ui'
import { Band } from './band'
import { Pane } from './pane'
import { newScroll, scrollHook } from './scroll'
import { showPath } from '../viewer/show'
import {
  acceptanceToast, autoResidueCount, cleanTargets, normalizeAbs, decideReply, NO_DECIDE, makeRecentTracker, bandLine1, bandView, buildSections, checkEnvelope, commonDirOf, commonDirOfGitdir, gitdirOfGitFile, countsOf, ctxShown, ctxText, earliestReceiptMs, executionToast,
  headerText, hhmm, projectName as projectNameOf, isKey, isSectionId, isObject, isPlainRoot, jobOf, longestPrefixKey, mergeDecisions, mergeEnvelopes, mergeJobModels, NO_SECTIONS, PANE_TABS, paneRows, parseJson, portOf, readAttention, readTurn, readDecisions,
  readForeman, readLoadSource, readSpendHistory, hourlySpend, readJobModel, readManifest, readMarker, readQc, readResidue, readReview, readStageWalk, readTasks, reviewLink, sanitizeSid, scopeKeyOf, sessionUsd,
  slotTab, slotUnfolds, spendOf, startMsOf, stateText, stalledCount, POINTER_SCHEMA, NO_DETAIL, usd, scanBackground, lastOutputLine, bgLabel, readQuota, readAccount,
} from './model'
import type { AccountView, ActivityItem, Counts, DecideState, DecisionsView, RecentGroup, EnvelopeCheck, JobModel, Json, LiveSnapshot, Manifest, PaneTab, SlotId, QuotaWindow, Sources } from './model'

const TICK_MS = 5000
const PANE_ID = 'autopilot-live'
const PANE_MIN_COLUMNS = 144
const MAX_PATH_FILES = 256
const MAX_RECEIPT_FILES = 64
const MAX_CAMPAIGN_ROOTS = 8 // session-mode.js CAMPAIGN_ROOTS_MAX

// Module state. A hot reload drops it and session.start rebuilds it (the first tick refills the snapshot at once).
// What the owner picked and typed on the 待決 tab is NOT here: a drawing's inputs belong in $.state (below), so a hot reload keeps them.
let snapshot: LiveSnapshot | null = null
// the 待決 tab's picks, notes and what was already sent, by decision id (the contract is types/index.d.ts, named by plugin.json)
const DECIDE = atom({ plugin: 'autopilot', key: 'decide' } as const, NO_DECIDE)
const SURFACES_WITH_INPUT = new Set<string>(['terminal', 'desktop', 'vscode']) // the elements tables with an `Input`; a phone has none (the resolved table hands out a stand-in for it, so the surface is what tells)
const DECIDE_KEEP_MS = 24 * 3600 * 1000 // a sent question the session never closed is forgotten after a day
let timer: { cancel: () => void } | undefined
let viewport: { columns: number; isFullscreen?: boolean } | null = null
let paneAttempted = false
let paneTab: PaneTab = 'now'
const expanded = new Set<string>() // the recent-prompt groups the person opened (by group id)
const folded = new Set<string>() // the Now sections the person folded (SECTION ids); kept across /clear, a view preference and not tied to the transcript
const recentTracker = makeRecentTracker()
let recent: RecentGroup[] | null = null // survives ticks: the snapshot is rebuilt each time, a failed read keeps the last value
let recentSid: string | null = null // group ids are transcript indexes, so a new session id (/clear) drops every opened group
let activity: ActivityItem[] | null = null // survives ticks like `recent`: a failed read keeps the last value
const tails = new Map<string, { size: number; mtimeMs: number; tail: string | null }>() // a background command's last output line, re-read only when its file changed
const MAX_TAIL_BYTES = 1024 * 1024 // a bigger output file shows its quiet time, not its last line ($.fs.read takes the whole file)
const LIVE_AGENT = new Set(['pending', 'running', 'waiting'])
let quota: QuotaWindow[] = [] // the rate-limit windows; a usage() that throws keeps the last ones
let account: AccountView | null | undefined = undefined // undefined until .claude.json parsed once; a half-written read keeps the last value
// the .claude.json the account was parsed from: its path, stat and when (Claude Code rewrites it often)
let accountFile: { path: string; size: number; mtimeMs: number; parsedMs: number } | null = null
const MAX_ACCOUNT_BYTES = 4 * 1024 * 1024 // $.fs.read's cap
const ACCOUNT_REPARSE_MS = 30_000 // a changed .claude.json is parsed again at most this often after a good parse (it can be megabytes)
let tr: T = T_EN // the active translator, set at the start of every tick (and read by the band / pane draws)
let pressSeq = 0 // one number per ⓘ press, taken before any await; only the latest press may assign paneTab or end the chain
let decided: Promise<PaneTab> | null = null // the tab the latest unfinished press chose: a press landing meanwhile steps on from it (N rapid presses = N tabs)
let previous: { scope: string; counts: Counts | null; acceptance: string | null } | null = null
const advisories: AdvisoryTracker = newTracker() // P7a: advisory rows seen for the current session; advisories.count feeds a band chip
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
    state, text, band: null, header: text, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null,
    sections: NO_SECTIONS, review: null, published_at: null, session_as_of: null, host_as_of: null, detail: NO_DETAIL, ...over,
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

// The cost fuse's mode as hooks/cost-fuse.js resolves it: AUTOPILOT_COST_FUSE_MODE, else ~/.autopilot/config.json cost_fuse.mode, else warn.
// (env first, then config: the same result as hooks/cost-fuse.js, which loads the config and then applies the env override)
async function fuseModeOf($: EngineInterface, autopilotHome: string): Promise<string> {
  try {
    const env = await $.env.get('AUTOPILOT_COST_FUSE_MODE')
    if (env === 'block' || env === 'warn' || env === 'off') return env
  } catch (_e) { /* no env */ }
  const cfg = await readObject($, autopilotHome + '/config.json')
  const cf = cfg !== null && isObject(cfg.cost_fuse) ? cfg.cost_fuse : null
  return cf !== null && (cf.mode === 'block' || cf.mode === 'warn' || cf.mode === 'off') ? cf.mode : 'warn'
}

// No watcher scope for this cwd (a repo that was never onboarded): the residue reminder still has to reach the person, so read
// `reap --auto`'s own result straight from the repo. The mod cannot run git, so it walks up from the cwd to the FIRST `.git`: a
// directory holds the file directly, a `.git` file (linked worktree / submodule) leads to the common dir via `commondir`. Absent / foreign = 0.
const MAX_GIT_WALK = 16
async function orphanResidueCount($: EngineInterface): Promise<number> {
  try {
    let dir = await $.session.cwd()
    for (let i = 0; i < MAX_GIT_WALK && dir !== ''; i++) {
      // the FIRST `.git` met is the repo: a directory (it holds HEAD) or a gitfile. If its result file cannot be resolved or read the answer
      // is 0; a parent repo's file is never borrowed.
      if (await readText($, dir + '/.git/HEAD') !== null) return autoResidueCount(await readText($, dir + '/.git/autopilot-residue-auto.json'))
      const gitText = await readText($, dir + '/.git')
      if (gitText !== null) { // a `.git` file exists: it is the repo, even when it is empty or unparseable
        const gitdir = gitdirOfGitFile(gitText, dir)
        if (gitdir === null) return 0
        const common = commonDirOfGitdir(gitdir, await readText($, gitdir + '/commondir'))
        return autoResidueCount(await readText($, common + '/autopilot-residue-auto.json'))
      }
      const cut = dir.lastIndexOf('/')
      if (cut <= 0) break
      dir = dir.slice(0, cut)
    }
  } catch (_e) { /* no cwd / unreadable: no reminder */ }
  return 0
}

// Claude Code's own language setting: the `/config` row named `language` when the engine lists one, else `language` in the user's settings.json.
// The row exists (verified on Claude Code 2.1.296: a `text` row, e.g. "正體中文台灣用語"); the file fallback covers an engine that lacks it; any failure is "no setting".
async function claudeLanguage($: EngineInterface, home: string | undefined): Promise<string | null> {
  try {
    const row = (await $.config.list()).find(r => r.key === 'language')
    if (row !== undefined && typeof row.value === 'string' && row.value.trim() !== '') return row.value
  } catch (_e) { /* no such row / the engine cannot list */ }
  if (!home) return null
  const settings = await readObject($, home + '/.claude/settings.json')
  return settings !== null && typeof settings.language === 'string' && settings.language.trim() !== '' ? settings.language : null
}

async function resolveT($: EngineInterface): Promise<T> {
  let home: string | undefined
  try { home = await $.env.get('HOME') } catch (_e) { home = undefined }
  const cfg = home ? await readObject($, home + '/.autopilot/config.json') : null
  const ui = cfg !== null && isObject(cfg.ui) ? cfg.ui : null
  const envLocale = await $.env.get('AUTOPILOT_LOCALE').catch(() => undefined)
  const lang = (await $.env.get('LC_ALL').catch(() => undefined)) || (await $.env.get('LANG').catch(() => undefined))
  const needLanguage = !(ui !== null && (ui.locale === 'en' || ui.locale === 'zh-TW')) && envLocale !== 'en' && envLocale !== 'zh-TW'
  const language = needLanguage ? await claudeLanguage($, home) : null
  return makeT(resolveLocale({ config: ui === null ? undefined : ui.locale, env: envLocale, language, lang }))
}

async function buildSnapshot($: EngineInterface, nowMs: number, t: T): Promise<{ snap: LiveSnapshot; counts: Counts | null; acceptance: string | null }> {
  const none = (snap: LiveSnapshot) => ({ snap, counts: null, acceptance: null })
  const STATE_TEXT = stateText(t)
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
  if (scope === null) {
    const wt = await orphanResidueCount($)
    return none(plain('no-project', wt > 0 ? STATE_TEXT.noProjectWt(wt) : STATE_TEXT.noProject))
  }

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
    rows: paneRows(env, nowMs),
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
  const loadSource = readLoadSource(await readText($, liveBase + '/load-source.json'))
  const identity = isObject(env.scope) ? env.scope.repo_identity : null
  // elapsed: the newest campaign root's bound receipt, else the marker root's
  let receiptMs: number | null = null
  let receiptRoot: string | null = null
  for (const r of [...scope.campaign].reverse().concat(scope.root === null ? [] : [scope.root])) {
    receiptMs = await receiptStart($, identity, r)
    if (receiptMs !== null) { receiptRoot = r; break }
  }
  // P7: the stage-graph facts. Each is optional; an absent / foreign file reads as null and its slot / tab says "no data".
  const marker = readMarker(scope.marker)
  const qc = readQc(await readText($, liveBase + '/runs/' + scope.key + '.qc.json'), { project_key: scope.key, root_run_id: null })
  const residue = readResidue(await readText($, liveBase + '/runs/' + scope.key + '.residue.json'), scope.key)
  const stage = readStageWalk(await readText($, liveBase + '/stage/' + fileSid + '.json'), sid)
  const review = readReview(await readText($, liveBase + '/runs/' + scope.key + '.review.json'), scope.key)
  const src: Sources = { tasks, attention, turn, decisions, manifest, foreman, loadSource, marker, review, qc, residue, stage, quota, startMs: startMsOf(receiptRoot, env, tasks, scope.marker === null ? null : scope.marker.started_at, receiptMs) }
  const ctx = ctxShown(ctxText(await readText($, liveBase + '/context/' + fileSid + '.json'), nowMs), manifest, t)
  const band = bandView(env, jobModel, scope.key, nowMs, src, t)
  return {
    snap: plain('ok', bandLine1(band) + (band.reason === null ? '' : '\n' + band.reason), {
      ...common, band, header: headerText(env, sid, ctx, t), metrics: { ctx }, pending: jobModel === null || !jobModel.needs_decision ? [] : jobModel.decisions,
      sections: buildSections(src, foreman),
      review,
      detail: {
        counts: countsOf(env), stalled: stalledCount(env, foreman, nowMs),
        now_ms: nowMs, project: projectNameOf(identity, scope.key), marker, qc, stage, decisions, load_source: loadSource, residue,
        spend: { session: sessionUsd(env, sid).text, host_all: usd(env.host_today_usd), host_all_n: typeof env.host_today_usd === 'number' && Number.isFinite(env.host_today_usd) ? env.host_today_usd : null, brain: spendOf(env)?.brain ?? null, cap: spendOf(env)?.cap ?? null, mode: await fuseModeOf($, autopilotHome), hourly: hourlySpend(readSpendHistory(await readText($, liveBase + '/runs/spend-history.json')), nowMs) },
      },
    }),
    counts: countsOf(env),
    acceptance: jobModel === null ? null : jobModel.acceptance,
  }
}

// P7a advisory bridge: the rows the hooks appended to <live_base>/advisories/<sid>.jsonl, each new one a toast.
async function pollAdvisories($: EngineInterface, nowMs: number): Promise<void> {
  try {
    const home = await $.env.get('HOME')
    if (!home) return
    const pointer = await readObject($, home + '/.autopilot/live-pointer.json')
    if (pointer === null || pointer.schema !== POINTER_SCHEMA || typeof pointer.live_base !== 'string' || !pointer.live_base) return
    const sid = await $.session.id()
    if (!sid) return
    const text = await readText($, pointer.live_base.replace(/\/+$/, '') + '/advisories/' + sanitizeSid(sid) + '.jsonl')
    for (const row of takeNew(advisories, sid, parseAdvisories(text), nowMs)) $.ui.toast(row.text)
  } catch (_e) {
    // the bridge never takes the session down
  }
}

// The background-work rows: the shells and watches scanned from the messages, each shell with its output file's last line and quiet time, then the
// running subagents. Each source fails on its own: an unread transcript keeps the previous shell and watch rows; null = neither answered (the caller
// keeps the previous rows). Only the rows the pane shows read their output file.
async function readActivity($: EngineInterface, msgs: unknown, nowMs: number, prev: readonly ActivityItem[] | null): Promise<ActivityItem[] | null> {
  const items: ActivityItem[] = []
  let answered = false
  if (!Array.isArray(msgs)) items.push(...(prev ?? []).filter(it => it.kind !== 'agent').map(it => ({ ...it, quietMs: null }))) // the age would freeze
  else {
    answered = true
    const seen = new Set<string>()
    for (const task of scanBackground(msgs as never)) {
      let tail = task.lastEvent
      let quietMs: number | null = null
      if (task.output !== null) {
        seen.add(task.output)
        try {
          const st = await $.fs.stat(task.output)
          if (st.kind === 'file') {
            quietMs = Math.max(0, nowMs - st.mtimeMs)
            const hit = tails.get(task.output)
            if (hit !== undefined && hit.size === st.size && hit.mtimeMs === st.mtimeMs) tail = hit.tail
            else {
              const text = st.size <= MAX_TAIL_BYTES ? await readText($, task.output) : null
              tail = text === null ? null : lastOutputLine(text)
              tails.set(task.output, { size: st.size, mtimeMs: st.mtimeMs, tail })
            }
          }
        } catch (_e) { /* no output file yet: the row shows without a tail */ }
      }
      items.push({ kind: task.kind, label: task.label, detail: null, tail, quietMs, output: task.output })
    }
    for (const path of [...tails.keys()]) if (!seen.has(path)) tails.delete(path)
  }
  try {
    const agents = await $.agent.list()
    if (Array.isArray(agents)) {
      answered = true
      for (const a of agents) if (LIVE_AGENT.has(a.status)) items.push({ kind: 'agent', label: bgLabel(a.description || a.type), detail: a.description ? bgLabel(a.type) : null, tail: null, quietMs: null })
    }
  } catch (_e) { /* no agent list: the shells still show */ }
  return answered ? items : null
}

// The account and its rate-limit windows. Each source fails on its own and keeps its last value.
async function readAccountQuota($: EngineInterface, nowMs: number): Promise<void> {
  try {
    const usage = await $.session.usage()
    quota = readQuota(isObject(usage) ? usage.rateLimits : null)
  } catch (_e) { /* no reading: keep the last windows */ }
  try {
    // Claude Code keeps it in CLAUDE_CONFIG_DIR when that is set, else in HOME (checked against the real tool)
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || (await $.env.get('HOME'))
    if (!dir) return
    const path = dir.replace(/\/+$/, '') + '/.claude.json'
    const clear = () => { account = undefined; accountFile = null } // no stale account, and a file back is read at once
    if (accountFile !== null && accountFile.path !== path) clear() // another directory: the account shown came from the old one
    const st = await $.fs.stat(path).catch(() => null)
    if (st === null) {
      // the rejection carries only a message across the engine boundary (no `code`): ask whether the file is there instead.
      // Gone: clear. Still there (a permission or passing I/O error): keep the last account.
      if (!(await $.fs.exists(path).catch(() => true))) clear()
      return
    }
    if (st.kind !== 'file' || st.size > MAX_ACCOUNT_BYTES) { clear(); return }
    const prev = accountFile // the same path here: another directory cleared it above, so it is read at once
    if (prev !== null && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return
    if (prev !== null && nowMs - prev.parsedMs < ACCOUNT_REPARSE_MS) return // changed again soon after a good parse: wait
    const next = readAccount(await readText($, path))
    if (next === undefined) return // unreadable or caught mid-rewrite: try again next tick
    account = next
    accountFile = { path, size: st.size, mtimeMs: st.mtimeMs, parsedMs: nowMs }
  } catch (_e) { /* a failed read: keep the last account */ }
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const nowMs = await $.clock.now()
    tr = await resolveT($)
    await pollAdvisories($, nowMs)
    await readAccountQuota($, nowMs)
    const built = await buildSnapshot($, nowMs, tr)
    let msgs: unknown = null
    try {
      const sid = await $.session.id()
      msgs = await $.session.messages()
      if (recentSid !== null && sid !== recentSid) expanded.clear()
      recentSid = sid ?? null
      if (Array.isArray(msgs)) recent = recentTracker.update(sid ?? '', msgs as never)
    } catch (_e) {
      // the transcript is optional garnish: keep the previous value
    }
    try {
      const next = await readActivity($, msgs, nowMs, activity)
      if (next !== null) activity = next
    } catch (_e) {
      // garnish too: keep the previous rows
    }
    snapshot = { ...built.snap, recent, activity, account: { account, quota } }
    await pruneDecide($, new Set(built.snap.pending.flatMap(d => (d.id === null ? [] : [d.id]))), built.snap.state === 'ok', nowMs).catch(() => undefined)
    $.ui.invalidate('ui.render')
    // toasts: only between two fresh snapshots of the same scope
    if (built.snap.state === 'ok') {
      const scope = (built.snap.project_key || '') + '/' + (built.snap.root_run_id || '')
      if (previous !== null && previous.scope === scope) {
        const texts: string[] = []
        if (previous.counts !== null && built.counts !== null) {
          const t = executionToast(previous.counts, built.counts, tr)
          if (t !== null) texts.push(t)
        }
        if (previous.acceptance !== null && built.acceptance !== null) {
          const t = acceptanceToast(previous.acceptance, built.acceptance, tr)
          if (t !== null) texts.push(t)
        }
        for (const text of texts) $.ui.toast(text)
      }
      previous = { scope, counts: built.counts, acceptance: built.acceptance }
    }
    // pane: asked for once, and only where it would be a sidebar (fullscreen, >= 144 columns)
    if (!paneAttempted && built.snap.project_key !== null && viewport !== null && viewport.isFullscreen === true && viewport.columns >= PANE_MIN_COLUMNS) {
      paneAttempted = true
      await $.ui.open({ id: PANE_ID, title: 'Autopilot' })
    }
  } catch (_e) {
    // a bad tick must never take the session down; the next tick tries again
  }
}

// A press on the 待決 tab: `pick:<id>:<k>` chooses option k of question id (pressing the chosen one again unchooses it), `submit` sends every answered question.
async function decidePress($: EngineInterface, id: string): Promise<void> {
  // a pressed file path (ui.ts linkSegs, the background tail): the viewer window has to open in THIS turn, before any await (mods/viewer/show.ts openWindow)
  if (id.startsWith(SHOW_PRESS)) {
    const at = showTarget(id)
    if (at !== null) await showPath($, at.path, at.line).catch(() => undefined)
    return
  }
  try {
    const m = /^pick:(.+):(\d+)$/.exec(id)
    if (m !== null) {
      const k = Number(m[2])
      await update($, DECIDE, s => {
        const picks = { ...s.picks }
        if (picks[m[1]] === k) delete picks[m[1]]
        else picks[m[1]] = k
        return { ...s, picks }
      })
    } else if (id === 'submit') await sendDecide($)
    else if (id.startsWith('clean:')) await cleanPress($, id)
  } catch (_e) {
    // a press never takes the session down
  }
}

// A press on a 殘留 cleanup button (`clean:all` or `clean:<path>`). The button never builds a delete of its own: it runs one of TWO fixed scripts, by argument vector (`$.process.run`,
// no shell, so no quoting), each of which classifies again at that moment: `repo-residue-sweep.js reap --yes --worktree <path>` (clean + integrated, or directory gone; a live,
// dirty or unintegrated worktree is never touched) and `prune-plugin-cache.js --version <v>` (a plain version directory, no live pid, not the loaded copy). The arguments come only
// from the CURRENT clearable lists of the snapshot, so a stale or forged id runs nothing. Owner ruling 2026-10-16 (d-7a7ee75c): no confirmation dialog.
export const CLEAN_SCRIPTS = ['scripts/repo-residue-sweep.js', 'scripts/prune-plugin-cache.js'] as const
type CleanRun = (argv: string[]) => Promise<{ exitCode: number; stdout: string }>
let cleaning = false
// the common git dir of the checkout a path belongs to: the first `.git` met walking up (a directory holds HEAD, a gitfile names the gitdir); null when there is none (a directory that is gone)
async function commonDirAt($: EngineInterface, start: string): Promise<string | null> {
  let dir = start
  for (let i = 0; i < MAX_GIT_WALK && dir !== ''; i++) {
    if (await readText($, dir + '/.git/HEAD') !== null) return normalizeAbs(dir + '/.git')
    const gitText = await readText($, dir + '/.git')
    if (gitText !== null) {
      const gitdir = gitdirOfGitFile(gitText, dir)
      return gitdir === null ? null : commonDirOfGitdir(gitdir, await readText($, gitdir + '/commondir'))
    }
    const cut = dir.lastIndexOf('/')
    if (cut <= 0) break
    dir = dir.slice(0, cut)
  }
  return null
}
type CleanNote = { ok: boolean; note: string }
export async function cleanPress($: EngineInterface, id: string, run?: CleanRun): Promise<void> {
  if (cleaning || snapshot === null) return
  // the only place `$.process` is used: argv is node + a whitelisted script (ui-lint.test.js pins this)
  const exec = async (script: (typeof CLEAN_SCRIPTS)[number], args: string[]): Promise<string> => {
    if (!CLEAN_SCRIPTS.includes(script)) throw new Error('script not allowed')
    const argv = ['node', $.plugin.root + '/' + script, ...args]
    const r = run === undefined ? await $.process.run(argv, { timeoutMs: 120_000 }) : await run(argv)
    return r.stdout
  }
  // the same list the 全部清掉 count is drawn from (model.ts cleanTargets): what is clearable now and was not already reported on
  const left = cleanTargets(snapshot.detail, (await read($, DECIDE)).clean ?? {})
  const asked = id === 'clean:all' ? left.worktrees.map(e => e.target) : left.worktrees.map(e => e.target).filter(x => 'clean:' + x === id)
  const askedCaches = id === 'clean:all' ? left.caches : left.caches.filter(x => 'clean:' + x === id)
  if (asked.length === 0 && askedCaches.length === 0) return
  cleaning = true
  try {
    const results: Record<string, CleanNote> = {}
    for (const dir of askedCaches) {
      const parts = dir.split('/').filter(x => x !== '')
      const version = parts[parts.length - 1]
      const claudeDir = '/' + parts.slice(0, -5).join('/') // <claude-dir>/plugins/cache/autopilot/autopilot/<version>
      if (!(await $.fs.exists($.plugin.root + '/' + CLEAN_SCRIPTS[1]).catch(() => false))) { results[dir] = { ok: false, note: 'cleanup script not found' }; continue }
      try {
        const out = await exec(CLEAN_SCRIPTS[1], ['--version', version, '--claude-dir', claudeDir])
        const rep = parseJson(out.split('\n').reverse().find(l => l.startsWith('{')) ?? '')
        results[dir] = rep.ok && isObject(rep.value) && rep.value.ok === true ? { ok: true, note: '' } : { ok: false, note: rep.ok && isObject(rep.value) && typeof rep.value.reason === 'string' ? rep.value.reason : 'no report from the cleanup script' }
      } catch (e) {
        results[dir] = { ok: false, note: e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : 'cleanup failed' } // a refusal exits 1 with its JSON reason on stdout (read above); this is a failure to start
      }
    }
    if (asked.length > 0) await cleanWorktrees($, asked, exec, results)
    await update($, DECIDE, s => ({ ...s, clean: { ...(s.clean ?? {}), ...results } }))
  } finally {
    cleaning = false
  }
}
// The worktrees of one press. Each runs under the repository it belongs to (its own checkout's common dir, never just the session's cwd), and only when that is the session's repository.
// A target counts as cleared only when its directory is really gone afterwards, whatever the report says.
async function cleanWorktrees($: EngineInterface, asked: string[], exec: (script: (typeof CLEAN_SCRIPTS)[number], args: string[]) => Promise<string>, results: Record<string, CleanNote>): Promise<void> {
  if (!(await $.fs.exists($.plugin.root + '/' + CLEAN_SCRIPTS[0]).catch(() => false))) { for (const x of asked) results[x] = { ok: false, note: 'cleanup script not found' }; return }
  const cwd = await $.session.cwd()
  const mine = await commonDirAt($, cwd)
  const byRepo = new Map<string, string[]>()
  for (const x of asked) {
    const own = await commonDirAt($, x) // null: the directory is gone, nothing to compare; the sweep only knows worktrees of the repo it is given
    if (own !== null && mine !== null && own !== mine) { results[x] = { ok: false, note: 'this worktree belongs to another repository' }; continue }
    const common = own ?? mine
    const repo = common !== null && common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : cwd
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), x])
  }
  for (const [repo, targets] of byRepo) {
    const kept = new Map<string, string>()
    let failure = ''
    try {
      const out = await exec(CLEAN_SCRIPTS[0], ['reap', '--repo', repo, '--yes', '--json', ...targets.flatMap(x => ['--worktree', x])])
      const line = out.split('\n').reverse().find(l => l.startsWith('{'))
      const report = line === undefined ? null : parseJson(line)
      const acts = report !== null && report.ok && isObject(report.value) && isObject(report.value.actions) ? report.value.actions : null
      if (acts === null) failure = 'no report from the cleanup script'
      else if (Array.isArray(acts.worktrees_kept)) for (const w of acts.worktrees_kept) if (isObject(w) && typeof w.path === 'string') kept.set(normalizeAbs(w.path), typeof w.why === 'string' ? w.why : 'kept')
    } catch (e) {
      failure = e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : 'cleanup failed'
    }
    for (const x of targets) {
      const gone = !(await $.fs.exists(x).catch(() => true))
      results[x] = gone ? { ok: true, note: '' } : { ok: false, note: failure !== '' ? failure : kept.get(normalizeAbs(x)) ?? 'the cleanup script did not handle this path' }
    }
  }
}

// One prompt carries every answered question that was not sent yet. The questions are marked sent BEFORE the prompt goes, so a second press cannot send them twice;
// a prompt the session refuses takes the marks back. The prompt starts a turn once the session is idle: it is not awaited here.
// The guard is a module flag taken before the first await: two presses landing together (a double click) both run this function before either has written its marks.
let sending = false
async function sendDecide($: EngineInterface): Promise<void> {
  if (sending) return
  sending = true
  try {
    const reply = decideReply(snapshot === null ? [] : snapshot.pending, await read($, DECIDE))
    if (reply === null) return
    const at = await $.clock.now()
    await update($, DECIDE, s => ({ ...s, sent: { ...s.sent, ...Object.fromEntries(reply.ids.map(i => [i, at])) } }))
    $.prompt.submit({ text: reply.text }).catch(async () => {
      await update($, DECIDE, s => { const sent = { ...s.sent }; for (const i of reply.ids) delete sent[i]; return { ...s, sent } })
    })
  } finally {
    sending = false
  }
}

// An edit of a note field (`note:<id>`).
async function decideNote($: EngineInterface, key: string, value: string): Promise<void> {
  if (!key.startsWith('note:')) return
  const id = key.slice(5)
  try {
    await update($, DECIDE, s => ({ ...s, notes: { ...s.notes, [id]: value } }))
  } catch (_e) {
    // keep the last text
  }
}

// Forget the picks and notes of questions that left the list, and sent marks a day old. Writes only when something is dropped (a write redraws the pane).
async function pruneDecide($: EngineInterface, listed: ReadonlySet<string>, ok: boolean, nowMs: number): Promise<void> {
  const st: DecideState = await read($, DECIDE)
  const gone = (id: string): boolean => !listed.has(id) && (st.sent[id] !== undefined ? nowMs - st.sent[id] > DECIDE_KEEP_MS : ok)
  const ids = new Set([...Object.keys(st.picks), ...Object.keys(st.notes), ...Object.keys(st.sent)])
  const drop = [...ids].filter(gone)
  if (drop.length === 0) return
  const keep = <V,>(o: Record<string, V>): Record<string, V> => Object.fromEntries(Object.entries(o).filter(([id]) => !drop.includes(id)))
  await update($, DECIDE, s => ({ ...s, picks: keep(s.picks), notes: keep(s.notes), sent: keep(s.sent) }))
}

const nextTab = (t: PaneTab): PaneTab => PANE_TABS[(PANE_TABS.indexOf(t) + 1) % PANE_TABS.length]

// After a press on a tab Button (a click, or Tab / arrows + Enter) the keyboard ring returns to the `›` chip, so the next Enter steps on instead of
// re-pressing the tab that was just chosen. Best effort: a pane that does not hold the keys refuses, and the tab has switched anyway.
async function ringToNext($: EngineInterface): Promise<void> {
  try {
    await $.ui.focus({ requestId: PANE_ID, key: 'next' })
  } catch (_e) {
    // not holding the keyboard: nothing to move
  }
}

// the live mod's session start. A function of its own because Claude Code refuses a second matcher-less `session.start` hook in one plugin: the composed module
// (mods/register.ts) registers the one hook and calls this and the viewer's start; the live mod's own tests use `register` below, which hooks it alone.
export async function startLive($: EngineInterface): Promise<void> {
  paneTab = 'now'
  folded.clear() // a new Claude Code session opens every section
  pressSeq += 1 // presses still in flight become stale: they assign nothing and leave the chain alone
  decided = null
  if (timer === undefined) timer = $.clock.every(TICK_MS, () => refresh($))
  await refresh($)
}

// every hook of the live mod except `session.start`
export function registerLive(on: Parameters<Register>[0]): void {
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
    // the ⓘ opens the panel on the Now tab; pressed again while the panel is open it shows the next tab (7 tabs, the ? legend last, then Now again) (the pane never gets the keyboard
    // while the person holds the ⓘ, so this is the keyboard way to change tab). "Open" is the engine's own record, $.ui.panes() (the pane
    // is listed until it closes, however it was opened). No hotkey: the band's autoFocus puts the keyboard path at Ctrl+x Tab, Enter.
    const info = async () => {
      const seq = ++pressSeq
      const prev = decided
      const nextOf = nextTab
      const mine: Promise<PaneTab> = (async () => {
        if (prev !== null) return nextOf(await prev) // an earlier press is still deciding / opening: $.ui.panes() may not list the pane yet
        let isOpen = false
        try {
          isOpen = (await $.ui.panes()).some(p => p.id === PANE_ID)
        } catch (_e) {
          // the engine could not list panes: treat the pane as closed (Now)
        }
        return isOpen ? nextOf(paneTab) : 'now'
      })()
      decided = mine
      try {
        const tab = await mine
        if (seq === pressSeq) paneTab = tab
        $.ui.invalidate('ui.render')
        await $.ui.open({ id: PANE_ID, title: 'Autopilot', focus: true, closeOnEscape: true })
      } finally {
        if (seq === pressSeq) decided = null
      }
    }
    // a slot pressed opens the pane on the tab that explains it (model.ts slotTab). It is a press like the ⓘ's: it takes a sequence number, so an
    // ⓘ press still in flight becomes stale and cannot drag the tab back, and it records its tab as `decided` while its open is in flight, so an
    // ⓘ landing meanwhile steps on from the slot's tab instead of reading a pane $.ui.panes() does not list yet.
    const slot = async (id: SlotId) => {
      const seq = ++pressSeq
      const tab = slotTab(id)
      decided = Promise.resolve(tab)
      paneTab = tab
      const unfold = slotUnfolds(id)
      if (unfold !== null) folded.delete(unfold)
      try {
        $.ui.invalidate('ui.render')
        await $.ui.open({ id: PANE_ID, title: 'Autopilot', focus: true, closeOnEscape: true })
      } finally {
        if (seq === pressSeq) decided = null
      }
    }
    return Band($.ui.resolve(e), snapshot, e.props.bodyColumns, info, tr, slot)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => (hostScrollHome($, e.props.scroll, paneTab), decideScroll.redraw = () => { void $.ui.invalidate('ui.render') }, Pane($.ui.resolve(e), snapshot, paneTab, (t: PaneTab) => { paneTab = t; $.ui.invalidate('ui.render'); void ringToNext($) }, tr, e.props.bodyColumns, () => { paneTab = nextTab(paneTab); $.ui.invalidate('ui.render') }, expanded, (id: string) => { const set = isSectionId(id) ? folded : expanded; if (!set.delete(id)) set.add(id); $.ui.invalidate('ui.render') }, folded, e.props.scroll ?? null, { state: await read($, DECIDE), inputs: SURFACES_WITH_INPUT.has(e.surface), onPress: (id: string) => { void decidePress($, id) }, onNote: (key: string, value: string) => { void decideNote($, key, value) } }, decideScroll)))

  // The 待決 tab draws its own scrolling window (scroll.tsx), so the person's scroll keys there move the mod's offset and never reach the engine; every other tab keeps the engine's own
  // scrolling (`next(e)`).
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    return scrollHook(decideScroll, e, next, () => { void $.ui.invalidate('ui.render') })
  })
}
const decideScroll = newScroll()

// The 待決 tab is exactly the pane's height, so the engine's own window must stand at 0 there; one left scrolled by another tab (the engine keeps one offset per pane) would hide the
// strip. Best effort: a pane that holds no keys refuses, and the next draw asks again.
function hostScrollHome($: EngineInterface, scroll: { offset: number } | undefined, tab: PaneTab): void {
  if (tab === 'decide' && scroll !== undefined && scroll.offset > 0) void $.ui.scroll({ in: PANE_ID, to: 'start' }).catch(() => undefined)
}

export const register: Register = on => {
  registerLive(on)
  on('session.start', async ($, e, next) => {
    await startLive($)
    return next(e)
  })
}
