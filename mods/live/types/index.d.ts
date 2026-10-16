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

declare module 'claude-code' {
  interface PluginState {
    autopilot: { decide: LiveDecideState }
  }
}
