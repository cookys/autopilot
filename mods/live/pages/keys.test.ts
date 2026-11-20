// keys.test.ts — r2 §3.2 / v7.4 B key table
import { test, expect } from 'claude-code/testing'
import { routeKey } from './keys'
import { V74_KEY, PET_KEY } from '../v74/contract'

type St = { page: string; paneFocus: boolean; focusedButton: boolean; textMode: boolean }
const st = (o: Partial<St>): St => ({ page: 'now', paneFocus: true, focusedButton: false, textMode: false, ...o })
const ALL = [...new Set([...Object.keys(V74_KEY), 'pet', 'todo', 'quota', 'forge'])]
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const show = (x: unknown) => JSON.stringify(x)

test('keys: Enter on a focused Button is that Button only, on every page', () => {
  const bad: string[] = []
  for (const page of ALL) {
    const a = routeKey('Enter', st({ page, focusedButton: true }))
    if (a.kind !== 'button') bad.push(`${page}=${show(a)}`)
  }
  expect(bad.join(' ')).toBe('')
})

test('keys: Enter without focus folds (v7.4)', () => {
  expect(routeKey('Enter', st({ page: 'fleet' }))).toEqual({ kind: 'fold' })
})

test('keys: decide, s = submit', () => {
  expect(routeKey('s', st({ page: 'decide' }))).toEqual({ kind: 'submit' })
})

test('keys: Esc with focus in the prompt box is passed to Claude Code', () => {
  for (const page of ALL) {
    expect(routeKey('Escape', st({ page, paneFocus: false })).kind).toBe('pass')
  }
})

test('keys: digits 1–9 and pet 0 switch pages', () => {
  const bad: string[] = []
  for (const page of ALL) {
    for (const d of DIGITS) {
      const to = Object.entries(V74_KEY).find(([, k]) => k === d)?.[0]
      if (to === undefined) continue
      const a = routeKey(d, st({ page }))
      const want = to === page ? { kind: 'none' } : { kind: 'page', to }
      if (show(a) !== show(want)) bad.push(`${page}:${d}=${show(a)}`)
    }
    const p = routeKey(PET_KEY, st({ page }))
    const want0 = page === 'pet' ? { kind: 'none' } : { kind: 'page', to: 'pet' }
    if (show(p) !== show(want0)) bad.push(`${page}:0=${show(p)}`)
  }
  expect(bad.join(' ')).toBe('')
})

test('keys: a/b/c pick on decide and todo only (negative on now)', () => {
  expect(routeKey('a', st({ page: 'decide' }))).toEqual({ kind: 'pick', index: 0 })
  expect(routeKey('a', st({ page: 'todo' }))).toEqual({ kind: 'pick', index: 0 })
  expect(routeKey('a', st({ page: 'now' })).kind).toBe('none')
})