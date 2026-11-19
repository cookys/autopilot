// mods/tux/format.ts — shared percent and duration formatters. One copy; mods/live/ui.ts re-exports them.
// pctInt floors. The epsilon keeps 0.58 * 100 = 57.999... from reading 57.

export function pctInt(ratio: number): number {
  return Math.floor(ratio * 100 + 1e-9)
}

export const pct = (ratio: number): string => pctInt(ratio) + '%'

const two = (n: number): string => (n < 10 ? '0' : '') + n

// at most two units, minutes zero-padded after hours: 29s, 5m, 8h05m, 4d04h; >= 7 d as 27d
export function dur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + two(m % 60) + 'm'
  const d = Math.floor(h / 24)
  return d >= 7 ? d + 'd' : d + 'd' + two(h % 24) + 'h'
}
