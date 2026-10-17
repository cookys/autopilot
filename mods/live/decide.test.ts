// mods/live/decide.test.ts — the 待決 (Decide) tab, pure half: the cards, the choice and field rows, the send row, the badge and the reply text.
// The mounted half (press an option, type a note, send, the sent state, a phone without Input) is in live.test.ts ("DECIDE mounted ...").
// Run through `bash mods/live/run-tests.sh` (a wrapper plugin named `autopilot`); the new assertions here were red on the tree before the tab existed.
import { test, expect } from 'claude-code/testing'
import { makeT } from './i18n'
import { DECIDE_REPLY_HEAD, NO_DECIDE, NO_DETAIL, NO_SECTIONS, decideLine, decideReply, recommendedIndex } from './model'
import type { DecideView, LiveDecision, LiveSnapshot, PaneLine } from './model'
import { decideTabLines, nowLines, stripOf, tabNeeds } from './tabs'
import * as ui from './ui'
import { violations } from './invariants.testkit'

const LOCALES = [['zh-TW', makeT('zh-TW')], ['en', makeT('en')]] as const
const dec = (id: string | null, question: string, over: Partial<LiveDecision> = {}): LiveDecision => ({
  id, question, background: null, options: [], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 60, orphaned: false, origin: null, ...over,
})
const OPT = (label: string, description = ''): { label: string; description: string } => ({ label, description })
const THREE = [
  dec('d-4290499d', 'P5 殘留分頁要不要把已清掉的也列出來', { background: '殘留分頁現在只列要人處理的；已清掉的在自動清理那段只有數字。', options: [OPT('OK', '照現況'), OPT('完整顯示', '全列出來')], recommendation: 'OK', blocks: '下一個派工' }),
  dec('d-c24ecfd9', 'U6 要不要把建議也寫進回覆', { options: [OPT('要'), OPT('不要')] }),
  dec('d-0000free', '這個分支要叫什麼名字？'),
]
const snapOf = (pending: LiveDecision[]): LiveSnapshot => ({
  state: 'ok', text: '', header: 'h', metrics: { ctx: '37%' },
  band: { kind: 'decide', key: 'warning', why: 'r', verdictReason: null, mark: '▲', verdict: 'v', head: '', progress: '—', progressDim: false, reason: null, project: 'repo', elapsed: '10m', phase: '—', slots: [] },
  pending, project_key: null, root_run_id: null, link: null, rows: [], gates: null, sections: NO_SECTIONS, review: null, published_at: null, session_as_of: null, host_as_of: null,
  detail: { ...NO_DETAIL, now_ms: 1, counts: { confirmed_live: 0, exited: 0, unknown: 0 } },
  activity: [], recent: [],
}) as never
const view = (over: Partial<DecideView> = {}): DecideView => ({ ...NO_DECIDE, inputs: true, ...over })
const ctxOf = (t: ReturnType<typeof makeT>, cols: number, decide?: DecideView) => ({ t, cols, expanded: new Set<string>(), folded: new Set<string>(), ...(decide === undefined ? {} : { decide }) })
const texts = (ls: PaneLine[]): string[] => ls.map(l => l.text.trimEnd())
const pressIds = (ls: PaneLine[]): string[] => ls.flatMap(l => [...new Set((l.segs ?? []).flatMap(s => (s.press === undefined ? [] : [s.press])))])

