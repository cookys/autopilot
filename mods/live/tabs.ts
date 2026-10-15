// mods/live/tabs.ts — the tab builders of the live pane (docs/plans/2026-10-13-live-pane-design-system.md §6.1): 現況, 派工, 審查, 用量, 殘留 and ?.
// Every line is built by a ui.ts component; this file writes no theme key, no glyph literal and no hand-made line (ui-lint.test.js L1, L2, L4-L7).

import { T_EN } from './i18n'
import type { T } from './i18n'
import * as ui from './ui'
import * as U from './ui'
import { cellWidth, displayWidth, isStale, stateOf } from './ui'
import { NO_DECIDE, bandAsks, bandIsDecide, bandIsQuiet, bandIsStalled, bandIsWaiting, DEFAULT_PANE_COLS, NOT_WIRED_ID, PANE_TABS, QUOTA_KEYS, RECENT_EXPANDED_LINES, SECTION, TODO_TOOLS_ID, agoText, attentionReason, bgLabel, collapsedPrompt, commonDirOf, decideDialog, decideLine, decideOpen, decidePick, recommendedIndex, elapsedFrom, exitCodeOf, hygieneChip, loadSourceFor, oneLine, runAgedOut, runEndedMs, runSubject, slotUnit, staleSuffix, tabLabel, truncateToWidth, verdictOf, vetoStep, walkSegs, wrapLines } from './model'
import type { AccountSnap, BandView, CodeReviewView, LivePaneRow, LiveSnapshot, PaneCtx, PaneLine, PaneTab, PlanReviewView, QuotaWindow, RecentGroup, ReviewSeat, Seg, SpendView, VerdictKind } from './model'
import type { Ctx as UiCtx, Column as UiColumn, FactId, FmtKind, Frag, LineKind, RunSubject, SegRole, Stated, TableListRow as UiTableListRow } from './ui'

// ================= Now =================
const KEY_IDS = { stage: 'label.stage', unit: 'label.unit', progress: 'label.progress', phase: 'label.phase' } as const

// P4: the 現況 tab and the global header, built from ui.ts components only (design plan §2.1-§2.3, §5.1). The section order, ids and defaults come from SECTION_ORDER /
// SECTION_DEFAULTS. A summary row is a projection of another tab's fact (a `kv` with `goto`); the tab's own facts are 要你處理, 位置, 背景工作, 任務 and 最近對話.
const nowId = (key: string): string => 'sec:now.' + key
const uiCtxOf = (ctx: PaneCtx): UiCtx => ({ t: ctx.t, cols: ctx.cols, ...(ctx.expanded === undefined ? {} : { expanded: ctx.expanded }) })
const nowMsOf = (snap: LiveSnapshot): number => (typeof snap.detail.now_ms === 'number' && Number.isFinite(snap.detail.now_ms) ? snap.detail.now_ms : 0)
const dotFrag = (): Frag => ui.val(' · ', { tone: 'dim' })
const isFolded = (ctx: PaneCtx, id: string): boolean => ctx.folded?.has(id) === true

// a foldable section: the header (its chip needs a fact), then the body while it is open
function nowSection(u: UiCtx, ctx: PaneCtx, key: string, title: string, body: readonly PaneLine[], o: { right?: Frag; fact?: FactId; defaultFolded?: boolean } = {}): PaneLine[] {
  const id = nowId(key)
  const open = U.sectionOpen(ctx.folded, id, o.defaultFolded === true)
  const head = ui.header(u, title, { id, open }, o.right === undefined ? {} : { right: o.right, fact: o.fact })
  return open ? [head, ...body] : [head]
}

// ---- the global header (§2.2): drawn by pane.tsx above every tab, never by a tab builder ----
export function headerLines(snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const b = snap.band
  if (b === null) return [ui.stateText(snap.header, 'header.verdict'), ui.blank()] // a non-ok snapshot: the state text, nothing invented around it
  const t = ctx.t
  const u = uiCtxOf(ctx)
  const sp = snap.detail.spend
  const ctxFigure = snap.metrics === undefined ? '—' : snap.metrics.ctx
  const metrics: Frag[] = [
    ui.headerProjection('spend.session', sp === null ? '$—' : sp.session, t('header.session')),
    ui.headerProjection('spend.local_today', sp === null ? '$—' : sp.host_all, t('header.host')),
    ui.val(t('header.ctx') + ' ' + ctxFigure, { fmt: 'pct', fact: 'header.verdict' }),
  ]
  const verdict = ui.stateOf('verdict', b.kind.toUpperCase())
  const lines = ui.verdictHeader(u, { state: verdict, word: b.verdict, project: snap.detail.project ?? b.project, elapsed: b.elapsed === '—' ? '' : t('now.since', { e: b.elapsed }), metrics })
  return wrapLines([...lines, ui.blank()], ctx.cols)
}

// ---- the overflow hint (live-pane height, coordinator ruling 2026-10-14): pane.tsx's own scroll state, not a fact of the session. While the window sits at the top
// (`scroll.offset === 0`) over a tree taller than `scroll.bodyRows`, the header's last metrics line ends with `↓ N more rows below`; once the person scrolls the header
// has left the window and the hint is gone. N = tree rows - bodyRows, the tree being the tab strip (its wrapped rows + the rule), the header, the body and a Link row: every
// PaneLine is one drawn row (wrapLine already broke what was wider than the pane). A strip that wraps is the one height this file cannot be sure of, so then the hint says
// "more" without a number. A header line too narrow for the hint drops it: the spend segments are never squeezed or cut.
export type ScrollView = { offset: number; bodyRows: number }
// ---- tab attention: which tab holds something for the owner, visible without opening it. The tab NAME is drawn warning bold (no symbol): 待決 while a question is open, 殘留 while
// residue needs a person, 審查 while QC is owed. Dispatch is not marked: a running dispatch needs nobody. No number in this variant. ----
export type TabNeed = { count?: number }
export function tabNeeds(snap: LiveSnapshot): Partial<Record<PaneTab, TabNeed>> {
  const out: Partial<Record<PaneTab, TabNeed>> = {}
  if (snap.detail.qc !== null && ui.isNeedYou(ui.stateOf('qc', snap.detail.qc.state))) out.review = {}
  const wt = snap.detail.residue === null ? 0 : snap.detail.residue.needs_human_count
  if (wt > 0) out.hygiene = {}
  if (snap.pending.length > 0) out.decide = {}
  return out
}
export function stripOf(snap: LiveSnapshot | null, ctx: PaneCtx, tab: PaneTab, hasButton: boolean): ui.Strip {
  const needs = snap === null ? {} : tabNeeds(snap)
  return ui.strip(uiCtxOf(ctx), tab, PANE_TABS.map(id => { const n = needs[id]; return { id, label: tabLabel(id, ctx.t), ...(n === undefined ? {} : { need: true, ...({}) }) } }), hasButton)
}
export const stripRows = (snap: LiveSnapshot, ctx: PaneCtx, tab: PaneTab, hasButton: boolean): { rows: number; exact: boolean } => { const s = stripOf(snap, ctx, tab, hasButton); return { rows: s.rows, exact: s.exact } }
// an empty-text line is drawn as an empty Text, which takes no row on screen (the header's trailing blank is one): count only the rows that are really drawn
export const treeRowCount = (strip: number, head: readonly PaneLine[], body: readonly PaneLine[], extra: number): number => strip + [...head, ...body].filter(l => l.text !== '').length + extra
export function withOverflowHint(head: PaneLine[], ctx: PaneCtx, scroll: ScrollView | null | undefined, treeRows: number, exact: boolean): PaneLine[] {
  if (scroll === null || scroll === undefined || scroll.offset !== 0 || treeRows <= scroll.bodyRows) return head
  let at = -1
  head.forEach((l, i) => { if (l.text !== '') at = i })
  if (at < 0) return head
  const line = ui.overflowHint(uiCtxOf(ctx), head[at], exact ? ctx.t('pane.overflow', { n: treeRows - scroll.bodyRows }) : ctx.t('pane.overflow_more')) // null = no room: the hint goes first, the spend figures are neither squeezed nor cut
  if (line === null) return head
  const out = head.slice()
  out[at] = line
  return out
}

