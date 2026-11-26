// console v5 P5a: pages 1 現況, 3 派工, 4 審查, 5 花費, 6 殘留, 7 艦隊, 8 待辦, 9 說明 in the wide band + pane, verbatim against the design's 50 non-待決 steps
// (fixtures/pages-steps.testkit.ts = band rows 25-41 / pane rows 0-41 of out-wide-all; the data per step is gen_wide_all.py S, written out as page inputs in pages-golden.data.testkit.ts).
// Only the glyph table's swaps differ from the design: ▲→⏶ ★→✧ ⚠→△ ▏→_ ●→◉.
import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, wideBand } from './band'
import { widePane } from './pane'
import { PAGE_STEPS } from './fixtures/pages-steps.testkit'
import { SKIPS, composeStep } from './fixtures/pages-golden-data.testkit'

const SWAP: [string, string][] = [['▲', '⏶'], ['★', '✧'], ['⚠', '△'], ['▏', '_'], ['●', '◉']]
const norm = (s: string): string => SWAP.reduce((a, [x, y]) => a.split(x).join(y), s)
const cols = (s: string, from: number, to: number): string => {
  let out = ''
  let at = 0
  for (const ch of s) {
    const w = displayWidth(ch)
    if (at >= from && at + w <= to) out += ch
    at += w
  }
  return out
}
const firstDiffs = (got: string[], want: string[]): string => {
  const out: string[] = []
  for (let i = 0; i < Math.max(got.length, want.length) && out.length < 4; i++) if (got[i] !== want[i]) out.push(`row ${i}\n  got : ${got[i]}\n  want: ${want[i]}`)
  return out.join('\n')
}

for (const step of PAGE_STEPS) {
  if (step.id === 'C2') continue // the cross-page note of an open 待決 card: covered in decide.test.ts
  const body = (): void => {
    const c = composeStep(step.id)
    const status = norm(cols(step.band[14], 2, 108).trimEnd())
    const band = wideBand({ page: c.page, tabs: WIDE_TABS, stepTitle: c.out.stepTitle, list: c.out.list, reply: c.out.reply, status, hints: c.out.hints, replyKeep: c.out.replyKeep })
    const pane = widePane({ ...c.pane, page: c.page, tabs: WIDE_TABS, moved: band.overflow.reply, more: band.overflow.list })
    const wantBand = step.band.map(norm)
    const wantPane = step.pane.map(norm)
    if (JSON.stringify(band.rows) !== JSON.stringify(wantBand)) throw new Error(`band differs from the design\n${firstDiffs(band.rows, wantBand)}`)
    if (JSON.stringify(pane.rows) !== JSON.stringify(wantPane)) throw new Error(`pane differs from the design\n${firstDiffs(pane.rows, wantPane)}`)
    expect(band.rows.length).toBe(17)
    expect(pane.rows.length).toBe(42)
  }
  const title = `P5a wide ${step.tab} ${step.id} (${step.title}): the 17 band rows and 42 pane rows equal the design (glyph table swaps only)`
  const skip = SKIPS[step.id]
  // this test runner has no test.skip: a skipped step is a test that proves the design contradicts itself instead of comparing the screen
  if (skip !== undefined) test(`P5a wide ${step.tab} ${step.id} (${step.title}): SKIPPED, ${skip.reason}`, () => expect(skip.holds([...step.band, ...step.pane])).toBe(true))
  else test(title, body)
}
