// 殘留 tab (docs/plans/2026-10-13-live-pane-design-system.md §12.7): two sections (what needs you / what can simply be cleared), each entry read where it stands (name, reason in
// the owner's words, command), no fold to open; the auto-cleanup kv; the plugin source with a sentence per flag. The fixtures are the shape of the owner's real data
// (copied in, never read from the live directory). Each check ships with a negative control: a deliberately broken input the same predicate must flag.
import { test, expect } from 'claude-code/testing'
import { makeT } from './i18n'
import { NO_DETAIL, NO_SECTIONS, autoResidueCount, cleanTargets, readLoadSource, readResidue, residueTally, slotHygiene } from './model'
import { hygieneTabLines, nowLines, stripOf, tabNeeds } from './tabs'
import type { LiveSnapshot, PaneLine } from './model'
import * as ui from './ui'
import { violations } from './invariants.testkit'

const KEY = '9dc556b726c078d9'
const NOW = Date.parse('2026-10-15T21:11:00.000Z')
const ZH = makeT('zh-TW')
const EN = makeT('en')

const REAL_RESIDUE = {
  schema: 'autopilot.residue/1', project_key: KEY, at: '2026-10-15T21:11:32.126Z', reapable_worktrees: 3, by_class: { dirty: 2, 'clean-integrated': 3 }, source: 'repo-residue-sweep scan',
  needs_human_count: 3, needs_human_bytes: 627445760,
  needs_human: [
    { kind: 'worktree', class: 'dirty', age_days: 1.19, bytes: 298819584, reason: '1349 uncommitted path(s)', command: "git -C '/home/cookys/projects/autopilot/.claude/worktrees/agent-a16d390b66014e3cf' status --short", path: '/home/cookys/projects/autopilot/.claude/worktrees/agent-a16d390b66014e3cf' },
    { kind: 'worktree', class: 'clean-integrated', age_days: 0, bytes: null, reason: 'HEAD is an ancestor of the integration ref', command: "git -C '/home/cookys/projects/autopilot' worktree remove '/home/cookys/projects/autopilot/.claude/worktrees/lane-loadsrc'", path: '/home/cookys/projects/autopilot/.claude/worktrees/lane-loadsrc' },
    { kind: 'worktree', class: 'clean-integrated', age_days: 4.54, bytes: 328626176, reason: 'HEAD is an ancestor of the integration ref', command: "git -C '/home/cookys/projects/autopilot' worktree remove '/home/cookys/projects/autopilot/.claude/worktrees/release-3.0.0'", path: '/home/cookys/projects/autopilot/.claude/worktrees/release-3.0.0' },
  ],
  auto_ran_at: '2026-10-14T21:19:10.325Z', auto_removed_count: 0, auto_archived_count: 0,
}
const REAL_LOAD = {
  schema: 'autopilot.load-source/1', checked_at: '2026-10-15T21:11:20.292Z', plugin_version: '3.0.0-alpha.6', source: 'dev', source_basis: 'dev_link', marketplace: 'directory',
  marketplace_path: '/home/cookys/projects/autopilot', marketplace_is_dev: true, dev_link_ok: true, behind_upstream: 0, flags: ['stale_cache_dirs'],
  stale_cache_dirs: [{ dir: '/home/cookys/.claude/plugins/cache/autopilot/autopilot/2.36.36', in_use_pids: ['1808913', '2097570'], alive: [] }],
}
const band = { kind: 'running', key: 'suggestion', why: 'ok', verdictReason: null, mark: '●', verdict: 'v', head: '', progress: '—', progressDim: false, reason: null, project: 'repo', elapsed: '10m', phase: '—', slots: [] }
const snapOf = (residue: object | null, ls: object | null): LiveSnapshot => ({
  state: 'ok', text: '', header: 'h', metrics: { ctx: '37%' }, band, pending: [], project_key: null, root_run_id: null, link: null, rows: [], gates: null, sections: NO_SECTIONS,
  review: { plan: null, code: null }, published_at: null, session_as_of: null, host_as_of: null,
  detail: { ...NO_DETAIL, now_ms: NOW, project: 'repo', residue: residue === null ? null : readResidue(JSON.stringify(residue), KEY), load_source: ls === null ? null : readLoadSource(JSON.stringify(ls)) },
  activity: [], recent: [],
}) as never
const ctxOf = (t: typeof ZH, cols = 76, expanded: string[] = []) => ({ t, cols, expanded: new Set(expanded), folded: new Set<string>() })
const texts = (ls: PaneLine[]): string[] => ls.map(l => l.text.trimEnd())
const hyg = (s: LiveSnapshot, t: typeof ZH = ZH, cols = 76, expanded: string[] = []): string[] => texts(hygieneTabLines(s, ctxOf(t, cols, expanded)))
const entry = (over: object) => ({ kind: 'worktree', class: 'dirty', age_days: 2, bytes: 1048576, reason: '12 uncommitted path(s)', command: 'git status', path: '/w/wt-a', ...over })
const resWith = (entries: object[], extra: object = {}) => ({ ...REAL_RESIDUE, needs_human_count: entries.length, needs_human_bytes: null, needs_human: entries, ...extra })

