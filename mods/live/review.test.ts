// P1 of the live pane design system (docs/plans/2026-10-13-live-pane-design-system.md §5.3, §7 row "P1 審查"): the Review tab, built from ui.ts components.
// Pure tests: the tab builder over fixture snapshots (busy reproduces the owner's screenshots, rich is a live round, empty has no source, weird plants an unknown token).
// Enabled here for 審查: I1 to I8, I10 and I13 over every line of the tab, I11 rows F2 to F4, the QC chip, the toggles. The mounted I18 / I19 / I23 are in live.test.ts.
import { test, expect } from 'claude-code/testing'
import { makeT } from './i18n'
import { NO_DETAIL, NO_SECTIONS, reviewTabLines } from './model'
import type { DecisionRow, LiveSnapshot, PaneLine, ReviewSeat } from './model'
import { GLYPHS, STATES, displayWidth, emojiViolations, emphasisViolations, isMade } from './ui'

const NOW = Date.parse('2026-10-13T12:00:00Z')
const DAY = 86_400_000
const iso = (agoMs: number): string => new Date(NOW - agoMs).toISOString()
const zh = makeT('zh-TW')
const en = makeT('en')

const seat = (id: string, family: string, status: string | null, verdict: string | null = null): ReviewSeat => ({ id, family, status, verdict })
const decision = (n: number, text: string, over: Partial<DecisionRow> = {}): DecisionRow =>
  ({ round: 1, decision: text, irreversible: false, writer: 'depth0', decision_id: 'intent-17-' + n, source: null, root: null, ...over })

type Over = { review?: unknown; qc?: unknown; decisions?: unknown; now?: number | null; note?: string }
function snap(o: Over): LiveSnapshot {
  return {
    header: 'cost $1.00 · host $2.00', review: o.review ?? null,
    detail: { ...NO_DETAIL, now_ms: o.now === undefined ? NOW : o.now, qc: o.qc ?? null, decisions: o.decisions ?? null },
    sections: { ...NO_SECTIONS, decisions: o.note === undefined ? [] : [{ text: o.note, dim: true }] },
  } as never
}

const codeRound = (over: Record<string, unknown> = {}) => ({
  phase: null, generation: 1, base: '4abd667f0000000000', head: '10c5c0860000000000', converged: false, at: iso(60_000),
  seats: [seat('s0', 'anthropic', 'reviewed', 'SHIP-AS-IS'), seat('s1', 'zhipu', 'reviewed', 'FIX-THEN-SHIP'), seat('s2', 'minimax', 'reviewed', 'SHIP-AS-IS'), seat('s3', 'alibaba', 'reviewed', 'SHIP-AS-IS')],
  ...over,
})
const planReview = (over: Record<string, unknown> = {}) => ({
  logical_plan_id: 'blind-review-packet-2026-09-16', generation: 1, max_generations: 2, terminal: false, verdict: 'CONDITIONAL', updated_at: iso(27 * DAY),
  seats: [seat('glm_architecture', 'zhipu', 'READY'), seat('codex_operations_skeptic', 'openai', 'STOP')], ...over,
})
const busyDecisions = (over: Record<string, unknown> = {}) => ({
  rows: [
    decision(1, '#17 direction: A (keep the native <repo>/.claude/worktrees root for hand/native worktrees, no WorktreeCreate takeover; rail worktrees carry the repo slug; …). Owner did not answer within 60s; A is reversible and the smallest surface.'),
    decision(2, 'Owner answered (supersedes intent-17-1): direction C = A plus moving the dispatch-rail worktrees (hand and native stay under the repo)'),
    decision(3, 'verify node, no qualified verifier seat (engine-scorecard current --role verifier: none admissible)', { decision_id: 'verify-17-1' }),
  ],
  count: 3, irreversible: 0, writers: ['depth0'], undocumented: 32, identity: 'git-common-dir:/home/cookys/projects/autopilot/.git', root: null, ladder: null, ...over,
})
const QC_NOT_NEEDED = { state: 'not_needed', range: '5a2706ad1111111111..HEAD', protected_files_count: 0, evidence: null }

