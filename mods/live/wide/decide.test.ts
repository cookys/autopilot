// console v5 P3: the 待決 page in the wide band (wide/decide.ts + wide/band.ts) against the design's 2-* steps and C1-C3 (fixtures/decide-steps.testkit.ts, band rows 25-41 of out-wide-all).
// The design draws a few glyphs this repo bans (▲ ★ ⚠ ▏ ●); the expected rows swap them for the glyph table's (⏶ ✧ △ _ ◉) and nothing else.
import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, wideBand } from './band'
import type { WideModel } from './band'
import { cardUrl, wideCrossNote, wideDecide } from './decide'
import type { WideCard, WideDecideInput } from './decide'
import { DECIDE_STEPS } from './fixtures/decide-steps.testkit'
import { routeKey } from '../pages/keys'
import { decideReduce, NO_NAV } from '../pages/decide'

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

const opt = (label: string, detail: string, recommended = false) => ({ label, detail, recommended })
const C = '待辦'
const cc = '離開待決，到期日前不再出現'
const c1: WideCard = { id: 'c1', title: '合併 plan', question: '要不要把 tui 共用計畫合進 develop？', background: null, options: [opt('合併', '計畫已凍結兩輪；今天就能開工', true), opt('再審一輪', '換一家再看一次；晚一天'), opt(C, cc)] }
const c2: WideCard = { id: 'c2', title: '外掛更新時機', question: 'forge-stats 外掛今晚還是明早更新？', background: null, options: [opt('今晚', '今晚就用到新版；出事沒人在線上'), opt('明早', '有人在線上看著換', true), opt(C, cc)] }
const c3: WideCard = { id: 'c3', title: '預覽先拍幾欄', question: '預覽先拍 80 欄還是 120 欄？', background: null, options: [opt('80 欄', '筆電的問題先抓到；寬螢幕晚半天'), opt('120 欄', '平常畫面先過閘門；80 欄晚半天', true), opt(C, cc)] }
const c4opts = [opt('照建議定案', '8 個值都和 staging 看到的一致', true), opt('不照建議', '按 m 寫哪一個值要改'), opt(C, '還沒空做，到期日前不再出現')]
const c4: WideCard = { id: 'c4', title: '時冶 PL02 定案', question: '時冶 PL02 模型的 8 個推定值照建議定案？', background: null, options: [opt('照建議定案', '8 個值都和 staging 看到的一致', true), opt('不照建議', '按 m 寫哪一個值要改'), opt(C, '還沒空做，到期日前不再出現')], awaiting: { steps: [] } }
const URL = 'https://staging.shiye.test/pl02?v=241115'
const c4bg: WideCard = { ...c4, options: c4opts, background: `1. 打開 staging 頁 ${URL}\n2. 走一圈，核對 8 個推定值` }
const c4steps: WideCard = { ...c4, options: c4opts, awaiting: { label: 'staging', steps: [`打開 staging 頁 ${URL}`, '走一圈，核對 8 個推定值：\n衰減、半徑、上限、下限\n權重 1、權重 2、權重 3、權重 4', '有不一致的值，按 m 寫是哪一個'] } }
const four = [c1, c2, c3, c4]
const NOTE4 = 'staging 走過一圈，8 個都對；第 5、7 兩個值和 11-24 的對照一致'
const base: WideDecideInput = { cards: four, cursor: 0, picks: {}, notes: {}, sent: {}, textMode: false, textBuf: '', armed: false, notice: null, source: null }

// 14 cards for 2-M: the first four picked with their recommendation, the fifth is the open one
const many: WideCard[] = (() => {
  const mk = (id: string, title: string, q: string, pick: number | null, act = false): WideCard => ({
    id, title, question: q, background: null, ...(act ? { awaiting: { steps: [] } } : {}),
    options: [opt('先裝 canary', '一台出事只影響一台；全部晚半天', pick === 0 || pick === null), opt('全部一起裝', '今天就全上；出事要一起回滾', pick === 1), opt(C, cc)],
  })
  const m5: WideCard = { ...mk('c5', 'hippo 安裝', 'hippo P1.5 要先裝 canary 還是全部一起裝？', null) }
  return [
    mk('c1', '合併 plan', 'q1', 0), mk('c2', '外掛更新時機', 'q2', 1), mk('c3', '預覽先拍幾欄', 'q3', 0), mk('c4', '時冶 PL02', 'q4', 0), m5,
    mk('c6', 'mnemos 匯入', 'q6', null), mk('c7', 'alfred 上線', 'q7', null, true), mk('c8', 'lab gate 放行', 'q8', null), mk('c9', 'docs 版本對齊', 'q9', null),
    mk('c10', 'mnemos 索引重建', 'q10', null), mk('c11', 'x11', 'q11', null), mk('c12', 'x12', 'q12', null, true), mk('c13', 'x13', 'q13', null), mk('c14', 'x14', 'q14', null),
  ]
})()