test('DECIDE card: a section header with the count, then per question the title, 背景 → 卡住 → 選項 → 建議 → 補充 in the key/value grammar (key at column 2, value at column 12), a blank between cards, the send row last', () => {
  const zh = makeT('zh-TW')
  const ls = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view()))
  const t = texts(ls)
  expect(ls[0].kind).toBe('header')
  expect(t[0]).toMatch(/^▾ 待你回答  3 ─+$/) // the section header every other tab has, the count on its right
  expect(ui.displayWidth(ls[0].text)).toBe(75)
  expect(t[1]).toBe('▲ 1. P5 殘留分頁要不要把已清掉的也列出來')
  const at = (prefix: string, from = 0): number => t.findIndex((x, i) => i >= from && x.startsWith(prefix))
  const bg = at('  背景      殘留分頁現在只列要人處理的')
  const blocks = at('  卡住      下一個派工')
  const row = ls.findIndex(l => l.kind === 'choice' && l.text.includes('[ ]'))
  const advice = at('  建議      ')
  const note = ls.findIndex(l => l.field !== undefined && l.field.key === 'note:d-4290499d')
  expect(bg).toBe(2)
  expect([bg < blocks, blocks < row, row < advice, advice < note], 'the order is 背景, 卡住, 選項, 建議, 補充').toEqual([true, true, true, true])
  expect(t[row]).toBe('  選項      [ ] ★ OK  [ ] 完整顯示') // one row; the star marks the recommendation, on the option only
  expect(ls[row].segs?.filter(s => s.role === 'glyph').map(s => s.text)).toEqual([ui.GLYPHS.structure.recommend])
  expect(pressIds([ls[row]])).toEqual(['pick:d-4290499d:0', 'pick:d-4290499d:1'])
  expect(t[advice]).toBe('  建議      OK') // no reason given: the recommended option alone
  expect(t[note]).toBe('  補充')
  expect(ls[note].field?.placeholder).toBe('選填，可留空')
  expect(ls[note].segs?.[1].text).toBe('補充      ') // the key slot is 10 cells: the field starts at column 12
  // every value row hangs at column 12
  for (const l of ls.filter(x => x.kind === 'kv')) expect(l.hang).toBe(12)
  // the second card is numbered 2 and has its own row; the third has no options, so it asks for a typed reply
  expect(t.some(x => x === '▲ 2. U6 要不要把建議也寫進回覆')).toBe(true)
  expect(t.some(x => x === '  選項      [ ] 要  [ ] 不要')).toBe(true)
  expect(t.some(x => x === '▲ 3. 這個分支要叫什麼名字？')).toBe(true)
  const free = ls.find(l => l.field !== undefined && l.field.key === 'note:d-0000free')
  expect(free?.text.trim()).toBe('回覆')
  expect(free?.field?.placeholder).toBe('請輸入你的回答')
  // a blank line after every card (drawn: pane.tsx gives it a row), none before the first title or between a title and its rows
  expect(ls.filter(l => l.kind === 'blank').length).toBe(3)
  expect(ls.map((l, i) => (l.kind === 'blank' ? i : -1)).filter(i => i >= 0).every(i => ls[i + 1].kind === 'item' || ls[i + 1].kind === 'choice')).toBe(true)
  expect(ls[1].kind).toBe('item')
  // the send row is last and is inert while nothing is chosen; it says where the answers go
  const last = ls[ls.length - 1]
  expect(last.text.trim()).toBe('[ 送出（已選 0/3） ]  答案會貼進這個對話送出')
  expect(pressIds([last])).toEqual([])
  expect(last.segs?.find(s => s.text.includes('答案會貼進'))?.dim).toBe(true)
  // a card is not a screenful: three cards of this kind fit well under a page
  expect(ls.length).toBeLessThan(28)
})

test('DECIDE title: the question is bold default text, wraps from column 2 and is never repeated; the glyph keeps the attention colour; a sent title is plain (negative controls)', () => {
  const zh = makeT('zh-TW')
  const q = '這個題目非常長所以一行放不下它必須換行而且續行要從第二欄開始不能再用角落符號把整題重複一次'
  const ls = decideTabLines(snapOf([dec('d-long', q, { options: [OPT('甲'), OPT('乙')] })]), ctxOf(zh, 40, view()))
  const titles = ls.filter(l => l.kind === 'item')
  expect(titles.length).toBeGreaterThanOrEqual(3)
  expect(titles[0].text.startsWith('▲ 1. ')).toBe(true)
  for (const l of titles.slice(1)) expect(l.text.startsWith('  ') && !l.text.startsWith('   ')).toBe(true) // continuation lines start at column 2
  expect(titles.map(l => l.text.slice(2)).join('').replace('1. ', '')).toBe(q) // the whole question once, in order
  expect(ls.some(l => l.text.includes(ui.GLYPHS.structure.detail)), 'no └ copy of the question').toBe(false)
  expect(ls.filter(l => l.text.includes('這個題目非常長')).length).toBe(1)
  for (const l of titles) for (const s of (l.segs ?? []).filter(x => x.role === 'title')) { expect(s.bold).toBe(true); expect(s.color).toBeUndefined(); expect(ui.boldUseOf(l, s)).toBe('question title') }
  expect(titles[0].segs?.find(s => s.role === 'glyph')?.color).toBe(ui.PALETTE.attention)
  expect(titles[0].segs?.find(s => s.role === 'glyph')?.bold).toBeUndefined()
  // a sent question is not bold: the bold title is the thing that still waits for you
  const sent = decideTabLines(snapOf([dec('d-long', q, { options: [OPT('甲'), OPT('乙')] })]), ctxOf(zh, 40, view({ sent: { 'd-long': 1 } })))
  expect(sent.filter(l => l.kind === 'item').every(l => (l.segs ?? []).every(s => s.bold !== true))).toBe(true)
  // control 1: the bold title is on the whitelist, and I4 stays clean on the real card
  expect(ui.BOLD_USES).toContain('question title')
  expect(violations(ls, 40, zh).filter(v => v.startsWith('I4'))).toEqual([])
  // control 2: bold on anything that is not a question title is flagged by I4 (a background value, an option key, a title segment that lost its role)
  const bend = (pick: (l: PaneLine) => boolean, edit: (s: any) => unknown): PaneLine[] =>
    decideTabLines(snapOf(THREE), ctxOf(zh, 76, view())).map(l => (pick(l) && l.segs !== undefined ? ui.carry(l, { ...l, segs: l.segs.map(s => (s.text.trim() === '' ? s : (edit(s) as never))) }) : l))
  const real = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view()))
  expect(violations(real, 76, zh).filter(v => v.startsWith('I4'))).toEqual([]) // green side
  expect(violations(bend(l => l.kind === 'kv', s => ({ ...s, bold: true })), 76, zh).some(v => v.startsWith('I4'))).toBe(true)
  expect(violations(bend(l => l.kind === 'item' && l.text.startsWith('▲'), s => (s.role === 'title' ? { ...s, role: 'prose' } : s)), 76, zh).some(v => v.startsWith('I4'))).toBe(true)
  expect(violations(bend(l => l.kind === 'detail' || l.kind === 'empty' || l.kind === 'header', s => ({ ...s, bold: true, role: 'title' })), 76, zh).some(v => v.startsWith('I4'))).toBe(true) // the role alone does not whitelist a non-item line
})