const busy = () => snap({ review: { plan: planReview(), code: codeRound() }, qc: QC_NOT_NEEDED, decisions: busyDecisions() })
const rich = () => snap({
  review: {
    plan: planReview({ updated_at: iso(60_000), seats: [seat('sol_chair', 'openai', 'running'), seat('grok_deep', 'xai', 'CONDITIONAL')] }),
    code: codeRound({ seats: [seat('s0', 'minimax', 'running'), seat('s1', 'zhipu', 'reviewed', 'FIX-THEN-SHIP'), seat('s2', 'openai', 'reviewed', 'SHIP-AS-IS')] }),
  },
  qc: { state: 'owed', range: 'aaaaaaaa11111111..bbbbbbbb22222222', protected_files_count: 2, evidence: null },
  decisions: busyDecisions({ irreversible: 1, undocumented: 1, rows: [decision(1, 'keep A', { irreversible: true }), decision(2, 'no id', { decision_id: null })], count: 2, ladder: { rung: 'U2', at: iso(3 * 3_600_000) } }),
})
const empty = () => snap({})
const weird = () => snap({ review: { plan: null, code: codeRound({ seats: [seat('s0', 'minimax', 'reviewed', 'SHIP-AS-IS'), seat('s1', 'zhipu', 'reviewed', 'WEIRD')] }) }, qc: { ...QC_NOT_NEEDED, state: 'unknown' } })
const FIXTURES: [string, () => LiveSnapshot][] = [['busy', busy], ['rich', rich], ['empty', empty], ['weird', weird]]
const COLS = [40, 60, 76, 100, 120, 160]
const LOCALES: [string, typeof zh][] = [['zh-TW', zh], ['en', en]]

const render = (s: LiveSnapshot, cols = 76, extra: { expanded?: string[]; folded?: string[]; t?: typeof zh } = {}): PaneLine[] =>
  reviewTabLines(s, { t: extra.t ?? zh, cols, expanded: new Set(extra.expanded ?? []), folded: new Set(extra.folded ?? []) })
const textsOf = (lines: PaneLine[]): string[] => lines.slice(2).map(l => l.text.trimEnd()) // without the legacy header line and its blank

// ---- the invariants I1 to I8 and I10 over a tab's lines (line 0, the legacy global header, is P4's: it is unbranded until the verdict header replaces it) ----
const RAW_TOKENS = ['SHIP-AS-IS', 'FIX-THEN-SHIP', 'BLOCK', 'REJECT', 'READY', 'APPROVE', 'PASS', 'CONDITIONAL', 'STOP', 'REVIEWED', 'NOT_NEEDED', 'WEIRD']
const hasToken = (text: string): boolean => RAW_TOKENS.some(tok => new RegExp('(^|[^A-Za-z0-9_-])' + tok + '($|[^A-Za-z0-9_-])', 'i').test(text))
const GLYPH_CHARS = new Set<string>([...Object.values(GLYPHS.state), ...Object.values(GLYPHS.structure), ...Object.values(GLYPHS.chart), ...Object.values(STATES).map(s => s.glyph)].flatMap(g => [...g]))
const STATE_KEY = new Map<string, string>(Object.values(STATES).map(s => [s.glyph, s.key]))
const leading = (text: string): number => text.length - text.trimStart().length

