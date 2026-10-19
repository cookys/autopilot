// mods/roundtable/model.ts — pure room log display. No engine value in here.
// Imports a function from the live design system (cell width). Syntax is erasable so node --test can load this file.
// A trailing line with no newline is partial and ignored. A line that is not one valid row is skipped.

import { cellWidth } from '../live/ui.ts'

export type RoomKind = 'say' | 'relay' | 'system'
export type LineRole = 'here' | 'attention' | 'broken' | 'text' | 'structure'

export type RoomRow = {
  ts: string
  room: string
  seq: number
  from: string
  kind: RoomKind
  text: string
  reply_to: number | null
  round?: number
  to?: string[]
}

export type DisplayLine = { text: string; role: LineRole }

const KINDS = new Set<string>(['say', 'relay', 'system'])

function isRow(v: unknown): v is RoomRow {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.ts !== 'string' || typeof o.room !== 'string') return false
  if (typeof o.seq !== 'number' || !Number.isInteger(o.seq)) return false
  if (typeof o.from !== 'string' || typeof o.text !== 'string') return false
  if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) return false
  if (o.reply_to !== null && (typeof o.reply_to !== 'number' || !Number.isInteger(o.reply_to))) return false
  return true
}

// Complete lines only: a file that does not end in a newline drops the trailing partial line. Blank lines and bad JSON are skipped.
export function parseRoomLog(text: string): RoomRow[] {
  const rows: RoomRow[] = []
  if (!text) return rows
  const end = text.endsWith('\n') ? text.length - 1 : text.lastIndexOf('\n')
  if (end < 0) return rows
  const body = text.slice(0, end)
  if (!body) return rows
  for (const line of body.split('\n')) {
    if (line === '') continue
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    if (!isRow(parsed)) continue
    rows.push(parsed)
  }
  return rows
}

// Owner rows are "you are here". A system row is attention, except a send failure, which is broken. Seat and relay rows stay default text.
export function rowRole(row: RoomRow): LineRole {
  if (row.kind === 'system' && row.text.includes('send failed')) return 'broken'
  if (row.kind === 'system') return 'attention'
  if (row.from === 'owner') return 'here'
  return 'text'
}

// Wrap on display cells. A character wider than the remaining room starts the next line. A character wider than the whole width stays whole on its own line.
export function wrapToWidth(text: string, width: number): string[] {
  if (text === '') return ['']
  if (width < 1) return [text]
  const out: string[] = []
  let line = ''
  let used = 0
  for (const ch of text) {
    const cw = cellWidth(ch.codePointAt(0) as number)
    if (cw > width) {
      if (line !== '') { out.push(line); line = ''; used = 0 }
      out.push(ch)
      continue
    }
    if (used + cw > width) { out.push(line); line = ch; used = cw; continue }
    line += ch
    used += cw
  }
  if (line !== '') out.push(line)
  return out
}

function headerOf(row: RoomRow): string {
  const base = row.seq + ' ' + row.from + ' ' + row.kind
  return typeof row.round === 'number' ? base + ' round ' + row.round : base
}

// One header line (wrapped) and the text indented by two cells. A rule separates rows. Nothing is wider than `width` when width >= 2.
export function displayLines(rows: readonly RoomRow[], width: number): DisplayLine[] {
  const out: DisplayLine[] = []
  const wide = Math.max(width, 1)
  rows.forEach((row, i) => {
    if (i > 0) out.push({ text: '-'.repeat(Math.min(wide, 20)), role: 'structure' })
    const role = rowRole(row)
    for (const l of wrapToWidth(headerOf(row), wide)) out.push({ text: l, role })
    const inner = Math.max(1, wide - 2)
    for (const part of row.text.split('\n')) {
      for (const l of wrapToWidth(part, inner)) out.push({ text: '  ' + l, role })
    }
  })
  return out
}

export function visibleLines<T>(lines: readonly T[], offset: number, room: number): T[] {
  const size = Math.max(room, 0)
  if (size === 0) return []
  const max = Math.max(0, lines.length - size)
  const start = Math.max(0, Math.min(offset, max))
  return lines.slice(start, start + size)
}

// When the previous offset sat on the bottom, the next offset sits on the new bottom. An offset above the bottom is kept and clamped.
export function nextOffset(offset: number, prevCount: number, nextCount: number, room: number): number {
  const size = Math.max(room, 0)
  const prevMax = Math.max(0, prevCount - size)
  const nextMax = Math.max(0, nextCount - size)
  const atBottom = offset >= prevMax
  const kept = atBottom ? nextMax : offset
  return Math.max(0, Math.min(nextMax, kept))
}
