// mods/live/ui.ts — the live pane's design system (docs/plans/2026-10-13-live-pane-design-system.md, P0).
//
// One module owns the vocabulary the pane draws with: the ten states (glyph + theme key + word), the glyph tables, the layout grid, the formatters, the
// status mapping from domain objects to states (`classify` -> `STATUS_MAP` -> `stateOf`, `worst`, `SEVERITY`), the freshness thresholds, the fact-ownership
// table, and the line components. Tab code (P1-P5) builds lines only through the components here; a line or fragment is a `PaneLine` / `Frag` only when
// `mk()` / `frag()` made it (module-private WeakSets, read back through `isMade` / `isFrag`).
//
// P0 scope: the tokens, formatters, components, brand, FRESH_MS and the mapping exist and are tested; `PaneLine.kind` is still optional and no tab is forced
// through them yet. This file imports TYPES only and uses erasable syntax only, so `node --test mods/live/ui-lint.test.js` can load it directly
// (Node strips the types) and run the glyph and vocabulary lint against the very tables the pane draws from.

import type { PaneLine, PaneTab, Seg, ThemeKey } from './model'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// display width (moved here from model.ts, which re-exports it)

export function cellWidth(c: number): number {
  if (c === 0 || (c >= 0x0300 && c <= 0x036f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x20d0 && c <= 0x20ff)) return 0
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x303e) || (c >= 0x3041 && c <= 0x33ff) || (c >= 0x3400 && c <= 0x4dbf)
    || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa000 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
    || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd)) return 2
  return 1
}
// Terminal cell width of a string: East Asian Wide / Fullwidth = 2, combining and zero-width = 0, everything else (the band glyphs included) = 1.
export function displayWidth(text: string): number {
  let w = 0
  for (const ch of text) w += cellWidth(ch.codePointAt(0) as number)
  return w
}
const padCells = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - displayWidth(text)))
const padLeft = (text: string, width: number): string => ' '.repeat(Math.max(0, width - displayWidth(text))) + text

// ---------------------------------------------------------------------------------------------------------------------------------------------
// tokens

export const GRID = [0, 2, 4, 12] as const // the four columns a body line may start at (§3.1)
export const KEY_W = 12 // the key column of a key/value row, in display cells

export const STATE_IDS = ['need_you', 'failed', 'stalled', 'findings', 'running', 'done', 'pending', 'stopped', 'skipped', 'unknown'] as const
export type StateId = (typeof STATE_IDS)[number]

// The glyph tables (§3.2, §3.4). Three groups that do not cross: state glyphs, structure glyphs, chart glyphs. `verified` records, per glyph that is new to
// the vocabulary, where it was checked to draw in ONE cell: confirmed 2026-10-13 by the owner (ssh + tmux, all ten single-cell); was `pending-owner` until the owner ran `node mods/live/glyph-check.js` in the real ssh + tmux
// terminal (P0 b). `fallback` is the next candidate when a glyph fails that check (§8 Q2); it is linted like every other glyph.
export const GLYPHS = {
  state: { need_you: '▲', failed: '✗', stalled: '⊘', findings: '△', running: '●', done: '✓', pending: '○', stopped: '◌', skipped: '∅', unknown: '?' },
  structure: { open: '▾', folded: '▸', rule: '─', detail: '└', command: '$', goto: '›', bullet: '◦', empty: '—', tabMark: '━', residue: '⚑' },
  chart: { meterOn: '▰', meterOff: '▱', here: '◐' },
  spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  fallback: { stalled: '◍', findings: '!' },
  verified: { '⊘': '2026-10-13 owner-ssh-tmux', '△': '2026-10-13 owner-ssh-tmux', '○': '2026-10-13 owner-ssh-tmux', '◌': '2026-10-13 owner-ssh-tmux', '∅': '2026-10-13 owner-ssh-tmux', '◦': '2026-10-13 owner-ssh-tmux', '›': '2026-10-13 owner-ssh-tmux', '━': '2026-10-13 owner-ssh-tmux', '◐': '2026-10-13 owner-ssh-tmux', '◍': '2026-10-13 owner-ssh-tmux' } as Record<string, string>,
}
// glyphs that are new to the pane's vocabulary: each must carry a `verified` entry (L3)
export const NEW_GLYPHS = ['⊘', '△', '○', '◌', '∅', '◦', '›', '━', '◐', '◍'] as const
// Extended_Pictographic glyphs a terminal may draw as an emoji box (§3.4); repeated so the rule survives a Unicode update
export const EMOJI_BANNED = ['⏸', '⚙', '⚠', '✔', '✖', '▶', '⏹', '⏺', '▪', '▫'] as const

export const STATES: Record<StateId, { glyph: string; key: ThemeKey; bold: boolean }> = {
  need_you: { glyph: GLYPHS.state.need_you, key: 'warning', bold: true },
  failed: { glyph: GLYPHS.state.failed, key: 'error', bold: false },
  stalled: { glyph: GLYPHS.state.stalled, key: 'error', bold: false },
  findings: { glyph: GLYPHS.state.findings, key: 'warning', bold: false },
  running: { glyph: GLYPHS.state.running, key: 'suggestion', bold: false },
  done: { glyph: GLYPHS.state.done, key: 'success', bold: false },
  pending: { glyph: GLYPHS.state.pending, key: 'inactive', bold: false },
  stopped: { glyph: GLYPHS.state.stopped, key: 'inactive', bold: false },
  skipped: { glyph: GLYPHS.state.skipped, key: 'inactive', bold: false },
  unknown: { glyph: GLYPHS.state.unknown, key: 'inactive', bold: false },
}
// the one total order of "worse" (§3.3); `unknown` ranks last so a missing mapping never hides a real finding
export const SEVERITY: readonly StateId[] = ['need_you', 'failed', 'stalled', 'findings', 'running', 'stopped', 'pending', 'done', 'skipped', 'unknown']

