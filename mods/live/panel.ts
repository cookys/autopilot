// mods/live/panel.ts — the sole reader of codeforge's `forge-stats.panel` (`codeforge.panel/1`).
// Moves panel parsing out of shell.ts (tux-guidelines L19 / shared-TUI §6): exposes ONLY two exits:
//   - readPet(): returns `{ pet }` only (used by pettab.ts; ignores `usage` / `side`)
//   - readLegacyUsage(): transitional whitelist for shell.ts usageRows / shellPlan until P6b removes it.
// Syntax is erasable and every runtime import carries `.ts`, so `node --test` loads this file directly.

import { GLYPHS } from '../tux/glyphs.ts'
import { PANEL_SCHEMA, PANEL_TONES } from '../tux/contracts/panel.ts'

export { PANEL_SCHEMA, PANEL_TONES, PANEL_TIER_KEYS } from '../tux/contracts/panel.ts'
export type { PanelLine, Tiers, SideData, PanelRead, PetIconEntry, PetPanel, PetRead } from '../tux/contracts/panel.ts'

export const STALE_MS = 60_000

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const clean = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '')
const TONES = new Set<string>(PANEL_TONES)

function lineOf(v: unknown): PanelLine | null {
  if (!Array.isArray(v)) return null
  const parts: PanelLine = []
  for (const p of v) {
    if (!isObj(p) || typeof p.text !== 'string') return null
    parts.push(typeof p.tone === 'string' && TONES.has(p.tone) ? { text: clean(p.text), tone: p.tone } : { text: clean(p.text) })
  }
  return parts
}

function tiersOf(v: unknown, noMoney = false): Tiers | null {
  if (!isObj(v) || !isObj(v.tiers)) return null
  const out: Tiers = {}
  for (const [k, raw] of Object.entries(v.tiers)) {
    if (!/^\d+$/.test(k) || !Array.isArray(raw)) continue
    const rows: PanelLine[] = []
    let ok = true
    for (const r of raw) { const l = lineOf(r); if (l === null) { ok = false; break } rows.push(l) }
    if (ok) out[k] = noMoney ? rows.filter(r => !r.some(p => p.text.includes('$'))) : rows
  }
  return Object.keys(out).length === 0 ? null : out
}

function pixelOn(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '' || v === ' ') return false
  return true
}

// keepBlank (SpriteData frames only): a row pair with no lit cell stays as an empty line, so the
// output is exactly ceil(height/2) rows; other callers drop blank rows.
function rasterRowsFromPixels(grid: unknown[], keepBlank = false): PanelLine[] | null {
  if (grid.length === 0 || !grid.every(r => Array.isArray(r))) return null
  const [TOP, BOT, FULL] = [String.fromCodePoint(0x2580), String.fromCodePoint(0x2584), String.fromCodePoint(0x2588)]
  const out: PanelLine[] = []
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y] as unknown[]
    const bot = (y + 1 < grid.length ? grid[y + 1] : []) as unknown[]
    const w = Math.max(top.length, bot.length)
    let line = ''
    for (let x = 0; x < w; x++) {
      const a = pixelOn(top[x])
      const b = pixelOn(bot[x])
      line += a && b ? FULL : a ? TOP : b ? BOT : ' '
    }
    const trimmed = line.replace(/\s+$/, '')
    if (trimmed !== '') out.push([{ text: clean(trimmed) }])
    else if (keepBlank) out.push([{ text: '' }])
  }
  return out.length === 0 ? null : out
}

function spriteLinesOf(raw: unknown): PanelLine[] | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    const rows = raw.split('\n').map(clean).filter(s => s !== '')
    return rows.length === 0 ? null : rows.map(s => [{ text: s }])
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null
    if (raw.every(r => typeof r === 'string')) {
      const rows = (raw as string[]).map(clean).filter(s => s !== '')
      return rows.length === 0 ? null : rows.map(s => [{ text: s }])
    }
    const out: PanelLine[] = []
    for (const r of raw) {
      const l = lineOf(r)
      if (l === null) return null
      out.push(l)
    }
    return out.length === 0 ? null : out
  }
  if (isObj(raw)) {
    if (raw.lines !== undefined) return spriteLinesOf(raw.lines)
    if (raw.rows !== undefined) return spriteLinesOf(raw.rows)
    if (Array.isArray(raw.pixels)) return rasterRowsFromPixels(raw.pixels)
    if (Array.isArray(raw.grid)) return rasterRowsFromPixels(raw.grid)
    if (Array.isArray(raw.frames)) return spriteFrameLines(raw)
  }
  return null
}

