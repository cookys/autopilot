// mods/live/v74/contract.ts — ux-v7.4 data and key contract (PM task 01M7N307). The six v7.4 sub-tasks code against these types only.
// Sources not live yet (fleet.pm.status v1 before the fleet rollout, the todo source) are read from fixtures/v74/*.json through the same parsers.
// Pure: no I/O here. The feeds (who runs `fleet pm status --json` / `fleet decision list --json`) live in register.ts and fill PageCtx.v74.

// ---- fleet.pm.status v1 (fleet docs/pm-status-json.md, integ/1120-pmsys ae8aab65). Readers ignore unknown fields. ----
export type PmCounts = { stuck: number | null; overdue: number | null; running: number | null; waiting: number | null; total: number | null } // null = the producer did not publish that count (unknown, never 0)
export type PmTask = {
  id: string; short_id: string; title: string; state: string; owner: string
  last_progress_at_ms: number | null; last_progress: string | null; next_evidence_due_ms: number | null
  waiting_on: string | null; overdue: boolean; stuck: boolean
}
export type PmProject = { project: string; root_id: string | null; counts: PmCounts; tasks: PmTask[] }
export type PmStatus = { schema: 'fleet.pm.status'; schema_version: 1; generated_at_ms: number; selector: string | null; projects: PmProject[] }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const intOrNull = (v: unknown): number | null => (isInt(v) ? v : null)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// Trust boundary: the JSON comes from another program. Returns null (source broken) on a wrong schema, a newer schema_version, an error object, or bad JSON.
export function parsePmStatus(json: string): PmStatus | null {
  let o: unknown
  try { o = JSON.parse(json) } catch { return null }
  if (typeof o !== 'object' || o === null) return null
  const r = o as Record<string, unknown>
  if (r.schema !== 'fleet.pm.status' || r.schema_version !== 1 || r.error !== undefined || !isInt(r.generated_at_ms) || !Array.isArray(r.projects)) return null
  const projects: PmProject[] = []
  for (const p of r.projects as unknown[]) {
    if (typeof p !== 'object' || p === null) continue
    const q = p as Record<string, unknown>
    const c = (q.counts ?? {}) as Record<string, unknown>
    const counts: PmCounts = { stuck: intOrNull(c.stuck), overdue: intOrNull(c.overdue), running: intOrNull(c.running), waiting: intOrNull(c.waiting), total: intOrNull(c.total) }
    const tasks: PmTask[] = (Array.isArray(q.tasks) ? q.tasks : []).filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null && typeof (t as Record<string, unknown>).id === 'string').map(t => ({
      id: str(t.id), short_id: str(t.short_id) || str(t.id), title: str(t.title), state: str(t.state) || '?', owner: str(t.owner),
      last_progress_at_ms: intOrNull(t.last_progress_at_ms), last_progress: strOrNull(t.last_progress), next_evidence_due_ms: intOrNull(t.next_evidence_due_ms),
      waiting_on: strOrNull(t.waiting_on), overdue: t.overdue === true, stuck: t.stuck === true,
    }))
    projects.push({ project: str(q.project), root_id: strOrNull(q.root_id), counts, tasks })
  }
  return { schema: 'fleet.pm.status', schema_version: 1, generated_at_ms: r.generated_at_ms as number, selector: strOrNull(r.selector), projects }
}

// The 全艦隊 block of 現況 (S2). fleet.pm.status has no host count, no offline/idle line state and no quota pools:
// lines = projects; ✗ = a project with stuck > 0 or overdue > 0; ⊘ = only waiting; ◉ = the rest. Hosts and quota alerts keep their existing sources (console / quota) and are omitted when those are missing.
export type FleetLineMark = 'fail' | 'parked' | 'ok' | 'unknown'
export type FleetLine = { project: string; mark: FleetLineMark; counts: PmCounts }
export function fleetLines(s: PmStatus): FleetLine[] {
  const mark = (c: PmCounts): FleetLineMark => ((c.stuck ?? 0) > 0 || (c.overdue ?? 0) > 0 ? 'fail' : c.stuck === null || c.overdue === null || c.running === null || c.waiting === null ? 'unknown' : c.waiting > 0 && c.running === 0 ? 'parked' : 'ok')
  const rank: Record<FleetLineMark, number> = { fail: 0, unknown: 1, parked: 2, ok: 3 }
  return s.projects.map(p => ({ project: p.project, mark: mark(p.counts), counts: p.counts })).sort((a, b) => rank[a.mark] - rank[b.mark]) // stable: keeps the fleet order inside a mark
}

// ---- decision cards (待決 S3) and todo cards (待辦 S9) ----
import type { DurableAwaiting } from '../model'
export type CardOption = { label: string; detail: string; recommended: boolean }
export type DecideCard = { id: string; title: string; question: string; background: string | null; options: CardOption[] }
export type TodoCard = { id: string; title: string; dueMs: number | null; question: string; options: CardOption[] } // source not live: fixtures/v74/todo.json
// The decision list names the set-aside answer `待辦` (option c) in its own option list. It only works when a todo source exists to take the card, so a draw with no todo source drops it (r11 #1): no row, and `c` picks nothing.
export const isTodoOption = (o: CardOption): boolean => ['待辦', 'todo'].includes(o.label.trim().toLowerCase())
export function offerTodo(cards: DecideCard[] | null, todo: TodoCard[] | null): DecideCard[] | null {
  if (cards === null || todo !== null) return cards
  return cards.map(c => { const keep = c.options.filter(o => !isTodoOption(o)); return keep.length === 0 || keep.length === c.options.length ? c : { ...c, options: keep } })
}
export type CardNav = { cursor: number; picks: Record<string, number>; notes: Record<string, string>; noteMode: boolean } // picks/notes keyed by card id; only the card at cursor draws its options as buttons