const P1 = { c1: 0, c2: 1 }
const P3 = { c1: 0, c2: 1, c4: 0 }
const MODELS: Record<string, WideDecideInput> = {
  '2-N': base,
  '2-E': { ...base, cards: [] },
  '2-M': { ...base, cards: many, cursor: 4, picks: { c1: 0, c2: 1, c3: 0, c4: 0 } },
  '2-L': { ...base, cards: [c1, c2, c3, c4bg], cursor: 3 },
  '2-X': { ...base, source: { reason: 'fleet decision list 結束碼 1', retrySec: 30 } },
  '2-S': { ...base, cursor: 1, picks: P1, notice: { kind: 'changed', n: 2, what: '選項 b 的說明' } },
  '2-L2': { ...base, cards: [c1, c2, c3, c4steps], cursor: 3, picks: P1 },
  '2-L3': { ...base, cards: [c1, c2, c3, c4steps], cursor: 3, picks: P1 },
  '2-A': { ...base, cards: [c1, c2, c3, c4steps], cursor: 3, picks: P3 },
  '2-I': { ...base, cards: [c1, c2, c3, c4steps], cursor: 3, picks: P3, textMode: true, textBuf: NOTE4 },
  '2-P': { ...base, cursor: 3, picks: P3, notes: { c4: NOTE4 }, armed: true },
  '2-Pc': { ...base, cards: [c1, c2, c3, c4bg], cursor: 3, picks: P3, notes: { c4: NOTE4 }, notice: { kind: 'cancelled' } },
  '2-R': { ...base, cursor: 2, picks: P3, sent: { c1: 1, c2: 1, c4: 1 }, notice: { kind: 'sent', n: 3, at: '09:42', receipt: '01M89R…' } },
  '2-F': { ...base, cards: [c1, c2, c3, c4bg], cursor: 3, picks: P3, notes: { c4: NOTE4 }, notice: { kind: 'failed', n: 3, reason: 'courier 逾時（30 秒）' } },
  '2-Fl0': { ...base, cursor: 0, picks: { c2: 0 } },
  '2-Fl': { ...base, cursor: 0, picks: { c1: 0, c2: 0, c3: 1 }, notice: { kind: 'filled', filled: [{ n: 1, letter: 'a' }, { n: 3, letter: 'b' }], kept: [{ n: 2, letter: 'a', label: '今晚' }], blocked: [4] } },
  C1: { ...base, cursor: 1, picks: P1, notes: { c2: '明早 9 點有人在' } },
  C3: { ...base, cursor: 1, picks: P1, notes: { c2: '明早 9 點有人在' }, notice: { kind: 'back', n: 2 } },
}

const wideOf = (rows: string[], out: { stepTitle: string; list: string[]; reply: string[]; hints: string }, page = 2): WideModel => ({
  page, tabs: WIDE_TABS, stepTitle: out.stepTitle, list: out.list, reply: out.reply, status: norm(cols(rows[14], 2, 113).trimEnd()), hints: out.hints,
})

