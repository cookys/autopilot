// P4 of the live pane design system (docs/plans/2026-10-13-live-pane-design-system.md §7 row "P4 現況"): the Now tab, built from ui.ts components, and the global header.
// Pure tests over a fixture snapshot. Enabled here: I9 (a), I11 F1 / X0 / X1, I16, I17, the pure halves of I18 and I19. The mounted halves (I9 b, I18 tasks and background
// `more`, the full I19) are in live.test.ts, named "P4 mounted ...". Each check ships with a negative control: a deliberately broken input that must be flagged.
import { test, expect } from 'claude-code/testing'
import { makeT } from './i18n'
import { NO_DETAIL, NO_SECTIONS, dispatchLines, headerLines, hygieneTabLines, legendLines, nowLines, reviewTabLines, spendTabLines, stripRows, treeRowCount, withOverflowHint, wrapLines } from './model'
import type { LiveSnapshot, PaneLine, Seg } from './model'
import * as ui from './ui'

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
    decision: o.decision === false ? null : { question: 'merge or split?', options: [{ label: 'merge', consequence: 'one acceptance' }], stale: false, age_s: 60 },
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
    const tabs: [string, PaneLine[]][] = [['now', nowLines(s, c)], ['dispatch', dispatchLines(s, c)], ['review', reviewTabLines(s, c)], ['spend', spendTabLines(s, c)], ['hygiene', hygieneTabLines(s, c)], ['legend', legendLines(c)]]
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
    const goto = ls.filter(l => l.kind === 'kv' && l.goto !== undefined).map(l => l.goto)
    expect(goto, loc).toEqual(['dispatch', 'review', 'spend', 'hygiene'])
    // negative controls
    expect(i16(ls.map(l => (l.kind === 'kv' && l.goto === 'spend' ? { ...l, goto: undefined } : l)), t).length).toBeGreaterThan(0)
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
    if (l.fact === undefined) return
    if (ui.FACT_OWNER[l.fact] !== 'now') {
      if (l.goto === undefined) out.push(at + ' shows ' + l.fact + ' (owned by ' + ui.FACT_OWNER[l.fact] + ') without goto')
      if (l.kind !== 'kv' && l.kind !== 'item') out.push(at + ' is a projection that is not kv / item')
      seenForeign.set(l.fact, (seenForeign.get(l.fact) ?? 0) + 1)
    }
  })
  for (const [f, n] of seenForeign) if (n > 1) out.push(f + ' is drawn ' + n + ' times on the tab')
  return out
}
// the golden table: the (fact, goto, kind) triples of the busy snapshot, in order
const GOLDEN_NOW = [
  'now.attention||header', 'now.attention||item', 'now.attention||item', 'residue.cleanup|hygiene|item',
  'now.position||chart', 'now.position||chart', 'now.position||kv', 'now.position||kv', 'now.position||kv', 'now.position||kv',
  'dispatch.counts|dispatch|kv', 'review.round|review|kv', 'usage.limit_max|spend|kv', 'residue.groups|hygiene|kv',
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
    // the header: spend.* on the two spend segments, none of them a goto
    const head = headerLines(snap(), ctxOf(t, 120))
    const facts = head.flatMap(l => (l.segs ?? []).flatMap(s => (s.fact === undefined ? [] : [s.fact])))
    expect([...new Set(facts.filter(f => f.startsWith('spend.')))], loc).toEqual(['spend.session', 'spend.local_today'])
    expect(head.every(l => l.goto === undefined), 'the header carries no goto').toBe(true)
  }
  const zh = LOCALES[0][1]
  const triples = nowLines(snap(), ctxOf(zh, 76)).flatMap(l => (l.fact === undefined ? [] : [l.fact + '|' + (l.goto ?? '') + '|' + l.kind]))
  expect(triples).toEqual(GOLDEN_NOW)
})

// ---- I18 (pure half): the default render has no detail or command line and no list over 5 rows; an open toggle adds exactly its own lines ----
test('I18 (pure): 現況 by default has no detail or command line and no list over 5 rows; tasks and background `more` hold the rest', () => {
  const many = Array.from({ length: 8 }, (_, i) => task('open ' + i, i === 0 ? 'in_progress' : 'pending'))
  const live = Array.from({ length: 7 }, (_, i) => item('job ' + i, 1_000 + i))
  const t = makeT('en')
  const s = snap({ tasks: many, activity: [...live, item('ended', 1_000, '[exited with code 0]')] })
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
    const want = wide.filter(l => l.kind === 'kv' && l.goto !== undefined).map(l => l.goto)
    expect(want, loc).toEqual(['dispatch', 'review', 'spend', 'hygiene'])
    const pieces = narrow.filter(l => l.kind === 'kv' && l.goto !== undefined)
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
    expect(hintSegOf(one.out)?.text, loc).toBe(loc === 'zh-TW' ? '↓ 下方還有 1 行' : '↓ 1 more rows below')
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

test('hint: its identity (own fact, owner pane, dim, glyph from GLYPHS) and the line is exactly as wide as the pane minus the edge', () => {
  expect(ui.FACT_OWNER['pane.overflow']).toBe('pane')
  expect(ui.GLYPHS.structure.overflow).toBe('↓')
  expect(ui.NEW_GLYPHS).toContain('↓')
  for (const [loc, t] of LOCALES) {
    const r = hinted(t, 76, { offset: 0, bodyRows: 5 })
    const seg = hintSegOf(r.out) as Seg
    expect(seg.dim, loc).toBe(true)
    expect(seg.text.startsWith(ui.GLYPHS.structure.overflow + ' '), loc).toBe(true)
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
    // the header line at 30 columns: the metrics wrap, so give the hint a roomy line to show the wording
    const roomy = { text: 'x'.repeat(5), segs: [{ text: 'xxxxx' }] } as PaneLine
    const out = withOverflowHint([roomy, ui.blank()], c, { offset: 0, bodyRows: 5 }, 50, false)
    expect(hintSegOf(out)?.text, loc).toBe(loc === 'zh-TW' ? '↓ 下方還有更多' : '↓ more rows below')
  }
})