// ---- 要你處理: the verdict's reason first when it asks something of the owner, then the open decision, the attention ask and the residue the owner has to act on ----
function attentionPart(u: UiCtx, ctx: PaneCtx, snap: LiveSnapshot): PaneLine[] {
  const t = ctx.t
  const b = snap.band as BandView
  const nowMs = nowMsOf(snap)
  const pending = snap.pending
  const d = pending.length > 0 ? pending[0] : null // every open question is drawn in full on the 待決 tab; this section keeps one row that points there
  const a = snap.sections.attention
  const needYou = ui.stateOf('verdict', 'DECIDE')
  const entries: { s: Stated, make: (bare: boolean) => PaneLine, children: readonly PaneLine[] }[] = []
  const put = (s: Stated, make: (bare: boolean) => PaneLine, children: readonly PaneLine[] = []): void => { entries.push({ s, make, children }) } // bare = the item's state is the chip's: the chip already says the word, so the row keeps only the glyph
  const asks = bandAsks(b)
  if (asks && !(bandIsDecide(b) && (d !== null || a !== null))) { // a decision question or an attention ask IS the reason of a 要你決定 verdict; do not say it twice
    const s = bandIsStalled(b) ? ui.stateOf('verdict', 'STALLED') : bandIsWaiting(b) ? ui.stateOf('attention', { source: null }) : needYou
    put(s, bare => ui.item(u, s, b.why, undefined, { fact: 'now.attention', word: !bare }))
  }
  if (d !== null) { // one row that points at 待決, where every question is drawn whole with its options; the number of questions is the row's text, the tab's name its press target
    put(needYou, bare => ui.item(u, needYou, t('now.pending_sum', { n: pending.length }), undefined, { fact: 'decide.cards', word: !bare, goto: 'decide' }))
  }
  if (a !== null) put(needYou, bare => ui.item(u, needYou, attentionReason(a, nowMs, t), undefined, { fact: 'now.attention', word: !bare }))
  const wt = snap.detail.residue === null ? 0 : snap.detail.residue.needs_human_count
  if (wt > 0) put(needYou, bare => ui.item(u, needYou, t('now.residue', { n: wt }), undefined, { fact: 'now.attention', word: !bare, goto: 'hygiene' })) // an attention row of this tab that points at 殘留; the one residue.groups line is the summary kv
  if (entries.length === 0) return nowSection(u, ctx, 'attention', t('now.needs_you'), [ui.empty(t('now.nothing_waits'), 'now.attention')])
  const chip = ui.worst(entries.map(e => e.s))
  const lines = entries.flatMap(e => [e.make(e.s.id === chip.id), ...e.children])
  return nowSection(u, ctx, 'attention', t('now.needs_you'), lines, { right: ui.countChip(u, chip, entries.length, 'now.attention'), fact: 'now.attention' })
}

// ---- 位置: the walk, stage, unit, progress and phase; the reason is the first row when the verdict asks nothing of the owner ----
function positionPart(u: UiCtx, ctx: PaneCtx, snap: LiveSnapshot): PaneLine[] {
  const t = ctx.t
  const b = snap.band as BandView
  const d = snap.detail
  const m = d.marker
  const F = 'now.position' as const
  const body: PaneLine[] = []
  if (bandIsQuiet(b)) body.push(ui.kv(u, t('label.reason'), [ui.val(b.why, { role: 'prose' })], { fact: F }))
  if (snap.sections.attentionNotWired) body.push(ui.kv(u, t('label.waiting'), [ui.absent(t(NOT_WIRED_ID))], { fact: F }))
  const head = m === null ? '' : [m.size === null ? null : m.size + (m.urgent ? '!' : ''), m.level].filter((x): x is string => x !== null).join('·')
  const noStage = m === null || m.stage === null
  const noUnit = m === null || m.unit === null || slotUnit(m, t) === null
  if (m !== null && m.stage !== null && d.stage !== null && walkSegs(d.stage, m.stage) !== null) {
    const labels = d.stage.walk.map(id => { const key = 'stage.' + id; const text = t(key); return text === key ? id : text })
    const at = d.stage.walk.indexOf(m.stage)
    const all = labels.join(' ')
    body.push(...ui.chart(u, head, ui.walkValue(at, d.stage.walk.length), ui.KEY_W + displayWidth(all) <= ctx.cols - 1 ? all : labels[at], F))
  }
  if (noStage && noUnit) body.push(ui.empty(t('nodata.stage_unit'), F))
  else {
    if (m === null || m.stage === null) body.push(ui.kv(u, t(KEY_IDS.stage), [ui.absent(t('nodata.stage'))], { fact: F }))
    else {
      const age = m.stage_set_at_ms === null ? '—' : elapsedFrom(m.stage_set_at_ms, d.now_ms ?? 0)
      body.push(ui.kv(u, t(KEY_IDS.stage), [ui.val(m.stage, { here: true }), ...(age === '—' ? [] : [ui.val(' · ' + t('now.in_stage', { e: age }), { tone: 'dim', fmt: 'dur' })]), ...(head === '' ? [] : [ui.val(' · ' + head, { tone: 'dim', fmt: 'id' })])], { fact: F }))
    }
    if (m === null || m.unit === null || slotUnit(m, t) === null) body.push(ui.kv(u, t(KEY_IDS.unit), [ui.absent(t('nodata.unit'))], { fact: F }))
    else {
      const { index, total } = m.unit
      const k = Math.min(Math.max(index, 1), total)
      const cells = Math.min(total, 10)
      const on = total > 10 ? Math.max(1, Math.min(10, Math.ceil((k * 10) / total))) : k
      const extra = (m.unit.label === '' ? '' : ' ' + m.unit.label) + ' (' + m.unit.kind + ')' + (m.review_families.length > 0 ? ' · ' + t('now.families', { n: m.review_families.length }) : '')
      body.push(ui.kv(u, t(KEY_IDS.unit), [ui.stepBar(cells, on, { here: true }), ui.fmtd('count', ' ' + index + '/' + total), ui.val(extra, { role: 'prose', tone: 'dim' })], { fact: F }))
    }
  }
  body.push(ui.kv(u, t(KEY_IDS.progress), [ui.val(b.progress, { role: 'prose', ...(b.progressDim ? { tone: 'dim' } : {}) })], { fact: F }))
  if (!ui.hasStageArrow(b.phase)) body.push(ui.kv(u, t(KEY_IDS.phase), [ui.val(b.phase, { role: 'prose' })], { fact: F }))
  return nowSection(u, ctx, 'where', t('now.where'), body.map(l => (l.fact === undefined ? l : ui.ownerRow('now', l.fact, l))))
}

// ---- 各分頁: one projection row per other tab (§2.3), each a `kv` with `goto` and its own fact ----
// the code-review round as the review tab and this tab's one review row both read it (§3.3), so the two cannot disagree
function codeRound(c: CodeReviewView, snap: LiveSnapshot): { age: number | null; stale: boolean; states: Stated[]; round: Stated; findings: number; unknown: number } {
  const age = ageMsOf(snap.detail.now_ms, c.at)
  const stale = !c.converged && age !== null && U.isStale('codeReview', age) // F4
  const states = c.seats.map(s => U.stateOf('seat', seatSubject('code', s)))
  const round = U.stateOf('round', { stale, converged: c.converged, seats: states })
  return { age, stale, states, round, findings: states.filter(ui.isFindings).length, unknown: states.filter(ui.isUnknown).length }
}

function limitWins(t: T, s: SpendView | null, quota: readonly QuotaWindow[], nowMs: number | null): LimitWin[] {
  const wins: LimitWin[] = []
  if (s !== null && s.brain !== null && s.cap !== null) {
    wins.push({ key: t('label.brain_today'), value: s.brain, cap: s.cap, fact: 'usage.brain', amount: ui.cat(ui.fmtd('money', ui.money(s.brain)), ui.val(' / ', { role: 'prose', tone: 'dim' }), ui.fmtd('money', ui.money(s.cap))) })
  }
  for (const w of quota) {
    const k = QUOTA_KEYS[w.kind]
    const fact: FactId = w.kind === 'five_hour' ? 'usage.window5h' : w.kind === 'seven_day' ? 'usage.window7d' : 'usage.window_other'
    wins.push({ key: k === undefined ? bgLabel(w.kind.replace(/_/g, ' ')) : t(k), value: w.pct, cap: 100, fact, ...(w.resetsAtMs === null || nowMs === null || w.resetsAtMs <= nowMs ? {} : { resetMs: w.resetsAtMs - nowMs }) })
  }
  return wins
}

