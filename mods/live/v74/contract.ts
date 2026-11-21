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
// lines = projects; ✗ = a project with stuck > 0 or overdue > 0; ⊘ = only waiting; ● = the rest. Hosts and quota alerts keep their existing sources (console / quota) and are omitted when those are missing.
export type FleetLineMark = 'fail' | 'parked' | 'ok' | 'unknown'
export type FleetLine = { project: string; mark: FleetLineMark; counts: PmCounts }
export function fleetLines(s: PmStatus): FleetLine[] {
  const mark = (c: PmCounts): FleetLineMark => ((c.stuck ?? 0) > 0 || (c.overdue ?? 0) > 0 ? 'fail' : c.stuck === null || c.overdue === null || c.running === null || c.waiting === null ? 'unknown' : c.waiting > 0 && c.running === 0 ? 'parked' : 'ok')
  const rank: Record<FleetLineMark, number> = { fail: 0, unknown: 1, parked: 2, ok: 3 }
  return s.projects.map(p => ({ project: p.project, mark: mark(p.counts), counts: p.counts })).sort((a, b) => rank[a.mark] - rank[b.mark]) // stable: keeps the fleet order inside a mark
}

// ---- decision cards (待決 S3) and todo cards (待辦 S9) ----
export type CardOption = { label: string; detail: string; recommended: boolean }
export type DecideCard = { id: string; title: string; question: string; background: string | null; options: CardOption[] }
export type TodoCard = { id: string; title: string; dueMs: number | null; question: string; options: CardOption[] } // source not live: fixtures/v74/todo.json
export type CardNav = { cursor: number; picks: Record<string, number>; notes: Record<string, string>; noteMode: boolean } // picks/notes keyed by card id; only the card at cursor draws its options as buttons

// ---- v7.4 page order and keys (sub-task B owns keys.ts / layout.ts / index.ts; everyone else reads this) ----
export const V74_PAGES = ['now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'fleet', 'todo', 'help'] as const // keys 1..9; quota folds into spend (S6)
export type V74PageId = (typeof V74_PAGES)[number]
export const V74_KEY: Record<V74PageId, string> = { now: '1', decide: '2', dispatch: '3', review: '4', spend: '5', hygiene: '6', fleet: '7', todo: '8', help: '9' }
export const PET_KEY = '0' // the pet keeps its own tab (operator rule, PM 01M78CB6); drawn after 9 when the width allows
// Digits only switch pages. Letters act on 待決/待辦 only: a/b/c pick for the card at the cursor, m note (待決), s send all (待決). ↑↓ (j/k) move the card cursor on 待決/待辦 and scroll elsewhere; Enter folds the section at the cursor unless a Button has focus.
export const PICK_KEYS = ['a', 'b', 'c'] as const

// ---- what every v7.4 page receives (PageCtx.v74); a null field means the source is missing (draw the broken marker, never invent rows) ----
export type V74Ctx = { pm: PmStatus | null; pmFetchedMs: number | null; decide: DecideCard[] | null; todo: TodoCard[] | null; nav: CardNav; ages?: Record<string, number | null>; keysHeld?: boolean; sendResult?: { n: number; left: number } | null }
