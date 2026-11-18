// mods/live/pane.tsx — the panel the ⓘ opens (TUI v2): Now · Decide · Dispatch · Review · Spend · Hygiene · ?  (the stage walk lives in Now, the proxy decisions in Review, the owner's open questions in Decide,
// the glyph legend is the `?` tab). Pure view over the snapshot; `el` comes from $.ui.resolve(e). Every tab builds its lines in tabs.ts, out of ui.ts components
// (a missing fact is an explicit "no data" line there, never an empty tab). Words come from the string tables through `t`. This file decides no colour: every Text
// gets its props from `drawSeg` (ui.ts), theme keys as text colour only, no background, no inverse.

import { T_EN } from './i18n'
import type { T } from './i18n'
import { paneWidth } from './model'
import type { DecideBatch } from './decidebatch'
import type { DecideState, LiveSnapshot, PaneLine, PaneTab, Seg } from './model'
import { decideTabLines, dispatchLines, fleetTabLines, headerLines, hygieneTabLines, legendLines, nowLines, reviewTabLines, spendTabLines, stripOf, treeRowCount, withOverflowHint } from './tabs'
import type { FleetView } from './fleet'
import type { ScrollView } from './tabs'
import { dimProps, drawSeg } from './ui'
import type { Strip } from './ui'
import { consoleStrip } from './consoletabs'
import { commandView } from './commandtab'
import { consolePage } from './consolepages'
import type { ConsoleNav, ConsoleTab } from './consoletabs'
import { keyed, scrollFrame } from './scroll'
import { actionRows, frameRows, STRIP_SPLIT_COLS } from './pages/frame'
import { fleetView as fleetPageView } from './pages/fleet'
import { renderQuota } from './pages/quota'
import { renderSpend } from './pages/spend'
import type { DecideNav } from './pages/decide'
import type { KeyAction } from './pages/keys'
import type { ConsoleSnapshot } from './console'
import type { Page, PageCtx, PageId, Row } from './pages/frame'
import type { ScrollModel } from './scroll'

export type { PaneTab } from './model'

// The operator-console mode (consoletabs.ts): the shared navigation state (snapshot + tab) and what a press on a tab / the `›` chip does. null = every session without .claude/console.json.
// Beyond the navigation: the live snapshot (the cards the host holds), the clock, the answering wiring, the scroll model of the 指揮 page, and its folded sections.
export type ConsolePane = { nav: ConsoleNav; onTab: (t: ConsoleTab) => void; onNext: () => void; live?: LiveSnapshot | null; now?: number; decide?: DecideActs | null; scroll?: ScrollView | null; win?: ScrollModel | null; folded?: ReadonlySet<string>; onToggle?: (id: string) => void; inline?: boolean }