function violations(lines: PaneLine[], cols: number, t: typeof zh): string[] {
  const out: string[] = []
  const wordKey = new Map<string, string>(Object.entries(STATES).map(([id, s]) => [t('ui.state.' + id), s.key]))
  let empties = 0
  lines.slice(1).forEach((l, i) => {
    const at = 'line ' + (i + 1) + ' ' + JSON.stringify(l.text)
    if (displayWidth(l.text) > cols) out.push('I1 ' + at + ' is ' + displayWidth(l.text) + ' wide')
    if (!isMade(l) || l.kind === undefined) out.push('I2 ' + at + ' is not made by a component')
    if (l.kind === 'header') empties = 0
    if (l.kind === 'empty') { empties++; if (empties > 1) out.push('I10 ' + at + ': a second empty line in a section') }
    if (/沒有資料|no data/.test(l.text) && l.kind !== 'empty') out.push('I10 ' + at + ' says no data outside an empty line')
    if (l.kind !== 'blank' && l.text !== '') {
      const lead = leading(l.text)
      const attached = (l.kind === 'detail' || l.kind === 'command') && (lead === 14 || lead === 16) // a detail under a column-12 item moves right by 12 (§5.3, I23): `└` at 14, text at 16; I3 of the plan does not list them
      if (![0, 2, 4, 12].includes(lead) && !attached) out.push('I3 ' + at + ' starts at ' + lead)
      if (l.kind === 'kv' && l.hang !== 12) out.push('I3 ' + at + ' kv without hang 12')
    }
    if (l.kind === 'header') { // I4: `^[▾▸] \S.*─+$`, width cols - 1, column 0
      if (!/^[▾▸] \S.*─+$/u.test(l.text)) out.push('I4 ' + at + ' is not a header line')
      if (displayWidth(l.text) !== cols - 1) out.push('I4 ' + at + ' is ' + displayWidth(l.text) + ' wide, not ' + (cols - 1))
    }
    if (l.text.includes('▌')) out.push('I4 ' + at + ' contains ▌')
    for (const v of emphasisViolations(l)) out.push('I4 ' + at + ' ' + v)
    const needYouItem = l.kind === 'item' && (l.segs ?? []).some(g => g.role === 'glyph' && g.text === STATES.need_you.glyph) // the plan lets a need_you item bold its mark, word and body (§3.6)
    for (const s of l.segs ?? []) { // a bold segment only in a header, a verdict, a here segment, a need_you item, or a meter headline value (fmt pct)
      const meterHeadline = s.role === 'value' && s.fmt === 'pct'
      if (s.bold === true && l.kind !== 'header' && l.kind !== 'verdict' && s.here !== true && !needYouItem && !meterHeadline) out.push('I4 ' + at + ' seg ' + JSON.stringify(s.text) + ' is bold outside header / verdict / need_you / here / meter headline')
    }
    if (l.kind !== 'detail' && emojiViolations(l.text).length > 0) out.push('I5 ' + at + ' ' + emojiViolations(l.text).join(','))
    if (/[️⃣]/u.test(l.text)) out.push('I5 ' + at + ' has VS16 or keycap')
    for (const s of l.segs ?? []) {
      const sat = at + ' seg ' + JSON.stringify(s.text)
      if ('backgroundColor' in s || 'inverse' in s) out.push('I6 ' + sat + ' has a background')
      if (s.color === 'claude' && s.here !== true) out.push('I6 ' + sat + ' claude without here')
      if (s.role === 'glyph') {
        for (const ch of s.text) if (ch !== ' ' && !GLYPH_CHARS.has(ch)) out.push('I5 ' + sat + ' glyph not in GLYPHS')
        const key = STATE_KEY.get(s.text)
        if (key !== undefined && s.color !== undefined && s.color !== key) out.push('I6 ' + sat + ' glyph colour ' + s.color + ' != ' + key)
      }
      if (s.role === 'state') {
        const key = wordKey.get(s.text.trim())
        if (key === undefined || s.color !== key) out.push('I6 ' + sat + ' state word colour ' + String(s.color) + ' != ' + String(key))
      }
      if (s.color === 'suggestion' && s.role !== 'glyph' && s.role !== 'state') out.push('I6 ' + sat + ' suggestion outside a running mark')
      if ((s.role === 'state' || s.role === 'value') && l.kind !== 'detail' && l.kind !== 'command') { // a command is copied verbatim: ids and paths are its text
        if (hasToken(s.text)) out.push('I7 ' + sat + ' holds a raw token')
        if (/\[exited with code|\brc \d/.test(s.text)) out.push('I7 ' + sat + ' holds an exit marker')
        if (/\d/.test(s.text) && s.fmt === undefined) out.push('I8 ' + sat + ' has a number no formatter made')
      }
      if (s.fmt === 'sha' && !/^((\p{Hex_Digit}{8})|—)(\.\.((\p{Hex_Digit}{8})|—|HEAD))?$/u.test(s.text)) out.push('I8 ' + sat + ' is not 8 hex')
      if (s.fmt === 'ago' && /\d/.test(s.text) && !/\d+(s|m|d|h\d\dm)/.test(s.text)) out.push('I8 ' + sat + ' is not a duration')
      if (s.fmt === 'count' && /\d\*/.test(s.text)) out.push('I8 ' + sat + ' has N*')
    }
  })
  return out
}
// every disclosure toggle id in a render (the `sec:` ones are folds, not disclosures), so the matrix can open them all
const toggleIds = (lines: PaneLine[]): string[] => lines.flatMap(l => (l.toggle !== undefined && !l.toggle.startsWith('sec:') ? [l.toggle] : []))

test('I1-I8, I10: every line of the Review tab, over fixtures x locales x widths, default and with every toggle open', () => {
  const found: string[] = []
  for (const [name, make] of FIXTURES) for (const [loc, t] of LOCALES) for (const cols of COLS) {
    const base = render(make(), cols, { t })
    const opened = render(make(), cols, { t, expanded: toggleIds(base) })
    for (const [mode, lines] of [['default', base], ['open', opened]] as const) {
      for (const v of violations(lines, cols, t)) found.push(name + ' ' + loc + ' ' + cols + ' ' + mode + ': ' + v)
    }
  }
  expect(found).toEqual([])
})

test('negative controls of the checker: a hand-made line, a raw token in a value, an unformatted number, a 1-space indent, a too-wide line and a second empty line are each flagged', () => {
  const lines = render(busy(), 76)
  const bad = [lines[0], lines[1], { text: '  hand made', kind: 'kv' as const }, ...lines.slice(2)]
  expect(violations(bad, 76, zh).some(v => v.startsWith('I2'))).toBe(true)
  const withSeg = (extra: { text: string; role: 'value' }): PaneLine[] => lines.map(l => (l.kind === 'kv' && l.text.startsWith('範圍') ? { ...l, segs: [...(l.segs ?? []), extra] } : l))
  expect(violations(withSeg({ text: ' SHIP-AS-IS', role: 'value' }), 76, zh).some(v => v.startsWith('I7'))).toBe(true)
  expect(violations(withSeg({ text: ' 12 MB', role: 'value' }), 76, zh).some(v => v.startsWith('I8'))).toBe(true)
  expect(violations(lines.map(l => (l.kind === 'kv' ? { ...l, text: ' ' + l.text } : l)), 76, zh).some(v => v.startsWith('I3'))).toBe(true)
  expect(violations(lines.map(l => (l.kind === 'kv' ? { ...l, text: l.text + 'x'.repeat(80) } : l)), 76, zh).some(v => v.startsWith('I1'))).toBe(true)
  const i4 = (map: (l: PaneLine) => PaneLine): string[] => violations(lines.map(map), 76, zh).filter(v => v.startsWith('I4'))
  expect(i4(l => l)).toEqual([]) // control: the unmodified render is I4-clean
  expect(i4(l => (l.kind === 'kv' && l.text.startsWith('範圍') ? { ...l, segs: (l.segs ?? []).map(s => (s.role === 'value' ? { ...s, bold: true } : s)) } : l)).length).toBeGreaterThan(0) // a bold value outside header / verdict
  expect(i4(l => (l.kind === 'kv' && l.text.startsWith('範圍') ? { ...l, segs: (l.segs ?? []).map(s => (s.role === 'value' ? { ...s, bold: true, dim: true } : s)) } : l)).length).toBeGreaterThan(0) // bold and dim on one segment
  // a findings item (△ 待修, also the warning colour) is not need_you: its bold mark must be caught
  expect(i4(l => (l.kind === 'item' && l.text.includes('待修') ? { ...l, segs: (l.segs ?? []).map(s => (s.role === 'glyph' || s.role === 'state' ? { ...s, bold: true } : s)) } : l)).length).toBeGreaterThan(0)
  // positives: a need_you item may bold its mark, word and body; a meter headline value may be bold
  const needYouItem = (l: PaneLine): PaneLine => (l.kind === 'item' && l.text.includes('待修')
    ? { ...l, segs: [{ text: STATES.need_you.glyph, role: 'glyph' as const, color: STATES.need_you.key, bold: true }, { text: ' ', role: 'prose' as const }, { text: l.text.trim(), role: 'prose' as const, bold: true }] }
    : l)
  expect(i4(needYouItem)).toEqual([])
  expect(i4(l => (l.kind === 'kv' && l.text.startsWith('範圍') ? { ...l, segs: [...(l.segs ?? []), { text: ' 80%', role: 'value' as const, fmt: 'pct' as const, bold: true, color: 'warning' as const }] } : l))).toEqual([])
  expect(i4(l => (l.kind === 'kv' ? { ...l, text: l.text + '▌' } : l)).length).toBeGreaterThan(0)
  expect(i4(l => (l.kind === 'header' ? { ...l, text: l.text.slice(0, -1) } : l)).length).toBeGreaterThan(0) // a header one cell short
  expect(i4(l => (l.kind === 'header' ? { ...l, text: l.text.replace(/^[▾▸] /u, '') } : l)).length).toBeGreaterThan(0) // a header without its fold mark
  const world = render(empty(), 76)
  const firstEmpty = world.findIndex(l => l.kind === 'empty')
  expect(violations(world, 76, zh)).toEqual([]) // control: the empty world itself is clean
  expect(violations([...world.slice(0, firstEmpty + 1), world[firstEmpty], ...world.slice(firstEmpty + 1)], 76, zh).some(v => v.startsWith('I10'))).toBe(true)
})

// ---- goldens: the §5.3 mockups at 76 columns, pinned to the real output ----
const GOLDEN_DEFAULT = [
  '▾ 程式碼審查  △ 待修 ──────────────────────────────────────────────────────',
  '輪次        R1 · 4abd667f..10c5c086',
  '席位',
  '            ✓ 完成  s0 · anthropic                                        ▸',
  '            △ 待修  s1 · zhipu                                            ▸',
  '            ✓ 完成  s2 · minimax                                          ▸',
  '            ✓ 完成  s3 · alibaba                                          ▸',
  '▾ 推送前 QC  ∅ 不需要 ─────────────────────────────────────────────────────',
  '範圍        5a2706ad..HEAD · 0 個受保護檔案',
  '▾ 代你決定  3 件 · 0 件不可逆 ─────────────────────────────────────────────',
  '◦ verify-17-1  verify node, no qualified verifier seat (engine-scorecard… ▸',
  '◦ intent-17-2  Owner answered (supersedes intent-17-1): direction C = A … ▸',
  '◦ intent-17-1  #17 direction: A (keep the native <repo>/.claude/worktree… ▸',
  '未記錄      32 件派工沒有決策紀錄',
  '升級階梯    — 沒有紀錄',
  '▸ 計畫審查  ◌ 已停 · 27d 前 ───────────────────────────────────────────────',
]
test('golden (76 columns, zh-TW): the default render of the owner\'s busy world is the §5.3 mockup', () => {
  expect(textsOf(render(busy(), 76))).toEqual(GOLDEN_DEFAULT)
})

test('decisions are newest first (§2.4): with 7 the 7th shows and the 1st sits behind more; opening more lists all 7 newest first', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map(n => decision(n, 'decision number ' + n))
  const s = snap({ review: null, decisions: busyDecisions({ rows, count: 7, undocumented: 0 }) })
  const ids = (lines: PaneLine[]): string[] => lines.filter(l => l.toggle?.startsWith('dec:') === true).map(l => l.toggle as string)
  expect(ids(render(s, 76))).toEqual(['dec:intent-17-7', 'dec:intent-17-6', 'dec:intent-17-5', 'dec:intent-17-4', 'dec:intent-17-3'])
  expect(ids(render(s, 76, { expanded: ['more:review.decisions'] }))).toEqual([7, 6, 5, 4, 3, 2, 1].map(n => 'dec:intent-17-' + n))
})

