import { test, expect } from 'claude-code/testing'
import { decidePage, NO_NAV } from './decide'
import { makeT } from '../i18n'
import { newScroll } from '../scrollmath'
import { displayWidth } from '../model'

const t = makeT('zh-TW')
const nowMs = 1794200000000
const text = (row: { text: string }[]) => row.map(s => s.text).join('')
const live = () => ({ state: 'ok', header: '', pending: [] }) as never
const con = (_cards: unknown[], _items: unknown[]) => ({ generated_at_ms: nowMs, sources: { cards: { at_ms: nowMs, state: 'ok' } }, counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: {}, hosts: {}, hints: 0, quota_worst: null } }, quota: { pools: null, seats: [] }, items: [], cards: [], lines: [] }) as never
const nav = (o: Partial<typeof NO_NAV>) => ({ ...NO_NAV, ...o })

for (const cols of [120, 205]) {
  test(`boxed decide CJK columns and scrollbar align at ${cols} cells`, () => {
    const cards = [1, 2].map(i => ({ id: 'c' + i, title: '中文待決' + i, question: '如何處理？', background: '背景說明。'.repeat(100), options: [{ label: '選項甲', detail: '說明' }] }))
    const ctx = { live: live(), console: con([], []), size: { cols: cols - 4, rows: 20 }, bodyColumns: cols, maxRows: 30, t, nowMs, box: true, pendingScroll: { list: newScroll(), detail: newScroll(), cursor: '' }, decide: nav({ cursor: 0 }), v74: { decide: cards, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } } as never
    const body = decidePage.render(ctx).body.map(text)
    const header = body.findIndex(r => r.includes('卡 #01 / 2'))
    expect(header).toBeGreaterThanOrEqual(0)
    const mid = displayWidth(body[header].split('│')[0])
    const section = body.slice(header, body.length)
    for (const row of section) expect(displayWidth(row), row).toBe(cols - 4)
    expect(displayWidth(body[header + 1].split('│')[0])).toBe(mid)
    expect(body[header + 1]).toContain('│')
    expect(section.some(r => r.endsWith('█'))).toBe(true)
  })
}

// ---- 等你動手: answered cards that still wait on the operator's own step (durable store, status awaiting_operator_action) ----
