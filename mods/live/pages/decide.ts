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
import { brokenRow } from './rows'
import type { Row } from './rows'

// ---- view state and the key reducer ----
// DecideState (model.ts) carries picks, notes, sent and hold (the 10 s undo window, by card id); the rest is this page's own: which card shows in full, whether the others are folded, the note mode and its buffer, the focused option beyond a)–e)
export type DecideNav = DecideState & { cursor: number; folded: boolean; textMode: boolean; textBuf: string; opt: number | null }
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
  return { all: [...own.map((d): Item => ({ kind: 'own', d })), ...cons.map((c): Item => ({ kind: 'con', c }))], steps: pending.filter(isStepCard), far }
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
    case 'prev': return same({ cursor: Math.max(0, cursor - 1), opt: null })
    case 'next': return same({ cursor: Math.min(Math.max(0, m.all.length - 1), cursor + 1), opt: null })
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

// left segments, then `right` ending at the right edge (4/5 of the width); two blanks at least, the left part is cut when it does not fit
function leftRight(left: Seg[], right: string, cols: number): Row {
  if (right === '') return left
  const rw = displayWidth(right)
  const edge = Math.round(cols * 0.8)
  const lw = widthOf(left)
  const gap = Math.max(2, edge - lw - rw)
  if (lw + gap + rw <= cols) return [...left, seg(' '.repeat(gap)), dimSeg(right)]
  return [seg(truncateToWidth(left.map(s => s.text).join(''), Math.max(1, cols - rw - 2))), seg('  '), dimSeg(right)]
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
  const out: Seg[] = [seg('[' + letterOf(i) + '] ' + label, picked ? { color: PALETTE.here } : {})]
  if (rec) out.push(seg(' ' + GLYPHS.structure.recommend, { color: PALETTE.attention }))
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
function ownCard(d: LiveDecision, pos: string, nav: DecideNav, ctx: PageCtx, wide: boolean): Row[] {
  const { t } = ctx
  const cols = ctx.size.cols
  const who = d.source ?? ''
  const age = ageOf(ctx, openedMs(d, ctx))
  const old = d.options.length > MAX_OPTS ? t('page.decide.old', { n: d.options.length }) : ''
  const out: Row[] = []
  const mark = seg(GLYPHS.structure.folded + ' ', { color: PALETTE.here })
  const id0 = d.id === null ? '' : d.id + ' '
  if (wide) out.push(leftRight([mark, seg(id0 + pos + '  ' + d.question + old)], who === '' ? age : t('page.decide.exec', { who }) + ' · ' + age, cols))
  else out.push([mark, seg([id0 + pos, who, age].filter(s => s !== '').join(' · ') + old)], [seg(d.question)])
  const sent = d.id !== null && nav.sent[d.id] !== undefined && nav.fixing?.[d.id] === undefined
  const held = d.id !== null && nav.hold?.[d.id] !== undefined
  const pick = decidePick(d, nav)
  if (sent || held) {
    const what = pick !== null ? t('page.decide.sent_opt', { k: letterOf(pick), label: d.options[pick].label }) : t('page.decide.sent_free', { text: d.id === null ? '' : nav.notes[d.id] ?? '' })
    out.push(wide ? [seg('  '), seg(what)] : [seg(what)])
    return out
  }
  if (d.background !== null) out.push(wide ? labelled(t('page.decide.k_bg'), d.background) : [dimSeg(t('page.decide.k_bg')), seg(' ' + d.background)])
  if (wide && d.blocks !== null) out.push(labelled(t('page.decide.k_blocks'), d.blocks))
  if (d.recommendation !== null) out.push(wide ? labelled(t('page.decide.k_advice'), d.recommendation) : [dimSeg(t('page.decide.k_advice')), seg(' ' + d.recommendation)])
  if (decideDialog(d)) out.push([seg(wide ? '  ' : ''), dimSeg(t('page.decide.in_dialog'))])
  else {
    out.push(...optionRows(d, nav, ctx, wide))
  }
  if (d.options.length <= MAX_OPTS) out.push(...noteRow(d, nav, ctx, wide))
  else if (nav.textMode) out.push(...noteRow(d, nav, ctx, wide))
  return out
}

// a console card, seen from this seat: the question and which seat answers it
function conCard(c: ConsoleCard, pos: string, ctx: PageCtx, wide: boolean): Row[] {
  const who = c.executor_display ?? ''
  const age = ageOf(ctx, c.opened_at_ms)
  const mark = seg(GLYPHS.structure.folded + ' ', { color: PALETTE.here })
  if (wide) return [leftRight([mark, seg(c.id + ' ' + pos + '  ' + c.question)], who === '' ? age : ctx.t('page.decide.exec', { who }) + ' · ' + age, ctx.size.cols)]
  return [[mark, seg([c.id + ' ' + pos, who, age].filter(s => s !== '').join(' · '))], [seg(c.question)]]
}

function otherRow(id: string, title: string, who: string, age: string, ctx: PageCtx, wide: boolean): Row {
  const tail = [who, age].filter(s => s !== '').join(' · ')
  if (wide) return leftRight([seg('  ' + id + '  ' + title)], tail, ctx.size.cols)
  return [seg(id + ' ' + title + (age === '' ? '' : ' · ' + age))]
}

// A10: a broken-source reason is never cut with `…`: it wraps onto further red rows (the frame's body overflow gives way to other content first, never the reason)
const brokenRows = (text: string, cols: number): Row[] => wrapPlain(text, cols, cols).map(l => brokenRow(l))
const noSource = (ctx: PageCtx, id: string): Row => brokenRow(GLYPHS.state.failed + ' ' + ctx.t(id))

function render(ctx0: PageCtx): { body: Row[]; actions: Row[] } {
  const ctx = ctx0 as DecideCtx
  const { t } = ctx
  const nav = ctx.decide ?? NO_NAV
  const wide = ctx.size.cols >= WIDE
  const m = modelOf(ctx)
  const body: Row[] = []
  // §5: a source that is stale or missing says so in red, with its reason
  if (ctx.live === null) body.push(noSource(ctx, 'page.decide.nosrc_live'))
  else if (ctx.live.state !== 'ok') body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('page.decide.stale_live', { why: ctx.live.header }), ctx.size.cols))
  if (ctx.console !== null) {
    const src = ctx.console.sources.cards
    if (src !== undefined && src.state !== 'ok') body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('frame.src_' + src.state, { name: 'cards', min: src.at_ms === null ? '-' : String(Math.max(0, Math.floor((ctx.nowMs - src.at_ms) / 60000))) }), ctx.size.cols))
    else if (ctx.console.cards === null) body.push(noSource(ctx, 'page.decide.nosrc_cards'))
  }

  const cursor = clampCursor(nav, m.all.length)
  const cur = m.all[cursor]
  const actions: Row[] = []
  const roomy = ctx.size.rows >= 32
  const total = m.all.length
  const hasOwn = cur !== undefined && cur.kind === 'own'

  if (cur === undefined) {
    if (ctx.live !== null) body.push([seg(GLYPHS.state.pending + ' '), dimSeg(t('page.decide.none_cards'))])
  } else {
    const pos = String(cursor + 1) + '/' + String(total)
    body.push(...(cur.kind === 'own' ? ownCard(cur.d, pos, nav, ctx, wide) : conCard(cur.c, pos, ctx, wide)))
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
      body.push([seg((wide ? '  ' : '') + f.id + (wide ? '  ' : ' ') + f.title + ' ' + GLYPHS.structure.answer + ' ' + to)])
    }
  }

  // what the owner has to do or look at
  if (m.steps.length > 0) {
    body.push(header(t('page.decide.sec_steps'), wide))
    for (const s of m.steps) {
      const text = s.title ?? s.question
      body.push(wide ? [seg('  '), dimSeg(s.kind === 'look' ? t('page.decide.look') : t('page.decide.step')), seg('  ' + text)] : [seg(text)])
    }
  }

  // the action area: the state of the focused card, then the keys that work now
  if (cur !== undefined) actions.push(...actionRows(cur, cursor, nav, ctx, wide, roomy))
  return { body, actions }
}