test('real data at 76 columns: what needs you and what can be cleared are two sections, each entry is name, reason and command, nothing to open', () => {
  const out = hyg(snapOf(REAL_RESIDUE, REAL_LOAD))
  expect(out).toEqual(GOLDEN_ZH_76)
})

// the numbers every surface shows: the tab name, 現況's row, 現況's summary and the band's ⚑N
const surfaces = (s: LiveSnapshot) => {
  const found = texts(nowLines(s, ctxOf(ZH, 76))).find(l => l.includes('要你處理') && l.includes('worktree') && !l.startsWith('▾'))
  const row = found === undefined ? null : found.replace(/ +殘留 ›$/, '')
  const band = slotHygiene(null, s.detail.residue)
  return { tabName: tabNeeds(s).hygiene !== undefined, nowRow: row, band: band === null ? null : band.segs.map(g => g.text).join('') }
}
test('counts: only what needs your judgement is counted, on the tab chip, the tab name, 現況 and the band; the cleanable ones are not', () => {
  const s = snapOf(REAL_RESIDUE, REAL_LOAD)
  const tl = residueTally(s.detail.residue!)
  expect([tl.judgeCount, tl.cleanCount, tl.judgeBytes, tl.cleanBytes]).toEqual([1, 2, 298819584, 328626176])
  expect(surfaces(s)).toEqual({ tabName: true, nowRow: '▲ 1 個 worktree 要你處理', band: '⚑1' })
})
test('counts: negative control, a cleanable class counted as yours to judge is a different number on every surface (the counts test above would be red)', () => {
  const s = snapOf(REAL_RESIDUE, REAL_LOAD)
  const good = surfaces(s)
  const was = ui.RESIDUE_KINDS['clean-integrated']
  ui.RESIDUE_KINDS['clean-integrated'] = 'judge'
  try {
    const bad = surfaces(s)
    expect(residueTally(s.detail.residue!).judgeCount).toBe(3)
    expect(bad.nowRow).not.toEqual(good.nowRow)
    expect(bad.band).not.toEqual(good.band)
  } finally { ui.RESIDUE_KINDS['clean-integrated'] = was }
  expect(surfaces(s)).toEqual(good)
})
test('counts: nothing to judge but something to clear marks no tab and draws no 現況 row and no ⚑; 現況 summary still says how many can go', () => {
  const only = { ...REAL_RESIDUE, needs_human_count: 2, needs_human: REAL_RESIDUE.needs_human.slice(1), needs_human_bytes: 328626176 }
  const s = snapOf(only, REAL_LOAD)
  const sf = surfaces(s)
  expect(sf).toEqual({ tabName: false, nowRow: null, band: null })
  const sum = texts(nowLines(s, ctxOf(ZH, 76))).find(l => l.startsWith('殘留'))
  expect(sum).toContain('2 個可清')
  expect(sum).not.toContain('要你看')
  expect(sum).toContain('313 MB')
  const withJudge = texts(nowLines(snapOf(REAL_RESIDUE, REAL_LOAD), ctxOf(ZH, 76))).find(l => l.startsWith('殘留'))
  expect(withJudge).toContain('1 個要你看 · 2 個可清 · 598 MB')
  const en = texts(nowLines(snapOf(REAL_RESIDUE, REAL_LOAD), ctxOf(EN, 76))).find(l => l.startsWith('Hygiene'))
  expect(en).toContain('1 to look at · 2 to clear · 598 MB')
})
test('counts: the band without a watcher scope reads the same judge count from the auto-reap result file', () => {
  const file = (entries: object[], n: number) => JSON.stringify({ schema: 'autopilot.residue-auto/1', needs_human_count: n, needs_human: entries })
  expect(autoResidueCount(file(REAL_RESIDUE.needs_human, 3))).toBe(1)
  expect(autoResidueCount(file([], 4))).toBe(4) // a count the list does not show is counted as yours: the safe side
  expect(autoResidueCount(file(REAL_RESIDUE.needs_human.slice(1), 2))).toBe(0)
})
test('counts: a producer list cut at 20 keeps the unlisted rest as yours to judge and says so', () => {
  const many = Array.from({ length: 20 }, (_, i) => entry({ class: 'clean-integrated', path: '/w/c' + i, bytes: null }))
  const s = snapOf(resWith(many, { needs_human_count: 25 }), null)
  expect(residueTally(s.detail.residue!).judgeCount).toBe(5)
  expect(hyg(s).some(l => l.includes('還有 5 項沒列出'))).toBe(true)
})

