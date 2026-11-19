// Bottom-anchor goldens run through the same TSX compiler as live.test.ts.
// The small terminal implements the Box/Text flex subset used by the real views.
import { test, expect } from 'claude-code/testing'
import { Pane } from './pane'
import * as B from './band'
import * as M from './model'
import * as S from './scrollmath'
import * as U from './ui'
import { makeT } from './i18n'
import { parseConsole } from './console'
import { shellPlan } from './shell'
import { readLegacyUsage as parsePanel } from './panel'
import { speedView } from './speedview'
import full from './fixtures/console/console-full.fixture'
import { frameHeight, frameRows, stripRows } from './pages/frame'
import { PAGES } from './pages/index'

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
  const p = n.props ?? {}
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
function screen(tree, cols, rows) {
  const out = render(tree, cols, rows)
  // A spare trigger may make the tree taller than the viewport; never discard
  // a control row in the assertions by silently trimming trailing blanks.
  return out.slice(0, rows)
}
function footer(tree, out) {
  const nodes = walk(tree)
  // the pane's strip is the 'tabs' Box (the `›` chip is gone); the renderer-control fixture still marks its strip with a 'next' child
  const tabsBox = nodes.find(n => n.type === 'Box' && n.props?.key === 'tabs')
  const strip = (tabsBox === undefined ? undefined : tabsBox.children[tabsBox.children.length - 1]) ?? nodes.find(n => n.type === 'Box' && n.children.some(c => c?.props?.key === 'next'))
  assert.ok(strip, 'real tab strip exists')
  const label = textOf(strip).trim()
  assert.ok(out[lastInk(out)].includes(label), 'last visible row must be the tab labels: ' + JSON.stringify(out[lastInk(out)]))
  assert.equal(lastInk(out), out.length - 1, 'no blank row below the controls')
}
function bottomAligned(tree, out, cols, win) {
  footer(tree, out)
  if (win.max === 0) assert.equal(out[0].trim(), '', 'short content must leave top blank rows')
  const nodes = walk(tree)
  const fixed = nodes.find(n => n.props?.key === 'fixed')
  const chrome = fixed === undefined ? [nodes.find(n => n.props?.key === 'tabs')] : fixed.children.slice(fixed.children.findIndex(n => n.props?.key === 'rule'))
  const chromeRows = chrome.flatMap(n => render(n, cols)).length
  const above = out[out.length - chromeRows - 1]
  // A scrollbar thumb must not make an otherwise blank content row pass.
  assert.ok(cut(above, cols - (win.max > 0 ? 1 : 0)).trim() !== '', 'content directly above bottom rule/chrome must be non-blank')
}

