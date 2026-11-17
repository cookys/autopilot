// frame.golden.test.ts — r2 §3.1 / §6.1 (codeforge plan 2026-11-18-pane-tabs-r2, PM 01M7N33J): frameRows(page, ctx) is exactly H rows in
// every page × state × size, actions sit in the reserved zone right above the strip, body overflow ends in a more row.
// Interface per autopilot 01M7N4GD: pages/frame.ts exports frameRows + types, pages/index.ts exports PAGES (key order).
// Red until S0 lands (pages/frame.ts does not exist on faa6b4cb6).
import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import { PAGES } from './index'
import { makeT } from '../i18n'
import { parseConsole } from '../console'
import full from '../fixtures/console/console-full.fixture'

const SIZES = [[160, 40], [120, 30], [80, 24]] as const
const A = (rows: number) => (rows >= 32 ? 6 : 4)
const text = (row: { text: string }[]) => row.map(s => s.text).join('')
const t = makeT('zh-TW')
const nowMs = 1794200000000
const consoles = [['console', () => parseConsole(JSON.stringify(full))], ['no console', () => null]] as const
const ctxOf = (cols: number, rows: number, console: unknown) => ({ live: null, console, size: { cols, rows }, t, nowMs }) as never

for (const [cols, rows] of SIZES) {
  test(`frame: ${cols}x${rows}, every registered page × console state is exactly ${rows} rows, strip last`, () => {
    const bad: string[] = []
    for (const page of PAGES)
      for (const [name, c] of consoles) {
        const ctx = ctxOf(cols, rows, c())
        const out = frameRows(page, ctx)
        if (out.length !== rows) bad.push(`${page.id}/${name}=${out.length}`)
        if (page.render(ctx).actions.length > A(rows)) bad.push(`${page.id}/${name} actions>${A(rows)}`)
        if (!/1\D*2\D*3\D*4/.test(text(out[out.length - 1]))) bad.push(`${page.id}/${name} strip not last`)
      }
    expect(bad.join(' ')).toBe('')
  })

  test(`frame: ${cols}x${rows}, overflow keeps ${rows} rows and the last body row says more; actions pinned above the strip`, () => {
    const body = Array.from({ length: rows * 3 }, (_, i) => [{ text: `row ${i}` }])
    const acts = [[{ text: 'ACT-1' }], [{ text: 'ACT-2' }]]
    const page = { ...PAGES[0], render: () => ({ body, actions: acts }) } as never
    const out = frameRows(page, ctxOf(cols, rows, null)).map(text)
    expect(out.length).toBe(rows)
    expect(out[rows - 2 - A(rows)]).toContain('還有')
    expect(out[rows - 3]).toContain('ACT-1')
    expect(out[rows - 2]).toContain('ACT-2')
    const empty = frameRows({ ...PAGES[0], render: () => ({ body: [], actions: [] }) } as never, ctxOf(cols, rows, null)).map(text)
    expect(empty.length).toBe(rows)
    expect(empty[rows - 2]).toContain('沒有要你處理的事')
  })

  test(`frame: ${cols}x${rows}, more than ${A(rows)} actions is a programming error`, () => {
    const many = Array.from({ length: A(rows) + 1 }, (_, i) => [{ text: `a${i}` }])
    expect(() => frameRows({ ...PAGES[0], render: () => ({ body: [], actions: many }) } as never, ctxOf(cols, rows, null))).toThrow()
  })
}