test('decisions from several roots are ordered by their time, not by position: marker roots come first in the merged list but a later row from them still shows first', () => {
  const at = (h: number): string => new Date(Date.UTC(2026, 9, 13, h)).toISOString()
  const row = (id: string, h: number) => decision(1, 'decision ' + id, { decision_id: id, at: at(h) } as Partial<DecisionRow>)
  const rows = [row('m1', 1), row('m2', 7), row('c2', 2), row('c3', 3), row('c4', 4), row('c5', 5), row('c6', 6)] // marker root (m1, m2), then the campaign (c2..c6)
  const s = snap({ review: null, decisions: busyDecisions({ rows, count: 7, undocumented: 0 }) })
  const ids = (lines: PaneLine[]): string[] => lines.filter(l => l.toggle?.startsWith('dec:') === true).map(l => l.toggle as string)
  expect(ids(render(s, 76))).toEqual(['dec:m2', 'dec:c6', 'dec:c5', 'dec:c4', 'dec:c3'])
  expect(ids(render(s, 76, { expanded: ['more:review.decisions'] })).slice(-2)).toEqual(['dec:c2', 'dec:m1'])
})

test('decisions without a parseable time fall back to position order, stably: a missing or bad time on any row means newest = last in the list', () => {
  const at = (h: number): string => new Date(Date.UTC(2026, 9, 13, h)).toISOString()
  const mk = (ids: string[], times: (string | null | undefined)[]) => snap({ review: null, decisions: busyDecisions({ rows: ids.map((id, i) => decision(1, 'x ' + id, { decision_id: id, at: times[i] } as Partial<DecisionRow>)), count: ids.length, undocumented: 0 }) })
  const ids = (lines: PaneLine[]): string[] => lines.filter(l => l.toggle?.startsWith('dec:') === true).map(l => l.toggle as string)
  expect(ids(render(mk(['a', 'b', 'c'], [undefined, undefined, undefined]), 76))).toEqual(['dec:c', 'dec:b', 'dec:a'])
  expect(ids(render(mk(['a', 'b', 'c'], [at(9), 'not a time', at(1)]), 76))).toEqual(['dec:c', 'dec:b', 'dec:a']) // a bad time: the whole list falls back
  expect(ids(render(mk(['a', 'b', 'c'], [at(3), at(3), at(3)]), 76))).toEqual(['dec:c', 'dec:b', 'dec:a']) // equal times: later position first
})

