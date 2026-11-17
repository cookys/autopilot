// fixed-height.test.ts — r2 §3 / §6 (codeforge plan 2026-11-18-pane-tabs-r2, PM 01M7N33J): the band and the pane keep one row count in every state.
// Harness (el, norm, render, walk, snap, acts) copied from bottom-anchor.test.ts; S0 may move it to a shared testkit.
import { test, expect } from 'claude-code/testing'
import { Pane } from './pane'
import * as B from './band'
import * as M from './model'
import * as S from './scrollmath'
import * as U from './ui'
import { makeT } from './i18n'
import { parseConsole } from './console'
import { shellPlan, parsePanel } from './shell'
import { speedView } from './speedview'
import full from './fixtures/console/console-full.fixture'

const assert = {
  ok(value: unknown, message?: string) { expect(Boolean(value), message).toBe(true) },
  equal(actual: unknown, expected: unknown, message?: string) { expect(actual, message).toBe(expected) },
  deepEqual(actual: unknown, expected: unknown) { expect(actual).toEqual(expected) },
  fail(message: string): never { throw new Error(message) },
}
const children = xs => xs.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false)
const el = Object.fromEntries(['Box', 'Text', 'Link', 'Button', 'Input'].map(type => [type, props => ({ type, props, children: children([props.children]) })]))
// The host compiler returns JSX nodes; evaluate their functional element types
// just as consoleframe.test.ts does, then hand plain nodes to the terminal.
function norm(n) {
  if (n === null || n === undefined || n === false || typeof n !== 'object') return n
  if (typeof n.type === 'function') return norm(n.type(n.props))
  return { ...n, children: children([n.children ?? n.props?.children]).map(norm) }
}
const t = makeT('zh-TW')
const textOf = n0 => { const n = norm(n0); return typeof n === 'string' ? n : n.type === 'Input' ? n.props.placeholder : n.type === 'Link' ? n.props.label : n.children.map(textOf).join('') }
const cut = (s, w) => S.sliceCells(s, 0, w)
const pad = (s, w) => cut(s, w) + ' '.repeat(Math.max(0, w - U.displayWidth(cut(s, w))))
const blank = w => ' '.repeat(w)

// Intrinsic height first, then distribute the available column height to flexGrow
// children. Row Boxes share a height; fixed-width cells and flexGrow share width.
function render(n0, width, givenHeight?) {
  const n = norm(n0)
  if (n === null || n === undefined) return []
  if (typeof n === 'string') return [cut(n, width)]
  const p = n.props
  width = p.width ?? width
  const height = p.height ?? givenHeight
  if (n.type !== 'Box') {
    const text = textOf(n)
    const rows = text === '' ? [] : p.wrap === 'wrap' ? S.wrapCells(text, width) : [cut(text, width)]
    return rows
  }
  const xs = children(n.children)
  let rows
  if (p.flexDirection === 'column') {
    const natural = xs.map(x => render(x, width))
    const used = natural.reduce((a, r) => a + r.length, 0)
    const grows = xs.reduce((a, x) => a + (x.props?.flexGrow ?? 0), 0)
    const extra = Math.max(0, (height ?? used) - used)
    rows = xs.flatMap((x, i) => render(x, width, natural[i].length + (grows ? Math.floor(extra * (x.props?.flexGrow ?? 0) / grows) : 0)))
    if (height !== undefined && p.justifyContent === 'flex-end' && rows.length < height) rows.unshift(...Array.from({ length: height - rows.length }, () => blank(width)))
  } else {
    const widths = xs.map(x => x.props?.width ?? (x.props?.flexGrow ? 0 : Math.min(width, U.displayWidth(textOf(x)))))
    const used = widths.reduce((a, w) => a + w, 0)
    const grows = xs.reduce((a, x) => a + (x.props?.flexGrow ?? 0), 0)
    const parts = xs.map((x, i) => {
      const w = widths[i] + (grows ? Math.floor(Math.max(0, width - used) * (x.props?.flexGrow ?? 0) / grows) : 0)
      return { w, rows: render(x, w, height) }
    })
    const h = Math.max(0, ...parts.map(x => x.rows.length))
    rows = Array.from({ length: h }, (_, i) => parts.map(x => pad(x.rows[i] ?? '', x.w)).join(''))
  }
  if (height !== undefined) {
    if (rows.length < height) rows.push(...Array.from({ length: height - rows.length }, () => blank(width)))
    if (p.overflow === 'hidden') rows = rows.slice(0, height)
  }
  return rows.map(r => cut(r, width))
}
const walk = n0 => { const n = norm(n0); return n && typeof n !== 'string' ? [n, ...n.children.flatMap(walk)] : [] }
const lastInk = rows => rows.findLastIndex(r => r.trim() !== '')
const HELD = { id: 'd-fixture', title: 'Anchor fixture', question: 'Choose the next step', background: null, options: [{ label: 'A', description: 'First option' }, { label: 'B', description: 'Last option' }], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 1 }
const snap = () => ({ state: 'ok', text: 'fixture', header: 'fixture', band: { kind: 'decide', verdict: '要你決定', reason: null, project: 'fixture', elapsed: '1m', phase: '', slots: [] }, pending: [{ ...HELD, background: 'Fixture context', recommendation: 'A', why: 'Fixture reason' }], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: 1794200000000, spend: { session: '$1', host_all: '$2', host_all_n: 2, brain: null, cap: null, mode: 'fixture' } } })
const acts = { state: { ...M.NO_DECIDE, picks: { 'd-fixture': 0 } }, inputs: false, onPress() {}, onNote() {}, onKeep() {} }
const consoleSnap = () => parseConsole(JSON.stringify(full))
function pane(tab, cols, rows, { live = snap(), win = S.newScroll(), con = false, conSnap = consoleSnap() } = {}) {
  const console = con ? { nav: { snap: conSnap, tab }, onTab() {}, onNext() {}, live, decide: acts, scroll: { offset: 0, bodyRows: rows }, win } : null
  return { tree: Pane(el, live, con ? 'now' : tab, () => {}, t, cols, () => {}, new Set(), () => {}, new Set(), { offset: 0, bodyRows: rows }, acts, win, null, console), win }
}
// r2 §3.1: the band is always this many rows (strip + one summary row), open or closed, on every tab.
const BAND_ROWS_FIXED = 2
const bandRows = (active, cols, live = snap()) => {
  const bar = B.BandBar(el, live, cols, t, { onInfo() {}, onSlot() {}, onTab() {} }, active, null)
  const body = active === null || active === 'forge' ? [] : B.barContent(el, live, active, cols, t, { onSlot() {}, onOpen() {} })
  const tree = B.stackRows(el, [bar.node, ...body])
  return { tree, rows: render(tree, cols) }
}
const STATES = [['one card', () => snap()], ['no card', () => ({ ...snap(), pending: [], band: { ...snap().band, kind: 'idle', verdict: '', slots: [] } })]]

