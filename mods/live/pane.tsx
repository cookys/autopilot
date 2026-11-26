// mods/live/pane.tsx — the panel the i opens (TUI v2): Now · Decide · Dispatch · Review · Spend · Hygiene · ?  (the stage walk lives in Now, the proxy decisions in Review, the owner's open questions in Decide,
// the glyph legend is the `?` tab). Pure view over the snapshot; `el` comes from $.ui.resolve(e). Every tab builds its lines in tabs.ts, out of ui.ts components
// (a missing fact is an explicit "no data" line there, never an empty tab). Words come from the string tables through `t`. This file decides no colour: every Text
// gets its props from `drawSeg` (ui.ts), theme keys as text colour only, no background, no inverse.

import { GLYPHS } from '../tux/glyphs.ts'
import { T_EN } from './i18n'
import type { T } from './i18n'
import { paneWidth } from './model'
import type { DecideBatch } from './decidebatch'
import type { DecideState, LiveSnapshot, PaneLine, PaneTab, Seg } from './model'
import { dispatchLines, fleetTabLines, headerLines, hygieneTabLines, legendLines, nowLines, reviewTabLines, spendTabLines, stripOf, treeRowCount, withOverflowHint } from './tabs'
import type { FleetView, OthersView } from './fleet'
import type { ScrollView } from './tabs'
import { dimProps, drawSeg, heldBorder, onBandLine } from './ui'
import type { Strip } from '../tux/strip.ts'
import { consoleStrip } from './consoletabs'
import { commandView } from './commandtab'
import { consolePage } from './consolepages'
import type { ConsoleNav, ConsoleTab } from './consoletabs'
import { keyed, scrollFrame } from './scroll'
import { TAB_GAP, actionRows, frameBottomFit, frameHintMin, frameHintShort, frameHintText, frameRows, stripRows, STRIP_SPLIT_COLS, v74BodyStatusRow, v74TitleSegs } from './pages/frame'
import { displayWidth, truncateToWidth } from './model'
import { fleetView as fleetPageView } from './pages/fleet'
import { renderQuota } from './pages/quota'
import { DEFAULT_REVIEW_VIEW, renderReview } from './pages/review'
import { renderSpend } from './pages/spend'
import type { PoolEta } from './pages/spend'
import type { DecideNav } from './pages/decide'
import type { KeyAction } from './pages/keys'
import type { ConsoleSnapshot } from './console'
import type { Page, PageCtx, PageId, Row } from './pages/frame'
import type { ScrollModel } from './scroll'
import type { Step } from './speed'
import { PET_KEY, V74_KEY } from './v74/contract'
import { widePane } from './wide/pane'
import type { PaneModel } from './wide/pane'
import { WidePaneTree } from './wide/tree'
import type { V74Ctx } from './v74/contract'

export type { PaneTab } from './model'

// The operator-console mode (consoletabs.ts): the shared navigation state (snapshot + tab) and what a press on a tab / the `›` chip does. null = every session without .claude/console.json.
// Beyond the navigation: the live snapshot (the cards the host holds), the clock, the answering wiring, the scroll model of the 指揮 page, and its folded sections.
export type ConsolePane = { nav: ConsoleNav; onTab: (t: ConsoleTab) => void; onNext: () => void; live?: LiveSnapshot | null; now?: number; decide?: DecideActs | null; scroll?: ScrollView | null; win?: ScrollModel | null; folded?: ReadonlySet<string>; onToggle?: (id: string) => void; inline?: boolean; epoch?: number }

// The console pane (C1 U4, U6): the page grows above the five-tab strip and its badges. The command page's own content is U5; 團隊 · 額度 · 主機 are a skeleton (consolepages.ts: a name line and a summary line, or
// "no source", never an empty table); 本席 folds this session's own 現況, 派工 and 審查 (the non-console pane's builders, tabs.ts) under one header. `own` is what 本席 draws: null = this session has no snapshot yet.
type SelfDraw = (l: PaneLine, i: number, k: string) => unknown
function consolePane(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, con: ConsolePane, t: T, cols: number, fleet: FleetView | null, own: { parts: { title: string | null; lines: PaneLine[] }[]; draw: SelfDraw } | null) {
  const { Box, Text } = el
  const strip = stripView(el, consoleStrip({ t, cols }, con.nav, false), con.onTab, {}, con.epoch ?? 0)
  const tab = con.nav.tab
  const stripRows = consoleStrip({ t, cols }, con.nav, false).rows
  const win = con.win ?? null
  if (win !== null) win.framed = false
  if (con.nav.snap !== null && tab === 'command') {
    const decide = con.decide ?? null
    const ctx = { t, cols, expanded: new Set<string>(), folded: con.folded ?? new Set<string>(), fleet, ...(decide === null ? {} : { decide: { ...decide.state, ...(decide.batch === undefined ? {} : { batch: decide.batch }), ...(decide.now === undefined ? {} : { now: decide.now }), inputs: decide.inputs && el.Input !== undefined } }) }
    const view = commandView(con.nav.snap, con.live ?? null, ctx, con.now ?? con.nav.snap.generated_at_ms)
    const line = lineView(el, decide, con.onToggle ?? (() => {}), () => {}, con.epoch ?? 0)
    const scroll = con.scroll ?? null
    if (scroll !== null && win !== null) {
      keyed(win, 'console:' + tab)
      return scrollFrame(el, {
        rows: scroll.bodyRows, cols, head: [], headRows: 0, total: view.body.length, window: (off, room) => view.body.slice(off, off + room).map((l, i) => line(l, off + i)),
        bar: [...view.bar.map((l, i) => line(l, i, 'bar')), strip], barRows: view.bar.length + stripRows, model: win,
        bottom: { above: n => t('shell.more_up', { n }), newer: '' },
      })
    }
    return (
      <Box flexDirection="column" height={con.scroll?.bodyRows} justifyContent="flex-end">
        {view.body.map((l, i) => line(l, i))}
        {view.bar.map((l, i) => line(l, i, 'bar'))}
        {strip}
      </Box>
    )
  }
  const page = tab === 'team' || tab === 'quota' || tab === 'hosts' ? consolePage(con.nav.snap, tab, t) : null
  const content = [
    ...(tab === 'command' && con.nav.snap === null ? [<Text {...dimProps()} wrap="truncate">{t('console.no_source')}</Text>] : []),
    ...(page === null ? [] : page.lines.map((l, i) => <Text key={'p' + i} {...(page.kind === 'summary' ? {} : dimProps())} wrap="truncate">{l}</Text>)),
    ...(tab !== 'self' ? [] : own === null ? [<Text {...dimProps()}>{t('pane.waiting')}</Text>] : own.parts.flatMap((p, n) => {
      while (p.lines[p.lines.length - 1]?.kind === 'blank') p.lines.pop()
      return [...(p.title === null ? [] : [<Text {...dimProps()} wrap="truncate">{p.title}</Text>]), ...p.lines.map((l, i) => own.draw(l, i, 's' + n))]
    })),
  ]
  if (con.scroll !== null && con.scroll !== undefined && win !== null) {
    keyed(win, 'console:' + tab)
    return scrollFrame(el, {
      rows: con.scroll.bodyRows, cols, head: [], headRows: 0, total: content.length, window: (off, room) => content.slice(off, off + room),
      bar: [strip], barRows: stripRows, model: win,
      bottom: { above: n => t('shell.more_up', { n }), newer: '' },
    })
  }
  return <Box flexDirection="column" height={con.scroll?.bodyRows} justifyContent="flex-end">{content}{strip}</Box>
}

