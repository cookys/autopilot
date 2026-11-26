// mods/live/wide/data.ts — console v5 P5b: small readers that turn live values into the figures the wide pages print.
// `42%` (the context text) -> 42; `—` or a 來源未接 text -> null
export const ctxPctOf = (text: string | null): number | null => { const m = text === null ? null : /^(\d+(?:\.\d+)?)%$/.exec(text.trim()); return m === null ? null : Math.round(Number(m[1])) }
// time left until a reset, as the design writes it: `2h10m`, `45m`, `4d`; null when there is no reset time
export const untilText = (atMs: number | null, nowMs: number): string | null => {
  if (atMs === null) return null
  const m = Math.max(0, Math.round((atMs - nowMs) / 60_000))
  if (m >= 24 * 60) return `${Math.round(m / (24 * 60))}d`
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60 > 0 ? `${m % 60}m` : ''}`
  return `${m}m`
}
