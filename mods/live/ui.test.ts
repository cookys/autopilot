// P0 of the live pane design system (docs/plans/2026-10-13-live-pane-design-system.md): the shared vocabulary in ui.ts.
// I5 (a) / I20 on the real tables and on every line the builders make, status precedence, severity, FRESH_MS boundaries, grid and widths, branding.
// The glyph-table negative controls M7 to M10 live in ui-lint.test.js (plain node); here the same checkers run over built lines.
import { test, expect } from 'claude-code/testing'
import {
  GLYPHS, STATES, SEVERITY, STATE_IDS, FRESH_MS, isStale, stateOf, worst, classify, isMade, isFrag, blank, header, kv, item, bullet, empty, more, command, detail, meter, table, val,
  stateLead, stateBadge, isBadgeState, verifiedOk, idTail, displayWidth, emojiViolations, glyphTableViolations, vocabularyViolations, emphasisViolations, GRID, KEY_W, PALETTE, meterKey, countChip, strip, boldUseOf,
} from './ui'
import type { Ctx, BadgeStated } from './ui'
import { wrapLines } from './model'

const T: Record<string, string> = { 'ui.state.running': 'running', 'ui.state.done': 'done', 'ui.state.need_you': 'needs you', 'ui.more': '{n} more {noun}', 'ui.table.state': 'state', ago: '{age} ago' }
const t = (id: string, v?: Record<string, string | number>): string => (T[id] ?? id).replace(/\{(\w+)\}/g, (_m, k) => String(v?.[k]))
const ctx = (cols: number): Ctx => ({ t, cols })

test('I5 (a): the real glyph tables have no emoji hazard; new glyphs carry a well-formed verified entry; I20: one glyph, one meaning', () => {
  expect(glyphTableViolations(GLYPHS)).toEqual([])
  expect(vocabularyViolations(GLYPHS)).toEqual([])
  expect(GLYPHS.state.stalled).toBe('⊘')
  expect(verifiedOk(GLYPHS.verified['⊘'])).toBe(true)
  for (const id of STATE_IDS) expect(STATES[id].glyph).toBe(GLYPHS.state[id])
})

test('I5 (c): the checker flags the emoji hazards; digits, # and * stay legal; a detail line may carry a pictograph', () => {
  expect(emojiViolations('⏸ paused').length).toBeGreaterThan(0)
  expect(emojiViolations('1️⃣').length).toBeGreaterThan(0)
  expect(emojiViolations('v1.2.3 #4 *5 0123456789')).toEqual([])
  expect(emojiViolations('🙂', true).length).toBe(0)
  expect(emojiViolations('🙂', false).length).toBeGreaterThan(0)
})

test('every line a builder makes is branded, free of emoji hazards, and within the emphasis rule, at 76 and 120 columns', () => {
  for (const cols of [48, 76, 120]) {
    const u = ctx(cols)
    const lines = [
      blank(),
      header(u, 'Review', { id: 'review.main', open: true }, { right: stateLead(u, stateOf('qc', 'owed')), fact: 'review.qc' }),
      kv(u, 'round', [val('R1')], { fact: 'review.round' }),
      item(u, stateOf('qc', 'owed'), 'body text', 'meta', { fact: 'review.qc', toggle: { id: 'x', open: false } }),
      bullet(u, 'a bullet', undefined, { fact: 'review.round' }),
      empty('nothing here', 'now.tasks'),
      more(u, 3, 'rows', 'more.x'),
      ...command(u, 'node scripts/decision-ledger.js veto --ledger /home/u/proj/.git/autopilot/ledger/decisions.jsonl --id intent-17-1'),
      ...detail(u, 'SHIP-AS-IS reviewed', { attached: true }),
      meter(u, 'brain today', 1.2, 1, { cells: 20, fact: 'usage.brain' }),
      ...table(u, [{ head: 'id', min: 8, priority: 1, flex: true, cut: 'left' }, { head: 'role', min: 4, priority: 2, cut: 'right' }],
        [{ state: stateOf('qc', 'ok'), cells: ['review-1791803964-2418470-c58e-extra-long-id-here', 'reviewer'] }], { fact: 'dispatch.runs' }),
    ]
    for (const l of lines) {
      expect(isMade(l)).toBe(true)
      expect(displayWidth(l.text)).toBeLessThanOrEqual(cols)
      if (l.kind !== 'detail') expect(emojiViolations(l.text)).toEqual([])
      expect(emphasisViolations(l)).toEqual([])
    }
  }
})

