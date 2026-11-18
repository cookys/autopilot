// keys.test.ts — r2 §3.2 / §6-4 (codeforge plan 2026-11-18-pane-tabs-r2; autopilot 01M7N46A Enter/Esc rules, 01M7N4GD): one key table, no key
// means two things on any page. Contract for S0: pages/keys.ts exports a pure `routeKey(key, state): KeyAction` that register.ts's key handler
// calls; the host-level focus facts come in as state. Red until S0 lands (pages/keys.ts does not exist on faa6b4cb6).
//
//   KeyState  = { page: string; paneFocus: boolean; focusedButton: boolean; textMode: boolean }
//               page = a PAGES id, 'pet', 'forge' or 'help'; paneFocus = the pane (not the prompt box) has keyboard focus;
//               focusedButton = some Button in the pane has focus (the host presses it on Enter); textMode = decide's `n` note mode.
//   KeyAction = { kind: 'page'; to: string } | { kind: 'close' } | { kind: 'pass' } | { kind: 'button' } | { kind: 'submit' }
//             | { kind: 'pick'; index: number } | { kind: 'text'; ch: string } | { kind: 'text_save' } | { kind: 'text_cancel' }
//             | { kind: 'none' } | other page-local kinds (move, fold, scroll, fill, primary, clear_all, undo, prev, next, note)
//   'pass'   = not ours: hand the key back to Claude Code (Esc interrupts the turn there).
//   'button' = the host's focused Button takes this Enter; the pane does nothing else with it.
import { test, expect } from 'claude-code/testing'
import { routeKey } from './keys'
import { PAGES } from './index'

type St = { page: string; paneFocus: boolean; focusedButton: boolean; textMode: boolean }
const st = (o: Partial<St>): St => ({ page: 'now', paneFocus: true, focusedButton: false, textMode: false, ...o })
const ALL = [...new Set([...PAGES.map(p => p.id as string), 'pet', 'forge', 'help'])]
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8']
const LETTERS = ['a', 'b', 'c', 'd', 'e']
const show = (x: unknown) => JSON.stringify(x)

test('keys: Enter on a focused Button is that Button only, on every page (never a second submit/primary)', () => {
  const bad: string[] = []
  for (const page of ALL) {
    const a = routeKey('Enter', st({ page, focusedButton: true }))
    if (a.kind !== 'button') bad.push(`${page}=${show(a)}`)
  }
  expect(bad.join(' ')).toBe('')
})

test('keys: decide, Enter with nothing focused = none (submit is s only); decide, s = submit', () => {
  expect(routeKey('Enter', st({ page: 'decide' }))).toEqual({ kind: 'none' })
  expect(routeKey('s', st({ page: 'decide' }))).toEqual({ kind: 'submit' })
})

test('keys: Esc with focus in the prompt box is passed to Claude Code on every page and in text mode', () => {
  const bad: string[] = []
  for (const page of ALL)
    for (const textMode of page === 'decide' ? [false, true] : [false]) {
      const a = routeKey('Escape', st({ page, paneFocus: false, textMode }))
      if (a.kind !== 'pass') bad.push(`${page}${textMode ? '/text' : ''}=${show(a)}`)
    }
  expect(bad.join(' ')).toBe('')
})

test('keys: with focus in the prompt box no pane/band hotkey fires — every key is passed to Claude Code (g2 folds A5)', () => {
  const bad: string[] = []
  const keys = [...DIGITS, '9', '0', 'i', ...LETTERS, 'n', 'u', 'x', 'f', 'j', 'k', 'h', 'l', 'o', 'z', 's', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape']
  for (const page of ALL)
    for (const k of keys) {
      const a = routeKey(k, st({ page, paneFocus: false }))
      if (a.kind !== 'pass') bad.push(`${page}:${JSON.stringify(k)}=${show(a)}`)
    }
  expect(bad.join(' ')).toBe('')
})

test('keys: Esc with the pane focused closes it; in text mode it only leaves text mode', () => {
  expect(routeKey('Escape', st({ page: 'fleet' }))).toEqual({ kind: 'close' })
  expect(routeKey('Escape', st({ page: 'decide', textMode: true }))).toEqual({ kind: 'text_cancel' })
})

test('keys: decide text mode (`n`) — 1–8 and a–e are text, not page switches or picks', () => {
  expect(routeKey('n', st({ page: 'decide' })).kind).toBe('note')
  const bad: string[] = []
  for (const ch of [...DIGITS, ...LETTERS, 'n', 'u', 'x', 'f', 'j', 'k', 'h', 'l', 'i', '9', '0']) {
    const a = routeKey(ch, st({ page: 'decide', textMode: true }))
    if (show(a) !== show({ kind: 'text', ch })) bad.push(`${ch}=${show(a)}`)
  }
  expect(bad.join(' ')).toBe('')
  expect(routeKey('Enter', st({ page: 'decide', textMode: true }))).toEqual({ kind: 'text_save' })
})

test('keys: decide (not text mode) — 1–8 only switch page (own key stays), a–e pick option 0–4', () => {
  const bad: string[] = []
  DIGITS.forEach((d, i) => {
    const target = PAGES[i]?.id
    const a = routeKey(d, st({ page: 'decide' }))
    const want = target === undefined ? null : target === 'decide' ? { kind: 'none' } : { kind: 'page', to: target }
    if (want !== null && show(a) !== show(want)) bad.push(`${d}=${show(a)} want ${show(want)}`)
    if (a.kind === 'pick') bad.push(`${d} picks`)
  })
  LETTERS.forEach((l, i) => {
    const a = routeKey(l, st({ page: 'decide' }))
    if (show(a) !== show({ kind: 'pick', index: i })) bad.push(`${l}=${show(a)}`)
  })
  expect(bad.join(' ')).toBe('')
})

test('keys: one meaning per key — digits, 9, 0, ? switch page identically on every page', () => {
  const bad: string[] = []
  const special: Record<string, string> = { '9': 'pet', '0': 'forge', 'i': 'help' }
  for (const page of ALL) {
    for (const [k, to] of [...DIGITS.map((d, i) => [d, PAGES[i]?.id as string | undefined] as const), ...Object.entries(special)]) {
      if (to === undefined) continue
      const a = routeKey(k, st({ page }))
      const want = to === page ? { kind: 'none' } : { kind: 'page', to }
      if (show(a) !== show(want)) bad.push(`${page}:${k}=${show(a)}`)
    }
    // a–e and n/u/[/] mean something only on decide; elsewhere they are not page switches or picks
    if (page !== 'decide')
      for (const k of [...LETTERS, 'n', 'u', 'h', 'l']) {
        const a = routeKey(k, st({ page }))
        if (a.kind === 'pick' || a.kind === 'page' || a.kind === 'note') bad.push(`${page}:${k}=${show(a)}`)
      }
  }
  expect(bad.join(' ')).toBe('')
})
