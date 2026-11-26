// mods/live/wide/types.ts — shared output shape for console v5 wide page mappers.
export type WidePageOut = {
  stepTitle: string
  list: string[]
  reply: string[]
  hints: string
  replyKeep?: number
  summary: string | null
  hist: { title: string; rows: string[] } | null
  pin?: string[] // fixed warning rows of the pane (source missing / stale)
  ctx?: string[] // the pane's context rows
}