test('DECIDE choose: the picked option is `[x]` in bold default text (no background, no inverse), the others stay plain, the send row counts it and becomes pressable', () => {
  const zh = makeT('zh-TW')
  const ls = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view({ picks: { 'd-4290499d': 1 } })))
  const row = ls.find(l => l.kind === 'choice' && l.text.includes('完整顯示')) as PaneLine
  expect(row.text.trimEnd()).toBe('  選項      [ ] ★ OK  [x] 完整顯示')
  const picked = (row.segs ?? []).filter(s => s.text.includes('完整顯示') || s.text === '[x] ')
  expect(picked.length).toBeGreaterThan(0)
  for (const s of picked) { expect(s.color).toBe(ui.PALETTE.action); expect(s.bold).toBe(true); expect('backgroundColor' in s || 'inverse' in s).toBe(false) } // default text, bold: the picked option is on the bold whitelist
  const desc = ls.find(l => l.text.includes('全列出來')) as PaneLine
  expect(desc.text, 'the picked option shows its description, dim, at column 12').toBe('            全列出來')
  expect(desc.segs?.every(s => s.dim === true || s.text.trim() === '')).toBe(true)
  const last = ls[ls.length - 1]
  expect(last.text.trim()).toBe('[ 送出（已選 1/3） ]  答案會貼進這個對話送出')
  expect(pressIds([last])).toEqual(['submit'])
  // a pick that is no longer one of the options (the list changed under it) counts as no pick
  const stale = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view({ picks: { 'd-4290499d': 7 } })))
  expect(stale[stale.length - 1].text.trim()).toBe('[ 送出（已選 0/3） ]  答案會貼進這個對話送出')
})

test('DECIDE sent: a question already sent says so, draws its options without Buttons and without a field, and the send row stops offering it', () => {
  const zh = makeT('zh-TW')
  const v = view({ picks: { 'd-4290499d': 0 }, sent: { 'd-4290499d': 5 } })
  const ls = decideTabLines(snapOf(THREE), ctxOf(zh, 76, v))
  expect(texts(ls)[1]).toBe('○ 1. P5 殘留分頁要不要把已清掉的也列出來 · 已送出，等處理')
  expect(pressIds(ls).filter(p => p.startsWith('pick:d-4290499d'))).toEqual([])
  expect(ls.some(l => l.field?.key === 'note:d-4290499d')).toBe(false)
  expect(texts(ls).some(x => x === '  選項      [x] ★ OK  [ ] 完整顯示')).toBe(true) // the choice made stays visible
  expect(pressIds(ls).some(p => p.startsWith('pick:d-c24ecfd9'))).toBe(true) // the other questions are still open
  // all sent: nothing left to send
  const all = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view({ sent: { 'd-4290499d': 5, 'd-c24ecfd9': 5, 'd-0000free': 5 } })))
  expect(all[all.length - 1].text.trim()).toBe('[ 全部已送出，等處理 ]')
  expect(pressIds(all)).toEqual([])
})

test('DECIDE phone: with no text field a question without options says to answer in the conversation, and no field line is made at all', () => {
  for (const [loc, t] of LOCALES) {
    const ls = decideTabLines(snapOf(THREE), ctxOf(t, 60, view({ inputs: false })))
    expect(ls.some(l => l.field !== undefined), loc).toBe(false)
    expect(texts(ls).some(x => x === '  ' + t('decide.in_chat')), loc).toBe(true)
    // the option Buttons are still there: a phone can press them
    expect(pressIds(ls).some(p => p.startsWith('pick:d-4290499d')), loc).toBe(true)
  }
})