test('branding: a hand-made line or fragment is not made; only the builders brand', () => {
  expect(isMade({ kind: 'item', text: 'x' })).toBe(false)
  expect(isFrag({ text: 'x', segs: [] })).toBe(false)
  expect(isFrag(val('x'))).toBe(true)
})

test('grid: the four columns, and the key column width', () => {
  expect([...GRID]).toEqual([0, 2, 4, 12])
  expect(KEY_W).toBe(12)
  const u = ctx(76)
  const k = kv(u, 'round', [val('R1')], { fact: 'review.round' })
  expect(k.text.startsWith('round')).toBe(true)
  expect(k.text.indexOf('R1')).toBe(KEY_W)
})

test('stateOf: the verdict, run and gate mappings; an unknown token is `unknown`, never a thrown error', () => {
  expect(stateOf('verdict', 'DECIDE').id).toBe('need_you')
  expect(stateOf('verdict', 'idle').id).toBe('stopped')
  expect(stateOf('verdict', 'nonsense').id).toBe('unknown')
  expect(stateOf('gate', 'NEEDS_FIX').id).toBe('need_you')
  expect(stateOf('qc', 'not_needed').id).toBe('skipped')
})

test('classify: run precedence is failed > done > weird > stall > fresh running > stopped', () => {
  const r = (o: Partial<{ rc: number | null; final_status: string | null; stall: boolean; fresh: boolean }>) => classify('run', { rc: null, final_status: null, stall: false, fresh: true, ...o })
  expect(r({ rc: 1, stall: true })).toBe('failed')
  expect(r({ rc: 0, final_status: 'FAILED' })).toBe('failed')
  expect(r({ rc: 0 })).toBe('done')
  expect(r({ final_status: 'odd', stall: true })).toBe('weird')
  expect(r({ stall: true })).toBe('stall')
  expect(r({})).toBe('running')
  expect(r({ fresh: false })).toBe('stopped')
})

test('worst: follows SEVERITY; empty is skipped; unknown never hides a finding', () => {
  expect([...SEVERITY]).toEqual(['need_you', 'failed', 'stalled', 'findings', 'running', 'stopped', 'pending', 'done', 'skipped', 'unknown'])
  expect(worst([stateOf('qc', 'ok'), stateOf('qc', 'owed')]).id).toBe('need_you')
  expect(worst([stateOf('qc', 'unknown'), stateOf('qc', 'ok')]).id).toBe('done')
  expect(worst([]).id).toBe('skipped')
})

test('FRESH_MS: exactly at the threshold is fresh, one ms over is stale (T-1, T, T+1)', () => {
  for (const kind of Object.keys(FRESH_MS) as (keyof typeof FRESH_MS)[]) {
    const T0 = FRESH_MS[kind]
    expect(isStale(kind, T0 - 1)).toBe(false)
    expect(isStale(kind, T0)).toBe(false)
    expect(isStale(kind, T0 + 1)).toBe(true)
  }
  expect(classify('background', { exit: null, quietMs: FRESH_MS.quiet })).toBe('fresh')
  expect(classify('background', { exit: null, quietMs: FRESH_MS.quiet + 1 })).toBe('quiet')
})

test('idTail: the cut tail never starts with a separator, and fits the width (the cut fell on a `-` here)', () => {
  const id = 'review-1792100439-1349925-c899'
  const out = idTail(id, 14)
  expect(out).toBe('…1349925-c899')
  expect(out.startsWith('…-')).toBe(false)
  expect(displayWidth(out)).toBeLessThanOrEqual(14)
  expect(idTail('short-id', 14)).toBe('short-id') // fits: untouched
})

test('classify run: an undefined or missing rc is no exit code; only a number counts', () => {
  const run = (rc: unknown) => classify('run', { rc: rc as number | null, final_status: null, stall: false, fresh: true })
  expect(run(undefined)).toBe('running')
  expect(run(null)).toBe('running')
  expect(run(0)).toBe('done')
  expect(run(2)).toBe('failed')
  expect(run('1')).toBe('running')
})

