// mods/live/addrcomplete.ts — prompt-box completion for fleet seats (`@@<q>`) and project owners (`p#<q>`) (B73).
// Pure matching over two cached lists plus a small feed that fetches them through an injected runner (register.ts passes `$.process.run`), the same shape as fleet.ts.
// The `prompt.autocomplete` hook answers from the cache only: a stale cache starts one background refresh and the answer comes from what is cached now.
// `fleet peers --json` and `fleet owners --json` are external process output, so every row is validated here and a malformed row is dropped.
import type { T } from './i18n'

export type Seat = { member: string; namespace: string; courier: string; project: string; state: string; address: string }
export type OwnerRow = { project: string; owner: string; backup: string | null; role: string }
export type Suggestion = { text: string; label?: string; description?: string }
export type AddrRunner = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string; isStdoutTruncated?: boolean }>

export const PEERS_ARGV = ['fleet', 'peers', '--json'] as const
export const OWNERS_ARGV = ['fleet', 'owners', '--json'] as const
export const ADDR_TTL_MS = 30_000
export const ADDR_MAX_BYTES = 1_000_000
export const ADDR_MAX_ROWS = 500
export const ADDR_MAX_SUGGESTIONS = 8
const ROLE_MAX_CHARS = 60

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const cut = (s: string, n: number): string => { const cs = Array.from(s); return cs.length <= n ? s : cs.slice(0, n).join('') + '…' }
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

// `fleet peers --json` to seats; throws on JSON that has no `members` list. A row without member, namespace and courier is dropped (no address can be made).
export function parseSeats(json: string): Seat[] {
  const data: unknown = JSON.parse(json)
  if (!obj(data) || !Array.isArray(data.members)) throw new Error('fleet peers: no members list')
  const out: Seat[] = []
  for (const m of data.members.slice(0, ADDR_MAX_ROWS)) {
    if (!obj(m)) continue
    const member = str(m.member), namespace = str(m.namespace), courier = str(m.courier)
    if (member === '' || namespace === '' || courier === '') continue
    out.push({ member, namespace, courier, project: str(m.project), state: str(m.state), address: namespace + '/' + courier + '/' + member })
  }
  return out
}

// `fleet owners --json` to owner rows; throws on JSON that has no `owners` list. A row without project and owner is dropped.
export function parseOwners(json: string): OwnerRow[] {
  const data: unknown = JSON.parse(json)
  if (!obj(data) || !Array.isArray(data.owners)) throw new Error('fleet owners: no owners list')
  const out: OwnerRow[] = []
  for (const o of data.owners.slice(0, ADDR_MAX_ROWS)) {
    if (!obj(o)) continue
    const project = str(o.project), owner = str(o.owner)
    if (project === '' || owner === '') continue
    out.push({ project, owner, backup: str(o.backup) || null, role: oneLine(str(o.role)) })
  }
  return out
}

// `@@<q>`: seats whose member, project or courier contains q; live first, then member name; at most 8; one row per address.
export function seatSuggestions(seats: readonly Seat[], q: string): Suggestion[] {
  const needle = q.toLowerCase()
  const seen = new Set<string>()
  const hits = seats.filter(s => {
    if (seen.has(s.address)) return false
    if (needle !== '' && ![s.member, s.project, s.courier].some(f => f.toLowerCase().includes(needle))) return false
    seen.add(s.address)
    return true
  })
  hits.sort((a, b) => (a.state === 'live' ? 0 : 1) - (b.state === 'live' ? 0 : 1) || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0))
  return hits.slice(0, ADDR_MAX_SUGGESTIONS).map(s => ({ text: s.address, label: '@@' + s.member, description: [s.courier, s.project, s.state].filter(p => p !== '').join(' · ') }))
}

