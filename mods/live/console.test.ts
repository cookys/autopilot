// mods/live/console.test.ts — C1 U8: the cross-cutting checks of the operator console's CLI pane, drawn through the real Pane (pane.tsx consolePane) with the C0 fixture as the snapshot.
//   KR8 (the CLI's share): the 指揮 page shows the fixture's `items` in the fixture's order (the feed sorted them by severity), the exceptions section is exactly the to_console exception / quota items,
//   the 待決 count and rows equal `counts.decisions`; the row text at 120 / 80 columns is the item's `text`, at 20 columns its `title`.
//   Leak red light: a copy of the C0 fixture with a member address, an IPv4 address and a login name planted in fields the pages must never draw; every page at 120 / 80 / 20 columns must not
//   contain them, nor any address-shaped or IPv4-shaped string. The negative control feeds the checker a screen that does contain them (red), then the real screens (green).
//   KR2 and KR5 (no runner spawned, no file written on a refresh) need the engine's `$` and are in live.test.ts ("C1 U8 KR2 + KR5").
import { test, expect } from 'claude-code/testing'
import { Pane } from './pane'
import { parseConsole } from './console'
import { makeT } from './i18n'
import { newScroll } from './scrollmath'
import full from './fixtures/console/console-full.fixture'

type Node = { kind: 'Box' | 'Text' | 'Button' | 'Input' | 'Link'; props: Record<string, any> }
const mk = (kind: Node['kind']) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }

const kids = (n: any): any[] => {
  const c = n?.props?.children
  return c === undefined || c === null || c === false ? [] : Array.isArray(c) ? c.flat(Infinity).filter((x: any) => x !== null && x !== false && x !== undefined) : [c]
}
const norm = (n: any): any => (n !== null && typeof n === 'object' && typeof n.type === 'function' && n.kind === undefined ? n.type(n.props) : n)
// the text of a node laid on ONE row (a Text, a Button, an inline Box)
const inline = (n0: any): string => {
  const n = norm(n0)
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  return kids(n).map(inline).join('')
}
const isRowBox = (n: any): boolean => n.kind === 'Box' && n.props.flexDirection === 'row'
const isColBox = (n: any): boolean => n.kind === 'Box' && (n.props.flexDirection === 'column' || n.props.height !== undefined)
function screen(n0: any, grow = 0): string[] {
  const n = norm(n0)
  if (n === null || n === undefined || n === false) return []
  if (typeof n === 'string' || typeof n === 'number') return [String(n)]
  if (n.kind === 'Text' || n.kind === 'Button') return [inline(n)]
  if (isRowBox(n)) {
    const cols = kids(n).map(c => screen(c, grow))
    const h = Math.max(grow, ...cols.map(c => c.length))
    return Array.from({ length: h }, (_, i) => cols.map(c => c[i] ?? '').join(''))
  }
  if (isColBox(n)) {
    const parts = kids(n).map(c => ({ c, g: norm(c)?.props?.flexGrow !== undefined }))
    const fixed = parts.filter(p => !p.g).flatMap(p => screen(p.c))
    const height: number | undefined = n.props.height
    const left = height === undefined ? 0 : Math.max(0, height - fixed.length)
    const out = parts.flatMap(p => (p.g ? screen(p.c, left) : screen(p.c)))
    return height === undefined ? out : out.slice(0, height).concat(Array.from({ length: Math.max(0, height - out.length) }, () => ''))
  }
  // a plain Box: its children are one row unless one of them is itself a block
  const ch = kids(n)
  if (ch.some(c => { const x = norm(c); return x?.kind === 'Box' && (isColBox(x) || isRowBox(x)) })) return ch.flatMap(c => screen(c))
  return [inline(n)]
}

const t = makeT('zh-TW')
const NOW = 1794200000000
const COLS = [120, 80, 20] as const
const TABS = ['command', 'team', 'quota', 'hosts', 'self'] as const
// a tall frame so nothing is scrolled out of sight; the bar rows (hint, data age) are fixed at the bottom
function drawTab(snap: any, tab: string, cols: number, rows = 300) {
  const win = newScroll()
  const con = { nav: { snap, tab }, onTab: () => {}, onNext: () => {}, live: null, now: NOW, scroll: { offset: 0, bodyRows: rows }, win, decide: null }
  return screen(Pane(EL, null, 'now', () => {}, t, cols, () => {}, new Set(), () => {}, new Set(), { offset: 0, bodyRows: rows }, null, win, null, con as never))
}
const RAW = full as any
const SNAP = parseConsole(JSON.stringify(RAW))!
const isException = (i: any) => (i.kind === 'exception' || i.kind === 'quota') && i.to_console === true

test('KR8 fixture precondition: the feed order is the severity order, ids are unique', () => {
  const sev = RAW.items.map((i: any) => i.severity)
  expect(sev).toEqual([...sev].sort((a: number, b: number) => a - b))
  expect(new Set(RAW.items.map((i: any) => i.id)).size).toBe(RAW.items.length)
})

