// mods/live/model.ts — pure helpers for the live mod (plan P1c). No `$` in here: every file read, every clock
// read and every UI call stays in register.ts. Nothing in this file derives a number the producer already
// published: counts, cost, context, the progress numbers and the decision are copied from the envelope / context
// file / job model. The selections made here: the verdict word (a precedence over fields the producers already
// published), the project short name, the earliest start and the quietest stalled run.
// W3a: the per-session files (tasks, attention), the watcher sidecars (decisions, foreman, sources manifest) and the
// campaign progress receipts are parsed here too; every sidecar carries its scope and a scope that is not the one
// wanted is an absent file (same rule as checkEnvelope).
// TUI v2: every user-visible word is an id in locales/{en,zh-TW}.json, resolved through a `t` this file receives as a parameter
// (never imported as state), so tests call the layout with a fixed `t`. Glyphs, numbers, ids, paths, shas and commands stay literal.

import { T_EN } from './i18n'
import type { T } from './i18n'
import * as ui from './ui' // the design system's builders; `ui.kv` etc. keep clear of this file's own legacy `kv` / `row`
import * as U from './ui'
import { GLYPHS, PALETTE, STATES, carry, cellWidth, displayWidth, isStale, stateOf } from './ui'
const GS = GLYPHS.state
const GT = GLYPHS.structure
const GC = GLYPHS.chart
import type { Ctx as UiCtx, Column as UiColumn, FactId, FmtKind, Frag, LineKind, RunSubject, SegRole, Stated, TableListRow as UiTableListRow } from './ui'


// ---- the snapshot the tick builds and the band / pane draw (module state in register.ts) ----
export type LivePaneRow = {
  stall: boolean // the producer's own stall flag for this run (the Dispatch table draws it as the state)
  run_id: string
  role: string | null
  runner: string | null
  model: string | null
  started_at: string | null
  elapsed_s: number | null
  phase: string | null
  rc: number | null
  final_status: string | null
  probe_age_s: number | null
  ended_at: string | null
  // the producer's own end test (runs-watch computeCounts: phase exited, ended_at or final_status; an rc is an end too) and its own freshness test
  // (confirmed_live: alive === true and a probe no older than counts.fresh_bound_s). A row the producer never probed is not `fresh`, and a row that
  // ended without an rc and without a final_status is `ended` and not `fresh`, so it reads ◌ 已停 and never ● 執行中 (design plan §2.5, §3.3 run row 6)
  ended: boolean
  fresh: boolean
  starting: boolean
}

export type LiveGateRow = {
  phase: string | null
  generation: number | null
  verdict: string | null
  status: string | null
}

// one open owner question (autopilot.decision/2 entry, as the job model carries it): the full context the owner needs to answer without scrolling back
export type LiveDecision = {
  id: string | null; question: string; background: string | null; options: { label: string; description: string }[]
  recommendation: string | null; why: string | null; blocks: string | null; not_authorized: string | null; source: string | null; opened_at: string | null
  stale: boolean; age_s: number | null
  origin: string | null // `ask_user_question`: hooks/ask-decision.js opened it, the asker's own dialog answers it (the pane never does)
  orphaned: boolean // the asking session left no turn file: it ended (or crashed) without answering; the watcher derives it, the entry is never removed by it
}

// `kind`, `fact`, `goto`, `group` and `ts` are stamped by the ui.ts components (the design system, docs/plans/2026-10-13-live-pane-design-system.md §6.1); `kind` and
// `fact` are required: a line no component made does not type-check.
export type PaneLine = { toggle?: string; text: string; dim?: boolean; bold?: boolean; warn?: boolean; color?: ThemeKey; segs?: Seg[]; wrap?: boolean; hang?: number; kind: LineKind; fact: FactId; goto?: PaneTab; group?: string; ts?: number; field?: { key: string; placeholder: string; value: string } }
export type VerdictKind = 'decide' | 'stalled' | 'waiting' | 'running' | 'idle'
// P4: the sections are DATA, the tab builders turn them into lines (design plan §7). attention = a permission / question the session waits on; the notes say why a
// source has nothing to show (its writer is not wired); the rest is the source view as read.
export type PaneSections = {
  attention: AttentionView | null
  attentionNotWired: boolean
  tasks: TasksView | null
  tasksNote: 'todo_hint' | 'not_wired' | null // why `tasks` is null
  decisionsNotWired: boolean
  foreman: ForemanView | null
  foremanNotWired: boolean
}
export const NO_SECTIONS: PaneSections = { attention: null, attentionNotWired: false, tasks: null, tasksNote: null, decisionsNotWired: false, foreman: null, foremanNotWired: false }

// The two band lines of an ok snapshot. Every ok band carries one of five words; the fifth, 待命, is the idle word.
export type BandView = {
  kind: VerdictKind
  key: ThemeKey
  why: string // the verdict's own reason, always set: the first item under 要你處理 when the verdict asks something of the owner, else the first row of 位置 (§2.2)
  verdictReason: string | null // the one-phrase reason the wide band draws after a 要你決定 / 疑似卡住 verdict (null for the other verdicts)
  mark: string
  verdict: string
  head: string // "<project> · <phase> · <elapsed> · " (the progress follows it)
  progress: string
  progressDim: boolean // an unfrozen denominator is drawn dim
  reason: string | null
  project: string // P7 Now tab row: verdict + project + elapsed; progress and phase are their own lines
  elapsed: string
  phase: string
  slots: Slot[] // P7: the one-line band's slots in priority order (width-independent; layoutBand applies the width table)
}

export type LiveSnapshot = {
  // ok | stale | unavailable | unreadable | no-pointer | no-project
  state: 'ok' | 'stale' | 'unavailable' | 'unreadable' | 'no-pointer' | 'no-project'
  // the exact band text (an ok snapshot: line 1, then the reason on its own line)
  text: string
  band: BandView | null // set for state ok only
  // the state text of a non-ok snapshot; for an ok one the legacy one-line "session / host / ctx" text (the pane draws the verdict header from `band` and `metrics`)
  header: string
  // the context figure of the global header (`22%`, `—`); the two spend figures come from `detail.spend` (undefined = a snapshot built without it)
  metrics?: { ctx: string }
  // what is awaited from the human, from the job model's decisions list, oldest first ([] = nothing awaited)
  pending: LiveDecision[]
  project_key: string | null
  root_run_id: string | null
  // page the Link in the pane points at (null until an envelope was found)
  link: string | null
  // pane data, copied from the envelope / the review job model; null = not published
  rows: LivePaneRow[] | null
  gates: LiveGateRow[] | null
  // W3a pane sections, text already built from the sources (empty = nothing to say)
  sections: PaneSections
  // P7d: plan-review state + latest code-review round of this project (null = none published)
  review: ReviewView | null
  published_at: string | null
  session_as_of: string | null
  host_as_of: string | null
  // P7: the facts the panel's tabs draw (null = the fact is not published: the tab says "no data")
  detail: PaneDetail
  // the last RECENT_MAX prompts of this session, each with its reply (null / [] = nothing available; undefined = a snapshot built without the tick)
  recent?: RecentGroup[] | null
  // what the session left running in the background: shell commands, Monitor watches, subagents (null / [] = none; undefined = no tick)
  activity?: ActivityItem[] | null
  // the logged-in Claude account and its rate-limit windows (undefined = no tick)
  account?: AccountSnap
}

export type SpendView = { session: string; host_all: string; host_all_n: number | null; brain: number | null; cap: number | null; mode: string; hourly?: number[] | null }
export type PaneDetail = {
  counts: Counts | null // the envelope's dispatch counts (merged over the root set); null = not published
  stalled: number // stalled runs + a stalled foreman (the band's ⊘ count)
  now_ms: number | null
  project: string | null
  marker: MarkerView | null
  qc: QcView | null
  stage: StageWalkView | null
  decisions: DecisionsView | null
  load_source: LoadSourceView | null
  residue: ResidueView | null
  spend: SpendView | null
}
export const NO_DETAIL: PaneDetail = { counts: null, stalled: 0, now_ms: null, project: null, marker: null, qc: null, stage: null, decisions: null, load_source: null, residue: null, spend: null }

// ---- the host-wide spend history (<live>/runs/spend-history.json, schema autopilot.spend-history/1) -> the Spend tab's hourly sparkline ----
export const SPEND_HISTORY_SCHEMA = 'autopilot.spend-history/1'
export const SPARK_BARS = GLYPHS.spark.join('')
const HOUR_MS = 3600 * 1000
export const SPEND_BUCKETS = 24
export type SpendSample = { ms: number; usd: number }
export function readSpendHistory(text: string | null): SpendSample[] | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== SPEND_HISTORY_SCHEMA || !Array.isArray(parsed.value.samples)) return null
  const out: SpendSample[] = []
  for (const x of parsed.value.samples) {
    if (!isObject(x) || typeof x.at !== 'string' || !finite(x.usd) || x.usd < 0) continue
    const ms = Date.parse(x.at)
    if (Number.isFinite(ms)) out.push({ ms, usd: x.usd })
  }
  return out.sort((a, b) => a.ms - b.ms)
}

// The last 24 hourly buckets (oldest first, the current hour last) of spend ADDED per hour. A sample's usd is the cumulative figure since the host's
// "today" began (scripts/lib/brain-spend.js sums UTC-day rows: its header, `todayPrefix` and `todaySpend`), but the rule here does not depend on where
// that boundary is: delta = cur >= prev ? cur - prev : cur, so a reset yields the new cumulative value, never a spike or a zero. A baseline more than
// 1 h older than the sample is unknown (a watcher gap): that sample adds no bar; the very first sample has no baseline and adds none. The delta lands
// in the bucket of the sample that shows it. Fewer than 2 samples inside the window -> null (no sparkline).
export const SPEND_BASELINE_MAX_MS = HOUR_MS
export function hourlySpend(samples: SpendSample[] | null, nowMs: number): number[] | null {
  if (samples === null) return null
  const endHour = Math.floor(nowMs / HOUR_MS)
  const startHour = endHour - (SPEND_BUCKETS - 1)
  const buckets: number[] = new Array(SPEND_BUCKETS).fill(0)
  let inWindow = 0
  samples.forEach((cur, i) => {
    const h = Math.floor(cur.ms / HOUR_MS)
    if (h < startHour || h > endHour) return
    inWindow += 1
    if (i === 0) return
    const prev = samples[i - 1]
    if (cur.ms - prev.ms > SPEND_BASELINE_MAX_MS) return
    buckets[h - startHour] += cur.usd >= prev.usd ? cur.usd - prev.usd : cur.usd
  })
  return inWindow >= 2 ? buckets : null
}

// `▁▂▃▄▅▆▇█`, one cell per bucket scaled to the peak; an all-zero window is a flat floor
export function sparkText(values: number[]): string {
  const peak = Math.max(...values)
  return values.map(v => SPARK_BARS[peak <= 0 ? 0 : Math.min(SPARK_BARS.length - 1, Math.round((v / peak) * (SPARK_BARS.length - 1)))]).join('')
}

export const SNAPSHOT_SCHEMA = 'autopilot.runs-live/1'
export const MODEL_SCHEMA = 'review-job-model/1'
export const POINTER_SCHEMA = 'autopilot.live-pointer/1'
export const DEFAULT_VALID_FOR_S = 180
export const CONTEXT_MAX_AGE_MS = 120000
export const DEFAULT_REVIEW_PORT = 8787
export const RUNS_HINT = 'autopilot status runs --watch'

export type Json = Record<string, unknown>

export const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isKey = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)

// -> { ok, value }: ok false = not JSON (malformed), never throws.
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (_e) {
    return { ok: false }
  }
}

// Same rule as src/status/runs-watch.js safeSegment: it names the per-root envelope file and the job directory.
export function safeSegment(value: string): string {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96) || '_'
}

export function scopeKeyOf(projectKey: string, root: string | null): string {
  return root ? projectKey + '--' + safeSegment(root) : projectKey
}

export function hhmm(ms: number): string {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export const usd = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) ? '$' + n.toFixed(2) : '$—')

// Longest path-boundary prefix of `real` among the merged runs/paths maps; -> project_key | null.
export function longestPrefixKey(real: string, maps: Json[]): string | null {
  let best: { len: number; key: string } | null = null
  for (const map of maps) {
    for (const p of Object.keys(map)) {
      const entry = map[p]
      if (!isObject(entry) || !isKey(entry.project_key)) continue
      const base = p.length > 1 ? p.replace(/\/+$/, '') : p
      const hit = real === base || real.startsWith(base === '/' ? '/' : base + '/')
      if (hit && (best === null || base.length > best.len)) best = { len: base.length, key: entry.project_key }
    }
  }
  return best === null ? null : best.key
}

export type EnvelopeCheck = { status: 'missing' | 'malformed' | 'fresh' | 'stale'; envelope: Json | null }

// readEnvelope's contract (src/status/runs-watch.js): a wrong schema or a scope that is not the one wanted is a
// MISSING file; fresh depends on published_at alone, never on when the mod read the file.
export function checkEnvelope(text: string | null, want: { project_key: string; root_run_id: string | null }, nowMs: number): EnvelopeCheck {
  if (text === null) return { status: 'missing', envelope: null }
  const parsed = parseJson(text)
  if (!parsed.ok) return { status: 'malformed', envelope: null }
  const env = parsed.value
  if (!isObject(env) || env.schema !== SNAPSHOT_SCHEMA || !isObject(env.scope)) return { status: 'missing', envelope: null }
  const sameRoot = (typeof env.scope.root_run_id === 'string' ? env.scope.root_run_id : null) === want.root_run_id
  if (env.scope.project_key !== want.project_key || !sameRoot) return { status: 'missing', envelope: null }
  const publishedMs = typeof env.published_at === 'string' ? Date.parse(env.published_at) : NaN
  const validFor = typeof env.valid_for_s === 'number' && Number.isFinite(env.valid_for_s) ? env.valid_for_s : DEFAULT_VALID_FOR_S
  if (!Number.isFinite(publishedMs) || nowMs - publishedMs > validFor * 1000) return { status: 'stale', envelope: env }
  return { status: 'fresh', envelope: env }
}

const rowsOf = (env: Json): Json[] | null => (Array.isArray(env.runs) ? env.runs.filter(isObject) : null)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const startedMs = (r: Json): number => Date.parse(String(r.started_at || r.fact_at || ''))

// the band's verdict mark and colour come from the design system's state table: the five owner-approved words map onto states (§3.2)
const VERDICT_MARK = Object.fromEntries((['decide', 'stalled', 'waiting', 'running', 'idle'] as const).map(k => {
  const st = STATES[stateOf('verdict', k).id]
  return [k, { mark: st.glyph, key: st.key }]
})) as Record<VerdictKind, { mark: string; key: ThemeKey | undefined }>
export const verdictOf = (kind: VerdictKind, t: T): { kind: VerdictKind; mark: string; word: string; key: ThemeKey | undefined } => ({ kind, mark: VERDICT_MARK[kind].mark, word: t('verdict.' + kind), key: VERDICT_MARK[kind].key })