test('DECIDE none: no question is the section header and one empty line, and no badge; each question adds to the badge', () => {
  for (const [loc, t] of LOCALES) {
    const none = decideTabLines(snapOf([]), ctxOf(t, 76, view()))
    expect(none.map(l => l.kind), loc).toEqual(['header', 'empty']) // the section header stays; the empty line is the one line under it
    expect(none[0].text, loc).toContain(t('decide.title'))
    expect(none[1].text, loc).toContain(t('decide.none'))
    expect(tabNeeds(snapOf([])).decide, loc).toBeUndefined()
    expect(tabNeeds(snapOf(THREE)).decide, loc).toEqual({})
  }
  // the need reaches the strip: the tab name is warning bold, no symbol; no number
  const strip = stripOf(snapOf(THREE), { t: makeT('zh-TW'), cols: 76 }, 'now', true)
  const dtab = strip.tabs.find(x => x.id === 'decide')!
  expect(dtab.label.color).toBe('warning')
  expect(dtab.label.bold).toBe(true)
  expect(strip.rule.map(s => s.text).join('')).not.toMatch(/[▲●⚑]/)
  expect(strip.tabs.map(x => x.id)).toEqual(['now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'legend'])
})

test('DECIDE every invariant: I1-I8 and I10 hold on the tab in both locales, with and without text fields, picked and sent, at 40-160 columns', () => {
  const states: DecideView[] = [view(), view({ inputs: false }), view({ picks: { 'd-4290499d': 0, 'd-c24ecfd9': 1 }, notes: { 'd-0000free': '叫 main' } }), view({ sent: { 'd-4290499d': 1 } })]
  const found = new Set<string>()
  for (const [, t] of LOCALES) for (const cols of [40, 60, 76, 120, 160]) for (const v of states) for (const pending of [THREE, []]) {
    const ls = decideTabLines(snapOf(pending), ctxOf(t, cols, v))
    for (const x of violations(ls, cols, t)) found.add(x.replace(/ line \d+/, ''))
    for (const l of ls) expect(ui.displayWidth(l.text), 'width ' + cols + ': ' + l.text).toBeLessThanOrEqual(cols - 1)
  }
  expect([...found]).toEqual([])
  // control: the checker does flag a background planted on an option segment
  const bent = decideTabLines(snapOf(THREE), ctxOf(makeT('en'), 76, view())).map(l => (l.kind === 'choice' && l.segs !== undefined ? ui.carry(l, { ...l, segs: l.segs.map(s => ({ ...s, backgroundColor: 'red' }) as never) }) : l))
  expect(violations(bent, 76, makeT('en')).some(v => v.startsWith('I6'))).toBe(true)
})

test('DECIDE bold whitelist (I4): only the picked option and the send button may be bold; an unpicked option, the star or a plain segment on a choice line is flagged (negative control)', () => {
  const t = makeT('en')
  const ls = decideTabLines(snapOf(THREE), ctxOf(t, 76, view({ picks: { 'd-4290499d': 1 } })))
  expect(violations(ls, 76, t).filter(v => v.startsWith('I4'))).toEqual([]) // control: the real card (picked option bold, send button bold) is clean
  expect(ls.some(l => l.kind === 'choice' && (l.segs ?? []).some(s => s.bold === true && s.role === 'pick'))).toBe(true)
  expect(ls.some(l => l.kind === 'choice' && (l.segs ?? []).some(s => s.bold === true && s.role === 'send'))).toBe(true)
  // plant: bold on every NON-picked, non-send segment of the option rows (an unpicked option label, the star, the spacing)
  const bent = ls.map(l => (l.kind === 'choice' && l.segs !== undefined ? ui.carry(l, { ...l, segs: l.segs.map(s => (s.role === 'pick' || s.role === 'send' || s.text.trim() === '' ? s : { ...s, bold: true })) }) : l))
  expect(violations(bent, 76, t).some(v => v.startsWith('I4'))).toBe(true)
  // the same bold on a send-role seg that has no press id (a button that cannot be pressed) is flagged too
  const dead = ls.map(l => (l.kind === 'choice' && l.segs !== undefined ? ui.carry(l, { ...l, segs: l.segs.map(s => (s.role === 'send' ? { ...s, press: undefined } : s)) }) : l))
  expect(violations(dead, 76, t).some(v => v.startsWith('I4'))).toBe(true)
  // BOLD_USES is the list I4 reads
  expect(ui.BOLD_USES).toContain('picked option')
})

test('DECIDE owner: the cards are the 待決 tab\'s own fact, and 現況 shows only the one summary row', () => {
  const zh = makeT('zh-TW')
  const cards = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view()))
  for (const l of cards) expect(l.fact === 'pane.chrome' || ui.FACT_OWNER[l.fact] === 'decide', l.text).toBe(true)
  const now = nowLines(snapOf(THREE), ctxOf(zh, 76))
  const rows = now.filter(l => l.fact === 'decide.cards')
  expect(rows.length).toBe(1)
  expect(rows[0].text).toMatch(/^▲ 待決議事項 3 件 +待決 ›$/)
  expect(rows[0].goto).toBe('decide')
  expect(now.length, '現況 with three questions is no longer than with one').toBe(nowLines(snapOf([THREE[0]]), ctxOf(zh, 76)).length)
})

