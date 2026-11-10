// mods/live/askpm.ts — the operator's questions to the PM, and the PM's replies.
// Pure: rows from askpm.jsonl (written by hooks/askpm-log.js) become a view model, then lines.
// Panel placement is paused. askpmLines is what a later page calls; it does not replace the card queue.
// No clock, no file, no `$`.

import type { PaneLine } from './model'
import * as ui from './ui'
import type { Ctx } from './ui'

export const ASKPM_SCHEMA = 'autopilot.askpm/1'
export const ASKPM_SECTION = 'sec:askpm'
export const ASKPM_WIDE_COLS = 100
const WIDE_LIMIT = 5
const NARROW_LIMIT = 3
const SUMMARY_CHARS = 40
const WAIT_MARK = '等回報：'
const DONE_MARK = '已回報：'

export type AskRecord = { schema?: string; kind: 'ask' | 'reply'; at: string; text?: string; lines?: string[] }
export type AskStatus = 'replied' | 'waiting' | 'open'
export type AskEntry = { at: string; summary: string; replyLines: string[]; status: AskStatus }
export type AskpmModel = { entries: AskEntry[]; limit: number; narrow: boolean }

// Taipei, UTC+8, no zone suffix. The same string a later reply quotes after 已回報：.
export function taipeiStamp(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const t = new Date(ms + 8 * 3600 * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`
}

function summaryOf(text: string): string {
  return Array.from(text.replace(/[\r\n]+/g, ' ').trim()).slice(0, SUMMARY_CHARS).join('')
}

function replyText(r: AskRecord): string {
  return typeof r.text === 'string' ? r.text : Array.isArray(r.lines) ? r.lines.join('\n') : ''
}

function shownLines(r: AskRecord): string[] {
  if (Array.isArray(r.lines) && r.lines.length > 0) return r.lines.slice(0, 2)
  return replyText(r).replace(/\r\n/g, '\n').split('\n').slice(0, 2)
}

export function parseAskpm(raw: string | null | undefined): AskRecord[] {
  if (typeof raw !== 'string' || raw === '') return []
  const out: AskRecord[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let v: unknown
    try { v = JSON.parse(line) } catch { continue }
    if (v === null || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    if ((o.kind !== 'ask' && o.kind !== 'reply') || typeof o.at !== 'string') continue
    const rec: AskRecord = { kind: o.kind, at: o.at }
    if (typeof o.schema === 'string') rec.schema = o.schema
    if (typeof o.text === 'string') rec.text = o.text
    if (Array.isArray(o.lines)) rec.lines = o.lines.filter((x): x is string => typeof x === 'string')
    out.push(rec)
  }
  return out
}

// Status is decided over the whole log, then the window keeps the newest asks (5, or 3 when narrow).
// A reply's own 等回報 stays waiting until a strictly later reply contains 已回報： plus this ask's Taipei time.
export function askpmView(rows: readonly AskRecord[], opts: { narrow?: boolean; cols?: number } = {}): AskpmModel {
  const cols = typeof opts.cols === 'number' ? opts.cols : ASKPM_WIDE_COLS
  const narrow = opts.narrow === true || cols < ASKPM_WIDE_COLS
  const limit = narrow ? NARROW_LIMIT : WIDE_LIMIT
  const asks = rows.map((r, i) => ({ r, i })).filter((x) => x.r.kind === 'ask')
  const replies = rows.map((r, i) => ({ r, i })).filter((x) => x.r.kind === 'reply')
  const entries: AskEntry[] = asks.map((a, n) => {
    const next = asks[n + 1]
    const own = replies.find((x) => x.i > a.i && (next === undefined || x.i < next.i))
    const at = taipeiStamp(a.r.at)
    let status: AskStatus = 'open'
    if (own !== undefined) {
      const waiting = replyText(own.r).replace(/\r\n/g, '\n').split('\n').some((l) => l.startsWith(WAIT_MARK))
      status = 'replied'
      if (waiting) {
        const mark = DONE_MARK + at
        status = replies.some((x) => x.i > own.i && replyText(x.r).includes(mark)) ? 'replied' : 'waiting'
      }
    }
    return { at, summary: summaryOf(typeof a.r.text === 'string' ? a.r.text : ''), replyLines: own === undefined ? [] : shownLines(own.r), status }
  })
  return { entries: entries.slice(-limit), limit, narrow }
}

export function askpmLines(view: AskpmModel, u: Ctx, folded?: ReadonlySet<string>): PaneLine[] {
  const open = ui.sectionOpen(folded, ASKPM_SECTION)
  const lines: PaneLine[] = [ui.header(u, u.t('askpm.title'), { id: ASKPM_SECTION, open }, { fact: 'decide.cards' })]
  if (!open) return lines
  for (const e of view.entries) {
    const status = e.status === 'waiting' ? u.t('askpm.waiting') : e.status === 'replied' ? u.t('askpm.replied') : u.t('askpm.reply_empty')
    // Status is its own row: the summary row's meta is the clock, and a narrow column drops the last meta part first.
    lines.push(ui.bullet(u, e.summary, [{ text: e.at, fmt: 'clock' }], { fact: 'decide.cards' }))
    lines.push(ui.bullet(u, status, undefined, { fact: 'decide.cards' }))
    if (e.status === 'open') continue
    for (const line of e.replyLines) if (line !== '') lines.push(ui.bullet(u, line, undefined, { fact: 'decide.cards' }))
  }
  return lines
}

// Columns the ask column takes when it sits beside the queue. 0 when the panel stacks it underneath.
export function askpmSideCols(cols: number, narrow: boolean): number {
  if (narrow) return 0
  return Math.min(48, Math.max(32, Math.floor(cols * 0.4)))
}