test('name: the last path segment, whole; too long, it loses its tail (never its head)', () => {
  const long = 'agent-' + 'abcdef0123456789'.repeat(6)
  const s = snapOf(resWith([entry({ path: '/w/' + long, bytes: 1048576, command: null }), entry({ path: '/w/short', class: 'live' }), entry({ path: '/w/ok-name', age_days: 3, bytes: null, command: null })]), null)
  const out = hyg(s, ZH, 76)
  const row = out.find(l => l.startsWith('▲ agent-'))!
  expect(ui.displayWidth(row)).toBeLessThanOrEqual(75)
  expect(row).toContain('…')
  expect(row.startsWith('▲ agent-abcdef')).toBe(true)
  expect(row.includes(long)).toBe(false)
  expect(row.endsWith('2d00h · 1.0 MB')).toBe(true)
  expect(out.some(l => l.startsWith('▲ ok-name') && l.endsWith('3d00h'))).toBe(true)
  // a branch is named by the branch, whole
  const b = hyg(snapOf(resWith([entry({ kind: 'branch', path: undefined, branch: 'feature/some-branch', class: 'unintegrated-branch', bytes: null })]), null))
  expect(b.some(l => l.startsWith('▲ feature/some-branch'))).toBe(true)
  // control: a head cut would lose the start of the name
  expect(row.startsWith('▲ …')).toBe(false)
})

const REASONS: [string, string, string][] = [
  ['dirty', '有 1349 個檔案沒提交，先看內容再決定要不要刪', '1349 files not committed; look before deciding to delete'],
  ['clean-unintegrated', '沒有沒提交的檔案，但還沒合併；確定不要了才刪', 'nothing uncommitted, but not merged; delete only if you are sure'],
  ['unintegrated-branch', '分支還沒合併；確定不要了才刪', 'branch not merged; delete only if you are sure'],
  ['unverifiable', '無法確認狀態，先看一下', 'could not verify its state; take a look'],
  ['clean-integrated', '已合併，可以刪', 'merged, safe to delete'],
  ['missing-dir', '目錄已經不見了，清掉紀錄就好', 'the directory is gone; just clear the record'],
]
test('reason: every class has its sentence in both locales, never the producer English', () => {
  for (const [cls, zh, en] of REASONS) {
    const s = snapOf(resWith([entry({ class: cls, reason: '1349 uncommitted path(s)' })]), null)
    expect(hyg(s, ZH), cls + ' zh').toContain('  ' + zh)
    expect(hyg(s, EN), cls + ' en').toContain('  ' + en)
    expect(hyg(s, ZH).join('\n'), cls + ' raw').not.toContain('uncommitted path(s)')
  }
  // control: a reason shown raw would carry the producer's words
  expect(hyg(snapOf(resWith([entry({ class: 'who-knows', reason: '1349 uncommitted path(s)' })]), null)).join('\n')).toContain('uncommitted path(s)')
})
test('reason: dirty takes its number from the reason, and says so without one', () => {
  expect(hyg(snapOf(resWith([entry({ reason: '7 uncommitted path(s)' })]), null))).toContain('  有 7 個檔案沒提交，先看內容再決定要不要刪')
  expect(hyg(snapOf(resWith([entry({ reason: 'weird' })]), null))).toContain('  有沒提交的檔案，先看內容再決定要不要刪')
  expect(hyg(snapOf(resWith([entry({ reason: null })]), null))).toContain('  有沒提交的檔案，先看內容再決定要不要刪')
})
test('reason: a class nobody mapped is yours to judge, with the class and the producer words, and its mark is the unknown one', () => {
  for (const [loc, t] of [['zh', ZH], ['en', EN]] as const) {
    const out = hyg(snapOf(resWith([entry({ class: 'weird-class', reason: 'producer words' })]), null), t)
    expect(out.some(l => l.includes('weird-class')), loc).toBe(true)
    expect(out.includes('  producer words'), loc).toBe(true)
    expect(out.some(l => l.startsWith(ui.STATES.unknown.glyph + ' wt-a')), loc).toBe(true)
    expect(out.some(l => l.startsWith(t('hygiene.need_you') ? '▾ ' + t('hygiene.need_you') : '')), loc).toBe(true)
  }
})

