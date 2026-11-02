// mods/live/speed.ts — the speed measurement (BL-0359): pure functions, no `$`, no glyph, no colour. register.ts times each model request from its
// `turn.step` stream and keeps the samples in $.state; ui.ts draws them. The method is codeforge 405b214's `stepRate` (forge-stats, which this replaces).
//
// Why the window starts at `sent` when no thinking text streamed: `output_tokens` counts thinking, and with the thinking display omitted the thinking
// tokens are written before the first visible chunk. Timing first -> last divided ALL tokens by only the visible text's window: a 773-token reply after
// 9.1 s of hidden thinking and 0.216 s of text read 3578 tok/s instead of ~83.

/** One model request, timed from its stream. */
export type Step = {
  /** Wall-clock ms when the request finished. */
  at: number
  model: string
  /** True when the request ran inside a subagent. */
  isSubagent: boolean
  /** Request sent -> first content chunk; null when nothing streamed. */
  ttftMs: number | null
  /** The writing window (see `stepRate`); null when nothing streamed. */
  decodeMs: number | null
  outTokens: number
  /** outTokens / decode time; null when the window is too short to measure or nothing was written. */
  tps: number | null
}

/** Only the most recent samples are kept. */
export const KEEP_STEPS = 200
/** The $.state shape tag of the sample list. A list stored under another tag is dropped: it was timed by another method. */
export const STEPS_SHAPE = 'steps-2'
/** Below this writing window the rate is noise (one-chunk replies). */
export const MIN_DECODE_MS = 150

/** The time the API spent running its own tools inside the request (the advisor, ...); a tool that has no `endedAt` is not subtracted. */
export function serverToolMs(uses: readonly { startedAt: number; endedAt?: number }[] | undefined): number {
  return (uses ?? []).reduce((n, u) => n + (u.endedAt !== undefined ? Math.max(0, u.endedAt - u.startedAt) : 0), 0)
}

/**
 * One request's writing window and rate. The window holds the time the thinking was written in:
 * - thinking streamed as visible text: first chunk -> last chunk;
 * - no thinking text streamed: send -> last chunk. A stream cannot tell a hidden thinking block from none at all, and this window also holds the
 *   prompt processing, so the rate is a lower bound, never an inflated one.
 * The API's own tool time is taken out of the window either way.
 */
export function stepRate(t: {
  sent: number
  first: number | null
  last: number | null
  outTokens: number
  thinkingStreamed: boolean
  serverToolMs: number
}): { decodeMs: number | null; tps: number | null } {
  if (t.first === null || t.last === null) return { decodeMs: null, tps: null }
  const start = t.thinkingStreamed ? t.first : t.sent
  const decodeMs = Math.max(0, t.last - start - t.serverToolMs)
  const tps = decodeMs >= MIN_DECODE_MS && t.outTokens > 0 ? t.outTokens / (decodeMs / 1000) : null
  return { decodeMs, tps }
}

export type Summary = { requests: number; outTokens: number; avgTps: number | null; medianTtft: number | null; bestTps: number | null; latestTps: number | null }

/** Token-weighted average (total tokens over total writing time of the timed requests), best, latest timed, median first-token delay over all requests. */
export function summarize(list: readonly Step[]): Summary {
  const timed = list.filter(s => s.tps !== null && s.decodeMs !== null)
  const tokens = timed.reduce((n, s) => n + s.outTokens, 0)
  const decode = timed.reduce((n, s) => n + (s.decodeMs ?? 0), 0)
  const ttfts = list.map(s => s.ttftMs).filter((x): x is number => x !== null).sort((a, b) => a - b)
  const rates = timed.map(s => s.tps as number)
  return {
    requests: list.length,
    outTokens: list.reduce((n, s) => n + s.outTokens, 0),
    avgTps: decode > 0 ? tokens / (decode / 1000) : null,
    medianTtft: ttfts[Math.floor(ttfts.length / 2)] ?? null,
    bestTps: rates.length > 0 ? Math.max(...rates) : null,
    latestTps: rates.length > 0 ? rates[rates.length - 1] : null,
  }
}