function tabsPart(u: UiCtx, ctx: PaneCtx, snap: LiveSnapshot): PaneLine[] {
  const t = ctx.t
  const d = snap.detail
  const nowMs = nowMsOf(snap)
  const body: PaneLine[] = []
  // 派工 ›
  {
    const rows = snap.rows
    if (rows === null) body.push(ui.kv(u, t('tab.dispatch'), [ui.absent(t('nodata.prefix', { what: t('nodata.runs') }))], { fact: 'dispatch.counts', goto: 'dispatch' }))
    else if (rows.length === 0) body.push(ui.kv(u, t('tab.dispatch'), [ui.absent(t('dispatch.no_runs'))], { fact: 'dispatch.counts', goto: 'dispatch' }))
    else {
      const st = ui.worst(rows.map(r => ui.stateOf('run', runSubject(r))))
      const live = d.counts === null ? rows.filter(r => !r.ended && r.fresh).length : d.counts.confirmed_live
      const parts: Frag[] = [ui.stateLead(u, st), ui.val('  '), ui.fmtd('count', t('now.sum_runs', { n: rows.length })), dotFrag(), ui.fmtd('count', live > 0 ? t('now.running', { n: live }) : t('now.sum_idle'))]
      if (d.stalled > 0) parts.push(dotFrag(), ui.fmtd('count', t('now.stalled', { n: d.stalled })))
      const ended = rows.map(runEndedMs).filter((x): x is number => x !== null)
      if (ctx.cols >= 100 && ended.length > 0 && nowMs > 0) parts.push(dotFrag(), ui.fmtd('ago', t('now.sum_last_end', { age: ui.dur(Math.max(0, nowMs - Math.max(...ended))) })))
      body.push(ui.kv(u, t('tab.dispatch'), parts, { fact: 'dispatch.counts', goto: 'dispatch' }))
    }
  }
  // 審查 ›: the code-review round only (§2.6): its state, the round id and how many seats have findings
  {
    const c = snap.review === null ? null : snap.review.code
    if (c === null) body.push(ui.kv(u, t('tab.review'), [ui.absent(t('nodata.review'))], { fact: 'review.round', goto: 'review' }))
    else {
      const r = codeRound(c, snap)
      const parts: Frag[] = [ui.stateLead(u, r.round), ui.val('  '), ui.val(t('review.code'), { role: 'prose' }), ui.val(' '), ui.fmtd('id', c.generation === null ? 'R—' : 'R' + c.generation)]
      if (r.findings > 0) parts.push(dotFrag(), ui.fmtd('count', t('now.sum_review_fix', { n: r.findings })))
      body.push(ui.kv(u, t('tab.review'), parts, { fact: 'review.round', goto: 'review' }))
    }
  }
  // 用量 ›: the most-used of the brain cap, 5 h and 7 d (one fact, `usage.limit_max`)
  {
    const wins = limitWins(t, d.spend, snap.account === undefined ? [] : snap.account.quota, d.now_ms)
    if (wins.length === 0) body.push(ui.kv(u, t('tab.spend'), [ui.absent(t('nodata.prefix', { what: t(d.spend === null ? 'nodata.spend' : 'nodata.brain') }))], { fact: 'usage.limit_max', goto: 'spend' }))
    else {
      const top = wins.reduce((a, w) => ((w.cap > 0 ? w.value / w.cap : 0) > (a.cap > 0 ? a.value / a.cap : 0) ? w : a))
      body.push(ui.meter(u, t('tab.spend'), top.value, top.cap, { cells: 10, amount: top.amount ?? ui.val(top.key, { role: 'prose', tone: 'dim' }), fact: 'usage.limit_max', goto: 'spend' }))
    }
  }
  // 殘留 ›
  {
    const rs = d.residue
    if (rs === null) body.push(ui.kv(u, t('tab.hygiene'), [ui.absent(t('nodata.prefix', { what: t('nodata.residue') }))], { fact: 'residue.groups', goto: 'hygiene' }))
    else if (rs.needs_human_count === 0) body.push(ui.kv(u, t('tab.hygiene'), [ui.stateLead(u, ui.worst([])), ui.val('  '), ui.val(t('now.sum_no_residue'), { role: 'prose' })], { fact: 'residue.groups', goto: 'hygiene' }))
    else {
      const parts: Frag[] = [ui.stateLead(u, ui.stateOf('residueGroup', 'dirty')), ui.val('  '), ui.fmtd('count', ui.count(rs.needs_human_count, t('now.sum_residue_unit')))]
      if (rs.needs_human_bytes !== null) parts.push(dotFrag(), ui.fmtd('size', ui.size(rs.needs_human_bytes)))
      body.push(ui.kv(u, t('tab.hygiene'), parts, { fact: 'residue.groups', goto: 'hygiene' }))
    }
  }
  return nowSection(u, ctx, 'tabs', t('now.tabs'), body.map(l => ui.projection('now', l.fact as FactId, l)))
}

// ---- 背景工作: live rows first; the ended and the quiet ones sit behind one `▸ N 項已結束` toggle (F1, X0, X1) ----
const ACTIVITY_KEYS = { shell: 'label.bg_shell', monitor: 'label.bg_monitor', agent: 'label.bg_agent' } as const

function backgroundPart(u: UiCtx, ctx: PaneCtx, snap: LiveSnapshot): PaneLine[] {
  const t = ctx.t
  const nowMs = nowMsOf(snap)
  const live: U.RowSpec[] = []
  const gone: U.RowSpec[] = []
  ;(snap.activity ?? []).forEach((it, i) => {
    const state = ui.stateOf('background', { exit: exitCodeOf(it.tail), quietMs: it.quietMs ?? 0 }) // an item with no output file has no clock: it counts as live
    const key = 'bg:' + i + ':' + it.label.slice(0, 24)
    const showQuiet = (ui.isRunning(state) || ui.isStopped(state)) && it.quietMs !== null
    const meta: ui.MetaPart[] = [t(ACTIVITY_KEYS[it.kind]), ...(it.detail === null ? [] : [it.detail]), ...(showQuiet ? [{ text: t('bg.quiet', { age: ui.dur(it.quietMs as number) }), fmt: 'ago' as const }] : [])]
    const spec: U.RowSpec = {
      group: key, ts: nowMs - (it.quietMs ?? 0) + i / 1000, state, fact: 'now.background', body: it.label, meta,
      ...(it.tail === null ? {} : { toggle: key, children: ui.detail(u, it.tail, { attached: true }) }),
    }
    ;(ui.isRunning(state) ? live : gone).push(spec)
  })
  const body: PaneLine[] = live.length === 0 ? [ui.empty(t('bg.none'), 'now.background')] : ui.list(u, 'now.background', t('bg.noun_live'), live)
  if (gone.length > 0) {
    const open = u.expanded?.has('more:now.background.ended') === true
    body.push(ui.more(u, gone.length, t('bg.noun_ended'), 'more:now.background.ended', open, true))
    if (open) body.push(...ui.list(u, 'now.background.gone', t('bg.noun_live'), gone))
  }
  return nowSection(u, ctx, 'background', t('now.background'), body)
}

// ---- 任務: the unfinished ones; the finished ones sit behind one `▸ N 項已完成` toggle ----
function tasksPart(u: UiCtx, ctx: PaneCtx, snap: LiveSnapshot): PaneLine[] {
  const t = ctx.t
  const tk = snap.sections.tasks
  if (tk === null) {
    const note = snap.sections.tasksNote
    if (note === null) return []
    return nowSection(u, ctx, 'tasks', t('now.tasks'), [ui.empty(note === 'todo_hint' ? t(TODO_TOOLS_ID) : t('tasks.not_wired', { nw: t(NOT_WIRED_ID) }), 'now.tasks')])
  }
  const chip = ui.fmtd('count', tk.completed + '/' + tk.total, 'now.tasks')
  if (tk.total === 0) return nowSection(u, ctx, 'tasks', t('now.tasks'), [ui.empty(t('tasks.none'), 'now.tasks')], { right: chip, fact: 'now.tasks' })
  const spec = (r: { subject: string; status: string }, i: number): U.RowSpec => ({ group: 'task:' + i, ts: i, state: ui.stateOf('task', r.status), fact: 'now.tasks', body: r.subject })
  const rows = tk.rows.map((r, i) => ({ r, i }))
  const open = rows.filter(x => x.r.status !== 'completed').sort((a, b) => Number(b.r.status === 'in_progress') - Number(a.r.status === 'in_progress') || a.i - b.i).map(x => spec(x.r, x.i))
  const done = rows.filter(x => x.r.status === 'completed').map(x => spec(x.r, x.i))
  const body: PaneLine[] = open.length === 0 ? [ui.empty(t('tasks.all_done'), 'now.tasks')] : ui.list(u, 'now.tasks', t('tasks.noun_open'), open, { keepOrder: true })
  if (tk.completed > 0) {
    const shown = u.expanded?.has('more:now.tasks.done') === true
    body.push(ui.more(u, tk.completed, t('tasks.noun_done'), 'more:now.tasks.done', shown, true))
    if (shown) body.push(...ui.list(u, 'now.tasks.shown', t('tasks.noun_done'), done, { keepOrder: true }))
  }
  return nowSection(u, ctx, 'tasks', t('now.tasks'), body, { right: chip, fact: 'now.tasks' })
}

