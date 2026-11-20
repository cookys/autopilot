// v7.4 S1: the band's pane toggle (▴ closed / ▾ open) left of the host's `[-]`. Negative control: no prop, nothing new.
import { test, expect } from 'claude-code/testing'
import { BandBar, PANE_TOGGLE_CLOSED, BAND_CLOSE_ROOM } from './band'
import { GLYPHS } from '../tux/glyphs.ts'
import { makeT } from './i18n'
import { displayWidth } from './model'

type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') }
const walk = (n: any): Node[] => n == null || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [...(n.kind ? [n] : []), ...walk(n.props?.children)]
const flat = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : n?.props ? flat(n.props.children) : ''
const hd = { onInfo() {}, onSlot() {}, onTab() {} }
const row1 = (node: any): any => (Array.isArray(node.props.children) ? node.props.children[0] : node.props.children)
const draw = (cols: number, tog?: () => void, open = false) => BandBar(EL as never, null, cols, makeT('zh-TW'), hd, null, null, true, null, null, null, null, true, false, false, tog, open).node as Node

test('v74.a: toggle draws ▴ closed and fires onTogglePane', () => {
  let n = 0
  const btn = walk(draw(120, () => { n++ })).find(b => b.kind === 'Button' && b.props.key === 'pane-toggle')!
  expect(flat(btn)).toBe(PANE_TOGGLE_CLOSED)
  btn.props.onPress()
  expect(n).toBe(1)
})

test('v74.a: toggle draws ▾ when the pane is open', () => {
  const btn = walk(draw(120, () => {}, true)).find(b => b.kind === 'Button' && b.props.key === 'pane-toggle')!
  expect(flat(btn)).toBe(GLYPHS.structure.open)
})

test('v74.a: negative control — no prop draws no toggle', () => {
  const all = walk(draw(120))
  expect(all.some(b => b.props.key === 'pane-toggle')).toBe(false)
  expect(flat(all)).not.toContain(PANE_TOGGLE_CLOSED)
})

test('v74.a: row 1 stays within columns - BAND_CLOSE_ROOM + 1 at 80/120/209', () => {
  for (const cols of [80, 120, 209]) {
    const text = flat(row1(draw(cols, () => {})))
    expect(displayWidth(text)).toBeLessThanOrEqual(cols - BAND_CLOSE_ROOM + displayWidth(PANE_TOGGLE_CLOSED))
    expect(text.includes('\n')).toBe(false)
    expect(text.endsWith(PANE_TOGGLE_CLOSED)).toBe(true)
  }
})
