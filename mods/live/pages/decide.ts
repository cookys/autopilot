// mods/live/pages/decide.ts — page 2 待決 of the pane (plan r2 §2 row 2, §3.1, §3.2, §5; g2 folds A5). One focused card in full (the seat's own cards carry their options), the other cards as a
// folded list, the other seats' cards read-only (each says which seat answers it), and the step / look items "要你做或看". Pure: rows in, rows out; the keys are a pure reducer (decideReduce).
//
// Data: own cards = ctx.live.pending (decision cards; step / look cards are 要你做或看); console cards = ctx.console.cards that the seat does not hold itself; other seats' cards = the console
// exception items of rule T7 (a card another lane opened, seen through the mirror). A page-local view state may ride on the ctx as `decide` (DecideNav); without it the first card is focused, nothing picked.
//
// Import order: pages/frame.ts imports ./index, which imports this file; a test that imports this file first would hit the cycle, so import ./frame (or ./index) first.
import type { ConsoleCard } from '../console'
import { DECIDE_UNDO_MS, NO_DECIDE, decideDialog, decideFillText, decideLine, decidePick, displayWidth, isStepCard, recommendedIndex, truncateToWidth } from '../model'
import type { DecideState, LiveDecision, Seg } from '../model'
import { GLYPHS, PALETTE, wrapPlain } from '../ui'
import type { KeyAction } from './keys'
import type { Page, PageCtx } from './frame'
import { brokenRow, pendingMissingReason, pendingSourceMissing, wrapRow } from './rows'
import type { Row } from './rows'
import { STRIP_SPLIT_COLS } from './layout'

// ---- view state and the key reducer ----
// DecideState (model.ts) carries picks, notes, sent and hold (the 10 s undo window, by card id); the rest is this page's own: which card shows in full, whether the others are folded, the note mode and its buffer, the focused option beyond a)–e)
export type DecideNav = DecideState & { cursor: number; folded: boolean; textMode: boolean; textBuf: string; opt: number | null; detailOffset?: number }
export const NO_NAV: DecideNav = { ...NO_DECIDE, cursor: 0, folded: false, textMode: false, textBuf: '', opt: null }
export type DecideCtx = PageCtx & { decide?: DecideNav }
export type DecideEffect = { kind: 'send'; id: string; line: string } | { kind: 'undo'; id: string } | { kind: 'fill'; text: string } | null

const LETTERS = 'abcde'
const MAX_OPTS = 5
const letterOf = (i: number): string => (i < MAX_OPTS ? LETTERS[i] : 'f' + (i + 1))

type Item = { kind: 'own'; d: LiveDecision } | { kind: 'con'; c: ConsoleCard }
type Far = { id: string; title: string; seat: string }
type Model = { all: Item[]; steps: LiveDecision[]; far: Far[] }

const idOf = (it: Item): string => (it.kind === 'own' ? it.d.id ?? '' : it.c.id)

// every card of this page: the seat's own decision cards, then the console cards it does not hold
function modelOf(ctx: PageCtx): Model {
  const pending = ctx.live === null ? [] : ctx.live.pending
  const own = pending.filter(d => !isStepCard(d))
  const held = new Set(own.map(d => d.id))
  const cons = ctx.console === null || ctx.console.cards === null ? [] : ctx.console.cards.filter(c => !held.has(c.id))
  const far: Far[] = []
  if (ctx.console !== null) {
    for (const it of ctx.console.items) {
      if (it.kind !== 'exception' || !it.id.startsWith('exc:T7:')) continue
      const line = ctx.console.lines === null || it.line_id === null ? undefined : ctx.console.lines.find(l => l.line_id === it.line_id)
      far.push({ id: /\bd-[0-9a-z-]+/.exec(it.text)?.[0] ?? it.id, title: it.title, seat: line?.lead_display ?? '' })
    }
  }
  // N1: priority order, then the longest wait first: the seat's own cards (answerable here) before the console cards, each group oldest first, so the default focus is the card
  // that has waited longest (the one 現況 names as 最舊 when it is a console card); a card with no open time keeps its place after the dated ones of its group
  const byAge = <X>(list: X[], at: (x: X) => number | null): X[] =>
    list.map((x, i) => ({ x, i, at: at(x) })).sort((a, b) => (a.at === null ? (b.at === null ? a.i - b.i : 1) : b.at === null ? -1 : a.at - b.at || a.i - b.i)).map(e => e.x)
  const all: Item[] = [...byAge(own, d => openedMs(d, ctx)).map((d): Item => ({ kind: 'own', d })), ...byAge(cons, c => c.opened_at_ms).map((c): Item => ({ kind: 'con', c }))]
  return { all, steps: pending.filter(isStepCard), far }
}

