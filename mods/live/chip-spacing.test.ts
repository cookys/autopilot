// Chip spacing invariant (codeforge doc/specs/tui-guideline.md §3.5, rule 3): every band the live mod draws, at every width, keeps
//   - a chip = mark + ONE space + value   (a mark is never followed by a non-blank character)
//   - chips CHIP_GAP (2 spaces) apart, never 3+ blanks in a row
//   - groups ` │ `, meta ` · ` (the band writes no bare `│`)
//   - a chip is never cut: no mark left without its value, however narrow the line
// The helper is `ui.chipSegs` / `ui.chipsJoin`; the source-level half of this rule (no glyph glued by `+`) is L10 in ui-lint.test.js.
// Run: `bash mods/live/run-tests.sh`.
import { test, expect } from 'claude-code/testing'
import { bandSlots, layoutBand, readMarker, readReview, readQc, readLoadSource, readResidue, slotDispatch, slotReview, slotDecisions, slotHygiene, slotPosition, slotUnit, qcChip } from './model'
import type { Slot } from './model'
import { GLYPHS, CHIP_GAP, CHIP_MARK, CHIP_META, chipSegs, chipsJoin, stateBadge, stateOf } from './ui'
import type { BadgeStated } from './ui'

const KEY = 'a1b2c3d4e5f60718'
const SCOPE = { project_key: KEY, root_run_id: null }
const NOW = Date.parse('2026-10-04T10:00:30.000Z')
// every mark a chip can start with: the state glyphs and the structure glyphs that lead a value (§3.1, §3.2)
const MARKS = [...Object.values(GLYPHS.state), GLYPHS.structure.residue, GLYPHS.structure.behind, GLYPHS.structure.round, GLYPHS.structure.decisions, GLYPHS.structure.age]
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MARK_RE = MARKS.map(esc).join('|')

const marker = (over: Record<string, unknown> = {}) => readMarker({ size: 'M', level: 'l5', stage: 'implement', stage_set_at: '2026-10-04T09:57:30.000Z', unit: { kind: 'deliverable', index: 3, total: 5, label: '' }, review_families: ['a', 'b'], ...over })
const review = readReview(JSON.stringify({ schema: 'autopilot.review/1', project_key: KEY, code: { generation: 3, seats: [] } }), KEY)
const qc = (state: string) => readQc(JSON.stringify({ schema: 'autopilot.qc-status/1', scope: SCOPE, state }), SCOPE)
const ls = (over: Record<string, unknown> = {}) => readLoadSource(JSON.stringify({ schema: 'autopilot.load-source/1', source: 'dev', marketplace: 'directory', behind_upstream: 3, flags: [], stale_cache_dirs: [], ...over }))
const rs = (n: number) => readResidue(JSON.stringify({ schema: 'autopilot.residue/1', project_key: KEY, reapable_worktrees: 0, by_class: {}, needs_human_count: n }), KEY)
const dv = (over: Record<string, unknown>) => ({ rows: [], count: 0, irreversible: 0, writers: [], undocumented: 0, identity: null, root: null, ladder: null, ...over }) as never

// every chip-bearing state of the band: all slots on, each slot with its variants
function fixtures() {
  const base = { verdict: { mark: '⊘', word: '疑似卡住', key: 'error' as const }, spend: { brain: 120, cap: 150 }, nowMs: NOW }
  const out: { name: string; slots: Slot[] }[] = []
  const add = (name: string, f: Record<string, unknown>) => out.push({ name, slots: bandSlots({ ...base, marker: marker(), live: 2, stalled: 1, review, qc: qc('owed'), decisions: dv({ count: 7, undocumented: 2, ladder: { rung: 'U3', at: 'x' } }), loadSource: ls(), residue: rs(3), ...f } as never) })
  add('all on', {})
  add('qc ok', { qc: qc('ok'), stalled: 0 })
  add('marketplace flagged', { loadSource: ls({ flags: ['marketplace_not_directory'] }) })
  add('cache source', { loadSource: ls({ source: 'cache:2.36.36', flags: ['loaded_from_cache'] }) })
  add('stalled only', { live: 0, stalled: 4, review: null, qc: qc('not_needed') })
  add('no residue, no behind', { residue: rs(0), loadSource: ls({ behind_upstream: 0 }) })
  add('dev label then residue chip', { loadSource: ls({ behind_upstream: 0 }) })
  add('residue alone', { loadSource: null, review: null, qc: null, decisions: null, marker: null, live: 0, stalled: 0 })
  add('wide numbers', { live: 12, stalled: 34, decisions: dv({ count: 123, undocumented: 45 }), residue: rs(67) })
  return out
}
const WIDTHS = [20, 24, 40, 56, 60, 76, 79, 80, 90, 100, 119, 120, 140, 159, 160, 180, 209, 240]