// "<project>": the last directory of a normal repo's git common dir. Any other shape (bare repo, no prefix, a path
// inside .git, empty) falls back to the first 8 hex of the project key. Pure string work: never git, never a hash.
export function projectName(identity: unknown, projectKey: string): string {
  const fallback = projectKey.slice(0, 8)
  const PREFIX = 'git-common-dir:'
  if (typeof identity !== 'string' || !identity.startsWith(PREFIX)) return fallback
  const dir = identity.slice(PREFIX.length).replace(/\/+$/, '')
  if (!dir.endsWith('/.git')) return fallback
  const name = dir.slice(0, -'/.git'.length).split('/').pop()
  return name ? name : fallback
}

// "38m" / "2h14m" / "1d03h" (ui.dur, the one duration format): now minus the start of this piece of work; no start -> an em dash.
export function elapsedFrom(startMs: number | null, nowMs: number): string {
  if (startMs === null || !Number.isFinite(startMs) || !Number.isFinite(nowMs) || nowMs < startMs) return '—'
  const minutes = Math.floor((nowMs - startMs) / 60000) // the band's elapsed never shows seconds
  return minutes < 1 ? '0m' : ui.dur(minutes * 60000)
}

// the earliest start among the scope's runs (null: none has one)
export function earliestRunMs(env: Json): number | null {
  let earliest = Infinity
  for (const r of rowsOf(env) || []) {
    const ms = Date.parse(String(r.started_at || ''))
    if (Number.isFinite(ms) && ms < earliest) earliest = ms
  }
  return earliest === Infinity ? null : earliest
}

// "seconds ago" in the same shorthand as the band: 45s / 20m / 3h5m / 2d1h
export function ageText(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—'
  return ui.dur(s * 1000)
}

export type JobProgress = { frozen: boolean; percent: number | null; done: number | null; total: number | null }

// frozen: "62.5%（5/8）" (the percent as the job model published it). Not frozen: "3 done*", drawn dim. No count: an em dash.
export function progressView(p: JobProgress | null, t: T = T_EN): { text: string; dim: boolean } {
  if (p === null) return { text: '—', dim: false }
  if (p.frozen && p.percent !== null && p.done !== null && p.total !== null) return { text: t('progress.frozen', { pct: p.percent, done: p.done, total: p.total }), dim: false }
  if (p.done !== null) return { text: t('progress.unfrozen', { n: p.done }), dim: true }
  return { text: '—', dim: false }
}

// The stalled rows are the ones the producer flagged (`stall: true`); the age is the producer's last_event_age_s.
export function stalledReason(env: Json, t: T = T_EN): string | null {
  const stalled = (rowsOf(env) || []).filter(r => r.stall === true)
  if (stalled.length === 0) return null
  const ages = stalled.map(r => r.last_event_age_s).filter(finite)
  if (ages.length === 0) return t('reason.stalled_count', { n: stalled.length })
  return t('reason.stalled_age', { m: Math.floor(Math.max(...ages) / 60) })
}

// ---- W3a: the sources the band and pane read besides the envelope and the job model ----
export const TASKS_SCHEMA = 'autopilot.session-tasks/1'
export const ATTENTION_SCHEMA = 'autopilot.attention/1'
export const TURN_SCHEMA = 'autopilot.session-turn/1'
export const TURN_EFFECTIVE_SCHEMA = 'autopilot.session-turn-effective/1'
export const DECISIONS_SCHEMA = 'autopilot.decisions-sidecar/1'
export const FOREMAN_SCHEMA = 'autopilot.foreman-activity/1'
export const SOURCES_SCHEMA = 'autopilot.sources/1'
export const LOAD_SOURCE_SCHEMA = 'autopilot.load-source/1'
export const NOT_WIRED_ID = 'nodata.not_wired'
export const TODO_TOOLS_ID = 'tasks.todo_hint'

// scripts/lib/live-state-dir.js sanitizeSessionId: every scalar outside [A-Za-z0-9_-] becomes one "_", first 64 scalars, empty -> unknown.
export function sanitizeSid(raw: string): string {
  if (raw.length === 0) return 'unknown'
  const kept = Array.from(raw).slice(0, 64).map(ch => (/^[A-Za-z0-9_-]$/.test(ch) ? ch : '_')).join('')
  return kept.length > 0 ? kept : 'unknown'
}

export type ScopeWant = { project_key: string; root_run_id: string | null }

// a sidecar names the scope it was built for; any other scope is an absent file (the checkEnvelope rule)
function scopeMatches(v: Json, want: ScopeWant): boolean {
  const s = v.scope
  if (!isObject(s)) return false
  const root = typeof s.root_run_id === 'string' && s.root_run_id ? s.root_run_id : null
  return s.project_key === want.project_key && root === want.root_run_id
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export type TasksView = {
  total: number; completed: number; in_progress: number
  current: string | null
  first_created_ms: number | null
  rows: { subject: string; status: string }[]
}

// <live>/tasks/<sid>.json (W1d). Counts are the writer's own (deleted tasks excluded there); another session's file is absent.
export function readTasks(text: string | null, sid: string): TasksView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== TASKS_SCHEMA) return null
  const v = parsed.value
  if (typeof v.session_id === 'string' && v.session_id !== sid) return null
  const c = v.counts
  if (!isObject(c) || !isCount(c.total) || !isCount(c.completed) || !isCount(c.in_progress)) return null
  const first = typeof v.first_created_at === 'string' ? Date.parse(v.first_created_at) : NaN
  const rows = (Array.isArray(v.tasks) ? v.tasks : []).filter(isObject)
    .map(t => ({ subject: str(t.subject) || '—', status: str(t.status) || 'pending' }))
    .filter(t => t.status !== 'deleted')
  return {
    total: c.total, completed: c.completed, in_progress: c.in_progress,
    current: isObject(v.current) ? str(v.current.subject) : null,
    first_created_ms: Number.isFinite(first) ? first : null,
    rows,
  }
}

export type AttentionView = { kind: 'permission' | 'question' | 'idle'; summary: string; since_ms: number | null }

// <live>/attention/<sid>.json (W1e): present only while the session waits. A file of another session / schema is absent.
export function readAttention(text: string | null, sid: string): AttentionView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== ATTENTION_SCHEMA) return null
  const v = parsed.value
  if (typeof v.session_id === 'string' && v.session_id !== sid) return null
  const kind = v.kind
  if (kind !== 'permission' && kind !== 'question' && kind !== 'idle') return null
  const since = typeof v.since === 'string' ? Date.parse(v.since) : NaN
  return { kind, summary: str(v.summary) || '', since_ms: Number.isFinite(since) ? since : null }
}

export type TurnView = { state: 'active' | 'ended'; since_ms: number | null }
// the session marker's TTL (scripts/session-mode.js DEFAULT_TTL_HOURS): a turn file older than that is a crashed session's leftover
export const TURN_TTL_MS = 24 * 3600 * 1000

// <live>/turn/<sid>.json (TURN): active while a prompt is being worked, ended after Stop. Another session / schema, no `since`
// that parses, or one older than the marker TTL is absent (stale).
// effectiveText = <live>/turn-effective/<sid>.json (GATEFIX2, watcher-owned): an Escape interrupt fires no Stop, so the watcher reads it
// from the transcript and publishes `ended` for ONE turn (its `turn_since`). It ends an `active` turn only while the turn file's `since`
// is that same value, so a newer UserPromptSubmit wins at once. Anything unreadable / foreign leaves the turn as the hook wrote it.
export function readTurn(text: string | null, sid: string, nowMs: number, effectiveText: string | null = null): TurnView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== TURN_SCHEMA) return null
  const v = parsed.value
  if (typeof v.session_id === 'string' && v.session_id !== sid) return null
  if (v.state !== 'active' && v.state !== 'ended') return null
  const since = typeof v.since === 'string' ? Date.parse(v.since) : NaN
  if (!Number.isFinite(since) || nowMs - since > TURN_TTL_MS) return null
  if (v.state === 'active' && effectiveText !== null) {
    const eff = parseJson(effectiveText)
    if (eff.ok && isObject(eff.value) && eff.value.schema === TURN_EFFECTIVE_SCHEMA && eff.value.state === 'ended'
      && (typeof eff.value.session_id !== 'string' || eff.value.session_id === sid) && eff.value.turn_since === v.since) return { state: 'ended', since_ms: since }
  }
  return { state: v.state, since_ms: since }
}

export type Manifest = Record<string, { installed: boolean; enabled: boolean } | undefined>

// autopilot.sources/1 (WATCH-A): sidecar `<live>/runs/sources/<scope_key>.json`, or the job model's own copy.
export function readManifest(value: unknown, want: ScopeWant): Manifest | null {
  if (!isObject(value) || value.schema !== SOURCES_SCHEMA || !isObject(value.sources) || !scopeMatches(value, want)) return null
  const out: Manifest = {}
  for (const k of Object.keys(value.sources)) {
    const e = value.sources[k]
    if (isObject(e) && typeof e.installed === 'boolean' && typeof e.enabled === 'boolean') out[k] = { installed: e.installed, enabled: e.enabled }
  }
  return out
}

// The producer (scripts/render-review-page.js) writes a task-sourced phase as the zh-only `做：<subject>`. Strip that prefix and re-prefix from the locale table so an en session never shows Chinese.
const TASK_PHASE_PREFIX = '做：'
function phaseText(ph: { label: string; source: string | null }, t: T): string {
  return ph.source === 'task' && ph.label.startsWith(TASK_PHASE_PREFIX) ? t('phase.task', { subject: ph.label.slice(TASK_PHASE_PREFIX.length) }) : ph.label
}

// true / false = the writer is / is not installed AND enabled; null = no manifest, or it does not name this source
export function liveSource(m: Manifest | null, name: string): boolean | null {
  if (m === null) return null
  const e = m[name]
  return e === undefined ? null : e.installed && e.enabled
}

// the manifest says none of these writers is live (every one is named, and every one is off)
export function notWired(m: Manifest | null, names: string[]): boolean {
  return names.every(n => liveSource(m, n) === false)
}

export type DecisionRow = { round: number | null; decision: string; irreversible: boolean; writer: string | null; decision_id: string | null; source: string | null; root: string | null; at?: string | null }
export type LadderView = { rung: string; at: string }
export type DecisionsView = { rows: DecisionRow[]; count: number; irreversible: number; writers: string[]; undocumented: number; identity: string | null; root: string | null; ladder: LadderView | null }

// <live>/runs/<scope_key>.decisions.json (WATCH-B). The counts are the publisher's own.
export function readDecisions(text: string | null, want: ScopeWant): DecisionsView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== DECISIONS_SCHEMA || !scopeMatches(parsed.value, want)) return null
  const v = parsed.value
  if (!isCount(v.count) || !isCount(v.irreversible_count) || !isCount(v.undocumented_dispatches) || !Array.isArray(v.writers_wired)) return null
  const rows = (Array.isArray(v.rows) ? v.rows : []).filter(isObject).map(r => ({
    round: Number.isInteger(r.round) ? (r.round as number) : null,
    decision: str(r.decision) || '—',
    irreversible: r.irreversible === true,
    writer: str(r.writer), decision_id: str(r.decision_id), source: str(r.source), root: want.root_run_id,
    at: typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) ? r.at : null, // kept for ordering: roots are concatenated, so position is not time across roots
  }))
  const scope = v.scope as Json
  return {
    rows, count: v.count, irreversible: v.irreversible_count, writers: v.writers_wired.filter((w): w is string => typeof w === 'string'),
    undocumented: v.undocumented_dispatches, identity: str(scope.repo_identity), root: want.root_run_id,
    ladder: readLadder(v.ladder),
  }
}

// D2: the latest unknown-escalation rung the sidecar publishes (`{ rung: "U0".."U5", at }`); anything else is no ladder.
export function readLadder(v: unknown): LadderView | null {
  if (!isObject(v) || typeof v.rung !== 'string' || !/^U[0-5]$/.test(v.rung) || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) return null
  return { rung: v.rung, at: v.at }
}

// ---- P1W SCOPE: one session, several roots (the marker's job root + the campaigns it launched) ----
// The band reads every root of the set and merges. Live counts, stall rows and proxy decisions are summed; the frozen
// progress and the phase come from the NEWEST campaign root that has them (campaign roots are ordered oldest -> newest).

// base's scope / sessions / host cost, every fresh envelope's runs concatenated and counts summed (an envelope with no
// readable counts adds none; when no envelope has counts the base's are kept).
export function mergeEnvelopes(base: Json, others: Json[]): Json {
  if (others.length === 0) return base
  const all = [base, ...others]
  const runs: Json[] = []
  let sum: Counts | null = null
  for (const env of all) {
    runs.push(...(rowsOf(env) || []))
    const c = countsOf(env)
    if (c !== null) sum = sum === null ? { ...c } : { confirmed_live: sum.confirmed_live + c.confirmed_live, exited: sum.exited + c.exited, unknown: sum.unknown + c.unknown }
  }
  const merged: Json = { ...base, runs }
  if (sum !== null) merged.counts = { ...(isObject(base.counts) ? base.counts : {}), ...sum }
  return merged
}

const isFrozenProgress = (p: JobProgress | null): p is JobProgress => p !== null && p.frozen && p.done !== null && p.total !== null

// primary = the marker root's job model (or null), campaigns = the campaign roots' job models, oldest -> newest (absent ones left out).
// Acceptance, gates and sources come from the primary (else the newest campaign); a decision awaited under ANY root is awaited;
// progress = the newest campaign's frozen progress, phase = the newest campaign's phase, each falling back to the base's own.
export function mergeJobModels(primary: JobModel | null, campaigns: JobModel[]): JobModel | null {
  const newestFirst = [...campaigns].reverse()
  const base: JobModel | null = primary !== null ? primary : (newestFirst[0] ?? null)
  if (base === null) return null
  const all = primary !== null ? [primary, ...campaigns] : campaigns
  const asking = all.find(m => m.needs_decision)
  const frozen = newestFirst.find(m => isFrozenProgress(m.progress))
  const phased = newestFirst.find(m => m.phase !== null)
  return {
    ...base,
    needs_decision: asking !== undefined,
    decisions: all.flatMap(m => m.decisions).sort((a, b) => (Date.parse(a.opened_at ?? '') || 0) - (Date.parse(b.opened_at ?? '') || 0)),
    conclusion: asking !== undefined ? asking.conclusion : base.conclusion,
    progress: frozen !== undefined ? frozen.progress : base.progress,
    phase: phased !== undefined ? phased.phase : base.phase,
  }
}

export function mergeDecisions(views: DecisionsView[]): DecisionsView | null {
  const first = views[0]
  if (first === undefined) return null
  if (views.length === 1) return first
  const writers: string[] = []
  for (const v of views) for (const w of v.writers) if (!writers.includes(w)) writers.push(w)
  return {
    rows: views.flatMap(v => v.rows),
    count: views.reduce((n, v) => n + v.count, 0),
    irreversible: views.reduce((n, v) => n + v.irreversible, 0),
    writers,
    undocumented: views.reduce((n, v) => n + v.undocumented, 0),
    identity: views.map(v => v.identity).find(i => i !== null) || null,
    root: first.root,
    ladder: views.map(v => v.ladder).filter((l): l is LadderView => l !== null).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null,
  }
}