const clampCursor = (nav: DecideNav, n: number): number => (n === 0 ? 0 : Math.max(0, Math.min(n - 1, nav.cursor)))

// one key of routeKey's table applied to the page state. The host calls it with the cards of the current draw (`cards` = the seat's own decision cards and the console cards, in page order), and does the effect.
export function decideReduce(nav: DecideNav, key: KeyAction, ctx: PageCtx, nowMs: number): { nav: DecideNav; effect: DecideEffect } {
  const m = modelOf(ctx)
  const cursor = clampCursor(nav, m.all.length)
  const cur = m.all[cursor]
  const d = cur !== undefined && cur.kind === 'own' && cur.d.id !== null ? cur.d : null
  const same = (patch: Partial<DecideNav>): { nav: DecideNav; effect: DecideEffect } => ({ nav: { ...nav, cursor, ...patch }, effect: null })
  const heldNow = d !== null && d.id !== null && nav.hold?.[d.id] !== undefined
  const sentNow = d !== null && d.id !== null && nav.sent[d.id] !== undefined && nav.fixing?.[d.id] === undefined
  switch (key.kind) {
    case 'text': {
      if (!nav.textMode) return same({})
      if (key.ch === 'Backspace') return same({ textBuf: [...nav.textBuf].slice(0, -1).join('') })
      return [...key.ch].length === 1 ? same({ textBuf: nav.textBuf + key.ch }) : same({})
    }
    case 'text_save': return d === null || d.id === null ? same({ textMode: false, textBuf: '' }) : same({ textMode: false, textBuf: '', notes: { ...nav.notes, [d.id]: nav.textBuf } })
    case 'text_cancel': return same({ textMode: false, textBuf: '' })
    case 'note': return d === null || d.id === null || heldNow || sentNow ? same({}) : same({ textMode: true, textBuf: nav.notes[d.id] ?? '', opt: null })
    case 'pick': {
      if (d === null || d.id === null || heldNow || sentNow || decideDialog(d) || key.index >= Math.min(d.options.length, MAX_OPTS)) return same({})
      return same({ picks: { ...nav.picks, [d.id]: key.index }, opt: null })
    }
    case 'move': {
      if (d === null || d.options.length <= MAX_OPTS) return same({})
      const last = d.options.length - 1
      const next = key.by === 1 ? (nav.opt === null ? MAX_OPTS : Math.min(last, nav.opt + 1)) : nav.opt === null || nav.opt <= MAX_OPTS ? null : nav.opt - 1
      return same({ opt: next })
    }
    case 'submit': {
      if (d === null || d.id === null || heldNow || sentNow) return same({})
      if (nav.opt !== null && decidePick(d, nav) !== nav.opt) return same({ picks: { ...nav.picks, [d.id]: nav.opt } }) // an old 6th option: the first Enter selects it, the second sends
      const line = decideLine(d, nav)
      if (line === null) return same({})
      return { nav: { ...nav, cursor, hold: { ...(nav.hold ?? {}), [d.id]: nowMs } }, effect: { kind: 'send', id: d.id, line } }
    }
    case 'undo': {
      if (d === null || d.id === null || nav.hold?.[d.id] === undefined || nowMs - nav.hold[d.id] >= DECIDE_UNDO_MS) return same({})
      const hold = { ...nav.hold }
      delete hold[d.id]
      return { nav: { ...nav, cursor, hold }, effect: { kind: 'undo', id: d.id } }
    }
    case 'prev': return same({ cursor: Math.max(0, cursor - 1), opt: null, detailOffset: 0 })
    case 'next': return same({ cursor: Math.min(Math.max(0, m.all.length - 1), cursor + 1), opt: null, detailOffset: 0 })
    case 'fold': return same({ folded: !nav.folded })
    case 'fill': {
      const text = d === null ? null : decideFillText(d, nav)
      return text === null ? same({}) : { nav: { ...nav, cursor }, effect: { kind: 'fill', text } }
    }
    default: return same({})
  }
}

