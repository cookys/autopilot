// P0 of the live pane design system (docs/plans/2026-10-13-live-pane-design-system.md): the shared vocabulary in ui.ts.
// I5 (a) / I20 on the real tables and on every line the builders make, status precedence, severity, FRESH_MS boundaries, grid and widths, branding.
// The glyph-table negative controls M7 to M10 live in ui-lint.test.js (plain node); here the same checkers run over built lines.
import { test, expect } from 'claude-code/testing'
import {
  GLYPHS, STATES, SEVERITY, STATE_IDS, FRESH_MS, isStale, stateOf, worst, classify, isMade, isFrag, blank, header, kv, item, bullet, empty, more, command, detail, meter, table, val,
  stateLead, stateBadge, isBadgeState, verifiedOk, displayWidth, emojiViolations, glyphTableViolations, vocabularyViolations, emphasisViolations, GRID, KEY_W,
} from './ui'
import type { Ctx, BadgeStated } from './ui'

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