export type ForemanView = {
  binding: string
  agents: { id: string; description: string | null; label: string | null; at_ms: number | null; age_s: number | null; stale: boolean; stamped: boolean; ended: boolean }[]
  stage: string | null; stage_source: string | null; stage_at_ms: number | null; stage_age_s: number | null
}

// <live>/runs/<scope_key>.foreman.json (WATCH-B): liveness ages only, never a verdict. Absent file = not wired.
export function readForeman(text: string | null, want: ScopeWant): ForemanView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== FOREMAN_SCHEMA || !scopeMatches(parsed.value, want)) return null
  const v = parsed.value
  const ms = (x: unknown): number | null => { const n = typeof x === 'string' ? Date.parse(x) : NaN; return Number.isFinite(n) ? n : null }
  const agents = (Array.isArray(v.agents) ? v.agents : []).filter(isObject).map(a => ({
    id: str(a.agent_id) || '?', description: str(a.description), label: str(a.label),
    at_ms: ms(a.last_activity_at), age_s: finite(a.age_s) ? a.age_s : null, stale: a.stale === true,
    stamped: a.stamped === true, ended: ms(a.ended_at) !== null,
  }))
  return {
    binding: str(v.binding) || 'session', agents,
    stage: str(v.stage), stage_source: str(v.stage_source), stage_at_ms: ms(v.stage_at), stage_age_s: finite(v.stage_age_s) ? v.stage_age_s : null,
  }
}

export const QC_SCHEMA = 'autopilot.qc-status/1'
export type QcView = { state: 'ok' | 'owed' | 'not_needed' | 'unknown'; range: string | null; protected_files_count: number; evidence: 'trailer' | 'artifact' | null }

// <live>/runs/<project_key>.qc.json (stage-graph P7c): the pre-push qc-gate decision for HEAD vs its upstream, re-derived by the watcher
// (scripts/qc-evidence-status.js). Absent / foreign scope / unknown state = null (nothing to say).
export function readQc(text: string | null, want: ScopeWant): QcView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== QC_SCHEMA || !scopeMatches(parsed.value, { project_key: want.project_key, root_run_id: null })) return null
  const v = parsed.value
  if (v.state !== 'ok' && v.state !== 'owed' && v.state !== 'not_needed' && v.state !== 'unknown') return null
  return {
    state: v.state, range: str(v.range), protected_files_count: isCount(v.protected_files_count) ? v.protected_files_count : 0,
    evidence: v.evidence === 'trailer' || v.evidence === 'artifact' ? v.evidence : null,
  }
}

// the review-slot chip: `QC✓` (evidence present), `QC▲` (protected diff, no evidence: it awaits a person); nothing owed or unknown = no chip
export function qcChip(q: QcView | null): string | null {
  if (q === null) return null
  return q.state === 'ok' ? 'QC' + GS.done : q.state === 'owed' ? 'QC' + GS.need_you : null
}

// `git-common-dir:<abs path>` -> the path (only an absolute one); anything else -> null
export function commonDirOf(identity: unknown): string | null {
  if (typeof identity !== 'string' || !identity.startsWith('git-common-dir:')) return null
  const dir = identity.slice('git-common-dir:'.length).replace(/\/+$/, '')
  return dir.startsWith('/') && !dir.split('/').includes('..') ? dir : null
}

// the same root-name rule as src/status/work-order-progress.js: a root names a directory, so it must be a plain segment
export const isPlainRoot = (root: string): boolean => /^[A-Za-z0-9._-]+$/.test(root) && root !== '.' && root !== '..'

// Earliest `issued_at` of the controller progress receipts bound to `root` (W1a's binding rule: the receipt's own
// root_run_id equals the root; a work-order file whose own top-level root_run_id is present and different is unbound).
export function earliestReceiptMs(texts: string[], root: string): number | null {
  let best = Infinity
  for (const text of texts) {
    const parsed = parseJson(text)
    if (!parsed.ok || !isObject(parsed.value)) continue
    const file = parsed.value
    if (typeof file.root_run_id === 'string' && file.root_run_id !== root) continue
    const list = isObject(file.controller) && Array.isArray(file.controller.progress_receipts) ? file.controller.progress_receipts : []
    for (const r of list) {
      if (!isObject(r) || r.artifact_type !== 'controller_progress_receipt' || r.root_run_id !== root) continue
      const ms = typeof r.issued_at === 'string' ? Date.parse(r.issued_at) : NaN
      if (Number.isFinite(ms) && ms < best) best = ms
    }
  }
  return best === Infinity ? null : best
}

// Start of this piece of work, chosen by campaign-vs-session, not by "has a root" (every plain session carries a root since
// PLAINROOT): the earliest bound progress receipt (a campaign has one; a session never does), else the tasks file's
// first_created_at, else the marker's started_at, else the earliest run, else null (shown as an em dash).
export function startMsOf(root: string | null, env: Json, tasks: TasksView | null, markerStartedAt: unknown, receiptMs: number | null): number | null {
  if (root !== null && receiptMs !== null) return receiptMs
  if (tasks !== null && tasks.first_created_ms !== null) return tasks.first_created_ms
  const m = typeof markerStartedAt === 'string' ? Date.parse(markerStartedAt) : NaN
  return Number.isFinite(m) ? m : earliestRunMs(env)
}

// P7b: <live>/load-source.json (machine-wide, not scope-bound): which copy of the plugin Claude Code loads. Watcher-published
// (src/status/load-source.js); an absent / foreign-schema file reads as null (= no chip).
export type LoadSourceView = {
  plugin_version: string | null
  source: string // "dev" | "cache:<semver>" | "unknown"
  marketplace: string
  marketplace_path: string | null
  behind_upstream: number | null
  flags: string[]
  stale_cache_dirs: { dir: string; in_use_pids: string[]; alive: string[] }[]
}
export function readLoadSource(text: string | null): LoadSourceView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== LOAD_SOURCE_SCHEMA) return null
  const v = parsed.value
  const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : [])
  return {
    plugin_version: str(v.plugin_version), source: str(v.source) || 'unknown', marketplace: str(v.marketplace) || 'missing', marketplace_path: str(v.marketplace_path),
    behind_upstream: finite(v.behind_upstream) && Number.isInteger(v.behind_upstream) && v.behind_upstream >= 0 ? v.behind_upstream : null,
    flags: strs(v.flags),
    stale_cache_dirs: (Array.isArray(v.stale_cache_dirs) ? v.stale_cache_dirs : []).filter(isObject).map(d => ({ dir: str(d.dir) || '?', in_use_pids: strs(d.in_use_pids), alive: strs(d.alive) })),
  }
}

// Narrow the watcher's conservative source with the session's own claude pid when the caller has one: a pid listed in a cache
// dir's .in_use means THIS session loaded that copy; a pid listed in none means it loaded no cache copy (dev when the dev link
// is sound, else unknown). How the mod learns its claude pid is [unverified]; register.ts passes null today, which keeps the
// watcher's any-alive-pid reading.
export function loadSourceFor(v: LoadSourceView, sessionPid: number | string | null): string {
  if (sessionPid === null) return v.source
  const pid = String(sessionPid)
  for (const d of v.stale_cache_dirs) {
    if (d.in_use_pids.includes(pid)) return 'cache:' + (d.dir.split('/').filter(x => x !== '').pop() || '?')
  }
  if (!v.source.startsWith('cache:')) return v.source
  return v.flags.includes('dev_link_missing_or_stale') ? 'unknown' : 'dev'
}

// The hygiene slot's load-source chip: `dev` / `dev ↓3` (behind upstream by 3), `dev ▲` (the marketplace is not this repo's directory),
// `cache 2.36.36 ▲` (a stale cache copy is what loads), `src ? ▲` (unknown). warn = the chip carries ▲ (the renderer picks the warning colour).
export function hygieneChip(v: LoadSourceView | null, sessionPid: number | string | null = null): { text: string; warn: boolean } | null {
  if (v === null) return null
  const src = loadSourceFor(v, sessionPid)
  const marketplaceBad = v.flags.includes('marketplace_not_directory') || v.flags.includes('marketplace_not_this_repo')
  if (src.startsWith('cache:')) return { text: 'cache ' + src.slice('cache:'.length) + ' ' + GS.need_you, warn: true }
  if (src === 'dev') {
    const behind = v.behind_upstream !== null && v.behind_upstream > 0 ? ' ' + GT.behind + v.behind_upstream : ''
    return { text: 'dev' + behind + (marketplaceBad ? ' ' + GS.need_you : ''), warn: marketplaceBad }
  }
  return { text: 'src ' + GS.unknown + ' ' + GS.need_you, warn: true }
}

export type Sources = {
  tasks: TasksView | null
  attention: AttentionView | null
  turn: TurnView | null
  decisions: DecisionsView | null
  manifest: Manifest | null
  foreman: ForemanView | null
  loadSource?: LoadSourceView | null
  marker?: MarkerView | null
  review?: ReviewView | null
  qc?: QcView | null
  residue?: ResidueView | null
  stage?: StageWalkView | null
  quota?: readonly QuotaWindow[] | null
  startMs: number | null
}
export const NO_SOURCES: Sources = { tasks: null, attention: null, turn: null, decisions: null, manifest: null, foreman: null, startMs: null }

// P1W FOREMAN: a background foreman (a native subagent) leaves no manifest, task or turn behind, so its tool-call stamp is the only
// sign it works. THE one stall bound: the same 180 s the dispatch stall uses (scripts/dispatch-status.js DEFAULT_STALL_SECS).
export const FOREMAN_STALL_S = 180
export type ForemanNow = { fresh: { name: string; age_s: number } | null; stalled: { age_s: number } | null }
// Agents of the session that wrote a stamp, not ended (SubagentStop) and not older than the marker TTL. Un-ended and quiet under the
// bound = fresh (the freshest one is named); un-ended and quiet at/over it = stalled (the quietest one sets the age).
export function foremanNow(f: ForemanView | null, nowMs: number): ForemanNow {
  const out: ForemanNow = { fresh: null, stalled: null }
  if (f === null) return out
  for (const a of f.agents) {
    if (!a.stamped || a.ended || a.at_ms === null) continue
    const ageMs = nowMs - a.at_ms
    if (ageMs > TURN_TTL_MS) continue
    const age_s = Math.max(0, Math.floor(ageMs / 1000))
    if (age_s < FOREMAN_STALL_S) {
      if (out.fresh === null || age_s < out.fresh.age_s) out.fresh = { name: a.description || a.label || a.id, age_s }
    } else if (out.stalled === null || age_s > out.stalled.age_s) out.stalled = { age_s }
  }
  return out
}

// the band's ⊘ count: the producer's stalled runs plus a stalled foreman
export function stalledCount(env: Json, foreman: ForemanView | null, nowMs: number): number {
  return (rowsOf(env) || []).filter(r => r.stall === true).length + (foremanNow(foreman, nowMs).stalled !== null ? 1 : 0)
}

const waitingMinutes = (sinceMs: number | null, nowMs: number): number | null => (sinceMs === null ? null : Math.max(0, Math.floor((nowMs - sinceMs) / 60000)))

// what the human is being waited on for, from the attention file (permission / question only)
export function attentionReason(a: AttentionView, nowMs: number, t: T = T_EN): string {
  const n = waitingMinutes(a.since_ms, nowMs)
  return t((a.kind === 'permission' ? 'reason.permission' : 'reason.question') + (n === null ? '' : '_waited'), { summary: a.summary, n: n === null ? 0 : n })
}

// 「（已等 N 天）」: only the model's stale flag, only when a whole day has passed. 「（提問的 session 已結束）」: only the model's orphaned flag (the asker is gone,
// nobody is waiting on this any more); the entry stays listed, closing it is the owner's `open-decision.js close --id`
export function staleSuffix(d: LiveDecision | null, t: T = T_EN): string {
  if (d === null) return ''
  const orphan = d.orphaned ? t('decision.orphaned') : ''
  if (!d.stale || d.age_s === null || d.age_s < 86400) return orphan
  return t('decision.stale_days', { d: Math.floor(d.age_s / 86400) }) + orphan
}

// 僅自動裁決, worded from the writers the sidecar says are wired; next-pick is the depth-0 writer
export function writersLabel(writers: string[], t: T = T_EN): string | null {
  if (writers.includes('next-pick')) return null
  return writers.length === 0 ? t('proxy.writers_none') : t('proxy.writers_only', { writers: writers.join(t('sep.list')) })
}

// band line 2 tail: the proxy decisions (only when non-zero) and the dispatches nobody wrote down
export function proxySegments(d: DecisionsView | null, t: T = T_EN): string[] {
  if (d === null) return []
  const out: string[] = []
  if (d.count > 0) {
    out.push(t('proxy.decided', { n: d.count, irr: d.irreversible }))
    const label = writersLabel(d.writers, t)
    if (label !== null) out.push(label)
  }
  if (d.undocumented > 0) out.push(t('proxy.undocumented', { n: d.undocumented }))
  return out
}

