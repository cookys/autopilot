// mods/live/frame.test.ts — S0 of the pane tab merge (plan r2 §3.1, §3.2, §5): the fixed-height frame, the page registry and the pane's key table.
// Pure: frameRows and paneKey are called directly; the strip is also drawn through the real Pane with fake elements.
import { test, expect } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY, Pane, pageHotkeys } from './pane'
import { EN, ZH_TW } from './locales'
import { makeT } from './i18n'
import { actionRows, brokenRow, frameRows, mostSevere } from './pages/frame'
import type { Page, PageCtx, Row } from './pages/frame'
import { PAGES, EXTRA_PAGES } from './pages/index'
import { NO_NAV } from './pages/decide'
import { consoleOf, POOLS } from './pages/quota.fixture'
import { bandQuotaSeg } from './band'
import { PALETTE } from '../tux/palette.ts'
import * as M from './model'
import { displayWidth } from './model'
import { parseConsole } from './console'
import full from './fixtures/console/console-full.fixture'

const t = makeT('zh-TW')
const SIZES = [{ cols: 160, rows: 40 }, { cols: 120, rows: 30 }, { cols: 80, rows: 24 }]
const NOW = 1794200000000
const line = (s: string): Row => [{ text: s }]
const SNAP = parseConsole(JSON.stringify(full))
// every source ok, 0 pending cards, and no pool with an unknown verdict: the data is whole, so the empty state is the scoped 沒有待決卡 and not 資料不足 (G4)
const WHOLE = { ...(SNAP as NonNullable<typeof SNAP>), cards: [], counts: { ...(SNAP as NonNullable<typeof SNAP>).counts, decisions: 0 }, sources: Object.fromEntries(Object.keys((SNAP as NonNullable<typeof SNAP>).sources).map(k => [k, { at_ms: NOW - 1000, state: 'ok' as const }])), quota: { ...(SNAP as NonNullable<typeof SNAP>).quota, pools: ((SNAP as NonNullable<typeof SNAP>).quota.pools ?? []).map(p => ({ ...p, stranded_seats: 1 })) } } as unknown as PageCtx['console']
const ctxOf = (size: { cols: number; rows: number }, console: PageCtx['console'] = null): PageCtx => ({ live: null, console, size, t, nowMs: NOW })
const withBody = (p: Page, body: number, actions: number): Page => ({ ...p, render: () => ({ body: Array.from({ length: body }, (_, i) => line('body ' + i)), actions: Array.from({ length: actions }, (_, i) => line('act ' + i)) }) })
const text = (r: Row): string => r.map(s => s.text).join('')
const stale = (): NonNullable<PageCtx['console']> => ({ ...(SNAP as NonNullable<typeof SNAP>), sources: { fleet: { at_ms: NOW - 6 * 60000, state: 'stale' }, quota: { at_ms: null, state: 'no_source' } } })

test('registry: ten pages in v7.4 key order 1-9, 0 pet (quota and forge are not on the strip); shells are empty, the pet page renders its no-pet state when absent (g2 folds A6)', () => {
  expect(PAGES.map(p => p.id + p.key)).toEqual(['now1', 'decide2', 'dispatch3', 'review4', 'spend5', 'hygiene6', 'fleet7', 'todo8', 'help9', 'pet0'])
  for (const p of PAGES) {
    const r = p.render(ctxOf(SIZES[0]))
    if (p.id === 'pet') expect(r.body.map(x => x.map(g => g.text).join(''))).toEqual(['沒有寵物資料'])
    else if (p.id === 'decide') {
      expect(r.body).toEqual([])
      expect(r.actions.map(x => x.map(g => g.text).join('')).join('')).toBe(t('shell.on_band'))
    }
    else if (!p.framed) expect(r).toEqual({ body: [], actions: [] }) // a page that is not framed is still a shell
    else expect(r.body.length).toBeGreaterThan(0) // a framed page draws something; its goldens are in pages/<id>.test.ts
  }
})

for (const size of SIZES) {
  for (const page of PAGES) {
    const states: [string, Page, PageCtx['console']][] = [
      ['empty', page, null],
      ['overflowing body', withBody(page, 200, 0), null],
      ['body one over', withBody(page, size.rows - 2 - actionRows(size.rows) + 1, 0), null],
      ['actions full', withBody(page, 3, actionRows(size.rows)), null],
      ['stale source', withBody(page, 5, 2), stale()],
      ['wide text', { ...page, render: () => ({ body: [line('字'.repeat(300))], actions: [line('x'.repeat(300))] }) }, null],
    ]
    for (const [name, p, con] of states) {
      test('frame: ' + page.id + ' ' + name + ' at ' + size.cols + 'x' + size.rows + ' is exactly ' + size.rows + ' rows, none wider than the pane', () => {
        const rows = frameRows(p, ctxOf(size, con), { pages: PAGES })
        expect(rows.length).toBe(size.rows)
        for (const r of rows) expect(displayWidth(text(r))).toBeLessThanOrEqual(size.cols)
      })
    }
  }
}