test('DECIDE recommendation: matched to an option by label (equal, or one starts with the other); an unmatched one is written as it is on the 建議 row', () => {
  expect(recommendedIndex(dec('a', 'q', { options: [OPT('OK'), OPT('No')], recommendation: 'ok' }))).toBe(0)
  expect(recommendedIndex(dec('a', 'q', { options: [OPT('OK'), OPT('No')], recommendation: 'No — it is cheaper' }))).toBe(1)
  expect(recommendedIndex(dec('a', 'q', { options: [OPT('OK'), OPT('No')], recommendation: 'something else' }))).toBe(null)
  expect(recommendedIndex(dec('a', 'q', { options: [OPT('OK')], recommendation: null }))).toBe(null)
  const zh = makeT('zh-TW')
  const ls = decideTabLines(snapOf([dec('d-1', 'q?', { options: [OPT('甲'), OPT('乙')], recommendation: '先做丙' })]), ctxOf(zh, 76, view()))
  expect(ls.some(l => l.text.includes('★'))).toBe(false)
  expect(texts(ls).some(x => x === '  建議      先做丙')).toBe(true)
})

test('DECIDE send note: the button says where the answers go, in both locales; on a narrow pane the note takes the line below; a folded section is only its header (negative controls)', () => {
  for (const [loc, t] of LOCALES) {
    const wide = decideTabLines(snapOf(THREE), ctxOf(t, 76, view()))
    const row = wide[wide.length - 1]
    expect(row.text.trim(), loc).toBe('[ ' + t('decide.submit', { n: 0, total: 3 }) + ' ]  ' + t('decide.submit_note'))
    expect(row.segs?.some(s => s.dim === true && s.text === t('decide.submit_note')), loc).toBe(true)
    const narrow = decideTabLines(snapOf(THREE), ctxOf(t, 36, view()))
    const btn = narrow.findIndex(l => l.kind === 'choice' && l.text.includes('[ ' + t('decide.submit', { n: 0, total: 3 }) + ' ]'))
    expect(btn, loc).toBeGreaterThan(0)
    expect(narrow[btn].text.trim(), loc).toBe('[ ' + t('decide.submit', { n: 0, total: 3 }) + ' ]') // the note did not fit beside it
    expect(narrow.slice(btn + 1).map(l => l.text.trim()).join(' '), loc).toBe(t('decide.submit_note')) // it is wrapped below, at column 2
    for (const l of narrow) expect(ui.displayWidth(l.text), l.text).toBeLessThanOrEqual(35)
    // the pressable form keeps its press id and its note
    const pick = decideTabLines(snapOf(THREE), ctxOf(t, 76, view({ picks: { 'd-4290499d': 0 } })))
    expect(pressIds([pick[pick.length - 1]]), loc).toEqual(['submit'])
    // folded: the header alone, no cards, no send row
    const folded = decideTabLines(snapOf(THREE), { ...ctxOf(t, 76, view()), folded: new Set(['sec:decide.cards']) })
    expect(folded.length, loc).toBe(1)
    expect(folded[0].toggle, loc).toBe('sec:decide.cards')
    expect(folded[0].text, loc).toMatch(/^▸ /)
    expect(decideTabLines(snapOf(THREE), ctxOf(t, 76, view()))[0].text, loc).toMatch(/^▾ /)
    // the count on the header is the number of questions, as a plain count (no formatter-less number)
    expect(decideTabLines(snapOf([THREE[0], THREE[1]]), ctxOf(t, 76, view()))[0].text, loc).toMatch(/ 2 ─+$/)
  }
  // control: the send note is not part of the press target: the Button text is only `[ ... ]`
  const row = decideTabLines(snapOf(THREE), ctxOf(makeT('zh-TW'), 76, view({ picks: { 'd-4290499d': 0 } }))).slice(-1)[0]
  expect(row.segs?.filter(s => s.press !== undefined).map(s => s.text)).toEqual(['[ 送出（已選 1/3） ]'])
})

test('DECIDE wrap: a closing mark never starts a continuation line (negative control: the checker flags a planted one)', () => {
  const zh = makeT('zh-TW')
  const bgText = 'P5 已審查通過並合併（bcaef0cc）。審查員指出計畫裡「殘留分頁截圖」只有資料產生端的證據，沒有你機器上的畫面，所以這一項改回待確認。'
  const startsClosed = (ls: PaneLine[]): string[] => texts(ls).filter(x => /^\s+[）」』、。，；：！？]/.test(x))
  for (const cols of [60, 66, 70, 76, 80]) {
    const ls = decideTabLines(snapOf([dec('d-1', 'q?', { background: bgText, options: [OPT('甲'), OPT('乙')] })]), ctxOf(zh, cols, view()))
    expect(startsClosed(ls), 'cols ' + cols).toEqual([])
    expect(texts(ls).filter(x => x.startsWith('  背景') || x.startsWith('            ')).map(x => x.trim()).join('').replace(/^背景\s+/, '')).toBe(bgText) // nothing lost to the wrap
  }
  expect(startsClosed([{ ...decideTabLines(snapOf(THREE), ctxOf(zh, 76, view()))[0], text: '            」只有' }])).toEqual(['            」只有'])
})