/** The main conversation's requests (a subagent's are counted apart). */
export const mainSteps = (list: readonly Step[]): Step[] => list.filter(s => !s.isSubagent)
/** The last `n` main requests long enough to time; most steps of a working turn are a lone tool call with no rate. */
export const recentTimed = (list: readonly Step[], n: number): Step[] => mainSteps(list).filter(s => s.tps !== null).slice(-n)

/** A count of a million or more in at most 5 cells: `1.2M`, `34M`, `5.6B`, `999T`; past a thousand trillion it is `>999T` (a stored sample can hold any number, the columns have a width). */
function compact(n: number): string {
  let v = n / 1e6
  for (const unit of ['M', 'B', 'T']) {
    if (v < 999.5) return (v < 9.95 ? v.toFixed(1) : String(Math.round(v))) + unit
    v /= 1000
  }
  return '>999T'
}

/**
 * `1.2s`, `840ms`, `14s`, `2m05s`, `1h15m`; null is a dash (the caller passes the dash it draws). Never wider than 6 cells: from 100 hours up it is `>99h`.
 */
export function fmtMs(ms: number | null, dash: string): string {
  if (ms === null || !Number.isFinite(ms)) return dash
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`
  if (ms < 360_000_000) return `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`
  return '>99h'
}
/** A rate in at most 6 cells: whole tokens per second under a million, `1.2M` and on above that. */
export function fmtTps(tps: number | null, dash: string): string {
  if (tps === null || !Number.isFinite(tps)) return dash
  const r = Math.round(tps)
  return r < 1_000_000 ? String(r) : compact(r)
}
/** A token count in at most 7 cells: with thousands separators under a million (`999,999`), `1.2M` and on above that. */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '>999T'
  const r = Math.round(n)
  return r < 1_000_000 ? r.toLocaleString('en-US') : compact(r)
}
export const shortModel = (m: string): string => m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[1m\]$/, '')

const nonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const nonNegOrNull = (v: unknown): v is number | null => v === null || nonNeg(v)
/** One stored sample, checked field by field: a bad one is dropped by `validSteps`, never trusted. */
export function isStep(s: unknown): s is Step {
  if (typeof s !== 'object' || s === null) return false
  const o = s as Record<string, unknown>
  return nonNeg(o.at) && typeof o.model === 'string' && o.model !== '' && typeof o.isSubagent === 'boolean' && nonNegOrNull(o.ttftMs) && nonNegOrNull(o.decodeMs) && nonNeg(o.outTokens) && nonNegOrNull(o.tps)
}
/** The `$.state` value: the samples that pass `isStep`, or an empty list when it is not a list. One bad sample does not void the rest. */
export const validSteps = (raw: unknown): Step[] => (Array.isArray(raw) ? raw.filter(isStep) : [])

/** codeforge's `codeforge.pet-view/1` snapshot (`<live base>/codeforge/pet.json`) as the label's pet tag `Name Lv.N`, or null when it holds no pet. */
export const PET_SCHEMA = 'codeforge.pet-view/1'
export function petTag(text: string | null): string | null {
  if (text === null) return null
  try {
    const raw = JSON.parse(text) as { schema?: unknown; pet?: { name?: unknown; level?: unknown } | null }
    if (raw === null || typeof raw !== 'object' || raw.schema !== PET_SCHEMA) return null
    const p = raw.pet
    if (p === null || p === undefined || typeof p.name !== 'string' || p.name === '' || typeof p.level !== 'number' || !Number.isFinite(p.level)) return null
    return `${p.name} Lv.${fmtCount(Math.max(0, Math.floor(p.level)))}`
  } catch (_e) {
    return null
  }
}
