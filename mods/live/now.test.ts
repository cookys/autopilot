// P4 of the live pane design system (docs/plans/2026-10-13-live-pane-design-system.md §7 row "P4 現況"): the Now tab, built from ui.ts components, and the global header.
// Pure tests over a fixture snapshot. Enabled here: I9 (a), I11 F1 / X0 / X1, I16, I17, the pure halves of I18 and I19. The mounted halves (I9 b, I18 tasks and background
// `more`, the full I19) are in live.test.ts, named "P4 mounted ...". Each check ships with a negative control: a deliberately broken input that must be flagged.
import { test, expect } from 'claude-code/testing'
import { makeT } from './i18n'
import { NO_DETAIL, NO_SECTIONS, staleSuffix, wrapLines } from './model'
import { decideTabLines, dispatchLines, headerLines, hygieneTabLines, legendLines, nowLines, reviewTabLines, spendTabLines, stripOf, stripRows, treeRowCount, withOverflowHint } from './tabs'
import type { LiveSnapshot, PaneLine, Seg } from './model'
import * as ui from './ui'
import { violations } from './invariants.testkit'

const NOW = Date.parse('2026-10-13T12:00:00Z')
const iso = (agoMs: number): string => new Date(NOW - agoMs).toISOString()
const LOCALES = [['zh-TW', makeT('zh-TW')], ['en', makeT('en')]] as const
const BG_OUT = '/tmp/x.output'

const band = (kind: string, why = 'reason') => ({ kind, key: 'suggestion', why, verdictReason: null, mark: '●', verdict: 'v', head: '', progress: '—', progressDim: false, reason: null, project: 'repo', elapsed: '10m', phase: '—', slots: [] })
const run = (id: string, over: object = {}) => ({ run_id: id, role: 'implementer', runner: 'codex', model: 'gpt-5', stall: false, rc: null, final_status: null, elapsed_s: 90, probe_age_s: 5, phase: 'running', started_at: iso(90_000), ended_at: null, ended: false, fresh: true, ...over })
const task = (subject: string, status: string) => ({ subject, status })
const item = (label: string, quietMs: number | null, tail: string | null = null, kind = 'shell') => ({ kind, label, detail: null, tail, quietMs })

const MARKER = { size: 'M', urgent: false, bug: false, high_risk: false, level: 'l5', stage: 'implement', stage_set_at_ms: NOW - 180_000, unit: { index: 3, total: 5, label: 'band', kind: 'deliverable' }, review_families: ['a', 'b'] }
const STAGE = { size: 'M', urgent: false, bug: false, high_risk: false, units: 5, nodes: ['spec', 'plan', 'implement', 'verify', 'close'], walk: ['spec', 'plan', 'implement', 'verify', 'close'], entry: null, terminal: null, unit_kind: null, current: 'implement', stage_set_at: null, at: null }
type Over = { kind?: string; tasks?: ReturnType<typeof task>[]; activity?: ReturnType<typeof item>[]; decision?: boolean }
// a busy snapshot: a decision, 2 worth-a-look worktrees, a review round, spend, tasks and background work; everything the Now tab can draw
function snap(o: Over = {}): LiveSnapshot {
  const tasks = o.tasks ?? [task('done one', 'completed'), task('now doing', 'in_progress'), task('later', 'pending')]
  return {
    state: 'ok', text: '', header: 'h', metrics: { ctx: '37%' }, band: band(o.kind ?? 'stalled', 'longest run 4m quiet'),
    pending: o.decision === false ? [] : [{ id: 'd-1', question: 'merge or split?', background: null, options: [{ label: 'merge', description: 'one acceptance' }], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 60, orphaned: false }],
    project_key: null, root_run_id: null, link: null,
    rows: [run('r1'), run('r2', { stall: true, probe_age_s: 200 })], gates: null,
    sections: { ...NO_SECTIONS, tasks: { total: tasks.length, completed: tasks.filter(t => t.status === 'completed').length, in_progress: 1, current: 'now doing', first_created_ms: null, rows: tasks } },
    review: { plan: null, code: { phase: null, generation: 3, base: 'aaaaaaaa00', head: 'bbbbbbbb00', converged: false, at: iso(60_000), seats: [{ id: 's0', family: 'x', status: 'reviewed', verdict: 'FIX-THEN-SHIP' }, { id: 's1', family: 'y', status: 'reviewed', verdict: 'SHIP-AS-IS' }] } },
    published_at: null, session_as_of: null, host_as_of: null,
    detail: {
      ...NO_DETAIL, now_ms: NOW, project: 'repo', marker: MARKER, stage: STAGE, counts: { confirmed_live: 2, exited: 0, unknown: 0 }, stalled: 1,
      residue: { reapable: 0, by_class: {}, at: null, needs_human_count: 2, needs_human_bytes: 3_000_000, needs_human: [], auto_ran_at: null, auto_removed_count: null, auto_archived_count: null },
      spend: { session: '$0.42', host_all: '$3.10', host_all_n: null, brain: 120.4, cap: 150, mode: 'warn', hourly: null },
    },
    activity: o.activity ?? [item('full suite', 20_000)], recent: [],
  } as never
}
const ctxOf = (t: ReturnType<typeof makeT>, cols = 76, extra: { expanded?: string[]; folded?: string[] } = {}) => ({ t, cols, expanded: new Set(extra.expanded ?? []), folded: new Set(extra.folded ?? []) })
const texts = (ls: PaneLine[]): string[] => ls.map(l => l.text.trimEnd())

// ---- I9 (a): no tab builder emits `kind:'verdict'`; only pane.tsx draws the header ----
const verdictLinesOf = (ls: PaneLine[]): PaneLine[] => ls.filter(l => l.kind === 'verdict')
test('I9 (a): no tab builder emits a verdict line, in either locale and at every width; the header builder does (negative control)', () => {
  for (const [loc, t] of LOCALES) for (const cols of [40, 76, 120, 160]) {
    const c = ctxOf(t, cols, { expanded: ['more:now.tasks.done', 'more:now.background.ended'] })
    const s = snap()
    const tabs: [string, PaneLine[]][] = [['now', nowLines(s, c)], ['decide', decideTabLines(s, c)], ['dispatch', dispatchLines(s, c)], ['review', reviewTabLines(s, c)], ['spend', spendTabLines(s, c)], ['hygiene', hygieneTabLines(s, c)], ['legend', legendLines(c)]]
    for (const [name, ls] of tabs) expect(verdictLinesOf(ls).length, loc + ' ' + cols + ' ' + name).toBe(0)
    expect(verdictLinesOf(headerLines(s, c)).length, 'control: the header builder is what draws a verdict line').toBeGreaterThan(0)
    expect(verdictLinesOf([...nowLines(s, c), ...headerLines(s, c)]).length, 'control: the checker sees a verdict line a tab emitted').toBeGreaterThan(0)
  }
})

