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
// terminal (P0 b). `↓` is East Asian Ambiguous and its width is still unchecked (`pending-owner`); the owner's 2026-10-14 ruling settled only its meaning (behind upstream, nothing else), see the plan §8. `fallback` is the next candidate when a glyph fails that check (§8 Q2); it is linted like every other glyph.
export const GLYPHS = {
  state: { need_you: '▲', failed: '✗', stalled: '⊘', findings: '△', running: '●', done: '✓', pending: '○', stopped: '◌', skipped: '∅', unknown: '?' },
  structure: { open: '▾', folded: '▸', rule: '─', detail: '└', command: '$', goto: '›', bullet: '◦', empty: '—', tabMark: '━', residue: '⚑', behind: '↓', bandSep: '│', info: 'ⓘ', round: '↺', decisions: '◆', age: '◷', recommend: '★' },
  chart: { meterOn: '▰', meterOff: '▱', here: '◐' },
  spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  fallback: { stalled: '◍', findings: '!' },
  verified: { '⊘': '2026-10-13 owner-ssh-tmux', '△': '2026-10-13 owner-ssh-tmux', '○': '2026-10-13 owner-ssh-tmux', '◌': '2026-10-13 owner-ssh-tmux', '∅': '2026-10-13 owner-ssh-tmux', '◦': '2026-10-13 owner-ssh-tmux', '›': '2026-10-13 owner-ssh-tmux', '━': '2026-10-13 owner-ssh-tmux', '◐': '2026-10-13 owner-ssh-tmux', '◍': '2026-10-13 owner-ssh-tmux', '↓': 'pending-owner', '★': 'pending-owner' } as Record<string, string>,
}
// glyphs that are new to the pane's vocabulary: each must carry a `verified` entry (L3)
export const NEW_GLYPHS = ['⊘', '△', '○', '◌', '∅', '◦', '›', '━', '◐', '◍', '↓', '★'] as const
// Extended_Pictographic glyphs a terminal may draw as an emoji box (§3.4); repeated so the rule survives a Unicode update
export const EMOJI_BANNED = ['⏸', '⚙', '⚠', '✔', '✖', '▶', '⏹', '⏺', '▪', '▫'] as const

// The semantic palette (owner ruling 2026-10-16): ONE colour means ONE thing. This table is the only place in mods/live that names a theme key; every colour the pane
// and the band draw goes through a ROLE here (ui-lint L8 reads the sources and fails on a theme-key literal anywhere else). A role with no entry (`undefined`) is the
// default text colour, `dim` is a weight (not a key), and bold is a whitelist (BOLD_USES below).
//   attention  (warning)    = the owner must look or act        here      (claude)     = you are here
//   broken     (error)      = failed, stalled or over the cap   done      (success)    = finished
//   running    (suggestion) = running now                       idle      (inactive)   = nothing to do
//   structure  (subtle)     = rules, fold marks, separators
export type PaletteRole = 'attention' | 'here' | 'broken' | 'done' | 'running' | 'idle' | 'structure'
export const PALETTE: Record<PaletteRole, ThemeKey> = { attention: 'warning', here: 'claude', broken: 'error', done: 'success', running: 'suggestion', idle: 'inactive', structure: 'subtle' }
// the one bold whitelist: a section title, the verdict line, the active tab name, a tab name that needs the owner, a decision card's question, a picked decision option and the send button. Nothing else is bold.
export const BOLD_USES = ['header title', 'verdict line', 'active tab name', 'needing tab name', 'question title', 'picked option', 'send button'] as const
// which whitelist entry a bold segment belongs to, or null (a violation); invariant I4 reads this so the test never keeps its own copy of the list
export function boldUseOf(line: PaneLine, s: Seg): (typeof BOLD_USES)[number] | null {
  if (line.kind === 'verdict') return 'verdict line'
  if (line.kind === 'header' && s.role === 'prose') return 'header title'
  if (s.role === 'tab') return s.here === true && (s.color === undefined || s.color === PALETTE.attention) ? 'active tab name' : s.color === PALETTE.attention ? 'needing tab name' : null
  if (line.kind === 'item' && s.role === 'title') return 'question title'
  if (line.kind === 'choice' && s.role === 'pick') return 'picked option'
  if (line.kind === 'choice' && s.role === 'send' && s.press !== undefined) return 'send button'
  return null
}
// a segment option that sets a colour only when there is one (the default text colour is the absence of a key)
export const tone = (k: ThemeKey | undefined): { color?: ThemeKey } => (k === undefined ? {} : { color: k })

// glyph colour (key) and word colour (wordKey): a need_you row draws only its mark yellow (the owner's attention is drawn once per surface: the verdict line and the tab name
// carry the yellow words), findings (待修) is not the owner's to act on, so it is default text
export const STATES: Record<StateId, { glyph: string; key: ThemeKey | undefined; wordKey: ThemeKey | undefined }> = {
  need_you: { glyph: GLYPHS.state.need_you, key: PALETTE.attention, wordKey: undefined },
  failed: { glyph: GLYPHS.state.failed, key: PALETTE.broken, wordKey: PALETTE.broken },
  stalled: { glyph: GLYPHS.state.stalled, key: PALETTE.broken, wordKey: PALETTE.broken },
  findings: { glyph: GLYPHS.state.findings, key: undefined, wordKey: undefined },
  running: { glyph: GLYPHS.state.running, key: PALETTE.running, wordKey: PALETTE.running },
  done: { glyph: GLYPHS.state.done, key: PALETTE.done, wordKey: PALETTE.done },
  pending: { glyph: GLYPHS.state.pending, key: PALETTE.idle, wordKey: PALETTE.idle },
  stopped: { glyph: GLYPHS.state.stopped, key: PALETTE.idle, wordKey: PALETTE.idle },
  skipped: { glyph: GLYPHS.state.skipped, key: PALETTE.idle, wordKey: PALETTE.idle },
  unknown: { glyph: GLYPHS.state.unknown, key: PALETTE.idle, wordKey: PALETTE.idle },
}
// the one total order of "worse" (§3.3); `unknown` ranks last so a missing mapping never hides a real finding
export const SEVERITY: readonly StateId[] = ['need_you', 'failed', 'stalled', 'findings', 'running', 'stopped', 'pending', 'done', 'skipped', 'unknown']

