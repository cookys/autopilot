// v74/feeds.ts — PM status and decision list feeds for PageCtx.v74 (sub-task B). Impure CLI runners live in register.ts.
import { parsePmStatus, type DecideCard, type CardOption, type PmStatus } from './contract'
import { cellWidth, displayWidth } from '../../tux/width.ts'

export const PM_STATUS_ARGV = ['fleet', 'pm', 'status', '--json'] as const
export const DECIDE_LIST_ARGV = ['fleet', 'decision', 'list', '--json'] as const
export const ASKS_LIST_TAIL = ['list', '--answers', '--open', '--json'] as const
export const V74_FEED_TTL_MS = 30_000

export type CliRunner = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
export type PmFeed = { status: () => PmStatus | null; fetchedMs: () => number | null; error: () => string | null; refresh: (run: CliRunner, nowMs: number, force?: boolean) => Promise<boolean> }
export type DecideFeed = { cards: () => DecideCard[] | null; fetchedMs: () => number | null; error: () => string | null; refresh: (run: CliRunner, nowMs: number, force?: boolean) => Promise<boolean> }
export type AskRow = { status: string; count: number; at: string; ask: string; answer: string | null }
export type AsksFeed = { rows: () => AskRow[] | null; fetchedMs: () => number | null; error: () => string | null; refresh: (run: CliRunner, argv: readonly string[], nowMs: number, force?: boolean) => Promise<boolean> }

const firstLine = (s: string): string => s.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
const exitError = (stderr: string, exitCode: number): string => {
  const line = firstLine(stderr)
  return (line !== '' ? line : 'exit') + '（rc=' + exitCode + '）'
}

// The courier list has no title field of its own (an older build showed the card's `kind` word, i.e. "decide"): the title falls back
// to the question, cut by code points to TITLE_MAX display columns (CJK = 2) plus '...'.
const TITLE_MAX = 40
export const cutTitle = (text: string): string => {
  if (displayWidth(text) <= TITLE_MAX) return text
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = cellWidth(ch.codePointAt(0)!)
    if (w + cw > TITLE_MAX - 3) break
    out += ch
    w += cw
  }
  return out + '...'
}

// fleet decision list and the open-decision.js store name the same card by id. The list wins on a clash: the list card keeps its place
// and its question/options, but takes the store card's title when the store has one (the store card, mapped from the durable entry,
// carries the real title the list lacks). A working list with no cards stays [] (not "no source").
export function mergeDecideCards(list: readonly DecideCard[] | null, store: readonly DecideCard[]): DecideCard[] | null {
  if (list === null && store.length === 0) return null
  const storeTitles = new Map<string, string>()
  for (const c of store) if (c.id !== '' && c.title !== '') storeTitles.set(c.id, c.title)
  const seen = new Set<string>()
  const out: DecideCard[] = []
  const push = (c: DecideCard, adoptStoreTitle: boolean): void => {
    if (c.id === '' || seen.has(c.id)) return
    seen.add(c.id)
    const title = adoptStoreTitle ? storeTitles.get(c.id) : undefined
    out.push(title !== undefined && title !== c.title ? { ...c, title } : c)
  }
  for (const c of list ?? []) push(c, true)
  for (const c of store) push(c, false)
  return out
}

export function parseDecideList(json: string): DecideCard[] | null {
  let o: unknown
  try { o = JSON.parse(json) } catch { return null }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
  const rec = o as Record<string, unknown>
  if (rec.cards === undefined) return Object.keys(rec).length === 0 ? [] : null
  if (!Array.isArray(rec.cards)) return null
  const out: DecideCard[] = []
  for (const row of rec.cards) {
    if (typeof row !== 'object' || row === null) continue
    const c = (row as { card?: unknown }).card
    if (typeof c !== 'object' || c === null) continue
    const card = c as Record<string, unknown>
    const id = typeof card.card_id === 'string' ? card.card_id : ''
    if (id === '') continue
    // The list has no title field: the card's title when it has one, else the question cut to TITLE_MAX display columns (never the `kind` word)
    const question = typeof card.question === 'string' ? card.question : ''
    const rawTitle = typeof card.title === 'string' && card.title !== '' ? card.title : question
    const title = rawTitle !== '' ? cutTitle(rawTitle) : id.slice(0, 8)
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
  return out
}

export function makePmFeed(ttlMs = V74_FEED_TTL_MS): PmFeed {
  let status: PmStatus | null = null
  let fetchedMs: number | null = null
  let triedMs: number | null = null
  let error: string | null = null
  let busy = false
  return {
    status: () => status,
    fetchedMs: () => fetchedMs,
    error: () => error,
    refresh: async (run, nowMs, force = false) => {
      if (busy) return false
      if (!force && triedMs !== null && nowMs - triedMs < ttlMs) return false
      busy = true
      triedMs = nowMs
      try {
        const r = await run(PM_STATUS_ARGV)
        if (r.exitCode !== 0) throw new Error(exitError(r.stderr, r.exitCode))
        const parsed = parsePmStatus(r.stdout)
        if (parsed === null) throw new Error('invalid pm status json')
        status = parsed
        fetchedMs = nowMs
        error = null
      } catch (e) {
        // retain last successful status & fetchedMs so title/status row stay truthful
        error = firstLine(e instanceof Error ? e.message : String(e)) || 'failed'
      } finally {
        busy = false
      }
      return true
    },
  }
}

export function parseAsksJson(json: string): AskRow[] | null {
  let o: unknown
  try { o = JSON.parse(json) } catch { return null }
  if (!Array.isArray(o)) return null
  const out: AskRow[] = []
  for (const item of o) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const r = item as Record<string, unknown>
    if (typeof r.status !== 'string' || typeof r.at !== 'string' || typeof r.ask !== 'string') return null
    if (typeof r.count !== 'number' || !Number.isFinite(r.count)) return null
    if (r.answer !== null && typeof r.answer !== 'string') return null
    out.push({ status: r.status, count: r.count, at: r.at, ask: r.ask, answer: r.answer })
  }
  return out
}