// The console pane (C1 U4, U6): the page grows above the five-tab strip and its badges. The command page's own content is U5; 團隊 · 額度 · 主機 are a skeleton (consolepages.ts: a name line and a summary line, or
// "no source", never an empty table); 本席 folds this session's own 現況, 派工 and 審查 (the non-console pane's builders, tabs.ts) under one header. `own` is what 本席 draws: null = this session has no snapshot yet.
type SelfDraw = (l: PaneLine, i: number, k: string) => unknown
function consolePane(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, con: ConsolePane, t: T, cols: number, own: { parts: { title: string | null; lines: PaneLine[] }[]; draw: SelfDraw } | null) {
  const { Box, Text } = el
  const strip = stripView(el, consoleStrip({ t, cols }, con.nav, false), con.onTab)
  const tab = con.nav.tab
  const stripRows = consoleStrip({ t, cols }, con.nav, false).rows
  const win = con.win ?? null
  if (win !== null) win.framed = false
  if (con.nav.snap !== null && tab === 'command') {
    const decide = con.decide ?? null
    const ctx = { t, cols, expanded: new Set<string>(), folded: con.folded ?? new Set<string>(), fleet: null, ...(decide === null ? {} : { decide: { ...decide.state, ...(decide.batch === undefined ? {} : { batch: decide.batch }), ...(decide.now === undefined ? {} : { now: decide.now }), inputs: decide.inputs && el.Input !== undefined } }) }
    const view = commandView(con.nav.snap, con.live ?? null, ctx, con.now ?? con.nav.snap.generated_at_ms)
    const line = lineView(el, decide, con.onToggle ?? (() => {}), () => {})
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
function tabStrip(el: { Box: El; Text: El; Button?: El }, tab: PaneTab, onTab: (t: PaneTab) => void, snap: LiveSnapshot | null, t: T, cols: number) {
  return stripView(el, stripOf(snap, { t, cols }, tab, false) as Strip<PaneTab>, onTab, PAGE_DIGIT)
}
// the digit of each tab (plan r2 §3.2): the four pages of the registry first (the quota page is still the Spend tab until S4 adds its own), then the tabs not moved yet
export const PAGE_DIGIT: Record<string, string> = { now: '1', decide: '2', fleet: '3', spend: '4', dispatch: '5', review: '6', hygiene: '8' }
export const DIGIT_TAB: Record<string, PaneTab> = { '1': 'now', '2': 'decide', '3': 'fleet', '4': 'spend', '5': 'dispatch', '6': 'review', '7': 'spend', '8': 'hygiene' }
// The FOCUS ANCHOR (plan r2 §3.2, fold A5): the one autoFocus Button carries the pane's autoFocus, so the host's ring starts on a Button that does nothing (drawn last: 'first drawn' only ranks among autoFocus Buttons, so it still wins) and `Enter` with nothing focused is a no-op.
// Without it the ring starts on the first tab Button, whose Enter pressed the tab already showing and closed the pane. It is zero cells wide and draws nothing; a tab is chosen by its digit or a click.
export const FOCUS_ANCHOR_KEY = 'focus'
function focusAnchor(el: { Text: El; Button?: El }) {
  const { Text, Button } = el
  return Button === undefined ? null : <Button key={FOCUS_ANCHOR_KEY} plain autoFocus onPress={() => {}}><Text>{''}</Text></Button>
}

// the drawing half of the strip, shared with the operator-console pane (same Buttons, same baseline)
function stripView<Id extends string>(el: { Box: El; Text: El; Button?: El }, strip: Strip<Id>, onTab: (t: Id) => void, digits: Record<string, string> = {}) {
  const { Box, Text, Button } = el
  const draw = (s: Seg, k: string | number) => <Text key={k} {...drawSeg(s)} wrap="truncate">{s.text}</Text>
  return (
    <Box key="tabs" flexDirection="column">
      <Box>{strip.rule.map((s, i) => draw(s, 'rule' + i))}</Box>
      <Box flexWrap="wrap">
        {strip.tabs.map(x => (
          <Box key={x.id}>
            {Button === undefined ? draw(x.label, 'label') : <Button key={x.id} plain {...(digits[x.id] === undefined ? {} : { hotkey: digits[x.id] })} onPress={() => onTab(x.id)}>{draw(x.label, 'label')}</Button>}
            <Text> </Text>
          </Box>
        ))}
        {focusAnchor(el)}
      </Box>
    </Box>
  )
}

// A page of the registry (pages/index.ts) drawn through frameRows: exactly `rows` rows, the strip entries are Buttons with the digit as hotkey.
export type PageView = { focus: number; expanded: boolean; folded?: boolean }
// view: focus index + expanded flag per page id (fleet, quota, spend); decide: the 待決 page's nav; onPress gets a Seg `press` that is not a tab switch (fleet:see:, fleet:fold, fill:...); onKey gets a page-local key (the host has no raw key hook: the keys are hidden hotkey Buttons)
export type FramePane = { pages: readonly Page[]; pageId?: PageId; onPage?: (id: PageId) => void; console: ConsoleSnapshot | null; nowMs: number; rows: number; scroll?: number; view?: Record<string, PageView>; decide?: DecideNav; onPress?: (id: string) => void; onKey?: (k: KeyAction) => void; onText?: (v: string) => void }
const COMMON_KEYS: Record<string, KeyAction> = { z: { kind: 'fold' } } // the host takes a digit or a lowercase letter as a hotkey: Space is z here. No j / k: a key needs a visible Button to carry it, and a row is its own Button (Tab walks the rows)
const DECIDE_KEYS: Record<string, KeyAction> = { a: { kind: 'pick', index: 0 }, b: { kind: 'pick', index: 1 }, c: { kind: 'pick', index: 2 }, d: { kind: 'pick', index: 3 }, e: { kind: 'pick', index: 4 }, n: { kind: 'note' }, u: { kind: 'undo' }, h: { kind: 'prev' }, l: { kind: 'next' }, f: { kind: 'fill' }, s: { kind: 'submit' } }
// o acts on the focused (▸) row: fleet sees that line, quota shows / hides that pool's seats. decide has no o (a-e pick there); now has no focused row yet, so o is not bound there
const OPEN_KEY: Record<string, KeyAction> = { o: { kind: 'open' } }
const pageKeys = (id: string): Record<string, KeyAction> => (id === 'decide' ? { ...COMMON_KEYS, ...DECIDE_KEYS } : id === 'fleet' || id === 'quota' ? { ...COMMON_KEYS, ...OPEN_KEY } : COMMON_KEYS)
// every hotkey a framed page binds (f on fleet / quota is the page's own fill action): a visible `[x]` key hint must be one of these (frame.test.ts)
export const pageHotkeys = (id: string): string[] => [...Object.keys(pageKeys(id)), ...(id === 'fleet' || id === 'quota' ? ['f'] : []), 'i']
// quota (4) and spend (7) both show the Spend tab when pageId is unset; when pageId is set, quota renders framed quotaPage and spend renders framed spendPage
const PAGE_TAB: Record<string, PaneTab> = { now: 'now', decide: 'decide', fleet: 'fleet', quota: 'spend', dispatch: 'dispatch', review: 'review', spend: 'spend', hygiene: 'hygiene' }
export const framedPage = (frame: FramePane | null, tab: PaneTab): Page | undefined => {
  if (frame === null) return undefined
  if (frame.pageId !== undefined) return frame.pages.find(p => p.framed === true && p.id === frame.pageId)
  return frame.pages.find(p => p.framed === true && PAGE_TAB[p.id] === tab)
}
const HINT_AT = /(^|\s)\[[a-z]\] \S/
const HINT_SPLIT = /(?<=^|\s)(?=\[[a-z]\] \S)/
function framedView(el: { Box: El; Text: El; Button?: El }, page: Page, frame: FramePane, snap: LiveSnapshot | null, onTab: (t: PaneTab) => void, t: T, cols: number) {
  const { Box, Text, Button } = el
  const ctx = { live: snap, console: frame.console, size: { cols, rows: frame.rows }, t, nowMs: frame.nowMs, ...(page.id === 'decide' && frame.decide !== undefined ? { decide: frame.decide } : {}) }
  const view = frame.view?.[page.id] ?? { focus: 0, expanded: false }
  // the pages that take a view are drawn through their view functions; the registry's render() keeps the default view
  const drawn: Page = page.id === 'fleet' ? { ...page, render: c => fleetPageView(c, view) } : page.id === 'quota' ? { ...page, render: c => renderQuota(c, view) } : page.id === 'spend' ? { ...page, render: c => renderSpend(c, view) } : page
  // free rows go to content first: a folded page (fleet lines, a pool's seats, spend details) is drawn open when the open body fits whole in the rows the surface has left, unless folded by key
  const unfold = view.expanded || view.folded === true ? undefined : page.id === 'fleet' ? (c: PageCtx) => fleetPageView(c, { ...view, expanded: true }) : page.id === 'quota' ? (c: PageCtx) => renderQuota(c, { ...view, expanded: true }) : page.id === 'spend' ? (c: PageCtx) => renderSpend(c, { ...view, expanded: true }) : undefined
  const rows: Row[] = frameRows(drawn, ctx, { pages: frame.pages, ...(unfold === undefined ? {} : { unfold }), ...(frame.scroll === undefined ? {} : { scroll: frame.scroll }) })
  const stripCount = cols < STRIP_SPLIT_COLS ? Math.min(2, rows.length) : Math.min(1, rows.length)
  // the action rows are exactly the ones the page returned (the frame pads nothing): only those rows may bind a `[x]` hint, never the body rows above them
  const avail = Math.max(0, frame.rows - 1 - stripCount)
  const firstActs = drawn.render(ctx).actions.length
  const effActs = avail - Math.min(Math.max(1, firstActs), avail) <= 4 ? drawn.render({ ...ctx, shortBody: true }).actions.length : Math.max(firstActs, unfold === undefined ? 0 : unfold(ctx).actions.length)
  const actionCount = Math.max(0, Math.min(effActs, avail))
  const press = (id: string) => { frame.onPress?.(id) }
  const noteAt = page.id === 'decide' && frame.decide?.textMode === true && el.Input !== undefined ? rows.length - stripCount - 1 : -1
  const typing = frame.decide?.textMode === true // while a note is typed the Input owns every key: the strip binds no digit and no hint binds a letter
  // A page key is carried by a VISIBLE Button: the action row's own `[x] label` (the host draws `x: label`), never an empty-label Button (the host draws that as a row `x:`).
  const keys: Record<string, KeyAction> = pageKeys(page.id)
  const used = new Set<string>()
  const actOf = (letter: string, own: string | undefined): (() => void) | undefined => {
    if (own !== undefined) return () => press(own)
    if (letter === 'i') return () => (frame.onPage !== undefined ? frame.onPage('help') : onTab('legend')) // the help page: the old legend tab until its page is drawn
    if (letter === 'o' && page.id === 'quota') return () => press('quota:open')
    const act = keys[letter]
    return act === undefined || letter === 'o' ? undefined : () => frame.onKey?.(act)
  }
  const drawRow = (r: Row, i: number) => {
    if (i === noteAt && el.Input !== undefined) {
      const Input = el.Input
      return <Box key={'f' + i}><Input key="[REDACTED]" placeholder={t('page.decide.act_text')} value={frame.decide?.textBuf ?? ''} onInput={(v: string) => frame.onText?.(v)} onSubmit={() => frame.onKey?.({ kind: 'text_save' })} autoFocus />{Button === undefined ? null : <Button key="note:cancel" plain onPress={() => frame.onKey?.({ kind: 'text_cancel' })}><Text>{t('page.decide.act_cancel')}</Text></Button>}</Box>
    }
    const isStrip = i >= rows.length - stripCount
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
        nodes.push(isStrip ? <Button key={m[2]} plain {...(typing ? {} : { hotkey: m[1] })} onPress={choose}>{label}</Button> : <Button key={'a:' + i + ':' + m[2]} plain onPress={choose}>{label}</Button>)
        continue
      }
      if (sg.press !== undefined && m === null && Button !== undefined) {
        // consecutive segments of one press id are one Button (a fleet line, a quota pool: one row, one Tab stop)
        let e = j
        while (e + 1 < r.length && r[e + 1].press === sg.press) e++
        const run = r.slice(j, e + 1)
        const hint = typing ? null : /^\[([a-z])\] /.exec(run[0].text)
        const letter = hint !== null && !used.has(hint[1]) ? hint[1] : null
        if (letter !== null) used.add(letter)
        const texts = run.map((x, n) => <Text key={'g' + (j + n)} {...drawSeg(x)} wrap="truncate">{n === 0 && letter !== null ? x.text.replace(/^\[[a-z]\] /, '') : x.text}</Text>)
        nodes.push(<Button key={'p:' + i + ':' + j} plain {...(letter === null ? {} : { hotkey: letter })} onPress={() => (sg.press as string).startsWith('key:') ? frame.onKey?.(keys[(sg.press as string).slice(4)]) : press(sg.press as string)}>{texts}</Button>)
        j = e
        continue
      }
      const text = (x: string, k: string) => <Text key={k} {...drawSeg(sg)} wrap="truncate">{x === '' && r.length === 1 ? ' ' : x}</Text>
      if (Button !== undefined && !typing && sg.press === undefined && (isStrip ? sg.text.startsWith('i ') : isActionRow && HINT_AT.test(sg.text))) {
        // hint pieces (`[h] prev  [l] next`) each become a Button carrying their letter; text between stays Text
        const pieces = isStrip ? [sg.text.replace(/\s{2}Esc.*$/, ''), sg.text.slice(sg.text.replace(/\s{2}Esc.*$/, '').length)].filter(x => x !== '') : sg.text.split(HINT_SPLIT)
        pieces.forEach((pc, n) => {
          const hm = isStrip ? (n === 0 && pc.startsWith('i ') ? ['', 'i'] : null) : /^\[([a-z])\] /.exec(pc)
          const act = hm === null || used.has(hm[1]) ? undefined : actOf(hm[1], undefined)
          if (hm === null || act === undefined) { nodes.push(text(pc, 'g' + j + '.' + n)); return }
          used.add(hm[1])
          nodes.push(<Button key={'h:' + hm[1]} plain hotkey={hm[1]} onPress={act}>{text(pc.replace(/^(\[[a-z]\]|i) /, ''), 'g' + j + '.' + n)}</Button>)
        })
        continue
      }
      nodes.push(text(sg.text, 'g' + j))
    }
    return <Box key={'f' + i}>{nodes}</Box>
  }
  return <Box flexDirection="column" height={frame.rows}>{rows.map(drawRow)}{focusAnchor(el)}</Box>
}

