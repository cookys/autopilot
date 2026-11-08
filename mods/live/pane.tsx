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
import { keyedGrow, scrollFrame } from './scroll'
import type { ScrollModel } from './scroll'

export type { PaneTab } from './model'

// The operator-console mode (consoletabs.ts): the shared navigation state (snapshot + tab) and what a press on a tab / the `›` chip does. null = every session without .claude/console.json.
// Beyond the navigation: the live snapshot (the cards the host holds), the clock, the answering wiring, the scroll model of the 指揮 page, and its folded sections.
export type ConsolePane = { nav: ConsoleNav; onTab: (t: ConsoleTab) => void; onNext: () => void; live?: LiveSnapshot | null; now?: number; decide?: DecideActs | null; scroll?: ScrollView | null; win?: ScrollModel | null; folded?: ReadonlySet<string>; onToggle?: (id: string) => void; inline?: boolean }

// The console pane (C1 U4, U6): the five-tab strip with its badges, then the page. The command page's own content is U5; 團隊 · 額度 · 主機 are a skeleton (consolepages.ts: a name line and a summary line, or
// "no source", never an empty table); 本席 folds this session's own 現況, 派工 and 審查 (the non-console pane's builders, tabs.ts) under one header. `own` is what 本席 draws: null = this session has no snapshot yet.
type SelfDraw = (l: PaneLine, i: number, k: string) => unknown
function consolePane(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, con: ConsolePane, t: T, cols: number, own: { parts: { title: string | null; lines: PaneLine[] }[]; draw: SelfDraw } | null) {
  const { Box, Text } = el
  const strip = stripView(el, consoleStrip({ t, cols }, con.nav, el.Button !== undefined), con.onTab, con.onNext)
  const tab = con.nav.tab
  const stripRows = consoleStrip({ t, cols }, con.nav, el.Button !== undefined).rows
  const win = con.win ?? null
  if (win !== null) win.framed = false
  if (con.nav.snap !== null && tab === 'command') {
    const decide = con.decide ?? null
    const ctx = { t, cols, expanded: new Set<string>(), folded: con.folded ?? new Set<string>(), fleet: null, ...(decide === null ? {} : { decide: { ...decide.state, ...(decide.batch === undefined ? {} : { batch: decide.batch }), ...(decide.now === undefined ? {} : { now: decide.now }), inputs: decide.inputs && el.Input !== undefined } }) }
    const view = commandView(con.nav.snap, con.live ?? null, ctx, con.now ?? con.nav.snap.generated_at_ms)
    const line = lineView(el, decide, con.onToggle ?? (() => {}), () => {})
    const scroll = con.scroll ?? null
    if (scroll !== null && win !== null) {
      keyedGrow(win, view.body.map((_, i) => String(i)))
      return scrollFrame(el, {
        rows: scroll.bodyRows, cols, head: [strip], headRows: stripRows, total: view.body.length, window: (off, room) => view.body.slice(off, off + room).map((l, i) => line(l, off + i)),
        bar: view.bar.map((l, i) => line(l, i, 'bar')), barRows: view.bar.length, model: win,
      })
    }
    return (
      <Box flexDirection="column">
        {strip}
        {view.body.map((l, i) => line(l, i))}
        {view.bar.map((l, i) => line(l, i, 'bar'))}
      </Box>
    )
  }
  const page = tab === 'team' || tab === 'quota' || tab === 'hosts' ? consolePage(con.nav.snap, tab, t) : null
  return (
    <Box flexDirection="column">
      {strip}
      {tab === 'command' && con.nav.snap === null ? <Text {...dimProps()} wrap="truncate">{t('console.no_source')}</Text> : null}
      {page === null ? null : page.lines.map((l, i) => <Text key={'p' + i} {...(page.kind === 'summary' ? {} : dimProps())} wrap="truncate">{l}</Text>)}
      {tab === 'self' ? (own === null ? <Text {...dimProps()}>{t('pane.waiting')}</Text> : own.parts.map((p, n) => <Box key={'s' + n} flexDirection="column">{p.title === null ? null : <Text {...dimProps()} wrap="truncate">{p.title}</Text>}{p.lines.map((l, i) => own.draw(l, i, 's' + n))}</Box>)) : null}
    </Box>
  )
}

// What the 待決 tab's controls call: a press on an option or the send Button (by its `press` id), and an edit of a note field (by the field's key). `state` is the
// owner's picks and notes as the host holds them; `inputs` is whether the surface draws text fields.
export type DecideActs = { state: DecideState; batch?: DecideBatch; now?: number; inputs: boolean; onPress: (id: string) => void; onNote: (key: string, value: string) => void; onKeep: (key: string, value: string) => void }

type El = (props: any) => any

