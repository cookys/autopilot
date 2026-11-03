// mods/live/fleet.ts — the Fleet tab's data (console C1 v0, PM G23): every lane's work as the fleet hub's task tree reports it (`fleet tasks --tree --json`).
// Pure: parsing, grouping and the stuck rules take the clock as an argument; the one impure piece is the feed, which runs the CLI through an injected runner
// (register.ts passes `$.process.run`). No string here is user-facing: the tab builder (tabs.ts) translates every word.

// A task row as the hub publishes it; fields this tab does not read are not named. `observed_at` is when the courier last observed the assignee's seat (every row of one
// seat carries the same value), not when the row changed: it measures how stale the seat's report is, and the creation time comes from the ULID task id.
export type FleetRow = {
  id: string
  lane: string // the assignee's member (`autopilot--claude`); the host is kept apart
  host: string
  title: string
  progress: string
  state: string // the hub's own word, lower-cased: open, task_accepted, running, waiting, result_reported, done, failed, suspect, lost, blocked_human, unknown, ...
  createdMs: number | null
  observedMs: number | null
}

// why a row is flagged: open over an hour with nobody accepting it, a seat not observed for four hours, or a state the hub itself classifies as stuck
export type StuckReason = 'unaccepted' | 'quiet' | 'hub'
export type FleetTask = FleetRow & { inflight: boolean; stuck: StuckReason | null; ageMs: number | null; quietMs: number | null }
export type FleetLane = { lane: string; host: string; inflight: FleetTask[]; upcoming: FleetTask[]; stuck: number }
// what the pane draws: the lanes as of `nowMs`, when the data was last fetched and the last fetch's error (null while it worked)
export type FleetView = { lanes: FleetLane[]; fetchedMs: number | null; error: string | null; nowMs: number }

export const FLEET_TTL_MS = 30_000
export const OPEN_UNACCEPTED_MS = 3_600_000
export const QUIET_MS = 4 * 3_600_000
export const FLEET_ARGV = ['fleet', 'tasks', '--tree', '--json'] as const

const TERMINAL = new Set(['done', 'declined', 'cancelled', 'canceled'])
const HUB_STUCK = new Set(['suspect', 'lost', 'blocked_human'])

// The creation time a ULID carries in its first ten Crockford base-32 characters (ms since the epoch); null for an id that is not one.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function ulidMs(id: string): number | null {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) return null
  let ms = 0
  for (const c of id.slice(0, 10).toUpperCase()) ms = ms * 32 + CROCKFORD.indexOf(c)
  return Number.isSafeInteger(ms) ? ms : null
}

// A dispatch's first line is often its brief header (`Engine: … | Role: … | Lane: …`), which says nothing about the work: such a title reads as empty, and the row falls
// back to its progress line.
const BRIEF_HEADER = /^\s*Engine:\s*[^|]*\|\s*Role:\s*[^|]*\|\s*Lane:\s*\S+\s*$/i
const firstLine = (s: string): string => s.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
export function taskTitle(title: string, progress: string, id: string): string {
  const t = firstLine(title)
  if (t !== '' && !BRIEF_HEADER.test(t)) return t
  const p = firstLine(progress)
  return p !== '' ? p : id.slice(-8)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const timeOf = (v: unknown): number | null => {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(ms) ? ms : null
}

// The hub's JSON (a list of rows) to work rows: observed runs (`kind: observed_run`, a process the courier saw, not a task anyone was given) and finished rows are left
// out. Throws on JSON that is not a list, so the feed can say the data is unreadable instead of drawing an empty fleet.
export function parseFleetTasks(json: string): FleetRow[] {
  const data: unknown = JSON.parse(json)
  if (!Array.isArray(data)) throw new Error('fleet tasks: not a list')
  const out: FleetRow[] = []
  for (const r of data) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    if (o.kind === 'observed_run') continue
    const id = str(o.task_id)
    const state = str(o.state).trim().toLowerCase() || 'unknown'
    if (id === '' || TERMINAL.has(state)) continue
    const assignee = str(o.assignee)
    const cut = assignee.lastIndexOf('/')
    out.push({
      id, state,
      lane: cut < 0 ? assignee || '—' : assignee.slice(cut + 1),
      host: cut < 0 ? '' : assignee.slice(0, cut),
      title: taskTitle(str(o.title), str(o.progress), id),
      progress: firstLine(str(o.progress)),
      createdMs: ulidMs(id),
      observedMs: timeOf(o.observed_at),
    })
  }
  return out
}

