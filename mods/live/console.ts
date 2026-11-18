// mods/live/console.ts — the operator-console snapshot half: the `fleet.console/1` schema the live pane reads from the fleet feed,
// parsed as UNTRUSTED input, plus the reader for the repo config `.claude/console.json` (`autopilot.console/1`). No UI, no rendering,
// no engine value in here: the pane will draw from the parsed result, never from the raw text. Zero refresh cost by design — parseConsole
// and consoleModeOf are pure functions of their input string; every number they return comes from the feed, and nothing is stored.
// Syntax is erasable (types plus plain functions only, no imports), so `node` strips the types and imports this file directly.
// Trust boundary: parseConsole never throws — it returns null for a broken or foreign snapshot and drops any item, card, line or issue
// with a wrong-typed required field. Nullable fields stay null when absent: an unassigned line's lead_display, a no_source source's
// at_ms, an item's to_console; counts get quota_risk 0 and summary.quota_worst null when absent. It copies only the declared fields,
// so an extra field holding a raw member address or a host ip is
// never carried into the result (fixtures/console/leak.json plants both; console.test.js pins their absence from the parse result).

export type ConsoleSourceState = 'ok' | 'stale' | 'expired' | 'no_source'
// the facts a page may read (a closed list: an extra key, such as a raw member address in a patrol item, is left behind); values are strings, numbers or booleans only
export const FACT_KEYS = ['seat', 'pool', 'resets_at', 'source', 'window', 'resets_at_text', 'stale', 'pct', 'projected', 'exhaust_h'] as const
export type ConsoleFacts = Record<string, string | number | boolean>
export type ConsoleItem = { id: string; kind: 'card' | 'exception' | 'hint' | 'quota' | 'seat_blocked'; severity: number; state: string; needs_operator: boolean; title: string; text: string; since_ms: number; line_id: string | null; to_console: boolean | null; answerable_by: string[]; facts: ConsoleFacts }
export type ConsoleCard = { id: string; question: string; status: 'open' | 'awaiting_operator_action' | 'waiting_step' | 'relayed_unconfirmed'; opened_at_ms: number; executor_display: string | null }
export type ConsoleIssue = { rule: string; state: string; subject: string; since_ms: number; to_console: boolean }
export type ConsoleLine = { line_id: string; label: string; lead_display: string | null; issues: ConsoleIssue[] }
export type ConsoleSnapshot = { generated_at_ms: number; sources: Record<string, { at_ms: number | null; state: ConsoleSourceState }>; counts: { decisions: number; exceptions: number; quota_risk: number; tabs: Record<string, [string, number][]>; summary: { lines: Record<string, number>; hosts: Record<string, number>; hints: number; quota_worst: string | null } }; items: ConsoleItem[]; quota: ConsoleQuota; cards: ConsoleCard[] | null; lines: ConsoleLine[] | null }

// one element of `quota.pools[]` (fleet 01M7N4EK); a field the feed lacks is null, never 0
export type QuotaPool = {
  pool: string; seven_day_pct: number | null; five_hour_pct: number | null; resets_at_ms: number | null; burn_pct_per_h: number | null; burn_window_h: number | null
  projected_pct_at_reset: number | null; projected_exhaustion_at_ms: number | null; verdict: string | null; limit_hit: boolean | null; stale: boolean | null; stale_age_min: number | null
  stale_note: string | null; observed_at_ms: number | null; stranded_seats: number | null; stranded_seat_list: string[] | null; switched: string | boolean | null; seats: number | null
  projection_source: string | null; switch_suggestion: string | null
}
export type QuotaSeat = { seat: string; pool: string; seven_day_pct: number | null; five_hour_pct: number | null; stale: boolean | null; age_min: number | null }
// pools null = the feed has no quota.pools (no source); [] = the feed says there is no pool
export type ConsoleQuota = { pools: QuotaPool[] | null; seats: QuotaSeat[] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const n = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const b = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// each element parser: null on a missing or wrong-typed required field; the nullable fields accept an explicit null
function parseItem(v: Obj): ConsoleItem | null {
  const id = s(v.id)
  const kind = s(v.kind)
  const severity = n(v.severity)
  const state = s(v.state)
  const needs_operator = b(v.needs_operator)
  const title = s(v.title)
  const text = s(v.text)
  const since_ms = n(v.since_ms)
  if (id === null || kind === null || severity === null || state === null || needs_operator === null || title === null || text === null || since_ms === null) return null
  const lineIn: unknown = v.line_id
  if (lineIn !== undefined && lineIn !== null && typeof lineIn !== 'string') return null // absent = null (the real feed omits it); a present non-string is refused
  const line_id: string | null = typeof lineIn === 'string' ? lineIn : null
  const answerable_by: unknown = v.answerable_by
  if (answerable_by !== undefined && !Array.isArray(answerable_by)) return null
  return {
    id, kind: kind as ConsoleItem['kind'], severity, state, needs_operator, title, text, since_ms, line_id,
    to_console: b(v.to_console),
    facts: parseFacts(v.facts),
    answerable_by: Array.isArray(answerable_by) ? answerable_by.filter((x): x is string => typeof x === 'string') : [],
  }
}

function parseFacts(v: unknown): ConsoleFacts {
  const out: ConsoleFacts = {}
  if (!isObj(v)) return out
  for (const k of FACT_KEYS) { const x = v[k]; if (typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))) out[k] = x }
  return out
}

