import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import { decidePage, NO_NAV, decideReduce } from './decide'
import type { DecideNav } from './decide'
import { ctxOf, consoleOf, NOW } from './quota.fixture'
import { Pane } from '../pane'
import { PAGES } from './index'

const card = {
  id: 'd-0a1b2c3d', title: null, question: '合成測試：先跑回歸嗎？', source: 'lead-x · Claude (h1)',
  opened_at: null, age_s: 60, background: '合成背景', blocks: '合成卡住', options: [{ label: '先跑回歸', description: '', recommended: true }, { label: '暫緩', description: '' }],
  recommendation: '先跑回歸', why: null, not_authorized: null, stale: false, origin: null, orphaned: false,
}
const text = (row: { text: string }[]) => row.map(s => s.text).join('')
const context = (cols: number, rows: number, own: boolean, c = card, nav: DecideNav = NO_NAV): any => ({
  ...ctxOf(cols, rows, consoleOf([], { cards: own ? [] : [{ ...c, executor_display: c.source, opened_at_ms: NOW - 60000, status: 'open' }], items: [], lines: [] })) as any,
  live: { state: 'ok', header: '', pending: own ? [c] : [] }, decide: nav,
})

test('W3: one action row leaves the own and remote answer summary visible at 80x24 host body height 9', () => {
  for (const [cols, rows] of [[80, 9], [120, 25], [160, 34]]) for (const own of [true, false]) {
    const ctx = context(cols, rows, own)
    expect(decidePage.render(ctx).actions.length).toBe(1)
    const out = frameRows(decidePage, ctx)
    const lines = out.map(text)
    const indices = ['合成背景', '合成卡住', '[a] 先跑回歸', '建議'].map(s => lines.findIndex(r => r.includes(s)))
    expect(indices.every(i => i >= 0), `${cols}: PM answer summary: ${lines.join("|")}`).toBe(true)
    for (let i = 1; i < indices.length; i++) expect(indices[i]).toBeGreaterThan(indices[i - 1])
    expect(lines.join('\n')).not.toContain('撤回')
    if (own) expect(out.flat().filter(s => s.press === 'key:a' || s.press === 'key:b').length).toBeGreaterThanOrEqual(2)
    else expect(lines.some(r => r.includes('到 lead-x'))).toBe(true)
  }
})

test('W3: a missing blocks value still renders a labelled 卡住 — row on both kinds of card', () => {
  for (const own of [true, false]) {
    const out = frameRows(decidePage, context(160, 34, own, { ...card, blocks: null } as any)).map(text)
    expect(out.some(r => /卡住\s+—/.test(r))).toBe(true)
  }
})

test('W3: long card details have working next/back buttons while the first view retains clickable choices', () => {
  const long = { ...card, background: '合成背景' + '長背景敘述'.repeat(35), blocks: '合成卡住' + '阻擋說明'.repeat(30), recommendation: '建議全文結尾' }
  let nav = NO_NAV
  const seen: string[] = []
  const mk = (kind: string) => (props: any) => ({ kind, props })
  const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link') }
  const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.props?.children)] : []
  const draw = () => {
    const ctx = context(80, 10, true, long, nav)
    seen.push(frameRows(decidePage, ctx).map(text).join('\n'))
    return Pane(el, ctx.live, 'decide', () => {}, ctx.t, 80, undefined, undefined, undefined, undefined, null, null, null, null, null,
      { pages: PAGES, pageId: 'decide', console: ctx.console, nowMs: NOW, rows: 10, decide: nav,
        onPress: id => { nav = { ...nav, detailOffset: Number(id.split(':').pop()) } as any } })
  }
  let tree = draw()
  expect(walk(tree).some(n => n.kind === 'Button' && n.props.hotkey === 'a'), 'summary choice: ' + JSON.stringify(tree)).toBe(true)
  for (let i = 0; i < 30; i++) {
    // Locate by visible label: production Button keys are positional; press ids are closure-owned.
    const buttons = walk(tree).filter(n => n.kind === 'Button' && JSON.stringify(n.props.children).includes('展開答題區'))
    if (buttons.length === 0) break
    buttons[0].props.onPress()
    tree = draw()
  }
  expect(seen.join('\n')).toContain('建議全文結尾')
  expect(seen.length).toBeGreaterThan(1)
  expect(walk(tree).some(n => n.kind === 'Button' && JSON.stringify(n.props.children).includes('收回答題區')), 'back control: ' + JSON.stringify(tree)).toBe(true)
  expect((decideReduce({ ...nav, detailOffset: 3 } as any, { kind: 'next' }, context(80, 10, true), NOW).nav as any).detailOffset).toBe(0)
})

test('V3: own cards show z and f together, and both card kinds use the same fold control', () => {
  const mk = (kind: string) => (props: any) => ({ kind, props })
  const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link') }
  const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.props?.children)] : []
  for (const cols of [80, 120, 160]) for (const own of [true, false]) for (const folded of [true, false]) {
    let nav = { ...NO_NAV, folded }
    const ctx = context(cols, 24, own, card, nav)
    if (own) ctx.live.pending.push({ ...card, id: 'd-0a1b2c3e' })
    else ctx.console.cards.push({ ...ctx.console.cards[0], id: 'd-0a1b2c3e' })
    const tree = Pane(el, ctx.live, 'decide', () => {}, ctx.t, cols, undefined, undefined, undefined, undefined, null, null, null, null, null,
      { pages: PAGES, pageId: 'decide', console: ctx.console, nowMs: NOW, rows: 24, decide: nav,
        onKey: key => { nav = decideReduce(nav, key, ctx, NOW).nav } })
    const buttons = walk(tree).filter(n => n.kind === 'Button')
    const fold = buttons.find(n => n.props.hotkey === 'z')
    expect(fold, `${cols}: ${own ? 'own' : 'remote'} has z`).toBeDefined()
    if (own) expect(buttons.some(n => n.props.hotkey === 'f'), `${cols}: own also has f`).toBe(true)
    fold.props.onPress()
    expect(nav.folded).toBe(!folded)
  }
})

test('U2: an unanswered remote card has 補充 — and names its answering destination once', () => {
  for (const [cols, rows] of [[80, 24], [120, 30], [160, 40]]) {
    const out = frameRows(decidePage, context(cols, rows, false)).map(text)
    expect(out.filter(r => r.includes('到 lead-x · Claude (h1) 答')).length).toBe(1)
    expect(out.some(r => /補充\s+—/.test(r))).toBe(true)
    expect(out.some(r => /補充.*到 lead-x/.test(r))).toBe(false)
  }
})
