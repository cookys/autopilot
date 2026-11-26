// mods/live/wide/decide.ts - console v5 P3: the 待決 page in the wide band (design gen_wide_all.py compose(), 2-* steps and C1-C3). Pure, no host calls.
// The page's state machine (pages/decide.ts decideReduce) is untouched: this only turns its state (cards, cursor, picks, notes, sent, note mode, preview) into the band's rows.
//   list column  (36 cols): summary row, one row per card, `▸` on the focused card; over 12 rows the last row says the rest is in the pane (`清單（續）`)
//   reply column (70 cols): notice lines, the question, steps, the options, the note / hint row; over 12 rows the steps after the question move to the pane
// What does not fit comes back as `overflow` (steps: rows between the question and the options; list: card rows past the list column) for the pane (P2) to draw; nothing here draws a pane.
// Glyphs: the design's action mark, recommend star, warning sign, text bar and running dot are East Asian ambiguous or emoji-prone (banned in this repo); the glyph table's own are used instead.
import { GLYPHS } from '../../tux/glyphs'
import { displayWidth } from '../../tux/width'
import { pickKeys } from '../v74/contract'
import { questionAfterTitle } from '../cardtitle'
import { clipTo } from './band'
import { wrapReply } from './wrap'
import { BAND_BODY_ROWS, BAND_REPLY_COLS } from './geometry'

export type WideOpt = { label: string; detail: string; recommended: boolean }
// awaiting: an answered card that waits on the operator's own steps (等你動手); `label` names what is being walked ("staging"), steps may carry `\n` for a forced line break
export type WideCard = { id: string; title: string; question: string; background: string | null; options: WideOpt[]; awaiting?: { label?: string; steps: string[] } }
export type WideNotice =
  | { kind: 'sent'; n: number; at: string; receipt: string }
  | { kind: 'failed'; n: number; reason: string }
  | { kind: 'cancelled' }
  | { kind: 'changed'; n?: number; what?: string }
  | { kind: 'filled'; filled: { n: number; letter: string }[]; kept: { n: number; letter: string; label: string }[]; blocked: number[] }
  | { kind: 'back'; n: number }
export type WideDecideInput = {
  cards: WideCard[]
  cursor: number
  picks: Record<string, number> // card id -> option index
  notes: Record<string, string>
  sent: Record<string, unknown> // card id -> anything: the card went out
  textMode: boolean
  textBuf: string
  armed: boolean // the send preview is open
  notice: WideNotice | null
  source: { reason: string; retrySec: number } | null // the card list could not be read
}
export type WideDecideOverflow = { steps: string[]; list: string[] }
export type WideDecideOut = { stepTitle: string; list: string[]; reply: string[]; hints: string; overflow: WideDecideOverflow }

const G = GLYPHS
const MARK_ACT = G.structure.foldUp // the card waits on your own step
const MARK_DONE = G.state.done
const MARK_REC = G.structure.recommend // recommended option
const MARK_WARN = G.state.findings // warning
const MARK_CUR = G.structure.folded // ▸: the focused card
const TEXT_CURSOR = '_' // text cursor
const ARROW = G.structure.answer
const URL_RE = /https?:\/\/\S+/
const REC_COL = 8 // `✧ 建議  `
const LIST_MORE_ROWS = BAND_BODY_ROWS

