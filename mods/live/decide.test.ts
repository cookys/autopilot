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

test('DECIDE card: first line `n. question`, the background below it, ONE row of option Buttons with the recommended one starred, the stall as one line, a note field, then the send row', () => {
  const zh = makeT('zh-TW')
  const ls = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view()))
  const t = texts(ls)
  expect(t[0]).toBe('▲ 1. P5 殘留分頁要不要把已清掉的也列出來')
  expect(t[1].trim().startsWith('殘留分頁現在只列要人處理的')).toBe(true) // the background, dim text
  const row = ls.findIndex(l => l.kind === 'choice' && l.text.includes('[ ]'))
  expect(t[row]).toBe('  [ ] ★ OK  [ ] 完整顯示') // one row; the star marks the recommendation
  expect(ls[row].segs?.filter(s => s.role === 'glyph').map(s => s.text)).toEqual([ui.GLYPHS.structure.recommend])
  expect(pressIds([ls[row]])).toEqual(['pick:d-4290499d:0', 'pick:d-4290499d:1'])
  expect(t.some(x => x === '  卡住：下一個派工')).toBe(true) // "if unanswered" is one subtle line
  const field = ls.find(l => l.field !== undefined && l.field.key === 'note:d-4290499d')
  expect(field?.text.trim()).toBe('補充')
  expect(field?.field?.placeholder).toBe('選填')
  // the second card is numbered 2 and has its own row; the third has no options, so it asks for a typed reply
  expect(t.some(x => x === '▲ 2. U6 要不要把建議也寫進回覆')).toBe(true)
  expect(t.some(x => x === '  [ ] 要  [ ] 不要')).toBe(true)
  expect(t.some(x => x === '▲ 3. 這個分支要叫什麼名字？')).toBe(true)
  expect(ls.find(l => l.field !== undefined && l.field.key === 'note:d-0000free')?.text.trim()).toBe('回覆')
  // the send row is last and is inert while nothing is chosen
  const last = ls[ls.length - 1]
  expect(last.text.trim()).toBe('[ 送出（已選 0/3） ]')
  expect(pressIds([last])).toEqual([])
  // a card is not a screenful: three cards of this kind fit well under a page
  expect(ls.length).toBeLessThan(24)
})

test('DECIDE choose: the picked option is `[x]` in bold default text (no background, no inverse), the others stay plain, the send row counts it and becomes pressable', () => {
  const zh = makeT('zh-TW')
  const ls = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view({ picks: { 'd-4290499d': 1 } })))
  const row = ls.find(l => l.kind === 'choice' && l.text.includes('完整顯示')) as PaneLine
  expect(row.text.trimEnd()).toBe('  [ ] ★ OK  [x] 完整顯示')
  const picked = (row.segs ?? []).filter(s => s.text.includes('完整顯示') || s.text === '[x] ')
  expect(picked.length).toBeGreaterThan(0)
  for (const s of picked) { expect(s.color).toBeUndefined(); expect(s.bold).toBe(true); expect('backgroundColor' in s || 'inverse' in s).toBe(false) } // default text, bold: the picked option is on the bold whitelist
  expect(ls.some(l => l.text.includes('全列出來')), 'the picked option shows its one-line description').toBe(true)
  const last = ls[ls.length - 1]
  expect(last.text.trim()).toBe('[ 送出（已選 1/3） ]')
  expect(pressIds([last])).toEqual(['submit'])
  // a pick that is no longer one of the options (the list changed under it) counts as no pick
  const stale = decideTabLines(snapOf(THREE), ctxOf(zh, 76, view({ picks: { 'd-4290499d': 7 } })))
  expect(stale[stale.length - 1].text.trim()).toBe('[ 送出（已選 0/3） ]')
})