// Precedence: 1 needs a decision (attention permission / question, or an open decision), 2 stalled (a dispatch run, or an un-ended foreman quiet >= FOREMAN_STALL_S), 3 complete and
// waiting acceptance (frozen progress done = total, or every session task completed; NO live run in scope and no un-ended fresh foreman), 4 running
// (a live run, a fresh foreman, a session task in progress, or an active turn), 5 idle (the turn ended: nothing live, no task in progress).
export function bandView(env: Json, jobModel: JobModel | null, projectKey: string, nowMs: number, src: Sources = NO_SOURCES, t: T = T_EN): BandView {
  const counts = countsOf(env)
  const progress = jobModel === null ? null : jobModel.progress
  const stalled = stalledReason(env, t)
  const noneLive = counts !== null && counts.confirmed_live === 0
  const undecided = jobModel === null || (jobModel.acceptance !== 'accepted' && jobModel.acceptance !== 'rejected')
  const frozenDone = progress !== null && progress.frozen && progress.done !== null && progress.total !== null && progress.done === progress.total
  const tasksDone = src.tasks !== null && src.tasks.total > 0 && src.tasks.completed === src.tasks.total
  const fm = foremanNow(src.foreman, nowMs)
  const waiting = noneLive && undecided && ((frozenDone && jobModel !== null) || tasksDone) && fm.fresh === null
  const taskRunning = src.tasks !== null && src.tasks.in_progress > 0
  const turnActive = src.turn !== null && src.turn.state === 'active'
  const awaiting = src.attention !== null && src.attention.kind !== 'idle' ? src.attention : null
  let kind: VerdictKind
  let reason: string | null = null
  if (awaiting !== null || (jobModel !== null && jobModel.needs_decision)) {
    kind = 'decide'
    if (awaiting !== null) reason = attentionReason(awaiting, nowMs, t)
    else if (jobModel !== null && jobModel.decisions.length > 0) reason = jobModel.decisions[0].question + staleSuffix(jobModel.decisions[0], t)
    else reason = (jobModel !== null && jobModel.conclusion) || t('reason.decide_fallback')
  } else if (stalled !== null) {
    kind = 'stalled'
    reason = stalled
  } else if (fm.stalled !== null) {
    kind = 'stalled'
    reason = t('reason.foreman_stalled', { m: Math.floor(fm.stalled.age_s / 60) })
  } else if (waiting) {
    kind = 'waiting'
    reason = frozenDone ? t('reason.waiting_verdict') : t('reason.waiting_tasks', { done: (src.tasks as TasksView).completed, total: (src.tasks as TasksView).total })
  } else if ((counts !== null && counts.confirmed_live > 0) || fm.fresh !== null || taskRunning || turnActive) {
    // GATEFIX / TURN: a live run, a session task in progress, or an active turn (the session is mid-work); the live run names itself first, then the task.
    kind = 'running'
    reason = counts !== null && counts.confirmed_live > 0
      ? t('reason.running_dispatch', { n: counts.confirmed_live })
      : fm.fresh !== null
        ? t('reason.running_foreman', { name: fm.fresh.name, m: Math.floor(fm.fresh.age_s / 60) })
      : taskRunning
        ? (src.tasks !== null && src.tasks.current ? t('reason.running_task', { what: src.tasks.current }) : t('reason.running_tasks', { n: (src.tasks as TasksView).in_progress }))
        : (() => { const n = waitingMinutes((src.turn as TurnView).since_ms, nowMs); return n === null ? t('reason.running_turn') : t('reason.running_turn_min', { n }) })()
  } else {
    kind = 'idle'
    reason = t('reason.idle')
    if (src.attention !== null && src.attention.kind === 'idle') {
      const n = waitingMinutes(src.attention.since_ms, nowMs)
      if (n !== null) reason += ' · ' + t('reason.idle_hold', { n })
    }
  }
  const pick = verdictOf(kind, t)
  const tail = proxySegments(src.decisions, t)
  const line2 = [reason, ...tail].join(' · ')
  const identity = isObject(env.scope) ? env.scope.repo_identity : null
  // the phase is the job model's `phase.label` (campaign > receipt > marker stage `size·level ▸ stage` + `unit k/N` (the producer's format, scripts/render-review-page.js; tabs.ts and ui.hasStageArrow read that `▸`; it is never drawn into the band, whose position slot reads `size·level·stage`) > task in progress > deliverable); absent / malformed: an em dash, never the process phase.
  // No writer of a stage live per the sources manifest: 來源未接 (a phase the model really carries is shown whatever the manifest says).
  const phase = jobModel !== null && jobModel.phase !== null ? phaseText(jobModel.phase, t) : notWired(src.manifest, ['stage', 'progress', 'task_status_input']) ? t(NOT_WIRED_ID) : '—'
  let prog = progressView(progress, t)
  if (prog.text === '—') {
    if (src.tasks !== null && src.tasks.total > 0) prog = { text: t('progress.unfrozen', { n: src.tasks.completed }), dim: true } // task counts have no frozen denominator
    else if (notWired(src.manifest, ['progress', 'tasks'])) prog = { text: t(NOT_WIRED_ID), dim: false }
  }
  const stalledN = (rowsOf(env) || []).filter(r => r.stall === true).length + (fm.stalled !== null ? 1 : 0)
  const slots = bandSlots({
    verdict: pick, marker: src.marker ?? null, live: counts === null ? 0 : counts.confirmed_live, stalled: stalledN, review: src.review ?? null, qc: src.qc ?? null,
    decisions: src.decisions, spend: spendOf(env), loadSource: src.loadSource ?? null, residue: src.residue ?? null, stage: src.stage ?? null, quota: src.quota ?? null, nowMs,
    reason: kind === 'decide' || kind === 'stalled' ? reason : null,
  }, t)
  return {
    kind,
    key: pick.key,
    why: reason ?? '',
    verdictReason: kind === 'decide' || kind === 'stalled' ? reason : null,
    mark: pick.mark,
    verdict: pick.word,
    head: projectName(identity, projectKey) + ' · ' + phase + ' · ' + elapsedFrom(src.startMs, nowMs) + ' · ',
    progress: prog.text,
    progressDim: prog.dim,
    reason: line2,
    project: projectName(identity, projectKey),
    elapsed: elapsedFrom(src.startMs, nowMs),
    phase,
    slots,
  }
}

export function bandLine1(v: BandView): string {
  return v.mark + ' ' + v.verdict + ' ' + v.head + v.progress
}

export function sessionUsd(env: Json, sid: string): { text: string; as_of: string | null } {
  const sessions = isObject(env.sessions) ? env.sessions : {}
  const s = Object.prototype.hasOwnProperty.call(sessions, sid) ? sessions[sid] : undefined
  if (!isObject(s) || !finite(s.session_usd)) return { text: '$—', as_of: null }
  return { text: usd(s.session_usd), as_of: typeof s.as_of === 'string' ? s.as_of : null }
}

// context file of THIS sid only, same contract as scripts/lib/live-state-dir.js readLive.
export function ctxText(text: string | null, nowMs: number): string {
  if (text === null) return '—'
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema_version !== 1) return '—'
  const writtenMs = typeof parsed.value.written_at === 'string' ? Date.parse(parsed.value.written_at) : NaN
  if (!Number.isFinite(writtenMs) || nowMs - writtenMs > CONTEXT_MAX_AGE_MS) return '—'
  const cw = parsed.value.context_window
  const pct = isObject(cw) ? cw.used_percentage : undefined
  return finite(pct) ? Math.round(pct) + '%' : '—'
}

// no usable context value and no writer live per the manifest: 來源未接 (a value that exists is shown whatever the manifest says)
export function ctxShown(ctx: string, manifest: Manifest | null, t: T = T_EN): string {
  return ctx === '—' && notWired(manifest, ['context']) ? t(NOT_WIRED_ID) : ctx
}

// pane header row: what left the band. Session cost and context are this sid's own; host cost is the day's total.
export function headerText(env: Json, sid: string, ctx: string, t: T = T_EN): string {
  return t('pane.header', { session: sessionUsd(env, sid).text, host: usd(env.host_today_usd), ctx })
}

export function paneRows(env: Json, nowMs: number | null = null): LivePaneRow[] | null {
  const rows = rowsOf(env)
  if (rows === null) return null
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const bound = isObject(env.counts) && finite(env.counts.fresh_bound_s) ? env.counts.fresh_bound_s : null
  return rows.map(r => {
    const rc = Number.isInteger(r.rc) ? (r.rc as number) : null
    const ended = r.phase === 'exited' || str(r.ended_at) !== null || str(r.final_status) !== null || rc !== null
    const probe = finite(r.probe_age_s) ? r.probe_age_s : null
    return {
      stall: r.stall === true,
      run_id: String(r.run_id === undefined || r.run_id === null ? '?' : r.run_id),
      role: str(r.role), runner: str(r.runner), model: str(r.model), started_at: str(r.started_at),
      elapsed_s: finite(r.elapsed_s) ? r.elapsed_s : null, phase: str(r.phase),
      rc, final_status: str(r.final_status),
      probe_age_s: probe, ended_at: str(r.ended_at), ended,
      fresh: !ended && r.alive === true && probe !== null && (bound === null || probe <= bound),
      starting: !ended && probe === null && bound !== null && nowMs !== null && Number.isFinite(Date.parse(str(r.started_at) ?? '')) && nowMs - Date.parse(str(r.started_at) as string) <= bound * 1000, // never probed, launched inside the bound as of NOW (elapsed_s is a stale copy in a heartbeat rewrite): ○ not started yet, not ◌ stopped
    }
  })
}

export type JobModel = {
  acceptance: string
  gates: LiveGateRow[]
  needs_decision: boolean
  conclusion: string | null
  decisions: LiveDecision[]
  progress: JobProgress | null
  phase: { code: string | null; label: string; source: string | null } | null
  sources_manifest: unknown
}

// The job page's model.json (review-job-model/1): acceptance axis, gate rows, the decision awaited, the progress
// numbers and the phase (`{code, label, source}`; only a string `label` counts). Absent / malformed -> null. `needs_decision` is true only when the model says exactly true.
export function readJobModel(text: string | null): JobModel | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== MODEL_SCHEMA || !isObject(parsed.value.axes)) return null
  const m = parsed.value
  const raw = isObject(m.axes) ? m.axes.acceptance : undefined
  const acceptance = raw === 'accepted' || raw === 'rejected' ? raw : 'unknown'
  const gates = (Array.isArray(m.gates) ? m.gates : []).filter(isObject).map(g => ({
    phase: typeof g.phase === 'string' ? g.phase : null,
    generation: Number.isInteger(g.generation) ? (g.generation as number) : null,
    verdict: typeof g.verdict === 'string' ? g.verdict : null,
    status: typeof g.status === 'string' ? g.status : null,
  }))
  const optText = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  const decisions: LiveDecision[] = (Array.isArray(m.decisions) ? m.decisions : []).filter(isObject).filter(d => typeof d.question === 'string' && d.question !== '').map(d => ({
    id: optText(d.id),
    question: d.question as string,
    background: optText(d.background),
    options: (Array.isArray(d.options) ? d.options : []).filter(isObject).map(o => ({
      label: typeof o.label === 'string' ? o.label : '',
      description: typeof o.description === 'string' ? o.description : '',
    })).filter(o => o.label !== ''),
    recommendation: optText(d.recommendation), why: optText(d.why), blocks: optText(d.blocks), not_authorized: optText(d.not_authorized), source: optText(d.source), opened_at: optText(d.opened_at),
    stale: d.stale === true,
    age_s: finite(d.age_s) ? d.age_s : null,
    orphaned: d.orphaned === true,
    origin: optText(d.origin),
  }))
  const p = m.progress
  const progress: JobProgress | null = isObject(p)
    ? {
        frozen: p.frozen === true,
        percent: finite(p.percent) ? p.percent : null,
        done: Number.isInteger(p.done) ? (p.done as number) : null,
        total: Number.isInteger(p.total) ? (p.total as number) : null,
      }
    : null
  const ph = m.phase
  const phase = isObject(ph) && typeof ph.label === 'string' && ph.label ? { code: typeof ph.code === 'string' ? ph.code : null, label: ph.label, source: typeof ph.source === 'string' ? ph.source : null } : null
  return { acceptance, gates, needs_decision: m.needs_decision === true, conclusion: typeof m.conclusion === 'string' && m.conclusion ? m.conclusion : null, decisions, progress, phase, sources_manifest: m.sources_manifest }
}

// Axis words follow the review page's chip mapping (plan A12).
export const acceptWord = (a: string, t: T = T_EN): string => t(a === 'accepted' ? 'accept.accepted' : a === 'rejected' ? 'accept.rejected' : 'accept.pending')

export type Counts = { confirmed_live: number; exited: number; unknown: number }

export function countsOf(env: Json): Counts | null {
  const c = env.counts
  if (!isObject(c) || !Number.isInteger(c.confirmed_live) || !Number.isInteger(c.exited) || !Number.isInteger(c.unknown)) return null
  return { confirmed_live: c.confirmed_live as number, exited: c.exited as number, unknown: c.unknown as number }
}

export function executionToast(before: Counts, after: Counts, t: T = T_EN): string | null {
  if (before.confirmed_live === after.confirmed_live && before.exited === after.exited && before.unknown === after.unknown) return null
  return t('toast.execution', { r0: before.confirmed_live, r1: after.confirmed_live, e0: before.exited, e1: after.exited, u0: before.unknown, u1: after.unknown })
}

export function acceptanceToast(before: string, after: string, t: T = T_EN): string | null {
  return before === after ? null : t('toast.acceptance', { from: acceptWord(before, t), to: acceptWord(after, t) })
}

// job directory for a scope: the scope's root, else the root of the most recently started row, else "unbound"
// (the watcher's renderer names an unbound job exactly that).
export function jobOf(env: Json, root: string | null): string {
  if (root) return safeSegment(root)
  let best: { ms: number; root: string } | null = null
  for (const r of rowsOf(env) || []) {
    if (typeof r.root_run_id !== 'string' || !r.root_run_id) continue
    const ms = startedMs(r)
    const at = Number.isFinite(ms) ? ms : -Infinity
    if (best === null || at >= best.ms) best = { ms: at, root: r.root_run_id }
  }
  return best === null ? 'unbound' : safeSegment(best.root)
}

export function reviewLink(port: number, projectKey: string, date: string | null, job: string): string {
  const base = 'http://localhost:' + port + '/' + projectKey + '/'
  return date === null ? base : base + date + '/' + job + '/current/'
}

export function portOf(text: string | null): number {
  if (text === null) return DEFAULT_REVIEW_PORT
  const parsed = parseJson(text)
  const p = parsed.ok && isObject(parsed.value) ? parsed.value.port : undefined
  return Number.isInteger(p) && (p as number) >= 1 && (p as number) <= 65535 ? (p as number) : DEFAULT_REVIEW_PORT
}

export const stateText = (t: T) => ({
  noPointer: t('state.no_pointer', { hint: RUNS_HINT }),
  noProject: t('state.no_project', { hint: RUNS_HINT }),
  // a repo with no watcher scope still shows its residue reminder: ⚑N from <git-common-dir>/autopilot-residue-auto.json
  noProjectWt: (wt: number) => t('state.no_project_wt', { wt: GT.residue, n: wt, hint: RUNS_HINT }),
  unreadable: t('state.unreadable'),
  stale: (key: string, publishedAt: string | null) => (publishedAt ? t('state.stale_at', { at: publishedAt, hint: RUNS_HINT, key }) : t('state.stale', { hint: RUNS_HINT, key })),
  unavailable: (key: string) => t('state.unavailable', { hint: RUNS_HINT, key }),
})

// ---- W3a pane sections: text built from the sources, drawn by pane.tsx ----
const ledgerPath = (source: string | null, common: string | null, root: string | null): string | null => {
  if (common === null) return null
  if (source === 'ledger_root') return root === null ? null : common + '/autopilot/work-orders/' + root + '/decision-ledger.jsonl'
  return common + '/autopilot/ledger/decisions.jsonl'
}

// the veto verb is decision-ledger.js `veto --ledger <ledger> --id <decision_id>` (its own round report prints the same line)
export function vetoStep(r: DecisionRow, common: string | null, root: string | null, t: T = T_EN): { cmd: string } | { note: string } {
  if (r.decision_id === null) return { note: t('veto.no_id') }
  const path = ledgerPath(r.source, common, r.root !== null ? r.root : root) // a merged view carries rows of several roots: each names its own
  if (path === null && r.source === 'ledger_root') return { note: t('veto.no_path') }
  return { cmd: 'decision-ledger.js veto ' + (path === null ? '' : '--ledger ' + path + ' ') + '--id ' + r.decision_id }
}

// "<age> ago" / "<age> 前": the one place a time and its direction word live together (word order differs per language)
export const agoText = (s: number, t: T = T_EN): string => t('ago', { age: ageText(s) })