export const WIDE_DECIDE_TEXT = {
  summary: (total: number, extra: string) => `待決 ${total} 張${extra}`,
  actCount: (k: number) => ` · 等你動手 ${k} 張`,
  pickedCount: (m: number) => ` · 已選 ${m} 張`,
  empty: '沒有要你處理的卡',
  sentMark: '已送出',
  listMore: (k: number) => `另 ${k} 列在右邊「清單（續）」`,
  stepsInPane: '步驟在右邊，不用捲',
  previewRest: (k: number) => `其餘 ${k} 列在右邊`,
  noteLabel: '附註',
  chosen: '已選',
  rec: '建議',
  sNone: (n: number) => `s 送出 · ${n} 張都還沒選 · 送出後不能改`,
  sSome: (m: number, rest: number) => `s 送出 · 已選 ${m} 張 · 還有 ${rest} 張沒選`,
  copyUrl: '（按 g 複製網址）',
  noteTitle: '寫附註',
  noteHead: '附註（Enter 存，Esc 取消）：',
  noteTyping: '輸入中：a/b/c、s 這些鍵都當成文字',
  previewTitle: '送出預覽',
  previewHead: (n: number, nos: number[]) => `送出預覽 · ${n} 張（${nos.join('、')}）· 確認後不能改`,
  sourceTitle: '缺源',
  sourceHead: (reason: string) => {
    const code = reason.match(/(?:rc=|結束碼\s*)(\d+)/)?.[1]
    return `${G.state.stalled} decision list 讀不到${code === undefined ? '' : `（fleet decision list 結束碼 ${code}）`}`
  },
  sourceBody: '卡片內容看不到，不能作答。已選的答案留在本機，恢復後會回來。',
  sourceRetry: (s: number) => `${s} 秒後自動重試。`,
  emptyTitle: '沒有卡',
  emptyHead: `${G.state.done} 沒有待決的卡。`,
  emptyBody: '新卡進來時底列會亮黃色「待決 N」，按 2 回到這裡。',
  titleOne: (n: number) => `第 ${n} 張`,
  titleOf: (total: number, n: number) => `${total} 張的第 ${n} 張`,
  titleBg: ' · 來龍去脈很長',
  titleAwait: '等你動手',
  titleAwaitLong: ' · 步驟很長',
  titleAwaitPicked: (label: string, letter: string) => `走完 ${label} · 選 ${letter}`,
  titleOpen: (n: number, parts: string[]) => `開著卡（第 ${n} 張${parts.length > 0 ? parts.join('、') : ''}）`,
  openPick: (l: string) => `選了 ${l}`,
  openNote: '寫了附註',
  titleFillBefore: '按 f 之前',
  noticeTitle: { sent: '送出成功', failed: '送出失敗', cancelled: '取消預覽', changed: '預覽中卡片變了', filled: '按 f 之後', back: '回到待決（全部恢復）' },
  sent: (n: number, at: string, receipt: string) => `${G.state.done} 已送出 ${n} 張，PM ${at} 收到（回執 ${receipt}）。`,
  sentRest: '送出的卡不能再改，a/b/c 只對沒送的這張有效：',
  failed: (reason: string, n: number) => `${G.state.failed} 送出失敗：${reason}，${n} 張都沒送出。`,
  failedRest: '選擇和附註都留著；按 s 再預覽一次就能重送。',
  cancelled: '已取消預覽；選擇和附註都留著，按 s 再預覽。',
  changed: (n: number | undefined, what: string | undefined) => (n === undefined ? `${MARK_WARN} 預覽之後，卡片有變動。` : `${MARK_WARN} 預覽之後，第 ${n} 張被 PM 改了${what === undefined ? '' : `（${what}）`}。`),
  changedRest: '確認已被拒絕，你的選擇都還在；看過再按 s 重新預覽。',
  back: (n: number) => `回到第 ${n} 張；選擇、附註、來龍去脈都和離開時一樣。`,
  fillHead: (picked: number, n: number, letter: string, label: string, rl: string) => `已選 ${picked} 張：第 ${n} 張你選了 ${letter}（${label}），不是建議的 ${rl}。`,
  fillRule: `按 f：沒選的卡填成建議；已選的和 ${MARK_ACT} 要動手的不動。`,
  filled: (filled: { n: number; letter: string }[]) => `${G.state.done} 填入建議 ${filled.length} 張：${filled.map(f => `第 ${f.n} 張 ${f.letter}`).join('、')}。`,
  filledKept: (kept: { n: number; letter: string; label: string }[], blocked: number[]) => [
    ...kept.map(k => `第 ${k.n} 張保留你選的 ${k.letter}（${k.label}）`),
    ...blocked.map(b => `第 ${b} 張要先動手，不自動填`),
  ].join('；') + '。',
  filledNext: '送出前會先預覽，可以再改。',
  cross: (page: string, n: number, what: string) => `看完${page}按 2 回待決：第 ${n} 張、${what}都還在。`,
  crossTitle: (page: string) => `開著卡時看${page}`,
  crossPick: (l: string) => `選的 ${l}`,
  crossNote: '附註',
}
const T = WIDE_DECIDE_TEXT

