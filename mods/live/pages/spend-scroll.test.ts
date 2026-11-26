// mods/live/pages/spend-scroll.test.ts — a cut body on a non-card page scrolls (j/k, arrows, PgUp/PgDn); the 待決 / 待辦 pages keep their own keys.
import { test, expect } from 'claude-code/testing'
import { Pane } from '../pane'
import { PAGES } from './index'
import { makeT } from '../i18n'
import { parseMeterPack } from './metering'

const t = makeT('zh-TW')
const SAMPLE = parseMeterPack(JSON.stringify({
  generated_at: '2026-11-27T00:15:00Z',
  coverage: {
    '4124gs': { expected: 137, got: 88, missing: 49, retention_days: 7, no_data: false },
    c4140: { expected: 81, got: 86, missing: 5, retention_days: 4, no_data: false },
    xl270d: { expected: 137, got: 125, missing: 12, retention_days: 7, no_data: false },
  },
  evidence: { lines: [] },
}))

const el = Object.fromEntries(['Box', 'Text', 'Link', 'Button', 'Input'].map(type => [type, props => ({ type, props })]))
function nodes(node): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== 'object') return []
  if (typeof node.type === 'function') return nodes(node.type(node.props))
  return [node, ...nodes(node.props?.children)]
}
const flat = c => Array.isArray(c) ? c.flatMap(flat) : c === null || c === undefined || typeof c === 'boolean' ? [] : typeof c === 'object' ? flat(c.props?.children) : [String(c)]

// the visible text rows of the frame (one Box per row, keyed f<i>); `scroll` is the page's body offset, `onScroll` receives the offset a scroll key asks for
function screen(scroll: number | undefined, onScroll: (to: number) => void = () => {}, rows = 9, pageId = 'spend') {
  const tree = Pane(el, null, 'spend', () => {}, t, 209, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: PAGES, pageId, console: null, nowMs: Date.UTC(2026, 10, 27, 1, 0, 0), rows, meter: SAMPLE, onKey: () => {},
    ...(scroll === undefined ? {} : { scroll }), onScroll,
  })
  const all = nodes(tree)
  const lines = all.filter(n => n.type === 'Box' && /^f\d+$/.test(n.props.key ?? '')).map(n => nodes(n).filter(x => x.type === 'Text').flatMap(x => flat(x.props.children)).join(''))
  return { all, lines, text: lines.join('\n') }
}
const press = (s: ReturnType<typeof screen>, hotkey: string): void => { s.all.find(n => n.type === 'Button' && n.props.hotkey === hotkey)!.props.onPress() }

test('spend page v7.4 pane: j is carried by a Button when the body is cut, and pressing it scrolls the metering rows into view', () => {
  const first = screen(undefined)
  expect(first.text).toMatch(/↓ 還有 \d+ 列/) // the body is cut at this size
  expect(first.text).not.toContain('88/137')
  expect(first.all.some(n => n.type === 'Button' && n.props.hotkey === 'j'), 'a hotkey j Button on the spend page').toBe(true)
  expect(first.all.some(n => n.type === 'Button' && n.props.hotkey === 'k'), 'a hotkey k Button on the spend page').toBe(true)
  // j scrolls one row at a time, clamped at the end: the hints follow (`↑ 還有 N 列` appears, `↓ 還有 N 列` goes), and the last row of the body is reachable
  let at = 0
  let seen = first
  let everSeen = first.text
  const hint = /(↑|↓) 還有 (\d+) 列/g
  for (let i = 0; i < 60; i++) {
    let to = -1
    seen = screen(at, v => { to = v })
    press(seen, 'j')
    if (/↓ 還有/.test(seen.text)) expect(to).toBe(at + 1)
    else { expect(to).toBe(at); break } // clamped: at the end j asks for the offset it already has
    at = to
    everSeen += '\n' + screen(at).text
    if (i === 0) expect(screen(at).text).toMatch(/↑ 還有 1 列/)
  }
  const end = screen(at)
  for (const row of ['4124gs  覆蓋 88/137（缺 49）· 保留 7 日', 'c4140   覆蓋 86/81（缺 5）· 保留 4 日', 'xl270d  覆蓋 125/137（缺 12）· 保留 7 日']) expect(everSeen, row).toContain(row)
  expect(end.text).toContain('本席速度')
  expect(end.text).not.toMatch(/↓ 還有/)
  expect(end.text).toMatch(/↑ 還有 \d+ 列/)
  expect([...end.text.matchAll(hint)].length).toBe(1)
  // k goes back one row and the `↓` row returns; at the top k stays at 0
  const back = screen(at, v => { at = v })
  press(back, 'k')
  expect(screen(at).text).toMatch(/↓ 還有/)
  const top = screen(0)
  let to0 = -1
  press(screen(0, v => { to0 = v }), 'k')
  expect(to0).toBe(0)
  expect(top.text).not.toMatch(/↑ 還有/)
})