export function buildSections(src: Sources, foreman: ForemanView | null): PaneSections {
  const m = src.manifest
  const a = src.attention
  const tk = src.tasks
  return {
    attention: a !== null && a.kind !== 'idle' ? a : null,
    attentionNotWired: a === null && liveSource(m, 'attention') === false,
    tasks: tk,
    tasksNote: tk !== null ? null : liveSource(m, 'tasks') === true ? 'todo_hint' : liveSource(m, 'tasks') === false ? 'not_wired' : null,
    decisionsNotWired: src.decisions === null && notWired(m, ['ledger_engine', 'ledger_depth0']),
    foreman,
    foremanNotWired: foreman === null,
  }
}

// ---- stage-graph P7d: the review fact (<live>/runs/<project_key>.review.json, schema autopilot.review/1, written by the watcher) ----
// `plan` is the plan-review state of this repo (dispatch-plan-review.js), `code` the latest hetero-review-loop round summary;
// either may be null. The file is project-scoped, so a project_key that is not the wanted one is an absent file.
export const REVIEW_SCHEMA = 'autopilot.review/1'
export type ReviewSeat = { id: string; family: string | null; status: string | null; verdict?: string | null }
export type PlanReviewView = { logical_plan_id: string | null; generation: number; max_generations: number | null; terminal: boolean; verdict: string | null; seats: ReviewSeat[]; updated_at: string | null }
export type CodeReviewView = { phase: string | null; generation: number | null; base: string | null; head: string | null; seats: ReviewSeat[]; converged: boolean; at: string | null }
export type ReviewView = { plan: PlanReviewView | null; code: CodeReviewView | null }

function reviewSeats(v: unknown, withVerdict: boolean): ReviewSeat[] {
  if (!Array.isArray(v)) return []
  return v.filter(isObject).map(s => ({ id: str(s.id) || '—', family: str(s.family), status: str(s.status), ...(withVerdict ? { verdict: str(s.verdict) } : {}) }))
}

export function readReview(text: string | null, projectKey: string): ReviewView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== REVIEW_SCHEMA || parsed.value.project_key !== projectKey) return null
  const v = parsed.value
  const p = isObject(v.plan) ? v.plan : null
  const c = isObject(v.code) ? v.code : null
  const plan: PlanReviewView | null = p === null || !Number.isInteger(p.generation) ? null : {
    logical_plan_id: str(p.logical_plan_id), generation: p.generation as number, max_generations: Number.isInteger(p.max_generations) ? (p.max_generations as number) : null,
    terminal: p.terminal === true, verdict: str(p.verdict), seats: reviewSeats(p.seats, false), updated_at: str(p.updated_at),
  }
  const code: CodeReviewView | null = c === null ? null : {
    phase: str(c.phase), generation: Number.isInteger(c.generation) ? (c.generation as number) : null, base: str(c.base), head: str(c.head),
    seats: reviewSeats(c.seats, true), converged: c.converged === true, at: str(c.at),
  }
  return plan === null && code === null ? null : { plan, code }
}

// The review round the band and the Review tab name: `R<n>`, n = the code-review round when there is one, else the plan-review generation; null = none.
export function reviewRound(r: ReviewView | null): number | null {
  if (r === null) return null
  return r.code !== null && r.code.generation !== null ? r.code.generation : r.plan !== null ? r.plan.generation : null
}

// The band's review slot text: `↺ R<n>`; null = no slot.
export function reviewSlot(r: ReviewView | null): string | null {
  const n = reviewRound(r)
  return n === null ? null : GT.round + ' R' + n
}

const short = (sha: string | null): string => (sha === null ? '—' : sha.slice(0, 8))

// ================= stage-graph P7: the one-line band (contract ②) and the panel's facts =================
// Colours are theme keys used as TEXT colour only (owner decision 5): no backgroundColor, no inverse, no raw colour.
export type ThemeKey = 'claude' | 'warning' | 'error' | 'success' | 'suggestion' | 'inactive' | 'subtle'
export type SlotId = 'verdict' | 'position' | 'unit' | 'dispatch' | 'review' | 'decisions' | 'spend' | 'quota' | 'hygiene'
// tag: which part the width table may drop or shorten (age, k/N, 族, the bar, the stage text)
export type SegTag = 'age' | 'kn' | 'fam' | 'bar' | 'stage' | 'live' | 'stalled' | 'chip' | 'wt' | 'walk' | 'dot' | 'reason' | 'round' | 'qc' | 'amt' | 'pct' | 'bar10' | 'bar5' | 'bar3' | 'qx'
export type Seg = { text: string; color?: ThemeKey; bold?: boolean; dim?: boolean; tag?: SegTag; slot?: SlotId; role?: SegRole; here?: boolean; fmt?: FmtKind; fact?: FactId; press?: string } // slot: set by layoutBand on the band line (the Button it presses); a separator has none
export type Slot = { id: SlotId; segs: Seg[] }

// displayWidth / cellWidth live in ui.ts (the design system owns the width rules); displayWidth is re-exported for the band and the tests.
export { displayWidth }

// the longest prefix of `text` that fits `width` cells, ending in `…` when it was cut (width < 1 -> empty)
export function truncateToWidth(text: string, width: number): string {
  if (width < 1) return ''
  if (displayWidth(text) <= width) return text
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = cellWidth(ch.codePointAt(0) as number)
    if (w + cw > width - 1) break
    out += ch
    w += cw
  }
  return out + '…'
}

// ---- marker (§2.9 fields) ----
export type UnitView = { kind: string; index: number; total: number; label: string }
export type MarkerView = {
  size: string | null; urgent: boolean; bug: boolean; high_risk: boolean; level: string | null
  stage: string | null; stage_set_at_ms: number | null; unit: UnitView | null; review_families: string[]
}
const SIZES = ['XS', 'S', 'M', 'L', 'XL']

// The session marker's stage-graph fields (scripts/session-mode.js §2.9, written by stage-advance.js). A field of the wrong type reads as absent.
export function readMarker(m: Json | null): MarkerView | null {
  if (m === null) return null
  const u = m.unit
  const pos = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1
  const unit: UnitView | null = isObject(u) && typeof u.kind === 'string' && u.kind && pos(u.index) && pos(u.total)
    ? { kind: u.kind, index: u.index, total: u.total, label: typeof u.label === 'string' ? u.label : '' }
    : null
  const at = typeof m.stage_set_at === 'string' ? Date.parse(m.stage_set_at) : NaN
  return {
    size: typeof m.size === 'string' && SIZES.includes(m.size) ? m.size : null,
    urgent: m.urgent === true, bug: m.bug === true, high_risk: m.high_risk === true,
    level: typeof m.level === 'string' && m.level ? m.level : null,
    stage: str(m.stage), stage_set_at_ms: Number.isFinite(at) ? at : null, unit,
    review_families: Array.isArray(m.review_families) ? m.review_families.filter((f): f is string => typeof f === 'string' && f !== '') : [],
  }
}

// ---- D3 residue / D4 stage walk / D1 spend ----
export const RESIDUE_SCHEMA = 'autopilot.residue/1'
// Residue auto-reap R4 (docs/plans/evidence/2026-10-09-residue-auto-reap/contract.md): the band's `wt N` and the Hygiene tab show
// needs_human_*, the residue a person must act on. Fields absent from an older fact read as 0 / null / [].
export type NeedsHumanEntry = { kind: string; target: string; class: string; age_days: number | null; bytes: number | null; reason: string | null; command: string | null }
export type ResidueView = {
  reapable: number; by_class: Record<string, number>; at: string | null
  needs_human_count: number; needs_human_bytes: number | null; needs_human: NeedsHumanEntry[]
  auto_ran_at: string | null; auto_removed_count: number | null; auto_archived_count: number | null
}
// the producer's own list of what a person must act on (path, branch or ref names the target); at most 20 entries are read
function readNeedsHuman(list: unknown): NeedsHumanEntry[] {
  const rows: NeedsHumanEntry[] = []
  if (!Array.isArray(list)) return rows
  for (const e of list) {
    if (!isObject(e)) continue
    const target = str(e.path) ?? str(e.branch) ?? str(e.ref)
    if (target === null) continue
    rows.push({
      kind: str(e.kind) ?? '—', target, class: str(e.class) ?? '—',
      age_days: typeof e.age_days === 'number' && Number.isFinite(e.age_days) ? e.age_days : null,
      bytes: isCount(e.bytes) ? e.bytes : null, reason: str(e.reason), command: str(e.command),
    })
    if (rows.length >= 20) break
  }
  return rows
}
export function readResidue(text: string | null, projectKey: string): ResidueView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== RESIDUE_SCHEMA || parsed.value.project_key !== projectKey) return null
  const v = parsed.value
  if (!isCount(v.reapable_worktrees)) return null
  const by: Record<string, number> = {}
  if (isObject(v.by_class)) for (const k of Object.keys(v.by_class)) if (isCount(v.by_class[k])) by[k] = v.by_class[k] as number
  const rows = readNeedsHuman(v.needs_human)
  return {
    reapable: v.reapable_worktrees, by_class: by, at: str(v.at),
    needs_human_count: isCount(v.needs_human_count) ? v.needs_human_count : 0,
    needs_human_bytes: isCount(v.needs_human_bytes) ? v.needs_human_bytes : null,
    needs_human: rows, auto_ran_at: str(v.auto_ran_at),
    auto_removed_count: isCount(v.auto_removed_count) ? v.auto_removed_count : null,
    auto_archived_count: isCount(v.auto_archived_count) ? v.auto_archived_count : null,
  }
}

// What the owner has to judge versus what can simply be cleared (ui.RESIDUE_KINDS, the one table). The producer's list is capped (20), so entries it counted but did not
// list have no class here: they are counted as 'judge' (the safe side), never as 'clean'. Bytes: needs_human_bytes covers both kinds; the cleanable share is the listed
// 'clean' entries' own bytes, and the judge share is what is left.
export type ResidueTally = { judge: NeedsHumanEntry[]; clean: NeedsHumanEntry[]; judgeCount: number; judgeBytes: number | null; cleanCount: number; cleanBytes: number | null; unlisted: number }
export function residueTally(r: { needs_human_count: number; needs_human_bytes: number | null; needs_human: readonly NeedsHumanEntry[] }): ResidueTally {
  const judge = r.needs_human.filter(e => U.residueKindOf(e.class) === 'judge')
  const clean = r.needs_human.filter(e => U.residueKindOf(e.class) === 'clean')
  const unlisted = Math.max(0, r.needs_human_count - r.needs_human.length)
  const cleanKnown = clean.some(e => e.bytes !== null)
  const cleanBytes = cleanKnown ? clean.reduce((a, e) => a + (e.bytes ?? 0), 0) : null
  return {
    judge, clean, unlisted, judgeCount: judge.length + unlisted, cleanCount: clean.length, cleanBytes,
    judgeBytes: r.needs_human_bytes === null ? null : Math.max(0, r.needs_human_bytes - (cleanBytes ?? 0)),
  }
}

// `reap --auto`'s own result file (<git-common-dir>/autopilot-residue-auto.json): what the owner has to judge (residueTally.judgeCount), else 0.
export function autoResidueCount(text: string | null): number {
  if (text === null) return 0
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== 'autopilot.residue-auto/1') return 0
  const n = parsed.value.needs_human_count
  if (!isCount(n)) return 0
  return residueTally({ needs_human_count: n, needs_human_bytes: null, needs_human: readNeedsHuman(parsed.value.needs_human) }).judgeCount
}

// Absolute path with `.`/`..` segments folded (never above the root).
export function normalizeAbs(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}

// The gitdir a `.git` FILE names (`gitdir: <path>`), absolute and normalised; a relative path is resolved against the directory that holds the file.
export function gitdirOfGitFile(text: string | null, dir: string): string | null {
  if (text === null) return null
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text)
  if (m === null) return null
  const g = m[1]
  return normalizeAbs(g.startsWith('/') ? g : dir + '/' + g)
}

// The common dir of a gitdir, the way git finds it: `<gitdir>/commondir` (relative to the gitdir) when it exists; else the gitdir itself
// (a submodule); only without that file, a linked worktree's `<common>/worktrees/<name>` is cut at its LAST `/worktrees/`.
export function commonDirOfGitdir(gitdir: string, commondirText: string | null): string {
  const c = commondirText === null ? '' : commondirText.trim()
  if (c !== '') return normalizeAbs(c.startsWith('/') ? c : gitdir + '/' + c)
  const i = gitdir.lastIndexOf('/worktrees/')
  return i > 0 ? gitdir.slice(0, i) : gitdir
}

export const STAGE_WALK_SCHEMA = 'autopilot.stage-walk/1'
export type StageWalkView = {
  size: string | null; urgent: boolean; bug: boolean; high_risk: boolean; units: number | null
  nodes: string[]; walk: string[]; entry: string | null; terminal: string | null; unit_kind: string | null
  current: string | null; stage_set_at: string | null; at: string | null
}
export function readStageWalk(text: string | null, sid: string): StageWalkView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== STAGE_WALK_SCHEMA) return null
  const v = parsed.value
  if (typeof v.sid === 'string' && v.sid !== sid && v.sid !== sanitizeSid(sid)) return null
  const names = (x: unknown): string[] => (Array.isArray(x) ? x.map(n => (typeof n === 'string' ? n : isObject(n) ? (str(n.id) ?? str(n.node_id) ?? str(n.name)) : null)).filter((n): n is string => n !== null) : [])
  const walk = names(v.walk)
  if (walk.length === 0) return null
  return {
    size: str(v.size), urgent: v.urgent === true, bug: v.bug === true, high_risk: v.high_risk === true, units: isCount(v.units) ? v.units : null,
    nodes: names(v.nodes), walk, entry: str(v.entry), terminal: str(v.terminal), unit_kind: str(v.unit_kind), current: str(v.current),
    stage_set_at: str(v.stage_set_at), at: str(v.at),
  }
}

// D1: host-today brain-tier spend and the cost-fuse cap, as the watcher published them on the envelope (null = not published)
export function spendOf(env: Json): { brain: number; cap: number } | null {
  const brain = env.host_today_brain_usd
  const cap = env.brain_cap_usd
  return finite(brain) && finite(cap) && cap > 0 ? { brain, cap } : null
}

// ---- the slots ----
// Colour semantics: one meaning per colour, through the ui.ts PALETTE roles only (text colour, never a background; the table and the rules are in the 2026-10-16 revision of
// docs/plans/2026-10-13-live-pane-design-system.md). attention = the owner must look or act · broken = stalled / over cap · done = finished · running = running now
// here = you are here (current stage, current bar cell) · idle = zero / absent / not yet · structure = separators · dim = labels and hints. Bold only on the verdict.
const sp = (text: string, extra: Partial<Seg> = {}): Seg => ({ text, ...extra })

export function slotVerdict(v: { mark: string; word: string; key: ThemeKey | undefined }, reason: string | null = null): Slot {
  const segs: Seg[] = [sp(v.mark + ' ' + v.word, { ...ui.tone(v.key), bold: v.key !== PALETTE.idle })]
  if (reason !== null && reason !== '') segs.push(sp(reason, { dim: true, tag: 'reason' })) // layoutBand places it, clipped, when the line is wide
  return { id: 'verdict', segs }
}