test('frame: layout, header on row 0, strip on the last row, A = 6 from 32 rows else 4, actions bottom-up, the overflow hint takes the last body row', () => {
  expect([actionRows(40), actionRows(32), actionRows(31), actionRows(24)]).toEqual([6, 6, 4, 4])
  const page = withBody(PAGES[1], 200, 2)
  const rows = frameRows(page, ctxOf({ cols: 120, rows: 30 }), { pages: PAGES })
  expect(text(rows[0])).toBe('待決')
  expect(text(rows[29])).toContain('1 現況')
  expect(text(rows[29])).toContain('2 待決')
  expect(text(rows[29])).toContain('9 說明') // V5: close with host ✕ / band [-]; Escape belongs to its focused surface.
  expect(text(rows[28])).toMatch(/^╰─/) // v7.4: the bottom border row sits between the actions and the strip
  expect(text(rows[27])).toBe('act 1') // the last action is directly over the border
  expect(text(rows[26])).toBe('act 0')
  const bodyRoom = 30 - 3 - 2 // border row + two actions: the area is as tall as the actions, not a fixed A
  expect(text(rows[bodyRoom])).toBe('↓ 還有 ' + (200 - (bodyRoom - 1)) + ' 列') // the last body row; the total did not change
  expect(text(rows[bodyRoom - 1])).toBe('body ' + (bodyRoom - 2))
})

test('frame: no action says 沒有待決卡 on one row only; a short body keeps the strip on the last row, blank rows only above the body', () => {
  const rows = frameRows(withBody(PAGES[6], 2, 0), ctxOf({ cols: 80, rows: 24 }, WHOLE), { pages: PAGES })
  const out = rows.map(text)
  const first = out.indexOf('body 0')
  expect(out[0]).toBe('艦隊')
  expect(out.slice(first, out.length - 2)).toEqual(['body 0', 'body 1', '沒有待決卡']) // then the border row and the strip
  expect(out.slice(1, first).every(r => r === '')).toBe(true)
  expect(rows.length).toBe(24)
  expect(text(rows[21])).toBe('沒有待決卡') // directly above the border row and the strip
  expect(rows.filter(r => text(r) === '沒有待決卡').length).toBe(1)
})

test('frame: scroll moves the window, and an offset past the end is clamped (still H rows)', () => {
  const rows = frameRows(withBody(PAGES[0], 100, 0), ctxOf({ cols: 80, rows: 24 }), { pages: PAGES, scroll: 9999 })
  expect(rows.length).toBe(24) // an overflowing body fills the surface
  const body = rows.slice(1, 1 + 20) // 24 - head - border - strip - the one empty-state row
  expect(text(body[19])).toBe('body 99') // clamped to the end: the window shows the last rows, the `↑ 還有 N 列` row and no `↓` row
  expect(text(body[0])).toBe('↑ 還有 81 列')
  expect(text(body[1])).toBe('body 81')
  expect(frameRows(withBody(PAGES[0], 100, 0), ctxOf({ cols: 80, rows: 24 }), { pages: PAGES, scroll: 10 }).slice(1, 21).map(text)[19]).toBe('↓ 還有 72 列') // one row of the window is the up-hint row
})

test('frame: more actions than the area holds throws (a programming error), at both A sizes', () => {
  expect(() => frameRows(withBody(PAGES[0], 0, 7), ctxOf({ cols: 160, rows: 40 }))).toThrow()
  expect(() => frameRows(withBody(PAGES[0], 0, 5), ctxOf({ cols: 80, rows: 24 }))).toThrow()
  expect(() => frameRows(withBody(PAGES[0], 0, 6), ctxOf({ cols: 160, rows: 40 }))).not.toThrow()
})

test('§5: a broken source is a red text colour (the broken palette key, no background, no inverse) with its reason; the header shows the most severe', () => {
  const m = mostSevere(ctxOf({ cols: 120, rows: 30 }, stale()))
  expect(m?.text).toBe('✗ quota 無來源') // no_source outranks stale
  expect(m?.color).toBe('error')
  expect(Object.keys(m as object).filter(k => k !== 'text' && k !== 'color')).toEqual([])
  expect(brokenRow('x')[0].color).toBe('error')
  const only = { ...(SNAP as NonNullable<typeof SNAP>), sources: { fleet: { at_ms: NOW - 6 * 60000, state: 'stale' as const } } }
  expect(mostSevere(ctxOf({ cols: 120, rows: 30 }, only))?.text).toBe('✗ fleet 資料過期，6 分鐘前')
  expect(mostSevere(ctxOf({ cols: 120, rows: 30 }, null))).toBeNull()
  const rows = frameRows(PAGES[6], ctxOf({ cols: 120, rows: 30 }, stale()), { pages: PAGES })
  expect(text(rows[0])).toContain('✗ quota 無來源')
  expect(rows[0].some(s => s.color === 'error')).toBe(true)
})