// What the 待決 tab's controls call: a press on an option or the send Button (by its `press` id), and an edit of a note field (by the field's key). `state` is the
// owner's picks and notes as the host holds them; `inputs` is whether the surface draws text fields.
export type DecideActs = { state: DecideState; batch?: DecideBatch; now?: number; inputs: boolean; onPress: (id: string) => void; onNote: (key: string, value: string) => void; onKeep: (key: string, value: string) => void }

// The host Input is uncontrolled. Enter clears its buffer and then ignores a new `value` while the element key stays, so the field shows the placeholder and the next
// keystroke replaces the note. A new key remounts it and it takes the saved note. One count per field key: Enter in one card does not remount the others.
const noteEpoch = new Map<string, number>()
export function resetNoteInputs(): void {
  noteEpoch.clear()
}
export function noteInputKey(fieldKey: string): string {
  return fieldKey + ':' + String(noteEpoch.get(fieldKey) ?? 0)
}
function bumpNoteInput(fieldKey: string): void {
  noteEpoch.set(fieldKey, (noteEpoch.get(fieldKey) ?? 0) + 1)
}

type El = (props: any) => any

// The tab strip (ui.ts `strip`): Buttons when the surface has them (a click or Enter switches the tab), plain Text otherwise. The active tab is a bold name, and
// the baseline under the strip carries a `claude` run of `━` beneath it (a strip that wraps keeps the bold alone). A tab that holds something for the owner is
// drawn attention bold (no badge, no count).
// There is no `›` next-tab chip any more: a tab is chosen by its digit (the Button's hotkey, PAGE_DIGIT) or a click, and the digit of the tab showing leaves it open (register.ts).
function tabStrip(el: { Box: El; Text: El; Button?: El }, tab: PaneTab, onTab: (t: PaneTab) => void, snap: LiveSnapshot | null, t: T, cols: number, epoch = 0) {
  return stripView(el, stripOf(snap, { t, cols }, tab, false) as Strip<PaneTab>, onTab, PAGE_DIGIT, epoch)
}
// the digit of each tab (v7.4: keys 1–9, pet 0)
export const PAGE_DIGIT: Record<string, string> = { ...V74_KEY, pet: '0' }
export const DIGIT_TAB: Record<string, PaneTab> = { ...Object.fromEntries(Object.entries(V74_KEY).map(([id, d]) => [d, id === 'spend' ? 'spend' : id as PaneTab])), '0': 'now' }
// The FOCUS ANCHOR (plan r2 §3.2, fold A5): the one autoFocus Button carries the pane's autoFocus, so the host's ring starts on a Button that does nothing (drawn last: 'first drawn' only ranks among autoFocus Buttons, so it still wins) and `Enter` with nothing focused is a no-op.
// Without it the ring starts on the first tab Button, whose Enter pressed the tab already showing and closed the pane. It is zero cells wide and draws nothing; a tab is chosen by its digit or a click.
// When the pane moves between `dock` and `inline` (B56), `epoch` rotates every Button key so the unmounting placement cannot unregister the newly mounted placement's hotkeys or focus anchor.
export const FOCUS_ANCHOR_KEY = 'focus'
export const focusAnchorKey = (epoch = 0): string => (epoch > 0 ? FOCUS_ANCHOR_KEY + ':' + epoch : FOCUS_ANCHOR_KEY)
function focusAnchor(el: { Text: El; Button?: El }, epoch = 0) {
  const { Text, Button } = el
  return Button === undefined ? null : <Button key={focusAnchorKey(epoch)} plain autoFocus onPress={() => {}}><Text>{''}</Text></Button>
}

// the drawing half of the strip, shared with the operator-console pane (same Buttons, same baseline)
function stripView<Id extends string>(el: { Box: El; Text: El; Button?: El }, strip: Strip<Id>, onTab: (t: Id) => void, digits: Record<string, string> = {}, epoch = 0) {
  const { Box, Text, Button } = el
  const ep = epoch > 0 ? ':' + epoch : ''
  const draw = (s: Seg, k: string | number) => <Text key={k} {...drawSeg(s)} wrap="truncate">{s.text}</Text>
  return (
    <Box key="tabs" flexDirection="column">
      <Box>{strip.rule.map((s, i) => draw(s, 'rule' + i))}</Box>
      <Box flexWrap="wrap">
        {strip.tabs.map(x => (
          <Box key={x.id}>
            {Button === undefined ? draw(x.label, 'label') : <Button key={x.id + ep} plain {...(digits[x.id] === undefined ? {} : { hotkey: digits[x.id] })} onPress={() => onTab(x.id)}>{draw(x.label, 'label')}</Button>}
            <Text> </Text>
          </Box>
        ))}
        {focusAnchor(el, epoch)}
      </Box>
    </Box>
  )
}