for (const cols of [160, 120, 80]) {
  test(`band: ${cols} columns, ${BAND_ROWS_FIXED} rows closed and on every tab, in every state (r2 §3.1)`, () => {
    const seen = []
    for (const [name, live] of STATES)
      for (const active of [null, 'now', 'decide', 'dispatch', 'review', 'usage'])
        seen.push(`${name}/${active ?? 'closed'}=${bandRows(active, cols, live()).rows.length}`)
    const bad = seen.filter(s => !s.endsWith('=' + BAND_ROWS_FIXED))
    assert.equal(bad.join(' '), '', `band row count must be ${BAND_ROWS_FIXED} everywhere; got ${seen.join(' ')}`)
  })
}

test('band: no transition artefacts — no open-panel button, no › next chip (r2 §3.2, UX gate 沒有過渡產物)', () => {
  const found = []
  for (const active of [null, 'now', 'decide', 'dispatch', 'review', 'usage'])
    for (const n of walk(bandRows(active, 120).tree)) {
      const id = String(n.props?.id ?? n.props?.key ?? '')
      const label = n.type === 'Button' ? textOf(n).trim() : ''
      if (id.startsWith('open:') || label === t('bar.open') || label === '›') found.push(`${active ?? 'closed'}:${id || label}`)
    }
  assert.equal(found.join(' '), '', 'band must open the pane from the tab strip only')
})

// Legacy Pane (faa6b4cb6): the harness's bodyRows draws H+1 everywhere, so here only "every tab and state draws the same count" is
// asserted; the exact-H check is pages/frame.golden.test.ts on frameRows (S0).
for (const [cols, rows] of [[160, 40], [120, 30], [80, 24]]) {
  test(`pane: ${cols}x${rows}, every tab and state draws the same row count (r2 §3.1)`, () => {
    const seen = []
    for (const [name, live] of STATES)
      for (const tab of M.PANE_TABS)
        seen.push([`${name}/${tab}`, render(pane(tab, cols, rows, { live: live() }).tree, cols, rows).length])
    const counts = new Set(seen.map(([, n]) => n))
    assert.equal(counts.size, 1, `pane row count must not change between tabs/states; got ${seen.map(([k, n]) => k + '=' + n).join(' ')}`)
  })
}