function nowLinesRaw(snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  if (snap.band === null) return [] // a non-ok snapshot: the header line is the state text, there is no body
  const u = uiCtxOf(ctx)
  return U.sections('now', {
    attention: attentionPart(u, ctx, snap),
    where: positionPart(u, ctx, snap),
    tabs: tabsPart(u, ctx, snap),
    background: backgroundPart(u, ctx, snap),
    tasks: tasksPart(u, ctx, snap),
    recent: snap.recent === undefined ? [] : recentLines(snap.recent, ctx),
  })
}
// ================= Decide (待決) =================
// The owner's open questions, one compact card each: `n. question`, the background, a row of option Buttons (the recommended one starred, the picked one in
// success text), an optional note field, and what stalls. Under the cards one Button sends every answered question as a single prompt (register.ts). A phone has
// no text field, so a question without options says to answer in the conversation there.
function decideCards(u: UiCtx, ctx: PaneCtx, snap: LiveSnapshot): PaneLine[] {
  const t = ctx.t
  const F = 'decide.cards' as const
  const list = snap.pending
  if (list.length === 0) return [ui.empty(t('decide.none'), F)]
  const dv = ctx.decide ?? { ...NO_DECIDE, inputs: false }
  const needYou = ui.stateOf('verdict', 'DECIDE')
  const sentState = ui.stateOf('task', 'PENDING') // a question already sent: not yet closed by the session
  const out: PaneLine[] = []
  list.forEach((d, i) => {
    const id = d.id
    const sent = id !== null && dv.sent[id] !== undefined
    const title = (i + 1) + '. ' + d.question + staleSuffix(d, t)
    out.push(ui.item(u, sent ? sentState : needYou, title, sent ? [t('decide.sent')] : undefined, { fact: F, word: false }))
    if (displayWidth(title) > ctx.cols - 1 - 4) out.push(...ui.detail(u, d.question, { attached: true })) // the headline is one cut line; the whole question follows
    if (d.background !== null) out.push(...ui.detail(u, d.background, { fact: F }))
    const pick = decidePick(d, dv)
    const rec = recommendedIndex(d)
    const dialog = decideDialog(d)
    if (d.options.length > 0) {
      out.push(...ui.choiceRows(u, d.options.map((o, k) => ({ label: o.label, picked: pick === k, recommended: rec === k, ...(sent || id === null || dialog ? {} : { press: 'pick:' + id + ':' + k }) })), { fact: F }))
      if (d.recommendation !== null && d.why !== null) out.push(ui.recommendNote(u, d.why, F))
      if (pick !== null && d.options[pick].description !== '') out.push(...ui.detail(u, d.options[pick].description, { attached: true, at: 0 }))
    }
    if (!sent) {
      if (id !== null && dv.inputs && !dialog) out.push(ui.fieldRow(u, t(d.options.length > 0 ? 'decide.note' : 'decide.reply'), { key: 'note:' + id, placeholder: t(d.options.length > 0 ? 'decide.note_ph' : 'decide.reply_ph'), value: dv.notes[id] ?? '', fact: F }))
      else if (dialog) out.push(...ui.detail(u, t('decide.in_dialog'), { fact: F }))
      else if (d.options.length === 0 || id === null) out.push(...ui.detail(u, t('decide.in_chat'), { fact: F }))
    }
    const meta = [...(d.blocks === null ? [] : [t('decide.blocks', { b: d.blocks })]), ...(d.source === null ? [] : [t('decide.source', { s: d.source })]), ...(d.recommendation !== null && rec === null ? [t('decide.recommend', { r: d.recommendation })] : [])]
    if (meta.length > 0) out.push(...ui.detail(u, meta.join(' · '), { fact: F }))
    out.push(ui.blank())
  })
  const mine = list.filter(d => d.id !== null && !decideDialog(d)) // a question with no id, or one the asker's dialog answers, cannot be answered from here: it only says so
  const open = mine.filter(d => decideOpen(d, dv))
  const answered = open.filter(d => decideLine(d, dv) !== null).length
  if (mine.length === 0) return out.slice(0, -1) // no send row: drop the blank that closed the last card
  if (open.length === 0) out.push(ui.actionRow(u, t('decide.sent_all'), { fact: F }))
  else out.push(ui.actionRow(u, t('decide.submit', { n: answered, total: open.length }), { fact: F, ...(answered > 0 ? { press: 'submit' } : {}) }))
  return out
}
function decideLinesRaw(snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  if (snap.band === null) return [] // a non-ok snapshot: the header line is the state text, there is no body
  return U.sections('decide', { cards: decideCards(uiCtxOf(ctx), ctx, snap) })
}
export const decideTabLines = (snap: LiveSnapshot, ctx: PaneCtx = { t: T_EN, cols: DEFAULT_PANE_COLS }): PaneLine[] => wrapLines(decideLinesRaw(snap, ctx), ctx.cols)

export function recentLines(recent: RecentGroup[] | null | undefined, ctx: PaneCtx): PaneLine[] {
  const t = ctx.t
  const u = uiCtxOf(ctx)
  const open = U.sectionOpen(ctx.folded, SECTION.recent, U.SECTION_DEFAULTS['now.recent'].folded) // the history starts folded (SECTION_DEFAULTS)
  const head = ui.header(u, t('recent.title'), { id: SECTION.recent, open })
  if (!open) return [head]
  if (recent === null || recent === undefined || recent.length === 0) return [head, ui.empty(t('recent.empty'), 'now.recent')]
  const you = t('recent.you')
  const F = 'now.recent' as const
  const noState = ui.stateOf('task', 'PENDING') // a bullet row has no state of its own; list() still wants one to order by
  const specs: U.RowSpec[] = recent.map((g, i) => {
    const isOpen = u.expanded?.has(g.id) === true
    let children: PaneLine[] = []
    if (isOpen) {
      const body: PaneLine[] = []
      for (const l of g.prompt.split('\n')) body.push(...ui.detail(u, l, { fact: F }))
      body.push(...ui.detail(u, t('recent.ai') + ':', { fact: F }))
      for (const l of g.reply === '' ? [] : g.reply.split('\n')) body.push(...ui.detail(u, l, { fact: F }))
      const room = RECENT_EXPANDED_LINES - 1 // the row itself takes one
      children = body.length <= room ? body : [...body.slice(0, room - 1), ...ui.detail(u, '…', { fact: F })]
    }
    return { group: g.id, ts: i, state: noState, fact: F, shape: 'bullet', toggle: g.id, body: you + ': ' + collapsedPrompt(g.prompt), bodyOpen: you + ':', children }
  })
  return [head, ...ui.list(u, 'now.recent', t('recent.noun'), specs, { keepOrder: true })]
}

const cell = (v: string | number | null | undefined): string => (v === null || v === undefined || v === '' ? '—' : String(v))
const DISPATCH_SEC = { running: 'dispatch.running', finished: 'dispatch.finished', other: 'dispatch.other' } as const

// the foreman sidecar (a job's agents and stage) as rows of 執行中: one `item` per agent, notes for the binding, the stage and the empty case (P4: was hand-built text in buildSections)
function foremanLines(u: UiCtx, snap: LiveSnapshot, nowMs: number | null): PaneLine[] {
  const t = u.t
  const f = snap.sections.foreman
  const fact = 'dispatch.runs' as const
  if (f === null) return snap.sections.foremanNotWired ? ui.detail(u, t('foreman.not_wired', { nw: t(NOT_WIRED_ID) }), { fact }) : []
  const out: PaneLine[] = ui.detail(u, f.binding === 'session' ? t('foreman.head_session') : t('foreman.head_bound', { b: f.binding }), { fact })
  const age = (at: number | null, published: number | null): string => ui.ago(at !== null && nowMs !== null ? Math.max(0, nowMs - at) : published === null ? NaN : published * 1000, t)
  const rows: U.RowSpec[] = f.agents.map((g, i) => ({
    group: 'fm:' + i, ts: g.at_ms ?? 0, fact, body: g.description || g.id,
    state: ui.stateOf('run', { rc: g.ended ? 0 : null, final_status: null, stall: false, fresh: !g.stale }),
    meta: [{ text: g.label || '—', fmt: 'id' as const }, { text: age(g.at_ms, g.age_s), fmt: 'ago' as const }, ...(g.stale ? [t('foreman.quiet')] : [])],
  }))
  if (rows.length > 0) out.push(...ui.list(u, 'dispatch.foreman', t('foreman.noun'), rows))
  if (f.stage !== null) out.push(...ui.detail(u, f.stage_source === null ? t('foreman.stage', { stage: f.stage, age: age(f.stage_at_ms, f.stage_age_s) }) : t('foreman.stage_src', { stage: f.stage, age: age(f.stage_at_ms, f.stage_age_s), src: f.stage_source }), { fact }))
  if (f.agents.length === 0 && f.stage === null) out.push(...ui.detail(u, t('foreman.empty'), { fact }))
  return out
}