// ---- I11 F1 (background quiet), X0 / X1 (exit marker) ----
const bgLines = (items: ReturnType<typeof item>[], t = makeT('zh-TW'), open = true): PaneLine[] => {
  const ls = nowLines(snap({ activity: items }), ctxOf(t, 120, { expanded: open ? ['more:now.background.ended'] : [] }))
  const from = ls.findIndex(l => l.toggle === 'sec:now.background')
  return ls.slice(from + 1, ls.findIndex((l, i) => i > from && l.kind === 'header') === -1 ? undefined : ls.findIndex((l, i) => i > from && l.kind === 'header'))
}
const rowTexts = (ls: PaneLine[]): string[] => ls.filter(l => l.kind === 'item').map(l => l.text.trimEnd())

test('I11 F1: a background item quiet for FRESH_MS.quiet - 1 ms and for exactly that keeps its running form; one ms more is stopped and sits behind the ended toggle', () => {
  const Tq = ui.FRESH_MS.quiet
  for (const q of [Tq - 1, Tq]) {
    const rows = rowTexts(bgLines([item('job', q)]))
    expect(rows.length, 'quiet ' + q).toBe(1)
    expect(rows[0].startsWith('● 執行中'), rows[0]).toBe(true)
  }
  const stale = bgLines([item('job', Tq + 1)], makeT('zh-TW'), false)
  expect(rowTexts(stale), 'closed: no item row, the stopped one is behind the toggle').toEqual([])
  expect(stale.map(l => l.kind)).toEqual(['empty', 'more'])
  expect(stale[1].text).toContain('1 項已結束')
  const opened = rowTexts(bgLines([item('job', Tq + 1)]))
  expect(opened.length).toBe(1)
  expect(opened[0].startsWith('◌ 已停'), opened[0]).toBe(true)
  // negative control: a threshold that is off by one (> becomes >=) would call the item at exactly T stopped; the T row above is what fails then
})

test('I11 X0 / X1: an exit marker of 0 is ✓ 完成, any other code is ✗ 失敗, never ● whatever the quiet time; 背景工作 is one empty line and one more', () => {
  for (const quiet of [1_000, ui.FRESH_MS.quiet + 1, 6 * 3_600_000]) {
    const ok = rowTexts(bgLines([item('job', quiet, '[exited with code 0]')]))
    expect(ok.length).toBe(1)
    expect(ok[0].startsWith('✓ 完成'), ok[0]).toBe(true)
    for (const code of [1, 2, 137]) {
      const bad = rowTexts(bgLines([item('job', quiet, '[exited with code ' + code + ']')]))
      expect(bad[0].startsWith('✗ 失敗'), bad[0]).toBe(true)
    }
    for (const r of [...ok, ...rowTexts(bgLines([item('job', quiet, '[exited with code 3]')]))]) expect(r.includes('●'), r).toBe(false)
  }
  const closed = bgLines([item('a', 1_000, '[exited with code 0]'), item('b', 1_000, '[exited with code 1]')], makeT('zh-TW'), false)
  expect(closed.map(l => l.kind)).toEqual(['empty', 'more'])
  expect(closed[1].text).toContain('2 項已結束')
  // negative control: a marker that is not the whole last line is output, not an exit
  const prose = rowTexts(bgLines([item('job', 1_000, 'the build exited with code 0 once')]))
  expect(prose[0].startsWith('● 執行中'), prose[0]).toBe(true)
})

// ---- I16: 現況 at 76 columns has no 今日花費 or 帳號 section, and each summary row carries goto ----
const i16 = (ls: PaneLine[], t: ReturnType<typeof makeT>): string[] => {
  const out: string[] = []
  const heads = ls.filter(l => l.kind === 'header')
  for (const h of heads) {
    const id = h.toggle as string
    if (!ui.SECTION_ORDER.now.includes(id.replace(/^sec:now\./, ''))) out.push('section ' + id + ' is not a Now section')
    if (/今日花費|帳號|Spend today|Account/.test(h.text)) out.push('Now has a spend or account section: ' + h.text)
  }
  const from = ls.findIndex(l => l.toggle === 'sec:now.tabs')
  const rows = ls.slice(from + 1, ls.findIndex((l, i) => i > from && l.kind === 'header'))
  const expected = [t('tab.dispatch'), t('tab.review'), t('tab.spend'), t('tab.hygiene')]
  if (rows.length !== 4) out.push('the summary has ' + rows.length + ' rows, not 4')
  rows.forEach((r, i) => {
    if (r.goto === undefined) out.push('summary row ' + r.text + ' has no goto')
    if (!r.text.startsWith(expected[i])) out.push('summary row ' + i + ' is ' + r.text)
  })
  return out
}
test('I16: 現況 at 76 columns has no 今日花費 or 帳號 section and four summary rows, each with goto; a hand-removed goto is flagged', () => {
  for (const [loc, t] of LOCALES) {
    const ls = nowLines(snap(), ctxOf(t, 76))
    expect(i16(ls, t), loc).toEqual([])
    const goto = ls.filter(l => (l.kind === 'kv' || l.kind === 'meter') && l.goto !== undefined).map(l => l.goto)
    expect(goto, loc).toEqual(['dispatch', 'review', 'spend', 'hygiene'])
    // negative controls
    expect(i16(ls.map(l => ((l.kind === 'kv' || l.kind === 'meter') && l.goto === 'spend' ? { ...l, goto: undefined } : l)), t).length).toBeGreaterThan(0)
    expect(i16([...ls, { ...ls.find(l => l.kind === 'header') as PaneLine, text: '▾ ' + t('now.account') + ' ───', toggle: 'sec:now.account' }], t).length).toBeGreaterThan(0)
  }
})