// ---- v7.4 page order and keys (sub-task B owns keys.ts / layout.ts / index.ts; everyone else reads this) ----
export const V74_PAGES = ['now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'fleet', 'todo', 'help'] as const // keys 1..9; quota folds into spend (S6)
export type V74PageId = (typeof V74_PAGES)[number]
export const V74_KEY: Record<V74PageId, string> = { now: '1', decide: '2', dispatch: '3', review: '4', spend: '5', hygiene: '6', fleet: '7', todo: '8', help: '9' }
export const PET_KEY = '0' // the pet keeps its own tab (operator rule, PM 01M78CB6); drawn after 9 when the width allows
// Digits only switch pages. Letters act on 待決/待辦 only: a/b/c pick for the card at the cursor, m note (待決), s send all (待決). ↑↓ (j/k) move the card cursor on 待決/待辦 and scroll elsewhere; Enter folds the section at the cursor unless a Button has focus.
export const PICK_KEYS = ['a', 'b', 'c'] as const

// Operator rule R6: the pick key follows the option's own letter, not its position — pressing a always picks the option labelled A.
// An option whose label starts with a single ASCII letter (A-Z or a-z) followed by a space, ':', '.', ')', '）', '、' or the end of
// the label claims that letter (lower case). The claims are honoured only while every claim on the card is unique, names a key the
// pick handler already accepts (PICK_KEYS), and no non-lettered option's positional key is stolen by a claim; any other card (a
// duplicate, a letter the handler cannot take, a collision) falls back to the positional keys wholesale — today's behaviour.
// One key per option ('' = the pick handler does not reach that option). The drawn `x:` prefix and the `press` of the same option
// must come from one call, so the letter shown is the letter that picks.
const PICK_LETTER = /^([A-Za-z])(?:[ :.:)）、]|$)/
export const pickKeys = (options: { label: string }[]): string[] => {
  const n = Math.min(options.length, PICK_KEYS.length)
  const letter = (i: number): string | null => (i >= n ? null : PICK_LETTER.exec(options[i].label)?.[1]?.toLowerCase() ?? null)
  const claimed: (string | null)[] = []
  let ok = true
  const seen = new Set<string>()
  for (let i = 0; i < n; i++) {
    const l = letter(i)
    claimed.push(l)
    if (l !== null) {
      if (!PICK_KEYS.includes(l as (typeof PICK_KEYS)[number]) || seen.has(l)) { ok = false; break }
      seen.add(l)
    }
  }
  if (ok) {
    const used = new Set<string>()
    for (let i = 0; i < n; i++) {
      const k = claimed[i] ?? String(PICK_KEYS[i])
      if (used.has(k)) { ok = false; break }
      used.add(k)
    }
  }
  return options.map((_, i) => (i < n ? (ok ? claimed[i] ?? String(PICK_KEYS[i]) : String(PICK_KEYS[i])) : ''))
}
// The option a pressed pick key selects (R6): the pressed key names the letter (its position in PICK_KEYS), the letter names the
// option. A key the pick handler does not accept (the legacy 4th pick) keeps its position. -1 = the card has no option with that key.
export const pickIndex = (options: { label: string }[], key: number): number =>
  key < 0 || key >= PICK_KEYS.length ? key : pickKeys(options).indexOf(String(PICK_KEYS[key]))

// ---- knowledge-review candidates (審查 page 候選教訓區塊, fleet 01M8ARXSD4): one lane's pending candidates, decided through the same CLI decision files ----
export type KReviewCandidate = { key: string; topic: string; pitfall: string; solution: string; tool: string; repo: string; count: number }

// ---- what every v7.4 page receives (PageCtx.v74); a null field means the source is missing (draw the broken marker, never invent rows) ----
export type V74Ctx = {
  pm: PmStatus | null
  pmFetchedMs: number | null
  pmError?: string | null
  decide: DecideCard[] | null
  awaiting?: DurableAwaiting[] | null // answered cards that still wait on the operator's own step (durable store, status awaiting_operator_action)
  decideFetchedMs?: number | null
  decideError?: string | null
  fleetError?: string | null
  fleetSummary?: { fetchedMs: number | null; error: string | null; totals: { stuck: number; running: number; waiting: number; failed: number } } | null
  todo: TodoCard[] | null
  kreview?: KReviewCandidate[] | null
  kreviewFetchedMs?: number | null
  kreviewError?: string | null
  nav: CardNav
  ages?: Record<string, number | null> // keyed by page id (now = PM feed fetchedMs, decide, fleet, ...)
  errors?: Record<string, string | null> // keyed by page id (now = PM feed error, decide, fleet, ...)
  keysHeld?: boolean
  sendResult?: { n: number; left: number } | null
}