function dispatchLinesRaw(snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const t = ctx.t
  const u: UiCtx = { t, cols: ctx.cols, ...(ctx.expanded === undefined ? {} : { expanded: ctx.expanded }) }
  const rows = snap.rows
  const nowRaw = snap.detail.now_ms
  const nowMs = typeof nowRaw === 'number' && Number.isFinite(nowRaw) ? nowRaw : null
  const sec = (id: string, title: string, right: Frag | undefined, body: PaneLine[]): PaneLine[] => {
    const open = !isFolded(ctx, id)
    return [ui.header(u, title, { id, open }, right === undefined ? {} : { right, fact: 'dispatch.counts' }), ...(open ? body : [])]
  }
  const own = (line: PaneLine): PaneLine => (line.fact === undefined ? line : ui.ownerRow('dispatch', line.fact, line)) // a toggle row (more, header) carries no fact of its own
  const col = (head: string, min: number, priority: number, cut: 'left' | 'right', flex = false): UiColumn => ({ head, min, priority, cut, ...(flex ? { flex: true } : {}) })
  const columns = (last: string): UiColumn[] => [
    col(t('dispatch.col_run'), 14, 1, 'left', true), col(t('dispatch.col_role'), 8, 5, 'right'), col(t('dispatch.col_engine'), 10, 4, 'right'),
    col(t('dispatch.col_elapsed'), 3, 2, 'right'), col(last, 4, 3, 'right'),
  ]
  const baseCells = (r: LivePaneRow): ui.Cell[] => [{ text: r.run_id, fmt: 'id' }, cell(r.role), { text: cell(r.runner) + ' / ' + cell(r.model), fmt: 'id' }, r.elapsed_s === null ? '—' : { text: ui.dur(r.elapsed_s * 1000), fmt: 'dur' }]
  const out: PaneLine[] = []
  const running: UiTableListRow[] = []
  const finished: UiTableListRow[] = []
  let finishedAll: Stated[] = []
  if (rows !== null) {
    for (const r of rows) {
      const state = ui.stateOf('run', runSubject(r))
      if (!r.ended) {
        const startMs = r.started_at === null ? NaN : Date.parse(r.started_at)
        running.push({ state, group: r.run_id, ts: Number.isFinite(startMs) ? startMs : 0, cells: [...baseCells(r), r.probe_age_s === null ? '—' : { text: ui.ago(r.probe_age_s * 1000, t), fmt: 'ago' }] })
        continue
      }
      finishedAll.push(state)
      if (runAgedOut(r, nowMs)) continue
      const end = runEndedMs(r)
      finished.push({ state, group: r.run_id, ts: end ?? 0, cells: [...baseCells(r), end === null || nowMs === null ? '—' : { text: ui.ago(Math.max(0, nowMs - end), t), fmt: 'ago' }] })
    }
  }
  // 執行中: running, stalled and a run nobody has confirmed alive (◌ 已停)
  const runBody: PaneLine[] = []
  if (rows === null) runBody.push(ui.empty(t('nodata.prefix', { what: t('nodata.runs') }), 'dispatch.runs'))
  else if (running.length === 0) runBody.push(ui.empty(t(rows.length === 0 ? 'dispatch.no_runs' : 'dispatch.no_running'), 'dispatch.runs'))
  else runBody.push(...ui.tableList(u, DISPATCH_SEC.running, t('dispatch.more_running'), columns(t('dispatch.col_seen')), running, { fact: 'dispatch.runs' }))
  runBody.push(...foremanLines(u, snap, nowMs))
  const runChip = running.length === 0 ? undefined : ui.countChip(u, ui.worst(running.map(r => r.state)), running.length, 'dispatch.counts')
  out.push(...sec(DISPATCH_SEC.running, t('dispatch.running'), runChip, runBody.map(l => (l.kind === undefined ? l : own(l)))))
  // 已完成: ended runs, the latest 5 and a toggle for the rest; a run ended more than 6 h ago (FRESH_MS.dispatch) is counted in the chip only
  if (rows !== null) {
    const finBody = finished.length === 0
      ? [ui.empty(t('dispatch.no_finished'), 'dispatch.runs')]
      : ui.tableList(u, DISPATCH_SEC.finished, t('dispatch.more_noun'), columns(t('dispatch.col_ended')), finished, { fact: 'dispatch.runs' })
    const finChip = finishedAll.length === 0 ? undefined : ui.countChip(u, ui.worst(finishedAll), finishedAll.length, 'dispatch.counts')
    out.push(...sec(DISPATCH_SEC.finished, t('dispatch.done'), finChip, finBody.map(own)))
  }
  // 其他分頁: one pointer row to 審查 (a projection, §2.6) and the snapshot note. No review verdict, no spend stamps.
  const gates = snap.gates
  const pointer = gates === null ? ui.val(t('dispatch.no_review_page'), { role: 'prose' }) : gates.length === 0 ? ui.val(t('dispatch.no_receipt'), { role: 'prose' }) : ui.fmtd('count', t('dispatch.gate_count', { n: gates.length }))
  const parts = [t('dispatch.note')]
  const pubMs = snap.published_at === null ? NaN : Date.parse(snap.published_at)
  if (Number.isFinite(pubMs)) parts.push(t('dispatch.snapshot', { at: ui.clock(pubMs, nowMs ?? pubMs) })) // the producer publishes an ISO string; HH:MM per §3.5
  out.push(...sec(DISPATCH_SEC.other, t('dispatch.others'), undefined, [
    ui.projection('dispatch', 'review.gates', ui.kv(u, t('tab.review'), [pointer], { fact: 'review.gates', goto: 'review' })),
    ...ui.detail(u, parts.join(' · '), { fact: 'dispatch.counts' }).map(own),
  ]))
  return out
}

// ================= Review (absorbs the decisions) =================
// P1: built from ui.ts components only (§4); the section order, ids and defaults come from SECTION_ORDER / SECTION_DEFAULTS (§2.1).
type SeatKind = 'code' | 'plan'
const secId = (key: string): string => 'sec:review.' + key

// a code seat reports a `verdict` and a `status`; a plan seat's `status` field holds its verdict (READY, STOP, ...) except while it is `running` / `reviewed`
function seatSubject(kind: SeatKind, s: ReviewSeat): U.SeatSubject {
  if (kind === 'code') return { kind, verdict: s.verdict ?? null, status: s.status }
  const raw = s.status ?? null
  const isStatus = raw !== null && /^\s*(running|reviewed)\s*$/i.test(raw)
  return { kind, verdict: isStatus ? null : raw, status: isStatus ? raw : null }
}
// whole ms since an ISO timestamp, or null when there is no clock or the timestamp does not parse (then nothing is judged stale)
function ageMsOf(nowMs: number | null, at: string | null): number | null {
  if (nowMs === null || at === null) return null
  const then = Date.parse(at)
  return Number.isFinite(then) ? Math.max(0, nowMs - then) : null
}

// seats: a valueless `席位` key, then one `item` per seat at column 12 in seat order, each with its own toggle; the raw verdict / status is the attached detail
function seatLines(u: U.Ctx, kind: SeatKind, seats: readonly ReviewSeat[], states: readonly U.Stated[]): PaneLine[] {
  const t = u.t
  if (seats.length === 0) return [U.kv(u, t('label.seats'), [U.absent(t('review.no_seats'))], { fact: 'review.seats' })]
  const rows: U.RowSpec[] = seats.map((s, i) => {
    const raw = (kind === 'code' ? [s.verdict, s.status] : [s.status]).filter((x): x is string => typeof x === 'string' && x.trim() !== '').join(' · ')
    return {
      group: String(i), ts: i, state: states[i], fact: 'review.seats', body: s.id, ...(s.family ? { meta: s.family } : {}),
      toggle: 'seat:' + kind + ':' + s.id, at: 12, ...(raw === '' ? {} : { children: U.detail(u, raw, { attached: true, at: 12 }) }),
    }
  })
  return [U.kv(u, t('label.seats'), [], { fact: 'review.seats' }), ...U.list(u, 'review.seats.' + kind, t('review.noun_seats'), rows, { keepOrder: true })]
}