// ---- drawing ----
const seg = (text: string, o: Partial<Seg> = {}): Seg => ({ text, ...o })
const dimSeg = (text: string): Seg => ({ text, dim: true })
const widthOf = (segs: Seg[]): number => segs.reduce((w, s) => w + displayWidth(s.text), 0)
const WIDE = 100 // columns from which the cards use the wide form (labelled rows, the executor at the right)

function truncateSegs(row: Row, cols: number): Row {
  if (cols <= 0) return [seg('')]
  if (widthOf(row) <= cols) return row
  const out: Row = []
  let used = 0
  for (const s of row) {
    const w = displayWidth(s.text)
    if (used + w <= cols) { out.push(s); used += w; continue }
    const room = cols - used
    if (room > 0) out.push({ ...s, text: truncateToWidth(s.text, room) })
    break
  }
  return out.length === 0 ? [seg('')] : out
}

// left segments (cut with `…` when too wide), then `right` fixed at the right edge `cols`, never wrapped (R11)
function leftRight(left: Seg[], right: string, cols: number, gap = 2): Row {
  if (right === '') return truncateSegs(left, cols)
  const rw = displayWidth(right)
  if (cols <= rw + gap) return truncateSegs(left, cols)
  const cut = truncateSegs(left, cols - gap - rw)
  const lw = widthOf(cut)
  return [...cut, seg(' '.repeat(Math.max(gap, cols - lw - rw))), dimSeg(right)]
}

const ageOf = (ctx: PageCtx, ms: number | null): string => {
  if (ms === null) return ''
  const min = Math.max(0, Math.floor((ctx.nowMs - ms) / 60000))
  if (min < 60) return ctx.t('page.decide.age_m', { n: min })
  const h = Math.floor(min / 60)
  return h < 24 ? ctx.t('page.decide.age_h', { n: h }) : ctx.t('page.decide.age_d', { n: Math.floor(h / 24) })
}
const openedMs = (d: LiveDecision, ctx: PageCtx): number | null => (d.age_s !== null ? ctx.nowMs - d.age_s * 1000 : d.opened_at === null ? null : Date.parse(d.opened_at) || null)

function header(label: string, wide: boolean): Row {
  const rule = GLYPHS.structure.rule
  return [dimSeg(rule + rule + ' ' + label + (label.endsWith('）') ? '' : ' ') + rule.repeat(wide ? 32 : 2))]
}
// a labelled row of the wide form: two blanks of indent, the label in 4 cells, three blanks, then the text
const labelled = (label: string, text: string, rest: Seg[] = []): Row => [seg('  '), dimSeg(label), seg('   ' + text), ...rest]

function optionSegs(d: LiveDecision, i: number, nav: DecideNav, ctx: PageCtx): Seg[] {
  const rec = recommendedIndex(d) === i
  const picked = decidePick(d, nav) === i
  const label = i < MAX_OPTS ? d.options[i].label : ctx.t('page.decide.opt_n', { n: i + 1, label: d.options[i].label })
  // G11: the option is a Button (press `key:<letter>`, the pane turns it into the key's action) so it works by click where the pane cannot take the keyboard; the old 6th-and-later options (f6..) keep plain text
  const press = i < MAX_OPTS ? { press: 'key:' + letterOf(i) } : {}
  const out: Seg[] = [seg('[' + letterOf(i) + '] ' + label, picked ? { color: PALETTE.here, ...press } : press)]
  if (rec) out.push(seg(' ' + GLYPHS.structure.recommend, { color: PALETTE.attention, ...press }))
  return out
}
function optionRows(d: LiveDecision, nav: DecideNav, ctx: PageCtx, wide: boolean): Row[] {
  const n = d.options.length
  const segs = d.options.map((_, i) => optionSegs(d, i, nav, ctx))
  const lead = wide ? '  ' : ''
  if (n === 0) return []
  if (n <= 2) {
    const sep = wide ? '    ' : '   '
    return [[seg(lead), ...segs.flatMap((s, i) => (i === 0 ? s : [seg(sep), ...s]))]]
  }
  if (wide) return segs.map(s => [seg(lead), ...s])
  const rows: Row[] = []
  const five = Math.min(n, MAX_OPTS)
  for (let i = 0; i < five; i += 3) rows.push(segs.slice(i, Math.min(i + 3, five)).flatMap((s, k) => (k === 0 ? s : [seg('  '), ...s])))
  for (let i = MAX_OPTS; i < n; i++) rows.push(segs[i]) // an old card's 6th option and beyond: one row each
  return rows
}