test('I23 golden: the opened decision and the first opened seat equal the §5.3 mockup lines, every line is made, with the kinds drawn there', () => {
  const dec = render(busy(), 76, { expanded: ['dec:intent-17-1'] })
  const at = dec.findIndex(l => l.toggle === 'dec:intent-17-1')
  expect(dec.slice(at, at + 7).map(l => l.text)).toEqual([
    '◦ intent-17-1  可逆 · depth0                                              ▾',
    '  └ #17 direction: A (keep the native <repo>/.claude/worktrees root for',
    '    hand/native worktrees, no WorktreeCreate takeover; rail worktrees',
    '    carry the repo slug; …). Owner did not answer within 60s; A is',
    '    reversible and the smallest surface.',
    '  $ decision-ledger.js veto --ledger /home/cookys/projects/autopilot/.git/',
    '    autopilot/ledger/decisions.jsonl --id intent-17-1',
  ])
  expect(dec.slice(at, at + 7).map(l => l.kind)).toEqual(['bullet', 'detail', 'detail', 'detail', 'detail', 'command', 'command'])
  const seat0 = render(busy(), 76, { expanded: ['seat:code:s0'] })
  const s0 = seat0.findIndex(l => l.toggle === 'seat:code:s0')
  expect(seat0.slice(s0, s0 + 3).map(l => l.text.trimEnd())).toEqual([
    '            ✓ 完成  s0 · anthropic                                        ▾',
    '              └ SHIP-AS-IS · reviewed',
    '            △ 待修  s1 · zhipu                                            ▸',
  ])
  expect(seat0.slice(s0, s0 + 3).map(l => l.kind)).toEqual(['item', 'detail', 'item'])
  for (const l of [...dec.slice(1), ...seat0.slice(1)]) expect(isMade(l)).toBe(true)
})