// freshness thresholds (§2.5), ms; dispatch = a finished run older than 6 h is counted in the chip, not listed (BL-0149); abandonedPlan = a non-terminal plan review untouched for 7 d fades to one line; every comparison is strict (`>`): exactly at the threshold is still fresh
export const FRESH_MS = { quiet: 1_800_000, planReview: 86_400_000, terminalPlan: 604_800_000, abandonedPlan: 604_800_000, codeReview: 86_400_000, dispatch: 21_600_000 } as const
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
  if (line.kind !== 'header' && line.kind !== 'verdict' && line.kind !== 'choice') { // a decision card's picked option is bold as a whole (head and label)
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
  return '…' + out.replace(/^[-_.]+/, '')
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
export type RunSubject = { rc: number | null; final_status: string | null; stall: boolean; fresh: boolean; starting?: boolean } // `starting`: never probed yet, but inside the freshness bound since launch
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
    return r.fresh ? 'running' : r.starting === true ? 'starting' : 'stopped'
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
    // §3.3 has no row for a round whose seats are partly `unknown` and nothing is running, failed or to fix (a gap, decided in P1): the round is `unknown`, not
    // `stopped`. `stopped` means "no verdict, or stale"; `unknown` means "a token missing from the mapping", and a round holding one is the second. worst() would
    // rank it last and show `done`, which hides it again.
    if (ids.includes('unknown')) return 'unknown'
    return 'open' // no seats published: the round is not moving and has no verdict (`stopped`)
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
  cleanup: c => (c.errors > 0 ? 'errors' : c.done > 0 ? 'done' : 'nothing'),
}
const ATTENTION_FROM = Object.fromEntries(STATE_IDS.map(id => ['from:' + id, id])) as Record<string, StateId>
export const STATUS_MAP: { [D in Domain]: Record<string, StateId> } = {
  verdict: { DECIDE: 'need_you', STALLED: 'stalled', WAITING: 'done', RUNNING: 'running', IDLE: 'stopped' },
  run: { failed: 'failed', done: 'done', weird: 'unknown', stall: 'stalled', running: 'running', starting: 'pending', stopped: 'stopped' },
  seat: {
    'code:SHIP-AS-IS': 'done', 'code:FIX-THEN-SHIP': 'findings', 'code:BLOCK': 'failed', 'code:REJECT': 'failed',
    'plan:READY': 'done', 'plan:APPROVE': 'done', 'plan:PASS': 'done', 'plan:CONDITIONAL': 'findings', 'plan:STOP': 'findings', 'plan:REJECT': 'failed', 'plan:BLOCK': 'failed', // Q5: REJECT and BLOCK are both ✗ 失敗, in a plan review as in a code review
    'status:RUNNING': 'running', 'status:REVIEWED': 'done',
  },
  round: { stale: 'stopped', running: 'running', failed: 'failed', findings: 'findings', done: 'done', unknown: 'unknown', open: 'stopped' },
  gate: { PASS: 'done', OK: 'done', ACCEPT: 'done', APPROVED: 'done', CONVERGED: 'done', OPEN: 'need_you', OWED: 'need_you', NEEDS: 'need_you', FAIL: 'failed', REJECT: 'failed', BLOCK: 'failed' },
  qc: { OK: 'done', OWED: 'need_you', NOT_NEEDED: 'skipped', UNKNOWN: 'unknown' },
  background: { exitN: 'failed', exit0: 'done', fresh: 'running', quiet: 'stopped' },
  task: { COMPLETED: 'done', IN_PROGRESS: 'running', PENDING: 'pending' },
  loadSource: { bad: 'need_you', ok: 'done', weird: 'need_you' }, // a source that is neither the dev directory nor a known cache copy is not the copy the owner expects
  attention: { acceptance: 'need_you', ...ATTENTION_FROM },
  residueGroup: { dirty: 'need_you', 'clean-integrated': 'done', 'clean-unintegrated': 'need_you', 'unintegrated-branch': 'need_you', 'missing-dir': 'done', live: 'running', unverifiable: 'unknown' }, // a 'clean' class (RESIDUE_KINDS) is drawn as a neutral row, never as a mark
  cleanup: { errors: 'failed', done: 'done', nothing: 'skipped' },
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

export type Owner = PaneTab | 'header' | 'pane'
export const FACT_OWNER = {
  'dispatch.runs': 'dispatch', 'dispatch.counts': 'dispatch',
  'review.round': 'review', 'review.seats': 'review', 'review.qc': 'review', 'review.gates': 'review', 'review.plan': 'review',
  'review.decisions': 'review', 'review.ladder': 'review', 'review.undocumented': 'review',
  'decide.cards': 'decide',
  'now.attention': 'now', 'now.position': 'now', 'now.background': 'now', 'now.tasks': 'now', 'now.recent': 'now',
  'usage.limit_max': 'spend', 'usage.brain': 'spend', 'usage.window5h': 'spend', 'usage.window7d': 'spend', 'usage.today': 'spend', 'usage.history': 'spend', 'usage.account': 'spend',
  'spend.session': 'spend', 'spend.local_today': 'spend',
  'usage.window_other': 'spend', // any other rate-limit window the host reports (spend_limit, an unknown kind)
  'residue.groups': 'hygiene', 'residue.cleanup': 'hygiene', 'residue.source': 'hygiene',
  'legend.states': 'legend', 'legend.structure': 'legend', 'legend.keys': 'legend',
  'header.verdict': 'header',
  'pane.chrome': 'pane', // lines that carry no fact of the session (the blank between sections, a heading with no chip, a fold / more toggle, an attached detail)
  'pane.overflow': 'pane', // pane.tsx's own scroll state, not a fact of the session: the header's last metrics line says how many rows lie below
} as const satisfies Record<string, Owner>
export type FactId = keyof typeof FACT_OWNER

// the order of sections inside each tab (§2.1), as data; and the sections that start folded (要你處理 never does)
export const SECTION_ORDER: Record<PaneTab, readonly string[]> = {
  now: ['attention', 'where', 'tabs', 'background', 'tasks', 'recent'],
  decide: ['cards'],
  dispatch: ['running', 'finished', 'other'],
  review: ['code', 'qc', 'decisions', 'plan'],
  spend: ['limits', 'today', 'last24', 'account'],
  hygiene: ['attention', 'cleanable', 'auto', 'source'],
  legend: ['states', 'structure', 'keys'],
}
// the sections that start folded: read by recentLines (now.recent) through sectionOpen; review.plan folds only while it is stale (F2, I11), by passing `stale` to sectionOpen
export const SECTION_DEFAULTS: Record<string, { folded: boolean }> = { 'now.recent': { folded: true }, 'review.plan': { folded: true }, 'hygiene.cleanable': { folded: false } }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// the brand: a PaneLine / Frag exists only if a component made it. `mk` and `frag` are not exported as makers for tab code to call by hand; the WeakSets are private.

export type LineKind = 'verdict' | 'header' | 'kv' | 'item' | 'bullet' | 'table' | 'meter' | 'empty' | 'more' | 'command' | 'detail' | 'chart' | 'blank' | 'choice' | 'field'
declare const FRAG: unique symbol
export type Frag = { readonly [FRAG]: true; readonly text: string; readonly segs: readonly Seg[]; readonly fact?: FactId }
const MADE = new WeakSet<object>()
const FRAGS = new WeakSet<object>()
type LineInit = Omit<PaneLine, 'kind' | 'fact'> & { kind?: LineKind; fact?: FactId }
function mk(line: LineInit & { kind: LineKind }): PaneLine {
  MADE.add(line)
  return line as PaneLine // a made line carries a fact: the components below pass one, and the invariants (I-fact) check it over every tab
}
export const isMade = (line: unknown): boolean => typeof line === 'object' && line !== null && MADE.has(line)
function frag(segs: Seg[], fact?: FactId): Frag {
  const f = { text: segs.map(s => s.text).join(''), segs, ...(fact === undefined ? {} : { fact }) }
  FRAGS.add(f)
  return f as unknown as Frag
}
export const isFrag = (v: unknown): v is Frag => typeof v === 'object' && v !== null && FRAGS.has(v)

export type FmtKind = 'money' | 'pct' | 'dur' | 'ago' | 'clock' | 'size' | 'sha' | 'id' | 'count'
export type SegRole = 'glyph' | 'state' | 'value' | 'prose' | 'key' | 'rule' | 'tab' | 'title' | 'pick' | 'send'
type SegOpts = { color?: ThemeKey; bold?: boolean; dim?: boolean; role?: SegRole; here?: boolean; fmt?: FmtKind; press?: string }
const sg = (text: string, o: SegOpts = {}): Seg => ({ text, ...o })
const dim = (text: string, o: SegOpts = {}): Seg => sg(text, { ...o, dim: true })
export type Ctx = { t: Translate; cols: number; expanded?: ReadonlySet<string> }

// inline fragments: they exist only as arguments of a builder
export const val = (s: string, o: { role?: 'value' | 'prose'; fmt?: FmtKind; bold?: boolean; dim?: boolean; here?: boolean; tone?: 'dim' | 'strong'; fact?: FactId } = {}): Frag => frag([sg(s, { role: o.role ?? 'value', ...(o.fmt ? { fmt: o.fmt } : {}), ...(o.here ? { here: true } : {}), ...(o.bold || o.tone === 'strong' ? { bold: true } : {}), ...(o.dim || o.tone === 'dim' ? { dim: true } : {}) })], o.fact)
export const fmtd = (kind: FmtKind, s: string, fact?: FactId): Frag => frag([sg(s, { role: 'value', fmt: kind })], fact)
// the state glyph (state colour) and, unless `word: false`, its word (same colour)
export function stateLead(u: Ctx, s: Stated, o: { word?: boolean; wordW?: number } = {}): Frag {
  const st = STATES[s.id]
  const segs: Seg[] = [sg(st.glyph, { ...tone(st.key), role: 'glyph' })]
  if (o.word !== false) segs.push(sg(' '), sg(padCells(u.t('ui.state.' + s.id), o.wordW ?? 0), { ...tone(st.wordKey), role: 'state' }))
  return frag(segs)
}
// a meter level's theme key: < 80% default text (a healthy level says nothing), >= 80% attention, >= 100% broken (on the raw ratio)
export const meterKey = (ratio: number): ThemeKey | undefined => (ratio >= 1 ? PALETTE.broken : ratio >= 0.8 ? PALETTE.attention : undefined)
export function meterValue(value: number, cap: number, o: { cells: number; fact?: FactId }): Frag {
  const ratio = cap > 0 ? value / cap : 0
  const on = Math.max(0, Math.min(o.cells, Math.round(Math.min(1, ratio) * o.cells)))
  const key = meterKey(ratio)
  return frag([
    sg(GLYPHS.chart.meterOn.repeat(on), { ...tone(key), role: 'glyph' }),
    ...(o.cells - on > 0 ? [sg(GLYPHS.chart.meterOff.repeat(o.cells - on), { color: PALETTE.idle, role: 'glyph' })] : []),
    sg('  '),
    sg(padLeft(pct(ratio), 4), { ...tone(key), role: 'value', fmt: 'pct' }),
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
  return frag([sg(st.glyph + (s.id === 'need_you' || n === undefined ? '' : String(n)), { ...tone(st.key), role: 'glyph' })], fact)
}
// a header's spend figures: one fragment per fact, no goto, typed as a projection of the 用量 facts
export function headerProjection(fact: FactId, s: string, label?: string): Frag {
  if (FACT_OWNER[fact] !== 'spend') throw new Error('headerProjection: ' + fact + ' is not a spend fact')
  return frag([...(label === undefined ? [] : [sg(label + ' ', { role: 'prose', dim: true })]), sg(s, { role: 'value', fmt: 'money', dim: true })], fact)
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// line builders. Every one returns PaneLine(s) stamped with a `kind` and registered with `mk`.

const segsOf = (...fs: (Frag | Seg)[]): Seg[] => fs.flatMap(f => (isFrag(f) ? [...f.segs] : [f as Seg]))
const lineOf = (kind: LineKind, segs: Seg[], extra: Partial<PaneLine> = {}): PaneLine => mk({ kind, text: segs.map(s => s.text).join(''), segs, fact: 'pane.chrome', ...extra })

export const blank = (): PaneLine => mk({ kind: 'blank', text: '', fact: 'pane.chrome' })

// `▾ Title  chip ────`: foldable section header (the toggle id is the section id); the rule runs to cols - 1
export function header(u: Ctx, title: string, fold: { id: string; open: boolean }, o: { right?: Frag; fact?: FactId } = {}): PaneLine {
  if (o.right !== undefined && o.fact === undefined) throw new Error('header: a chip needs a fact')
  const lead: Seg = sg(fold.open ? GLYPHS.structure.open : GLYPHS.structure.folded, { color: PALETTE.structure, role: 'glyph' })
  const chip: Seg[] = o.right === undefined ? [] : [...o.right.segs]
  const titleSeg: Seg = sg(title, { bold: true, role: 'prose' })
  const widthOf = (): number => displayWidth([lead, sg(' '), titleSeg, ...(chip.length > 0 ? [sg('  '), ...chip] : [])].map(s => s.text).join(''))
  // the line is `cols - 1` wide with a rule of at least 3 cells (I4): a title or chip too long is cut (§3.1: no line wider than cols). The title goes first, down to
  // 6 cells; then the last chip segment (the dim meta) takes the rest.
  const room = u.cols - 1 - 1 - 3 // one space and a 3-cell rule
  let over = widthOf() - room
  if (over > 0) {
    titleSeg.text = cutProse(title, Math.max(Math.min(displayWidth(title), 6), displayWidth(title) - over))
    over = widthOf() - room
  }
  if (over > 0 && chip.length > 0) {
    const last = chip.length - 1
    chip[last] = { ...chip[last], text: cutProse(chip[last].text, Math.max(1, displayWidth(chip[last].text) - over)) }
  }
  const segs: Seg[] = [lead, sg(' '), titleSeg]
  if (chip.length > 0) segs.push(sg('  '), ...chip)
  const fill = u.cols - 1 - widthOf() - 1
  if (fill >= 3) segs.push(sg(' ' + GLYPHS.structure.rule.repeat(fill), { color: PALETTE.structure, role: 'rule' }))
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
export function item(u: Ctx, s: Stated, body: string, meta: Meta | undefined, o: { fact: FactId; at?: 0 | 12; goto?: PaneTab; toggle?: { id: string; open: boolean }; word?: boolean; wordW?: number }): PaneLine {
  const st = STATES[s.id]
  const at = o.at ?? 0
  const segs: Seg[] = []
  if (at > 0) segs.push(sg(' '.repeat(at)))
  segs.push(...stateLead(u, s, { word: o.word, wordW: o.wordW }).segs, sg(o.word === false ? ' ' : '  ')) // §5 mockups: two cells after the state word, one after a bare glyph
  segs.push(sg(body, { role: 'prose', ...(s.id === 'stopped' ? { dim: true } : {}) }))
  segs.push(...metaSegs(meta))
  return withToggle(u, 'item', segs, o)
}
// a neutral `◦` row that has no state
export function bullet(u: Ctx, body: string, meta: Meta | undefined, o: { fact: FactId; toggle?: { id: string; open: boolean } }): PaneLine {
  const segs: Seg[] = [dim(GLYPHS.structure.bullet, { role: 'glyph' }), sg(' '), sg(body, { role: 'prose' })]
  segs.push(...metaSegs(meta))
  return withToggle(u, 'bullet', segs, o)
}
// the dim meta after a row's body: parts joined by ` · `, each its own segment so a number keeps the formatter that made it (I8). A bare string is one part
// with no formatter (it must hold no number); `{ text, fmt }` names the formatter. Nothing concatenates a number into a string and hides it from the checker.
export type MetaPart = string | { text: string; fmt: FmtKind }
export type Meta = string | readonly MetaPart[]
const partText = (p: MetaPart): string => (typeof p === 'string' ? p : p.text)
const metaSegs = (meta: Meta | undefined): Seg[] => {
  const parts = meta === undefined ? [] : typeof meta === 'string' ? [meta] : meta
  return parts.filter(p => partText(p) !== '').flatMap(p => [dim(' · ', { role: 'prose' }), dim(partText(p), { role: 'value', ...(typeof p === 'string' ? {} : { fmt: p.fmt }) })])
}
function withToggle(u: Ctx, kind: 'item' | 'bullet', segs: Seg[], o: { fact: FactId; goto?: PaneTab; toggle?: { id: string; open: boolean } }): PaneLine {
  const extra: Partial<PaneLine> = { fact: o.fact, ...(o.goto === undefined ? {} : { goto: o.goto }) }
  const widthOf = (): number => displayWidth(segs.map(s => s.text).join(''))
  const mark = o.toggle !== undefined ? (o.toggle.open ? GLYPHS.structure.open : GLYPHS.structure.folded) : o.goto !== undefined ? tabName(o.goto, u) : ''
  fitSegs(segs, u.cols - 1 - (mark === '' ? 0 : 1 + displayWidth(mark))) // one item is one line (§2.4): too long = the body is cut so the line (and its mark) still fits
  if (mark !== '') {
    segs.push(sg(' '.repeat(Math.max(1, u.cols - 1 - widthOf() - displayWidth(mark)))))
    if (o.toggle === undefined && o.goto !== undefined) segs.push(dim(u.t('tab.' + o.goto), { role: 'prose' }), sg(' '), dim(GLYPHS.structure.goto, { role: 'glyph' })) // the press target: the tab's name, then the `›` glyph
    else segs.push(dim(mark, { role: 'glyph' }))
    if (o.toggle !== undefined) extra.toggle = o.toggle.id
  }
  return lineOf(kind, segs, extra)
}
// cut `segs` (in place) so their text is at most `limit` cells: the body (first prose segment) down to 8 cells at most, then the dim meta, then the body further
function fitSegs(segs: Seg[], limit: number): void {
  const widthOf = (): number => displayWidth(segs.map(s => s.text).join(''))
  const cutBy = (i: number, by: number): void => { segs[i] = { ...segs[i], text: cutProse(segs[i].text, Math.max(1, displayWidth(segs[i].text) - by)) } }
  if (widthOf() <= limit) return
  const b = segs.findIndex(s => s.role === 'prose')
  if (b >= 0) cutBy(b, Math.min(widthOf() - limit, Math.max(0, displayWidth(segs[b].text) - 8)))
  // the meta is ` · ` + part pairs after the body: the last parts go whole first, then the one left is cut
  while (b >= 0 && widthOf() > limit && segs.length - (b + 1) > 2) segs.splice(segs.length - 2, 2)
  if (b >= 0 && widthOf() > limit && segs.length - (b + 1) === 2) cutBy(segs.length - 1, widthOf() - limit)
  if (widthOf() > limit && b >= 0) cutBy(b, widthOf() - limit)
}
const tabName = (tab: PaneTab, u: Ctx): string => u.t('tab.' + tab) + ' ' + GLYPHS.structure.goto

// an empty state: `—` at column 0, dim reason at 2. At most one per section (I10).
export const empty = (reason: string, fact: FactId): PaneLine => lineOf('empty', [dim(GLYPHS.structure.empty, { role: 'glyph' }), dim(' ' + reason, { role: 'prose' })], { fact })
// `  ▸ 還有 27 筆已完成` (open: `  ▾ 收起`), a toggle at column 2
// `bare`: the whole group sits behind the toggle (`▸ 16 項已結束`), so there is no `還有` (it is not "more of a list")
export function more(u: Ctx, n: number, noun: string, id: string, open = false, bare = false): PaneLine {
  const body = open ? u.t('ui.collapse') : u.t(bare ? 'ui.more_all' : 'ui.more', { n, noun })
  return lineOf('more', [sg('  '), dim(open ? GLYPHS.structure.open : GLYPHS.structure.folded, { role: 'glyph' }), dim(' ' + body, { role: 'prose' })], { toggle: id })
}

// ---- the 待決 tab's controls (pick-and-submit). A `choice` line is a row of pressable options: every seg that carries a `press` id is drawn as a Button by
// pane.tsx, consecutive segs of one id are one Button. A `field` line is a label followed by a text field (pane.tsx draws the Input). Neither is a number or a state. ----
export type Choice = { label: string; picked: boolean; recommended: boolean; press?: string }
// the 待決 card's rows share the pane's key/value grammar: the key (dim) at column 2 in a 10-cell slot, the value at column 12, continuation lines hung at 12.
export const CARD_KEY_W = KEY_W - 2
const cardLead = (key: string): Seg[] => [sg('  '), dim(padCells(cutProse(key, CARD_KEY_W - 1), CARD_KEY_W), { role: 'key' })]
const cardHang = (): Seg => sg(' '.repeat(KEY_W))
// the question line(s): `▲ n. question` with the glyph of its state; the whole text is bold default text (the 'question title' bold use) while the question is open, plain once it is
// sent. It wraps (never cut, never repeated) and continuation lines start at column 2. `meta` (dim, after ` · `) closes the last line, or takes one of its own when it does not fit.
export function cardTitle(u: Ctx, s: Stated, title: string, meta: string | undefined, o: { fact: FactId; sent: boolean }): PaneLine[] {
  const room = u.cols - 1 - 2
  const pieces = wrapPlain(title, room, room)
  const lines = pieces.map((piece, i) => {
    const body = sg(piece, { role: 'title', ...(o.sent ? {} : { bold: true }) })
    const lead = i === 0 ? [...stateLead(u, s, { word: false }).segs, sg(' ')] : [sg('  ')]
    return lineOf('item', [...lead, body], { fact: o.fact, hang: 2 })
  })
  if (meta !== undefined && meta !== '') {
    const last = lines[lines.length - 1]
    const tail = dim(' · ' + meta, { role: 'prose' })
    if (displayWidth(last.text) + displayWidth(tail.text) <= u.cols - 1) lines[lines.length - 1] = lineOf('item', [...(last.segs as Seg[]), tail], { fact: o.fact, hang: 2 })
    else lines.push(lineOf('item', [sg('  '), dim(cutProse(meta, Math.max(1, room)), { role: 'prose' })], { fact: o.fact, hang: 2 }))
  }
  return lines
}
// one key/value row of a card: `  key       value` (the value wraps, continuation lines hang at column 12). `subtle` draws the value dim; an empty key makes a continuation-only row.
export function cardRow(u: Ctx, key: string, value: string, o: { fact: FactId; subtle?: boolean }): PaneLine[] {
  const room = Math.max(1, u.cols - 1 - KEY_W)
  return wrapPlain(value, room, room).map((piece, i) =>
    lineOf('kv', [...(i === 0 ? cardLead(key) : [cardHang()]), sg(piece, { role: 'prose', ...(o.subtle === true ? { dim: true } : {}) })], { hang: KEY_W, fact: o.fact }))
}
// the options of one question: the key `選項` at column 2, then rows of at most `cols - 1` cells from column 12: `[x] ★ label` (picked: bold default text) beside `[ ] label`, two
// cells between options. A press-less choice is drawn plain (a question already sent), its picked mark kept. The star marks the recommendation here and nowhere else.
export function choiceRows(u: Ctx, key: string, choices: readonly Choice[], o: { fact: FactId }): PaneLine[] {
  const room = u.cols - 1 - KEY_W
  const piece = (c: Choice): Seg[] => {
    const press = c.press === undefined ? {} : { press: c.press }
    const pick = c.picked ? { bold: true, role: 'pick' as const } : c.press === undefined ? { dim: true } : {}
    const head = c.picked ? '[x] ' : '[ ] '
    const star: Seg[] = c.recommended ? [sg(GLYPHS.structure.recommend, { role: 'glyph', ...press }), sg(' ', { role: 'prose', ...press })] : []
    const used = displayWidth(head) + star.reduce((n, x) => n + displayWidth(x.text), 0)
    return [sg(head, { role: 'prose', ...pick, ...press }), ...star, sg(cutProse(c.label, Math.max(1, room - used)), { role: 'prose', ...pick, ...press })]
  }
  const rows: Seg[][] = []
  let cur: Seg[] = []
  let w = 0
  for (const c of choices) {
    const segs = piece(c)
    const cw = segs.reduce((n, x) => n + displayWidth(x.text), 0)
    if (cur.length > 0 && w + 2 + cw > room) { rows.push(cur); cur = []; w = 0 }
    if (cur.length > 0) { cur.push(sg('  ')); w += 2 }
    cur.push(...segs)
    w += cw
  }
  if (cur.length > 0) rows.push(cur)
  return rows.map((r, i) => lineOf('choice', [...(i === 0 ? cardLead(key) : [cardHang()]), ...r], { fact: o.fact }))
}
// the send row: `[ label ]` at column 2, bold default text and pressable under `press`, dim and inert without it (nothing chosen yet, or already sent), then a dim `note` saying where
// the answers go; a note that does not fit beside the button takes the line below, at column 2.
export function actionRow(u: Ctx, label: string, o: { press?: string; note?: string; fact: FactId }): PaneLine[] {
  const text = cutProse('[ ' + label + ' ]', Math.max(1, u.cols - 1 - 2))
  const button = o.press === undefined ? dim(text, { role: 'prose' }) : sg(text, { role: 'send', bold: true, press: o.press })
  const note = o.note === undefined || o.note === '' ? undefined : o.note
  if (note !== undefined && 2 + displayWidth(text) + 2 + displayWidth(note) <= u.cols - 1) return [lineOf('choice', [sg('  '), button, sg('  '), dim(note, { role: 'prose' })], { fact: o.fact })]
  const out = [lineOf('choice', [sg('  '), button], { fact: o.fact })]
  if (note !== undefined) out.push(...wrapPlain(note, u.cols - 1 - 2, u.cols - 1 - 2).map(piece => lineOf('detail', [sg('  '), dim(piece, { role: 'prose' })], { fact: o.fact })))
  return out
}
// a labelled text field: the key at column 2, the Input at column 12 (drawn by pane.tsx; a surface without Input never gets this line: the card says to answer in the conversation)
export function fieldRow(u: Ctx, label: string, o: { key: string; placeholder: string; value: string; fact: FactId }): PaneLine {
  return lineOf('field', cardLead(label), { fact: o.fact, field: { key: o.key, placeholder: o.placeholder, value: o.value } })
}

const CLOSING_PUNCT_UI = '）」』、。，；：！？)]}】》〉,.;:!?'
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
      // in code points, so a step back never splits a surrogate pair
      const cps = [...cur]
      let cut = lastBreak > 0 ? [...cur.slice(0, lastBreak)].length : cps.length
      // a closing mark never starts a line: while the next line would open with one (after its leading spaces are dropped), the character before the cut goes
      // down too. This covers a run of marks (`。」`), a space before the mark, and a cut at an earlier break; at least one character stays on this line.
      const head = (k: number): string => (cps.slice(k).join('') + ch).replace(/^ +/, '')[0] ?? ''
      const closing = (c: string): boolean => c !== '' && CLOSING_PUNCT_UI.includes(c)
      while (cut > 1 && closing(head(cut))) cut -= 1
      out.push(cps.slice(0, cut).join('').replace(/ +$/, ''))
      cur = cps.slice(cut).join('').replace(/^ +/, '')
      w = displayWidth(cur)
      limit = restW
      lastBreak = -1
    }
    cur += ch
    w += cw
    if (ch === ' ' || ch === '/' || cw === 2) lastBreak = cur.length
  }
  if (cur !== '') out.push(cur.replace(/ +$/, ''))
  // a last line of one wide character (a CJK orphan) takes the last character of the line above, so no line is a lone glyph
  if (out.length > 1) {
    const last = [...out[out.length - 1]]
    const prev = [...out[out.length - 2]]
    if (last.length === 1 && cellWidth(last[0].codePointAt(0) as number) === 2 && prev.length > 2) { out[out.length - 2] = prev.slice(0, -1).join(''); out[out.length - 1] = prev[prev.length - 1] + last[0] }
  }
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
export function meter(u: Ctx, key: string, value: number, cap: number, o: { cells: number; amount?: Frag; resetMs?: number; fact: FactId; goto?: PaneTab }): PaneLine {
  const segs: Seg[] = [dim(padCells(o.goto === undefined ? key : key + ' ' + GLYPHS.structure.goto, KEY_W), { role: 'key' }), ...meterValue(value, cap, { cells: o.cells }).segs]
  if (o.amount !== undefined) segs.push(sg('  '), ...o.amount.segs)
  if (o.resetMs !== undefined) segs.push(sg('  '), dim(u.t('ui.reset', { age: dur(o.resetMs) }), { role: 'value', fmt: 'ago' }))
  return lineOf('meter', segs, { hang: KEY_W, fact: o.fact, ...(o.goto === undefined ? {} : { goto: o.goto }) })
}

// charts: a two-line unit (value line + caption), both from column 12
export function chart(u: Ctx, key: string, value: Frag, caption: string | undefined, fact: FactId): PaneLine[] {
  const lines = [lineOf('chart', [dim(padCells(key, KEY_W), { role: 'key' }), ...value.segs], { hang: KEY_W, fact })]
  if (caption !== undefined) lines.push(lineOf('chart', [sg(' '.repeat(KEY_W)), dim(caption, { role: 'prose' })], { fact }))
  return lines
}
// the stage walk `✓─✓─◐─○─○`: done nodes success, the current node `◐` claude (tagged `here`), the rest inactive
export function walkValue(current: number, n: number): Frag {
  const segs: Seg[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) segs.push(dim(GLYPHS.structure.rule, { role: 'rule' }))
    if (i < current) segs.push(sg(STATES.done.glyph, { color: PALETTE.done, role: 'glyph' }))
    else if (i === current) segs.push(sg(GLYPHS.chart.here, { color: PALETTE.here, here: true, role: 'glyph' }))
    else segs.push(sg(STATES.pending.glyph, { color: PALETTE.idle, role: 'glyph' }))
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
export type Cell = string | { text: string; fmt: FmtKind } // a cell holding a number names the formatter that made it (I8)
const cellText = (c: Cell | undefined): string => (c === undefined ? '' : typeof c === 'string' ? c : c.text)
const cellFmt = (c: Cell | undefined): { fmt?: FmtKind } => (c === undefined || typeof c === 'string' ? {} : { fmt: c.fmt })
export type TableRow = { state: Stated; cells: readonly Cell[]; group?: string; ts?: number } // group / ts are stamped on the line (I22); tableList() requires them
export function table(u: Ctx, columns: readonly Column[], rows: readonly TableRow[], o: { fact: FactId }): PaneLine[] {
  const stateHead = u.t('ui.table.state')
  const stateW = Math.max(displayWidth(stateHead), ...rows.map(r => displayWidth(u.t('ui.state.' + r.state.id)))) // the word column; the glyph and a space precede it
  const lead = 2 + stateW
  const w = columns.map((c, i) => Math.max(displayWidth(c.head), ...rows.map(r => displayWidth(cellText(r.cells[i])))))
  const floor = columns.map((c, i) => Math.max(c.min, Math.min(w[i], displayWidth(c.head)))) // a column never narrows below its own heading: the heading row must not wrap or clip, or it stops lining up with the cells under it
  const keep = columns.map((_, i) => i)
  const total = (): number => lead + keep.reduce((n, i) => n + 2 + w[i], 0)
  // 1. drop whole columns, the largest priority number first, only while the table cannot fit even with every kept column cut to its `min`
  //    (the state column is never dropped; one data column stays)
  const minTotal = (): number => lead + keep.reduce((n, i) => n + 2 + Math.min(w[i], floor[i]), 0)
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
      const take = Math.max(0, Math.min(w[i] - floor[i], over))
      w[i] -= take
      over -= take
    }
  }
  const fit = (cell: string, i: number): string => padCells(displayWidth(cell) > w[i] ? (columns[i].cut === 'left' ? idTail(cell, w[i]) : cutProse(cell, w[i])) : cell, w[i])
  const head = lineOf('table', [sg('  '), dim(padCells(stateHead, stateW), { role: 'key' }), ...keep.flatMap(i => [sg('  '), dim(padCells(columns[i].head, w[i]), { role: 'key' })])], { fact: o.fact })
  const body = rows.map(r => {
    const st = STATES[r.state.id]
    return lineOf('table', [
      sg(st.glyph, { ...tone(st.key), role: 'glyph' }), sg(' '), sg(padCells(u.t('ui.state.' + r.state.id), stateW), { ...tone(st.wordKey), role: 'state' }),
      ...keep.flatMap(i => [sg('  '), sg(fit(cellText(r.cells[i]), i), { role: 'value', ...cellFmt(r.cells[i]) })]),
    ], { fact: o.fact, ...(r.group === undefined ? {} : { group: r.group }), ...(r.ts === undefined ? {} : { ts: r.ts }) })
  })
  return [head, ...body]
}

// ---- lists and sections -----------------------------------------------------------------------------------------------------------------------
// Every list of rows goes through list(): equal `group` keys fold into one counted row, rows run needs-you -> live -> finished and newest first inside a
// state, the cap applies to the grouped rows, and a `more` toggle carries the rest.
export type RowSpec = {
  group: string; ts: number; state: Stated; fact: FactId; body: string; meta?: Meta
  groupBody?: (n: number) => string // the text of a folded group of n rows
  shape?: 'item' | 'bullet'; toggle?: string; goto?: PaneTab; word?: boolean
  at?: 0 | 12 // the column the row starts at (a seat `item` under the valueless `席位` key sits at 12)
  children?: readonly PaneLine[] // the detail / command lines that follow the row while its toggle is open
  bodyOpen?: string; metaOpen?: Meta // the row's own text while its toggle is open (an opened decision reads `id` + `可逆 · writer`)
}
// `keepOrder`: the rows stay in the order given (seats are a panel in seat order, not a queue; §5.3 draws s0, s1, s2, s3). Grouping and the cap still apply.
export function list(u: Ctx, id: string, noun: string, rows: readonly RowSpec[], o: { cap?: number; keepOrder?: boolean } = {}): PaneLine[] {
  const cap = o.cap ?? 5
  const groups = new Map<string, { first: RowSpec; n: number; state: Stated }>()
  for (const r of o.keepOrder === true ? rows : [...rows].sort((a, b) => b.ts - a.ts)) {
    const g = groups.get(r.group)
    if (g === undefined) groups.set(r.group, { first: r, n: 1, state: r.state })
    else { g.n++; g.state = worst([g.state, r.state]) }
  }
  const ordered = o.keepOrder === true ? [...groups.values()] : [...groups.values()].sort((a, b) => SEVERITY.indexOf(a.state.id) - SEVERITY.indexOf(b.state.id) || b.first.ts - a.first.ts)
  const expanded = u.expanded?.has('more:' + id) === true
  const shown = expanded ? ordered : ordered.slice(0, cap)
  const wordW = Math.max(0, ...shown.map(g => displayWidth(u.t('ui.state.' + g.state.id))))
  const out = shown.flatMap(g => {
    const r = g.first
    const isOpen = r.toggle !== undefined && u.expanded?.has(r.toggle) === true
    const body = isOpen && r.bodyOpen !== undefined ? r.bodyOpen : g.n > 1 && r.groupBody !== undefined ? r.groupBody(g.n) : r.body
    const meta = isOpen && r.bodyOpen !== undefined ? r.metaOpen : r.meta
    const tog = r.toggle === undefined ? undefined : { id: r.toggle, open: isOpen }
    const line = r.shape === 'bullet'
      ? bullet(u, body, meta, { fact: r.fact, ...(tog === undefined ? {} : { toggle: tog }) })
      : item(u, g.state, body, meta, { fact: r.fact, wordW, ...(r.at === undefined ? {} : { at: r.at }), ...(r.word === undefined ? {} : { word: r.word }), ...(tog === undefined ? {} : { toggle: tog }), ...(r.goto === undefined ? {} : { goto: r.goto }) })
    return isOpen && r.children !== undefined ? [line, ...r.children] : [line]
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
  if (fact === 'pane.chrome') return line // a heading, a toggle row or a spacer: no fact of the session, no owner to check
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
    sg(st.glyph, { ...tone(st.key), bold: true, role: 'glyph' }), sg(' '), sg(v.word, { ...tone(st.key), bold: true, role: 'state' }), sg('  '),
    sg(v.project, { bold: true, role: 'value' }), ...(v.elapsed === '' ? [] : [dim(' · ' + v.elapsed, { role: 'value' })]), // no known start: no elapsed segment
  ]
  const metrics: Seg[] = v.metrics.flatMap((m, i) => [...(i > 0 ? [dim(' · ')] : []), ...m.segs.map(s => ({ ...s, dim: true, ...(m.fact === undefined ? {} : { fact: m.fact }) }))])
  const lw = displayWidth(left.map(s => s.text).join(''))
  const mw = displayWidth(metrics.map(s => s.text).join(''))
  if (u.cols >= 110 && lw + 4 + mw <= u.cols - 1) return [lineOf('verdict', [...left, sg(' '.repeat(u.cols - 1 - lw - mw)), ...metrics], { fact: 'header.verdict' })]
  return [lineOf('verdict', left, { fact: 'header.verdict' }), lineOf('verdict', metrics, { fact: 'header.verdict' })]
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// P1 additions (the review tab): small helpers other tabs may reuse

// a header chip: the state glyph and word, then optional dim meta after ` · ` (`● 執行中 · 1 席已有發現`)
export function chip(u: Ctx, s: Stated, meta?: string, fmt?: FmtKind): Frag {
  const segs: Seg[] = [...stateLead(u, s).segs]
  if (meta !== undefined && meta !== '') segs.push(dim(' · ' + meta, { role: 'value', ...(fmt === undefined ? {} : { fmt }) })) // a number in the meta is tagged with the formatter that made it (I8)
  return frag(segs)
}
// a count of cells as a bar: `on` filled (done; with `here`, the last filled cell is the current one, tagged `here`), the rest inactive
export function stepBar(total: number, on: number, o: { here?: boolean } = {}): Frag {
  const k = Math.max(0, Math.min(total, on))
  const done = o.here === true ? Math.max(0, k - 1) : k
  const segs: Seg[] = []
  if (done > 0) segs.push(sg(GLYPHS.chart.meterOn.repeat(done), { color: PALETTE.done, role: 'glyph' }))
  if (o.here === true && k > 0) segs.push(sg(GLYPHS.chart.meterOn, { color: PALETTE.here, here: true, role: 'glyph' }))
  if (total - k > 0) segs.push(sg(GLYPHS.chart.meterOff.repeat(total - k), { color: PALETTE.idle, role: 'glyph' }))
  return frag(segs)
}
// whether a foldable section is open. `folded` holds the sections the person TOGGLED away from their default (register.ts flips membership on every press),
// so a section that starts folded (`defaultFolded`) is open exactly when it was toggled.
export const sectionOpen = (folded: ReadonlySet<string> | undefined, id: string, defaultFolded = false): boolean => defaultFolded === (folded?.has(id) === true)
// a wrapped piece of a made line keeps the brand and the line's identity (kind, fact, goto, hang); a hand-made line stays unbranded
export function carry(from: PaneLine, piece: LineInit): PaneLine {
  if (!MADE.has(from)) return piece as PaneLine
  return mk({ ...piece, kind: from.kind as LineKind, ...(from.fact === undefined ? {} : { fact: from.fact }), ...(from.goto === undefined ? {} : { goto: from.goto }), ...(from.hang === undefined ? {} : { hang: from.hang }) })
}

// P2 (派工) helpers

// a header chip made of a state glyph (no word) and a count: `✓ 32`. The section header names the state, the count says how many.
// a need_you count is a plain number: the owner's attention is drawn once per surface (the verdict line and the tab name), not again on the section title
export function countChip(u: Ctx, s: Stated, n: number, fact: FactId): Frag {
  const lead = s.id === 'need_you' ? [] : [...stateLead(u, s, { word: false }).segs, sg(' ')]
  return frag([...lead, ...plainCount(n, fact).segs], fact)
}

// a table whose rows go through the same rules as list(): equal `group` keys fold into one row (the newest), rows run in SEVERITY order and, inside a
// state, newest `ts` first, the cap applies to the grouped rows, and a `more` toggle carries the rest. A row without a `group` or a finite `ts` is refused.
export type TableListRow = TableRow & { group: string; ts: number }
export function tableList(u: Ctx, id: string, noun: string, columns: readonly Column[], rows: readonly TableListRow[], o: { fact: FactId; cap?: number }): PaneLine[] {
  for (const r of rows) if (typeof r.group !== 'string' || r.group === '' || !Number.isFinite(r.ts)) throw new Error('tableList: ' + id + ' has a row without group or ts')
  const cap = o.cap ?? 5
  const seen = new Set<string>()
  const ordered = [...rows].sort((a, b) => b.ts - a.ts).filter(r => (seen.has(r.group) ? false : (seen.add(r.group), true)))
    .sort((a, b) => SEVERITY.indexOf(a.state.id) - SEVERITY.indexOf(b.state.id) || b.ts - a.ts)
  const expanded = u.expanded?.has('more:' + id) === true
  const shown = expanded ? ordered : ordered.slice(0, cap)
  const out = table(u, columns, shown, { fact: o.fact })
  if (ordered.length > cap) out.push(more(u, ordered.length - cap, noun, 'more:' + id, expanded))
  return out
}

// P3 (用量) helpers: fragments a tab joins into one value

// several fragments as one (a `chart` takes a single value fragment)
export const cat = (...fs: Frag[]): Frag => frag(fs.flatMap(f => [...f.segs]))
// a header chip naming a meter level (正常 / 接近上限 / 已超過), in the level's theme key; the word is the chip, there is no glyph
export const levelChip = (ratio: number, word: string, fact: FactId): Frag => frag([sg(word, { ...tone(meterKey(ratio)), role: 'value' })], fact)
// a plain share bar of `cells` cells (default text colour: a share is not a level)
export const barValue = (cells: number): Frag => frag([sg(GLYPHS.chart.meterOn.repeat(Math.max(0, cells)), { role: 'glyph' })])

// ---------------------------------------------------------------------------------------------------------------------------------------------
// P5: the tab strip, the right-aligned hint, the 殘留 rows and the generated `?` tab. Every theme key, bold and dim of the pane's chrome is decided here;
// pane.tsx and band.tsx only draw the segments (drawSeg).

// the props a drawn Text gets from one segment: pane.tsx / band.tsx spread this, so they carry no colour decision of their own (§6.1)
export function drawSeg(s: Seg): { color: ThemeKey | undefined; bold: boolean | undefined; dimColor: boolean | undefined } {
  return { color: s.color, bold: s.bold, dimColor: s.dim }
}

// `need`: the tab holds something for the owner, so its name is drawn attention bold (the colour of `▲ 要你決定`)
export type StripTab = { id: PaneTab; label: string; need?: boolean }
export type Strip = {
  next: Seg | null // the next-tab chip `›`
  tabs: { id: PaneTab; on: boolean; label: Seg }[]
  rule: Seg[] // the baseline under the strip; on one row it carries the active mark (`━` under the active label)
  rows: number // drawn rows: the strip's wrapped rows + the baseline
  exact: boolean // the strip fits one row, so `rows` is certain and the `━` mark is drawn
}
// Q1 (owner 2026-10-13, revised 2026-10-16): no background; the active tab name is bold default text (attention bold when it needs the owner) and the `here` colour
// is only the run of `━` in the baseline; a strip that wraps falls back to bold alone. The `›` next-page button is an action, not a place: dim.
export function strip(u: Ctx, active: PaneTab, tabs: readonly StripTab[], hasNext: boolean): Strip {
  const next = hasNext ? sg(GLYPHS.structure.goto, { dim: true, role: 'glyph' }) : null
  const built = tabs.map(tb => {
    const on = tb.id === active
    const needs = tb.need === true
    // any tab that needs the owner is attention bold (the active one too: the `━` run marks where you are); the active one otherwise default bold, the rest dim.
    // `here` tags the active label for I4 and the strip test; it is not a colour
    const o: SegOpts = on ? { ...(needs ? { color: PALETTE.attention } : {}), bold: true, here: true, role: 'tab' } : needs ? { color: PALETTE.attention, bold: true, role: 'tab' } : { dim: true, role: 'tab' }
    const label = sg(' ' + tb.label + ' ', o)
    return { id: tb.id, on, label, width: displayWidth(label.text) + 1 }
  })
  let rows = 1
  let x = next === null ? 0 : displayWidth(next.text) + 1
  let w = x
  let markAt = -1
  let markW = 0
  for (const b of built) {
    if (w > 0 && w + b.width > u.cols) { rows++; w = 0 }
    if (b.on) { markAt = x; markW = displayWidth(b.label.text) }
    w += b.width
    x += b.width
  }
  const exact = rows === 1
  const bar = (n: number, glyph: string, o: SegOpts): Seg[] => (n > 0 ? [sg(glyph.repeat(n), { role: 'rule', ...o })] : [])
  const rule: Seg[] = exact && markAt >= 0
    ? [...bar(markAt, GLYPHS.structure.rule, { color: PALETTE.structure }), ...bar(markW, GLYPHS.structure.tabMark, { color: PALETTE.here, here: true }), ...bar(u.cols - markAt - markW, GLYPHS.structure.rule, { color: PALETTE.structure })]
    : bar(u.cols, GLYPHS.structure.rule, { color: PALETTE.structure })
  return { next, tabs: built.map(({ id, on, label }) => ({ id, on, label })), rule, rows: rows + 1, exact }
}

// a hint at the right edge of a made line: in the gap when the line leaves room, else in the run of blanks the one-line header already holds; null = no room
export function appendRight(u: Ctx, line: PaneLine, hint: string, fact: FactId): PaneLine | null {
  const base: Seg[] = line.segs ?? [{ text: line.text }]
  const hintSeg: Seg = { text: hint, dim: true, fact }
  const gap = u.cols - 1 - displayWidth(line.text) - displayWidth(hint)
  let segs: Seg[]
  if (gap >= 2) segs = [...base, { text: ' '.repeat(gap) }, hintSeg]
  else {
    const pad = base.findIndex((s, i) => i > 0 && i < base.length - 1 && /^ +$/.test(s.text) && s.text.length >= displayWidth(hint) + 4)
    if (pad < 0) return null
    const n = base[pad].text.length
    segs = [...base.slice(0, pad), { text: '  ' }, hintSeg, { text: ' '.repeat(n - 2 - displayWidth(hint)) }, ...base.slice(pad + 1)]
  }
  return carry(line, { text: segs.map(x => x.text).join(''), segs })
}

// the overflow hint (live-pane height): `N more rows below` (text only, no glyph; owner ruling 2026-10-14) at the right edge of the header's last metrics line
export const overflowHint = (u: Ctx, line: PaneLine, text: string): PaneLine | null => appendRight(u, line, text, 'pane.overflow')

// a row of the `?` tab: the example (a fragment) padded to the key column, then the explanation
export function legendRow(u: Ctx, example: Frag, body: string, fact: FactId): PaneLine {
  const w = displayWidth(example.text)
  const segs: Seg[] = [...example.segs, sg(' '.repeat(Math.max(1, KEY_W - w))), sg(body, { role: 'prose' })]
  return lineOf('kv', segs, { hang: w < KEY_W ? KEY_W : w + 1, fact })
}
// the `?` tab's three sections, generated from the same tables the tabs draw from: STATES, the structure glyphs, the meter levels (§5.6). Section ids: `sec:legend.<key>`.
export function legendParts(u: Ctx, folded: ReadonlySet<string> | undefined): Record<string, PaneLine[]> {
  const t = u.t
  const part = (key: string, title: string, body: readonly PaneLine[]): PaneLine[] => {
    const id = 'sec:legend.' + key
    const open = sectionOpen(folded, id)
    return [header(u, title, { id, open }), ...(open ? body : [])]
  }
  const S = GLYPHS.structure
  const wordW = Math.max(...STATE_IDS.map(i => displayWidth(t('ui.state.' + i))))
  const states = STATE_IDS.map(id => legendRow(u, stateLead(u, stated(id), { wordW }), t('legend.state.' + id), 'legend.states'))
  states.push(legendRow(u, frag([dim(S.empty, { role: 'glyph' })]), t('legend.nodata'), 'legend.states'))
  const ex = (...segs: Seg[]): Frag => frag(segs)
  const bar = ex(sg(GLYPHS.chart.meterOn, { ...tone(meterKey(0.5)), role: 'glyph' }), sg(GLYPHS.chart.meterOn, { ...tone(meterKey(0.9)), role: 'glyph' }), sg(GLYPHS.chart.meterOn, { ...tone(meterKey(1)), role: 'glyph' }), sg(GLYPHS.chart.meterOff, { color: PALETTE.idle, role: 'glyph' }))
  const walk = ex(sg(GLYPHS.state.done, { ...tone(STATES.done.key), role: 'glyph' }), dim(S.rule, { role: 'glyph' }), sg(GLYPHS.chart.here, { color: PALETTE.here, here: true, role: 'glyph' }), dim(S.rule, { role: 'glyph' }), sg(GLYPHS.state.pending, { ...tone(STATES.pending.key), role: 'glyph' }))
  const badges = ex(sg(' Aa ', { color: PALETTE.attention, bold: true, role: 'tab' }))
  const structure = [
    legendRow(u, ex(dim(S.open, { role: 'glyph' }), sg(' '), dim(S.folded, { role: 'glyph' })), t('legend.fold'), 'legend.structure'),
    legendRow(u, ex(dim(S.goto, { role: 'glyph' })), t('legend.goto'), 'legend.structure'),
    legendRow(u, ex(dim(S.bullet, { role: 'glyph' })), t('legend.bullet'), 'legend.structure'),
    legendRow(u, ex(dim(S.detail, { role: 'glyph' }), sg(' '), dim(S.command, { role: 'glyph' })), t('legend.detail'), 'legend.structure'),
    legendRow(u, ex(sg(S.tabMark, { color: PALETTE.here, here: true, role: 'glyph' })), t('legend.tabmark'), 'legend.structure'),
    legendRow(u, bar, t('legend.meter'), 'legend.structure'),
    legendRow(u, walk, t('legend.walk'), 'legend.structure'),
    legendRow(u, badges, t('legend.badges'), 'legend.structure'),
    legendRow(u, ex(dim(S.behind, { role: 'glyph' })), t('legend.behind'), 'legend.structure'),
    legendRow(u, ex(sg(S.recommend, { role: 'glyph' })), t('legend.recommend'), 'legend.structure'),
  ]
  return {
    states: part('states', t('legend.sec_states'), states),
    structure: part('structure', t('legend.sec_structure'), structure),
    keys: part('keys', t('legend.sec_keys'), detail(u, t('legend.keys', { icon: GLYPHS.structure.info }), { fact: 'legend.keys' })),
  }
}

// ---- 殘留 (§12.7) ----
export type ResidueEntry = { kind: string; target: string; cls: string; ageMs: number | null; bytes: number | null; reason: string | null; command: string | null }
// which residue classes need the owner's judgement ('judge'), which can simply be cleared ('clean'), and which are in use ('live', never listed). Every count on every
// surface (the tab's chip, 現況's row and summary, the tab name, the band's ⚑N) is derived from this one table; a class it does not name is 'judge'.
export type ResidueKind = 'judge' | 'clean' | 'live'
export const RESIDUE_KINDS: Record<string, ResidueKind> = {
  dirty: 'judge', 'clean-unintegrated': 'judge', 'unintegrated-branch': 'judge', unverifiable: 'judge',
  'clean-integrated': 'clean', 'missing-dir': 'clean',
  live: 'live',
}
export const residueKindOf = (cls: string): ResidueKind => (Object.prototype.hasOwnProperty.call(RESIDUE_KINDS, norm(cls).toLowerCase()) ? RESIDUE_KINDS[norm(cls).toLowerCase()] : 'judge')
// the name of an entry: a worktree's last path segment (whole, cut from the tail only when the row cannot hold it), a branch's own name
export const residueNameOf = (e: ResidueEntry): string => (e.kind === 'branch' ? e.target : (e.target.split('/').filter(x => x !== '').pop() ?? e.target))
// the owner-facing reason lines of an entry: the class's sentence from the string table; a class the table does not name keeps the producer's own words
export function residueWhy(t: Translate, e: ResidueEntry): string[] {
  const cls = norm(e.cls).toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(RESIDUE_KINDS, cls) || RESIDUE_KINDS[cls] === 'live') return [t('residue.class_raw', { cls: e.cls }), ...(e.reason === null ? [] : [e.reason])]
  if (cls === 'dirty') {
    const m = /^(\d+) uncommitted/.exec(e.reason ?? '')
    return [m === null ? t('residue.why.dirty_unknown') : t('residue.why.dirty', { n: m[1] })]
  }
  return [t('residue.why.' + cls.replace(/-/g, '_'))]
}
// a plain count, no state mark: a header chip whose section name already says what the number is
export const plainCount = (n: number, fact: FactId): Frag => frag([sg(String(n), { role: 'value', fmt: 'count' })], fact)
const dimParts = (parts: readonly { text: string; fmt: FmtKind }[]): Seg[] => parts.flatMap((p, i) => [...(i > 0 ? [dim(' · ', { role: 'prose' })] : []), dim(p.text, { role: 'value', fmt: p.fmt })])
// one residue entry's name row: the mark (the state's glyph, or the neutral `◦`), the name from the left, the dim `age · size` at the right edge. A name too long loses its tail.
function residueNameRow(u: Ctx, e: ResidueEntry, state: Stated | null): PaneLine {
  const parts: { text: string; fmt: FmtKind }[] = [...(e.ageMs === null ? [] : [{ text: dur(e.ageMs), fmt: 'dur' as const }]), ...(e.bytes === null ? [] : [{ text: size(e.bytes), fmt: 'size' as const }])]
  const lead: Seg[] = state === null ? [dim(GLYPHS.structure.bullet, { role: 'glyph' }), sg(' ')] : [...stateLead(u, state, { word: false }).segs, sg(' ')]
  const leadW = 2
  let meta = dimParts(parts)
  let metaW = displayWidth(meta.map(s => s.text).join(''))
  if (u.cols - 1 - leadW - metaW - 2 < 8) { meta = []; metaW = 0 } // no room for the name beside the meta: the name wins
  const room = u.cols - 1 - leadW - (metaW > 0 ? metaW + 2 : 0)
  const name = cutProse(residueNameOf(e), room)
  const segs: Seg[] = [...lead, sg(name, { role: 'prose' })]
  if (metaW > 0) segs.push(sg(' '.repeat(room - displayWidth(name) + 2)), ...meta)
  return lineOf(state === null ? 'bullet' : 'item', segs, { fact: 'residue.groups' })
}
// one residue section's rows: newest first (judge rows by severity first), each entry the name row, its reason (dim, column 2) and its command (`$`, never cut), at most
// `cap` entries and a `more` row for the rest. No grouping, no per-row fold: what the owner has to read is on the screen.
// newest first; an entry with no age goes last, and two with no age keep their order (Infinity - Infinity is NaN, which a comparator must never return)
const ageOrder = (a: number | null, b: number | null): number => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b)
export function residueRows(u: Ctx, id: string, entries: readonly ResidueEntry[], o: { judge: boolean; cap?: number }): PaneLine[] {
  const cap = o.cap ?? 5
  const rows = entries.map(e => ({ e, state: o.judge ? stateOf('residueGroup', e.cls) : null }))
  rows.sort((a, b) => (a.state === null || b.state === null ? 0 : SEVERITY.indexOf(a.state.id) - SEVERITY.indexOf(b.state.id)) || ageOrder(a.e.ageMs, b.e.ageMs))
  const expanded = u.expanded?.has('more:' + id) === true
  const shown = expanded ? rows : rows.slice(0, cap)
  const out = shown.flatMap(({ e, state }) => [
    residueNameRow(u, e, state),
    ...residueWhy(u.t, e).flatMap(w => detail(u, w, { fact: 'residue.groups' })),
    ...(e.command === null ? [] : command(u, e.command)),
  ])
  if (rows.length > cap) out.push(more(u, rows.length - cap, u.t('residue.noun'), 'more:' + id, expanded))
  return out
}

// the one dim line of a snapshot that is not ok (no band): the state text as published, nothing invented around it
export const stateText = (text: string, fact: FactId): PaneLine => lineOf('verdict', [dim(text, { role: 'prose' })], { fact })

// state predicates: tabs.ts asks a Stated what it is without spelling a StateId (lint L7)
export const isRunning = (s: Stated): boolean => s.id === 'running'
export const isStopped = (s: Stated): boolean => s.id === 'stopped'
export const isFindings = (s: Stated): boolean => s.id === 'findings'
export const isUnknown = (s: Stated): boolean => s.id === 'unknown'
export const isNeedYou = (s: Stated): boolean => s.id === 'need_you'
export const hasStageArrow = (s: string): boolean => s.includes(GLYPHS.structure.folded)
// the U0-U5 ladder span, drawn once here
export const ladderSpan = (): string => 'U0 ' + GLYPHS.structure.rule + ' U5'
// text props for a dim run of plain text (a view that holds no colour decision of its own asks for these)
export const dimProps = (): ReturnType<typeof drawSeg> => drawSeg({ text: "", dim: true })
