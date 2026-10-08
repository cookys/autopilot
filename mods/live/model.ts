// mods/live/model.ts — pure helpers for the live mod (plan P1c). No `$` in here: every file read, every clock
// read and every UI call stays in register.ts. Nothing in this file derives a number the producer already
// published: counts, cost, context, the progress numbers and the decision are copied from the envelope / context
// file / job model. The selections made here: the verdict word (a precedence over fields the producers already
// published), the project short name, the earliest start and the quietest stalled run.
// W3a: the per-session files (tasks, attention), the watcher sidecars (decisions, foreman, sources manifest) and the
// campaign progress receipts are parsed here too; every sidecar carries its scope and a scope that is not the one
// wanted is an absent file (same rule as checkEnvelope).


// ---- the snapshot the tick builds and the band / pane draw (module state in register.ts) ----
export type LivePaneRow = {
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
}

export type LiveGateRow = {
  phase: string | null
  generation: number | null
  verdict: string | null
  status: string | null
}

export type LiveDecision = { question: string; options: { label: string; consequence: string }[]; stale: boolean; age_s: number | null }

// one pane line: plain text plus how it is drawn
export type PaneLine = { text: string; dim?: boolean; bold?: boolean; warn?: boolean; color?: ThemeKey; segs?: Seg[] }
// attention = something awaits the human (drawn first); waiting = idle / source-not-wired note; the rest follow the gate rows
export type PaneSections = { attention: PaneLine[]; waiting: PaneLine[]; tasks: PaneLine[]; decisions: PaneLine[]; foreman: PaneLine[] }
export const NO_SECTIONS: PaneSections = { attention: [], waiting: [], tasks: [], decisions: [], foreman: [] }

// The two band lines of an ok snapshot. Every ok band carries one of five words; the fifth, 待命, is the idle word.
export type BandView = {
  mark: string
  verdict: string
  head: string // "<project> · <phase> · <elapsed> · " (the progress follows it)
  progress: string
  progressDim: boolean // an unfrozen denominator is drawn dim
  reason: string | null
  slots: Slot[] // P7: the one-line band's slots in priority order (width-independent; layoutBand applies the width table)
}

export type LiveSnapshot = {
  // ok | stale | unavailable | unreadable | no-pointer | no-project
  state: 'ok' | 'stale' | 'unavailable' | 'unreadable' | 'no-pointer' | 'no-project'
  // the exact band text (an ok snapshot: line 1, then the reason on its own line)
  text: string
  band: BandView | null // set for state ok only
  // pane header row: session cost / host cost / context (an ok snapshot); the state text otherwise
  header: string
  // what is awaited from the human, from the job model's decision object (null = nothing awaited)
  decision: LiveDecision | null
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
}