test('120 columns: the round line gains the seat count, the decision rows fill the width', () => {
  const lines = textsOf(render(busy(), 120))
  expect(lines[1]).toBe('輪次        R1 · 4abd667f..10c5c086 · 4 席')
  expect(lines.filter(l => l.startsWith('◦ ')).every(l => displayWidth(l) <= 120 && l.endsWith('▸'))).toBe(true)
})

// ---- what the tab shows ----
test('seats keep seat order, one item per seat at column 12, each with its own toggle; the default has no detail and no command (I18, default part)', () => {
  const lines = render(busy(), 76)
  const seats = lines.filter(l => l.toggle?.startsWith('seat:code:') === true)
  expect(seats.map(l => l.toggle)).toEqual(['seat:code:s0', 'seat:code:s1', 'seat:code:s2', 'seat:code:s3'])
  expect(seats.every(l => l.kind === 'item' && l.fact === 'review.seats' && leading(l.text) === 12)).toBe(true)
  expect(lines.some(l => l.kind === 'detail' || l.kind === 'command')).toBe(false)
})

test('the raw verdict never shows in the default render; it sits in the opened seat\'s detail (I7)', () => {
  const text = (lines: PaneLine[]): string => lines.map(l => l.text).join('\n')
  expect(text(render(busy(), 76))).not.toMatch(/SHIP-AS-IS|FIX-THEN-SHIP|CONDITIONAL|STOP/)
  expect(text(render(busy(), 76, { expanded: ['seat:code:s1'] }))).toContain('FIX-THEN-SHIP · reviewed')
})

test('a round with a seat still running reads running, with the seats that already have findings counted; a running seat beats findings', () => {
  const lines = textsOf(render(rich(), 76))
  expect(lines[0]).toContain('● 執行中 · 1 席已有發現')
  expect(lines.some(l => l.startsWith('            ● 執行中  s0 · minimax'))).toBe(true)
  expect(lines.some(l => l.startsWith('            △ 待修    s1 · zhipu'))).toBe(true)
})

test('a round holding a seat the mapping does not know is unknown, not stopped (the P0 review finding, §3.2 / §3.3); WEIRD shows only in the seat\'s detail', () => {
  const lines = render(weird(), 76)
  const head = lines.find(l => l.kind === 'header')!
  expect(head.text).toContain('? 未知')
  expect(head.text).toContain('1 席未知')
  expect(head.text).not.toContain('已停')
  expect(lines.map(l => l.text).join('\n')).not.toContain('WEIRD')
  expect(render(weird(), 76, { expanded: ['seat:code:s1'] }).filter(l => l.text.includes('WEIRD')).map(l => l.kind)).toEqual(['detail'])
  // a round with no seats at all is still stopped (no verdict)
  expect(render(snap({ review: { plan: null, code: codeRound({ seats: [] }) } }), 76)[2].text).toContain('已停')
})

