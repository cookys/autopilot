// mods/live/walkchart.test.ts — the stage walk drawn as aligned columns (ui.walkChart): each dot sits over its label's first cell,
// the current label wears the `here` colour, and a narrow pane falls back to the dot row plus a "step k/n" line.
import { test, expect } from 'claude-code/testing'
import { walkChart, displayWidth, PALETTE, KEY_W } from './ui'
import type { Ctx } from './ui'
import { EN, ZH_TW } from './locales'

const WALK = ['intent', 'proposal', 'plan', 'plan-review', 'implement', 'verify', 'code-review', 'qc-gate', 'finish']
const tr = (T: Record<string, string>) => (id: string, v?: Record<string, string | number>): string => (T[id] ?? id).replace(/\{(\w+)\}/g, (_m, k) => String(v?.[k]))
const labelsOf = (T: Record<string, string>): string[] => WALK.map(id => T['stage.' + id])
type S = { text: string; color?: string; dim?: boolean }
const segsOf = (l: unknown): S[] => (l as { segs: S[] }).segs
const textOf = (l: unknown): string => segsOf(l).map(s => s.text).join('')
// the starting display cell of each segment whose text is non-blank and not a rule run
function starts(l: unknown, pick: (s: S) => boolean): number[] {
  const out: number[] = []
  let at = 0
  for (const s of segsOf(l)) { if (pick(s)) out.push(at); at += displayWidth(s.text) }
  return out
}
const LOCALES: [string, Record<string, string>][] = [['zh-TW', ZH_TW], ['en', EN]]

test('walk columns: every dot starts on the same cell as its label, in both locales and at every step', () => {
  for (const [name, T] of LOCALES) {
    const labels = labelsOf(T)
    for (let at = 0; at < WALK.length; at++) {
      const u: Ctx = { t: tr(T), cols: 200 }
      const [dotRow, nameRow] = walkChart(u, 'L', labels, at, 'now.position')
      const dots = starts(dotRow, s => /^[^\s─]$/u.test(s.text) && s.text !== 'L')
      const names = starts(nameRow, s => s.text.trim() !== '')
      expect(dots.length, name).toBe(9)
      expect(dots, `${name} step ${at + 1}`).toEqual(names)
      dots.slice(1).forEach((d, i) => expect(d - dots[i], `${name} column ${i + 1} is label width + 2`).toBe(displayWidth(labels[i]) + 2))
    }
  }
})

test('walk columns: the current label has the here colour, the finished ones are dim, the rest idle', () => {
  const labels = labelsOf(ZH_TW)
  const [, nameRow] = walkChart({ t: tr(ZH_TW), cols: 200 }, 'L', labels, 4, 'now.position')
  const named = segsOf(nameRow).filter(s => s.text.trim() !== '')
  expect(named.map(s => s.text)).toEqual(labels)
  named.forEach((s, i) => {
    if (i === 4) expect(s.color).toBe(PALETTE.here)
    else if (i < 4) expect(s.dim).toBe(true)
    else expect(s.color).toBe(PALETTE.idle)
  })
  expect(ZH_TW['stage.qc-gate']).toBe('QC關卡')
})

test('walk fallback: a narrow pane keeps the dot row and adds "step k/n · stage  next: stage"; the last step has no next', () => {
  const labels = labelsOf(ZH_TW)
  const narrow: Ctx = { t: tr(ZH_TW), cols: 60 }
  const mid = walkChart(narrow, 'L', labels, 4, 'now.position')
  expect(mid.length).toBe(2)
  expect((mid[1] as unknown as { hang?: number }).hang, 'the step line hangs at the key column').toBe(KEY_W)
  expect(textOf(mid[1]).trim()).toBe('第 5／9 步 · 實作　下一步：驗證')
  const last = walkChart(narrow, 'L', labels, 8, 'now.position')
  expect(textOf(last[1]).trim()).toBe('第 9／9 步 · 收尾')
  const en = walkChart({ t: tr(EN), cols: 60 }, 'L', labelsOf(EN), 4, 'now.position')
  expect(textOf(en[1]).trim()).toBe('step 5/9 · implement  next: verify')
})