export type SpendView = { session: string; host_all: string; brain: number | null; cap: number | null; mode: string }
export type PaneDetail = {
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
export const NO_DETAIL: PaneDetail = { now_ms: null, project: null, marker: null, qc: null, stage: null, decisions: null, load_source: null, residue: null, spend: null }

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

const VERDICT = {
  decide: { mark: '▲', word: '要你決定', key: 'warning' },
  stalled: { mark: '⏸', word: '疑似卡住', key: 'error' },
  waiting: { mark: '✓', word: '完成待驗收', key: 'success' },
  running: { mark: '●', word: '進行中', key: 'suggestion' },
  idle: { mark: '◌', word: '待命', key: 'inactive' },
} as const

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

// "38m" / "2h14m" / "1d3h": now minus the start of this piece of work; no start -> an em dash.
export function elapsedFrom(startMs: number | null, nowMs: number): string {
  if (startMs === null || !Number.isFinite(startMs) || !Number.isFinite(nowMs) || nowMs < startMs) return '—'
  const minutes = Math.floor((nowMs - startMs) / 60000)
  if (minutes < 60) return minutes + 'm'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + 'h' + (minutes % 60) + 'm'
  return Math.floor(hours / 24) + 'd' + (hours % 24) + 'h'
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
  if (s < 60) return Math.floor(s) + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + (m % 60) + 'm'
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}

export type JobProgress = { frozen: boolean; percent: number | null; done: number | null; total: number | null }

// frozen: "62.5%（5/8）" (the percent as the job model published it). Not frozen: "3 done*", drawn dim. No count: an em dash.
export function progressView(p: JobProgress | null): { text: string; dim: boolean } {
  if (p === null) return { text: '—', dim: false }
  if (p.frozen && p.percent !== null && p.done !== null && p.total !== null) return { text: p.percent + '%（' + p.done + '/' + p.total + '）', dim: false }
  if (p.done !== null) return { text: p.done + ' done*', dim: true }
  return { text: '—', dim: false }
}

// The stalled rows are the ones the producer flagged (`stall: true`); the age is the producer's last_event_age_s.
export function stalledReason(env: Json): string | null {
  const stalled = (rowsOf(env) || []).filter(r => r.stall === true)
  if (stalled.length === 0) return null
  const ages = stalled.map(r => r.last_event_age_s).filter(finite)
  if (ages.length === 0) return '有 ' + stalled.length + ' 個派工疑似沒有輸出'
  return '最久的派工 ' + Math.floor(Math.max(...ages) / 60) + 'm 沒有輸出'
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
export const NOT_WIRED = '來源未接'
export const TODO_TOOLS_HINT = '任務工具未開 · 設 CLAUDE_CODE_ENABLE_TODO_TOOLS=1 後才會記錄任務'

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

export type DecisionRow = { round: number | null; decision: string; irreversible: boolean; writer: string | null; decision_id: string | null; source: string | null; root: string | null }
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
    decision: asking !== undefined ? asking.decision : base.decision,
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

// the review-slot chip: `QC ✓` (evidence present), `QC owed` (protected diff, no evidence); nothing owed or unknown = no chip
export function qcChip(q: QcView | null): string | null {
  if (q === null) return null
  return q.state === 'ok' ? 'QC ✓' : q.state === 'owed' ? 'QC owed' : null
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
    plugin_version: str(v.plugin_version), source: str(v.source) || 'unknown', marketplace: str(v.marketplace) || 'missing',
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

// The hygiene slot's load-source chip: `dev` / `dev ↓3` (behind upstream by 3), `dev ⚠` (the marketplace is not this repo's directory),
// `cache 2.36.36 ⚠` (a stale cache copy is what loads), `src ? ⚠` (unknown). warn = the chip carries ⚠ (the renderer picks the warning colour).
export function hygieneChip(v: LoadSourceView | null, sessionPid: number | string | null = null): { text: string; warn: boolean } | null {
  if (v === null) return null
  const src = loadSourceFor(v, sessionPid)
  const marketplaceBad = v.flags.includes('marketplace_not_directory') || v.flags.includes('marketplace_not_this_repo')
  if (src.startsWith('cache:')) return { text: 'cache ' + src.slice('cache:'.length) + ' ⚠', warn: true }
  if (src === 'dev') {
    const behind = v.behind_upstream !== null && v.behind_upstream > 0 ? ' ↓' + v.behind_upstream : ''
    return { text: 'dev' + behind + (marketplaceBad ? ' ⚠' : ''), warn: marketplaceBad }
  }
  return { text: 'src ? ⚠', warn: true }
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

const waitingMinutes = (sinceMs: number | null, nowMs: number): number | null => (sinceMs === null ? null : Math.max(0, Math.floor((nowMs - sinceMs) / 60000)))

// what the human is being waited on for, from the attention file (permission / question only)
export function attentionReason(a: AttentionView, nowMs: number): string {
  const n = waitingMinutes(a.since_ms, nowMs)
  return (a.kind === 'permission' ? '等你批准：' : '等你回答：') + a.summary + (n === null ? '' : '（等了 ' + n + ' 分）')
}

// 「（已等 N 天）」: only the model's stale flag, only when a whole day has passed
export function staleSuffix(d: LiveDecision | null): string {
  if (d === null || !d.stale || d.age_s === null || d.age_s < 86400) return ''
  return '（已等 ' + Math.floor(d.age_s / 86400) + ' 天）'
}

// 僅自動裁決, worded from the writers the sidecar says are wired; next-pick is the depth-0 writer
export function writersLabel(writers: string[]): string | null {
  if (writers.includes('next-pick')) return null
  return writers.length === 0 ? '決策寫入端未接' : '僅 ' + writers.join('、') + ' 自動裁決'
}

// band line 2 tail: the proxy decisions (only when non-zero) and the dispatches nobody wrote down
export function proxySegments(d: DecisionsView | null): string[] {
  if (d === null) return []
  const out: string[] = []
  if (d.count > 0) {
    out.push('代你決定 ' + d.count + ' 件（' + d.irreversible + ' 件不可逆）')
    const label = writersLabel(d.writers)
    if (label !== null) out.push(label)
  }
  if (d.undocumented > 0) out.push(d.undocumented + ' 件派工無決策紀錄')
  return out
}

// Precedence: 1 needs a decision (attention permission / question, or an open decision), 2 stalled (a dispatch run, or an un-ended foreman quiet >= FOREMAN_STALL_S), 3 complete and
// waiting acceptance (frozen progress done = total, or every session task completed; NO live run in scope and no un-ended fresh foreman), 4 running
// (a live run, a fresh foreman, a session task in progress, or an active turn), 5 idle (the turn ended: nothing live, no task in progress).
export function bandView(env: Json, jobModel: JobModel | null, projectKey: string, nowMs: number, src: Sources = NO_SOURCES): BandView {
  const counts = countsOf(env)
  const progress = jobModel === null ? null : jobModel.progress
  const stalled = stalledReason(env)
  const noneLive = counts !== null && counts.confirmed_live === 0
  const undecided = jobModel === null || (jobModel.acceptance !== 'accepted' && jobModel.acceptance !== 'rejected')
  const frozenDone = progress !== null && progress.frozen && progress.done !== null && progress.total !== null && progress.done === progress.total
  const tasksDone = src.tasks !== null && src.tasks.total > 0 && src.tasks.completed === src.tasks.total
  const fm = foremanNow(src.foreman, nowMs)
  const waiting = noneLive && undecided && ((frozenDone && jobModel !== null) || tasksDone) && fm.fresh === null
  const taskRunning = src.tasks !== null && src.tasks.in_progress > 0
  const turnActive = src.turn !== null && src.turn.state === 'active'
  const awaiting = src.attention !== null && src.attention.kind !== 'idle' ? src.attention : null
  let pick: { mark: string; word: string; key: ThemeKey }
  let reason: string | null = null
  if (awaiting !== null || (jobModel !== null && jobModel.needs_decision)) {
    pick = VERDICT.decide
    if (awaiting !== null) reason = attentionReason(awaiting, nowMs)
    else if (jobModel !== null && jobModel.decision !== null) reason = jobModel.decision.question + staleSuffix(jobModel.decision)
    else reason = (jobModel !== null && jobModel.conclusion) || '等你決定'
  } else if (stalled !== null) {
    pick = VERDICT.stalled
    reason = stalled
  } else if (fm.stalled !== null) {
    pick = VERDICT.stalled
    reason = '工頭 ' + Math.floor(fm.stalled.age_s / 60) + ' 分沒有動作'
  } else if (waiting) {
    pick = VERDICT.waiting
    reason = frozenDone ? '驗收結論尚未出' : '任務 ' + (src.tasks as TasksView).completed + '/' + (src.tasks as TasksView).total + ' 都完成，等你驗收'
  } else if ((counts !== null && counts.confirmed_live > 0) || fm.fresh !== null || taskRunning || turnActive) {
    // GATEFIX / TURN: a live run, a session task in progress, or an active turn (the session is mid-work); the live run names itself first, then the task.
    pick = VERDICT.running
    reason = counts !== null && counts.confirmed_live > 0
      ? counts.confirmed_live + ' 個派工在跑'
      : fm.fresh !== null
        ? '工頭在跑：' + fm.fresh.name + '（' + Math.floor(fm.fresh.age_s / 60) + ' 分前有動作）'
      : taskRunning
        ? '任務進行中：' + (src.tasks !== null && src.tasks.current ? src.tasks.current : (src.tasks as TasksView).in_progress + ' 件')
        : '回合進行中' + (() => { const n = waitingMinutes((src.turn as TurnView).since_ms, nowMs); return n === null ? '' : '（' + n + ' 分）' })()
  } else {
    pick = VERDICT.idle
    reason = '沒有派工在跑'
    if (src.attention !== null && src.attention.kind === 'idle') {
      const n = waitingMinutes(src.attention.since_ms, nowMs)
      if (n !== null) reason += ' · 停在等你指示 ' + n + ' 分'
    }
  }
  const tail = proxySegments(src.decisions)
  const line2 = [reason, ...tail].join(' · ')
  const identity = isObject(env.scope) ? env.scope.repo_identity : null
  // the phase is the job model's `phase.label` (campaign > receipt > marker stage `size·level ▸ stage` + `unit k/N` > task in progress > deliverable); absent / malformed: an em dash, never the process phase.
  // No writer of a stage live per the sources manifest: 來源未接 (a phase the model really carries is shown whatever the manifest says).
  const phase = jobModel !== null && jobModel.phase !== null ? jobModel.phase.label : notWired(src.manifest, ['stage', 'progress', 'task_status_input']) ? NOT_WIRED : '—'
  let prog = progressView(progress)
  if (prog.text === '—') {
    if (src.tasks !== null && src.tasks.total > 0) prog = { text: src.tasks.completed + ' done*', dim: true } // task counts have no frozen denominator
    else if (notWired(src.manifest, ['progress', 'tasks'])) prog = { text: NOT_WIRED, dim: false }
  }
  const stalledN = (rowsOf(env) || []).filter(r => r.stall === true).length + (fm.stalled !== null ? 1 : 0)
  const slots = bandSlots({
    verdict: pick, marker: src.marker ?? null, live: counts === null ? 0 : counts.confirmed_live, stalled: stalledN, review: src.review ?? null, qc: src.qc ?? null,
    decisions: src.decisions, spend: spendOf(env), loadSource: src.loadSource ?? null, residue: src.residue ?? null, nowMs,
  })
  return {
    mark: pick.mark,
    verdict: pick.word,
    head: projectName(identity, projectKey) + ' · ' + phase + ' · ' + elapsedFrom(src.startMs, nowMs) + ' · ',
    progress: prog.text,
    progressDim: prog.dim,
    reason: line2,
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
export function ctxShown(ctx: string, manifest: Manifest | null): string {
  return ctx === '—' && notWired(manifest, ['context']) ? NOT_WIRED : ctx
}

// pane header row: what left the band. Session cost and context are this sid's own; host cost is the day's total.
export function headerText(env: Json, sid: string, ctx: string): string {
  return 'session ' + sessionUsd(env, sid).text + ' · host ' + usd(env.host_today_usd) + ' · ctx ' + ctx
}

export function paneRows(env: Json): LivePaneRow[] | null {
  const rows = rowsOf(env)
  if (rows === null) return null
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return rows.map(r => ({
    run_id: String(r.run_id === undefined || r.run_id === null ? '?' : r.run_id),
    role: str(r.role), runner: str(r.runner), model: str(r.model), started_at: str(r.started_at),
    elapsed_s: finite(r.elapsed_s) ? r.elapsed_s : null, phase: str(r.phase),
    rc: Number.isInteger(r.rc) ? (r.rc as number) : null, final_status: str(r.final_status),
    probe_age_s: finite(r.probe_age_s) ? r.probe_age_s : null,
  }))
}

export type JobModel = {
  acceptance: string
  gates: LiveGateRow[]
  needs_decision: boolean
  conclusion: string | null
  decision: LiveDecision | null
  progress: JobProgress | null
  phase: { code: string | null; label: string } | null
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
  const d = m.decision
  const decision: LiveDecision | null = isObject(d) && typeof d.question === 'string' && d.question
    ? {
        question: d.question,
        options: (Array.isArray(d.options) ? d.options : []).filter(isObject).map(o => ({
          label: typeof o.label === 'string' ? o.label : '',
          consequence: typeof o.consequence === 'string' ? o.consequence : '',
        })).filter(o => o.label !== ''),
        stale: d.stale === true,
        age_s: finite(d.age_s) ? d.age_s : null,
      }
    : null
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
  const phase = isObject(ph) && typeof ph.label === 'string' && ph.label ? { code: typeof ph.code === 'string' ? ph.code : null, label: ph.label } : null
  return { acceptance, gates, needs_decision: m.needs_decision === true, conclusion: typeof m.conclusion === 'string' && m.conclusion ? m.conclusion : null, decision, progress, phase, sources_manifest: m.sources_manifest }
}

// Axis words follow the review page's chip mapping (plan A12).
export const execWord = { running: 'RUNNING', exited: 'EXITED', unknown: 'UNKNOWN' } as const
export const acceptWord = (a: string): string => (a === 'accepted' ? 'ACCEPTED' : a === 'rejected' ? 'REJECTED' : 'PENDING')

export type Counts = { confirmed_live: number; exited: number; unknown: number }

export function countsOf(env: Json): Counts | null {
  const c = env.counts
  if (!isObject(c) || !Number.isInteger(c.confirmed_live) || !Number.isInteger(c.exited) || !Number.isInteger(c.unknown)) return null
  return { confirmed_live: c.confirmed_live as number, exited: c.exited as number, unknown: c.unknown as number }
}

export function executionToast(before: Counts, after: Counts): string | null {
  if (before.confirmed_live === after.confirmed_live && before.exited === after.exited && before.unknown === after.unknown) return null
  return 'execution axis: RUNNING ' + before.confirmed_live + '→' + after.confirmed_live
    + ' · EXITED ' + before.exited + '→' + after.exited + ' · UNKNOWN ' + before.unknown + '→' + after.unknown
}

export function acceptanceToast(before: string, after: string): string | null {
  return before === after ? null : 'acceptance axis: ' + acceptWord(before) + ' → ' + acceptWord(after)
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

export const STATE_TEXT = {
  noPointer: 'no pointer · run: ' + RUNS_HINT,
  noProject: 'no project · run: ' + RUNS_HINT,
  unreadable: 'unreadable',
  stale: (key: string, publishedAt: string | null) => 'stale' + (publishedAt ? ' · last published ' + publishedAt : '') + ' · run: ' + RUNS_HINT + ' --project ' + key,
  unavailable: (key: string) => 'unavailable · run: ' + RUNS_HINT + ' --project ' + key,
}

// ---- W3a pane sections: text built from the sources, drawn by pane.tsx ----
const ledgerPath = (source: string | null, common: string | null, root: string | null): string | null => {
  if (common === null) return null
  if (source === 'ledger_root') return root === null ? null : common + '/autopilot/work-orders/' + root + '/decision-ledger.jsonl'
  return common + '/autopilot/ledger/decisions.jsonl'
}

// the veto verb is decision-ledger.js `veto --ledger <ledger> --id <decision_id>` (its own round report prints the same line)
export function vetoLine(r: DecisionRow, common: string | null, root: string | null): string {
  if (r.decision_id === null) return '  （沒有 decision_id，無法 veto）'
  const path = ledgerPath(r.source, common, r.root !== null ? r.root : root) // a merged view carries rows of several roots: each names its own
  if (path === null && r.source === 'ledger_root') return '  （找不到 ledger 路徑，無法組出 veto 指令）'
  return '  veto: decision-ledger.js veto ' + (path === null ? '' : '--ledger ' + path + ' ') + '--id ' + r.decision_id
}

const MAX_DECISION_ROWS = 12
const MAX_TASK_ROWS = 8

export function buildSections(src: Sources, foreman: ForemanView | null, identity: unknown, nowMs: number): PaneSections {
  const m = src.manifest
  const a = src.attention
  const attention: PaneLine[] = a !== null && a.kind !== 'idle'
    ? [{ text: '要你決定', bold: true, warn: true }, { text: attentionReason(a, nowMs) }]
    : []
  const waiting: PaneLine[] = []
  if (a !== null && a.kind === 'idle') {
    const n = waitingMinutes(a.since_ms, nowMs)
    waiting.push({ text: n === null ? '停在等你指示' : '停在等你指示 ' + n + ' 分', dim: true })
  } else if (a === null && liveSource(m, 'attention') === false) {
    waiting.push({ text: '等待狀態：' + NOT_WIRED, dim: true })
  }

  const tasks: PaneLine[] = []
  const t = src.tasks
  if (t !== null) {
    if (t.total === 0) tasks.push({ text: '沒有任務', dim: true })
    else {
      tasks.push({ text: '任務 ' + t.completed + '/' + t.total + ' 完成 · 進行中 ' + t.in_progress, bold: true })
      if (t.current !== null) tasks.push({ text: '目前：' + t.current })
      for (const r of t.rows.slice(0, MAX_TASK_ROWS)) tasks.push({ text: (r.status === 'completed' ? '[x] ' : r.status === 'in_progress' ? '[~] ' : '[ ] ') + r.subject, dim: r.status === 'completed' })
    }
  } else if (liveSource(m, 'tasks') === true) tasks.push({ text: TODO_TOOLS_HINT, dim: true })
  else if (liveSource(m, 'tasks') === false) tasks.push({ text: '任務：' + NOT_WIRED, dim: true })

  const decisions: PaneLine[] = []
  const d = src.decisions
  if (d !== null) {
    const common = commonDirOf(identity)
    if (d.count > 0) {
      decisions.push({ text: '代你決定 ' + d.count + ' 件（' + d.irreversible + ' 件不可逆）', bold: true })
      const label = writersLabel(d.writers)
      if (label !== null) decisions.push({ text: label, dim: true })
      for (const r of d.rows.slice(-MAX_DECISION_ROWS)) {
        decisions.push({ text: '[' + (r.decision_id === null ? '—' : r.decision_id) + '] ' + r.decision + ' · ' + (r.irreversible ? '不可逆' : '可逆') + ' · ' + (r.writer === null ? '—' : r.writer) + (r.round === null ? '' : ' · 第 ' + r.round + ' 輪') })
        decisions.push({ text: vetoLine(r, common, d.root), dim: true })
      }
      if (d.rows.length > MAX_DECISION_ROWS) decisions.push({ text: '…另有 ' + (d.rows.length - MAX_DECISION_ROWS) + ' 件較早的決定', dim: true })
    }
    if (d.undocumented > 0) decisions.push({ text: d.undocumented + ' 件派工無決策紀錄', dim: true })
  } else if (notWired(m, ['ledger_engine', 'ledger_depth0'])) decisions.push({ text: '代你決定：' + NOT_WIRED, dim: true })

  const fm: PaneLine[] = []
  if (foreman === null) fm.push({ text: '工頭狀態：' + NOT_WIRED, dim: true })
  else {
    fm.push({ text: foreman.binding === 'session' ? '工頭活動（依 session 綁定：同一 session 的多個工作會看到同一批）' : '工頭活動（綁定：' + foreman.binding + '）', bold: true })
    const age = (at: number | null, published: number | null) => ageText(at !== null ? (nowMs - at) / 1000 : published === null ? NaN : published)
    for (const g of foreman.agents) {
      fm.push({ text: (g.description || g.id) + ' · ' + (g.label || '—') + ' · ' + age(g.at_ms, g.age_s) + ' 前' + (g.stale ? ' · 久未動' : ''), dim: g.stale })
    }
    if (foreman.stage !== null) fm.push({ text: '階段 ' + foreman.stage + ' · ' + age(foreman.stage_at_ms, foreman.stage_age_s) + ' 前' + (foreman.stage_source === null ? '' : '（' + foreman.stage_source + '）') })
    if (foreman.agents.length === 0 && foreman.stage === null) fm.push({ text: '沒有活動紀錄', dim: true })
  }
  return { attention, waiting, tasks, decisions, foreman: fm }
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

// The band's review slot (the band layout itself is P7): `R<n> ⟲`, n = the code-review round when there is one, else the plan-review generation; null = no slot.
export function reviewSlot(r: ReviewView | null): string | null {
  if (r === null) return null
  const n = r.code !== null && r.code.generation !== null ? r.code.generation : r.plan !== null ? r.plan.generation : null
  return n === null ? null : 'R' + n + ' ⟲'
}

const short = (sha: string | null): string => (sha === null ? '—' : sha.slice(0, 8))

// The Review tab: plan review, then code review; "no review" when neither is published.
export function reviewLines(r: ReviewView | null): PaneLine[] {
  if (r === null) return [NO_DATA('no review published')]
  const out: PaneLine[] = []
  if (r.plan !== null) {
    const p = r.plan
    out.push({ text: 'plan review · ' + (p.logical_plan_id || '—') + ' · gen ' + p.generation + (p.max_generations === null ? '' : '/' + p.max_generations) + ' · ' + (p.terminal ? 'terminal' : 'active') + ' · ' + (p.verdict || '—'), bold: true })
    if (p.seats.length === 0) out.push({ text: '  no seat verdicts yet', dim: true })
    for (const s of p.seats) out.push({ text: '  ' + s.id + ' · ' + (s.family || '—') + ' · ' + (s.status || '—') })
  }
  if (r.code !== null) {
    const c = r.code
    out.push({ text: 'code review · ' + (c.phase || '—') + ' · R' + (c.generation === null ? '—' : c.generation) + ' · ' + short(c.base) + '..' + short(c.head) + ' · ' + (c.converged ? 'converged' : 'open'), bold: true })
    if (c.seats.length === 0) out.push({ text: '  no seats', dim: true })
    for (const s of c.seats) out.push({ text: '  ' + s.id + ' · ' + (s.family || '—') + ' · ' + (s.status || '—') + ' · ' + (s.verdict || '—') })
  }
  return out
}

// ================= stage-graph P7: the one-line band (contract ②) and the panel's facts =================
// Colours are theme keys used as TEXT colour only (owner decision 5): no backgroundColor, no inverse, no raw colour.
export type ThemeKey = 'claude' | 'warning' | 'error' | 'success' | 'suggestion' | 'inactive' | 'subtle'
export type SlotId = 'verdict' | 'position' | 'unit' | 'dispatch' | 'review' | 'decisions' | 'spend' | 'hygiene'
// tag: which part the width table may drop or shorten (age, k/N, 族, the bar, the stage text)
export type SegTag = 'age' | 'kn' | 'fam' | 'bar' | 'stage'
export type Seg = { text: string; color?: ThemeKey; bold?: boolean; tag?: SegTag }
export type Slot = { id: SlotId; segs: Seg[] }

// Terminal cell width of a string: East Asian Wide / Fullwidth = 2, combining and zero-width = 0, everything else (the band glyphs
// ▲⏸✓●◌▸◷▰▱⚙◆⟲ⓘ│… included) = 1.
export function displayWidth(text: string): number {
  let w = 0
  for (const ch of text) w += cellWidth(ch.codePointAt(0) as number)
  return w
}
function cellWidth(c: number): number {
  if (c === 0 || (c >= 0x0300 && c <= 0x036f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x20d0 && c <= 0x20ff)) return 0
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x303e) || (c >= 0x3041 && c <= 0x33ff) || (c >= 0x3400 && c <= 0x4dbf)
    || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa000 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
    || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd)) return 2
  return 1
}

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
export type ResidueView = { reapable: number; by_class: Record<string, number>; at: string | null }
export function readResidue(text: string | null, projectKey: string): ResidueView | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== RESIDUE_SCHEMA || parsed.value.project_key !== projectKey) return null
  const v = parsed.value
  if (!isCount(v.reapable_worktrees)) return null
  const by: Record<string, number> = {}
  if (isObject(v.by_class)) for (const k of Object.keys(v.by_class)) if (isCount(v.by_class[k])) by[k] = v.by_class[k] as number
  return { reapable: v.reapable_worktrees, by_class: by, at: str(v.at) }
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
const sp = (text: string, extra: Partial<Seg> = {}): Seg => ({ text, ...extra })

export function slotVerdict(v: { mark: string; word: string; key: ThemeKey }): Slot {
  return { id: 'verdict', segs: [sp(v.mark + ' ' + v.word, { color: v.key, bold: v.key !== 'inactive' })] }
}

// `<size>[!]·<level> ▸ <stage>` + ` ◷<age>`; no marker stage = no slot
export function slotPosition(m: MarkerView | null, nowMs: number): Slot | null {
  if (m === null || m.stage === null) return null
  const head = (m.size === null ? '' : m.size + (m.urgent ? '!' : '')) + (m.level === null ? '' : '·' + m.level)
  const segs: Seg[] = [sp((head === '' ? '' : head + ' ') + '▸ '), sp(m.stage, { color: 'claude', tag: 'stage' })]
  const age = m.stage_set_at_ms === null ? '—' : elapsedFrom(m.stage_set_at_ms, nowMs)
  if (age !== '—') segs.push(sp(' ◷' + age, { tag: 'age' }))
  return { id: 'position', segs }
}

// `<bar> <k>/<N>` + ` ·<n>族`; bar: k-1 done `▰` success, the current `▰` claude, the rest `▱` inactive; N > 10 scales to 10 cells
export function slotUnit(m: MarkerView | null): Slot | null {
  if (m === null || m.unit === null) return null
  const { index, total } = m.unit
  const cells = Math.min(total, 10)
  const k = Math.min(Math.max(index, 1), total)
  const cur = total > 10 ? Math.max(1, Math.min(10, Math.ceil((k * 10) / total))) : k
  const segs: Seg[] = []
  if (cur > 1) segs.push(sp('▰'.repeat(cur - 1), { color: 'success', tag: 'bar' }))
  segs.push(sp('▰', { color: 'claude', tag: 'bar' }))
  if (cells > cur) segs.push(sp('▱'.repeat(cells - cur), { color: 'inactive', tag: 'bar' }))
  segs.push(sp(' ' + index + '/' + total, { tag: 'kn' }))
  if (m.review_families.length > 0) segs.push(sp(' ·' + m.review_families.length + '族', { tag: 'fam' }))
  return { id: 'unit', segs }
}

export function slotDispatch(live: number, stalled: number): Slot | null {
  if (live <= 0 && stalled <= 0) return null
  const segs: Seg[] = []
  if (live > 0) segs.push(sp('⚙' + live))
  if (stalled > 0) segs.push(sp((segs.length > 0 ? ' ' : '') + '⏸' + stalled, { color: 'error' }))
  return { id: 'dispatch', segs }
}

// `R<n> ⟲` + ` · QC ✓` / ` · QC owed`
export function slotReview(r: ReviewView | null, q: QcView | null): Slot | null {
  const rs = reviewSlot(r)
  const chip = qcChip(q)
  if (rs === null && chip === null) return null
  const segs: Seg[] = []
  if (rs !== null) segs.push(sp(rs))
  if (chip !== null) {
    if (rs !== null) segs.push(sp(' · '))
    segs.push(sp(chip, { color: chip === 'QC ✓' ? 'success' : 'warning' }))
  }
  return { id: 'review', segs }
}

// `◆<proxy>` + ` ?<undocumented>` + ` <rung>`
export function slotDecisions(d: DecisionsView | null): Slot | null {
  if (d === null) return null
  const parts: Seg[] = []
  if (d.count > 0) parts.push(sp('◆' + d.count, { color: 'claude' }))
  if (d.undocumented > 0) parts.push(sp('?' + d.undocumented, { color: 'inactive' }))
  if (d.ladder !== null) parts.push(sp(d.ladder.rung))
  if (parts.length === 0) return null
  return { id: 'decisions', segs: parts.flatMap((p, i) => (i === 0 ? [p] : [sp(' '), p])) }
}

// `$<brain today>/<cap>` (integers); warning from 80 % of the cap, error from 100 %
export function slotSpend(s: { brain: number; cap: number } | null): Slot | null {
  if (s === null) return null
  const ratio = s.brain / s.cap
  return { id: 'spend', segs: [sp('$' + Math.round(s.brain) + '/' + Math.round(s.cap), ratio >= 1 ? { color: 'error' } : ratio >= 0.8 ? { color: 'warning' } : {})] }
}

// hygieneChip text + ` · wt <n>` (reapable worktrees, n > 0 only)
export function slotHygiene(ls: LoadSourceView | null, residue: ResidueView | null): Slot | null {
  const chip = hygieneChip(ls)
  const wt = residue !== null && residue.reapable > 0 ? residue.reapable : 0
  if (chip === null && wt === 0) return null
  const segs: Seg[] = []
  if (chip !== null) segs.push(sp(chip.text, chip.warn ? { color: 'warning' } : {}))
  if (wt > 0) segs.push(sp((chip !== null ? ' · ' : '') + 'wt ' + wt))
  return { id: 'hygiene', segs }
}

export type BandFacts = {
  verdict: { mark: string; word: string; key: ThemeKey }
  marker: MarkerView | null; live: number; stalled: number
  review: ReviewView | null; qc: QcView | null; decisions: DecisionsView | null
  spend: { brain: number; cap: number } | null; loadSource: LoadSourceView | null; residue: ResidueView | null
  nowMs: number
}
// Slots in priority order; an empty slot is left out.
export function bandSlots(f: BandFacts): Slot[] {
  return [
    slotVerdict(f.verdict), slotPosition(f.marker, f.nowMs), slotUnit(f.marker), slotDispatch(f.live, f.stalled),
    slotReview(f.review, f.qc), slotDecisions(f.decisions), slotSpend(f.spend), slotHygiene(f.loadSource, f.residue),
  ].filter((s): s is Slot => s !== null)
}

export const BAND_SEP = ' │ '
export const BAND_ICON = 'ⓘ'
export type BandLayout = { segs: Seg[]; text: string; width: number }

// The width table (contract ②), cumulative: < 160 no hygiene; < 140 also no spend / decisions; < 120 also no ◷ age / review;
// < 80 only verdict, dispatch and the unit bar. Then, if the line still does not fit, the position's stage text is cut with `…`.
// Never the verdict, never the ⓘ. `segs` is everything before the ⓘ button (its separator included); `text` is the whole line.
export function layoutBand(slots: Slot[], columns: number): BandLayout {
  const drop = new Set<string>()
  if (columns < 160) drop.add('hygiene')
  if (columns < 140) { drop.add('spend'); drop.add('decisions') }
  if (columns < 120) { drop.add('review'); drop.add('age') }
  if (columns < 80) { drop.add('position'); drop.add('kn'); drop.add('fam') }
  const kept: Slot[] = slots.filter(s => !drop.has(s.id)).map(s => ({ id: s.id, segs: s.segs.filter(g => g.tag === undefined || !drop.has(g.tag)) }))
  const join = (list: Slot[]): Seg[] => {
    const out: Seg[] = []
    list.forEach((s, i) => {
      if (i > 0) out.push(sp(BAND_SEP, { color: 'subtle' }))
      out.push(...s.segs)
    })
    out.push(sp(BAND_SEP, { color: 'subtle' }))
    return out
  }
  let segs = join(kept)
  const widthOf = (g: Seg[]) => g.reduce((n, x) => n + displayWidth(x.text), 0) + displayWidth(BAND_ICON)
  const over = widthOf(segs) - columns
  if (over > 0) {
    segs = segs.map(g => (g.tag === 'stage' ? { ...g, text: truncateToWidth(g.text, Math.max(2, displayWidth(g.text) - over)) } : g))
  }
  return { segs, text: segs.map(g => g.text).join('') + BAND_ICON, width: widthOf(segs) }
}

// a non-ok snapshot: one dim line `<reason> │ ⓘ`, the reason cut to fit
export function plainBandText(reason: string, columns: number): string {
  return truncateToWidth(reason.replace(/\s*\n\s*/g, ' '), Math.max(1, columns - displayWidth(BAND_SEP) - displayWidth(BAND_ICON)))
}

// ---- the panel's tabs (contract ②): Legend · Now · Graph · Dispatch · Review · Decisions · Spend · Hygiene ----
export const PANE_TABS = ['legend', 'now', 'graph', 'dispatch', 'review', 'decisions', 'spend', 'hygiene'] as const
export type PaneTab = (typeof PANE_TABS)[number]
export const TAB_LABEL: Record<PaneTab, string> = {
  legend: 'Legend', now: 'Now', graph: 'Graph', dispatch: 'Dispatch', review: 'Review', decisions: 'Decisions', spend: 'Spend', hygiene: 'Hygiene',
}

const NO_DATA = (what: string): PaneLine => ({ text: 'no data · ' + what, dim: true })
const seg = (text: string, color?: ThemeKey, bold?: boolean): Seg => ({ text, ...(color === undefined ? {} : { color }), ...(bold ? { bold } : {}) })
const row = (...segs: Seg[]): PaneLine => ({ text: segs.map(s => s.text).join(''), segs })

// Legend: every glyph / indicator of the band with its meaning, in the band's own theme colours.
export function legendLines(): PaneLine[] {
  const l = (glyph: Seg[], meaning: string): PaneLine => row(...glyph, seg('  ' + meaning))
  return [
    { text: '圖例 · what the one-line band shows (left to right; an empty slot is left out)', bold: true },
    l([seg('▲ 要你決定', 'warning', true)], 'a decision or an approval waits for you'),
    l([seg('⏸ 疑似卡住', 'error', true)], 'a dispatch or foreman has gone quiet'),
    l([seg('✓ 完成待驗收', 'success', true)], 'work is done, acceptance is yours'),
    l([seg('● 進行中', 'suggestion', true)], 'something is running'),
    l([seg('◌ 待命', 'inactive')], 'idle: nothing running'),
    l([seg('M!·l5 ▸ '), seg('implement', 'claude'), seg(' ◷3m')], 'size (! = urgent) · level ▸ stage · time in this stage'),
    l([seg('▰▰', 'success'), seg('▰', 'claude'), seg('▱▱', 'inactive'), seg(' 3/5 ·2族')], 'unit bar: done / current / to come · k of N · review families'),
    l([seg('⚙2'), seg(' ⏸1', 'error')], 'live dispatches · stalled dispatches (zero is left out)'),
    l([seg('R2 ⟲'), seg(' · '), seg('QC ✓', 'success'), seg(' / '), seg('QC owed', 'warning')], 'review round · pre-push QC evidence present / owed'),
    l([seg('◆3', 'claude'), seg(' '), seg('?1', 'inactive'), seg(' U2')], 'decided on your behalf · dispatches with no decision record · latest escalation rung'),
    l([seg('$120/150', 'warning')], 'brain-tier spend today / cap · warning from 80 %, error from 100 %'),
    l([seg('dev ↓3'), seg(' · '), seg('wt 2')], 'plugin load source (⚠ = look at it) · reapable worktrees'),
    l([seg('ⓘ')], 'opens this panel'),
    { text: 'narrow terminals drop slots: < 160 hygiene · < 140 spend, decisions · < 120 review, age · < 80 all but verdict, dispatch, unit bar', dim: true },
  ]
}

// Now: where the session is and why the verdict is what it is. The first row (verdict · project · phase · elapsed · progress) is drawn by the pane.
export function nowLines(snap: LiveSnapshot): PaneLine[] {
  const out: PaneLine[] = []
  const d = snap.detail
  if (snap.band !== null && snap.band.reason !== null) out.push({ text: snap.band.reason })
  const pos = slotPosition(d.marker, d.now_ms ?? 0)
  out.push(pos === null ? NO_DATA('no stage recorded for this session') : row(seg('position  '), ...pos.segs))
  const unit = slotUnit(d.marker)
  out.push(unit === null || d.marker === null || d.marker.unit === null
    ? NO_DATA('no unit recorded')
    : row(seg('unit  '), ...unit.segs, seg(d.marker.unit.label === '' ? '' : ' ' + d.marker.unit.label + ' (' + d.marker.unit.kind + ')')))
  out.push(...snap.sections.attention)
  return out
}

// Graph: the D4 walk as `node → node → …`
export function graphLines(w: StageWalkView | null): PaneLine[] {
  if (w === null) return [NO_DATA('no stage walk published for this session')]
  const flags = [w.size, w.urgent ? 'urgent' : null, w.bug ? 'bug' : null, w.high_risk ? 'high-risk' : null, w.units === null ? null : w.units + ' units', w.unit_kind === null ? null : 'unit kind ' + w.unit_kind].filter((x): x is string => x !== null)
  const out: PaneLine[] = [{ text: flags.join(' · ') || '—', bold: true }]
  const at = w.current === null ? -1 : w.walk.indexOf(w.current)
  const segs: Seg[] = []
  w.walk.forEach((n, i) => {
    if (i > 0) segs.push(seg(' → ', 'subtle'))
    const mark = (n === w.entry ? '⊢ ' : '') + n + (n === w.terminal ? ' ⊣' : '')
    segs.push(i === at ? seg(mark, 'claude', true) : seg(mark, at >= 0 && i < at ? 'success' : 'subtle'))
  })
  out.push(row(...segs))
  out.push({ text: 'entry ' + (w.entry ?? '—') + ' · terminal ' + (w.terminal ?? '—') + ' · now ' + (w.current ?? '—') + (w.current !== null && at < 0 ? ' (not on this walk)' : ''), dim: true })
  return out
}

const shortSha = (s: string | null): string => (s === null ? '—' : s.slice(0, 8))

// Review tab, QC part: the pre-push qc-gate fact
export function qcLines(q: QcView | null): PaneLine[] {
  if (q === null) return [NO_DATA('no QC status published')]
  return [{ text: 'QC · ' + q.state + ' · range ' + (q.range === null ? '—' : q.range.split('..').map(shortSha).join('..')) + ' · ' + q.protected_files_count + ' protected file(s) · evidence ' + (q.evidence ?? '—'), bold: q.state === 'owed', warn: q.state === 'owed' }]
}

// Decisions tab: proxy decisions (the sections' rows), undocumented dispatches, the latest ladder rung + when
export function decisionsTabLines(snap: LiveSnapshot): PaneLine[] {
  const d = snap.detail
  const out: PaneLine[] = []
  if (d.decisions === null && snap.sections.decisions.length === 0) return [NO_DATA('no decisions sidecar published')]
  out.push(...snap.sections.decisions)
  if (d.decisions !== null && d.decisions.count === 0) out.push({ text: 'no decision made on your behalf', dim: true })
  if (d.decisions !== null) {
    const ago = d.decisions.ladder !== null && d.now_ms !== null ? ' · ' + ageText((d.now_ms - Date.parse(d.decisions.ladder.at)) / 1000) + ' ago' : ''
    out.push(d.decisions.ladder === null ? NO_DATA('no escalation rung recorded') : { text: 'ladder · ' + d.decisions.ladder.rung + ' · ' + d.decisions.ladder.at + ago })
  }
  return out
}

// Spend tab
export function spendLines(snap: LiveSnapshot): PaneLine[] {
  const s = snap.detail.spend
  if (s === null) return [NO_DATA('no spend published')]
  const out: PaneLine[] = [{ text: 'session ' + s.session, bold: true }, { text: 'host today (all tiers) ' + s.host_all }]
  if (s.brain === null || s.cap === null) out.push(NO_DATA('brain-tier spend today is not published'))
  else {
    const pct = Math.round((s.brain / s.cap) * 100)
    out.push({ text: 'host today (brain tier) ' + usd(s.brain) + ' / ' + usd(s.cap) + ' · ' + pct + ' %', warn: pct >= 80, bold: pct >= 100 })
  }
  out.push({ text: 'cost fuse · ' + s.mode, dim: true })
  return out
}

// Hygiene tab: load source detail + reapable worktree residue
export function hygieneLines(ls: LoadSourceView | null, residue: ResidueView | null): PaneLine[] {
  const out: PaneLine[] = []
  if (ls === null) out.push(NO_DATA('no load source published'))
  else {
    const chip = hygieneChip(ls)
    out.push({ text: 'load source · ' + (chip === null ? '—' : chip.text), bold: true, warn: chip !== null && chip.warn })
    out.push({ text: '  plugin ' + (ls.plugin_version ?? '—') + ' · source ' + loadSourceFor(ls, null) + ' · marketplace ' + ls.marketplace + ' · behind upstream ' + (ls.behind_upstream === null ? '—' : ls.behind_upstream) })
    if (ls.flags.length > 0) out.push({ text: '  flags ' + ls.flags.join(', '), warn: true })
    for (const dir of ls.stale_cache_dirs) out.push({ text: '  cache dir ' + dir.dir + ' · in use by ' + (dir.in_use_pids.join(', ') || '—') + ' · alive ' + (dir.alive.join(', ') || '—'), dim: true })
  }
  if (residue === null) out.push(NO_DATA('no worktree residue published'))
  else {
    out.push({ text: 'reapable worktrees · ' + residue.reapable, bold: residue.reapable > 0 })
    const classes = Object.keys(residue.by_class).sort()
    out.push(classes.length === 0 ? { text: '  no residue classes', dim: true } : { text: '  ' + classes.map(c => c + ' ' + residue.by_class[c]).join(' · '), dim: true })
  }
  return out
}