// A page of the registry (pages/index.ts) drawn through frameRows: exactly `rows` rows, the strip entries are Buttons with the digit as hotkey.
export type PageView = { focus: number; expanded: boolean; folded?: boolean }
// view: focus index + expanded flag per page id (fleet, quota, spend); decide: the 待決 page's nav; onPress gets a Seg `press` that is not a tab switch (fleet:see:, fleet:fold, fill:...); onKey gets a page-local key (the host has no raw key hook: the keys are hidden hotkey Buttons); epoch rotates Button keys after a dock <-> inline move (B56)
// the screen-order rank of every Button the framed page drew (`card:N`, `p:row:col`): the ring's step direction is read from it (register.ts, ui.focus)
export const paneRank = new Map<string, number>()
export type FramePane = { wide?: { model: PaneModel; onPage: (n: number) => void; onKey: (key: string) => void }; pendingScroll?: PageCtx['pendingScroll']; poolEta?: PoolEta | null; room?: readonly { seq: number; from: string; kind: string; text: string }[]; pages: readonly Page[]; pageId?: PageId; onPage?: (id: PageId) => void; console: ConsoleSnapshot | null; nowMs: number; rows: number; maxRows?: number; bodyColumns?: number; scroll?: number; view?: Record<string, PageView>; decide?: DecideNav; v74?: V74Ctx; v74Box?: true; askRows?: readonly Row[]; onPress?: (id: string) => void; onKey?: (k: KeyAction) => void; onText?: (v: string) => void; epoch?: number; steps?: readonly Step[]; pet?: unknown; others?: OthersView | null }
const COMMON_KEYS: Record<string, KeyAction> = { z: { kind: 'fold' } } // the host takes a digit or a lowercase letter as a hotkey: Space is z here. j / k (next / previous card) are carried by the `[j] [k]` hint Buttons of the 待決 action row
const CARD_KEYS: Record<string, KeyAction> = { a: { kind: 'pick', index: 0 }, b: { kind: 'pick', index: 1 }, c: { kind: 'pick', index: 2 } }
const DECIDE_KEYS: Record<string, KeyAction> = { ...CARD_KEYS, d: { kind: 'pick', index: 3 }, e: { kind: 'expand' }, v: { kind: 'style' }, j: { kind: 'move', by: 1 }, k: { kind: 'move', by: -1 }, m: { kind: 'note' }, n: { kind: 'move', by: 1 }, p: { kind: 'move', by: -1 }, u: { kind: 'undo' }, h: { kind: 'prev' }, l: { kind: 'next' }, f: { kind: 'fill' }, s: { kind: 'submit' } }
// o acts on the focused (▸) row: quota shows / hides that pool's seats. decide has no o (a-e pick there); now has no focused row yet, so o is not bound there
const OPEN_KEY: Record<string, KeyAction> = { o: { kind: 'open' } }
const pageKeys = (id: string): Record<string, KeyAction> =>
  (id === 'decide' ? { ...COMMON_KEYS, ...DECIDE_KEYS } : id === 'todo' ? { ...COMMON_KEYS, ...CARD_KEYS } : id === 'fleet' ? {} : id === 'quota' ? { ...COMMON_KEYS, ...OPEN_KEY } : COMMON_KEYS) // v7.4 S8: the 艦隊 page is a plain list with no action rows, so it binds nothing (no fold, no see, no fill)
