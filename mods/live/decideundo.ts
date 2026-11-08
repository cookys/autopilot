// mods/live/decideundo.ts - the 待決 send step with an undo window and corrections (operator, 2026-11-08: "I click and it is sent, I cannot regret or change it").
//
//   press an option      -> only SELECTS (applyPick): the card stays open, pick and note can still change
//   press send           -> holdSend: every answered card enters the undo window (DECIDE_UNDO_MS); nothing is sent
//   press undo           -> undoHold: the card leaves the window, nothing was sent, pick and note are kept
//   the window ends      -> tickHold: due cards leave `hold` and go to sendNow = the `[待決回覆]` prompt (with the answer_id of a claim that already returned, else without)
//   press 改答案 (a sent card) -> reopen: the card is editable again; its next send is ONE `[待決回覆·更正] <id> → <answer>` line
//
// Pure of the engine: the clock, the state and the prompt are injected (UndoDeps), so a test drives time by hand and register.ts wires the real ones.
import { DECIDE_UNDO_MS, decideAnswer, decideCorrectionLine, decideFixing, decideHeld, decideLine, decideOpen, decideReply } from './model'
import type { ClaimAnswer, DecideState, LiveDecision } from './model'

// The courier claim (F4) runs in the BACKGROUND of the undo window and never blocks anything (PM rule 2026-11-08): holdSend starts it, sendNow only LOOKS at what it has already returned.
// ok with answer_id null = a host with no courier that speaks `fleet decision`. Its own limit (register.ts CLAIM_MS, below the window) is the process timeout of the claim script.
export type ClaimResult = { ok: boolean; answer_id: string | null; reason: string | null }
export type ClaimCard = (card: { id: string; question: string }, answer: ClaimAnswer) => Promise<ClaimResult>

export type UndoDeps = {
  now: () => Promise<number>
  read: () => Promise<DecideState>
  update: (fn: (s: DecideState) => DecideState) => Promise<void>
  pool: (st: DecideState) => LiveDecision[] // the cards that can be acted on now (decidebatch.ts actionable)
  claim?: ClaimCard // started in the background when a card enters its window; absent = no claim
}
// the real send posts; only register.ts sendDecide holds the one prompt.submit (ui-lint allowlist), so only it builds these
export type SendDeps = UndoDeps & { post: (text: string) => Promise<unknown> }

const dropIds = <V,>(r: Record<string, V> | undefined, ids: readonly string[]): Record<string, V> => Object.fromEntries(Object.entries(r ?? {}).filter(([i]) => !ids.includes(i)))
// a card that was sent (and not reopened) or sits in its undo window takes no edit
const locked = (s: DecideState, id: string): boolean => (s.sent[id] !== undefined && s.fixing?.[id] === undefined) || s.hold?.[id] !== undefined

// card id -> the claim started for it by the window now running. `answerId` is filled only by a claim that returned ok with an id; the send reads it as it is at that moment.
// An undo (or the send) deletes the entry, so a claim that returns later writes into a slot nothing reads.
const claims = new Map<string, { answerId: string | null }>()
function startClaim(claim: ClaimCard, c: LiveDecision, st: DecideState): void {
  const answer = decideAnswer(c, st)
  if (answer === null) return
  const id = c.id as string
  const slot = { answerId: null as string | null }
  claims.set(id, slot)
  void claim({ id, question: c.question }, answer).then(r => { if (r.ok && typeof r.answer_id === 'string' && r.answer_id !== '') slot.answerId = r.answer_id }).catch(() => undefined) // a failed claim is just no id
}

// A press on an option: select it (pressing the selected one again unselects). Nothing is sent or marked sent.
export function applyPick(s: DecideState, id: string, k: number): DecideState {
  if (locked(s, id)) return s
  const picks = { ...s.picks }
  if (picks[id] === k) delete picks[id]
  else picks[id] = k
  return { ...s, picks }
}

// Send pressed: the answered open cards that are not already in a window enter one. Returns their ids.
export async function holdSend(d: UndoDeps): Promise<string[]> {
  const st = await d.read()
  const cards = d.pool(st).filter(c => decideOpen(c, st) && !decideHeld(c, st) && decideLine(c, st) !== null)
  const ids = cards.map(c => c.id as string)
  if (ids.length === 0) return []
  const until = (await d.now()) + DECIDE_UNDO_MS
  await d.update(s => ({ ...s, hold: { ...(s.hold ?? {}), ...Object.fromEntries(ids.map(i => [i, until])) } }))
  // a reopened (sent) card is a correction: it is never claimed
  if (d.claim !== undefined) for (const c of cards) if (!decideFixing(c, st)) startClaim(d.claim, c, st)
  return ids
}