// ---- the pane draws the strip: no `›` chip, digits are the hotkeys ----
type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
const walk = (n: any, out: Node[] = []): Node[] => {
  if (n === null || n === undefined || n === false || typeof n !== 'object') return out
  if (Array.isArray(n)) { n.forEach(c => walk(c, out)); return out }
  if (n.kind !== undefined) out.push(n)
  walk(n.props?.children, out)
  return out
}
const flat = (n: Node): string => { const c = n.props.children; return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flat(x) : '')).join('') : c?.props ? flat(c) : '' }

test('pane strip: no `›` next chip anywhere, every digit tab is a Button with its digit as hotkey (old strip and framed page)', () => {
  const live = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never
  const old = walk(Pane(EL as never, live, 'now', () => {}, t, 120))
  expect(old.filter(n => n.kind === 'Button').map(n => n.props.key)).not.toContain('next')
  expect(old.some(n => n.kind === 'Text' && flat(n).trim() === '›')).toBe(false)
  expect(Object.fromEntries(old.filter(n => n.kind === 'Button' && n.props.hotkey !== undefined).map(n => [n.props.key, n.props.hotkey]))).toEqual({ now: '1', decide: '2', dispatch: '3', review: '4', spend: '5', hygiene: '6', fleet: '7' })
  const shown: Page[] = PAGES.map(p => ({ ...p, framed: true as const }))
  const framed = walk(Pane(EL as never, live, 'decide', () => {}, t, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: shown, console: null, nowMs: NOW, rows: 30 }))
  const anchor = framed.filter(n => n.kind === 'Button' && n.props.autoFocus === true)
  expect(anchor.map(n => n.props.key), 'the one autoFocus Button is the inert anchor (g2 fold A5), not a tab').toEqual([FOCUS_ANCHOR_KEY])
  const btn = framed.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY)
  // pane.tsx also draws the page's own hidden hotkey Buttons (j k z a-e n u p l f s): letters; the digits belong to the strip alone
  expect(btn.map(n => n.props.hotkey).filter(h => /^[0-9]$/.test(h))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
  expect(btn.some(n => flat(n).includes('›'))).toBe(false)
  expect(framed.find(n => n.kind === 'Box' && n.props.height === 30)).toBeDefined()
})

// every visible key hint `[x]` in a framed page's action rows (all states are the page.<id>.* strings, in both locales) is a hotkey the page binds. [Esc] is the
// host's own key (an Input ends on Esc), so it is not a hotkey and is not checked. [Enter] is never a hint and never a bound hotkey: the host cannot bind Enter
// (it presses the focused Button), so a hint "[Enter]" on any framed page is a failure.
test('key hints: every [x] in a framed page string is one of that page\'s bound hotkeys, in en and zh-TW; no page draws [Enter]', () => {
  const bad: string[] = []
  for (const [loc, table] of [['en', EN], ['zh-TW', ZH_TW]] as const) {
    for (const [id, text] of Object.entries(table as Record<string, string>)) {
      const m = /^page\.(now|decide|fleet|quota)\./.exec(id)
      if (m === null) continue
      const bound = pageHotkeys(m[1])
      for (const h of text.matchAll(/\[([^\]\s]+)\]/g)) {
        if (h[1] === 'Esc' || h[1].includes('{')) continue
        if (!bound.includes(h[1])) bad.push(loc + ' ' + id + ' [' + h[1] + ']')
      }
    }
  }
  expect(bad).toEqual([])
  expect(pageHotkeys('decide')).toContain('h')
  expect(pageHotkeys('decide')).toContain('p')
})

