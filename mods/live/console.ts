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
export type ConsoleItem = { id: string; kind: 'card' | 'exception' | 'hint' | 'quota'; severity: number; state: string; needs_operator: boolean; title: string; text: string; since_ms: number; line_id: string | null; to_console: boolean | null; answerable_by: string[] }
export type ConsoleCard = { id: string; question: string; status: 'open' | 'awaiting_operator_action' | 'waiting_step' | 'relayed_unconfirmed'; opened_at_ms: number; executor_display: string | null }
export type ConsoleIssue = { rule: string; state: string; subject: string; since_ms: number; to_console: boolean }
export type ConsoleLine = { line_id: string; label: string; lead_display: string | null; issues: ConsoleIssue[] }
export type ConsoleSnapshot = { generated_at_ms: number; sources: Record<string, { at_ms: number | null; state: ConsoleSourceState }>; counts: { decisions: number; exceptions: number; quota_risk: number; tabs: Record<string, [string, number][]>; summary: { lines: Record<string, number>; hosts: Record<string, number>; hints: number; quota_worst: string | null } }; items: ConsoleItem[]; cards: ConsoleCard[] | null; lines: ConsoleLine[] | null }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const n = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const b = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

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
  const line_id: unknown = v.line_id
  if (line_id !== null && typeof line_id !== 'string') return null
  const answerable_by: unknown = v.answerable_by
  if (answerable_by !== undefined && !Array.isArray(answerable_by)) return null
  return {
    id, kind: kind as ConsoleItem['kind'], severity, state, needs_operator, title, text, since_ms, line_id,
    to_console: b(v.to_console),
    answerable_by: Array.isArray(answerable_by) ? answerable_by.filter((x): x is string => typeof x === 'string') : [],
  }
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
    items: itemsIn.map(v => (isObj(v) ? parseItem(v) : null)).filter((x): x is ConsoleItem => x !== null),
    cards: cardsIn === null ? null : cardsIn.map(v => (isObj(v) ? parseCard(v) : null)).filter((x): x is ConsoleCard => x !== null),
    lines: linesIn === null ? null : linesIn.map(v => (isObj(v) ? parseLine(v) : null)).filter((x): x is ConsoleLine => x !== null),
  }
}

// the repo config .claude/console.json: true only for an object whose schema is exactly autopilot.console/1 and whose mode is exactly program
export function consoleModeOf(text: string | null): boolean {
  if (text === null) return false
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return false }
  if (!isObj(raw)) return false
  return s(raw.schema) === 'autopilot.console/1' && s(raw.mode) === 'program'
}

// the mode of the session's repo: walk up from `cwd` to the FIRST directory that holds a `.git` (a directory with HEAD, or a gitfile) and read that repo's `.claude/console.json`; a parent repo's file is never
// borrowed. The mod cannot run git, so `readText` is the caller's file reader (null = absent or unreadable). false for no repo, no file, broken JSON, a foreign schema and any mode but program.
export async function findConsoleMode(cwd: string, readText: (path: string) => Promise<string | null>): Promise<boolean> {
  let dir = cwd
  for (let i = 0; i < 16 && dir !== ''; i++) {
    if ((await readText(dir + '/.git/HEAD')) !== null || (await readText(dir + '/.git')) !== null) return consoleModeOf(await readText(dir + '/.claude/console.json'))
    const cut = dir.lastIndexOf('/')
    if (cut <= 0) break
    dir = dir.slice(0, cut)
  }
  return false
}