// forge-stats SpriteData: frames[0] only; a cell equal to `transparent` is off, any other char is lit.
// Palette colour is not used. Any shape mismatch (width/height, row length, row count) gives null.
function spriteFrameLines(raw: Record<string, unknown>): PanelLine[] | null {
  const { width, height, transparent, frames } = raw
  if (!Number.isInteger(width) || !Number.isInteger(height) || typeof transparent !== 'string') return null
  const w = width as number
  const h = height as number
  if (w < 1 || h < 1 || !Array.isArray(frames) || frames.length === 0) return null
  const frame = frames[0]
  if (!Array.isArray(frame) || frame.length !== h) return null
  const grid: boolean[][] = []
  for (const row of frame) {
    if (typeof row !== 'string') return null
    const cells = Array.from(row)
    if (cells.length !== w) return null
    grid.push(cells.map(c => c !== transparent))
  }
  return rasterRowsFromPixels(grid, true)
}

function matchPetIcon(raw: unknown): PetIconEntry | null {
  if (!isObj(raw)) return null
  const { id, emoji, fallback, text } = raw
  if (typeof id !== 'string' || typeof emoji !== 'string' || typeof fallback !== 'string' || typeof text !== 'string') return null
  const icons = GLYPHS.pet.icons
  if (!Object.hasOwn(icons, id)) return null
  const entry = icons[id]
  if (emoji !== entry.emoji || fallback !== entry.fallback) return null
  if (text !== entry.emoji && text !== entry.fallback) return null
  return { id: entry.id, emoji: entry.emoji, fallback: entry.fallback, text }
}

/**
 * Exit 1 (pettab.ts only): reads only `schema` and `pet`, validates the whole icon tuple
 * `{id, emoji, fallback, text}` against a single GLYPHS.pet.icons entry, and never reads
 * or returns `usage` or `side`.
 */
export function readPet(value: unknown): PetRead {
  if (!isObj(value) || value.schema !== PANEL_SCHEMA) return { pet: null }
  const p = value.pet
  if (!isObj(p)) return { pet: null }
  const icon = matchPetIcon(p.icon)
  if (icon === null) return { pet: null }
  const title = typeof p.title === 'string' ? clean(p.title) : ''
  const sprite = spriteLinesOf(p.sprite)
  const tiers = isObj(p.tiers) ? tiersOf('tiers' in p.tiers ? p.tiers : { tiers: p.tiers }) : null
  return { pet: { title, sprite, tiers, icon } }
}

/**
 * Exit 2 (P6b transitional whitelist, shell.ts only): reads `side` and `usage` from a
 * `codeforge.panel/1` payload while dropping any `$` money rows.
 */
export function readLegacyUsage(value: unknown, nowMs: number): PanelRead {
  if (value === null || value === undefined) return { status: 'absent', ageMs: null, side: null, usage: null }
  if (!isObj(value)) return { status: 'bad', ageMs: null, side: null, usage: null }
  if (value.schema !== PANEL_SCHEMA) return { status: 'old', ageMs: null, side: null, usage: null }
  const at = value.updated_at_ms
  const ageMs = typeof at === 'number' && Number.isFinite(at) ? Math.max(0, nowMs - at) : null
  const usage = tiersOf(value.usage, true)
  const s = value.side
  if (!isObj(s) || JSON.stringify(s).includes('$')) return { status: 'ok', ageMs, side: null, usage }
  const side = { usage: tiersOf(s.usage), usageFull: tiersOf(s.usage_full), memory: tiersOf(s.memory) }
  return { status: 'ok', ageMs, side: side.usage === null && side.usageFull === null && side.memory === null ? null : side, usage }
}
