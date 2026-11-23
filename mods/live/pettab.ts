// mods/live/pettab.ts — page 9 (寵物 / pet) body builder (shared-TUI §6, g2-folds A6):
// Draws icon (2-cell emoji on >= 80 cols, 2-char ASCII fallback from GLYPHS.pet.icons on < 80 cols),
// title, half-block raster sprite rows (no Image), and stat rows from pet.tiers, bottom-anchored
// inside frameRows. Reads ONLY readPet(raw).pet from panel.ts; invalid/absent data renders a single
// localized "no pet data" line and never crashes (with source/reason detail when opts.detail is true).
// Syntax is erasable and every runtime import carries `.ts`, so `node --test` loads this file directly.

import type { T } from './i18n.ts'
import type { Seg } from './model.ts'
import type { Page, Row } from './pages/frame.ts'
import { PANEL_SCHEMA, STALE_MS, readPet } from './panel.ts'
import type { PanelLine, PetIconEntry } from './panel.ts'
import { GLYPHS } from '../tux/glyphs.ts'
import { PALETTE } from '../tux/palette.ts'
import { displayWidth } from '../tux/width.ts'

export type PetMissingReason = 'absent' | 'bad_shape' | 'bad_schema' | 'no_pet' | 'bad_icon'
export type RenderPetOpts = { detail?: boolean; nowMs?: number }

const TONE_STYLE: Record<string, Partial<Seg>> = {
  subtle: { color: PALETTE.structure },
  inactive: { color: PALETTE.idle },
  dim: { dim: true },
  success: { color: PALETTE.done },
}

const lineSegs = (row: PanelLine): Row =>
  row.map(p => ({ text: p.text, ...(p.tone === undefined ? {} : (TONE_STYLE[p.tone] ?? {})) }))

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Classifies why a raw panel payload yielded no valid pet (without reading non-pet fields). */
export function petMissingReason(raw: unknown): PetMissingReason {
  if (raw === null || raw === undefined) return 'absent'
  if (!isObj(raw)) return 'bad_shape'
  if (raw.schema !== PANEL_SCHEMA) return 'bad_schema'
  if (!isObj(raw.pet)) return 'no_pet'
  return 'bad_icon'
}

function petAgeUnit(t: T, ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t('page.now.age_s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('page.now.age_m', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('page.now.age_h', { n: h }) : t('page.now.age_d', { n: Math.floor(h / 24) })
}

function petMissingRow(raw: unknown, t: T): Row {
  const reason = petMissingReason(raw)
  const text = reason === 'absent' ? t('page.pet.why_absent')
    : reason === 'bad_shape' ? t('page.pet.why_bad_shape')
    : reason === 'bad_schema' ? t('page.pet.why_bad_schema')
    : reason === 'no_pet' ? t('page.pet.why_no_pet')
    : t('page.pet.why_bad_icon')
  return [{ text, dim: true }]
}

function petMetaRow(raw: unknown, nowMs: number | undefined, t: T): Row {
  const at = isObj(raw) && typeof raw.updated_at_ms === 'number' && Number.isFinite(raw.updated_at_ms) ? raw.updated_at_ms : null
  if (at === null || nowMs === undefined) return [{ text: t('page.pet.meta_noage'), dim: true }]
  const ageMs = Math.max(0, nowMs - at)
  const age = petAgeUnit(t, ageMs)
  if (ageMs > STALE_MS) return [{ text: GLYPHS.state.failed + ' ' + t('page.pet.meta_stale', { age }), color: PALETTE.broken }]
  return [{ text: t('page.pet.meta_age', { age }), dim: true }]
}

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
export function renderPet(raw: unknown, cols: number, t: T, opts?: RenderPetOpts): { body: Row[]; actions: Row[] } {
  const detail = opts?.detail === true
  const { pet } = readPet(raw)
  if (pet === null) {
    const body: Row[] = [[{ text: t('page.pet.none'), dim: true }]]
    if (detail) body.push(petMissingRow(raw, t))
    return { body, actions: [] }
  }
  const label = petIconLabel(pet.icon, cols)
  if (displayWidth(label) !== 2) {
    const body: Row[] = [[{ text: t('page.pet.none'), dim: true }]]
    if (detail) body.push([{ text: t('page.pet.why_bad_icon'), dim: true }])
    return { body, actions: [] }
  }
  const head: Row = [{ text: pet.title !== '' ? label + ' ' + pet.title : label }]
  const sprite: Row[] = (pet.sprite ?? []).map(lineSegs)
  const stats: Row[] = (pickPetTier(pet.tiers, Math.max(1, cols)) ?? []).map(lineSegs)
  const meta: Row[] = detail ? [petMetaRow(raw, opts?.nowMs, t)] : []
  return { body: [head, ...sprite, ...stats, ...meta], actions: [] }
}

export const petPage: Page = {
  id: 'pet',
  key: '0',
  title: '寵物',
  framed: true,
  render: ctx => renderPet(ctx.pet, ctx.size.cols, ctx.t, { detail: ctx.v74 !== undefined || ctx.box === true, nowMs: ctx.nowMs }),
}