test('renderer controls: top alignment and a trailing spacer are distinguishable from bottom alignment', () => {
  const text = el.Box({ children: [el.Text({ key: 'next', children: ['fixture'] })] })
  const tree = justifyContent => el.Box({ flexDirection: 'column', justifyContent, children: [text] })
  assert.deepEqual(render(tree('flex-end'), 8, 3).map(x => x.trim()), ['', '', 'fixture'])
  assert.deepEqual(render(tree(undefined), 8, 3).map(x => x.trim()), ['fixture', '', ''])
  footer(tree('flex-end'), render(tree('flex-end'), 8, 3))
  expect(() => footer(tree(undefined), render(tree(undefined), 8, 3))).toThrow()
  const trailing = el.Box({ flexDirection: 'column', justifyContent: 'flex-end', children: [text, el.Text({ children: [' '] })] })
  expect(() => footer(trailing, render(trailing, 8, 3))).toThrow()
})
for (const [cols, rows] of [[160, 40], [80, 24]]) {
  for (const tab of M.PANE_TABS) test(`pane ${tab} ${cols}x${rows}: footer last, short content leaves blanks above`, () => {
    const { tree, win } = pane(tab, cols, rows)
    const out = screen(tree, cols, rows)
    bottomAligned(tree, out, cols, win)
    const short = pane(tab, cols, rows, { live: null })
    const shortRows = screen(short.tree, cols, rows)
    bottomAligned(short.tree, shortRows, cols, short.win)
    assert.equal(shortRows[0].trim(), '', 'short-content case leaves blank rows above on every tab')
    if (tab === 'decide') {
      const joined = out.join('\n')
      assert.ok(joined.includes('待決在 band 上（d）'), 'the retired decide page is the one band line')
      assert.ok(!joined.includes('Last option') && !joined.includes('Fixture reason'), 'the pane no longer draws the decision card')
    }
  })
  for (const tab of ['command', 'team', 'quota', 'hosts', 'self']) test(`console ${tab} ${cols}x${rows}: footer last, short content leaves blanks above`, () => {
    const { tree, win } = pane(tab, cols, rows, { con: true })
    const out = screen(tree, cols, rows)
    bottomAligned(tree, out, cols, win)
    const short = pane(tab, cols, rows, { con: true, live: null, conSnap: null })
    bottomAligned(short.tree, screen(short.tree, cols, rows), cols, short.win)
    if (tab === 'command') {
      const option = out.findIndex(r => r.includes('Last option'))
      const advice = out.findIndex(r => r.includes('Fixture reason'))
      const submit = out.findIndex(r => r.includes('送出'))
      assert.ok(option >= 0 && advice > option && submit > advice && submit - advice <= 2, 'held card answer area directly precedes submit, with options before advice')
      assert.ok(out.slice(submit + 1).every(r => /指揮|[─━]/.test(r)), 'only navigation follows submit')
    }
  })
  test(`pane waiting ${cols}x${rows}: short-content fallback is bottom anchored`, () => {
    const { tree } = pane('now', cols, rows, { live: null })
    const out = screen(tree, cols, rows)
    footer(tree, out)
    assert.equal(out[0].trim(), '')
  })
  test(`scroll ${cols}x${rows}: the retired decide page is one line, so thirty cards do not scroll`, () => {
    const live = snap()
    live.pending = Array.from({ length: 30 }, (_, i) => ({ ...HELD, id: 'd-' + i, question: 'Older fixture ' + i }))
    const win = S.newScroll()
    const drawn = pane('decide', cols, rows, { live, win })
    const out = screen(drawn.tree, cols, rows)
    assert.equal(win.max, 0, 'the one line does not overflow')
    assert.equal(win.offset, 0)
    assert.ok(out.some(r => r.includes('待決在 band 上（d）')))
    assert.ok(!out.some(r => r.includes('Older fixture')))
    footer(drawn.tree, out)
  })
  test(`band speed ${cols}x${rows}: real speed content grows above band`, () => {
    const bar = B.BandBar(el, snap(), cols, t, { onInfo() {}, onSlot() {}, onTab() {} }, 'forge', null)
    const view = speedView([], 6, cols, t)
    const tree = B.stackBand(el, bar.node, B.speedContent(el, view.columns, null, 'stack'))
    const out = render(tree, cols)
    // the band is two rows (summary, then the strip); the last ink row is the strip, first tab label to last
    const tabs = walk(bar.node).filter(n => String(n.props?.key ?? '').startsWith('tab:') || n.props?.key === 'forge')
    const last = out[lastInk(out)].trim()
    assert.ok(tabs.length > 0 && last.startsWith(textOf(tabs[0]).trim()) && last.endsWith(textOf(tabs[tabs.length - 1]).trim()), JSON.stringify(last))
  })
}

test('shell: the menu row is second to last and the quick row is last (r5: operator rule, bottom next to the prompt)', () => {
  const plan = shellPlan({ columns: 160, t, menuTitle: 'fixture menu', mainTitle: 'fixture main', room: { rows: [], fresh: 0 }, panel: parsePanel(null, 0), fleet: [] })
  const bar = el.Text({ children: ['fixture band'] })
  const main = [el.Text({ children: ['fixture card options'] })]
  const tree = B.stackRows(el, B.Shell(el, { plan, left: [], onLeft() {}, main, progress: el.Text({ children: ['fixture progress'] }), quick: [el.Text({ children: ['fixture submit'] })], bar }))
  const out = render(tree, 160)
  const last = lastInk(out)
  assert.equal(out[last].trim(), 'fixture submit', 'the quick row is the last band row')
  assert.equal(out[last - 1].trim(), 'fixture band', 'r5: the menu row is the row just above the quick row')
  const opt = out.findIndex(r => r.includes('fixture card options'))
  assert.equal(opt, 1, 'a short main sits on the first body row, under the top frame')
})

test('shell overflow: default opens at bottom, scrolling up survives redraw', () => {
  const model = S.newScroll()
  const top = Array.from({ length: 30 }, (_, i) => el.Text({ children: ['fixture history ' + i] }))
  const draw = () => B.cardSplit(el, t, { top, strip: [el.Text({ children: ['fixture options'] })], room: 12, cells: 60, model, onPage() {} })
  draw()
  assert.ok(model.max > 0)
  assert.equal(model.offset, model.max)
  S.applyScroll(model, { by: -3, contentRows: 30 })
  const offset = model.offset
  draw()
  assert.equal(model.offset, offset)
})

const R14_SIZES = [[80, 24, 'inline'], [120, 30, 'dock'], [160, 40, 'dock']] as const
const rowText = row => row.map(s => s.text).join('')