// freshness thresholds (§2.5), ms; every comparison is strict (`>`): exactly at the threshold is still fresh
export const FRESH_MS = { quiet: 1_800_000, planReview: 86_400_000, terminalPlan: 604_800_000, codeReview: 86_400_000, dispatch: 86_400_000 } as const
export type FreshKind = keyof typeof FRESH_MS
export const isStale = (kind: FreshKind, ageMs: number): boolean => ageMs > FRESH_MS[kind]

// ---------------------------------------------------------------------------------------------------------------------------------------------
// glyph and vocabulary lint (the pure checks behind I5 (a), I20 and ui-lint.test.js L3; tests also call them on planted tables)

const EXT_PICT = /\p{Extended_Pictographic}/u
export type GlyphTables = { state: Record<string, string>; structure: Record<string, string>; chart: Record<string, string>; spark?: readonly string[]; fallback?: Record<string, string>; verified?: Record<string, string> }
// I5 (c) for one text: an emoji-presentation hazard. `allowPictographic` is true for kind 'detail' lines only. Digits, `#` and `*` are legal (keycap bases, not pictographs).
export function emojiViolations(text: string, allowPictographic = false): string[] {
  const out: string[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    if (cp === 0xfe0f) out.push('U+FE0F (emoji variation selector)')
    else if (cp === 0x20e3) out.push('U+20E3 (keycap mark)')
    else if ((EMOJI_BANNED as readonly string[]).includes(ch)) out.push('banned emoji-prone glyph ' + ch)
    else if (!allowPictographic && EXT_PICT.test(ch)) out.push('Extended_Pictographic ' + ch)
  }
  return out
}
const tableGlyphs = (g: GlyphTables): string[] => [...Object.values(g.state), ...Object.values(g.structure), ...Object.values(g.chart), ...(g.spark ?? []), ...Object.values(g.fallback ?? {})]
// a `verified` entry is `pending-owner` or `<YYYY-MM-DD> <terminal>`; anything else (`yes`, ``, `pending`) is refused
export const verifiedOk = (v: unknown): boolean => typeof v === 'string' && (v === 'pending-owner' || /^\d{4}-\d{2}-\d{2} \S/.test(v))
// I5 (a) + L3: every glyph is non-emoji, and each new-to-vocabulary glyph carries a `verified` entry
export function glyphTableViolations(g: GlyphTables = GLYPHS): string[] {
  const out: string[] = []
  for (const glyph of tableGlyphs(g)) for (const v of emojiViolations(glyph)) out.push(`glyph ${glyph}: ${v}`)
  for (const glyph of NEW_GLYPHS) {
    if (!tableGlyphs(g).includes(glyph)) continue
    const v = g.verified?.[glyph]
    if (!verifiedOk(v)) out.push(`glyph ${glyph} is new to the vocabulary and has no \`verified\` entry`)
  }
  return out
}
// I20 (tables): one glyph, one meaning. No glyph character under two meanings across the state, structure and chart tables; the ten state glyphs are pairwise distinct.
// (the fallbacks are alternatives for an existing meaning, so they are exempt from the cross-table check.)
export function vocabularyViolations(g: GlyphTables = GLYPHS): string[] {
  const out: string[] = []
  const seen = new Map<string, string>()
  for (const [group, table] of [['state', g.state], ['structure', g.structure], ['chart', g.chart]] as const) {
    for (const [name, glyph] of Object.entries(table)) {
      const prior = seen.get(glyph)
      if (prior !== undefined) out.push(`glyph ${glyph} means both ${prior} and ${group}.${name}`)
      else seen.set(glyph, group + '.' + name)
    }
  }
  for (const glyph of g.spark ?? []) {
    const prior = seen.get(glyph)
    if (prior !== undefined) out.push(`glyph ${glyph} means both ${prior} and spark`)
  }
  return out
}
// I20 (lines): no segment both bold and dim; no line outside header / verdict with more than one bold value (a `here` segment pair counts as one)
export function emphasisViolations(line: PaneLine): string[] {
  const out: string[] = []
  const segs = line.segs ?? []
  for (const s of segs) if (s.bold === true && s.dim === true) out.push('segment both bold and dim: ' + JSON.stringify(s.text))
  if (line.kind !== 'header' && line.kind !== 'verdict') {
    const value = (s: Seg): boolean => s.bold === true && s.role !== 'glyph' && s.role !== 'state' // a state's glyph and word are one mark, not a value
    const bolds = segs.filter(s => value(s) && s.here !== true).length + (segs.some(s => value(s) && s.here === true) ? 1 : 0)
    if (bolds > 1) out.push('more than one bold value on a ' + String(line.kind) + ' line')
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// formatters (§3.5): tab code never concatenates a unit

export function money(n: number): string {
  const neg = n < 0
  const [whole, frac] = Math.abs(n).toFixed(2).split('.')
  return (neg ? '-' : '') + '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + frac
}
// a ratio (1.17 = 117%) -> integer, floored, no space. The epsilon keeps 0.58 * 100 = 57.999... from reading 57.
export const pct = (ratio: number): string => Math.floor(ratio * 100 + 1e-9) + '%'
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
export const ago = (ms: number, t: Translate): string => t('ago', { age: dur(ms) })
// HH:MM when `ms` is on the same local day as `nowMs`, MM-DD otherwise
export function clock(ms: number, nowMs: number): string {
  const d = new Date(ms)
  const n = new Date(nowMs)
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return two(d.getHours()) + ':' + two(d.getMinutes())
  return two(d.getMonth() + 1) + '-' + two(d.getDate())
}
// 1 decimal below 10, integer above: 2.0 MB, 14 MB, 1.3 GB
export function size(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.max(0, bytes)
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return (u === 0 ? String(Math.round(v)) : v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' ' + units[u]
}
// 8 hex characters; a range `a..b` shortens both ends
export const sha = (s: string): string => s.split('..').map(x => x.slice(0, 8)).join('..')
// an identifier too long: cut from the LEFT, keeping the unique tail (`…2031601-0e0c`)
export function idTail(id: string, width: number): string {
  if (displayWidth(id) <= width) return id
  const chars = [...id]
  let out = ''
  let w = 1
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = cellWidth(chars[i].codePointAt(0) as number)
    if (w + cw > width) break
    out = chars[i] + out
    w += cw
  }
  return '…' + out
}
// prose too long: cut from the right with `…`
export function cutProse(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  let out = ''
  let w = 1
  for (const ch of text) {
    const cw = cellWidth(ch.codePointAt(0) as number)
    if (w + cw > width) break
    out += ch
    w += cw
  }
  return out + '…'
}
// number first, then the measure word from the string table; never `N*`
export const count = (n: number, measure: string): string => n + ' ' + measure

// ---------------------------------------------------------------------------------------------------------------------------------------------
// the status mapping (§3.3): classify (ordered precedence -> one atom) -> STATUS_MAP[domain][atom] -> StateId. stateOf / worst are the only producers of `Stated`.

export type Translate = (id: string, vars?: Record<string, string | number>) => string
declare const STATED: unique symbol
export type Stated = { readonly [STATED]: true; readonly id: StateId }
const STATED_OBJS = {} as Record<StateId, Stated>
for (const id of STATE_IDS) STATED_OBJS[id] = Object.freeze({ id }) as unknown as Stated
const stated = (id: StateId): Stated => STATED_OBJS[id]
export const isStated = (v: unknown): v is Stated => typeof v === 'object' && v !== null && Object.values(STATED_OBJS).includes(v as Stated)

export type Domain = 'verdict' | 'run' | 'seat' | 'round' | 'gate' | 'qc' | 'background' | 'task' | 'loadSource' | 'attention' | 'residueGroup' | 'cleanup'
export type RunSubject = { rc: number | null; final_status: string | null; stall: boolean; fresh: boolean }
export type SeatSubject = { kind: 'code' | 'plan'; verdict: string | null; status: string | null }
export type RoundSubject = { stale: boolean; converged: boolean; seats: readonly Stated[] }
export type BackgroundSubject = { exit: number | null; quietMs: number }
export type LoadSourceSubject = { source: string; behind: number; flags: number }
export type AttentionSubject = { source: Stated | null } // null = the one item of its own: task acceptance
export type CleanupSubject = { errors: number; done: number }
export type Subject = {
  verdict: string; run: RunSubject; seat: SeatSubject; round: RoundSubject; gate: string; qc: string; background: BackgroundSubject; task: string
  loadSource: LoadSourceSubject; attention: AttentionSubject; residueGroup: string; cleanup: CleanupSubject
}

// token normalisation, once: trim, upper-case; a prefix class (`NEEDS*`, `CACHE:*`) is one atom
const norm = (v: unknown): string => (typeof v === 'string' ? v.trim().toUpperCase() : '')
const present = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== ''
const FAILED_FINAL = ['FAILED', 'ERROR', 'KILLED']
const DONE_FINAL = ['REVIEWED', 'DONE', 'OK']

const CLASSIFY: { [D in Domain]: (s: Subject[D]) => string } = {
  verdict: s => norm(s),
  run: r => {
    const fs = present(r.final_status) ? norm(r.final_status) : null
    if ((typeof r.rc === 'number' && r.rc !== 0) || (fs !== null && FAILED_FINAL.includes(fs))) return 'failed'
    if (r.rc === 0 || (fs !== null && DONE_FINAL.includes(fs))) return 'done'
    if (fs !== null) return 'weird' // a final_status in neither set beats stall and freshness; the raw text goes to detail
    if (r.stall) return 'stall'
    return r.fresh ? 'running' : 'stopped'
  },
  seat: s => {
    if (present(s.verdict)) return s.kind + ':' + norm(s.verdict)
    if (present(s.status)) return 'status:' + norm(s.status)
    return 'none'
  },
  round: r => {
    if (r.stale && !r.converged) return 'stale'
    const ids = r.seats.map(x => x.id)
    if (ids.includes('running')) return 'running'
    if (ids.includes('failed')) return 'failed'
    if (ids.includes('findings')) return 'findings'
    if (r.converged || (ids.length > 0 && ids.every(i => i === 'done'))) return 'done'
    return 'open' // seats not started / stopped / unknown and nothing converged (a gap in §3.3, filled as `stopped`)
  },
  gate: g => (norm(g).startsWith('NEEDS') ? 'NEEDS' : norm(g)),
  qc: q => norm(q),
  background: b => {
    if (b.exit !== null) return b.exit === 0 ? 'exit0' : 'exitN'
    return b.quietMs <= FRESH_MS.quiet ? 'fresh' : 'quiet'
  },
  task: t => norm(t),
  loadSource: l => {
    const src = norm(l.source)
    if (src.startsWith('CACHE:') || src === 'MISSING') return 'bad'
    if (l.behind > 0 || l.flags > 0) return 'bad'
    return src === 'DEV' || src === 'DIRECTORY' ? 'ok' : 'weird'
  },
  attention: a => (a.source === null ? 'acceptance' : 'from:' + a.source.id),
  residueGroup: c => norm(c).toLowerCase(),
  cleanup: c => (c.errors > 0 ? 'error' : c.done > 0 ? 'done' : 'nothing'),
}
const ATTENTION_FROM = Object.fromEntries(STATE_IDS.map(id => ['from:' + id, id])) as Record<string, StateId>
export const STATUS_MAP: { [D in Domain]: Record<string, StateId> } = {
  verdict: { DECIDE: 'need_you', STALLED: 'stalled', WAITING: 'done', RUNNING: 'running', IDLE: 'stopped' },
  run: { failed: 'failed', done: 'done', weird: 'unknown', stall: 'stalled', running: 'running', stopped: 'stopped' },
  seat: {
    'code:SHIP-AS-IS': 'done', 'code:FIX-THEN-SHIP': 'findings', 'code:BLOCK': 'failed', 'code:REJECT': 'failed',
    'plan:READY': 'done', 'plan:APPROVE': 'done', 'plan:PASS': 'done', 'plan:CONDITIONAL': 'findings', 'plan:STOP': 'findings', 'plan:REJECT': 'failed',
    'status:RUNNING': 'running', 'status:REVIEWED': 'done',
  },
  round: { stale: 'stopped', running: 'running', failed: 'failed', findings: 'findings', done: 'done', open: 'stopped' },
  gate: { PASS: 'done', OK: 'done', ACCEPT: 'done', APPROVED: 'done', CONVERGED: 'done', OPEN: 'need_you', OWED: 'need_you', NEEDS: 'need_you', FAIL: 'failed', REJECT: 'failed', BLOCK: 'failed' },
  qc: { OK: 'done', OWED: 'need_you', NOT_NEEDED: 'skipped', UNKNOWN: 'unknown' },
  background: { exitN: 'failed', exit0: 'done', fresh: 'running', quiet: 'stopped' },
  task: { COMPLETED: 'done', IN_PROGRESS: 'running', PENDING: 'pending' },
  loadSource: { bad: 'need_you', ok: 'done', weird: 'unknown' },
  attention: { acceptance: 'need_you', ...ATTENTION_FROM },
  residueGroup: { dirty: 'need_you', 'clean-integrated': 'need_you', 'clean-unintegrated': 'need_you', 'unintegrated-branch': 'need_you', 'missing-dir': 'need_you', live: 'running', unverifiable: 'unknown' },
  cleanup: { error: 'failed', done: 'done', nothing: 'skipped' },
}
export function classify<D extends Domain>(domain: D, subject: Subject[D]): string {
  return (CLASSIFY[domain] as (s: Subject[D]) => string)(subject)
}
export function stateOf<D extends Domain>(domain: D, subject: Subject[D]): Stated {
  return stated(STATUS_MAP[domain][classify(domain, subject)] ?? 'unknown')
}
// the worst of several states under SEVERITY; [] -> skipped
export function worst(states: readonly Stated[]): Stated {
  if (states.length === 0) return stated('skipped')
  let best = states[0].id
  for (const s of states) if (SEVERITY.indexOf(s.id) < SEVERITY.indexOf(best)) best = s.id
  return stated(best)
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// fact ownership (§2.6): every fact has one home tab; any other tab shows it only as a projection (a line with `goto`)

export type Owner = PaneTab | 'header'
export const FACT_OWNER = {
  'dispatch.runs': 'dispatch', 'dispatch.counts': 'dispatch',
  'review.round': 'review', 'review.seats': 'review', 'review.qc': 'review', 'review.gates': 'review', 'review.plan': 'review',
  'review.decisions': 'review', 'review.ladder': 'review', 'review.undocumented': 'review',
  'now.attention': 'now', 'now.position': 'now', 'now.background': 'now', 'now.tasks': 'now', 'now.recent': 'now',
  'usage.limit_max': 'spend', 'usage.brain': 'spend', 'usage.window5h': 'spend', 'usage.window7d': 'spend', 'usage.today': 'spend', 'usage.history': 'spend', 'usage.account': 'spend',
  'spend.session': 'spend', 'spend.local_today': 'spend',
  'usage.window_other': 'spend', // any other rate-limit window the host reports (spend_limit, an unknown kind)
  'residue.groups': 'hygiene', 'residue.cleanup': 'hygiene', 'residue.source': 'hygiene',
  'header.verdict': 'header',
} as const satisfies Record<string, Owner>
export type FactId = keyof typeof FACT_OWNER

// the order of sections inside each tab (§2.1), as data; and the sections that start folded (要你處理 never does)
export const SECTION_ORDER: Record<PaneTab, readonly string[]> = {
  now: ['attention', 'where', 'tabs', 'background', 'tasks', 'recent'],
  dispatch: ['running', 'finished', 'other'],
  review: ['code', 'qc', 'decisions', 'plan'],
  spend: ['limits', 'today', 'last24', 'account'],
  hygiene: ['attention', 'auto', 'source'],
  legend: ['states', 'structure', 'keys'],
}
export const SECTION_DEFAULTS: Record<string, { folded: boolean }> = { 'now.recent': { folded: true }, 'review.plan': { folded: true } }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// the brand: a PaneLine / Frag exists only if a component made it. `mk` and `frag` are not exported as makers for tab code to call by hand; the WeakSets are private.

export type LineKind = 'verdict' | 'header' | 'kv' | 'item' | 'bullet' | 'table' | 'meter' | 'empty' | 'more' | 'command' | 'detail' | 'chart' | 'blank'
declare const FRAG: unique symbol
export type Frag = { readonly [FRAG]: true; readonly text: string; readonly segs: readonly Seg[]; readonly fact?: FactId }
const MADE = new WeakSet<object>()
const FRAGS = new WeakSet<object>()
function mk(line: PaneLine & { kind: LineKind }): PaneLine {
  MADE.add(line)
  return line
}
export const isMade = (line: unknown): boolean => typeof line === 'object' && line !== null && MADE.has(line)
function frag(segs: Seg[], fact?: FactId): Frag {
  const f = { text: segs.map(s => s.text).join(''), segs, ...(fact === undefined ? {} : { fact }) }
  FRAGS.add(f)
  return f as unknown as Frag
}
export const isFrag = (v: unknown): v is Frag => typeof v === 'object' && v !== null && FRAGS.has(v)

export type FmtKind = 'money' | 'pct' | 'dur' | 'ago' | 'clock' | 'size' | 'sha' | 'id' | 'count'
export type SegRole = 'glyph' | 'state' | 'value' | 'prose' | 'key' | 'rule'
type SegOpts = { color?: ThemeKey; bold?: boolean; dim?: boolean; role?: SegRole; here?: boolean; fmt?: FmtKind }
const sg = (text: string, o: SegOpts = {}): Seg => ({ text, ...o })
const dim = (text: string, o: SegOpts = {}): Seg => sg(text, { ...o, dim: true })
export type Ctx = { t: Translate; cols: number; expanded?: ReadonlySet<string> }

// inline fragments: they exist only as arguments of a builder
export const val = (s: string, o: { role?: 'value' | 'prose'; fmt?: FmtKind; bold?: boolean; dim?: boolean; fact?: FactId } = {}): Frag => frag([sg(s, { role: o.role ?? 'value', ...(o.fmt ? { fmt: o.fmt } : {}), ...(o.bold ? { bold: true } : {}), ...(o.dim ? { dim: true } : {}) })], o.fact)
export const fmtd = (kind: FmtKind, s: string, fact?: FactId): Frag => frag([sg(s, { role: 'value', fmt: kind })], fact)
// the state glyph (state colour) and, unless `word: false`, its word (same colour)
export function stateLead(u: Ctx, s: Stated, o: { word?: boolean; wordW?: number } = {}): Frag {
  const st = STATES[s.id]
  const segs: Seg[] = [sg(st.glyph, { color: st.key, ...(st.bold ? { bold: true } : {}), role: 'glyph' })]
  if (o.word !== false) segs.push(sg(' '), sg(padCells(u.t('ui.state.' + s.id), o.wordW ?? 0), { color: st.key, ...(st.bold ? { bold: true } : {}), role: 'state' }))
  return frag(segs)
}
// a meter level's theme key: < 80% success, >= 80% warning, >= 100% error (on the raw ratio)
export const meterKey = (ratio: number): ThemeKey => (ratio >= 1 ? 'error' : ratio >= 0.8 ? 'warning' : 'success')
export function meterValue(value: number, cap: number, o: { cells: number; fact?: FactId }): Frag {
  const ratio = cap > 0 ? value / cap : 0
  const on = Math.max(0, Math.min(o.cells, Math.round(Math.min(1, ratio) * o.cells)))
  const key = meterKey(ratio)
  return frag([
    sg(GLYPHS.chart.meterOn.repeat(on), { color: key, role: 'glyph' }),
    ...(o.cells - on > 0 ? [sg(GLYPHS.chart.meterOff.repeat(o.cells - on), { color: 'inactive', role: 'glyph' })] : []),
    sg('  '),
    sg(padLeft(pct(ratio), 4), { color: key, bold: true, role: 'value', fmt: 'pct' }),
  ], o.fact)
}
const BADGE_STATES = ['need_you', 'running', 'stalled'] as const
export type BadgeStated = Stated & { readonly id: (typeof BADGE_STATES)[number] }
// narrows a Stated to the three states that have a badge form, so `stateBadge` rejects the other seven at the type level
export const isBadgeState = (s: Stated): s is BadgeStated => (BADGE_STATES as readonly string[]).includes(s.id)
// the only two badge constructors (§3.2 b, I14): ▲, ●N, ⊘N for a state; ⚑N for residue. Any other state is refused.
export function stateBadge(s: BadgeStated, n: number | undefined, fact: FactId): Frag {
  if (!isBadgeState(s)) throw new Error('badge: state ' + (s as Stated).id + ' has no badge form')
  const st = STATES[s.id]
  if (s.id !== 'need_you' && (n === undefined || n < 1)) throw new Error('badge: ' + s.id + ' needs a count')
  return frag([sg(st.glyph + (s.id === 'need_you' || n === undefined ? '' : String(n)), { color: st.key, role: 'glyph' })], fact)
}
export const residueBadge = (n: number, fact: FactId): Frag => frag([sg(GLYPHS.structure.residue + n, { color: 'warning', role: 'glyph' })], fact)
// a header's spend figures: one fragment per fact, no goto, typed as a projection of the 用量 facts
export function headerProjection(fact: FactId, s: string): Frag {
  if (FACT_OWNER[fact] !== 'spend') throw new Error('headerProjection: ' + fact + ' is not a spend fact')
  return frag([sg(s, { role: 'value', fmt: 'money', dim: true })], fact)
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// line builders. Every one returns PaneLine(s) stamped with a `kind` and registered with `mk`.

const segsOf = (...fs: (Frag | Seg)[]): Seg[] => fs.flatMap(f => (isFrag(f) ? [...f.segs] : [f as Seg]))
const lineOf = (kind: LineKind, segs: Seg[], extra: Partial<PaneLine> = {}): PaneLine => mk({ kind, text: segs.map(s => s.text).join(''), segs, ...extra })

export const blank = (): PaneLine => mk({ kind: 'blank', text: '' })

// `▾ Title  chip ────`: foldable section header (the toggle id is the section id); the rule runs to cols - 1
export function header(u: Ctx, title: string, fold: { id: string; open: boolean }, o: { right?: Frag; fact?: FactId } = {}): PaneLine {
  if (o.right !== undefined && o.fact === undefined) throw new Error('header: a chip needs a fact')
  const segs: Seg[] = [sg(fold.open ? GLYPHS.structure.open : GLYPHS.structure.folded, { color: 'subtle', role: 'glyph' }), sg(' '), sg(title, { bold: true, role: 'prose' })]
  if (o.right !== undefined) segs.push(sg('  '), ...o.right.segs)
  const fill = u.cols - 1 - displayWidth(segs.map(s => s.text).join('')) - 1
  if (fill >= 3) segs.push(sg(' ' + GLYPHS.structure.rule.repeat(fill), { color: 'subtle', role: 'rule' }))
  return lineOf('header', segs, { toggle: fold.id, ...(o.fact === undefined ? {} : { fact: o.fact }) })
}

// key (dim, padded to 12) + value at column 12; no value = a bare key heading the rows beneath it; goto = a press target (`key ›`)
export function kv(u: Ctx, key: string, value: readonly Frag[], o: { fact: FactId; goto?: PaneTab }): PaneLine {
  const label = o.goto === undefined ? key : key + ' ' + GLYPHS.structure.goto
  const segs: Seg[] = [dim(padCells(label, KEY_W), { role: 'key' }), ...segsOf(...value)]
  return lineOf('kv', segs, { hang: KEY_W, fact: o.fact, ...(o.goto === undefined ? {} : { goto: o.goto }) })
}
// an absent value: `—` plus a dim reason
export const absent = (reason: string): Frag => frag([dim(GLYPHS.structure.empty, { role: 'value' }), dim(' ' + reason, { role: 'prose' })])

// state glyph, state word (padded to the widest in the list), text, dim meta after ` · `, a toggle at the right edge
export function item(u: Ctx, s: Stated, body: string, meta: string | undefined, o: { fact: FactId; at?: 0 | 12; goto?: PaneTab; toggle?: { id: string; open: boolean }; word?: boolean; wordW?: number }): PaneLine {
  const st = STATES[s.id]
  const at = o.at ?? 0
  const segs: Seg[] = []
  if (at > 0) segs.push(sg(' '.repeat(at)))
  segs.push(...stateLead(u, s, { word: o.word, wordW: o.wordW }).segs, sg(' '))
  segs.push(sg(body, { role: 'prose', ...(s.id === 'need_you' ? { bold: true } : {}), ...(s.id === 'stopped' ? { dim: true } : {}) }))
  if (meta !== undefined && meta !== '') segs.push(dim(' · ' + meta, { role: 'value' }))
  return withToggle(u, 'item', segs, o)
}
// a neutral `◦` row that has no state
export function bullet(u: Ctx, body: string, meta: string | undefined, o: { fact: FactId; toggle?: { id: string; open: boolean } }): PaneLine {
  const segs: Seg[] = [dim(GLYPHS.structure.bullet, { role: 'glyph' }), sg(' '), sg(body, { role: 'prose' })]
  if (meta !== undefined && meta !== '') segs.push(dim(' · ' + meta, { role: 'value' }))
  return withToggle(u, 'bullet', segs, o)
}
function withToggle(u: Ctx, kind: 'item' | 'bullet', segs: Seg[], o: { fact: FactId; goto?: PaneTab; toggle?: { id: string; open: boolean } }): PaneLine {
  const extra: Partial<PaneLine> = { fact: o.fact, ...(o.goto === undefined ? {} : { goto: o.goto }) }
  if (o.toggle !== undefined || o.goto !== undefined) {
    const mark = o.toggle !== undefined ? (o.toggle.open ? GLYPHS.structure.open : GLYPHS.structure.folded) : tabName(o.goto as PaneTab, u)
    const overflow = displayWidth(segs.map(s => s.text).join('')) + 1 + displayWidth(mark) - (u.cols - 1)
    if (overflow > 0) { // too long: cut the body (the first prose segment) so the mark still fits
      const body = segs.findIndex(s => s.role === 'prose')
      if (body >= 0) segs[body] = { ...segs[body], text: cutProse(segs[body].text, Math.max(1, displayWidth(segs[body].text) - overflow)) }
    }
    const gap = Math.max(1, u.cols - 1 - displayWidth(segs.map(s => s.text).join('')) - displayWidth(mark))
    segs.push(sg(' '.repeat(gap)), dim(mark, { role: 'glyph' }))
    if (o.toggle !== undefined) extra.toggle = o.toggle.id
  }
  return lineOf(kind, segs, extra)
}
const tabName = (tab: PaneTab, u: Ctx): string => u.t('tab.' + tab) + ' ' + GLYPHS.structure.goto

// an empty state: `—` at column 0, dim reason at 2. At most one per section (I10).
export const empty = (reason: string, fact: FactId): PaneLine => lineOf('empty', [dim(GLYPHS.structure.empty, { role: 'glyph' }), dim(' ' + reason, { role: 'prose' })], { fact })
// `  ▸ 還有 27 筆已完成` (open: `  ▾ 收起`), a toggle at column 2
export function more(u: Ctx, n: number, noun: string, id: string, open = false): PaneLine {
  const body = open ? u.t('ui.collapse') : u.t('ui.more', { n, noun })
  return lineOf('more', [sg('  '), dim(open ? GLYPHS.structure.open : GLYPHS.structure.folded, { role: 'glyph' }), dim(' ' + body, { role: 'prose' })], { toggle: id })
}

// wrap plain text at spaces, after `/`, and between wide characters; continuation lines hang at `hang` (already part of `first`'s prefix width)
function wrapPlain(body: string, firstW: number, restW: number): string[] {
  const out: string[] = []
  let cur = ''
  let w = 0
  let limit = firstW
  let lastBreak = -1 // index into `cur` just after the last break opportunity
  for (const ch of body) {
    const cw = cellWidth(ch.codePointAt(0) as number)
    if (w + cw > limit && cur !== '') {
      const cut = lastBreak > 0 ? lastBreak : cur.length
      out.push(cur.slice(0, cut).replace(/ +$/, ''))
      cur = cur.slice(cut).replace(/^ +/, '')
      w = displayWidth(cur)
      limit = restW
      lastBreak = -1
    }
    cur += ch
    w += cw
    if (ch === ' ' || ch === '/' || cw === 2) lastBreak = cur.length
  }
  if (cur !== '') out.push(cur.replace(/ +$/, ''))
  return out
}
// `$` at 2, the command dim at 4; wraps at spaces and `/`, hangs at 4, is never cut (the owner copies it)
export function command(u: Ctx, cmd: string, o: { at?: 0 | 12 } = {}): PaneLine[] {
  const at = o.at ?? 0
  const pad = ' '.repeat(at)
  return wrapPlain(cmd, u.cols - 1 - at - 4, u.cols - 1 - at - 4).map((piece, i) =>
    lineOf('command', [sg(pad + '  '), dim(i === 0 ? GLYPHS.structure.command : ' ', { role: 'glyph' }), sg(' '), dim(piece, { role: 'value' })]))
}
// `└` at 2 with text at 4 when it belongs to the item above (it inherits that item's fact); a plain note at 2 otherwise (then it needs its own fact).
// The only kind allowed to carry raw tokens.
export function detail(u: Ctx, body: string, o: { attached: true; at?: 0 | 12; fact?: FactId } | { attached?: false; at?: 0 | 12; fact: FactId }): PaneLine[] {
  const at = o.at ?? 0
  const pad = ' '.repeat(at)
  if (o.attached === true) {
    return wrapPlain(body, u.cols - 1 - at - 4, u.cols - 1 - at - 4).map((piece, i) =>
      lineOf('detail', [sg(pad + '  '), dim(i === 0 ? GLYPHS.structure.detail : ' ', { role: 'glyph' }), sg(' '), dim(piece, { role: 'prose' })], o.fact === undefined ? {} : { fact: o.fact }))
  }
  return wrapPlain(body, u.cols - 1 - at - 2, u.cols - 1 - at - 2).map(piece => lineOf('detail', [sg(pad + '  '), dim(piece, { role: 'prose' })], { fact: (o as { fact: FactId }).fact }))
}

// a full-row meter: key, bar, percent, amount, then (when `resetMs` is given) the relative reset time
export function meter(u: Ctx, key: string, value: number, cap: number, o: { cells: number; amount?: Frag; resetMs?: number; fact: FactId }): PaneLine {
  const segs: Seg[] = [dim(padCells(key, KEY_W), { role: 'key' }), ...meterValue(value, cap, { cells: o.cells }).segs]
  if (o.amount !== undefined) segs.push(sg('  '), ...o.amount.segs)
  if (o.resetMs !== undefined) segs.push(sg('  '), dim(u.t('ui.reset', { age: dur(o.resetMs) }), { role: 'value', fmt: 'ago' }))
  return lineOf('meter', segs, { hang: KEY_W, fact: o.fact })
}

// charts: a two-line unit (value line + caption), both from column 12
export function chart(u: Ctx, key: string, value: Frag, caption: string | undefined, fact: FactId): PaneLine[] {
  const lines = [lineOf('chart', [dim(padCells(key, KEY_W), { role: 'key' }), ...value.segs], { hang: KEY_W, fact })]
  if (caption !== undefined) lines.push(lineOf('chart', [sg(' '.repeat(KEY_W)), dim(caption, { role: 'prose' })], { fact }))
  return lines
}
// the stage walk `✓─✓─◐─○─○`: done nodes success, the current node `◐` claude bold (tagged `here`), the rest inactive
export function walkValue(current: number, n: number): Frag {
  const segs: Seg[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) segs.push(dim(GLYPHS.structure.rule, { role: 'rule' }))
    if (i < current) segs.push(sg(STATES.done.glyph, { color: 'success', role: 'glyph' }))
    else if (i === current) segs.push(sg(GLYPHS.chart.here, { color: 'claude', bold: true, here: true, role: 'glyph' }))
    else segs.push(sg(STATES.pending.glyph, { color: 'inactive', role: 'glyph' }))
  }
  return frag(segs)
}
// a sparkline: one glyph per value scaled to the largest value
export function sparkValue(values: readonly number[]): Frag {
  const max = Math.max(0, ...values)
  const top = GLYPHS.spark.length - 1
  return frag([sg(values.map(v => GLYPHS.spark[max <= 0 ? 0 : Math.max(0, Math.min(top, Math.round((v / max) * top)))]).join(''), { role: 'glyph' })])
}

// ---- tables ---------------------------------------------------------------------------------------------------------------------------------
// Each column: { head, min, priority, flex?, cut }. `priority` 1 is kept longest; the column with the largest number is dropped first (the state column is
// always kept). When the table is still too wide, the `flex` column is cut to fit (an identifier from the left), then the others down to `min`. It never falls
// back to key/value blocks.
export type Column = { head: string; min: number; priority: number; flex?: boolean; cut: 'left' | 'right' }
export type TableRow = { state: Stated; cells: readonly string[] }
export function table(u: Ctx, columns: readonly Column[], rows: readonly TableRow[], o: { fact: FactId }): PaneLine[] {
  const stateHead = u.t('ui.table.state')
  const stateW = Math.max(displayWidth(stateHead), ...rows.map(r => displayWidth(u.t('ui.state.' + r.state.id)))) // the word column; the glyph and a space precede it
  const lead = 2 + stateW
  const w = columns.map((c, i) => Math.max(displayWidth(c.head), ...rows.map(r => displayWidth(r.cells[i] ?? ''))))
  const keep = columns.map((_, i) => i)
  const total = (): number => lead + keep.reduce((n, i) => n + 2 + w[i], 0)
  // 1. drop whole columns, the largest priority number first, only while the table cannot fit even with every kept column cut to its `min`
  //    (the state column is never dropped; one data column stays)
  const minTotal = (): number => lead + keep.reduce((n, i) => n + 2 + Math.min(w[i], columns[i].min), 0)
  while (minTotal() > u.cols - 1 && keep.length > 1) {
    let drop = keep[0]
    for (const i of keep) if (columns[i].priority > columns[drop].priority) drop = i
    keep.splice(keep.indexOf(drop), 1)
  }
  // 2. cut the flex column, then every other column, down to its `min`
  let over = total() - (u.cols - 1)
  for (const flexPass of [true, false]) {
    for (const i of keep) {
      if (over <= 0) break
      if ((columns[i].flex === true) !== flexPass) continue
      const take = Math.max(0, Math.min(w[i] - columns[i].min, over))
      w[i] -= take
      over -= take
    }
  }
  const fit = (cell: string, i: number): string => padCells(displayWidth(cell) > w[i] ? (columns[i].cut === 'left' ? idTail(cell, w[i]) : cutProse(cell, w[i])) : cell, w[i])
  const head = lineOf('table', [sg('  '), dim(padCells(stateHead, stateW), { role: 'key' }), ...keep.flatMap(i => [sg('  '), dim(padCells(columns[i].head, w[i]), { role: 'key' })])], { fact: o.fact })
  const body = rows.map(r => {
    const st = STATES[r.state.id]
    return lineOf('table', [
      sg(st.glyph, { color: st.key, role: 'glyph' }), sg(' '), sg(padCells(u.t('ui.state.' + r.state.id), stateW), { color: st.key, role: 'state' }),
      ...keep.flatMap(i => [sg('  '), sg(fit(r.cells[i] ?? '', i), { role: 'value' })]),
    ], { fact: o.fact })
  })
  return [head, ...body]
}

// ---- lists and sections -----------------------------------------------------------------------------------------------------------------------
// Every list of rows goes through list(): equal `group` keys fold into one counted row, rows run needs-you -> live -> finished and newest first inside a
// state, the cap applies to the grouped rows, and a `more` toggle carries the rest.
export type RowSpec = {
  group: string; ts: number; state: Stated; fact: FactId; body: string; meta?: string
  groupBody?: (n: number) => string // the text of a folded group of n rows
  kind?: 'item' | 'bullet'; toggle?: string; goto?: PaneTab; word?: boolean
}
export function list(u: Ctx, id: string, noun: string, rows: readonly RowSpec[], o: { cap?: number } = {}): PaneLine[] {
  const cap = o.cap ?? 5
  const groups = new Map<string, { first: RowSpec; n: number; state: Stated }>()
  for (const r of [...rows].sort((a, b) => b.ts - a.ts)) {
    const g = groups.get(r.group)
    if (g === undefined) groups.set(r.group, { first: r, n: 1, state: r.state })
    else { g.n++; g.state = worst([g.state, r.state]) }
  }
  const ordered = [...groups.values()].sort((a, b) => SEVERITY.indexOf(a.state.id) - SEVERITY.indexOf(b.state.id) || b.first.ts - a.first.ts)
  const expanded = u.expanded?.has('more:' + id) === true
  const shown = expanded ? ordered : ordered.slice(0, cap)
  const wordW = Math.max(0, ...shown.map(g => displayWidth(u.t('ui.state.' + g.state.id))))
  const out = shown.map(g => {
    const r = g.first
    const body = g.n > 1 && r.groupBody !== undefined ? r.groupBody(g.n) : r.body
    const tog = r.toggle === undefined ? undefined : { id: r.toggle, open: u.expanded?.has(r.toggle) === true }
    return r.kind === 'bullet'
      ? bullet(u, body, r.meta, { fact: r.fact, ...(tog === undefined ? {} : { toggle: tog }) })
      : item(u, g.state, body, r.meta, { fact: r.fact, wordW, ...(r.word === undefined ? {} : { word: r.word }), ...(tog === undefined ? {} : { toggle: tog }), ...(r.goto === undefined ? {} : { goto: r.goto }) })
  })
  if (ordered.length > cap) out.push(more(u, ordered.length - cap, noun, 'more:' + id, expanded))
  return out
}
// the sections of one tab, emitted in SECTION_ORDER[tab]; a missing or an unknown section id is an error, so tab code cannot reorder or skip a header
export function sections(tab: PaneTab, parts: Record<string, readonly PaneLine[]>): PaneLine[] {
  const order = SECTION_ORDER[tab]
  for (const id of Object.keys(parts)) if (!order.includes(id)) throw new Error('sections: ' + tab + ' has no section ' + id)
  for (const id of order) if (parts[id] === undefined) throw new Error('sections: ' + tab + ' is missing section ' + id)
  return order.flatMap(id => [...parts[id]])
}
// typed constructors for body lines of a tab (§2.6 rule 7): an owner row is checked against the tab, a projection must carry `goto` and belong to another tab
export function ownerRow(tab: PaneTab, fact: FactId, line: PaneLine): PaneLine {
  if (FACT_OWNER[fact] !== tab) throw new Error('ownerRow: ' + fact + ' is owned by ' + FACT_OWNER[fact] + ', not ' + tab)
  return line
}
export function projection(tab: PaneTab, fact: FactId, line: PaneLine): PaneLine {
  if (FACT_OWNER[fact] === tab) throw new Error('projection: ' + fact + ' is owned by ' + tab + ' (use ownerRow)')
  if (line.goto === undefined) throw new Error('projection: ' + fact + ' on ' + tab + ' needs goto')
  return line
}

// the global header (§2.2): line 1 = verdict glyph + word (state colour, bold), project (bold), elapsed (dim); line 2 = metrics (dim). At >= 110 columns, when both
// fit with a gap of at least 4 cells, they merge into one line with the metrics right-aligned.
export function verdictHeader(u: Ctx, v: { state: Stated; word: string; project: string; elapsed: string; metrics: readonly Frag[] }): PaneLine[] {
  const st = STATES[v.state.id]
  const left: Seg[] = [
    sg(st.glyph, { color: st.key, bold: true, role: 'glyph' }), sg(' '), sg(v.word, { color: st.key, bold: true, role: 'state' }), sg('  '),
    sg(v.project, { bold: true, role: 'value' }), dim(' · ' + v.elapsed, { role: 'value' }),
  ]
  const metrics: Seg[] = v.metrics.flatMap((m, i) => [...(i > 0 ? [dim(' · ')] : []), ...m.segs.map(s => ({ ...s, dim: true }))])
  const lw = displayWidth(left.map(s => s.text).join(''))
  const mw = displayWidth(metrics.map(s => s.text).join(''))
  if (u.cols >= 110 && lw + 4 + mw <= u.cols - 1) return [lineOf('verdict', [...left, sg(' '.repeat(u.cols - 1 - lw - mw)), ...metrics])]
  return [lineOf('verdict', left), lineOf('verdict', metrics)]
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// P3 (用量) helpers: fragments a tab joins into one value

// several fragments as one (a `chart` takes a single value fragment)
export const cat = (...fs: Frag[]): Frag => frag(fs.flatMap(f => [...f.segs]))
// a header chip naming a meter level (正常 / 接近上限 / 已超過), in the level's theme key; the word is the chip, there is no glyph
export const levelChip = (ratio: number, word: string, fact: FactId): Frag => frag([sg(word, { color: meterKey(ratio), role: 'value' })], fact)
// a plain share bar of `cells` cells (default text colour: a share is not a level)
export const barValue = (cells: number): Frag => frag([sg(GLYPHS.chart.meterOn.repeat(Math.max(0, cells)), { role: 'glyph' })])