test('command: shown as the producer wrote it, `$` first, wrapped and never cut; no command, no line', () => {
  const out = hyg(snapOf(REAL_RESIDUE, REAL_LOAD))
  const at = out.findIndex(l => l.startsWith('  $ git -C '))
  expect(out.slice(at, at + 2).map(l => l.trim()).join('').replace(/\s/g, '').includes("git-C'/home/cookys/projects/autopilot/.claude/worktrees/agent-a16d390b66014e3cf'status--short".replace(/\s/g, ''))).toBe(true)
  for (const l of out) expect(ui.displayWidth(l)).toBeLessThanOrEqual(75)
  const none = hyg(snapOf(resWith([entry({ command: null })]), null))
  expect(none.some(l => l.includes('$'))).toBe(false)
  // control: the same entry with a command does draw one
  expect(hyg(snapOf(resWith([entry({ command: 'git status' })]), null)).some(l => l === '  $ git status')).toBe(true)
})

test('more than 5: five entries per section, the rest behind the `more` row that opens them', () => {
  const many = Array.from({ length: 7 }, (_, i) => entry({ path: '/w/wt-' + i, age_days: i + 1, class: 'clean-integrated', command: null }))
  const s = snapOf(resWith(many), null)
  const shown = (out: string[]) => out.filter(l => l.startsWith('◦ wt-')).length
  const closed = hyg(s)
  expect(shown(closed)).toBe(5)
  expect(closed.some(l => /^ +▸ 還有 2 項/.test(l))).toBe(true)
  expect(closed.some(l => l.startsWith('▾ 可以直接清掉  7'))).toBe(true)
  const open = hyg(s, ZH, 76, ['more:residue.cleanable'])
  expect(shown(open)).toBe(7)
  expect(open.some(l => /^ +▾ 收起/.test(l))).toBe(true)
  // the judge section has its own cap
  const judge = Array.from({ length: 6 }, (_, i) => entry({ path: '/w/j-' + i, command: null }))
  expect(hyg(snapOf(resWith(judge), null)).filter(l => l.startsWith('▲ j-')).length).toBe(5)
})

test('empty sections: nothing to judge keeps the empty line, nothing to clear draws no section at all', () => {
  const judgeOnly = hyg(snapOf(resWith([entry({})]), null))
  expect(judgeOnly.some(l => l.startsWith('▾ 可以直接清掉'))).toBe(false)
  const cleanOnly = hyg(snapOf(resWith([entry({ class: 'clean-integrated' })]), null))
  expect(cleanOnly.some(l => l.startsWith('▾ 要你處理'))).toBe(true)
  expect(cleanOnly).toContain('— 沒有需要手動清理的項目')
  expect(cleanOnly.some(l => l.startsWith('▾ 可以直接清掉'))).toBe(true)
  const order = hyg(snapOf(REAL_RESIDUE, REAL_LOAD)).filter(l => /^▾ /.test(l)).map(l => l.split(/\s/)[1])
  expect(order).toEqual(['要你處理', '可以直接清掉', '自動清理', '外掛來源'])
})