function parsePool(v: unknown): QuotaPool | null {
  if (!isObj(v)) return null
  const pool = s(v.pool)
  if (pool === null) return null
  const list = Array.isArray(v.stranded_seat_list) ? v.stranded_seat_list.filter((x): x is string => typeof x === 'string') : null
  const sw = v.switched
  return {
    pool, seven_day_pct: fin(v.seven_day_pct), five_hour_pct: fin(v.five_hour_pct), resets_at_ms: fin(v.resets_at_ms), burn_pct_per_h: fin(v.burn_pct_per_h),
    burn_window_h: fin(v.burn_window_h), projected_pct_at_reset: fin(v.projected_pct_at_reset), projected_exhaustion_at_ms: fin(v.projected_exhaustion_at_ms), verdict: s(v.verdict),
    limit_hit: b(v.limit_hit), stale: b(v.stale), stale_age_min: fin(v.stale_age_min), stale_note: s(v.stale_note), observed_at_ms: fin(v.observed_at_ms),
    stranded_seats: fin(v.stranded_seats), stranded_seat_list: list, switched: typeof sw === 'string' || typeof sw === 'boolean' ? sw : null, seats: fin(v.seats),
    projection_source: s(v.projection_source), switch_suggestion: s(v.switch_suggestion),
  }
}

function parseSeat(v: unknown): QuotaSeat | null {
  if (!isObj(v)) return null
  const seat = s(v.seat)
  const pool = s(v.pool)
  return seat === null || pool === null ? null : { seat, pool, seven_day_pct: fin(v.seven_day_pct), five_hour_pct: fin(v.five_hour_pct), stale: b(v.stale), age_min: fin(v.age_min) }
}

function parseQuota(v: unknown): ConsoleQuota {
  if (!isObj(v) || !Array.isArray(v.pools)) return { pools: null, seats: [] }
  return { pools: v.pools.map(parsePool).filter((p): p is QuotaPool => p !== null), seats: Array.isArray(v.seats) ? v.seats.map(parseSeat).filter((x): x is QuotaSeat => x !== null) : [] }
}

const CARD_ID = /^d-[0-9a-f]{8}$/
function parseCard(v: Obj): ConsoleCard | null {
  const id = s(v.id)
  const question = s(v.question)
  const status = s(v.status)
  const opened_at_ms = n(v.opened_at_ms)
  if (id === null || question === null || status === null || opened_at_ms === null) return null
  if (!CARD_ID.test(id)) return null // the id reaches the prompt box (a fill: press) and the shell; only the decision card id form crosses the trust boundary
  const executor_display: unknown = v.executor_display
  if (executor_display !== null && typeof executor_display !== 'string') return null
  return { id, question, status: status as ConsoleCard['status'], opened_at_ms, executor_display }
}

function parseIssue(v: Obj): ConsoleIssue | null {
  const rule = s(v.rule)
  const state = s(v.state)
  const subject = s(v.subject)
  const since_ms = n(v.since_ms)
  const to_console = b(v.to_console)
  if (rule === null || state === null || subject === null || since_ms === null || to_console === null) return null
  return { rule, state, subject, since_ms, to_console }
}

function parseLine(v: Obj): ConsoleLine | null {
  const line_id = s(v.line_id)
  const label = s(v.label)
  if (line_id === null || label === null) return null
  const lead_display = s(v.lead_display)
  const issues = Array.isArray(v.issues) ? v.issues.map(x => (isObj(x) ? parseIssue(x) : null)).filter((x): x is ConsoleIssue => x !== null) : []
  return { line_id, label, lead_display, issues }
}

// a source is kept whenever its state is one of the four states; at_ms is absent on a no_source entry, so it is nullable
function parseSource(v: unknown): { at_ms: number | null; state: ConsoleSourceState } | null {
  if (!isObj(v)) return null
  const state = s(v.state)
  if (state === null || !(['ok', 'stale', 'expired', 'no_source'] as string[]).includes(state)) return null
  return { at_ms: n(v.at_ms), state: state as ConsoleSourceState }
}

function parseCountMap(v: unknown): Record<string, number> {
  if (!isObj(v)) return {}
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v)) { const nv = n(val); if (nv !== null) out[k] = nv }
  return out
}

function parseTabs(v: unknown): Record<string, [string, number][]> {
  if (!isObj(v)) return {}
  const out: Record<string, [string, number][]> = {}
  for (const [k, val] of Object.entries(v)) {
    if (!Array.isArray(val)) { out[k] = []; continue }
    const pairs: [string, number][] = []
    for (const p of val) if (Array.isArray(p) && p.length === 2) { const a = s(p[0]); const c = n(p[1]); if (a !== null && c !== null) pairs.push([a, c]) }
    out[k] = pairs
  }
  return out
}

