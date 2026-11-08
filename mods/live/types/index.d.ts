// mods/live/types/index.d.ts — the live mod's $.state contract (named by "types" in .claude-plugin/plugin.json; checked by `claude plugin validate`).
// `decide` is what the owner picked and typed on the 待決 tab, by decision id, and which questions were already sent to the session:
//   picks  decision id -> index of the chosen option
//   notes  decision id -> the text typed in its note / reply field
//   sent   decision id -> clock ms the answer was submitted (the card says "sent" until the id leaves the decisions file)
//   clean  residue worktree path -> what the 殘留 tab's cleanup button reported (ok, or the reason it was kept)
// mods/live/model.ts `DecideState` is the same shape; keep the two equal.
export type LiveDecideState = {
  picks: Record<string, number>
  notes: Record<string, string>
  sent: Record<string, number>
  clean?: Record<string, { ok: boolean; note: string }>
}

// One timed model request (mods/live/speed.ts `Step`); the list keeps the last 200 under the shape tag `steps-2`.
export type LiveStep = {
  at: number
  model: string
  isSubagent: boolean
  ttftMs: number | null
  decodeMs: number | null
  outTokens: number
  tps: number | null
}

// The fleet summary (PM G33a; mods/live/fleet.ts `FleetSummary`, keep the two equal): what codeforge's forge-stats band reads. `v` is 1; a reader that sees another
// value draws nothing. Counts per state the Fleet tab draws: needYou ▲, failed ✗, stuck ⊘, running ●, waiting ⋯. `title` is at most 200 characters, ending in `…` when cut.
export type LiveFleetCounts = { needYou: number; failed: number; stuck: number; running: number; waiting: number }
export type LiveFleetSummary = {
  v: 1
  fetchedMs: number | null
  error: string | null
  capped: number
  totals: LiveFleetCounts
  lanes: ({ lane: string; host: string } & LiveFleetCounts)[]
  topStuck: { lane: string; host: string; title: string; ageMs: number | null; rule: 'unaccepted' | 'quiet' | 'hub' } | null
}

// `panel_open_at_ms`: clock ms of the last draw of the O4 shell (band.tsx Shell), written at most every 15 s while it is on screen. codeforge's forge-stats reads it: within a minute of now it
// keeps the quota mirror and its `forge-stats.panel` current. 0 until the shell was first drawn.

declare module 'claude-code' {
  interface PluginState {
    autopilot: { decide: LiveDecideState; steps: Shaped<LiveStep[]>; fleet: LiveFleetSummary; panel_open_at_ms: number }
  }
}