// The stage walk as `✓─✓─◐─○─○` (done `✓` done, current `◐` here, later `○` idle, links structure; the same marks as the pane's walk); null = nothing to draw
// (no walk published, the current stage is not on it, or it is longer than the band can carry).
export const WALK_MAX = 9
export function walkSegs(w: StageWalkView | null, current: string | null): Seg[] | null {
  if (w === null || current === null) return null
  const at = w.walk.indexOf(current)
  if (at < 0 || w.walk.length < 2 || w.walk.length > WALK_MAX) return null
  const out: Seg[] = []
  w.walk.forEach((_n, i) => {
    if (i > 0) out.push(sp(GT.rule, { color: PALETTE.structure, tag: 'walk' }))
    out.push(i < at ? sp(GS.done, { color: PALETTE.done, tag: 'walk' }) : i === at ? sp(GC.here, { color: PALETTE.here, tag: 'walk' }) : sp(GS.pending, { color: PALETTE.idle, tag: 'walk' }))
  })
  return out
}

// `<size>[!]·<level>·<stage>` + ` ◷<age>`; with a stage walk the wide band draws `<size>·<level> <walk> <stage> ◷<age>`; no marker stage = no slot
export function slotPosition(m: MarkerView | null, nowMs: number, w: StageWalkView | null = null): Slot | null {
  if (m === null || m.stage === null) return null
  const head = [m.size === null ? null : m.size + (m.urgent ? '!' : ''), m.level].filter((x): x is string => x !== null).join('·') // no size: no leading `·`
  const segs: Seg[] = []
  const walk = walkSegs(w, m.stage)
  if (head !== '') segs.push(sp(head)) // `size·level·stage`: the `·` is the band's separator (`▸` only ever means folded); the wide band swaps it for the walk
  if (walk === null) { if (head !== '') segs.push(sp('·')) }
  else { if (head !== '') segs.push(sp('·', { tag: 'dot' })); segs.push(sp(' ', { tag: 'walk' }), ...walk, sp(' ', { tag: 'walk' })) }
  segs.push(sp(m.stage, { color: PALETTE.here, tag: 'stage' }))
  const age = m.stage_set_at_ms === null ? '—' : elapsedFrom(m.stage_set_at_ms, nowMs)
  if (age !== '—') segs.push(sp(' ' + GT.age + age, { dim: true, tag: 'age' }))
  return { id: 'position', segs }
}

// `<bar> <k>/<N>` + ` ·<n>fam`; bar: k-1 done `▰` success, the current `▰` claude, the rest `▱` inactive; N > 10 scales to 10 cells
export function unitBarSegs(index: number, total: number): Seg[] {
  const cells = Math.min(total, 10)
  const k = Math.min(Math.max(index, 1), total)
  const cur = total > 10 ? Math.max(1, Math.min(10, Math.ceil((k * 10) / total))) : k
  const segs: Seg[] = []
  if (cur > 1) segs.push(sp(GC.meterOn.repeat(cur - 1), { color: PALETTE.done, tag: 'bar' }))
  segs.push(sp(GC.meterOn, { color: PALETTE.here, tag: 'bar' }))
  if (cells > cur) segs.push(sp(GC.meterOff.repeat(cells - cur), { color: PALETTE.idle, tag: 'bar' }))
  return segs
}
export function slotUnit(m: MarkerView | null, t: T = T_EN): Slot | null {
  if (m === null || m.unit === null) return null
  const { index, total } = m.unit
  const segs: Seg[] = unitBarSegs(index, total)
  segs.push(sp(' ' + index + '/' + total, { tag: 'kn' }))
  if (m.review_families.length > 0) segs.push(sp(' ' + t('band.fam', { n: m.review_families.length }), { dim: true, tag: 'fam' }))
  return { id: 'unit', segs }
}

export function slotDispatch(live: number, stalled: number): Slot | null {
  if (live <= 0 && stalled <= 0) return null
  const segs: Seg[] = []
  if (live > 0) segs.push(sp(GS.running + live, { color: PALETTE.running, tag: 'live' }))
  if (stalled > 0) segs.push(sp((segs.length > 0 ? ' ' : '') + GS.stalled + stalled, { color: PALETTE.broken, tag: 'stalled' }))
  return { id: 'dispatch', segs }
}

// `↺ R<n>` (↺ dim) + ` QC▲` / ` QC✓`: the round goes at < 120, the QC chip stays down to 80
export function slotReview(r: ReviewView | null, q: QcView | null): Slot | null {
  const round = reviewRound(r)
  const chip = qcChip(q)
  if (round === null && chip === null) return null
  const segs: Seg[] = []
  if (round !== null) segs.push(sp(GT.round + ' ', { dim: true, tag: 'round' }), sp('R' + round, { tag: 'round' }))
  if (chip !== null) {
    if (round !== null) segs.push(sp(' ', { tag: 'round' }))
    // the label stays default text; only the mark carries the colour (the owner's attention is yellow once: the verdict word)
    segs.push(sp(chip.slice(0, 2), { tag: 'qc' }), sp(chip.slice(2), { color: chip === 'QC' + GS.done ? PALETTE.done : PALETTE.attention, tag: 'qc' }))
  }
  return { id: 'review', segs }
}

// `◆<proxy>` + ` ?<undocumented>` + ` <rung>`: ◆ is a plain value now (claude is reserved for "you are here"), `?` inactive
export function slotDecisions(d: DecisionsView | null): Slot | null {
  if (d === null) return null
  const parts: Seg[] = []
  if (d.count > 0) parts.push(sp(GT.decisions + d.count))
  if (d.undocumented > 0) parts.push(sp('?' + d.undocumented, { color: PALETTE.idle }))
  if (d.ladder !== null) parts.push(sp(d.ladder.rung))
  if (parts.length === 0) return null
  return { id: 'decisions', segs: parts.flatMap((p, i) => (i === 0 ? [p] : [sp(' '), p])) }
}

// brain-tier spend vs the cap: warning from 80 % of the cap, error from 100 %
export function spendColor(brain: number, cap: number): ThemeKey | undefined {
  const ratio = brain / cap // the raw ratio, never a rounded percent: the band slot and the Spend tab judge the same number
  return ratio >= 1 ? PALETTE.broken : ratio >= 0.8 ? PALETTE.attention : undefined
}

// `▰▰▰▱▱`: filled = round(ratio * n) cells in the state colour, the rest inactive; one tag per width variant
export function spendBarSegs(brain: number, cap: number, n: number, tag?: SegTag): Seg[] {
  const f = Math.min(n, Math.max(0, Math.round((brain / cap) * n)))
  const segs: Seg[] = []
  if (f > 0) segs.push(sp(GC.meterOn.repeat(f), { ...ui.tone(spendColor(brain, cap)), ...(tag === undefined ? {} : { tag }) }))
  if (n > f) segs.push(sp(GC.meterOff.repeat(n - f), { color: PALETTE.idle, ...(tag === undefined ? {} : { tag }) }))
  return segs
}

// `$60 ▰▰▰▰▰▰▱▱▱▱ 60%`: the amount goes below 120 columns (`$▰▰▱` stays), the 10-cell bar + percent are for >= 160, a 5-cell bar for 120-159, 3 cells below
export function slotSpend(s: { brain: number; cap: number } | null): Slot | null {
  if (s === null) return null
  const color = spendColor(s.brain, s.cap)
  const c = color === undefined ? {} : { color }
  const pct = Math.round((s.brain / s.cap) * 100)
  return {
    id: 'spend',
    segs: [
      sp('$', c), sp(String(Math.round(s.brain)), { ...c, tag: 'amt' }),
      sp(' ', { tag: 'bar10' }), ...spendBarSegs(s.brain, s.cap, 10, 'bar10'), sp(' ', { tag: 'pct' }), sp(pct + '%', { dim: true, tag: 'pct' }),
      sp(' ', { tag: 'bar5' }), ...spendBarSegs(s.brain, s.cap, 5, 'bar5'),
      ...spendBarSegs(s.brain, s.cap, 3, 'bar3'),
    ],
  }
}

// hygieneChip text (`dev↓3`, the arrow dim) + ` ⚑<n>` (n = residueTally(...).judgeCount = what a person must judge, the cleanable entries not counted, n > 0 only; the owner reminder, never dropped)
export function slotHygiene(ls: LoadSourceView | null, residue: ResidueView | null): Slot | null {
  const chip = hygieneChip(ls)
  const wt = residue === null ? 0 : residueTally(residue).judgeCount // what the owner has to judge; the cleanable ones are not a reminder
  if (chip === null && wt === 0) return null
  const segs: Seg[] = []
  if (chip !== null) {
    const text = chip.text.replace(' ' + GT.behind, GT.behind)
    const arrow = text.indexOf(GT.behind)
    const col = chip.warn ? { color: PALETTE.attention } : {}
    if (arrow < 0) segs.push(sp(text, { ...col, tag: 'chip' }))
    else {
      const m = new RegExp('^(\\S*' + GT.behind + '\\d+)(.*)$').exec(text.slice(arrow))
      segs.push(sp(text.slice(0, arrow), { ...col, tag: 'chip' }), sp(m === null ? text.slice(arrow) : m[1], { dim: true, tag: 'chip' }))
      if (m !== null && m[2] !== '') segs.push(sp(m[2], { ...col, tag: 'chip' }))
    }
  }
  if (wt > 0) {
    if (chip !== null) segs.push(sp(' ', { tag: 'chip' })) // the separator goes with the chip: a lone `⚑N` has no leading space
    segs.push(sp(GT.residue, { color: PALETTE.attention, tag: 'wt' }), sp(String(wt), { tag: 'wt' })) // the mark is yellow, the number default text
  }
  return { id: 'hygiene', segs }
}

export type BandFacts = {
  verdict: { mark: string; word: string; key: ThemeKey | undefined }
  marker: MarkerView | null; live: number; stalled: number
  review: ReviewView | null; qc: QcView | null; decisions: DecisionsView | null
  spend: { brain: number; cap: number } | null; loadSource: LoadSourceView | null; residue: ResidueView | null
  stage?: StageWalkView | null
  reason?: string | null
  quota?: readonly QuotaWindow[] | null
  nowMs: number
}
// Slots in priority order; an empty slot is left out.
export function bandSlots(f: BandFacts, t: T = T_EN): Slot[] {
  return [
    slotVerdict(f.verdict, f.reason ?? null), slotPosition(f.marker, f.nowMs, f.stage ?? null), slotUnit(f.marker, t), slotDispatch(f.live, f.stalled),
    slotReview(f.review, f.qc), slotDecisions(f.decisions), slotSpend(f.spend), slotQuota(f.quota), slotHygiene(f.loadSource, f.residue),
  ].filter((s): s is Slot => s !== null)
}

export const BAND_SEP = ' ' + GT.bandSep + ' '
export const BAND_ICON = GT.info
// the ⓘ Button's label: the glyph plus a space. ⓘ (U+24D8) is East Asian Width Ambiguous: displayWidth counts it one cell, a CJK-locale terminal
// (the owner's) draws it two, so a one-cell Button left the glyph's right half outside the control. The space makes the Button two cells either way.
export const BAND_INFO_LABEL = BAND_ICON + ' '
export type BandLayout = { segs: Seg[]; text: string; width: number }

// slots in one group read as one thing (single space between): the dispatch count with the review round and QC chip; every other slot is its own group; groups are separated by ` │ `
const GROUP: Record<SlotId, number> = { verdict: 0, position: 1, unit: 2, dispatch: 3, review: 3, decisions: 4, spend: 5, quota: 6, hygiene: 7 }
const REASON_MAX = 48
const REASON_MIN = 8

// The width table (cumulative per band; the line is ONE row, groups separated by ` │ `, items inside a group by a space):
//   >= 160  everything: stage walk, 10-cell spend bar + %, the verdict's reason phrase, load-source chip, age, families, decisions, `5h N% 7d N%`
//   120-159 verdict, `size·level·stage`, unit bar + k/N, `● ⊘ ↺R QC`, `$N` + 5-cell bar, `5h N% 7d N%`, `⚑N`
//   80-119  verdict, unit bar, `●N QC▲`, `$` + 3-cell bar, the most used quota window, `⚑N`
//   < 80    verdict, `●N ⊘N`, `⚑N`
// Then, if the line still does not fit: the position's stage text is cut with `…`, then the unit bar, the ⊘ count and the ● count go, then the
// verdict WORD is shortened (the glyph stays). Never the verdict glyph, the ⓘ or `⚑N` (the owner reminder survives narrowing).
export function layoutBand(slots: Slot[], columns: number): BandLayout {
  const drop = new Set<string>()
  if (columns >= 160) { drop.add('dot'); drop.add('bar5'); drop.add('bar3') }
  else {
    for (const x of ['chip', 'reason', 'walk', 'pct', 'bar10', 'age', 'fam', 'decisions']) drop.add(x)
    if (columns >= 120) drop.add('bar3')
    else {
      for (const x of ['bar5', 'kn', 'round', 'amt', 'position', 'qx']) drop.add(x)
      if (columns < 80) for (const x of ['unit', 'review', 'spend', 'quota']) drop.add(x)
    }
  }
  const rs: { text: string | null } = { text: null }
  let kept: Slot[] = slots.filter(s => !drop.has(s.id)).map(s => {
    const own = s.segs.filter(g => g.tag === undefined || !drop.has(g.tag))
    const r = own.find(g => g.tag === 'reason')
    if (r !== undefined) rs.text = r.text
    return { id: s.id, segs: own.filter(g => g.tag !== 'reason') }
  }).filter(s => s.segs.length > 0)
  const join = (list: Slot[]): Seg[] => {
    const out: Seg[] = []
    list.forEach((s, i) => {
      if (i > 0) out.push(GROUP[s.id] === GROUP[list[i - 1].id] ? sp(' ') : sp(BAND_SEP, { color: PALETTE.structure }))
      out.push(...s.segs.map(g => ({ ...g, slot: s.id })))
    })
    out.push(sp(BAND_SEP, { color: PALETTE.structure }))
    return out
  }
  const widthOf = (g: Seg[]) => g.reduce((n, x) => n + displayWidth(x.text), 0) + displayWidth(BAND_INFO_LABEL)
  let segs = join(kept)
  // too long: the quota windows go first, before any other text is cut
  if (widthOf(segs) > columns && kept.some(s => s.id === 'quota')) { kept = kept.filter(s => s.id !== 'quota'); segs = join(kept) }
  let over = widthOf(segs) - columns
  if (over > 0) segs = segs.map(g => (g.tag === 'stage' ? { ...g, text: truncateToWidth(g.text, Math.max(2, displayWidth(g.text) - over)) } : g))
  // below the width table: still too long -> drop the unit bar, then the ⊘ stalled count, then the ● count (a slot left empty goes with its separator)
  const fallbacks: ((s: Slot) => Slot | null)[] = [
    s => (s.id === 'unit' ? null : s),
    s => (s.id === 'dispatch' ? { ...s, segs: s.segs.filter(g => g.tag !== 'stalled') } : s),
    s => (s.id === 'dispatch' ? { ...s, segs: s.segs.filter(g => g.tag !== 'live') } : s),
  ]
  for (const f of fallbacks) {
    if (widthOf(segs) <= columns) break
    kept = kept.map(f).filter((s): s is Slot => s !== null && s.segs.length > 0)
    segs = join(kept)
  }
  // last: shorten the verdict WORD, the glyph stays; the ⓘ is never touched
  over = widthOf(segs) - columns
  if (over > 0) {
    const v = segs[0]
    const glyph = Array.from(v.text)[0]
    const target = displayWidth(v.text) - over
    segs = [{ ...v, text: target >= 2 ? truncateToWidth(v.text, target) : glyph }, ...segs.slice(1)]
  }
  // the verdict's reason phrase (wide bands only): whatever room is left, clipped, right after the verdict word
  const room = columns - widthOf(segs) - 1
  if (rs.text !== null && segs[0] !== undefined && kept[0] !== undefined && kept[0].id === 'verdict' && room >= REASON_MIN) { // widthOf() already counts the ⓘ, so room = free cells - 1 and the inserted ' ' + reason (1 + room) fills the line exactly
    segs = [segs[0], { ...sp(' ' + truncateToWidth(rs.text, Math.min(room, REASON_MAX)), { dim: true }), slot: 'verdict' }, ...segs.slice(1)]
  }
  return { segs, text: segs.map(g => g.text).join('') + BAND_INFO_LABEL, width: widthOf(segs) }
}

