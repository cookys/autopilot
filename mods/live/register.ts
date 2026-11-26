// mods/live/register.ts — the `live` mod (mods plan P1c; Claude Code only).
//
// Reads files the project watcher publishes and draws a band above the prompt, a pane in a wide fullscreen
// terminal and a toast on an axis change. It starts no program. The one file it writes is
// `<live_base>/autopilot/band-facts/<sanitised sid>.json` (numbers and the shared contract, for the statusline; mods/band-statusline-map.md).
// The one thing it sends to the model is the owner's
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
//            The band is ONE line (band.tsx, layout in model.ts layoutBand); the i opens the pane on the Now tab (7 tabs: Now Decide Dispatch Review Spend Hygiene ?).
//
//   i18n     every word comes from mods/live/locales/{en,zh-TW}.json (compiled to locales.ts) through `t`; the locale is resolved on every tick:
//            ~/.autopilot/config.json ui.locale > AUTOPILOT_LOCALE > Claude Code's language setting ($.config.list() row `language`, else the
//            user settings.json) > LC_ALL / LANG > en
//
// $.session.id() is read on EVERY tick: /clear gives the session a new id while the timer keeps running (S7).
// Every clock comparison uses $.clock.now(), so a test with a mocked clock decides fresh / stale.

import { probePane } from './pane-probe'
import { appendSendLog } from './sendlog'
import type { EngineInterface, Register } from 'claude-code'

import { newTracker, parseAdvisories, takeNew } from './advisories'
import { makeT, resolveLocale, T_EN } from './i18n'
import type { T } from './i18n'
import { atom, read, update } from 'claude-code'
import type { AdvisoryTracker } from './advisories'
import { GLYPHS } from '../tux/glyphs.ts'
import { DISMISS_PRESS, forgeBar, forgeFit, LOOK_PRESS, SHOW_PRESS, showTarget, stateOf } from './ui'
import type { ForgeSegment } from './ui'
import { cardSentenceOf } from './cardtitle'
import { NO_BATCH, actionable, answerPlan, answerOf, batchSync, cardKey, draftOf, focusRepair, inputsFor, noteKey, optKey, submitSuccessor } from './decidebatch'
import type { DecideBatch } from './decidebatch'
import { applyPick, holdSend, reopen, sendNow, tickHold, undoHold, writeV74Answers } from './decideundo'
import type { ClaimCard, UndoDeps } from './decideundo'
import { BAND_MIN_COLS, BAND_PAGE_TABS, FORGE_LABEL_MIN, barStrip, decideTabLines, usageTabFits } from './tabs'
import { findConsoleConfig, parseConsole } from './console'
import { CONSOLE_FILE, CONSOLE_TIMEOUT_MS, makeConsoleFeed } from './consolefeed'
import type { ConsoleSnapshot } from './console'
import { consoleSlotTab, nextConsoleTab } from './consoletabs'
import type { ConsoleNav, ConsoleTab } from './consoletabs'

import { BandBar, bandQuotaSeg, BarRule, OneRowBand, Shell, barContent, barParts, cardMain, cardQuick, ShellBare, decideContent, progressRow, cardSplit, shellMenuRow, shellNote, speedContent, stackBand, stackRows, usageDraw } from './band'
import type { SpeedPlacement } from './band'
import { bandExpandOnPageChange, bandExpandOnRefresh, bandExpandOnResize, bandSlotPage, dataStateOf, initialBandExpand, layoutOneRowBand, toggleBandExpand } from './band-onerow'
import type { BandExpandState, BandSegmentId, OneRowInput } from './band-onerow'
import { normalizedPools } from './pages/quota-pick'
import { consoleFleetCounts } from './pages/rows'
import { KEEP_STEPS, petTag, serverToolMs, STEPS_SHAPE, stepRate, validSteps } from './speed'
import type { Step } from './speed'
import { COL_GAP, SPEED_ROWS, speedLabelParts, speedView } from './speedview'
import { FLEET_SUMMARY_V, fleetSummary, fleetView, makeFleetFeed, othersView, utf8Bytes } from './fleet'
import type { FleetSummary, FleetTask, FleetView } from './fleet'
import type { BandPageId, BarTabId, ScrollView } from './tabs'
import { BODY_ROWS, MAIN_CONTENT_ROWS, SHELL_MENUS, SHELL_MIN_ROWS, SHELL_ROWS, type ShellMenuId, type ShellPlan, cardRows, freshCount, isCompact, leftItems, leftTitle, legacyUsageRows, newestSeq, nextShellMenu, parseRoom, progressSegs, roomLines, shellContentRows, shellGeometry, shellPlan } from './shell'
import { collapsedRowMark, initialBandCollapsed, toggleBand, toggleFold, type BandTarget } from './bandfold'
import type { Card } from './shell'
import type { LeftItem } from './shell'
import type { FleetLaneSum, RoomRow } from './shell'
import { focusAnchorKey, Pane, noteInputKey, resetNoteInputs } from './pane'
import { routeKey } from './pages/keys'
import { PANE_COLS, wideNext } from './wide/geometry'
import { WIDE_TABS, wideBand, wideStatusText } from './wide/band'
import { WideBandTree } from './wide/tree'
import type { PaneModel } from './wide/pane'
import type { KeyAction } from './pages/keys'
import { decideReduce, NO_NAV, v74Pool } from './pages/decide'
import type { DecideNav } from './pages/decide'
import { DECIDE_COMPACT_MAX_ROWS, decideLayoutMode } from './pages/layout'
import type { DecideLayoutMode } from './pages/layout'
import { SEATS_TIMEOUT_MS, seatQuota, v74PmCounts } from './pages/now'
import { PAGES, EXTRA_PAGES } from './pages/index'
import { ASKS_LIST_TAIL, cutTitle, makeAsksFeed, makeDecideFeed, makePmFeed, mergeDecideCards } from './v74/feeds'
import { askBandRows } from './askband'
import { offerTodo, pickIndex, PICK_KEYS, V74_PAGES } from './v74/contract'
import type { CardNav, DecideCard, PmStatus, TodoCard, V74Ctx } from './v74/contract'
import { v74Keylog } from './v74/keylog'
import { frameHeight } from './pages/frame'
import type { PageId } from './pages/frame'
import { FOLD_AT, rowsOf as fleetRowsOf } from './pages/fleet'
import { DEFAULT_REVIEW_VIEW } from './pages/review'
import { spendFocusRows } from './pages/spend'
import { FILL_PRESS } from './commandtab'
import { type ScrollModel, applyScroll, fixedWindow, keyed, newScroll, scrollHook } from './scroll'
import type { ShowRequest } from '../viewer/model'
import { reopenLook, showPath } from '../viewer/show'
import {
  acceptanceToast, autoResidueCount, bandCardNote, decideDialog, decideFillText, decideFixing, decideHeld, decideLine, decideOpen, decidePick, cleanTargets, normalizeAbs, decideReply, NO_DECIDE, makeRecentTracker, bandFactsDocument, bandLine1, bandView, buildSections, checkEnvelope, sourceMoved, sourcesOf, commonDirOf, commonDirOfGitdir, gitdirOfGitFile, countsOf, ctxShown, ctxText, earliestReceiptMs, executionToast,
  isStepCard, BAND_NARROW_STEPS, displayWidth, fittedBandWidth, layoutBand, layoutBandLine, v74FitBand, slotFleet, headerText, hhmm, projectName as projectNameOf, isKey, isSectionId, isObject, isPlainRoot, jobOf, longestPrefixKey, mergeDecisions, mergeDurableDecisions, mergeEnvelopes, mergeJobModels, NO_SECTIONS, PANE_TABS, paneRows, parseJson, portOf, readAttention, readTurn, readDecisions, readDurableDecisionFiles,
  readForeman, readLoadSource, readSpendHistory, hourlySpend, readJobModel, readManifest, readMarker, readQc, readQcAt, readResidue, readReview, readStageWalk, readTasks, reviewLink, sanitizeSid, scopeKeyOf, sessionUsd,
  paneWidth, DEFAULT_PANE_COLS, slotTab, slotUnfolds, sparkText, truncateToWidth, spendOf, startMsOf, stateText, stalledCount, POINTER_SCHEMA, NO_DETAIL, usd, scanBackground, lastOutputLine, bgLabel, readQuota, readAccount,
} from './model'
import type { AccountView, ActivityItem, Counts, DecideState, DecisionsView, RecentGroup, EnvelopeCheck, JobModel, Json, LiveDecision, LiveSnapshot, LookTarget, Manifest, DurableAwaiting, PaneLine, PaneTab, Seg, Slot, SlotId, QuotaWindow, Sources, SourceGroup } from './model'

const TICK_MS = 5000
const FACTS_PRUNE_MS = 60_000
const FACTS_TMP_STALE_MS = 5 * 60 * 1000
const PANE_ID = 'autopilot-live'
const V74_FRAME_MIN = 4
const V74_FRAME_MAX = 28 // design S2..S10 measure 28 rows from ╭ to ╰ (26 body rows + both borders; r8 #6 had 27). V74_FRAME_MIN: the smallest v7.4 page frame (two borders and two inner rows, so 80x24 can open); under it only the band row draws
const MAX_PATH_FILES = 256
const MAX_RECEIPT_FILES = 64
const MAX_CAMPAIGN_ROOTS = 8 // session-mode.js CAMPAIGN_ROOTS_MAX

