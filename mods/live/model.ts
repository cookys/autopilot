// mods/live/model.ts — pure helpers for the live mod (plan P1c). No `$` in here: every file read, every clock
// read and every UI call stays in register.ts. Nothing in this file derives a number the producer already
// published: counts, cost, context, the progress numbers and the decision are copied from the envelope / context
// file / job model. The selections made here: the verdict word (a precedence over fields the producers already
// published), the project short name, the earliest start and the quietest stalled run.


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

export type LiveDecision = { question: string; options: { label: string; consequence: string }[] }

// The two band lines of an ok snapshot. `verdict` null = none of the four words applies (nothing live, nothing
// awaited): the band then says project / phase / elapsed / progress without a word.
export type BandView = {
  mark: string
  verdict: string | null
  head: string // "<project> · <phase> · <elapsed> · " (the progress follows it)
  progress: string
  progressDim: boolean // an unfrozen denominator is drawn dim
  reason: string | null
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
  published_at: string | null
  session_as_of: string | null
  host_as_of: string | null
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

const VERDICT = {
  decide: { mark: '▲', word: '要你決定' },
  stalled: { mark: '⏸', word: '疑似卡住' },
  waiting: { mark: '✓', word: '完成待驗收' },
  running: { mark: '●', word: '進行中' },
} as const
const NO_VERDICT_MARK = '○'

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

// "38m" / "2h14m" / "1d3h": now minus the earliest start among the scope's runs; none -> an em dash.
export function elapsedText(env: Json, nowMs: number): string {
  let earliest = Infinity
  for (const r of rowsOf(env) || []) {
    const ms = Date.parse(String(r.started_at || ''))
    if (Number.isFinite(ms) && ms < earliest) earliest = ms
  }
  if (earliest === Infinity || !Number.isFinite(nowMs) || nowMs < earliest) return '—'
  const minutes = Math.floor((nowMs - earliest) / 60000)
  if (minutes < 60) return minutes + 'm'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + 'h' + (minutes % 60) + 'm'
  return Math.floor(hours / 24) + 'd' + (hours % 24) + 'h'
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

// Precedence: 1 needs a decision, 2 stalled, 3 complete and waiting acceptance, 4 running. None of them: no word.
export function bandView(env: Json, jobModel: JobModel | null, projectKey: string, nowMs: number): BandView {
  const counts = countsOf(env)
  const progress = jobModel === null ? null : jobModel.progress
  const stalled = stalledReason(env)
  const waiting = counts !== null && counts.confirmed_live === 0 && progress !== null && progress.frozen
    && progress.done !== null && progress.total !== null && progress.done === progress.total
    && jobModel !== null && jobModel.acceptance !== 'accepted' && jobModel.acceptance !== 'rejected'
  let pick: { mark: string; word: string } | null = null
  let reason: string | null = null
  if (jobModel !== null && jobModel.needs_decision) {
    pick = VERDICT.decide
    reason = jobModel.decision !== null ? jobModel.decision.question : (jobModel.conclusion || '等你決定')
  } else if (stalled !== null) {
    pick = VERDICT.stalled
    reason = stalled
  } else if (waiting) {
    pick = VERDICT.waiting
    reason = '驗收結論尚未出'
  } else if (counts !== null && counts.confirmed_live > 0) {
    pick = VERDICT.running
    reason = counts.confirmed_live + ' 個派工在跑'
  }
  const identity = isObject(env.scope) ? env.scope.repo_identity : null
  // the phase is a human phase of the job, and the job model publishes none: an em dash, never the process phase
  const phase = '—'
  const prog = progressView(progress)
  return {
    mark: pick === null ? NO_VERDICT_MARK : pick.mark,
    verdict: pick === null ? null : pick.word,
    head: projectName(identity, projectKey) + ' · ' + phase + ' · ' + elapsedText(env, nowMs) + ' · ',
    progress: prog.text,
    progressDim: prog.dim,
    reason,
  }
}

export function bandLine1(v: BandView): string {
  return v.mark + ' ' + (v.verdict === null ? '' : v.verdict + ' ') + v.head + v.progress
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
}

// The job page's model.json (review-job-model/1): acceptance axis, gate rows, the decision awaited and the progress
// numbers. Absent / malformed -> null. `needs_decision` is true only when the model says exactly true.
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
  return { acceptance, gates, needs_decision: m.needs_decision === true, conclusion: typeof m.conclusion === 'string' && m.conclusion ? m.conclusion : null, decision, progress }
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
