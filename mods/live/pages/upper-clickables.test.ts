// upper-clickables.test.ts — operator rules R1 (the action area sits at the bottom; nothing clickable in the upper half) and R6 (pressing a
// always picks the option labelled A). PM 01M88CCDQD items 3-4. Mechanical: no eyeballing of screenshots.
import { test, expect } from 'claude-code/testing'
import decideFx from '../fixtures/v74/decide.fixture'
import todoFx from '../fixtures/v74/todo.fixture'
import { frameRows } from './frame'
import { PAGES } from './index'
import { consoleOf, NOW } from './quota.fixture'
import { makeT } from '../i18n'
import { upperClickables } from './upper-clickables'
import { PICK_KEYS, pickIndex, pickKeys } from '../v74/contract'
import type { DecideCard, TodoCard, V74Ctx } from '../v74/contract'
import type { Row } from './rows'

const t = makeT('zh-TW')
const text = (r: Row): string => r.map(s => s.text).join('')
const v74 = (): V74Ctx => ({ pm: null, pmFetchedMs: null, decide: decideFx as DecideCard[], todo: todoFx as TodoCard[], nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } })
const SIZES: [number, number][] = [[80, 24], [120, 40], [200, 50]]

// known: moves in the R1 redesign ticket. Page id + the clickable seg's text as drawn today in the upper half.
// Any clickable in the upper half that is not listed here fails the test; a listed one that disappears is fine.
const KNOWN = new Set<string>([
  // measured 2026-11-25 on this base (docked: the expanded card's options and note; boxed: the card list rows)
  'decide a: 合併 ✧', 'decide b: 再審一輪', 'decide c: 待辦', 'decide m 附註：',
  'decide 02 外掛更新時機', 'decide 03 預覽先拍幾欄',
])

const measure = (boxed: boolean): string[] => {
  const found: string[] = []
  for (const page of PAGES) for (const [cols, rows] of SIZES) {
    const ctx = { live: null, console: consoleOf(null, { decisions: (decideFx as DecideCard[]).length }), size: { cols, rows }, t, nowMs: NOW, v74: v74(), ...(boxed ? { box: true, maxRows: rows } : {}) } as never
    const framed = frameRows(page, ctx)
    for (const i of upperClickables(framed, framed.length)) {
      for (const s of framed[i]) if (s.press !== undefined) found.push(page.id + ' ' + s.text.trim())
    }
  }
  return [...new Set(found)].sort()
}

for (const boxed of [false, true]) {
  test('R1: no clickable in the upper half of any page at 80x24 / 120x40 / 200x50 beyond the known list (' + (boxed ? 'boxed' : 'docked') + ')', () => {
    expect(measure(boxed).filter(k => !KNOWN.has(k))).toEqual([])
  })
}

test('R1 reverse control: a clickable planted in row 0 is reported, so the check fails', () => {
  const page = PAGES.find(p => p.id === 'now')!
  const framed = frameRows(page, { live: null, console: null, size: { cols: 80, rows: 24 }, t, nowMs: NOW, v74: v74() } as never)
  const planted: Row[] = [[{ text: 'planted', press: 'key:x' }], ...framed.slice(1)]
  expect(upperClickables(planted, planted.length)).toContain(0)
  expect(upperClickables(planted, planted.length).filter(i => !upperClickables(framed, framed.length).includes(i))).toEqual([0])
})

// R6: does pressing the key `a` select the option labelled A? `keysOf` maps options to their pick keys.
const aPicksA = (keysOf: (o: { label: string }[]) => string[], options: { label: string }[]): boolean =>
  options[keysOf(options).indexOf('a')]?.label.startsWith('A') === true
const positional = (o: { label: string }[]): string[] => o.map((_, i) => String(PICK_KEYS[i] ?? ''))

test('R6: options [B, A] — key a picks the option labelled A, through pickKeys and pickIndex', () => {
  const ba = [{ label: 'B 先不要' }, { label: 'A 可以' }]
  expect(pickKeys(ba)).toEqual(['b', 'a'])
  expect(aPicksA(pickKeys, ba)).toBe(true)
  expect(pickIndex(ba, PICK_KEYS.indexOf('a'))).toBe(1)
})

test('R6 reverse control: the old positional mapping fails the [B, A] case', () => {
  expect(aPicksA(positional, [{ label: 'B 先不要' }, { label: 'A 可以' }])).toBe(false)
})

test('R6: no letters → positional; duplicate letters → positional; a letter outside a/b/c → positional', () => {
  expect(pickKeys([{ label: '合併' }, { label: '再審' }])).toEqual(['a', 'b'])
  expect(pickKeys([{ label: 'A 一' }, { label: 'A 二' }])).toEqual(['a', 'b'])
  expect(pickKeys([{ label: 'D 一' }, { label: 'A 二' }])).toEqual(['a', 'b'])
  expect(new Set(pickKeys([{ label: 'B 一' }, { label: '二' }])).size).toBe(2) // a claim never collides with another option's key
})