test('R14: every page bottom-anchors short content in a fixed frame at all three sizes and H=5..7', () => {
  const sizes = [...R14_SIZES, ...[60, 80, 120, 160].flatMap(cols => [5, 6, 7].map(rows => [cols, rows, 'dock'] as const))]
  for (const [cols, available, placement] of sizes) for (const page of PAGES) {
    const H = frameHeight(available, placement)
    const ctx = { live: null, console: null, size: { cols, rows: H }, t, nowMs: 0 }
    const body = [[{ text: page.id + ' first' }], [{ text: page.id + ' last' }]]
    const actions = [[{ text: page.id + ' action' }]]
    const out = frameRows({ ...page, render: () => ({ body, actions }) }, ctx).map(rowText)
    const S = stripRows(page, ctx).length
    const kept = body.slice(0, Math.min(body.length, H - S - 2)).map(rowText)
    const at = out.indexOf(kept[0])
    const action = out.indexOf(page.id + ' action')
    const label = page.id + ' ' + cols + 'x' + H
    expect(out.length, label).toBe(H)
    expect(out[0], label + ' header').toBe(t('tab.' + page.id))
    expect(action, label + ' action precedes strip').toBe(H - S - 1)
    expect(out.slice(-S), label + ' strip remains last').toEqual(stripRows(page, ctx).map(rowText))
    expect(out.slice(at, action), label + ' content order and adjacency').toEqual(kept)
    expect(out.slice(1, at).every(r => r.trim() === ''), label + ' padding only above content').toBe(true)
    expect(at - 1, label + ' all spare rows are above content').toBe(H - S - 2 - kept.length)
  }
})

test('R14: real page content ends directly above actions with null or short snapshots', () => {
  for (const [cols, available, placement] of R14_SIZES) for (const page of PAGES) for (const live of [null, snap()]) {
    const H = frameHeight(available, placement)
    const ctx = { live, console: null, size: { cols, rows: H }, t, nowMs: 1794200000000 }
    const source = page.render(ctx)
    const out = frameRows(page, ctx).map(rowText)
    const S = stripRows(page, ctx).length
    const action = H - S - Math.max(1, source.actions.length)
    const body = out.slice(1, action)
    const label = page.id + ' ' + cols + 'x' + H
    expect(out.length, label).toBe(H)
    if (source.body.length === 0) expect(body.every(r => r.trim() === ''), label + ' empty body').toBe(true)
    else {
      expect(body[body.length - 1].trim(), label + ' content touches actions').not.toBe('')
      const first = body.findIndex(r => r.trim() !== '')
      expect(body.slice(0, first).every(r => r.trim() === ''), label + ' leading padding').toBe(true)
    }
  }
})

test('R14 mounted: every page keeps content adjacent to actions at 80x24 inline and 120x30/160x40 dock', async ($, on) => {
  on('clock.now', () => ({ value: 1794200000000 }))
  for (const [columns, rows, placement] of R14_SIZES) {
    const cols = placement === 'dock' ? columns / 2 : columns
    const mounted = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'Pane', requestId: 'autopilot-live', props: { title: 'Autopilot', isFocused: true, bodyColumns: cols, placement, scroll: { offset: 0, bodyRows: rows }, view: { agentId: undefined } }, viewport: { columns, rows, isFullscreen: true } })
    for (const page of PAGES) {
      const home = (await mounted.findAll({ type: 'Button' })).find(b => b.props.hotkey === '1' || b.props.key === 'now')
      expect(home, 'return to the modern page strip').toBeDefined()
      await mounted.press({ key: home!.props.key })
      const button = (await mounted.findAll({ type: 'Button' })).find(b => b.props.hotkey === page.key)
      expect(button, 'page ' + page.id + ' is reachable').toBeDefined()
      await mounted.press({ key: button!.props.key })
      const tree = await mounted.drawn()
      if (!page.framed) {
        // These registry shells still use the original pane renderer. Exercise
        // that real selection and its bottom controls, without replacing content.
        const out = screen(tree, cols, rows)
        const tabs = walk(tree).find(n => n.props?.key === 'tabs')
        expect(tabs, page.id + ' strip exists').toBeDefined()
        const chrome = render(tabs, cols)
        expect(chrome.length, page.id + ' strip has visible rows').toBeGreaterThan(0)
        expect(out.length, page.id + ' fixed viewport').toBe(rows)
        expect(out.slice(-chrome.length), page.id + ' strip is last').toEqual(chrome)
        expect(out[out.length - chrome.length - 1].trim(), page.id + ' content touches strip').not.toBe('')
        expect(out[0].trim(), page.id + ' spare rows precede content').toBe('')
        continue
      }
      const rendered = walk(tree).filter(n => /^f\d+$/.test(n.props?.key ?? '')).map(textOf)
      const S = cols < 66 ? 2 : 1
      const action = rendered.length - S - 1 // no snapshot: every page has the single empty-state action
      const label = page.id + ' ' + columns + 'x' + rows
      expect(rendered.length, label + ' fixed height').toBe(rows)
      expect(rendered[action].trim(), label + ' action exists').not.toBe('')
      if (page.id === 'decide') {
        expect(rendered.join('\n'), label + ' retired').toMatch(/待決在 band 上（d）|Pending is on the band \(d\)/)
        continue
      }
      expect(rendered[action - 1].trim(), label + ' content touches action').not.toBe('')
      // K1: help now starts at its header in the shared frame; its long body fills the room.
      if (page.id === 'help') expect(rendered[0].trim(), label + ' header first').toMatch(/^(Help|說明)$/)
      else expect(rendered[1].trim(), label + ' spare rows precede content').toBe('')
    }
    await mounted.unmount()
  }
})