// The tab strip (ui.ts `strip`): Buttons when the surface has them (a click or Enter switches the tab), plain Text otherwise. The active tab is a bold name, and
// the baseline under the strip carries a `claude` run of `━` beneath it (a strip that wraps keeps the bold alone). A tab that holds something for the owner is
// drawn attention bold (no badge, no count).
// The FIRST drawn Button is the `›` next-tab chip and it carries the pane's autoFocus ("of several in one site the first drawn wins"): whenever Ctrl+x Tab or
// `open({focus})` hands the pane the keyboard, the ring lands on a Button whose Enter steps to the next tab. It used to land on the ACTIVE tab's Button,
// where Enter pressed the tab already showing (a no-op): "Ctrl+x Tab, Enter, Enter" cycled tabs only when the ring happened to sit on the band's ⓘ
// (real machine 2026-10-10, 120 columns). The tab Buttons stay pressable (a click, or Tab / arrows + Enter) and still select their own tab.
function tabStrip(el: { Box: El; Text: El; Button?: El }, tab: PaneTab, onTab: (t: PaneTab) => void, onNext: () => void, snap: LiveSnapshot | null, t: T, cols: number) {
  return stripView(el, stripOf(snap, { t, cols }, tab, el.Button !== undefined) as Strip<PaneTab>, onTab, onNext)
}
// the drawing half of the strip, shared with the operator-console pane (same Buttons, same `›` chip, same baseline)
function stripView<Id extends string>(el: { Box: El; Text: El; Button?: El }, strip: Strip<Id>, onTab: (t: Id) => void, onNext: () => void) {
  const { Box, Text, Button } = el
  const draw = (s: Seg, k: string | number) => <Text key={k} {...drawSeg(s)} wrap="truncate">{s.text}</Text>
  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap">
        {Button === undefined || strip.next === null ? null : <Box key="next"><Button key="next" plain autoFocus onPress={onNext}>{strip.next.text}</Button><Text> </Text></Box>}
        {strip.tabs.map(x => (
          <Box key={x.id}>
            {Button === undefined ? draw(x.label, 'label') : <Button key={x.id} plain onPress={() => onTab(x.id)}>{draw(x.label, 'label')}</Button>}
            <Text> </Text>
          </Box>
        ))}
      </Box>
      <Box>{strip.rule.map((s, i) => draw(s, 'rule' + i))}</Box>
    </Box>
  )
}