// the violations of one band line; the verdict (mark + word, first seg) is cut as its own rule says ("the glyph stays"), so it is left out.
// A chip is `<mark or QC> <value>`: the value is a run of non-blank characters that is not a separator (`│`, `·`, `─`). Chips of one group are exactly CHIP_GAP apart.
const SEP = '│·─'
const TWO_BLANKS = '  ' // written out, not CHIP_GAP: a test that reads the constant it checks passes when the constant is wrong
function violations(text: string, verdictLen: number): string[] {
  const out: string[] = []
  const body = text.slice(verdictLen)
  const near = (i: number) => JSON.stringify(body.slice(Math.max(0, i - 3), i + 4))
  if (/ {3,}/.test(body)) out.push('3+ blanks in a row: ' + JSON.stringify(body))
  if (/[^ ]│|│[^ ]/.test(body)) out.push('bare group bar: ' + JSON.stringify(body))
  if (/ ·(?! )|(?<! )· /.test(body)) out.push('meta dot without a blank on both sides: ' + JSON.stringify(body)) // `size·level·stage` has no blanks around its dots and is not meta
  // every mark has a value: one space, then a character that is not blank and not a separator
  for (const m of body.matchAll(new RegExp(MARK_RE, 'gu'))) {
    const i = m.index ?? 0
    const next = body.slice(i + m[0].length)
    if (body.slice(Math.max(0, i - 3), i) === 'QC ') continue // the mark of a `QC <mark>` chip is its value
    if (!new RegExp('^ [^\\s' + SEP + ']').test(next) && !/^─/.test(next)) {
      // no value after the mark: only the trailing flag of a word chip (`dev ▲`, `cache 2.36.36 ▲`, `src ? ▲`) may stand that way, never a cut chip
      const flag = (m[0] === '▲' || m[0] === '?') && /^(?: │|  |$)/.test(next) && /[^ ] $/.test(body.slice(0, i))
      if (!flag) out.push('mark without its value / glued: ' + near(i))
    }
  }
  // chips of one group are exactly CHIP_GAP apart: `<mark|QC> <value>` then the blanks then the next mark, QC or rung
  for (const group of body.split(' │ ')) {
    const chips = [...group.matchAll(new RegExp('(?:QC|' + MARK_RE + ') [^\\s' + SEP + ']+(?: ▲(?= |$))?', 'gu'))] // a trailing ▲ flag (`dev ↓ 3 ▲`) is part of the chip it follows
    chips.forEach((c, k) => {
      // a text label belongs to the chip after it: exactly ONE blank between them (`dev ⚑ 2`, `implement ◷ 3m`, `dev ↓ 3`); two are for chip to chip only
      const start = c.index ?? 0
      const before = group.slice(0, start)
      const pad = /( +)$/.exec(before)?.[1] ?? ''
      const prev = chips[k - 1]
      const afterChip = prev !== undefined && (prev.index ?? 0) + prev[0].length === start - pad.length
      if (pad !== '' && !afterChip && pad !== ' ') out.push('label and chip ' + pad.length + ' blanks apart, not 1: ' + JSON.stringify(group))
      const end = (c.index ?? 0) + c[0].length
      const rest = group.slice(end)
      const nextChip = chips[k + 1]
      const between = nextChip === undefined ? (/^ +U\d/.exec(rest)?.[0].replace(/U\d$/, '') ?? null) : group.slice(end, nextChip.index)
      if (between !== null && /^ +$/.test(between) && between !== TWO_BLANKS) out.push('chips ' + JSON.stringify(between.length) + ' blank(s) apart, not 2' + ': ' + JSON.stringify(group))
    })
  }
  return out
}

test('chip spacing: every band fixture at every width keeps mark+1 space+value, 2-space chip gaps, and never cuts a chip', () => {
  const bad: string[] = []
  for (const f of fixtures()) for (const w of WIDTHS) {
    const line = layoutBand(f.slots, w)
    const first = line.segs[0]
    for (const v of violations(line.text, first === undefined ? 0 : first.text.length)) bad.push(f.name + ' @' + w + ': ' + v + ' in ' + JSON.stringify(line.text))
  }
  expect(bad).toEqual([])
})