test('KR8: the 指揮 exceptions section lists the to_console exception / quota items in the fixture order, one row each, at 120 / 80 / 20 columns', () => {
  const expected = RAW.items.filter(isException)
  for (const cols of COLS) {
    const lines = drawTab(SNAP, 'command', cols)
    const from = lines.findIndex(l => l.includes('例外'))
    const to = lines.findIndex(l => l.includes('待決'))
    expect(from, cols + ': exceptions header').toBeGreaterThan(-1)
    expect(to, cols + ': queue header after it').toBeGreaterThan(from)
    const rows = lines.slice(from + 1, to).filter(l => l.trim() !== '')
    expect(rows.length, cols + ': one row per exception item (counts: ' + expected.length + ')').toBe(expected.length)
    expected.forEach((it: any, k: number) => {
      const needle = cols >= 60 ? it.text : it.title
      const shown = rows[k].replace(/^\S+\s+/, '').split(' · ')[0].replace(/…$/, '') // a narrow row is cut with an ellipsis
      expect(shown.length > 0 && needle.startsWith(shown), cols + ': row ' + k + ' is ' + it.id + ' (' + needle + ') but reads ' + rows[k]).toBe(true)
    })
  }
})

test('KR8: the 指揮 queue shows counts.decisions cards, in the fixture order, titled as the items are', () => {
  const expected = RAW.items.filter((i: any) => i.kind === 'card' && i.needs_operator === true)
  expect(expected.length).toBe(RAW.counts.decisions)
  for (const cols of COLS) {
    const lines = drawTab(SNAP, 'command', cols)
    const from = lines.findIndex(l => l.includes('待決'))
    expect(Number(/待決\s+(\d+)/.exec(lines[from])?.[1]), cols + ': the queue header count').toBe(RAW.counts.decisions)
    const rows: string[] = []
    for (const l of lines.slice(from + 1)) { if (l.trim() === '') break; if (!l.trim().startsWith('[')) rows.push(l) }
    expect(rows.length, cols + ': one row per card').toBe(RAW.counts.decisions)
    expected.forEach((it: any, k: number) => {
      const shown = rows[k].replace(/^\S+\s+/, '').split(' · ')[0].replace(/…$/, '')
      const title = it.title.replace(/…$/, '')
      expect(shown.length > 0 && (title.startsWith(shown) || shown.startsWith(title)), cols + ': card row ' + k + ' is ' + it.id + ' (' + it.title + ') but reads ' + rows[k]).toBe(true)
    })
  }
})

// the leaked copy of the C0 fixture: strings the pages must never draw, planted in fields no page reads (and in the fields the feed itself plants)
const LEAK_ADDR = 'leakns/leakcourier/leak-member--claude'
const LEAK_IP = ['203', '0', '113', '77'].join('.') // a documentation address, assembled so the source holds no IPv4 literal
const LEAK_LOGIN = 'fx-login-probe'
const leakRaw = (): any => {
  const raw = JSON.parse(JSON.stringify(RAW))
  for (const l of raw.lines) { l.lead = LEAK_ADDR; l.owner_login = LEAK_LOGIN }
  for (const h of raw.hosts) { h.host_key = LEAK_IP; h.ssh_user = LEAK_LOGIN; h.address = LEAK_ADDR }
  for (const i of raw.items) { i.owner = LEAK_ADDR; i.host_ip = LEAK_IP; i.login = LEAK_LOGIN }
  for (const c of raw.cards) { c.executor = LEAK_ADDR; c.login = LEAK_LOGIN }
  return raw
}
const PLANTED = [LEAK_ADDR, LEAK_IP, LEAK_LOGIN, ...RAW.lines.map((l: any) => l.lead).filter((x: any) => typeof x === 'string'), ...RAW.hosts.map((h: any) => h.host_key).filter((x: any) => typeof x === 'string')]
const SHAPES = [/\b[\w.-]+\/[\w.-]+\/[\w.-]+--claude\b/, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/]
const leaksIn = (lines: string[]): string[] => lines.flatMap(l => [...PLANTED.filter(p => l.includes(p)), ...SHAPES.filter(r => r.test(l)).map(r => String(r))])

test('leak red light: the checker is red on a screen that prints a planted address, ip or login (negative control)', () => {
  expect(leaksIn(['本席 ' + LEAK_ADDR]).length).toBeGreaterThan(0)
  expect(leaksIn(['主機 ' + LEAK_IP]).length).toBeGreaterThan(0)
  expect(leaksIn(['成員 ' + LEAK_LOGIN]).length).toBeGreaterThan(0)
  expect(leaksIn(['gpu · Claude (fx-host-a)', '主機 在線 2/3']).length).toBe(0)
})

test('leak red light: no page draws a member address, an ip or a login name, at 120 / 80 / 20 columns', () => {
  const snap = parseConsole(JSON.stringify(leakRaw()))!
  let drawn = 0
  for (const tab of TABS) for (const cols of COLS) {
    const lines = drawTab(snap, tab, cols)
    drawn += lines.length
    expect(leaksIn(lines), tab + ' at ' + cols + ' columns').toEqual([])
  }
  console.log('leak scan: ' + TABS.length * COLS.length + ' screens, ' + drawn + ' rows, 0 planted strings')
})
