// UX gate round 2: fictional fixtures, exercised through the production page/frame.
import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import { quotaPage, renderQuota } from './quota'
import { consoleOf, ctxOf, POOLS } from './quota.fixture'
import { Pane } from '../pane'
import { PAGES } from './index'
import { makeT } from '../i18n'
import { decidePage, decideReduce, NO_NAV } from './decide'
import { NOW } from './quota.fixture'
import { wrapRow } from './rows'
import { displayWidth } from '../ui'
import { nowPage } from './now'
import { NO_DETAIL, NO_SECTIONS, headerText } from '../model'

const live = { state: 'ok', header: '', pending: [] } as never
const remote = {
  id: 'd-0a1b2c3d', question: '合成卡：先跑回歸嗎？', status: 'open', opened_at_ms: NOW - 86400000, executor_display: 'h1',
  background: '合成背景', blocks: '合成卡住', options: [{ label: '先跑回歸', description: '涵蓋排程邊界', recommended: true }, { label: '暫緩', description: '' }],
  recommendation: '先跑回歸',
}

const text = (row: { text: string }[]): string => row.map(s => s.text).join('')

test('X5: quota table, detail, actions and strip have no intervening empty rows', () => {
  for (const [cols, rows] of [[80, 24], [120, 30], [160, 40]] as const) {
    const out = frameRows(quotaPage, ctxOf(cols, rows, consoleOf(POOLS))).map(text)
    expect(out.length).toBe(rows)
    const first = out.findIndex((r, i) => i > 0 && r.trim() !== '')
    expect(first).toBeGreaterThan(0)
    expect(out.slice(first).filter(r => r.trim() === ''), cols + ': padding belongs above the content').toEqual([])
    expect(out[out.length - 1]).toContain('1 ')
  }
})

test('Y2: a remote card keeps the complete answer area in PM order and directs answering to h1', () => {
  const con = consoleOf([], { cards: [remote] }) as any
  expect(con.cards[0].background).toBe(remote.background)
  for (const [cols, rows] of [[80, 24], [120, 30], [160, 40]] as const) {
    const ctx = { ...ctxOf(cols, rows, con) as any, live }
    const out = frameRows(decidePage, ctx).map(text)
    const indices = ['合成背景', '合成卡住', '[a] 先跑回歸', '建議', '補充'].map(s => out.findIndex(r => r.includes(s)))
    expect(indices.every(i => i >= 0), cols + ': complete card').toBe(true)
    for (let i = 1; i < indices.length; i++) expect(indices[i]).toBeGreaterThan(indices[i - 1])
    expect(out.some(r => r.includes('涵蓋排程邊界'))).toBe(true)
    expect(out.some(r => r.includes('到 h1 答'))).toBe(true)
    expect(decidePage.render(ctx).body.flat().some(s => s.press?.startsWith('key:'))).toBe(false)
    for (const key of [{ kind: 'pick', index: 0 }, { kind: 'submit' }, { kind: 'fill' }] as const) {
      const r = decideReduce(NO_NAV, key, ctx, NOW)
      expect(r.effect).toBeNull()
      expect(r.nav.picks).toEqual({})
    }
  }
})

test('Y4: the 80x24 quota table labels 7-day, 5-hour and projected percentages, including compact rendering', () => {
  for (const shortBody of [false, true]) {
    const ctx = { ...ctxOf(80, 24, consoleOf(POOLS)) as any, shortBody }
    const out = renderQuota(ctx).body.map(text)
    const firstPool = out.findIndex(r => r.includes('31%'))
    const head = out.findIndex(r => r.includes('7 天') && r.includes('5 時') && r.includes('預測'))
    expect(firstPool).toBeGreaterThanOrEqual(0)
    if (shortBody) {
      // R4-2: headerless compact rows own their labels; headed tables do not repeat them.
      expect(head).toBe(-1)
      expect(out[firstPool]).toContain('7天 31%✗')
      expect(out[firstPool]).toContain('5時 0%✗')
      expect(out[firstPool]).toContain('預 47%✗')
    } else {
      expect(head, 'one header before the percentages').toBeGreaterThanOrEqual(0)
      expect(head).toBeLessThan(firstPool)
      expect(out[firstPool]).not.toContain('7天')
      expect(out[firstPool]).not.toContain('5時')
    }
  }
})