function codeSection(u: U.Ctx, c: CodeReviewView | null, snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const t = u.t
  const id = secId('code')
  if (c === null) return snap.review === null ? [U.header(u, t('review.code'), { id, open: U.sectionOpen(ctx.folded, id) }), ...(U.sectionOpen(ctx.folded, id) ? [U.empty(t('nodata.review'), 'review.round')] : [])] : []
  const { age, stale, states, round, findings, unknown } = codeRound(c, snap)
  const meta = stale && age !== null ? U.ago(age, t) : ui.isRunning(round) && findings > 0 ? t('review.findings_running', { n: findings }) : ui.isUnknown(round) && unknown > 0 ? t('review.unknown_seats', { n: unknown }) : undefined
  const metaFmt: U.FmtKind = stale ? 'ago' : 'count'
  const open = U.sectionOpen(ctx.folded, id, stale)
  const head = U.header(u, t('review.code'), { id, open }, { right: U.chip(u, round, meta, metaFmt), fact: 'review.round' })
  if (!open) return [head]
  const range = c.base === null && c.head === null ? null : U.sha((c.base ?? '—') + '..' + (c.head ?? '—'))
  const sep = (): U.Frag => U.val(' · ', { tone: 'dim' })
  const value: U.Frag[] = [U.fmtd('id', c.generation === null ? 'R—' : 'R' + c.generation)]
  if (range !== null) value.push(sep(), U.fmtd('sha', range))
  if (c.phase !== null) value.push(sep(), U.val(c.phase, { role: 'prose' }))
  if (ctx.cols >= 100 && c.seats.length > 0) value.push(sep(), U.fmtd('count', t('review.seat_count', { n: c.seats.length })))
  return [head, U.kv(u, t('label.round'), value, { fact: 'review.round' }), ...seatLines(u, 'code', c.seats, states)]
}

function qcSection(u: U.Ctx, snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const t = u.t
  const id = secId('qc')
  const open = U.sectionOpen(ctx.folded, id)
  const q = snap.detail.qc
  if (q === null) return [U.header(u, t('review.qc'), { id, open }), ...(open ? [U.empty(t('nodata.qc'), 'review.qc')] : [])]
  const head = U.header(u, t('review.qc'), { id, open }, { right: U.chip(u, U.stateOf('qc', q.state)), fact: 'review.qc' })
  if (!open) return [head]
  const value: U.Frag[] = []
  if (q.range !== null) value.push(U.fmtd('sha', U.sha(q.range)), U.val(' · ', { tone: 'dim' }))
  value.push(U.fmtd('count', t('review.protected', { n: q.protected_files_count })))
  return [head, U.kv(u, t('label.scope'), value, { fact: 'review.qc' })]
}

function decisionsSection(u: U.Ctx, snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const t = u.t
  const id = secId('decisions')
  const open = U.sectionOpen(ctx.folded, id)
  const dv = snap.detail.decisions
  const chip = dv !== null && dv.count > 0 ? U.fmtd('count', t('review.chip_decisions', { n: dv.count, irr: dv.irreversible }), 'review.decisions') : undefined
  const head = U.header(u, t('review.decided'), { id, open }, chip === undefined ? {} : { right: chip, fact: 'review.decisions' })
  if (!open) return [head]
  if (dv === null) {
    return [head, U.empty(snap.sections.decisionsNotWired ? t('decisions.not_wired', { nw: t(NOT_WIRED_ID) }) : t('nodata.decisions'), 'review.decisions')]
  }
  const out: PaneLine[] = [head]
  if (dv.count === 0) out.push(U.empty(t('review.none_decided'), 'review.decisions'))
  const common = commonDirOf(dv.identity)
  // newest first (§2.4), keyed like src/status/decisions-sidecar.js: time in ms * 1000 + min(position, 999); a row with no time sinks to the oldest, the position breaks ties (later first)
  const rows: U.RowSpec[] = dv.rows.map((r, i) => {
    const rid = r.decision_id ?? '—'
    const step = vetoStep(r, common, dv.root, t)
    const children = [...U.detail(u, r.decision, { attached: true }), ...('cmd' in step ? U.command(u, step.cmd) : U.detail(u, step.note, { attached: true }))]
    return {
      group: String(i), ts: (Date.parse(r.at ?? '') || 0) * 1000 + Math.min(i, 999), state: U.worst([]), fact: 'review.decisions', shape: 'bullet', body: rid + '  ' + r.decision,
      bodyOpen: rid + '  ' + t(r.irreversible ? 'decision.irreversible' : 'decision.reversible') + (r.writer === null ? '' : ' · ' + r.writer),
      toggle: 'dec:' + (r.decision_id ?? '#' + i), children,
    }
  })
  out.push(...U.list(u, 'review.decisions', t('review.noun_decisions'), rows, {})) // §2.4: newest first (the ledger is oldest first, so a row's index is its time); past the cap the oldest go behind more
  if (dv.undocumented > 0) out.push(U.kv(u, t('label.undocumented'), [U.fmtd('count', t('review.undocumented', { n: dv.undocumented }))], { fact: 'review.undocumented' }))
  if (dv.ladder === null) out.push(U.kv(u, t('label.ladder'), [U.absent(t('nodata.ladder'))], { fact: 'review.ladder' }))
  else {
    const rung = dv.ladder.rung
    const n = Math.max(0, Math.min(5, Number(rung.slice(1)) || 0))
    const age = ageMsOf(snap.detail.now_ms, dv.ladder.at)
    const value: U.Frag[] = [U.stepBar(6, n + 1), U.val('  '), U.fmtd('id', rung), U.val('  ' + U.ladderSpan(), { fmt: 'id', tone: 'dim' })]
    if (age !== null) value.push(U.val(' · ' + U.ago(age, t), { fmt: 'ago', tone: 'dim' }))
    out.push(U.kv(u, t('label.ladder'), value, { fact: 'review.ladder' }))
  }
  return out
}

function planSection(u: U.Ctx, p: PlanReviewView | null, snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const t = u.t
  if (p === null) return []
  const id = secId('plan')
  const age = ageMsOf(snap.detail.now_ms, p.updated_at)
  if (p.terminal && age !== null && U.isStale('terminalPlan', age)) { // F3: a finished plan review fades to one history line
    return U.detail(u, t('review.plan_history', { id: p.logical_plan_id ?? '—', ago: U.ago(age, t) }), { fact: 'review.plan' })
  }
  const stale = !p.terminal && age !== null && U.isStale('planReview', age) // F2
  const states = p.seats.map(s => U.stateOf('seat', seatSubject('plan', s)))
  const round = U.stateOf('round', { stale, converged: p.terminal, seats: states })
  const open = U.sectionOpen(ctx.folded, id, stale)
  const head = U.header(u, t('review.plan'), { id, open }, { right: U.chip(u, round, stale && age !== null ? U.ago(age, t) : undefined, 'ago'), fact: 'review.plan' })
  if (!open) return [head]
  const plan: U.Frag[] = [U.val(p.logical_plan_id || '—', { fmt: 'id' })]
  if (p.verdict !== null && p.verdict.trim() !== '') plan.push(U.val(' · ', { tone: 'dim' }), U.stateLead(u, U.stateOf('seat', { kind: 'plan', verdict: p.verdict, status: null })))
  const max = p.max_generations
  const roundText = t(max === null ? 'review.round' : 'review.round_of', { g: p.generation, max: max ?? 0 })
  const rounds: U.Frag[] = max !== null && max >= 1 && max <= 12 ? [U.stepBar(max, Math.min(Math.max(p.generation, 1), max), { here: true }), U.val('  '), U.fmtd('id', roundText)] : [U.fmtd('id', roundText)]
  return [head, U.kv(u, t('label.plan'), plan, { fact: 'review.plan' }), U.kv(u, t('label.round'), rounds, { fact: 'review.plan' }), ...seatLines(u, 'plan', p.seats, states)]
}

function reviewTabLinesRaw(snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const u: U.Ctx = { t: ctx.t, cols: ctx.cols, ...(ctx.expanded === undefined ? {} : { expanded: ctx.expanded }) }
  const r = snap.review
  return [
    ...U.sections('review', {
      code: codeSection(u, r === null ? null : r.code, snap, ctx),
      qc: qcSection(u, snap, ctx),
      decisions: decisionsSection(u, snap, ctx),
      plan: planSection(u, r === null ? null : r.plan, snap, ctx),
    }),
  ]
}