test('QC chip: not_needed is `∅ 不需要`, owed needs you, unknown is unknown; the protected-file count reads as a count', () => {
  const qc = (state: string, n = 0) => textsOf(render(snap({ qc: { ...QC_NOT_NEEDED, state, protected_files_count: n } }), 76)).filter(l => l.includes('推送前 QC') || l.startsWith('範圍'))
  expect(qc('not_needed')[0]).toContain('∅ 不需要')
  expect(qc('ok')[0]).toContain('✓ 完成')
  expect(qc('owed', 2)[0]).toContain('要你處理')
  expect(qc('unknown')[0]).toContain('? 未知')
  expect(qc('owed', 2)[1]).toBe('範圍        5a2706ad..HEAD · 2 個受保護檔案')
  expect(textsOf(render(snap({ qc: QC_NOT_NEEDED }), 76, { t: en })).find(l => l.startsWith('scope'))).toBe('scope       5a2706ad..HEAD · 0 protected files')
})

test('decisions: one line each in ledger order; more than five fold into a `more` item that opens and closes (I18, pure part)', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map(n => decision(n, 'decision number ' + n))
  const s = snap({ decisions: busyDecisions({ rows, count: 7 }) })
  const closed = textsOf(render(s, 76))
  expect(closed.filter(l => l.startsWith('◦ ')).length).toBe(5)
  expect(closed.some(l => l.includes('還有 2 件決定'))).toBe(true)
  const open = textsOf(render(s, 76, { expanded: ['more:review.decisions'] }))
  expect(open.filter(l => l.startsWith('◦ ')).length).toBe(7)
  expect(open.some(l => l.includes('收起'))).toBe(true)
})

test('decisions: a row with no decision_id says why it cannot be vetoed; no sidecar reuses the not-wired note; no decisions say so once', () => {
  const noId = snap({ decisions: busyDecisions({ rows: [decision(1, 'x', { decision_id: null })], count: 1 }) })
  expect(render(noId, 76, { expanded: ['dec:#0'] }).map(l => l.text).join('\n')).toContain('沒有 decision_id，無法 veto')
  expect(textsOf(render(snap({ note: '代你決定：來源未接' }), 76)).filter(l => l.includes('來源未接'))).toEqual(['— 代你決定：來源未接'])
  expect(textsOf(render(snap({ decisions: busyDecisions({ rows: [], count: 0, undocumented: 0 }) }), 76)).filter(l => l.startsWith('— '))).toContain('— 尚無代你決定的事')
})

test('the escalation ladder: bar of six cells, the rung, U0 ─ U5 and how long ago', () => {
  const line = textsOf(render(rich(), 76)).find(l => l.startsWith('升級階梯'))!
  expect(line).toBe('升級階梯    ▰▰▰▱▱▱  U2  U0 ─ U5 · 3h00m 前')
  expect([...line].filter(c => c === '▰' || c === '▱').length).toBe(6)
})

test('every fold: a header toggles its section; a folded section is the header alone', () => {
  const lines = render(busy(), 76, { folded: ['sec:review.code', 'sec:review.plan'] })
  const texts = textsOf(lines)
  expect(texts[0].startsWith('▸ 程式碼審查')).toBe(true) // code was open by default: toggled away
  expect(texts.some(l => l.startsWith('輪次        R1'))).toBe(false)
  expect(texts.some(l => l.startsWith('▾ 計畫審查'))).toBe(true) // the stale plan review was folded by default: toggled open
  expect(lines.filter(l => l.kind === 'header').map(l => l.toggle)).toEqual(['sec:review.code', 'sec:review.qc', 'sec:review.decisions', 'sec:review.plan'])
})

test('opened, the stale plan review shows plan, round bar and seats; raw CONDITIONAL / READY / STOP stay in each seat\'s detail', () => {
  const lines = render(busy(), 76, { folded: ['sec:review.plan'], expanded: ['seat:plan:codex_operations_skeptic'] })
  const texts = textsOf(lines)
  const at = texts.findIndex(l => l.startsWith('▾ 計畫審查'))
  expect(texts[at]).toContain('◌ 已停 · 27d 前')
  expect(texts.slice(at + 1, at + 4)).toEqual(['計畫        blind-review-packet-2026-09-16 · △ 待修', '輪次        ▰▱  R1／上限 2', '席位'])
  expect(texts[at + 4]).toMatch(/^ {12}✓ 完成 {2}glm_architecture · zhipu +▸$/)
  expect(texts[at + 5]).toMatch(/^ {12}△ 待修 {2}codex_operations_skeptic · openai +▾$/)
  expect(texts[at + 6]).toBe('              └ STOP')
  expect(texts.join('\n')).not.toMatch(/READY|CONDITIONAL/)
})