// Every fleet line and every quota pool is its own Button (Tab walks the rows, Enter presses the focused one): pressing row 2 sees line 2 / opens pool 2. There is no j / k, and no
// Button is drawn with an empty label (the host would draw it as a row `x:`); `o` and the strip digits ride on a visible Button.
test('keys: fleet binds no letter (v7.4 plain list), row 2 of quota opens its seats; decide has no o; help (9) rides the strip; no j / k', () => {
  const live = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never
  const shown: Page[] = PAGES.map(p => ({ ...p, framed: true as const }))
  const drawn = (tab: 'fleet' | 'spend' | 'decide', focus: number) => {
    const pressed: string[] = []
    const pageId = tab === 'spend' ? 'quota' : tab // the quota page is not on the strip (folded into spend): it is reached with an explicit pageId
    const tree = walk(Pane(EL as never, live, tab, () => {}, t, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: [...shown, ...EXTRA_PAGES], ...(tab === 'spend' ? { pageId: 'quota' } : {}), console: SNAP, nowMs: NOW, rows: 30, view: { [pageId]: { focus, expanded: false } }, onPress: (id: string) => { pressed.push(id) } } as never))
    return { tree, pressed }
  }
  const hot = (tree: Node[], k: string) => tree.find(n => n.kind === 'Button' && n.props.hotkey === k)
  // v7.4 S8: the 艦隊 page is a plain list (pages/fleet.ts, covered by pages/v74-f.test.ts): no line Button, no 看 / fold / fill action, so it binds no letter
  expect(pageHotkeys('fleet'), 'fleet binds no page letter').toEqual([])
  expect(drawn('fleet', 0).tree.filter(n => n.kind === 'Button' && /^[a-z]$/.test(n.props.hotkey ?? '')).map(n => n.props.hotkey), 'fleet draws no letter Button').toEqual([])
  const q = drawn('spend', 0)
  const pools = q.tree.filter(n => n.kind === 'Button' && typeof n.props.key === 'string' && n.props.key.startsWith('p:')).filter(n => { n.props.onPress(); return true })
  expect(q.pressed.filter(x => x.startsWith('quota:pool:')).slice(0, 2), 'quota: row 2 is pool index 1').toEqual(['quota:pool:0', 'quota:pool:1'])
  expect(pools.length).toBeGreaterThanOrEqual(2)
  expect(hot(drawn('decide', 0).tree, 'o')).toBeUndefined()
  for (const tab of ['fleet', 'spend', 'decide'] as const) {
    const tree = drawn(tab, 0).tree
    expect(hot(tree, '9'), 'the help tab 9 is a Button with a visible label').toBeDefined()
    expect(flat(hot(tree, '9') as Node)).toBe('說明')
    if (tab === 'decide') { expect(hot(tree, 'j'), 'F1: decide always carries j').toBeDefined(); expect(hot(tree, 'k'), 'F1: decide always carries k').toBeDefined() }
    else expect(hot(tree, 'j') ?? hot(tree, 'k'), 'no j / k off the decide page').toBeUndefined()
    const id = tab === 'spend' ? 'quota' : tab
    const letters = tree.filter(n => n.kind === 'Button' && /^[a-z]$/.test(n.props.hotkey ?? '')).map(n => n.props.hotkey as string)
    expect(letters.filter(h => !pageHotkeys(id).includes(h)), id + ' draws a hotkey it does not list').toEqual([])
    expect(tree.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && flat(n).trim() === '').map(n => n.props.key), id + ': a Button with an empty label').toEqual([])
  }
  expect(hot(drawn('fleet', 0).tree, 'o'), 'fleet has no 看 action row').toBeUndefined()
})

// review fix (codeforge screenshot): the pane has no empty-label Button, the strip is the last row on every page, its labels are the page name alone (the host adds `1: `),
// every Button key is unique among siblings, and a note being typed leaves the digits to the Input.
const LIVE0 = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never
const framedPane = (tab: any, over: Record<string, unknown> = {}) => {
  const shown: Page[] = PAGES.map(p => ({ ...p, framed: true as const }))
  return walk(Pane(EL as never, LIVE0, tab, () => {}, t, 160, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: shown, console: SNAP, nowMs: NOW, rows: 30, ...over } as never))
}
test('pane review fix: no Button has an empty label, and the strip is the last row, on every page', () => {
  for (const tab of ['now', 'decide', 'fleet', 'spend'] as const) {
    const tree = framedPane(tab)
    expect(tree.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && flat(n).trim() === '').map(n => n.props.key), tab + ': empty-label Buttons').toEqual([])
    const root = tree.find(n => n.kind === 'Box' && n.props.height === 30) as Node
    const kids = ([] as any[]).concat(root.props.children).flat(9).filter(c => c && c.props)
    const rowKeys = kids.map(c => String(c.props.key)).filter(k => /^f\d+$/.test(k))
    expect(rowKeys[rowKeys.length - 1], tab + ': the last row is the strip').toBe(rowKeys[rowKeys.length - 1])
    const stripKids = walk(kids.find(c => c.props.key === rowKeys[rowKeys.length - 1]))
    expect(stripKids.filter(n => n.kind === 'Button' && /^[0-9]$/.test(n.props.hotkey ?? '')).length, tab + ': the strip carries the digit Buttons').toBeGreaterThanOrEqual(6)
  }
})
test('pane review fix: strip labels are the page name alone (the host draws `<hotkey>: <label>`)', () => {
  const tree = framedPane('fleet')
  const tabs = tree.filter(n => n.kind === 'Button' && /^[0-9]$/.test(n.props.hotkey ?? ''))
  expect(tabs.length).toBeGreaterThanOrEqual(6)
  for (const b of tabs) expect(flat(b), 'label of hotkey ' + b.props.hotkey).not.toMatch(/^\s*\d/)
  expect(flat(tabs[0]).trim()).toBe('現況')
})
test('pane review fix: quota and spend share one tab target but their strip Buttons and press rows have unique keys', () => {
  for (const tab of ['fleet', 'spend'] as const) {
    const keys = framedPane(tab).filter(n => n.kind === 'Button').map(n => n.props.key).filter(k => k !== undefined)
    expect(keys.filter((k, i) => keys.indexOf(k) !== i), tab + ': duplicate Button keys').toEqual([])
  }
})
test('pane review fix: while a 待決 note is typed the strip binds no digit and no letter; the Input owns the keys', () => {
  const typing = { decide: { ...NO_NAV, textMode: true, textBuf: '3' } }
  const tree = framedPane('decide', typing)
  expect(tree.filter(n => n.kind === 'Button' && n.props.hotkey !== undefined).map(n => n.props.hotkey), 'no hotkey while typing').toEqual([])
  expect(framedPane('decide').filter(n => n.kind === 'Button' && /^[0-9]$/.test(n.props.hotkey ?? '')).length, 'control: the digits are bound when not typing').toBeGreaterThanOrEqual(6)
})

