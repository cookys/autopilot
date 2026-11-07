// mods/live/decideclaim.ts - the 待決 send step with the F4 claim in front of it (PM spec 2026-11-07).
// The owner presses send; BEFORE a card's answer goes into the `[待決回覆]` reply, the pane claims it with the fleet courier (`claimCard`). Only a card whose claim
// succeeded is in the reply, and its line ends with the claimed `answer_id` (hooks/advisory-relay.js reads the last `｜` field and verifies it; a card it cannot verify stays open).
// A card whose claim failed is not in the reply, is not marked sent, and keeps its reason (`failed`) so the pane can say why. Pure: the claim itself is injected, so no
// `$.process` is reached from here (register.ts wires the real one).
import { DECIDE_REPLY_HEAD, decideAnswer, decideLine, decideOpen } from './model'
import type { ClaimAnswer, DecideState, LiveDecision } from './model'

export type ClaimResult = { ok: boolean; answer_id: string | null; reason: string | null }
export type ClaimCard = (card: { id: string; question: string }, answer: ClaimAnswer) => Promise<ClaimResult>

// ok with answer_id null = this host has no courier that speaks `fleet decision` (today's behaviour): the line goes out without an id
export type ClaimedReply = { reply: { text: string; ids: string[] } | null; failed: Record<string, string> }

export async function claimReply(list: readonly LiveDecision[], st: DecideState, claimCard: ClaimCard): Promise<ClaimedReply> {
  const rows: { id: string; line: string }[] = []
  const failed: Record<string, string> = {}
  for (const d of list) {
    if (!decideOpen(d, st)) continue
    const answer = decideAnswer(d, st)
    if (answer === null) continue
    const id = d.id as string
    let r: ClaimResult
    try {
      r = await claimCard({ id, question: d.question }, answer)
    } catch (e) {
      r = { ok: false, answer_id: null, reason: e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : 'claim failed' }
    }
    if (!r.ok) { failed[id] = r.reason !== null && r.reason !== '' ? r.reason : 'claim failed'; continue }
    const line = decideLine(d, st, r.answer_id)
    if (line !== null) rows.push({ id, line })
  }
  return { reply: rows.length === 0 ? null : { text: [DECIDE_REPLY_HEAD, ...rows.map(r => r.line)].join('\n'), ids: rows.map(r => r.id) }, failed }
}