// every hotkey a framed page binds (f on fleet / quota is the page's own fill action): a visible `[x]` key hint must be one of these (frame.test.ts)
export const pageHotkeys = (id: string): string[] => [...Object.keys(pageKeys(id)), ...(id === 'quota' ? ['f'] : [])]
// quota renders under spend tab; spend page id maps to spend tab
const PAGE_TAB: Record<string, PaneTab> = { now: 'now', decide: 'decide', fleet: 'fleet', quota: 'spend', dispatch: 'dispatch', review: 'review', spend: 'spend', hygiene: 'hygiene', todo: 'decide', help: 'legend' }
export const framedPage = (frame: FramePane | null, tab: PaneTab): Page | undefined => {
  if (frame === null) return undefined
  if (frame.pageId !== undefined) return frame.pages.find(p => p.framed === true && p.id === frame.pageId)
  return frame.pages.find(p => p.framed === true && PAGE_TAB[p.id] === tab)
}
const HINT_AT = /(^|\s)\[[a-z]\] \S/
const HINT_SPLIT = /(?<=^|\s)(?=\[[a-z]\] \S)/
// v7.4: the framed page drawn as a full-width box (frame.rows tall, borders included): the title in the top border, the key hint in the bottom border, `│` on both sides, and the tab row
// as a separate last row under the box (the caller counts it in its own height). The page renderers are the same: they are asked for a frame of `frame.rows + strip` rows
// (head + body + actions + hint border + strip, `cols - 4` wide) and the head, the hint border and the strip are cut off the result and redrawn as the box's borders and the tab row.
const V74_TAB_HOTKEYS = false // the host draws a hotkey Button as `1: 現況`; the design's tab row is `1 現況`, so the tab buttons carry no hotkey (click only)
const CURSOR_MARK = '\u2023' // ‣ (U+2023, EAW=N): active item cursor; distinct from fold marker ▸ (GLYPHS.structure.folded)
function fitSegs(segs: Seg[], max: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const sg of segs) {
    const w = displayWidth(sg.text)
    if (used + w <= max) { out.push(sg); used += w; continue }
    if (max - used > 0) out.push({ ...sg, text: truncateToWidth(sg.text, max - used) })
    break
  }
  return out
}
// the box title (design S2-S10): `<頁名> · 資料 <source>（schema <schema>）· <age>`; the age is the feed's own fetch time (or the live snapshot's published_at), absent when the feed has none
function framedView(el: { Box: El; Text: El; Button?: El }, page: Page, frame: FramePane, snap: LiveSnapshot | null, onTab: (t: PaneTab) => void, t: T, fullCols: number) {
  const { Box, Text, Button } = el
  if (frame.pendingScroll !== undefined) paneRank.clear()
  const box = frame.v74Box === true
  const cols = box ? Math.max(20, fullCols - 4) : fullCols
  const stripN = cols < STRIP_SPLIT_COLS ? 2 : 1
  const frameRowsN = box ? frame.rows + stripN : frame.rows // what the page renderers are asked for (box: the inner rows + head + hint border + strip)
  const epoch = frame.epoch ?? 0
  const ep = epoch > 0 ? ':' + epoch : ''
  const baseCtx = { pendingScroll: frame.pendingScroll, live: snap, console: frame.console, size: { cols, rows: frameRowsN }, bodyColumns: frame.bodyColumns ?? fullCols, ...(frame.maxRows !== undefined ? { maxRows: frame.maxRows } : {}), t, nowMs: frame.nowMs, steps: frame.steps, pet: frame.pet, ...(frame.room !== undefined ? { room: frame.room } : {}), ...(frame.poolEta !== undefined ? { poolEta: frame.poolEta } : {}), ...(box ? { box: true as const } : {}), ...(page.id === 'fleet' ? { others: frame.others ?? null } : {}), ...(frame.v74 !== undefined ? { v74: frame.v74 } : {}), ...(page.id === 'decide' && frame.decide !== undefined ? { decide: frame.decide } : {}) }
  const statusRow = box ? v74BodyStatusRow(page, baseCtx, cols) : null
  const hasStatusRow = box && frame.rows >= 3 && statusRow !== null && statusRow.some(s => s.text.trim() !== '')
  // Reserve 1 row inside frameRows only when statusRow is actually drawn so body/overflow never lose their last row.
  const effFrameRows = hasStatusRow && frameRowsN > 4 ? frameRowsN - 1 : frameRowsN
  const ctx = effFrameRows === frameRowsN ? baseCtx : { ...baseCtx, size: { cols, rows: effFrameRows } }
  const view = frame.view?.[page.id] ?? (page.id === 'review' ? DEFAULT_REVIEW_VIEW : { focus: 0, expanded: false })
  // the pages that take a view are drawn through their view functions; the registry's render() keeps the default view
  const drawn: Page = page.id === 'fleet' ? { ...page, render: c => fleetPageView(c, view) } : page.id === 'quota' ? { ...page, render: c => renderQuota(c, view) } : page.id === 'review' ? { ...page, render: c => renderReview(c, view) } : page.id === 'spend' ? { ...page, render: c => renderSpend(c, view) } : page
  // free rows go to content first: a folded page (fleet lines, a pool's seats, spend details) is drawn open when the open body fits whole in the rows the surface has left, unless folded by key
  const unfold = view.expanded || view.folded === true ? undefined : page.id === 'fleet' ? (c: PageCtx) => fleetPageView(c, { ...view, expanded: true }) : page.id === 'quota' ? (c: PageCtx) => renderQuota(c, { ...view, expanded: true }) : page.id === 'spend' ? (c: PageCtx) => renderSpend(c, { ...view, expanded: true }) : undefined
  const rows: Row[] = frameRows(drawn, ctx, { ...(box ? { topAnchor: true as const } : {}), pages: frame.pages, ...(unfold === undefined ? {} : { unfold }), ...(frame.scroll === undefined ? {} : { scroll: frame.scroll }), ...(frame.askRows === undefined ? {} : { askRows: frame.askRows }) })
  const stripCount = effFrameRows <= 3 ? stripN : stripN + 1 // bottom border row (omitted at <= 3 rows) + tab strip
  // the action rows are exactly the ones the page returned (the frame pads nothing): only those rows may bind a `[x]` hint, never the body rows above them
  const avail = Math.max(0, effFrameRows - 1 - stripCount)
  const countActs = (acts: Row[]): number => (box
    ? acts.filter(row => row.some(s => s.press !== undefined) || row.map(s => s.text).join('').trim() !== t('frame.unknown')).length
    : acts.length)
  const firstActs = countActs(drawn.render(ctx).actions)
  const effActs = avail - Math.min(Math.max(1, firstActs), avail) <= 4 ? countActs(drawn.render({ ...ctx, shortBody: true }).actions) : Math.max(firstActs, unfold === undefined ? 0 : countActs(unfold(ctx).actions))
  const actionCount = Math.max(0, Math.min(effActs, avail))
  const press = (id: string) => { frame.onPress?.(id) }
  const noteAt = page.id === 'decide' && frame.decide?.textMode === true && el.Input !== undefined ? rows.length - stripCount - 1 : -1
  const typing = frame.decide?.textMode === true // while a note is typed the Input owns every key: the strip binds no digit and no hint binds a letter
  // A page key is carried by a VISIBLE Button: the action row's own `[x] label` (the host draws `x: label`), never an empty-label Button (the host draws that as a row `x:`).
  const keys: Record<string, KeyAction> = pageKeys(page.id)
  const used = new Set<string>()
  const actOf = (letter: string, own: string | undefined): (() => void) | undefined => {
    if (own !== undefined) return () => press(own)
    if (letter === 'i') return () => (frame.onPage !== undefined ? frame.onPage('help') : onTab('legend'))
    if (letter === 'o' && page.id === 'quota') return () => press('quota:open')
    const act = keys[letter]
    return act === undefined || letter === 'o' ? undefined : () => frame.onKey?.(act)
  }
  const drawRow = (r: Row, i: number) => {
    if (i === noteAt && el.Input !== undefined) {
      const Input = el.Input
      return <Box key={'f' + i}><Input key="v74-note" placeholder={t('page.decide.act_text')} value={frame.decide?.textBuf ?? ''} onInput={(v: string) => frame.onText?.(v)} onSubmit={() => frame.onKey?.({ kind: 'text_save' })} autoFocus />{Button === undefined ? null : <Button key={'note:cancel' + ep} plain onPress={() => frame.onKey?.({ kind: 'text_cancel' })}><Text>{t('page.decide.act_cancel')}</Text></Button>}</Box>
    }
    const isStrip = i >= rows.length - stripCount + 1 // tab buttons only (not the border row above)
    const isBorder = i === rows.length - stripCount
    // a `[x] label` hint binds a letter only in an ACTION row (a head or body row can quote `[a]` or `buf[i]`), at the start of the text or after a space (one form: the host draws the Button `x: label`, so the text never also carries `[x]`)
    const isActionRow = i >= rows.length - stripCount - actionCount && !isStrip
    const nodes: unknown[] = []
    for (let j = 0; j < r.length; j++) {
      const sg = r[j]
      const m = sg.press === undefined ? null : /^tab:(\d):(\w+)$/.exec(sg.press)
      const to = m === null ? undefined : PAGE_TAB[m[2]]
      if (m !== null && frame.pages.some(p => p.id === m[2]) && Button !== undefined) {
        // the strip owns the digit hotkey; the host draws `<digit>: <label>`, so the label is the page name alone. A page's own `[2]` action is a click target only.
        const label = <Text key={'g' + j} {...drawSeg(sg)} wrap="truncate">{isStrip ? sg.text.replace(/^\d+\s+/, '') : sg.text}</Text>
        const choose = () => (frame.onPage !== undefined ? frame.onPage(m[2] as PageId) : to === undefined ? undefined : onTab(to))
        paneRank.set(m[2] + ep, i * 1000 + j)
        nodes.push(isStrip ? <Button key={m[2] + ep} plain {...(typing ? {} : { hotkey: m[1] })} onPress={choose}>{label}</Button> : <Button key={'a:' + i + ':' + m[2] + ep} plain onPress={choose}>{label}</Button>)
        continue
      }
      if (sg.press !== undefined && m === null && Button !== undefined) {
        // consecutive segments of one press id are one Button (a fleet line, a quota pool: one row, one Tab stop)
        let e = j
        while (e + 1 < r.length && r[e + 1].press === sg.press) e++
        const run = r.slice(j, e + 1)
        const fromKey = typeof sg.press === 'string' && sg.press.startsWith('key:') ? sg.press.slice(4) : ''
        const hint = typing ? null : /^\[([a-z])\] /.exec(run[0].text)
        const keyLetter = /^[a-z]$/.test(fromKey) ? fromKey : null
        const letter = hint !== null && !used.has(hint[1]) ? hint[1] : keyLetter !== null && !used.has(keyLetter) ? keyLetter : null
        if (letter !== null) used.add(letter)
        const cardAt = typeof sg.press === 'string' && sg.press.startsWith('card:') ? Number(sg.press.slice(5)) : null
        const focusMark = frame.pendingScroll === undefined && cardAt !== null && box && !typing && (sg.text.startsWith(CURSOR_MARK) || sg.text.startsWith(GLYPHS.structure.folded))
        const stripLead = (x: string) => letter === null ? x : x.replace(new RegExp('^\\[' + letter + '\\] |^' + letter + ': |^' + letter + ' '), '')
        const texts = run.map((x, n) => <Text key={'g' + (j + n)} {...drawSeg(x)} wrap="truncate">{n === 0 && letter !== null ? stripLead(x.text) : x.text}</Text>)
        const onKeyPress = () => {
          if (cardAt !== null) frame.onKey?.({ kind: 'cursor', at: cardAt })
          else if (typeof sg.press === 'string' && sg.press.startsWith('key:')) frame.onKey?.(keys[sg.press.slice(4)] ?? (sg.press === 'key:y' ? { kind: 'confirm' } : { kind: 'none' }))
          else press(sg.press as string)
        }
        paneRank.set(cardAt !== null ? 'card:' + cardAt : 'p:' + i + ':' + j + ep, i * 1000 + j)
        nodes.push(<Button key={(cardAt !== null ? 'card:' + cardAt : 'p:' + i + ':' + j + ep)} plain {...(letter === null ? {} : { hotkey: letter })} {...(focusMark ? { autoFocus: true } : {})} onPress={onKeyPress}>{texts}</Button>)
        j = e
        continue
      }
      const text = (x: string, k: string) => <Text key={k} {...drawSeg(sg)} wrap="truncate">{x === '' && r.length === 1 ? ' ' : x}</Text>
      if (isBorder) { nodes.push(text(sg.text, 'g' + j)); continue }
      if (Button !== undefined && !typing && sg.press === undefined && (isStrip ? false : isActionRow && HINT_AT.test(sg.text))) {
        // hint pieces (`[h] prev  [l] next`) each become a Button carrying their letter; text between stays Text
        const pieces = sg.text.split(HINT_SPLIT)
        pieces.forEach((pc, n) => {
          const hm = isStrip ? (n === 0 && pc.startsWith('i ') ? ['', 'i'] : null) : /^\[([a-z])\] /.exec(pc)
          const act = hm === null || used.has(hm[1]) ? undefined : actOf(hm[1], undefined)
          if (hm === null || act === undefined) { nodes.push(text(pc, 'g' + j + '.' + n)); return }
          used.add(hm[1])
          paneRank.set('h:' + hm[1] + ep, i * 1000 + j + n / 100)
          nodes.push(<Button key={'h:' + hm[1] + ep} plain hotkey={hm[1]} onPress={act}>{text(pc.replace(/^(\[[a-z]\]|i) /, ''), 'g' + j + '.' + n)}</Button>)
        })
        continue
      }
      nodes.push(text(sg.text, 'g' + j))
    }
    // F1: j / k (next / previous card) are always carried by a zero-size Button on 待決 and 待辦, whatever the action row says: a letter with no Button in the Pane is handed to the prompt and takes the keyboard with it
    if (i === rows.length - 1) {
      paneRank.set(focusAnchorKey(epoch), rows.length * 1000)
      for (const [at, letter] of ['j', 'k', 'n', 'p', 'm'].entries()) paneRank.set('pn:' + letter + ep, rows.length * 1000 + at + 1)
    }
    const navHot = i === rows.length - 1 && !typing && Button !== undefined && (page.id === 'decide' || page.id === 'todo')
      ? (page.id === 'decide' && frame.v74 !== undefined ? [['j', 1], ['k', -1], ['n', 1], ['p', -1], ['m', 0]] : [['j', 1], ['k', -1]]).filter(([l]) => !used.has(l as string)).map(([l, by]) => <Box key={'hk:' + l} width={0} height={0} overflow="hidden"><Button key={'pn:' + l + ep} plain hotkey={l as string} onPress={() => frame.onKey?.(keys[l as string] ?? { kind: 'move', by: by as 1 | -1 })}>{l as string}</Button></Box>)
      : []
    return <Box key={'f' + i} {...(frame.pendingScroll !== undefined && page.id === 'decide' ? { width: cols, height: 1, overflow: 'hidden' as const } : {})}>{nodes}{i === rows.length - 1 ? [focusAnchor(el, epoch), ...navHot] : null}</Box>
  }
  if (!box) return <Box {...(epoch > 0 ? { key: 'frame:' + epoch } : {})} flexDirection="column" height={frame.rows}>{rows.map(drawRow)}</Box>
  const rule = GLYPHS.structure.rule
  const side = GLYPHS.structure.bandSep
  const pad = (n: number) => rule.repeat(Math.max(1, n))
  // r11 #9: the border changes colour while the pane holds the keyboard, so focus is not only a hint word
  const held = ctx.v74?.keysHeld === true
  const bc = held ? heldBorder() : {}
  const titleMax = Math.max(0, fullCols - 6)
  const titleSegs = fitSegs(v74TitleSegs(page, ctx, (rows[0] ?? [])[0] ?? { text: t('tab.' + page.id) }, titleMax), titleMax)
  const titleW = titleSegs.reduce((n, x) => n + displayWidth(x.text), 0)
  const top = <Box key="v74-top" height={1} width={fullCols} overflow="hidden"><Text {...bc}>{GLYPHS.structure.frameTL + rule + ' '}</Text>{titleSegs.map((x, j) => <Text key={'tt' + j} {...drawSeg(x)} wrap="truncate">{x.text}</Text>)}<Text {...bc}>{' ' + pad(fullCols - 5 - titleW) + GLYPHS.structure.frameTR}</Text></Box>
  const rawInner = rows.slice(1, Math.max(1, rows.length - stripCount)).map((r, k) => ({ r, idx: k + 1 }))
  let innerEntries = rawInner
  if (hasStatusRow) {
    const maxInner = Math.max(0, frame.rows - 2)
    if (effFrameRows < frameRowsN) {
      innerEntries = [{ r: statusRow!, idx: -2 }, ...rawInner]
    } else {
      const actStart = rows.length - stripCount - actionCount
      const bodyPart = rawInner.filter(e => e.idx < actStart)
      const actPart = rawInner.filter(e => e.idx >= actStart)
      const keepBody = bodyPart.slice(0, Math.max(0, maxInner - 1 - actPart.length))
      innerEntries = [{ r: statusRow!, idx: -2 }, ...keepBody, ...actPart].slice(0, maxInner)
    }
  }
  // Codex R3 Critical: shrink boxed Decide pane to content height (drop trailing filler gap rows between content and actions).
  if (page.id === 'decide' && ctx.v74 !== undefined) {
    const actStart = rows.length - stripCount - actionCount
    const bodyPart = innerEntries.filter(e => e.idx < actStart)
    const actPart = innerEntries.filter(e => e.idx >= actStart)
    while (bodyPart.length > 0 && bodyPart.length + actPart.length > 2 && bodyPart[bodyPart.length - 1].r.every(s => s.text.trim() === '')) {
      bodyPart.pop()
    }
    innerEntries = [...bodyPart, ...actPart]
  }
  const inner = innerEntries.map(({ r, idx }, k) => (
    <Box key={'v74-row' + k} height={1} width={fullCols} overflow="hidden"><Text>{side + ' '}</Text><Box flexGrow={1} flexDirection="row" overflow="hidden">{drawRow(r, idx)}</Box><Text>{' ' + side}</Text></Box>
  ))
  // PM 01M7XB0B: the page tabs sit on the bottom border, right side; the key hint stays on the left. One row, never a second line.
  const entriesOf = (c: PageCtx) => stripRows(page, c).flat().filter(sg => sg.press !== undefined && !sg.press.endsWith(':pet'))
  const fullForm = entriesOf({ ...ctx, size: { ...ctx.size, cols: 1000 } })
  const tabItems = fullForm.flatMap(sg => {
    const m = /^tab:(\d):(\w+)$/.exec(sg.press as string)
    return m === null ? [] : [{ key: m[1], id: m[2], text: sg.text }]
  })
  const fit = frameBottomFit(fullCols, frameHintText(page, ctx), frameHintShort(page, ctx), tabItems, page.id, frameHintMin(page, ctx))
  const tabW = fit.tabs.reduce((n, x, i) => n + (i === 0 ? 0 : TAB_GAP) + displayWidth(x.text), 0)
  const padN = Math.max(1, fullCols - (2 + 2 + displayWidth(fit.hint) + 2 + 2 + tabW + 2 + 2))
  const tabs = fit.tabs.map((tb, j) => {
    const draw = <Text key={'tl' + j} wrap="truncate">{tb.text}</Text>
    const choose = () => (frame.onPage !== undefined ? frame.onPage(tb.id as PageId) : onTab(PAGE_TAB[tb.id]))
    const on = tb.id === page.id
    // The host drops Button variant. The current tab is its own Text with inverse (SGR 7) so the ╰ row is not one plain string.
    const label = on ? <Text key={'tl' + j} inverse wrap="truncate">{tb.text}</Text> : draw
    // The selected card head is not a Button (it ate Up/Down and re-fired cursor at its own index).
    // ctrl+x Tab still lands: the current tab is the visible autoFocus button.
    const land = on && !typing && (page.id === 'decide' || page.id === 'todo')
    const btn = Button === undefined ? label : <Button key={'tab:' + tb.id + ep} plain {...(V74_TAB_HOTKEYS ? { hotkey: tb.key } : {})} {...(land ? { autoFocus: true } : {})} onPress={choose}>{label}</Button>
    return <Box key={'tb' + j}>{j === 0 ? null : <Text>{' '.repeat(TAB_GAP)}</Text>}{btn}</Box>
  })
  const hidden = Button === undefined || frame.decide?.textMode === true ? [] : [
    ...tabItems.map((tb, j) => {
      const choose = () => (frame.onPage !== undefined ? frame.onPage(tb.id as PageId) : onTab(PAGE_TAB[tb.id]))
      return <Box key={'hk' + j} width={0} height={0} overflow="hidden"><Button key={'hotkey:' + tb.key + ep} plain hotkey={tb.key} onPress={choose}>{tb.key}</Button></Box>
    }),
    ...(frame.pages.some(p => p.id === 'pet')
      ? [<Box key="hk-pet" width={0} height={0} overflow="hidden"><Button key={'hotkey:' + PET_KEY + ep} plain hotkey={PET_KEY} onPress={() => (frame.onPage !== undefined ? frame.onPage('pet') : onTab('now'))}><Text>{''}</Text></Button></Box>]
      : []),
  ]
  // The boxed fallback replaces the strip row (and its navHot buttons).
  // Keep card navigation registered on this bottom border too. s stays on the action row.
  const letters = Button === undefined || typing || page.id !== 'decide' ? [] : (['a', 'b', 'c', 'e', 'm', 'n', 'p', 'j', 'k', 'v'] as const).map(letter => (
    <Box key={'lk' + letter} width={0} height={0} overflow="hidden"><Button key={'letter:' + letter + ep} plain hotkey={letter} onPress={() => frame.onKey?.(keys[letter] ?? (letter === 'j' ? { kind: 'move', by: 1 } : letter === 'k' ? { kind: 'move', by: -1 } : { kind: 'none' }))}>{letter}</Button></Box>
  ))
  const expandKey = Button === undefined || typing ? [] : [
    <Box key="lkw" width={0} height={0} overflow="hidden"><Button key={'letter:w' + ep} plain hotkey="w" onPress={() => frame.onKey?.({ kind: 'toggle_expand' })}><Text>{''}</Text></Button></Box>,
  ]
  const bottom = <Box key="v74-bottom" height={1} width={fullCols} overflow="hidden"><Text {...bc}>{GLYPHS.structure.frameBL + rule + '  ' + fit.hint + '  ' + rule.repeat(padN) + '  '}</Text>{tabs}<Text {...bc}>{'  ' + rule + GLYPHS.structure.frameBR}</Text>{hidden}{letters}{expandKey}</Box>
  return <Box {...(epoch > 0 ? { key: 'v74:' + epoch } : {})} flexDirection="column">{top}{inner}{bottom}</Box>
}