function actionRows(cur: Item, cursor: number, nav: DecideNav, ctx: PageCtx, wide: boolean, roomy: boolean): Row[] {
  const { t } = ctx
  const R = (text: string): Row => [seg(text)]
  const navKeys = wide ? t('page.decide.act_nav') : t('page.decide.act_nav_c')
  if (cur.kind === 'con') return [R(t('page.decide.act_readonly', { seat: cur.c.executor_display ?? '-' })), R(navKeys)]
  const d = cur.d
  const sent = d.id !== null && nav.sent[d.id] !== undefined && nav.fixing?.[d.id] === undefined
  const hold = d.id === null ? undefined : nav.hold?.[d.id]
  const pick = decidePick(d, nav)
  const k = pick === null ? '' : letterOf(pick)
  if (hold !== undefined) {
    const left = Math.max(0, Math.ceil((hold + DECIDE_UNDO_MS - ctx.nowMs) / 1000))
    return [R(t('page.decide.act_held', { k, n: left })), R(t('page.decide.act_nav_held'))]
  }
  if (sent) return [R(t('page.decide.act_sent', { k })), R(t('page.decide.act_nav_held'))]
  if (nav.textMode) return [R(t('page.decide.act_text')), R(t('page.decide.act_text_keys'))]
  if (decideDialog(d)) return [R(navKeys)]
  const n = d.options.length
  const fold = nav.folded ? (wide ? t('page.decide.act_fold_open') : t('page.decide.act_fold_open_c')) : wide ? t('page.decide.act_fold_close') : ''
  if (n > MAX_OPTS) {
    const picked = pick === null ? t('page.decide.act_none') : t('page.decide.act6_pick', { n: pick + 1, label: d.options[pick].label })
    return [R(picked), R(t('page.decide.act6_send')), R(t('page.decide.act6_keys'))]
  }
  const picked = pick === null ? t('page.decide.act_none') : wide ? t('page.decide.act_picked', { k, label: d.options[pick].label }) : t('page.decide.act_picked_c', { k })
  if (!wide) {
    return [R(picked + ' ' + t('page.decide.act_note_c')), R(t('page.decide.act_send_c') + '  ' + t('page.decide.act_undo_c')), R(navKeys + ' ' + (nav.folded ? fold : t('page.decide.act_fill_c')))]
  }
  const range = n <= 1 ? '[a]' : t('page.decide.act_range', { last: letterOf(n - 1) })
  const pickHelp = roomy ? t('page.decide.act_pick_roomy') : t('page.decide.act_pick_tight')
  const rows = [R(picked), R(range + ' ' + pickHelp + '   ' + t('page.decide.act_note')), R(t('page.decide.act_send') + '   ' + t('page.decide.act_undo') + (roomy ? '' : '   ' + t('page.decide.act_fill'))), R(navKeys + '  ' + fold)]
  if (roomy) rows.push(R(t('page.decide.act_fill')))
  return rows
}

export const decidePage: Page = { id: 'decide', key: '2', title: '待決', framed: true, render }
