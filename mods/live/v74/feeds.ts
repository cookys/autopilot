// v74/feeds.ts — PM status and decision list feeds for PageCtx.v74 (sub-task B). Impure CLI runners live in register.ts.
import { parsePmStatus, type DecideCard, type CardOption, type PmStatus } from './contract'

export const PM_STATUS_ARGV = ['fleet', 'pm', 'status', '--json'] as const
export const DECIDE_LIST_ARGV = ['fleet', 'decision', 'list', '--json'] as const
export const V74_FEED_TTL_MS = 30_000

export type CliRunner = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
export type PmFeed = { status: () => PmStatus | null; fetchedMs: () => number | null; refresh: (run: CliRunner, nowMs: number, force?: boolean) => Promise<boolean> }
export type DecideFeed = { cards: () => DecideCard[] | null; fetchedMs: () => number | null; refresh: (run: CliRunner, nowMs: number, force?: boolean) => Promise<boolean> }

const firstLine = (s: string): string => s.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''

// fleet decision list and the open-decision.js store name the same card by id. The list wins on a clash; a working list with no cards stays [] (not "no source").
export function mergeDecideCards(list: readonly DecideCard[] | null, store: readonly DecideCard[]): DecideCard[] | null {
  if (list === null && store.length === 0) return null
  const seen = new Set<string>()
  const out: DecideCard[] = []
  for (const c of [...(list ?? []), ...store]) {
    if (c.id === '' || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

export function parseDecideList(json: string): DecideCard[] | null {
  let o: unknown
  try { o = JSON.parse(json) } catch { return null }
  if (typeof o !== 'object' || o === null || !Array.isArray((o as { cards?: unknown }).cards)) return null
  const out: DecideCard[] = []
  for (const row of (o as { cards: unknown[] }).cards) {
    if (typeof row !== 'object' || row === null) continue
    const c = (row as { card?: unknown }).card
    if (typeof c !== 'object' || c === null) continue
    const card = c as Record<string, unknown>
    const id = typeof card.card_id === 'string' ? card.card_id : ''
    if (id === '') continue
    const title = typeof card.kind === 'string' && card.kind !== '' ? card.kind : id.slice(0, 8)
    const question = typeof card.question === 'string' ? card.question : ''
    const background = typeof card.background === 'string' ? card.background : null
    const options: CardOption[] = []
  const opts = card.options
    if (Array.isArray(opts)) {
      for (const op of opts) {
        if (typeof op !== 'object' || op === null) continue
        const q = op as Record<string, unknown>
        options.push({
          label: typeof q.label === 'string' ? q.label : '',
          detail: typeof q.description === 'string' ? q.description : '',
          recommended: card.recommendation === q.label,
        })
      }
    }
    const rec = typeof card.recommendation === 'string' ? card.recommendation : null
    if (options.length === 0 && Array.isArray(card.blocks)) {
      for (const b of card.blocks) {
        if (typeof b !== 'object' || b === null) continue
        const bl = b as Record<string, unknown>
        if (bl.type === 'options' && Array.isArray(bl.options)) {
          for (const op of bl.options) {
            if (typeof op !== 'object' || op === null) continue
            const q = op as Record<string, unknown>
            const label = typeof q.label === 'string' ? q.label : ''
            options.push({ label, detail: typeof q.description === 'string' ? q.description : '', recommended: rec === label })
          }
        }
      }
    }
    if (options.length === 0) continue
    out.push({ id, title, question, background, options })
  }
  return out.length === 0 ? null : out
}

export function makePmFeed(ttlMs = V74_FEED_TTL_MS): PmFeed {
  let status: PmStatus | null = null
  let fetchedMs: number | null = null
  let triedMs: number | null = null
  let busy = false
  return {
    status: () => status,
    fetchedMs: () => fetchedMs,
    refresh: async (run, nowMs, force = false) => {
      if (busy) return false
      if (!force && triedMs !== null && nowMs - triedMs < ttlMs) return false
      busy = true
      triedMs = nowMs
      try {
        const r = await run(PM_STATUS_ARGV)
        if (r.exitCode !== 0) throw new Error(firstLine(r.stderr) || 'exit ' + r.exitCode)
        const parsed = parsePmStatus(r.stdout)
        if (parsed === null) throw new Error('invalid pm status json')
        status = parsed
        fetchedMs = nowMs
      } catch {
        status = null
      } finally {
        busy = false
      }
      return true
    },
  }
}

export function makeDecideFeed(ttlMs = V74_FEED_TTL_MS): DecideFeed {
  let cards: DecideCard[] | null = null
  let fetchedMs: number | null = null
  let triedMs: number | null = null
  let busy = false
  return {
    cards: () => cards,
    fetchedMs: () => fetchedMs,
    refresh: async (run, nowMs, force = false) => {
      if (busy) return false
      if (!force && triedMs !== null && nowMs - triedMs < ttlMs) return false
      busy = true
      triedMs = nowMs
      try {
        const r = await run(DECIDE_LIST_ARGV)
        if (r.exitCode !== 0) throw new Error(firstLine(r.stderr) || 'exit ' + r.exitCode)
        const parsed = parseDecideList(r.stdout)
        cards = parsed
        fetchedMs = nowMs
      } catch {
        cards = null
      } finally {
        busy = false
      }
      return true
    },
  }
}