// review fix 1: the frame is exactly H rows even when H is under the six rows (head + strip + at least one action) the layout used to force
test('frame: a pane under 6 rows is exactly H rows (0 -> none, 1 -> the strip, 2 -> head and strip, actions keep the last ones)', () => {
  for (const H of [0, 1, 2, 3, 4, 5]) {
    for (const acts of [0, 1, 3]) {
      const rows = frameRows(withBody(PAGES[0], 9, acts), ctxOf({ cols: 80, rows: H }), { pages: PAGES })
      expect(rows.length, 'H=' + H + ' actions=' + acts).toBe(H)
      if (H > 0) expect(text(rows[rows.length - 1]), 'H=' + H + ': the strip is last').toMatch(/說明|現|1/)
    }
  }
  const one = frameRows(withBody(PAGES[0], 9, 3), ctxOf({ cols: 80, rows: 1 }), { pages: PAGES })
  expect(text(one[0])).toContain('說明') // the strip
  const four = frameRows(withBody(PAGES[0], 9, 3), ctxOf({ cols: 80, rows: 4 }), { pages: PAGES })
  expect(text(four[1])).toBe('act 2') // the last action that fits, then the border row and the strip
  expect(text(four[2])).toMatch(/^╰─/)
})

// review fix 4: an empty segment is 0 cells in clip(); the pane must not draw it as one blank cell
test('pane: a framed row with an empty segment plus cols cells of text draws exactly cols cells', () => {
  const live = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never
  const wide = 'a'.repeat(60)
  const page: Page = { ...PAGES[0], framed: true as const, render: () => ({ body: [[{ text: '' }, { text: wide }], [{ text: '' }]], actions: [] }) }
  const tree = walk(Pane(EL as never, live, 'now', () => {}, t, 60, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: [page, ...PAGES.filter(p => p.id !== page.id)], console: null, nowMs: NOW, rows: 12 } as never))
  const rowsDrawn = tree.filter(n => n.kind === 'Box' && typeof n.props.key === 'string' && /^f\d+$/.test(n.props.key))
  const width = (n: Node) => walk(n.props.children).filter(x => x.kind === 'Text').reduce((s, x) => s + displayWidth(flat(x)), 0)
  const wideRow = rowsDrawn.find(n => walk(n.props.children).some(x => flat(x).includes(wide)))
  expect(wideRow).toBeDefined()
  expect(width(wideRow as Node)).toBe(60)
  expect(rowsDrawn.some(n => width(n) === 1), 'a row that is only one empty segment still draws one cell').toBe(true)
})

// band-quota-stale-source: the band's quota segment follows the quota SOURCE state, not only the pools: no_source draws nothing, stale takes the warning role, expired the broken one
test('band quota segment: source state no_source -> absent, stale -> warning role, expired -> broken role; an ok source keeps the pool colour', () => {
  const pools = (SNAP as NonNullable<typeof SNAP>).quota.pools!.filter(p => p.pool === 'pool-a').map(p => ({ ...p, seven_day_pct: 20, five_hour_pct: 10, projected_pct_at_reset: 97, projected_exhaustion_at_ms: null, burn_pct_per_h: 1, limit_hit: false, observed_at_ms: NOW, stale: false, stale_note: null, stale_age_min: null })) // a healthy pool
  const ok = bandQuotaSeg(pools, NOW, t, 'ok')
  expect(ok, 'control: the ok source draws the segment').not.toBeNull()
  expect(ok!.color, 'control: a healthy pool draws the done colour').toBe(PALETTE.done)
  expect(bandQuotaSeg(pools, NOW, t, 'no_source'), 'no_source: no segment').toBeNull()
  expect(bandQuotaSeg(pools, NOW, t, 'stale')!.color, 'stale: warning role').toBe(PALETTE.attention)
  expect(bandQuotaSeg(pools, NOW, t, 'expired')!.color, 'expired: broken role').toBe(PALETTE.broken)
})