// ---- I17: ownership of the lines 現況 draws ----
const DATA_KINDS = new Set(['item', 'kv', 'bullet', 'table', 'meter', 'chart'])
const i17 = (ls: PaneLine[]): string[] => {
  const out: string[] = []
  const seenForeign = new Map<string, number>()
  ls.forEach((l, i) => {
    const at = 'line ' + i + ' ' + JSON.stringify(l.text.trimEnd())
    if (l.kind !== undefined && DATA_KINDS.has(l.kind) && l.fact === undefined && l.kind !== 'item') out.push(at + ' carries data and no fact')
    if (l.kind === 'item' && l.fact === undefined) out.push(at + ' is an item with no fact')
    if (l.fact === undefined || l.fact === 'pane.chrome') return // a heading, a toggle row or a spacer carries no fact of the session
    if (ui.FACT_OWNER[l.fact] !== 'now') {
      if (l.goto === undefined) out.push(at + ' shows ' + l.fact + ' (owned by ' + ui.FACT_OWNER[l.fact] + ') without goto')
      if (l.kind !== 'kv' && l.kind !== 'meter' && l.kind !== 'item') out.push(at + ' is a projection that is not kv / item')
      seenForeign.set(l.fact, (seenForeign.get(l.fact) ?? 0) + 1)
    }
  })
  for (const [f, n] of seenForeign) if (n > 1) out.push(f + ' is drawn ' + n + ' times on the tab')
  // M39 (plan :691): a projected review.round row carries ONE state (its round); a QC state beside it is a second claim
  for (const l of ls) if (l.fact === 'review.round' && (l.segs ?? []).filter(s => s.role === 'state').length > 1) out.push('review.round row has more than one state segment')
  return out
}
// a bare-glyph item (no state word) under a count chip must wear the chip's glyph; a differing state keeps its word
const glyphOfSeg = (l: PaneLine): string | undefined => (l.segs ?? []).find(s => s.role === 'glyph')?.text
const bareMismatch = (ls: PaneLine[]): string[] => {
  const head = ls.find(l => l.kind === 'header' && l.fact === 'now.attention')
  const chip = head === undefined ? undefined : [...(head.segs ?? [])].reverse().find(s => s.role === 'glyph')?.text
  if (chip === undefined) return []
  return ls.filter(l => l.kind === 'item' && l.fact === 'now.attention' && !(l.segs ?? []).some(s => s.role === 'state') && glyphOfSeg(l) !== chip).map(l => JSON.stringify(l.text.trimEnd()))
}
// the golden table: the (fact, goto, kind) triples of the busy snapshot, in order
const GOLDEN_NOW = [
  'now.attention||header', 'now.attention||item', 'decide.cards|decide|item', 'now.attention|hygiene|item',
  'now.position||chart', 'now.position||chart', 'now.position||kv', 'now.position||kv', 'now.position||kv', 'now.position||kv',
  'dispatch.counts|dispatch|kv', 'review.round|review|kv', 'usage.limit_max|spend|meter', 'residue.groups|hygiene|kv',
  'now.background||item', 'now.tasks||header', 'now.tasks||item', 'now.tasks||item',
]
test('I17: every data line of 現況 has a fact; a foreign fact is a kv / item projection with goto and the only line for it; the header spend segments carry spend.* and no goto', () => {
  for (const [loc, t] of LOCALES) {
    const ls = nowLines(snap(), ctxOf(t, 76))
    expect(i17(ls), loc).toEqual([])
    // negative controls: a stripped fact, a stripped goto, and a second line for one foreign fact
    expect(i17(ls.map(l => (l.kind === 'item' ? { ...l, fact: undefined } : l))).length).toBeGreaterThan(0)
    expect(i17(ls.map(l => (l.fact === 'dispatch.counts' ? { ...l, goto: undefined } : l))).length).toBeGreaterThan(0)
    expect(i17([...ls, ls.find(l => l.fact === 'review.round') as PaneLine]).length).toBeGreaterThan(0)
    const rv = ls.find(l => l.fact === 'review.round') as PaneLine
    expect(i17(ls.map(l => (l === rv ? { ...l, segs: [...(l.segs ?? []), { text: 'x', role: 'state' as const }] } : l))).length, 'a second state seg on the review row').toBeGreaterThan(0)
    // a bare-glyph reason under a chip of another state is flagged; the real render has none, and the stalled reason says its word
    expect(bareMismatch(ls), loc).toEqual([])
    const reason = ls.find(l => l.kind === 'item' && l.fact === 'now.attention') as PaneLine
    expect(reason.segs?.some(s => s.role === 'state'), 'the stalled reason keeps its state word under a louder chip').toBe(true)
    expect(bareMismatch(ls.map(l => (l === reason ? { ...l, segs: (l.segs ?? []).filter(s => s.role !== 'state') } : l))).length).toBeGreaterThan(0)
    // the header: spend.* on the two spend segments, none of them a goto
    const head = headerLines(snap(), ctxOf(t, 120))
    const facts = head.flatMap(l => (l.segs ?? []).flatMap(s => (s.fact === undefined ? [] : [s.fact])))
    expect([...new Set(facts.filter(f => f.startsWith('spend.')))], loc).toEqual(['spend.session', 'spend.local_today'])
    expect(head.every(l => l.goto === undefined), 'the header carries no goto').toBe(true)
  }
  const zh = LOCALES[0][1]
  const triples = nowLines(snap(), ctxOf(zh, 76)).flatMap(l => (l.fact === undefined || l.fact === 'pane.chrome' ? [] : [l.fact + '|' + (l.goto ?? '') + '|' + l.kind]))
  expect(triples).toEqual(GOLDEN_NOW)
})

