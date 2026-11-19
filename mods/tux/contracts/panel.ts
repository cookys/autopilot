// mods/tux/contracts/panel.ts — codeforge.panel/1 types shared by the reader. Tones are the existing set only.
// Tier keys reference SIDE_TIERS; the reader in mods/live/panel.ts re-exports this module.

import { SIDE_TIERS } from '../tiers.ts'

export const PANEL_SCHEMA = 'codeforge.panel/1'
export const PANEL_TONES = 'subtle inactive dim bold mono success'.split(' ')
export const PANEL_TIER_KEYS = { panel: SIDE_TIERS.panel, side: SIDE_TIERS.side } as const

export type PanelLine = { text: string; tone?: string }[]
export type Tiers = Record<string, PanelLine[]>
export type SideData = { usage: Tiers | null; usageFull: Tiers | null; memory: Tiers | null }
// absent: nothing written (null / undefined); bad: not an object; old: another schema (or none); ok: codeforge.panel/1
// usage: the top-level `usage` tiers (the 用量 tab of the band), money lines already dropped
export type PanelRead = { status: 'absent' | 'bad' | 'old' | 'ok'; ageMs: number | null; side: SideData | null; usage: Tiers | null }

export type PetIconEntry = { id: 'cat' | 'chick' | 'crab'; emoji: string; fallback: string; text: string }
export type PetPanel = { title: string; sprite: PanelLine[] | null; tiers: Tiers | null; icon: PetIconEntry }
export type PetRead = { pet: PetPanel | null }