test('auto cleanup: a kv row with the last run and what it did, or that it never ran; no ∅ mark', () => {
  const at = (r: object) => hyg(snapOf(r, null)).filter(l => l.startsWith('上次'))
  expect(at(REAL_RESIDUE)).toEqual(['上次        23h51m 前 · 沒有清掉東西'])
  expect(at({ ...REAL_RESIDUE, auto_removed_count: 2, auto_archived_count: 1 })).toEqual(['上次        23h51m 前 · 刪了 2 個 worktree、封存 1 條分支'])
  expect(at({ ...REAL_RESIDUE, auto_ran_at: null })).toEqual(['上次        還沒跑過'])
  expect(hyg(snapOf({ ...REAL_RESIDUE, auto_removed_count: 2 }, null), EN).filter(l => l.startsWith('last run'))).toEqual(['last run    23h51m ago · removed 2 worktrees, archived 0 branches'])
  for (const r of [REAL_RESIDUE, { ...REAL_RESIDUE, auto_ran_at: null }]) expect(hyg(snapOf(r, null)).join('\n')).not.toContain('∅')
})

// the state mark of the source row: ▲ only when the owner would really run the wrong copy
const sourceRows = (ls: object, t: typeof ZH = ZH): string[] => { const o = hyg(snapOf(REAL_RESIDUE, ls), t); return o.slice(o.findIndex(l => /^[▾▸] (外掛來源|Plugin source)/.test(l))) }
test('plugin source: only stale cache dirs is fine (✓) with the sentence and the delete command; no chip on the header', () => {
  const out = sourceRows(REAL_LOAD)
  expect(out[0]).toMatch(/^▾ 外掛來源 ─+$/)
  expect(out[1]).toBe('✓ 開發目錄 · /home/cookys/projects/autopilot · v3.0.0-alpha.6')
  expect(out[2]).toBe('  舊版快取 2.36.36 沒有程式在用，可以刪')
  expect(out[3]).toBe('  $ rm -rf /home/cookys/.claude/plugins/cache/autopilot/autopilot/2.36.36/')
  expect(out.length).toBe(4)
  expect(out.join('\n')).not.toContain('▲')
  // a copy a live program still uses: the sentence names the pid and offers no delete
  const busy = sourceRows({ ...REAL_LOAD, stale_cache_dirs: [{ dir: '/c/2.36.36', in_use_pids: ['1'], alive: ['4242'] }] })
  expect(busy[2]).toBe('  舊版快取 2.36.36 還有程式在用（pid 4242），先不要刪')
  expect(busy.some(l => l.includes('rm -rf'))).toBe(false)
  expect(sourceRows(REAL_LOAD, EN)[2]).toBe('  old cache 2.36.36 is not used by any program; safe to delete')
})
test('plugin source: negative control, every flag that really misleads is ▲ and says what to do; a stale-only flag set must not be', () => {
  const stateOf = (ls: object) => sourceRows(ls)[1].slice(0, 1)
  expect(stateOf(REAL_LOAD)).toBe('✓')
  for (const f of ['marketplace_not_directory', 'marketplace_not_this_repo', 'dev_link_missing_or_stale']) expect(stateOf({ ...REAL_LOAD, flags: [f] }), f).toBe('▲')
  expect(stateOf({ ...REAL_LOAD, behind_upstream: 2 })).toBe('▲')
  expect(stateOf({ ...REAL_LOAD, source: 'cache:2.36.36' })).toBe('▲')
  expect(stateOf({ ...REAL_LOAD, source: 'unknown' })).toBe('▲')
  expect(stateOf({ ...REAL_LOAD, flags: ['stale_cache_dirs', 'some_new_flag'] })).toBe('✓')
})
test('plugin source: a sentence per flag, the fix command from the marketplace path (never a fixed home), the rest in the producer words', () => {
  const mk = sourceRows({ ...REAL_LOAD, marketplace: 'github', flags: ['marketplace_not_directory', 'marketplace_not_this_repo'], stale_cache_dirs: [] })
  expect(mk.slice(2)).toEqual(['  市集不是指向這個 repo 的目錄，/reload-plugins 可能載到舊版', '  $ bash /home/cookys/projects/autopilot/scripts/dev-setup.sh'])
  const link = sourceRows({ ...REAL_LOAD, flags: ['dev_link_missing_or_stale'], stale_cache_dirs: [], marketplace_path: '/srv/other/repo' })
  expect(link.slice(2)).toEqual(['  開發連結不見了或過期', '  $ bash /srv/other/repo/scripts/dev-setup.sh'])
  expect(sourceRows({ ...REAL_LOAD, flags: ['dev_link_missing_or_stale'], stale_cache_dirs: [], marketplace_path: null }).slice(2)).toEqual(['  開發連結不見了或過期']) // no path, no command
  expect(sourceRows({ ...REAL_LOAD, flags: [], stale_cache_dirs: [], behind_upstream: 3 }).slice(1)).toEqual(['▲ 開發目錄 · /home/cookys/projects/autopilot · v3.0.0-alpha.6', '  落後遠端 3 個提交'])
  expect(sourceRows({ ...REAL_LOAD, flags: ['mystery'], stale_cache_dirs: [] }).slice(2)).toEqual(['  其他旗標：mystery'])
  expect(sourceRows({ ...REAL_LOAD, source: 'cache:2.36.36', flags: [], stale_cache_dirs: [] })[1]).toBe('▲ 快取版 2.36.36')
  expect(sourceRows({ ...REAL_LOAD, source: 'unknown', flags: [], stale_cache_dirs: [], plugin_version: null })[1]).toBe('▲ 讀不到外掛來源')
})