export function stuckOf(r: FleetRow, nowMs: number): StuckReason | null {
  if (HUB_STUCK.has(r.state)) return 'hub'
  if (r.state === 'open' && r.createdMs !== null && nowMs - r.createdMs > OPEN_UNACCEPTED_MS) return 'unaccepted'
  if (r.observedMs !== null && nowMs - r.observedMs > QUIET_MS) return 'quiet'
  return null
}

// Grouped by lane: a lane's in-flight rows first (stuck ones on top, then the newest), then its open rows, the upcoming work (oldest first: the queue's order). Lanes
// with a stuck row come first, then the busiest, then by name.
export function fleetLanes(rows: readonly FleetRow[], nowMs: number): FleetLane[] {
  const by = new Map<string, FleetLane>()
  for (const r of rows) {
    const key = r.host + '/' + r.lane
    let lane = by.get(key)
    if (lane === undefined) by.set(key, (lane = { lane: r.lane, host: r.host, inflight: [], upcoming: [], stuck: 0 }))
    const stuck = stuckOf(r, nowMs)
    const task: FleetTask = { ...r, inflight: r.state !== 'open', stuck, ageMs: r.createdMs === null ? null : Math.max(0, nowMs - r.createdMs), quietMs: r.observedMs === null ? null : Math.max(0, nowMs - r.observedMs) }
    if (stuck !== null) lane.stuck++
    ;(task.inflight ? lane.inflight : lane.upcoming).push(task)
  }
  const created = (t: FleetTask): number => t.createdMs ?? 0
  for (const l of by.values()) {
    l.inflight.sort((a, b) => Number(b.stuck !== null) - Number(a.stuck !== null) || created(b) - created(a))
    l.upcoming.sort((a, b) => created(a) - created(b))
  }
  return [...by.values()].sort((a, b) => Number(b.stuck > 0) - Number(a.stuck > 0) || b.inflight.length - a.inflight.length || a.lane.localeCompare(b.lane))
}

// ---- the feed: one CLI run at a time, at most once per TTL, never awaited by a render ----
export type FleetRunner = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
export type FleetFeed = { rows: () => readonly FleetRow[]; fetchedMs: () => number | null; error: () => string | null; refresh: (run: FleetRunner, nowMs: number, force?: boolean) => Promise<boolean> }

// `refresh` resolves true when it ran the CLI (the caller redraws), false when it skipped (in flight, or the data is younger than the TTL). A failed run keeps the last good
// rows and their time, so the pane shows old data with its age and the error, never a blank fleet. The runner comes with each call: a hooks module may not keep `$`.
export function makeFleetFeed(ttlMs = FLEET_TTL_MS): FleetFeed {
  let rows: FleetRow[] = []
  let fetchedMs: number | null = null
  let triedMs: number | null = null
  let error: string | null = null
  let busy = false
  return {
    rows: () => rows,
    fetchedMs: () => fetchedMs,
    error: () => error,
    refresh: async (run: FleetRunner, nowMs: number, force = false) => {
      if (busy) return false
      if (!force && triedMs !== null && nowMs - triedMs < ttlMs) return false
      busy = true
      triedMs = nowMs
      try {
        const r = await run(FLEET_ARGV)
        if (r.exitCode !== 0) throw new Error(firstLine(r.stderr) || 'exit ' + r.exitCode)
        rows = parseFleetTasks(r.stdout)
        fetchedMs = nowMs
        error = null
      } catch (e) {
        error = firstLine(e instanceof Error ? e.message : String(e)) || 'failed'
      } finally {
        busy = false
      }
      return true
    },
  }
}

export const fleetView = (feed: FleetFeed, nowMs: number): FleetView => ({ lanes: fleetLanes(feed.rows(), nowMs), fetchedMs: feed.fetchedMs(), error: feed.error(), nowMs })