// how one PaneLine is drawn (shared by the tabs and the console's 指揮 page): plain segments, a press row of Buttons, a text field, a toggle Button, a goto Button
function lineView(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, decide: DecideActs | null, onToggle: (id: string) => void, onTab: (t: PaneTab) => void) {
  const { Box, Text, Button, Input } = el
  const segsOf = (l: PaneLine): Seg[] => l.segs ?? [{ text: l.text }]
  const drawn = (l: PaneLine) => segsOf(l).map((x, j) => <Text key={'g' + j} {...drawSeg(x)} wrap="truncate">{x.text}</Text>)
  // a line with no segments is the blank (drawn as a one-cell Text: an empty Text takes no row); every other line is a row of segments
  const plainLine = (l: PaneLine, i: number, k = '') => l.segs !== undefined
    ? <Box key={k + 'l' + i} flexWrap={l.wrap === true ? 'wrap' : undefined}>{l.segs.map((s, j) => <Text key={'g' + j} {...drawSeg(s)} wrap={l.wrap === true ? 'wrap' : 'truncate'}>{s.text}</Text>)}</Box>
    : <Text key={k + 'l' + i} wrap="truncate">{l.text === '' ? ' ' : l.text}</Text>
  // a line with pressable segments (the 待決 option row and send row): consecutive segments of one `press` id are one Button, the rest plain Text. Without Button it is plain.
  const pressLine = (l: PaneLine, i: number, k: string) => {
    const runs: { press: string | undefined; segs: Seg[] }[] = []
    for (const s of l.segs as Seg[]) {
      const last = runs[runs.length - 1]
      if (last !== undefined && last.press === s.press) last.segs.push(s)
      else runs.push({ press: s.press, segs: [s] })
    }
    return (
      <Box key={k + 'p' + (runs.find(r => r.press !== undefined)?.press ?? i)} flexWrap="wrap">
        {runs.map((r, j) => {
          const texts = r.segs.map((s, n) => <Text key={'g' + n} {...drawSeg(s)} wrap="truncate">{s.text}</Text>)
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
        {Input === undefined || decide === null ? null : <Input key={f.key} placeholder={f.placeholder} value={f.value} onInput={(v: string) => decide.onNote(f.key, v)} onSubmit={(v: string) => decide.onKeep(f.key, v)} />}
      </Box>
    )
  }
  // a line that carries a `toggle` id is a Button when the surface has them (a press expands / collapses its group), the plain line otherwise
  const line = (l: PaneLine, i: number, k = '') => l.field !== undefined && l.segs !== undefined
    ? fieldLine(l, i, k)
    : l.segs !== undefined && (l.kind === 'choice' || l.segs.some(x => x.press !== undefined))
    ? pressLine(l, i, k)
    : l.toggle !== undefined && Button !== undefined
    ? <Button key={k + 'b' + i} plain onPress={() => onToggle(l.toggle as string)}>{drawn(l)}</Button>
    // a line that carries a `goto` tab (a projection row, design plan §2.3) is a Button that opens that tab
    : l.goto !== undefined && Button !== undefined
    ? <Button key={k + 'g' + i} plain onPress={() => onTab(l.goto as PaneTab)}>{drawn(l)}</Button>
    : plainLine(l, i, k)
  return line
}

export function Pane(el: { Box: El; Text: El; Link: El; Button?: El; Input?: El }, snap: LiveSnapshot | null, tab: PaneTab = 'now', onTab: (t: PaneTab) => void = () => {}, t: T = T_EN, bodyColumns: number | null = null, onNext: () => void = () => {}, expanded: ReadonlySet<string> = new Set(), onToggle: (id: string) => void = () => {}, folded: ReadonlySet<string> = new Set(), scroll: ScrollView | null = null, decide: DecideActs | null = null, win: ScrollModel | null = null, fleet: FleetView | null = null, con: ConsolePane | null = null) {
  const { Box, Text, Link, Button, Input } = el
  const cols = paneWidth(bodyColumns)
  const ctx = { t, cols, expanded, folded, fleet, ...(decide === null ? {} : { decide: { ...decide.state, ...(decide.batch === undefined ? {} : { batch: decide.batch }), ...(decide.now === undefined ? {} : { now: decide.now }), inputs: decide.inputs && Input !== undefined } }) }
  const line = lineView(el, decide, onToggle, (g: PaneTab) => onTab(g))
  if (con !== null) {
    // 本席: the header (spend, context), then 現況, 派工, 審查 under a dim name each; the lines are the ones the non-console tabs draw
    const own = snap === null ? null : { parts: [{ title: null, lines: headerLines(snap, ctx) }, { title: t('console.self.now'), lines: nowLines(snap, ctx) }, { title: t('console.self.dispatch'), lines: dispatchLines(snap, ctx) }, { title: t('console.self.review'), lines: reviewTabLines(snap, ctx) }], draw: line }
    return consolePane(el, con, t, cols, own)
  }
  const strip = tabStrip(el, tab, onTab, onNext, snap, t, cols)
  if (snap === null) {
    return (
      <Box flexDirection="column">
        {strip}
        <Text {...dimProps()}>{t('pane.waiting')}</Text>
      </Box>
    )
  }
  // the global header (design plan §2.2): drawn here, once, on every tab; no tab builder emits it (I9)
  // (pane.overflow: this site's own scroll state, so the one thing allowed to differ between tabs: the last metrics line may end with the overflow hint)
  const body: PaneLine[] = tab === 'legend' ? legendLines(ctx) : tab === 'now' ? nowLines(snap, ctx) : tab === 'decide' ? decideTabLines(snap, ctx) : tab === 'review' ? reviewTabLines(snap, ctx) : tab === 'spend' ? spendTabLines(snap, ctx) : tab === 'hygiene' ? hygieneTabLines(snap, ctx) : tab === 'fleet' ? fleetTabLines(snap, ctx) : dispatchLines(snap, ctx)
  const link = tab === 'dispatch' && snap.link !== null
  const stripH = stripOf(snap, ctx, tab, Button !== undefined)
  const plainHead = headerLines(snap, ctx)
  // the 待決 tab is a scrolling window of its own (design plan §12.10): the strip and the header stay, the cards scroll, the send row sits in the fixed action strip under a rule
  if (win !== null) win.framed = false // set again by the frame; a plain tree leaves ui.scroll to the engine
  if (tab === 'decide' && scroll !== null && win !== null && snap.band !== null) {
    const cards = body.filter(l => l.bar !== true)
    const barLines = body.filter(l => l.bar === true)
    keyedGrow(win, decide !== null && decide.batch !== undefined ? decide.batch.order : snap.pending.map(d => d.id ?? d.question))
    return scrollFrame(el, {
      rows: scroll.bodyRows, cols, head: [strip, ...plainHead.map((l, i) => line(l, i, 'h'))], headRows: stripH.rows + plainHead.length,
      total: cards.length, window: (off, room) => cards.slice(off, off + room).map((l, i) => line(l, off + i)),
      bar: barLines.map((l, i) => line(l, i, 'bar')), barRows: barLines.length, model: win,
    })
  }
  const head = withOverflowHint(plainHead, ctx, scroll, treeRowCount(stripH.rows, plainHead, body, link ? 1 : 0), stripH.exact).map((l, i) => line(l, i, 'h'))
  return (
    <Box flexDirection="column">
      {strip}
      {head}
      {body.map((l, i) => line(l, i))}
      {link ? <Link href={snap.link as string} label={t('dispatch.link')} /> : null}
    </Box>
  )
}