// a non-ok snapshot: one dim line `<reason> │ ⓘ `, the reason cut to fit
export function plainBandText(reason: string, columns: number): string {
  return truncateToWidth(reason.replace(/\s*\n\s*/g, ' '), Math.max(1, columns - displayWidth(BAND_SEP) - displayWidth(BAND_INFO_LABEL)))
}

// ---- the panel's tabs: Now (absorbs the stage walk) · Dispatch · Review (absorbs the decisions) · Spend · Hygiene · ? (the legend) ----
export const PANE_TABS = ['now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'legend'] as const
export type PaneTab = (typeof PANE_TABS)[number]
// a band slot pressed opens the pane on the tab that explains it; position and unit live in Now's 目前位置 section, which the press also unfolds
const SLOT_TAB: Record<SlotId, PaneTab> = { verdict: 'now', position: 'now', unit: 'now', dispatch: 'dispatch', review: 'review', decisions: 'review', spend: 'spend', quota: 'spend', hygiene: 'hygiene' }
export const slotTab = (id: SlotId): PaneTab => SLOT_TAB[id]
export const slotUnfolds = (id: SlotId): string | null => (id === 'position' || id === 'unit' ? SECTION.where : id === 'quota' ? SECTION.limits : null)
export const tabLabel = (tab: PaneTab, t: T): string => t('tab.' + tab)

// What a pane line is drawn with: the translator and the pane's width in cells (rules and bars size themselves to it)
export type PaneCtx = { t: T; cols: number; expanded?: ReadonlySet<string>; folded?: ReadonlySet<string>; decide?: DecideView }

// ---- the 待決 tab: what the owner picked and typed, and what was already sent. The pane keeps it in $.state (`autopilot.decide`, types/index.d.ts), keyed by the
// decision id; `inputs` says whether the surface draws text fields (a phone does not). The reply is one machine-readable prompt: the head line, then one line per
// answered question `<id>｜<first 30 characters of the question> → <answer>[｜補充：<note>]`. These strings are a wire format the model reads back, so they are not
// in the locale tables and do not change with the language. ----
export type DecideState = { picks: Record<string, number>; notes: Record<string, string>; sent: Record<string, number> }
export const NO_DECIDE: DecideState = { picks: {}, notes: {}, sent: {} }
export type DecideView = DecideState & { inputs: boolean }
export const DECIDE_REPLY_HEAD = '[待決回覆]'
const DECIDE_ARROW = '\u2192' // written as an escape: it is wire text the model parses, never a glyph the pane draws (ui-lint L2 keeps drawn glyphs in GLYPHS)
const DECIDE_EXCERPT = 30
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim()
const excerptOf = (q: string): string => { const cs = [...flat(q)]; return cs.length <= DECIDE_EXCERPT ? cs.join('') : cs.slice(0, DECIDE_EXCERPT).join('') + '…' }
// a question the dialog of the asking session answers itself: the pane shows it but never answers it (a second answer would be a duplicate)
export const decideDialog = (d: LiveDecision): boolean => d.origin === 'ask_user_question'
// a question the owner can answer from the pane: it has an id, the pane is the way to answer it, and it was not sent yet
export const decideOpen = (d: LiveDecision, st: DecideState): boolean => d.id !== null && !decideDialog(d) && st.sent[d.id] === undefined
// the picked option of a question (an index that is still one of its options), else null
export const decidePick = (d: LiveDecision, st: DecideState): number | null => {
  const k = d.id === null ? undefined : st.picks[d.id]
  return k !== undefined && Number.isInteger(k) && k >= 0 && k < d.options.length ? k : null
}
const decideNote = (d: LiveDecision, st: DecideState): string => flat(d.id === null ? '' : st.notes[d.id] ?? '')
// one question is ONE line of the reply: line breaks in a label or a typed text become blanks (`flat`), and `｜` in a free text is the separator, so it is replaced
const wire = (s: string): string => flat(s).replace(/｜/g, '|')
// which option the question recommends: its `recommendation` text equals an option's label, or one starts with the other (a recommendation often adds a reason); null = none
export function recommendedIndex(d: LiveDecision): number | null {
  const r = d.recommendation === null ? '' : flat(d.recommendation).toLowerCase()
  if (r === '') return null
  const labels = d.options.map(o => flat(o.label).toLowerCase())
  const exact = labels.indexOf(r)
  if (exact >= 0) return exact
  const part = labels.findIndex(l => l !== '' && (r.startsWith(l) || l.startsWith(r)))
  return part >= 0 ? part : null
}
// the answer line of one question, or null when nothing is chosen (an option question needs a pick, a free one needs text)
export function decideLine(d: LiveDecision, st: DecideState): string | null {
  if (d.id === null || decideDialog(d)) return null
  const note = decideNote(d, st)
  const pick = decidePick(d, st)
  const answer = d.options.length === 0 ? wire(note) : pick === null ? '' : wire(d.options[pick].label) + (note === '' ? '' : '｜補充：' + wire(note))
  return answer === '' ? null : d.id + '｜' + wire(excerptOf(d.question)) + ' ' + DECIDE_ARROW + ' ' + answer
}
// the reply to send now: every open question that has an answer, in list order; null when there is none
export function decideReply(list: readonly LiveDecision[], st: DecideState): { text: string; ids: string[] } | null {
  const rows = list.filter(d => decideOpen(d, st)).flatMap(d => { const line = decideLine(d, st); return line === null ? [] : [{ id: d.id as string, line }] })
  return rows.length === 0 ? null : { text: [DECIDE_REPLY_HEAD, ...rows.map(r => r.line)].join('\n'), ids: rows.map(r => r.id) }
}
export const DEFAULT_PANE_COLS = 76
// the panel is exactly as wide as the body the host gives it (rules, bars and wrapping all size to it); no body width known -> the default
export const paneWidth = (bodyColumns: number | null | undefined): number => (typeof bodyColumns === 'number' && Number.isFinite(bodyColumns) ? Math.max(20, Math.floor(bodyColumns)) : DEFAULT_PANE_COLS)



// ---- wrapping: panel text is never clipped. A line wider than the pane breaks at spaces, after a `/`, and between CJK characters; its continuation
// lines are indented by `hang` (kv rows: under the value column; other rows: their own leading blanks). Only a single unbreakable token longer than
// a whole line is hard-broken. A line that fits is returned untouched.
const CLOSING_PUNCT = '）」』、。，；：！？)]}】》〉,.;:!?'
type WrapCh = { ch: string; si: number; w: number }
function wrapLine(l: PaneLine, cols: number): PaneLine[] {
  if (displayWidth(l.text) <= cols) return [l]
  const base: Seg[] = l.segs ?? [{ text: l.text, ...(l.color !== undefined ? { color: l.color } : l.warn ? { color: PALETTE.attention } : {}), ...(l.bold ? { bold: true } : {}), ...(l.dim ? { dim: true } : {}) }]
  const chars: WrapCh[] = []
  base.forEach((s, si) => { for (const ch of s.text) chars.push({ ch, si, w: cellWidth(ch.codePointAt(0) as number) }) })
  const lead = (l.text.match(/^ */) as RegExpMatchArray)[0].length
  const hang = Math.min(l.hang ?? lead, Math.max(0, Math.floor(cols / 2)))
  // tokens: runs of blanks, and runs of other characters that end after a `/` or a wide (CJK) character
  const tokens: { cs: WrapCh[]; blank: boolean; w: number }[] = []
  for (const c of chars) {
    const blank = c.ch === ' '
    const last = tokens[tokens.length - 1]
    const lastCh = last === undefined ? null : last.cs[last.cs.length - 1]
    const closing = !blank && last !== undefined && !last.blank && CLOSING_PUNCT.includes(c.ch)
    const joins = closing || last !== undefined && last.blank === blank && !(lastCh !== null && (lastCh.ch === '/' || lastCh.w === 2)) && !(c.w === 2 && lastCh !== null && lastCh.w !== 2 && !blank)
    if (joins) { last.cs.push(c); last.w += c.w } else tokens.push({ cs: [c], blank, w: c.w })
  }
  const lines: WrapCh[][] = []
  let cur: WrapCh[] = []
  let w = 0
  let content = false
  const pad = (n: number): WrapCh[] => Array.from({ length: n }, () => ({ ch: ' ', si: -1, w: 1 }))
  const newLine = () => {
    while (cur.length > 0 && cur[cur.length - 1].ch === ' ') cur.pop()
    lines.push(cur)
    cur = pad(hang)
    w = hang
    content = false
  }
  for (const tk of tokens) {
    if (tk.blank) {
      if (!content && lines.length > 0) continue // a blank at the start of a continuation line
      if (w + tk.w <= cols) { cur.push(...tk.cs); w += tk.w } else newLine()
      continue
    }
    if (w + tk.w > cols && content) newLine()
    if (w + tk.w <= cols) { cur.push(...tk.cs); w += tk.w; content = true; continue }
    for (const c of tk.cs) { // one token longer than a whole line: hard-break it
      if (w + c.w > cols && content) newLine()
      cur.push(c); w += c.w; content = true
    }
  }
  while (cur.length > 0 && cur[cur.length - 1].ch === ' ') cur.pop()
  if (cur.length > 0 || lines.length === 0) lines.push(cur)
  // a continuation line holding a single glyph is a widow: pull the previous line's last word (or last character) down beside it
  if (lines.length > 1) {
    const lastLine = lines[lines.length - 1]
    const body = lastLine.slice(hang)
    if (body.length === 1) {
      const prev = lines[lines.length - 2]
      let k = prev.length
      while (k > hang && prev[k - 1].ch !== ' ') k--
      if (k === hang || k === prev.length) { k = prev.length - 1; while (k > hang && CLOSING_PUNCT.includes(prev[k].ch)) k-- } // no blank to break at: move one character, with any closing punctuation joined to it
      const moved = prev.slice(k)
      const rest = prev.slice(0, k)
      while (rest.length > 0 && rest[rest.length - 1].ch === ' ') rest.pop()
      const gap: WrapCh[] = moved[moved.length - 1]?.w === 2 || body[0].w === 2 ? [] : [{ ch: ' ', si: -1, w: 1 }]
      const merged = [...pad(hang), ...moved, ...gap, ...body]
      const mw = merged.reduce((n, c) => n + c.w, 0)
      if (rest.length > hang && mw <= cols) { lines[lines.length - 2] = rest; lines[lines.length - 1] = merged }
    }
  }
  return lines.map(cs => {
    const text = cs.map(c => c.ch).join('')
    if (l.segs === undefined) return carry(l, Object.assign({}, l, { text, hang: undefined, wrap: undefined }))
    const segs: Seg[] = []
    let run = ''
    let at = -2
    const flush = () => { if (run !== '') segs.push(at < 0 ? { text: run } : { ...base[at], text: run }); run = '' }
    for (const c of cs) { if (c.si !== at) { flush(); at = c.si } run += c.ch }
    flush()
    return carry(l, { text, segs, ...(l.toggle !== undefined ? { toggle: l.toggle } : {}), ...(l.goto !== undefined ? { goto: l.goto } : {}) }) // every piece of a wrapped toggle line stays pressable and keeps its goto; a made line's pieces stay made
  })
}
export const wrapLines = (lines: PaneLine[], cols: number): PaneLine[] => lines.flatMap(l => wrapLine(l, cols))

// the Now tab's foldable sections (what waits for you never folds); the ids share the toggle channel with the recent groups, hence the prefix
export const SECTION = { where: 'sec:now.where', account: 'sec:account', recent: 'sec:now.recent', limits: 'sec:limits', today: 'sec:today', last24: 'sec:last24' } as const
export const isSectionId = (id: string): boolean => id.startsWith('sec:') || /^(now|decide|dispatch|review|spend|hygiene|legend)\./.test(id)
const BG_EXIT = /^\[exited with code (\d+)\]$/
export const exitCodeOf = (tail: string | null): number | null => {
  if (tail === null) return null
  const m = BG_EXIT.exec(tail.trim())
  return m === null ? null : Number(m[1])
}

// ================= Recent prompts (the Now tab's trailing section) =================
// The last RECENT_MAX real prompts of this session, each with the assistant's reply, from $.session.messages(). Pure functions only: grouping, redaction
// (secret-shaped strings become ***, in code, no model call) and the line builders. The tick (register.ts) owns the cache and the expanded set.
export type SessionMsg = { role: 'user' | 'assistant'; text: string; toolUses?: unknown[]; toolResults?: unknown[] }
export type RecentGroup = { id: string; prompt: string; reply: string }
export const RECENT_MAX = 3
export const RECENT_COLLAPSED_CHARS = 60
export const RECENT_EXPANDED_LINES = 20
const RECENT_STORE_CHARS = 8000 // what one prompt / reply keeps: the pane shows at most ~20 lines of it
// a user message that starts with one of these is something the harness injected, not something the person typed
export const INJECTED_PREFIXES: readonly string[] = ['<system-reminder>', '<task-notification>', '<local-command-', '<command-name>', '<command-message>', '<command-args>']

const REDACTIONS: { re: RegExp; to: string }[] = [
  { re: /github_pat_[A-Za-z0-9_]{16,}/g, to: '***' },
  { re: /\bgh[posu]_[A-Za-z0-9]{16,}/g, to: '***' },
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, to: '***' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, to: 'Bearer ***' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: '***' },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{8,}/g, to: '***' },
]
export function redactSecrets(text: string): string {
  let out = text
  for (const r of REDACTIONS) out = out.replace(r.re, r.to)
  return out
}