// Undo pressed: the card leaves its window. Its pick and note stay as they were; nothing was sent.
export async function undoHold(d: UndoDeps, id: string): Promise<void> {
  claims.delete(id) // the claim result is thrown away (scripts/lib/fleet-decision.js has no release call, so a claim that did succeed stays claimed at the courier)
  await d.update(s => (s.hold?.[id] === undefined ? s : { ...s, hold: dropIds(s.hold, [id]) }))
}

// 改答案 pressed on a card that was sent from here: it is editable again, with the pick and note it was sent with.
export async function reopen(d: UndoDeps, id: string): Promise<void> {
  const at = await d.now()
  await d.update(s => (s.sent[id] === undefined || s.hold?.[id] !== undefined ? s : { ...s, fixing: { ...(s.fixing ?? {}), [id]: at } }))
}

let ticking = false
// One tick of the timer: the cards whose window ended leave `hold` FIRST (so an undo landing meanwhile finds nothing, and the next tick cannot send them twice), then go out.
// `idle` is true when no card is left in a window, so the caller can stop its timer.
export async function tickHold(d: UndoDeps, send: (ids: ReadonlySet<string>) => Promise<unknown>): Promise<{ idle: boolean }> {
  if (ticking) return { idle: false }
  ticking = true
  try {
    const st = await d.read()
    const now = await d.now()
    const hold = st.hold ?? {}
    const due = Object.keys(hold).filter(i => hold[i] <= now)
    if (due.length > 0) {
      await d.update(s => ({ ...s, hold: dropIds(s.hold, due) }))
      await send(new Set(due))
    }
    return { idle: Object.keys((await d.read()).hold ?? {}).length === 0 }
  } finally {
    ticking = false
  }
}

let sending = false
// The real send of `only`. First answers: ONE `[待決回覆]` prompt. Reopened cards: one `[待決回覆·更正]` prompt each. The claim is never awaited on this path (PM rule 2026-11-08: a claim
// never blocks the send, and the pane froze for up to 120 s per card when it did): answerIds is what holdSend's background claims have already returned. Nothing here awaits the prompt: `post` is fired and only its refusal is handled. The cards are
// marked sent BEFORE the prompt goes; a prompt the session refuses takes the marks back, so a card never stays in a sending state. Returns the ids of the first answers that went out.
export async function sendNow(d: SendDeps, only: ReadonlySet<string>): Promise<string[]> {
  if (sending) return []
  sending = true
  try {
    const st0 = await d.read()
    const pool = d.pool(st0).filter(c => c.id !== null && only.has(c.id))
    const answerIds: Record<string, string> = {}
    for (const i of only) { const a = claims.get(i)?.answerId; if (a !== undefined && a !== null) answerIds[i] = a; claims.delete(i) } // whatever the claim has returned by now; one still running is dropped
    const reply = decideReply(pool, st0, answerIds)
    const at = await d.now()
    if (reply !== null) {
      await d.update(s => ({ ...s, sent: { ...s.sent, ...Object.fromEntries(reply.ids.map(i => [i, at])) } }))
      void d.post(reply.text).catch(async () => {
        await d.update(s => { const sent = { ...s.sent }; for (const i of reply.ids) delete sent[i]; return { ...s, sent } })
      }).catch(() => undefined) // the take-back write may fail on a dead session; nothing is waiting on it
    }
    for (const fix of correctionReplies(pool, st0)) {
      await d.update(s => ({ ...s, sent: { ...s.sent, [fix.id]: at }, fixing: dropIds(s.fixing, [fix.id]) }))
      void d.post(fix.text).catch(async () => {
        await d.update(s => ({ ...s, fixing: { ...(s.fixing ?? {}), [fix.id]: at } }))
      }).catch(() => undefined)
    }
    return reply === null ? [] : reply.ids
  } finally {
    sending = false
  }
}

// A reopened (sent) card goes out as its own correction line (decideCorrectionLine): no answer id, so the receiving hook records it and says it was not verified by the courier.
export function correctionReplies(list: readonly LiveDecision[], st: DecideState): { id: string; text: string }[] {
  return list.flatMap(d => {
    if (!decideOpen(d, st) || !decideFixing(d, st)) return []
    const text = decideCorrectionLine(d, st)
    return text === null ? [] : [{ id: d.id as string, text }]
  })
}
