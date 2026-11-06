// mods/live/decidebatch.ts — the 待決 tab across several answers in a row: one batch of cards with stable numbers, answered cards that stay (greyed), stable focus keys, and the
// focus / scroll plan after an answer. Pure: the shell (register.ts) holds the batch and applies the plan through the host's focus and scroll calls.
import type { DecideState, LiveDecision, PaneLine } from './model'

export type DecideBatch = { order: string[]; num: Record<string, number>; next: number; q: Record<string, string>; ans: Record<string, string> }
export const NO_BATCH: DecideBatch = { order: [], num: {}, next: 1, q: {}, ans: {} }
export const SUBMIT_KEY = 'submit'

// STUB (red first): the real bodies come in the next commit
export const optKey = (_id: string, _k: number): string => ''
export const cardKey = (d: LiveDecision): string => d.id ?? 'q:' + d.question
export function batchSync(_prev: DecideBatch, _pending: readonly LiveDecision[], _st: DecideState): DecideBatch { return NO_BATCH }
export function rowOfKey(_lines: readonly PaneLine[], _key: string): number { return -1 }
export type AnswerPlan = { focus: string; offset: number }
export function answerPlan(_o: { lines: readonly PaneLine[]; batch: DecideBatch; pending: readonly LiveDecision[]; st: DecideState; answered: string; offset: number; room: number }): AnswerPlan { return { focus: '', offset: 0 } }