function noteRow(d: LiveDecision, nav: DecideNav, ctx: PageCtx, wide: boolean): Row[] {
  const note = d.id === null ? '' : nav.notes[d.id] ?? ''
  const k = ctx.t('page.decide.k_note')
  if (nav.textMode) return [wide ? labelled(k, nav.textBuf + '_') : [dimSeg(k), seg(' ' + nav.textBuf + '_')]]
  if (note !== '') return [wide ? labelled(k, note) : [dimSeg(k), seg(' ' + note)]]
  return wide ? [labelled(k, ctx.t('page.decide.note_ph'))] : []
}

// the card in full: the seat's own card with its options
function ownCard(d: LiveDecision, pos: string, nav: DecideNav, ctx: PageCtx, wide: boolean, readOnly = false, compactOptions = false): Row[] {
  const { t } = ctx
  const cols = ctx.size.cols
  const who = d.source ?? ''
  const age = ageOf(ctx, openedMs(d, ctx))
  const old = d.options.length > MAX_OPTS ? t('page.decide.old', { n: d.options.length }) : ''
  const out: Row[] = []
  const mark = seg(GLYPHS.structure.folded + ' ', { color: PALETTE.here })
  const id0 = d.id === null ? '' : d.id + ' '
  // Z4: reserve the progress/age suffix before shortening the question.
  const progress = '(' + [pos, age].filter(Boolean).join(' · ') + ')'
  if (wide) out.push(leftRight([mark, seg(id0 + ' ' + d.question + old)], (who === '' ? '' : t('page.decide.exec', { who }) + '  ') + progress, cols))
  else out.push(leftRight([mark, seg(d.question)], progress, cols), [dimSeg('  ' + [id0.trim(), who].filter(Boolean).join(' · ') + old)])
  const sent = d.id !== null && nav.sent[d.id] !== undefined && nav.fixing?.[d.id] === undefined
  const held = d.id !== null && nav.hold?.[d.id] !== undefined
  const pick = decidePick(d, nav)
  if (sent || held) {
    const what = pick !== null ? t('page.decide.sent_opt', { k: letterOf(pick), label: d.options[pick].label }) : t('page.decide.sent_free', { text: d.id === null ? '' : nav.notes[d.id] ?? '' })
    out.push(wide ? [seg('  '), seg(what)] : [seg(what)])
    return out
  }
  if (d.background !== null) out.push(wide ? labelled(t('page.decide.k_bg'), d.background) : [dimSeg(t('page.decide.k_bg')), seg(' ' + d.background)])
  const blocks = d.blocks ?? '—' // W3: absence is explicit; the answer area's labels stay stable.
  out.push(wide ? labelled(t('page.decide.k_blocks'), blocks) : [dimSeg(t('page.decide.k_blocks')), seg(' ' + blocks)])
  if (decideDialog(d)) out.push([seg(wide ? '  ' : ''), dimSeg(t('page.decide.in_dialog'))])
  else {
    if (readOnly && !compactOptions) d.options.forEach((o, i) => {
      out.push([seg((wide ? '  ' : '') + '[' + letterOf(i) + '] ' + o.label + (recommendedIndex(d) === i ? ' ' + GLYPHS.structure.recommend : ''))])
      if (o.description !== '') out.push([dimSeg((wide ? '      ' : '    ') + o.description)])
    })
    else out.push(...optionRows(d, nav, ctx, wide).map(r => readOnly ? r.map(({ press: _press, ...s }) => s) : r))
  }
  if (d.recommendation !== null) out.push(wide ? labelled(t('page.decide.k_advice'), d.recommendation) : [dimSeg(t('page.decide.k_advice')), seg(' ' + d.recommendation)])
  if (readOnly) out.push(wide ? labelled(t('page.decide.k_note'), '—') : [dimSeg(t('page.decide.k_note')), seg(' —')]) // U2: the destination belongs only in the action row.
  else if (d.options.length <= MAX_OPTS) out.push(...noteRow(d, nav, ctx, wide))
  else if (nav.textMode) out.push(...noteRow(d, nav, ctx, wide))
  return out
}