export function makeAsksFeed(ttlMs = V74_FEED_TTL_MS): AsksFeed {
  let rows: AskRow[] | null = null
  let fetchedMs: number | null = null
  let triedMs: number | null = null
  let error: string | null = null
  let busy = false
  return {
    rows: () => rows,
    fetchedMs: () => fetchedMs,
    error: () => error,
    refresh: async (run, argv, nowMs, force = false) => {
      if (busy) return false
      if (!force && triedMs !== null && nowMs - triedMs < ttlMs) return false
      busy = true
      triedMs = nowMs
      try {
        const r = await run(argv)
        if (r.exitCode !== 0) throw new Error(exitError(r.stderr, r.exitCode))
        const parsed = parseAsksJson(r.stdout)
        if (parsed === null) throw new Error('invalid asks json')
        rows = parsed
        fetchedMs = nowMs
        error = null
      } catch (e) {
        // retain last successful rows & fetchedMs so title/status row stay truthful
        error = firstLine(e instanceof Error ? e.message : String(e)) || 'failed'
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
  let error: string | null = null
  let busy = false
  return {
    cards: () => cards,
    fetchedMs: () => fetchedMs,
    error: () => error,
    refresh: async (run, nowMs, force = false) => {
      if (busy) return false
      if (!force && triedMs !== null && nowMs - triedMs < ttlMs) return false
      busy = true
      triedMs = nowMs
      try {
        const r = await run(DECIDE_LIST_ARGV)
        if (r.exitCode !== 0) throw new Error(exitError(r.stderr, r.exitCode))
        const parsed = parseDecideList(r.stdout)
        if (parsed === null) throw new Error('invalid decision list json')
        cards = parsed
        fetchedMs = nowMs
        error = null
      } catch (e) {
        // retain last successful cards & fetchedMs so title/status row stay truthful
        error = firstLine(e instanceof Error ? e.message : String(e)) || 'failed'
      } finally {
        busy = false
      }
      return true
    },
  }
}

// ---- knowledge-review candidates (審查 候選教訓, fleet 01M8ARXSD4): the same store the knowledge-review.js CLI reads, through the injected runner ----
export const KR_LIST_TAIL = ['list', '--json', '--status', 'pending'] as const
export type KReviewFeed = { rows: () => KReviewCandidate[] | null; fetchedMs: () => number | null; error: () => string | null; refresh: (run: CliRunner, argv: readonly string[], nowMs: number, force?: boolean) => Promise<boolean>; fail: (message: string) => void }

// Trust boundary: the list comes from another program. Wrong shape (not an array of {key, topic, ...}) answers null (source broken), never [] — an empty list is a
// parsed success, a broken one is not.
export function parseKReviewList(json: string): KReviewCandidate[] | null {
  let o: unknown
  try { o = JSON.parse(json) } catch { return null }
  if (!Array.isArray(o)) return null
  const out: KReviewCandidate[] = []
  for (const item of o) {
    if (typeof item !== 'object' || item === null) return null
    const r = item as Record<string, unknown>
    if (typeof r.key !== 'string' || r.key === '' || typeof r.topic !== 'string' || typeof r.status !== 'string') return null
    if (!/^(?!-)[\w.:-]+$/.test(r.key)) return null // a leading '-' would read as a CLI flag (krDecideArgv passes the key verbatim)
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const count = typeof r.count === 'number' && Number.isFinite(r.count) ? r.count : 0
    out.push({ key: r.key, topic: r.topic, pitfall: str(r.pitfall_type), solution: str(r.solution_type), tool: str(r.tool), repo: str(r.repo), count })
  }
  return out
}

export function makeKReviewFeed(ttlMs = V74_FEED_TTL_MS): KReviewFeed {
  let rows: KReviewCandidate[] | null = null
  let fetchedMs: number | null = null
  let triedMs: number | null = null
  let error: string | null = null
  let busy = false
  return {
    rows: () => rows,
    fetchedMs: () => fetchedMs,
    error: () => error,
    fail: (message: string) => { error = firstLine(message) || 'failed' },
    refresh: async (run, argv, nowMs, force = false) => {
      if (busy) return false
      if (!force && triedMs !== null && nowMs - triedMs < ttlMs) return false
      busy = true
      triedMs = nowMs
      try {
        const r = await run(argv)
        if (r.exitCode !== 0) throw new Error(exitError(r.stderr, r.exitCode))
        const parsed = parseKReviewList(r.stdout)
        if (parsed === null) throw new Error('invalid knowledge-review list json')
        rows = parsed
        fetchedMs = nowMs
        error = null
      } catch (e) {
        // retain last successful rows & fetchedMs so title/status row stay truthful
        error = firstLine(e instanceof Error ? e.message : String(e)) || 'failed'
      } finally {
        busy = false
      }
      return true
    },
  }
}
