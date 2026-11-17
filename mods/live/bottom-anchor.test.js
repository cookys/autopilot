'use strict'
// Render the REAL TSX views, not a parallel implementation of their row order.
// Install the test-only compiler with: npm ci --offline --prefix mods/live
// The small terminal below implements the Box/Text flex subset these views use;
// geometry controls prove that top alignment and bottom padding fail the golden.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => {
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, jsxFactory: '__jsx',
  } })
  mod._compile(result.outputText, file)
}
const children = xs => xs.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false)
global.__jsx = (tag, props, ...xs) => tag({ ...props, children: children(xs) })
const el = Object.fromEntries(['Box', 'Text', 'Link', 'Button', 'Input'].map(type => [type, props => ({ type, props, children: props.children ?? [] })]))
// Red/green replay can point at immutable base product sources while keeping
// this same test artifact and fixtures. Normal runs always use this directory.
const source = process.env.AUTOPILOT_ANCHOR_SOURCE ?? __dirname
const load = name => require(path.join(source, name))
const { Pane } = load('pane.tsx')
const B = load('band.tsx')
const M = load('model.ts')
const S = load('scrollmath.ts')
const U = load('ui.ts')
const { makeT } = load('i18n.ts')
const { parseConsole } = load('console.ts')
const { shellPlan, parsePanel } = load('shell.ts')
const { speedView } = load('speedview.ts')
const t = makeT('zh-TW')
const textOf = n => typeof n === 'string' ? n : n.type === 'Input' ? n.props.placeholder : n.type === 'Link' ? n.props.label : n.children.map(textOf).join('')
const cut = (s, w) => S.sliceCells(s, 0, w)
const pad = (s, w) => cut(s, w) + ' '.repeat(Math.max(0, w - U.displayWidth(cut(s, w))))
const blank = w => ' '.repeat(w)

// Intrinsic height first, then distribute the available column height to flexGrow
// children. Row Boxes share a height; fixed-width cells and flexGrow share width.
function render(n, width, givenHeight) {
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
const walk = n => n && typeof n !== 'string' ? [n, ...n.children.flatMap(walk)] : []
const lastInk = rows => rows.findLastIndex(r => r.trim() !== '')
const HELD = { id: 'd-fixture', title: 'Anchor fixture', question: 'Choose the next step', background: null, options: [{ label: 'A', description: 'First option' }, { label: 'B', description: 'Last option' }], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 1 }
const snap = () => ({ state: 'ok', text: 'fixture', header: 'fixture', band: { kind: 'decide', verdict: '要你決定', reason: null, project: 'fixture', elapsed: '1m', phase: '', slots: [] }, pending: [{ ...HELD, background: 'Fixture context', recommendation: 'A', why: 'Fixture reason' }], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: 1794200000000, spend: { session: '$1', host_all: '$2', host_all_n: 2, brain: null, cap: null, mode: 'fixture' } } })
const acts = { state: { ...M.NO_DECIDE, picks: { 'd-fixture': 0 } }, inputs: false, onPress() {}, onNote() {}, onKeep() {} }
const consoleSnap = () => parseConsole(fs.readFileSync(path.join(__dirname, 'fixtures/console/c0/console-full.json'), 'utf8'))
function pane(tab, cols, rows, { live = snap(), win = S.newScroll(), con = false } = {}) {
  const console = con ? { nav: { snap: consoleSnap(), tab }, onTab() {}, onNext() {}, live, decide: acts, scroll: { offset: 0, bodyRows: rows }, win } : null
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
  const strip = nodes.find(n => n.type === 'Box' && n.children.some(c => c?.props?.key === 'next'))
  assert.ok(strip, 'real tab strip exists')
  const label = textOf(strip).trim()
  assert.ok(out[lastInk(out)].includes(label), 'last visible row must be the tab labels: ' + JSON.stringify(out[lastInk(out)]))
  assert.equal(lastInk(out), out.length - 1, 'no blank row below the controls')
}

