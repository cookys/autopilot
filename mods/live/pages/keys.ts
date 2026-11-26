// mods/live/pages/keys.ts — the pane's ONE key table (plan r2 §3.2, v7.4 B): digits, Esc, Enter and the 待決 note mode are decided here and nowhere else; register.ts calls routeKey.
// Pure. The state is host facts: which page shows, whether the pane (not the prompt box) holds the keyboard, whether a Button has focus, whether the note mode is on.
// 'pass' hands the key back to Claude Code (Esc interrupts the turn there); 'button' means the host's focused Button takes this Enter and the pane does nothing else with it.
import { PET_KEY, PICK_KEYS, V74_KEY, V74_PAGES } from '../v74/contract'

export type KeyState = { page: string; paneFocus: boolean; focusedButton: boolean; textMode: boolean; armed?: boolean; bgOpen?: boolean; compactExpanded?: boolean; wide?: boolean }
export type KeyAction =
  | { kind: 'page'; to: string } | { kind: 'close' } | { kind: 'pass' } | { kind: 'button' } | { kind: 'submit' } | { kind: 'confirm' } | { kind: 'disarm' }
  | { kind: 'pick'; index: number } | { kind: 'text'; ch: string } | { kind: 'text_save' } | { kind: 'text_cancel' }
  | { kind: 'note' } | { kind: 'undo' } | { kind: 'prev' } | { kind: 'next' } | { kind: 'fill' }
  | { kind: 'move'; by: 1 | -1 } | { kind: 'cursor'; at: number } | { kind: 'fold' } | { kind: 'open' } | { kind: 'none' }
  | { kind: 'scroll'; by: 1 | -1; page: boolean } | { kind: 'style' } | { kind: 'expand' } | { kind: 'toggle_expand' } | { kind: 'toggle_ctx' } | { kind: 'copy_url' }

const pageForDigit = (key: string): string | undefined => {
  if (key === PET_KEY) return 'pet'
  const hit = Object.entries(V74_KEY).find(([, k]) => k === key)
  return hit?.[0]
}

// shell menus d 待決 / r 圓桌 / u 用量 / p 寵物 / h 說明 as page keys (d is page 2, h is page 9, the rest are here)
export const SHELL_MENU_PAGES: Record<string, string> = { r: 'room', u: 'spend', p: 'pet' }
const CARD_PAGES = new Set(['decide', 'todo'])

export function routeKey(key: string, st: KeyState): KeyAction {
  if (!st.paneFocus) return { kind: 'pass' }
  if (st.textMode) return key === 'Enter' ? { kind: 'text_save' } : key === 'Escape' ? { kind: 'text_cancel' } : { kind: 'text', ch: key }
  if (key === 'Escape') return st.page === 'decide' && (st.bgOpen === true || st.compactExpanded === true) ? { kind: 'expand' } : st.armed === true && st.page === 'decide' ? { kind: 'disarm' } : { kind: 'close' }
  if (key === 'Tab' && st.wide === true) { const at = (V74_PAGES as readonly string[]).indexOf(st.page); return { kind: 'page', to: V74_PAGES[(at + 1) % V74_PAGES.length] } } // console v5 wide band: Tab cycles 1 -> 9 -> 1
  if (key === 'e' && st.wide === true && st.page !== 'decide') return { kind: 'toggle_ctx' } // console v5 wide pane: e opens / folds the context (來龍去脈); 待決 keeps its own e
  if (key === 'w') return { kind: 'toggle_expand' }
  if (key === 'Enter') return st.focusedButton ? { kind: 'button' } : { kind: 'fold' }
  if (st.page === 'decide') {
    if (key === 'p' || key === 'n') return { kind: 'move', by: key === 'p' ? -1 : 1 }
    if (key === 'v') return { kind: 'style' }
    if (key === 'e') return { kind: 'expand' }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown') return { kind: 'scroll', by: key === 'ArrowUp' || key === 'PageUp' ? -1 : 1, page: key.startsWith('Page') }
  }
  const moved = SHELL_MENU_PAGES[key] // r / p / u page keys (u stays undo on 待決)
  if (moved !== undefined && !(key === 'u' && st.page === 'decide')) return moved === st.page ? { kind: 'none' } : { kind: 'page', to: moved }
  const target = /^[1-9]$/.test(key) ? pageForDigit(key) : key === PET_KEY ? 'pet' : undefined
  if (target !== undefined) return target === st.page ? { kind: 'none' } : { kind: 'page', to: target }
  if (/^[0-9]$/.test(key)) return { kind: 'none' }
  if (key === 'PageUp' || key === 'PageDown') return { kind: 'scroll', by: key === 'PageUp' ? -1 : 1, page: true } // a cut body scrolls one screen (frameKey ignores it on a page that is not cut)
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
    if (key === 'y') return st.armed === true ? { kind: 'confirm' } : { kind: 'none' } // r11 #12: y confirms the send preview and means nothing else
    if (key === 'u') return { kind: 'undo' }
    if (key === 'x') return st.armed === true ? { kind: 'disarm' } : { kind: 'none' } // x cancels the send preview, as Esc does (a band hotkey cannot be Esc, d.ts:1391)
    if (key === 'h') return { kind: 'prev' }
    if (key === 'l') return { kind: 'next' }
    if (key === 'f') return { kind: 'fill' }
    if (key === 'g' && st.wide === true) return { kind: 'copy_url' } // console v5 wide band: g hands out the open card's URL
  }
  return { kind: 'none' }
}