// ---- pane UX fix (real-host screenshots, 160x40, pane ~70 columns): the strip counts the host's `<key>: ` prefix, folds when it must ----
// The host draws each hotkey Button as `<key>: <label>`: one cell wider than the segment text. A strip segment is a Button when it carries a tab press (the help entry is tab 9).
const isButtonSeg = (s: { text: string; press?: string }): boolean => s.press !== undefined && s.press.startsWith('tab:')
const hostWidth = (r: Row): number => r.reduce((w, s) => w + displayWidth(s.text) + (isButtonSeg(s) ? 1 : 0), 0)
test('pane UX fix: strip at 70 / 60 / 40 columns stays within the width (host prefix counted, 2 rows under 66 cols), no two Buttons touch, help and all entries stay reachable', () => {
  for (const cols of [70, 60, 40]) {
    const rows = frameRows(PAGES[1], ctxOf({ cols, rows: 24 }), { pages: PAGES })
    const sRows = cols < 66 ? rows.slice(-2) : rows.slice(-1)
    expect(rows.length, cols + ': exactly H rows').toBe(24)
    for (const strip of sRows) {
      expect(hostWidth(strip), cols + ': the strip with the host prefix is ' + hostWidth(strip) + ' wide: ' + text(strip)).toBeLessThanOrEqual(cols)
      for (let i = 1; i < strip.length; i++) expect(isButtonSeg(strip[i - 1]) && isButtonSeg(strip[i]), cols + ': two Buttons run together at ' + i + ': ' + text(strip)).toBe(false)
    }
    expect(rows[rows.length - 1].some(s => s.press === 'tab:9:help'), cols + ': the help entry is in the strip').toBe(true)
  }
  const wide = frameRows(PAGES[1], ctxOf({ cols: 70, rows: 24 }), { pages: PAGES })
  const last = (r: Row[]) => text(r[r.length - 1])
  expect(last(wide).startsWith('1 現 2 待'), 'at 70 the labels shrink to the first character: ' + last(wide)).toBe(true)
  const narrow = frameRows(PAGES[1], ctxOf({ cols: 40, rows: 24 }), { pages: PAGES })
  const joined = narrow.slice(-2).map(text).join(' ')
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) expect(joined, 'G7: at 40 the entry ' + key + ' is still there: ' + joined).toMatch(new RegExp('(^|\\s)' + key + '(\\s|$)'))
  expect(joined.includes('…'), 'G7: no fold').toBe(false)
})
test('pane UX fix: the quota page empty state says 沒有待決卡, not 沒有要你處理的事 (pools above can be red)', () => {
  const rows = frameRows(withBody(EXTRA_PAGES[0], 2, 0), ctxOf({ cols: 80, rows: 24 }, WHOLE), { pages: PAGES })
  expect(text(rows[rows.length - 3])).toBe('沒有待決卡') // above the border row and the strip
  expect(makeT('en')('frame.nothing')).toBe('No pending cards')
})

// R1 pane-inline-hint-hijack: a `[x] ` inside a head / body row (a question, code) is text, never a hotkey. Only an action row's own hint (at the start or after two spaces, with a label)
// and the strip's `i ` bind a letter; the decide option rows carry their press id and keep a-e.
test('pane R1: a question with [a] / [b] and code with [i] in the body leave a-e on the option rows and help on the strip (tab 9)', () => {
  const body: Row[] = [[{ text: 'Use [a] sync or [b] async?' }], [{ text: 'buf[i] == 0' }]]
  const actions: Row[] = [[{ text: '[a] 同步', press: 'decide:pick:0' }], [{ text: '[b] 非同步', press: 'decide:pick:1' }], [{ text: '[n] 補充  [s] 送出' }]]
  const page: Page = { ...PAGES[1], framed: true as const, render: () => ({ body, actions }) }
  const tree = walk(Pane(EL as never, LIVE0, 'decide', () => {}, t, 160, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: [PAGES[0], page, ...PAGES.slice(2)], console: null, nowMs: NOW, rows: 30 } as never))
  const hot = tree.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && /^[a-z]$/.test(n.props.hotkey ?? ''))
  const by = (k: string) => hot.filter(n => n.props.hotkey === k)
  const help = tree.filter(n => n.kind === 'Button' && n.props.hotkey === '9')
  expect(by('a').map(n => flat(n).trim()), 'option A keeps a').toEqual(['同步'])
  expect(by('b').map(n => flat(n).trim()), 'option B keeps b').toEqual(['非同步'])
  expect(help.map(n => flat(n).trim()), 'the strip keeps the help tab 9').toEqual(['說明'])
  expect(by('i'), 'a body `buf[i]` never becomes a hotkey').toEqual([])
  expect(by('n').length + by('s').length, 'a real action-row hint ([n] / [s] after two spaces) is still a key').toBe(2)
})

// R2 decide-textmode: the host gives no raw Enter / Esc / Backspace, so the note Input must be the focused element (autoFocus) to receive typing, and cancelling needs a visible Button
test('pane R2: while a note is typed the Input is autoFocus, its submit saves, and a visible 放棄 Button cancels', () => {
  const keys: any[] = []
  const tree = framedPane('decide', { decide: { ...NO_NAV, textMode: true, textBuf: '先' }, onKey: (k: any) => keys.push(k) })
  const input = tree.find(n => n.kind === 'Input') as Node
  expect(input, 'the note Input is mounted').toBeDefined()
  expect(input.props.autoFocus, 'the Input takes the focus when n is pressed').toBe(true)
  input.props.onSubmit('先')
  expect(keys).toEqual([{ kind: 'text_save' }])
  const cancel = tree.find(n => n.kind === 'Button' && flat(n).trim() === '放棄') as Node
  expect(cancel, 'a visible cancel Button').toBeDefined()
  cancel.props.onPress()
  expect(keys[1]).toEqual({ kind: 'text_cancel' })
})