// Module state. A hot reload drops it and session.start rebuilds it (the first tick refills the snapshot at once).
// What the owner picked and typed on the 待決 tab is NOT here: a drawing's inputs belong in $.state (below), so a hot reload keeps them.
let snapshot: LiveSnapshot | null = null
// the 待決 tab's picks, notes and what was already sent, by decision id (the contract is types/index.d.ts, named by plugin.json)
const DECIDE = atom({ plugin: 'autopilot', key: 'decide' } as const, NO_DECIDE)
// the timed model requests (speed.ts); a list stored under another shape tag is dropped, it was timed by another method
const STEPS = atom({ plugin: 'autopilot', key: 'steps' } as const, [] as Step[], { shape: STEPS_SHAPE })
const DECIDE_KEEP_MS = 24 * 3600 * 1000 // a sent question the session never closed is forgotten after a day
let timer: { cancel: () => void } | undefined
let liveBaseSeen: string | null = null // the live base the pointer named on the last tick (codeforge's pet.json sits under it)
let factsPrunedAt = -Infinity // band-facts cleanup runs at most once a minute; session.start resets it
let petText: string | null = null // `Name Lv.N` from codeforge's pet.json, read every refresh; null draws no pet
let paneTab: PaneTab = 'now'
let panePage: PageId = 'now'
// the Fleet tab's feed (fleet.ts): `fleet tasks --tree --json`, kicked on every tick and when the Fleet tab is drawn. The TTL inside the feed keeps the runs 30 s apart.
// Never awaited by a render.
const fleetFeed = makeFleetFeed()
const pmFeed = makePmFeed()
const decideFeed = makeDecideFeed()
const asksFeed = makeAsksFeed()
let durableOpenCards: DecideCard[] = [] // open-decision.js store, refreshed with the snapshot; merged with the fleet list by card id
let durableAwaiting: DurableAwaiting[] = [] // the store's answered cards still waiting on the operator's own step (awaiting_operator_action); the decide page's 等你動手 block
const durableClosedIds = new Set<string>() // ids s wrote to the card store; the fleet list can still name them until the next fetch
export function v74ArrowFromScroll(page: string, by: number): { kind: 'move'; by: 1 | -1 } | null {
  if ((page !== 'decide' && page !== 'todo') || by === 0) return null
  return { kind: 'move', by: by > 0 ? 1 : -1 }
}
// Host ui.scroll (scrollmath.ts: the event is { component, by, offset, bodyRows, contentRows }).
// AbovePrompt is the band site. A one-row by on any other component except Pane is the same arrow:
// spatial focus does not emit ui.scroll, and a Down that still arrives as scroll must move the cursor.
export function v74HostScroll(e: { by?: number; component?: string }, page: string, open: boolean, legacy: boolean | null, textMode: boolean): { kind: 'move'; by: 1 | -1 } | null {
  if (!open || legacy === true || textMode) return null
  if (e.component === 'Pane') return null
  if (typeof e.by !== 'number' || e.by === 0) return null
  if (e.component !== 'AbovePrompt' && e.component !== undefined && Math.abs(e.by) !== 1) return null
  return v74ArrowFromScroll(page, e.by)
}
export function v74FocusAt(e: { element?: unknown; key?: unknown }): number | null {
  return v74CursorFromFocus(e.element) ?? v74CursorFromFocus(e.key)
}
// Speed text for the v7.4 band, including when nothing was timed (the bare row and the snapshot row).
export function v74SpeedText(steps: readonly Step[], pet: string | null = null): string {
  const parts = speedLabelParts(steps, pet) ?? [
    { role: 'bolt' as const, text: GLYPHS.structure.speed + ' ' },
    { role: 'value' as const, text: GLYPHS.structure.empty },
    { role: 'unit' as const, text: ' tok/s' },
  ]
  return parts.map(s => s.text).join('')
}
// tok/s and the fleet word stay on the v7.4 row. Dropping the word left `│  │` where 艦隊 had been.
const V74_NARROW = BAND_NARROW_STEPS.map(step => step.filter(id => id !== 'speed' && id !== 'fleetWord')).filter(step => step.length > 0)
function v74SpeedParts(steps: readonly Step[], pet: string | null) {
  return speedLabelParts(steps, pet) ?? [
    { role: 'bolt' as const, text: GLYPHS.structure.speed + ' ' },
    { role: 'value' as const, text: GLYPHS.structure.empty },
    { role: 'unit' as const, text: ' tok/s' },
  ]
}
export function v74CursorFromFocus(element: unknown): number | null {
  if (typeof element !== 'string') return null
  const m = /^card:(\d+)$/.exec(element)
  return m === null ? null : Number(m[1])
}
// A focus event whose element is already the cursor's card must not write that index again.
// The host sends focus card:N and then the cursor event; applying the focus index last puts the ▸ back.
export function v74FocusCursor(cursor: number, element: unknown): { kind: 'cursor'; at: number } | null {
  const at = v74CursorFromFocus(element)
  if (at === null || at === cursor) return null
  return { kind: 'cursor', at }
}
// r7-1 keylog: with the selected head no longer a Button, the band's focus ring sits on the current
// tab (tab:decide) and the arrows walk it along the strip (tab:dispatch, tab:review, ...) without a
// ui.scroll. On the 待決/待辦 pages a person's move to another tab is the arrow: the ring stays and the
// cursor moves. Tab order is the strip's (V74_PAGE_ORDER); a jump of more than one is the wrap.
const V74_PAGE_ORDER = ['now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'fleet', 'todo', 'help']
export function v74TabStep(page: string, element: unknown, origin: unknown): { kind: 'move'; by: 1 | -1 } | null {
  if ((page !== 'decide' && page !== 'todo') || typeof element !== 'string') return null
  if ((origin as { kind?: unknown } | undefined)?.kind !== 'person') return null
  const m = /^tab:(\w+)(?::\d+)?$/.exec(element)
  if (m === null || m[1] === page) return null
  const from = V74_PAGE_ORDER.indexOf(page)
  const to = V74_PAGE_ORDER.indexOf(m[1])
  if (from < 0 || to < 0) return null
  const d = to - from
  const by = Math.abs(d) === 1 ? d : -Math.sign(d)
  return { kind: 'move', by: by > 0 ? 1 : -1 }
}
// the 現況 page's 產線 counts (✗ fail, ⊘ parked, ⋯ unknown, ◉ running) as the band's chips: failed, stuck(⊘), waiting(⋯), running
export function v74LineCounts(pm: PmStatus): { failed: number; stuck: number; running: number; waiting: number; normal: number } {
  const c = v74PmCounts(pm)
  return { failed: c.fail, stuck: c.idle, running: c.ok, waiting: c.unknown, normal: 0 }
}
export function v74BareBandSlots(own: string, fleet: { stuck: number; running: number; waiting: number } | null, decideN: number, t: T): Slot[] {
  const fleetSlot = slotFleet(fleet ?? { stuck: 0, running: 0, waiting: 0 }, t, true)
  return [
    { id: 'verdict', segs: [{ text: own.split(' · ')[0], bold: true }] },
    ...(fleetSlot === null ? [] : [fleetSlot]),
    { id: 'hygiene', segs: [{ text: t('v74.b.source_word'), dim: true, tag: 'chip' }, { text: ' ', tag: 'chip' }, { text: t('band.src_unknown'), dim: true, tag: 'chip' }] },
    { id: 'decide', segs: [{ text: t('v74.b.decide_word'), dim: true, tag: 'chip' }, { text: ' ', tag: 'chip' }, { text: String(decideN), tag: 'chip' }] },
  ]
}
function mergedDecide(): DecideCard[] | null {
  const merged = mergeDecideCards(decideFeed.cards(), durableOpenCards)
  if (merged === null || durableClosedIds.size === 0) return merged
  return merged.filter(c => !durableClosedIds.has(c.id))
}
function liveToDecideCard(d: LiveDecision): DecideCard | null {
  if (d.id === null || d.id === '') return null
  return {
    id: d.id, title: d.title ?? (d.question !== '' ? cutTitle(d.question) : d.id.slice(0, 8)), question: d.question, background: d.background,
    options: d.options.map(o => ({ label: o.label, detail: o.description, recommended: d.recommendation === o.label })),
  }
}
const NO_V74_NAV: CardNav = { cursor: 0, picks: {}, notes: {}, noteMode: false }
const V74_NAV = atom({ plugin: 'autopilot', key: 'v74_nav' } as const, NO_V74_NAV)
function kickV74($: EngineInterface, nowMs: number): void {
  const run = (argv: readonly string[]) => $.process.run(argv, { timeoutMs: 8000 })
  void pmFeed.refresh(run, nowMs).then(r => { if (r) void $.ui.invalidate('ui.render') }).catch(() => {})
  void decideFeed.refresh(run, nowMs).then(r => { if (r) void $.ui.invalidate('ui.render') }).catch(() => {})
  // pm-ask.js shares one grouping algorithm with the CLI; AUTOPILOT_PM_ASK_BIN overrides the script path (tests, a pinned copy)
  void $.env.get('AUTOPILOT_PM_ASK_BIN').then(bin => {
    const script = typeof bin === 'string' && bin.trim() !== '' ? bin.trim() : $.plugin.root + '/scripts/pm-ask.js'
    return asksFeed.refresh(run, ['node', script, ...ASKS_LIST_TAIL], nowMs)
  }).then(r => { if (r) void $.ui.invalidate('ui.render') }).catch(() => {})
}
const V74_TODO: TodoCard[] | null = null // the todo source (fleet todo --json) is not wired: decision cards do not offer `待辦` (offerTodo) until it is
async function v74CtxOf($: EngineInterface, withStore = false): Promise<V74Ctx> {
  const nav = await read($, V74_NAV)
  // The host Pane's 待決 tab stays the retired pointer. Only the band box merges the card store.
  const decide = offerTodo(withStore ? mergedDecide() : decideFeed.cards(), V74_TODO)
  const pmErr = pmFeed.error()
  const decErr = decideFeed.error()
  const fltErr = fleetFeed.error()
  const fleetSum = await read($, FLEET)
  return {
    pm: pmFeed.status(),
    pmFetchedMs: pmFeed.fetchedMs(),
    pmError: pmErr,
    decide,
    awaiting: durableAwaiting,
    decideFetchedMs: decideFeed.fetchedMs(),
    decideError: decErr,
    fleetError: fltErr,
    fleetSummary: fleetSum,
    todo: V74_TODO,
    nav,
    keysHeld: v74KeysHeld,
    sendResult: v74SendResult,
    ages: { now: pmFeed.fetchedMs(), decide: decideFeed.fetchedMs(), fleet: fleetFeed.fetchedMs() },
    errors: { now: pmErr, decide: decErr, fleet: fltErr },
  }
}
// The summary other plugins read (PM G33a; fleet.ts `FleetSummary`, `v: 1`): written by the feed after each run, success or failure, never while drawing. Each row is counted
// by the state the Fleet tab draws for it, so the band reader and the tab never disagree.
const FLEET = atom({ plugin: 'autopilot', key: 'fleet' } as const, { v: FLEET_SUMMARY_V, fetchedMs: null, error: null, capped: 0, totals: { needYou: 0, failed: 0, stuck: 0, running: 0, waiting: 0 }, lanes: [], topStuck: null } as FleetSummary)
const fleetState = (task: FleetTask): string => stateOf('fleetTask', { state: task.state, stuck: task.stuck !== null, stale: task.stale }).id
function kickFleet($: EngineInterface, nowMs: number): void {
  void fleetFeed.refresh(argv => $.process.run(argv, { timeoutMs: 5000 }), nowMs).then(async ran => {
    if (!ran) return
    await update($, FLEET, () => fleetSummary(fleetView(fleetFeed, nowMs), fleetState))
    void $.ui.invalidate('ui.render')
  }, () => {}).catch(() => {})
}
// codeforge's forge-stats band is drawn in this session: its heartbeat `<live_base>/codeforge/mod-alive/<sid>.json` (schema codeforge.mod-alive/1, written every 2 s) is this
// session's, at most FORGE_ALIVE_MS old and says layout `band`. `summaryRow`: it also says `summary_row: true`, the forge-stats that draws the one-line summary on the row
// under the band (PM G33, TUI guideline 1.1 rule 3). An older one answers a one-row ask with its own speed label, so it is never handed that row (BL-0359).
// The file is stat'ed before it is read: only a regular file, not itself a symbolic link, at most FORGE_ALIVE_MAX_BYTES; then the text is held to the same bound in UTF-8
// bytes. A link, a directory, a FIFO or device, a big file or any error is no heartbeat, and the tick goes on. `$.fs` has no lstat and no bounded read, so a file swapped
// between the stat and the read is held only by the size check after. Read by the tick only, never by a render.
const FORGE_ALIVE_MS = 10_000
const FORGE_ALIVE_MAX_BYTES = 4096
export async function forgeAliveAt($: EngineInterface, liveBase: string, nowMs: number): Promise<boolean> {
  try {
    const sid = await $.session.id()
    const path = liveBase + '/codeforge/mod-alive/' + sanitizeSid(sid) + '.json'
    const st = await $.fs.stat(path)
    if (st.kind !== 'file' || st.isLink || !(st.size <= FORGE_ALIVE_MAX_BYTES)) return false
    const text = await $.fs.read(path)
    if (typeof text !== 'string' || text.length > FORGE_ALIVE_MAX_BYTES || utf8Bytes(text) > FORGE_ALIVE_MAX_BYTES) return false
    const parsed = parseJson(text)
    if (!parsed.ok || !isObject(parsed.value)) return false
    const v = parsed.value
    const age = typeof v.written_at_ms === 'number' ? nowMs - v.written_at_ms : NaN
    return v.schema === 'codeforge.mod-alive/1' && v.session_id === sid && v.layout === 'band' && age >= 0 && age < FORGE_ALIVE_MS && v.summary_row === true
  } catch (_e) {
    return false
  }
}
async function forgeBand($: EngineInterface, nowMs: number): Promise<boolean> {
  return liveBaseSeen === null ? false : forgeAliveAt($, liveBaseSeen, nowMs)
}
let forgeSummaryRow = false // set by the tick from the heartbeat; the band's draw reads it, never the file
async function fleetFor($: EngineInterface): Promise<FleetView | null> {
  if (paneTab !== 'fleet') return null
  const nowMs = await $.clock.now()
  kickFleet($, nowMs)
  return fleetView(fleetFeed, nowMs, await readOthers($, nowMs))
}
// The other hosts' cards: two files the PM host keeps in its state dir (scripts/fleet-card-mirror.js; AUTOPILOT_CARD_MIRROR_DIR, else XDG_STATE_HOME or HOME/.local/state, then autopilot/).
// Read only, while the Fleet tab is drawn; nothing is run and nothing is written.
async function readOthers($: EngineInterface, nowMs: number): Promise<ReturnType<typeof othersView>> {
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '') // $.env.get takes a literal name at every call site (the mod loader refuses a variable)
  const over = text(await $.env.get('AUTOPILOT_CARD_MIRROR_DIR').catch(() => undefined))
  const xdg = text(await $.env.get('XDG_STATE_HOME').catch(() => undefined))
  const home = text(await $.env.get('HOME').catch(() => undefined))
  const dir = over !== '' ? over : xdg !== '' ? xdg.replace(/\/$/, '') + '/autopilot' : home !== '' ? home.replace(/\/$/, '') + '/.local/state/autopilot' : null
  if (dir === null) return othersView(null, null, nowMs)
  return othersView(await readText($, dir.replace(/\/$/, '') + '/fleet-card-mirror.json'), await readText($, dir.replace(/\/$/, '') + '/fleet-card-todo.json'), nowMs)
}
// one tick of the shared timer: the Fleet fetch rides along (never awaited, its failure dropped) and the tick returns refresh's promise, as before G23, rather than
// dropping it (review g1). Nothing awaits that promise today: the engine's `$.clock.every` ignores what its callback returns and the test kit's `clock.advance`
// resolves once the event loop settles; refresh catches its own failures. ui-lint TICK_SHAPE holds the shape.
export function liveTick($: EngineInterface): Promise<void> {
  void fleetTick($).catch(() => {})
  return refresh($)
}
async function fleetTick($: EngineInterface): Promise<void> {
  const nowMs = await $.clock.now()
  await consoleTick($).catch(() => undefined) // the console mode and its snapshot (below); the tick is the only place either is read
  // NOT gated by the console mode: the framed pages (現況 · 待決 · 艦隊 · 額度 · 花費 ...) are drawn in every session and read the seat quota row and the console snapshot,
  // so the polls run whether the pane is open or not and whatever .claude/console.json says (pane-poll.test.ts holds this)
  void seatQuota.refresh(argv => $.process.run([...argv], { timeoutMs: SEATS_TIMEOUT_MS }), nowMs).then(ran => { if (ran) void $.ui.invalidate('ui.render') }, () => undefined) // the 現況 page's seat quota row: 60 s cache inside the feed, never awaited by a render
  forgeSummaryRow = await forgeBand($, nowMs)
  kickFleet($, nowMs) // the band's own fleet segment reads the summary this publishes; the feed's TTL spaces the runs
  kickV74($, nowMs)
  await shellTick($, nowMs).catch(() => undefined)
}
// ---- the O4 shell (shell.ts): the render never reads a file; the tick keeps what it draws from while the shell is on screen ----
const SHELL_SEEN_MS = 15_000 // the shell counts as open while it was drawn this recently
const PANEL_OPEN_EVERY_MS = 15_000 // forge-stats reads `autopilot.panel_open_at_ms` and refreshes the quota mirror only while it is within a minute
let shellDrawnMs = -Infinity
let shellRoom: { rows: RoomRow[]; raw: string } = { rows: [], raw: '' }
let shellBaseline: number | undefined // the newest roundtable seq when the shell opened (✦ counts what came after); undefined = taken at the next read
let panelOpenWrittenMs = -Infinity
const PANEL_OPEN = atom({ plugin: 'autopilot', key: 'panel_open_at_ms' } as const, 0)
const ROOM_RE = /^[a-z0-9-]+$/
const MAX_ROOM_BYTES = 2_000_000 // a longer log keeps the last read (the roundtable pane reads it whole; the band does not)
// the newest room's log text, '' when there is none. The rooms directory is the roundtable mod's: AUTOPILOT_ROOMS_DIR, else HOME/.autopilot/rooms.
async function readRoomText($: EngineInterface): Promise<string | null> {
  try {
    const over = await $.env.get('AUTOPILOT_ROOMS_DIR').catch(() => undefined)
    const home = await $.env.get('HOME').catch(() => undefined)
    const dir = typeof over === 'string' && over.trim() !== '' ? over.trim() : typeof home === 'string' && home.trim() !== '' ? home.replace(/\/$/, '') + '/.autopilot/rooms' : null
    if (dir === null) return ''
    let best: { name: string; mt: number } | null = null
    for (const e of await $.fs.list(dir)) {
      if (e.kind !== 'dir' || !ROOM_RE.test(e.name)) continue
      const mt = typeof (e as { mtimeMs?: number }).mtimeMs === 'number' ? (e as { mtimeMs: number }).mtimeMs : 0
      if (best === null || mt >= best.mt) best = { name: e.name, mt }
    }
    if (best === null) return ''
    const path = dir.replace(/\/$/, '') + '/' + best.name + '/room.jsonl'
    const st = await $.fs.stat(path)
    if (st.kind !== 'file' || st.isLink || !(st.size <= MAX_ROOM_BYTES)) return null
    return String(await $.fs.read(path))
  } catch (_e) {
    return '' // no rooms directory, no log: an empty column, not an error
  }
}
async function shellTick($: EngineInterface, nowMs: number): Promise<void> {
  if (nowMs - shellDrawnMs > SHELL_SEEN_MS) { shellBaseline = undefined; return }
  if (nowMs - panelOpenWrittenMs >= PANEL_OPEN_EVERY_MS) {
    panelOpenWrittenMs = nowMs
    await update($, PANEL_OPEN, () => nowMs).catch(() => undefined)
  }
  const raw = await readRoomText($)
  if (raw === null) return
  if (shellBaseline === undefined) shellBaseline = newestSeq(raw === shellRoom.raw ? shellRoom.rows : parseRoom(raw)) ?? 0 // taken before the unchanged-log return: a reopened shell on an old (or empty) log still gets its baseline
  if (raw === shellRoom.raw) return
  const rows = parseRoom(raw)
  shellRoom = { rows, raw }
  void $.ui.invalidate('ui.render')
}
let decideCursor = 0 // the card the O4 shell's main window shows (an index into the band's batch, bandBatch: the pending cards and the ones closed elsewhere; clamped at every draw)
let decideLastId: string | null = null // the card answered last from the shell (the progress row names it)
// ---- the operator-console mode (plan §3.1; consoletabs.ts): on only where the session's repo has .claude/console.json = {"schema":"autopilot.console/1","mode":"program"} (findConsoleConfig; optional
// "ingest_from": "<address>=pace ..." passes validated ^[a-z0-9._-]+/[a-z0-9._-]+/[a-z0-9._-]+=[a-z]+$ tokens via FLEET_CONSOLE_INGEST_FROM, omitted when absent/empty). Off, the band and
// the legacy console pane are what they were; the snapshot itself (consoleSnap) is still polled, because the framed pages read it in every session. ONE navigation state (consoleTab) for the band's tabs and the pane's: pressing either sets it, both draw it.
// The snapshot comes from consoleSource (a top-level function declaration: the mod loader follows `$` only into declared functions, so it cannot be a swappable variable); it comes from consolefeed.ts: `fleet console --json` (at most once a minute, never while drawing), else the courier's HOME/.local/state/fleet/console.json; neither = null = no source. ----
let consoleOn = false
let consoleTab: ConsoleTab = 'command'
let consoleSnap: ConsoleSnapshot | null = null
let consoleCwd: string | null = null // the cwd the mode was last read for; a different cwd (a new session in another repo) reads it again at the next tick
let consoleReadMs = -Infinity
let consoleIngestFrom: string | null = null
const CONSOLE_MODE_EVERY_MS = 10_000 // the config file is read again at most this often
let consoleFeed = makeConsoleFeed() // per session: startLive makes a new one, so the 60 s throttle and the snapshot of an earlier session do not leak
async function consoleSource($: EngineInterface): Promise<ConsoleSnapshot | null> {
  const nowMs = await $.clock.now()
  const before = consoleFeed.current(nowMs)
  const home = await $.env.get('HOME').catch(() => undefined)
  const path = typeof home === 'string' && home.trim() !== '' ? home.trim().replace(/\/$/, '') + '/' + CONSOLE_FILE : null
  // not awaited: the command may take its whole timeout; the next tick draws what it left (an unchanged snapshot keeps its identity, so only a change redraws)
  void consoleFeed.refresh(argv => $.process.run(argv, { timeoutMs: CONSOLE_TIMEOUT_MS }), () => (path === null ? Promise.resolve(null) : readText($, path)), parseConsole, nowMs).then(async () => { if (consoleFeed.current(await $.clock.now()) !== before) void $.ui.invalidate('ui.render') }, () => {}).catch(() => {})
  return consoleFeed.current(nowMs)
}
async function consoleTick($: EngineInterface): Promise<void> {
  const nowMs = await $.clock.now()
  const cwd = await $.session.cwd()
  let changed = false
  if (cwd !== consoleCwd || nowMs - consoleReadMs >= CONSOLE_MODE_EVERY_MS) {
    const found = await findConsoleConfig(cwd, p => readText($, p))
    consoleCwd = cwd
    consoleReadMs = nowMs
    consoleIngestFrom = found.ingestFrom
    consoleFeed.setIngestFrom(found.ingestFrom)
    changed = found.on !== consoleOn
    if (found.on && !consoleOn && barTab !== 'forge') barTab = null // the strip turns to the console tabs: a band tab left open would keep its body under a 指揮 highlight
    consoleOn = found.on
  }
  // the snapshot is fetched in every session, console mode or not: the framed pages draw 待決 / 艦隊 / 額度 from it (a null here is "無來源：沒有 console 快照" on every page).
  // The console mode only decides the band strip and the legacy console pane (both still check consoleOn before reading consoleSnap).
  const snap = await consoleSource($)
  if (snap !== consoleSnap) { consoleSnap = snap; changed = true }
  if (changed) void $.ui.invalidate('ui.render')
}
const consoleNav = (): ConsoleNav => ({ snap: consoleSnap, tab: consoleTab })
// the console pane (pane.tsx consolePane): the same navigation state as the band. The 指揮 page answers cards through the same decide wiring as the 待決 tab (decideState, decideBatch,
// decidePress); a `fill:` press (a waiting_step card's report button) only puts the report line in the prompt box with `$.prompt.fill`, it never submits.
const consolePaneOf = async ($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0] & { props: { bodyColumns: number | null; scroll?: ScrollView | null } }) => {
  hostScrollHome($, e.props.scroll ?? undefined)
  decideCols = paneWidth(e.props.bodyColumns)
  decideInputs = inputsFor(e.surface)
  await decideRepair($, await read($, DECIDE))
  decideScroll.redraw = () => { void $.ui.invalidate('ui.render') }
  const now = await $.clock.now()
  return Pane($.ui.resolve(e), snapshot, 'now', () => {}, tr, e.props.bodyColumns, () => {}, expanded, (id: string) => { const set = isSectionId(id) ? folded : expanded; if (!set.delete(id)) set.add(id); $.ui.invalidate('ui.render') }, folded, null, null, null, null, {
    nav: consoleNav(),
    onTab: (tab: ConsoleTab) => { consoleTab = tab; $.ui.invalidate('ui.render') },
    onNext: () => { consoleTab = nextConsoleTab(consoleTab); $.ui.invalidate('ui.render') },
    live: snapshot,
    now,
    scroll: e.props.scroll ?? null,
    win: decideScroll,
    folded,
    onToggle: (id: string) => { if (!folded.delete(id)) folded.add(id); $.ui.invalidate('ui.render') },
    decide: {
      state: decideState, batch: decideBatch, now, inputs: decideInputs,
      onPress: (id: string) => {
        if (id.startsWith(FILL_PRESS)) void $.prompt.fill({ text: tr('console.command.fill', { id: id.slice(FILL_PRESS.length) }), mode: 'replace' }).then(out => { if (!out.isFilled) $.ui.toast(tr('console.command.fill_refused')) })
        else void decidePress($, id)
      },
      onNote: (key: string, value: string) => { void decideNote($, key, value) },
      onKeep: (key: string, value: string) => { void decideKeep($, key, value) },
    },
  })
}
let bandCollapsed = initialBandCollapsed() // the shell's one band row (pending count, needs-you count, the expand hint). A click on that row expands; d on the open 待決 menu collapses. Reset at session start.
let bandSeenCount: number | null = null // pending cards already shown. Null until the first shell draw, which baselines them so cards already waiting are not marked. A later growth while collapsed marks ⏶N until one expanded draw catches up.
let bandShellOff = false // console mode / framed pages: another page name was pressed, so the default 待決 shell stays closed until 待決 is pressed again; reset at session start
let barTab: BarTabId | null = null // the tab of the band row that is open (its content is drawn under the rule); null = none; a memory state, reset at session start
let shellMenu: ShellMenuId = 'd' // the O4 shell's menu (d 待決 by default). It is not barTab: d/r/u/p/h and 9 only change this.
let geomSeen: string | null = null // `maxRows x bodyColumns` of the last band draw that was logged (band-geometry.log); reset at session start
let geomLines: string[] | null = null // the log's lines (the last 200); read once per session, then kept in memory because the fs hook only writes whole files
let shellOn = false // the last AbovePrompt draw was the shell (ui.scroll follows the card window only then)
const expanded = new Set<string>() // the recent-prompt groups the person opened (by group id)
const folded = new Set<string>() // the Now sections the person folded (SECTION ids); kept across /clear, a view preference and not tied to the transcript
const recentTracker = makeRecentTracker()
let recent: RecentGroup[] | null = null // survives ticks: the snapshot is rebuilt each time, a failed read keeps the last value
let recentSid: string | null = null // group ids are transcript indexes, so a new session id (/clear) drops every opened group
let activity: ActivityItem[] | null = null // survives ticks like `recent`: a failed read keeps the last value
let activitySid: string | null = null // the session id those rows belong to; a failed transcript keeps them only while this id still matches
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
let pressSeq = 0 // one number per i press, taken before any await; only the latest press may assign paneTab or end the chain
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
    sections: NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: NO_DETAIL, ...over,
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

// Same judgement as scripts/session-mode.js readSessionRoot (parity pinned by the ROOT_LIVENESS_CASES table in live.test.ts and
// hooks/session-root-liveness.test.js): alive = marker unexpired, OR expired but <live>/turn/<sid>.json (schema autopilot.session-turn/1) has a
// `since` inside one marker TTL (24 h). SessionEnd removes the turn file, so an ended session stays expired. Never "expired counts as valid".
const MARKER_TTL_MS = 24 * 3600 * 1000
const MARKER_LEVELS = ['l3', 'l4', 'l5', 'l6']
async function markerAlive($: EngineInterface, liveBase: string, sid: string, marker: Json, nowMs: number): Promise<boolean> {
  // level whitelist (readSessionRoot): a missing or null level is a legal plain session; an unknown level is refused
  if (marker.level !== undefined && marker.level !== null && !MARKER_LEVELS.includes(marker.level as string)) return false
  if (typeof marker.expires_at === 'string' && Date.parse(marker.expires_at) > nowMs) return true
  const turn = await readObject($, liveBase + '/turn/' + sid + '.json')
  if (!turn || turn.schema !== 'autopilot.session-turn/1' || typeof turn.since !== 'string') return false
  return Date.parse(turn.since) > nowMs - MARKER_TTL_MS
}