test('stateBadge: only need_you, running and stalled have a badge form; the runtime refusal stays', () => {
  expect(stateBadge(stateOf('verdict', 'DECIDE') as BadgeStated, undefined, 'header.verdict' as never).text).toBe('▲')
  expect(stateBadge(stateOf('verdict', 'STALLED') as BadgeStated, 2, 'header.verdict' as never).text).toBe('⊘2')
  expect(() => stateBadge(stateOf('qc', 'ok') as BadgeStated, 1, 'header.verdict' as never)).toThrow()
  expect(isBadgeState(stateOf('qc', 'ok'))).toBe(false)
  expect(isBadgeState(stateOf('verdict', 'RUNNING'))).toBe(true)
})

// ---- P1: the three P0 review findings, and the pairwise precedence fixtures of I13 ----
test('plan-review BLOCK and REJECT are both a failure, STOP and CONDITIONAL are findings (§8 Q5); a code seat maps the same way', () => {
  const seat = (kind: 'code' | 'plan', verdict: string | null, status: string | null = null) => stateOf('seat', { kind, verdict, status }).id
  expect(seat('plan', 'BLOCK')).toBe('failed')
  expect(seat('plan', 'REJECT')).toBe('failed')
  expect(seat('plan', 'STOP')).toBe('findings')
  expect(seat('plan', 'CONDITIONAL')).toBe('findings')
  expect(seat('plan', 'READY')).toBe('done')
  expect(seat('code', 'BLOCK')).toBe('failed')
  expect(seat('plan', ' block ')).toBe('failed') // padded and lower-case classify like upper-case
  expect(seat('plan', 'WEIRD')).toBe('unknown')
})

test('classify round: a round holding an unknown seat is unknown, not stopped; running, failed and findings still beat it; no seats stays stopped', () => {
  const s = (verdict: string) => stateOf('seat', { kind: 'code', verdict, status: null })
  const round = (seats: ReturnType<typeof s>[], over: { stale?: boolean; converged?: boolean } = {}) => stateOf('round', { stale: false, converged: false, seats, ...over }).id
  const done = s('SHIP-AS-IS')
  const unknown = s('WEIRD')
  expect(round([done, unknown])).toBe('unknown')
  expect(round([unknown])).toBe('unknown')
  expect(round([unknown, stateOf('seat', { kind: 'code', verdict: null, status: 'running' })])).toBe('running')
  expect(round([unknown, s('BLOCK')])).toBe('failed')
  expect(round([unknown, s('FIX-THEN-SHIP')])).toBe('findings')
  expect(round([done, done])).toBe('done')
  expect(round([])).toBe('stopped')
  expect(round([done, unknown], { stale: true })).toBe('stopped') // a stale round is stopped whatever its seats say
})

test('I13 pairwise precedence: round, background, loadSource, run and gate conflict fixtures', () => {
  const seat = (verdict: string | null, status: string | null = null) => stateOf('seat', { kind: 'code', verdict, status })
  const round = (seats: ReturnType<typeof seat>[]) => stateOf('round', { stale: false, converged: false, seats }).id
  expect(round([seat('FIX-THEN-SHIP'), seat(null, 'running')])).toBe('running') // findings + a running seat
  expect(round([seat('FIX-THEN-SHIP'), seat('BLOCK')])).toBe('failed') // a failed seat + findings
  const bg = (exit: number | null, quietMs: number) => stateOf('background', { exit, quietMs }).id
  expect(bg(0, 6 * 3_600_000)).toBe('done') // exit marker 0 + quiet 6 h
  expect(bg(1, 0)).toBe('failed')
  expect(bg(null, 6 * 3_600_000)).toBe('stopped')
  const load = (source: string, behind: number, flags = 0) => stateOf('loadSource', { source, behind, flags }).id
  expect(load('dev', 54)).toBe('need_you')
  expect(load('dev', 0)).toBe('done')
  expect(load('cache:x', 0)).toBe('need_you')
  const run = (o: Partial<{ rc: number | null; final_status: string | null; stall: boolean; fresh: boolean }>) => stateOf('run', { rc: null, final_status: null, stall: false, fresh: true, ...o }).id
  expect(run({ stall: true, rc: 0 })).toBe('done')
  expect(run({ final_status: 'WEIRD' })).toBe('unknown')
  expect(run({ final_status: 'WEIRD', stall: true })).toBe('unknown')
  expect(run({ final_status: 'WEIRD', rc: 0 })).toBe('done')
  expect(run({ final_status: 'WEIRD', rc: 1 })).toBe('failed')
  expect(run({})).toBe('running')
  expect(run({ stall: true, rc: 1 })).toBe('failed')
  expect(run({ rc: 0, final_status: 'failed' })).toBe('failed')
  expect(stateOf('gate', ' needs_fix ').id).toBe('need_you')
  expect(stateOf('qc', ' Not_Needed ').id).toBe('skipped')
  expect(stateOf('seat', { kind: 'plan', verdict: ' ready ', status: null }).id).toBe('done')
})