// G11 (gate round 1): on the real host (tmux) the pane cannot take keyboard focus, so every key of a page's key table is ALSO a visible Button with that hotkey and a non-empty label.
test('gate G11: every key in a page key table has a Button with that hotkey and a non-empty label among the drawn rows', () => {
  const dec = (id: string) => ({ id, title: null, question: 'q ' + id, background: 'bg', options: ['a', 'b', 'c', 'd', 'e'].map(label => ({ label, description: '' })), recommendation: null, why: null, blocks: null, not_authorized: null, source: 'game-lead', opened_at: null, stale: false, age_s: 60, origin: null, orphaned: false, kind: 'decide' })
  const live = { ...LIVE0, pending: [dec('d-aaaa0001'), dec('d-aaaa0002')] }
  const shown: Page[] = PAGES.map(p => ({ ...p, framed: true as const }))
  const drawn = (tab: any, over: Record<string, unknown>) => walk(Pane(EL as never, live as never, tab, () => {}, t, 160, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: shown, console: SNAP, nowMs: NOW, rows: 40, ...over } as never))
  const hotkeys = (tree: Node[]) => new Map(tree.filter(n => n.kind === 'Button' && typeof n.props.hotkey === 'string' && flat(n).trim() !== '').map(n => [n.props.hotkey as string, flat(n)]))
  const missing: string[] = []
  const need = (id: string, have: Map<string, string>, keys: string[]) => { for (const k of keys) if (!have.has(k)) missing.push(id + ':' + k) }
  const pickedTree = drawn('decide', { decide: { ...NO_NAV, picks: { 'd-aaaa0001': 0 } } })
  const heldTree = drawn('decide', { decide: { ...NO_NAV, picks: { 'd-aaaa0001': 1 }, hold: { 'd-aaaa0001': NOW - 2000 } } })
  const cardKeys = ['a', 'b', 'c', 'd', 'e', 's', 'n', 'f', 'z', 'h', 'l', 'u']
  for (const [id, tree] of [['decide-picked', pickedTree], ['decide-held', heldTree]] as const) {
    const have = hotkeys(tree)
    const drawnText = tree.map(flat).join('\n')
    if (!drawnText.includes(t('shell.on_band'))) missing.push(id + ':on_band')
    for (const k of cardKeys) if (have.has(k)) missing.push(id + ':retired-' + k)
  }
  need('fleet', hotkeys(drawn('fleet', {})), pageHotkeys('fleet'))
  need('quota', hotkeys(drawn('spend', { pages: [...shown, ...EXTRA_PAGES], pageId: 'quota', console: consoleOf(POOLS.map(p => ({ ...p, switch_suggestion: 'personal -> team' }))) })), pageHotkeys('quota').filter(k => k !== 'z')) // z folds nothing on the quota page
  need('now', hotkeys(drawn('now', {})), ['9']) // help is tab 9
  expect(missing).toEqual([])
})