test('DECIDE wrap: a run of closing marks, a space before a mark and an astral character never put a closing mark at the head of a line, and nothing is lost', () => {
  const zh = makeT('zh-TW')
  const cases = [
    '他說「這一項改回待確認。」然後又說「這是第二句話，後面還有括號（註一）。」最後一句「結束了！」）」',
    '𠀋𠀋𠀋 名字裡有擴充字元「𠀋」。後面接一串「引號裡的句子。」再一串（括號裡的句子。）以及更多文字直到換行為止。',
    'the reviewer said (see the plan ) and then ( more text here ) , then a list ; of items : done !',
  ]
  const closing = /^\s+[）」』、。，；：！？)\]}】》〉,.;:!?]/
  for (const bg of cases) for (let cols = 40; cols <= 80; cols++) {
    const ls = decideTabLines(snapOf([dec('d-1', 'q?', { background: bg, options: [OPT('甲'), OPT('乙')] })]), ctxOf(zh, cols, view()))
    const rows = texts(ls).filter(x => x.startsWith('  背景') || x.startsWith('            '))
    expect(rows.filter(x => closing.test(x.replace(/^  背景/, '    '))), 'cols ' + cols + ': ' + bg.slice(0, 12)).toEqual([])
    expect(rows.some(x => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(x)), 'cols ' + cols + ': a lone surrogate').toBe(false)
    expect(rows.map(x => x.trim()).join('').replace(/^背景\s+/, '').replace(/ /g, ''), 'cols ' + cols + ': nothing lost').toBe(bg.replace(/ /g, ''))
  }
})

// ---- the reply text: a wire format the model reads back; the id is what ties an answer to its question ----
test('DECIDE reply: the head line, then `<id>｜<first 30 characters> → <answer>` per answered question, `｜補充：` for a note; only answered, unsent questions with an id', () => {
  const st = { picks: { 'd-4290499d': 0, 'd-c24ecfd9': 1 }, notes: { 'd-c24ecfd9': '  要，\n但只寫一句 ', 'd-0000free': '叫 main' }, sent: {} }
  const r = decideReply(THREE, st)
  expect(r).not.toBeNull()
  expect(r?.text).toBe([
    '[待決回覆]',
    'd-4290499d｜P5 殘留分頁要不要把已清掉的也列出來 → OK',
    'd-c24ecfd9｜U6 要不要把建議也寫進回覆 → 不要｜補充：要， 但只寫一句',
    'd-0000free｜這個分支要叫什麼名字？ → 叫 main',
  ].join('\n'))
  expect(r?.ids).toEqual(['d-4290499d', 'd-c24ecfd9', 'd-0000free'])
  expect(DECIDE_REPLY_HEAD).toBe('[待決回覆]')
  // the question is cut at 30 characters with an ellipsis
  const long = dec('d-long', '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十多出來的字', { options: [OPT('甲'), OPT('乙')] })
  expect(decideLine(long, { ...NO_DECIDE, picks: { 'd-long': 1 } })).toBe('d-long｜一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十… → 乙')
  // nothing chosen, an option question with only a note, a sent question and a question with no id all send nothing
  expect(decideReply(THREE, NO_DECIDE)).toBeNull()
  expect(decideReply([THREE[0]], { ...NO_DECIDE, notes: { 'd-4290499d': '只有補充' } })).toBeNull()
  expect(decideReply([THREE[0]], { picks: { 'd-4290499d': 0 }, notes: {}, sent: { 'd-4290499d': 9 } })).toBeNull()
  expect(decideReply([dec(null, '沒有 id', { options: [OPT('甲'), OPT('乙')] })], { ...NO_DECIDE, picks: { null: 0 } })).toBeNull()
  // one answered question among three: only that one is in the text
  expect(decideReply(THREE, { ...NO_DECIDE, picks: { 'd-c24ecfd9': 0 } })?.text).toBe('[待決回覆]\nd-c24ecfd9｜U6 要不要把建議也寫進回覆 → 要')
})