const HINT = {
  normal: 'a/b/c 選 · p/n 換張 · f 填建議 · m 附註 · s 送出 · Esc 回輸入框',
  awaiting: 'a/b/c 選 · g 複製網址 · m 附註 · s 送出',
  note: 'Enter 存附註 · Esc 取消附註',
  preview: 'y 確認送出 · x 取消 · Esc 取消',
  changed: 'a/b/c 選 · p/n 換張 · s 重新預覽 · Esc 回輸入框',
  sentSome: (n: number) => `a/b/c 選第 ${n} 張 · m 附註 · s 送出 · Esc 回輸入框`,
  none: 'Esc 回輸入框',
}

const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, ' ').trim()
const padTo = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - displayWidth(s)))
const wrapTo = (s: string, width: number): string[] => {
  const out: string[] = []
  let cur = ''
  for (const ch of s) {
    if (displayWidth(cur) + displayWidth(ch) > width) { out.push(cur); cur = '' }
    cur += ch
  }
  out.push(cur)
  return out
}

// the first URL a card carries (its steps, then its background, then its question): what `g` hands over
export function cardUrl(c: { question: string; background: string | null; awaiting?: { steps: string[] } }): string | null {
  for (const s of [...(c.awaiting?.steps ?? []), c.background ?? '', c.question]) {
    const m = URL_RE.exec(s)
    if (m !== null) return m[0]
  }
  return null
}

const letterOf = (c: WideCard, at: number): string => pickKeys(c.options)[at] || 'abc'[at] || String(at + 1)

// steps of an awaiting card: `  1. text`, continuation rows hang at 6; the first step with a URL puts the URL on its own row and says `g` copies it
function awaitingRows(steps: string[]): string[] {
  const rows: string[] = []
  let hinted = false
  steps.forEach((step, i) => {
    const lines = step.split('\n')
    let head = lines[0]
    const url = !hinted ? /^(.*?)\s*(https?:\/\/\S+)\s*$/.exec(head) : null
    const rest = lines.slice(1)
    if (url !== null && url[1] !== '') { hinted = true; head = url[1] + T.copyUrl; rest.unshift(url[2]) }
    rows.push(`  ${i + 1}. ${head}`)
    for (const r of rest) rows.push('     ' + r)
  })
  return rows
}

function optionRows(c: WideCard, picked: number | undefined): string[] {
  const lw = Math.max(0, ...c.options.map(o => displayWidth(o.label))) + 2
  return c.options.map((o, i) => {
    const rec = o.recommended ? padTo(`${MARK_REC} ${T.rec}`, REC_COL) : ' '.repeat(REC_COL)
    const mark = picked === i ? `  ${MARK_DONE} ${T.chosen}` : ''
    return `    ${letterOf(c, i)}: ${padTo(o.label, lw)}${rec}${o.detail}${mark}`.trimEnd()
  })
}

