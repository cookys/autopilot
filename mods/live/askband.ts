import type { AskRow } from './v74/feeds'
import type { Seg } from './model'
import { displayWidth, truncateToWidth } from './model'
import type { Row } from './pages/rows'
import { PALETTE } from '../tux/palette.ts'

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const WIDE_COLS = 100
const MAX_WIDE_ITEMS = 4
const MAX_NARROW_ITEMS = 3

const pad2 = (n: number): string => (n < 10 ? '0' + String(n) : String(n))

function formatTaipeiTime(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '-- --:--'
  const d = new Date(ms + TAIPEI_OFFSET_MS)
  const mm = pad2(d.getUTCMonth() + 1)
  const dd = pad2(d.getUTCDate())
  const hh = pad2(d.getUTCHours())
  const min = pad2(d.getUTCMinutes())
  return `${mm}-${dd} ${hh}:${min}`
}

function firstLine(s: string | null): string {
  if (s === null) return ''
  const line = s.split(/\r?\n/).map(l => l.trim()).find(l => l !== '')
  return line ?? ''
}

function summarize(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

function clipRow(row: Row, cols: number): Row {
  if (cols <= 0) return [{ text: '' }]
  const out: Row = []
  let used = 0
  for (const s of row) {
    const w = displayWidth(s.text)
    if (used + w <= cols) {
      out.push(s)
      used += w
      continue
    }
    const room = cols - used
    if (room > 0) {
      out.push({ ...s, text: truncateToWidth(s.text, room) })
    }
    break
  }
  return out.length === 0 ? [{ text: '' }] : out
}

function formatSecondRowItem(r: AskRow): string {
  const time = formatTaipeiTime(r.at)
  const ask = summarize(r.ask)
  const ans = firstLine(r.answer)
  const ansText = ans !== '' ? ans : '（尚無答案）'
  return `${time} ${r.status} ${ask} ＞ ${ansText}`
}

function formatWideItem(r: AskRow, budget: number): string {
  const time = formatTaipeiTime(r.at).slice(6)
  const status = r.status
  const ans = firstLine(r.answer)
  const ansText = ans !== '' ? ans : '無答案'
  const room = Math.max(0, budget - displayWidth(time) - 1 - displayWidth(status) - 1 - 2)
  const askRoom = Math.ceil(room / 2)
  return `${time} ${status} ${truncateToWidth(summarize(r.ask), askRoom)}＞${truncateToWidth(ansText, room - askRoom)}`
}

export function askBandRows(rows: AskRow[], cols: number, _nowMs: number): Row[] {
  if (rows.length === 0) return []

  const unanswered = rows.filter(r => r.status === '未答').length
  const latest = rows[0]
  const latestTime = formatTaipeiTime(latest.at)
  const latestAsk = summarize(latest.ask)

  const row1: Row = [
    { text: '我問：' },
    { text: `${unanswered} 未答`, color: PALETTE.attention },
    { text: ` ｜ ${latestTime} ${latest.status} ${latestAsk}` },
  ]

  const result: Row[] = [clipRow(row1, cols)]

  if (rows.length >= 2) {
    const isWide = cols >= WIDE_COLS
    const maxItems = isWide ? MAX_WIDE_ITEMS : MAX_NARROW_ITEMS
    const candidates = isWide ? [] : rows.slice(1, 1 + maxItems).map(formatSecondRowItem)

    if (isWide) {
      // four items must all fit the row: each gets an equal share of the width, split between the ask and the answer
      const picked = rows.slice(1, 1 + maxItems)
      const gap = 2
      const budget = Math.floor((cols - gap * (picked.length - 1)) / picked.length)
      const items = picked.map(r => formatWideItem(r, budget))
      result.push(clipRow([{ text: items.join('　') }], cols))
    } else {
      let line = ''
      for (const item of candidates) {
        const next = line === '' ? item : `${line}　${item}`
        if (line !== '' && displayWidth(next) > cols) break
        line = next
      }
      result.push(clipRow([{ text: line }], cols))
    }
  }

  return result
}