// ---- review round 1 ----
test('DECIDE rows: 背景 → 卡住 → 選項 → 建議 → 補充, a row with nothing to say is not drawn, the source is never drawn, 建議 is `<option>：<reason>` with no star (negative controls)', () => {
  const zh = makeT('zh-TW')
  const full = (over: Partial<LiveDecision>) => decideTabLines(snapOf([dec('d-1', 'q?', { options: [OPT('甲'), OPT('乙')], ...over })]), ctxOf(zh, 76, view()))
  const one = (over: Partial<LiveDecision>) => texts(full(over))
  const all = one({ background: '為什麼問', recommendation: '甲', why: '少一屏', blocks: '下一個派工', source: 'lane-x', not_authorized: '深度零不能決定' })
  const keys = ['  背景      為什麼問', '  卡住      下一個派工', '  選項      [ ] ★ 甲  [ ] 乙', '  建議      甲：少一屏', '  補充']
  expect(keys.map(k => all.indexOf(k)), 'every row is there').not.toContain(-1)
  expect(keys.map(k => all.indexOf(k)), 'in this order').toEqual(keys.map(k => all.indexOf(k)).slice().sort((a, b) => a - b))
  expect(all.join('\n'), 'the source is data for the assistant, not the owner').not.toMatch(/lane-x|來源/)
  expect(all.join('\n'), 'not_authorized is deliberately not drawn: being on this tab already says the owner decides').not.toContain('深度零不能決定')
  // nothing to say: only the title, the options and the note
  const none = one({})
  expect(none.some(x => /^ {2}(背景|卡住|建議) /.test(x))).toBe(false)
  expect(none.join('\n')).not.toMatch(/(背景|卡住|建議)\s*$/m)
  // only some: the others are not drawn
  const blocksOnly = one({ blocks: '下一個派工' })
  expect(blocksOnly).toContain('  卡住      下一個派工')
  expect(blocksOnly.some(x => x.startsWith('  背景') || x.startsWith('  建議'))).toBe(false)
  expect(one({ source: 'lane-x' }).join('\n')).not.toMatch(/lane-x|來源/)
  // a reason without a recommendation has nothing to hang under: not drawn
  expect(one({ why: '少一屏' }).some(x => x.includes('少一屏'))).toBe(false)
  // a recommendation without a reason: the recommended option's label alone
  expect(one({ recommendation: '甲' })).toContain('  建議      甲')
  expect(one({ recommendation: '乙' })).toContain('  建議      乙')
  // the star is on the option only; 建議 carries none
  const ls = full({ recommendation: '甲', why: '少一屏' })
  const starred = (l: PaneLine[]): PaneLine[] => l.filter(x => x.kind !== 'choice' && x.text.includes(ui.GLYPHS.structure.recommend))
  expect(starred(ls)).toEqual([])
  expect(ls.filter(x => x.kind === 'choice' && x.text.includes('★')).length).toBe(1)
  // the value of 建議 is default text, the 背景 value is dim, the key is dim
  const adv = ls.find(x => x.text.startsWith('  建議')) as PaneLine
  expect(adv.kind).toBe('kv')
  expect(adv.segs?.find(s => s.role === 'key')?.dim).toBe(true)
  expect(adv.segs?.find(s => s.role === 'prose')?.dim).toBeUndefined()
  const bgl = full({ background: '為什麼問' }).find(x => x.text.startsWith('  背景')) as PaneLine
  expect(bgl.segs?.find(s => s.role === 'prose')?.dim).toBe(true)
  // control: the star checker does flag a star planted on the 建議 row, and the source check a planted source
  const bent = ls.map(x => (x.text.startsWith('  建議') ? ui.carry(x, { ...x, text: x.text + ' ★', segs: [...(x.segs ?? []), { text: ' ★' }] }) : x))
  expect(starred(bent).length).toBeGreaterThan(0)
  expect(texts(bent).join('\n') + '來源：lane-x').toMatch(/lane-x|來源/)
})

test('DECIDE send row: the total counts only the questions still open from the pane (an id, not sent, not a dialog)', () => {
  const zh = makeT('zh-TW')
  const list = [THREE[0], THREE[1], THREE[2], dec(null, '沒有 id', { options: [OPT('甲'), OPT('乙')] }), dec('d-dlg', '對話框題', { options: [OPT('甲'), OPT('乙')], origin: 'ask_user_question' })]
  const ls = decideTabLines(snapOf(list), ctxOf(zh, 76, view({ picks: { 'd-4290499d': 0 }, sent: { 'd-0000free': 3 } })))
  expect(ls[ls.length - 1].text.trim()).toBe('[ 送出（已選 1/2） ]  答案會貼進這個對話送出')
})

test('DECIDE dialog: a question the asking session\'s dialog answers has no option Buttons, no field, says so, and is not counted or sent', () => {
  for (const [loc, t] of LOCALES) {
    const d = dec('d-dlg', '要不要繼續？', { options: [OPT('是'), OPT('否')], origin: 'ask_user_question' })
    const ls = decideTabLines(snapOf([d]), ctxOf(t, 76, view()))
    expect(pressIds(ls), loc).toEqual([])
    expect(ls.some(l => l.field !== undefined), loc).toBe(false)
    expect(texts(ls).some(x => x === '  ' + t('decide.in_dialog')), loc).toBe(true)
    expect(ls.some(l => l.text.includes('[ ]')), loc + ': the options are still shown, as plain text').toBe(true)
  }
  expect(texts(decideTabLines(snapOf([dec('d-dlg', 'q', { origin: 'ask_user_question' })]), ctxOf(makeT('zh-TW'), 76, view())))).toContain('  請在對話框回答。')
  expect(decideReply([dec('d-dlg', 'q', { options: [OPT('是'), OPT('否')], origin: 'ask_user_question' })], { ...NO_DECIDE, picks: { 'd-dlg': 0 } })).toBeNull()
  // the other cards still send
  expect(decideReply([dec('d-dlg', 'q', { options: [OPT('是'), OPT('否')], origin: 'ask_user_question' }), THREE[1]], { ...NO_DECIDE, picks: { 'd-dlg': 0, 'd-c24ecfd9': 0 } })?.ids).toEqual(['d-c24ecfd9'])
})