async function resolveScope($: EngineInterface, autopilotHome: string, liveBase: string, sid: string, nowMs: number): Promise<Scope | null> {
  if (sid) {
    const marker = await readObject($, autopilotHome + '/session-mode/' + sid + '.json')
    if (marker && isKey(marker.project_key) && await markerAlive($, liveBase, sid, marker, nowMs)) {
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

// An old envelope is outdated only if something it was built from has changed since: age alone says nothing (a watcher that exited on purpose leaves a
// snapshot that stays true). Only a snapshot whose writer is gone (writer null, the final publish) can be judged by its sources; a writer that is listed but
// stopped publishing is a stuck or dead one, and keeps the age verdict. No `sources` list (an older watcher) keeps the age verdict too.
// The sources are THIS project's (see sourceFingerprint): a listed file newer or gone is a change; a directory whose own mtime moved (anyone's create / rename /
// delete) is listed and each file not seen before is read once and judged by this project's match value.
// What counts as "not this project's", and what does not (an error is never an answer):
//  - only a file that was READ and PARSED as an object whose match field is a STRING that is not this project's goes into `notOurs` (a manifest or marker never changes owner, so
//    it is never read again). A read or parse error is NOT cached: the next poll reads it again, so a file that is repaired into this project's is seen.
//  - a new file that cannot be read or parsed right now does not make the snapshot stale this time: the writers create it by tmp + rename, so a half-written file
//    is not normally visible; it is retried on the next poll.
//  - a listed file or directory of this project that cannot be checked (stat fails: gone, or EACCES, the engine gives a message only) reads as changed (stale),
//    and so does a directory that cannot be listed once its mtime moved: with no way to confirm nothing changed, the age verdict stands.
// The fresh verdict of one publish is MEMOIZED (keyed by the envelope's path + published_at + observed_at: the bytes of a publish are fixed once its tmp + rename
// landed) together with the group dirs' mtimes the full check saw and the new files it could not judge yet (unreadable, unparseable, or a missing / non-string
// owner: "not an answer, not cached"). The next poll of the same publish stats the group DIRS only: every writer creates / replaces / deletes by tmp + rename, so
// any of those moves the dir's own mtime; equal dir mtimes confirm nothing of this project's moved and the memoized fresh stands without a single per-file stat
// (a host's session-mode dir holds thousands of files, and a per-file pass per poll burned 11-22% of a core per seat). The pending files are re-read before the
// memoized fresh is trusted (a repair must be seen on the next poll, exactly as by the full check), and a dir whose mtime moved, or that cannot be confirmed
// (absent / EACCES: the same two outcomes as the full check), runs the full check, which re-memoizes a fresh verdict with what it saw. The memo is bounded
// (SOURCE_MEMO_MAX: cleared whole above it) and a hot reload drops it with the rest of the module state.
const SOURCE_MEMO_MAX = 256
const sourceMemo = new Map<string, { dirs: (number | null)[]; pending: { p: string; g: number }[] }>()
function rememberVerdict(key: string, dirs: (number | null)[], pending: { p: string; g: number }[], verdict: EnvelopeCheck): EnvelopeCheck {
  if (verdict.status === 'fresh') {
    if (sourceMemo.size >= SOURCE_MEMO_MAX) sourceMemo.clear()
    sourceMemo.set(key, { dirs, pending })
  }
  return verdict
}
const notOurs = new Set<string>()
async function judgeByChange($: EngineInterface, check: EnvelopeCheck, idPath: string): Promise<EnvelopeCheck> {
  const env = check.envelope as Json
  if (env.sources === undefined) return check // an older watcher: no list, the age verdict stands
  const moved: EnvelopeCheck = { ...check, status: 'stale', moved: true }
  const groups = sourcesOf(env)
  if (groups === null) return moved // a list that is there but unreadable cannot confirm nothing changed
  // Include the immutable envelope bytes too: timestamp precision alone is not a unique publish identity.
  const memoKey = idPath + '|' + JSON.stringify(env)
  const hit = sourceMemo.get(memoKey)
  if (hit !== undefined) {
    const freshNow: EnvelopeCheck = { status: 'fresh', envelope: env }
    // The last full check of this publish was fresh and saw these dir mtimes. Equal dir mtimes confirm nothing of this project's
    // moved (see above): no per-file stats. A dir that cannot be re-stat'ed gets the full check's own two outcomes: absent then
    // and still absent is no change, anything else cannot confirm nothing changed.
    let same = true
    for (let i = 0; i < groups.length && same; i++) {
      const g = groups[i]
      const dirSt = await $.fs.stat(g.dir).catch(() => null)
      if (dirSt === null) {
        const absent = await $.fs.exists(g.dir).then(x => !x).catch(() => false)
        if (absent && g.dir_mtime_ms === null && hit.dirs[i] === null) continue
        return moved
      }
      same = dirSt.mtimeMs === hit.dirs[i]
    }
    if (!same) return await fullSourceCheck($, check, groups, memoKey)
    // The pending files are the ones the last fresh verdict could not judge: they are re-read, the full check's way (a repair
    // must be seen on the next poll); only a string owner equal to this project's makes the snapshot stale, a different string
    // settles them into notOurs, everything else stays pending.
    const still: { p: string; g: number }[] = []
    for (const pr of hit.pending) {
      const g = groups[pr.g]
      const text = await readText($, pr.p)
      if (text === null) { still.push(pr); continue }
      const parsed = parseJson(text)
      if (!parsed.ok || !isObject(parsed.value)) { still.push(pr); continue }
      const owner = parsed.value[g.match_field]
      if (owner === g.match_value) return moved
      if (typeof owner !== 'string') { still.push(pr); continue }
      if (notOurs.size > 20000) notOurs.clear()
      notOurs.add(pr.p + '|' + g.match_field + '=' + g.match_value)
    }
    if (still.length !== hit.pending.length) rememberVerdict(memoKey, hit.dirs, still, freshNow) // the set shrank: keep the memo current
    return freshNow
  }
  return await fullSourceCheck($, check, groups, memoKey)
}
// The full per-file pass (what this used to be): every listed file is stat'ed, a moved dir is listed and every file not seen
// before is read once and judged by this project's match value. `pending` collects the new files left unanswered, for the memo.
async function fullSourceCheck($: EngineInterface, check: EnvelopeCheck, groups: SourceGroup[], memoKey: string): Promise<EnvelopeCheck> {
  const env = check.envelope as Json
  const moved: EnvelopeCheck = { ...check, status: 'stale', moved: true }
  const dirsSeen: (number | null)[] = []
  const pending: { p: string; g: number }[] = []
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    for (const f of g.files) {
      const st = await $.fs.stat(f.path).catch(() => null)
      if (st === null || sourceMoved(f.mtime_ms, st.mtimeMs)) return moved // a listed file that cannot be checked is a change, whatever was recorded
    }
    const dirSt = await $.fs.stat(g.dir).catch(() => null)
    if (dirSt === null) {
      // absent then and still absent is no change; any other failure (EACCES: the engine gives a message only) cannot be told from it by stat, so ask exists
      const absent = await $.fs.exists(g.dir).then(x => !x).catch(() => false)
      if (absent && g.dir_mtime_ms === null) { dirsSeen.push(null); continue }
      return moved
    }
    dirsSeen.push(dirSt.mtimeMs)
    if (!sourceMoved(g.dir_mtime_ms, dirSt.mtimeMs)) continue
    let entries: { name: string; kind: string }[]
    try { entries = await $.fs.list(g.dir) } catch { return moved }
    const known = new Set(g.files.map(f => f.path))
    for (const e of entries) {
      if (e.kind !== 'file' || !e.name.endsWith(g.suffix)) continue
      const p = g.dir.replace(/\/+$/, '') + '/' + e.name
      const memo = p + '|' + g.match_field + '=' + g.match_value
      if (known.has(p) || notOurs.has(memo)) continue
      const text = await readText($, p)
      if (text === null) { pending.push({ p, g: gi }); continue } // unreadable now: not an answer, not cached, read again next poll
      const parsed = parseJson(text)
      if (!parsed.ok || !isObject(parsed.value)) { pending.push({ p, g: gi }); continue } // same: a half-written or foreign shape is retried
      const owner = parsed.value[g.match_field]
      if (owner === g.match_value) return moved
      if (typeof owner !== 'string') { pending.push({ p, g: gi }); continue } // field missing, null or not a string: an incomplete file, not another project's; read again next poll
      if (notOurs.size > 20000) notOurs.clear()
      notOurs.add(memo)
    }
  }
  return rememberVerdict(memoKey, dirsSeen, pending, { status: 'fresh', envelope: env })
}

// The envelope of one scope: the tmpfs file, then the SSD copy; a fresh one beats a stale one.
async function findEnvelope($: EngineInterface, autopilotHome: string, liveBase: string, scope: Scope, nowMs: number): Promise<EnvelopeCheck> {
  const scopeKey = scopeKeyOf(scope.key, scope.root)
  const want = { project_key: scope.key, root_run_id: scope.root }
  const paths = [liveBase + '/runs/' + scopeKey + '.json', autopilotHome + '/review/' + scope.key + '/live/runs.' + scopeKey + '.json']
  let stale: EnvelopeCheck | null = null
  let malformed = false
  for (const path of paths) {
    let check = checkEnvelope(await readText($, path), want, nowMs)
    // a writer that is gone (the final publish) leaves a snapshot judged by what it was built from, never by its age: a change makes it stale even while valid_for_s runs
    if ((check.status === 'fresh' || check.status === 'stale') && check.envelope !== null && check.envelope.writer === null) check = await judgeByChange($, check, path)
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

// BL-0336: why the watcher did not come up, from the launch record the autostart hook also reads (<autopilot home>/review/<key>/live/):
// the failed result of the CURRENT launch id, or null. Shown instead of "unavailable" / "stale" so the band says the same sentence the hook did.
async function launchFailure($: EngineInterface, autopilotHome: string, key: string): Promise<string | null> {
  const dir = autopilotHome + '/review/' + key + '/live/'
  const rec = await readObject($, dir + 'watcher-launch.json')
  if (rec === null || typeof rec.launch_id !== 'string' || !/^[0-9a-f]{16}$/.test(rec.launch_id)) return null
  const res = await readObject($, dir + 'watcher-start.' + rec.launch_id + '.json')
  if (res === null || res.launch_id !== rec.launch_id || res.ok !== false) return null
  return typeof res.reason === 'string' && res.reason !== '' ? res.reason : 'unknown reason'
}

async function buildSnapshot($: EngineInterface, nowMs: number, t: T): Promise<{ snap: LiveSnapshot; counts: Counts | null; acceptance: string | null }> {
  durableOpenCards = []
  durableAwaiting = []
  const none = (snap: LiveSnapshot) => ({ snap, counts: null, acceptance: null })
  const STATE_TEXT = stateText(t)
  const home = await $.env.get('HOME')
  if (!home) { durableOpenCards = []; durableAwaiting = []; return none(plain('no-pointer', STATE_TEXT.noPointer)) }
  const pointerText = await readText($, home + '/.autopilot/live-pointer.json')
  if (pointerText === null) return none(plain('no-pointer', STATE_TEXT.noPointer))
  const parsed = parseJson(pointerText)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== POINTER_SCHEMA || typeof parsed.value.live_base !== 'string' || !parsed.value.live_base) {
    return none(plain('unreadable', STATE_TEXT.unreadable))
  }
  const liveBase = parsed.value.live_base.replace(/\/+$/, '')
  liveBaseSeen = liveBase
  void flushPendingLogs($)
  const autopilotHome = typeof parsed.value.autopilot_home === 'string' && parsed.value.autopilot_home ? parsed.value.autopilot_home.replace(/\/+$/, '') : home + '/.autopilot'

  const sid = await $.session.id()
  // A tick that got a pointer may still be non-ok below. Cleanup uses this tick's base, never a stale one from a later failed read.
  if (sid) await pruneBandFacts($, liveBase, autopilotHome, sid, nowMs).catch(() => undefined)
  const scope = await resolveScope($, autopilotHome, liveBase, sid, nowMs)
  if (scope === null) {
    const wt = await orphanResidueCount($)
    durableOpenCards = []
    durableAwaiting = []
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
    const failure = await launchFailure($, autopilotHome, scope.key)
    if (failure !== null) return none(plain('unavailable', STATE_TEXT.watcherFailed(failure), keyed))
    const malformed = finds.some(f => f.found.status === 'malformed')
    return none(malformed ? plain('unreadable', STATE_TEXT.unreadable, keyed) : plain('unavailable', STATE_TEXT.unavailable(), keyed))
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
    detail: { ...NO_DETAIL, now_ms: nowMs }, // X4: non-ok snapshots still need the clock to show their data age.
  }
  if (fresh.length === 0) {
    const failure = await launchFailure($, autopilotHome, scope.key)
    if (failure !== null) return { snap: plain('stale', STATE_TEXT.watcherFailed(failure), common), counts: null, acceptance: null }
    const at = published !== null && Number.isFinite(Date.parse(published)) ? hhmm(Date.parse(published)) : null
    // a watcher that is gone (writer null) over sources that moved: say what happened, not that the watcher is "not publishing"
    if (found.moved === true) return { snap: plain('stale', STATE_TEXT.staleMoved(at), common), counts: null, acceptance: null }
    return { snap: plain('stale', STATE_TEXT.stale(at), common), counts: null, acceptance: null }
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
  const qcText = await readText($, liveBase + '/runs/' + scope.key + '.qc.json')
  const qcScope = { project_key: scope.key, root_run_id: null }
  const qc = readQc(qcText, qcScope)
  const qcAt = readQcAt(qcText, qcScope)
  const residue = readResidue(await readText($, liveBase + '/runs/' + scope.key + '.residue.json'), scope.key)
  const stage = readStageWalk(await readText($, liveBase + '/stage/' + fileSid + '.json'), sid)
  const review = readReview(await readText($, liveBase + '/runs/' + scope.key + '.review.json'), scope.key)
  const src: Sources = { tasks, attention, turn, decisions, manifest, foreman, loadSource, marker, review, qc, residue, stage, quota, startMs: startMsOf(receiptRoot, env, tasks, scope.marker === null ? null : scope.marker.started_at, receiptMs) }
  const ctx = ctxShown(ctxText(await readText($, liveBase + '/context/' + fileSid + '.json'), nowMs), manifest, t)
  const commonDir = commonDirOf(identity) ?? await commonDirAt($, await $.session.cwd().catch(() => ''))
  const durable = await readDurableDecisions($, commonDir, scope.key, identity, nowMs)
  durableOpenCards = durable.open.flatMap(d => { const c = liveToDecideCard(d); return c === null ? [] : [c] })
  durableAwaiting = durable.awaiting
  const dismissed = (await read($, DECIDE).catch(() => NO_DECIDE)).dismissed ?? {}
  const baseDecisions = jobModel === null || !jobModel.needs_decision ? [] : jobModel.decisions
  const mergedPending = mergeDurableDecisions(baseDecisions, durable, dismissed)
  const effectiveJobModel: JobModel | null = mergedPending.length > 0
    ? (jobModel === null
        ? { acceptance: 'unknown', gates: [], needs_decision: true, conclusion: null, decisions: mergedPending, progress: null, phase: null, sources_manifest: null }
        : { ...jobModel, needs_decision: true, decisions: mergedPending })
    : baseDecisions.length > 0 && jobModel !== null
      ? { ...jobModel, needs_decision: false, decisions: [] }
      : jobModel
  const band = bandView(env, effectiveJobModel, scope.key, nowMs, src, t)
  return {
    snap: plain('ok', bandLine1(band) + (band.reason === null ? '' : '\n' + band.reason), {
      ...common, watcher_note: typeof env.exit_reason === 'string' && env.exit_reason !== '' && env.writer === null ? STATE_TEXT.watcherNote(env.exit_reason) : null,
      band, header: headerText(env, sid, ctx, t), metrics: { ctx }, pending: mergedPending, awaiting: jobModel === null ? [] : (jobModel.awaiting_operator ?? []), dispatching: jobModel === null ? [] : (jobModel.pending_dispatch ?? []),
      sections: buildSections(src, foreman),
      review,
      detail: {
        counts: countsOf(env), stalled: stalledCount(env, foreman, nowMs),
        now_ms: nowMs, project: projectNameOf(identity, scope.key), marker, qc, ...(qcAt === null ? {} : { qc_at: qcAt }), stage, decisions, load_source: loadSource, residue,
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

function bandFactsDir(liveBase: string): string {
  return liveBase.replace(/\/+$/, '') + '/autopilot/band-facts'
}

// Numbers and the shared contract for the statusline. The plugin fs API has no rename, and a hooks
// module cannot import node builtins, so this writes `<sid>.json.tmp` in the same directory and then the destination.
// A tick that throws before the destination write leaves the previous file. A non-ok tick does not call this, so the
// previous file stays; the statusline treats a file whose age is not inside 30 s as absent.
async function publishBandFacts($: EngineInterface, liveBase: string, snap: LiveSnapshot, sessionId: string, nowMs: number): Promise<void> {
  const d = snap.detail
  const brain = d.spend?.brain ?? null
  const cap = d.spend?.cap ?? null
  const doc = bandFactsDocument({
    written_at_ms: nowMs,
    session_id: sessionId,
    live: d.counts?.confirmed_live ?? 0,
    marker: d.marker,
    review: snap.review,
    decisions: d.decisions?.count ?? 0,
    spend: brain !== null && cap !== null ? { brain, cap } : null,
  })
  const dest = bandFactsDir(liveBase) + '/' + sanitizeSid(sessionId) + '.json'
  const tmp = dest + '.tmp'
  const text = JSON.stringify(doc)
  await $.fs.write(tmp, text)
  await $.fs.write(dest, text)
}

// Claude Code 2.1.322's plugin fs exposes read, write, list, exists, stat and ancestors.
// `$.fs.delete`, `$.fs.unlink` and `$.fs.remove` are not functions, and a hooks module cannot import node builtins.
// An empty file fails the reader's JSON parse and `v == 1` check, so the statusline treats it as absent. The name stays.
async function retireBandFacts($: EngineInterface, path: string): Promise<void> {
  await $.fs.write(path, '')
}

function factsEntryName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

// At most once a minute: empty another session's `band-facts/<sid>.json` when that session is not alive by markerAlive,
// and any `*.json.tmp` whose mtime is older than 5 minutes. Never the own session's `<sanitised sid>.json`.
async function pruneBandFacts($: EngineInterface, liveBase: string, autopilotHome: string, sessionId: string, nowMs: number): Promise<void> {
  if (nowMs - factsPrunedAt < FACTS_PRUNE_MS) return
  factsPrunedAt = nowMs
  const dir = bandFactsDir(liveBase)
  const own = sanitizeSid(sessionId) + '.json'
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>
  try {
    entries = await $.fs.list(dir)
  } catch (_e) {
    return
  }
  for (const entry of entries) {
    const name = entry.name
    if (entry.kind !== 'file' || entry.isLink === true || !factsEntryName(name) || name === own) continue
    const path = dir + '/' + name
    try {
      if (name.endsWith('.json.tmp')) {
        const st = await $.fs.stat(path)
        if (st.kind === 'file' && st.isLink !== true && nowMs - st.mtimeMs > FACTS_TMP_STALE_MS) await retireBandFacts($, path)
        continue
      }
      if (!name.endsWith('.json')) continue
      const stem = name.slice(0, -'.json'.length)
      if (stem.length === 0) continue
      const doc = await readObject($, path)
      const named = doc !== null && typeof doc.session_id === 'string' ? doc.session_id : null
      const sid = named !== null && sanitizeSid(named) === stem ? named : stem
      if (sid === sessionId) continue
      const marker = await readObject($, autopilotHome + '/session-mode/' + sid + '.json')
      if (marker !== null && await markerAlive($, liveBase, sid, marker, nowMs)) continue
      await retireBandFacts($, path)
    } catch (_e) { /* one name failed: the next minute tries the directory again */ }
  }
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const nowMs = await $.clock.now()
    tr = await resolveT($)
    await pollAdvisories($, nowMs)
    await readAccountQuota($, nowMs)
    const built = await buildSnapshot($, nowMs, tr)
    let msgs: unknown = null
    let sid: string | null = null
    let sidOk = false
    try {
      const rawSid = await $.session.id()
      // unread only for the kept-row decision below: a null id still reads the transcript and updates recent
      sid = rawSid ?? null
      sidOk = rawSid !== null && rawSid !== undefined
      msgs = await $.session.messages()
      if (recentSid !== null && sid !== recentSid) expanded.clear()
      recentSid = sid
      if (Array.isArray(msgs)) recent = recentTracker.update(sid ?? '', msgs as never)
    } catch (_e) {
      // the transcript is optional garnish: keep the previous value. `sid` stays set when only messages() threw.
    }
    // kept shell and watch rows carry no session id. Drop them when the id was read, the transcript is not an array,
    // and the id is not the one those rows belong to (/clear or resume while messages() keeps failing). An unread id keeps them.
    if (sidOk && !Array.isArray(msgs) && sid !== activitySid) {
      activity = null
      activitySid = sid
    }
    try {
      const next = await readActivity($, msgs, nowMs, activity)
      if (next !== null) {
        activity = next
        if (Array.isArray(msgs) && sidOk) activitySid = sid // the rows just built belong to this session
      }
    } catch (_e) {
      // garnish too: keep the previous rows
    }
    petText = petTag(liveBaseSeen === null ? null : await readText($, liveBaseSeen + '/codeforge/pet.json'))
    snapshot = { ...built.snap, recent, activity, account: { account, quota } }
    bandExpand = bandExpandOnRefresh(bandExpand)
    if (built.snap.state === 'ok' && liveBaseSeen !== null && sidOk && sid) await publishBandFacts($, liveBaseSeen, built.snap, sid, nowMs).catch(() => undefined)
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
    // The side pane is never opened here (side-pane plan B, owner ruling 2026-11-06): it took 37-40% of the width and left the band 83 columns at 160 and 145 at 240. The person opens it:
    // the i, a slot, or the /live-pane command.
  } catch (_e) {
    // a bad tick must never take the session down; the next tick tries again
  }
}

// A press on the 待決 tab: `pick:<id>:<k>` only SELECTS option k of question id (pressing the chosen one again unselects it; nothing is sent and the card stays editable), `submit` starts the
// undo window for every answered question (DECIDE_UNDO_MS, then the send), `undo:<id>` takes a card back out of it, `fix:<id>` reopens a sent card to correct its answer.
async function decidePress($: EngineInterface, id: string): Promise<void> {
  // a pressed file path (ui.ts linkSegs / cardAttachRows, the background tail) or a `給你看` row: the viewer window has to open in THIS turn, before any await (mods/viewer/show.ts openWindow)
  if (id.startsWith(SHOW_PRESS)) {
    const at = showTarget(id)
    if (at !== null) await showPath($, at.path, at.line).catch(() => undefined)
    return
  }
  if (id.startsWith(LOOK_PRESS)) {
    const lid = id.slice(LOOK_PRESS.length)
    const card = snapshot?.pending.find(d => d.id === lid)
    if (card?.look_target !== undefined && card.look_target !== null) await reopenLook($, card.look_target).catch(() => undefined)
    else if ((card?.attachments?.length ?? 0) > 0) await showPath($, (card?.attachments as string[])[0], null).catch(() => undefined)
    return
  }
  try {
    const m = /^pick:(.+):(\d+)$/.exec(id)
    if (m !== null) {
      const k = Number(m[2])
      decideFocus = optKey(m[1], k)
      decideLocal = { ...decideLocal, armed: false } // a pick changes what `s` would send: the preview is over
      await update($, DECIDE, s => applyPick(s, m[1], k))
    } else if (id === 'submit') await holdDecide($)
    else if (id.startsWith('undo:')) await undoDecide($, id.slice(5))
    else if (id.startsWith('fix:')) await reopen(undoDeps($), id.slice(4))
    else if (id.startsWith(DISMISS_PRESS + 'done:')) await dismissCard($, id.slice((DISMISS_PRESS + 'done:').length), true, '做完了')
    else if (id.startsWith(DISMISS_PRESS + 'cancel:')) await cancelDismissConfirmation($, id.slice((DISMISS_PRESS + 'cancel:').length))
    else if (id.startsWith(DISMISS_PRESS)) await requestDismissConfirmation($, id.slice(DISMISS_PRESS.length))
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
// The undo window's claim (F4) is the one other script the pane runs, from its own list: it only wraps `fleet decision claim` and prints JSON (PM ruling 2026-11-07).
export const CLAIM_SCRIPTS = ['scripts/decision-claim.js'] as const
// Durable card store writer (scripts/open-decision.js): records `show` items (`--kind look`) and closes dismissed step / look rows.
export const DECISION_SCRIPTS = ['scripts/open-decision.js'] as const
type CleanRun = (argv: string[]) => Promise<{ exitCode: number; stdout: string }>
// the one exec path for the whitelisted script lists: argv is node + a whitelisted script (ui-lint.test.js pins this); the only place `$.process` is used
async function execScript($: EngineInterface, script: (typeof CLEAN_SCRIPTS)[number] | (typeof CLAIM_SCRIPTS)[number] | (typeof DECISION_SCRIPTS)[number], args: string[], run?: CleanRun, timeoutMs = 120_000, exit?: (code: number) => void): Promise<string> {
  const allowed: readonly string[] = [...CLEAN_SCRIPTS, ...CLAIM_SCRIPTS, ...DECISION_SCRIPTS]
  if (!allowed.includes(script)) throw new Error('script not allowed')
  const argv = ['node', $.plugin.root + '/' + script, ...args]
  const r = run === undefined ? await $.process.run(argv, { timeoutMs }) : await run(argv)
  exit?.(r.exitCode)
  return r.stdout
}

async function readDurableDecisions($: EngineInterface, commonDir: string | null, projectKey: string, identity: unknown, nowMs: number): Promise<{ open: LiveDecision[]; closedIds: Set<string>; awaiting: DurableAwaiting[] }> {
  if (commonDir === null) return { open: [], closedIds: new Set(), awaiting: [] }
  const dir = commonDir + '/autopilot/decisions'
  let names: string[] = []
  try {
    names = (await $.fs.list(dir))
      .filter(e => e.kind === 'file' && e.name.endsWith('.json') && (e.name === projectKey + '.json' || e.name.startsWith(projectKey + '--')))
      .map(e => e.name)
      .sort()
      .slice(0, MAX_PATH_FILES)
  } catch (_e) {
    return { open: [], closedIds: new Set(), awaiting: [] }
  }
  const texts: string[] = []
  for (const name of names) {
    const text = await readText($, dir + '/' + name)
    if (text !== null) texts.push(text)
  }
  return readDurableDecisionFiles(texts, { project_key: projectKey, repo_identity: identity }, nowMs)
}

function showItemLabel(req: ShowRequest, lane: string): { text: string; lookTarget: LookTarget; attach: string[] } {
  if (req.kind === 'path') {
    const trimmed = req.path.replace(/\/+$/, '')
    const base = trimmed.slice(trimmed.lastIndexOf('/') + 1) || req.path
    return {
      text: '給你看：' + base + '（' + lane + '）',
      lookTarget: { kind: 'path', path: req.path, start: req.start, end: req.end, ...(req.tail === true ? { tail: true } : {}) },
      attach: [req.path],
    }
  }
  const dash = req.args.indexOf('--')
  const tailArgs = dash >= 0 ? req.args.slice(dash + 1) : []
  const firstTail = tailArgs.length === 1 ? tailArgs[0].replace(/\/+$/, '') : ''
  const name = firstTail !== ''
    ? (firstTail.slice(firstTail.lastIndexOf('/') + 1) || tailArgs[0])
    : req.args.length > 0 ? 'diff ' + req.args.join(' ') : 'diff'
  return {
    text: '給你看：' + name + '（' + lane + '）',
    lookTarget: { kind: 'diff', args: [...req.args] },
    attach: [],
  }
}

export async function recordShowLook($: EngineInterface, req: ShowRequest): Promise<void> {
  if (!(await $.fs.exists($.plugin.root + '/' + DECISION_SCRIPTS[0]).catch(() => false))) return
  const cwd = await $.session.cwd()
  const common = await commonDirAt($, cwd)
  const fromSnap = snapshot !== null && snapshot.detail.project !== '' && snapshot.detail.project !== '—' ? snapshot.detail.project : null
  const derived = common !== null ? projectNameOf('git-common-dir:' + common, '') : ''
  const cwdBase = cwd.replace(/\/+$/, '').split('/').pop() ?? ''
  const lane = fromSnap ?? (derived !== '' && derived !== '—' ? derived : cwdBase !== '' ? cwdBase : 'repo')
  const item = showItemLabel(req, lane)
  const rootRunId = snapshot !== null && typeof snapshot.root_run_id === 'string' && /^[A-Za-z0-9._-]+$/.test(snapshot.root_run_id) ? snapshot.root_run_id : null
  const args = [
    'open', '--cwd', cwd, '--kind', 'look',
    '--question', item.text,
    '--source', lane,
    '--look-target', JSON.stringify(item.lookTarget),
    ...item.attach.flatMap(a => ['--attach', a]),
    ...(rootRunId === null ? [] : ['--root-run-id', rootRunId]),
  ]
  await execScript($, DECISION_SCRIPTS[0], args)
  await refresh($)
}

async function requestDismissConfirmation($: EngineInterface, id: string): Promise<void> {
  if (id === '' || !/^[A-Za-z0-9._-]+$/.test(id)) return
  await update($, DECIDE, s => ({ ...s, dismissConfirmId: id }))
  await refresh($)
}
async function cancelDismissConfirmation($: EngineInterface, id: string): Promise<void> {
  await update($, DECIDE, s => s.dismissConfirmId === id ? { ...s, dismissConfirmId: undefined } : s)
  await refresh($)
}
async function dismissCard($: EngineInterface, id: string, done: boolean, key: string): Promise<void> {
  if (id === '' || !/^[A-Za-z0-9._-]+$/.test(id) || key.trim() === '') return
  const script = $.plugin.root + '/' + DECISION_SCRIPTS[0]
  if (!(await $.fs.exists(script).catch(() => false))) return
  const cwd = await $.session.cwd().catch(() => '')
  if (cwd === '') return
  let exitCode = -1
  try {
    await execScript($, DECISION_SCRIPTS[0], ['close', '--cwd', cwd, '--id', id, done ? '--panel-done' : '--panel-dismiss', '--closed-key', key], undefined, 120_000, code => { exitCode = code })
  } catch (_e) { return }
  if (exitCode !== 0) return
  const nowMs = await $.clock.now()
  await update($, DECIDE, s => ({ ...s, dismissed: { ...(s.dismissed ?? {}), [id]: nowMs }, dismissConfirmId: undefined }))
  await refresh($)
}
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
  const exec = (script: (typeof CLEAN_SCRIPTS)[number], args: string[]): Promise<string> => execScript($, script, args, run)
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

// Send (decideundo.ts): a press on send starts the undo window of every answered card (DECIDE_UNDO_MS); the 1 s timer below redraws the countdown and, when a window ends, calls
// sendDecide. Nothing on this path awaits the network or a courier. The clock is the engine's ($.clock), so a test advances time instead of waiting.
const DECIDE_TICK_MS = 1000
// How one card's answer is claimed with the fleet courier (F4), in the background of its undo window: `scripts/decision-claim.js` (CLAIM_SCRIPTS) prints {ok, answer_id, reason}. Its process limit is
// below the window (DECIDE_UNDO_MS 10 s), so a stuck courier is abandoned inside it; the send never waits for it either way. Injectable (`setClaimCard`) so a test needs no process.
const CLAIM_MS = 8000
let claimCard: ClaimCard | null = null
export function setClaimCard(fn: ClaimCard | null): void { claimCard = fn }
const claimWith = ($: EngineInterface): ClaimCard => async (card, answer) => {
  const args = [card.id, ...('option' in answer ? ['--option', answer.option, ...(answer.freeText ? ['--free-text', answer.freeText] : [])] : ['--free-text', answer.freeText])]
  let j: unknown
  try { j = JSON.parse((await execScript($, CLAIM_SCRIPTS[0], args, undefined, CLAIM_MS)).trim().split('\n').pop() ?? '') } catch (_e) { return { ok: false, answer_id: null, reason: 'claim failed' } }
  const r = j as { ok?: unknown; answer_id?: unknown; reason?: unknown } | null
  if (r === null || typeof r !== 'object' || typeof r.ok !== 'boolean') return { ok: false, answer_id: null, reason: 'claim failed' }
  return { ok: r.ok, answer_id: typeof r.answer_id === 'string' && r.answer_id !== '' ? r.answer_id : null, reason: typeof r.reason === 'string' ? r.reason : null }
}
let holdTimer: { cancel: () => void } | undefined
const undoDeps = ($: EngineInterface): UndoDeps => ({
  now: () => $.clock.now(),
  read: () => read($, DECIDE),
  update: fn => update($, DECIDE, fn),
  pool: st => actionable(v74Pool(snapshot === null ? [] : snapshot.pending.filter(d => !isStepCard(d)), mergedDecide()), decideBatch.order.length > 0 ? decideBatch : bandBatch, st), // a reopened card the session already closed is kept in whichever batch is open
  claim: claimCard ?? claimWith($),
  onClaimFailed: (id, reason) => {
    void $.clock.now().then(ts => appendSendLog((p) => $.fs.read(p), (p, t) => $.fs.write(p, t), liveBaseSeen, { ts, event: 'claim_failed', ids: [id], reason })).catch(() => undefined)
  },
})
async function stopHoldTimerIfIdle($: EngineInterface): Promise<void> {
  if (holdTimer !== undefined && Object.keys((await read($, DECIDE)).hold ?? {}).length === 0) { holdTimer.cancel(); holdTimer = undefined }
}
function startHoldTimer($: EngineInterface): void {
  if (holdTimer === undefined) holdTimer = $.clock.every(DECIDE_TICK_MS, () => { void holdTick($).catch(() => undefined) }) // a bad tick must never take the session down
}
async function holdDecide($: EngineInterface): Promise<void> {
  if ((await holdSend(undoDeps($))).length > 0) startHoldTimer($)
}
// s on the v7.4 list writes the answer into the card store immediately. The model prompt is not
// part of this step: a turn that never answers (weekly limit) must not keep the card on the open list.
async function commitV74Send($: EngineInterface, st: DecideState, feed: readonly DecideCard[], nowMs: number): Promise<void> {
  const pending = snapshot === null ? [] : snapshot.pending.filter(d => !isStepCard(d))
  const { state: next, failed } = await writeV74Answers({
    cards: v74Pool(pending, feed),
    state: st,
    now: nowMs,
    post: text => sendDecide($, new Set(), text),
    run: async (args) => {
      if (!(await $.fs.exists($.plugin.root + '/' + DECISION_SCRIPTS[0]).catch(() => false))) return false
      const cwd = await $.session.cwd().catch(() => '')
      let code = -1
      await execScript($, DECISION_SCRIPTS[0], cwd === '' ? args : ['close', '--cwd', cwd, ...args.slice(1)], undefined, 120_000, c => { code = c })
      return code === 0
    },
  })
  if (failed.length > 0) $.ui.toast(t('decide.send_failed', { reason: failed.join(' ') }))
  for (const id of Object.keys(next.sent)) if (st.sent[id] === undefined) durableClosedIds.add(id)
  const sentNow = Object.keys(next.sent).filter(id => st.sent[id] === undefined).length
  v74SendResult = { n: sentNow, left: feed.filter(c => next.sent[c.id] === undefined).length }
  v74KeysHeld = v74KeysHeldNext(v74KeysHeld, { kind: 'sent' })
  void $.ui.invalidate('ui.render')
  await update($, DECIDE, s => ({ ...s, sent: next.sent }))
}
async function undoDecide($: EngineInterface, id: string): Promise<void> {
  await undoHold(undoDeps($), id)
  await stopHoldTimerIfIdle($)
}
let ticking = false // a clock jump fires many ticks at once: one runs, the rest are skipped (the next 1 s tick sees any change)
async function holdTick($: EngineInterface): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const r = await tickHold(undoDeps($), ids => sendDecide($, ids))
    if (r.idle) await stopHoldTimerIfIdle($)
    await $.ui.invalidate('ui.render') // awaited so the caller's catch owns a refused redraw
  } finally { ticking = false }
}
// The one prompt.submit of the mod (ui-lint allowlist): the window of `only` ended, so its answers go out (decideundo.ts sendNow). The prompt starts a turn once the session is idle: it is not awaited.
async function sendDecide($: EngineInterface, only: ReadonlySet<string>, preset?: string): Promise<void> {
  const post = (text: string) => $.prompt.submit({ text })
  // v7.4 s: the cards are already written to the store and marked sent (commitV74Send); this posts the
  // [待決回覆] line and does not wait for the turn. A refused post keeps the store write.
  if (preset !== undefined) { void post(preset).catch((err: unknown) => $.ui.toast(t('decide.send_failed', { reason: (err instanceof Error ? err.message : String(err ?? '-')).replace(/[\r\n]+/g, ' ').slice(0, 120) }))); return }
  const ids = await sendNow({
    ...undoDeps($),
    post,
    onSendFailed: (reason, failedIds) => {
      const oneLine = reason.replace(/[\r\n]+/g, ' ').trim()
      const truncated = oneLine.length > 120 ? oneLine.slice(0, 119) + '…' : oneLine
      $.ui.toast(t('decide.send_failed', { reason: truncated || '-' }))
      void $.clock.now().then(ts => appendSendLog((p) => $.fs.read(p), (p, t) => $.fs.write(p, t), liveBaseSeen, { ts, event: 'post_refused', ids: failedIds, reason })).catch(() => undefined)
    },
  }, only)
  const typed = submitSuccessor(snapshot === null ? [] : snapshot.pending.filter(d => !isStepCard(d)), ids)
  if (typed !== null) await decideAnswered($, typed) // a typed-only card is answered by sending it: the focus goes to its successor even though the send button is gone
}

// An edit of a note field (`note:<id>`).
async function decideNote($: EngineInterface, key: string, value: string): Promise<void> {
  if (!key.startsWith('note:')) return
  const id = key.slice(5)
  try {
    decideFocus = noteKey(id)
    await update($, DECIDE, s => ({ ...s, notes: { ...s.notes, [id]: value } }))
  } catch (_e) {
    // keep the last text
  }
}

// Enter in a note field (the Input's submit). The host clears its field on submit (roundtable/register.ts keepDraft), but a note is only SENT by the send Button, so Enter must
// not lose what was typed: keep the text, then draw the pane again so the field is drawn with the kept text. A blank submit is that clear already done: writing it would
// replace notes[id] with ''. Leave the stored note and only redraw.
async function decideKeep($: EngineInterface, key: string, value: string): Promise<void> {
  if (value.trim() !== '') await decideNote($, key, value)
  void $.ui.invalidate('ui.render')
}

// Forget the picks and notes of questions that left the list, and sent marks a day old. Writes only when something is dropped (a write redraws the pane).
async function pruneDecide($: EngineInterface, listed: ReadonlySet<string>, ok: boolean, nowMs: number): Promise<void> {
  const st: DecideState = await read($, DECIDE)
  const busy = (id: string): boolean => st.hold?.[id] !== undefined || (st.fixing?.[id] !== undefined && nowMs - st.fixing[id] <= DECIDE_KEEP_MS) // in an undo window, or reopened to correct: its pick and note are still wanted
  const gone = (id: string): boolean => !listed.has(id) && !busy(id) && (
    st.dismissed?.[id] !== undefined
      ? nowMs - st.dismissed[id] > DECIDE_KEEP_MS
      : st.sent[id] !== undefined ? nowMs - st.sent[id] > DECIDE_KEEP_MS : ok
  )
  const ids = new Set([...Object.keys(st.picks), ...Object.keys(st.notes), ...Object.keys(st.sent), ...Object.keys(st.hold ?? {}), ...Object.keys(st.fixing ?? {}), ...Object.keys(st.dismissed ?? {})])
  const drop = [...ids].filter(gone)
  if (drop.length === 0) return
  const keep = <V,>(o: Record<string, V>): Record<string, V> => Object.fromEntries(Object.entries(o).filter(([id]) => !drop.includes(id)))
  await update($, DECIDE, s => ({ ...s, picks: keep(s.picks), notes: keep(s.notes), sent: keep(s.sent), hold: keep(s.hold ?? {}), fixing: keep(s.fixing ?? {}), dismissed: keep(s.dismissed ?? {}) }))
}

// r4 B(c): what the host gave the band, once per change, as one JSON line `{ts, maxRows, bodyColumns, shellRows}` in `<live base>/band-geometry.log` (the live base the pointer names, as every other live file),
// so a real-pane screenshot can be set against the rows the draw got. The file is rewritten whole (the plugin fs only writes); it keeps the last 200 lines. A failed write never stops the draw.
async function logBandGeometry($: EngineInterface, maxRows: number, bodyColumns: number, shellRows: number, expanded = true): Promise<void> {
  const key = maxRows + 'x' + bodyColumns + 'x' + shellRows + (expanded ? 'e' : 'c')
  if (key === geomSeen || liveBaseSeen === null) return
  geomSeen = key
  const path = liveBaseSeen + '/band-geometry.log'
  if (geomLines === null) geomLines = ((await readText($, path)) ?? '').split('\n').filter(l => l !== '')
  geomLines.push(JSON.stringify({ ts: await $.clock.now(), maxRows, bodyColumns, shellRows, expanded }))
  if (geomLines.length > 200) geomLines.splice(0, geomLines.length - 200)
  await $.fs.write(path, geomLines.join('\n') + '\n').catch(() => undefined)
}

// every focus move the host reports (ctrl+x tab stops, clicks, our own focus calls), next to band-geometry.log: requestId (the site), element, origin, component. The last 200 lines. D (ctrl+x tab dwell): which element is each stop.
const appendLogs = new Map<string, string[]>()
const pendingLogs: { name: string; row: Record<string, unknown> }[] = []
async function flushPendingLogs($: EngineInterface): Promise<void> {
  while (liveBaseSeen !== null && pendingLogs.length > 0) { const p = pendingLogs.shift() as { name: string; row: Record<string, unknown> }; await appendLog($, p.name, p.row) }
}
async function appendLog($: EngineInterface, name: string, row: Record<string, unknown>): Promise<void> {
  if (liveBaseSeen === null) { pendingLogs.push({ name, row }); return } // before the first snapshot names the live base: kept, written by flushPendingLogs
  const path = liveBaseSeen + '/' + name
  let lines = appendLogs.get(name)
  if (lines === undefined) { lines = ((await readText($, path)) ?? '').split('\n').filter(l => l !== ''); appendLogs.set(name, lines) }
  lines.push(JSON.stringify({ ts: await $.clock.now(), ...row }))
  if (lines.length > 200) lines.splice(0, lines.length - 200)
  await $.fs.write(path, lines.join('\n') + '\n').catch(() => undefined)
}
const logFocusStop = ($: EngineInterface, ev: { requestId?: unknown; component?: unknown; element?: unknown; origin?: unknown }): Promise<void> => appendLog($, 'band-focus.log', { requestId: ev.requestId, component: ev.component, element: ev.element, origin: ev.origin })

// the forge tab: the widest label asked of the mod below, the narrowest worth asking for, the cells the indicator keeps at least, the rows the full forge view needs
const FORGE_LABEL_MAX = 30
const FORGE_FULL_ROWS = 12
const FORGE_BELOW_MIN_COLS = 26 // the narrowest the mod below is asked for its view (forge-stats draws a one-row summary under this)
// The one-row ask the band makes of the mod below (PM G33): only with no tab open, an alive forge-stats that draws the summary row, a row to spare under the band's own two, and
// a host at least FORGE_BELOW_MIN_COLS wide. null = not asked.
export function forgeRowAsk(active: unknown, summaryRow: boolean, rows: number, columns: number): { maxRows: 1; bodyColumns: number } | null {
  return active === null && summaryRow && rows >= 3 && columns >= FORGE_BELOW_MIN_COLS ? { maxRows: 1, bodyColumns: columns } : null
}
// BL-0359 closed. The speed view sits `beside` the mod below, as shipped. The label's pet is always read (codeforge's pet.json); a null pet draws nothing.
const SPEED_PLACEMENT: SpeedPlacement = 'beside'

const nextTab = (t: PaneTab): PaneTab => PANE_TABS[(PANE_TABS.indexOf(t) + 1) % PANE_TABS.length]
const PAGE_TAB_OF: Partial<Record<PageId, PaneTab>> = {
  now: 'now', decide: 'decide', dispatch: 'dispatch', review: 'review', spend: 'spend',
  hygiene: 'hygiene', fleet: 'fleet', todo: 'decide', help: 'legend', quota: 'spend',
}
const PAGE_CONSOLE_OF: Partial<Record<PageId, ConsoleTab>> = {
  now: 'command', decide: 'command', fleet: 'team', quota: 'quota',
  dispatch: 'self', review: 'self', spend: 'quota', hygiene: 'self',
}
const SLOT_PAGE_OF: Partial<Record<SlotId, BandPageId>> = {
  verdict: 'now', decisions: 'decide', fleet: 'fleet', quota: 'quota',
  dispatch: 'dispatch', review: 'review', spend: 'spend', hygiene: 'hygiene',
}
const pageOfTab = (t: PaneTab): PageId => (t === 'legend' ? 'help' : t as PageId)

// A page digit selects that page; pressing the current page again leaves the pane and its state alone.
async function panePagePress($: EngineInterface, id: PageId): Promise<void> {
  if (id === panePage) return
  panePage = id
  paneTab = PAGE_TAB_OF[id] ?? paneTab
  bandExpand = bandExpandOnPageChange(bandExpand, id)
  keyed(decideScroll, 'page:' + id) // K1: a different page starts at its first row.
  void $.ui.scroll({ in: PANE_ID, to: 'start' }).catch(() => undefined)
  decideLocal = { ...decideLocal, textMode: false, textBuf: '', armed: false } // a tab press ends a note being typed: the mode must not outlive the page
  $.ui.invalidate('ui.render')
  // r8-2 keylog: in the band box the tab Buttons keep their keys across pages, so autoFocus does not fire again and the host's ring stays on the
  // tab of the page left (4 → tab:review). Back on 待決, Down then lands on tab:spend, three tabs away, which v74TabStep reads as the wrap (Up).
  // Put the ring on the page's own tab, as armNote does for the note.
  if (v74Open && (id === 'decide' || id === 'todo')) void ringToTab($, id)
}
async function renderLater($: EngineInterface): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve($.ui.invalidate('ui.render')).catch(() => undefined)
}
async function ringToTab($: EngineInterface, id: PageId): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  if (panePage !== id) return
  await $.ui.focus({ requestId: ABOVE_PROMPT, key: 'tab:' + id }).catch(() => undefined)
}

async function paneTabPress($: EngineInterface, t: PaneTab, legacy = false): Promise<void> {
  if (legacy) {
    if (t === paneTab) {
      markPaneClosed()
      try { await $.ui.close({ id: PANE_ID }) } catch (_e) { /* already closed */ }
      return
    }
    paneTab = t
    panePage = pageOfTab(t)
    decideLocal = { ...decideLocal, textMode: false, textBuf: '', armed: false }
    $.ui.invalidate('ui.render')
    return
  }
  return panePagePress($, pageOfTab(t))
}

// ---- the framed pages' own state (pages/*.ts are pure): focus + fold per page id, and the 待決 page's nav (cursor, fold, note text) beside the DECIDE atom ----
let pageView: Record<string, { focus: number; expanded: boolean; folded?: boolean }> = {}
// how many rows of a page can hold the focus (▸): fleet shows FOLD_AT lines until unfolded, quota every pool, spend its two meter rows; the clamp for j/k and fold
const focusRows = (id: string, expanded: boolean): number => {
  if (id === 'fleet') { const n = consoleSnap?.lines === null || consoleSnap === null ? 0 : fleetRowsOf(consoleSnap.lines).length; return expanded ? n : Math.min(FOLD_AT, n) }
  if (id === 'quota') return consoleSnap?.quota.pools?.length ?? 0
  if (id === 'spend') return spendFocusRows(snapshot)
  return 1
}
let decideLocal: Pick<DecideNav, 'cursor' | 'folded' | 'textMode' | 'textBuf' | 'opt' | 'detailOffset' | 'armed' | 'snap' | 'stale' | 'style' | 'bgOpen' | 'compactExpanded'> = { cursor: NO_NAV.cursor, folded: NO_NAV.folded, textMode: NO_NAV.textMode, textBuf: NO_NAV.textBuf, opt: NO_NAV.opt, style: 'D', bgOpen: false, compactExpanded: false }
let bandExpand: BandExpandState = initialBandExpand('now')
let decideLayout: DecideLayoutMode | null = null
let decideMaxRows = 24
const framePageId = (): string => panePage
// B56: crossing the side-dock width threshold unmounts `<Pane placement="dock">` and mounts `<Pane placement="inline">` (or back).
// On CC 2.1.327 that remount drops the pane's keyboard focus to the prompt and collides on the previous placement's Button keys,
// so digits 1-9 and 0 type into the prompt instead of firing strip hotkeys. Bump the Button key epoch on every placement move and,
// when the pane held (or was opened with) focus, reclaim focus on the new placement's anchor after this render commits.
// v7.4: the page is a full-width framed tree inside the AbovePrompt band, not a host Pane. `v74Open` is its open/closed state (the band's ▴/▾, /live-pane, the i, a slot, Esc);
// `bandLegacy` is the last AbovePrompt draw's legacyTabs (the host's old layout keeps the host Pane and its ui.open / ui.close).
let v74Open = false
// console v5: the wide band (wide/geometry.ts) is on for the last band draw; the pane then docks 94 columns wide and Tab cycles the pages. Set only in the v7.4 band draw.
let bandWide = false
// console v5 wide pane (wide/pane.ts): what the band's last draw could not fit (band.ts overflow) and whether `e` has opened the context; the pane draws them
let wideOverflow: { list: string[]; reply: string[] } = { list: [], reply: [] }
let widePaneCtxOpen = false
function widePaneModel(): PaneModel {
  const page = Math.max(1, (V74_PAGES as readonly string[]).indexOf(panePage) + 1)
  const mark = (sid: string): 'running' | 'failed' | 'waiting' => (sid === 'failed' ? 'failed' : sid === 'running' ? 'running' : 'waiting')
  const rows = consoleSnap?.lines != null ? fleetRowsOf(consoleSnap.lines) : null
  const counts = consoleSnap !== null ? consoleFleetCounts(consoleSnap, tr) : null
  const cards = mergedDecide()
  const none = (n: number): (string | null)[] => Array.from({ length: n }, () => null) // no source for a page's summary yet: the pane says 無
  const summaries = none(9)
  if (cards !== null) summaries[1] = `${cards.length} 張要你選`
  if (counts !== null) summaries[6] = `執行 ${counts.running} · 失敗 ${counts.failed} · ${GLYPHS.state.waiting} ${counts.stuck}`
  return {
    page, tabs: WIDE_TABS, moved: wideOverflow.reply, more: wideOverflow.list, pin: [], ctx: [], ctxFold: false, ctxOpen: widePaneCtxOpen,
    lanes: rows === null ? null : rows.slice(0, 12).map(r => ({ state: mark(r.sid), name: r.line.label, speed: r.word, task: r.line.lead_display ?? '' })),
    lanesHead: rows === null ? '' : `艦隊 · ${rows.length} 條產線`,
    hist: null, events: null, summaries,
  }
}
// `bandLegacy` is null until the first AbovePrompt draw of this session: the mode is not known yet, so an open asked before it (`/live-pane` at startup) is only recorded
// (v74Open) and the first draw opens the host Pane when it turns out to be the old layout.
let bandLegacy: boolean | null = null
const openHostPane = ($: EngineInterface): Promise<unknown> => $.ui.open({ id: PANE_ID, title: 'Autopilot', focus: true, closeOnEscape: true, ...(bandWide ? { columns: PANE_COLS } : {}) } as never)
async function openPane($: EngineInterface): Promise<void> {
  if (bandLegacy === true) await openHostPane($)
  else $.ui.invalidate('ui.render')
}
async function closePane($: EngineInterface): Promise<void> {
  if (bandLegacy === true) { try { await $.ui.close({ id: PANE_ID }) } catch (_e) { /* already closed */ } }
  else $.ui.invalidate('ui.render')
}
// K1: module level (a re-render must not reset the in-flight flag): one open / close at a time
type FlightState = { since: number | null }
const toggleFlightState: FlightState = { since: null } // the flag is the only thing shared between draws; every draw builds its own closure over ITS $ (a press never runs a closure of an older engine)
function singleFlight(run: () => Promise<void>, onBusy: (ageMs: number) => void, ttlMs = 2500, now: () => number = Date.now, st: FlightState = { since: null }): () => Promise<void> {
  return async () => {
    const t0 = now()
    if (st.since !== null && t0 - st.since < ttlMs) { onBusy(t0 - st.since); return }
    st.since = t0
    try { await run() } finally { if (st.since === t0) st.since = null }
  }
}
const toggleFlight = (run: () => Promise<void>, onBusy: (ageMs: number) => void): (() => Promise<void>) => singleFlight(run, onBusy, 2500, Date.now, toggleFlightState)
let panePlacement: 'dock' | 'inline' | null = null
let panePlacementEpoch = 0
let paneFocused = false
let paneOpenAsked = false
let paneOpened = false
// r8 #2: whether the band's frame holds the keyboard now, shown as words in the bottom border (`keys in pane` / `ctrl+x tab`). A focus event that names a band element, or a key that reached the frame, says yes;
// a focus event that names nothing (the prompt took it back), the close key and a closed pane say no.
let v74KeysHeld = false
// r8 #3: how many cards the last `s` sent, shown under the send row (`已送出 N 張 · 尚有 M 張待決`); a new pane open clears it
let v74SendResult: { n: number; left: number } | null = null
// r10 #2: a focus event the program raised itself (the current tab's autoFocus mounting again after a render, or after Esc handed the keyboard back) is not the person taking the keyboard:
// only an event whose origin is the person sets the word to `keys in pane`; any event that names no band element clears it.
export function v74KeysHeldAfter(was: boolean, named: string | undefined, origin: unknown): boolean {
  if (!bandElement(named)) return false
  return (origin as { kind?: unknown } | undefined)?.kind === 'person' ? true : was
}
// r11 #4: while the send preview is up, a focus event that names no band element is the host's Esc handing the keyboard to the prompt; it cancels the preview instead (one meaning for Esc there).
export const v74EscCancelsPreview = (armed: boolean | undefined, open: boolean, page: string, named: string | undefined): boolean => open && armed === true && page === 'decide' && !bandElement(named)
export const v74EscClosesBg = (bgOpen: boolean | undefined, textMode: boolean, open: boolean, page: string, named: string | undefined): boolean =>
  open && bgOpen === true && !textMode && page === 'decide' && !bandElement(named)
// r11 #2: every change of the border word goes through this one function, so the sequence open -> keys -> send -> Esc is testable without the host.
// A send posts the [待決回覆] line to the prompt and starts a turn; the host then gives the first Esc to the turn (it stops it) and raises no focus event for it, so the pane cannot tell
// when the prompt has the keyboard again. After a send the word therefore falls back to `ctrl+x tab` and comes back only on evidence: a key that reached the pane or a focus event of the person.
export type V74KeysEvent = { kind: 'open' } | { kind: 'closed' } | { kind: 'sent' } | { kind: 'key'; key: KeyAction['kind'] } | { kind: 'focus'; named: string | undefined; origin: unknown }
export function v74KeysHeldNext(was: boolean, ev: V74KeysEvent): boolean {
  if (ev.kind === 'open' || ev.kind === 'closed' || ev.kind === 'sent') return false
  if (ev.kind === 'key') return ev.key === 'close' ? false : ev.key !== 'page' ? true : was
  return v74KeysHeldAfter(was, ev.named, ev.origin)
}
const bandElement = (named: string | undefined): boolean => named !== undefined && /^(tab:|card:|letter:|hotkey:|opt:|v74-note$)/.test(named)
function markPaneOpen(): void {
  v74KeysHeld = false
  v74SendResult = null
  v74Open = true
  bandExpand = { ...bandExpand, expanded: true }
  paneOpened = true
  paneOpenAsked = true
  panePlacement = null
}
function markPaneClosed(): void {
  v74KeysHeld = false
  v74Open = false
  bandExpand = { ...bandExpand, expanded: false }
  paneOpened = false
  paneOpenAsked = false
  paneFocused = false
  panePlacement = null
}
async function restorePaneFocus($: EngineInterface, reopen: boolean, key: string | null, epochAtMove: number): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  if (panePlacementEpoch !== epochAtMove) return
  if (reopen && paneOpened) await $.ui.open({ id: PANE_ID, title: 'Autopilot', focus: true, closeOnEscape: true, ...(bandWide ? { columns: PANE_COLS } : {}) } as never).catch(() => undefined)
  if (key === null || panePlacementEpoch !== epochAtMove) return
  await $.ui.focus({ requestId: PANE_ID, key }).catch(() => undefined)
}
function syncPanePlacement($: EngineInterface, placement: 'dock' | 'inline' | undefined, isFocused: boolean | undefined): number {
  const next = placement === 'dock' || placement === 'inline' ? placement : null
  const focused = isFocused === true
  if (next !== null && panePlacement !== null && next !== panePlacement) {
    panePlacementEpoch += 1
    const wantFocus = paneFocused || focused || paneOpenAsked
    const reopen = paneOpened
    panePlacement = next
    if (wantFocus) {
      paneFocused = true
      paneOpenAsked = reopen
      const typingNote = panePage === 'decide' && decideLocal.textMode
      void restorePaneFocus($, reopen, typingNote ? null : focusAnchorKey(panePlacementEpoch), panePlacementEpoch)
    }
    return panePlacementEpoch
  }
  if (next !== null) panePlacement = next
  if (focused) {
    paneFocused = true
    paneOpenAsked = false
  } else if (!paneOpenAsked) {
    paneFocused = false
  }
  return panePlacementEpoch
}
// A key of the framed page (a visible hotkey Button or routeKey, pane.tsx). 待決 goes through decideReduce; fleet, quota and spend keep a focus row and a fold.
const ABOVE_PROMPT = 'above-prompt' // the band site's instance id; $.ui.focus only lands on an element drawn under that request
let noteArmed = false
async function armNote($: EngineInterface): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  if (!decideLocal.textMode) return
  noteArmed = true
  void v74Keylog($, { handler: 'ui.focus', component: 'AbovePrompt', element: 'v74-note', page: panePage, cursor: decideLocal.cursor, focusOwner: 'v74-note', noteOpen: true })
  await $.ui.focus({ requestId: ABOVE_PROMPT, key: 'v74-note' }).catch(() => undefined)
}
let frameKeyChain: Promise<void> = Promise.resolve()
export async function frameKey($: EngineInterface, k: KeyAction): Promise<void> {
  const run = frameKeyChain.then(() => frameKeyBody($, k))
  frameKeyChain = run.then(() => undefined, () => undefined)
  await run
}
async function frameKeyBody($: EngineInterface, k: KeyAction): Promise<void> {
  const cursorBefore = decideLocal.cursor
  void v74Keylog($, {
    handler: 'frameKey', component: 'AbovePrompt', key: k.kind, event: k.kind,
    len: k.kind === 'text' ? [...k.ch].length : undefined,
    page: framePageId(), cursor: cursorBefore, focusOwner: decideLocal.textMode ? 'v74-note' : 'band', noteOpen: decideLocal.textMode,
    ...(k.kind === 'cursor' ? { cursorBefore, cursorAfter: cursorBefore } : {}),
  })
  const noteWas = decideLocal.textMode
  v74KeysHeld = v74KeysHeldNext(v74KeysHeld, { kind: 'key', key: k.kind })
  try {
    if (k.kind === 'page') { await panePagePress($, k.to as PageId); return }
    if (k.kind === 'toggle_ctx') { widePaneCtxOpen = !widePaneCtxOpen; void $.ui.invalidate('ui.render'); return }
    if (k.kind === 'toggle_expand') {
      const synced = bandExpand.expanded === v74Open ? bandExpand : { ...bandExpand, expanded: v74Open }
      bandExpand = toggleBandExpand(synced)
      if (bandExpand.expanded) {
        await panePagePress($, 'now')
        markPaneOpen()
        await openPane($)
      } else {
        panePage = bandExpand.activePage
        paneTab = PAGE_TAB_OF[panePage] ?? paneTab
        markPaneClosed()
        await closePane($)
      }
      return
    }
    if (k.kind === 'close') {
      markPaneClosed()
      await closePane($)
      return
    }
    const id = framePageId()
    if (id === 'decide' && k.kind === 'scroll') {
      scrollPendingPane($, k.by * (k.page ? pendingScroll.detail.room : 1))
      return
    }
    if (id === 'decide') {
      const nowMs = await $.clock.now()
      const st = await read($, DECIDE)
      const v74 = await v74CtxOf($, true)
      // The focus path's cursor event names the card that already has the ▸. Applying it
      // after a move puts the cursor back. A later cursor event in the queue still runs.
      const compactCollapsed = decideMaxRows < DECIDE_COMPACT_MAX_ROWS && decideLocal.compactExpanded !== true
      if (k.kind === 'cursor' && k.at === decideLocal.cursor && !compactCollapsed) {
        void v74Keylog($, {
          handler: 'frameKey', component: 'AbovePrompt', key: 'cursor', event: 'cursor',
          page: framePageId(), cursor: decideLocal.cursor, cursorBefore, cursorAfter: decideLocal.cursor,
          focusOwner: decideLocal.textMode ? 'v74-note' : 'band', noteOpen: decideLocal.textMode,
        })
        return
      }
      const ctx = { live: snapshot, console: consoleSnap, size: { cols: decideCols, rows: 24 }, bodyColumns: decideCols, maxRows: decideMaxRows, t: tr, nowMs, v74 }
      const prevStyle = decideLocal.style ?? 'D'
      const r = decideReduce({ ...st, ...decideLocal }, k, ctx, nowMs)
      decideLocal = { cursor: r.nav.cursor, folded: r.nav.folded, textMode: r.nav.textMode, textBuf: r.nav.textBuf, opt: r.nav.opt, detailOffset: r.nav.detailOffset, armed: r.nav.armed, snap: r.nav.snap, stale: r.nav.stale, style: r.nav.style, bgOpen: r.nav.bgOpen, compactExpanded: r.nav.compactExpanded }
      if ((r.nav.style ?? 'D') !== prevStyle) void $.store.set('decide.style', r.nav.style ?? 'D').catch(() => undefined)
      if (k.kind === 'style' || k.kind === 'expand' || k.kind === 'move' || k.kind === 'cursor' || k.kind === 'prev' || k.kind === 'next') pendingScroll.detail.offset = 0
      if (k.kind === 'cursor') {
        void v74Keylog($, {
          handler: 'frameKey', component: 'AbovePrompt', key: 'cursor', event: 'cursor',
          page: framePageId(), cursor: decideLocal.cursor, cursorBefore, cursorAfter: decideLocal.cursor,
          focusOwner: decideLocal.textMode ? 'v74-note' : 'band', noteOpen: decideLocal.textMode,
        })
      }
      if (r.nav.picks !== st.picks || r.nav.notes !== st.notes) await update($, DECIDE, s => ({ ...s, picks: r.nav.picks, notes: r.nav.notes }))
      await update($, V74_NAV, n => ({ ...n, cursor: r.nav.cursor, picks: r.nav.picks, notes: r.nav.notes, noteMode: r.nav.textMode }))
      if (r.effect?.kind === 'send' && v74.decide !== null) await commitV74Send($, { ...st, ...r.nav }, v74.decide, nowMs)
      else if (r.effect?.kind === 'send') await holdDecide($) // the hold and the claim stay decideundo's: the reducer's own hold is not written
      else if (r.effect?.kind === 'undo') await undoDecide($, r.effect.id)
      else if (r.effect?.kind === 'fill') await fillPrompt($, r.effect.text)
      if (!r.nav.textMode) noteArmed = false
    } else if (id === 'todo') {
      const nav = await read($, V74_NAV)
      const cards = (await v74CtxOf($)).todo ?? []
      const last = Math.max(0, cards.length - 1)
      if (k.kind === 'move') await update($, V74_NAV, () => ({ ...nav, cursor: Math.min(last, Math.max(0, nav.cursor + k.by)) }))
      else if (k.kind === 'cursor') await update($, V74_NAV, () => ({ ...nav, cursor: Math.min(last, Math.max(0, k.at)) }))
      else if (k.kind === 'pick') {
        const c = cards[nav.cursor]
        if (c !== undefined) {
          const at = pickIndex(c.options, k.index) // R6: the pressed letter picks the option it labels, not the position (contract.pickKeys)
          if (at >= 0 && at < c.options.length) await update($, V74_NAV, () => ({ ...nav, picks: { ...nav.picks, [c.id]: at } }))
        }
      }
    } else {
      const v = pageView[id] ?? (id === 'review' ? DEFAULT_REVIEW_VIEW : { focus: 0, expanded: false })
      const last = Math.max(0, focusRows(id, v.expanded) - 1)
      if (k.kind === 'move') pageView[id] = { ...v, focus: Math.min(last, Math.max(0, v.focus + k.by)) }
      else if (k.kind === 'fold') { const expanded = !v.expanded; pageView[id] = { expanded, folded: !expanded, focus: Math.min(v.focus, Math.max(0, focusRows(id, expanded) - 1)) } }
    }
  } catch (_e) {
    // a key never takes the session down
  }
  void $.ui.invalidate('ui.render')
  if (decideLocal.textMode && !noteWas && framePageId() === 'decide') void armNote($)
}
export async function paneKey($: EngineInterface, key: string, over: { paneFocus?: boolean; focusedButton?: boolean } = {}): Promise<KeyAction> {
  const page = framePageId()
  const act = routeKey(key, {
    page,
    paneFocus: over.paneFocus ?? true,
    focusedButton: over.focusedButton ?? false,
    textMode: page === 'decide' && decideLocal.textMode,
    armed: page === 'decide' && decideLocal.armed === true,
    bgOpen: page === 'decide' && decideLocal.bgOpen === true,
    compactExpanded: page === 'decide' && decideLocal.compactExpanded === true,
    wide: bandWide,
  })
  if (act.kind !== 'none' && act.kind !== 'pass' && act.kind !== 'button') await frameKey($, act)
  return act
}
async function fillPrompt($: EngineInterface, text: string): Promise<void> {
  const out = await $.prompt.fill({ text, mode: 'replace' })
  if (!out.isFilled) $.ui.toast(tr('console.command.fill_refused'))
}
// A press inside a framed page: `fleet:fold`, `fleet:see:<line_id>` (open the list so the line is on screen; nothing is sent), `fill:quota:<pool>` (the pool's switch suggestion into the prompt) and any other `fill:<text>`.
async function framePress($: EngineInterface, id: string): Promise<void> {
  try {
    if (id.startsWith(DISMISS_PRESS)) { await decidePress($, id); return }
    else if (/^decide:detail:\d+$/.test(id)) { decideLocal = { ...decideLocal, detailOffset: Number(id.slice('decide:detail:'.length)) } }
    else if (id === 'fleet:fold') { await frameKey($, { kind: 'fold' }); return } // use the same focus clamp as the fold key, including when a tall dock auto-unfolded the body
    else if (id === 'quota:open') { const expanded = !(pageView.quota?.expanded ?? false); pageView.quota = { ...(pageView.quota ?? { focus: 0, expanded: false }), expanded, folded: !expanded } }
    else if (id.startsWith('fleet:see:')) {
      const at = consoleSnap?.lines == null ? -1 : fleetRowsOf(consoleSnap.lines).findIndex(r => r.line.line_id === id.slice('fleet:see:'.length))
      pageView.fleet = { ...(pageView.fleet ?? { focus: 0, expanded: false }), expanded: true, folded: false, ...(at < 0 ? {} : { focus: at }) } // a row is its own Button: pressing it focuses that line and shows it
    } else if (id.startsWith('quota:pool:')) {
      const at = Number(id.slice('quota:pool:'.length))
      const v = pageView.quota ?? { focus: 0, expanded: false }
      const expanded = v.focus === at ? !v.expanded : true
      pageView.quota = { focus: at, expanded, folded: !expanded } // the pool's own row: press it to show its seats, press it again to fold them
    } else if (id.startsWith('spend:meter:')) {
      const at = Number(id.slice('spend:meter:'.length))
      const v = pageView.spend ?? { focus: 0, expanded: false }
      const last = Math.max(0, focusRows('spend', v.expanded) - 1)
      if (Number.isFinite(at)) pageView.spend = { ...v, focus: Math.min(last, Math.max(0, at)) } // a meter row is its own Button: pressing it moves the focus marker
    }
    else if (id.startsWith('fill:quota:')) {
      const pool = id.slice('fill:quota:'.length)
      const sug = consoleSnap?.quota.pools?.find(p => p.pool === pool)?.switch_suggestion ?? null
      if (sug !== null) await fillPrompt($, sug)
    } else if (id.startsWith(FILL_PRESS)) await fillPrompt($, id.slice(FILL_PRESS.length))
  } catch (_e) {
    // a press never takes the session down
  }
  void $.ui.invalidate('ui.render')
}

// the live mod's session start. A function of its own because Claude Code refuses a second matcher-less `session.start` hook in one plugin: the composed module
// (mods/register.ts) registers the one hook and calls this and the viewer's start; the live mod's own tests use `register` below, which hooks it alone.
export async function startLive($: EngineInterface): Promise<void> {
  try {
    await $.command.register({ name: 'live-pane', description: 'Open the Autopilot side pane (it is never opened on its own)' })
  } catch (_e) {
    // a host without commands: the band's own controls still open the pane
  }
  paneTab = 'now'
  panePage = 'now'
  bandLegacy = null
  bandExpand = initialBandExpand('now')
  decideLayout = null
  decideMaxRows = 24
  markPaneClosed()
  panePlacementEpoch = 0
  pageView = {}
  const savedStyle = await $.store.get('decide.style').catch(() => undefined)
  decideLocal = { cursor: NO_NAV.cursor, folded: NO_NAV.folded, textMode: NO_NAV.textMode, textBuf: NO_NAV.textBuf, opt: NO_NAV.opt, style: savedStyle === 'C' ? 'C' : 'D', bgOpen: false, compactExpanded: false }
  Object.assign(pendingScroll, { list: newScroll(), detail: newScroll(), cursor: '' })
  resetNoteInputs()
  consoleReadMs = -Infinity
  consoleFeed = makeConsoleFeed(undefined, undefined, consoleIngestFrom)
  barTab = null
  shellMenu = 'd'
  shellOn = false
  bandShellOff = false
  bandCollapsed = initialBandCollapsed()
  bandSeenCount = null
  geomSeen = null
  geomLines = null
  folded.clear() // a new Claude Code session opens every section
  pressSeq += 1 // presses still in flight become stale: they assign nothing and leave the chain alone
  decided = null
  holdTimer?.cancel() // the undo-window timer holds the previous session's engine handle: this session starts its own
  holdTimer = undefined
  if (Object.keys((await read($, DECIDE)).hold ?? {}).length > 0) startHoldTimer($) // a send still inside its window when /clear came: the new session takes it over (an expired one goes out on the first tick)
  if (timer === undefined) timer = $.clock.every(TICK_MS, () => liveTick($))
  factsPrunedAt = -Infinity
  await refresh($)
}

// every hook of the live mod except `session.start`
export function registerLive(on: Parameters<Register>[0]): void {
  // /live-pane: the pane is never opened on its own (plan B); this and the band's i and slots are the ways to open it
  on('command.run', { command: 'live-pane' }, async ($) => {
    bandExpand = { ...bandExpand, expanded: true, manualExpanded: true }
    markPaneOpen()
    await openPane($)
    return {}
  })
  // /clear ends the session but no session.start follows and the timer survives it (S7): only a real exit stops it.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && timer !== undefined) {
      timer.cancel()
      timer = undefined
    }
    if (e.reason !== 'clear' && holdTimer !== undefined) {
      holdTimer.cancel()
      holdTimer = undefined
    }
    return next(e)
  })

  // Time every model request from its stream (BL-0359): send -> first content chunk -> last chunk. The rate's window is picked by stepRate (speed.ts): hidden thinking is written
  // before the first chunk, so it counts from send. Chunks are yielded unchanged; a request without usage records nothing.
  on('turn.step', async function* ($, e, next) {
    const sent = performance.now()
    let first: number | null = null
    let last: number | null = null
    let thinkingStreamed = false
    const stream = next(e)
    for await (const chunk of stream) {
      if (chunk.kind !== 'engine') {
        const now = performance.now()
        if (first === null) first = now
        last = now
        if (chunk.kind === 'thinking' && chunk.text.length > 0) thinkingStreamed = true
      }
      yield chunk
    }
    const result = await stream.result
    // Measuring must never break the turn: whatever fails below (the rate, the state write, the redraw) is dropped, and the result is returned either way.
    try {
      const usage = result.usage
      if (usage) {
        const outTokens = usage.output_tokens ?? 0
        const { decodeMs, tps } = stepRate({ sent, first, last, outTokens, thinkingStreamed, serverToolMs: serverToolMs(result.serverToolUses) })
        let agent: string | undefined
        if (e.agentId !== undefined) {
          try {
            const found = (await $.agent.list()).find(a => a.id === e.agentId)
            const named = found?.description || found?.name || found?.type
            if (named) agent = named.slice(0, 40)
          } catch (_e) { /* no agent list: the sample is kept without a name */ }
        }
        const step: Step = { at: Date.now(), model: usage.model ?? e.model, isSubagent: e.agentId !== undefined, ttftMs: first !== null ? first - sent : null, decodeMs, outTokens, tps, ...(e.agentId !== undefined ? { agentId: e.agentId } : {}), ...(agent !== undefined ? { agent } : {}), ...(first !== null && !thinkingStreamed ? { floor: true } : {}) }
        await update($, STEPS, list => [...validSteps(list), step].slice(-KEEP_STEPS))
        await $.ui.invalidate('ui.render')
      }
    } catch (_e) {
      // a sample lost is a sample lost; the turn goes on
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    shellOn = false
    if (e.props.hasSurvey) return next(e)
    const legacyTabs = (e.props as { legacyTabs?: boolean }).legacyTabs === true
    // `o4Shell` (tests only) keeps the pre-v7.4 band + host Pane path alive for the O4 shell suites; no setting or host prop sets it.
    const v74 = !legacyTabs && (e.props as { o4Shell?: boolean }).o4Shell !== true
    const firstDraw = bandLegacy === null
    bandLegacy = !v74
    if (firstDraw && bandLegacy && v74Open) await openHostPane($) // an open asked before the mode was known
    // the i opens the panel on the Now tab; pressed again while the panel is open it shows the next tab (7 tabs, the ? legend last, then Now again) (the pane never gets the keyboard
    // while the person holds the i, so this is the keyboard way to change tab). "Open" is the engine's own record, $.ui.panes() (the pane
    // is listed until it closes, however it was opened). No hotkey: the band's autoFocus puts the keyboard path at Ctrl+x Tab, Enter.
    const info = async () => {
      if (!legacyTabs) return pageOpen('now')
      if (consoleOn) return consoleInfo()
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
        if (seq === pressSeq) { paneTab = tab; panePage = pageOfTab(tab) }
        markPaneOpen()
        $.ui.invalidate('ui.render')
        await openPane($)
      } finally {
        if (seq === pressSeq) decided = null
      }
    }
    // a slot pressed opens the pane on the tab that explains it (model.ts slotTab). It is a press like the i's: it takes a sequence number, so an
    // i press still in flight becomes stale and cannot drag the tab back, and it records its tab as `decided` while its open is in flight, so an
    // i landing meanwhile steps on from the slot's tab instead of reading a pane $.ui.panes() does not list yet.
    const openOn = async (tab: PaneTab, unfold: string | null = null, pageId: PageId = pageOfTab(tab)) => {
      const seq = ++pressSeq
      decided = Promise.resolve(tab)
      paneTab = tab
      await panePagePress($, pageId) // K1: band and slot navigation also enter at the top.
      if (unfold !== null) folded.delete(unfold)
      try {
        markPaneOpen()
        $.ui.invalidate('ui.render')
        await openPane($)
      } finally {
        if (seq === pressSeq) decided = null
      }
    }
    // console mode: band row 2 shows the new page names 1-8 (without digit hotkeys); pressing one opens the pane on that page
    const pageOpen = async (id: BandPageId, unfold: string | null = null, legacyCon?: ConsoleTab) => {
      const tab = PAGE_TAB_OF[id] ?? 'now'
      consoleTab = legacyCon ?? PAGE_CONSOLE_OF[id] ?? 'command'
      decideLocal = { ...decideLocal, textMode: false, textBuf: '', armed: false }
      await openOn(tab, unfold, id)
    }
    const consoleInfo = async () => {
      let isOpen = false
      try { isOpen = (await $.ui.panes()).some(p => p.id === PANE_ID) } catch (_e) { /* the engine could not list panes: treat the pane as closed */ }
      const nextCon = isOpen ? nextConsoleTab(consoleTab) : 'command'
      const at = BAND_PAGE_TABS.indexOf(panePage as BandPageId)
      const nextPage: BandPageId = isOpen && at >= 0 ? BAND_PAGE_TABS[(at + 1) % BAND_PAGE_TABS.length] : 'now'
      await pageOpen(nextPage, null, nextCon)
    }
    // v7.4 S1 / §2.5: the band's ▾展開 / ▴收合 toggle. Expand switches to page 1 ('now') and remembers previous page; collapse restores previous page and closes the band frame.
    const togglePaneRun = async () => {
      const listed = await $.ui.panes().catch(() => [] as { id: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[])
      if (v74) {
        const synced = bandExpand.expanded === v74Open ? bandExpand : { ...bandExpand, expanded: v74Open }
        bandExpand = toggleBandExpand(synced)
        void appendLog($, 'band-reload.log', { step: 'toggle-press', panes: listed, v74Open, action: bandExpand.expanded ? 'open' : 'close' })
        if (bandExpand.expanded) { await pageOpen('now'); return }
        panePage = bandExpand.activePage
        paneTab = PAGE_TAB_OF[panePage] ?? paneTab
        markPaneClosed()
        await closePane($)
        return
      }
      const action = listed.some(p => p.id === PANE_ID) ? 'close' : 'open'
      void appendLog($, 'band-reload.log', { step: 'toggle-press', panes: listed, v74Open, action })
      if (action === 'open') { await pageOpen('now'); return }
      markPaneClosed()
      await closePane($)
    }
    const togglePane = toggleFlight(togglePaneRun, (age) => { void appendLog($, 'band-reload.log', { step: 'toggle-busy', ageMs: age }) })
    const slot = (id: SlotId) => (consoleOn ? pageOpen(SLOT_PAGE_OF[id] ?? 'now', slotUnfolds(id), consoleSlotTab(id)) : openOn(slotTab(id), slotUnfolds(id), id === 'spend' ? 'spend' : undefined))
    // a tab of the band row: the open tab is a memory state; pressing it again closes it. In the console mode a page tab opens the pane on that page (the forge tab keeps its band behaviour)
    const onTab = (id: BarTabId | ConsoleTab | BandPageId) => {
      // the 待決 tab is the O4 card shell (barTab 'decide', drawn at maxRows >= SHELL_ROWS). In the console mode / framed pages the shell is the default and a press on 待決 keeps it open;
      // any other page name closes it and opens the pane on that page (forge keeps its band toggle).
      const paged = !legacyTabs || (consoleOn && id !== 'forge')
      if (paged && id === 'decide') { barTab = 'decide'; bandShellOff = false; $.ui.invalidate('ui.render'); return }
      if (paged) { barTab = null; bandShellOff = true; void pageOpen(id as BandPageId); return }
      barTab = barTab === id ? null : (id as BarTabId)
      $.ui.invalidate('ui.render')
    }
    for (const m of Object.values(bandScroll)) m.framed = false // a draw that does not frame its window hands the scroll to the engine
    const el = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    // a maxRows that is missing or not a number is no room: the mod below is not asked
    const rows = Number.isFinite(e.props.maxRows) ? e.props.maxRows : 0
    const t = tr
    // What the mod below (codeforge's forge-stats) is asked: the same event, only maxRows, bodyColumns and scroll.bodyRows changed (bodyRows follows maxRows, never below 0; a scroll
    // that was not there stays absent). requestId and every other field stay as received.
    const lower = (maxRows: number, bodyColumns: number) => {
      const scroll = e.props.scroll
      return next({ ...e, props: { ...e.props, maxRows, bodyColumns, ...(scroll === undefined ? {} : { scroll: { ...scroll, bodyRows: Math.max(0, scroll.bodyRows - (e.props.maxRows - maxRows)) } }) } })
    }
    // The speed label (BL-0359): the live mod measures it itself (speed.ts), so the mod below is no longer asked for a one-row label and two speeds can never stand on the band.
    // One row. With a fetched fleet summary (and not in the console mode) the fleet segment is fitted onto that line, right after the verdict, and the speed shares its room.
    // Otherwise the label keeps the cells the indicator's narrowest form leaves it (at most FORGE_LABEL_MAX); none while no request was timed.
    let forge: ForgeSegment[] | null = null
    const steps = validSteps(await read($, STEPS))
    // the label sits on the left after the i (`│ ` + label) and a short forge tab joins the strip; the indicator keeps what it needs at its narrowest, the label gets the rest.
    // Console mode stays at FORGE_LABEL_MAX and never draws the pet (the console band's bytes stay what they were). Outside it, 48 holds a 5-step spark plus the pet: that label is 31 cells and 30 drops the pet.
    const indicatorMin = snapshot !== null && snapshot.band !== null ? Math.min(BAND_MIN_COLS, layoutBand(snapshot.band.slots, BAND_MIN_COLS).width) : BAND_MIN_COLS
    const con = !legacyTabs || consoleOn ? { ...consoleNav(), cols: columns } : null // X1/X4: the shared strip reads the same source health and counts as the pages in every mode.
    const usageOn = con !== null || usageTabFits(columns, t, GLYPHS.structure.speed) // no 用量 tab in the console mode, so it is never hidden behind the `›`
    const labelMax = consoleOn ? FORGE_LABEL_MAX : 48
    const labelCols = Math.min(labelMax, columns - indicatorMin - barStrip(snapshot, t, null, GLYPHS.structure.speed, usageOn, con).width - 1 - 2)
    // forgeMore: something was timed but the band has no room for the label (its smallest form) and its tab; the strip then ends in a dim `›` Button (key 'more') that opens the forge view, so the keyboard still reaches it
    let forgeMore = false
    let bandPreset: { segs: Seg[]; width: number } | null = null
    const snap = snapshot
    const fleetNow = await read($, FLEET)
    // X3: a bus snapshot owns every pane/band count. Preserve the existing
    // task-only band when no console snapshot has ever been available.
    // r10 #3: in the v7.4 band the 產線 counts are the 現況 page's own (v74PmCounts over fleet pm status), so the band and the page never disagree; before that feed answers, the older sources stay
    const pmNow = v74 ? pmFeed.status() : null
    const fleetCounts = pmNow !== null ? v74LineCounts(pmNow) : consoleSnap !== null ? consoleFleetCounts(consoleSnap, t) : fleetNow.fetchedMs !== null
      ? { stuck: fleetNow.totals.stuck, running: fleetNow.totals.running, waiting: fleetNow.totals.waiting } : null
    const fleetSlot = snap !== null && snap.band !== null && (!consoleOn || v74) ? slotFleet(fleetCounts, t, v74) : null // v7.4: the band row carries the fleet counts in console mode too (design S1)
    if (fleetSlot !== null && snap !== null && snap.band !== null) {
      const base = snap.band.slots
      const atV = base.findIndex(s => s.id === 'verdict')
      // v7.4 (design S1): `待決 N` after the fleet counts, N = the cards `fleet decision list` returned; a click opens the 待決 page
      const decideN = v74 ? mergedDecide()?.length ?? 0 : 0
      const decideSlot: Slot | null = decideN > 0 && !base.some(s => s.id === 'decide') ? { id: 'decide', segs: [{ text: t('v74.b.decide_word'), dim: true, tag: 'chip' }, { text: ' ', tag: 'chip' }, { text: String(decideN), tag: 'chip' }] } : null
      // r8 #12 (design S1): `艦隊 … │ 來源 <load source> ⚑ n │ 待決 N`. The hygiene slot moves up to sit right after the fleet counts and carries the 來源 label; v7.4 only.
      const hyg = v74 ? base.find(s => s.id === 'hygiene') ?? null : null
      const sourceSlot: Slot | null = hyg === null ? null : { ...hyg, segs: [{ text: t('v74.b.source_word'), dim: true, tag: 'chip' }, { text: ' ', tag: 'chip' }, ...hyg.segs] }
      // r8 #4: the band names the question of the card the 待決 page has at its cursor, not the first pending one
      const feedCards = v74 ? mergedDecide() : null
      const cur = feedCards === null || feedCards.length === 0 ? null : feedCards[Math.max(0, Math.min(feedCards.length - 1, decideLocal.cursor))]
      const baseQ = cur === null ? base : base.map(s => s.id !== 'verdict' || !s.segs.some(x => x.tag === 'reason') ? s : { ...s, segs: s.segs.map(x => x.tag === 'reason' ? { ...x, text: cur.question } : x) })
      const rest = hyg === null ? baseQ : baseQ.filter(s => s.id !== 'hygiene')
      const atV2 = rest.findIndex(s => s.id === 'verdict')
      const withFleet = [...rest.slice(0, atV2 + 1), fleetSlot, ...(sourceSlot === null ? [] : [sourceSlot]), ...(decideSlot === null ? [] : [decideSlot]), ...rest.slice(atV2 + 1)]
      const parts = rows >= 1 ? v74SpeedParts(steps, petText) : null
      // room is the cells left after the strip and the one-cell gap. The › is not subtracted here: fittedBandWidth counts it when `more` is set.
      // Row 2 owns the tab strip. Subtracting it here left row 1 about 40 cells at 100 columns,
      // and v74FitBand then emptied 艦隊 and 開發 while the separators stayed.
      const roomFor = (_speedTab: boolean) => Math.max(1, columns - 4)
      // v7.4 keeps tok/s on this row (a dash when nothing was timed). Narrowing may drop other chips, not the speed label.
      let fitted = layoutBandLine(withFleet, roomFor(parts !== null), parts, V74_NARROW, !usageOn)
      if (parts !== null && fitted.speed === null) fitted = { ...fitted, speed: parts }
      const drawMore = !usageOn || forgeMore
      const segs = v74FitBand(fitted.band.segs, fitted.speed, drawMore, roomFor(fitted.speed !== null))
      forge = fitted.speed
      bandPreset = { segs, width: fittedBandWidth(segs.reduce((n, s) => n + displayWidth(s.text), 0), null, false) }
    } else if (v74) {
      // No project (or no band slots): the status row still keeps 狀態, 艦隊, 來源, 待決 N, i and tok/s. Only the own-seat segment says there is no project.
      const withFleet = v74BareBandSlots(snap?.text ?? t('band.waiting'), fleetCounts, mergedDecide()?.length ?? 0, t)
      const parts = rows >= 1 ? v74SpeedParts(steps, consoleOn ? null : petText) : null
      const roomFor = (_speedTab: boolean) => Math.max(1, columns - 4)
      let fitted = layoutBandLine(withFleet, roomFor(parts !== null), parts, V74_NARROW, false)
      if (parts !== null && fitted.speed === null) fitted = { ...fitted, speed: parts }
      const segs = v74FitBand(fitted.band.segs, fitted.speed, false, roomFor(fitted.speed !== null))
      forge = fitted.speed
      bandPreset = { segs, width: fittedBandWidth(segs.reduce((n, s) => n + displayWidth(s.text), 0), null, false) }
    } else if (rows >= 1) {
      const parts = speedLabelParts(steps, consoleOn ? null : petText)
      if (parts !== null) {
        if (labelCols >= FORGE_LABEL_MIN) forge = forgeFit(parts, labelCols)
        forgeMore = forge === null
      }
    }
    if (barTab === 'forge' && forge === null && !forgeMore) barTab = null // nothing is timed: the tab is gone
    // console mode: the band opens on the 待決 shell by default (O4) whenever the host gave the shell its rows; pressing another page name turns the default off
    const active: BarTabId | null = barTab ?? (consoleOn && !bandShellOff && rows >= SHELL_ROWS ? 'decide' : null)
    // the tabs the band has no room for, in strip order; one dim `›` ends the row and steps through them (the last press closes), so the keyboard still reaches each
    const hidden: BarTabId[] = [...(usageOn ? [] : ['usage' as const]), ...(forgeMore ? ['forge' as const] : [])]
    const at = active === null ? -1 : hidden.indexOf(active)
    const moreTo: BarTabId | null = hidden.length === 0 ? null : at < 0 ? hidden[0] : (hidden[at + 1] ?? active)
    const bandNow = await $.clock.now()
    const qSrc = consoleSnap?.sources.quota?.state
    // the band is two rows: row 2 is the tab row while the pane is closed. With the pane open the pane's own strip is the only tab row on screen (folds A4).
    let paneOpen = false
    if (v74) paneOpen = v74Open
    else if (!legacyTabs || consoleOn) { try { paneOpen = (await $.ui.panes()).some(p => p.id === PANE_ID) } catch (_e) { /* the engine could not list panes: treat the pane as closed */ } }
    // The O4 shell is the band's normal state whenever the host gave 12 rows and the width holds a main window.
    // It does not wait for a band tab, and it does not care whether the pane is open. legacyTabs keeps the old bar only under 12 rows (the E1 suites).
    // r4: the console band and the framed pages (the PM's pane) take the shell from SHELL_MIN_ROWS up, whatever legacyTabs says and with or without a live snapshot; the older tab-row band
    // (legacyTabs, no console) keeps its own layout and only shows the shell with a band tab open at SHELL_ROWS.
    const shellMode = !legacyTabs || consoleOn
    const shellFits = shellMode
      ? rows >= SHELL_MIN_ROWS && shellGeometry(columns) !== null
      : rows >= SHELL_ROWS && shellGeometry(columns) !== null && snapshot !== null && active !== null && active !== 'forge'
    // No shell and no tab open, a row to spare under the band's own two and a forge-stats that draws the summary row (its heartbeat says so): that row goes to the mod below (PM G33).
    // While it holds the row the repair line is not drawn on the band (it stays in the pane and the page).
    let forgeRow: unknown | null = null
    const forgeAsk = shellFits || v74 ? null : forgeRowAsk(active, forgeSummaryRow, rows, columns)
    if (forgeAsk !== null) {
      const answer = await lower(forgeAsk.maxRows, forgeAsk.bodyColumns)
      if (answer !== undefined && answer !== null && (answer as { type?: string }).type !== 'engine') forgeRow = answer
    }
    const bar = BandBar(el, snapshot, columns, t, { onInfo: info, onSlot: slot, onTab }, active, forge, usageOn, moreTo, con, bandPreset, consoleOn && consoleSnap !== null ? bandQuotaSeg(normalizedPools(consoleSnap), bandNow, t, qSrc) : null, paneOpen || v74, legacyTabs, forgeRow !== null, legacyTabs ? undefined : () => { void togglePane() }, paneOpen)
    // v7.4: single-row fixed-column band (2026-11-23-band-layout v4) + framed page within maxRows.
    // console v5 is opt-in while the 209-column suites still pin the v7.4 frame: AUTOPILOT_LIVE_V5=1 and the size switch (wide/geometry.ts) both have to hold
    const v5On = v74 && (await $.env.get('AUTOPILOT_LIVE_V5').catch(() => undefined)) === '1'
    bandWide = v5On && wideNext(bandWide, columns, rows)
    if (v74) {
      decideMaxRows = rows
      decideCols = paneWidth(columns)
      const prevLayout = decideLayout
      decideLayout = decideLayoutMode(columns, decideLayout)
      if (rows >= DECIDE_COMPACT_MAX_ROWS && decideLocal.compactExpanded === true) {
        decideLocal = { ...decideLocal, compactExpanded: false }
      }
      if (prevLayout === 'single' && decideLayout === 'dual') {
        decideLocal = { ...decideLocal, style: 'D', compactExpanded: false }
      }
      bandExpand = bandExpandOnResize(bandExpand, columns)
      const decideCards = mergedDecide()
      const curCard = decideCards !== null && decideCards.length > 0 ? decideCards[Math.max(0, Math.min(decideCards.length - 1, decideLocal.cursor))] : null
      const publishedMs = snap?.published_at != null && Number.isFinite(Date.parse(snap.published_at)) ? Date.parse(snap.published_at) : null
      const liveAgeMs = publishedMs !== null ? Math.max(0, bandNow - publishedMs) : null
      const liveStale = snap?.state === 'stale'
      const pmFetched = pmFeed.fetchedMs()
      const tasksSrc = consoleSnap?.sources.tasks
      const lineAgeMs = pmFetched !== null ? Math.max(0, bandNow - pmFetched) : tasksSrc?.at_ms != null ? Math.max(0, bandNow - tasksSrc.at_ms) : fleetNow.fetchedMs !== null ? Math.max(0, bandNow - fleetNow.fetchedMs) : null
      const lineStaleFlag = tasksSrc?.state === 'stale' || tasksSrc?.state === 'expired'
      const decideFetched = decideFeed.fetchedMs()
      const decideAgeMs = decideFetched !== null ? Math.max(0, bandNow - decideFetched) : liveAgeMs
      const pendCount = decideCards !== null ? decideCards.length : (snap !== null ? snap.pending.filter(d => !isStepCard(d)).length : null)
      const ls = snap?.detail.load_source ?? null
      const srcLabel = ls === null ? null : ls.source === 'dev' ? t('band.src_dev') : ls.source === 'cache' ? t('band.src_cache') : t('band.src_unknown')
      const srcFlags = snap?.detail.residue?.needs_human_count ?? ls?.flags.length ?? null
      const qcState = snap?.detail.qc ?? null
      const qcStatus: 'alert' | 'ok' | 'none' = qcState === null ? 'none' : qcState.state === 'owed' ? 'alert' : 'ok'
      const lastStep = steps.length > 0 ? steps[steps.length - 1] : null
      const tpsAgeMs = lastStep !== null ? Math.max(0, bandNow - lastStep.at) : null
      const tpsDataState = dataStateOf(tpsAgeMs, lastStep === null)
      const sparkBars = steps.length > 0 ? sparkText(steps.slice(-5).map(s => s.tps)) : null
      const remText = curCard !== null
        ? t('band.onerow.remind_prefix') + curCard.question
        : snap?.band?.reason ?? (liveStale && snap?.text ? snap.text : null)
      const remState = liveStale ? 'stale' : dataStateOf(decideAgeMs, false, false)
      const height = Math.min(Math.max(0, rows - 1), V74_FRAME_MAX) // total band height = height + 1 <= maxRows
      const showBox = v74Open && height >= V74_FRAME_MIN
      const oneRowInput: OneRowInput = {
        reminder: { text: remText, cardId: curCard?.id ?? null, state: remState, hasRec: curCard?.options.some(o => o.recommended) ?? false },
        line: {
          stalled: fleetCounts?.stuck ?? null,
          running: fleetCounts?.running ?? null,
          failed: (fleetCounts as { failed?: number } | null)?.failed ?? (fleetCounts !== null ? 0 : null),
          waiting: fleetCounts?.waiting ?? null,
          state: dataStateOf(lineAgeMs, fleetCounts === null, lineStaleFlag),
        },
        source: { label: srcLabel, flags: srcFlags, state: dataStateOf(liveAgeMs, ls === null && snap?.band === null, liveStale) },
        pend: { count: pendCount, hasRec: curCard?.options.some(o => o.recommended) ?? false, state: dataStateOf(decideAgeMs, pendCount === null, liveStale) },
        qc: { status: qcStatus, state: dataStateOf(liveAgeMs, qcState === null, liveStale) },
        tps: { value: lastStep?.tps ?? null, state: tpsDataState },
        spark: { bars: sparkBars, state: tpsDataState },
        pet: { text: petText, state: petText === null ? 'missing' : 'normal' },
        // Codex R3 Major3 / Carbon R3 M1: band toggle MUST match actual visible pane state (never ▴收合 when no pane is shown).
        expanded: showBox,
      }
      if (bandWide) {
        // console v5 wide band (P1 skeleton): the page's own rows go in the list / reply columns as they are; P3/P4 re-skin them, P2 moves the overflow to the pane
        const pageNo = Math.max(1, (V74_PAGES as readonly string[]).indexOf(panePage) + 1)
        const list = pageNo === 2 && decideCards !== null ? decideCards.map((c, i) => (c === curCard ? GLYPHS.structure.folded + ' ' : '  ') + String(i + 1) + ' ' + cardSentenceOf(c)) : []
        const reply = pageNo === 2 && curCard !== null ? [curCard.question, ...curCard.options.map((o, i) => PICK_KEYS[i] + ': ' + o.label)] : remText !== null ? [remText] : []
        const status = wideStatusText({ verdict: '進行中', running: fleetCounts?.running ?? null, failed: oneRowInput.line.failed, stalled: fleetCounts?.stuck ?? null, pending: pendCount, act: null, tps: lastStep?.tps ?? null, spark: sparkBars, labels: { fleet: '艦隊', pending: '待決', act: '動手' } })
        await logBandGeometry($, rows, columns, 17)
        const wide = wideBand({ page: pageNo, tabs: WIDE_TABS, stepTitle: '', list, reply, status, hints: '' })
        wideOverflow = wide.overflow
        return WideBandTree(el, wide)
      }
      const onOneRowSegment = (id: BandSegmentId) => {
        const target = bandSlotPage(id, false)
        if (target === null) return
        bandExpand = { ...bandExpand, expanded: true, manualExpanded: true, activePage: target }
        void pageOpen(target as BandPageId)
      }
      const onOneRowPage = (id: PageId) => {
        bandExpand = { ...bandExpand, expanded: true, manualExpanded: true, activePage: id }
        void pageOpen(id as BandPageId)
      }
      const oneRow = OneRowBand(el, layoutOneRowBand(oneRowInput, columns, t), onOneRowSegment, () => { void togglePane() }, showBox ? undefined : { onPage: onOneRowPage })
      if (!showBox) return stackRows(el, [oneRow])
      const page = await paneTree($, e as never, false, height, rows)
      await logBandGeometry($, rows, columns, height + 1)
      return stackRows(el, [page, oneRow])
    }
    if (shellMode && rows < SHELL_MIN_ROWS) {
      const n = snapshot === null ? 0 : new Set(snapshot.pending.filter(d => !isStepCard(d)).map(cardKey)).size
      await logBandGeometry($, rows, columns, 1)
      return stackRows(el, shellNote(el, t('shell.short_height', { n, m: rows, min: SHELL_MIN_ROWS })))
    }
    if (shellMenu !== 'd' || !shellFits) bandBatch = NO_BATCH // the batch lives while the 待決 card view is drawn
    const pendingAll: LiveDecision[] = snapshot === null ? [] : snapshot.pending
    if (shellFits) {
      const nowMs = await $.clock.now()
      const panelRaw = await ($.state.get as (ref: { plugin: string; key: string }) => Promise<{ value: unknown }>)({ plugin: 'forge-stats', key: 'panel' }).then(g => g.value, () => null)
      const fleet = await read($, FLEET)
      const lanes: FleetLaneSum[] = fleet.lanes.map(l => ({ lane: l.lane, needYou: l.needYou, failed: l.failed, stuck: l.stuck, running: l.running, waiting: l.waiting }))
      const grouped = new Map<string, LiveDecision[]>()
      for (const d of pendingAll) {
        const k = cardKey(d)
        const g = grouped.get(k)
        if (g === undefined) grouped.set(k, [d])
        else g.push(d)
      }
      const nonStep: LiveDecision[] = []
      const stepOnly: LiveDecision[] = []
      const marked = new Set<string>()
      for (const [k, copies] of grouped) {
        const step = copies.find(c => isStepCard(c))
        const plain = copies.find(c => !isStepCard(c))
        if (plain !== undefined) { nonStep.push(plain); if (step !== undefined) marked.add(k) }
        else if (step !== undefined) stepOnly.push(step)
      }
      const st = await read($, DECIDE)
      const pending = shellMenu === 'd' ? nonStep : []
      // The pane's batch (decidebatch.ts batchSync, the same pure function and the same DecideState): the card list keeps its order and its numbers, a card the session or the CLI closed stays greyed in place
      // (`answered elsewhere`), and a sent card is greyed. The batch is the band's own variable (the pane's closes with the pane's tab), synced at every draw of the 待決 tab and closed on any other.
      bandBatch = st === null ? NO_BATCH : batchSync(bandBatch, pending, st, t('decide.elsewhere'))
      const entries: { key: string; d: LiveDecision | null }[] = st === null ? [] : bandBatch.order.map(k => {
        const listed = pending.find(d => cardKey(d) === k)
        const reopened = listed === undefined ? bandBatch.card[k] : undefined // a sent card the session already closed, reopened here to correct: still actionable
        const d = listed ?? (reopened !== undefined && reopened.id !== null && st.fixing?.[reopened.id] !== undefined ? reopened : null)
        return { key: k, d }
      })
      const live = entries.flatMap(e => (e.d === null ? [] : [e.d]))
      const sentOf = (d: LiveDecision): boolean => d.id !== null && st !== null && st.sent[d.id] !== undefined && !decideFixing(d, st)
      const cards: Card[] = st === null ? [] : entries.map(({ key, d }) => d === null
        ? { id: key, name: cardSentenceOf({ title: bandBatch.card[key]?.title ?? null, question: bandBatch.q[key] }), answer: bandBatch.ans[key] ?? null, sent: false, grey: true, gone: true }
        : { id: key, name: cardSentenceOf(d), answer: draftOf(d, st), sent: sentOf(d), grey: sentOf(d) })
      if (shellMenu === 'd' && st !== null) {
        const have = new Set(cards.map(c => c.id))
        for (const d of stepOnly) {
          const key = cardKey(d)
          if (have.has(key)) continue
          have.add(key)
          entries.push({ key, d })
          cards.push({ id: key, name: t('shell.step_mark') + ' ' + cardSentenceOf(d), answer: null, sent: false, grey: false })
        }
        const mark = t('shell.step_mark') + ' '
        for (const c of cards) if (marked.has(c.id) && !c.name.startsWith(mark)) c.name = mark + c.name
      }
      decideCursor = cards.length === 0 ? 0 : Math.max(0, Math.min(cards.length - 1, decideCursor))
      const cur = entries[decideCursor]?.d ?? undefined
      const curKey = entries[decideCursor]?.key
      const curLocked = cur !== undefined && st !== null && (sentOf(cur) || decideHeld(cur, st)) // sent, or in its undo window: no option, no fill (decideundo.ts applyPick would refuse the pick anyway)
      const optN = cur === undefined || cur.id === null || decideDialog(cur) ? 0 : cur.options.length
      // bandlayout: the card view has no right-hand columns (the roundtable and the usage have their own tabs) and its frame grows upward; every other tab keeps the 12-row frame
      const cardMode = shellMenu === 'd' && cards.length > 0 && st !== null && curKey !== undefined
      const menuWord = shellMenu === 'r' ? t('shell.room') : shellMenu === 'u' ? t('shell.usage') : shellMenu === 'p' ? t('tab.pet') : shellMenu === 'h' ? t('shell.help') : t('tab.decide')
      const planInp = {
        columns, t, menuTitle: leftTitle(cardMode ? 'cards' : 'tabs', t('tab.decide'), t),
        mainTitle: cardMode ? t('shell.main_title', { n: decideCursor + 1, total: cards.length }) : menuWord,
        room: { rows: shellRoom.rows, fresh: freshCount(shellRoom.rows, shellBaseline ?? null) }, panelRaw, nowMs, fleet: lanes,
        ...(cardMode ? { footLeft: decideCursor + 1 + '/' + cards.length, footMain: optN > 0 && !curLocked ? t('shell.hint_pick', { n: Math.min(optN, 6) }) : '' } : {}), // the card view re-plans with the hint of the options it actually draws
        ...(cardMode ? { noRight: true } : {}),
        bodyRows: Math.min(BODY_ROWS, shellContentRows(rows) + (isCompact(rows) ? 0 : 2)), compact: isCompact(rows), // r4: a short band gets a short frame
      }
      const plan0 = shellPlan(planInp)
      if (plan0 !== null) {
        let plan: ShellPlan = plan0
        shellDrawnMs = nowMs
        shellOn = true
        const mainCols = plan.geo.main - 1
        const redraw = () => { void $.ui.invalidate('ui.render') }
        const menuItems = SHELL_MENUS.map(id => ({ id, label: id === 'd' ? t('tab.decide') : id === 'r' ? t('shell.room') : id === 'u' ? t('shell.usage') : id === 'p' ? t('tab.pet') : t('shell.help') }))
        const holdIds = Object.keys(st?.hold ?? {})
        const quickOf = (sendN: number, holds: number[], fillBtn: { label: string; onPress: () => void } | null = null) => cardQuick(el, t, {
          fill: fillBtn,
          sendN, ...(holds.length === 0 ? {} : { undo: { secs: Math.max(0, Math.ceil((Math.max(...holds) - nowMs) / 1000)), onUndo: () => { void Promise.all(holdIds.map(i => undoDecide($, i))).then(redraw) } } }), tip: t(plan.geo.tier === 80 ? 'shell.tip_short' : 'shell.tip_full'),
          onSend: () => { void decidePress($, 'submit').then(redraw) },
          onPrev: () => { if (cards.length > 0) { decideCursor = Math.max(0, decideCursor - 1); redraw() } },
          onNext: () => { if (cards.length > 0) { decideCursor = Math.min(cards.length - 1, decideCursor + 1); redraw() } },
          onMenu: () => { shellMenu = nextShellMenu(shellMenu); redraw() },
        })
        const pickMenu = (id: string) => { shellMenu = id as ShellMenuId; redraw() }
        let main: unknown[]
        let left: LeftItem[]
        let onLeft: (id: string) => void
        let progress: unknown
        let quick: unknown[]
        let bare = false
        let bareMain: unknown[] | null = null
        let bareFill: { label: string; onPress: () => void } | null = null
        let barePos = ''
        if (cardMode && st !== null && curKey !== undefined) {
          const pickPress = (k: number) => {
            if (cur === undefined || cur.id === null || curLocked) return
            const id = cur.id
            void decidePress($, 'pick:' + id + ':' + k).then(async () => { // a press only selects: the card stays where it is, so the pick can still be changed before send
              const now = await read($, DECIDE)
              if (now.picks[id] === k) decideLastId = id
              redraw()
            })
          }
          // 附註／其他回答 (an option card) and 打字回答 (a typed one): the button puts the reply line in the prompt box with `$.prompt.fill` (never a submit); the owner types the rest and presses Enter.
          // The fill is the first thing the press does (nothing awaited before it). A dialog's card (ask_user_question) is answered in its dialog: no button.
          const fillText = cur === undefined || curLocked ? null : decideFillText(cur, st)
          const fill = fillText === null ? null : {
            label: t(optN === 0 ? 'shell.fill_type' : 'shell.fill_note'),
            onPress: () => { void $.prompt.fill({ text: fillText, mode: 'replace' }).then(out => { if (!out.isFilled) $.ui.toast(t('shell.fill_refused', { why: out.refusal ?? '-' })) }) },
          }
          const { note: noteKey, doneId: stepId } = bandCardNote(cur, curLocked, fill)
          const note = noteKey === null ? null : t(noteKey)
          const confirming = stepId !== null && st.dismissConfirmId === stepId
          const done = stepId === null ? null : confirming ? [
            { label: '做完了', onPress: () => { void dismissCard($, stepId, true, '做完了').then(redraw) } },
            { label: '還沒', onPress: () => { void cancelDismissConfirmation($, stepId).then(redraw) } },
          ] : [{ label: t('decide.step_done'), onPress: () => { void requestDismissConfirmation($, stepId).then(redraw) } }]
          // the pane's state words (tabs.ts decideCards): held, sent, and for a card closed elsewhere the batch's `answered elsewhere` line; a correcting card (fixing) is open again and says nothing here
          const heldNow = cur !== undefined && decideHeld(cur, st)
          const meta = cur === undefined ? (bandBatch.ans[curKey] ?? null) : heldNow ? t('decide.held') : sentOf(cur) ? t('decide.sent') : null
          const fixable = cur !== undefined && cur.id !== null && !heldNow && sentOf(cur) && !decideDialog(cur)
          const fixId = cur?.id ?? null
          const view = (split: boolean, tight = false, width = mainCols - 1, noFill = false) => cardMain(el, {
            key: curKey, question: cur === undefined ? bandBatch.q[curKey] : cur.question, background: cur === undefined ? null : cur.background, note, fill: noFill ? null : fill, done, confirmation: confirming ? '做完了嗎？' : null, meta, tight, locked: curLocked, grey: cur === undefined || sentOf(cur), split,
            fix: fixable && fixId !== null ? { label: t('decide.fix'), onPress: () => { void decidePress($, 'fix:' + fixId).then(redraw) } } : null,
            advice: cur === undefined || (cur.recommendation === null && cur.why === null) ? null : { label: cur.recommendation ?? '', why: cur.why },
            notAuthorized: cur === undefined ? null : cur.not_authorized,
            width, onPress: pickPress, compact: plan.compact,
            options: cur === undefined || optN === 0 || cur.id === null ? [] : cur.options.map((o, k) => ({ label: o.label, description: o.description, picked: decidePick(cur, st) === k, recommended: cur.recommendation === o.label, key: optKey(cur.id as string, k) })),
          }, t)
          // the frame is as tall as the card, between the 6 content rows of the ordinary frame and what the host's maxRows leaves (the menu row, the quick row and the two frames take 4, the divider and
          // the progress row 2); the tree is never taller than maxRows (the host would open a window of its own over the quick row). A card taller than that goes to the split view (§12.10): the rows
          // scroll over a scrollbar, the options and the Buttons stand fixed under them. Each card has its own offset (bandScroll).
          // r5: a card that does not fit the frame sheds, in this order: the padding rows and the 建議 reason's own row (tight); the divider and the progress row; the frames and the left window (bare:
          // the card's rows, the menu row, the quick row, the fill Button on the quick row). Only a card still taller than that is split and scrolled.
          const avail0 = shellContentRows(rows)
          let whole = view(false)
          let tight = false
          let forceCompact = false
          if (whole.rows.length > avail0) {
            const t1 = view(false, true)
            if (t1.rows.length <= avail0) { whole = t1; tight = true }
            else if (!plan.compact && t1.rows.length <= rows - 4) { whole = t1; tight = true; forceCompact = true }
            else {
              const b = view(false, true, columns - 3, true)
              if (b.rows.length <= rows - 2) { whole = b; tight = true; bare = true }
            }
          }
          const avail = bare ? rows - 2 : forceCompact ? rows - 4 : avail0
          const split = whole.rows.length > avail
          // the strip has priority (§12.10: the options stand in view): it takes its place whenever one scrolling row and the page row still fit above it, even at 12 rows where that leaves the rows less than the 3 the ruling wants (reported); a strip too tall for that, or a card with nothing to press (locked), scrolls whole with the page Buttons alone
          if (split && !curLocked && !plan.compact) { const sp = view(true); if (avail - (1 + sp.strip.length) >= 2) whole = sp }
          const room = split ? avail : Math.min(avail, Math.max(forceCompact || bare ? 1 : MAIN_CONTENT_ROWS, whole.rows.length))
          const compactNow = plan.compact || forceCompact
          if (!bare && (forceCompact || room + (plan.compact ? 0 : 2) !== plan.bodyRows)) { const again = shellPlan({ ...planInp, compact: compactNow, bodyRows: room + (compactNow ? 0 : 2) }); if (again !== null) plan = again }
          if (bare) { bareFill = fill; bareMain = whole.rows; barePos = t('shell.bare_pos', { n: decideCursor + 1, total: cards.length }) }
          const model = bandModel('decide')
          keyed(model, curKey)
          const page = (by: number) => { model.offset = Math.max(0, Math.min(model.max, model.offset + by * Math.max(1, model.room))); redraw() }
          // the hint names only the options whose Button is in the tree: all of them when drawn whole or in the strip, else those in the window (a Button off the tree has no hotkey)
          let seen = whole.keyed.map(x => x.k)
          if (split && plan.compact) {
            // r4: a window of 4 rows or fewer has no room for a strip or page Buttons: the title, the options and then the rest of the card, scrolled by the wheel and the scroll keys
            const win = fixedWindow(whole.rows.length, room, model)
            main = whole.rows.slice(win.offset, win.offset + win.rows)
            seen = whole.keyed.filter(x => x.at === null || (x.at >= win.offset && x.at < win.offset + win.rows)).map(x => x.k)
          }
          else if (split) { const sc = cardSplit(el, t, { top: whole.rows, strip: whole.strip, room, cells: plan.geo.main, model, onPage: page }); main = sc.rows; seen = whole.keyed.filter(x => x.at === null || (x.at >= sc.from && x.at < sc.to)).map(x => x.k) }
          else { fixedWindow(whole.rows.length, room, model); main = whole.rows }
          const hint = curLocked || seen.length === 0 ? '' : seen.every((k, i) => k === i) && (seen.length > 1 || optN === 1) ? t('shell.hint_pick', { n: seen.length }) : t('shell.hint_pick_some')
          if (bare && hint !== '') barePos += ' · ' + hint // no bottom frame in the bare layout: the pick hint rides on the menu row's note
          if (hint !== (optN > 0 && !curLocked ? t('shell.hint_pick', { n: Math.min(optN, 6) }) : '')) { const again = shellPlan({ ...planInp, footMain: hint, bodyRows: plan.bodyRows }); if (again !== null) plan = again }
          left = cardRows(cards, decideCursor, plan.separate ? plan.leftInner : plan.geo.left, plan.bodyRows)
          onLeft = (id: string) => { const i = cards.findIndex(c => c.id === id); if (i >= 0) { decideCursor = i; redraw() } }
          const lastCard = cards.find(c => c.id === decideLastId)
          const prog = progressSegs({ cards: cards.filter(c => c.gone !== true), last: lastCard === undefined || lastCard.answer === null || lastCard.sent ? null : { name: lastCard.name, answer: lastCard.answer }, wide: plan.geo.tier >= 160, width: mainCols - 1, t })
          progress = progressRow(el, prog)
          const sendN = live.filter(d => decideOpen(d, st) && !decideHeld(d, st) && decideLine(d, st) !== null).length
          quick = quickOf(sendN, Object.values(st.hold ?? {}), bare ? bareFill : null)
        } else {
          const content = plan.compact ? plan.bodyRows : plan.bodyRows - 2
          const lines = shellMenu === 'u' ? legacyUsageRows(panelRaw, nowMs, mainCols, content, t) : shellMenu === 'r' ? roomLines(shellRoom.rows, mainCols, content) : null
          main = lines === null
            ? shellNote(el, t(shellMenu === 'p' ? 'shell.pet_soon' : shellMenu === 'h' ? 'shell.help_body' : 'decide.none'))
            : usageDraw(el, lines.length === 0 ? [[{ text: t('shell.room_none'), dim: true }]] : lines)
          left = leftItems(menuItems, shellMenu, plan.geo.left)
          onLeft = pickMenu
          progress = progressRow(el, [])
          quick = quickOf(0, [])
        }
        // One row until a click. d on the open 待決 menu collapses; another menu key expands and selects. A new card while collapsed stays collapsed and marks ⏶N.
        // No focus-free key binding exists ($.command.register is a slash command; a Button hotkey needs this surface's keyboard), so the letter d still needs ctrl+x tab.
        const pendingCount = nonStep.length
        const seen = bandSeenCount === null ? pendingCount : bandSeenCount
        if (bandSeenCount === null) bandSeenCount = pendingCount
        const mark = bandCollapsed && collapsedRowMark(seen, pendingCount)
        if (!bandCollapsed) bandSeenCount = pendingCount
        const applyBand = (target: BandTarget) => {
          const fold = toggleBand({ collapsed: bandCollapsed, menu: shellMenu }, target)
          bandCollapsed = fold.collapsed
          shellMenu = fold.menu
          redraw()
        }
        const applyFold = () => {
          const fold = toggleFold({ collapsed: bandCollapsed, menu: shellMenu })
          bandCollapsed = fold.collapsed
          shellMenu = fold.menu
          redraw()
        }
        const foldCell = { collapsed: bandCollapsed, onPress: applyFold }
        const menu = shellMenuRow(el, t, {
          selected: shellMenu, pending: pendingCount, room: shellRoom.rows.length, awaiting: (snapshot?.awaiting ?? []).length, columns,
          onSelect: applyBand, speed: forge === null ? null : forgeBar(forge).segs, onSpeed: redraw,
          ...(bandCollapsed ? { note: t('shell.collapsed', { n: pendingCount, key: 'd' }), onRow: () => applyBand('row'), mark, fold: foldCell } : bare ? { note: barePos } : {}),
        })
        if (bandCollapsed) {
          await logBandGeometry($, rows, columns, 1, false)
          return stackRows(el, [menu])
        }
        if (bareMain !== null) {
          await logBandGeometry($, rows, columns, bareMain.length + 2)
          return stackRows(el, ShellBare(el, { main: bareMain, bar: menu, quick, columns, fold: foldCell }))
        }
        await logBandGeometry($, rows, columns, plan.bodyRows + 4)
        return stackRows(el, Shell(el, { plan, left, onLeft, main, progress, quick, bar: menu, columns, fold: foldCell }))
      }
    }
    let content: unknown[] = []
    if (active === 'forge') {
      // the room under the bar and the rule: the speed view (ours) and, when there is room for it, the mod below's full view (Ferris, pet, memory, brain)
      // When this tab is shut the mod below is not asked and its element is not in our tree. Its Raster is then not mounted, so its `$.ui.blit` is denied (host contract: `{ deny }` when nothing of the
      // caller's is mounted there) and the screen shows only our tree: no stale picture (checked in a real terminal, BL-0359 round 2). The mod resends its frame once it is drawn again.
      const room = rows - 2 // the speed tab's thresholds are pinned by the speed-tab tests (known red until its own follow-up); with the two-row bar it is one row over budget
      if (room >= SPEED_ROWS) {
        const stack = SPEED_PLACEMENT === 'stack'
        const view = speedView(steps, stack ? SPEED_ROWS : Math.min(room, FORGE_FULL_ROWS), columns, t)
        const belowRows = stack ? room - SPEED_ROWS : room
        const belowCols = stack ? columns : columns - view.used - COL_GAP
        let below: unknown | null = null
        if (belowRows >= FORGE_FULL_ROWS && belowCols >= FORGE_BELOW_MIN_COLS) {
          const answer = await lower(belowRows, belowCols)
          if (answer !== undefined && answer !== null && (answer as { type?: string }).type !== 'engine') below = answer
        }
        if (view.columns.length > 0) content = speedContent(el, view.columns, below, SPEED_PLACEMENT)
      }
    } else if (active === 'decide') {
      // the pane's own 待決 lines, compact; a press is the pane's decidePress, and the draw is asked again once it has written the state
      content = decideContent(el, snapshot, await read($, DECIDE), columns, t, (id: string) => { void decidePress($, id).then(() => $.ui.invalidate('ui.render')) }, rows - 3)
    } else if (active !== null) {
      content = barContent(el, snapshot, active, columns, t, { onSlot: slot })
    }
    if (active !== 'forge' && rows < 3 + content.length) return bar.node // the two bar rows, the rule and the rows do not fit: the two bar rows alone stay
    // The fleet counts are on the band's own line (slotFleet). The mod below gets the row under the band only through forgeRow (above).
    if (forgeRow !== null) return stackBand(el, bar.node, [forgeRow])
    if ((content.length === 0 && (active === null || active === 'forge')) || rows < 3) return bar.node // an open tab with no row of its own still draws its rule: the ━ shows which tab is open
    return stackBand(el, bar.node, [BarRule(el, bar.strip, columns, bar.tabsAt, active), ...content])
  })

  // bandlayout: the band's card view scrolls its own window (the wheel and the scroll keys, when the engine sends them to the band), one offset per tab (bandScroll), kept when the tab is left
  on('ui.focus', ($, e, next) => {
    const raw = e as { element?: unknown; key?: unknown; component?: string }
    const named = typeof raw.element === 'string' ? raw.element : typeof raw.key === 'string' ? raw.key : undefined
    void v74Keylog($, { handler: 'ui.focus', component: raw.component, element: named, origin: ((raw as { origin?: { kind?: unknown } }).origin?.kind as string | undefined), page: panePage, cursor: decideLocal.cursor, focusOwner: decideLocal.textMode ? 'v74-note' : 'band', noteOpen: decideLocal.textMode })
    void logFocusStop($, { requestId: (raw as { requestId?: unknown }).requestId, component: raw.component, element: named, origin: (raw as { origin?: { kind?: unknown } }).origin?.kind })
    if (decideLocal.textMode && noteArmed && named !== 'v74-note' && (named === undefined || named === '')) {
      noteArmed = false
      void frameKey($, { kind: 'text_cancel' })
      return {}
    }
    if (v74EscClosesBg(decideLocal.bgOpen, decideLocal.textMode, v74Open, panePage, named)) {
      void frameKey($, { kind: 'expand' })
      return {}
    }
    if (v74EscCancelsPreview(decideLocal.armed, v74Open, panePage, named)) {
      void frameKey($, { kind: 'disarm' })
      return {}
    }
    // r8-3: the border word follows the keyboard. It only re-renders when the value really flips, and one tick later (two microtasks, as ringToTab does), never inside the focus event:
    // a render there remounts the tab Buttons and the host's focus lands on a card Button, which wrote the cursor back (r8-1 gate, step 22).
    if (v74Open) { const was = v74KeysHeld; v74KeysHeld = v74KeysHeldNext(was, { kind: 'focus', named, origin: (raw as { origin?: unknown }).origin }); if (was !== v74KeysHeld) void renderLater($) }
    const step = decideLocal.textMode || bandLegacy || !v74Open ? null : v74TabStep(panePage, named, (raw as { origin?: unknown }).origin)
    if (step !== null) {
      if (panePage === 'decide') {
        scrollPendingPane($, step.by)
        void ringToTab($, panePage)
      } else void frameKey($, step)
      return {}
    } // the ring stays on the current tab
    const at = v74FocusAt(raw)
    // A summary's focus is a host ring stop, not a request to select that card.
    if (at === null || decideLocal.textMode || panePage !== 'todo' || bandLegacy || !v74Open) return next(e)
    const act = v74FocusCursor(decideLocal.cursor, typeof raw.element === 'string' ? raw.element : raw.key)
    if (act !== null) void frameKey($, act)
    return {}
  })

  // A scroll that is not the band and not the legacy pane (scrollmath.ts takesScroll / scrollHook). One row moves the card cursor.
  on('ui.scroll', ($, e, next) => {
    const ev = e as { by?: number; component?: string }
    void v74Keylog($, { handler: 'ui.scroll', component: ev.component, by: ev.by, page: panePage, cursor: decideLocal.cursor, focusOwner: decideLocal.textMode ? 'v74-note' : 'band', noteOpen: decideLocal.textMode })
    if (ev.component === 'AbovePrompt' || ev.component === 'Pane') return next(e)
    if (panePage === 'decide' && v74Open && !decideLocal.textMode && !bandLegacy && typeof ev.by === 'number' && ev.by !== 0) {
      scrollPendingPane($, ev.by)
      return {}
    }
    const arrow = v74HostScroll(ev, panePage, v74Open, bandLegacy, decideLocal.textMode)
    if (arrow !== null) { void frameKey($, arrow); return {} }
    return next(e)
  })

  on('ui.scroll', { component: 'AbovePrompt' }, ($, e, next) => {
    void v74Keylog($, { handler: 'ui.scroll', component: 'AbovePrompt', by: e.by, page: panePage, cursor: decideLocal.cursor, focusOwner: decideLocal.textMode ? 'v74-note' : 'band', noteOpen: decideLocal.textMode })
    if (panePage === 'decide' && v74Open && !decideLocal.textMode && !bandLegacy && typeof e.by === 'number' && e.by !== 0) {
      scrollPendingPane($, e.by)
      return {}
    }
    const arrow = v74HostScroll(e, panePage, v74Open, bandLegacy, decideLocal.textMode)
    if (arrow !== null) { void frameKey($, arrow); return {} }
    const model = shellOn && shellMenu === 'd' ? bandModel('decide') : barTab === null ? undefined : bandScroll[barTab]
    return model === undefined ? next(e) : scrollHook(model, e, next, () => { void $.ui.invalidate('ui.render') })
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const legacy = (e.props as { legacyTabs?: boolean }).legacyTabs === true
    if (consoleOn && legacy) {
      const tree = await consolePaneOf($, e)
      await probePane($, e, tree)
      return tree
    }
    return paneTree($, e, legacy, null)
  })

  // All live and console tabs share the bottom window; scroll keys move its
  // offset. A host without a frame still receives the event through next(e).
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    return scrollHook(decideScroll, e, next, () => { void $.ui.invalidate('ui.render') })
  })
}
export function pageNeedsSteps(page: PageId): boolean {
  return page === 'forge' || page === 'spend'
}
// The framed page's tree. `boxRows` null: the Pane surface (the legacy / dock path, as before). A number: v7.4, the page drawn as a full-width box of that many rows (borders included) plus the tab row under it,
// inside the AbovePrompt band (pane.tsx framedView). Same state, same renderers, same press handlers.
async function paneTree($: EngineInterface, e: { props: any; surface: string }, legacy: boolean, boxRows: number | null, boxMaxRows: number | null = null): Promise<unknown> {
  if (boxRows === null) hostScrollHome($, e.props.scroll, paneTab)
  decideCols = paneWidth(e.props.bodyColumns)
  decideInputs = inputsFor(e.surface)
  await decideRepair($, await read($, DECIDE))
  decideScroll.redraw = () => { void $.ui.invalidate('ui.render') }
  const decideNow = await $.clock.now()
  const fleet = await fleetFor($)
  const frameNow = legacy ? 0 : await $.clock.now()
  const epoch = legacy || boxRows !== null ? 0 : syncPanePlacement($, e.props.placement, e.props.isFocused)
  const petPanel = !legacy && panePage === 'pet'
    ? await ($.state.get as (ref: { plugin: string; key: string }) => Promise<{ value: unknown }>)({ plugin: 'forge-stats', key: 'panel' }).then(g => g.value, () => null)
    : undefined
  const v74 = legacy ? undefined : await v74CtxOf($, boxRows !== null)
  const askRowsRaw = asksFeed.rows()
  const askRows = !legacy && askRowsRaw !== null && askRowsRaw.length > 0
    ? askBandRows(askRowsRaw, boxRows !== null ? Math.max(20, decideCols - 4) : decideCols, frameNow)
    : undefined
  const tree = Pane(
    $.ui.resolve(e), snapshot, paneTab, (t: PaneTab) => { void paneTabPress($, t, legacy) }, tr, e.props.bodyColumns,
    () => { paneTab = nextTab(paneTab); panePage = pageOfTab(paneTab); $.ui.invalidate('ui.render') },
    expanded, (id: string) => { const set = isSectionId(id) ? folded : expanded; if (!set.delete(id)) set.add(id); $.ui.invalidate('ui.render') },
    folded, boxRows !== null ? null : e.props.scroll ?? null,
    { state: decideState, batch: decideBatch, now: decideNow, inputs: decideInputs, onPress: (id: string) => { void decidePress($, id) }, onNote: (key: string, value: string) => { void decideNote($, key, value) }, onKeep: (key: string, value: string) => { void decideKeep($, key, value) } },
    decideScroll, fleet, null,
    legacy ? null : { pages: [...PAGES, ...EXTRA_PAGES], pageId: panePage, ...(!legacy ? { pendingScroll } : {}), onPage: (id: PageId) => { void panePagePress($, id) }, console: consoleSnap, others: fleet?.others ?? null, nowMs: frameNow, rows: boxRows ?? frameHeight(e.props.scroll?.bodyRows ?? 24, e.props.placement), ...(boxMaxRows === null ? {} : { maxRows: boxMaxRows }), bodyColumns: decideCols, ...(boxRows === null ? {} : { v74Box: true as const }), ...(askRows !== undefined && askRows.length > 0 ? { askRows } : {}), view: pageView, ...(bandWide && boxRows === null ? { wide: { model: widePaneModel(), onPage: (n: number) => { void panePagePress($, V74_PAGES[n - 1] as PageId) } } } : {}), decide: { ...decideState, ...decideLocal, layoutMode: decideLayout }, v74, onPress: (id: string) => { void framePress($, id) }, onKey: (k: KeyAction) => { void frameKey($, k) }, onText: (v: string) => { void v74Keylog($, { handler: 'input', component: 'Input', element: 'v74-note', len: [...v].length, page: panePage, cursor: decideLocal.cursor, focusOwner: 'v74-note', noteOpen: true }); decideLocal = { ...decideLocal, textBuf: v }; void $.ui.invalidate('ui.render') }, epoch, ...(pageNeedsSteps(panePage) ? { steps: validSteps(await read($, STEPS)) } : {}), ...(panePage === 'pet' ? { pet: petPanel } : {}), ...(panePage === 'room' ? { room: parseRoom((await readRoomText($)) ?? '') } : {}) },
  )
  if (boxRows === null) await probePane($, e as never, tree)
  return tree
}