test('chip spacing: each slot, as drawn, is chips joined by CHIP_GAP, each chip exactly `mark<space>value`', () => {
  const texts = (s: Slot | null) => (s === null ? '' : s.segs.map(g => g.text).join(''))
  expect(texts(slotDispatch(2, 1))).toBe('● 2  ⊘ 1')
  expect(texts(slotDispatch(0, 1))).toBe('⊘ 1')
  expect(texts(slotDispatch(3, 0))).toBe('● 3')
  expect(texts(slotReview(review, qc('owed')))).toBe('↺ R3  QC ▲')
  expect(texts(slotReview(null, qc('ok')))).toBe('QC ✓')
  expect(qcChip(qc('owed'))).toBe('QC ▲')
  expect(texts(slotDecisions(dv({ count: 7, undocumented: 2, ladder: { rung: 'U3', at: 'x' } })))).toBe('◆ 7  ? 2  U3')
  expect(texts(slotHygiene(ls(), rs(3)))).toBe('dev ↓ 3  ⚑ 3')
  expect(texts(slotHygiene(null, rs(3)))).toBe('⚑ 3')
  expect(texts(slotHygiene(ls({ behind_upstream: 0 }), rs(3)))).toBe('dev ⚑ 3') // a label and the chip it modifies: one blank
  expect(texts(slotPosition(marker(), NOW))).toBe('M·l5·implement ◷ 3m')
  expect(texts({ id: 'dispatch', segs: chipsJoin([chipSegs([{ text: '●' }], [{ text: '1' }]), chipSegs([{ text: '⊘' }], [{ text: '2' }])]) })).toBe('●' + CHIP_MARK + '1' + CHIP_GAP + '⊘' + CHIP_MARK + '2')
  expect(CHIP_GAP).toBe('  ')
  expect(CHIP_MARK).toBe(' ')
  expect(CHIP_META).toBe(' · ')
})

test('chip spacing: the state badge goes through the same helper (`⊘ 2`), and a lone ▲ stays a bare mark', () => {
  expect(stateBadge(stateOf('verdict', 'STALLED') as BadgeStated, 2, 'header.verdict' as never).text).toBe('⊘ 2')
  expect(stateBadge(stateOf('verdict', 'DECIDE') as BadgeStated, undefined, 'header.verdict' as never).text).toBe('▲')
})

test('chip spacing control: the checker reports a glued mark, a 3-space gap, a one-space gap, a separator as the value, a cut chip and a bare group bar', () => {
  expect(violations('●2  ⊘ 1', 0).length).toBeGreaterThan(0) // glued
  expect(violations('● 2   ⊘ 1', 0).length).toBeGreaterThan(0) // three blanks
  expect(violations('● 2 ⊘ 1', 0).length).toBeGreaterThan(0) // chips one blank apart (must fail)
  expect(violations('● 2  ⊘ 1 ↺ R3', 0).length).toBeGreaterThan(0) // one blank apart again, later in the line
  expect(violations('● │ ⓘ ', 0).length).toBeGreaterThan(0) // a group bar is not a value (must fail)
  expect(violations('● 2  ⊘ · x', 0).length).toBeGreaterThan(0) // a meta dot is not a value
  expect(violations('● 2  ⊘', 0).length).toBeGreaterThan(0) // cut chip
  expect(violations('● 2│⊘ 1', 0).length).toBeGreaterThan(0) // bare group bar
  expect(violations('◆ 3  ? 1 U2', 0).length).toBeGreaterThan(0) // the rung one blank after a chip
  expect(violations('dev  ⚑ 2', 0).length).toBeGreaterThan(0) // label + chip two blanks apart (must fail)
  expect(violations('M·l5·implement  ◷ 3m', 0).length).toBeGreaterThan(0) // same for the stage word + age
  expect(violations('dev  ↓ 3  ⚑ 2', 0).length).toBeGreaterThan(0)
  expect(violations('dev ⚑ 2 │ dev ↓ 3  ⚑ 2 │ implement ◷ 3m │ ⓘ ', 0)).toEqual([])
  expect(violations('● 2  ⊘ 1 │ ⓘ ', 0)).toEqual([])
  expect(violations('● 2  ↺ R3  QC ▲ │ ◆ 3  ? 1  U2 │ dev ↓ 3  ⚑ 2 │ ⓘ ', 0)).toEqual([])
  expect(violations('▰▰▰▱▱ 3/5 · 2fam │ cache 2.36.36 ▲ │ ⓘ ', 0)).toEqual([])
})

test('chip spacing: unit meta (`· 2fam`) is introduced by CHIP_META, and the checker reports a meta dot with no blank after it', () => {
  const texts = (s: Slot | null) => (s === null ? '' : s.segs.map(g => g.text).join(''))
  expect(texts(slotUnit(marker()))).toBe('▰▰▰▱▱ 3/5' + CHIP_META + '2fam')
  expect(violations('▰▰▰▱▱ 3/5 ·2fam │ ⓘ ', 0).length).toBeGreaterThan(0) // the old `·2fam`
  expect(violations('▰▰▰▱▱ 3/5 · 2fam │ ⓘ ', 0)).toEqual([])
})
