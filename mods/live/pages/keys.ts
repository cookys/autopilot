// mods/live/pages/keys.ts — the pane's ONE key table (plan r2 §3.2): digits, Esc, Enter and the 待決 note mode are decided here and nowhere else; register.ts calls routeKey.
// Pure. The state is host facts: which page shows, whether the pane (not the prompt box) holds the keyboard, whether a Button has focus, whether the note mode is on.
// 'pass' hands the key back to Claude Code (Esc interrupts the turn there); 'button' means the host's focused Button takes this Enter and the pane does nothing else with it.
import { PAGES } from './index'

export type KeyState = { page: string; paneFocus: boolean; focusedButton: boolean; textMode: boolean }
export type KeyAction =
  | { kind: 'page'; to: string } | { kind: 'close' } | { kind: 'pass' } | { kind: 'button' } | { kind: 'submit' }
  | { kind: 'pick'; index: number } | { kind: 'text'; ch: string } | { kind: 'text_save' } | { kind: 'text_cancel' }
  | { kind: 'note' } | { kind: 'undo' } | { kind: 'prev' } | { kind: 'next' } | { kind: 'fill' }
  | { kind: 'move'; by: 1 | -1 } | { kind: 'fold' } | { kind: 'none' }

const SPECIAL: Record<string, string> = { '9': 'pet', '0': 'forge', '?': 'help' } // the ids are PAGES entries 9, 0, ? (pages/index.ts)
const PICKS = ['a', 'b', 'c', 'd', 'e']

export function routeKey(key: string, st: KeyState): KeyAction {
  if (!st.paneFocus) return { kind: 'pass' } // focus in the prompt box: every key goes back to Claude Code (g2 folds A5); enter the pane with Ctrl+x Tab or a click
  if (st.textMode) return key === 'Enter' ? { kind: 'text_save' } : key === 'Escape' ? { kind: 'text_cancel' } : { kind: 'text', ch: key }
  if (key === 'Escape') return { kind: 'close' }
  if (key === 'Enter') return st.focusedButton ? { kind: 'button' } : st.page === 'decide' ? { kind: 'submit' } : { kind: 'none' }
  const target = /^[1-8]$/.test(key) ? PAGES[Number(key) - 1]?.id : SPECIAL[key]
  if (target !== undefined) return target === st.page ? { kind: 'close' } : { kind: 'page', to: target }
  if (/^[1-9]$/.test(key)) return { kind: 'none' } // a digit with no page yet
  if (key === 'j' || key === 'ArrowDown') return { kind: 'move', by: 1 }
  if (key === 'k' || key === 'ArrowUp') return { kind: 'move', by: -1 }
  if (key === ' ') return { kind: 'fold' }
  if (st.page === 'decide') {
    const pick = PICKS.indexOf(key)
    if (pick >= 0) return { kind: 'pick', index: pick }
    if (key === 'n') return { kind: 'note' }
    if (key === 'u') return { kind: 'undo' }
    if (key === '[') return { kind: 'prev' }
    if (key === ']') return { kind: 'next' }
    if (key === 'f') return { kind: 'fill' }
  }
  return { kind: 'none' }
}