// how one PaneLine is drawn (shared by the tabs and the console's 指揮 page): plain segments, a press row of Buttons, a text field, a toggle Button, a goto Button
function lineView(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, decide: DecideActs | null, onToggle: (id: string) => void, onTab: (t: PaneTab) => void) {
  const { Box, Text, Link, Button, Input } = el
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
            : <Button key={r.press.replace(/^pick:/, 'opt:')} plain onPress={() => decide.onPress(r.press as string)}>{texts}</Button>
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
    ? <Button key={k + 'b' + i} plain onPress={() => onToggle(l.toggle as string)}>{drawn(l)}</Button>
    // a line that carries a `goto` tab (a projection row, design plan §2.3) is a Button that opens that tab
    : l.goto !== undefined && Button !== undefined
    ? <Button key={k + 'g' + i} plain onPress={() => onTab(l.goto as PaneTab)}>{drawn(l)}</Button>
    : plainLine(l, i, k)
  return line
}

export function Pane(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, snap: LiveSnapshot | null, tab: PaneTab = 'now', onTab: (t: PaneTab) => void = () => {}, t: T = T_EN, bodyColumns: number | null = null, onNext: () => void = () => {}, expanded: ReadonlySet<string> = new Set(), onToggle: (id: string) => void = () => {}, folded: ReadonlySet<string> = new Set(), scroll: ScrollView | null = null, decide: DecideActs | null = null, win: ScrollModel | null = null, fleet: FleetView | null = null, con: ConsolePane | null = null, frame: FramePane | null = null) {
  const { Box, Text, Link, Button, Input } = el
  const cols = paneWidth(bodyColumns)
  const ctx = { t, cols, expanded, folded, fleet, ...(decide === null ? {} : { decide: { ...decide.state, ...(decide.batch === undefined ? {} : { batch: decide.batch }), ...(decide.now === undefined ? {} : { now: decide.now }), inputs: decide.inputs && Input !== undefined } }) }
  const line = lineView(el, decide, onToggle, (g: PaneTab) => onTab(g))
  if (con !== null) {
    // 本席: the header (spend, context), then 現況, 派工, 審查 under a dim name each; the lines are the ones the non-console tabs draw
    const own = snap === null ? null : { parts: [{ title: null, lines: headerLines(snap, ctx) }, { title: t('console.self.now'), lines: nowLines(snap, ctx) }, { title: t('console.self.dispatch'), lines: dispatchLines(snap, ctx) }, { title: t('console.self.review'), lines: reviewTabLines(snap, ctx) }], draw: line }
    return consolePane(el, con, t, cols, own)
  }
  const framed = framedPage(frame, tab)
  if (frame !== null && framed !== undefined) return framedView(el, framed, frame, snap, onTab, t, cols)
  const strip = tabStrip(el, tab, onTab, snap, t, cols)
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
  const body: PaneLine[] = tab === 'legend' ? legendLines(ctx) : tab === 'now' ? nowLines(snap, ctx) : tab === 'decide' ? decideTabLines(snap, ctx) : tab === 'review' ? reviewTabLines(snap, ctx) : tab === 'spend' ? spendTabLines(snap, ctx) : tab === 'hygiene' ? hygieneTabLines(snap, ctx) : tab === 'fleet' ? fleetTabLines(snap, ctx) : dispatchLines(snap, ctx)
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