test('invariants: I1-I8 and I10 hold on the new tab for the real data in both locales at 40-160 columns', () => {
  for (const [loc, t] of [['zh', ZH], ['en', EN]] as const) for (const cols of [40, 60, 76, 120, 160]) {
    const lines = hygieneTabLines(snapOf(REAL_RESIDUE, REAL_LOAD), ctxOf(t, cols))
    const v = violations(lines, cols, t)
    expect(v, loc + ' ' + cols).toEqual([])
  }
  // control: a hand-made line is flagged by the same checker
  const lines = hygieneTabLines(snapOf(REAL_RESIDUE, REAL_LOAD), ctxOf(ZH, 76))
  expect(violations([...lines, { text: 'by hand', fact: 'residue.groups' } as never], 76, ZH).some(x => x.includes('I2'))).toBe(true)
  void stripOf
})

const GOLDEN_ZH_76: string[] = [
  "▾ 要你處理  1 · 285 MB ────────────────────────────────────────────────────",
  "▲ agent-a16d390b66014e3cf                                    1d04h · 285 MB",
  "  有 1349 個檔案沒提交，先看內容再決定要不要刪",
  "  $ git -C '/home/cookys/projects/autopilot/.claude/worktrees/",
  "    agent-a16d390b66014e3cf' status --short",
  "▾ 可以直接清掉  2 · 313 MB ────────────────────────────────────────────────",
  "◦ lane-loadsrc                                                           0s",
  "  已合併，可以刪",
  "  $ git -C '/home/cookys/projects/autopilot' worktree remove '/home/cookys/",
  "    projects/autopilot/.claude/worktrees/lane-loadsrc'",
  "◦ release-3.0.0                                              4d12h · 313 MB",
  "  已合併，可以刪",
  "  $ git -C '/home/cookys/projects/autopilot' worktree remove '/home/cookys/",
  "    projects/autopilot/.claude/worktrees/release-3.0.0'",
  "▾ 自動清理 ────────────────────────────────────────────────────────────────",
  "上次        23h51m 前 · 沒有清掉東西",
  "▾ 外掛來源 ────────────────────────────────────────────────────────────────",
  "✓ 開發目錄 · /home/cookys/projects/autopilot · v3.0.0-alpha.6",
  "  舊版快取 2.36.36 沒有程式在用，可以刪",
  "  $ rm -rf /home/cookys/.claude/plugins/cache/autopilot/autopilot/2.36.36/",
]

test('tab name: 殘留 turns yellow when the 外掛來源 row shows ▲ even with nothing to judge, and not for an old cache copy alone', () => {
  const clean = resWith([entry({ class: 'clean-integrated', reason: 'HEAD is an ancestor of the integration ref' })])
  expect(tabNeeds(snapOf(clean, REAL_LOAD)).hygiene).toBeUndefined() // only stale_cache_dirs: information, not a request
  for (const bad of [
    { ...REAL_LOAD, flags: ['marketplace_not_directory'], marketplace: 'git' },
    { ...REAL_LOAD, flags: ['dev_link_missing_or_stale'] },
    { ...REAL_LOAD, behind_upstream: 3 },
    { ...REAL_LOAD, source: 'unknown', flags: [] },
  ]) {
    expect(tabNeeds(snapOf(clean, bad)).hygiene, JSON.stringify(bad.flags) + ' ' + bad.source + ' ' + bad.behind_upstream).toEqual({})
    expect(hyg(snapOf(clean, bad)).some(l => l.startsWith('▲ ')), 'the row shows ▲ too').toBe(true)
  }
})