for (const step of DECIDE_STEPS) {
  if (step.id === 'C2') continue
  test(`P3 wide 待決 ${step.id} (${step.title}): the 17 band rows equal the design (glyph table swaps only), each 115 columns`, () => {
    const out = wideDecide(MODELS[step.id])
    const band = wideBand(wideOf(step.rows, out))
    const want = step.rows.map(norm)
    expect(band.rows.length).toBe(17)
    for (const r of band.rows) expect(displayWidth(r)).toBe(115)
    // 2-L3 is 2-L2 scrolled to the end; the wide band has no scroll, so only its title differs
    const skip = step.id === '2-L3' ? 1 : 0
    expect(band.rows.slice(skip)).toEqual(want.slice(skip))
  })
  test(`P3 wide 待決 ${step.id}: structure rows verbatim (frame, divider, tabs, bottom hint ending), status row has no 卡住`, () => {
    const out = wideDecide(MODELS[step.id])
    const band = wideBand(wideOf(step.rows, out))
    for (const i of [13, 15]) expect(band.rows[i]).toBe(norm(step.rows[i]))
    expect(band.rows[16]).toBe(norm(step.rows[16]))
    expect(band.rows[13].startsWith('├') && band.rows[13].includes('┴') && band.rows[13].endsWith('┤')).toBe(true)
    expect(band.rows[16].includes('Tab 換頁 ─')).toBe(true)
    expect(band.rows[14].includes('卡住')).toBe(false)
  })
}

test('P3 wide 待決 C2 (open card, looking at 艦隊): the note in the reply column, the fleet list untouched', () => {
  const step = DECIDE_STEPS.find(s => s.id === 'C2')!
  const note = wideCrossNote('艦隊', { n: 2, pick: 'b', note: true })!
  const list = step.rows.slice(1, 13).map(r => norm(cols(r, 2, 38).trimEnd()))
  const band = wideBand({ page: 7, tabs: WIDE_TABS, stepTitle: note.stepTitle, list, reply: note.reply, status: norm(cols(step.rows[14], 2, 113).trimEnd()), hints: 'j/k 換筆 · o 展開 · Esc 關閉' })
  expect(band.rows).toEqual(step.rows.map(norm))
  expect(wideCrossNote('艦隊', { n: 2, pick: null, note: false })).toBe(null)
})

test('P3 wide 待決: more than 12 reply rows move the steps after the question to overflow.steps, the band keeps question and options', () => {
  const long: WideCard = { ...c4steps, awaiting: { label: 'staging', steps: Array.from({ length: 12 }, (_, i) => `步驟 ${i + 1}`) } }
  const out = wideDecide({ ...base, cards: [c1, c2, c3, long], cursor: 3 })
  expect(out.reply.length).toBeLessThanOrEqual(12)
  expect(out.reply[0].endsWith(long.question)).toBe(true)
  expect(out.reply[1]).toBe('步驟在右邊，不用捲')
  expect(out.reply.filter(r => /^ {4}[abc]: /.test(r)).length).toBe(3)
  expect(out.overflow.steps.length).toBe(12)
  expect(out.overflow.steps[0]).toBe('  1. 步驟 1')
})

test('P3 wide 待決: more than 12 list rows keep 11 and say the rest is in the pane; the rest comes back as overflow.list', () => {
  const out = wideDecide({ ...base, cards: many, cursor: 4 })
  expect(out.list.length).toBe(12)
  expect(out.list[11]).toBe('另 4 列在右邊「清單（續）」')
  expect(out.overflow.list.length).toBe(4)
})

test('P3 wide 待決: g copies the current card URL - the key routes only in the wide band, the reducer hands the URL out', () => {
  const st = { page: 'decide', paneFocus: true, focusedButton: false, textMode: false }
  expect(routeKey('g', { ...st, wide: true }).kind).toBe('copy_url')
  expect(routeKey('g', st).kind).toBe('none')
  expect(routeKey('g', { ...st, wide: false }).kind).toBe('none')
  expect(routeKey('g', { ...st, page: 'now', wide: true }).kind).toBe('none')
  expect(cardUrl(c4bg)).toBe(URL)
  expect(cardUrl(c4steps)).toBe(URL)
  expect(cardUrl(c1)).toBe(null)
  const ctx = { v74: { decide: [{ id: 'd1', title: 't', question: 'q', background: `1. 開 ${URL}`, options: [] }] }, size: { cols: 209, rows: 49 }, t: (k: string) => k } as never
  const r = decideReduce({ ...NO_NAV }, { kind: 'copy_url' }, ctx, 0)
  expect(r.effect).toEqual({ kind: 'copy_url', url: URL })
  const none = decideReduce({ ...NO_NAV }, { kind: 'copy_url' }, { v74: { decide: [{ id: 'd2', title: 't', question: 'q', background: null, options: [] }] }, size: { cols: 209, rows: 49 }, t: (k: string) => k } as never, 0)
  expect(none.effect).toBe(null)
})
