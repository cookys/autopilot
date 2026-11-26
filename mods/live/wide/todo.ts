// mods/live/wide/todo.ts — console v5 wide 8 待辦 page. Pure: TodoCard[] -> WideBand fields & pane summary.
import { dueText } from '../pages/todo'
import { PICK_KEYS } from '../v74/contract'
import type { TodoCard } from '../v74/contract'
import { GLYPHS } from '../../tux/glyphs'
import { displayWidth } from '../model'
import type { WidePageOut } from './types'

export type WideTodoInput = {
  todo: TodoCard[] | null
  cursor: number
  picks: Record<string, number>
  notes: Record<string, string>
  stale?: boolean
  // the design's states beyond the plain rows (P5a); all optional
  label?: string // the state label of the title
  staleNote?: string // after the list heading, e.g. `（30 分鐘前）`
  movedNote?: string // the note written when the card moved here, drawn under the options
  missingNote?: string[] // the source has no wiring: the words of the reply column
  emptyNote?: string // no cards: the words of the reply column
  detail?: string[] // the pane's context rows
  warnings?: string[] // fixed warning rows (source missing / stale)
}

const REPLY_COLS = 73 // the band's reply column

// break a row at the column width; the continuation rows are indented by `hang`
function wrapRow(text: string, hang: number): string[] {
  const out: string[] = []
  let cur = ''
  let w = 0
  for (const ch of text) {
    const cw = displayWidth(ch)
    if (w + cw > REPLY_COLS) {
      out.push(cur)
      cur = ' '.repeat(hang)
      w = hang
    }
    cur += ch
    w += cw
  }
  out.push(cur)
  return out
}

const FOLDED = GLYPHS.structure.folded

export function wideTodo(inp: WideTodoInput): WidePageOut {
  const { todo, cursor, picks, notes, stale } = inp
  const extra = { pin: inp.warnings ?? [], ctx: inp.detail ?? [] }
  if (todo === null) {
    return {
      stepTitle: inp.label ?? '缺源（還沒接線）',
      list: ['待辦', '  待辦還沒接線'],
      reply: inp.missingNote ?? ['待辦資料來源尚未接線（fleet todo）。'],
      hints: 'Esc 關閉',
      summary: null,
      hist: null,
      ...extra,
    }
  }
  if (todo.length === 0) {
    return {
      stepTitle: inp.label ?? '沒有待辦',
      list: ['待辦 0 張', '  沒有待辦'],
      reply: [inp.emptyNote ?? '目前沒有待辦卡片。'],
      hints: 'Esc 關閉',
      summary: '0 張',
      hist: null,
      ...extra,
    }
  }

  const idx = Math.max(0, Math.min(todo.length - 1, cursor))
  const cur = todo[idx]
  const n = todo.length
  const list = [
    `待辦 ${n} 張${inp.staleNote ?? ''}`,
    ...todo.map((c, i) => `${i === idx ? FOLDED : ' '} ${dueText(c.dueMs) ?? '--'} ${c.title}`),
  ]

  const picked = picks[cur.id]
  const note = notes[cur.id] ?? ''
  const opts = cur.options.slice(0, PICK_KEYS.length)
  const pad = Math.max(...opts.map(o => displayWidth(o.label)))
  const recW = displayWidth(`${GLYPHS.structure.recommend} 建議`)
  const reply: string[] = [
    ...wrapRow(`${FOLDED} ${cur.question}`, 0),
    ...opts.flatMap((o, i) => {
      const rec = o.recommended ? `${GLYPHS.structure.recommend} 建議` : ' '.repeat(recW)
      const mark = picked === i ? `${GLYPHS.state.done} ` : '  '
      const head = `  ${mark}${PICK_KEYS[i]}: ${o.label}${' '.repeat(pad - displayWidth(o.label))}  ${rec}  `
      return wrapRow(head + o.detail, displayWidth(head))
    }),
    ...(inp.movedNote !== undefined ? [`附註（移來時寫的）：${inp.movedNote}`] : []),
    ...(note !== '' ? [`附註：${note}`] : []),
  ]

  return {
    stepTitle: inp.label ?? (stale ? '過時' : '正常'),
    list,
    reply,
    hints: 'a/b/c 選 · j/k 換筆 · Esc 關閉',
    summary: `${n} 張`,
    hist: null,
    ...extra,
  }
}