export function wideDecide(m: WideDecideInput): WideDecideOut {
  const empty: WideDecideOverflow = { steps: [], list: [] }
  if (m.source !== null) {
    return { stepTitle: T.sourceTitle, list: ['待決讀不到'], reply: [T.sourceHead(m.source.reason), T.sourceBody, T.sourceRetry(m.source.retrySec)], hints: HINT.none, overflow: empty }
  }
  if (m.cards.length === 0) {
    return { stepTitle: T.emptyTitle, list: [T.summary(0, ''), '  ' + T.empty], reply: [T.emptyHead, T.emptyBody], hints: HINT.none, overflow: empty }
  }
  const cards = m.cards
  const at = Math.max(0, Math.min(cards.length - 1, m.cursor))
  const cur = cards[at]
  const isSent = (c: WideCard): boolean => m.sent[c.id] !== undefined
  const pickOf = (c: WideCard): number | undefined => (m.picks[c.id] !== undefined && m.picks[c.id] < c.options.length ? m.picks[c.id] : undefined)
  const curPick = pickOf(cur)
  const curNote = (m.notes[cur.id] ?? '').trim() !== '' ? m.notes[cur.id] : null

  // ---- list column ----
  const unsent = cards.filter(c => !isSent(c)).length
  const acting = cards.filter(c => c.awaiting !== undefined && !isSent(c)).length
  const pickedN = cards.filter(c => pickOf(c) !== undefined).length
  const summary = pickedN > 0 && cards.length <= BAND_BODY_ROWS ? T.summary(unsent, T.pickedCount(pickedN)) : acting > 0 ? T.summary(unsent - acting, T.actCount(acting)) : T.summary(unsent, '')
  const cardRows = cards.map((c, i) => {
    const p = pickOf(c)
    const mark = isSent(c) ? G.structure.up : p !== undefined ? MARK_DONE : c.awaiting !== undefined ? MARK_ACT : '·'
    return `${i === at ? MARK_CUR : ' '} ${mark}${i + 1} ${c.title}${p !== undefined ? '：' + letterOf(c, p) : ''}${isSent(c) ? ' ' + T.sentMark : ''}`
  })
  let list = [summary, ...cardRows]
  const overflow: WideDecideOverflow = { steps: [], list: [] }
  if (list.length > LIST_MORE_ROWS) {
    overflow.list = list.slice(LIST_MORE_ROWS - 1)
    list = [...list.slice(0, LIST_MORE_ROWS - 1), T.listMore(overflow.list.length)]
  }

  // ---- reply column ----
  const out = (stepTitle: string, reply: string[], hints: string): WideDecideOut => ({ stepTitle, list, reply: fitReply(reply, overflow), hints, overflow })
  const sentAny = cards.some(isSent)
  const hasSteps = cur.awaiting !== undefined && cur.awaiting.steps.length > 0
  const hintsOf = (): string => (m.notice?.kind === 'changed' ? HINT.changed : sentAny ? HINT.sentSome(at + 1) : hasSteps ? HINT.awaiting : HINT.normal)
  const questionRow = MARK_CUR + ' ' + oneLine(cur.question)
  const noteRow = curNote === null ? [] : wrapReply(`  m ${T.noteLabel}：${oneLine(curNote)}`)

  if (m.textMode) {
    const body = wrapTo((m.textBuf) + TEXT_CURSOR, BAND_REPLY_COLS - 2).map(r => '  ' + r)
    return out(T.noteTitle, [questionRow, T.noteHead, ...body, T.noteTyping], HINT.note)
  }
  if (m.armed) {
    const ready = cards.map((c, i) => ({ c, i })).filter(({ c }) => !isSent(c) && pickOf(c) !== undefined)
    const rows: string[] = [T.previewHead(ready.length, ready.map(r => r.i + 1))]
    for (const { c, i } of ready) {
      const p = pickOf(c) as number
      const o = c.options[p]
      rows.push(`${i + 1} ${c.title}${questionAfterTitle(c.title, oneLine(c.question))}`, `   ${ARROW} ${letterOf(c, p)} ${o.label}${o.detail !== '' ? '：' + o.detail : ''}`)
      if ((m.notes[c.id] ?? '').trim() !== '') rows.push(`   ${T.noteLabel}：${oneLine(m.notes[c.id])}`)
    }
    if (rows.length > BAND_BODY_ROWS) {
      overflow.steps = rows.slice(BAND_BODY_ROWS - 1)
      rows.splice(BAND_BODY_ROWS - 1, rows.length, T.previewRest(overflow.steps.length))
    }
    return { stepTitle: T.previewTitle, list, reply: rows, hints: HINT.preview, overflow }
  }

  const n = m.notice
  const head: string[] = []
  let showQuestion = true
  let title: string
  if (n !== null) {
    title = T.noticeTitle[n.kind]
    if (n.kind === 'sent') head.push(T.sent(n.n, n.at, n.receipt), T.sentRest)
    else if (n.kind === 'failed') head.push(T.failed(n.reason, n.n), T.failedRest)
    else if (n.kind === 'cancelled') head.push(T.cancelled)
    else if (n.kind === 'changed') { head.push(T.changed(n.n, n.what), T.changedRest); showQuestion = false }
    else if (n.kind === 'filled') { head.push(T.filled(n.filled), T.filledKept(n.kept, n.blocked), T.filledNext); showQuestion = false }
    else head.push(T.back(n.n))
  } else if (curPick === undefined && curNote === null && !hasSteps) {
    // a pick that is not the recommendation, while this card is still open: say what f would do
    const idx = cards.findIndex(c => { const p = pickOf(c); return p !== undefined && !isSent(c) && c.options.some(o => o.recommended) && !c.options[p].recommended })
    if (idx >= 0) {
      const c = cards[idx]
      const p = pickOf(c) as number
      const r = c.options.findIndex(o => o.recommended)
      head.push(T.fillHead(pickedN, idx + 1, letterOf(c, p), c.options[p].label, letterOf(c, r)), T.fillRule)
      title = T.titleFillBefore
    } else title = ''
  } else title = ''
  if (title === '') {
    if (hasSteps) {
      title = curPick !== undefined ? T.titleAwaitPicked(cur.awaiting?.label ?? '步驟', letterOf(cur, curPick)) : T.titleAwait + (awaitingRows(cur.awaiting?.steps ?? []).length >= 5 ? T.titleAwaitLong : '')
    } else if (curPick !== undefined || curNote !== null) {
      title = T.titleOpen(at + 1, [...(curPick !== undefined ? [T.openPick(letterOf(cur, curPick))] : []), ...(curNote !== null ? [T.openNote] : [])])
    } else title = ''
  }

  const body: string[] = []
  if (showQuestion) body.push(questionRow)
  let stepRows: string[] = []
  if (showQuestion) {
    if (hasSteps) stepRows = awaitingRows((cur.awaiting as { steps: string[] }).steps)
    else if (cur.background !== null && cur.background.trim() !== '') stepRows = cur.background.split('\n').map(l => '  ' + l.trimEnd())
  }
  const opts = optionRows(cur, curPick)
  const tail = [...noteRow]
  if (n === null && head.length === 0 && curPick === undefined && curNote === null && !hasSteps && stepRows.length === 0) {
    tail.push(pickedN === 0 ? T.sNone(unsent) : T.sSome(pickedN, unsent - pickedN))
  }
  if (title === '') {
    title = hasSteps ? T.titleAwait + (stepRows.length >= 5 ? T.titleAwaitLong : '')
      : stepRows.length > 0 ? (cards.length > BAND_BODY_ROWS ? T.titleOf(cards.length, at + 1) : T.titleOne(at + 1)) + T.titleBg
      : cards.length > BAND_BODY_ROWS ? T.titleOf(cards.length, at + 1) : T.titleOne(at + 1)
  }
  // 12 rows: the steps after the question move to the pane and the band keeps the question and the options
  const rows = [...head, ...body, ...stepRows, ...opts, ...tail]
  if (rows.length > BAND_BODY_ROWS && stepRows.length > 0 && opts.length > 0) {
    overflow.steps = stepRows
    return { stepTitle: title, list, reply: [...head, ...body, T.stepsInPane, ...opts, ...tail], hints: hintsOf(), overflow }
  }
  return { stepTitle: title, list, reply: rows, hints: hintsOf(), overflow }
}

// the band cuts what is left past 12 rows to `…` (band.ts limitRows); nothing else to do here, kept as one place for the reply
function fitReply(rows: string[], _overflow: WideDecideOverflow): string[] {
  return rows
}

// C1-C3 (cross-page): another page is shown while a card is open. The band keeps the open card's state one line away: `看完艦隊按 2 回待決：第 2 張、選的 b 和附註都還在。`
export function wideCrossNote(page: string, open: { n: number; pick: string | null; note: boolean }): { stepTitle: string; reply: string[] } | null {
  if (open.pick === null && !open.note) return null
  const what = open.pick !== null ? T.crossPick(open.pick) + (open.note ? ' 和' + T.crossNote : ' ') : T.crossNote
  return { stepTitle: T.crossTitle(page), reply: [T.cross(page, open.n, what)] }
}
export { clipTo }