test('card pages keep their own j / k: 待決 and 待辦 get no scroll Button, and a short page with nothing cut gets none either', () => {
  const short = screen(undefined, () => {}, 40)
  expect(short.text).not.toMatch(/還有 \d+ 列/)
  expect(short.all.some(n => n.type === 'Button' && n.props.hotkey === 'j')).toBe(false)
  const decide = screen(undefined, () => {}, 9, 'decide')
  const js = decide.all.filter(n => n.type === 'Button' && n.props.hotkey === 'j')
  expect(js.length).toBeLessThanOrEqual(1) // the card nav Button (if any), never a second scroll Button
  for (const j of js) { let to = -1; const d = screen(0, v => { to = v }, 9, 'decide'); d.all.filter(n => n.type === 'Button' && n.props.hotkey === 'j').forEach(b => b.props.onPress()); expect(to).toBe(-1) }
})

// the real 209x49 host draws the v7.4 BOXED frame (borders, status row, strip on the bottom border): the page rows are drawn as inner rows, never through the last-row path
function boxScreen(scroll: number | undefined, onScroll: (to: number) => void = () => {}, rows = 12) {
  const v74 = { pm: null, pmFetchedMs: null, decide: [], todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false }, ages: {} }
  const tree = Pane(el, null, 'spend', () => {}, t, 209, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: PAGES, pageId: 'spend', console: null, nowMs: Date.UTC(2026, 10, 27, 1, 0, 0), rows, meter: SAMPLE, onKey: () => {}, v74Box: true, v74,
    ...(scroll === undefined ? {} : { scroll }), onScroll,
  } as never)
  const all = nodes(tree)
  const lines = all.filter(n => n.type === 'Box' && /^v74-row\d+$/.test(n.props.key ?? '')).map(n => nodes(n).filter(x => x.type === 'Text').flatMap(x => flat(x.props.children)).join(''))
  return { all, lines, text: lines.join('\n') }
}

test('spend page v7.4 BOXED frame: a cut body carries j / k Buttons and pressing them moves the window, down to the last row', () => {
  const first = boxScreen(undefined)
  expect(first.text).toMatch(/↓ 還有 \d+ 列/)
  expect(first.all.some(n => n.type === 'Button' && n.props.hotkey === 'j'), 'a hotkey j Button in the boxed frame').toBe(true)
  expect(first.all.some(n => n.type === 'Button' && n.props.hotkey === 'k'), 'a hotkey k Button in the boxed frame').toBe(true)
  let at = 0
  let everSeen = first.text
  for (let i = 0; i < 60; i++) {
    let to = -1
    const s = boxScreen(at, v => { to = v })
    s.all.find(n => n.type === 'Button' && n.props.hotkey === 'j')!.props.onPress()
    if (to === at) break
    at = to
    everSeen += '\n' + boxScreen(at).text
  }
  expect(everSeen).toContain('xl270d  覆蓋 125/137')
  expect(boxScreen(at).text).not.toMatch(/↓ 還有/)
})
