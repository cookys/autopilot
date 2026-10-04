// mods/live/model.ts — pure helpers for the live mod (plan P1c). No `$` in here: every file read, every clock
// read and every UI call stays in register.ts. Nothing in this file derives a number the producer already
// published: counts, cost and context are copied from the envelope / context file; the only selections made
// here are "oldest", "last rc" and the stalled tally the plan asks the band to show.


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

export type LiveSnapshot = {
  // ok | stale | unavailable | unreadable | no-pointer | no-project
  state: 'ok' | 'stale' | 'unavailable' | 'unreadable' | 'no-pointer' | 'no-project'
  // the exact band text
  text: string
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

export function runningText(env: Json): string {
  const c = isObject(env.counts) ? env.counts.confirmed_live : undefined
  return Number.isInteger(c) ? String(c) : '—'
}

// "oldest" = the earliest start among the rows the envelope itself would call confirmed-live (same predicate as the
// producer's counts: alive, probed within its own fresh_bound_s, no end state). No such row -> an em dash.
export function oldestText(env: Json): string {
  const rows = rowsOf(env)
  const bound = isObject(env.counts) && finite(env.counts.fresh_bound_s) ? env.counts.fresh_bound_s : null
  if (rows === null || bound === null) return '—'
  let oldest = Infinity
  for (const r of rows) {
    const live = r.alive === true && finite(r.probe_age_s) && r.probe_age_s <= bound
    const ended = r.phase === 'exited' || Boolean(r.ended_at) || Boolean(r.final_status)
    const ms = startedMs(r)
    if (live && !ended && Number.isFinite(ms) && ms < oldest) oldest = ms
  }
  return oldest === Infinity ? '—' : hhmm(oldest)
}

export function stalledText(env: Json): string {
  const rows = rowsOf(env)
  return rows === null ? '—' : String(rows.filter(r => r.stall === true).length)
}

// last rc = the rc of the most recently dated row that has an integer rc; none -> "unknown" (never 0).
export function lastRcText(env: Json): string {
  const rows = rowsOf(env)
  if (rows === null) return 'unknown'
  let best: { ms: number; rc: number } | null = null
  for (const r of rows) {
    if (!Number.isInteger(r.rc)) continue
    const ms = Date.parse(String(r.fact_at || r.ended_at || r.started_at || ''))
    const at = Number.isFinite(ms) ? ms : -Infinity
    if (best === null || at >= best.ms) best = { ms: at, rc: r.rc as number }
  }
  return best === null ? 'unknown' : String(best.rc)
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

export function bandText(env: Json, sid: string, ctx: string): string {
  const session = sessionUsd(env, sid)
  return [
    'running ' + runningText(env),
    'oldest ' + oldestText(env),
    'stalled ' + stalledText(env) + ' (telemetry)',
    'last rc ' + lastRcText(env),
    session.text + ' / host ' + usd(env.host_today_usd),
    'ctx ' + ctx,
  ].join(' · ')
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

// The job page's model.json (review-job-model/1): acceptance axis + gate rows. Absent / malformed -> null.
export function readJobModel(text: string | null): { acceptance: string; gates: LiveGateRow[] } | null {
  if (text === null) return null
  const parsed = parseJson(text)
  if (!parsed.ok || !isObject(parsed.value) || parsed.value.schema !== MODEL_SCHEMA || !isObject(parsed.value.axes)) return null
  const raw = parsed.value.axes.acceptance
  const acceptance = raw === 'accepted' || raw === 'rejected' ? raw : 'unknown'
  const gates = (Array.isArray(parsed.value.gates) ? parsed.value.gates : []).filter(isObject).map(g => ({
    phase: typeof g.phase === 'string' ? g.phase : null,
    generation: Number.isInteger(g.generation) ? (g.generation as number) : null,
    verdict: typeof g.verdict === 'string' ? g.verdict : null,
    status: typeof g.status === 'string' ? g.status : null,
  }))
  return { acceptance, gates }
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