// ---- I11: freshness, T-1 / T / T+1 (F2 plan review, F3 terminal plan review, F4 code review); X0 / X1 have no clock ----
const T_F2 = 86_400_000
const T_F3 = 604_800_000
const T_F4 = 86_400_000
test('I11 F2: a non-terminal plan review stops being fresh one ms after 24 h (chip ◌ 已停, folded)', () => {
  const at = (ms: number) => textsOf(render(snap({ review: { plan: planReview({ updated_at: iso(ms) }), code: null } }), 76))
  for (const ms of [T_F2 - 1, T_F2]) {
    const lines = at(ms)
    expect(lines.some(l => l.startsWith('計畫        '))).toBe(true)
    expect(lines.find(l => l.includes('計畫審查'))).toContain('△ 待修')
  }
  const stale = at(T_F2 + 1)
  expect(stale.find(l => l.includes('計畫審查'))).toContain('◌ 已停')
  expect(stale.some(l => l.startsWith('計畫        '))).toBe(false)
})

test('I11 F3: a terminal plan review fades to one dim history line, no section, one ms after 7 days', () => {
  const seats = [seat('a', 'x', 'READY')]
  const at = (ms: number) => render(snap({ review: { plan: planReview({ terminal: true, verdict: 'READY', seats, updated_at: iso(ms) }), code: null } }), 76)
  for (const ms of [T_F3 - 1, T_F3]) expect(textsOf(at(ms)).some(l => l.includes('計畫審查') && l.includes('✓ 完成'))).toBe(true)
  const stale = at(T_F3 + 1)
  expect(textsOf(stale).some(l => l.startsWith('▾ 計畫審查') || l.startsWith('▸ 計畫審查'))).toBe(false)
  const note = stale.filter(l => l.kind === 'detail')
  expect(note.length).toBe(1)
  expect(note[0].text.trim()).toBe('計畫審查 blind-review-packet-2026-09-16 已終結 · 7d 前')
})

test('I11 F4: a non-converged code review stops being fresh one ms after 24 h (chip ◌ 已停, folded); a converged one never does', () => {
  const at = (ms: number, converged = false) => textsOf(render(snap({ review: { plan: null, code: codeRound({ at: iso(ms), converged }) } }), 76))
  for (const ms of [T_F4 - 1, T_F4]) {
    expect(at(ms)[0]).toContain('△ 待修')
    expect(at(ms).some(l => l.startsWith('輪次'))).toBe(true)
  }
  const stale = at(T_F4 + 1)
  expect(stale[0]).toContain('◌ 已停 · 1d00h 前')
  expect(stale.some(l => l.startsWith('輪次'))).toBe(false)
  expect(at(T_F4 + 1, true)[0]).toContain('▾')
})

test('I11 X0 / X1: with no clock, or a timestamp that does not parse, nothing is judged stale', () => {
  const old = { plan: planReview({ updated_at: '2020-01-01T00:00:00Z' }), code: codeRound({ at: '2020-01-01T00:00:00Z' }) }
  const garbage = { plan: planReview({ updated_at: 'garbage' }), code: codeRound({ at: 'garbage' }) }
  for (const lines of [textsOf(render(snap({ review: old, now: null }), 76)), textsOf(render(snap({ review: garbage }), 76))]) {
    expect(lines.some(l => l.startsWith('輪次'))).toBe(true)
    expect(lines.some(l => l.startsWith('計畫        '))).toBe(true)
    expect(lines.join('\n')).not.toContain('◌')
  }
})

// ---- the empty world, and a narrow pane ----
test('the empty world: every section says what is missing, once; nothing throws', () => {
  const lines = render(empty(), 76).slice(2)
  expect(lines.map(l => l.kind)).toEqual(['header', 'empty', 'header', 'empty', 'header', 'empty'])
  expect(lines.filter(l => l.kind === 'empty').map(l => l.text)).toEqual(['— 沒有審查資料', '— 沒有 QC 狀態', '— 沒有決策資料'])
})

test('narrow (40 columns): no line is wider than the pane, and a toggle line keeps its mark at the right edge', () => {
  const lines = render(busy(), 40)
  for (const l of lines) expect(displayWidth(l.text)).toBeLessThanOrEqual(40)
  for (const l of lines.filter(x => x.kind === 'item' || x.kind === 'bullet')) expect(l.text.trimEnd().endsWith('▸')).toBe(true)
})