// ---- P1: fit at 40 columns (§3.1): one item is one line, a kv wraps at its hang, a header never overflows ----
test('item: a body of 98 cells is cut so the line and its toggle mark fit 40 columns (one item is one line); the meta goes first, the bare-glyph form keeps one space', () => {
  const long = 'x'.repeat(70) + ' 中文很長很長很長很長很長很長很長很長很長很長很長'
  const u = ctx(40)
  const line = item(u, stateOf('qc', 'ok'), long, 'family-name', { fact: 'review.seats', at: 12, toggle: { id: 'seat:code:s0', open: false } })
  expect(displayWidth(line.text)).toBeLessThanOrEqual(39)
  expect(line.text.trimEnd().endsWith('▸')).toBe(true)
  expect(line.toggle).toBe('seat:code:s0')
  const plain = item(u, stateOf('qc', 'ok'), long, undefined, { fact: 'review.seats' })
  expect(displayWidth(plain.text)).toBeLessThanOrEqual(39)
  expect(plain.text.endsWith('…')).toBe(true)
  const bullet40 = bullet(u, long, 'meta', { fact: 'review.decisions', toggle: { id: 'dec:x', open: true } })
  expect(displayWidth(bullet40.text)).toBeLessThanOrEqual(39)
  expect(bullet40.text.trimEnd().endsWith('▾')).toBe(true)
  const bare = item(ctx(76), stateOf('qc', 'ok'), 'body', undefined, { fact: 'review.seats', word: false })
  expect(bare.text).toBe('✓ body')
  expect(item(ctx(76), stateOf('qc', 'ok'), 'body', undefined, { fact: 'review.seats' }).text).toBe('✓ done  body')
})

test('kv: a value wider than the pane wraps at the key column through wrapLines; no piece is wider than the pane, every continuation hangs at 12', () => {
  const u = ctx(40)
  const line = kv(u, 'scope', [val('5a2706ad..HEAD · a value that is far too long to fit in the remaining twenty-seven cells', { role: 'prose' })], { fact: 'review.qc' })
  expect(line.hang).toBe(12)
  const pieces = wrapLines([line], 40)
  expect(pieces.length).toBeGreaterThan(1)
  for (const p of pieces) expect(displayWidth(p.text)).toBeLessThanOrEqual(40)
  for (const p of pieces.slice(1)) expect(p.text.startsWith(' '.repeat(12))).toBe(true)
  for (const p of pieces) expect(isMade(p)).toBe(true) // a wrapped piece keeps the brand (I2) and the line's identity
  expect(pieces.every(p => p.kind === 'kv' && p.fact === 'review.qc')).toBe(true)
})

test('header: a title and a chip too wide for the pane are cut so the line is cols - 1 wide with a rule of at least 3 cells', () => {
  const u = ctx(40)
  const chip = stateLead(u, stateOf('qc', 'ok'))
  const h = header(u, 'A section title that is much too long for forty columns', { id: 'sec:x', open: true }, { right: chip, fact: 'review.qc' })
  expect(displayWidth(h.text)).toBeLessThanOrEqual(39)
  expect(h.text.endsWith('───')).toBe(true)
  const small = header(ctx(76), 'Review', { id: 'sec:x', open: false })
  expect(small.text.startsWith('▸ Review ')).toBe(true)
  expect(displayWidth(small.text)).toBe(75)
})

