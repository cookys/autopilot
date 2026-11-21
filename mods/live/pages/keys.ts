// mods/live/pages/keys.ts — the pane's ONE key table (plan r2 §3.2, v7.4 B): digits, Esc, Enter and the 待決 note mode are decided here and nowhere else; register.ts calls routeKey.
// Pure. The state is host facts: which page shows, whether the pane (not the prompt box) holds the keyboard, whether a Button has focus, whether the note mode is on.
// 'pass' hands the key back to Claude Code (Esc interrupts the turn there); 'button' means the host's focused Button takes this Enter and the pane does nothing else with it.
import { PET_KEY, PICK_KEYS, V74_KEY } from '../v74/contract'

export type KeyState = { page: string; paneFocus: boolean; focusedButton: boolean; textMode: boolean }
export type KeyAction =
  | { kind: 'page'; to: string } | { kind: 'close' } | { kind: 'pass' } | { kind: 'button' } | { kind: 'submit' }
  | { kind: 'pick'; index: number } | { kind: 'text'; ch: string } | { kind: 'text_save' } | { kind: 'text_cancel' }
  | { kind: 'note' } | { kind: 'undo' } | { kind: 'prev' } | { kind: 'next' } | { kind: 'fill' }
  | { kind: 'move'; by: 1 | -1 } | { kind: 'cursor'; at: number } | { kind: 'fold' } | { kind: 'open' } | { kind: 'none' }

const pageForDigit = (key: string): string | undefined => {
  if (key === PET_KEY) return 'pet'
  const hit = Object.entries(V74_KEY).find(([, k]) => k === key)
  return hit?.[0]
}

const CARD_PAGES = new Set(['decide', 'todo'])

export function routeKey(key: string, st: KeyState): KeyAction {
  if (!st.paneFocus) return { kind: 'pass' }
  if (st.textMode) return key === 'Enter' ? { kind: 'text_save' } : key === 'Escape' ? { kind: 'text_cancel' } : { kind: 'text', ch: key }
  if (key === 'Escape') return { kind: 'close' }
  if (key === 'Enter') return st.focusedButton ? { kind: 'button' } : { kind: 'fold' }
  const target = /^[1-9]$/.test(key) ? pageForDigit(key) : key === PET_KEY ? 'pet' : undefined
  if (target !== undefined) return target === st.page ? { kind: 'none' } : { kind: 'page', to: target }
  if (/^[0-9]$/.test(key)) return { kind: 'none' }
  if (key === 'j' || key === 'ArrowDown') return { kind: 'move', by: 1 }
  if (key === 'k' || key === 'ArrowUp') return { kind: 'move', by: -1 }
  if (key === 'z') return { kind: 'fold' }
  if (key === 'o' && !CARD_PAGES.has(st.page)) return { kind: 'open' }
  if (st.page === 'decide' || st.page === 'todo') {
    const pick = PICK_KEYS.indexOf(key as (typeof PICK_KEYS)[number])
    if (pick >= 0) return { kind: 'pick', index: pick }
    if (key === 'm' && st.page === 'decide') return { kind: 'note' }
    if (key === 's' && st.page === 'decide') return { kind: 'submit' }
  }
  if (st.page === 'decide') {
    if (key === 'n') return { kind: 'note' }
    if (key === 'u') return { kind: 'undo' }
    if (key === 'h') return { kind: 'prev' }
    if (key === 'l') return { kind: 'next' }
    if (key === 'f') return { kind: 'fill' }
  }
  return { kind: 'none' }
}