test('pet page: renders sprite + stat rows bottom-anchored at 80x24 and 120x30, draws 2-cell fallback under 80 cols, and rejects invalid tuples without crashing', () => {
  const petPage = PAGES.find(p => p.id === 'pet')!
  const sprite = [String.fromCodePoint(0x2584, 0x2588, 0x2584), String.fromCodePoint(0x2588, 0x2580, 0x2588)]
  const validPanel = {
    schema: 'codeforge.panel/1',
    updated_at_ms: NOW,
    pet: {
      title: 'Mochi Lv.3',
      icon: { id: 'cat', emoji: '🐱', fallback: ':3', text: '🐱' },
      sprite,
      tiers: {
        60: [[{ text: 'HP 60  EXP 42%' }]],
        100: [[{ text: 'HP 100  EXP 42%  MOOD good' }]],
      },
    },
  }
  for (const size of [{ cols: 80, rows: 24 }, { cols: 120, rows: 30 }]) {
    const rows = frameRows(petPage, { ...ctxOf(size), pet: validPanel }, { pages: PAGES })
    expect(rows.length).toBe(size.rows)
    for (const r of rows) expect(displayWidth(text(r))).toBeLessThanOrEqual(size.cols)
    const rendered = rows.map(text)
    expect(rendered[0]).toBe('寵物')
    // bottom-anchored: body sits directly above the empty-state action row (rows - 3), the border row (rows - 2) and the strip (rows - 1)
    const statLine = size.cols >= 100 ? 'HP 100  EXP 42%  MOOD good' : 'HP 60  EXP 42%'
    expect(rendered[size.rows - 4]).toBe(statLine)
    expect(rendered[size.rows - 5]).toBe(sprite[1])
    expect(rendered[size.rows - 6]).toBe(sprite[0])
    expect(rendered[size.rows - 7]).toBe('🐱 Mochi Lv.3')
    expect(rendered.slice(1, size.rows - 7).every(r => r === '')).toBe(true)
  }
  // 79 cols (< 80): draws entry fallback (:3) instead of payload text (🐱)
  const r79 = frameRows(petPage, { ...ctxOf({ cols: 79, rows: 24 }), pet: validPanel }, { pages: PAGES }).map(text)
  expect(r79.some(l => l.startsWith(':3 Mochi Lv.3'))).toBe(true)
  expect(r79.some(l => l.includes('🐱'))).toBe(false)
  // Negative controls: ⚠️, CJK two chars, valid text + invalid fallback at 79 cols -> no pet
  for (const [cols, icon] of [
    [80, { id: 'cat', emoji: '⚠️', fallback: ':3', text: '⚠️' }],
    [80, { id: 'cat', emoji: '🐱', fallback: '寵物', text: '寵物' }],
    [79, { id: 'cat', emoji: '🐱', fallback: 'xx', text: '🐱' }],
  ] as const) {
    const bad = { ...validPanel, pet: { ...validPanel.pet, icon } }
    const out = frameRows(petPage, { ...ctxOf({ cols, rows: 24 }), pet: bad }, { pages: PAGES }).map(text)
    expect(out.some(l => l === '沒有寵物資料')).toBe(true)
    expect(out.some(l => l.includes('Mochi'))).toBe(false)
  }
  // Mounted in Pane: zero Image nodes
  const tree = walk(Pane(EL as never, LIVE0, 'now', () => {}, t, 80, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: PAGES, pageId: 'pet', console: null, nowMs: NOW, rows: 24, pet: validPanel } as never))
  expect(tree.some(n => n.kind === 'Image')).toBe(false)
  expect(tree.some(n => n.kind === 'Text' && flat(n).includes('🐱 Mochi Lv.3'))).toBe(true)
})

test('pane boxed statusRow: last body row is visible when no statusRow is drawn; when statusRow is drawn, box keeps fixed height and renders statusRow', () => {
  const fullBody = Array.from({ length: 6 }, (_, i) => line('row-' + i))
  const customNow: Page = { ...PAGES[0], framed: true as const, render: () => ({ body: fullBody, actions: [] }) }
  const pages = [customNow, ...PAGES.filter(p => p.id !== 'now')]
  const okPm = { schema: 'fleet.pm.status' as const, schema_version: 1 as const, generated_at_ms: NOW - 10_000, selector: null, projects: [] }
  const nav = { cursor: 0, picks: {}, notes: {}, noteMode: false }

  const drawBox = (v74: Record<string, unknown>) => {
    const tree = walk(Pane(EL as never, LIVE0, 'now', () => {}, t, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
      pages, pageId: 'now', console: null, nowMs: NOW, rows: 8, v74Box: true, v74,
    } as never))
    const inner = tree.filter(n => n.kind === 'Box' && typeof n.props.key === 'string' && /^v74-row\d+$/.test(n.props.key))
    return inner.map(flat)
  }

  // Healthy fresh source -> no statusRow -> all 6 inner rows drawn, including the last row (row-5)
  const noStatus = drawBox({ pm: okPm, pmFetchedMs: NOW - 10_000, decide: [], todo: null, nav, ages: { now: NOW - 10_000 } })
  expect(noStatus.length).toBe(6)
  expect(noStatus.join('\n')).toContain('row-0')
  expect(noStatus.join('\n')).toContain('row-5')

  // Failed source -> statusRow IS drawn on inner row 0 -> total inner rows stay 6 (8 total box rows)
  const withStatus = drawBox({ pm: okPm, pmFetchedMs: NOW - 10_000, pmError: 'pm rpc fail', decide: [], todo: null, nav, ages: { now: NOW - 10_000 }, errors: { now: 'pm rpc fail' } })
  expect(withStatus.length).toBe(6)
  expect(withStatus[0]).toContain('讀取失敗：pm rpc fail')
})

test('askRows: the band sits directly above the action rows, the height stays fixed, and a short surface drops it', () => {
  const page = withBody(PAGES[0], 30, 2)
  const ask: Row[] = [line('我問：1 未答'), line('第二列')]
  for (const size of [{ cols: 120, rows: 30 }, { cols: 80, rows: 24 }]) {
    const plain = frameRows(page, ctxOf(size), {})
    const withAsk = frameRows(page, ctxOf(size), { askRows: ask })
    expect(withAsk.length).toBe(size.rows)
    expect(plain.length).toBe(size.rows)
    const at = withAsk.findIndex(r => text(r).startsWith('我問：1 未答'))
    expect(at).toBeGreaterThan(0)
    expect(text(withAsk[at + 1])).toBe('第二列')
  }
  const tiny = frameRows(page, ctxOf({ cols: 80, rows: 12 }), { askRows: ask })
  expect(tiny.some(r => text(r).startsWith('我問：'))).toBe(false)
  expect(tiny.length).toBe(12)
})