// ---- I18 (pure half): the default render has no detail or command line and no list over 5 rows; an open toggle adds exactly its own lines ----
test('I18 (pure): 現況 by default has no detail or command line and no list over 5 rows; tasks and background `more` hold the rest', () => {
  const many = Array.from({ length: 8 }, (_, i) => task('open ' + i, i === 0 ? 'in_progress' : 'pending'))
  const live = Array.from({ length: 7 }, (_, i) => item('job ' + i, 1_000 + i))
  const t = makeT('en')
  const s = snap({ tasks: many, activity: [...live, item('ended', 1_000, '[exited with code 0]')], decision: false }) // the 待決議事項 block is open by design (full context), so this default holds while none is pending
  const ls = nowLines(s, ctxOf(t, 100))
  expect(ls.filter(l => l.kind === 'detail' || l.kind === 'command').length).toBe(0)
  const section = (id: string) => { const from = ls.findIndex(l => l.toggle === id); return ls.slice(from + 1, ls.findIndex((l, i) => i > from && l.kind === 'header') === -1 ? undefined : ls.findIndex((l, i) => i > from && l.kind === 'header')) }
  expect(section('sec:now.tasks').filter(l => l.kind === 'item').length).toBe(5)
  expect(section('sec:now.background').filter(l => l.kind === 'item').length).toBe(5)
  expect(section('sec:now.tasks').filter(l => l.kind === 'more').length).toBe(1)
  expect(section('sec:now.background').filter(l => l.kind === 'more').length).toBe(2) // the live rows' own more, and the ended toggle
  const open = nowLines(s, ctxOf(t, 100, { expanded: ['more:now.tasks', 'more:now.background'] }))
  expect(open.filter(l => l.kind === 'item').length).toBeGreaterThan(ls.filter(l => l.kind === 'item').length)
})

// ---- I19 (pure half): the default fold of every header equals SECTION_DEFAULTS; 要你處理 never starts folded ----
test('I19 (pure): every 現況 header starts as SECTION_DEFAULTS says (最近對話 folded, the rest open, 要你處理 never folded); a flipped fold is flagged', () => {
  const t = makeT('zh-TW')
  const defaults = (ls: PaneLine[]): string[] => ls.filter(l => l.kind === 'header').flatMap(l => {
    const id = (l.toggle as string).replace(/^sec:/, '')
    const wantFolded = ui.SECTION_DEFAULTS[id]?.folded === true
    const folded = l.text.startsWith('▸')
    return folded === wantFolded ? [] : [id + (folded ? ' starts folded' : ' starts open')]
  })
  const ls = nowLines(snap(), ctxOf(t, 76))
  expect(defaults(ls)).toEqual([])
  expect(ls.find(l => l.toggle === 'sec:now.attention')?.text.startsWith('▾')).toBe(true)
  expect(ls.find(l => l.toggle === 'sec:now.recent')?.text.startsWith('▸')).toBe(true)
  // negative control (M29): 要你處理 that starts folded is flagged
  expect(defaults(nowLines(snap(), ctxOf(t, 76, { folded: ['sec:now.attention'] }))).length).toBeGreaterThan(0)
})

// ---- P1 follow-up: a goto survives wrapping, on every piece of a wrapped summary row ----
test('wrap: a summary row that wraps keeps its goto on every piece (each piece stays pressable)', () => {
  for (const [loc, t] of LOCALES) {
    const wide = nowLines(snap(), ctxOf(t, 120))
    const narrow = nowLines(snap(), ctxOf(t, 30))
    const want = wide.filter(l => (l.kind === 'kv' || l.kind === 'meter') && l.goto !== undefined).map(l => l.goto)
    expect(want, loc).toEqual(['dispatch', 'review', 'spend', 'hygiene'])
    const pieces = narrow.filter(l => (l.kind === 'kv' || l.kind === 'meter') && l.goto !== undefined)
    expect(pieces.length, loc + ': at 30 columns at least one summary row wraps').toBeGreaterThan(want.length)
    const gotoOfLines = (ls: PaneLine[]) => ls.map(l => l.goto)
    const tabsFrom = narrow.findIndex(l => l.toggle === 'sec:now.tabs')
    const body = narrow.slice(tabsFrom + 1, narrow.findIndex((l, i) => i > tabsFrom && l.kind === 'header'))
    expect(gotoOfLines(body).every(g => g !== undefined), loc + ': every line of the summary section, wrapped or not, has a goto').toBe(true)
  }
  // a literal line, so the check does not lean on the fixture: three pieces, one goto each
  const long = { kind: 'kv' as const, goto: 'review' as const, text: 'review ›    ' + 'word '.repeat(20), segs: [{ text: 'review ›    ' }, { text: 'word '.repeat(20) }], hang: 12 } as PaneLine
  const out = wrapLines([long], 30)
  expect(out.length).toBeGreaterThan(2)
  expect(out.every(l => l.goto === 'review')).toBe(true)
})

// ---- the overflow hint (coordinator ruling 2026-10-14): pure halves. `pane.overflow` is pane.tsx's own scroll state: the header's last metrics line says how many rows lie below ----
function hinted(t: ReturnType<typeof makeT>, cols: number, scroll: { offset: number; bodyRows: number } | null, delta: number | null = null) {
  const c = ctxOf(t, cols)
  const s = snap()
  const sr = stripRows(s, c, 'now', true)
  const head = headerLines(s, c)
  const total = treeRowCount(sr.rows, head, nowLines(s, c), 0)
  const win = scroll === null ? null : { offset: scroll.offset, bodyRows: delta === null ? scroll.bodyRows : total - delta }
  return { total, sr, head, out: withOverflowHint(head, c, win, total, sr.exact) }
}
const hintSegOf = (ls: PaneLine[]) => ls.flatMap(l => l.segs ?? []).find(s => s.fact === 'pane.overflow')

test('hint: a tree exactly the window high has none, one row taller says 1 (both locales)', () => {
  for (const [loc, t] of LOCALES) {
    const probe = hinted(t, 76, { offset: 0, bodyRows: 0 }, 0)
    expect(hintSegOf(probe.out), loc + ': bodyRows == tree rows').toBeUndefined()
    const one = hinted(t, 76, { offset: 0, bodyRows: 0 }, 1)
    expect(hintSegOf(one.out)?.text, loc).toBe(loc === 'zh-TW' ? '下方還有 1 行' : '1 more rows below')
    // negative control: a window taller than the tree has none either; and a window of 5 says total - 5
    expect(hintSegOf(hinted(t, 76, { offset: 0, bodyRows: 0 }, -3).out), loc).toBeUndefined()
    expect(hintSegOf(hinted(t, 76, { offset: 0, bodyRows: 5 }).out)?.text, loc).toContain(String(probe.total - 5))
  }
})

test('hint: once the window has moved (offset > 0) there is none', () => {
  for (const [loc, t] of LOCALES) {
    expect(hintSegOf(hinted(t, 76, { offset: 0, bodyRows: 5 }).out), loc + ': at the top').toBeDefined()
    expect(hintSegOf(hinted(t, 76, { offset: 1, bodyRows: 5 }).out), loc + ': scrolled one row').toBeUndefined()
    expect(hintSegOf(hinted(t, 76, null).out), loc + ': no scroll known').toBeUndefined()
  }
})

