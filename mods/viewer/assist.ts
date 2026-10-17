// mods/viewer/assist.ts — the three window buttons: summary, ask, send into the conversation. The mod calls haiku itself (`$.model.complete`: no tools, no history), so the text
// of the file never passes through the main model, and what haiku writes reaches the main model only when the owner presses "send into the conversation" (it fills the prompt
// box; the owner sends it). The `show` tool's answer (model.ts summaryOf*) is untouched by anything in this file.
//
// State lives in this module (like the window's own `current`): the shown result, the running call and the saved answers. Nothing is written to disk.

import type { EngineInterface } from 'claude-code'

import { AI_ASK_TOKENS, AI_CACHE_ENTRIES, AI_MODEL, AI_SUMMARY_TOKENS, AI_TIMEOUT_MS, cacheKeyOf, promptFor, sha256Hex, systemFor, totalTokens, truncateForAi } from './model'
import type { AiKind, AiLang, AiSource, UsageLike } from './model'
import type { VT } from './strings'

export type AiResult = {
  kind: AiKind
  text: string
  usage: UsageLike
  subject: string // "src/a.ts 第 1–163 行"
  note: string | null // the cut notice, or null
  question: string | null
  cached: boolean // true when this showing came from the saved answers (no call)
}
export type Running = { kind: AiKind; ctl: AbortController }
export type AiState = { shown: AiResult | null; visible: boolean; running: Running | null; error: string | null; cancelled: boolean }

const fresh = (): AiState => ({ shown: null, visible: true, running: null, error: null, cancelled: false })
let state: AiState = fresh()
const saved = new Map<string, { text: string; usage: UsageLike }>()

export const aiState = (): AiState => state
export const savedCount = (): number => saved.size
export const clearSaved = (): void => saved.clear()

// a new window content: whatever was running is cancelled and the previous answer is dropped (the saved answers stay: the same content asked again is free)
export function resetAssist(): void {
  if (state.running !== null) state.running.ctl.abort()
  state = fresh()
}

export type Source = { text: string; path: string | null; title: string; isDiff: boolean }

function failureText(t: VT, r: { reason: string; status?: number | null; error?: string }): string {
  if (r.reason === 'api-error') return t('viewer.ai.why.api', { kind: r.error ?? 'unknown', status: r.status === null || r.status === undefined ? '-' : r.status })
  if (r.reason === 'empty-reply') return t('viewer.ai.why.empty')
  return r.reason
}

function redraw($: EngineInterface): void {
  void $.ui.invalidate('ui.render')
}

// Summary or question about the whole text of the window (cut at AI_MAX_CHARS, said on screen). A saved answer for the same content and question is shown without a call.
export async function runAi($: EngineInterface, kind: AiKind, question: string | null, src: Source, lang: AiLang, t: VT): Promise<void> {
  if (state.running !== null) { $.ui.toast(t('viewer.ai.busy')); return }
  const cut = truncateForAi(src.text)
  const subject = src.isDiff ? src.title.replace(/[\r\n]+/g, ' ') : t('viewer.ai.lines', { path: src.path ?? src.title, n: cut.lines })
  const note = cut.cut ? t('viewer.ai.cut', { n: cut.lines, total: cut.total }) : null
  const aiSrc: AiSource = { label: subject, isDiff: src.isDiff, content: cut.text }
  // the call is marked running before the first await, so a second press (or a double Enter) while the key is being computed finds it busy
  const ctl = new AbortController()
  const mine: AiState = { shown: state.shown, visible: state.visible, running: { kind, ctl }, error: null, cancelled: false }
  state = mine
  redraw($)
  const key = await cacheKeyOf(kind, question, lang, aiSrc)
  const hash = await sha256Hex(cut.text)
  if (state !== mine) return
  const hit = saved.get(key)
  if (hit !== undefined) {
    state = { shown: { kind, text: hit.text, usage: hit.usage, subject, note, question, cached: true }, visible: true, running: null, error: null, cancelled: false }
    redraw($)
    return
  }
  let r
  try {
    r = await $.model.complete(
      { model: AI_MODEL, system: systemFor(lang), prompt: promptFor(kind, aiSrc, question, hash), maxTokens: kind === 'ask' ? AI_ASK_TOKENS : AI_SUMMARY_TOKENS, timeoutMs: AI_TIMEOUT_MS },
      { signal: ctl.signal },
    )
  } catch (err) {
    if (state !== mine) return // the window moved on while this call ran
    if (ctl.signal.aborted) { state = { shown: mine.shown, visible: mine.visible, running: null, error: null, cancelled: true }; redraw($); return }
    state = { shown: mine.shown, visible: mine.visible, running: null, cancelled: false, error: t('viewer.ai.failed', { why: t('viewer.ai.why.refused', { what: String(err instanceof Error ? err.message : err).slice(0, 160) }) }) }
    redraw($)
    return
  }
  if (state !== mine) return
  if (r.isAnswered) {
    saved.set(key, { text: r.text, usage: r.usage })
    if (saved.size > AI_CACHE_ENTRIES) saved.delete(saved.keys().next().value as string)
    state = { shown: { kind, text: r.text, usage: r.usage, subject, note, question, cached: false }, visible: true, running: null, error: null, cancelled: false }
  } else if (r.reason === 'aborted') {
    state = { shown: mine.shown, visible: mine.visible, running: null, error: null, cancelled: true }
  } else {
    state = { shown: mine.shown, visible: mine.visible, running: null, cancelled: false, error: t('viewer.ai.failed', { why: failureText(t, r) }) }
  }
  redraw($)
}

export function cancelAi($: EngineInterface): void {
  if (state.running === null) return
  state.running.ctl.abort() // the pending call resolves `aborted`, which runAi turns into the "cancelled" line
  redraw($)
}

export function toggleAi($: EngineInterface): void {
  if (state.shown === null) return
  state.visible = !state.visible // in place: a running call holds this very object, and a new one would make its result look stale
  redraw($)
}

// what "send into the conversation" puts in the prompt box: where it came from first, then the text
export function chatTextOf(r: AiResult, t: VT): string {
  const head = (r.kind === 'ask' ? t('viewer.ai.tagAnswer') : t('viewer.ai.tagSummary')) + ' ' + r.subject + (r.note === null ? '' : ' (' + r.note + ')') + '：'
  const body = r.kind === 'ask' ? t('viewer.ai.q') + ' ' + (r.question ?? '') + '\n' + t('viewer.ai.a') + ' ' + r.text : r.text
  return head + '\n' + body
}

// Fill the prompt box with the shown result and stop there: `prompt.fill` puts a draft, the owner presses Enter. Never `prompt.submit`.
export async function sendToChat($: EngineInterface, t: VT): Promise<void> {
  const r = state.shown
  if (r === null) { $.ui.toast(t('viewer.ai.nosummary')); return }
  const draft = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const text = (draft.text === '' ? '' : '\n\n') + chatTextOf(r, t)
  const out = await $.prompt.fill({ text, mode: draft.text === '' ? 'replace' : 'append' })
  $.ui.toast(out.isFilled ? t('viewer.ai.filled') : t('viewer.ai.notfilled', { why: out.refusal ?? '-' }))
}

export { totalTokens }