export function isRealPrompt(m: SessionMsg): boolean {
  if (m.role !== 'user' || typeof m.text !== 'string') return false
  const head = m.text.trim()
  if (head === '') return false
  if (Array.isArray(m.toolResults) && m.toolResults.length > 0) return false
  return !INJECTED_PREFIXES.some(p => head.startsWith(p))
}

// cut on a code-point boundary: a UTF-16 slice can split a surrogate pair into a stray replacement glyph
const clip = (s: string) => (s.length > RECENT_STORE_CHARS ? s.slice(0, /[\uD800-\uDBFF]/.test(s[RECENT_STORE_CHARS - 1]) ? RECENT_STORE_CHARS - 1 : RECENT_STORE_CHARS) : s)

export function groupRecent(messages: readonly SessionMsg[], max: number = RECENT_MAX): RecentGroup[] {
  const groups: { id: string; prompt: string; replies: string[] }[] = []
  messages.forEach((m, i) => {
    if (isRealPrompt(m)) groups.push({ id: String(i), prompt: m.text.trim(), replies: [] })
    else if (m.role === 'assistant' && groups.length > 0 && typeof m.text === 'string' && m.text.trim() !== '') groups[groups.length - 1].replies.push(m.text.trim())
  })
  return groups.slice(-max).map(g => ({ id: g.id, prompt: clip(redactSecrets(g.prompt)), reply: clip(redactSecrets(g.replies.join('\n\n'))) }))
}

// Recompute only when the transcript changed (message count, plus the newest message's length: the engine keeps just the newest 4096, so a full
// transcript's count stops moving). `computed` counts the recomputations.
export function makeRecentTracker() {
  let key = ''
  let value: RecentGroup[] | null = null
  const tracker = {
    computed: 0,
    update(sid: string, messages: readonly SessionMsg[]): RecentGroup[] | null {
      const last = messages.length > 0 ? messages[messages.length - 1] : undefined
      const k = sid + ':' + messages.length + ':' + (last === undefined || typeof last.text !== 'string' ? 0 : last.text.length)
      if (k === key) return value
      key = k
      tracker.computed++
      value = groupRecent(messages)
      return value
    },
  }
  return tracker
}

export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
export function collapsedPrompt(prompt: string): string {
  const cps = [...oneLine(prompt)]
  return cps.length > RECENT_COLLAPSED_CHARS ? cps.slice(0, RECENT_COLLAPSED_CHARS).join('') + '…' : cps.join('')
}

// ================= Background work (rows of the Now tab's working section) =================
// What the session left running: background Bash commands (asked for, or moved to the background by a timeout) and Monitor watches, scanned from
// $.session.messages(), plus the subagents $.agent.list() reports running. A task ends on a <task-notification> that carries a <status> (a Monitor
// event notification has none), or on a TaskStop of its id, or, for a result flagged `backgroundEndsWithFinalResponse`, on the next real prompt.
// Known gap (BL-0002, unverified): a row left running across a session resume never ends; the transcript carries no resume marker.
// Known gap: a task that ends mid-turn keeps its row until the turn ends, because its notification waits in the input queue, not in the messages.
export type BgKind = 'shell' | 'monitor'
export type BgTask = { id: string; kind: BgKind; label: string; output: string | null; lastEvent: string | null }
export type ActivityItem = { kind: BgKind | 'agent'; label: string; detail: string | null; tail: string | null; quietMs: number | null }
const BG_LABEL_CHARS = 200
const BG_TAIL_CHARS = 300

const strOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const oneLineClip = (s: string, n: number): string => { const cps = [...oneLine(s)]; return cps.length > n ? cps.slice(0, n).join('') + '…' : cps.join('') }
// A row label from text Claude or a subagent wrote: one line, secrets masked, clipped.
export const bgLabel = (s: string): string => oneLineClip(redactSecrets(s), BG_LABEL_CHARS)
const tagOf = (chunk: string, tag: string): string | null => { const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(chunk); return m === null ? null : m[1].trim() }

// one task-notification block: its ids, its status (absent on a Monitor event) and its event text
type BgNote = { taskId: string | null; toolUseId: string | null; status: string | null; event: string | null }
function notesOf(text: string): BgNote[] {
  return text.split('<task-notification>').slice(1).map(chunk => ({ taskId: tagOf(chunk, 'task-id'), toolUseId: tagOf(chunk, 'tool-use-id'), status: tagOf(chunk, 'status'), event: tagOf(chunk, 'event') }))
}

export function scanBackground(messages: readonly SessionMsg[]): BgTask[] {
  const tasks: (BgTask & { toolUseId: string; turn: number; endsWithFinal: boolean })[] = []
  const ended = new Set<string>()
  const events = new Map<string, string>()
  let turn = 0 // real prompts seen so far: a new one means the turn that started a task has ended
  for (const m of messages) {
    if (m === null || typeof m !== 'object') continue
    if (isRealPrompt(m)) turn++
    if (m.role === 'user' && typeof m.text === 'string' && m.text.includes('<task-notification>')) {
      for (const n of notesOf(m.text)) {
        if (n.status !== null && !/^(running|pending)$/i.test(n.status)) {
          if (n.taskId !== null) ended.add(n.taskId)
          if (n.toolUseId !== null) ended.add(n.toolUseId)
        } else if (n.taskId !== null && n.event !== null) events.set(n.taskId, n.event)
      }
      continue
    }
    if (m.role !== 'assistant' || !Array.isArray(m.toolUses)) continue
    for (const raw of m.toolUses) {
      if (raw === null || typeof raw !== 'object') continue
      const u = raw as { tool_use_id?: unknown; tool?: unknown; input?: unknown; result?: unknown; text?: unknown; isError?: unknown }
      if (u.isError === true) continue // refused: nothing started
      const input = u.input !== null && typeof u.input === 'object' ? (u.input as Record<string, unknown>) : {}
      const stored = u.result !== null && typeof u.result === 'object'
      const result = stored ? (u.result as Record<string, unknown>) : {}
      const text = typeof u.text === 'string' ? u.text : ''
      // The result text is the fallback only when no result was stored (headless): a stored foreground result's text is the command's own output.
      const fromText = (re: RegExp): string | null => (stored ? null : (re.exec(text)?.[1] ?? null))
      const toolUseId = typeof u.tool_use_id === 'string' ? u.tool_use_id : ''
      if (u.tool === 'TaskStop') {
        const id = strOf(input.task_id) ?? strOf(input.shell_id)
        if (id !== null) ended.add(id)
        continue
      }
      let kind: BgKind
      let id: string | null
      if (u.tool === 'Bash') {
        kind = 'shell'
        id = strOf(result.backgroundTaskId) ?? fromText(/^Command running in background with ID: (\S+?)\./) // keyed on the result: a timed-out foreground command moves to the background too
      } else if (u.tool === 'Monitor') {
        kind = 'monitor'
        id = strOf(result.taskId) ?? fromText(/^Monitor started \(task (\S+?),/)
      } else continue
      if (id === null) continue
      const label = strOf(input.description) ?? strOf(input.command) ?? id
      // The output file is named after the task id, so only a path ending in `<id>.output` is taken.
      const output = kind === 'shell' ? (new RegExp('written to: (\\S+/' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.output)').exec(text)?.[1] ?? null) : null
      // Source: Claude Code 2.1.300 Bash result schema, `backgroundEndsWithFinalResponse`: "True when this backgrounded command is terminated at its
      // caller's final response, so no completion notification can follow (a synchronous subagent's command, or a headless session ...)". So it shows up
      // mainly in a synchronous subagent or headless. The evidence that the turn is over is a later real prompt; until then the command is still running.
      tasks.push({ id, toolUseId, kind, label: bgLabel(label), output, lastEvent: null, turn, endsWithFinal: result.backgroundEndsWithFinalResponse === true })
    }
  }
  return tasks
    .filter(task => !ended.has(task.id) && !(task.toolUseId !== '' && ended.has(task.toolUseId)) && !(task.endsWithFinal && task.turn < turn))
    .map(({ toolUseId: _u, turn: _t, endsWithFinal: _e, ...task }) => ({ ...task, lastEvent: events.has(task.id) ? oneLineClip(redactSecrets(events.get(task.id) as string), BG_TAIL_CHARS) : null }))
}

// The last line a background command printed: escape codes stripped, a progress bar's `\r` redraws reduced to the final one, secrets masked.
export function lastOutputLine(text: string): string | null {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  const lines = plain.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = lines[i].split('\r').filter(p => p.trim() !== '')
    if (parts.length > 0) return oneLineClip(redactSecrets(parts[parts.length - 1]), BG_TAIL_CHARS)
  }
  return null
}

// ================= Account and quota =================
// The rate-limit windows come from `$.session.usage().rateLimits` (empty off a subscription or before the first reading); the account from
// Claude Code's own `~/.claude.json` `oauthAccount` (verified by reading the real file; the mods API has no account getter, and `$.settings`
// says it never reads that file). Only these fields are taken from it.
export type QuotaWindow = { kind: string; pct: number; resetsAtMs: number | null }
export type AccountView = { email: string | null; name: string | null; org: string | null; role: string | null; plan: string | null; extraUsage: boolean }
// account: undefined = no tick / the file was not read; null = read, no Claude account (API key or a third-party provider)
export type AccountSnap = { account: AccountView | null | undefined; quota: QuotaWindow[] }

const QUOTA_ORDER = ['five_hour', 'seven_day', 'spend_limit']
export function readQuota(v: unknown): QuotaWindow[] {
  if (!Array.isArray(v)) return []
  const out: QuotaWindow[] = []
  for (const w of v) {
    if (w === null || typeof w !== 'object') continue
    const { kind, percentUsed, resetsAt } = w as { kind?: unknown; percentUsed?: unknown; resetsAt?: unknown }
    if (typeof kind !== 'string' || kind === '' || typeof percentUsed !== 'number' || !Number.isFinite(percentUsed)) continue
    const at = typeof resetsAt === 'string' ? Date.parse(resetsAt) : NaN
    const reading = { kind, pct: Math.max(0, percentUsed), resetsAtMs: Number.isFinite(at) ? at : null }
    const i = out.findIndex(o => o.kind === kind)
    if (i < 0) out.push(reading)
    else if (reading.pct > out[i].pct) out[i] = reading // one row per kind: the most used reading
  }
  const rank = (k: string) => { const i = QUOTA_ORDER.indexOf(k); return i < 0 ? QUOTA_ORDER.length : i }
  return out.sort((a, b) => rank(a.kind) - rank(b.kind))
}

// `claude_max` + `default_claude_max_20x` -> `claude max · 20x`
function planText(type: unknown, tier: unknown): string | null {
  const ty = typeof type === 'string' && type !== '' ? type.replace(/_/g, ' ') : null
  const mult = typeof tier === 'string' ? /_(\d+x)$/.exec(tier)?.[1] ?? null : null
  if (ty === null) return mult
  return mult === null ? ty : ty + ' · ' + mult
}
// null = the file has no `oauthAccount` (an API-key login); the email is shown whole (owner's call), every text goes through bgLabel (one line, masked)
export function readAccount(text: string | null): AccountView | null | undefined {
  if (text === null) return undefined
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value)) return undefined
  const a = parsed.value.oauthAccount
  if (!isObject(a)) return null
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? bgLabel(v) : null)
  const email = str(a.emailAddress)
  if (email === null && str(a.accountUuid) === null) return null
  return { email, name: str(a.displayName), org: str(a.organizationName), role: str(a.organizationRole), plan: planText(a.organizationType, a.organizationRateLimitTier), extraUsage: a.hasExtraUsageEnabled === true }
}

// the shown percent is floored, so text and colour agree (79.9 shows 79% uncoloured) and 100% means the limit is reached
const quotaPct = (pct: number): number => Math.floor(pct)
// used share of a window: warning from 80 %, error from 100 % (the spend slot's thresholds)
const quotaColor = (pct: number): ThemeKey | undefined => spendColor(pct, 100)
const QUOTA_SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'cap' } // not `$`: the spend slot's `$60` sits beside it

// `5h 42% 7d 18%`: the known windows only, each label dim and its percent coloured; below 120 columns only the most used window stays
export function slotQuota(q: readonly QuotaWindow[] | null | undefined): Slot | null {
  const known = (q ?? []).filter(w => QUOTA_SHORT[w.kind] !== undefined)
  if (known.length === 0) return null
  const top = known.reduce((m, w) => (w.pct > m.pct ? w : m), known[0])
  const segs: Seg[] = []
  for (const w of known) {
    const tag = w === top ? undefined : 'qx'
    const c = quotaColor(w.pct)
    if (segs.length > 0) segs.push(sp(' ', { tag: 'qx' })) // a separator only matters while two windows show
    segs.push(sp(QUOTA_SHORT[w.kind] + ' ', { dim: true, ...(tag === undefined ? {} : { tag }) }), sp(quotaPct(w.pct) + '%', { ...(c === undefined ? {} : { color: c }), ...(tag === undefined ? {} : { tag }) }))
  }
  return { id: 'quota', segs }
}

export const QUOTA_KEYS: Record<string, string> = { five_hour: 'label.quota_5h', seven_day: 'label.quota_7d', spend_limit: 'label.quota_spend' }

// ================= Dispatch =================

// the subject `stateOf('run', …)` classifies (design plan §3.3). `fresh` is the producer's own freshness test, read once in paneRows; an ended row is never fresh.
export const runSubject = (r: LivePaneRow): RunSubject => ({ rc: r.rc, final_status: r.final_status, stall: r.stall, fresh: r.fresh, starting: r.starting })
// when a run ended (ms): the manifest's ended_at, else started_at + elapsed_s (the producer freezes elapsed_s at the end); null = unknown
export function runEndedMs(r: LivePaneRow): number | null {
  const end = r.ended_at === null ? NaN : Date.parse(r.ended_at)
  if (Number.isFinite(end)) return end
  if (r.final_status === null) return null // the producer freezes elapsed_s only for a run that really ended; a dead process without ended_at keeps counting, so it cannot date the end
  const start = r.started_at === null ? NaN : Date.parse(r.started_at)
  return Number.isFinite(start) && r.elapsed_s !== null ? start + r.elapsed_s * 1000 : null
}
// F5 (§2.5): a finished run older than FRESH_MS.dispatch is counted in the section chip and not listed; unknown times keep the run listed
export const runAgedOut = (r: LivePaneRow, nowMs: number | null): boolean => {
  const end = runEndedMs(r)
  return r.ended && nowMs !== null && end !== null && isStale('dispatch', nowMs - end)
}

// band-kind predicates: tabs.ts asks the band what it is without spelling a state word (lint L7)
export const bandAsks = (b: BandView): boolean => b.kind === 'decide' || b.kind === 'stalled' || b.kind === 'waiting'
export const bandIsDecide = (b: BandView): boolean => b.kind === 'decide'
export const bandIsStalled = (b: BandView): boolean => b.kind === 'stalled'
export const bandIsWaiting = (b: BandView): boolean => b.kind === 'waiting'
export const bandIsQuiet = (b: BandView): boolean => b.kind === 'running' || b.kind === 'idle'
