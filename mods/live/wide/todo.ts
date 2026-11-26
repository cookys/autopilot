// mods/live/wide/todo.ts — console v5 wide 8 待辦 page. Pure: TodoCard[] -> WideBand fields & pane summary.
import { dueText } from '../pages/todo'
import { PICK_KEYS } from '../v74/contract'
import type { TodoCard } from '../v74/contract'
import { GLYPHS } from '../../tux/glyphs'
import type { WidePageOut } from './types'

export type WideTodoInput = {
  todo: TodoCard[] | null
  cursor: number
  picks: Record<string, number>
  notes: Record<string, string>
  stale?: boolean
}

const FOLDED = GLYPHS.structure.folded

export function wideTodo(inp: WideTodoInput): WidePageOut {
  const { todo, cursor, picks, notes, stale } = inp
  if (todo === null) {
    return {
      stepTitle: '缺源（還沒接線）',
      list: ['讀不到待辦資料'],
      reply: ['待辦資料來源尚未接線（fleet todo）。'],
      hints: 'Esc 關閉',
      summary: null,
      hist: null,
    }
  }
  if (todo.length === 0) {
    return {
      stepTitle: '沒有待辦',
      list: ['待辦 0 張'],
      reply: ['目前沒有待辦卡片。'],
      hints: 'Esc 關閉',
      summary: '0 張',
      hist: null,
    }
  }

  const idx = Math.max(0, Math.min(todo.length - 1, cursor))
  const cur = todo[idx]
  const list = [
    `待辦 ${todo.length} 張`,
    ...todo.map((c, i) => `${i === idx ? FOLDED : ' '} ${dueText(c.dueMs) ?? '--'} ${c.title}`),
  ]

  const picked = picks[cur.id]
  const note = notes[cur.id] ?? ''
  const reply: string[] = [
    `${FOLDED} ${cur.question}`,
    ...cur.options.slice(0, PICK_KEYS.length).map((o, i) => {
      const rec = o.recommended ? `  ${GLYPHS.structure.recommend} 建議` : ''
      const mark = picked === i ? `${GLYPHS.state.done} ` : '  '
      return `  ${mark}${PICK_KEYS[i]}: ${o.label}${rec}`
    }),
    ...(note !== '' ? [`附註：${note}`] : []),
  ]

  return {
    stepTitle: stale ? '過時' : '正常',
    list,
    reply,
    hints: 'a/b/c 選 · j/k 換筆 · Esc 關閉',
    summary: `${todo.length} 張`,
    hist: null,
  }
}