// Y2: the same answer area in PM order, with inert options and the answering seat.
function conCard(c: ConsoleCard, pos: string, ctx: PageCtx, wide: boolean): Row[] {
  const options = c.options ?? []
  const recommendation = c.recommendation ?? options.find(o => o.recommended === true)?.label ?? null
  return ownCard({ id: c.id, title: null, question: c.question, source: c.executor_display,
    opened_at: null, age_s: Math.max(0, (ctx.nowMs - c.opened_at_ms) / 1000), background: c.background ?? null, blocks: c.blocks ?? null,
    options, recommendation, why: null, not_authorized: null, stale: false, origin: null, orphaned: false }, pos, NO_NAV, ctx, wide, true)
}

// W3: keep the PM-ordered answer summary visible in a short host allocation.
// Full text remains reachable through click targets, in bounded pages; counts
// below describe hidden detail rows only, never bus card/line/pool totals.
function cardWindow(cur: Item, pos: string, nav: DecideNav, ctx: PageCtx, wide: boolean): Row[] {
  const full = (cur.kind === 'own' ? ownCard(cur.d, pos, nav, ctx, wide) : conCard(cur.c, pos, ctx, wide))
    .flatMap(r => wrapRow(r, ctx.size.cols))
  const room = Math.max(1, ctx.size.rows - 2 - (ctx.size.cols < STRIP_SPLIT_COLS ? 2 : 1))
  if (full.length <= room) return full
  const take = Math.max(1, room - 1)
  const offset = Math.max(0, Math.min(nav.detailOffset ?? 0, full.length))
  const more = (at: number): Seg => seg(GLYPHS.structure.behind + ' ' + ctx.t('page.decide.details', { n: full.length - at }), { press: 'decide:detail:' + (at + 1) })
  const back: Seg = seg(GLYPHS.structure.folded + ' ' + ctx.t('page.decide.details_back'), { press: 'decide:detail:0' })
  if (offset > 0) {
    const start = offset - 1
    const end = Math.min(full.length, start + take)
    return [...full.slice(start, end), [back, ...(end < full.length ? [seg('  '), more(end)] : [])]]
  }
  const d = cur.kind === 'own' ? cur.d : { ...cur.c, source: cur.c.executor_display, age_s: Math.max(0, (ctx.nowMs - cur.c.opened_at_ms) / 1000), opened_at: null, id: cur.c.id }
  const compact = { ...d, background: d.background == null ? null : truncateToWidth(d.background, Math.max(4, ctx.size.cols - 7)),
    blocks: d.blocks == null ? null : truncateToWidth(d.blocks, Math.max(4, ctx.size.cols - 7)),
    recommendation: d.recommendation == null ? null : truncateToWidth(d.recommendation, Math.max(4, ctx.size.cols - 7)),
    options: (d.options ?? []).map(o => ({ ...o, description: '', label: truncateToWidth(o.label, Math.max(4, Math.floor(ctx.size.cols / Math.min(3, (d.options ?? []).length)) - 12)) })) } as LiveDecision
  const summary = ownCard(compact, pos, nav, ctx, false, cur.kind === 'con', true)
  summary.splice(1, 1) // the focused title already identifies the card; reclaim the separate id/seat row.
  return [...summary.slice(0, take), [more(0)]]
}

// Keep a visible gutter between each list question and its owner/age column;
// truncate the title before it reaches that column, leaving the age at the edge.
const OTHER_CARD_GUTTER = 4
function otherRow(id: string, title: string, who: string, age: string, ctx: PageCtx, wide: boolean): Row {
  const tail = [who, age].filter(s => s !== '').join(' · ')
  if (wide) return leftRight([seg('  ' + id + '  ' + title)], tail, ctx.size.cols, OTHER_CARD_GUTTER)
  if (age === '') return [seg(truncateToWidth(id + ' ' + title, ctx.size.cols))]
  const right = '· ' + age
  const rw = displayWidth(right)
  if (ctx.size.cols <= rw + 2) return [seg(truncateToWidth(id + ' ' + title, ctx.size.cols))]
  const leftText = truncateToWidth(id + ' ' + title, ctx.size.cols - 1 - rw)
  const gap = Math.max(1, ctx.size.cols - displayWidth(leftText) - rw)
  return [seg(leftText + ' '.repeat(gap)), dimSeg(right)]
}