test('order: newest first within a section; entries with no age go last and keep their published order', () => {
  const es = [entry({ path: '/w/no-age-a', age_days: null }), entry({ path: '/w/no-age-b', age_days: null }), entry({ path: '/w/old', age_days: 3 }), entry({ path: '/w/new', age_days: 1 })]
  const names = hyg(snapOf(resWith(es), REAL_LOAD)).filter(l => l.startsWith('▲ ')).map(l => l.slice(2).trim().split(/\s+/)[0])
  expect(names).toEqual(['new', 'old', 'no-age-a', 'no-age-b'])
})

// ---- cleanup buttons (design plan §12.9): a surface with buttons draws `[ 清掉 ]` per clearable worktree and one `全部清掉` for the section; no command under a clearable entry ----
const withButtons = (s: LiveSnapshot, clean: Record<string, { ok: boolean; note: string }> = {}): PaneLine[] =>
  hygieneTabLines(s, { ...ctxOf(ZH), decide: { picks: {}, notes: {}, sent: {}, clean, inputs: true } })
const pressIds = (ls: PaneLine[]): string[] => ls.flatMap(l => (l.segs ?? []).flatMap(g => (g.press === undefined ? [] : [g.press])))
const DIRTY_PATH = 'agent-a16d390b66014e3cf'
test('cleanup buttons: one per clearable worktree plus one for all of them, in the action colour; the entry to judge has none; no command under a clearable entry', () => {
  const ls = withButtons(snapOf(REAL_RESIDUE, REAL_LOAD))
  const out = texts(ls)
  const from = out.findIndex(l => l.startsWith('▾ 可以直接清掉'))
  const clean = out.slice(from, out.findIndex(l => l.startsWith('▾ 自動清理')))
  expect(out[0]).toBe('  [ 全部清掉（3 項） ]') // the tab's first row, always the same place; counts the unused cache copy too, and has no size because a cache copy has none
  expect(clean.some(l => l.includes('全部清掉'))).toBe(false)
  expect(clean.filter(l => l === '  [ 清掉 ]').length).toBe(2)
  expect(clean.some(l => l.startsWith('  $ ') || l.includes('worktree remove'))).toBe(false)
  const ids = pressIds(ls)
  expect(ids.length).toBe(4) // all + two worktrees + the unused cache copy
  expect(ids.some(i => i.endsWith('/2.36.36'))).toBe(true)
  expect(out.some(l => l.includes('rm -rf')), 'the cache copy has a button, not a command').toBe(false)
  expect(ids.filter(i => i === 'clean:all').length).toBe(1)
  expect(ids.some(i => i.includes(DIRTY_PATH))).toBe(false)
  for (const g of ls.flatMap(l => l.segs ?? []).filter(g => g.press !== undefined)) expect(g.color).toBe(ui.PALETTE.action)
  expect(out.filter(l => l.startsWith('  $ ')).length, 'the entry to judge keeps its command').toBeGreaterThan(0)
  // a surface without buttons keeps the commands
  expect(hyg(snapOf(REAL_RESIDUE, REAL_LOAD))).toEqual(GOLDEN_ZH_76)
})
test('busy: a worktree class `busy` (a process uses it) is dropped before any panel row, count or button exists; the same entry as clean-integrated is drawn', () => {
  const busy = entry({ class: 'busy', path: '/w/hub-app', reason: 'in use by pid 7 (cwd: /w/hub-app)', command: null })
  const free = entry({ class: 'clean-integrated', path: '/w/hub-app', command: null })
  const view = (e: object) => readResidue(JSON.stringify(resWith([e])), KEY)!
  expect(view(busy).needs_human.length).toBe(0)
  expect(view(busy).needs_human_count).toBe(0)
  const rows = (e: object): string[] => hyg(snapOf(resWith([e]), null))
  expect(rows(busy).some(l => l.includes('hub-app'))).toBe(false)
  expect(pressIds(withButtons(snapOf(resWith([busy]), null))).some(i => i.includes('/w/hub-app'))).toBe(false)
  expect(cleanTargets(snapOf(resWith([busy]), null).detail).worktrees.length).toBe(0)
  // negative control: the identical entry classed clean-integrated is drawn, counted and offered a button
  expect(view(free).needs_human.length).toBe(1)
  expect(rows(free).some(l => l.includes('hub-app'))).toBe(true)
  expect(pressIds(withButtons(snapOf(resWith([free]), null))).some(i => i === 'clean:/w/hub-app')).toBe(true)
})
test('cleanup buttons: with no 待決 card at all the buttons are still drawn and no command is printed under a clearable entry (2026-10-16 report); a surface without the decide view prints them', () => {
  const s = snapOf(REAL_RESIDUE, REAL_LOAD)
  expect(s.pending.length).toBe(0)
  const clean = (ls: PaneLine[]): string[] => { const o = texts(ls); return o.slice(o.findIndex(l => l.startsWith('▾ 可以直接清掉')), o.findIndex(l => l.startsWith('▾ 自動清理'))) }
  const on = clean(withButtons(s))
  expect(on.filter(l => l === '  [ 清掉 ]').length).toBe(2)
  expect(on.some(l => l.includes('$ '))).toBe(false)
  const off = clean(hygieneTabLines(s, ctxOf(ZH)))
  expect(off.some(l => l.includes('worktree remove')), 'negative control: no decide view means the old command rows').toBe(true)
})
test('cleanup buttons: a failed press can be pressed again, and the batch button counts it again', () => {
  const s = snapOf(REAL_RESIDUE, REAL_LOAD)
  const paths = residueTally(s.detail.residue!).clean.map(e => e.target)
  const failed = texts(withButtons(s, Object.fromEntries(paths.map(p => [p, { ok: false, note: 'busy' }]))))
  expect(failed.filter(l => l === '  [ 清掉 ]').length, 'a retry button under each of the two failures, plus the untouched cache copy').toBe(3)
  expect(failed[0]).toBe('  [ 全部清掉（3 項） ]')
  expect(cleanTargets(s.detail, { [paths[0]]: { ok: false, note: 'busy' } }).worktrees.length).toBe(2)
  expect(cleanTargets(s.detail, { [paths[0]]: { ok: true, note: '' } }).worktrees.length).toBe(1)
})
test('cleanup buttons: negative control, a judged class listed as clearable gets a button (the safety assertion above would be red)', () => {
  const s = snapOf(REAL_RESIDUE, REAL_LOAD)
  expect(pressIds(withButtons(s)).some(i => i.includes(DIRTY_PATH))).toBe(false)
  const was = ui.RESIDUE_KINDS.dirty
  ui.RESIDUE_KINDS.dirty = 'clean'
  try { expect(pressIds(withButtons(s)).some(i => i.includes(DIRTY_PATH))).toBe(true) } finally { ui.RESIDUE_KINDS.dirty = was }
})
test('cleanup buttons: after a press the entry says cleared, or why not and then the command; the batch button leaves with the last button', () => {
  const s = snapOf(REAL_RESIDUE, REAL_LOAD)
  const paths = residueTally(s.detail.residue!).clean.map(e => e.target)
  const one = texts(withButtons(s, { [paths[0]]: { ok: true, note: '' } }))
  expect(one).toContain('  已清掉')
  expect(one.filter(l => l === '  [ 清掉 ]').length).toBe(2) // the other worktree and the cache copy
  expect(one[0]).toBe('  [ 全部清掉（2 項） ]')
  const noCache = texts(hygieneTabLines(snapOf(resWith([entry({ class: 'clean-integrated', path: '/w/a', bytes: 1048576 }), entry({ class: 'clean-integrated', path: '/w/b', bytes: 2097152 })]), null), { ...ctxOf(ZH), decide: { picks: {}, notes: {}, sent: {}, clean: {}, inputs: true } }))
  expect(noCache[0]).toBe('  [ 全部清掉（2 項 · 3.0 MB） ]') // worktrees only, all sized: the sum of the two entries (one without a size would leave the count alone)
  const failed = texts(withButtons(s, { [paths[1]]: { ok: false, note: 'busy' } }))
  const at = failed.findIndex(l => l.startsWith('  沒清掉：busy'))
  expect(at).toBeGreaterThan(0)
  expect(failed[at + 1].startsWith('  $ git -C')).toBe(true)
  const both = texts(withButtons(s, Object.fromEntries([...paths, '/home/cookys/.claude/plugins/cache/autopilot/autopilot/2.36.36'].map(p => [p, { ok: true, note: '' }]))))
  expect(both.filter(l => l === '  已清掉').length).toBe(3)
  expect(both.some(l => l.includes('全部清掉'))).toBe(false)
})