test('renderer controls: top alignment and a trailing spacer are distinguishable from bottom alignment', () => {
  const text = el.Text({ children: ['fixture'] })
  const tree = justifyContent => el.Box({ flexDirection: 'column', justifyContent, children: [text] })
  assert.deepEqual(render(tree('flex-end'), 8, 3).map(x => x.trim()), ['', '', 'fixture'])
  assert.deepEqual(render(tree(undefined), 8, 3).map(x => x.trim()), ['fixture', '', ''])
})
for (const [cols, rows] of [[160, 40], [80, 24]]) {
  for (const tab of M.PANE_TABS) test(`pane ${tab} ${cols}x${rows}: footer last, short content leaves blanks above`, () => {
    const { tree, win } = pane(tab, cols, rows)
    const out = screen(tree, cols, rows)
    footer(tree, out)
    if (win.max === 0) assert.ok(out[0].trim() === '', 'short fixture must leave top blank rows')
    const short = pane(tab, cols, rows, { live: null })
    const shortRows = screen(short.tree, cols, rows)
    footer(short.tree, shortRows)
    assert.equal(shortRows[0].trim(), '', 'short-content case leaves blank rows above on every tab')
    if (tab === 'decide') {
      const opt = out.findIndex(r => r.includes('Last option'))
      const send = out.findIndex(r => r.includes('送出'))
      assert.ok(opt >= 0 && send > opt, 'option and submit are visible')
      assert.ok(send - opt <= 2, 'L3 directly below options, at most one rule: ' + JSON.stringify(out.slice(opt, send + 1)))
      assert.ok(out.slice(send + 1).every(r => /現況|[─━]/.test(r)), 'only navigation may follow submit')
    }
  })
  for (const tab of ['command', 'team', 'quota', 'hosts', 'self']) test(`console ${tab} ${cols}x${rows}: footer last`, () => {
    const { tree } = pane(tab, cols, rows, { con: true })
    const out = screen(tree, cols, rows)
    footer(tree, out)
    if (tab === 'command') {
      const option = out.findIndex(r => r.includes('Last option'))
      const submit = out.findIndex(r => r.includes('送出'))
      assert.ok(option >= 0 && submit > option && submit - option <= 2, 'held card options directly precede submit')
      assert.ok(out.slice(submit + 1).every(r => /指揮|[─━]/.test(r)), 'only navigation follows submit')
    }
  })
  test(`pane waiting ${cols}x${rows}: short-content fallback is bottom anchored`, () => {
    const { tree } = pane('now', cols, rows, { live: null })
    const out = screen(tree, cols, rows)
    footer(tree, out)
    assert.equal(out[0].trim(), '')
  })
  test(`scroll ${cols}x${rows}: bottom default, up reveals older rows, End returns to hot rows`, () => {
    const live = snap()
    live.pending = Array.from({ length: 30 }, (_, i) => ({ ...HELD, id: 'd-' + i, question: 'Older fixture ' + i }))
    const win = S.newScroll()
    let drawn = pane('decide', cols, rows, { live, win })
    assert.ok(win.max > 0)
    assert.equal(win.offset, win.max, 'overflow opens at bottom')
    assert.ok(screen(drawn.tree, cols, rows).some(r => r.includes('Older fixture 29')))
    const ev = { by: -rows, bodyRows: rows, contentRows: rows + 1, offset: 0 }
    S.scrollHook(win, ev, () => assert.fail('framed keys must stay in the mod'), () => {})
    const off = win.offset
    drawn = pane('decide', cols, rows, { live, win })
    assert.equal(win.offset, off, 'redraw preserves the scrolled-up view')
    assert.ok(!screen(drawn.tree, cols, rows).some(r => r.includes('Older fixture 29')))
    S.scrollHook(win, { ...ev, by: rows + 1, offset: 1 }, () => assert.fail('End belongs to the frame'), () => {})
    drawn = pane('decide', cols, rows, { live, win })
    assert.equal(win.offset, win.max)
    footer(drawn.tree, screen(drawn.tree, cols, rows))
  })
  test(`band speed ${cols}x${rows}: real speed content grows above band`, () => {
    const bar = B.BandBar(el, snap(), cols, t, { onInfo() {}, onSlot() {}, onTab() {} }, 'forge', null)
    const view = speedView([], 6, cols, t)
    const tree = B.stackBand(el, bar.node, B.speedContent(el, view.columns, null, 'stack'))
    const out = render(tree, cols)
    assert.equal(textOf(bar.node).trim(), out[lastInk(out)].trim())
  })
}

test('shell: short main content is padded above, quick controls precede final menu', () => {
  const plan = shellPlan({ columns: 160, t, menuTitle: 'fixture menu', mainTitle: 'fixture main', room: { rows: [], fresh: 0 }, panel: parsePanel(null, 0), fleet: [] })
  const bar = el.Text({ children: ['fixture band'] })
  const main = [el.Text({ children: ['fixture card options'] })]
  const tree = B.stackRows(el, B.Shell(el, { plan, left: [], onLeft() {}, main, progress: el.Text({ children: ['fixture progress'] }), quick: [el.Text({ children: ['fixture submit'] })], bar }))
  const out = render(tree, 160)
  assert.equal(out[lastInk(out)].trim(), 'fixture band')
  const opt = out.findIndex(r => r.includes('fixture card options'))
  assert.equal(opt, plan.bodyRows - 2, 'main row sits just above its divider/progress, blanks above it')
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