// A10: a broken-source reason is never cut with `…`: it wraps onto further red rows (the frame's body overflow gives way to other content first, never the reason)
const brokenRows = (text: string, cols: number): Row[] => wrapPlain(text, cols, cols).map(l => brokenRow(l))
const noSource = (ctx: PageCtx, id: string): Row => brokenRow(GLYPHS.state.failed + ' ' + ctx.t(id))

function render(ctx0: PageCtx): { body: Row[]; actions: Row[] } {
  // The pane's 待決 page is retired: the O4 band shell is the only pending-decision panel. The tab and its key stay.
  return { body: [[seg(ctx0.t('shell.on_band'))]], actions: [] }
  const ctx = ctx0 as DecideCtx
  const { t } = ctx
  const nav = ctx.decide ?? NO_NAV
  const wide = ctx.size.cols >= WIDE
  const m = modelOf(ctx)
  const noPendingSrc = pendingSourceMissing(ctx)
  const body: Row[] = []
  let focusEnd = 0
  if (noPendingSrc) body.push(...wrapRow(brokenRow(GLYPHS.state.failed + ' ' + t('page.decide.pending_no_source', { why: pendingMissingReason(ctx, t) })), ctx.size.cols))
  // §5: a source that is stale or missing says so in red, with its reason
  if (ctx.live === null) body.push(noSource(ctx, 'page.decide.nosrc_live'))
  else if (ctx.live.state !== 'ok') body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('page.decide.stale_live', { why: ctx.live.header }), ctx.size.cols))
  if (ctx.console !== null) {
    const src = ctx.console.sources.cards
    if (src !== undefined && src.state !== 'ok') body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('frame.src_' + src.state, { name: t('console.command.src.cards'), min: src.at_ms === null ? '-' : String(Math.max(0, Math.floor((ctx.nowMs - src.at_ms) / 60000))) }), ctx.size.cols))
    else if (ctx.console.cards === null) body.push(noSource(ctx, 'page.decide.nosrc_cards'))
  }

  const cursor = clampCursor(nav, m.all.length)
  const cur = m.all[cursor]
  const actions: Row[] = []
  const roomy = ctx.size.rows >= 32
  const total = m.all.length
  const hasOwn = cur !== undefined && cur.kind === 'own'

  // R4-3: like fleet/quota, the only content slot carries the focused fact, not controls.
  const available = ctx.size.rows - 1 - (ctx.size.cols < STRIP_SPLIT_COLS ? 2 : 1)
  if (available === 1 && cur !== undefined) {
    const title = cur.kind === 'own' ? cur.d.title ?? cur.d.question : cur.c.question
    const age = ageOf(ctx, cur.kind === 'own' ? openedMs(cur.d, ctx) : cur.c.opened_at_ms)
    const position = t('page.decide.position', { n: cursor + 1, total })
    return { body: [], actions: [leftRight([seg(GLYPHS.structure.folded + ' ', { color: PALETTE.here }), seg(title)], position + (age === '' ? '' : ' · ' + age), ctx.size.cols)] }
  }

  if (cur === undefined) {
    if (!noPendingSrc && ctx.live !== null) body.push([seg(GLYPHS.state.pending + ' '), dimSeg(t('page.decide.none_cards'))])
  } else {
    const pos = String(cursor + 1) + '/' + String(total)
    body.push(...cardWindow(cur, pos, nav, ctx, wide))
    focusEnd = body.length
    if (wide) body.push([seg('')])
    const rest = m.all.filter((_, i) => i !== cursor)
    const label = rest.length === 0 ? t('page.decide.sec_others_plain', { n: 0 }) : nav.folded ? t('page.decide.sec_others_folded', { n: rest.length }) : t('page.decide.sec_others_open', { n: rest.length })
    body.push(header(label, wide))
    if (!nav.folded) {
      for (const it of rest) {
        if (it.kind === 'own') body.push(otherRow(it.d.id ?? '', it.d.title ?? it.d.question, it.d.source ?? '', ageOf(ctx, openedMs(it.d, ctx)), ctx, wide))
        else body.push(otherRow(it.c.id, it.c.question, it.c.executor_display ?? '', ageOf(ctx, it.c.opened_at_ms), ctx, wide))
      }
    }
  }

  // the other seats' cards: read-only, each says which seat answers it
  if (ctx.console === null) {
    body.push(header(t('page.decide.sec_far_empty'), wide), noSource(ctx, 'page.decide.nosrc_console'))
  } else if (m.far.length > 0 || cur === undefined) {
    body.push(header(cur === undefined ? (wide ? t('page.decide.sec_far_wide') : t('page.decide.sec_far_empty')) : wide ? t('page.decide.sec_far_wide') : t('page.decide.sec_far'), wide))
    if (m.far.length === 0) body.push([seg(GLYPHS.state.pending + ' '), dimSeg(t('page.decide.far_none'))])
    for (const f of m.far) {
      const to = wide && f.seat !== '' ? t('page.decide.far_to', { seat: f.seat }) : t('page.decide.far_to_c')
      const suffix = ' ' + GLYPHS.structure.answer + ' ' + to
      const prefix = (wide ? '  ' : '') + f.id + (wide ? '  ' : ' ')
      const maxTitle = Math.max(4, ctx.size.cols - displayWidth(prefix) - displayWidth(suffix))
      body.push(truncateSegs([seg(prefix + truncateToWidth(f.title, maxTitle) + suffix)], ctx.size.cols))
    }
  }

  // what the owner has to do or look at
  if (m.steps.length > 0) {
    body.push(header(t('page.decide.sec_steps'), wide))
    for (const s of m.steps) {
      const text = s.title ?? s.question
      body.push(truncateSegs(wide ? [seg('  '), dimSeg(s.kind === 'look' ? t('page.decide.look') : t('page.decide.step')), seg('  ' + text)] : [seg(text)], ctx.size.cols))
    }
  }

  // the action area: the state of the focused card, then the keys that work now
  if (cur !== undefined) actions.push(...actionRows(cur, cursor, nav, ctx, wide, roomy, total))
  // W3: focus content and its detail controls take precedence over the other-card
  // list. h/l still visit every bus card (the title keeps its real position/total).
  const room = Math.max(0, ctx.size.rows - 1 - (ctx.size.cols < STRIP_SPLIT_COLS ? 2 : 1) - actions.length)
  if (body.length > room && focusEnd < room) {
    const hidden = body.length - room + 1
    return { body: [...body.slice(0, Math.max(0, room - 1)), [dimSeg(ctx.t('frame.more', { n: hidden, arrow: GLYPHS.structure.behind }))]], actions }
  }
  return { body: body.slice(0, room), actions }
}