test('DECIDE sent: a question already sent says so, draws its options without Buttons and without a field, and the send row stops offering it', () => {
  const zh = makeT('zh-TW')
  const v = view({ picks: { 'd-4290499d': 0 }, sent: { 'd-4290499d': 5 } })
  const ls = decideTabLines(snapOf(THREE), ctxOf(zh, 76, v))
  expect(texts(ls)[0]).toBe('○ 1. P5 殘留分頁要不要把已清掉的也列出來 · 已送出，等處理')
  expect(pressIds(ls).filter(p => p.startsWith('pick:d-4290499d'))).toEqual([])
  expect(ls.some(l => l.field?.key === 'note:d-4290499d')).toBe(false)
  expect(texts(ls).some(x => x === '  [x] ★ OK  [ ] 完整顯示')).toBe(true) // the choice made stays visible
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

test('DECIDE none: no question is one empty line and no badge; each question adds to the badge', () => {
  for (const [loc, t] of LOCALES) {
    const none = decideTabLines(snapOf([]), ctxOf(t, 76, view()))
    expect(none.map(l => l.kind), loc).toEqual(['empty'])
    expect(none[0].text, loc).toContain(t('decide.none'))
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

test('DECIDE recommendation: matched to an option by label (equal, or one starts with the other); an unmatched one is said once on the meta line instead', () => {
  expect(recommendedIndex(dec('a', 'q', { options: [OPT('OK'), OPT('No')], recommendation: 'ok' }))).toBe(0)
  expect(recommendedIndex(dec('a', 'q', { options: [OPT('OK'), OPT('No')], recommendation: 'No — it is cheaper' }))).toBe(1)
  expect(recommendedIndex(dec('a', 'q', { options: [OPT('OK'), OPT('No')], recommendation: 'something else' }))).toBe(null)
  expect(recommendedIndex(dec('a', 'q', { options: [OPT('OK')], recommendation: null }))).toBe(null)
  const zh = makeT('zh-TW')
  const ls = decideTabLines(snapOf([dec('d-1', 'q?', { options: [OPT('甲'), OPT('乙')], recommendation: '先做丙' })]), ctxOf(zh, 76, view()))
  expect(ls.some(l => l.text.includes('★'))).toBe(false)
  expect(texts(ls).some(x => x === '  建議：先做丙')).toBe(true)
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
test('DECIDE meta: one subtle line `卡住：… · 來源：…`, the ★ reason line only under a recommendation; empty parts are left out, never drawn empty (all / none / source only)', () => {
  const zh = makeT('zh-TW')
  const one = (over: Partial<LiveDecision>) => texts(decideTabLines(snapOf([dec('d-1', 'q?', { options: [OPT('甲'), OPT('乙')], ...over })]), ctxOf(zh, 76, view())))
  const all = one({ recommendation: '甲', why: '少一屏', blocks: '下一個派工', source: 'lane-x', not_authorized: '深度零不能決定' })
  expect(all).toContain('  ★ 少一屏')
  expect(all).toContain('  卡住：下一個派工 · 來源：lane-x')
  expect(all.indexOf('  ★ 少一屏'), 'the reason follows the option row').toBe(all.findIndex(x => x.startsWith('  [ ] ★ 甲')) + 1)
  expect(all.join('\n'), 'not_authorized is deliberately not drawn: being on this tab already says the owner decides').not.toContain('深度零不能決定')
  const none = one({})
  expect(none.some(x => x.includes('卡住') || x.includes('來源') || x.includes('★ '))).toBe(false)
  expect(none.join('\n')).not.toMatch(/卡住：\s*$|來源：\s*$/m)
  const src = one({ source: 'lane-x' })
  expect(src).toContain('  來源：lane-x')
  expect(src.some(x => x.includes('卡住'))).toBe(false)
  // a reason without a recommendation has nothing to hang under: not drawn
  expect(one({ why: '少一屏' }).some(x => x.includes('少一屏'))).toBe(false)
  // the ★ line is a detail line made by the design system: the glyph from GLYPHS, dim, no background
  const ls = decideTabLines(snapOf([dec('d-1', 'q?', { options: [OPT('甲'), OPT('乙')], recommendation: '甲', why: '少一屏' })]), ctxOf(zh, 76, view()))
  const why = ls.find(l => l.text.includes('少一屏')) as PaneLine
  expect(why.kind).toBe('detail')
  expect(why.segs?.find(s => s.role === 'glyph')?.text).toBe(ui.GLYPHS.structure.recommend)
  expect(why.segs?.every(s => s.dim === true || s.text.trim() === '')).toBe(true)
})

test('DECIDE send row: the total counts only the questions still open from the pane (an id, not sent, not a dialog)', () => {
  const zh = makeT('zh-TW')
  const list = [THREE[0], THREE[1], THREE[2], dec(null, '沒有 id', { options: [OPT('甲'), OPT('乙')] }), dec('d-dlg', '對話框題', { options: [OPT('甲'), OPT('乙')], origin: 'ask_user_question' })]
  const ls = decideTabLines(snapOf(list), ctxOf(zh, 76, view({ picks: { 'd-4290499d': 0 }, sent: { 'd-0000free': 3 } })))
  expect(ls[ls.length - 1].text.trim()).toBe('[ 送出（已選 1/2） ]')
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
