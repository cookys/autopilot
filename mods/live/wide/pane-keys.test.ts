// console v5 P2: the wide pane's keys (pages/keys.ts). Digits jump pages and `e` folds / opens the context, only in W; every other width keeps its key table.
import { test, expect } from 'claude-code/testing'
import { routeKey } from '../pages/keys'
import { V74_PAGES } from '../v74/contract'

const st = (o: Record<string, unknown>) => ({ page: 'now', paneFocus: true, focusedButton: false, textMode: false, ...o })

test('P2 wide keys: e toggles the context on every page but 待決, in W only', () => {
  for (const page of V74_PAGES.filter(p => p !== 'decide')) {
    expect(routeKey('e', st({ page, wide: true }))).toEqual({ kind: 'toggle_ctx' })
    expect(routeKey('e', st({ page }))).toEqual({ kind: 'none' }) // the v7.4 table: e means nothing outside 待決
    expect(routeKey('e', st({ page, wide: false }))).toEqual({ kind: 'none' })
  }
  expect(routeKey('e', st({ page: 'decide', wide: true }))).toEqual({ kind: 'expand' }) // 待決 keeps its own e (P3)
})

test('P2 wide keys: digits 1-9 jump to the page with the pane focused; the current page stays put', () => {
  V74_PAGES.forEach((to, i) => {
    const act = routeKey(String(i + 1), st({ page: 'now', wide: true }))
    expect(act).toEqual(to === 'now' ? { kind: 'none' } : { kind: 'page', to })
  })
})

test('P2 wide keys: with the prompt holding the keyboard every key is passed back; a note being typed keeps e as text', () => {
  expect(routeKey('e', st({ page: 'now', wide: true, paneFocus: false }))).toEqual({ kind: 'pass' })
  expect(routeKey('e', st({ page: 'decide', wide: true, textMode: true }))).toEqual({ kind: 'text', ch: 'e' })
})