test('Z1: wrap at clause boundaries, keeping statusline 沒在跑 and · z 收合 whole', () => {
  for (const sentence of ['✗ 額度 180 分未更新（>10 分，statusline 沒在跑）', '額度資料與使用量 · z 收合']) {
    const phrase = sentence.includes('statusline') ? 'statusline 沒在跑' : '· z 收合'
    for (const cols of [26, 28, 30, 32, 34, 36, 38, 40]) {
      const out = wrapRow([{ text: sentence, color: 'error' as never }], cols, 2)
      const lines = out.map(text)
      expect(lines.some(r => r.includes(phrase)), cols + ': ' + lines.join('|')).toBe(true)
      expect(lines.join('').replace(/\s+/g, '')).toBe(sentence.replace(/\s+/g, ''))
      expect(lines.every(r => displayWidth(r) <= cols)).toBe(true)
      expect(out.flat().every(s => s.color === 'error')).toBe(true)
    }
  }
})

test('Z3: a project hash without stage has a Chinese explanation and missing context says 上下文 —', () => {
  const t = makeT('zh-TW')
  const hash = '3ebbdc778104dcc3'
  const snap = { ...live as any, project_key: hash, detail: NO_DETAIL, sections: NO_SECTIONS, metrics: { ctx: '—' } }
  const ctx = { ...ctxOf(120, 30, consoleOf([], { cards: [], items: [], lines: [] })) as any, live: snap }
  const out = frameRows(nowPage, ctx).map(text)
  const where = out.find(r => r.includes(hash)) ?? ''
  expect(where).toContain('專案')
  expect(where).toContain('讀不到狀態')
  expect(where).toContain('上下文 —')
  expect(out.some(r => /\bctx\b/.test(r))).toBe(false)
  expect(headerText({}, null, '—', t)).toContain('上下文 —')
})

test('Z4: the focused decision title keeps (1/3 · 1 天) on the same row at every pane width', () => {
  for (const [cols, rows] of [[80, 24], [120, 30], [160, 40]] as const) {
    const cards = [remote, { ...remote, id: 'd-0a1b2c3e', opened_at_ms: NOW - 2000 }, { ...remote, id: 'd-0a1b2c3f', opened_at_ms: NOW - 1000 }]
    for (const own of [false, true]) {
      const pending = own ? cards.map(c => ({ ...c, source: 'h1', age_s: null, opened_at: new Date(c.opened_at_ms).toISOString(), title: null, why: null, origin: null, orphaned: false, stale: false, not_authorized: null })) : []
      const ctx = { ...ctxOf(cols, rows, consoleOf([], { cards: own ? [] : cards })) as any, live: { ...live as any, pending } }
      const out = frameRows(decidePage, ctx).map(text)
      const title = out.find(r => r.startsWith('▸ ')) ?? ''
      expect(title).toContain('合成卡')
      expect(title).toContain('(1/3 · 1 天)')
      expect(displayWidth(title)).toBeLessThanOrEqual(cols)
    }
  }
})

test('X5: the inert focus anchor shares the final strip row instead of adding a row below it', () => {
  const mk = (kind: string) => (props: any) => ({ kind, props })
  const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link') }
  const root = Pane(el, null, 'spend', () => {}, makeT('zh-TW'), 120, undefined, undefined, undefined, undefined, null, null, null, null, null,
    { pages: PAGES, pageId: 'quota', console: consoleOf(POOLS) as never, nowMs: 0, rows: 30 }) as any
  const children = root.props.children.flat(9).filter(Boolean)
  expect(children.length).toBe(30)
  expect(children[children.length - 1].kind).toBe('Box')
  const tail = children[children.length - 1].props.children.flat(9).filter(Boolean)
  expect(tail.some((n: any) => n.kind === 'Button' && n.props.autoFocus === true)).toBe(true)
})