// ================= Spend (用量): limits, today, last 24 h, account — drawn through the design system's components (ui.ts), docs/plans/2026-10-13-live-pane-design-system.md §5.4 =================
const METER_CELLS = (cols: number): number => (cols >= 100 ? 40 : 20) // meter and share bars: 20 cells below 100 columns, 40 at or above
const MARK = '\u0001'
// a string-table sentence with one money amount in it: the words stay prose, the amount is the formatter's (fmt-tagged) fragment
function withMoney(template: string, amount: ui.Frag): ui.Frag {
  const [head, tail = ''] = template.split(MARK)
  return ui.cat(ui.val(head, { role: 'prose', tone: 'dim' }), amount, ui.val(tail, { role: 'prose', tone: 'dim' }))
}

type LimitWin = { key: string; value: number; cap: number; amount?: ui.Frag; resetMs?: number; fact: FactId }
function limitsSection(u: ui.Ctx, ctx: PaneCtx, s: SpendView | null, quota: readonly QuotaWindow[], nowMs: number | null): PaneLine[] {
  const t = ctx.t
  const wins = limitWins(t, s, quota, nowMs)
  const open = !isFolded(ctx, SECTION.limits)
  if (wins.length === 0) {
    const what = s === null ? 'nodata.spend' : 'nodata.brain'
    return [ui.header(u, t('usage.limits'), { id: SECTION.limits, open }), ...(open ? [ui.empty(t('nodata.prefix', { what: t(what) }), 'usage.brain')] : [])]
  }
  const worst = Math.max(...wins.map(w => (w.cap > 0 ? w.value / w.cap : 0)))
  const chip = ui.levelChip(worst, t(worst >= 1 ? 'spend.over' : worst >= 0.8 ? 'spend.warn' : 'spend.ok'), 'usage.limit_max')
  const head = ui.header(u, t('usage.limits'), { id: SECTION.limits, open }, { right: chip, fact: 'usage.limit_max' })
  if (!open) return [head]
  // every bar is as long as the longest tail allows, so the rows compare by length; a narrow pane shortens the bars, never wraps the row
  const tail = Math.max(...wins.map(w => (w.amount === undefined ? 0 : 2 + displayWidth(w.amount.text)) + (w.resetMs === undefined ? 0 : 2 + displayWidth(t('ui.reset', { age: ui.dur(w.resetMs) })))))
  const cells = Math.max(4, Math.min(METER_CELLS(ctx.cols), ctx.cols - 1 - ui.KEY_W - 7 - tail))
  const body = wins.map(w => ui.ownerRow('spend', w.fact, ui.meter(u, w.key, w.value, w.cap, { cells, fact: w.fact, ...(w.amount === undefined ? {} : { amount: w.amount }), ...(w.resetMs === undefined ? {} : { resetMs: w.resetMs }) })))
  if (s !== null && s.brain !== null && s.cap !== null) body.push(...ui.detail(u, t('spend.note', { mode: t('spend.mode_' + s.mode) }), { fact: 'usage.brain' }))
  return [head, ...body]
}

function todaySection(u: ui.Ctx, ctx: PaneCtx, s: SpendView | null): PaneLine[] {
  const t = ctx.t
  const open = !isFolded(ctx, SECTION.today)
  const head = ui.header(u, t('now.cost'), { id: SECTION.today, open })
  if (!open) return [head]
  if (s === null) return [head, ui.empty(t('nodata.prefix', { what: t('nodata.spend') }), 'usage.today')]
  const hostN = s.host_all_n
  const rows: PaneLine[] = [ui.kv(u, t('label.host'), [ui.fmtd('money', hostN === null ? s.host_all : ui.money(hostN), 'spend.local_today'), ui.val('  ' + t('spend.all_tiers'), { role: 'prose', tone: 'dim' })], { fact: 'spend.local_today' })]
  if (hostN !== null && s.brain !== null && hostN >= s.brain && hostN > 0) {
    // the two share bars use one scale, so brain and the other tiers compare by length
    const brainTxt = ui.money(s.brain)
    const otherTxt = ui.money(hostN - s.brain)
    const w = Math.max(displayWidth(brainTxt), displayWidth(otherTxt)) + 2
    const total = Math.max(2, Math.min(METER_CELLS(ctx.cols), ctx.cols - 1 - ui.KEY_W - w))
    let brainCells = Math.round((s.brain / hostN) * total)
    if (hostN - s.brain >= 0.005 && brainCells >= total) brainCells = total - 1 // a non-zero remainder keeps at least one cell
    const pad = (txt: string) => ui.val(' '.repeat(w - displayWidth(txt)), { role: 'prose' })
    rows.push(
      ui.kv(u, t('label.brain'), [ui.fmtd('money', brainTxt), pad(brainTxt), ui.barValue(brainCells)], { fact: 'usage.today' }),
      ui.kv(u, t('label.other_tiers'), [ui.fmtd('money', otherTxt), pad(otherTxt), ui.barValue(total - brainCells)], { fact: 'usage.today' }),
    )
  }
  rows.push(ui.kv(u, t('label.session'), [ui.fmtd('money', s.session)], { fact: 'spend.session' }))
  return [head, ...rows]
}

function last24Section(u: ui.Ctx, ctx: PaneCtx, s: SpendView | null): PaneLine[] {
  const t = ctx.t
  const open = !isFolded(ctx, SECTION.last24)
  const hourly = s === null ? null : s.hourly ?? null
  if (hourly === null) return [ui.header(u, t('usage.last24'), { id: SECTION.last24, open }), ...(open ? [ui.empty(t('spend.no_history'), 'usage.history')] : [])]
  const total = hourly.reduce((a, b) => a + b, 0)
  const head = ui.header(u, t('usage.last24'), { id: SECTION.last24, open }, { right: ui.fmtd('money', ui.money(total), 'usage.history'), fact: 'usage.history' })
  if (!open) return [head]
  const peak = withMoney(t('spend.peak', { v: MARK }), ui.fmtd('money', ui.money(Math.max(...hourly))))
  const hint = t('spend.hint')
  const spark = ui.sparkValue(hourly)
  // one line when the sparkline, the peak and the hint all fit beside the key; otherwise the hint drops under the sparkline (both from column 12)
  const oneLine = ui.KEY_W + hourly.length + 2 + displayWidth(peak.text) + 3 + displayWidth(hint) <= ctx.cols - 1
  const gap = ui.val('  ', { role: 'prose' })
  const lines = oneLine
    ? ui.chart(u, t('label.brain'), ui.cat(spark, gap, peak, ui.val(' · ' + hint, { role: 'prose', tone: 'dim' })), undefined, 'usage.history')
    : ui.chart(u, t('label.brain'), ui.cat(spark, gap, peak), hint, 'usage.history')
  return [head, ...lines]
}

// account: email (name), organization · role, plan · extra use. Where all of it fits on one row it is one row (§5.4 at 120 columns), else one row each.
function accountSection(u: ui.Ctx, ctx: PaneCtx, a: AccountSnap | undefined): PaneLine[] {
  const t = ctx.t
  const open = !isFolded(ctx, SECTION.account)
  const head = ui.header(u, t('now.account'), { id: SECTION.account, open })
  if (!open) return [head]
  const acc = a === undefined ? undefined : a.account
  if (acc === undefined) return [head, ui.empty(t('nodata.account'), 'usage.account')]
  if (acc === null) return [head, ui.kv(u, t('label.account'), [ui.absent(t('account.none'))], { fact: 'usage.account' })]
  const prose = (s: string, dim = false) => ui.val(s, { role: 'prose', ...(dim ? { tone: 'dim' } : {}) })
  const parts: { label: string; frags: ui.Frag[] }[] = []
  if (acc.email !== null) parts.push({ label: t('label.account'), frags: [prose(acc.email), ...(acc.name === null ? [] : [prose(' (' + acc.name + ')', true)])] })
  if (acc.org !== null) parts.push({ label: t('label.org'), frags: [prose(acc.org), ...(acc.role === null ? [] : [prose(' · ' + acc.role, true)])] })
  if (acc.plan !== null || acc.extraUsage) parts.push({ label: t('label.tier'), frags: [prose(acc.plan ?? '—'), ...(acc.extraUsage ? [prose(' · ' + t('account.extra_on'), true)] : [])] })
  if (parts.length === 0) return [head, ui.kv(u, t('label.account'), [ui.absent(t('account.partial'))], { fact: 'usage.account' })]
  const merged = parts.flatMap((p, i) => (i === 0 ? p.frags : [prose(' · ' + p.label + ' ', true), ...p.frags]))
  if (parts.length > 1 && ui.KEY_W + displayWidth(merged.map(f => f.text).join('')) <= ctx.cols - 1) return [head, ui.kv(u, parts[0].label, merged, { fact: 'usage.account' })]
  return [head, ...parts.map(p => ui.kv(u, p.label, p.frags, { fact: 'usage.account' }))]
}