// how one PaneLine is drawn (shared by the tabs and the console's 指揮 page): plain segments, a press row of Buttons, a text field, a toggle Button, a goto Button
function lineView(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, decide: DecideActs | null, onToggle: (id: string) => void, onTab: (t: PaneTab) => void, epoch = 0) {
  const { Box, Text, Link, Button, Input } = el
  const ep = epoch > 0 ? ':' + epoch : ''
  const segsOf = (l: PaneLine): Seg[] => l.segs ?? [{ text: l.text }]
  const drawn = (l: PaneLine) => segsOf(l).map((x, j) => <Text key={'g' + j} {...drawSeg(x)} wrap="truncate">{x.text}</Text>)
  // a line with no segments is the blank (drawn as a one-cell Text: an empty Text takes no row); every other line is a row of segments
  const plainLine = (l: PaneLine, i: number, k = '') => l.segs !== undefined
    ? <Box key={k + 'l' + i} flexWrap={l.wrap === true ? 'wrap' : undefined}>{l.segs.map((s, j) => <Text key={'g' + j} {...drawSeg(s)} wrap={l.wrap === true ? 'wrap' : 'truncate'}>{s.text}</Text>)}</Box>
    : <Text key={k + 'l' + i} wrap="truncate">{l.text === '' ? ' ' : l.text}</Text>
  // a line with pressable or link segments (option row, send row, attachment row, 給你看 row): consecutive segments of one `press` id are one Button, `href` is a Link, the rest plain Text.
  const pressLine = (l: PaneLine, i: number, k: string) => {
    const runs: { press: string | undefined; href: string | undefined; segs: Seg[] }[] = []
    for (const s of l.segs as Seg[]) {
      const last = runs[runs.length - 1]
      if (last !== undefined && last.press === s.press && last.href === s.href) last.segs.push(s)
      else runs.push({ press: s.press, href: s.href, segs: [s] })
    }
    const runId = runs.find(r => r.press !== undefined)?.press ?? runs.find(r => r.href !== undefined)?.href
    return (
      <Box key={k + 'p' + (runId ?? i)} flexWrap="wrap">
        {runs.map((r, j) => {
          const texts = r.segs.map((s, n) => <Text key={'g' + n} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)
          if (r.href !== undefined && Link !== undefined) return <Link key={'lnk:' + j + ':' + r.href} href={r.href} label={r.segs.map(s => s.text).join('')} />
          return r.press === undefined || Button === undefined || decide === null
            ? <Box key={'r' + j}>{texts}</Box>
            : <Button key={r.press.replace(/^pick:/, 'opt:') + ep} plain onPress={() => decide.onPress(r.press as string)}>{texts}</Button>
        })}
      </Box>
    )
  }
  // a text-field line: the label, then the Input (what is typed is the owner's note, kept by the host under the field's key)
  const fieldLine = (l: PaneLine, i: number, k: string) => {
    const f = l.field as NonNullable<PaneLine['field']>
    return (
      <Box key={k + 'f' + i}>
        {l.segs === undefined ? null : l.segs.map((s, j) => <Text key={'g' + j} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)}
        {Input === undefined || decide === null ? null : <Input key={noteInputKey(f.key)} placeholder={f.placeholder} value={f.value} onInput={(v: string) => decide.onNote(f.key, v)} onSubmit={(v: string) => { bumpNoteInput(f.key); decide.onKeep(f.key, v) }} />}
      </Box>
    )
  }
  // a line that carries a `toggle` id is a Button when the surface has them (a press expands / collapses its group), the plain line otherwise
  const line = (l: PaneLine, i: number, k = '') => l.field !== undefined && l.segs !== undefined
    ? fieldLine(l, i, k)
    : l.segs !== undefined && (l.kind === 'choice' || l.segs.some(x => x.press !== undefined || x.href !== undefined))
    ? pressLine(l, i, k)
    : l.toggle !== undefined && Button !== undefined
    ? <Button key={k + 'b' + i + ep} plain onPress={() => onToggle(l.toggle as string)}>{drawn(l)}</Button>
    // a line that carries a `goto` tab (a projection row, design plan §2.3) is a Button that opens that tab
    : l.goto !== undefined && Button !== undefined
    ? <Button key={k + 'g' + i + ep} plain onPress={() => onTab(l.goto as PaneTab)}>{drawn(l)}</Button>
    : plainLine(l, i, k)
  return line
}