test('DECIDE reply: one question is one line whatever the labels and typed text hold (line breaks become blanks, a typed `｜` is not a separator)', () => {
  const d = dec('d-x', '第一行\n第二行\r\n第三行？', { options: [OPT('甲\n乙'), OPT('丙')] })
  const r = decideReply([d, THREE[2]], { picks: { 'd-x': 0 }, notes: { 'd-x': '先做\n\n再做｜然後', 'd-0000free': '一行\n又一行｜x' }, sent: {} })
  expect(r?.text).toBe('[待決回覆]\nd-x｜第一行 第二行 第三行？ → 甲 乙｜補充：先做 再做|然後\nd-0000free｜這個分支要叫什麼名字？ → 一行 又一行|x')
  expect(r?.text.split('\n').length, 'the head and one line per question').toBe(3)
})

// ---- pressable file paths (the viewer mod): a path written in a card's text opens the viewer window ----
const LINKED = [dec('d-link0001', '看哪一份設計？', { background: '見 docs/plans/2026-10-13-live-pane-design-system.md §12 與 mods/live/ui.ts:120，也可看 README.md。網址 https://example.com/a/b.html 不算，版本 v2.36.1 和 3/4 也不算。', options: [OPT('A'), OPT('B')] })]
const linkSegsOf = (ls: PaneLine[]) => ls.flatMap(l => (l.segs ?? []).filter(s => s.press !== undefined && s.press.startsWith(ui.SHOW_PRESS)))

test('DECIDE paths: a file path in a card\'s text is a pressable run in the action colour; a :line suffix opens at that line; URLs, versions and plain fractions are not links', () => {
  for (const [, t] of LOCALES) {
    const ls = decideTabLines(snapOf(LINKED), ctxOf(t, 120, view()))
    const links = linkSegsOf(ls)
    expect(links.map(s => s.text)).toEqual(['docs/plans/2026-10-13-live-pane-design-system.md', 'mods/live/ui.ts:120', 'README.md'])
    expect(links.map(s => s.press)).toEqual(['show:docs/plans/2026-10-13-live-pane-design-system.md', 'show:mods/live/ui.ts:120', 'show:README.md'])
    for (const s of links) expect(s.color, 'one colour, one meaning: a pressable run is the action role').toBe(ui.PALETTE.action)
    // the text of the line is unchanged by the links (they only split it into runs)
    const bg = ls.find(l => l.kind === 'kv' && l.text.includes('見 docs/plans'))
    expect(bg?.text).toContain('見 docs/plans/2026-10-13-live-pane-design-system.md §12 與 mods/live/ui.ts:120，也可看 README.md。')
    expect(violations(ls, 120, t)).toEqual([])
  }
})

test('DECIDE paths: showTarget reads the press id back; a malformed id is nothing (negative controls)', () => {
  expect(ui.showTarget('show:mods/live/ui.ts:120')).toEqual({ path: 'mods/live/ui.ts', line: 120 })
  expect(ui.showTarget('show:/tmp/x/out.log:end')).toEqual({ path: '/tmp/x/out.log', line: 'end' })
  expect(ui.showTarget('show:README.md')).toEqual({ path: 'README.md', line: null })
  expect(ui.showTarget('show:')).toBeNull()
  expect(ui.showTarget('pick:d-1:0')).toBeNull()
  expect(ui.showPress('a/b.md', 'end')).toBe('show:a/b.md:end')
  // linkSegs: no path -> exactly one segment with the base options
  expect(ui.linkSegs('只有文字 and words', { role: 'prose', dim: true })).toEqual([{ text: '只有文字 and words', role: 'prose', dim: true }])
  for (const not of ['https://example.com/a/b.html', 'v2.36.1', '3/4', 'a/b', 'e.g.']) expect(ui.linkSegs('see ' + not + ' now', { role: 'prose' }).length, not).toBe(1)
})

test('DECIDE paths: a sent card links its paths too (reading the background does not need the card to be open)', () => {
  const ls = decideTabLines(snapOf(LINKED), ctxOf(makeT('en'), 120, view({ sent: { 'd-link0001': 1 } })))
  expect(linkSegsOf(ls).length).toBe(3)
})