function parseCounts(v: Obj): ConsoleSnapshot['counts'] {
  const sum = isObj(v.summary) ? v.summary : {}
  const hints = n(sum.hints)
  return {
    decisions: n(v.decisions) ?? 0,
    exceptions: n(v.exceptions) ?? 0,
    quota_risk: n(v.quota_risk) ?? 0,
    tabs: parseTabs(v.tabs),
    summary: { lines: parseCountMap(sum.lines), hosts: parseCountMap(sum.hosts), hints: hints ?? 0, quota_worst: s(sum.quota_worst) },
  }
}

// the untrusted snapshot: null (never an exception) when the text is not JSON, the schema is foreign, counts is missing or not an
// object, or items is not an array; otherwise the declared fields are copied and everything else is left behind
export function parseConsole(text: string): ConsoleSnapshot | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  if (!isObj(raw)) return null
  if (s(raw.schema) !== 'fleet.console/1') return null
  const counts = raw.counts
  if (!isObj(counts)) return null
  const itemsIn = raw.items
  if (!Array.isArray(itemsIn)) return null
  const sourcesIn = isObj(raw.sources) ? raw.sources : {}
  const sources: ConsoleSnapshot['sources'] = {}
  for (const [k, val] of Object.entries(sourcesIn)) { const src = parseSource(val); if (src !== null) sources[k] = src }
  const cardsIn = Array.isArray(raw.cards) ? raw.cards : null // null = the key is missing (no source); [] = the feed says no card is open
  const linesIn = Array.isArray(raw.lines) ? raw.lines : null // null = the key is missing (no source); [] = the feed says there is no lane
  const generated_at_ms = n(raw.generated_at_ms)
  return {
    generated_at_ms: generated_at_ms ?? 0,
    sources,
    counts: parseCounts(counts),
    quota: parseQuota(raw.quota),
    items: itemsIn.map(v => (isObj(v) ? parseItem(v) : null)).filter((x): x is ConsoleItem => x !== null),
    cards: cardsIn === null ? null : cardsIn.map(v => (isObj(v) ? parseCard(v) : null)).filter((x): x is ConsoleCard => x !== null),
    lines: linesIn === null ? null : linesIn.map(v => (isObj(v) ? parseLine(v) : null)).filter((x): x is ConsoleLine => x !== null),
  }
}

export const INGEST_FROM_TOKEN = /^[a-z0-9._-]+\/[a-z0-9._-]+\/[a-z0-9._-]+=[a-z]+$/
export type ConsoleConfig = { on: boolean; ingestFrom: string | null }

export function parseIngestFrom(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const kept = v.split(/\s+/).filter(tok => INGEST_FROM_TOKEN.test(tok))
  return kept.length > 0 ? kept.join(' ') : null
}

// the repo config .claude/console.json: on only for an object whose schema is exactly autopilot.console/1 and whose mode is exactly program;
// optional ingest_from ("<address>=pace ...") keeps only tokens matching ^[a-z0-9._-]+/[a-z0-9._-]+/[a-z0-9._-]+=[a-z]+$ (joined by ' '; null when absent or none match)
export function consoleConfigOf(text: string | null): ConsoleConfig {
  if (text === null) return { on: false, ingestFrom: null }
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return { on: false, ingestFrom: null } }
  if (!isObj(raw)) return { on: false, ingestFrom: null }
  if (s(raw.schema) !== 'autopilot.console/1' || s(raw.mode) !== 'program') return { on: false, ingestFrom: null }
  return { on: true, ingestFrom: parseIngestFrom(raw.ingest_from) }
}

export function consoleModeOf(text: string | null): boolean {
  return consoleConfigOf(text).on
}

// the config of the session's repo: walk up from `cwd` to the FIRST directory that holds a `.git` (a directory with HEAD, or a gitfile) and read that repo's `.claude/console.json`; a parent repo's file is never
// borrowed. The mod cannot run git, so `readText` is the caller's file reader (null = absent or unreadable). on is false (ingestFrom null) for no repo, no file, broken JSON, a foreign schema and any mode but program.
export async function findConsoleConfig(cwd: string, readText: (path: string) => Promise<string | null>): Promise<ConsoleConfig> {
  let dir = cwd
  for (let i = 0; i < 16 && dir !== ''; i++) {
    if ((await readText(dir + '/.git/HEAD')) !== null || (await readText(dir + '/.git')) !== null) return consoleConfigOf(await readText(dir + '/.claude/console.json'))
    const cut = dir.lastIndexOf('/')
    if (cut <= 0) break
    dir = dir.slice(0, cut)
  }
  return { on: false, ingestFrom: null }
}

export async function findConsoleMode(cwd: string, readText: (path: string) => Promise<string | null>): Promise<boolean> {
  return (await findConsoleConfig(cwd, readText)).on
}