// ---- the semantic palette (owner ruling 2026-10-16): one colour, one meaning ----
test('palette: every state colour is a PALETTE role; need_you draws only its mark yellow, findings is default text, nothing in STATES is bold', () => {
  const roles = new Set(Object.values(PALETTE))
  for (const id of STATE_IDS) {
    const s = STATES[id]
    if (s.key !== undefined) expect(roles.has(s.key), id).toBe(true)
    expect('bold' in s, id).toBe(false)
  }
  expect(STATES.need_you.key).toBe(PALETTE.attention)
  expect(STATES.need_you.wordKey).toBeUndefined()
  expect(STATES.findings.key).toBeUndefined()
  expect(STATES.findings.wordKey).toBeUndefined()
  expect(STATES.failed.key).toBe(PALETTE.broken)
  expect(STATES.stalled.key).toBe(PALETTE.broken)
  expect(STATES.running.key).toBe(PALETTE.running)
  expect(STATES.done.key).toBe(PALETTE.done)
  // one colour, one meaning: the seven roles map to seven distinct keys
  expect(new Set(Object.values(PALETTE)).size).toBe(Object.keys(PALETTE).length)
})

test('palette: a meter is plain below 80 %, attention from 80 %, broken from 100 %; its bar and percent are not bold', () => {
  expect([meterKey(0), meterKey(0.79), meterKey(0.8), meterKey(0.99), meterKey(1), meterKey(1.4)]).toEqual([undefined, undefined, PALETTE.attention, PALETTE.attention, PALETTE.broken, PALETTE.broken])
  const l = meter(ctx(76), 'quota', 50, 100, { cells: 10, fact: 'usage.limit_max' as never })
  expect((l.segs ?? []).every(g => g.bold !== true)).toBe(true)
  expect((l.segs ?? []).filter(g => g.role === 'glyph' && g.color !== undefined).map(g => g.color)).toEqual([PALETTE.idle]) // the filled cells are default text, only the empty ones are idle
})

test('palette: a need_you count on a section title is a plain number; any other state keeps its mark', () => {
  const plain = countChip(ctx(76), stateOf('verdict', 'DECIDE'), 2, 'now.attention' as never)
  expect(plain.segs.map(g => [g.text, g.color])).toEqual([['2', undefined]])
  const fail = countChip(ctx(76), stateOf('run', { rc: 1 } as never), 2, 'dispatch.counts' as never)
  expect(fail.segs[0].color).toBe(PALETTE.broken)
})

test('palette: the tab strip draws the active name default bold, a needing name attention+bold (active or not), the rest dim, the here colour only on the ━ run, and the next-page button dim', () => {
  const sr = strip(ctx(76), 'now' as never, [{ id: 'now' as never, label: 'Now' }, { id: 'decide' as never, label: 'Decide', need: true }, { id: 'spend' as never, label: 'Spend' }], true)
  expect(sr.next).toMatchObject({ dim: true })
  expect(sr.next?.color).toBeUndefined()
  const [now, decide, spend] = sr.tabs
  expect([now.label.color, now.label.bold, now.label.here]).toEqual([undefined, true, true])
  expect([decide.label.color, decide.label.bold]).toEqual([PALETTE.attention, true])
  expect([spend.label.color, spend.label.bold, spend.label.dim]).toEqual([undefined, undefined, true])
  expect(sr.rule.some(g => g.color === PALETTE.here && g.bold !== true)).toBe(true)
  expect(sr.tabs.some(x => x.label.color === PALETTE.here)).toBe(false)
  const onNeed = strip(ctx(76), 'decide' as never, [{ id: 'now' as never, label: 'Now' }, { id: 'decide' as never, label: 'Decide', need: true }], false).tabs[1].label
  expect([onNeed.color, onNeed.bold, onNeed.here]).toEqual([PALETTE.attention, true, true])
})

test('palette: I4 accepts a bold tab name only when it is the active one (here) or one that needs the owner; a planted bold inactive name is a violation', () => {
  const line = { kind: 'kv', text: '' } as never
  expect(boldUseOf(line, { text: ' Now ', bold: true, here: true, role: 'tab' })).toBe('active tab name')
  expect(boldUseOf(line, { text: ' Decide ', bold: true, color: PALETTE.attention, role: 'tab' })).toBe('needing tab name')
  // negative controls: a bold tab with no here mark and no attention colour, and the pre-2026-10-16 claude-coloured active name
  expect(boldUseOf(line, { text: ' Spend ', bold: true, role: 'tab' })).toBeNull()
  expect(boldUseOf(line, { text: ' Now ', bold: true, here: true, color: PALETTE.here, role: 'tab' })).toBeNull()
})