// W3: reserve one action row. Options stay in the body and undo exists only
// during a real hold; verbose explanations belong to the card, not the controls.
function actionRows(cur: Item, _cursor: number, nav: DecideNav, ctx: PageCtx, wide: boolean, _roomy: boolean, total = 1): Row[] {
  const { t } = ctx
  const R = (...parts: string[]): Row[] => [[seg(parts.filter(Boolean).join(' '))]]
  const navKeys = t('page.decide.act_nav_c')
  const fold = nav.folded ? t('page.decide.act_fold_open_c') : t('page.decide.act_fold_close_c')
  if (cur.kind === 'con') return R(t('page.decide.act_readonly', { seat: cur.c.executor_display ?? '-' }), navKeys, total > 1 ? fold : '')
  const d = cur.d
  const sent = d.id !== null && nav.sent[d.id] !== undefined && nav.fixing?.[d.id] === undefined
  const hold = d.id === null ? undefined : nav.hold?.[d.id]
  const pick = decidePick(d, nav)
  const k = pick === null ? '' : letterOf(pick)
  if (hold !== undefined) {
    const left = Math.max(0, Math.ceil((hold + DECIDE_UNDO_MS - ctx.nowMs) / 1000))
    return R(t('page.decide.act_held', { k, n: left }), navKeys)
  }
  if (sent) return R(t('page.decide.act_sent', { k }), navKeys)
  if (nav.textMode) return R(t('page.decide.act_text'), t('page.decide.act_text_keys'))
  if (decideDialog(d)) return R(navKeys)
  return R(k === '' ? '' : GLYPHS.structure.decisions + ' ' + k, t('page.decide.act_note_c'), t('page.decide.act_send_c'), navKeys,
    total > 1 ? fold : '', t('page.decide.act_fill_c')) // V3: folding never replaces filling.
}

export const decidePage: Page = { id: 'decide', key: '2', title: '待決', framed: true, render }