export function Pane(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, snap: LiveSnapshot | null, tab: PaneTab = 'now', onTab: (t: PaneTab) => void = () => {}, t: T = T_EN, bodyColumns: number | null = null, onNext: () => void = () => {}, expanded: ReadonlySet<string> = new Set(), onToggle: (id: string) => void = () => {}, folded: ReadonlySet<string> = new Set(), scroll: ScrollView | null = null, decide: DecideActs | null = null, win: ScrollModel | null = null, fleet: FleetView | null = null, con: ConsolePane | null = null, frame: FramePane | null = null) {
  const { Box, Text, Link, Button, Input } = el
  const cols = paneWidth(bodyColumns)
  const epoch = con !== null ? (con.epoch ?? 0) : (frame?.epoch ?? 0)
  const ctx = { t, cols, expanded, folded, fleet, ...(decide === null ? {} : { decide: { ...decide.state, ...(decide.batch === undefined ? {} : { batch: decide.batch }), ...(decide.now === undefined ? {} : { now: decide.now }), inputs: decide.inputs && Input !== undefined } }) }
  const line = lineView(el, decide, onToggle, (g: PaneTab) => onTab(g), epoch)
  if (con !== null) {
    // 本席: the header (spend, context), then 現況, 派工, 審查 under a dim name each; the lines are the ones the non-console tabs draw
    const own = snap === null ? null : { parts: [{ title: null, lines: headerLines(snap, ctx) }, { title: t('console.self.now'), lines: nowLines(snap, ctx) }, { title: t('console.self.dispatch'), lines: dispatchLines(snap, ctx) }, { title: t('console.self.review'), lines: reviewTabLines(snap, ctx) }], draw: line }
    return consolePane(el, con, t, cols, fleet, own)
  }
  if (frame?.wide !== undefined) return WidePaneTree(el, widePane(frame.wide.model), frame.wide.onPage, frame.wide.onKey, epoch) // console v5: the 94-column docked pane (wide/pane.ts); every other width keeps the frame below
  const framed = framedPage(frame, tab)
  if (frame !== null && framed !== undefined) return framedView(el, framed, frame, snap, onTab, t, cols)
  const strip = tabStrip(el, tab, onTab, snap, t, cols, epoch)
  if (snap === null) {
    return (
      <Box flexDirection="column" height={scroll?.bodyRows} justifyContent="flex-end">
        <Text {...dimProps()}>{t('pane.waiting')}</Text>
        {strip}
      </Box>
    )
  }
  // the global header (design plan §2.2): drawn here, once, on every tab; no tab builder emits it (I9)
  // The frame keeps its upward overflow hint apart from these shared facts.
  const body: PaneLine[] = tab === 'legend' ? legendLines(ctx) : tab === 'now' ? nowLines(snap, ctx) : tab === 'decide' ? [onBandLine(t('shell.on_band'))] : tab === 'review' ? reviewTabLines(snap, ctx) : tab === 'spend' ? spendTabLines(snap, ctx) : tab === 'hygiene' ? hygieneTabLines(snap, ctx) : tab === 'fleet' ? fleetTabLines(snap, ctx) : dispatchLines(snap, ctx)
  const link = tab === 'dispatch' && snap.link !== null
  const stripH = stripOf(snap, ctx, tab, false)
  const plainHead = headerLines(snap, ctx)
  // Every tab shares a bottom window: cold header/body rows scroll above the
  // fixed submit controls and navigation. No padding separates L2 from L3.
  if (win !== null) win.framed = false // set again by the frame; a plain tree leaves ui.scroll to the engine
  if (scroll !== null && win !== null) {
    const cards = [...plainHead, ...body.filter(l => l.bar !== true)]
    while (cards[cards.length - 1]?.kind === 'blank') cards.pop()
    const barLines = body.filter(l => l.bar === true)
    keyed(win, tab)
    return scrollFrame(el, {
      rows: scroll.bodyRows, cols, head: [], headRows: 0,
      total: cards.length + (link ? 1 : 0), window: (off, room) => [...cards.map((l, i) => line(l, i < plainHead.length ? i : i - plainHead.length, i < plainHead.length ? 'h' : '')), ...(link ? [<Link href={snap.link as string} label={t('dispatch.link')} />] : [])].slice(off, off + room),
      bar: [...barLines.map((l, i) => line(l, i, 'bar')), strip], barRows: barLines.length + stripH.rows, model: win,
      bottom: { above: n => t('shell.more_up', { n }), newer: '' },
    })
  }
  const head = withOverflowHint(plainHead, ctx, scroll, treeRowCount(stripH.rows, plainHead, body, link ? 1 : 0), stripH.exact).map((l, i) => line(l, i, 'h'))
  return (
    <Box flexDirection="column" height={scroll?.bodyRows} justifyContent="flex-end">
      {head}
      {body.map((l, i) => line(l, i))}
      {link ? <Link href={snap.link as string} label={t('dispatch.link')} /> : null}
      {strip}
    </Box>
  )
}