test('hint: its identity (own fact, owner pane, dim, text only, no glyph) and the line is exactly as wide as the pane minus the edge', () => {
  expect(ui.FACT_OWNER['pane.overflow']).toBe('pane')
  expect('overflow' in ui.GLYPHS.structure, 'owner ruling 2026-10-14: no glyph for the overflow hint').toBe(false)
  expect(ui.NEW_GLYPHS).not.toContain('⇣')
  for (const [loc, t] of LOCALES) {
    const r = hinted(t, 76, { offset: 0, bodyRows: 5 })
    const seg = hintSegOf(r.out) as Seg
    expect(seg.dim, loc).toBe(true)
    expect(/^[^\s\p{S}]/u.test(seg.text) && !seg.text.includes('⇣'), loc + ': the hint starts with its words, not an arrow').toBe(true)
    const line = r.out.find(l => l.segs?.includes(seg)) as PaneLine
    expect(ui.displayWidth(line.text), loc + ': right-aligned to cols - 1').toBe(75)
    expect(line.text.endsWith(seg.text), loc).toBe(true)
    // the spend segments are untouched: same text as without the hint
    const plain = r.head.find(l => l.text.includes('$')) as PaneLine
    expect(line.text.startsWith(plain.text), loc).toBe(true)
  }
})

test('hint: no room means it is dropped, never squeezed into or cut out of the spend figures', () => {
  for (const [loc, t] of LOCALES) {
    const c = ctxOf(t, 76)
    const full = { text: 'x'.repeat(70), segs: [{ text: 'x'.repeat(70) }] } as PaneLine
    const out = withOverflowHint([full, ui.blank()], c, { offset: 0, bodyRows: 5 }, 50, true)
    expect(out[0], loc).toBe(full)
    expect(hintSegOf(out), loc).toBeUndefined()
    // negative control: the same line with room gets its hint
    const roomy = { text: 'x'.repeat(20), segs: [{ text: 'x'.repeat(20) }] } as PaneLine
    expect(hintSegOf(withOverflowHint([roomy, ui.blank()], c, { offset: 0, bodyRows: 5 }, 50, true)), loc).toBeDefined()
  }
})

test('hint: a tab strip that wraps makes the row count uncertain, so the hint says "more" without a number', () => {
  for (const [loc, t] of LOCALES) {
    const wide = hinted(t, 76, { offset: 0, bodyRows: 5 })
    expect(wide.sr.exact, loc).toBe(true)
    const c = ctxOf(t, 30)
    const s = snap()
    const sr = stripRows(s, c, 'now', true)
    expect(sr.exact, loc + ': 30 columns wraps the strip').toBe(false)
    expect(sr.rows, loc).toBeGreaterThan(2)
    const st = stripOf(s, c, 'now', true)
    expect(st.rule.some(g => g.text.includes('━')), loc + ': a wrapped strip draws no ━ under-mark').toBe(false)
    const on = st.tabs.find(x => x.on)!
    expect(on.label.bold === true && on.label.color === 'claude', loc + ': the active label falls back to bold claude').toBe(true)
    const one = stripOf(s, ctxOf(t, 76), 'now', true)
    expect(one.rule.some(g => g.text.includes('━')), loc + ': control: an unwrapped strip does draw it').toBe(true)
    // the header line at 30 columns: the metrics wrap, so give the hint a roomy line to show the wording
    const roomy = { text: 'x'.repeat(5), segs: [{ text: 'xxxxx' }] } as PaneLine
    const out = withOverflowHint([roomy, ui.blank()], c, { offset: 0, bodyRows: 5 }, 50, false)
    expect(hintSegOf(out)?.text, loc).toBe(loc === 'zh-TW' ? '下方還有更多' : 'more rows below')
  }
})

// ---- the usage row with several quota windows (P4 review follow-up): the one 用量 row shows the most-used window, whichever it is ----
const withQuota = (quota: { kind: string; pct: number; resetsAtMs: number | null }[], brain: number | null = 120.4): LiveSnapshot => {
  const s = snap() as never as { account: unknown; detail: { spend: unknown } }
  s.account = { account: null, quota }
  if (brain === null) s.detail.spend = { session: '$0.42', host_all: '$3.10', host_all_n: null, brain: null, cap: null, mode: 'warn', hourly: null }
  return s as never
}
const usageRow = (ls: PaneLine[]): PaneLine[] => ls.filter(l => l.fact === 'usage.limit_max')
test('usage row: with a brain cap and four quota windows the row is the single most-used one, and it is the only line of usage.limit_max', () => {
  const reset = NOW + 3 * 3_600_000
  const cases: { quota: { kind: string; pct: number; resetsAtMs: number | null }[]; brain?: number | null; key: string }[] = [
    { quota: [{ kind: 'five_hour', pct: 40, resetsAtMs: reset }, { kind: 'seven_day', pct: 92, resetsAtMs: reset }, { kind: 'spend_limit', pct: 60, resetsAtMs: null }, { kind: 'seven_day_opus', pct: 70, resetsAtMs: null }], key: 'label.quota_7d' },
    { quota: [{ kind: 'five_hour', pct: 97, resetsAtMs: reset }, { kind: 'seven_day', pct: 92, resetsAtMs: reset }, { kind: 'spend_limit', pct: 60, resetsAtMs: null }], key: 'label.quota_5h' },
    { quota: [{ kind: 'five_hour', pct: 10, resetsAtMs: reset }, { kind: 'spend_limit', pct: 99, resetsAtMs: null }], key: 'label.quota_spend' },
    { quota: [{ kind: 'five_hour', pct: 10, resetsAtMs: reset }, { kind: 'seven_day', pct: 20, resetsAtMs: null }], key: 'label.brain_today' }, // brain 120.4 / 150 = 80% beats both
    { quota: [{ kind: 'five_hour', pct: 10, resetsAtMs: reset }, { kind: 'seven_day', pct: 20, resetsAtMs: null }], brain: null, key: 'label.quota_7d' }, // no brain cap published: the windows alone
  ]
  for (const [loc, t] of LOCALES) for (const c of cases) {
    const ls = nowLines(withQuota(c.quota, c.brain), ctxOf(t, 76))
    const rows = usageRow(ls)
    expect(rows.length, loc + ' ' + c.key).toBe(1)
    expect(rows[0].goto).toBe('spend')
    // the brain window prints its amount, a quota window its label; both name the window they show
    if (c.key === 'label.brain_today') expect(rows[0].text, loc).toContain('$120.40')
    else expect(rows[0].text, loc + ' ' + rows[0].text).toContain(t(c.key))
    expect(i17(ls), loc + ' ' + c.key).toEqual([])
    // negative control: the least-used window is not the one shown
    expect(rows[0].text.includes(t('label.quota_5h')) && c.key !== 'label.quota_5h', loc + ' ' + c.key).toBe(false)
  }
})