const pendingScroll = { list: newScroll(), detail: newScroll(), cursor: '' }
function scrollPendingPane($: EngineInterface, by: number, queue = false): void {
  const model = queue ? pendingScroll.list : pendingScroll.detail
  applyScroll(model, { by, contentRows: 0 })
  void $.ui.invalidate('ui.render')
}
const decideScroll = newScroll()
// The band's own scroll models, one per tab (bandlayout, guideline §13.4): leaving a tab keeps its offset, coming back finds the same row. Only the 待決 card view scrolls so far.
const bandScroll: Record<string, ScrollModel> = {}
const bandModel = (tab: string): ScrollModel => (bandScroll[tab] ??= newScroll())

// The 待決 batch (decidebatch.ts): the shell holds it between draws. It closes when nothing is pending or the tab is left; an answer moves the focus to the next card and the scroll offset
// where answerPlan put it, so the next card takes the answered card's place and the list never jumps to the top.
let decideBatch: DecideBatch = NO_BATCH
let bandBatch: DecideBatch = NO_BATCH // the same batch for the band's card view (the O4 shell draw): the band's own variable, synced there, because decideBatch closes with the pane's tab
let decideState: DecideState = NO_DECIDE
let decideCols = DEFAULT_PANE_COLS
let decideInputs = false // whether the surface being drawn has text fields: the pane draws with it and the plans count the note rows with it (decidebatch.ts inputsFor)
let decideFocus: string | null = null // the element key the owner last pressed, typed in or was sent to; the host has no call that reads the focus
function decideSync(st: DecideState): void {
  decideState = st
  decideBatch = paneTab === 'decide' ? batchSync(decideBatch, snapshot === null ? [] : snapshot.pending.filter(d => !isStepCard(d)), st, tr('decide.elsewhere')) : NO_BATCH
}
// The card lines the plans count: the same ones the pane draws (same inputs flag), without the fixed send strip.
function decideCardLines(snap: LiveSnapshot, st: DecideState): PaneLine[] {
  const ctx = { t: tr, cols: decideCols, expanded: new Set<string>(), folded: new Set<string>(), decide: { ...st, inputs: decideInputs, batch: decideBatch } }
  return decideTabLines(snap, ctx).filter(l => l.bar !== true)
}
async function decideFocusTo($: EngineInterface, plan: { focus: string | null; offset: number }): Promise<void> {
  decideScroll.offset = plan.offset
  decideFocus = plan.focus
  decideScroll.redraw?.()
  if (plan.focus === null) return
  const hostKey = plan.focus.startsWith('note:') ? noteInputKey(plan.focus) : plan.focus
  await $.ui.focus({ requestId: PANE_ID, key: hostKey }).catch(() => undefined)
}
// A draw's sync. A card the owner was on that another session or the CLI closed now stays greyed in place (batchSync): the focus goes where a local answer would send it.
async function decideRepair($: EngineInterface, st: DecideState): Promise<void> {
  const prev = decideBatch
  decideSync(st)
  if (snapshot === null || paneTab !== 'decide') return
  const decisionPending = snapshot.pending.filter(d => !isStepCard(d))
  const plan = focusRepair({ prev, batch: decideBatch, focus: decideFocus, lines: decideCardLines(snapshot, st), pending: decisionPending, st, offset: decideScroll.offset, room: Math.max(1, decideScroll.room) })
  if (plan !== null) await decideFocusTo($, plan)
}
async function decideAnswered($: EngineInterface, id: string): Promise<void> {
  const st = await read($, DECIDE)
  const pending = snapshot === null ? [] : snapshot.pending.filter(d => !isStepCard(d))
  decideSync(st)
  const d = pending.find(x => x.id === id)
  if (d === undefined || answerOf(d, st) === null || snapshot === null) return
  const plan = answerPlan({ lines: decideCardLines(snapshot, st), batch: decideBatch, pending, st, answered: id, offset: decideScroll.offset, room: Math.max(1, decideScroll.room) })
  await decideFocusTo($, plan)
}

// The mod cuts every tab's window itself. Keep the engine's outer window at 0
// so a stale host offset cannot hide the fixed footer.
function hostScrollHome($: EngineInterface, scroll: { offset: number } | undefined, _tab?: PaneTab): void {
  if (scroll !== undefined && scroll.offset > 0) void $.ui.scroll({ in: PANE_ID, to: 'start' }).catch(() => undefined)
}

export const register: Register = on => {
  registerLive(on)
  on('session.start', async ($, e, next) => {
    await startLive($)
    return next(e)
  })
}