// `p#<q>`: projects whose name starts with q, exact match first; null owners = the registry could not be read (one row, token unchanged, never a guessed address).
export function ownerSuggestions(owners: readonly OwnerRow[] | null, token: string, t: T): Suggestion[] {
  if (owners === null) return [{ text: token, description: t('addr.registry_down') }]
  const q = token.slice(2).toLowerCase()
  const hits = owners.filter(o => o.project.toLowerCase().startsWith(q))
  hits.sort((a, b) => (a.project.toLowerCase() === q ? 0 : 1) - (b.project.toLowerCase() === q ? 0 : 1))
  const seen = new Set<string>()
  const rows: Suggestion[] = []
  for (const o of hits) {
    if (seen.has(o.project)) continue
    seen.add(o.project)
    const role = cut(o.role, ROLE_MAX_CHARS)
    const desc = [t('addr.owner') + (role !== '' ? ' ' + role : ''), o.backup !== null ? o.backup : ''].filter(p => p !== '').join(' · ')
    rows.push({ text: o.owner, label: 'p#' + o.project, description: desc })
    if (rows.length >= ADDR_MAX_SUGGESTIONS) break
  }
  return rows
}

// A project name the registry has no owner for: offered by the caller when it knows the name (none of the cached rows carries it), text = the token unchanged.
export const noOwnerRow = (project: string, token: string, t: T): Suggestion => ({ text: token, label: 'p#' + project, description: t('addr.no_owner') })

export type AddrFeed = {
  seats: () => readonly Seat[]
  owners: () => readonly OwnerRow[] | null // null: the registry was not readable at the last fetch, or nothing was fetched yet
  stale: (nowMs: number) => boolean
  refresh: (run: AddrRunner, nowMs: number) => Promise<boolean>
}

// The two lists are fetched together. A failed run keeps the last good seats; owners go back to null on an exit code 2 / error (the registry is not published or not readable).
export function makeAddrFeed(ttlMs = ADDR_TTL_MS): AddrFeed {
  let seats: Seat[] = []
  let owners: OwnerRow[] | null = null
  let triedMs: number | null = null
  let busy = false
  const ok = (r: { exitCode: number; stdout: string; isStdoutTruncated?: boolean }): boolean => r.exitCode === 0 && r.isStdoutTruncated !== true && r.stdout.length <= ADDR_MAX_BYTES
  return {
    seats: () => seats,
    owners: () => owners,
    stale: nowMs => triedMs === null || nowMs - triedMs >= ttlMs,
    refresh: async (run, nowMs) => {
      if (busy) return false
      busy = true
      triedMs = nowMs
      try {
        const [p, o] = await Promise.all([run(PEERS_ARGV).catch(() => null), run(OWNERS_ARGV).catch(() => null)])
        if (p !== null && ok(p)) { try { seats = parseSeats(p.stdout) } catch (_e) { /* keep the last good seats */ } }
        owners = null
        if (o !== null && ok(o)) { try { owners = parseOwners(o.stdout) } catch (_e) { owners = null } }
      } finally {
        busy = false
      }
      return true
    },
  }
}

// What the hook answers for one token, from the cache only. `kick` starts the background refresh when the cache is stale; it is called, never awaited.
// Returns null for a token that is not ours (the caller returns next(e) untouched).
export function addrSuggestions(token: string, feed: AddrFeed, nowMs: number, kick: () => void, t: T): Suggestion[] | null {
  const seat = token.startsWith('@@')
  if (!seat && !token.startsWith('p#')) return null
  if (feed.stale(nowMs)) kick()
  if (seat) return seatSuggestions(feed.seats(), token.slice(2))
  const owners = feed.owners()
  const rows = ownerSuggestions(owners, token, t)
  if (owners !== null && rows.length === 0) {
    const q = token.slice(2)
    // a project with no owner row: the seats know its name
    const known = [...new Set(feed.seats().map(s => s.project).filter(p => p !== '' && p.toLowerCase().startsWith(q.toLowerCase())))].sort()
    return known.slice(0, ADDR_MAX_SUGGESTIONS).map(p => noOwnerRow(p, token, t))
  }
  return rows
}