// ---- P5: every structural invariant over every tab (plan §7: "every invariant over every tab") ----
const ALL_TABS = ['now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'legend'] as const
const richSnap = (): LiveSnapshot => {
  const s = withQuota([{ kind: 'five_hour', pct: 40, resetsAtMs: NOW + 3_600_000 }, { kind: 'seven_day', pct: 92, resetsAtMs: null }]) as never as { detail: { residue: object } }
  s.detail.residue = { reapable: 0, by_class: {}, at: null, needs_human_count: 2, needs_human_bytes: 3_000_000, auto_ran_at: iso(3_600_000), auto_removed_count: 2, auto_archived_count: 1,
    needs_human: [
      { kind: 'worktree', target: '/home/u/proj/.claude/worktrees/hands-x', class: 'dirty', age_days: 4, bytes: 2_000_000, reason: 'uncommitted work', command: 'git worktree remove --force /home/u/proj/.claude/worktrees/hands-x' },
      { kind: 'branch', target: 'feature/old', class: 'unintegrated-branch', age_days: 20, bytes: null, reason: null, command: 'git branch -D feature/old' },
    ] }
  return s as never
}
const tabLinesOf = (tab: (typeof ALL_TABS)[number], s: LiveSnapshot, c: ReturnType<typeof ctxOf>): PaneLine[] =>
  tab === 'now' ? nowLines(s, c) : tab === 'decide' ? decideTabLines(s, c) : tab === 'dispatch' ? dispatchLines(s, c) : tab === 'review' ? reviewTabLines(s, c) : tab === 'spend' ? spendTabLines(s, c) : tab === 'hygiene' ? hygieneTabLines(s, c) : legendLines(c)
// the invariants of the plan that hold on every tab, as a list of violations (empty = holds)
const ONE_LINE_KINDS = new Set(['header', 'item', 'bullet', 'table', 'more'])
const everyTab = (tab: (typeof ALL_TABS)[number], ls: PaneLine[], cols: number, expanded: boolean): string[] => {
  const out: string[] = []
  const seenToggle = new Set<string>()
  let emptiesInSection = 0
  const foreign = new Map<string, number>()
  ls.forEach((l, i) => {
    const at = tab + ' line ' + i + ' ' + JSON.stringify(l.text.trimEnd())
    if (!ui.isMade(l)) out.push(at + ' is not made by a component (made)')
    if (l.kind === undefined || l.fact === undefined) out.push(at + ' has no kind or no fact (type lock)')
    if (ONE_LINE_KINDS.has(l.kind) && ui.displayWidth(l.text) > cols - 1) out.push(at + ' is a one-line kind wider than the pane (width)') // kv, detail, command and chart lines wrap by their hang, these never do
    if (l.kind === 'header') { emptiesInSection = 0; if (l.toggle === undefined) out.push(at + ' is a header with no toggle (fold)') }
    if (l.kind === 'empty' && l.text.startsWith(ui.GLYPHS.structure.empty) && ++emptiesInSection > 1) out.push(at + ' is a second empty line in one section (empty)')
    if (l.toggle !== undefined) { if (seenToggle.has(l.toggle)) out.push(at + ' repeats toggle ' + l.toggle); seenToggle.add(l.toggle) }
    if (!expanded && l.kind === 'command') out.push(at + ' is a command in the default render (command)')
    if (l.fact === 'pane.chrome' || l.fact === 'pane.overflow') return
    const owner = ui.FACT_OWNER[l.fact]
    if (owner !== tab) {
      if (l.goto === undefined) out.push(at + ' shows ' + l.fact + ' (owner ' + owner + ') without goto (owner)')
      if (!((l.kind === 'kv' || l.kind === 'meter') && l.text.startsWith(' '.repeat(ui.KEY_W)))) foreign.set(l.fact, (foreign.get(l.fact) ?? 0) + 1) // a wrapped continuation row is the same row
    }
  })
  for (const [f, n] of foreign) if (n > 1) out.push(tab + ': ' + f + ' is drawn ' + n + ' times (owner)')
  return out
}
test('every tab: made lines, kind and fact, width, one empty per section, unique toggles, no command by default, foreign facts carry goto and appear once', () => {
  const ids = (tab: (typeof ALL_TABS)[number], ls: PaneLine[]) => ls.filter(l => l.kind === 'item' && l.toggle !== undefined).map(l => l.toggle as string).concat(tab === 'hygiene' ? ['res:worktree|dirty', 'res:branch|unintegrated-branch'] : [])
  for (const [loc, t] of LOCALES) for (const cols of [40, 60, 76, 120, 160]) for (const tab of ALL_TABS) {
    const dflt = tabLinesOf(tab, richSnap(), ctxOf(t, cols))
    expect(everyTab(tab, dflt, cols, false), loc + ' ' + cols + ' default').toEqual([])
    // every toggle the default render offers, plus the residue ones, opened at once
    const open = ctxOf(t, cols, { expanded: [...ids(tab, dflt), ...dflt.filter(l => l.toggle !== undefined).map(l => l.toggle as string), 'resitem:/home/u/proj/.claude/worktrees/hands-x', 'resitem:feature/old'] })
    expect(everyTab(tab, tabLinesOf(tab, richSnap(), open), cols, true), loc + ' ' + cols + ' expanded').toEqual([])
  }
})
test('every tab: negative controls, each invariant is reported when its line is broken', () => {
  const t = makeT('en')
  const ls = tabLinesOf('hygiene', richSnap(), ctxOf(t, 76))
  const first = ls.findIndex(l => l.kind === 'item')
  const bent = (f: (l: PaneLine) => PaneLine): string[] => everyTab('hygiene', ls.map((l, i) => (i === first ? f(l) : l)), 76, false)
  expect(bent(l => ({ ...l, text: l.text })).length, 'copy').toBeGreaterThan(0) // spread drops the brand
  expect(bent(l => ui.carry(l, { ...l, text: 'x'.repeat(80) }) /* an item 80 wide */).some(v => v.includes('(width)')), 'width').toBe(true)
  expect(bent(l => Object.assign(ui.carry(l, { ...l }), { fact: 'review.round' as const, goto: undefined })).some(v => v.includes('(owner)')), 'owner').toBe(true)
  expect(everyTab('hygiene', [...ls, ui.empty('x', 'residue.groups'), ui.empty('y', 'residue.groups')], 76, false).some(v => v.includes('(empty)')), 'empty').toBe(true)
  expect(everyTab('hygiene', [...ls, ...ui.command(({ t, cols: 76 }) as never, 'git status')], 76, false).some(v => v.includes('(command)')), 'command').toBe(true)
})

// ---- P5: I1-I8 and I10 (the checker review.test.ts runs over the Review tab) over EVERY tab, fixtures x locales x widths, default and with every toggle open ----
// The one exemption: the legend is a sample column (the mark at column 0, its meaning hanging at 12, wrapped rows at 14) and its `—` row explains the empty mark by
// the sentence "no data", so I3 (kv hang 12, indent set) and the I10 "says no data" half are not asked of it. Nothing else is exempt: a hand-written number on any
// other tab is I8, a bold or claude segment without `here` is I4 / I6.
const EXEMPT: Record<string, RegExp> = { legend: /^(I3 |I10 .* says no data outside an empty line)/ }
const tabViolations = (tab: (typeof ALL_TABS)[number], ls: PaneLine[], cols: number, t: ReturnType<typeof makeT>): string[] =>
  violations(ls, cols, t).filter(v => !(EXEMPT[tab] ?? /^$/).test(v)).map(v => tab + ' ' + v)
test('every tab: I1-I8 and I10 hold on all seven tabs, in both locales, at 40-160 columns, default and with every toggle open', () => {
  const found = new Set<string>()
  const ids = (ls: PaneLine[]) => ls.filter(l => l.toggle !== undefined).map(l => l.toggle as string)
  for (const [, t] of LOCALES) for (const cols of [40, 60, 76, 120, 160]) for (const tab of ALL_TABS) {
    const dflt = tabLinesOf(tab, richSnap(), ctxOf(t, cols))
    const open = ctxOf(t, cols, { expanded: [...ids(dflt), 'resitem:/home/u/proj/.claude/worktrees/hands-x', 'resitem:feature/old'] })
    for (const ls of [dflt, tabLinesOf(tab, richSnap(), open)]) for (const v of tabViolations(tab, ls, cols, t)) found.add(v.replace(/ line \d+/, ''))
  }
  expect([...found]).toEqual([])
})
test('every tab: a percentage is never written with a space before the sign (§3.5), in either locale, on any tab', () => {
  for (const [loc, t] of LOCALES) for (const tab of ALL_TABS) {
    const text = tabLinesOf(tab, richSnap(), ctxOf(t, 160)).map(l => l.text).join('\n')
    expect(/\d\s%/.test(text), loc + ' ' + tab).toBe(false)
  }
  // control: the checked pattern does catch the old legend wording
  expect(/\d\s%/.test('warns at 80 % and 100 %')).toBe(true)
})
test('hygiene: a residue class the status map has no row for is the unknown state with the producer text in a detail line, never a raw string id', () => {
  const withClass = (cls: string): LiveSnapshot => {
    const s = richSnap() as never as { detail: { residue: { needs_human: { class: string }[] } } }
    s.detail.residue.needs_human = [{ ...s.detail.residue.needs_human[0], class: cls }]
    return s as never
  }
  for (const [loc, t] of LOCALES) {
    const open = ctxOf(t, 76, { expanded: ['res:worktree|weird-class'] })
    const lines = hygieneTabLines(withClass('weird-class'), open)
    const text = lines.map(l => l.text).join('\n')
    expect(/residue\.class/.test(text), loc + ' raw id').toBe(false)
    expect(text, loc + ' word').toContain(t('residue.class.unknown'))
    expect(text, loc + ' producer text').toContain('weird-class')
    expect(lines.some(l => l.kind === 'detail' && l.text.includes('weird-class')), loc + ' detail line').toBe(true)
    expect(lines.some(l => l.kind === 'item' && l.text.includes(t('ui.state.unknown'))), loc + ' unknown state').toBe(true)
    // control: a class the map knows keeps its own word and has no detail line for it
    const known = hygieneTabLines(withClass('dirty'), ctxOf(t, 76, { expanded: ['res:worktree|dirty'] }))
    expect(known.some(l => l.text.includes(t('residue.class_raw', { cls: 'dirty' }))), loc + ' known has no raw line').toBe(false)
    expect(known.map(l => l.text).join('\n'), loc + ' known word').toContain(t('residue.class.dirty'))
  }
})
test('every tab: the shared checker flags a hand-written number, a bold mark without here and a claude mark without here on any tab; the legend exemption covers nothing else', () => {
  const t = makeT('en')
  const lines = (tab: (typeof ALL_TABS)[number]): PaneLine[] => tabLinesOf(tab, richSnap(), ctxOf(t, 120))
  for (const tab of ['now', 'dispatch', 'spend', 'hygiene'] as const) {
    const ls = lines(tab)
    expect(tabViolations(tab, ls, 120, t), tab + ' control').toEqual([])
    // the number below is what a formatter makes ('7m'), but written by hand: no `fmt` names who made it
    const typed = ls.map((l, i) => (i === ls.findIndex(x => ['item', 'table', 'kv', 'meter', 'bullet'].includes(x.kind)) ? { ...l, segs: [...(l.segs ?? []), { text: ' · 7m', role: 'value' as const }] } : l))
    expect(tabViolations(tab, typed, 120, t).some(v => v.includes(' I8 ')), tab + ' hand-written number').toBe(true)
  }
  const bent = (tab: (typeof ALL_TABS)[number], f: (s: Seg) => object): string[] =>
    tabViolations(tab, lines(tab).map(l => ({ ...l, segs: (l.segs ?? []).map(s => (s.role === 'value' && s.text.trim() !== '' ? { ...s, ...f(s) } : s)) })) as PaneLine[], 120, t)
  expect(bent('dispatch', () => ({ bold: true })).some(v => v.includes(' I4 ')), 'bold without here').toBe(true)
  expect(bent('dispatch', () => ({ color: 'claude' })).some(v => v.includes(' I6 ')), 'claude without here').toBe(true)
  // a need_you kv summary row may bold its state mark and word only; a bold value on it is flagged (§3.6)
  const kvRow = (tab: (typeof ALL_TABS)[number]): PaneLine => lines(tab).find(l => l.kind === 'kv' && (l.segs ?? []).some(g => g.role === 'glyph' && g.text === ui.STATES.need_you.glyph)) as PaneLine
  const needKv = kvRow('now')
  expect(needKv, 'the fixture has a need_you kv summary row on the now tab').toBeDefined()
  const boldValue = { ...needKv, segs: (needKv.segs ?? []).map(s => (s.role === 'value' && s.text.trim() !== '' ? { ...s, bold: true } : s)) } as PaneLine
  expect(tabViolations('now', [boldValue], 120, t).some(v => v.includes(' I4 ')), 'bold value on a need_you kv row').toBe(true)
  // the legend exemption is only I3 and the "no data" sentence: a hand-made line in the legend is still caught
  const legend = lines('legend')
  expect(tabViolations('legend', [{ text: 'hand made', kind: 'kv' } as PaneLine, ...legend], 120, t).some(v => v.includes(' I2 ')), 'legend I2').toBe(true)
  expect(tabViolations('legend', legend.map(l => ({ ...l, segs: [...(l.segs ?? []), { text: ' 7m', role: 'value' as const }] })), 120, t).some(v => v.includes(' I8 ')), 'legend I8').toBe(true)
})

test('strip: the active label and the ━ run are the here mark (I4 / I6); every bold or claude seg of the strip carries here', () => {
  for (const [loc, t] of LOCALES) {
    const sr = stripOf(snap(), ctxOf(t, 120), 'now', true)
    const marked = [...sr.tabs.map(x => x.label), ...sr.tabs.flatMap(x => x.badge), ...sr.rule]
    for (const s of marked) if (s.bold === true || s.color === 'claude') expect(s.here, loc + ': strip seg "' + s.text.trim() + '" is bold or claude without here').toBe(true)
    expect(sr.tabs.filter(x => x.on).length).toBe(1)
    expect(sr.rule.some(s => s.here === true && s.text.includes('━')), loc + ': the ━ run carries here').toBe(true)
  }
})

// ---- 待決議事項 on 現況: one row that points at the 待決 tab (the cards are decide.test.ts); no row at all when none is open ----
const pend = (id: string, q: string, over: Partial<LiveSnapshot['pending'][number]> = {}): LiveSnapshot['pending'][number] => ({
  id, question: q, background: null, options: [], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 60, orphaned: false, ...over,
})
test('PENDING (現況): any number of open questions is ONE row that counts them and points at 待決; no question text, no block, no header', () => {
  const long = 'this background sentence is deliberately long enough that it has to wrap at seventy-six columns and must never be cut off by the pane'
  const two = [
    pend('d-1', 'merge or split?', { background: long, options: [{ label: 'merge', description: 'one acceptance' }, { label: 'split', description: 'two acceptances' }], recommendation: 'merge', why: 'fewer round trips', blocks: 'the release cannot start', source: 'depth-0 AskUserQuestion' }),
    pend('d-2', 'which engine?', { options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }),
  ]
  for (const [loc, t] of LOCALES) {
    const ls = nowLines({ ...snap(), pending: two }, ctxOf(t, 76))
    const rows = ls.filter(l => l.fact === 'decide.cards')
    expect(rows.length, loc).toBe(1)
    expect(rows[0].kind, loc).toBe('item')
    expect(rows[0].goto, loc).toBe('decide')
    expect(rows[0].text, loc).toContain(t('now.pending_sum', { n: 2 }))
    expect(rows[0].text.trimEnd().endsWith(t('tab.decide') + ' ›'), loc + ': the row ends with the tab it opens').toBe(true)
    const text = ls.map(l => l.text).join('\n')
    for (const gone of ['merge or split?', 'which engine?', 'one acceptance', 'fewer round trips', 'the release cannot start', 'depth-0 AskUserQuestion', 'this background sentence'])
      expect(text, loc + ': ' + gone + ' is on the 待決 tab, not here').not.toContain(gone)
    expect(ls.some(l => l.kind === 'header' && l.text.includes(t('tab.decide'))), loc + ': no section header for it').toBe(false)
    for (const l of ls) expect(ui.displayWidth(l.text), loc + ': "' + l.text + '"').toBeLessThanOrEqual(75)
    expect(i17(ls), loc).toEqual([])
  }
  // negative control: with none pending there is no row and no fact
  const none = nowLines({ ...snap(), pending: [] }, ctxOf(makeT('en'), 76))
  expect(none.some(l => l.fact === 'decide.cards')).toBe(false)
  expect(none.map(l => l.text).join('\n')).not.toContain('pending decisions')
})

// ---- orphan label (BL-0163): the asker's session is gone; the entry stays listed, labelled, never dropped ----
test('PENDING: an orphaned question carries the asker-ended label in pane and band suffix, stays listed; a live one carries none', () => {
  for (const [loc, t] of LOCALES) {
    const text = (o: boolean): string => decideTabLines({ ...snap(), pending: [pend('d-9', 'ship it?', { orphaned: o })] }, ctxOf(t, 76)).map(l => l.text).join('\n')
    expect(text(true), loc).toContain('ship it?')
    expect(text(true), loc + ': orphan label').toContain(t('decision.orphaned').trim())
    expect(text(false), loc + ': a live question has no orphan label').not.toContain(t('decision.orphaned').trim())
    expect(staleSuffix(pend('d-9', 'q', { orphaned: true }), t), loc).toBe(t('decision.orphaned'))
    expect(staleSuffix(pend('d-9', 'q', { orphaned: true, stale: true, age_s: 8 * 86400 }), t), loc + ': stale and orphaned both say so').toBe(t('decision.stale_days', { d: 8 }) + t('decision.orphaned'))
    expect(staleSuffix(pend('d-9', 'q'), t), loc).toBe('')
  }
})
