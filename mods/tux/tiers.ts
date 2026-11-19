// mods/tux/tiers.ts — shared width tiers.
// PANE_TIERS is tux-guidelines §6.6 (whole window). Below 80 is the fallback.
// SIDE_TIERS is the panel/side column ladder.
// mods/live/shell.ts TIER_AT / bandTier (240/200/160/120/80 on bodyColumns, band contract 1.1) is a different table and stays there.

export const PANE_TIERS = [200, 160, 120, 100, 80] as const

export const SIDE_TIERS = {
  panel: [40, 60, 80, 100, 120],
  side: [30, 40, 50],
} as const