function spendTabLinesRaw(snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const u: ui.Ctx = { t: ctx.t, cols: ctx.cols, ...(ctx.expanded === undefined ? {} : { expanded: ctx.expanded }) }
  const s = snap.detail.spend
  return [
    ...ui.sections('spend', {
      limits: limitsSection(u, ctx, s, snap.account === undefined ? [] : snap.account.quota, snap.detail.now_ms),
      today: todaySection(u, ctx, s),
      last24: last24Section(u, ctx, s),
      account: accountSection(u, ctx, snap.account),
    }),
  ]
}

// ================= Hygiene (殘留): groups that need a person -> automatic cleanup -> plugin load source (§5.5) =================
const HYG = (key: string): string => 'sec:hygiene.' + key
function hygSection(u: UiCtx, ctx: PaneCtx, key: string, title: string, body: readonly PaneLine[], o: { right?: Frag; fact?: FactId } = {}): PaneLine[] {
  const id = HYG(key)
  const open = U.sectionOpen(ctx.folded, id)
  return [ui.header(u, title, { id, open }, o.right === undefined ? {} : { right: o.right, fact: o.fact }), ...(open ? body : [])]
}
function residueAttention(u: UiCtx, ctx: PaneCtx, residue: LiveSnapshot['detail']['residue']): PaneLine[] {
  const t = ctx.t
  const title = t('hygiene.need_you')
  if (residue === null) return hygSection(u, ctx, 'attention', title, [ui.empty(t('nodata.prefix', { what: t('nodata.residue') }), 'residue.groups')])
  const n = residue.needs_human_count
  if (n === 0) return hygSection(u, ctx, 'attention', title, [ui.empty(t('hygiene.none'), 'residue.groups')])
  const entries: U.ResidueEntry[] = residue.needs_human.map(e => ({ kind: e.kind, target: e.target, cls: e.class, ageMs: e.age_days === null ? null : e.age_days * 86_400_000, bytes: e.bytes, reason: e.reason, command: e.command }))
  const chipState = entries.length === 0 ? ui.stateOf('residueGroup', 'dirty') : ui.worst(entries.map(e => ui.stateOf('residueGroup', e.cls)))
  const chip = ui.cat(ui.countChip(u, chipState, n, 'residue.groups'), ...(residue.needs_human_bytes === null ? [] : [ui.val(' · ', { tone: 'dim' }), ui.fmtd('size', ui.size(residue.needs_human_bytes))]))
  const body = U.residueGroups(u, entries, chipState)
  if (n > entries.length) body.push(...ui.detail(u, t('hygiene.more', { n: n - entries.length }), { fact: 'residue.groups' }))
  return hygSection(u, ctx, 'attention', title, body, { right: chip, fact: 'residue.groups' })
}
function residueAuto(u: UiCtx, ctx: PaneCtx, snap: LiveSnapshot): PaneLine[] {
  const t = ctx.t
  const residue = snap.detail.residue
  const title = t('hygiene.auto_title')
  if (residue === null) return hygSection(u, ctx, 'auto', title, [ui.empty(t('nodata.prefix', { what: t('nodata.auto') }), 'residue.cleanup')])
  if (residue.auto_ran_at === null) return hygSection(u, ctx, 'auto', title, [ui.item(u, ui.stateOf('cleanup', { errors: 0, done: 0 }), t('hygiene.no_auto'), undefined, { fact: 'residue.cleanup' })])
  const ms = Date.parse(residue.auto_ran_at)
  const nowMs = snap.detail.now_ms
  const age = nowMs !== null && Number.isFinite(ms) ? ui.dur(nowMs - ms) : undefined
  const removed = residue.auto_removed_count ?? 0
  const archived = residue.auto_archived_count ?? 0
  // the producer publishes no error count (only what it removed and archived), so `errors` is 0 here: the row reads done when anything was cleaned, skipped when nothing was
  const s = ui.stateOf('cleanup', { errors: 0, done: removed + archived })
  return hygSection(u, ctx, 'auto', title, [ui.item(u, s, age === undefined ? t('hygiene.auto', { wt: removed, br: archived }) : t('hygiene.auto_at', { age, wt: removed, br: archived }), undefined, { fact: 'residue.cleanup' })]) // the plan 5.5 mockup: the age leads the sentence, so the row is one body with no meta to clip
}
function residueSource(u: UiCtx, ctx: PaneCtx, snap: LiveSnapshot): PaneLine[] {
  const t = ctx.t
  const ls = snap.detail.load_source
  const title = t('hygiene.load')
  if (ls === null) return hygSection(u, ctx, 'source', title, [ui.empty(t('nodata.prefix', { what: t('nodata.load_source') }), 'residue.source')])
  const behind = ls.behind_upstream
  const s = ui.stateOf('loadSource', { source: ls.source, behind: behind ?? 0, flags: ls.flags.length + (ls.marketplace === 'missing' ? 1 : 0) })
  const isOpen = u.expanded?.has('residue:source') === true
  const meta: ui.MetaPart[] = [{ text: 'v' + (ls.plugin_version ?? '—'), fmt: 'id' }, ...(behind !== null && behind > 0 ? [{ text: t('hygiene.behind') + ' ' + behind, fmt: 'count' as const }] : [])]
  const details: PaneLine[] = []
  if (isOpen) {
    details.push(...ui.detail(u, t('label.marketplace') + ' ' + ls.marketplace, { attached: true }))
    if (ls.flags.length > 0) details.push(...ui.detail(u, t('label.flags') + ' ' + ls.flags.join(', '), { attached: true }))
    for (const dir of ls.stale_cache_dirs) details.push(...ui.detail(u, t('hygiene.cache_dir', { dir: dir.dir, pids: dir.in_use_pids.join(', ') || '—', alive: dir.alive.join(', ') || '—' }), { attached: true }))
  }
  const row = ui.item(u, s, loadSourceFor(ls, null), meta, { fact: 'residue.source', toggle: { id: 'residue:source', open: isOpen }, ...(ui.isNeedYou(s) ? { word: false } : {}) })
  return hygSection(u, ctx, 'source', title, [row, ...details], { right: ui.chip(u, s), fact: 'residue.source' })
}
function hygieneTabLinesRaw(snap: LiveSnapshot, ctx: PaneCtx): PaneLine[] {
  const u = uiCtxOf(ctx)
  return U.sections('hygiene', { attention: residueAttention(u, ctx, snap.detail.residue), auto: residueAuto(u, ctx, snap), source: residueSource(u, ctx, snap) })
}

// ================= ? (the legend: generated from STATES, the structure glyphs and the meter levels, §5.6) =================
export function legendLines(ctx: PaneCtx = { t: T_EN, cols: DEFAULT_PANE_COLS }): PaneLine[] {
  return wrapLines(U.sections('legend', U.legendParts(uiCtxOf(ctx), ctx.folded)), ctx.cols)
}

export const nowLines = (snap: LiveSnapshot, ctx: PaneCtx = { t: T_EN, cols: DEFAULT_PANE_COLS }): PaneLine[] => wrapLines(nowLinesRaw(snap, ctx), ctx.cols)

export const dispatchLines = (snap: LiveSnapshot, ctx: PaneCtx = { t: T_EN, cols: DEFAULT_PANE_COLS }): PaneLine[] => wrapLines(dispatchLinesRaw(snap, ctx), ctx.cols)

export const reviewTabLines = (snap: LiveSnapshot, ctx: PaneCtx = { t: T_EN, cols: DEFAULT_PANE_COLS }): PaneLine[] => wrapLines(reviewTabLinesRaw(snap, ctx), ctx.cols)

export const spendTabLines = (snap: LiveSnapshot, ctx: PaneCtx = { t: T_EN, cols: DEFAULT_PANE_COLS }): PaneLine[] => wrapLines(spendTabLinesRaw(snap, ctx), ctx.cols)

export const hygieneTabLines = (snap: LiveSnapshot, ctx: PaneCtx = { t: T_EN, cols: DEFAULT_PANE_COLS }): PaneLine[] => wrapLines(hygieneTabLinesRaw(snap, ctx), ctx.cols)

