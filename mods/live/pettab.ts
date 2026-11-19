// mods/live/pettab.ts — page 9 (寵物 / pet) body builder (shared-TUI §6, g2-folds A6):
// Draws icon (2-cell emoji on >= 80 cols, 2-char ASCII fallback from GLYPHS.pet.icons on < 80 cols),
// title, half-block raster sprite rows (no Image), and stat rows from pet.tiers, bottom-anchored
// inside frameRows. Reads ONLY readPet(raw).pet from panel.ts; invalid/absent data renders a single
// localized "no pet data" line and never crashes.
// Syntax is erasable and every runtime import carries `.ts`, so `node --test` loads this file directly.

import type { T } from './i18n.ts'
import type { Seg } from './model.ts'
import type { Page, Row } from './pages/frame.ts'
import { readPet } from './panel.ts'
import type { PanelLine, PetIconEntry } from './panel.ts'
import { GLYPHS } from '../tux/glyphs.ts'
import { PALETTE } from '../tux/palette.ts'
import { displayWidth } from '../tux/width.ts'

const TONE_STYLE: Record<string, Partial<Seg>> = {
  subtle: { color: PALETTE.structure },
  inactive: { color: PALETTE.idle },
  dim: { dim: true },
  success: { color: PALETTE.done },
}

const lineSegs = (row: PanelLine): Row =>
  row.map(p => ({ text: p.text, ...(p.tone === undefined ? {} : (TONE_STYLE[p.tone] ?? {})) }))

/** Returns the 2-cell label to draw for a validated icon tuple: whitelist fallback when cols < 80, else payload text. */
export function petIconLabel(icon: PetIconEntry, cols: number): string {
  const icons = GLYPHS.pet.icons
  if (!Object.hasOwn(icons, icon.id)) return ''
  const entry = icons[icon.id]
  return cols < 80 ? entry.fallback : icon.text
}

/** Largest tier key not exceeding `cols`, falling back to the smallest available tier when narrower. */
export function pickPetTier(tiers: Record<string, PanelLine[]> | null, cols: number): PanelLine[] | null {
  if (tiers === null) return null
  let best = -1
  for (const k of Object.keys(tiers)) {
    const n = Number(k)
    if (Number.isFinite(n) && n <= cols && n > best) best = n
  }
  if (best >= 0) return tiers[String(best)]
  const keys = Object.keys(tiers).map(Number).filter(Number.isFinite)
  return keys.length === 0 ? null : tiers[String(Math.min(...keys))]
}

/** Builds page 9 body and actions from a raw panel payload via readPet().pet only. */
export function renderPet(raw: unknown, cols: number, t: T): { body: Row[]; actions: Row[] } {
  const { pet } = readPet(raw)
  if (pet === null) return { body: [[{ text: t('page.pet.none'), dim: true }]], actions: [] }
  const label = petIconLabel(pet.icon, cols)
  if (displayWidth(label) !== 2) return { body: [[{ text: t('page.pet.none'), dim: true }]], actions: [] }
  const head: Row = [{ text: pet.title !== '' ? label + ' ' + pet.title : label }]
  const sprite: Row[] = (pet.sprite ?? []).map(lineSegs)
  const stats: Row[] = (pickPetTier(pet.tiers, Math.max(1, cols)) ?? []).map(lineSegs)
  return { body: [head, ...sprite, ...stats], actions: [] }
}

export const petPage: Page = {
  id: 'pet',
  key: '9',
  title: '寵物',
  framed: true,
  render: ctx => renderPet(ctx.pet, ctx.size.cols, ctx.t),
}
