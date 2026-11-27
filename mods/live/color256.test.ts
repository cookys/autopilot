// color256.test.ts: 256-colour terminals quantize the theme keys claude (174 #d78787 = 2.73 on light) and inactive (#626262 = 2.73 on dark) under the 3:1 bar.
// In 256 mode the pane sends exact cube colours that clear 3:1 on both themes; truecolor keeps the theme keys. PM ruling r-8b068b12 (01M8FJWEMJ).
import { test, expect } from 'claude-code/testing'
import { PAGES } from './pages/index'
import { frameRows } from './pages/frame'
import { decidePage } from './pages/decide'
import { makeT } from './i18n'
import { CLAUDE_256, INACTIVE_256, drawSeg, ink, is256, isTruecolorValue, setTruecolor } from './ui'
import type { Seg } from './model'

const lum = (hex: string): number => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }

test('ink: 256 mode swaps claude and inactive for cube colours, every other key and truecolor pass through', () => {
  try {
    setTruecolor(false)
    expect(is256()).toBe(true)
    expect(ink('claude')).toBe(CLAUDE_256)
    expect(ink('inactive')).toBe(INACTIVE_256)
    expect(ink('success')).toBe('success')
    expect(ink(undefined)).toBeUndefined()
    setTruecolor(true)
    expect(ink('claude')).toBe('claude')
    expect(ink('inactive')).toBe('inactive')
  } finally { setTruecolor(true) }
  expect(isTruecolorValue('truecolor', 'xterm') && isTruecolorValue('24bit', 'xterm') && isTruecolorValue(undefined, undefined)).toBe(true)
  expect(isTruecolorValue('truecolor', 'xterm-256color'), 'truecolor claimed on a *-256color terminal: CC quantizes, so lean to 256').toBe(false)
  expect(isTruecolorValue('truecolor', 'xterm', '/tmp/tmux-1/default,1,0'), 'under tmux').toBe(false)
  expect(isTruecolorValue(undefined, 'xterm-256color') || isTruecolorValue('', 'screen-256color'), 'a real 256-colour terminal is not truecolor').toBe(false)
})

test('the replacement colours clear 3:1 on both a white and a black terminal background', () => {
  for (const c of [CLAUDE_256, INACTIVE_256]) {
    expect(ratio(c, '#ffffff'), c + ' on white').toBeGreaterThanOrEqual(3)
    expect(ratio(c, '#000000'), c + ' on black').toBeGreaterThanOrEqual(3)
  }
  expect(ratio('#d78787', '#ffffff'), 'the quantized claude key is the failure being fixed').toBeLessThan(3)
})

test('drawSeg in 256 mode: claude text, inactive text and dim text all resolve to a cube colour, no dimColor; truecolor keeps keys', () => {
  try {
    setTruecolor(false)
    expect(drawSeg({ text: 'x', color: 'claude' }).color).toBe(CLAUDE_256)
    expect(drawSeg({ text: 'x', color: 'inactive' }).color).toBe(INACTIVE_256)
    const dim = drawSeg({ text: 'x', dim: true })
    expect(dim.color).toBe(INACTIVE_256)
    expect(dim.dimColor).toBeUndefined()
    setTruecolor(true)
    expect(drawSeg({ text: 'x', color: 'claude' }).color).toBe('claude')
    expect(drawSeg({ text: 'x', dim: true }).dimColor).toBe(true)
  } finally { setTruecolor(true) }
})

test('rendered 待決 frame at 13/14/17/40/50 rows: in 256 mode no drawn segment resolves to the claude or inactive key or to dimColor', () => {
  const t = makeT('zh-TW') as never
  try {
    setTruecolor(false)
    for (const rows of [13, 14, 17, 40, 50]) {
      const cards = [{ id: 'd-c1', title: '合併 plan', question: '要不要合併？', background: null, options: [{ label: '合併', detail: '', recommended: true }, { label: '再審', detail: '', recommended: false }] }]
      const ctx = { live: null, console: null, size: { cols: 120, rows }, t, nowMs: 0, box: true, maxRows: rows, v74: { decide: cards, awaiting: [{ id: 'd-a1', title: '插電', question: '插？', operator_steps: ['插電', '按完成'] }], pm: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } } as never
      const segs = frameRows(decidePage, ctx, { pages: PAGES, topAnchor: true }).flat() as Seg[]
      expect(segs.length, rows + ' rows: something is drawn').toBeGreaterThan(0)
      for (const s of segs) {
        const d = drawSeg(s)
        expect(d.color === 'claude' || d.color === 'inactive', rows + ' rows: ' + JSON.stringify(s.text)).toBe(false)
        expect(d.dimColor, rows + ' rows: dim ' + JSON.stringify(s.text)).toBeUndefined()
      }
    }
  } finally { setTruecolor(true) }
})
